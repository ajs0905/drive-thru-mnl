/*
  Drive Thru MNL: BGC export.
  Paste into https://overpass-turbo.eu, click Run, then Export > GeoJSON > download,
  and save it as data/raw/bgc.geojson.
  Box (south, west, north, east) covers BGC from Kalayaan Ave down to McKinley Hill, Lawton to C-5.
*/
[out:json][timeout:90][bbox:14.5370,121.0370,14.5650,121.0640];
(
  way["highway"];
  way["building"];
  relation["building"];
  way["landuse"];
  relation["landuse"];
  way["leisure"~"^(park|garden)$"];
  relation["leisure"~"^(park|garden)$"];
  way["natural"="water"];
  relation["natural"="water"];
);
out body;
>;
out skel qt;
