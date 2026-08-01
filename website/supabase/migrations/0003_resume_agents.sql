create table if not exists public.resume_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (user_id, content_hash)
);

create index if not exists resume_documents_user_created_idx
  on public.resume_documents (user_id, created_at desc);

create table if not exists public.resume_agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resume_document_id uuid references public.resume_documents(id) on delete set null,
  agent text not null check (
    agent in ('resume_opt_agent', 'interview_question_agent', 'history_interview_agent')
  ),
  version integer not null,
  company text,
  role text,
  job_description text,
  input_snapshot jsonb not null default '{}'::jsonb,
  result_content text not null,
  sources jsonb not null default '[]'::jsonb,
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  credits_charged integer not null check (credits_charged > 0),
  created_at timestamptz not null default now(),
  unique (user_id, agent, version)
);

create index if not exists resume_agent_runs_user_created_idx
  on public.resume_agent_runs (user_id, created_at desc);

alter table public.resume_documents enable row level security;
alter table public.resume_agent_runs enable row level security;
revoke all on public.resume_documents from public, anon, authenticated;
revoke all on public.resume_agent_runs from public, anon, authenticated;
