-- Run once after add-trust-pipeline.sql. GPT-reviewed map leads remain visibly
-- distinct from city and community-verified restroom records.
alter table restrooms drop constraint if exists restrooms_source_tier_check;
alter table restrooms add constraint restrooms_source_tier_check
  check (source_tier in ('official_city', 'official_business', 'community_verified', 'gpt_reviewed_lead'));

alter table venue_candidates add column if not exists published_restroom_id text;
notify pgrst, 'reload schema';
