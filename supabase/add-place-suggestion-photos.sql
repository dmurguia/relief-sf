-- Run once in the Supabase SQL Editor. Suggested places may include an optional,
-- private restroom-only photo for the moderator to inspect.
alter table place_suggestions add column if not exists photo_path text;
