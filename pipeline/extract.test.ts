import { readFileSync } from 'node:fs';
import type { FeatureCollection } from 'geojson';
import { describe, expect, it } from 'vitest';
import { extractMap, parseHeight, parseLayer, parseLevels } from './extract';

const fixture = JSON.parse(
  readFileSync(new URL('./__fixtures__/sample.geojson', import.meta.url), 'utf8'),
) as FeatureCollection;

const map = extractMap(fixture);
const byId = <T extends { id: string }>(xs: T[], id: string) => xs.find((x) => x.id === id);

describe('extractMap', () => {
  it('counts every input feature', () => {
    const skippedTotal = Object.values(map.stats.skipped).reduce((a, b) => a + b, 0);
    expect(map.stats.features).toBe(17);
    // Every feature is either kept or skipped. relation/9 yields two buildings from one feature.
    expect(map.roads.length + map.buildings.length - 1 + map.areas.length + skippedTotal).toBe(17);
  });

  it('classifies roads by highway type', () => {
    expect(byId(map.roads, 'way/1')?.cls).toBe('major');
    expect(byId(map.roads, 'way/2')?.cls).toBe('major');
    expect(byId(map.roads, 'way/3')?.cls).toBe('minor');
    expect(byId(map.roads, 'way/4')?.cls).toBe('path');
    expect(byId(map.roads, 'way/5')?.cls).toBe('service');
    expect(byId(map.roads, 'way/1')?.name).toBe('5th Avenue');
  });

  it('reads tags nested under properties.tags (older exports)', () => {
    const r = byId(map.roads, 'way/17');
    expect(r?.cls).toBe('minor');
    expect(r?.name).toBe('Old Style Rd');
  });

  it('projects coordinates so the origin road crossing is at (0, 0)', () => {
    const fifth = byId(map.roads, 'way/1')!;
    expect(fifth.points[1]).toEqual([0, 0]);
    expect(fifth.points[0][1]).toBeLessThan(0); // south end
    expect(fifth.points[2][1]).toBeGreaterThan(0); // north end
  });

  it('drops consecutive duplicate points', () => {
    expect(byId(map.roads, 'way/3')?.points).toHaveLength(2);
  });

  it('drops the repeated closing point of rings', () => {
    const tower = byId(map.buildings, 'way/8')!;
    expect(tower.rings[0]).toHaveLength(4);
  });

  it('parses height and levels', () => {
    const tower = byId(map.buildings, 'way/8')!;
    expect(tower.height).toBe(45);
    expect(tower.levels).toBe(12);
    expect(tower.name).toBe('Test Tower');
  });

  it('splits multipolygons and keeps holes', () => {
    const a = byId(map.buildings, 'relation/9#0')!;
    const b = byId(map.buildings, 'relation/9#1')!;
    expect(a.rings).toHaveLength(2); // outer + hole
    expect(b.rings).toHaveLength(1);
  });

  it('turns pedestrian areas into plazas', () => {
    expect(byId(map.areas, 'way/7')?.kind).toBe('plaza');
  });

  it('extracts parks, water and land use', () => {
    expect(byId(map.areas, 'way/11')?.kind).toBe('park');
    expect(byId(map.areas, 'way/12')?.kind).toBe('water');
    const lu = byId(map.areas, 'way/13');
    expect(lu?.kind).toBe('landuse');
    expect(lu?.landuse).toBe('commercial');
  });

  it('skips junk with a reason instead of crashing', () => {
    expect(map.stats.skipped).toEqual({
      'highway:construction': 1,
      'degenerate-polygon': 1,
      point: 1,
      'degenerate-line': 1,
      'building-not-polygon': 1,
    });
  });

  it('computes bounds that contain every point', () => {
    const { minX, minY, maxX, maxY } = map.bounds;
    const all = [
      ...map.roads.flatMap((r) => r.points),
      ...map.buildings.flatMap((b) => b.rings.flat()),
      ...map.areas.flatMap((a) => a.rings.flat()),
    ];
    for (const [x, y] of all) {
      expect(x).toBeGreaterThanOrEqual(minX);
      expect(x).toBeLessThanOrEqual(maxX);
      expect(y).toBeGreaterThanOrEqual(minY);
      expect(y).toBeLessThanOrEqual(maxY);
    }
  });

  it('handles an empty collection', () => {
    const empty = extractMap({ type: 'FeatureCollection', features: [] });
    expect(empty.roads).toEqual([]);
    expect(empty.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it('rejects input that is not a FeatureCollection', () => {
    expect(() => extractMap({} as FeatureCollection)).toThrow(TypeError);
  });

  it('skips features with non-finite coordinates', () => {
    const bad = extractMap({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { highway: 'primary' },
          geometry: { type: 'LineString', coordinates: [[121.05, NaN], [121.06, 14.55]] },
        },
      ],
    });
    expect(bad.roads).toHaveLength(0);
    expect(bad.stats.skipped['degenerate-line']).toBe(1);
  });
});

describe('extractMap: elevation, widths and junk', () => {
  const line = { type: 'LineString' as const, coordinates: [[121.05, 14.55], [121.051, 14.55]] };
  const poly = {
    type: 'Polygon' as const,
    coordinates: [[[121.05, 14.55], [121.0503, 14.55], [121.0503, 14.5503], [121.05, 14.5503], [121.05, 14.55]]],
  };
  const fc = (features: { id: string; props: Record<string, string>; geometry: typeof line | typeof poly }[]) =>
    extractMap({
      type: 'FeatureCollection',
      features: features.map(({ id, props, geometry }) => ({ type: 'Feature', id, properties: props, geometry })),
    });

  it('keeps bridge, layer and tunnel info on roads', () => {
    const m = fc([
      { id: 'a', props: { highway: 'primary', bridge: 'viaduct', layer: '1' }, geometry: line },
      { id: 'b', props: { highway: 'secondary', tunnel: 'yes', layer: '-1' }, geometry: line },
      { id: 'c', props: { highway: 'residential' }, geometry: line },
    ]);
    expect(byId(m.roads, 'a')).toMatchObject({ bridge: true, layer: 1 });
    expect(byId(m.roads, 'b')).toMatchObject({ tunnel: true, layer: -1 });
    expect(byId(m.roads, 'c')?.bridge).toBeUndefined();
    expect(byId(m.roads, 'c')?.layer).toBeUndefined();
  });

  it('sizes roads from their tags', () => {
    const m = fc([
      { id: 'one', props: { highway: 'primary', oneway: 'yes', lanes: '3' }, geometry: line },
      { id: 'two', props: { highway: 'primary', lanes: '6' }, geometry: line },
    ]);
    expect(byId(m.roads, 'one')!.w).toBeLessThan(byId(m.roads, 'two')!.w);
  });

  it('skips indoor corridors and underground walkways, keeps building passages', () => {
    const m = fc([
      { id: 'corr', props: { highway: 'corridor' }, geometry: line },
      { id: 'mall', props: { highway: 'footway', indoor: 'yes' }, geometry: line },
      { id: 'floor', props: { highway: 'steps', level: '0;1' }, geometry: line },
      { id: 'under', props: { highway: 'footway', tunnel: 'yes', layer: '-1' }, geometry: line },
      { id: 'pass', props: { highway: 'service', tunnel: 'building_passage' }, geometry: line },
    ]);
    expect(m.roads.map((r) => r.id)).toEqual(['pass']);
    expect(m.stats.skipped).toEqual({ indoor: 3, underground: 1 });
  });

  it('floats canopies as thin slabs and drops underground buildings', () => {
    const m = fc([
      { id: 'canopy', props: { building: 'roof', layer: '1' }, geometry: poly },
      { id: 'basement', props: { building: 'commercial', layer: '-1' }, geometry: poly },
      { id: 'bridge', props: { building: 'yes', min_height: '8', height: '12' }, geometry: poly },
      { id: 'raised', props: { building: 'yes', 'building:min_level': '2' }, geometry: poly },
    ]);
    expect(byId(m.buildings, 'canopy')).toMatchObject({ minH: 3.6, h: 4.2 });
    expect(byId(m.buildings, 'basement')).toBeUndefined();
    expect(byId(m.buildings, 'bridge')).toMatchObject({ minH: 8, h: 12 });
    expect(byId(m.buildings, 'raised')).toMatchObject({ minH: 6.4, h: 9.6 });
    expect(m.stats.skipped).toEqual({ 'underground-building': 1 });
  });
});

describe('parseLayer', () => {
  it('parses layers and ignores 0 and junk', () => {
    expect(parseLayer('1')).toBe(1);
    expect(parseLayer('-1')).toBe(-1);
    expect(parseLayer('1;2')).toBe(1);
    expect(parseLayer('0')).toBeUndefined();
    expect(parseLayer('high')).toBeUndefined();
    expect(parseLayer('99')).toBeUndefined();
  });
});

describe('parseHeight', () => {
  it.each([
    ['45', 45],
    ['45 m', 45],
    ['45m', 45],
    ['12.5', 12.5],
    [30, 30],
  ])('parses %j -> %j', (input, expected) => {
    expect(parseHeight(input)).toBe(expected);
  });

  it.each(['', 'tall', '150\'', '-5', '0', null, undefined, NaN])('rejects %j', (input) => {
    expect(parseHeight(input)).toBeUndefined();
  });
});

describe('parseLevels', () => {
  it('parses whole and fractional levels', () => {
    expect(parseLevels('12')).toBe(12);
    expect(parseLevels('3.5')).toBe(3);
    expect(parseLevels(4)).toBe(4);
  });

  it.each(['0', 'many', '', null, -2])('rejects %j', (input) => {
    expect(parseLevels(input)).toBeUndefined();
  });
});
