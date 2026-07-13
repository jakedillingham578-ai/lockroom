// ESPN Public API — completely free, no API key required
// Endpoints are unofficial but stable and widely used.
// Docs/reference: https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports'

// Map our sport labels → ESPN sport + one or more league slugs.
// Soccer covers the World Cup + major competitions so those games show up.
export const ESPN_PATHS: Record<string, { sport: string; leagues: string[] }> = {
  NFL:    { sport: 'football',   leagues: ['nfl'] },
  CFB:    { sport: 'football',   leagues: ['college-football'] },
  NBA:    { sport: 'basketball', leagues: ['nba'] },
  MLB:    { sport: 'baseball',   leagues: ['mlb'] },
  NHL:    { sport: 'hockey',     leagues: ['nhl'] },
  Soccer: { sport: 'soccer',     leagues: [
    'fifa.world',        // FIFA Men's World Cup
    'fifa.wwc',          // FIFA Women's World Cup
    'uefa.champions',    // Champions League
    'uefa.euro',         // Euros
    'eng.1',             // Premier League
    'esp.1',             // La Liga
    'usa.1',             // MLS
  ] },
  MMA:    { sport: 'mma',        leagues: ['ufc'] },
}

export type GameOdds = {
  provider?: string
  spread?: { home?: { line: string; odds: string }; away?: { line: string; odds: string } }
  total?: { over?: { line: string; odds: string }; under?: { line: string; odds: string } }
  moneyline?: { home?: string; away?: string }
}

export type ESPNGame = {
  id: string
  date: string                  // ISO 8601
  name: string                  // "Buffalo Bills at Kansas City Chiefs"
  shortName: string             // "BUF @ KC"
  sport: string                 // our label e.g. "NFL"
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  completed: boolean
  inProgress: boolean
  displayClock?: string         // "4th 2:34" when live
  venue?: string
  odds?: GameOdds               // live lines from ESPN (DraftKings), when available
}

// Parse ESPN's odds block into clean spread / total / moneyline with American prices.
function parseOdds(comp: any): GameOdds | undefined {
  const o = (comp?.odds ?? [])[0]
  if (!o) return undefined
  const pick = (node: any) => node?.current ?? node?.close ?? node?.open
  const cleanOdds = (s?: string) => { if (!s) return undefined; if (/^ev(en)?$/i.test(s.trim())) return '+100'; return s }
  const cleanLine = (s?: string) => (s ? s.replace(/[^0-9.\-+]/g, '') : undefined)

  const sp = o.pointSpread, tot = o.total, ml = o.moneyline
  const spread = sp ? {
    home: pick(sp.home) ? { line: cleanLine(pick(sp.home).line) ?? '', odds: cleanOdds(pick(sp.home).odds) ?? '' } : undefined,
    away: pick(sp.away) ? { line: cleanLine(pick(sp.away).line) ?? '', odds: cleanOdds(pick(sp.away).odds) ?? '' } : undefined,
  } : undefined
  const total = tot ? {
    over: pick(tot.over) ? { line: cleanLine(pick(tot.over).line) ?? '', odds: cleanOdds(pick(tot.over).odds) ?? '' } : undefined,
    under: pick(tot.under) ? { line: cleanLine(pick(tot.under).line) ?? '', odds: cleanOdds(pick(tot.under).odds) ?? '' } : undefined,
  } : undefined
  const moneyline = ml ? { home: cleanOdds(pick(ml.home)?.odds), away: cleanOdds(pick(ml.away)?.odds) } : undefined

  if (!spread && !total && !moneyline) return undefined
  return { provider: o.provider?.name, spread, total, moneyline }
}

type ESPNEvent = {
  id: string
  date: string
  name: string
  shortName: string
  status: { type: { completed: boolean; description: string; state: string }; displayClock: string }
  competitions: {
    competitors: { homeAway: string; team: { displayName: string }; score: string }[]
    venue?: { fullName: string }
  }[]
}

function parseEvent(event: ESPNEvent, sport: string): ESPNGame {
  const comp = event.competitions[0]
  const home = comp.competitors.find(c => c.homeAway === 'home')
  const away = comp.competitors.find(c => c.homeAway === 'away')
  const completed = event.status.type.completed
  const inProgress = event.status.type.state === 'in'

  return {
    id: event.id,
    date: event.date,
    name: event.name,
    shortName: event.shortName,
    sport,
    homeTeam: home?.team.displayName ?? '',
    awayTeam: away?.team.displayName ?? '',
    homeScore: completed || inProgress ? parseInt(home?.score ?? '-1') : null,
    awayScore: completed || inProgress ? parseInt(away?.score ?? '-1') : null,
    completed,
    inProgress,
    displayClock: event.status.displayClock,
    venue: comp.venue?.fullName,
    odds: parseOdds(comp),
  }
}

