// @ts-nocheck
// AppProvider backed by Supabase
// Falls back to mock data if Supabase isn't configured yet.

import { supabase } from './supabase'

const SUPABASE_READY =
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_URL !== 'YOUR_SUPABASE_URL_HERE'

export type Status   = 'pending' | 'won' | 'lost' | 'push'
export type Sport    = 'NFL' | 'NBA' | 'WNBA' | 'MLB' | 'NHL' | 'CFB' | 'NCAAM' | 'NCAAW' | 'CBB' | 'Soccer' | 'MMA' | 'Other'
export type BetType  = 'spread' | 'moneyline' | 'over_under' | 'parlay' | 'prop' | 'other'

export interface Bet {
  id: string; userId: string; sport: Sport; type: BetType
  description: string; odds: number; stake: number; status: Status
  bookmaker: string; createdAt: Date; settledAt?: Date; gameId?: string | null
}

export interface AppUser {
  id: string; username: string; displayName: string; emoji: string
  isPro: boolean
}

// ── Row → Domain ────────────────────────────────────────────
function rowToBet(row: any): Bet {
  return {
    id:          row.id,
    userId:      row.user_id,
    sport:       row.sport as Sport,
    type:        row.type as BetType,
    description: row.description,
    odds:        row.odds,
    stake:       Number(row.stake),
    status:      row.status as Status,
    bookmaker:   row.sportsbook,
    gameId:      row.game_id ?? null,
    createdAt:   new Date(row.created_at),
    settledAt:   row.settled_at ? new Date(row.settled_at) : undefined,
  }
}

function rowToUser(row: any): AppUser {
  return {
    id:          row.id,
    username:    row.username,
    displayName: row.display_name,
    emoji:       row.emoji ?? '🦁',
    isPro:       row.is_pro ?? false,
  }
}

// ── Supabase-backed actions ─────────────────────────────────

export async function fetchGroupBets(groupId: string): Promise<Bet[]> {
  if (!SUPABASE_READY) return []
  const { data, error } = await supabase
    .from('bets')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
  if (error) { console.error('[store] fetchGroupBets:', error.message); return [] }
  return (data ?? []).map(rowToBet)
}

export async function fetchGroupMembers(groupId: string): Promise<AppUser[]> {
  if (!SUPABASE_READY) return []
  const { data, error } = await supabase
    .from('group_members')
    .select('profiles(*)')
    .eq('group_id', groupId)
  if (error) { console.error('[store] fetchGroupMembers:', error.message); return [] }
  return (data ?? []).map((row: any) => rowToUser(row.profiles)).filter(Boolean)
}

// ── Reactions ────────────────────────────────────────────────
// Aggregated per bet: { betId: { emoji: [userId, ...] } }
export async function fetchReactions(betIds: string[]): Promise<Record<string, Record<string, string[]>>> {
  if (!SUPABASE_READY || betIds.length === 0) return {}
  const { data, error } = await supabase
    .from('bet_reactions')
    .select('*')
    .in('bet_id', betIds)
  if (error) { console.error('[store] fetchReactions:', error.message); return {} }
  const out: Record<string, Record<string, string[]>> = {}
  for (const r of data ?? []) {
    out[r.bet_id] ??= {}
    out[r.bet_id][r.emoji] ??= []
    out[r.bet_id][r.emoji].push(r.user_id)
  }
  return out
}

export async function toggleReaction(betId: string, userId: string, emoji: string): Promise<void> {
  if (!SUPABASE_READY) return
  // Is it already there? Toggle off, else on.
  const { data: existing } = await supabase
    .from('bet_reactions')
    .select('*')
    .eq('bet_id', betId).eq('user_id', userId).eq('emoji', emoji)
    .maybeSingle()
  if (existing) {
    await supabase.from('bet_reactions').delete().eq('bet_id', betId).eq('user_id', userId).eq('emoji', emoji)
  } else {
    await supabase.from('bet_reactions').insert({ bet_id: betId, user_id: userId, emoji })
  }
}

// ── Comments ─────────────────────────────────────────────────
export async function fetchComments(betIds: string[]): Promise<Record<string, any[]>> {
  if (!SUPABASE_READY || betIds.length === 0) return {}
  const { data, error } = await supabase
    .from('bet_comments')
    .select('*')
    .in('bet_id', betIds)
    .order('created_at', { ascending: true })
  if (error) { console.error('[store] fetchComments:', error.message); return {} }
  const out: Record<string, any[]> = {}
  for (const c of data ?? []) {
    out[c.bet_id] ??= []
    out[c.bet_id].push({ id: c.id, userId: c.user_id, text: c.text, createdAt: new Date(c.created_at) })
  }
  return out
}

