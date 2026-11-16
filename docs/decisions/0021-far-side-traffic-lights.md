# 0021. Traffic lights on the far side of the intersection

**Status:** Accepted, 2026-11-16

## Context

The first traffic lights (D1) stood at each approach's stop line, on the right-hand curb, with the arm over the approach lanes. On Metro Manila's avenues the lights a driver watches stand across the intersection: a car stopped at the line looks ahead at a pole on the far corner, not up at one right beside its bumper. The near-side placement also put a second pole on the corner each approach was leaving, so corners looked doubled up before the one-per-corner rule thinned them.

Two things in the map data make "the far side" harder than it sounds. A divided avenue crossing another road is one junction polygon per carriageway, joined by short links across the medians, so "past the junction" lands in the median. And roads are often split a few meters past a junction (for a crossing node or a change of tags), so the road straight ahead can be too short to stand a pole on.

## Decision

`pipeline/lights.ts` places every traffic light on the far side:

- **Intersections, not junctions.** Signalized junctions and the junctions joined to them by a road with less than 25 m between the polygons are grouped into one intersection. Roads inside the group (the median links) get no lights; every road arriving from outside gets one.
- **Straight through.** From the approach, take at each junction the road leaving within 35 degrees of the traffic's direction (one-way roads only where they leave), across median links, until a road leaves the intersection. The light stands on that road's right-hand curb (traffic keeps right), 1.2 m past the junction polygon or 1 m past a zebra crossing there, the arm reaching over the lanes the traffic is heading into, heads facing back at it. If that road is a short piece, the search carries on into the road it joins.
- **No road straight ahead** (the stem of a T) **or no room on it:** a short pole on the far curb across the junction, in line with the approach's right-hand curb, starting from the junction's far edge. There are no lanes there for a mast arm to hang over.
- Poles keep the existing rules (one within 9 m, clear of crossings, drawn furniture, parked cars and anything overhead) plus two new ones: not on a junction's paving, and heads facing along a road beside them or the one they look back at across a junction. The facing test (`headsAlongRoad`) is shared with map QA.
- Mid-block signals get one light per direction just past the crossing.
- A new map QA kind, `signal-near-side`, finds a light with a junction or zebra crossing right behind it and nothing to control in front of its heads. The old placement scores 104 on it; the new one 0.

## Consequences

- 162 traffic lights at 49 intersections (130 mast arms, 32 short poles, 18 of those on the far curb across a junction), down from 167. 9 approaches find no room (6 in another road, 2 outside the playable area, 1 on a corner already taken).
- One light per approach: no second head on the near side and no head on the far-left corner, both common on real avenues. A second head per approach would double the poles; the far-right one is the one a driver in the right-hand lanes looks at.
- Short poles on the far curb of a T face back across the junction from a curb that runs crosswise, which is right for the approaching traffic but reads less obviously than a mast arm.
- The `signal-near-side` check can't tell a near-side light on a very short block (where the previous junction is also in front of its heads) from a far-side one: it's a regression gate for this placement, not a full proof.
