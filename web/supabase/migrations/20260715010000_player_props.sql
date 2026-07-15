-- Player prop tracking: which player + stat category, so props can be
-- auto-settled against ESPN's real box score once the game ends.
-- pick_side ('over'/'under') and pick_line (the number) already exist
-- from the precise-settlement migration and are reused here.
alter table public.bets add column if not exists prop_player_id text;
alter table public.bets add column if not exists prop_player_name text;
alter table public.bets add column if not exists prop_stat text; -- e.g. 'PTS', 'REB', 'H', 'K'
