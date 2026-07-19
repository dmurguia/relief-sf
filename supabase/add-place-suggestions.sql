-- Run once in the Supabase SQL Editor after schema.sql.
create table if not exists place_suggestions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 160),
  address text not null check (char_length(address) between 5 and 280),
  category restroom_category not null,
  latitude double precision not null,
  longitude double precision not null,
  note text check (char_length(note) <= 1000),
  access_detail text check (char_length(access_detail) <= 280),
  cleanliness_rating smallint check (cleanliness_rating between 1 and 5),
  status review_status not null default 'pending',
  created_at timestamptz not null default now()
);

alter table place_suggestions enable row level security;
create policy "anonymous place suggestions can be submitted" on place_suggestions
for insert to anon with check (status = 'pending');
