-- Dedupe bookings.declined_creator_ids on production.
--
-- WHY: offers.ts appended the excluded creator without de-duplicating, and
-- manual dispatch from the portal does not check the declined list — so an
-- admin could re-offer a booking to a creator who had already passed, and
-- their second timeout appended the same id again. `declined.length` is the
-- auto-cancel threshold (MAX_ASSIGNMENT_FAILURES = 3), so an inflated array
-- cancels a booking and refunds the client on a limit that was never really
-- reached. The code fix is in offers.ts; this cleans the rows it already
-- affected.
--
-- Run in the Supabase SQL editor against the PRODUCTION project
-- (euvwnpjwlekegtyghcoy). Step 1 is read-only — run it first and keep the
-- output. Step 2 writes. Step 3 confirms.

-- ---------------------------------------------------------------- 1. PREVIEW
-- Every row with duplicates, live and historical.
select id,
       status,
       declined_creator_ids,
       cardinality(declined_creator_ids) as entries,
       (select count(distinct x) from unnest(declined_creator_ids) as x) as distinct_creators
  from bookings
 where cardinality(declined_creator_ids)
       > (select count(distinct x) from unnest(declined_creator_ids) as x)
 order by status, id;

-- ----------------------------------------------------------------- 2. UPDATE
-- PENDING rows only. The two cancelled rows (3545a35f, 82039e60) are left
-- exactly as they are on purpose: they are the evidence that the auto-cancel
-- fired on an inflated count, and rewriting them would erase the record of
-- what happened to those two clients.
--
-- First-occurrence order is preserved, so the array still reads as the
-- sequence in which creators passed.
update bookings b
   set declined_creator_ids = (
         select array_agg(x order by first_pos)
           from (select x, min(ord) as first_pos
                   from unnest(b.declined_creator_ids) with ordinality as u(x, ord)
                  group by x) d
       )
 where b.status = 'pending'
   and cardinality(b.declined_creator_ids)
       > (select count(distinct x) from unnest(b.declined_creator_ids) as x);

-- ------------------------------------------------------------------ 3. VERIFY
-- Expect: zero rows with status = 'pending'. The two cancelled rows should
-- still be listed — that is intended.
select id,
       status,
       declined_creator_ids,
       cardinality(declined_creator_ids) as entries,
       (select count(distinct x) from unnest(declined_creator_ids) as x) as distinct_creators
  from bookings
 where cardinality(declined_creator_ids)
       > (select count(distinct x) from unnest(declined_creator_ids) as x)
 order by status, id;
