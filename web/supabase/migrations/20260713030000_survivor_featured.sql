-- ============================================================
-- Survivor featured game: the ONE game each group must guess per
-- day, pinned server-side so every member sees the identical game
-- (first member to open that day locks it in). Safe to re-run.
-- ============================================================

create table if not exists public.survivor_featured (
  group_id   uuid references public.groups(id) on delete cascade,
  day        text not null,      -- local YYYY-MM-DD
  game_id    text not null,
  created_at timestamptz default now(),
  primary key (group_id, day)
);

alter table public.survivor_featured enable row level security;

drop policy if exists "see group featured" on public.survivor_featured;
drop policy if exists "pin group featured" on public.survivor_featured;

create policy "see group featured" on public.survivor_featured for select
  using (group_id in (select public.my_group_ids()));
create policy "pin group featured" on public.survivor_featured for insert
  with check (group_id in (select public.my_group_ids()));

do $$ begin alter publication supabase_realtime add table public.survivor_featured; exception when duplicate_object then null; end $$;
