# Lockroom — Backend Setup

## Sports Data — ESPN (Free, No Key Needed)

Lockroom uses ESPN's public API for live scores, schedules, and game results.
- **100% free** — no account, no API key, no limits
- Covers NFL, NBA, MLB, NHL, CFB, Soccer, MMA
- Auto-settles bets when games go final

No setup needed for this — it works out of the box.

---

## Step 1: Supabase (database + auth)

1. Go to **supabase.com** → New Project → name it "lockroom" (free tier is fine)
2. Once created, go to **Settings → API**
3. Copy **Project URL** → paste into `.env` as `VITE_SUPABASE_URL`
4. Copy **anon/public key** → paste into `.env` as `VITE_SUPABASE_ANON_KEY`
5. Go to **SQL Editor** → paste the entire contents of `supabase/schema.sql` → Run

That creates all tables, indexes, row-level security policies, and the auto-profile trigger.

---

## Step 2: Google OAuth (so login actually works)

1. Go to **console.cloud.google.com** → New Project → "lockroom"
2. APIs & Services → Credentials → Create OAuth 2.0 Client ID
3. Application type: **Web application**
4. Authorized JavaScript origins: `http://localhost:5173`
5. Copy **Client ID** → paste into `.env` as `VITE_GOOGLE_CLIENT_ID`
6. Back in Supabase → Authentication → Providers → Google → enable it, paste the Client ID + Secret

---

## How auto-settlement works

1. User adds a bet and links it to a real game (search in the Add Bet page)
2. When the game finishes, ESPN returns the final score
3. `settlement.ts` evaluates the bet automatically:
   - **Moneyline** — did the picked team win?
   - **Spread** — did the team cover?
   - **Over/Under** — did the total clear the line?
4. Status flips to `won`, `lost`, or `push` in Supabase
5. Feed and leaderboard update instantly

**Auto-settles:** Moneyline, Spread, Over/Under  
**Manual only:** Parlays, Props, Other

---

## File map

```
src/lib/
  supabase.ts       — Supabase client
  database.types.ts — TypeScript types for all tables
  odds.ts           — ESPN API: fetchScoreboard(), searchGames(), fetchAllScoreboards()
  settlement.ts     — Auto-settlement engine (runs at app load)

supabase/
  schema.sql        — Paste into Supabase SQL Editor to create your database
```

## Total cost: $0
- ESPN API: free, no key
- Supabase: free tier (500MB DB, 50k monthly active users)
- Hosting: Vercel free tier when you're ready to deploy
