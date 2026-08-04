-- Service area, corrected model (Don, 2026-08-04):
--
-- 1. The service area is ONE polygon covering the island's entire northern
--    region (coastline + a southern boundary below Ciceron). It is the
--    authoritative inside/outside check for meeting points — replaces the
--    radius-around-each-point approach entirely. Stored in app_config so
--    the boundary can be corrected without a code change; the app renders
--    it for review. DRAFT BOUNDARY pending Don's correction (confirmed
--    stays false until signed off).
--
-- 2. service_areas becomes the 19 FINAL highlighted locations (exact
--    coordinates supplied by Don — nothing geocoded, nothing added).
--    They are visual highlights + snap labels only; validity of a meeting
--    point depends solely on the polygon.

delete from service_areas;

insert into service_areas (name, lat, lng, confirmed) values
  ('Cap Estate',           14.097186074877438, -60.940764449273566, true),
  ('Cas en Bas',           14.089693829162256, -60.930636427993790, true),
  ('Gros Islet',           14.084199359342136, -60.947459243000900, true),
  ('Rodney Bay',           14.067215617042590, -60.947630904378514, true),
  ('Monchy',               14.049564508897042, -60.931151412126660, true),
  ('Mongiraud',            14.037241230427039, -60.948832534021875, true),
  ('La Clery',             14.019421264112948, -60.980246566126970, true),
  ('Vigie',                14.018755070302479, -60.995867751490714, true),
  ('Balata',               14.016923027351767, -60.951579116063854, true),
  ('Babonneau',            14.010427484517816, -60.942309401672180, true),
  ('Garrand',              14.013258897579771, -60.920851729469256, true),
  ('Castries',             14.010927148183564, -60.989344619141020, true),
  ('Ciceron',              13.993105138838141, -61.008914016190090, true),
  ('Grande Riviere',       14.039414596118403, -60.952947590395866, true),
  ('Bisee',                14.024123357383369, -60.975365704015815, true),
  ('Bonneterre',           14.064540203389860, -60.942292455846570, true),
  ('Beausejour Phase 1&2', 14.075964057045471, -60.937691331900490, true),
  ('Pigeon Island',        14.092367360368574, -60.964747717840034, true),
  ('Cap Marquis',          14.051773268392779, -60.888090262733535, true);

-- Draft northern-region boundary, [lat, lng] pairs, clockwise from the
-- west-coast point below Ciceron. Coastline is approximate on purpose —
-- Don reviews it on the rendered map and corrections are an UPDATE here,
-- no code change.
insert into app_config (key, value, description, confirmed) values
  ('service_area_polygon',
   '[[13.9840,-61.0080],[13.9930,-61.0135],[14.0080,-61.0060],[14.0125,-61.0025],
     [14.0185,-61.0035],[14.0260,-60.9930],[14.0430,-60.9770],[14.0580,-60.9680],
     [14.0700,-60.9630],[14.0800,-60.9640],[14.0900,-60.9700],[14.0960,-60.9700],
     [14.1030,-60.9600],[14.1100,-60.9500],[14.1130,-60.9400],[14.1060,-60.9280],
     [14.0950,-60.9200],[14.0870,-60.9180],[14.0760,-60.9100],[14.0620,-60.8950],
     [14.0530,-60.8830],[14.0400,-60.8850],[14.0150,-60.9000],[13.9980,-60.9300],
     [13.9850,-60.9650],[13.9800,-60.9950]]',
   'Authoritative service-area boundary (northern region). [lat,lng] vertices. DRAFT pending boundary review.',
   false)
on conflict (key) do update set value = excluded.value, description = excluded.description;