export async function insertComment(betId: string, userId: string, text: string): Promise<any | null> {
  if (!SUPABASE_READY) return null
  const { data, error } = await supabase
    .from('bet_comments')
    .insert({ bet_id: betId, user_id: userId, text })
    .select().single()
  if (error) { console.error('[store] insertComment:', error.message); return null }
  return { id: data.id, userId: data.user_id, text: data.text, createdAt: new Date(data.created_at) }
}

// ── Pick'em ──────────────────────────────────────────────────
export async function fetchPickemPicks(groupId: string): Promise<{ gameId: string; userId: string; pick: string }[]> {
  if (!SUPABASE_READY) return []
  const { data, error } = await supabase
    .from('pickem_picks')
    .select('*')
    .eq('group_id', groupId)
  if (error) { console.error('[store] fetchPickemPicks:', error.message); return [] }
  return (data ?? []).map((r: any) => ({ gameId: r.game_id, userId: r.user_id, pick: r.pick }))
}

export async function upsertPickemPick(groupId: string, userId: string, gameId: string, pick: string): Promise<void> {
  if (!SUPABASE_READY) return
  const { error } = await supabase
    .from('pickem_picks')
    .upsert({ group_id: groupId, user_id: userId, game_id: gameId, pick }, { onConflict: 'group_id,user_id,game_id' })
  if (error) console.error('[store] upsertPickemPick:', error.message)
}

// ── Survivor ─────────────────────────────────────────────────
export async function fetchSurvivorPicks(groupId: string): Promise<{ day: string; gameId: string; userId: string; pick: string }[]> {
  if (!SUPABASE_READY) return []
  const { data, error } = await supabase
    .from('survivor_picks')
    .select('*')
    .eq('group_id', groupId)
  if (error) { console.error('[store] fetchSurvivorPicks:', error.message); return [] }
  return (data ?? []).map((r: any) => ({ day: r.day, gameId: r.game_id, userId: r.user_id, pick: r.pick }))
}

export async function upsertSurvivorPick(groupId: string, userId: string, day: string, gameId: string, pick: string): Promise<void> {
  if (!SUPABASE_READY) return
  const { error } = await supabase
    .from('survivor_picks')
    .upsert({ group_id: groupId, user_id: userId, day, game_id: gameId, pick }, { onConflict: 'group_id,user_id,day' })
  if (error) console.error('[store] upsertSurvivorPick:', error.message)
}

// Featured "game of the day" pinned per group — first writer wins.
export async function fetchFeaturedGames(groupId: string): Promise<Record<string, string>> {
  if (!SUPABASE_READY) return {}
  const { data, error } = await supabase
    .from('survivor_featured')
    .select('*')
    .eq('group_id', groupId)
  if (error) { console.error('[store] fetchFeaturedGames:', error.message); return {} }
  const out: Record<string, string> = {}
  for (const r of data ?? []) out[r.day] = r.game_id
  return out
}

export async function pinFeaturedGame(groupId: string, day: string, gameId: string): Promise<void> {
  if (!SUPABASE_READY) return
  // Ignore conflicts so the first member to pin a day wins.
  const { error } = await supabase
    .from('survivor_featured')
    .upsert({ group_id: groupId, day, game_id: gameId }, { onConflict: 'group_id,day', ignoreDuplicates: true })
  if (error) console.error('[store] pinFeaturedGame:', error.message)
}

