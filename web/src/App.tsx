import React, { useState, useEffect, createContext, useContext, useCallback, useMemo } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google'
import { SUPABASE_READY, fetchGroupBets, fetchGroupMembers, fetchMyGroups, insertBet, updateBetStatus, updateProfile, fetchReactions, toggleReaction, fetchComments, insertComment, subscribeToGroup } from './lib/store'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

// ─── Theme ────────────────────────────────────────────────────────────────────
const C = {
  bg: '#F0F5FA', bgCard: '#FFFFFF', bgEl: '#E4EEF7', bgInput: '#F0F5FA',
  primary: '#4B9CD3', primaryBg: 'rgba(75,156,211,0.12)',
  win: '#16A34A', winBg: 'rgba(22,163,74,0.1)',
  loss: '#DC2626', lossBg: 'rgba(220,38,38,0.1)',
  push: '#D97706', pushBg: 'rgba(217,119,6,0.1)',
  muted: '#5A6A7A', border: '#D6E4F0', borderL: '#B8D0E8',
  gold: '#B45309', goldBg: 'rgba(180,83,9,0.08)',
  text: '#0D1F2D', textMuted: '#8FA3B1',
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Status = 'pending' | 'won' | 'lost' | 'push'
type Sport = 'NFL' | 'NBA' | 'MLB' | 'NHL' | 'CFB' | 'Soccer' | 'MMA' | 'Other'
type BetType = 'spread' | 'moneyline' | 'over_under' | 'parlay' | 'prop' | 'other'

const REACTION_EMOJIS = ['🔥', '🤡', '👀', '💀', '🎯'] as const
type ReactionEmoji = typeof REACTION_EMOJIS[number]

interface Reaction { emoji: ReactionEmoji; userIds: string[] }
interface Comment { id: string; userId: string; text: string; createdAt: Date }

interface Bet {
  id: string; userId: string; sport: Sport; type: BetType
  description: string; odds: number; stake: number; status: Status
  bookmaker: string; createdAt: Date; settledAt?: Date; gameId?: string | null
  reactions?: Reaction[]; comments?: Comment[]
}

interface Stats {
  wins: number; losses: number; totalStaked: number; totalProfit: number
  roi: number; winRate: number; streak: { type: 'win' | 'loss'; count: number }
  weeklyPnl: number[]
}

interface User {
  id: string; username: string; displayName: string; emoji: string
  isPro: boolean; stats: Stats
}

// ─── Seed Data ────────────────────────────────────────────────────────────────
const mkStats = (w: number, l: number, staked: number, profit: number): Stats => ({
  wins: w, losses: l, totalStaked: staked, totalProfit: profit,
  roi: (profit / staked) * 100, winRate: w / (w + l),
  streak: profit >= 0 ? { type: 'win', count: 2 } : { type: 'loss', count: 1 },
  weeklyPnl: [-20, 45, -10, 80, 30, -15, 55],
})

// Real stats computed from actual bets (American-odds payout math)
const betPayout = (b: { odds: number; stake: number }) =>
  b.odds > 0 ? b.stake * b.odds / 100 : b.stake * 100 / Math.abs(b.odds)

function computeStats(allBets: Bet[], userId: string): Stats {
  const ub = allBets
    .filter(b => b.userId === userId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const settled = ub.filter(b => b.status === 'won' || b.status === 'lost')
  const wins = settled.filter(b => b.status === 'won').length
  const losses = settled.filter(b => b.status === 'lost').length
  const totalStaked = settled.reduce((s, b) => s + b.stake, 0)
  const totalProfit = settled.reduce((s, b) => b.status === 'won' ? s + betPayout(b) : s - b.stake, 0)
  const roi = totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0
  const winRate = wins + losses > 0 ? wins / (wins + losses) : 0

  // Current streak from most recent settled bet backwards
  let streakType: 'win' | 'loss' = 'win'
  let count = 0
  for (let i = settled.length - 1; i >= 0; i--) {
    const t: 'win' | 'loss' = settled[i].status === 'won' ? 'win' : 'loss'
    if (count === 0) { streakType = t; count = 1 }
    else if (t === streakType) count++
    else break
  }

  // Daily net P/L for the last 7 days (index 6 = today)
  const now = Date.now(); const day = 864e5
  const weeklyPnl = [0, 0, 0, 0, 0, 0, 0]
  for (const b of settled) {
    const ageDays = Math.floor((now - b.createdAt.getTime()) / day)
    if (ageDays >= 0 && ageDays < 7) {
      weeklyPnl[6 - ageDays] += b.status === 'won' ? betPayout(b) : -b.stake
    }
  }

  return { wins, losses, totalStaked, totalProfit, roi, winRate, streak: { type: streakType, count }, weeklyPnl }
}

const USERS: User[] = [
  { id: 'u1', username: 'you', displayName: 'You', emoji: '🦁', isPro: false, stats: mkStats(14, 8, 1200, 280) },
  { id: 'u2', username: 'owen_bets', displayName: 'Owen', emoji: '🐯', isPro: true, stats: mkStats(22, 10, 2000, 650) },
  { id: 'u3', username: 'will_l', displayName: 'Will', emoji: '🦊', isPro: false, stats: mkStats(8, 18, 1500, -420) },
  { id: 'u4', username: 'charlie_picks', displayName: 'Charlie', emoji: '🐺', isPro: true, stats: mkStats(19, 12, 1800, 380) },
  { id: 'u5', username: 'luke_money', displayName: 'Luke', emoji: '🦅', isPro: false, stats: mkStats(6, 20, 900, -560) },
]

const SEED_BETS: Bet[] = [
  // This week
  { id: 'b1', userId: 'u2', sport: 'NFL', type: 'parlay', description: '2-leg: Chiefs -3.5 vs Bills + Eagles ML vs Cowboys', odds: 265, stake: 100, status: 'won', bookmaker: 'DraftKings', createdAt: new Date(Date.now() - 864e5) },
  { id: 'b2', userId: 'u3', sport: 'NBA', type: 'over_under', description: 'Lakers/Warriors Over 228.5', odds: -115, stake: 50, status: 'lost', bookmaker: 'FanDuel', createdAt: new Date(Date.now() - 864e5 * 2) },
  { id: 'b3', userId: 'u1', sport: 'NFL', type: 'moneyline', description: 'Eagles ML vs Cowboys', odds: 130, stake: 75, status: 'won', bookmaker: 'BetMGM', createdAt: new Date(Date.now() - 864e5 * 3) },
  { id: 'b4', userId: 'u4', sport: 'NFL', type: 'parlay', description: '3-leg: Ravens ML + Over 45.5 + CMC TD', odds: 620, stake: 25, status: 'pending', bookmaker: 'DraftKings', createdAt: new Date(Date.now() - 36e5 * 2) },
  { id: 'b5', userId: 'u5', sport: 'NBA', type: 'spread', description: 'Celtics -5.5 vs Heat', odds: -110, stake: 200, status: 'lost', bookmaker: 'Caesars', createdAt: new Date(Date.now() - 864e5 * 4) },
  { id: 'b6', userId: 'u2', sport: 'CFB', type: 'spread', description: 'Alabama -7 vs Auburn', odds: -110, stake: 150, status: 'won', bookmaker: 'FanDuel', createdAt: new Date(Date.now() - 864e5 * 5) },
  // This month (8–25 days ago) — more losses
  { id: 'b7', userId: 'u4', sport: 'NBA', type: 'moneyline', description: 'Knicks ML vs Bucks', odds: 115, stake: 80, status: 'lost', bookmaker: 'BetMGM', createdAt: new Date(Date.now() - 864e5 * 8) },
  { id: 'b8', userId: 'u1', sport: 'NFL', type: 'spread', description: 'Packers +3 vs Bears', odds: -110, stake: 100, status: 'lost', bookmaker: 'DraftKings', createdAt: new Date(Date.now() - 864e5 * 9) },
  { id: 'b9', userId: 'u3', sport: 'MLB', type: 'moneyline', description: 'Yankees ML vs Red Sox', odds: -130, stake: 130, status: 'lost', bookmaker: 'FanDuel', createdAt: new Date(Date.now() - 864e5 * 11) },
  { id: 'b10', userId: 'u5', sport: 'NFL', type: 'parlay', description: '2-leg: Rams -4 vs 49ers + Under 48.5', odds: 240, stake: 50, status: 'lost', bookmaker: 'Caesars', createdAt: new Date(Date.now() - 864e5 * 13) },
  { id: 'b11', userId: 'u2', sport: 'NBA', type: 'prop', description: 'LeBron Over 27.5 pts', odds: -115, stake: 75, status: 'won', bookmaker: 'DraftKings', createdAt: new Date(Date.now() - 864e5 * 15) },
  { id: 'b12', userId: 'u4', sport: 'NHL', type: 'moneyline', description: 'Bruins ML vs Rangers', odds: -120, stake: 120, status: 'lost', bookmaker: 'BetMGM', createdAt: new Date(Date.now() - 864e5 * 17) },
  { id: 'b13', userId: 'u1', sport: 'CFB', type: 'spread', description: 'Georgia -10 vs Tennessee', odds: -110, stake: 100, status: 'lost', bookmaker: 'FanDuel', createdAt: new Date(Date.now() - 864e5 * 19) },
  { id: 'b14', userId: 'u3', sport: 'NBA', type: 'over_under', description: 'Celtics/Heat Over 215.5', odds: -110, stake: 60, status: 'lost', bookmaker: 'Caesars', createdAt: new Date(Date.now() - 864e5 * 22) },
  { id: 'b15', userId: 'u5', sport: 'NFL', type: 'spread', description: 'Cowboys -6 vs Giants', odds: -110, stake: 150, status: 'lost', bookmaker: 'DraftKings', createdAt: new Date(Date.now() - 864e5 * 24) },
  // This year (30–300 days ago) — even worse
  { id: 'b16', userId: 'u2', sport: 'NFL', type: 'parlay', description: '3-leg: Bills ML + Ravens -3 + Over 51', odds: 580, stake: 50, status: 'lost', bookmaker: 'FanDuel', createdAt: new Date(Date.now() - 864e5 * 35) },
  { id: 'b17', userId: 'u4', sport: 'NBA', type: 'spread', description: 'Warriors -4.5 vs Suns', odds: -110, stake: 200, status: 'lost', bookmaker: 'BetMGM', createdAt: new Date(Date.now() - 864e5 * 50) },
  { id: 'b18', userId: 'u1', sport: 'MLB', type: 'moneyline', description: 'Dodgers ML vs Padres', odds: -145, stake: 145, status: 'lost', bookmaker: 'DraftKings', createdAt: new Date(Date.now() - 864e5 * 65) },
  { id: 'b19', userId: 'u3', sport: 'NFL', type: 'spread', description: 'Ravens -7 vs Browns', odds: -110, stake: 100, status: 'lost', bookmaker: 'Caesars', createdAt: new Date(Date.now() - 864e5 * 80) },
  { id: 'b20', userId: 'u5', sport: 'NBA', type: 'parlay', description: '2-leg: Lakers ML + Curry Over 29.5', odds: 310, stake: 40, status: 'lost', bookmaker: 'FanDuel', createdAt: new Date(Date.now() - 864e5 * 100) },
  { id: 'b21', userId: 'u2', sport: 'CFB', type: 'spread', description: 'Ohio State -14 vs Michigan', odds: -110, stake: 200, status: 'lost', bookmaker: 'DraftKings', createdAt: new Date(Date.now() - 864e5 * 120) },
  { id: 'b22', userId: 'u4', sport: 'NHL', type: 'moneyline', description: 'Leafs ML vs Canadiens', odds: -135, stake: 135, status: 'lost', bookmaker: 'BetMGM', createdAt: new Date(Date.now() - 864e5 * 150) },
  { id: 'b23', userId: 'u1', sport: 'NFL', type: 'parlay', description: '3-leg: Chiefs ML + Under 47 + Hill Over 85.5 rec', odds: 450, stake: 75, status: 'lost', bookmaker: 'FanDuel', createdAt: new Date(Date.now() - 864e5 * 180) },
  { id: 'b24', userId: 'u3', sport: 'MMA', type: 'moneyline', description: 'Jones ML vs Miocic', odds: -200, stake: 200, status: 'lost', bookmaker: 'Caesars', createdAt: new Date(Date.now() - 864e5 * 210) },
  { id: 'b25', userId: 'u5', sport: 'NBA', type: 'spread', description: 'Nuggets -5 vs Clippers', odds: -110, stake: 100, status: 'lost', bookmaker: 'DraftKings', createdAt: new Date(Date.now() - 864e5 * 250) },
  { id: 'b26', userId: 'u2', sport: 'MLB', type: 'over_under', description: 'Braves/Mets Over 8.5', odds: -115, stake: 80, status: 'lost', bookmaker: 'FanDuel', createdAt: new Date(Date.now() - 864e5 * 280) },
]

// ─── Context ──────────────────────────────────────────────────────────────────
interface Ctx {
  me: User; users: User[]; bets: Bet[]; groupCode: string; groupName: string; groupId: string | null
  myGroups: { id: string; name: string; code: string }[]
  switchGroup: (id: string) => void
  openAddGroup: () => void
  addBet: (b: Omit<Bet, 'id' | 'createdAt'>) => void
  settleBet: (id: string, s: 'won' | 'lost' | 'push') => void
  getUserById: (id: string) => User | undefined
  upgradePro: () => void
  signOut: () => void
  reactToBet: (betId: string, emoji: ReactionEmoji) => void
  commentOnBet: (betId: string, text: string) => void
  darkMode: boolean; toggleDark: () => void
}

const AppCtx = createContext<Ctx>(null as any)
const useApp = () => useContext(AppCtx)

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase()
}

function GroupSetupPage({ onGroup, onCancel }: { onGroup: (id: string, name: string, code: string) => void; onCancel?: () => void }) {
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose')
  const [groupName, setGroupName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    if (!groupName.trim()) return setError('Enter a group name.')
    setLoading(true); setError('')
    const code = generateCode()
    try {
      if (SUPABASE_READY) {
        const { supabase: sb } = await import('./lib/supabase')
        const { data: { user } } = await sb.auth.getUser()
        const { data, error: err } = await (sb as any).from('groups').insert({ name: groupName.trim(), code, owner_id: user?.id, max_members: 25 }).select().single()
        if (err) throw err
        await (sb as any).from('group_members').insert({ group_id: data.id, user_id: user?.id })
        localStorage.setItem(`lockroom-group-${user?.id}`, JSON.stringify({ id: data.id, name: data.name, code: data.code }))
        onGroup(data.id, data.name, data.code)
      } else {
        const fakeId = `g${Date.now()}`
        localStorage.setItem(`lockroom-group-anon`, JSON.stringify({ id: fakeId, name: groupName.trim(), code }))
        onGroup(fakeId, groupName.trim(), code)
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to create group.')
    } finally {
      setLoading(false)
    }
  }

  const join = async () => {
    if (!joinCode.trim()) return setError('Enter a join code.')
    setLoading(true); setError('')
    try {
      if (SUPABASE_READY) {
        const { supabase: sb } = await import('./lib/supabase')
        const { data: { user } } = await sb.auth.getUser()
        const { data: group, error: err } = await (sb as any).from('groups').select('*').eq('code', joinCode.trim().toUpperCase()).single()
        if (err || !group) throw new Error('Group not found. Check the code.')
        await (sb as any).from('group_members').upsert({ group_id: group.id, user_id: user?.id })
        localStorage.setItem(`lockroom-group-${user?.id}`, JSON.stringify({ id: group.id, name: group.name, code: group.code }))
        onGroup(group.id, group.name, group.code)
      } else {
        setError('Join requires a live connection.')
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to join group.')
    } finally {
      setLoading(false)
    }
  }

  const s: Record<string, React.CSSProperties> = {
    wrap: { minHeight: '100vh', background: '#0a1929', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', fontFamily: 'system-ui,-apple-system,sans-serif' },
    card: { background: '#0f2236', border: '1px solid #1a3a52', borderRadius: 20, padding: '32px 28px', width: '100%', maxWidth: 380 },
    title: { color: '#fff', fontSize: 22, fontWeight: 900, marginBottom: 6, textAlign: 'center' },
    sub: { color: '#5a7a90', fontSize: 14, textAlign: 'center', marginBottom: 24, lineHeight: 1.5 },
    input: { width: '100%', background: '#0a1929', border: '1px solid #1a3a52', borderRadius: 12, padding: '14px 16px', color: '#fff', fontSize: 15, outline: 'none', boxSizing: 'border-box', marginBottom: 12 },
    btn: { width: '100%', background: '#4B9CD3', color: '#fff', border: 'none', borderRadius: 12, padding: '14px', fontWeight: 800, fontSize: 15, cursor: 'pointer', marginBottom: 10 },
    ghost: { width: '100%', background: 'transparent', color: '#4B9CD3', border: '1px solid #1a3a52', borderRadius: 12, padding: '14px', fontWeight: 700, fontSize: 15, cursor: 'pointer' },
    err: { color: '#DC2626', fontSize: 13, textAlign: 'center', marginBottom: 8 },
  }

  if (mode === 'choose') return (
    <div style={s.wrap}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
      <div style={{ color: '#4B9CD3', fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>Welcome to Lockroom</div>
      <div style={s.card}>
        <div style={s.title}>Set up your group</div>
        <div style={s.sub}>Create a private group for your crew or join one with a code.</div>
        <button style={s.btn} onClick={() => setMode('create')}>➕ Create a group</button>
        <button style={s.ghost} onClick={() => setMode('join')}>🔑 Join with a code</button>
        {onCancel && <button style={{ ...s.ghost, border: 'none', marginTop: 10, color: '#5a7a90' }} onClick={onCancel}>← Back to app</button>}
      </div>
    </div>
  )

  if (mode === 'create') return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.title}>Create a group</div>
        <div style={s.sub}>Name your crew. You'll get a shareable join code.</div>
        {error && <div style={s.err}>{error}</div>}
        <input style={s.input} placeholder="Group name (e.g. The Boys)" value={groupName} onChange={e => setGroupName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} autoFocus />
        <button style={{ ...s.btn, opacity: loading ? 0.6 : 1 }} onClick={create} disabled={loading}>{loading ? 'Creating...' : 'Create group'}</button>
        <button style={s.ghost} onClick={() => { setMode('choose'); setError('') }}>← Back</button>
      </div>
    </div>
  )

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.title}>Join a group</div>
        <div style={s.sub}>Enter the 6-character code your friend shared.</div>
        {error && <div style={s.err}>{error}</div>}
        <input style={s.input} placeholder="Enter code (e.g. AB12CD)" value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && join()} autoFocus maxLength={6} />
        <button style={{ ...s.btn, opacity: loading ? 0.6 : 1 }} onClick={join} disabled={loading}>{loading ? 'Joining...' : 'Join group'}</button>
        <button style={s.ghost} onClick={() => { setMode('choose'); setError('') }}>← Back</button>
      </div>
    </div>
  )
}

const DEMO = !SUPABASE_READY
const PLACEHOLDER_USER: User = { id: '', username: '', displayName: '', emoji: '🦁', isPro: false, stats: computeStats([], '') }

function AppProvider({ children, onSignOut }: { children: React.ReactNode; onSignOut: () => void }) {
  const [users, setUsers] = useState<User[]>(DEMO ? USERS : [])
  const [bets, setBets] = useState<Bet[]>(DEMO ? SEED_BETS : [])
  const [myId, setMyId] = useState<string>(DEMO ? 'u1' : '')
  const [groupId, setGroupId] = useState<string | null>(null)
  const [groupName, setGroupName] = useState('My Group')
  const [groupCode, setGroupCode] = useState('')
  const [loading, setLoading] = useState(SUPABASE_READY)
  const [needsGroup, setNeedsGroup] = useState(false)
  const [addingGroup, setAddingGroup] = useState(false)
  const [myGroups, setMyGroups] = useState<{ id: string; name: string; code: string }[]>([])
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('lockroom-dark') === 'true')

  const me = useMemo(() => users.find(u => u.id === myId) ?? users[0] ?? PLACEHOLDER_USER, [users, myId])

  const toggleDark = useCallback(() => {
    setDarkMode(prev => { const next = !prev; localStorage.setItem('lockroom-dark', String(next)); return next })
  }, [])

  // Pull everything for a group from Supabase and rebuild state with real stats.
  const loadGroup = useCallback(async (gId: string) => {
    try {
      const { supabase: sb } = await import('./lib/supabase')
      const { data: { user: authUser } } = await sb.auth.getUser()
      const [members, groupBets] = await Promise.all([
        fetchGroupMembers(gId),
        fetchGroupBets(gId),
      ])
      const betIds = groupBets.map(b => b.id)
      const [reactionsMap, commentsMap] = await Promise.all([
        fetchReactions(betIds),
        fetchComments(betIds),
      ])

      // Attach reactions + comments to each bet
      const enrichedBets = groupBets.map(b => ({
        ...b,
        reactions: reactionsMap[b.id]
          ? Object.entries(reactionsMap[b.id]).map(([emoji, userIds]) => ({ emoji: emoji as ReactionEmoji, userIds }))
          : [],
        comments: commentsMap[b.id] ?? [],
      })) as Bet[]
      setBets(enrichedBets)

      // Build members with stats computed from real bets
      if (members.length > 0) {
        const mapped: User[] = members.map(m => ({
          id: m.id, username: m.username, displayName: m.displayName,
          emoji: m.emoji, isPro: m.isPro, stats: computeStats(enrichedBets, m.id),
        }))
        setUsers(mapped)
      }
      if (authUser) setMyId(authUser.id)
    } catch (e) {
      console.warn('[AppProvider] loadGroup failed:', e)
    }
  }, [])

  // Load real data from Supabase on mount
  useEffect(() => {
    if (!SUPABASE_READY) return

    async function load() {
      try {
        const { supabase: sb } = await import('./lib/supabase')
        const { data: { user: authUser } } = await sb.auth.getUser()
        const uid = authUser?.id
        if (uid) setMyId(uid)

        const groups = await fetchMyGroups()
        setMyGroups(groups)

        if (groups.length === 0) { setNeedsGroup(true); return }

        // Resolve the active group: last-used if still a member, else first.
        const savedId = uid ? localStorage.getItem(`lockroom-active-${uid}`) : null
        const active = groups.find(g => g.id === savedId) ?? groups[0]
        if (uid) localStorage.setItem(`lockroom-active-${uid}`, active.id)
        setGroupId(active.id); setGroupName(active.name); setGroupCode(active.code)
        await loadGroup(active.id)
      } catch (e) {
        console.warn('[AppProvider] Supabase load failed:', e)
        setNeedsGroup(true)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [loadGroup])

  // Live sync: refetch when anyone in the group changes bets/reactions/comments,
  // plus on window focus and a slow poll as a fallback if realtime isn't enabled.
  useEffect(() => {
    if (!SUPABASE_READY || !groupId) return
    const refetch = () => { loadGroup(groupId) }
    const unsub = subscribeToGroup(groupId, refetch)
    window.addEventListener('focus', refetch)
    const poll = setInterval(refetch, 20000)
    return () => { unsub(); window.removeEventListener('focus', refetch); clearInterval(poll) }
  }, [groupId, loadGroup])

  // Auto-settle: for bets linked to a real game, check ESPN scores and mark
  // won/lost/push automatically. Runs on load and every 2 minutes.
  useEffect(() => {
    if (!SUPABASE_READY || !groupId) return
    let cancelled = false
    const runSettle = async () => {
      try {
        const { settlePendingBets } = await import('./lib/settlement')
        const { settled } = await settlePendingBets()
        if (!cancelled && settled > 0) loadGroup(groupId)
      } catch (e) { console.warn('[settlement]', e) }
    }
    runSettle()
    const iv = setInterval(runSettle, 120000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [groupId, loadGroup])

  const handleGroupReady = useCallback(async (id: string, name: string, code: string) => {
    setGroupId(id); setGroupName(name); setGroupCode(code)
    setNeedsGroup(false); setAddingGroup(false)
    if (myId) localStorage.setItem(`lockroom-active-${myId}`, id)
    if (SUPABASE_READY) {
      const groups = await fetchMyGroups()
      setMyGroups(groups)
      await loadGroup(id)
    }
  }, [loadGroup, myId])

  const switchGroup = useCallback(async (id: string) => {
    const g = myGroups.find(x => x.id === id)
    if (!g || id === groupId) return
    setGroupId(g.id); setGroupName(g.name); setGroupCode(g.code)
    if (myId) localStorage.setItem(`lockroom-active-${myId}`, g.id)
    setBets([]); setUsers([])   // clear stale group data while the new one loads
    if (SUPABASE_READY) await loadGroup(g.id)
  }, [myGroups, groupId, myId, loadGroup])

  const openAddGroup = useCallback(() => setAddingGroup(true), [])

  const getUserById = useCallback((id: string) => users.find(u => u.id === id), [users])

  const addBet = useCallback(async (b: Omit<Bet, 'id' | 'createdAt'>) => {
    const local: Bet = { ...b, id: `b${Date.now()}`, createdAt: new Date(), reactions: [], comments: [] }
    setBets(prev => [local, ...prev]) // optimistic
    if (SUPABASE_READY && groupId) {
      await insertBet(b, groupId)
      await loadGroup(groupId) // reconcile with real row + recompute stats
    }
  }, [groupId, loadGroup])

  const settleBet = useCallback(async (id: string, s: 'won' | 'lost' | 'push') => {
    setBets(prev => prev.map(b => b.id === id ? { ...b, status: s, settledAt: new Date() } : b))
    if (SUPABASE_READY) {
      await updateBetStatus(id, s)
      if (groupId) await loadGroup(groupId)
    }
  }, [groupId, loadGroup])

  const upgradePro = useCallback(async () => {
    setUsers(prev => prev.map(u => u.id === myId ? { ...u, isPro: true } : u))
    if (SUPABASE_READY && myId) await updateProfile(myId, { is_pro: true })
  }, [myId])

  const reactToBet = useCallback(async (betId: string, emoji: ReactionEmoji) => {
    // optimistic toggle
    setBets(prev => prev.map(b => {
      if (b.id !== betId) return b
      const reactions = b.reactions ? [...b.reactions] : []
      const existing = reactions.find(r => r.emoji === emoji)
      if (existing) {
        const already = existing.userIds.includes(myId)
        return { ...b, reactions: reactions.map(r => r.emoji === emoji ? { ...r, userIds: already ? r.userIds.filter(id => id !== myId) : [...r.userIds, myId] } : r).filter(r => r.userIds.length > 0) }
      }
      return { ...b, reactions: [...reactions, { emoji, userIds: [myId] }] }
    }))
    if (SUPABASE_READY && myId) await toggleReaction(betId, myId, emoji)
  }, [myId])

  const commentOnBet = useCallback(async (betId: string, text: string) => {
    const temp: Comment = { id: `c${Date.now()}`, userId: myId, text, createdAt: new Date() }
    setBets(prev => prev.map(b => b.id !== betId ? b : { ...b, comments: [...(b.comments ?? []), temp] }))
    if (SUPABASE_READY && myId) await insertComment(betId, myId, text)
  }, [myId])

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#F0F5FA', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 40 }}>🔒</div>
      <div style={{ fontWeight: 800, fontSize: 20 }}>Lockroom</div>
      <div style={{ color: '#5A6A7A', fontSize: 14 }}>Loading your group...</div>
    </div>
  )

  if (needsGroup) return <GroupSetupPage onGroup={handleGroupReady} />
  if (addingGroup) return <GroupSetupPage onGroup={handleGroupReady} onCancel={() => setAddingGroup(false)} />

  return (
    <AppCtx.Provider value={{ me, users, bets, groupCode, groupName, groupId, myGroups, switchGroup, openAddGroup, addBet, settleBet, getUserById, upgradePro, signOut: onSignOut, reactToBet, commentOnBet, darkMode, toggleDark }}>
      <div style={{ filter: darkMode ? 'invert(1) hue-rotate(180deg)' : 'none', minHeight: '100vh' }}>
        {children}
      </div>
    </AppCtx.Provider>
  )
}

// ─── Shared helpers ───────────────────────────────────────────────────────────
const fmtOdds = (o: number) => o > 0 ? `+${o}` : `${o}`
const fmtMoney = (n: number) => `${n >= 0 ? '+' : ''}$${Math.abs(n).toFixed(0)}`
const timeAgo = (d: Date) => {
  const s = (Date.now() - d.getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
const pnl = (b: Bet) => b.status === 'won' ? (b.odds > 0 ? b.stake * b.odds / 100 : b.stake * 100 / Math.abs(b.odds)) : b.status === 'lost' ? -b.stake : 0

const STATUS = {
  won: { color: C.win, bg: C.winBg, label: 'WON', icon: '✅' },
  lost: { color: C.loss, bg: C.lossBg, label: 'LOST', icon: '❌' },
  push: { color: C.push, bg: C.pushBg, label: 'PUSH', icon: '🔄' },
  pending: { color: C.muted, bg: 'rgba(158,158,158,0.12)', label: 'LIVE', icon: '⏳' },
}

// ─── Logo & Illustrations ─────────────────────────────────────────────────────
function LockroomLogo({ size = 80 }: { size?: number }) {
  // 6 people evenly spaced around a circle of radius 34, centered at 40,40
  const people = Array.from({ length: 6 }, (_, i) => {
    const angle = (i * 60 - 90) * (Math.PI / 180)
    const r = 28
    const cx = 40 + r * Math.cos(angle)
    const cy = 40 + r * Math.sin(angle)
    return { cx, cy }
  })

  return (
    <svg width={size} height={size} viewBox="-5 -5 90 90" fill="none">
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6EC6F0" />
          <stop offset="100%" stopColor="#2a7ab5" />
        </linearGradient>
        <linearGradient id="lockBodyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5BAEE0" />
          <stop offset="100%" stopColor="#1e6fa8" />
        </linearGradient>
        <filter id="logoShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#4B9CD3" floodOpacity="0.25" />
        </filter>
      </defs>


      {/* Connecting ring line */}
      <circle cx="40" cy="40" r="27" fill="none" stroke="#4B9CD3" strokeWidth="1" strokeDasharray="2 3" opacity="0.4" />

      {/* Clip art people around the circle */}
      {people.map((p, i) => (
        <g key={i} transform={`translate(${p.cx}, ${p.cy}) rotate(${i * 60})`}>
          {/* Head */}
          <circle cx="0" cy="-9" r="3.5" fill="#4B9CD3" />
          {/* Body */}
          <rect x="-3" y="-5" width="6" height="7" rx="1.5" fill="#4B9CD3" />
          {/* Left arm */}
          <line x1="-3" y1="-4" x2="-6" y2="-1" stroke="#4B9CD3" strokeWidth="1.8" strokeLinecap="round" />
          {/* Right arm */}
          <line x1="3" y1="-4" x2="6" y2="-1" stroke="#4B9CD3" strokeWidth="1.8" strokeLinecap="round" />
          {/* Left leg */}
          <line x1="-1.5" y1="2" x2="-3" y2="7" stroke="#4B9CD3" strokeWidth="1.8" strokeLinecap="round" />
          {/* Right leg */}
          <line x1="1.5" y1="2" x2="3" y2="7" stroke="#4B9CD3" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      ))}

      {/* Lock body */}
      <rect x="26" y="38" width="28" height="20" rx="6" fill="url(#lockBodyGrad)" />

      {/* Lock shackle */}
      <path d="M31 38 L31 32 C31 26 49 26 49 32 L49 38"
        stroke="url(#lockBodyGrad)" strokeWidth="4" strokeLinecap="round" fill="none" />

      {/* Lock shine */}
      <rect x="26" y="38" width="28" height="8" rx="6" fill="white" opacity="0.15" />

      {/* Keyhole */}
      <circle cx="40" cy="47" r="3.5" fill="white" opacity="0.9" />
      <rect x="38.5" y="49" width="3" height="4.5" rx="1.5" fill="white" opacity="0.9" />
    </svg>
  )
}

function IllustrationLeaderboard() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      {/* Podium bars */}
      <rect x="4" y="36" width="16" height="20" rx="3" fill={C.primaryBg} stroke={C.primary} strokeWidth="1.5" />
      <rect x="24" y="26" width="16" height="30" rx="3" fill={C.primary} />
      <rect x="44" y="40" width="16" height="16" rx="3" fill={C.primaryBg} stroke={C.primary} strokeWidth="1.5" />
      {/* Heads */}
      <circle cx="12" cy="28" r="7" fill={C.primaryBg} stroke={C.primary} strokeWidth="1.5" />
      <circle cx="32" cy="18" r="7" fill="white" stroke={C.primary} strokeWidth="1.5" />
      <circle cx="52" cy="32" r="7" fill={C.primaryBg} stroke={C.primary} strokeWidth="1.5" />
      {/* Crown on winner */}
      <path d="M25 12 L25 7 L28.5 10 L32 5 L35.5 10 L39 7 L39 12 Z" fill="#FFD700" stroke="#B8860B" strokeWidth="0.8" strokeLinejoin="round" />
      <rect x="25" y="12" width="14" height="3" rx="1" fill="#FFD700" stroke="#B8860B" strokeWidth="0.8" />
      <circle cx="32" cy="7" r="1.2" fill="white" />
      <circle cx="26" cy="9" r="0.9" fill="white" />
      <circle cx="38" cy="9" r="0.9" fill="white" />
    </svg>
  )
}

function IllustrationBetSlip() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      {/* Ticket shape */}
      <rect x="10" y="8" width="44" height="48" rx="6" fill="white" stroke={C.primary} strokeWidth="1.5" />
      {/* Dashed middle */}
      <line x1="10" y1="34" x2="54" y2="34" stroke={C.border} strokeWidth="1.5" strokeDasharray="3 3" />
      {/* Notches */}
      <circle cx="10" cy="34" r="4" fill={C.bg} stroke={C.primary} strokeWidth="1.5" />
      <circle cx="54" cy="34" r="4" fill={C.bg} stroke={C.primary} strokeWidth="1.5" />
      {/* Lines of text */}
      <rect x="18" y="16" width="28" height="3" rx="1.5" fill={C.primaryBg} />
      <rect x="18" y="23" width="20" height="3" rx="1.5" fill={C.primaryBg} />
      {/* Win checkmark */}
      <circle cx="32" cy="47" r="7" fill={C.win} opacity="0.15" />
      <path d="M28 47 l3 3 5-6" stroke={C.win} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IllustrationCompete() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      {/* Trophy cup */}
      <path d="M22 10 h20 v18 a10 10 0 0 1-20 0 Z" fill={C.primaryBg} stroke={C.primary} strokeWidth="1.5" />
      {/* Trophy handles */}
      <path d="M22 16 Q12 16 12 24 Q12 30 22 30" stroke={C.primary} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <path d="M42 16 Q52 16 52 24 Q52 30 42 30" stroke={C.primary} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      {/* Stem */}
      <rect x="28" y="38" width="8" height="10" rx="2" fill={C.primary} opacity="0.4" />
      {/* Base */}
      <rect x="20" y="48" width="24" height="5" rx="2.5" fill={C.primary} />
      {/* Star inside */}
      <path d="M32 18 l2 4 4.5 0 -3.5 3 1.5 4.5 -4.5-3 -4.5 3 1.5-4.5 -3.5-3 4.5 0 Z" fill={C.primary} opacity="0.5" />
    </svg>
  )
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  ['#4B9CD3', '#e8f4fd'],
  ['#2a7ab5', '#d6ecf8'],
  ['#16A34A', '#dcfce7'],
  ['#9333EA', '#f3e8ff'],
  ['#D97706', '#fef3c7'],
]
function Avatar({ name, size = 38 }: { name: string; size?: number }) {
  const idx = name.charCodeAt(0) % AVATAR_COLORS.length
  const [fg, bg] = AVATAR_COLORS[idx]
  const initials = name.slice(0, 2).toUpperCase()
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: bg, border: `2px solid ${fg}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <span style={{ color: fg, fontWeight: 800, fontSize: size * 0.35, letterSpacing: -0.5 }}>{initials}</span>
    </div>
  )
}

// ─── Shared Components ────────────────────────────────────────────────────────
function BetCard({ bet, isMe = false }: { bet: Bet; isMe?: boolean }) {
  const { me, getUserById, settleBet, reactToBet, commentOnBet } = useApp()
  const user = getUserById(bet.userId)
  const [showComments, setShowComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [swipeX, setSwipeX] = useState(0)
  const [swipeStart, setSwipeStart] = useState<number | null>(null)
  if (!user) return null
  const s = STATUS[bet.status]
  const p = pnl(bet)
  const reactions = bet.reactions ?? []
  const comments = bet.comments ?? []

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isMe || bet.status !== 'pending') return
    setSwipeStart(e.touches[0].clientX)
  }
  const handleTouchMove = (e: React.TouchEvent) => {
    if (swipeStart === null) return
    setSwipeX(e.touches[0].clientX - swipeStart)
  }
  const handleTouchEnd = () => {
    if (swipeX > 80) settleBet(bet.id, 'won')
    else if (swipeX < -80) settleBet(bet.id, 'lost')
    setSwipeX(0); setSwipeStart(null)
  }

  return (
    <div style={{ position: 'relative', marginBottom: 10, overflow: 'hidden', borderRadius: 16 }}>
      {isMe && bet.status === 'pending' && (
        <>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '50%', background: C.winBg, display: 'flex', alignItems: 'center', paddingLeft: 20, borderRadius: '16px 0 0 16px' }}>
            <span style={{ color: C.win, fontWeight: 800, fontSize: 13 }}>✅ Won →</span>
          </div>
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '50%', background: C.lossBg, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 20, borderRadius: '0 16px 16px 0' }}>
            <span style={{ color: C.loss, fontWeight: 800, fontSize: 13 }}>← ❌ Lost</span>
          </div>
        </>
      )}
      <div
        onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
        style={{ background: C.bgCard, borderRadius: 16, padding: 16, border: `1px solid ${C.border}`, boxShadow: '0 2px 12px rgba(75,156,211,0.06)', borderLeft: `4px solid ${s.color}`, transform: `translateX(${swipeX}px)`, transition: swipeStart === null ? 'transform 0.2s' : 'none', position: 'relative' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Avatar name={user.displayName} size={38} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{user.displayName}</div>
              <div style={{ color: C.muted, fontSize: 11 }}>{timeAgo(bet.createdAt)}</div>
            </div>
          </div>
          <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 800 }}>{s.icon} {s.label}</span>
        </div>

        {(() => {
          const legs = bet.type === 'parlay'
            ? bet.description.replace(/^\d+-leg:\s*/i, '').split(' + ')
            : [bet.description]
          const isParlay = bet.type === 'parlay'
          return (
            <div style={{ marginBottom: 10 }}>
              {isParlay && <div style={{ fontWeight: 700, fontSize: 13, color: C.muted, marginBottom: 8 }}>{legs.length}-Leg Parlay</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {legs.map((leg, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, background: bet.status === 'won' ? C.winBg : bet.status === 'lost' ? C.lossBg : bet.status === 'push' ? C.pushBg : C.primaryBg, border: `1px solid ${bet.status === 'won' ? C.win : bet.status === 'lost' ? C.loss : bet.status === 'push' ? C.push : C.primary}`, borderRadius: 8, padding: '4px 10px' }}>
                    <span style={{ color: bet.status === 'won' ? C.win : bet.status === 'lost' ? C.loss : bet.status === 'push' ? C.push : C.primary, fontSize: 12 }}>
                      {bet.status === 'won' ? '✓' : bet.status === 'lost' ? '✗' : bet.status === 'push' ? '~' : '·'}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{leg}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

        <div style={{ display: 'flex', gap: 16, fontSize: 13, color: C.muted, marginBottom: 8 }}>
          <span>{bet.sport} · {bet.type.replace('_', '/')}</span>
          <span>{fmtOdds(bet.odds)}</span>
          <span>${bet.stake} stake</span>
          {bet.status !== 'pending' && <span style={{ color: p >= 0 ? C.win : C.loss, fontWeight: 700 }}>{fmtMoney(p)}</span>}
        </div>

        <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 10 }}>{bet.bookmaker}</div>

        {/* Reactions row */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
          {REACTION_EMOJIS.map(emoji => {
            const r = reactions.find(r => r.emoji === emoji)
            const count = r?.userIds.length ?? 0
            const mine = r?.userIds.includes(me.id) ?? false
            return (
              <button key={emoji} onClick={() => reactToBet(bet.id, emoji)} style={{
                background: mine ? C.primaryBg : C.bgEl, border: mine ? `1px solid ${C.primary}` : `1px solid ${C.border}`,
                borderRadius: 99, padding: '3px 9px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4,
                color: mine ? C.primary : C.muted, fontWeight: mine ? 700 : 400,
              }}>
                {emoji}{count > 0 && <span style={{ fontSize: 11 }}>{count}</span>}
              </button>
            )
          })}
          <button onClick={() => setShowComments(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, fontSize: 12, marginLeft: 4 }}>
            💬 {comments.length > 0 ? comments.length : ''}
          </button>
        </div>

        {/* Comments */}
        {showComments && (
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 4 }}>
            {comments.map(c => {
              const cu = getUserById(c.userId)
              return (
                <div key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
                  <Avatar name={cu?.displayName ?? '?'} size={24} />
                  <div style={{ background: C.bgEl, borderRadius: 10, padding: '6px 10px', flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 2 }}>{cu?.displayName}</div>
                    <div style={{ fontSize: 13 }}>{c.text}</div>
                  </div>
                </div>
              )
            })}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input value={commentText} onChange={e => setCommentText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && commentText.trim()) { commentOnBet(bet.id, commentText.trim()); setCommentText('') } }} placeholder="Say something..." style={{ flex: 1, borderRadius: 10, border: `1px solid ${C.border}`, padding: '7px 12px', fontSize: 13, background: C.bgEl, color: C.text, outline: 'none' }} />
              <button onClick={() => { if (commentText.trim()) { commentOnBet(bet.id, commentText.trim()); setCommentText('') } }} style={{ background: C.primary, color: '#fff', border: 'none', borderRadius: 10, padding: '7px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>↑</button>
            </div>
          </div>
        )}

        {isMe && bet.status === 'pending' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {(['won', 'lost', 'push'] as const).map(s => (
              <button key={s} onClick={() => settleBet(bet.id, s)} style={{
                flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12,
                background: STATUS[s].bg, color: STATUS[s].color,
              }}>{STATUS[s].icon} {STATUS[s].label.charAt(0) + STATUS[s].label.slice(1).toLowerCase()}</button>
            ))}
          </div>
        )}
        {isMe && bet.status === 'pending' && <div style={{ textAlign: 'center', fontSize: 11, color: C.muted, marginTop: 6 }}>swipe right = won · swipe left = lost</div>}
      </div>
    </div>
  )
}

// ─── Google Sign-In Button ────────────────────────────────────────────────────
function GoogleSignInButton({ onAuth }: { onAuth: () => void }) {
  const [error, setError] = useState('')

  const handleSuccess = async (credentialResponse: { credential?: string }) => {
    if (!SUPABASE_READY) { onAuth(); return }
    if (!credentialResponse.credential) { setError('Google sign-in failed. Try again.'); return }
    const { supabase: sb } = await import('./lib/supabase')
    const { error: authErr } = await sb.auth.signInWithIdToken({
      provider: 'google',
      token: credentialResponse.credential,
    })
    if (authErr) setError(authErr.message)
    else onAuth()
  }

  return (
    <>
      <div style={{ width: '100%', marginBottom: 10, display: 'flex', justifyContent: 'center' }}>
        <GoogleLogin
          onSuccess={handleSuccess}
          onError={() => setError('Google sign-in failed. Try again.')}
          width="100%"
          text="continue_with"
          shape="rectangular"
        />
      </div>
      {error && <div style={{ color: C.loss, fontSize: 12, textAlign: 'center', marginTop: -4, marginBottom: 8 }}>{error}</div>}
    </>
  )
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function AuthPage({ onAuth }: { onAuth: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmSent, setConfirmSent] = useState(false)

  const handleSubmit = async () => {
    if (!email || !password) return setError('Enter your email and password.')
    setLoading(true); setError('')
    try {
      if (!SUPABASE_READY) { onAuth(); return }
      const { supabase: sb } = await import('./lib/supabase')
      if (mode === 'in') {
        const { error } = await sb.auth.signInWithPassword({ email, password })
        if (error) throw error
        onAuth()
      } else {
        if (!username) return setError('Choose a username.')
        const { data, error } = await sb.auth.signUp({
          email, password,
          options: { data: { full_name: username } },
        })
        if (error) throw error
        if (data.user && !data.session) setConfirmSent(true)
        else onAuth()
      }
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', position: 'relative' }}>
      {/* Background glow blobs */}
      <div style={{ position: 'absolute', top: -120, left: -120, width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(79,70,229,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -80, right: -80, width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle, rgba(79,70,229,0.05) 0%, transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ display: 'flex', width: '100%', alignItems: 'stretch' }}>

        {/* Left panel — hero (hidden on narrow screens via minWidth trick) */}
        <div style={{ flex: 1, minWidth: 340, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '60px 40px', borderRight: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 48, gap: 16, marginTop: 24, marginLeft: -40 }}>
            <LockroomLogo size={72} />
            <div style={{ fontSize: 68, fontWeight: 900, letterSpacing: -3, color: C.primary }}>Lockroom</div>
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5, lineHeight: 1.3, marginBottom: 12, textAlign: 'center', color: C.text }}>
            Your crew.<br />Your picks.<br />
            <span style={{ color: C.primary }}>Your bragging rights.</span>
          </div>
          <div style={{ color: C.muted, fontSize: 15, lineHeight: 1.6, marginBottom: 48, maxWidth: 320, textAlign: 'center' }}>
            The private locker room for your betting group — compete, trash talk, and see who really knows their stuff.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 360 }}>
            {[
              { Img: IllustrationLeaderboard, title: 'Group Leaderboards', desc: 'Live standings across all your bets.' },
              { Img: IllustrationBetSlip, title: 'Full Bet History', desc: 'Spreads, MLs, parlays, props — all tracked.' },
              { Img: IllustrationCompete, title: 'Group Competitions', desc: 'Weekly challenges and custom formats.' },
            ].map(f => (
              <div key={f.title} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 16, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16, padding: '14px 16px', boxShadow: '0 2px 12px rgba(75,156,211,0.06)' }}>
                <f.Img />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{f.title}</div>
                  <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

        </div>

        {/* Right panel — form */}
        <div style={{ width: 420, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '60px 48px' }}>
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>
              {mode === 'in' ? 'Sign in' : 'Create an account'}
            </div>
            <div style={{ color: C.muted, fontSize: 14 }}>
              {mode === 'in' ? 'Good to have you back.' : 'Free to join. No credit card needed.'}
            </div>
          </div>

          {/* Toggle */}
          <div style={{ display: 'flex', background: C.bgEl, borderRadius: 12, padding: 4, marginBottom: 24, border: `1px solid ${C.border}` }}>
            {(['in', 'up'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14, transition: 'all 0.15s',
                background: mode === m ? C.primary : 'transparent', color: mode === m ? C.bg : C.muted,
              }}>{m === 'in' ? 'Sign In' : 'Sign Up'}</button>
            ))}
          </div>

          {confirmSent ? (
            <div style={{ background: C.winBg, border: `1px solid ${C.win}`, borderRadius: 14, padding: '20px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📬</div>
              <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Check your email</div>
              <div style={{ fontSize: 13, color: C.muted }}>We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account then sign in.</div>
            </div>
          ) : (
            <>
              {mode === 'up' && (
                <div style={{ marginBottom: 12 }}>
                  <div style={labelStyle}>Username</div>
                  <input value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. sharpbettor99" style={inputStyle} />
                </div>
              )}

              <div style={{ marginBottom: 12 }}>
                <div style={labelStyle}>Email</div>
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" type="email" style={inputStyle} />
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={labelStyle}>Password</div>
                  {mode === 'in' && (
                    <span onClick={async () => {
                      if (!email) return setError('Enter your email first.')
                      const { supabase: sb } = await import('./lib/supabase')
                      await sb.auth.resetPasswordForEmail(email)
                      setError('Password reset email sent!')
                    }} style={{ color: C.primary, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Forgot?</span>
                  )}
                </div>
                <input value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()} placeholder="••••••••" type="password" style={inputStyle} />
              </div>

              {error && <div style={{ color: error.includes('sent') ? C.win : C.loss, fontSize: 12, marginBottom: 12, fontWeight: 600 }}>{error}</div>}

              <button onClick={handleSubmit} disabled={loading} style={{
                ...btnStyle, width: '100%', padding: '14px 0', fontSize: 15,
                boxShadow: '0 4px 24px rgba(0,212,255,0.25)',
                opacity: loading ? 0.7 : 1,
              }}>
                {loading ? 'Please wait...' : mode === 'in' ? 'Sign In →' : 'Create Account →'}
              </button>
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'center', margin: '20px 0' }}>
            <div style={{ flex: 1, height: 1, background: C.border }} />
            <span style={{ color: C.textMuted, fontSize: 12, margin: '0 14px' }}>or</span>
            <div style={{ flex: 1, height: 1, background: C.border }} />
          </div>

          <GoogleSignInButton onAuth={onAuth} />


          {mode === 'up' && (
            <div style={{ color: C.textMuted, fontSize: 11, textAlign: 'center', marginTop: 16, lineHeight: 1.5 }}>
              By signing up you agree to our <span style={{ color: C.muted, cursor: 'pointer' }}>Terms</span> and <span style={{ color: C.muted, cursor: 'pointer' }}>Privacy Policy</span>.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${C.border}`,
  background: C.bgInput, color: C.text, fontSize: 15, marginBottom: 10, outline: 'none',
}
const btnStyle: React.CSSProperties = {
  padding: '12px 24px', borderRadius: 12, border: 'none', background: C.primary,
  color: C.bg, fontWeight: 800, fontSize: 15, cursor: 'pointer',
}

// ─── Home / Feed ──────────────────────────────────────────────────────────────
function GroupSwitcher({ onClose }: { onClose: () => void }) {
  const { myGroups, groupId, switchGroup, openAddGroup } = useApp()
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 200 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.bgCard, borderRadius: '20px 20px 0 0', padding: '20px', width: '100%', maxWidth: 480, maxHeight: '75vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: C.text }}>Your Groups</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: C.muted, cursor: 'pointer' }}>✕</button>
        </div>
        {myGroups.map(g => {
          const active = g.id === groupId
          return (
            <button key={g.id} onClick={() => { switchGroup(g.id); onClose() }} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
              background: active ? C.primaryBg : C.bgEl, border: `1.5px solid ${active ? C.primary : C.border}`,
              borderRadius: 12, padding: '12px 14px', marginBottom: 8, cursor: 'pointer',
            }}>
              <span style={{ fontSize: 20 }}>🎰</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>{g.name}</div>
                <div style={{ fontSize: 12, color: C.muted }}>Code: <span style={{ color: C.primary, fontWeight: 700 }}>{g.code}</span></div>
              </div>
              {active && <span style={{ color: C.primary, fontWeight: 800, fontSize: 13 }}>✓ Active</span>}
            </button>
          )
        })}
        <button onClick={() => { openAddGroup(); onClose() }} style={{
          width: '100%', background: 'none', border: `1.5px dashed ${C.borderL}`, borderRadius: 12,
          padding: '14px', marginTop: 4, cursor: 'pointer', color: C.primary, fontWeight: 800, fontSize: 14,
        }}>➕ Create or join another group</button>
      </div>
    </div>
  )
}

