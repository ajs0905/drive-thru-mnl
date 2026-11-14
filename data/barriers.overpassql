/*
  Drive Thru MNL: BGC barriers, trees and street furniture.
  Paste into https://overpass-turbo.eu, click Run, then Export > GeoJSON > download,
  and save it as data/raw/bgc-barriers.geojson.
  Same box as data/bgc.overpassql. Kept as a separate export so the main one stays unchanged.
*/
[out:json][timeout:90][bbox:14.5370,121.0370,14.5650,121.0640];
(
  way["barrier"];
  node["barrier"];
  node["natural"="tree"];
  way["natural"="tree_row"];
  node["highway"~"^(street_lamp|traffic_signals)$"];
);
out body;
>;
out skel qt;
