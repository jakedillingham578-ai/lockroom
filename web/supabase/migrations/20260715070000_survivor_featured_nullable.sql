-- The old singular game_id column is superseded by game_ids (array) but
-- still has its original NOT NULL constraint, which blocks every new
-- gauntlet-style insert (they only populate game_ids). Relax it.
alter table public.survivor_featured alter column game_id drop not null;
