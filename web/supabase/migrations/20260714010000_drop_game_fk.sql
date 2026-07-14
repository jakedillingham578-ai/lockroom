-- bets.game_id stores an ESPN event id for auto-settlement lookups; the app
-- never populates the local `games` table (it fetches live from ESPN), so
-- the foreign key just rejects every real bet linked to a game. Drop it.
alter table public.bets drop constraint if exists bets_game_id_fkey;
