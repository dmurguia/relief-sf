-- Run once in the Supabase SQL Editor. Suggested places may include an optional,
-- private restroom-only photo for the moderator to inspect.
alter table place_suggestions add column if not exists photo_path text;

-- Make the new column visible to the REST API immediately. This avoids PGRST204
-- on a just-migrated project when an anonymous place suggestion includes a photo.
notify pgrst, 'reload schema';
