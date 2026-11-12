-- migrate:up

-- One row = one user's collection on one day (what the `Value | Return %` chart draws).
-- Written by the daily job after prices are saved, and REBUILT for a user when they
-- delete a lot or change a quantity (it's derived from lots + sales + price_snapshots).
--
-- Time-weighted return:
--   daily return = (value − net_flow) ÷ yesterday's value − 1     (0% if yesterday's value is 0)
--   growth       = yesterday's growth × (1 + daily return)        (starts at 100)
-- Any period's return = growth_end ÷ growth_start − 1.
create table portfolio_days (
  user_id   uuid not null references profiles (id) on delete cascade,
  day       date not null,
  value     numeric(14,2) not null check (value >= 0),   -- Σ copies owned × that day's price
  net_flow  numeric(14,2) not null default 0,            -- market value of cards added minus sold/removed that day (can be negative)
  growth    numeric(18,8) not null check (growth > 0),   -- the growth line, starts at 100
  primary key (user_id, day)                             -- one row per user per day; rerunning a day updates it
);
-- The primary key (user_id, day) also serves the chart query: "this user's days from X to Y".

-- Lock the table to direct access (our security rule).
alter table portfolio_days enable row level security;
revoke all on table portfolio_days from anon, authenticated;


-- migrate:down

drop table portfolio_days;
