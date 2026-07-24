-- Pro is a group-level unlock, not a per-person one: the Pro games
-- (Confidence Pool, Squares, Pick'em, Survivor, custom bracket rounds)
-- are shared experiences — one person having personal access doesn't
-- let anyone else actually play. Whoever subscribes sponsors the whole
-- group. Safe to re-run.
alter table public.groups add column if not exists is_pro boolean not null default false;
alter table public.groups add column if not exists stripe_customer_id text;
alter table public.groups add column if not exists stripe_subscription_id text;
