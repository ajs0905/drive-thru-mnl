import { describe, expect, it } from 'vitest';
import { LANE_WIDTH, parseLanes, parseMaxspeed, parseWidth, roadWidth } from './roadWidth';

describe('roadWidth', () => {
  it('uses the width tag first', () => {
    expect(roadWidth('primary', 'major', { width: '12', lanes: '6' })).toBe(12);
  });

  it('uses lanes when there is no width', () => {
    expect(roadWidth('secondary', 'major', { lanes: '3', oneway: 'yes' })).toBeCloseTo(3 * LANE_WIDTH + 0.6, 9);
    expect(roadWidth('residential', 'minor', { lanes: '2' })).toBeCloseTo(2 * LANE_WIDTH + 1, 9);
  });

  it('makes a one-way carriageway narrower than a two-way road of the same type', () => {
    expect(roadWidth('primary', 'major', { oneway: 'yes' })).toBeLessThan(roadWidth('primary', 'major', {}));
    expect(roadWidth('residential', 'minor', { oneway: 'yes' })).toBeLessThan(roadWidth('residential', 'minor', {}));
  });

  it('treats roundabouts as one-way', () => {
    expect(roadWidth('tertiary', 'minor', { junction: 'roundabout' })).toBe(roadWidth('tertiary', 'minor', { oneway: 'yes' }));
  });

  it('keeps driveways, alleys and parking aisles narrow', () => {
    expect(roadWidth('service', 'service', { service: 'driveway' })).toBe(3.5);
    expect(roadWidth('service', 'service', { service: 'alley' })).toBe(3);
    expect(roadWidth('service', 'service', {})).toBe(5);
  });

  it('gives links one lane by default', () => {
    expect(roadWidth('primary_link', 'major', { oneway: 'yes' })).toBeCloseTo(LANE_WIDTH + 0.8, 9);
  });

  it('sizes paths by type', () => {
    expect(roadWidth('footway', 'path', {})).toBe(2);
    expect(roadWidth('pedestrian', 'path', {})).toBe(4);
    expect(roadWidth('weird_path', 'path', {})).toBe(2);
  });

  it('never returns a silly width', () => {
    for (const hw of ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'made_up']) {
      for (const oneway of ['yes', 'no']) {
        const w = roadWidth(hw, hw === 'service' ? 'service' : 'minor', { oneway });
        expect(w).toBeGreaterThanOrEqual(3);
        expect(w).toBeLessThanOrEqual(16);
      }
    }
  });
});

describe('parseWidth', () => {
  it.each([['7', 7], ['7.5 m', 7.5], ['10m', 10], [6, 6]])('parses %j', (v, w) => expect(parseWidth(v)).toBe(w));
  it.each(['', 'wide', "20'", '0', '500', null])('rejects %j', (v) => expect(parseWidth(v)).toBeUndefined());
});

describe('parseLanes', () => {
  it('parses plain and multi-value tags', () => {
    expect(parseLanes('3')).toBe(3);
    expect(parseLanes('2;3')).toBe(2);
    expect(parseLanes(4)).toBe(4);
  });
  it.each(['', 'many', '0', '40', null])('rejects %j', (v) => expect(parseLanes(v)).toBeUndefined());
});

describe('parseMaxspeed', () => {
  it('reads km/h, converts mph and ignores the rest', () => {
    expect(parseMaxspeed('40')).toBe(40);
    expect(parseMaxspeed('60 km/h')).toBe(60);
    expect(parseMaxspeed('30 mph')).toBe(48);
    expect(parseMaxspeed('signals')).toBeUndefined();
    expect(parseMaxspeed(undefined)).toBeUndefined();
  });
});
