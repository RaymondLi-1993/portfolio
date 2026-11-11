-- migrate:up

-- Trigram matching for fast "contains" search on card names (AP-1: search on every keystroke).
-- Supabase keeps extensions in the `extensions` schema.
create extension if not exists pg_trgm with schema extensions;

-- One row = one card, copied from TCGdex (e.g. 'sv08-238' = Pikachu ex, Surging Sparks #238).
-- Each card belongs to one set (one set has many cards).
create table cards (
  id                    text primary key,                   -- TCGdex's id, e.g. 'sv08-238'
  set_id                text not null references sets (id), -- the set it belongs to
  number                text not null,                      -- collector number: '238', 'TG05', '001' (text on purpose)
  name                  text not null,                      -- 'Pikachu ex'
  rarity                text,                               -- 'Special Illustration Rare' (index candidate filter)
  regulation_mark       text,                               -- 'H' (rotation warnings, v1.3); null for old cards
  legal_standard        boolean,                            -- TCGdex's Standard legality flag (v1.3)
  image_path            text,                               -- 'en/sv/sv08/238'; the API builds the URL (images-off switch)
  tcgplayer_product_id  integer,                            -- for matching JustTCG later (v1.1)
  unique (set_id, number)                                   -- a number appears once per set
);

-- "Contains" search on name, e.g. 'umbre' finds 'Umbreon VMAX'.
create index cards_name_search on cards using gin (name extensions.gin_trgm_ops);
-- (No separate index on set_id: the unique (set_id, number) index already starts with set_id.)

-- Lock the table to direct access (our security rule).
alter table cards enable row level security;
revoke all on table cards from anon, authenticated;


-- migrate:down

-- Drops the table and its indexes. The pg_trgm extension stays: other things may use it.
drop table cards;
