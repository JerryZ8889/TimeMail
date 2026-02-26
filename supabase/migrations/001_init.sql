create extension if not exists pgcrypto;

create table if not exists public.job_state (
  key text primary key,
  last_success_at timestamptz null,
  updated_at timestamptz not null default now()
);

insert into public.job_state (key, last_success_at)
values ('daily_news', null)
on conflict (key) do nothing;

create table if not exists public.run_log (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  status text not null,
  window_start timestamptz null,
  window_end timestamptz null,
  fetched_count int not null default 0,
  deduped_count int not null default 0,
  output_count int not null default 0,
  error_message text null
);

create index if not exists idx_run_log_started_at_desc on public.run_log (started_at desc);

create table if not exists public.news_item (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  title text not null,
  url text not null,
  source text not null,
  published_at timestamptz not null,
  content_hash text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_news_item_url on public.news_item (url);
create unique index if not exists uq_news_item_content_hash on public.news_item (content_hash);
create index if not exists idx_news_item_published_at_desc on public.news_item (published_at desc);

alter table public.job_state enable row level security;
alter table public.run_log enable row level security;
alter table public.news_item enable row level security;

drop policy if exists job_state_select_anon on public.job_state;
create policy job_state_select_anon
on public.job_state
for select
to anon
using (true);

drop policy if exists job_state_select_authenticated on public.job_state;
create policy job_state_select_authenticated
on public.job_state
for select
to authenticated
using (true);

drop policy if exists run_log_select_anon on public.run_log;
create policy run_log_select_anon
on public.run_log
for select
to anon
using (true);

drop policy if exists run_log_select_authenticated on public.run_log;
create policy run_log_select_authenticated
on public.run_log
for select
to authenticated
using (true);

drop policy if exists news_item_select_anon on public.news_item;
create policy news_item_select_anon
on public.news_item
for select
to anon
using (true);

drop policy if exists news_item_select_authenticated on public.news_item;
create policy news_item_select_authenticated
on public.news_item
for select
to authenticated
using (true);

grant select on public.job_state to anon;
grant select on public.run_log to anon;
grant select on public.news_item to anon;

grant all privileges on public.job_state to authenticated;
grant all privileges on public.run_log to authenticated;
grant all privileges on public.news_item to authenticated;

