-- Run once in the Supabase SQL editor before enabling Autopilot in Operator Review.
-- This is intentionally service-role-only: there are no public RLS policies.
create table if not exists operator_autopilot_settings (
  id boolean primary key default true check (id = true),
  enabled boolean not null default false,
  confidence_threshold numeric(3,2) not null default 0.92 check (confidence_threshold between 0.85 and 0.99),
  updated_at timestamptz not null default now()
);

alter table operator_autopilot_settings enable row level security;

insert into operator_autopilot_settings (id, enabled, confidence_threshold)
values (true, false, 0.92)
on conflict (id) do nothing;
