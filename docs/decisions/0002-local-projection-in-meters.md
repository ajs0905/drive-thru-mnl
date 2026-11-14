# 0002: Equirectangular projection around a local origin

**Status:** Accepted

**Context.** OSM gives latitude and longitude; physics and rendering want meters. Web Mercator distorts distances (about 3% at Manila's latitude) and produces huge coordinates that lose float precision on the GPU.

**Decision.** Project with an equirectangular projection around a fixed origin in BGC (14.5509 N, 121.0503 E): `x = R · Δlon · cos(lat0)`, `y = R · Δlat`.

**Consequences.**
- Coordinates stay small (a few km), so 32-bit floats keep centimeter precision.
- Tested against great-circle distance: worst error under 0.05% and under 1 m across BGC.
- Error grows with distance from the origin. Fine for Metro Manila (tens of km); a much larger world would need multiple origins or a better projection.
