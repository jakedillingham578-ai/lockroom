-- Tighten write policies: bets/reactions/comments must belong to a group
-- the user is actually a member of, not just "user_id = auth.uid()".
-- Safe to re-run.

drop policy if exists "Users add own bets" on public.bets;
create policy "Users add own bets" on public.bets for insert
  with check (auth.uid() = user_id and group_id in (select public.my_group_ids()));

drop policy if exists "add own reactions" on public.bet_reactions;
create policy "add own reactions" on public.bet_reactions for insert
  with check (user_id = auth.uid() and bet_id in (
    select id from public.bets where group_id in (select public.my_group_ids())
  ));

drop policy if exists "add own comments" on public.bet_comments;
create policy "add own comments" on public.bet_comments for insert
  with check (user_id = auth.uid() and bet_id in (
    select id from public.bets where group_id in (select public.my_group_ids())
  ));
