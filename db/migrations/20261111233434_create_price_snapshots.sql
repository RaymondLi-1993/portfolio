-- migrate:up

-- Lets us say "no two ranges of the same printing may overlap" (see the exclude rule below).
create extension if not exists btree_gist with schema extensions;

-- One row = one printing's price over a range of days (run-length style history).
-- The daily job extends valid_to while the price stays the same,
-- and starts a new range when it changes.
--   Pikachu ex holo:  238.10  Nov 1 → Nov 4
--                     241.30  Nov 5 → Nov 10
-- "Price on day X" = the range where valid_from <= X <= valid_to (both days included).
create table price_snapshots (
  printing_id   bigint not null references card_printings (id) on delete cascade,
  market_price  numeric(12,2) not null check (market_price >= 0),
  valid_from    date not null,      -- first day this price applied
  valid_to      date not null,      -- last day this price applied (extended daily while unchanged)
  primary key (printing_id, valid_from),
  check (valid_to >= valid_from),   -- a range can't end before it starts
  -- No overlaps: the same printing can't have two prices on the same day.
  exclude using gist (
    printing_id with =,
    daterange(valid_from, valid_to, '[]') with &&
  )
);
-- The primary key index (printing_id, valid_from) also serves "the range containing day X".

-- Lock the table to direct access (our security rule).
alter table price_snapshots enable row level security;
revoke all on table price_snapshots from anon, authenticated;


-- migrate:down

-- Drops the table and its constraints. The btree_gist extension stays: other things may use it.
drop table price_snapshots;
