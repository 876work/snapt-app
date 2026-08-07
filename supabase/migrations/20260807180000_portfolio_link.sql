-- The portfolio link the applicant types has never had anywhere to go.
--
-- ApplyBody declared it and the app has always shown the input, but no column
-- existed, so every applicant's Instagram or website was silently discarded —
-- the single most useful artefact for judging a photographer.
--
-- Column only, no foreign key.

alter table creator_profiles
  add column portfolio_link text;
