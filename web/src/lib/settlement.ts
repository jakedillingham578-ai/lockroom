// Auto-settlement engine — powered by ESPN free API (no key needed)

import { supabase } from './supabase'
import { fetchAllScoreboards, type ESPNGame } from './odds'

type BetRow = {
  id: string
  game_id: string | null
  type: string
  odds: number
  stake: number
  status: string
  description: string
}

function evaluateBet(bet: BetRow, game: ESPNGame): 'won' | 'lost' | 'push' | null {
  if (!game.completed) return null
  if (game.homeScore === null || game.awayScore === null) return null

  const desc = bet.description.toLowerCase()
  const home = game.homeTeam.toLowerCase()
  const away = game.awayTeam.toLowerCase()
  const homeScore = game.homeScore
  const awayScore = game.awayScore

  // Helper: did the description mention the home team?
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

  // Fetch pending bets with linked games
  const { data: bets, error } = await supabase
    .from('bets')
    .select('*')
    .eq('status', 'pending')
    .not('game_id', 'is', null)

  if (error) return { settled: 0, errors: [error.message] }
  if (!bets?.length) return { settled: 0, errors: [] }

  // Fetch all completed games from ESPN (free, no key)
  let games: ESPNGame[] = []
  try {
    games = await fetchAllScoreboards()
  } catch (e: any) {
    return { settled: 0, errors: [`ESPN fetch failed: ${e.message}`] }
  }

  const gameMap = new Map(games.map(g => [g.id, g]))

  for (const bet of bets) {
    const game = gameMap.get(bet.game_id!)
    if (!game) continue

    const result = evaluateBet(bet as BetRow, game)
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
