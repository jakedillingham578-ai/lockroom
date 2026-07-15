-- Fix squares_cells policies:
-- 1. INSERT happens once at board creation, populating 100 blank cells
--    (user_id = NULL) — the old policy required user_id = auth.uid(),
--    which blocked NULL inserts entirely.
-- 2. UPDATE (claiming/unclaiming) was unrestricted — any group member
--    could overwrite anyone else's claim. Now: you can only touch a cell
--    that's empty or already yours, and can only set it to empty or you.
drop policy if exists "claim board cells" on public.squares_cells;
drop policy if exists "update board cells" on public.squares_cells;

create policy "create board cells" on public.squares_cells for insert
  with check (board_id in (select id from public.squares_boards where group_id in (select public.my_group_ids())));

create policy "claim or unclaim own cell" on public.squares_cells for update
  using (
    board_id in (select id from public.squares_boards where group_id in (select public.my_group_ids()))
    and (user_id is null or user_id = auth.uid())
  )
  with check (user_id is null or user_id = auth.uid());
