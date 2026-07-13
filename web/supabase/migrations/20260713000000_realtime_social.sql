-- ============================================================
-- Lockroom — make it real: co-member visibility, reactions,
-- comments, and realtime. Safe to re-run.
-- ============================================================

-- Helper: your group ids, WITHOUT triggering RLS recursion.
create or replace function public.my_group_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select group_id from public.group_members where user_id = auth.uid()
$$;

-- ── group_members: see everyone in your groups (no recursion) ──
drop policy if exists "Users see own memberships" on public.group_members;
drop policy if exists "Members see group members" on public.group_members;
drop policy if exists "See co-members" on public.group_members;
create policy "See co-members" on public.group_members for select
  using (group_id in (select public.my_group_ids()));

-- ── bets: everyone in the group sees the group's bets ──
drop policy if exists "Group members see bets" on public.bets;
create policy "Group members see bets" on public.bets for select
  using (group_id in (select public.my_group_ids()));

-- ── Reactions ──────────────────────────────────────────────
create table if not exists public.bet_reactions (
  bet_id     uuid references public.bets(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz default now(),
  primary key (bet_id, user_id, emoji)
);
alter table public.bet_reactions enable row level security;
drop policy if exists "see reactions" on public.bet_reactions;
drop policy if exists "add own reactions" on public.bet_reactions;
drop policy if exists "remove own reactions" on public.bet_reactions;
create policy "see reactions" on public.bet_reactions for select
  using (bet_id in (select id from public.bets where group_id in (select public.my_group_ids())));
create policy "add own reactions" on public.bet_reactions for insert
  with check (user_id = auth.uid());
create policy "remove own reactions" on public.bet_reactions for delete
  using (user_id = auth.uid());

-- ── Comments ───────────────────────────────────────────────
create table if not exists public.bet_comments (
  id         uuid primary key default uuid_generate_v4(),
  bet_id     uuid references public.bets(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  text       text not null,
  created_at timestamptz default now()
);
alter table public.bet_comments enable row level security;
drop policy if exists "see comments" on public.bet_comments;
drop policy if exists "add own comments" on public.bet_comments;
create policy "see comments" on public.bet_comments for select
  using (bet_id in (select id from public.bets where group_id in (select public.my_group_ids())));
create policy "add own comments" on public.bet_comments for insert
  with check (user_id = auth.uid());

-- ── Realtime (optional; app also polls + refetches on focus) ──
do $$ begin alter publication supabase_realtime add table public.bets;          exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.bet_reactions; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.bet_comments;  exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.group_members; exception when duplicate_object then null; end $$;
