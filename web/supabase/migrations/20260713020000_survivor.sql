-- ============================================================
-- Survivor Pool: one team pick per member per DAY, graded against
-- real ESPN results. Your team must win or you're eliminated;
-- you can't reuse a team. Safe to re-run.
-- ============================================================

create table if not exists public.survivor_picks (
  id         uuid primary key default uuid_generate_v4(),
  group_id   uuid references public.groups(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  day        text not null,       -- local YYYY-MM-DD of the game
  game_id    text not null,
  pick       text not null,       -- team display name
  created_at timestamptz default now(),
  unique (group_id, user_id, day)
);

alter table public.survivor_picks enable row level security;

drop policy if exists "see group survivor"   on public.survivor_picks;
drop policy if exists "add own survivor"      on public.survivor_picks;
drop policy if exists "update own survivor"   on public.survivor_picks;

create policy "see group survivor" on public.survivor_picks for select
  using (group_id in (select public.my_group_ids()));
create policy "add own survivor" on public.survivor_picks for insert
  with check (user_id = auth.uid() and group_id in (select public.my_group_ids()));
create policy "update own survivor" on public.survivor_picks for update
  using (user_id = auth.uid());

do $$ begin alter publication supabase_realtime add table public.survivor_picks; exception when duplicate_object then null; end $$;