// ── Realtime ─────────────────────────────────────────────────
// Fires onChange whenever bets/reactions/comments/picks change. Returns an unsubscribe fn.
export function subscribeToGroup(groupId: string, onChange: () => void): () => void {
  if (!SUPABASE_READY) return () => {}
  const channel = supabase
    .channel(`group-${groupId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bets', filter: `group_id=eq.${groupId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bet_reactions' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bet_comments' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pickem_picks', filter: `group_id=eq.${groupId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'survivor_picks', filter: `group_id=eq.${groupId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'survivor_featured', filter: `group_id=eq.${groupId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${groupId}` }, onChange)
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}

// Ensure the current user has a profile row; returns their profile.
export async function ensureMyProfile(): Promise<{ id: string; displayName: string; username: string; nameConfirmed: boolean } | null> {
  if (!SUPABASE_READY) return null
  const { data: { session } } = await supabase.auth.getSession()
  const u = session?.user
  if (!u) return null
  const { data: existing } = await supabase
    .from('profiles').select('id, display_name, username, name_confirmed').eq('id', u.id).maybeSingle()
  if (existing) return { id: (existing as any).id, displayName: (existing as any).display_name, username: (existing as any).username, nameConfirmed: !!(existing as any).name_confirmed }
  const username = (u.email ?? 'user').split('@')[0].replace(/[^a-z0-9_]/gi, '_')
  const gname = (u.user_metadata?.full_name || u.user_metadata?.name || username)
  const { data: created, error } = await supabase
    .from('profiles').insert({ id: u.id, username, display_name: gname, name_confirmed: false })
    .select('id, display_name, username, name_confirmed').single()
  if (error) { console.error('[store] ensureMyProfile:', error.message); return null }
  return { id: (created as any).id, displayName: (created as any).display_name, username: (created as any).username, nameConfirmed: false }
}

export async function setDisplayName(name: string): Promise<void> {
  if (!SUPABASE_READY) return
  const { data: { session } } = await supabase.auth.getSession()
  const uid = session?.user?.id
  if (!uid) return
  await supabase.from('profiles').update({ display_name: name, name_confirmed: true }).eq('id', uid)
}

export async function fetchMyGroups(): Promise<{ id: string; name: string; code: string }[]> {
  if (!SUPABASE_READY) return []
  const { data: { session } } = await supabase.auth.getSession()
  const uid = session?.user?.id
  if (!uid) return []
  const { data, error } = await supabase
    .from('group_members')
    .select('groups(*)')
    .eq('user_id', uid)
  if (error) { console.error('[store] fetchMyGroups:', error.message); return [] }
  return (data ?? [])
    .map((r: any) => r.groups)
    .filter(Boolean)
    .map((g: any) => ({ id: g.id, name: g.name, code: g.code }))
}

export async function leaveGroupMembership(groupId: string, userId: string): Promise<boolean> {
  if (!SUPABASE_READY) return false
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId)
  if (error) { console.error('[store] leaveGroupMembership:', error.message); return false }
  return true
}

export async function fetchLastGroup(): Promise<string | null> {
  if (!SUPABASE_READY) return null
  const { data: { session } } = await supabase.auth.getSession()
  const uid = session?.user?.id
  if (!uid) return null
  const { data } = await supabase.from('profiles').select('last_group_id').eq('id', uid).single()
  return (data as any)?.last_group_id ?? null
}

export async function setLastGroup(groupId: string): Promise<void> {
  if (!SUPABASE_READY) return
  const { data: { session } } = await supabase.auth.getSession()
  const uid = session?.user?.id
  if (!uid) return
  await supabase.from('profiles').update({ last_group_id: groupId }).eq('id', uid)
}

export async function fetchGroupByCode(code: string) {
  if (!SUPABASE_READY) return null
  const { data, error } = await supabase
    .from('groups')
    .select('*')
    .eq('code', code)
    .single()
  if (error) return null
  return data
}

export async function insertBet(
  bet: Omit<Bet, 'id' | 'createdAt' | 'settledAt'>,
  groupId: string
): Promise<{ bet: Bet | null; error: string | null }> {
  if (!SUPABASE_READY) return { bet: null, error: null }
  const row = {
    user_id:     bet.userId,
    group_id:    groupId,
    game_id:     bet.gameId ?? null,
    sport:       bet.sport,
    type:        bet.type,
    description: bet.description,
    odds:        bet.odds,
    stake:       bet.stake,
    status:      bet.status,
    sportsbook:  bet.bookmaker,
  }
  const doInsert = () => supabase.from('bets').insert(row).select().single()
  let { data, error } = await doInsert()
  if (error) {
    // Likely a stale/unattached session token (mobile background tabs are
    // the common trigger) — refresh and retry once before giving up.
    await supabase.auth.refreshSession().catch(() => {})
    ;({ data, error } = await doInsert())
  }
  if (error) { console.error('[store] insertBet:', error.message); return { bet: null, error: error.message } }
  return { bet: rowToBet(data), error: null }
}

export async function updateBetStatus(
  id: string,
  status: 'won' | 'lost' | 'push'
): Promise<boolean> {
  if (!SUPABASE_READY) return false
  const { error } = await supabase
    .from('bets')
    .update({ status, settled_at: new Date().toISOString() })
    .eq('id', id)
  if (error) { console.error('[store] updateBetStatus:', error.message); return false }
  return true
}

export async function updateProfile(
  id: string,
  updates: { is_pro?: boolean; display_name?: string; emoji?: string }
): Promise<boolean> {
  if (!SUPABASE_READY) return false
  const { error } = await supabase.from('profiles').update(updates).eq('id', id)
  if (error) { console.error('[store] updateProfile:', error.message); return false }
  return true
}

export async function getOrCreateProfile(authUser: {
  id: string; email: string; name?: string
}): Promise<AppUser | null> {
  if (!SUPABASE_READY) return null

  // Try to fetch existing profile
  const { data: existing } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', authUser.id)
    .single()

  if (existing) return rowToUser(existing)

  // Create new profile
  const username = authUser.email.split('@')[0].replace(/[^a-z0-9_]/gi, '_')
  const { data: created, error } = await supabase
    .from('profiles')
    .insert({
      id:           authUser.id,
      username,
      display_name: authUser.name ?? username,
      emoji:        '🦁',
      is_pro:       false,
    })
    .select()
    .single()

  if (error) { console.error('[store] getOrCreateProfile:', error.message); return null }
  return rowToUser(created)
}

export { SUPABASE_READY }
