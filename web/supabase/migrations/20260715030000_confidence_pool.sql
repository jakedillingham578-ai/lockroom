-- Confidence Pool (Pro): like Pick'em, but each pick carries a confidence
-- rank (1..N, each used once) — correct picks score their confidence value.
-- Safe to re-run.

create table if not exists public.confidence_picks (
  id         uuid primary key default uuid_generate_v4(),
  group_id   uuid references public.groups(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  game_id    text not null,
  pick       text not null,
  confidence int not null,
  created_at timestamptz default now(),
  unique (group_id, user_id, game_id)
);

alter table public.confidence_picks enable row level security;

drop policy if exists "see group confidence picks" on public.confidence_picks;
drop policy if exists "add own confidence picks" on public.confidence_picks;
drop policy if exists "update own confidence picks" on public.confidence_picks;

create policy "see group confidence picks" on public.confidence_picks for select
  using (group_id in (select public.my_group_ids()));
create policy "add own confidence picks" on public.confidence_picks for insert
  with check (user_id = auth.uid() and group_id in (select public.my_group_ids()));
create policy "update own confidence picks" on public.confidence_picks for update
  using (user_id = auth.uid());

do $$ begin alter publication supabase_realtime add table public.confidence_picks; exception when duplicate_object then null; end $$;
