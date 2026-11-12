-- migrate:up

-- One row = the daily job's fetch state for one card (the job's notebook).
-- Per card, not per printing: one TCGdex request returns all printings of a card.
-- "Not done today" = last_fetched_at before today, OR source_updated_at before today (stale).
create table price_fetches (
  card_id            text primary key references cards (id) on delete cascade,
  last_fetched_at    timestamptz,   -- when WE last fetched it successfully
  source_updated_at  timestamptz,   -- TCGdex's "updated" from that fetch
  etag               text,          -- TCGdex's version tag, for conditional requests
  last_error         text           -- most recent error, for debugging; null when the last fetch worked
);
-- No index on last_fetched_at yet: the table is small (one row per tracked card).
-- Add one later if the "not done today" query gets slow.

-- Lock the table to direct access (our security rule).
alter table price_fetches enable row level security;
revoke all on table price_fetches from anon, authenticated;


-- migrate:down

drop table price_fetches;
