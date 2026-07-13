-- Track whether a user has set their display name (shown everywhere).
-- Safe to re-run.
alter table public.profiles
  add column if not exists name_confirmed boolean default false;
