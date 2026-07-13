-- Allow a member to remove their own membership (leave a group). Safe to re-run.
drop policy if exists "leave group" on public.group_members;
create policy "leave group" on public.group_members for delete
  using (user_id = auth.uid());
