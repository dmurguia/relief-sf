-- Run after schema.sql. This separates map-published records from research candidates.
alter table restrooms add column if not exists source_tier text not null default 'community_verified'
  check (source_tier in ('official_city', 'official_business', 'community_verified', 'gpt_reviewed_lead'));
alter table restrooms add column if not exists source_updated_at timestamptz;

create table if not exists venue_candidates (
  id text primary key,
  name text not null,
  address text,
  latitude double precision not null,
  longitude double precision not null,
  venue_type text not null,
  source_name text not null,
  source_url text,
  source_license text,
  source_retrieved_at timestamptz not null default now(),
  evidence_note text,
  ai_proposal jsonb,
  status review_status not null default 'pending',
  created_at timestamptz not null default now()
);

alter table venue_candidates enable row level security;
-- Candidates intentionally have no anonymous read policy. They are research leads,
-- not claims about a venue's restroom access.
