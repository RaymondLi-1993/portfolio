-- migrate:up

-- One row = the CURRENT market price of one printing (overwritten by the daily job).
-- printing_id is both the primary key and the foreign key: at most one current price per printing.
create table prices (
  printing_id        bigint primary key references card_printings (id) on delete cascade,
  market_price       numeric(12,2) check (market_price >= 0),  -- TCGplayer market price, USD (~NM); null = no price
  source_updated_at  timestamptz                               -- TCGdex's "updated": the "as of" date users see
);

-- Lock the table to direct access (our security rule).
alter table prices enable row level security;
revoke all on table prices from anon, authenticated;


-- migrate:down

drop table prices;
