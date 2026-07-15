-- Real weekly Bracket competition: group members are seeded by that
-- week's actual betting profit, then face off head-to-head each round —
-- whoever has the better real profit during the round's window advances.
-- Safe to re-run.

create table if not exists public.bracket_competitions (
  id           uuid primary key default uuid_generate_v4(),
  group_id     uuid references public.groups(id) on delete cascade,
  status       text not null default 'active' check (status in ('active','completed')),
  round        int not null default 1,
  round_days   int not null default 3,
  champion_id  uuid references public.profiles(id),
  created_at   timestamptz default now(),
  completed_at timestamptz
);

create table if not exists public.bracket_matches (
  id           uuid primary key default uuid_generate_v4(),
  bracket_id   uuid references public.bracket_competitions(id) on delete cascade,
  round        int not null,
  slot         int not null,
  user_a_id    uuid references public.profiles(id),
  user_b_id    uuid references public.profiles(id), -- null = bye
  period_start timestamptz not null,
  period_end   timestamptz not null,
  winner_id    uuid references public.profiles(id),
  created_at   timestamptz default now(),
  unique (bracket_id, round, slot)
);

alter table public.bracket_competitions enable row level security;
alter table public.bracket_matches enable row level security;

drop policy if exists "see group brackets" on public.bracket_competitions;
drop policy if exists "start group bracket" on public.bracket_competitions;
drop policy if exists "update group bracket" on public.bracket_competitions;

create policy "see group brackets" on public.bracket_competitions for select
  using (group_id in (select public.my_group_ids()));
create policy "start group bracket" on public.bracket_competitions for insert
  with check (group_id in (select public.my_group_ids()));
create policy "update group bracket" on public.bracket_competitions for update
  using (group_id in (select public.my_group_ids()));

drop policy if exists "see bracket matches" on public.bracket_matches;
drop policy if exists "create bracket matches" on public.bracket_matches;
drop policy if exists "update bracket matches" on public.bracket_matches;

create policy "see bracket matches" on public.bracket_matches for select
  using (bracket_id in (select id from public.bracket_competitions where group_id in (select public.my_group_ids())));
create policy "create bracket matches" on public.bracket_matches for insert
  with check (bracket_id in (select id from public.bracket_competitions where group_id in (select public.my_group_ids())));
create policy "update bracket matches" on public.bracket_matches for update
  using (bracket_id in (select id from public.bracket_competitions where group_id in (select public.my_group_ids())));

do $$ begin alter publication supabase_realtime add table public.bracket_competitions; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.bracket_matches; exception when duplicate_object then null; end $$;