function HomePage() {
  const { me, bets, groupName } = useApp()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [period, setPeriod] = useState<'weekly' | 'monthly' | 'yearly'>('weekly')
  const now = Date.now()
  const periodMs = { weekly: 7 * 864e5, monthly: 30 * 864e5, yearly: 365 * 864e5 }
  const sorted = [...bets]
    .filter(b => (now - b.createdAt.getTime()) < periodMs[period])
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const periodBets = bets.filter(b => b.status !== 'pending' && (now - b.createdAt.getTime()) < periodMs[period])
  const groupRecord = {
    wins: periodBets.filter(b => b.status === 'won').length,
    losses: periodBets.filter(b => b.status === 'lost').length,
    profit: periodBets.reduce((sum, b) => {
      if (b.status === 'won') return sum + (b.odds > 0 ? b.stake * b.odds / 100 : b.stake * 100 / Math.abs(b.odds))
      if (b.status === 'lost') return sum - b.stake
      return sum
    }, 0),
  }
  return (
    <div>
      {switcherOpen && <GroupSwitcher onClose={() => setSwitcherOpen(false)} />}
      <div style={{ background: 'rgba(75,156,211,0.15)', backdropFilter: 'blur(12px)', borderRadius: 20, padding: '20px 20px 16px', marginBottom: 16, color: C.text, border: `1px solid rgba(75,156,211,0.3)`, boxShadow: '0 4px 20px rgba(75,156,211,0.15)' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 2, color: C.text }}>@{me.username}</h1>
        <div style={{ fontSize: 13, color: C.muted }}>{groupName} · Personal record</div>
        <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
          {[
            { label: 'Record', val: `${me.stats.wins}W`, val2: `-${me.stats.losses}L`, color1: '#4ade80', color2: '#f87171' },
            { label: 'Profit', val: `${me.stats.totalProfit >= 0 ? '+' : ''}$${me.stats.totalProfit}`, color1: me.stats.totalProfit >= 0 ? '#4ade80' : '#f87171' },
            { label: 'ROI', val: `${me.stats.roi >= 0 ? '+' : ''}${me.stats.roi.toFixed(1)}%`, color1: me.stats.roi >= 0 ? '#4ade80' : '#f87171' },
          ].map(s => (
            <div key={s.label} style={{ background: 'rgba(75,156,211,0.08)', borderRadius: 10, padding: '6px 12px', border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label}</div>
              <div style={{ fontSize: 15, fontWeight: 900 }}>
                <span style={{ color: s.color1 }}>{s.val}</span>
                {s.val2 && <span style={{ color: s.color2 }}>{s.val2}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Group record tabs */}
      <div style={{ background: C.bgCard, borderRadius: 16, padding: 16, marginBottom: 16, border: `1px solid ${C.border}`, boxShadow: '0 2px 12px rgba(75,156,211,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <button onClick={() => setSwitcherOpen(true)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontWeight: 800, fontSize: 14, color: C.text }}>🎰 {groupName}</span>
              <span style={{ fontSize: 11, color: C.primary }}>▾</span>
            </button>
            <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>Tap to switch groups</div>
          </div>
          <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>{{ weekly: 'This Week', monthly: 'This Month', yearly: 'This Year' }[period]} · Group Record</span>
        </div>
        <div style={{ display: 'flex', background: C.bgEl, borderRadius: 10, padding: 3, marginBottom: 14 }}>
          {(['weekly', 'monthly', 'yearly'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12,
              background: period === p ? C.primary : 'transparent', color: period === p ? '#fff' : C.muted,
            }}>{{ weekly: 'This Week', monthly: 'This Month', yearly: 'This Year' }[p]}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {[
            { label: 'Record', val: <><span style={{ color: '#4ade80' }}>{groupRecord.wins}W</span><span style={{ color: C.muted }}> - </span><span style={{ color: '#f87171' }}>{groupRecord.losses}L</span></> },
            { label: 'Win %', val: <span style={{ color: groupRecord.wins / Math.max(groupRecord.wins + groupRecord.losses, 1) >= 0.5 ? '#4ade80' : '#f87171' }}>{groupRecord.wins + groupRecord.losses > 0 ? ((groupRecord.wins / (groupRecord.wins + groupRecord.losses)) * 100).toFixed(1) : '0.0'}%</span> },
            { label: 'Group P&L', val: <span style={{ color: groupRecord.profit >= 0 ? '#4ade80' : '#f87171' }}>{groupRecord.profit >= 0 ? '+' : ''}${groupRecord.profit.toFixed(0)}</span> },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, background: C.bgEl, borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 900 }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>

      <p style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>Recent activity</p>
      {sorted.map(b => <BetCard key={b.id} bet={b} isMe={b.userId === me.id} />)}
    </div>
  )
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────
function LeaderboardPage() {
  const { me, users, bets, upgradePro, groupName } = useApp()
  const [period, setPeriod] = useState<'weekly' | 'monthly' | 'yearly'>('weekly')
  const [showUpgrade, setShowUpgrade] = useState(false)

  const now = Date.now()
  const periodMs = { weekly: 7 * 864e5, monthly: 30 * 864e5, yearly: 365 * 864e5 }
  const periodLabel = { weekly: 'This Week', monthly: 'This Month', yearly: 'This Year' }

  const periodBets = bets.filter(b => b.status !== 'pending' && (now - b.createdAt.getTime()) < periodMs[period])

  const userStats = useMemo(() => users.map(u => {
    const ub = periodBets.filter(b => b.userId === u.id).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    const wins = ub.filter(b => b.status === 'won').length
    const losses = ub.filter(b => b.status === 'lost').length
    const winRate = wins + losses > 0 ? wins / (wins + losses) : 0
    const winPayout = (b: any) => b.odds > 0 ? b.stake * b.odds / 100 : b.stake * 100 / Math.abs(b.odds)
    const profit = ub.reduce((s, b) => b.status === 'won' ? s + winPayout(b) : b.status === 'lost' ? s - b.stake : s, 0)
    const staked = ub.reduce((s, b) => s + b.stake, 0)
    const roi = staked > 0 ? (profit / staked) * 100 : 0
    const avgOdds = ub.length > 0 ? ub.reduce((s, b) => s + b.odds, 0) / ub.length : 0
    let running = 0
    const curve = ub.map(b => { running += b.status === 'won' ? winPayout(b) : b.status === 'lost' ? -b.stake : 0; return running })
    return { ...u, wins, losses, winRate, total: wins + losses, profit, staked, roi, avgOdds, curve }
  }), [users, periodBets])

  const sorted = useMemo(() => [...userStats].sort((a, b) => b.winRate - a.winRate || b.wins - a.wins), [userStats])
  const myRank = sorted.findIndex(u => u.id === me.id) + 1
  const leader = sorted[0]

  // Activity feed entries (social blurbs)
  const activityFeed = useMemo(() => {
    const items: { userId: string, text: string, sub: string, emoji: string, time: Date }[] = []

    // Hot streak
    users.forEach(u => {
      const ub = periodBets.filter(b => b.userId === u.id)
      const recentWins = ub.filter(b => b.status === 'won').length
      if (recentWins >= 2) items.push({ userId: u.id, emoji: '🔥', text: `${u.displayName} is on a ${recentWins}-win streak`, sub: periodLabel[period], time: ub[0]?.createdAt ?? new Date() })
    })

    // Big win
    const bigWin = periodBets.filter(b => b.status === 'won' && b.odds > 150).sort((a,b) => b.odds - a.odds)[0]
    if (bigWin) {
      const u = users.find(u => u.id === bigWin.userId)
      if (u) items.push({ userId: u.id, emoji: '💰', text: `${u.displayName} cashed a +${bigWin.odds} bet`, sub: bigWin.description, time: bigWin.createdAt })
    }

    // Longest losing streak
    const loser = [...userStats].sort((a, b) => b.losses - a.losses)[0]
    if (loser && loser.losses >= 2) items.push({ userId: loser.id, emoji: '🥶', text: `${loser.displayName} is down ${loser.losses} straight`, sub: 'Send thoughts and prayers', time: new Date() })

    // Leader callout
    if (leader && leader.total > 0) items.push({ userId: leader.id, emoji: '👑', text: `${leader.id === me.id ? 'You\'re' : leader.displayName + ' is'} leading the group`, sub: `${(leader.winRate * 100).toFixed(0)}% win rate ${periodLabel[period].toLowerCase()}`, time: new Date() })

    // Parlay hit
    const parlayWin = periodBets.filter(b => b.status === 'won' && b.type === 'parlay')[0]
    if (parlayWin) {
      const u = users.find(u => u.id === parlayWin.userId)
      if (u) items.push({ userId: u.id, emoji: '🎯', text: `${u.displayName} hit a parlay`, sub: parlayWin.description, time: parlayWin.createdAt })
    }

    return items.sort((a, b) => b.time.getTime() - a.time.getTime()).slice(0, 6)
  }, [userStats, periodBets, period])

  const MEDALS = ['🥇', '🥈', '🥉']

  return (
    <div>
      {/* Upgrade modal */}
      {showUpgrade && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowUpgrade(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.bgCard, borderRadius: '24px 24px 0 0', padding: '28px 24px 40px', width: '100%', maxWidth: 480 }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>⚡</div>
              <div style={{ fontSize: 24, fontWeight: 900, marginBottom: 8 }}>Upgrade to Pro</div>
              <div style={{ fontSize: 14, color: C.muted }}>Unlock the full analytics suite for {groupName}</div>
            </div>
            {[
              { icon: '📊', title: 'Advanced Board Analytics', desc: 'ROI breakdowns, sharp ratings, follow/fade board' },
              { icon: '📈', title: 'P&L Trend Charts', desc: 'Sparkline curves for every player, every period' },
              { icon: '🎯', title: 'Bet Type & Sport Breakdown', desc: 'See where everyone wins and loses by category' },
              { icon: '⚔️', title: 'Head-to-Head Comparisons', desc: 'Go stat-for-stat against any group member' },
              { icon: '🏆', title: 'Season Long Competition', desc: 'Full season analytics with deep per-player breakdowns' },
              { icon: '🔓', title: 'Unlimited Competitions', desc: 'Create as many as you want, no weekly limit' },
            ].map(f => (
              <div key={f.title} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 14 }}>
                <div style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>{f.icon}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{f.title}</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{f.desc}</div>
                </div>
              </div>
            ))}
            <button onClick={() => { upgradePro(); setShowUpgrade(false) }} style={{
              ...btnStyle, width: '100%', padding: '15px 0', marginTop: 8, fontSize: 16, fontWeight: 900,
              background: 'linear-gradient(135deg, #B45309, #D97706)',
            }}>
              Upgrade to Pro — $4.99/mo →
            </button>
            <button onClick={() => setShowUpgrade(false)} style={{ width: '100%', background: 'none', border: 'none', color: C.muted, fontSize: 13, marginTop: 12, cursor: 'pointer', padding: 8 }}>
              Maybe later
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900 }}>Board 🏆</h1>
          <p style={{ color: C.muted, fontSize: 13 }}>{groupName}</p>
        </div>
        {!me.isPro
          ? <button onClick={() => setShowUpgrade(true)} style={{ background: 'linear-gradient(135deg,#B45309,#D97706)', border: 'none', borderRadius: 99, padding: '7px 14px', cursor: 'pointer', color: '#fff', fontWeight: 800, fontSize: 12 }}>⚡ Go Pro</button>
          : <div style={{ background: C.goldBg, border: `1px solid ${C.gold}`, borderRadius: 99, padding: '5px 12px' }}><span style={{ fontSize: 12, color: C.gold, fontWeight: 800 }}>⭐ PRO</span></div>
        }
      </div>

      {/* Period tabs */}
      <div style={{ display: 'flex', background: C.bgEl, borderRadius: 10, padding: 3, marginBottom: 18 }}>
        {(['weekly', 'monthly', 'yearly'] as const).map(p => (
          <button key={p} onClick={() => setPeriod(p)} style={{
            flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12,
            background: period === p ? C.primary : 'transparent', color: period === p ? '#fff' : C.muted,
          }}>{periodLabel[p]}</button>
        ))}
      </div>

      {/* Your rank banner */}
      <div style={{ background: `linear-gradient(135deg, #1a3a52, #2a5a7a)`, borderRadius: 16, padding: '16px 18px', marginBottom: 18, color: '#fff', display: 'flex', alignItems: 'center', gap: 14 }}>
        <Avatar name={me.displayName} size={44} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 2 }}>{periodLabel[period]}</div>
          <div style={{ fontSize: 18, fontWeight: 900 }}>You're #{myRank} in {groupName}</div>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
            {sorted.find(u => u.id === me.id)?.wins ?? 0}W – {sorted.find(u => u.id === me.id)?.losses ?? 0}L
            {myRank === 1 ? ' · 👑 Top of the group' : myRank === sorted.length ? ' · Room to grow 😅' : ` · ${myRank - 1} spot${myRank - 1 !== 1 ? 's' : ''} from the top`}
          </div>
        </div>
        <div style={{ fontSize: 36 }}>{myRank <= 3 ? MEDALS[myRank - 1] : `#${myRank}`}</div>
      </div>

      {/* Standings — simple, just rank + record */}
      <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Standings</div>
      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden', marginBottom: 22 }}>
        {sorted.map((u, i) => {
          const isMe = u.id === me.id
          const barWidth = u.total > 0 ? (u.winRate * 100) : 0
          return (
            <div key={u.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px',
              borderBottom: i < sorted.length - 1 ? `1px solid ${C.border}` : 'none',
              background: isMe ? C.primaryBg : 'transparent',
            }}>
              <div style={{ width: 28, textAlign: 'center', fontSize: i < 3 ? 20 : 13, fontWeight: 800, color: C.muted, flexShrink: 0 }}>
                {i < 3 ? MEDALS[i] : `#${i+1}`}
              </div>
              <Avatar name={u.displayName} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{u.displayName}{isMe ? ' (You)' : ''}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <div style={{ flex: 1, background: C.bgEl, borderRadius: 99, height: 5, overflow: 'hidden' }}>
                    <div style={{ width: `${barWidth}%`, height: '100%', background: u.winRate >= 0.5 ? C.win : C.loss, borderRadius: 99 }} />
                  </div>
                  <span style={{ fontSize: 11, color: C.muted, flexShrink: 0 }}>{u.total > 0 ? `${(u.winRate*100).toFixed(0)}%` : '—'}</span>
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <span style={{ fontWeight: 800, fontSize: 14 }}>
                  <span style={{ color: C.win }}>{u.wins}W</span>
                  <span style={{ color: C.muted }}> – </span>
                  <span style={{ color: C.loss }}>{u.losses}L</span>
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Activity feed */}
      <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>What's Happening</div>
      {activityFeed.length === 0
        ? <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>No activity yet this period — go make some bets 👀</div>
        : activityFeed.map((item, i) => {
          const u = users.find(u => u.id === item.userId)
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 14px', marginBottom: 8 }}>
              <div style={{ fontSize: 26, flexShrink: 0 }}>{item.emoji}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{item.text}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{item.sub}</div>
              </div>
              {u && <Avatar name={u.displayName} size={28} />}
            </div>
          )
        })
      }

      {/* Pro analytics section */}
      <div style={{ marginTop: 28 }}>
        {me.isPro ? (
          <ProAnalytics sorted={sorted} periodBets={periodBets} users={users} periodLabel={periodLabel[period]} />
        ) : (
          <div style={{ background: C.bgCard, border: `1.5px dashed ${C.borderL}`, borderRadius: 18, padding: '24px 20px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
            <div style={{ filter: 'blur(4px)', pointerEvents: 'none', marginBottom: 16 }}>
              {sorted.slice(0, 3).map(u => (
                <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ fontWeight: 700 }}>{u.displayName}</span>
                  <span style={{ color: C.win }}>+{Math.abs(u.roi).toFixed(1)}% ROI · +${Math.abs(u.profit).toFixed(0)}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 28, marginBottom: 8 }}>⚡</div>
            <div style={{ fontWeight: 900, fontSize: 17, marginBottom: 6 }}>Unlock Pro Analytics</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Deep stat breakdowns, P&L trends, bet type grades, sharp ratings, and head-to-head records.</div>
            <button onClick={() => setShowUpgrade(true)} style={{ ...btnStyle, padding: '11px 28px', background: 'linear-gradient(135deg,#B45309,#D97706)' }}>Upgrade to Pro →</button>
          </div>
        )}
      </div>
    </div>
  )
}

function ProAnalytics({ sorted, periodBets, users, periodLabel }: { sorted: any[], periodBets: any[], users: any[], periodLabel: string }) {
  const [activeTab, setActiveTab] = useState<'overview'|'trends'|'breakdown'|'h2h'>('overview')
  const [h2hA, setH2hA] = useState(users[0]?.id ?? '')
  const [h2hB, setH2hB] = useState(users[1]?.id ?? '')

  const winPayout = (b: any) => b.odds > 0 ? b.stake * b.odds / 100 : b.stake * 100 / Math.abs(b.odds)

  // Per-user extended stats
  const extended = sorted.map(u => {
    const ub = periodBets.filter((b: any) => b.userId === u.id)
    // Bet type breakdown
    const byType: Record<string, { w: number, l: number }> = {}
    ub.forEach((b: any) => {
      if (!byType[b.type]) byType[b.type] = { w: 0, l: 0 }
      if (b.status === 'won') byType[b.type].w++ ; else if (b.status === 'lost') byType[b.type].l++
    })
    // Sport breakdown
    const bySport: Record<string, { w: number, l: number }> = {}
    ub.forEach((b: any) => {
      if (!bySport[b.sport]) bySport[b.sport] = { w: 0, l: 0 }
      if (b.status === 'won') bySport[b.sport].w++ ; else if (b.status === 'lost') bySport[b.sport].l++
    })
    // Underdog vs favourite (positive odds = dog, negative = fav)
    const dogs = ub.filter((b: any) => b.odds > 0)
    const favs = ub.filter((b: any) => b.odds < 0)
    const dogWins = dogs.filter((b: any) => b.status === 'won').length
    const favWins = favs.filter((b: any) => b.status === 'won').length
    // Best sport by win rate
    const sportEntries = Object.entries(bySport).map(([s, r]: [string, any]) => ({ s, wr: r.w + r.l > 0 ? r.w / (r.w + r.l) : 0, total: r.w + r.l }))
    const bestSport = sportEntries.sort((a, b) => b.wr - a.wr)[0]
    const worstSport = sportEntries.sort((a, b) => a.wr - b.wr)[0]
    // Consistency score: stddev of results (lower = more consistent)
    const avgStake = ub.length > 0 ? ub.reduce((s: number, b: any) => s + b.stake, 0) / ub.length : 0
    // Sharp rating: positive ROI on dogs = sharp
    const dogProfit = dogs.reduce((s: number, b: any) => b.status === 'won' ? s + winPayout(b) : b.status === 'lost' ? s - b.stake : s, 0)
    const sharpScore = Math.min(100, Math.max(0, 50 + dogProfit * 2 + (u.roi ?? 0)))

    return { ...u, byType, bySport, dogs: dogs.length, favs: favs.length, dogWins, favWins, bestSport, worstSport, avgStake, sharpScore, dogProfit }
  })

  const tabs = [
    { id: 'overview', label: '📊 Overview' },
    { id: 'trends', label: '📈 Trends' },
    { id: 'breakdown', label: '🎯 Breakdown' },
    { id: 'h2h', label: '⚔️ H2H' },
  ] as const

  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 20 }}>{children}</div>
  )

  const Sparkline = ({ curve, color, w = 100, h = 44 }: { curve: number[], color: string, w?: number, h?: number }) => {
    const pts = curve.slice(-12)
    if (pts.length < 2) return <div style={{ height: h, display: 'flex', alignItems: 'center', fontSize: 11, color: C.muted }}>—</div>
    const min = Math.min(...pts, 0), max = Math.max(...pts, 0), range = max - min || 1
    const x = (i: number) => (i / (pts.length - 1)) * w
    const y = (v: number) => h - ((v - min) / range) * (h - 4) - 2
    const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
    const zeroY = y(0)
    return (
      <svg width={w} height={h} style={{ overflow: 'visible', display: 'block' }}>
        <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke={C.border} strokeWidth="1" strokeDasharray="3,2" />
        <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="3.5" fill={color} />
      </svg>
    )
  }

  return (
    <>
      {/* Pro badge + tab bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div style={{ background: 'linear-gradient(135deg,#B45309,#D97706)', borderRadius: 99, padding: '3px 10px', flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: '#fff', fontWeight: 800 }}>⚡ PRO</span>
        </div>
        <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Advanced Analytics · {periodLabel}</div>
      </div>

      <div style={{ display: 'flex', background: C.bgEl, borderRadius: 10, padding: 3, marginBottom: 18 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            flex: 1, padding: '7px 4px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 11,
            background: activeTab === t.id ? C.primary : 'transparent', color: activeTab === t.id ? '#fff' : C.muted,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {activeTab === 'overview' && (
        <>
          {/* Full stats table */}
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', padding: '8px 12px', background: C.bgEl, fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              <div>Player</div><div style={{ textAlign: 'right' }}>P&L</div><div style={{ textAlign: 'right' }}>ROI</div><div style={{ textAlign: 'right' }}>Odds</div><div style={{ textAlign: 'right' }}>Risked</div>
            </div>
            {extended.map((u) => (
              <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', padding: '10px 12px', borderTop: `1px solid ${C.border}`, alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Avatar name={u.displayName} size={22} />
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{u.displayName}</span>
                </div>
                <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 800, color: u.profit >= 0 ? C.win : C.loss }}>{u.profit >= 0 ? '+' : ''}${u.profit.toFixed(0)}</div>
                <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: u.roi >= 0 ? C.win : C.loss }}>{u.roi >= 0 ? '+' : ''}{u.roi.toFixed(0)}%</div>
                <div style={{ textAlign: 'right', fontSize: 11, color: C.muted }}>{u.avgOdds >= 0 ? '+' : ''}{u.avgOdds.toFixed(0)}</div>
                <div style={{ textAlign: 'right', fontSize: 11, color: C.muted }}>${u.staked.toFixed(0)}</div>
              </div>
            ))}
          </div>

          {/* Sharp meter */}
          <SectionLabel>Sharp Rating</SectionLabel>
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16 }}>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>How often each bettor beats the market — high score = bets like a sharp, low score = square</div>
            {[...extended].sort((a, b) => b.sharpScore - a.sharpScore).map(u => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <Avatar name={u.displayName} size={26} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{u.displayName}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: u.sharpScore >= 60 ? C.win : u.sharpScore >= 40 ? C.push : C.loss }}>
                      {u.sharpScore >= 70 ? '🎯 Sharp' : u.sharpScore >= 50 ? '📊 Even' : '🎰 Square'} · {u.sharpScore.toFixed(0)}/100
                    </span>
                  </div>
                  <div style={{ background: C.bgEl, borderRadius: 99, height: 8, overflow: 'hidden' }}>
                    <div style={{ width: `${u.sharpScore}%`, height: '100%', borderRadius: 99, background: u.sharpScore >= 60 ? C.win : u.sharpScore >= 40 ? C.push : C.loss, transition: 'width 0.4s' }} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Follow / Fade board */}
          <SectionLabel>Follow or Fade?</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ background: C.winBg, border: `1px solid ${C.win}`, borderRadius: 14, padding: 14 }}>
              <div style={{ fontSize: 11, color: C.win, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>🔥 Follow</div>
              {[...extended].sort((a, b) => b.roi - a.roi).slice(0, 2).map(u => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Avatar name={u.displayName} size={24} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{u.displayName}</div>
                    <div style={{ fontSize: 11, color: C.win }}>{u.roi >= 0 ? '+' : ''}{u.roi.toFixed(0)}% ROI</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background: C.lossBg, border: `1px solid ${C.loss}`, borderRadius: 14, padding: 14 }}>
              <div style={{ fontSize: 11, color: C.loss, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>❄️ Fade</div>
              {[...extended].sort((a, b) => a.roi - b.roi).slice(0, 2).map(u => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Avatar name={u.displayName} size={24} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{u.displayName}</div>
                    <div style={{ fontSize: 11, color: C.loss }}>{u.roi.toFixed(0)}% ROI</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Dog vs fav breakdown */}
          <SectionLabel>Underdog vs Favourite</SectionLabel>
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', padding: '8px 12px', background: C.bgEl, fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase' }}>
              <div>Player</div><div style={{ textAlign: 'right' }}>Dog W</div><div style={{ textAlign: 'right' }}>Dog L</div><div style={{ textAlign: 'right' }}>Fav W</div><div style={{ textAlign: 'right' }}>Fav L</div>
            </div>
            {extended.map(u => (
              <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', padding: '10px 12px', borderTop: `1px solid ${C.border}`, alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Avatar name={u.displayName} size={22} />
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{u.displayName}</span>
                </div>
                <div style={{ textAlign: 'right', fontSize: 12, color: C.win, fontWeight: 700 }}>{u.dogWins}</div>
                <div style={{ textAlign: 'right', fontSize: 12, color: C.loss, fontWeight: 700 }}>{u.dogs - u.dogWins}</div>
                <div style={{ textAlign: 'right', fontSize: 12, color: C.win, fontWeight: 700 }}>{u.favWins}</div>
                <div style={{ textAlign: 'right', fontSize: 12, color: C.loss, fontWeight: 700 }}>{u.favs - u.favWins}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── TRENDS ── */}
      {activeTab === 'trends' && (
        <>
          <SectionLabel>P&L Curve — {periodLabel}</SectionLabel>
          {extended.map(u => {
            const color = u.profit >= 0 ? C.win : C.loss
            return (
              <div key={u.id} style={{ background: C.bgCard, border: `1px solid ${u.profit >= 0 ? C.win : C.loss}`, borderRadius: 16, padding: '14px 16px', marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Avatar name={u.displayName} size={28} />
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>{u.displayName}</div>
                      <div style={{ fontSize: 11, color: C.muted }}>{u.wins}W – {u.losses}L · {u.total} bets</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 900, color }}>{u.profit >= 0 ? '+' : ''}${u.profit.toFixed(0)}</div>
                    <div style={{ fontSize: 10, color: u.roi >= 0 ? C.win : C.loss, fontWeight: 700 }}>ROI {u.roi >= 0 ? '+' : ''}{u.roi.toFixed(1)}%</div>
                  </div>
                </div>
                <Sparkline curve={u.curve} color={color} w={280} h={52} />
              </div>
            )
          })}

          {/* ROI bar race */}
          <SectionLabel>ROI Comparison</SectionLabel>
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16 }}>
            {[...extended].sort((a, b) => b.roi - a.roi).map(u => {
              const maxAbs = Math.max(...extended.map(s => Math.abs(s.roi)), 1)
              return (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <Avatar name={u.displayName} size={24} />
                  <div style={{ width: 72, fontSize: 12, fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.displayName}</div>
                  <div style={{ flex: 1, background: C.bgEl, borderRadius: 99, height: 10, overflow: 'hidden' }}>
                    <div style={{ width: `${(Math.abs(u.roi) / maxAbs) * 100}%`, height: '100%', background: u.roi >= 0 ? C.win : C.loss, borderRadius: 99 }} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 900, color: u.roi >= 0 ? C.win : C.loss, width: 48, textAlign: 'right', flexShrink: 0 }}>{u.roi >= 0 ? '+' : ''}{u.roi.toFixed(1)}%</div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── BREAKDOWN ── */}
      {activeTab === 'breakdown' && (
        <>
          {extended.map(u => (
            <div key={u.id} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16, padding: '14px 16px', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <Avatar name={u.displayName} size={32} />
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{u.displayName}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{u.wins}W – {u.losses}L · {u.total} bets</div>
                </div>
                <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                  <div style={{ fontSize: 16, fontWeight: 900, color: u.profit >= 0 ? C.win : C.loss }}>{u.profit >= 0 ? '+' : ''}${u.profit.toFixed(0)}</div>
                  <div style={{ fontSize: 10, color: C.muted }}>P&L</div>
                </div>
              </div>

              {/* Bet type rows */}
              {Object.entries(u.byType).length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>By Bet Type</div>
                  {Object.entries(u.byType).map(([type, rec]: [string, any]) => {
                    const tot = rec.w + rec.l
                    const wr = tot > 0 ? rec.w / tot : 0
                    const typeLabel: Record<string, string> = { spread: 'Spread', moneyline: 'ML', over_under: 'O/U', parlay: 'Parlay', prop: 'Prop', other: 'Other' }
                    return (
                      <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <div style={{ width: 52, fontSize: 11, fontWeight: 700, color: C.muted }}>{typeLabel[type] ?? type}</div>
                        <div style={{ flex: 1, background: C.bgEl, borderRadius: 99, height: 7, overflow: 'hidden' }}>
                          <div style={{ width: `${wr * 100}%`, height: '100%', background: wr >= 0.5 ? C.win : C.loss, borderRadius: 99 }} />
                        </div>
                        <div style={{ fontSize: 11, color: C.muted, width: 42, textAlign: 'right' }}>{rec.w}W–{rec.l}L</div>
                        <div style={{ fontSize: 11, fontWeight: 800, color: wr >= 0.5 ? C.win : C.loss, width: 30, textAlign: 'right' }}>{(wr * 100).toFixed(0)}%</div>
                      </div>
                    )
                  })}
                </>
              )}

              {/* Sport rows */}
              {Object.entries(u.bySport).length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8, marginTop: 12 }}>By Sport</div>
                  {Object.entries(u.bySport).map(([sport, rec]: [string, any]) => {
                    const tot = rec.w + rec.l
                    const wr = tot > 0 ? rec.w / tot : 0
                    return (
                      <div key={sport} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <div style={{ width: 52, fontSize: 11, fontWeight: 700, color: C.muted }}>{sport}</div>
                        <div style={{ flex: 1, background: C.bgEl, borderRadius: 99, height: 7, overflow: 'hidden' }}>
                          <div style={{ width: `${wr * 100}%`, height: '100%', background: wr >= 0.5 ? C.win : C.loss, borderRadius: 99 }} />
                        </div>
                        <div style={{ fontSize: 11, color: C.muted, width: 42, textAlign: 'right' }}>{rec.w}W–{rec.l}L</div>
                        <div style={{ fontSize: 11, fontWeight: 800, color: wr >= 0.5 ? C.win : C.loss, width: 30, textAlign: 'right' }}>{(wr * 100).toFixed(0)}%</div>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          ))}
        </>
      )}

      {/* ── H2H ── */}
      {activeTab === 'h2h' && (
        <>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 14 }}>Compare any two members head-to-head across all stats.</div>

          {/* Picker */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, alignItems: 'center', marginBottom: 20 }}>
            <select value={h2hA} onChange={e => setH2hA(e.target.value)} style={{ padding: '10px 12px', borderRadius: 12, border: `1px solid ${C.border}`, background: C.bgCard, fontWeight: 700, fontSize: 13, color: C.text, cursor: 'pointer' }}>
              {users.map((u: any) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
            <div style={{ textAlign: 'center', fontWeight: 900, color: C.muted, fontSize: 14 }}>VS</div>
            <select value={h2hB} onChange={e => setH2hB(e.target.value)} style={{ padding: '10px 12px', borderRadius: 12, border: `1px solid ${C.border}`, background: C.bgCard, fontWeight: 700, fontSize: 13, color: C.text, cursor: 'pointer' }}>
              {users.map((u: any) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          </div>

          {h2hA !== h2hB && (() => {
            const A = extended.find(u => u.id === h2hA)!
            const B = extended.find(u => u.id === h2hB)!
            if (!A || !B) return null

            const rows = [
              { label: 'Win Rate', aVal: `${(A.winRate * 100).toFixed(1)}%`, bVal: `${(B.winRate * 100).toFixed(1)}%`, aWins: A.winRate >= B.winRate },
              { label: 'ROI', aVal: `${A.roi >= 0 ? '+' : ''}${A.roi.toFixed(1)}%`, bVal: `${B.roi >= 0 ? '+' : ''}${B.roi.toFixed(1)}%`, aWins: A.roi >= B.roi },
              { label: 'P&L', aVal: `${A.profit >= 0 ? '+' : ''}$${A.profit.toFixed(0)}`, bVal: `${B.profit >= 0 ? '+' : ''}$${B.profit.toFixed(0)}`, aWins: A.profit >= B.profit },
              { label: 'Record', aVal: `${A.wins}W–${A.losses}L`, bVal: `${B.wins}W–${B.losses}L`, aWins: A.wins >= B.wins },
              { label: 'Avg Odds', aVal: `${A.avgOdds >= 0 ? '+' : ''}${A.avgOdds.toFixed(0)}`, bVal: `${B.avgOdds >= 0 ? '+' : ''}${B.avgOdds.toFixed(0)}`, aWins: A.avgOdds >= B.avgOdds },
              { label: 'Total Risked', aVal: `$${A.staked.toFixed(0)}`, bVal: `$${B.staked.toFixed(0)}`, aWins: A.staked >= B.staked },
              { label: 'Sharp Score', aVal: `${A.sharpScore.toFixed(0)}/100`, bVal: `${B.sharpScore.toFixed(0)}/100`, aWins: A.sharpScore >= B.sharpScore },
              { label: 'Dog Wins', aVal: String(A.dogWins), bVal: String(B.dogWins), aWins: A.dogWins >= B.dogWins },
            ]

            const aEdge = rows.filter(r => r.aWins).length
            const bEdge = rows.length - aEdge

            return (
              <>
                {/* Header cards */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, marginBottom: 16, alignItems: 'center' }}>
                  <div style={{ background: A.profit >= B.profit ? C.winBg : C.bgCard, border: `2px solid ${A.profit >= B.profit ? C.win : C.border}`, borderRadius: 14, padding: '14px', textAlign: 'center' }}>
                    <Avatar name={A.displayName} size={36} />
                    <div style={{ fontWeight: 800, fontSize: 14, marginTop: 6 }}>{A.displayName}</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: A.profit >= 0 ? C.win : C.loss, marginTop: 4 }}>{A.profit >= 0 ? '+' : ''}${A.profit.toFixed(0)}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{aEdge} categories won</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 24 }}>⚔️</div>
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 4, fontWeight: 700 }}>H2H</div>
                  </div>
                  <div style={{ background: B.profit > A.profit ? C.winBg : C.bgCard, border: `2px solid ${B.profit > A.profit ? C.win : C.border}`, borderRadius: 14, padding: '14px', textAlign: 'center' }}>
                    <Avatar name={B.displayName} size={36} />
                    <div style={{ fontWeight: 800, fontSize: 14, marginTop: 6 }}>{B.displayName}</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: B.profit >= 0 ? C.win : C.loss, marginTop: 4 }}>{B.profit >= 0 ? '+' : ''}${B.profit.toFixed(0)}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{bEdge} categories won</div>
                  </div>
                </div>

                {/* Stat rows */}
                <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
                  {rows.map((row, i) => (
                    <div key={row.label} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', alignItems: 'center', padding: '11px 14px', borderTop: i > 0 ? `1px solid ${C.border}` : 'none', background: i % 2 === 0 ? 'transparent' : C.bgEl }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: row.aWins ? C.win : C.muted, textAlign: 'left' }}>{row.aVal}</div>
                      <div style={{ textAlign: 'center', fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase' }}>{row.label}</div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: !row.aWins ? C.win : C.muted, textAlign: 'right' }}>{row.bVal}</div>
                    </div>
                  ))}
                </div>
              </>
            )
          })()}

          {h2hA === h2hB && (
            <div style={{ textAlign: 'center', padding: '24px', color: C.muted, fontSize: 13 }}>Select two different players to compare</div>
          )}
        </>
      )}
    </>
  )
}

// ─── Add Bet ──────────────────────────────────────────────────────────────────
const SPORTS: Sport[] = ['NFL', 'NBA', 'MLB', 'NHL', 'CFB', 'Soccer', 'MMA', 'Other']
const BET_TYPES: [BetType, string][] = [['spread', 'Spread'], ['moneyline', 'ML'], ['over_under', 'O/U'], ['parlay', 'Parlay'], ['prop', 'Prop'], ['other', 'Other']]
const BOOKS = ['DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'ESPN Bet', 'Kalshi', 'Polymarket', 'Other']

function pctToAmericanOdds(pct: number): number {
  if (pct <= 0 || pct >= 100) return 0
  const p = pct / 100
  return p >= 0.5
    ? Math.round(-(p / (1 - p)) * 100)
    : Math.round(((1 - p) / p) * 100)
}

function AddBetPage() {
  const { me, addBet } = useApp()
  const nav = useNavigate()
  const [sport, setSport] = useState<Sport>('NFL')
  const [type, setType] = useState<BetType>('spread')
  const [desc, setDesc] = useState('')
  const [parlayLegs, setParlayLegs] = useState<string[]>(['', ''])
  const [spreadTeam, setSpreadTeam] = useState('')
  const [spreadLine, setSpreadLine] = useState('')
  const [spreadOpp, setSpreadOpp] = useState('')
  const [mlTeam, setMlTeam] = useState('')
  const [mlOpp, setMlOpp] = useState('')
  const [ouDir, setOuDir] = useState<'Over' | 'Under'>('Over')
  const [ouTotal, setOuTotal] = useState('')
  const [ouMatchup, setOuMatchup] = useState('')
  const [odds, setOdds] = useState('')
  const [stake, setStake] = useState('')
  const [book, setBook] = useState('DraftKings')
  const [done, setDone] = useState(false)
  const [convertedFrom, setConvertedFrom] = useState<string | null>(null)

  // Game search state
  const [gameQuery, setGameQuery] = useState('')
  const [gameResults, setGameResults] = useState<import('./lib/odds').ESPNGame[]>([])
  const [selectedGame, setSelectedGame] = useState<import('./lib/odds').ESPNGame | null>(null)
  const [gameLoading, setGameLoading] = useState(false)
  const [gameSearched, setGameSearched] = useState(false)

  const searchGames = async () => {
    setGameLoading(true)
    setGameSearched(true)
    try {
      const { searchGames: search } = await import('./lib/odds')
      const results = await search(gameQuery, sport !== 'Other' ? sport : undefined)
      setGameResults(results.slice(0, 8))
    } catch (e) {
      setGameResults([])
    }
    setGameLoading(false)
  }

  const selectGame = (game: import('./lib/odds').ESPNGame) => {
    setSelectedGame(game)
    setGameResults([])
    setGameSearched(false)
    setGameQuery('')
    // Auto-fill description
    if (!desc) setDesc(`${game.awayTeam} @ ${game.homeTeam}`)
  }

  const clearGame = () => {
    setSelectedGame(null)
    setDesc('')
  }

  const handleOddsChange = (val: string) => {
    if (val.includes('%')) {
      const pct = parseFloat(val.replace('%', '').trim())
      if (!isNaN(pct)) {
        const american = pctToAmericanOdds(pct)
        setOdds(String(american))
        setConvertedFrom(`${pct}% → ${american > 0 ? '+' : ''}${american}`)
        return
      }
    }
    setConvertedFrom(null)
    setOdds(val)
  }

  const potentialWin = useMemo(() => {
    const o = parseInt(odds); const s = parseFloat(stake)
    if (isNaN(o) || isNaN(s) || s <= 0) return null
    return o > 0 ? s * o / 100 : s * 100 / Math.abs(o)
  }, [odds, stake])


  const submit = () => {
    let finalDesc = desc
    if (type === 'parlay') finalDesc = parlayLegs.filter(l => l.trim()).join(' + ')
    else if (type === 'spread') finalDesc = [spreadTeam, spreadLine, spreadOpp ? `vs ${spreadOpp}` : ''].filter(Boolean).join(' ')
    else if (type === 'moneyline') finalDesc = [mlTeam, 'ML', mlOpp ? `vs ${mlOpp}` : ''].filter(Boolean).join(' ')
    else if (type === 'over_under') finalDesc = [ouMatchup, ouDir, ouTotal].filter(Boolean).join(' ')
    if (!finalDesc || !odds || !stake) return alert('Fill in description, odds, and stake.')
    addBet({ userId: me.id, sport, type, description: finalDesc, odds: parseInt(odds), stake: parseFloat(stake), status: 'pending', bookmaker: book, gameId: selectedGame?.id ?? null })
    setDone(true)
    setTimeout(() => { setDone(false); nav('/') }, 2000)
  }

  if (done) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 16 }}>
      <div style={{ fontSize: 72 }}>🎯</div>
      <div style={{ fontSize: 26, fontWeight: 900 }}>Bet Posted!</div>
      <div style={{ color: C.muted }}>Your crew can see it now. Good luck 🤞</div>
    </div>
  )

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 900, marginBottom: 20 }}>Add a Bet 🎯</h1>


      <ChipRow label="Sport" options={SPORTS} value={sport} onChange={v => { setSport(v as Sport); setSelectedGame(null) }} />

      {/* ── Live Game Search ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={labelStyle}>Link to a Real Game <span style={{ color: C.primary, fontWeight: 600, fontSize: 10 }}>LIVE · ESPN</span></div>

        {selectedGame ? (
          <div style={{ background: C.primaryBg, border: `1.5px solid ${C.primary}`, borderRadius: 14, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>{selectedGame.awayTeam} @ {selectedGame.homeTeam}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                {selectedGame.sport} · {new Date(selectedGame.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {selectedGame.venue ? ` · ${selectedGame.venue}` : ''}
              </div>
              {selectedGame.inProgress && (
                <div style={{ fontSize: 11, color: C.win, fontWeight: 700, marginTop: 4 }}>
                  🔴 LIVE — {selectedGame.awayTeam} {selectedGame.awayScore} · {selectedGame.homeTeam} {selectedGame.homeScore} · {selectedGame.displayClock}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ fontSize: 10, color: C.primary, fontWeight: 800 }}>✓ LINKED</div>
              <button onClick={clearGame} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 11, cursor: 'pointer', padding: 0 }}>remove</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={gameQuery}
                onChange={e => setGameQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchGames()}
                placeholder={`Search ${sport} games...`}
                style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
              />
              <button onClick={searchGames} style={{ ...btnStyle, padding: '0 16px', fontSize: 13, flexShrink: 0 }}>
                {gameLoading ? '...' : 'Search'}
              </button>
            </div>

            {gameLoading && (
              <div style={{ textAlign: 'center', padding: '16px', color: C.muted, fontSize: 13 }}>
                Fetching live games from ESPN...
              </div>
            )}

            {!gameLoading && gameSearched && gameResults.length === 0 && (
              <div style={{ textAlign: 'center', padding: '12px', color: C.muted, fontSize: 13 }}>
                No games found — try a team name or leave blank to search all
              </div>
            )}

            {gameResults.length > 0 && (
              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', marginTop: 8 }}>
                {gameResults.map((g, i) => {
                  const gameDate = new Date(g.date)
                  const isToday = gameDate.toDateString() === new Date().toDateString()
                  return (
                    <button key={g.id} onClick={() => selectGame(g)} style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 14px', background: 'none', border: 'none',
                      borderBottom: i < gameResults.length - 1 ? `1px solid ${C.border}` : 'none',
                      cursor: 'pointer', textAlign: 'left',
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{g.awayTeam} @ {g.homeTeam}</div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                          {g.sport} · {isToday ? 'Today' : gameDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {gameDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        </div>
                      </div>
                      {g.inProgress && (
                        <div style={{ fontSize: 11, color: C.win, fontWeight: 700, flexShrink: 0 }}>
                          🔴 {g.awayScore}–{g.homeScore}
                        </div>
                      )}
                      {g.completed && (
                        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, flexShrink: 0 }}>
                          Final {g.awayScore}–{g.homeScore}
                        </div>
                      )}
                      <div style={{ color: C.primary, fontSize: 13 }}>+</div>
                    </button>
                  )
                })}
              </div>
            )}

            <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
              Linking a game enables auto-settlement when the final score is in ✓
            </div>
          </>
        )}
      </div>

      <ChipRow label="Bet Type" options={BET_TYPES.map(([, v]) => v)} value={BET_TYPES.find(([k]) => k === type)?.[1] ?? 'Spread'} onChange={v => setType((BET_TYPES.find(([, l]) => l === v)?.[0]) ?? 'spread')} />

      <div style={{ marginBottom: 16 }}>
        {type === 'spread' && (
          <>
            <div style={labelStyle}>Spread</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input value={spreadTeam} onChange={e => setSpreadTeam(e.target.value)} placeholder="Team (e.g. Chiefs)" style={{ ...inputStyle, flex: 2, marginBottom: 0 }} />
              <input value={spreadLine} onChange={e => setSpreadLine(e.target.value)} placeholder="Line (e.g. -3.5)" style={{ ...inputStyle, flex: 1, marginBottom: 0 }} />
            </div>
            <input value={spreadOpp} onChange={e => setSpreadOpp(e.target.value)} placeholder="Opponent (e.g. Bills)" style={inputStyle} />
            {(spreadTeam || spreadLine || spreadOpp) && (
              <div style={{ fontSize: 12, color: C.primary, fontWeight: 600, marginTop: -8, marginBottom: 8 }}>
                Preview: {[spreadTeam, spreadLine, spreadOpp ? `vs ${spreadOpp}` : ''].filter(Boolean).join(' ')}
              </div>
            )}
          </>
        )}
        {type === 'moneyline' && (
          <>
            <div style={labelStyle}>Moneyline</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={mlTeam} onChange={e => setMlTeam(e.target.value)} placeholder="Your team (e.g. Chiefs)" style={{ ...inputStyle, flex: 1, marginBottom: 8 }} />
              <input value={mlOpp} onChange={e => setMlOpp(e.target.value)} placeholder="Opponent (e.g. Bills)" style={{ ...inputStyle, flex: 1, marginBottom: 8 }} />
            </div>
            {(mlTeam || mlOpp) && (
              <div style={{ fontSize: 12, color: C.primary, fontWeight: 600, marginTop: -8, marginBottom: 8 }}>
                Preview: {[mlTeam, 'ML', mlOpp ? `vs ${mlOpp}` : ''].filter(Boolean).join(' ')}
              </div>
            )}
          </>
        )}
        {type === 'over_under' && (
          <>
            <div style={labelStyle}>Over / Under</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button onClick={() => setOuDir('Over')} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', background: ouDir === 'Over' ? C.primary : C.bgEl, color: ouDir === 'Over' ? '#fff' : C.text }}>Over</button>
              <button onClick={() => setOuDir('Under')} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', background: ouDir === 'Under' ? C.primary : C.bgEl, color: ouDir === 'Under' ? '#fff' : C.text }}>Under</button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={ouTotal} onChange={e => setOuTotal(e.target.value)} placeholder="Total (e.g. 48.5)" style={{ ...inputStyle, flex: 1, marginBottom: 8 }} />
              <input value={ouMatchup} onChange={e => setOuMatchup(e.target.value)} placeholder="Game (e.g. Chiefs/Bills)" style={{ ...inputStyle, flex: 2, marginBottom: 8 }} />
            </div>
            {(ouTotal || ouMatchup) && (
              <div style={{ fontSize: 12, color: C.primary, fontWeight: 600, marginTop: -8, marginBottom: 8 }}>
                Preview: {[ouMatchup, ouDir, ouTotal].filter(Boolean).join(' ')}
              </div>
            )}
          </>
        )}
        {type === 'parlay' && (
          <>
            <div style={labelStyle}>Parlay Legs</div>
            {parlayLegs.map((leg, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.primary, minWidth: 22 }}>#{i + 1}</div>
                <input
                  value={leg}
                  onChange={e => { const next = [...parlayLegs]; next[i] = e.target.value; setParlayLegs(next) }}
                  placeholder="e.g. Chiefs -3.5 vs Bills"
                  style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
                />
                {parlayLegs.length > 2 && (
                  <button onClick={() => setParlayLegs(parlayLegs.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 18, cursor: 'pointer', padding: '0 4px' }}>×</button>
                )}
              </div>
            ))}
            <button onClick={() => setParlayLegs([...parlayLegs, ''])} style={{ background: C.bgEl, border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 600, color: C.primary, cursor: 'pointer', marginTop: 2 }}>
              + Add Leg
            </button>
          </>
        )}
        {(type === 'prop' || type === 'other') && (
          <>
            <div style={labelStyle}>Bet Description</div>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. LeBron Over 27.5 pts" style={{ ...inputStyle, height: 80, resize: 'none', fontFamily: 'inherit' }} />
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={labelStyle}>Odds</div>
          <input value={odds} onChange={e => handleOddsChange(e.target.value)} placeholder="-110 or 65%" style={inputStyle} />
          {convertedFrom && (
            <div style={{ fontSize: 11, color: C.primary, marginTop: -6, marginBottom: 6, fontWeight: 600 }}>
              ✓ Converted from Kalshi: {convertedFrom}
            </div>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <div style={labelStyle}>Stake ($)</div>
          <input value={stake} onChange={e => setStake(e.target.value)} placeholder="100" type="number" style={inputStyle} />
        </div>
      </div>

      {potentialWin !== null && (
        <div style={{ background: C.winBg, borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: C.muted }}>Potential win:</span>
          <span style={{ color: C.win, fontWeight: 800, fontSize: 18 }}>+${potentialWin.toFixed(2)}</span>
        </div>
      )}

      <ChipRow label="Sportsbook" options={BOOKS} value={book} onChange={setBook} />

      <button onClick={submit} style={{ ...btnStyle, width: '100%', padding: '14px 0', fontSize: 16, marginTop: 8, boxShadow: `0 4px 20px rgba(0,212,255,0.3)` }}>
        Post Bet to Group 🚀
      </button>
    </div>
  )
}

const labelStyle: React.CSSProperties = { color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }

function ChipRow({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {options.map(o => (
          <button key={o} onClick={() => onChange(o)} style={{
            padding: '7px 14px', borderRadius: 99, border: `1px solid ${value === o ? C.primary : C.border}`,
            background: value === o ? C.primary : C.bgCard, color: value === o ? C.bg : C.muted,
            cursor: 'pointer', fontWeight: 600, fontSize: 13,
          }}>{o}</button>
        ))}
      </div>
    </div>
  )
}

// ─── Profile ──────────────────────────────────────────────────────────────────
function ProfilePage() {
  const { me, bets, groupCode, groupName, upgradePro, signOut, darkMode, toggleDark } = useApp()
  const [tab, setTab] = useState<'stats' | 'history'>('stats')
  const [copied, setCopied] = useState(false)

  const shareInvite = () => {
    const text = `Join my Lockroom betting group! Code: ${groupCode}`
    if (navigator.share) navigator.share({ title: 'Lockroom Invite', text })
    else { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }
  const myBets = bets.filter(b => b.userId === me.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const { stats } = me
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const maxPnl = Math.max(...stats.weeklyPnl.map(Math.abs), 1)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <Avatar name={me.displayName} size={64} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 22, fontWeight: 900 }}>{me.displayName}</span>
            {me.isPro && <span style={{ background: C.goldBg, color: C.gold, fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 99, border: `1px solid ${C.gold}` }}>⭐ PRO</span>}
          </div>
          <div style={{ color: C.muted, fontSize: 13 }}>@{me.username}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={toggleDark} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 10, padding: '7px 10px', cursor: 'pointer', fontSize: 16 }} title="Toggle dark mode">
            {darkMode ? '☀️' : '🌙'}
          </button>
          <button onClick={signOut} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 10, padding: '7px 14px', cursor: 'pointer', color: C.muted, fontSize: 13, fontWeight: 600 }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Streak banner */}
      {(() => {
        const { streak } = me.stats
        if (streak.count < 2) return null
        return (
          <div style={{ background: streak.type === 'win' ? C.winBg : C.lossBg, border: `1px solid ${streak.type === 'win' ? C.win : C.loss}`, borderRadius: 12, padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>{streak.type === 'win' ? '🔥' : '🥶'}</span>
            <div>
              <div style={{ fontWeight: 800, color: streak.type === 'win' ? C.win : C.loss, fontSize: 14 }}>{streak.count}-{streak.type === 'win' ? 'Win' : 'Loss'} Streak</div>
              <div style={{ fontSize: 12, color: C.muted }}>{streak.type === 'win' ? "You're on fire 🔥" : "Time to bounce back 💪"}</div>
            </div>
          </div>
        )
      })()}

      {/* Group card */}
      <div style={{ background: C.bgCard, borderRadius: 12, padding: '12px 16px', marginBottom: 16, border: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: 16, marginRight: 8 }}>🎰</span>
          <span style={{ fontWeight: 700 }}>{groupName}</span>
          <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>Code: <span style={{ color: C.primary, fontWeight: 700 }}>{groupCode}</span></div>
        </div>
        <button onClick={shareInvite} style={{ background: C.primaryBg, border: `1px solid ${C.primary}`, borderRadius: 10, padding: '7px 14px', cursor: 'pointer', color: C.primary, fontSize: 13, fontWeight: 700 }}>
          {copied ? '✓ Copied!' : '🔗 Invite'}
        </button>
      </div>

      {!me.isPro && (
        <button onClick={upgradePro} style={{ width: '100%', background: C.goldBg, border: `1px solid ${C.gold}`, borderRadius: 14, padding: '12px 16px', marginBottom: 20, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: C.text }}>
          <div style={{ textAlign: 'left' }}>
            <div style={{ color: C.gold, fontWeight: 800, fontSize: 15 }}>⭐ Upgrade to Pro</div>
            <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>Advanced charts, custom competitions & more</div>
          </div>
          <span style={{ color: C.gold, fontSize: 18 }}>→</span>
        </button>
      )}

      <div style={{ display: 'flex', background: C.bgCard, borderRadius: 12, padding: 4, marginBottom: 20 }}>
        {(['stats', 'history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700,
            background: tab === t ? C.primary : 'transparent', color: tab === t ? C.bg : C.muted,
          }}>{t === 'stats' ? '📊 Stats' : '📋 History'}</button>
        ))}
      </div>

      {tab === 'stats' ? (
        <>
          {/* Win rate card */}
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ width: 90, height: 90, borderRadius: '50%', border: `6px solid ${C.primary}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 20, fontWeight: 900 }}>{(stats.winRate * 100).toFixed(0)}%</span>
              <span style={{ fontSize: 8, color: C.textMuted, fontWeight: 700, letterSpacing: 0.5 }}>WIN RATE</span>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>
                <span style={{ color: C.win }}>{stats.wins}W</span> - <span style={{ color: C.loss }}>{stats.losses}L</span>
              </div>
              <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>{stats.wins + stats.losses} total bets</div>
              <div style={{ marginTop: 8, color: stats.streak.type === 'win' ? C.win : C.loss, fontWeight: 700, fontSize: 13 }}>
                {stats.streak.type === 'win' ? '🔥' : '🥶'} {stats.streak.count}-{stats.streak.type} streak
              </div>
            </div>
          </div>

          {/* Stat grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            {[
              { label: 'Total Profit', val: fmtMoney(stats.totalProfit), color: stats.totalProfit >= 0 ? C.win : C.loss, sub: 'All time' },
              { label: 'ROI', val: `${stats.roi >= 0 ? '+' : ''}${stats.roi.toFixed(1)}%`, color: stats.roi >= 0 ? C.win : C.loss, sub: 'Return on investment' },
              { label: 'Total Staked', val: `$${stats.totalStaked.toLocaleString()}`, color: C.text, sub: 'Total wagered' },
              { label: 'Best Streak', val: `${Math.floor(stats.wins / 3)}`, color: C.win, sub: 'Wins in a row' },
            ].map(s => (
              <div key={s.label} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
                <div style={{ color: C.textMuted, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{s.label}</div>
                <div style={{ color: s.color, fontSize: 22, fontWeight: 900 }}>{s.val}</div>
                <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Weekly chart */}
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontWeight: 700 }}>This Week's P&L</span>
              {!me.isPro && <span style={{ color: C.gold, fontSize: 11, fontWeight: 600 }}>📈 More charts in Pro</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', height: 80, gap: 4 }}>
              {stats.weeklyPnl.map((v, i) => {
                const h = Math.max((Math.abs(v) / maxPnl) * 60, 4)
                const pos = v >= 0
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: 80 }}>
                    <div style={{ width: '80%', height: h, background: pos ? C.win : C.loss, borderRadius: 4 }} />
                    <div style={{ color: C.textMuted, fontSize: 9, marginTop: 4 }}>{days[i]}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      ) : (
        myBets.length === 0
          ? <div style={{ textAlign: 'center', padding: '60px 0', color: C.muted }}>No bets yet. Time to get in the action!</div>
          : myBets.map(b => <BetCard key={b.id} bet={b} isMe />)
      )}
    </div>
  )
}

// ─── Competition Detail Views ─────────────────────────────────────────────────
function BestRecordComp({ users, bets, onBack }: { users: User[], bets: any[], onBack: () => void }) {
  const { groupName } = useApp()
  const now = Date.now()
  const weekBets = bets.filter(b => b.status !== 'pending' && (now - b.createdAt.getTime()) < 7 * 864e5)
  const standings = users.map(u => {
    const ub = weekBets.filter((b: any) => b.userId === u.id)
    const wins = ub.filter((b: any) => b.status === 'won').length
    const losses = ub.filter((b: any) => b.status === 'lost').length
    const profit = ub.reduce((sum: number, b: any) => b.status === 'won' ? sum + (b.odds > 0 ? b.stake * b.odds / 100 : b.stake * 100 / Math.abs(b.odds)) : b.status === 'lost' ? sum - b.stake : sum, 0)
    return { ...u, wins, losses, profit }
  }).sort((a, b) => (b.wins - b.losses) - (a.wins - a.losses) || b.profit - a.profit)

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.primary, fontWeight: 700, fontSize: 14, cursor: 'pointer', marginBottom: 16, padding: 0 }}>← Back</button>
      <h2 style={{ fontSize: 22, fontWeight: 900, marginBottom: 4 }}>Weekly Best Record</h2>
      <p style={{ color: C.muted, fontSize: 13, marginBottom: 20 }}>4 days left · {groupName}</p>
      <div style={{ background: C.goldBg, border: `1px solid rgba(180,83,9,0.2)`, borderRadius: 10, padding: '10px 14px', marginBottom: 20 }}>
        <div style={{ color: C.gold, fontWeight: 700, fontSize: 13 }}>Prize: Bragging rights + winner picks next group dinner</div>
      </div>
      {standings.map((u, i) => (
        <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: C.bgCard, border: `1px solid ${i === 0 ? C.gold : C.border}`, borderRadius: 14, padding: '12px 14px', marginBottom: 8 }}>
          <div style={{ width: 28, fontWeight: 800, fontSize: 16, color: i === 0 ? C.gold : C.muted }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}</div>
          <Avatar name={u.displayName} size={34} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{u.displayName}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}><span style={{ color: '#4ade80' }}>{u.wins}W</span> - <span style={{ color: '#f87171' }}>{u.losses}L</span></div>
          </div>
          <div style={{ fontWeight: 800, fontSize: 15, color: u.profit >= 0 ? C.win : C.loss }}>{u.profit >= 0 ? '+' : ''}${u.profit.toFixed(0)}</div>
        </div>
      ))}
    </div>
  )
}

function BracketComp({ users, onBack }: { users: User[], onBack: () => void }) {
  const { groupName } = useApp()
  // 5 players: u4 vs u5 in R1, u1 gets bye, semis: u1 vs winner(u4/u5), u2 vs u3
  const lc = C.borderL // line color
  const slotH = 36 // slot height
  const slotGap = 4 // gap between slots in a match
  const matchH = slotH * 2 + slotGap // total height of one matchup

  const r1Winner = users[3] // u4 beats u5
  const sf1Winner = users[0] // u1 beats u4 (bye advantage)
  const sf2Winner = users[1] // u2 beats u3
  const champion = null as User | null

  const Slot = ({ user, isWinner, hasWinner }: { user: User | null, isWinner: boolean, hasWinner: boolean }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 7, padding: '0 10px',
      height: slotH, background: isWinner ? C.winBg : user ? C.bgCard : C.bgEl,
      border: `1px solid ${isWinner ? C.win : C.border}`, borderRadius: 8,
      opacity: hasWinner && !isWinner ? 0.4 : 1, width: 130,
    }}>
      {user
        ? <><Avatar name={user.displayName} size={20} /><span style={{ fontWeight: 700, fontSize: 12, flex: 1 }}>{user.displayName}</span>{isWinner && <span style={{ color: C.win, fontSize: 10 }}>✓</span>}</>
        : <span style={{ color: C.muted, fontSize: 11, fontStyle: 'italic' }}>TBD</span>
      }
    </div>
  )

  const Match = ({ top, bottom, winner }: { top: User | null, bottom: User | null, winner: User | null }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: slotGap }}>
      <Slot user={top} isWinner={!!winner && winner.id === top?.id} hasWinner={!!winner} />
      <Slot user={bottom} isWinner={!!winner && winner.id === bottom?.id} hasWinner={!!winner} />
    </div>
  )

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.primary, fontWeight: 700, fontSize: 14, cursor: 'pointer', marginBottom: 16, padding: 0 }}>← Back</button>
      <h2 style={{ fontSize: 22, fontWeight: 900, marginBottom: 4 }}>Custom Bracket</h2>
      <p style={{ color: C.muted, fontSize: 13, marginBottom: 24 }}>{groupName} · 5-player single elimination</p>

      <div style={{ overflowX: 'auto', paddingBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, minWidth: 580 }}>

          {/* ── ROUND 1 ── */}
          <div>
            <div style={{ color: C.muted, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Round 1</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {/* u4 vs u5 */}
              <Match top={users[3]} bottom={users[4]} winner={r1Winner} />
              {/* spacer to push sf2 down */}
              <div style={{ height: 20 + matchH }} />
            </div>
          </div>

          {/* R1 → Semis connector */}
          <svg width="40" height={matchH * 2 + 20} style={{ flexShrink: 0, marginTop: 24 }}>
            {/* line from r1 match center out */}
            <line x1="0" y1={matchH / 2} x2="20" y2={matchH / 2} stroke={lc} strokeWidth="2" />
            {/* vertical to sf1 center */}
            <line x1="20" y1={matchH / 2} x2="20" y2={slotH / 2} stroke={lc} strokeWidth="2" />
            <line x1="20" y1={slotH / 2} x2="40" y2={slotH / 2} stroke={lc} strokeWidth="2" />
          </svg>

          {/* ── SEMIS ── */}
          <div>
            <div style={{ color: C.muted, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Semifinals</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* SF1: u1 (bye) vs r1Winner */}
              <Match top={users[0]} bottom={r1Winner} winner={sf1Winner} />
              {/* SF2: u2 vs u3 */}
              <Match top={users[1]} bottom={users[2]} winner={sf2Winner} />
            </div>
          </div>

          {/* Semis → Final connector */}
          <svg width="40" height={matchH * 2 + 20} style={{ flexShrink: 0, marginTop: 24 }}>
            <line x1="0" y1={matchH / 2} x2="20" y2={matchH / 2} stroke={lc} strokeWidth="2" />
            <line x1="0" y1={matchH + 20 + matchH / 2} x2="20" y2={matchH + 20 + matchH / 2} stroke={lc} strokeWidth="2" />
            <line x1="20" y1={matchH / 2} x2="20" y2={matchH + 20 + matchH / 2} stroke={lc} strokeWidth="2" />
            <line x1="20" y1={(matchH / 2 + matchH + 20 + matchH / 2) / 2} x2="40" y2={(matchH / 2 + matchH + 20 + matchH / 2) / 2} stroke={lc} strokeWidth="2" />
          </svg>

          {/* ── FINAL ── */}
          <div style={{ marginTop: 24 + matchH / 2 + 10 - matchH / 2 }}>
            <div style={{ color: C.muted, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Final</div>
            <Match top={sf1Winner} bottom={sf2Winner} winner={champion} />
          </div>

          {/* Final → Champion */}
          <svg width="36" height={matchH} style={{ flexShrink: 0, marginTop: 24 + matchH / 2 + 10 - matchH / 2 + 24 }}>
            <line x1="0" y1={matchH / 2} x2="36" y2={matchH / 2} stroke={lc} strokeWidth="2" />
          </svg>

          {/* ── CHAMPION ── */}
          <div style={{ marginTop: 24 + matchH / 2 + 10 - matchH / 2 }}>
            <div style={{ color: C.gold, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Champion</div>
            <div style={{ background: C.goldBg, border: `2px solid ${C.gold}`, borderRadius: 12, padding: '14px', textAlign: 'center', width: 110 }}>
              {champion
                ? <><Avatar name={champion.displayName} size={32} /><div style={{ fontWeight: 800, fontSize: 13, marginTop: 6, color: C.gold }}>{champion.displayName}</div></>
                : <><div style={{ fontSize: 30 }}>🏆</div><div style={{ color: C.gold, fontSize: 12, fontWeight: 700, marginTop: 4 }}>TBD</div></>
              }
            </div>
          </div>

        </div>
      </div>

      {/* Bye note */}
      <div style={{ background: C.primaryBg, border: `1px solid ${C.borderL}`, borderRadius: 10, padding: '8px 14px', marginTop: 16, fontSize: 12, color: C.muted }}>
        <span style={{ color: C.primary, fontWeight: 700 }}>You</span> received a first-round bye as the top seed.
      </div>
    </div>
  )
}

const SPORT_EMOJI: Record<string, string> = {
  NFL: '🏈', CFB: '🏈', NBA: '🏀', MLB: '⚾', NHL: '🏒', Soccer: '⚽', MMA: '🥊', Other: '🎯',
}

// Deterministic "game of the day" — marquee sport priority, then earliest.
// Used to pick the featured game before it's pinned server-side.
const SURVIVOR_SPORT_PRIORITY = ['Soccer', 'NFL', 'CFB', 'NBA', 'NHL', 'MLB', 'MMA', 'Other']
function featuredGameOf(dayGames: import('./lib/odds').ESPNGame[]) {
  return [...dayGames].sort((a, b) => {
    const ra = SURVIVOR_SPORT_PRIORITY.indexOf(a.sport); const rb = SURVIVOR_SPORT_PRIORITY.indexOf(b.sport)
    const pa = ra < 0 ? 99 : ra, pb = rb < 0 ? 99 : rb
    if (pa !== pb) return pa - pb
    return new Date(a.date).getTime() - new Date(b.date).getTime()
  })[0]
}

function PickemComp({ users, onBack }: { users: User[], onBack: () => void }) {
  const { groupName, me, groupId } = useApp()
  type PGame = import('./lib/odds').ESPNGame
  const [games, setGames] = useState<PGame[]>([])
  const [myPicks, setMyPicks] = useState<Record<string, string>>({})   // gameId → team
  const [allPicks, setAllPicks] = useState<{ gameId: string; userId: string; pick: string }[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [odds, store] = await Promise.all([import('./lib/odds'), import('./lib/store')])
      const g = await odds.fetchPickemGames()
      const picks = groupId ? await store.fetchPickemPicks(groupId) : []
      setGames(g)
      setAllPicks(picks)
      const mine: Record<string, string> = {}
      picks.filter(p => p.userId === me.id).forEach(p => { mine[p.gameId] = p.pick })
      setMyPicks(mine)
    } catch (e) {
      console.warn('[pickem] load failed', e)
    } finally {
      setLoading(false)
    }
  }, [groupId, me.id])

  useEffect(() => { load() }, [load])

  const winnerOf = (g: PGame): string | null => {
    if (!g.completed || g.homeScore == null || g.awayScore == null) return null
    if (g.homeScore === g.awayScore) return 'DRAW'
    return g.homeScore > g.awayScore ? g.homeTeam : g.awayTeam
  }

  const makePick = async (g: PGame, team: string) => {
    if (g.completed || g.inProgress) return  // locked once it starts
    setMyPicks(p => ({ ...p, [g.id]: team }))
    setAllPicks(prev => [...prev.filter(p => !(p.userId === me.id && p.gameId === g.id)), { gameId: g.id, userId: me.id, pick: team }])
    if (groupId) {
      const { upsertPickemPick } = await import('./lib/store')
      await upsertPickemPick(groupId, me.id, g.id, team)
    }
  }

  const openGames = games.filter(g => !g.completed)
  const madeCount = openGames.filter(g => myPicks[g.id]).length

  // Standings: correct picks among completed games, per member
  const standings = users.map(u => {
    let correct = 0, graded = 0
    for (const g of games) {
      if (!g.completed) continue
      const w = winnerOf(g)
      const p = allPicks.find(x => x.userId === u.id && x.gameId === g.id)
      if (!p) continue
      graded++
      if (w && w !== 'DRAW' && w === p.pick) correct++
    }
    return { user: u, correct, graded }
  }).sort((a, b) => b.correct - a.correct || b.graded - a.graded)

  const fmtTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { weekday: 'short' }) + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.primary, fontWeight: 700, fontSize: 14, cursor: 'pointer', marginBottom: 16, padding: 0 }}>← Back</button>

      {/* Header */}
      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 18px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 900, marginBottom: 2 }}>Weekly Pick'em</h2>
            <p style={{ color: C.muted, fontSize: 12 }}>{groupName} · Pick winners · Live from ESPN</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.primary }}>{madeCount}/{openGames.length}</div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: 'uppercase' }}>Picks made</div>
          </div>
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', color: C.muted, padding: '30px 0' }}>Loading games…</div>}

      {!loading && games.length === 0 && (
        <div style={{ textAlign: 'center', color: C.muted, padding: '30px 16px', background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14 }}>
          No games scheduled in the next few days. Check back closer to game day.
        </div>
      )}

      {/* Games */}
      {games.map(g => {
        const picked = myPicks[g.id]
        const w = winnerOf(g)
        const locked = g.completed || g.inProgress
        return (
          <div key={g.id} style={{ background: C.bgCard, border: `1.5px solid ${picked ? C.primary : C.border}`, borderRadius: 14, marginBottom: 8, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', gap: 8 }}>
              {[g.awayTeam, g.homeTeam].map((team, ti) => {
                const isPicked = picked === team
                const isWinner = g.completed && w === team
                const otherPicked = picked && picked !== team
                return (
                  <React.Fragment key={team}>
                    <button onClick={() => makePick(g, team)} disabled={locked} style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '8px 10px', borderRadius: 10,
                      border: `1.5px solid ${isWinner ? C.win : isPicked ? C.primary : C.border}`,
                      background: isWinner ? C.winBg : isPicked ? C.primaryBg : C.bgEl,
                      cursor: locked ? 'default' : 'pointer', opacity: otherPicked && !g.completed ? 0.4 : 1, transition: 'all 0.15s',
                    }}>
                      <span style={{ fontSize: 13, fontWeight: 900, color: isWinner ? C.win : isPicked ? C.primary : C.text }}>{team}</span>
                      {g.completed && team === g.homeTeam && <span style={{ fontSize: 11, color: C.muted }}>{g.homeScore}</span>}
                      {g.completed && team === g.awayTeam && <span style={{ fontSize: 11, color: C.muted }}>{g.awayScore}</span>}
                      {isPicked && !g.completed && <span style={{ fontSize: 12, color: C.primary }}>✓</span>}
                    </button>
                    {ti === 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0, width: 54 }}>
                        <span style={{ fontSize: 12 }}>{SPORT_EMOJI[g.sport] ?? '🎯'}</span>
                        {g.completed
                          ? <span style={{ fontSize: 9, fontWeight: 900, color: C.muted }}>FINAL</span>
                          : g.inProgress
                            ? <span style={{ fontSize: 9, fontWeight: 900, color: C.loss }}>🔴 LIVE</span>
                            : <span style={{ fontSize: 9, fontWeight: 900, color: C.muted }}>VS</span>}
                        <span style={{ fontSize: 8, color: C.muted, fontWeight: 600, textAlign: 'center' }}>{g.completed || g.inProgress ? '' : fmtTime(g.date)}</span>
                      </div>
                    )}
                  </React.Fragment>
                )
              })}
            </div>
            {/* Result footer: was my pick right? */}
            {g.completed && picked && (
              <div style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, background: w === 'DRAW' ? C.pushBg : w === picked ? C.winBg : C.lossBg, color: w === 'DRAW' ? C.push : w === picked ? C.win : C.loss }}>
                {w === 'DRAW' ? '➖ Draw — no result' : w === picked ? '✓ You got it right' : '✗ You missed this one'}
              </div>
            )}
          </div>
        )
      })}

      {/* Standings */}
      {standings.some(s => s.graded > 0) && (
        <div style={{ marginTop: 28 }}>
          <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Standings</div>
          {standings.map((row, i) => {
            const rankEmoji = ['🥇', '🥈', '🥉']
            const isTop3 = i < 3
            return (
              <div key={row.user.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: i === 0 ? C.goldBg : C.bgCard, border: `1px solid ${i === 0 ? C.gold : C.border}`, borderRadius: 12, padding: '11px 14px', marginBottom: 8 }}>
                <div style={{ fontSize: isTop3 ? 18 : 13, width: 24, textAlign: 'center', fontWeight: 700, color: C.muted }}>{isTop3 ? rankEmoji[i] : `#${i + 1}`}</div>
                <Avatar name={row.user.displayName} size={30} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{row.user.displayName}{row.user.id === me.id ? ' (you)' : ''}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{row.correct}/{row.graded} correct</div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 900, color: C.primary }}>{row.graded > 0 ? `${Math.round((row.correct / row.graded) * 100)}%` : '—'}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SurvivorComp({ users, onBack }: { users: User[], onBack: () => void }) {
  const { groupName, me, groupId } = useApp()
  type SGame = import('./lib/odds').ESPNGame
  const [games, setGames] = useState<SGame[]>([])
  const [allPicks, setAllPicks] = useState<{ day: string; gameId: string; userId: string; pick: string }[]>([])
  const [featured, setFeatured] = useState<Record<string, string>>({})  // day → pinned gameId
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [odds, store] = await Promise.all([import('./lib/odds'), import('./lib/store')])
      const g = await odds.fetchSurvivorGames()
      const picks = groupId ? await store.fetchSurvivorPicks(groupId) : []
      let feat = groupId ? await store.fetchFeaturedGames(groupId) : {}

      // Pin a featured game for any day that doesn't have one yet (first writer wins).
      if (groupId) {
        const byDayLocal: Record<string, SGame[]> = {}
        for (const gg of g) { const k = new Date(gg.date).toLocaleDateString('en-CA'); (byDayLocal[k] ??= []).push(gg) }
        const missing = Object.keys(byDayLocal).filter(d => !feat[d])
        if (missing.length) {
          await Promise.all(missing.map(d => {
            const fg = featuredGameOf(byDayLocal[d])
            return fg ? store.pinFeaturedGame(groupId, d, fg.id) : Promise.resolve()
          }))
          feat = await store.fetchFeaturedGames(groupId)  // re-read whoever won the race
        }
      }

      setGames(g)
      setAllPicks(picks)
      setFeatured(feat)
    } catch (e) {
      console.warn('[survivor] load failed', e)
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => { load() }, [load])

  const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA')
  const dayLabel = (key: string) => new Date(key + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const winnerOf = (g: SGame): string | null => {
    if (!g.completed || g.homeScore == null || g.awayScore == null) return null
    if (g.homeScore === g.awayScore) return 'DRAW'
    return g.homeScore > g.awayScore ? g.homeTeam : g.awayTeam
  }

  // Group games by day
  const byDay: Record<string, SGame[]> = {}
  for (const g of games) { const k = dayKey(g.date); (byDay[k] ??= []).push(g) }
  const days = Object.keys(byDay).sort()

  // My picks by day
  const myPickByDay: Record<string, { gameId: string; pick: string }> = {}
  allPicks.filter(p => p.userId === me.id).forEach(p => { myPickByDay[p.day] = { gameId: p.gameId, pick: p.pick } })

  // The featured game for a day: prefer the server-pinned id (authoritative for
  // the whole group), fall back to the deterministic local choice.
  const featuredForDay = (day: string): SGame | undefined => {
    const pinnedId = featured[day]
    if (pinnedId) { const g = games.find(x => x.id === pinnedId); if (g) return g }
    return featuredGameOf(byDay[day])
  }

  // Alive/eliminated status: walk each user's picks in day order; a completed
  // pick that didn't win (loss OR draw) knocks them out.
  const statusOf = (uid: string): { alive: boolean; outDay?: string } => {
    const picks = allPicks.filter(p => p.userId === uid).sort((a, b) => a.day.localeCompare(b.day))
    for (const p of picks) {
      const g = games.find(x => x.id === p.gameId)
      if (g && g.completed) {
        const w = winnerOf(g)
        if (w !== p.pick) return { alive: false, outDay: p.day }
      }
    }
    return { alive: true }
  }

  const roster = users.map(u => ({ user: u, ...statusOf(u.id) }))
  const aliveList = roster.filter(r => r.alive)
  const outList = roster.filter(r => !r.alive)
  const amAlive = statusOf(me.id).alive

  const makePick = async (day: string, g: SGame, team: string) => {
    if (!amAlive || g.completed || g.inProgress) return
    setAllPicks(prev => [...prev.filter(p => !(p.userId === me.id && p.day === day)), { day, gameId: g.id, userId: me.id, pick: team }])
    if (groupId) {
      const { upsertSurvivorPick } = await import('./lib/store')
      await upsertSurvivorPick(groupId, me.id, day, g.id, team)
    }
  }

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.primary, fontWeight: 700, fontSize: 14, cursor: 'pointer', marginBottom: 16, padding: 0 }}>← Back</button>
      <h2 style={{ fontSize: 22, fontWeight: 900, marginBottom: 4 }}>Survivor Pool</h2>
      <p style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>{groupName} · Same game every day · Guess the winner · Miss and you're out</p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1, background: C.winBg, border: `1px solid ${C.win}`, borderRadius: 12, padding: '12px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: C.win }}>{aliveList.length}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Still alive</div>
        </div>
        <div style={{ flex: 1, background: C.lossBg, border: `1px solid ${C.loss}`, borderRadius: 12, padding: '12px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: C.loss }}>{outList.length}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Eliminated</div>
        </div>
      </div>

      {!amAlive && (
        <div style={{ background: C.lossBg, border: `1px solid ${C.loss}`, borderRadius: 12, padding: '12px 14px', marginBottom: 20, color: C.loss, fontWeight: 700, fontSize: 13, textAlign: 'center' }}>
          💀 You've been eliminated. Better luck next pool.
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', color: C.muted, padding: '30px 0' }}>Loading games…</div>}
      {!loading && days.length === 0 && (
        <div style={{ textAlign: 'center', color: C.muted, padding: '30px 16px', background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14 }}>
          No games scheduled in the next few days.
        </div>
      )}

      {/* One featured game per day */}
      {days.map(day => {
        const g = featuredForDay(day)
        if (!g) return null
        const myPick = myPickByDay[day]
        const w = winnerOf(g)
        const locked = g.completed || g.inProgress
        const survived = g.completed && myPick ? w === myPick.pick : null
        const others = allPicks.filter(p => p.gameId === g.id && p.userId !== me.id)
        return (
          <div key={day} style={{ marginBottom: 16 }}>
            <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{dayLabel(day)}</div>
            <div style={{ background: C.bgCard, border: `1.5px solid ${myPick ? C.primary : C.border}`, borderRadius: 14, padding: '12px 14px' }}>
              {/* Matchup header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 14 }}>{SPORT_EMOJI[g.sport] ?? '🎯'}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>{g.sport}</span>
                <span style={{ fontSize: 11, color: C.muted }}>·</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: g.completed ? C.muted : g.inProgress ? C.loss : C.muted }}>
                  {g.completed ? 'FINAL' : g.inProgress ? '🔴 LIVE' : new Date(g.date).toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + new Date(g.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
              {/* Two winner buttons */}
              <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
                {[g.awayTeam, g.homeTeam].map((team, ti) => {
                  const isPicked = myPick?.pick === team
                  const isWinner = g.completed && w === team
                  const disabled = locked || !amAlive
                  return (
                    <React.Fragment key={team}>
                      <button onClick={() => makePick(day, g, team)} disabled={disabled} style={{
                        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '12px 8px', borderRadius: 11,
                        border: `2px solid ${isWinner ? C.win : isPicked ? C.primary : C.border}`,
                        background: isWinner ? C.winBg : isPicked ? C.primaryBg : C.bgEl,
                        cursor: disabled ? 'default' : 'pointer',
                      }}>
                        <span style={{ fontSize: 13, fontWeight: 900, color: isWinner ? C.win : isPicked ? C.primary : C.text, textAlign: 'center' }}>{team}</span>
                        {g.completed
                          ? <span style={{ fontSize: 16, fontWeight: 900, color: isWinner ? C.win : C.muted }}>{team === g.homeTeam ? g.homeScore : g.awayScore}</span>
                          : isPicked ? <span style={{ fontSize: 11, color: C.primary, fontWeight: 700 }}>✓ your pick</span> : <span style={{ fontSize: 11, color: C.muted }}>tap to pick</span>}
                      </button>
                      {ti === 0 && <div style={{ display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 900, color: C.muted }}>@</div>}
                    </React.Fragment>
                  )
                })}
              </div>
              {/* Result / group pick count */}
              {survived !== null ? (
                <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, textAlign: 'center', color: survived ? C.win : C.loss }}>
                  {survived ? `✓ You survived` : myPick ? `✗ ${myPick.pick} didn't win — eliminated` : '— you had no pick'}
                </div>
              ) : others.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 11, color: C.muted, textAlign: 'center' }}>{others.length} other {others.length === 1 ? 'member has' : 'members have'} picked</div>
              )}
            </div>
          </div>
        )
      })}

      {/* Roster */}
      <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 8 }}>Pool</div>
      {[...aliveList, ...outList].map(({ user: u, alive }) => (
        <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 14px', marginBottom: 8, opacity: alive ? 1 : 0.5 }}>
          <Avatar name={u.displayName} size={30} />
          <div style={{ flex: 1, fontWeight: 600 }}>{u.displayName}{u.id === me.id ? ' (you)' : ''}</div>
          <span style={{ color: alive ? C.win : C.loss, fontWeight: 700, fontSize: 12 }}>{alive ? 'ALIVE ✓' : 'OUT ✗'}</span>
        </div>
      ))}
    </div>
  )
}

