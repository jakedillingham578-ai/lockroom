// Real weekly Bracket: group members seeded by real betting profit, then
// eliminated head-to-head based on real profit during each round's window.

export interface BracketMatch {
  id: string
  round: number
  slot: number
  userAId: string | null
  userBId: string | null // null = bye
  periodStart: string
  periodEnd: string
  winnerId: string | null
}

export interface BracketState {
  id: string
  groupId: string
  status: 'active' | 'completed'
  round: number
  roundDays: number
  championId: string | null
  matches: BracketMatch[]
}

// Standard single-elimination seed order, e.g. seedOrder(8) = [1,8,4,5,2,7,3,6].
// Pairing consecutive entries gives the correct top-seed-vs-bottom-seed bracket.
export function seedOrder(size: number): number[] {
  if (size <= 1) return [1]
  const half = seedOrder(size / 2)
  const out: number[] = []
  for (const s of half) out.push(s, size + 1 - s)
  return out
}

function nextPowerOf2(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

// Build round-1 pairings for a list of seeded user ids (best profit first).
// Users beyond the real count are byes — the standard seed order naturally
// gives byes to the top seeds when the group size isn't a power of 2.
export function buildRound1(seededUserIds: string[]): { slot: number; userAId: string | null; userBId: string | null }[] {
  const n = seededUserIds.length
  const size = nextPowerOf2(n)
  const order = seedOrder(size)
  const userOf = (seed: number) => (seed <= n ? seededUserIds[seed - 1] : null)
  const pairs: { slot: number; userAId: string | null; userBId: string | null }[] = []
  for (let i = 0; i < order.length; i += 2) {
    pairs.push({ slot: i / 2, userAId: userOf(order[i]), userBId: userOf(order[i + 1]) })
  }
  return pairs
}

// Real profit for a user from their own bets settled within [start, end).
export function profitInWindow(bets: { userId: string; status: string; odds: number; stake: number; settledAt?: Date; createdAt: Date }[], userId: string, start: Date, end: Date): number {
  const payout = (b: { odds: number; stake: number }) => b.odds > 0 ? b.stake * b.odds / 100 : b.stake * 100 / Math.abs(b.odds)
  return bets
    .filter(b => b.userId === userId && (b.status === 'won' || b.status === 'lost'))
    .filter(b => { const t = (b.settledAt ?? b.createdAt).getTime(); return t >= start.getTime() && t < end.getTime() })
    .reduce((sum, b) => sum + (b.status === 'won' ? payout(b) : -b.stake), 0)
}

export type BracketAction =
  | { kind: 'setWinner'; matchId: string; winnerId: string }
  | { kind: 'createRound'; round: number; roundDays: number; periodStart: Date; periodEnd: Date; pairs: { slot: number; userAId: string | null; userBId: string | null }[] }
  | { kind: 'complete'; championId: string }

// Look at the current round, decide byes/finished matchups, and figure out
// what needs to happen next — advance a round, or crown a champion. Pure
// function; the caller persists whatever actions come back.
export function computeBracketActions(
  bracket: BracketState,
  bets: { userId: string; status: string; odds: number; stake: number; settledAt?: Date; createdAt: Date }[],
  now: Date = new Date()
): BracketAction[] {
  if (bracket.status === 'completed') return []
  const actions: BracketAction[] = []
  const currentRoundMatches = bracket.matches.filter(m => m.round === bracket.round)

  for (const m of currentRoundMatches) {
    if (m.winnerId) continue
    // Bye: auto-advance immediately, no need to wait out the period.
    if (!m.userBId && m.userAId) { actions.push({ kind: 'setWinner', matchId: m.id, winnerId: m.userAId }); continue }
    if (!m.userAId && m.userBId) { actions.push({ kind: 'setWinner', matchId: m.id, winnerId: m.userBId }); continue }
    if (!m.userAId || !m.userBId) continue // both empty — shouldn't happen

    if (now.getTime() < new Date(m.periodEnd).getTime()) continue // round still in progress

    const start = new Date(m.periodStart), end = new Date(m.periodEnd)
    const profitA = profitInWindow(bets, m.userAId, start, end)
    const profitB = profitInWindow(bets, m.userBId, start, end)
    let winnerId: string
    if (profitA !== profitB) winnerId = profitA > profitB ? m.userAId : m.userBId
    else winnerId = m.userAId < m.userBId ? m.userAId : m.userBId // deterministic tiebreak
    actions.push({ kind: 'setWinner', matchId: m.id, winnerId })
  }

  // If every match in the current round now has a winner (including ones
  // just decided above), advance to the next round or crown a champion.
  const decidedThisPass = new Map<string, string>()
  for (const a of actions) if (a.kind === 'setWinner') decidedThisPass.set(a.matchId, a.winnerId)
  const winnerOf = (m: BracketMatch) => m.winnerId ?? decidedThisPass.get(m.id) ?? null

  const allDecided = currentRoundMatches.every(m => winnerOf(m) !== null)
  if (!allDecided) return actions

  const orderedWinners = currentRoundMatches
    .slice().sort((a, b) => a.slot - b.slot)
    .map(m => winnerOf(m) as string)

  if (orderedWinners.length === 1) {
    actions.push({ kind: 'complete', championId: orderedWinners[0] })
    return actions
  }

  const nextRound = bracket.round + 1
  const periodStart = now
  const periodEnd = new Date(now.getTime() + bracket.roundDays * 864e5)
  const pairs: { slot: number; userAId: string | null; userBId: string | null }[] = []
  for (let i = 0; i < orderedWinners.length; i += 2) {
    pairs.push({ slot: i / 2, userAId: orderedWinners[i], userBId: orderedWinners[i + 1] ?? null })
  }
  actions.push({ kind: 'createRound', round: nextRound, roundDays: bracket.roundDays, periodStart, periodEnd, pairs })
  return actions
}
