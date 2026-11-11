-- migrate:up

-- One row = one card in one printing (e.g. Pineco normal, Pineco reverse holo).
-- This is the thing that has a price and gets owned: prices, lots and index members point here.
create table card_printings (
  id        bigint generated always as identity primary key,   -- short generated id: 1, 2, 3…
  card_id   text not null references cards (id) on delete cascade,
  printing  text not null check (printing in (
              'normal',
              'holofoil',
              'reverse_holofoil',
              '1st_edition_normal',
              '1st_edition_holofoil',
              'unlimited_holofoil'
            )),
  unique (card_id, printing)                                    -- each printing once per card
);
-- (No separate index on card_id: the unique (card_id, printing) index already starts with card_id.)

-- Lock the table to direct access (our security rule).
alter table card_printings enable row level security;
revoke all on table card_printings from anon, authenticated;
-- The identity column uses a sequence (the counter behind 1, 2, 3…); lock that too.
revoke all on sequence card_printings_id_seq from anon, authenticated;


-- migrate:down

drop table card_printings;
