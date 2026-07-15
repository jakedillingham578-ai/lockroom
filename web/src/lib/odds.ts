// ESPN Public API — completely free, no API key required
// Endpoints are unofficial but stable and widely used.
// Docs/reference: https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports'

// Map our sport labels → ESPN sport + one or more league slugs.
// Soccer covers the World Cup + major competitions so those games show up.
export const ESPN_PATHS: Record<string, { sport: string; leagues: string[] }> = {
  NFL:    { sport: 'football',   leagues: ['nfl'] },
  CFB:    { sport: 'football',   leagues: ['college-football'] },
  NBA:    { sport: 'basketball', leagues: ['nba', 'nba-summer', 'nba-summer-california'] },
  WNBA:   { sport: 'basketball', leagues: ['wnba'] },
  NCAAM:  { sport: 'basketball', leagues: ['mens-college-basketball'] },
  NCAAW:  { sport: 'basketball', leagues: ['womens-college-basketball'] },
  MLB:    { sport: 'baseball',   leagues: ['mlb'] },
  CBB:    { sport: 'baseball',   leagues: ['college-baseball'] },
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
  league: string                 // ESPN league slug this event was fetched from, e.g. "mlb"
  homeTeam: string
  awayTeam: string
  homeTeamId?: string
  awayTeamId?: string
  homeScore: number | null
  awayScore: number | null
  completed: boolean
  inProgress: boolean
  displayClock?: string         // "4th 2:34" when live
  venue?: string
  odds?: GameOdds               // live lines from ESPN (DraftKings), when available
}

// Which broad sports have simple, flat per-player box scores we can use for
// player props (basketball/baseball). Football/hockey split stats into
// multiple categorized tables per athlete — not supported yet.
export const PROP_CAPABLE_SPORTS = new Set(['NBA', 'WNBA', 'NCAAM', 'NCAAW', 'MLB', 'CBB'])

// Stat categories offered per sport, mapped to the exact ESPN box-score
// column label. `parse` extracts a plain number from that column's raw
// string (some columns are compound like "5-11" made-attempted).
export const PROP_STATS: Record<string, { key: string; label: string; parse: (raw: string) => number | null }[]> = {
  basketball: [
    { key: 'PTS', label: 'Points', parse: n => parseFloat(n) },
    { key: 'REB', label: 'Rebounds', parse: n => parseFloat(n) },
    { key: 'AST', label: 'Assists', parse: n => parseFloat(n) },
    { key: 'STL', label: 'Steals', parse: n => parseFloat(n) },
    { key: 'BLK', label: 'Blocks', parse: n => parseFloat(n) },
    { key: '3PT', label: '3-Pointers Made', parse: n => parseFloat((n.split('-')[0] ?? '')) },
  ],
  baseball: [
    { key: 'H', label: 'Hits', parse: n => parseFloat(n) },
    { key: 'R', label: 'Runs', parse: n => parseFloat(n) },
    { key: 'RBI', label: 'RBIs', parse: n => parseFloat(n) },
    { key: 'HR', label: 'Home Runs', parse: n => parseFloat(n) },
    { key: 'BB', label: 'Walks', parse: n => parseFloat(n) },
    { key: 'K', label: 'Strikeouts', parse: n => parseFloat(n) },
  ],
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
    competitors: { homeAway: string; team: { id?: string; displayName: string }; score: string }[]
    venue?: { fullName: string }
  }[]
}

