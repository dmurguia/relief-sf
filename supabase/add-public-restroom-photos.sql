-- Run once after schema.sql. Approved contributor photos move into this public
-- bucket; pending and rejected evidence remains private.
alter table restrooms add column if not exists public_photo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('restroom-photos', 'restroom-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true;

notify pgrst, 'reload schema';
