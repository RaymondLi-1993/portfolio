-- migrate:up

-- One row = a benchmark's value and growth line on one day (the market line on the chart).
-- Price-weighted daily change = Σ members' prices today ÷ Σ the SAME members' prices yesterday − 1.
-- growth = yesterday's growth × (1 + daily change), starting at 100.
-- No net_flow: the comparison always uses the same members on both days.
create table benchmark_days (
  benchmark_id  text not null references benchmarks (id) on delete cascade,
  day           date not null,
  total_value   numeric(14,2) not null check (total_value >= 0),   -- Σ members' prices that day
  growth        numeric(18,8) not null check (growth > 0),         -- the growth line, starts at 100
  primary key (benchmark_id, day)                                  -- one row per benchmark per day
);

-- Lock the table to direct access (our security rule).
alter table benchmark_days enable row level security;
revoke all on table benchmark_days from anon, authenticated;


-- migrate:down

drop table benchmark_days;