function parseEvent(event: ESPNEvent, sport: string, league: string): ESPNGame {
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
    league,
    homeTeam: home?.team.displayName ?? '',
    awayTeam: away?.team.displayName ?? '',
    homeTeamId: home?.team.id,
    awayTeamId: away?.team.id,
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
// IMPORTANT: format using the LOCAL calendar date, not toISOString() (which
// is always UTC). For anyone west of UTC (all of the US), the UTC date
// rolls over to "tomorrow" while it's still "today" locally for a chunk of
// the evening — that shifted the whole search window and could push
// today's games out of range or group them under the wrong day.
function fmtLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

// Build a range covering the last `daysBack` days through today.
export function recentDateRange(daysBack = 4): string {
  const end = new Date()
  const start = new Date(Date.now() - daysBack * 864e5)
  return `${fmtLocalDate(start)}-${fmtLocalDate(end)}`
}

// A range spanning both directions from today.
export function dateRange(daysBack: number, daysForward: number): string {
  return `${fmtLocalDate(new Date(Date.now() - daysBack * 864e5))}-${fmtLocalDate(new Date(Date.now() + daysForward * 864e5))}`
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
      return (data.events ?? []).map((e: ESPNEvent) => parseEvent(e, sportLabel, league))
    })
  )
  const games = perLeague
    .filter((r): r is PromiseFulfilledResult<ESPNGame[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)
  // De-dupe by ESPN event id (leagues shouldn't overlap, but be safe)
  const seen = new Set<string>()
  return games
    .filter(g => (seen.has(g.id) ? false : (seen.add(g.id), true)))
    // Drop placeholder bracket slots (e.g. future playoff games where the
    // matchup isn't determined yet) — "TBD @ TBD" isn't a real bettable game.
    .filter(g => g.homeTeam && g.awayTeam && g.homeTeam !== 'TBD' && g.awayTeam !== 'TBD')
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

// Search games by team name across all sports (for Add Bet flow).
// IMPORTANT: always pass a date range. Without one, ESPN's "current"
// scoreboard for a league with no games right now (e.g. Euros/Women's World
// Cup outside their tournament window) silently falls back to the LAST
// match ever played — sometimes years old — which looked like a live/
// upcoming game. A bounded window makes those leagues correctly return
// nothing when nothing's actually on.
export async function searchGames(query: string, sportLabel?: string): Promise<ESPNGame[]> {
  const sports = sportLabel ? [sportLabel] : Object.keys(ESPN_PATHS)
  const window = dateRange(3, 14)
  const results = await Promise.allSettled(sports.map(s => fetchScoreboard(s, window)))
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

export type RosterPlayer = { id: string; name: string; position?: string }

// Full season roster for a team — available anytime (unlike the game-day
// lineup, which ESPN doesn't post until close to first pitch/tipoff).
export async function fetchTeamRoster(sportLabel: string, league: string, teamId: string): Promise<RosterPlayer[]> {
  const path = ESPN_PATHS[sportLabel]
  if (!path) return []
  try {
    const res = await fetch(`${ESPN}/${path.sport}/${league}/teams/${teamId}/roster`)
    if (!res.ok) return []
    const data = await res.json()
    const groups = data.athletes ?? []
    const players: RosterPlayer[] = []
    // Two shapes exist across leagues: grouped-by-position ({ items: [...] },
    // e.g. MLB) and a flat list of athlete objects directly (e.g. WNBA).
    for (const g of groups) {
      if (Array.isArray(g.items)) {
        for (const a of g.items) players.push({ id: a.id, name: a.displayName, position: a.position?.abbreviation })
      } else if (g.id && g.displayName) {
        players.push({ id: g.id, name: g.displayName, position: g.position?.abbreviation })
      }
    }
    return players
  } catch {
    return []
  }
}

// Look up one player's stat value from a completed game's real box score.
// Returns null if the game isn't final yet, the player didn't appear, or
// the stat column isn't present (e.g. a pitcher has no rebounds).
export async function fetchBoxscoreStat(
  sportLabel: string, league: string, eventId: string, playerId: string, statKey: string
): Promise<number | null> {
  const path = ESPN_PATHS[sportLabel]
  if (!path) return null
  const group = path.sport === 'basketball' ? PROP_STATS.basketball : path.sport === 'baseball' ? PROP_STATS.baseball : []
  const statDef = group.find(s => s.key === statKey)
  if (!statDef) return null
  try {
    const res = await fetch(`${ESPN}/${path.sport}/${league}/summary?event=${eventId}`)
    if (!res.ok) return null
    const data = await res.json()
    const teams = data.boxscore?.players ?? []
    for (const team of teams) {
      for (const statGroup of team.statistics ?? []) {
        const labels: string[] = statGroup.labels ?? []
        const idx = labels.indexOf(statKey)
        if (idx === -1) continue
        const athlete = (statGroup.athletes ?? []).find((a: any) => a.athlete?.id === playerId)
        if (!athlete) continue
        const raw = athlete.stats?.[idx]
        if (raw == null) continue
        const val = statDef.parse(raw)
        if (val !== null && !isNaN(val)) return val
      }
    }
    return null
  } catch {
    return null
  }
}

// Check one specific game's live status by id — used by Squares to know
// when to grade, without waiting for it to reappear in a scoreboard fetch.
export async function fetchGameStatus(
  sportLabel: string, league: string, eventId: string
): Promise<{ completed: boolean; homeScore: number | null; awayScore: number | null } | null> {
  const path = ESPN_PATHS[sportLabel]
  if (!path) return null
  try {
    const res = await fetch(`${ESPN}/${path.sport}/${league}/summary?event=${eventId}`)
    if (!res.ok) return null
    const data = await res.json()
    const comp = data.header?.competitions?.[0]
    if (!comp) return null
    const completed = !!comp.status?.type?.completed
    const home = comp.competitors?.find((c: any) => c.homeAway === 'home')
    const away = comp.competitors?.find((c: any) => c.homeAway === 'away')
    return {
      completed,
      homeScore: home?.score != null ? parseInt(home.score) : null,
      awayScore: away?.score != null ? parseInt(away.score) : null,
    }
  } catch {
    return null
  }
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
