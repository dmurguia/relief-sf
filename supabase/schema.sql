-- Run in the Supabase SQL editor. Anonymous visitors can submit, but never approve, updates.
create extension if not exists "pgcrypto";

create type restroom_category as enum ('Public', 'Park', 'Restaurant', 'Grocery', 'Coffee');
create type review_status as enum ('pending', 'approved', 'rejected');

create table if not exists restrooms (
  id text primary key,
  name text not null,
  address text not null,
  neighborhood text not null,
  category restroom_category not null,
  latitude double precision not null,
  longitude double precision not null,
  hours text not null,
  access text not null,
  tags text[] not null default '{}',
  description text not null,
  source_url text,
  source_name text,
  verification_status review_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists restroom_updates (
  id uuid primary key default gen_random_uuid(),
  restroom_id text not null references restrooms(id) on delete cascade,
  note text not null check (char_length(note) between 3 and 1000),
  access_detail text check (char_length(access_detail) <= 280),
  cleanliness_rating smallint check (cleanliness_rating between 1 and 5),
  photo_path text,
  ai_review jsonb,
  status review_status not null default 'pending',
  created_at timestamptz not null default now()
);

alter table restrooms enable row level security;
alter table restroom_updates enable row level security;

create policy "approved restrooms are readable" on restrooms for select using (verification_status = 'approved');
create policy "anonymous updates can be submitted" on restroom_updates for insert with check (status = 'pending');
-- Do not add an anonymous select/update policy on restroom_updates. Review from the Supabase dashboard.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('restroom-submissions', 'restroom-submissions', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "anonymous pending photos can be uploaded" on storage.objects
for insert to anon with check (bucket_id = 'restroom-submissions' and name like 'pending/%');
-- Keep the bucket private. Only a moderator/service role should obtain signed URLs for review.
