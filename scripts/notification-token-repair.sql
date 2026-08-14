-- Production notification-token queries (2026-08-14 raw {amount} incident).
-- Run in the Supabase SQL editor (project euvwnpjwlekegtyghcoy), which runs
-- as postgres and bypasses RLS. Run A and B first (read-only). C is the
-- repair — it computes each refund amount from the transactions ledger and
-- formats it exactly the way server/src/money.ts would for that recipient's
-- currency. Run statements ONE AT A TIME: the editor only displays the
-- result of the last statement in a selection.

-- ============================================================
-- A. THE DUPLICATE QUESTION — recent cancellation notifications
--    (two "Cancellation confirmed" + two "Cancellation fee applied"
--    arrived a minute apart; same booking or two bookings?)
--    Read: if the two rows of a pair show DIFFERENT booking_id values,
--    they are two separate cancellations — not a duplicate send.
-- ============================================================
select n.id, n.user_id, n.trigger_type, n.title,
       n.data->>'booking_id' as booking_id, n.created_at, n.body
from notifications n
where n.trigger_type in ('refund_processed', 'fee_charged')
  and n.created_at > now() - interval '7 days'
order by n.created_at desc;

-- A2. Same question asked structurally: any booking with more than one
--     notification of the same trigger is a genuine double-send.
--     (Empty result = no duplicates anywhere, ever.)
select data->>'booking_id' as booking_id, trigger_type, count(*) as sends,
       array_agg(created_at order by created_at) as sent_at
from notifications
where trigger_type in ('refund_processed', 'fee_charged')
group by 1, 2
having count(*) > 1;

-- ============================================================
-- B. INVENTORY — every notification that ever shipped a raw token
-- ============================================================
select id, user_id, trigger_type, title, body,
       data->>'booking_id' as booking_id, created_at
from notifications
where title ~ '\{[a-z_]+\}' or body ~ '\{[a-z_]+\}'
order by created_at;

-- ============================================================
-- C. REPAIR — substitute the real amount into broken refund rows.
--    Amount = the succeeded refund transaction on that booking;
--    format = USD reader "USD 293.00", XCD reader
--    "XCD 796.96 (refunded as USD 293.00)" at app_config.xcd_per_usd.
--    RETURNING shows the after-state of every repaired row.
-- ============================================================
begin;
with cfg as (
  select coalesce(
    (select (value #>> '{}')::numeric from app_config where key = 'xcd_per_usd'),
    2.72
  ) as rate
),
broken as (
  select n.id, n.user_id, (n.data->>'booking_id')::uuid as booking_id
  from notifications n
  where n.trigger_type = 'refund_processed' and n.body like '%{amount}%'
),
refunds as (
  select b.id as notification_id, b.user_id, t.amount_usd
  from broken b
  join lateral (
    select amount_usd from transactions
    where booking_id = b.booking_id and type = 'refund' and status = 'succeeded'
    order by created_at desc limit 1
  ) t on true
),
rendered as (
  select r.notification_id,
         case when p.currency = 'XCD'
              then 'XCD ' || to_char(round(r.amount_usd * cfg.rate, 2), 'FM999999990.00')
                   || ' (refunded as USD ' || to_char(round(r.amount_usd, 2), 'FM999999990.00') || ')'
              else 'USD ' || to_char(round(r.amount_usd, 2), 'FM999999990.00')
         end as amount_text
  from refunds r
  join profiles p on p.id = r.user_id
  cross join cfg
)
update notifications n
set body = replace(n.body, '{amount}', rendered.amount_text)
from rendered
where n.id = rendered.notification_id
returning n.id, n.user_id, n.trigger_type, n.body;
commit;

-- If inventory (B) shows broken "Booking rescheduled" rows too, the same
-- repair applies with the reschedule fee as the source amount (direction:
-- charged):
--   ... transactions where booking_id = b.booking_id and type = 'fee'
--       and fees->>'kind' = 'reschedule_fee' ...
--   XCD format: 'XCD X.XX (charged as USD Y.YY)'
-- Confirm the exact type/kind values against a sample row before running.
