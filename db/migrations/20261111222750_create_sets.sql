-- migrate:up

-- One row = one set (expansion), copied from TCGdex (e.g. 'sv08' = Surging Sparks).
-- Each set belongs to one series (one series has many sets).
create table sets (
  id            text primary key,                        -- TCGdex's id, e.g. 'sv08' (text: 'sv03.5' exists)
  series_id     text not null references series (id),    -- the era it belongs to
  name          text not null,                           -- 'Surging Sparks'
  release_date  date,                                    -- '2024-11-08'
  synced_at     timestamptz                              -- when we last copied this set from TCGdex
);

-- Foreign keys don't get an index automatically; this one speeds up "all sets in a series".
create index sets_series on sets (series_id);

-- Lock the table to direct access (our security rule).
alter table sets enable row level security;
revoke all on table sets from anon, authenticated;


-- migrate:down

drop table sets;
