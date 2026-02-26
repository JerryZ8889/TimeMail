alter table public.ai_digest_job
add column if not exists run_token uuid not null default gen_random_uuid();

create index if not exists idx_ai_digest_job_run_token on public.ai_digest_job (run_token);

