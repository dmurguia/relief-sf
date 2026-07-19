-- Run once in the Supabase SQL Editor to add 1–5 cleanliness ratings to the moderation queues.
alter table restroom_updates add column if not exists cleanliness_rating smallint;
alter table place_suggestions add column if not exists cleanliness_rating smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'restroom_updates_cleanliness_rating_check') then
    alter table restroom_updates add constraint restroom_updates_cleanliness_rating_check check (cleanliness_rating between 1 and 5);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'place_suggestions_cleanliness_rating_check') then
    alter table place_suggestions add constraint place_suggestions_cleanliness_rating_check check (cleanliness_rating between 1 and 5);
  end if;
end $$;
