-- migrate:up

-- One row = one printing that is a member of a benchmark for one month.
-- Written by the monthly re-rank. Old months are KEPT (not overwritten), so the
-- benchmark's history can always be recalculated if its rules change.
create table benchmark_members (
  benchmark_id  text not null references benchmarks (id) on delete cascade,
  month         date not null
                  check (month = date_trunc('month', month)::date),   -- always the 1st of the month
  printing_id   bigint not null references card_printings (id),       -- NO cascade: members can't be deleted from the catalog
  rank          integer not null check (rank > 0),                    -- 1 = most valuable at re-rank time
  primary key (benchmark_id, month, printing_id),                     -- a printing is a member at most once per month
  unique (benchmark_id, month, rank)                                  -- each rank used once per month
);

-- Lets the catalog check "is this printing a benchmark member?" quickly (the no-cascade rule),
-- and lets the daily job include members in its "tracked cards".
create index benchmark_members_by_printing on benchmark_members (printing_id);

-- Lock the table to direct access (our security rule).
alter table benchmark_members enable row level security;
revoke all on table benchmark_members from anon, authenticated;


-- migrate:down

drop table benchmark_members;
