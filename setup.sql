-- TicketDesk database setup.
-- Run once in Supabase → SQL Editor → New query → Run.
-- Creates two tables and restricts each signed-in user to their own rows.

create table projects (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  start_date  date,
  deadline    date,
  created_at  timestamptz not null default now()
);

create table tickets (
  id               bigint generated always as identity primary key,
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  project_id       bigint references projects on delete cascade,
  title            text not null,
  description      text not null default '',
  importance       int  not null default 2,     -- 1 low, 2 medium, 3 high
  urgency          int  not null default 2,     -- 1 low, 2 medium, 3 high
  planned_for      date,                        -- empty = in the backlog
  start_time       time,                        -- optional, e.g. 14:00
  added_to_backlog date,
  slips            int  not null default 0,     -- times it was planned and moved
  done             boolean not null default false,
  checklist        jsonb not null default '[]', -- [{"text": "...", "done": false}]
  reminded         text,                        -- set by the reminder job
  created_at       timestamptz not null default now()
);

-- Row Level Security: without these policies, anyone with the public anon key could read all rows.
alter table projects enable row level security;
alter table tickets  enable row level security;

create policy "own projects" on projects for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own tickets" on tickets for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
