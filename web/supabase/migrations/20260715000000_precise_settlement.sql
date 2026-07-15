-- Store the EXACT pick (side + line) at bet creation time instead of making
-- the settlement engine re-parse a human-readable description with regex.
-- Safe to re-run.
alter table public.bets add column if not exists pick_side text; -- 'home' | 'away' | 'over' | 'under'
alter table public.bets add column if not exists pick_line numeric;
