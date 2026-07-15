-- Squares (Pro): classic 10x10 grid pool on one real game. Members claim
-- cells; digits are randomized once locked; final score's last digits
-- pick the winning cell. Safe to re-run.

create table if not exists public.squares_boards (
  id         uuid primary key default uuid_generate_v4(),
  group_id   uuid references public.groups(id) on delete cascade,
  game_id    text not null,
  sport      text not null,
  league     text not null,
  status     text not null default 'open' check (status in ('open','locked','completed')),
  home_digits int[],  -- index 0-9 -> digit shown in each column, set at lock time
  away_digits int[],  -- index 0-9 -> digit shown in each row, set at lock time
  winner_id  uuid references public.profiles(id),
  created_at timestamptz default now(),
  locked_at  timestamptz,
  completed_at timestamptz
);

create table if not exists public.squares_cells (
  id        uuid primary key default uuid_generate_v4(),
  board_id  uuid references public.squares_boards(id) on delete cascade,
  row       int not null check (row >= 0 and row <= 9),
  col       int not null check (col >= 0 and col <= 9),
  user_id   uuid references public.profiles(id),
  unique (board_id, row, col)
);

alter table public.squares_boards enable row level security;
alter table public.squares_cells enable row level security;

drop policy if exists "see group boards" on public.squares_boards;
drop policy if exists "create group boards" on public.squares_boards;
drop policy if exists "update group boards" on public.squares_boards;

create policy "see group boards" on public.squares_boards for select
  using (group_id in (select public.my_group_ids()));
create policy "create group boards" on public.squares_boards for insert
  with check (group_id in (select public.my_group_ids()));
create policy "update group boards" on public.squares_boards for update
  using (group_id in (select public.my_group_ids()));

drop policy if exists "see board cells" on public.squares_cells;
drop policy if exists "claim board cells" on public.squares_cells;
drop policy if exists "update board cells" on public.squares_cells;

create policy "see board cells" on public.squares_cells for select
  using (board_id in (select id from public.squares_boards where group_id in (select public.my_group_ids())));
create policy "claim board cells" on public.squares_cells for insert
  with check (user_id = auth.uid() and board_id in (select id from public.squares_boards where group_id in (select public.my_group_ids())));
create policy "update board cells" on public.squares_cells for update
  using (board_id in (select id from public.squares_boards where group_id in (select public.my_group_ids())));

do $$ begin alter publication supabase_realtime add table public.squares_boards; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.squares_cells; exception when duplicate_object then null; end $$;
