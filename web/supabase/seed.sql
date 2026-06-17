-- Seed data for local development
-- Run automatically on: npx supabase db reset

-- ── Users (bypass auth for local dev) ───────────────────────
insert into auth.users (id, email, created_at, updated_at, confirmation_token, email_confirmed_at)
values
  ('00000000-0000-0000-0000-000000000001', 'you@lockroom.app',     now(), now(), '', now()),
  ('00000000-0000-0000-0000-000000000002', 'owen@lockroom.app',    now(), now(), '', now()),
  ('00000000-0000-0000-0000-000000000003', 'will@lockroom.app',    now(), now(), '', now()),
  ('00000000-0000-0000-0000-000000000004', 'charlie@lockroom.app', now(), now(), '', now()),
  ('00000000-0000-0000-0000-000000000005', 'luke@lockroom.app',    now(), now(), '', now())
on conflict (id) do nothing;

-- ── Profiles ─────────────────────────────────────────────────
insert into public.profiles (id, username, display_name, emoji, is_pro) values
  ('00000000-0000-0000-0000-000000000001', 'you',           'You',     '🦁', false),
  ('00000000-0000-0000-0000-000000000002', 'owen_bets',     'Owen',    '🐯', true),
  ('00000000-0000-0000-0000-000000000003', 'will_l',        'Will',    '🦊', false),
  ('00000000-0000-0000-0000-000000000004', 'charlie_picks', 'Charlie', '🐺', true),
  ('00000000-0000-0000-0000-000000000005', 'luke_money',    'Luke',    '🦅', false)
on conflict (id) do update set display_name = excluded.display_name, is_pro = excluded.is_pro;

-- ── Citadel group ─────────────────────────────────────────────
insert into public.groups (id, name, code, owner_id, max_members) values
  ('10000000-0000-0000-0000-000000000001', 'Citadel', 'DEG247', '00000000-0000-0000-0000-000000000001', 15)
on conflict (id) do nothing;

-- ── Group memberships ─────────────────────────────────────────
insert into public.group_members (group_id, user_id) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005')
on conflict do nothing;

-- ── Bets ──────────────────────────────────────────────────────
insert into public.bets (user_id, group_id, sport, type, description, odds, stake, status, sportsbook, created_at) values
  -- This week
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'NFL', 'parlay',     '2-leg: Chiefs -3.5 vs Bills + Eagles ML vs Cowboys', 265, 100, 'won',     'DraftKings', now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'NBA', 'over_under', 'Lakers/Warriors Over 228.5',                         -115,  50, 'lost',    'FanDuel',   now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'NFL', 'moneyline',  'Eagles ML vs Cowboys',                                130,  75, 'won',     'BetMGM',    now() - interval '3 days'),
  ('00000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'NFL', 'parlay',     '3-leg: Ravens ML + Over 45.5 + CMC TD',               620,  25, 'pending', 'DraftKings', now() - interval '4 hours'),
  ('00000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'NBA', 'spread',     'Celtics -5.5 vs Heat',                               -110, 200, 'lost',    'Caesars',   now() - interval '4 days'),
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'CFB', 'spread',     'Alabama -7 vs Auburn',                               -110, 150, 'won',     'FanDuel',   now() - interval '5 days'),
  -- This month
  ('00000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'NBA', 'moneyline',  'Knicks ML vs Bucks',                                  115,  80, 'lost',    'BetMGM',    now() - interval '8 days'),
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'NFL', 'spread',     'Packers +3 vs Bears',                                -110, 100, 'lost',    'DraftKings', now() - interval '9 days'),
  ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'MLB', 'moneyline',  'Yankees ML vs Red Sox',                              -130, 130, 'lost',    'FanDuel',   now() - interval '11 days'),
  ('00000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'NFL', 'parlay',     '2-leg: Rams -4 vs 49ers + Under 48.5',                240,  50, 'lost',    'Caesars',   now() - interval '13 days'),
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'NBA', 'prop',       'LeBron Over 27.5 pts',                               -115,  75, 'won',     'DraftKings', now() - interval '15 days'),
  ('00000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'NHL', 'moneyline',  'Bruins ML vs Rangers',                               -120, 120, 'lost',    'BetMGM',    now() - interval '17 days'),
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'CFB', 'spread',     'Georgia -10 vs Tennessee',                           -110, 100, 'lost',    'FanDuel',   now() - interval '19 days'),
  -- This year
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'NFL', 'parlay',     '3-leg: Bills ML + Ravens -3 + Over 51',               580,  50, 'lost',    'FanDuel',   now() - interval '35 days'),
  ('00000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'NBA', 'spread',     'Warriors -4.5 vs Suns',                              -110, 200, 'lost',    'BetMGM',    now() - interval '50 days'),
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'MLB', 'moneyline',  'Dodgers ML vs Padres',                               -145, 145, 'lost',    'DraftKings', now() - interval '65 days'),
  ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'NFL', 'spread',     'Ravens -7 vs Browns',                                -110, 100, 'lost',    'Caesars',   now() - interval '80 days'),
  ('00000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'NBA', 'parlay',     '2-leg: Lakers ML + Curry Over 29.5',                  310,  40, 'lost',    'FanDuel',   now() - interval '100 days'),
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'CFB', 'spread',     'Ohio State -14 vs Michigan',                         -110, 200, 'lost',    'DraftKings', now() - interval '120 days'),
  ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'MMA', 'moneyline',  'Jones ML vs Miocic',                                 -200, 200, 'lost',    'Caesars',   now() - interval '210 days');
