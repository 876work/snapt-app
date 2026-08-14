-- Production notification-token queries (2026-08-14 raw {amount} incident;
-- broken by 628820c on 2026-08-09, when copy switched to {amount} tokens).
-- Run in the Supabase SQL editor (project euvwnpjwlekegtyghcoy), which runs
-- as postgres and bypasses RLS. Run A and B first (read-only). C is the
-- repair — rows with a ledgered refund get its amount formatted exactly as
-- server/src/money.ts would for that recipient's currency; rows with no
-- refund transaction (under-24h, charged in full) get the no-refund copy
-- instead. Run statements ONE AT A TIME: the editor only displays the
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
-- C. REPAIR — two cases, decided by the ledger:
--    1. A succeeded refund transaction exists on the booking → substitute
--       its amount into the copy. USD reader "USD 293.00"; XCD reader
--       "XCD 796.96 (refunded as USD 293.00)" at app_config.xcd_per_usd.
--    2. NO refund transaction exists → this was an under-24h cancellation
--       (100% charge; refundClient() no-ops at zero, so nothing was ever
--       ledgered). "Refund on its way" is false for these rows — the body
--       is replaced with the no-refund copy, word-for-word the same copy
--       the fixed server now sends for this case.
--    One atomic UPDATE — no begin/commit wrapper, because the editor
--    displays only the last statement's result and a commit would hide
--    the RETURNING rows. The repair column says which case each row took.
-- ============================================================
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
with_refund as (
  -- LEFT join: rows with no refund transaction must survive to take the
  -- no-refund copy, not silently stay broken.
  select b.id as notification_id, b.user_id, t.amount_usd
  from broken b
  left join lateral (
    select amount_usd from transactions
    where booking_id = b.booking_id and type = 'refund' and status = 'succeeded'
    order by created_at desc limit 1
  ) t on true
),
rendered as (
  select w.notification_id,
         case
           when w.amount_usd is null then null
           when p.currency = 'XCD'
             then 'XCD ' || to_char(round(w.amount_usd * cfg.rate, 2), 'FM999999990.00')
                  || ' (refunded as USD ' || to_char(round(w.amount_usd, 2), 'FM999999990.00') || ')'
           else 'USD ' || to_char(round(w.amount_usd, 2), 'FM999999990.00')
         end as amount_text
  from with_refund w
  join profiles p on p.id = w.user_id
  cross join cfg
)
update notifications n
set body = case
      when rendered.amount_text is not null
        then replace(n.body, '{amount}', rendered.amount_text)
      else 'Your booking is cancelled. Under the less-than-24-hour notice tier the session cost is charged in full, so no refund is due.'
    end
from rendered
where n.id = rendered.notification_id
returning n.id, n.user_id, n.trigger_type,
          case when rendered.amount_text is not null
               then 'amount: ' || rendered.amount_text
               else 'no-refund copy' end as repair,
          n.body;

-- If inventory (B) shows broken "Booking rescheduled" rows too, the same
-- repair applies with the reschedule fee as the source amount (direction:
-- charged):
--   ... transactions where booking_id = b.booking_id and type = 'fee'
--       and fees->>'kind' = 'reschedule_fee' ...
--   XCD format: 'XCD X.XX (charged as USD Y.YY)'
-- Confirm the exact type/kind values against a sample row before running.
