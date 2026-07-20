-- Run after schema.sql and add-place-suggestions.sql. These fields persist the
-- server-side GPT-5.6 review; anonymous clients still cannot read or edit them.
alter table restroom_updates add column if not exists ai_review_status text not null default 'queued'
  check (ai_review_status in ('queued', 'reviewing', 'reviewed', 'error'));
alter table restroom_updates add column if not exists ai_reviewed_at timestamptz;
alter table restroom_updates add column if not exists ai_review_error text;

alter table place_suggestions add column if not exists ai_review jsonb;
alter table place_suggestions add column if not exists ai_review_status text not null default 'queued'
  check (ai_review_status in ('queued', 'reviewing', 'reviewed', 'error'));
alter table place_suggestions add column if not exists ai_reviewed_at timestamptz;
alter table place_suggestions add column if not exists ai_review_error text;

notify pgrst, 'reload schema';
