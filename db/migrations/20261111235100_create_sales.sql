-- migrate:up

-- One row = one sale of some copies from one lot (partial sales allowed).
-- Selling never changes the lot: copies owned = lots.quantity − sum(sales.quantity).
-- Whose sale it is comes from the lot (sale → lot → user), so there's no user_id here.
create table sales (
  id              uuid primary key default gen_random_uuid(),
  lot_id          uuid not null references lots (id) on delete cascade,  -- removing a lot (a mistake) removes its sales
  quantity        integer not null check (quantity > 0),                 -- copies sold in this sale
  price_per_copy  numeric(12,2) not null check (price_per_copy >= 0),    -- whatever the user enters (no fees)
  sold_on         date not null,
  created_at      timestamptz not null default now()
);
-- Checked in the API, inside a transaction that locks the lot:
--   total sold for a lot never exceeds lots.quantity.

-- "Sales of this lot" (copies owned, realized gains).
create index sales_by_lot on sales (lot_id);

-- Lock the table to direct access (our security rule).
alter table sales enable row level security;
revoke all on table sales from anon, authenticated;


-- migrate:down

drop table sales;
