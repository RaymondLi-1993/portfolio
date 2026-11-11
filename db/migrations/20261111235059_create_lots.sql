-- migrate:up

-- One row = one purchase (a "lot") of one printing by one user.
-- A user's collection = all their lots, minus copies sold (see `sales`).
-- Copies owned, value and gain/loss are calculated in queries, never stored.
create table lots (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles (id) on delete cascade,   -- whose lot (set from sign-in, never the form)
  printing_id    bigint not null references card_printings (id),             -- which version; NO cascade: owned printings can't be deleted
  condition      text not null default 'NM'
                   check (condition in ('NM', 'LP', 'MP', 'HP', 'DMG')),      -- always NM in v1 (hidden in the UI)
  quantity       integer not null check (quantity > 0),                      -- copies BOUGHT in this purchase (never changed by a sale)
  cost_per_copy  numeric(12,2) check (cost_per_copy >= 0),                    -- price paid, or our estimate; null while pending
  cost_source    text not null
                   check (cost_source in ('entered', 'market_on_add', 'pending')),
  purchased_on   date,                                                       -- optional, shown to the user
  added_at       timestamptz not null default now(),                         -- when added to the app (time-weighted return)
  -- "pending" exactly when there's no cost: the two can never disagree.
  check ((cost_source = 'pending') = (cost_per_copy is null))
);
-- Checked in the API instead (they depend on "today" or on other rows):
--   purchased_on not in the future; total sold never exceeds quantity.

-- "Read my collection" (every page view) always asks for one user's lots.
create index lots_by_user on lots (user_id);
-- Lets the catalog check "does anyone own this printing?" quickly (the no-cascade rule).
create index lots_by_printing on lots (printing_id);

-- Lock the table to direct access (our security rule).
alter table lots enable row level security;
revoke all on table lots from anon, authenticated;


-- migrate:down

drop table lots;
