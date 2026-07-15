// @ts-nocheck
// Auto-settlement engine — powered by ESPN free API (no key needed)

import { supabase } from './supabase'
import { fetchAllScoreboards, fetchBoxscoreStat, recentDateRange, type ESPNGame } from './odds'

type BetRow = {
  id: string
  game_id: string | null
  type: string
  odds: number
  stake: number
  status: string
  description: string
  pick_side: string | null
  pick_line: number | null
  prop_player_id: string | null
  prop_stat: string | null
}

// Player prop: fetch the real box score and compare the player's actual
// stat to the line. Returns null if the game's box score isn't posted yet.
async function evaluatePropBet(bet: BetRow, game: ESPNGame): Promise<'won' | 'lost' | 'push' | null> {
  if (!game.completed) return null
  if (!bet.prop_player_id || !bet.prop_stat || bet.pick_line === null || !bet.pick_side) return null
  const value = await fetchBoxscoreStat(game.sport, game.league, game.id, bet.prop_player_id, bet.prop_stat)
  if (value === null) return null
  if (value === bet.pick_line) return 'push'
  const over = value > bet.pick_line
  return (bet.pick_side === 'over' ? over : !over) ? 'won' : 'lost'
}

function evaluateBet(bet: BetRow, game: ESPNGame): 'won' | 'lost' | 'push' | null {
  if (!game.completed) return null
  if (game.homeScore === null || game.awayScore === null) return null
  const homeScore = game.homeScore
  const awayScore = game.awayScore

  // Preferred path: the EXACT pick captured at bet creation (home/away,
  // over/under + line). No text parsing, no ambiguity.
  if (bet.pick_side) {
    if (bet.type === 'moneyline') {
      const homeWon = homeScore > awayScore
      if (homeScore === awayScore) return 'push' // draw, e.g. soccer
      return (bet.pick_side === 'home' ? homeWon : !homeWon) ? 'won' : 'lost'
    }
    if (bet.type === 'spread' && bet.pick_line !== null) {
      const margin = bet.pick_side === 'home' ? homeScore - awayScore : awayScore - homeScore
      const result = margin + bet.pick_line
      if (result === 0) return 'push'
      return result > 0 ? 'won' : 'lost'
    }
    if (bet.type === 'over_under' && bet.pick_line !== null) {
      const total = homeScore + awayScore
      if (total === bet.pick_line) return 'push'
      const over = total > bet.pick_line
      return (bet.pick_side === 'over' ? over : !over) ? 'won' : 'lost'
    }
  }

  // Fallback: legacy bets created before precise picks existed — parse the
  // human-readable description as a best effort.
  const desc = bet.description.toLowerCase()
  const home = game.homeTeam.toLowerCase()
  const away = game.awayTeam.toLowerCase()
  const mentionsHome = () => home.split(' ').some(w => w.length > 3 && desc.includes(w))

  if (bet.type === 'moneyline') {
    const homeWon = homeScore > awayScore
    const pickedHome = mentionsHome()
    return (pickedHome ? homeWon : !homeWon) ? 'won' : 'lost'
  }

  if (bet.type === 'over_under') {
    const total = homeScore + awayScore
    const overMatch = desc.match(/over\s+([\d.]+)/)
    const underMatch = desc.match(/under\s+([\d.]+)/)
    if (overMatch) {
      const line = parseFloat(overMatch[1])
      if (total === line) return 'push'
      return total > line ? 'won' : 'lost'
    }
    if (underMatch) {
      const line = parseFloat(underMatch[1])
      if (total === line) return 'push'
      return total < line ? 'won' : 'lost'
    }
  }

  if (bet.type === 'spread') {
    const spreadMatch = desc.match(/([+-][\d.]+)/)
    if (!spreadMatch) return null
    const line = parseFloat(spreadMatch[1])
    const pickedHome = mentionsHome()
    const margin = pickedHome ? homeScore - awayScore : awayScore - homeScore
    const result = margin + line
    if (result === 0) return 'push'
    return result > 0 ? 'won' : 'lost'
  }

  // parlay, prop, other — manual only
  return null
}

export async function settlePendingBets(): Promise<{ settled: number; errors: string[] }> {
  const errors: string[] = []
  let settled = 0

  // Only settle the current user's own bets (RLS allows updating own rows only).
  const { data: { user } } = await supabase.auth.getUser()

  let query = supabase
    .from('bets')
    .select('*')
    .eq('status', 'pending')
    .not('game_id', 'is', null)
  if (user) query = query.eq('user_id', user.id)

  const { data: bets, error } = await query
  if (error) return { settled: 0, errors: [error.message] }
  if (!bets?.length) return { settled: 0, errors: [] }

  // Fetch completed games from ESPN (free, no key) over the last few days
  // so recently-finished games are still in the feed.
  let games: ESPNGame[] = []
  try {
    games = await fetchAllScoreboards(recentDateRange(5))
  } catch (e: any) {
    return { settled: 0, errors: [`ESPN fetch failed: ${e.message}`] }
  }

  const gameMap = new Map(games.map(g => [g.id, g]))

  for (const bet of bets) {
    const game = gameMap.get(bet.game_id!)
    if (!game) continue

    const result = bet.type === 'prop'
      ? await evaluatePropBet(bet as BetRow, game)
      : evaluateBet(bet as BetRow, game)
    if (!result) continue

    const { error: updateErr } = await supabase
      .from('bets')
      .update({ status: result, settled_at: new Date().toISOString() })
      .eq('id', bet.id)

    if (updateErr) errors.push(`Bet ${bet.id}: ${updateErr.message}`)
    else settled++
  }

  return { settled, errors }
}

// Call once at app load — runs silently in background
export function runSettlementInBackground() {
  settlePendingBets().then(({ settled, errors }) => {
    if (settled > 0) console.log(`[Settlement] Auto-settled ${settled} bets`)
    if (errors.length) console.warn('[Settlement] Errors:', errors)
  })
}
