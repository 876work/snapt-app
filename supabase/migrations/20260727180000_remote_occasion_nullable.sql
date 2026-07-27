-- Remote-edit orders have no occasion step in their journey (upload →
-- choose edit → pricing); occasion is an in-person matching input (§12).
-- Nullable so real remote orders don't fabricate one. In-person creation
-- still requires it server-side.
alter table bookings alter column occasion drop not null;
