-- migrate:up

-- One row = one user of our app, linked one-to-one to Supabase's own user (auth.users).
-- Created by our API on the user's first sign-in. Our other user tables point here,
-- so this is the only table that touches Supabase's auth system.
create table profiles (
  id            uuid primary key references auth.users (id) on delete cascade,  -- same id as the Supabase user
  display_name  text,
  created_at    timestamptz not null default now()
);
-- Deleting the Supabase user deletes the profile, and from there (by cascade)
-- all of that user's lots, sales and history.

-- Lock the table to direct access (our security rule).
alter table profiles enable row level security;
revoke all on table profiles from anon, authenticated;


-- migrate:down

drop table profiles;
