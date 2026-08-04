-- Google Maps wiring: real coordinates for service areas + meeting points.
--
-- service_areas is the single source of truth for the named areas: the app's
-- meeting-point map snaps the pin to the nearest active area and validates
-- "inside the service area" as distance-to-center <= radius_km (a circle
-- union — honest with the data we actually have; replace with real polygons
-- if/when they are drawn). Editing this table changes the product with no
-- code change.
--
-- CONFIRMED areas: the original five (Rodney Bay, Castries, Gros Islet,
-- Marigot Bay, Soufrière). The other fifteen complete the requested 20-area
-- list with well-known Saint Lucia localities — PROPOSED (confirmed=false),
-- awaiting Don's sign-off; coordinates are locality centers.

create table service_areas (
  name text primary key,
  lat double precision not null,
  lng double precision not null,
  -- "inside the service area" tolerance around the center
  radius_km numeric not null default 5,
  active boolean not null default true,
  confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

insert into service_areas (name, lat, lng, radius_km, confirmed) values
  ('Rodney Bay',      14.0722, -60.9498, 5, true),
  ('Castries',        14.0101, -60.9875, 5, true),
  ('Gros Islet',      14.0781, -60.9530, 5, true),
  ('Marigot Bay',     13.9664, -61.0242, 5, true),
  ('Soufrière',       13.8560, -61.0565, 5, true),
  ('Cap Estate',      14.0997, -60.9375, 4, false),
  ('Monchy',          14.0567, -60.9236, 4, false),
  ('Vigie',           14.0206, -60.9931, 4, false),
  ('Babonneau',       14.0006, -60.9367, 5, false),
  ('Bexon',           13.9500, -60.9667, 5, false),
  ('Anse La Raye',    13.9469, -61.0378, 4, false),
  ('Canaries',        13.9033, -61.0664, 4, false),
  ('Fond St Jacques', 13.8703, -61.0125, 5, false),
  ('Choiseul',        13.7736, -61.0497, 5, false),
  ('Laborie',         13.7500, -60.9931, 5, false),
  ('Vieux Fort',      13.7167, -60.9490, 6, false),
  ('Micoud',          13.8258, -60.9000, 5, false),
  ('Praslin',         13.8747, -60.8992, 4, false),
  ('Mon Repos',       13.8603, -60.8942, 4, false),
  ('Dennery',         13.9128, -60.8917, 5, false);

-- Anyone may read the list (it renders in the public booking flow).
alter table service_areas enable row level security;
create policy "anyone reads active service areas" on service_areas
  for select using (active);

-- Exact pin position for in-person bookings. meeting_point stays the
-- optional human directions text ("blue gate opposite the fish market").
alter table bookings
  add column meeting_lat double precision,
  add column meeting_lng double precision;

-- Server-side geocode cache: the fixed area list is seeded above, so this
-- exists for anything geocoded later — each unique query hits Google once,
-- ever.
create table geocode_cache (
  query text primary key,
  lat double precision,
  lng double precision,
  formatted text,
  created_at timestamptz not null default now()
);