function SeasonLongComp({ users, bets, onBack }: { users: User[], bets: any[], onBack: () => void }) {
  const { groupName } = useApp()
  const [selected, setSelected] = useState<string | null>(null)

  const yearBets = bets.filter((b: any) => b.status !== 'pending' && (Date.now() - b.createdAt.getTime()) < 365 * 864e5)

  const calcStats = (uid: string) => {
    const ub = yearBets.filter((b: any) => b.userId === uid).sort((a: any, b: any) => a.createdAt - b.createdAt)
    const wins = ub.filter((b: any) => b.status === 'won')
    const losses = ub.filter((b: any) => b.status === 'lost')
    const winPayout = (b: any) => b.odds > 0 ? b.stake * b.odds / 100 : b.stake * 100 / Math.abs(b.odds)
    const profit = ub.reduce((s: number, b: any) => b.status === 'won' ? s + winPayout(b) : b.status === 'lost' ? s - b.stake : s, 0)
    const staked = ub.reduce((s: number, b: any) => s + b.stake, 0)
    const roi = staked > 0 ? (profit / staked) * 100 : 0
    const winRate = ub.length > 0 ? wins.length / ub.length : 0
    const avgOdds = ub.length > 0 ? ub.reduce((s: number, b: any) => s + b.odds, 0) / ub.length : 0
    const avgStake = ub.length > 0 ? staked / ub.length : 0

    // Sport breakdown
    const sports: Record<string, { w: number, l: number }> = {}
    ub.forEach((b: any) => {
      if (!sports[b.sport]) sports[b.sport] = { w: 0, l: 0 }
      if (b.status === 'won') sports[b.sport].w++ ; else sports[b.sport].l++
    })

    // Best / worst single bet by profit
    const best = wins.length > 0 ? wins.reduce((top: any, b: any) => winPayout(b) > winPayout(top) ? b : top, wins[0]) : null
    const worst = losses.length > 0 ? losses.reduce((bot: any, b: any) => b.stake > bot.stake ? b : bot, losses[0]) : null

    // Running P&L for sparkline (up to 8 points)
    let running = 0
    const curve = ub.map((b: any) => {
      running += b.status === 'won' ? winPayout(b) : b.status === 'lost' ? -b.stake : 0
      return running
    })

    // Streak
    let streak = 0, streakType = 'win'
    for (let i = ub.length - 1; i >= 0; i--) {
      const s = ub[i].status
      if (i === ub.length - 1) { streakType = s === 'won' ? 'win' : 'loss'; streak = 1 }
      else if ((streakType === 'win' && s === 'won') || (streakType === 'loss' && s === 'lost')) streak++
      else break
    }

    return { wins: wins.length, losses: losses.length, profit, staked, roi, winRate, avgOdds, avgStake, sports, best, worst, curve, streak, streakType, total: ub.length }
  }

  const standings = users.map(u => ({ ...u, ...calcStats(u.id) })).sort((a, b) => b.profit - a.profit)
  const leader = standings[0]
  const selectedUser = selected ? standings.find(s => s.id === selected) : null

  const Sparkline = ({ curve, color }: { curve: number[], color: string }) => {
    if (curve.length < 2) return <div style={{ fontSize: 11, color: C.muted }}>Not enough data</div>
    const pts = curve.slice(-10)
    const w = 120, h = 36
    const min = Math.min(...pts, 0), max = Math.max(...pts, 0)
    const range = max - min || 1
    const x = (i: number) => (i / (pts.length - 1)) * w
    const y = (v: number) => h - ((v - min) / range) * h
    const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
    return (
      <svg width={w} height={h} style={{ overflow: 'visible' }}>
        <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="3.5" fill={color} />
        <line x1="0" y1={y(0)} x2={w} y2={y(0)} stroke={C.border} strokeWidth="1" strokeDasharray="3,3" />
      </svg>
    )
  }

  // Detail view for a selected player
  if (selectedUser) {
    const u = selectedUser
    return (
      <div>
        <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: C.primary, fontWeight: 700, fontSize: 14, cursor: 'pointer', marginBottom: 16, padding: 0 }}>← Back to Standings</button>

        {/* Player header */}
        <div style={{ background: 'linear-gradient(135deg, #1a3a52, #2a5a7a)', borderRadius: 18, padding: '20px', marginBottom: 20, color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <Avatar name={u.displayName} size={48} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 900 }}>{u.displayName}</div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>2024–25 Season · {u.total} bets placed</div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 11, opacity: 0.7 }}>Current streak</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: u.streakType === 'win' ? '#4ade80' : '#f87171' }}>
                {u.streakType === 'win' ? '🔥' : '🥶'} {u.streak} {u.streakType}
              </div>
            </div>
          </div>
          {/* P&L curve */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>Season P&L trend</div>
              <Sparkline curve={u.curve} color={u.profit >= 0 ? '#4ade80' : '#f87171'} />
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 32, fontWeight: 900, color: u.profit >= 0 ? '#4ade80' : '#f87171' }}>{u.profit >= 0 ? '+' : ''}${u.profit.toFixed(0)}</div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>net profit</div>
            </div>
          </div>
        </div>

        {/* Stat grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
          {[
            { label: 'Win Rate', value: `${(u.winRate * 100).toFixed(1)}%`, color: u.winRate >= 0.5 ? C.win : C.loss },
            { label: 'ROI', value: `${u.roi >= 0 ? '+' : ''}${u.roi.toFixed(1)}%`, color: u.roi >= 0 ? C.win : C.loss },
            { label: 'Record', value: `${u.wins}–${u.losses}`, color: C.text },
            { label: 'Avg Stake', value: `$${u.avgStake.toFixed(0)}`, color: C.text },
            { label: 'Avg Odds', value: u.avgOdds >= 0 ? `+${u.avgOdds.toFixed(0)}` : u.avgOdds.toFixed(0), color: C.text },
            { label: 'Total Risked', value: `$${u.staked.toFixed(0)}`, color: C.text },
          ].map(s => (
            <div key={s.label} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Sport breakdown */}
        {Object.keys(u.sports).length > 0 && (
          <>
            <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>By Sport</div>
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', marginBottom: 20 }}>
              {Object.entries(u.sports).map(([sport, rec]: [string, any], i, arr) => {
                const total = rec.w + rec.l
                const wr = total > 0 ? rec.w / total : 0
                return (
                  <div key={sport} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                    <div style={{ fontWeight: 700, fontSize: 13, width: 50 }}>{sport}</div>
                    <div style={{ flex: 1, background: C.bgEl, borderRadius: 99, height: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${wr * 100}%`, height: '100%', background: wr >= 0.5 ? C.win : C.loss, borderRadius: 99 }} />
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, width: 60, textAlign: 'right' }}>
                      <span style={{ color: C.win }}>{rec.w}W</span><span style={{ color: C.muted }}>–</span><span style={{ color: C.loss }}>{rec.l}L</span>
                    </div>
                    <div style={{ fontSize: 11, color: wr >= 0.5 ? C.win : C.loss, fontWeight: 700, width: 34, textAlign: 'right' }}>{(wr * 100).toFixed(0)}%</div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* Best & worst */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>💰 Best Bet</div>
            <div style={{ background: C.winBg, border: `1px solid ${C.win}`, borderRadius: 14, padding: '14px' }}>
              {u.best
                ? <><div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{u.best.description}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>{u.best.sport} · +{u.best.odds}</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: C.win, marginTop: 8 }}>+${(u.best.odds > 0 ? u.best.stake * u.best.odds / 100 : u.best.stake * 100 / Math.abs(u.best.odds)).toFixed(0)}</div></>
                : <div style={{ color: C.muted, fontSize: 13 }}>No wins yet</div>
              }
            </div>
          </div>
          <div>
            <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>🩸 Worst Beat</div>
            <div style={{ background: C.lossBg, border: `1px solid ${C.loss}`, borderRadius: 14, padding: '14px' }}>
              {u.worst
                ? <><div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{u.worst.description}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>{u.worst.sport} · {u.worst.odds}</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: C.loss, marginTop: 8 }}>-${u.worst.stake.toFixed(0)}</div></>
                : <div style={{ color: C.muted, fontSize: 13 }}>No losses yet</div>
              }
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.primary, fontWeight: 700, fontSize: 14, cursor: 'pointer', marginBottom: 16, padding: 0 }}>← Back</button>

      {/* Pro badge */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'linear-gradient(135deg, #B45309, #D97706)', borderRadius: 99, padding: '4px 12px', marginBottom: 14 }}>
        <span style={{ fontSize: 12, color: '#fff', fontWeight: 800 }}>⚡ PRO ANALYTICS</span>
      </div>

      {/* Hero header */}
      <div style={{ background: `linear-gradient(135deg, #1a3a52 0%, #2a5a7a 100%)`, borderRadius: 18, padding: '22px 20px', marginBottom: 20, color: '#fff' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.7, marginBottom: 6 }}>{groupName} · 2024–25 Season</div>
        <h2 style={{ fontSize: 26, fontWeight: 900, marginBottom: 16 }}>Season Long</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          {[
            { label: 'Total Bets', value: standings.reduce((s, u) => s + u.total, 0) },
            { label: 'Players', value: users.length },
            { label: 'Leader P&L', value: `${leader?.profit >= 0 ? '+' : ''}$${leader?.profit.toFixed(0) ?? '0'}`, color: leader?.profit >= 0 ? '#4ade80' : '#f87171' },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, background: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: '12px' }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: (s as any).color ?? '#fff' }}>{s.value}</div>
              <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Leader spotlight */}
      {leader && (
        <div style={{ background: C.goldBg, border: `1.5px solid ${C.gold}`, borderRadius: 16, padding: '14px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ fontSize: 30 }}>🏆</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: C.gold, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Leading the group</div>
            <div style={{ fontSize: 18, fontWeight: 900, marginTop: 1 }}>{leader.displayName}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{leader.wins}W–{leader.losses}L · ROI {leader.roi >= 0 ? '+' : ''}{leader.roi.toFixed(1)}% · Win rate {(leader.winRate * 100).toFixed(0)}%</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: leader.profit >= 0 ? C.win : C.loss }}>{leader.profit >= 0 ? '+' : ''}${leader.profit.toFixed(0)}</div>
            <div style={{ fontSize: 10, color: C.muted }}>net profit</div>
          </div>
        </div>
      )}

      {/* Full standings — tap to drill in */}
      <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Full Standings · Tap for breakdown</div>
      {standings.map((u, i) => (
        <button key={u.id} onClick={() => setSelected(u.id)} style={{
          display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
          background: i === 0 ? C.goldBg : C.bgCard,
          border: `1px solid ${i === 0 ? C.gold : C.border}`,
          borderRadius: 14, padding: '14px 16px', marginBottom: 8, cursor: 'pointer',
        }}>
          <div style={{ fontSize: i < 3 ? 22 : 14, width: 28, textAlign: 'center', fontWeight: 800, color: C.muted, flexShrink: 0 }}>
            {i < 3 ? ['🥇','🥈','🥉'][i] : `#${i+1}`}
          </div>
          <Avatar name={u.displayName} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{u.displayName}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 3, display: 'flex', gap: 10 }}>
              <span><span style={{ color: C.win, fontWeight: 700 }}>{u.wins}W</span> – <span style={{ color: C.loss, fontWeight: 700 }}>{u.losses}L</span></span>
              <span>ROI <span style={{ color: u.roi >= 0 ? C.win : C.loss, fontWeight: 700 }}>{u.roi >= 0 ? '+' : ''}{u.roi.toFixed(0)}%</span></span>
              <span>Win% <span style={{ fontWeight: 700 }}>{(u.winRate * 100).toFixed(0)}%</span></span>
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 900, color: u.profit >= 0 ? C.win : C.loss }}>{u.profit >= 0 ? '+' : ''}${u.profit.toFixed(0)}</div>
            <div style={{ fontSize: 10, color: C.muted }}>›</div>
          </div>
        </button>
      ))}
    </div>
  )
}

// ─── Competitions ─────────────────────────────────────────────────────────────
function CompetitionsPage() {
  const { me, users, bets, upgradePro, groupName } = useApp()
  const [showModal, setShowModal] = useState(false)
  const [activeComp, setActiveComp] = useState<string | null>(null)

  if (activeComp === 'best-record') return <BestRecordComp users={users} bets={bets} onBack={() => setActiveComp(null)} />
  if (activeComp === 'bracket') return <BracketComp users={users} onBack={() => setActiveComp(null)} />
  if (activeComp === 'pickem') return <PickemComp users={users} onBack={() => setActiveComp(null)} />
  if (activeComp === 'survivor') return <SurvivorComp users={users} onBack={() => setActiveComp(null)} />
  if (activeComp === 'season') return <SeasonLongComp users={users} bets={bets} onBack={() => setActiveComp(null)} />

  const ACTIVE = { name: 'Weekly Best Record', type: 'Best Record', status: 'active', daysLeft: 4, prize: 'Bragging rights + winner picks next group dinner', players: users }

  const freeUsed = true // they've used their 1 free competition this week
  const daysUntilReset = 3

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900 }}>Competitions</h1>
          <p style={{ color: C.muted, fontSize: 13 }}>{groupName}</p>
        </div>
        <button onClick={() => freeUsed && !me.isPro ? setShowModal(true) : alert('Create competition (coming soon)')} style={{ ...btnStyle, padding: '8px 16px', fontSize: 13 }}>+ New</button>
      </div>

      {/* Free tier banner */}
      {!me.isPro && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Free Plan</div>
            <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>1 competition per week · resets in {daysUntilReset}d</div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: C.win }} />
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: C.bgEl, border: `1px solid ${C.border}` }} />
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: C.bgEl, border: `1px solid ${C.border}` }} />
          </div>
        </div>
      )}

      {/* Active comp */}
      <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Active</div>
      <div onClick={() => setActiveComp('best-record')} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, marginBottom: 20, borderLeft: `4px solid ${C.win}`, cursor: 'pointer' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ background: C.bgEl, color: C.muted, padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600 }}>{ACTIVE.type}</span>
          <span style={{ background: C.winBg, color: C.win, padding: '3px 10px', borderRadius: 99, fontSize: 9, fontWeight: 800 }}>ACTIVE</span>
        </div>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 8 }}>{ACTIVE.name}</div>
        <div style={{ background: C.goldBg, border: `1px solid rgba(180,83,9,0.2)`, borderRadius: 6, padding: '4px 10px', marginBottom: 10, display: 'inline-block' }}>
          <span style={{ color: C.gold, fontSize: 12, fontWeight: 600 }}>Prize: {ACTIVE.prize}</span>
        </div>
        <div style={{ display: 'flex', gap: 16, color: C.muted, fontSize: 12, marginBottom: 12 }}>
          <span>{ACTIVE.players.length} players</span>
          <span>{ACTIVE.daysLeft}d left</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {ACTIVE.players.map(u => <Avatar key={u.id} name={u.displayName} size={28} />)}
        </div>
      </div>

      {/* Pro competitions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {me.isPro ? 'Pro Competitions' : 'Pro Only'}
        </div>
        {!me.isPro && (
          <button onClick={() => setShowModal(true)} style={{ background: C.goldBg, border: `1px solid ${C.gold}`, color: C.gold, padding: '4px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 11 }}>Upgrade</button>
        )}
      </div>
      {[
        { icon: '🏆', title: 'Custom Bracket', desc: 'Head-to-head tournament — one loss and you\'re out.', id: 'bracket' },
        { icon: '🗳️', title: 'Weekly Pick\'em', desc: 'Everyone picks the same slate. Most correct wins.', id: 'pickem' },
        { icon: '🏝️', title: 'Survivor Pool', desc: 'Pick one team per week. One wrong pick ends your run.', id: 'survivor' },
        { icon: '📅', title: 'Season Long', desc: 'Full season standings. Who\'s the real sharp?', id: 'season' },
      ].map(c => (
        <div key={c.title} onClick={() => me.isPro ? setActiveComp(c.id) : setShowModal(true)}
          style={{ background: C.bgCard, border: `1px solid ${me.isPro ? C.primary : C.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 10, display: 'flex', gap: 14, alignItems: 'center', cursor: 'pointer', opacity: me.isPro ? 1 : 0.6 }}>
          <div style={{ fontSize: 28, flexShrink: 0 }}>{c.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{c.title}</div>
            <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{c.desc}</div>
          </div>
          {me.isPro
            ? <div style={{ color: C.primary, fontSize: 12, fontWeight: 700 }}>Start →</div>
            : <div style={{ color: C.gold, fontSize: 13, fontWeight: 800 }}>🔒</div>
          }
        </div>
      ))}

      {/* Pro modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'flex-end', zIndex: 100 }} onClick={() => setShowModal(false)}>
          <div style={{ background: C.bgCard, borderRadius: '28px 28px 0 0', padding: 28, paddingBottom: 40, width: '100%', maxWidth: 500, margin: '0 auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 48 }}>⭐</div>
              <div style={{ fontSize: 24, fontWeight: 900 }}>Lockroom Pro</div>
              <div style={{ color: C.muted, marginTop: 4 }}>Take your group to the next level</div>
            </div>
            {[['⚔️', 'Custom competitions: brackets, survivor, pick\'em'], ['📈', 'Advanced stats: ROI charts, trend analysis'], ['🔥', 'Unlimited groups & history'], ['🏆', 'Season leaderboards & hall of fame']].map(([e, t]) => (
              <div key={t} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 18 }}>{e}</span><span style={{ fontSize: 14 }}>{t}</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, margin: '20px 0' }}>
              {[['$4.99', '/month', false], ['$39.99', '/year', true]].map(([price, period, best]) => (
                <button key={period as string} onClick={() => { upgradePro(); setShowModal(false); alert('⭐ Welcome to Pro!') }} style={{
                  flex: 1, padding: '14px 0', borderRadius: 14, border: `1px solid ${best ? C.gold : C.border}`,
                  background: best ? C.goldBg : C.bgEl, cursor: 'pointer', color: C.text,
                }}>
                  {best && <div style={{ color: C.bg, background: C.gold, fontSize: 8, fontWeight: 900, letterSpacing: 0.5, borderRadius: 99, padding: '1px 8px', display: 'inline-block', marginBottom: 4 }}>BEST VALUE</div>}
                  <div style={{ color: best ? C.gold : C.text, fontSize: 22, fontWeight: 900 }}>{price as string}</div>
                  <div style={{ color: C.muted, fontSize: 12 }}>{period as string}</div>
                </button>
              ))}
            </div>
            <button onClick={() => setShowModal(false)} style={{ width: '100%', background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: '10px 0' }}>Not now</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Layout / Nav ─────────────────────────────────────────────────────────────
const TABS = [
  { path: '/', label: '🏠', name: 'Feed' },
  { path: '/leaderboard', label: '🏆', name: 'Board' },
  { path: '/add', label: '➕', name: 'Add Bet' },
  { path: '/competitions', label: '⚔️', name: 'Compete' },
  { path: '/profile', label: '👤', name: 'Me' },
]

function Layout() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <div style={{ flex: 1, padding: '16px 16px 100px' }}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/add" element={<AddBetPage />} />
          <Route path="/competitions" element={<CompetitionsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Routes>
      </div>
      <nav style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 480, background: '#1a3a52', backdropFilter: 'blur(12px)', borderTop: `1px solid rgba(75,156,211,0.2)`, display: 'flex', padding: '8px 0 16px', zIndex: 50, boxShadow: '0 -4px 24px rgba(0,0,0,0.15)' }}>
        {TABS.map(t => (
          <NavLink key={t.path} to={t.path} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, textDecoration: 'none' }}
            end={t.path === '/'}>
            {({ isActive }) => (
              <>
                {t.path === '/add'
                  ? <div style={{ width: 48, height: 48, borderRadius: '50%', background: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, marginTop: -20, boxShadow: `0 4px 20px rgba(0,212,255,0.4)`, color: C.bg }}>+</div>
                  : <span style={{ fontSize: 22, opacity: isActive ? 1 : 0.4 }}>{t.label}</span>
                }
                {t.path !== '/add' && <span style={{ fontSize: 9, color: isActive ? C.primary : 'rgba(255,255,255,0.4)', fontWeight: isActive ? 700 : 400 }}>{t.name}</span>}
                {t.path !== '/add' && isActive && <div style={{ width: 4, height: 4, borderRadius: '50%', background: C.primary }} />}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────
function WaitlistPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#0a1929', fontFamily: 'system-ui,-apple-system,sans-serif', overflowX: 'hidden' }}>
      {/* Hero */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px 40px', textAlign: 'center' }}>
        <div style={{ width: 80, height: 80, borderRadius: 22, background: 'linear-gradient(135deg,#1e5f8e,#4B9CD3)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24, boxShadow: '0 8px 32px rgba(75,156,211,0.3)' }}>
          <span style={{ fontSize: 40 }}>🔒</span>
        </div>
        <div style={{ display: 'inline-block', background: 'rgba(75,156,211,0.15)', border: '1px solid rgba(75,156,211,0.4)', borderRadius: 20, padding: '4px 14px', color: '#4B9CD3', fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 16 }}>
          Coming Soon
        </div>
        <h1 style={{ color: '#fff', fontSize: 52, fontWeight: 900, letterSpacing: -2, margin: '0 0 12px', lineHeight: 1 }}>Lockroom</h1>
        <p style={{ color: '#6b8299', fontSize: 18, lineHeight: 1.6, maxWidth: 380, margin: '0 0 8px' }}>
          Your crew's private betting league.
        </p>
        <p style={{ color: '#4a6070', fontSize: 15, lineHeight: 1.6, maxWidth: 340, margin: '0 0 40px' }}>
          Post picks, talk trash, and see who's actually sharp — all in one private group.
        </p>

        {/* CTA box */}
        <div style={{ background: 'linear-gradient(135deg, #0f2d45, #112a40)', border: '1px solid rgba(75,156,211,0.25)', borderRadius: 20, padding: '32px 28px', width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🔔</div>
          <div style={{ color: '#fff', fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Get notified when we go live</div>
          <div style={{ color: '#5a7a90', fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>
            Subscribe below and we'll email you the second Lockroom opens. No spam — one email, that's it.
          </div>
          <a
            href="https://lockroom.beehiiv.com/subscribe"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'block', background: 'linear-gradient(135deg,#1e70b0,#4B9CD3)', color: '#fff', textDecoration: 'none', borderRadius: 14, padding: '16px 24px', fontWeight: 800, fontSize: 16, textAlign: 'center', boxShadow: '0 4px 20px rgba(75,156,211,0.4)', transition: 'opacity 0.2s' }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            Subscribe for launch notification →
          </a>
          <div style={{ color: '#3a5570', fontSize: 12, textAlign: 'center', marginTop: 12 }}>
            lockroom.beehiiv.com/subscribe
          </div>
        </div>
      </div>

      {/* Features */}
      <div style={{ padding: '0 24px 60px', maxWidth: 480, margin: '0 auto' }}>
        <div style={{ color: '#3a5570', fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center', marginBottom: 20 }}>What's inside</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[
            ['📊', 'Leaderboard', 'See the rankings for your whole group in real time'],
            ['🔥', 'Reactions', 'Flame bets, call out bad picks, comment on every slip'],
            ['🎯', "Pick'em", 'Weekly competitions to crown the sharpest bettor'],
            ['🔒', 'Private', 'Invite-only — just you and your crew, no randos'],
            ['📈', 'Bet Tracking', 'Spread, ML, O/U, parlays — all logged automatically'],
            ['🏆', 'Streak Badges', 'Win streaks, hot hands, and bragging rights built in'],
          ].map(([icon, title, desc]) => (
            <div key={title} style={{ background: '#0f2236', border: '1px solid #1a3a52', borderRadius: 16, padding: '18px 16px' }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
              <div style={{ color: '#fff', fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{title}</div>
              <div style={{ color: '#4a6070', fontSize: 12, lineHeight: 1.5 }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ paddingBottom: 40 }} />
    </div>
  )
}

export default function App() {
  const [authed, setAuthed] = useState(false)
  const [sessionChecked, setSessionChecked] = useState(!SUPABASE_READY)

  useEffect(() => {
    if (!SUPABASE_READY) return
    import('./lib/supabase').then(({ supabase: sb }) => {
      // Check for existing session (user refreshed the page)
      sb.auth.getSession().then(({ data }) => {
        if (data.session) setAuthed(true)
        setSessionChecked(true)
      })
      // Listen for future auth state changes
      const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
        setAuthed(!!session)
      })
      return () => subscription.unsubscribe()
    })
  }, [])

  if (!sessionChecked) return (
    <div style={{ minHeight: '100vh', background: '#F0F5FA', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 40 }}>🔒</div>
      <div style={{ fontWeight: 800, fontSize: 20 }}>Lockroom</div>
    </div>
  )

  const handleAuth = () => setAuthed(true)
  const handleSignOut = async () => {
    if (SUPABASE_READY) {
      const { supabase: sb } = await import('./lib/supabase')
      await sb.auth.signOut()
    }
    setAuthed(false)
  }

  const isWaitlist = window.location.pathname === '/waitlist'
  if (isWaitlist) return <WaitlistPage />

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      {!authed
        ? <AuthPage onAuth={handleAuth} />
        : <AppProvider onSignOut={handleSignOut}>
            <BrowserRouter>
              <Layout />
            </BrowserRouter>
          </AppProvider>
      }
    </GoogleOAuthProvider>
  )
}
