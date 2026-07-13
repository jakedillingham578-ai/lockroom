-- Remember each user's active group server-side so it survives logout/login
-- and works across devices. Safe to re-run.
alter table public.profiles
  add column if not exists last_group_id uuid references public.groups(id) on delete set null;
