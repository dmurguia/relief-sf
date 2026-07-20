-- Run once in the Supabase SQL Editor. Safe to re-run.
-- Anonymous visitors may create review-queue records, but cannot read,
-- update, or set a record to an approved status.

drop policy if exists "anonymous place suggestions can be submitted" on public.place_suggestions;
create policy "anonymous place suggestions can be submitted"
on public.place_suggestions
for insert
to anon, authenticated
with check (status = 'pending'::public.review_status);

drop policy if exists "anonymous updates can be submitted" on public.restroom_updates;
create policy "anonymous updates can be submitted"
on public.restroom_updates
for insert
to anon, authenticated
with check (status = 'pending'::public.review_status);
