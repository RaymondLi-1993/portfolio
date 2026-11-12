-- migrate:up

-- One row = one market benchmark (a market index we compare users' returns against).
-- Named "benchmark" so it isn't confused with database indexes.
-- Its settings are data: changing the basket size or adding a cap is a one-row update.
create table benchmarks (
  id           text primary key,                                        -- 'modern'
  name         text not null,                                           -- 'Modern market' (shown in the UI)
  era          text not null check (era in ('vintage', 'mid', 'modern')),  -- which series' cards can be members
  basket_size  integer not null default 500 check (basket_size > 0),    -- how many printings are tracked
  weight_cap   numeric(5,4) check (weight_cap > 0 and weight_cap <= 1)  -- max share per printing (0.10 = 10%); null = no cap
);

-- Lock the table to direct access (our security rule).
alter table benchmarks enable row level security;
revoke all on table benchmarks from anon, authenticated;

-- v1 has one benchmark: the Modern market, top 500 by price, no cap.
-- (Vintage and Mid era are added later as new rows.)
insert into benchmarks (id, name, era, basket_size, weight_cap)
values ('modern', 'Modern market', 'modern', 500, null);


-- migrate:down

drop table benchmarks;
