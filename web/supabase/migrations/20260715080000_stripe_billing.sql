-- Real Pro billing via Stripe. is_pro already exists; add the columns
-- needed to link a profile to its Stripe customer/subscription so the
-- webhook can update status and the billing portal link can work.
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;
