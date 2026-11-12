-- migrate:up

-- One row = one series/era of the TCG, copied from TCGdex (e.g. 'swsh' = Sword & Shield).
-- `era` decides which market index a series belongs to (null = none, e.g. TCG Pocket).
create table series (
  id            text primary key,                                   -- TCGdex's id, e.g. 'swsh'
  name          text not null,                                      -- 'Sword & Shield'
  release_date  date,                                               -- '2019-11-15'
  era           text check (era in ('vintage', 'mid', 'modern'))    -- null = not in any index
);

-- Lock the table to direct access (our security rule).
-- The browser must never read or write tables directly; only our API (service role) can.
-- 1. Row level security ON, with no policies = nobody gets rows through Supabase's public API.
alter table series enable row level security;
-- 2. Remove the default permissions Supabase gives its two public roles
--    (anon = signed-out visitors, authenticated = signed-in users).
revoke all on table series from anon, authenticated;


-- migrate:down

-- Dropping the table also removes its row level security setting and its grants.
drop table series;
