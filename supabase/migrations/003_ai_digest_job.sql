create table if not exists public.ai_digest_job (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null,
  topic text not null,
  days text not null,
  q text not null default '',
  candidate_limit int not null default 200,
  max_items int not null default 30,
  attempt int not null default 0,
  next_run_at timestamptz null,
  started_at timestamptz null,
  ended_at timestamptz null,
  candidate_count int null,
  error_message text null,
  picked jsonb null,
  digest jsonb null
);

create index if not exists idx_ai_digest_job_created_at_desc on public.ai_digest_job (created_at desc);
create index if not exists idx_ai_digest_job_status_next on public.ai_digest_job (status, next_run_at, created_at);

alter table public.ai_digest_job enable row level security;
