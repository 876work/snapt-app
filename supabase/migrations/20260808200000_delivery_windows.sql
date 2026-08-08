-- Delivery commitments, admin-editable from the portal.
--
-- Standard was "typically delivered within 5 days" in the app while the PAID
-- rush add-on promised 48 hours — the free promise and the paid one were
-- inconsistent, and rush was the slower-sounding of the two.
--
-- rush_hours is 6, not 3: at ~6 min per edited photo a 2-hour Both session
-- (45 photos + 2 videos) is already ~6 hours of editing. A 3-hour promise is
-- only deliverable on the smallest packages, and a paid speed promise we
-- cannot keep is a refund plus a bad review.
insert into app_config (key, value, description, confirmed) values
  (
    'delivery_windows',
    '{"standard_hours": 24, "rush_hours": 6, "warn_fraction": 0.75}'::jsonb,
    'Delivery commitments in hours from session end (in-person) or footage upload (remote). warn_fraction is how much of the window elapses before admin sees an approaching flag.',
    false
  )
on conflict (key) do nothing;
