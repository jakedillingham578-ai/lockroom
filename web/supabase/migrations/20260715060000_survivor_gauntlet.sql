-- Gauntlet-style Survivor: day 1 features 1 game, day 2 features 2 games
-- (must go 2-for-2 to survive), day 3 features 3, and so on. Requires
-- multiple games per featured day (was one) and a day_number to track
-- the pool's sequence. Safe to re-run.

alter table public.survivor_featured add column if not exists day_number int;
alter table public.survivor_featured add column if not exists game_ids text[];
update public.survivor_featured set game_ids = array[game_id] where game_ids is null and game_id is not null;

-- Allow multiple picks per user per day (one per that day's featured games)
-- instead of a single pick per day.
alter table public.survivor_picks drop constraint if exists survivor_picks_group_id_user_id_day_key;
alter table public.survivor_picks add constraint survivor_picks_group_user_day_game_key unique (group_id, user_id, day, game_id);
