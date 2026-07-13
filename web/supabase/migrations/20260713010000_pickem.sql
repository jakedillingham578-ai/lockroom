-- ============================================================
-- Weekly Pick'em: one pick per member per game, graded against
-- real ESPN final scores. Safe to re-run.
-- ============================================================

create table if not exists public.pickem_picks (
  id         uuid primary key default uuid_generate_v4(),
  group_id   uuid references public.groups(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  game_id    text not null,
  pick       text not null,
  created_at timestamptz default now(),
  unique (group_id, user_id, game_id)
);

alter table public.pickem_picks enable row level security;

drop policy if exists "see group picks" on public.pickem_picks;
drop policy if exists "add own picks"   on public.pickem_picks;
drop policy if exists "update own picks" on public.pickem_picks;

create policy "see group picks" on public.pickem_picks for select
  using (group_id in (select public.my_group_ids()));
create policy "add own picks" on public.pickem_picks for insert
  with check (user_id = auth.uid() and group_id in (select public.my_group_ids()));
create policy "update own picks" on public.pickem_picks for update
  using (user_id = auth.uid());

do $$ begin alter publication supabase_realtime add table public.pickem_picks; exception when duplicate_object then null; end $$;
