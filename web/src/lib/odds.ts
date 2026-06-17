// ESPN Public API — completely free, no API key required
// Endpoints are unofficial but stable and widely used.
// Docs/reference: https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports'

// Map our sport labels → ESPN sport/league paths
export const ESPN_PATHS: Record<string, { sport: string; league: string }> = {
  NFL:    { sport: 'football',   league: 'nfl' },
  CFB:    { sport: 'football',   league: 'college-football' },
  NBA:    { sport: 'basketball', league: 'nba' },
  MLB:    { sport: 'baseball',   league: 'mlb' },
  NHL:    { sport: 'hockey',     league: 'nhl' },
  Soccer: { sport: 'soccer',     league: 'eng.1' },  // Premier League
  MMA:    { sport: 'mma',        league: 'ufc' },
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
  }
}

// Fetch today's scoreboard for a sport
export async function fetchScoreboard(sportLabel: string): Promise<ESPNGame[]> {
  const path = ESPN_PATHS[sportLabel]
  if (!path) return []
  try {
    const res = await fetch(`${ESPN}/${path.sport}/${path.league}/scoreboard`)
    if (!res.ok) throw new Error(`ESPN ${res.status}`)
    const data = await res.json()
    return (data.events ?? []).map((e: ESPNEvent) => parseEvent(e, sportLabel))
  } catch (e) {
    console.warn(`[ESPN] Failed to fetch ${sportLabel}:`, e)
    return []
  }
}

// Fetch scoreboards for all sports (used by settlement engine)
export async function fetchAllScoreboards(): Promise<ESPNGame[]> {
  const results = await Promise.allSettled(
    Object.keys(ESPN_PATHS).map(s => fetchScoreboard(s))
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