// ESPN accepts ?dates=YYYYMMDD or a YYYYMMDD-YYYYMMDD range.
// Build a range covering the last `daysBack` days through today.
export function recentDateRange(daysBack = 4): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '')
  const end = new Date()
  const start = new Date(Date.now() - daysBack * 864e5)
  return `${fmt(start)}-${fmt(end)}`
}

// A range spanning both directions from today.
export function dateRange(daysBack: number, daysForward: number): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '')
  return `${fmt(new Date(Date.now() - daysBack * 864e5))}-${fmt(new Date(Date.now() + daysForward * 864e5))}`
}

// Curated pool of games for Weekly Pick'em: upcoming games to pick from,
// plus recently-finished ones so results can be graded and shown.
export async function fetchPickemGames(): Promise<ESPNGame[]> {
  const all = await fetchAllScoreboards(dateRange(2, 7))
  const seen = new Set<string>()
  const uniq = all.filter(g => (seen.has(g.id) ? false : (seen.add(g.id), true)))
  const now = Date.now()

  // Upcoming games, capped per-sport so a high-volume league (e.g. MLB)
  // doesn't crowd out the World Cup / MLS / etc.
  const PER_SPORT = 3
  const perSportCount: Record<string, number> = {}
  const upcoming = uniq
    .filter(g => !g.completed)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .filter(g => {
      perSportCount[g.sport] = (perSportCount[g.sport] ?? 0) + 1
      return perSportCount[g.sport] <= PER_SPORT
    })
    .slice(0, 12)

  const recent = uniq
    .filter(g => g.completed && (now - new Date(g.date).getTime()) < 3 * 864e5)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5)

  return [...recent, ...upcoming].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

// Games for Survivor: a week's worth across sports, capped per sport per
// day so slates stay pickable. Includes completed games for grading.
export async function fetchSurvivorGames(): Promise<ESPNGame[]> {
  const all = await fetchAllScoreboards(dateRange(2, 7))
  const seen = new Set<string>()
  const uniq = all.filter(g => (seen.has(g.id) ? false : (seen.add(g.id), true)))
  const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA')
  const capCount: Record<string, number> = {}
  const CAP = 4
  return uniq
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .filter(g => {
      const key = g.sport + dayOf(g.date)
      capCount[key] = (capCount[key] ?? 0) + 1
      return capCount[key] <= CAP
    })
}

// Winner of a completed game, or 'DRAW', or null if not final.
export function gameWinner(g: ESPNGame): string | null {
  if (!g.completed || g.homeScore == null || g.awayScore == null) return null
  if (g.homeScore === g.awayScore) return 'DRAW'
  return g.homeScore > g.awayScore ? g.homeTeam : g.awayTeam
}

// Fetch the scoreboard for a sport across ALL its leagues (optionally for a date range).
export async function fetchScoreboard(sportLabel: string, dates?: string): Promise<ESPNGame[]> {
  const path = ESPN_PATHS[sportLabel]
  if (!path) return []
  const qs = dates ? `?dates=${dates}` : ''
  const perLeague = await Promise.allSettled(
    path.leagues.map(async (league) => {
      const res = await fetch(`${ESPN}/${path.sport}/${league}/scoreboard${qs}`)
      if (!res.ok) throw new Error(`ESPN ${res.status}`)
      const data = await res.json()
      return (data.events ?? []).map((e: ESPNEvent) => parseEvent(e, sportLabel))
    })
  )
  const games = perLeague
    .filter((r): r is PromiseFulfilledResult<ESPNGame[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)
  // De-dupe by ESPN event id (leagues shouldn't overlap, but be safe)
  const seen = new Set<string>()
  return games.filter(g => (seen.has(g.id) ? false : (seen.add(g.id), true)))
}

// Fetch scoreboards for all sports (used by settlement engine)
export async function fetchAllScoreboards(dates?: string): Promise<ESPNGame[]> {
  const results = await Promise.allSettled(
    Object.keys(ESPN_PATHS).map(s => fetchScoreboard(s, dates))
  )
  return results
    .filter((r): r is PromiseFulfilledResult<ESPNGame[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)
}

// Search games by team name across all sports (for Add Bet flow)
export async function searchGames(query: string, sportLabel?: string): Promise<ESPNGame[]> {
  const sports = sportLabel ? [sportLabel] : Object.keys(ESPN_PATHS)
  const results = await Promise.allSettled(sports.map(s => fetchScoreboard(s)))
  const games = results
    .filter((r): r is PromiseFulfilledResult<ESPNGame[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)

  if (!query.trim()) return games
  const q = query.toLowerCase()
  return games.filter(g =>
    g.homeTeam.toLowerCase().includes(q) ||
    g.awayTeam.toLowerCase().includes(q) ||
    g.name.toLowerCase().includes(q)
  )
}

// Format game time nicely
export function formatGameTime(isoDate: string): string {
  const d = new Date(isoDate)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  const days = Math.floor(diff / 864e5)

  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  if (days === 0) return `Today · ${time}`
  if (days === 1) return `Tomorrow · ${time}`
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return `${day} · ${time}`
}
