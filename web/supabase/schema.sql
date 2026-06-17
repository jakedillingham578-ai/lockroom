-- ============================================================
-- Lockroom — Supabase Schema
-- Run this in Supabase SQL Editor: supabase.com → your project → SQL Editor
-- ============================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ── Profiles (extends Supabase auth.users) ──────────────────
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text unique not null,
  display_name  text not null,
  emoji         text default '🦁',
  is_pro        boolean default false,
  created_at    timestamptz default now()
);

-- Auto-create a profile when a user signs up via Google OAuth
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    split_part(new.email, '@', 1),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Groups ──────────────────────────────────────────────────
create table public.groups (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  code        text unique not null,           -- 6-char join code e.g. 'DEG247'
  owner_id    uuid references public.profiles(id),
  max_members int default 25,
  created_at  timestamptz default now()
);

-- ── Group Memberships ────────────────────────────────────────
create table public.group_members (
  group_id  uuid references public.groups(id) on delete cascade,
  user_id   uuid references public.profiles(id) on delete cascade,
  joined_at timestamptz default now(),
  primary key (group_id, user_id)
);

-- ── Games (cached from The Odds API) ────────────────────────
create table public.games (
  id             text primary key,   -- The Odds API game key
  sport_key      text not null,
  home_team      text not null,
  away_team      text not null,
  commence_time  timestamptz not null,
  home_score     int,
  away_score     int,
  completed      boolean default false,
  last_fetched   timestamptz default now()
);

-- ── Bets ─────────────────────────────────────────────────────
create table public.bets (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid references public.profiles(id) on delete cascade,
  group_id     uuid references public.groups(id) on delete cascade,
  game_id      text references public.games(id),   -- null = manual bet
  sport        text not null,
  type         text not null check (type in ('spread','moneyline','over_under','parlay','prop','other')),
  description  text not null,
  odds         int not null,           -- American odds e.g. -110, +250
  stake        numeric(10,2) not null,
  status       text default 'pending' check (status in ('pending','won','lost','push')),
  sportsbook   text default 'Other',
  legs         jsonb,                  -- parlay legs: [{team, odds, sport, description}]
  created_at   timestamptz default now(),
  settled_at   timestamptz
);

-- ── Indexes ──────────────────────────────────────────────────
create index bets_user_id_idx     on public.bets(user_id);
create index bets_group_id_idx    on public.bets(group_id);
create index bets_game_id_idx     on public.bets(game_id);
create index bets_status_idx      on public.bets(status);
create index bets_created_at_idx  on public.bets(created_at desc);
create index games_completed_idx  on public.games(completed);

-- ── Row Level Security ───────────────────────────────────────
alter table public.profiles      enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.bets          enable row level security;
alter table public.games         enable row level security;

-- Profiles: anyone can read, only you can update yours
create policy "Profiles are public"         on public.profiles for select using (true);
create policy "Users update own profile"    on public.profiles for update using (auth.uid() = id);

-- Groups: members can read their groups
create policy "Members see their groups"    on public.groups for select
  using (id in (select group_id from public.group_members where user_id = auth.uid()));
create policy "Owners can update group"     on public.groups for update
  using (owner_id = auth.uid());
create policy "Auth users can create groups" on public.groups for insert
  with check (auth.uid() is not null);

-- Group members: members see their group's members
create policy "Members see group members"   on public.group_members for select
  using (group_id in (select group_id from public.group_members where user_id = auth.uid()));
create policy "Users can join groups"       on public.group_members for insert
  with check (auth.uid() = user_id);

-- Bets: only group members see bets in their groups
create policy "Group members see bets"      on public.bets for select
  using (group_id in (select group_id from public.group_members where user_id = auth.uid()));
create policy "Users add own bets"          on public.bets for insert
  with check (auth.uid() = user_id);
create policy "Users update own bets"       on public.bets for update
  using (auth.uid() = user_id);

-- Games: publicly readable (they're just game data)
create policy "Games are public"            on public.games for select using (true);
create policy "Service can upsert games"    on public.games for all using (true);

-- ── Seed data: create the Citadel group ─────────────────────
-- (Run manually after creating your account)
-- insert into public.groups (name, code, owner_id, max_members)
-- values ('Citadel', 'DEG247', '<your-user-uuid>', 15);
