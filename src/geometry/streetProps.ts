/**
 * Trees and street fixtures (gates, parking booms, bollards, concrete blocks) as props.
 * Sizes are typical real ones; per-tree variation comes from the tree's size factor and
 * a hash of its position, so every build looks the same.
 */
import { idUnit } from '../map/hash';
import type { Fixture, Tree } from '../map/types';
import type { Prop } from './props';

export function treeProps(t: Tree): Prop[] {
  const [x, y] = t.p;
  const s = t.s;
  const tone = idUnit(`${x},${y}`);
  const rot = tone * Math.PI * 2;
  if (t.shape === 'palm') {
    return [
      { kind: 'palmTrunk', x, y, base: 0, size: [0.32 * s, 8 * s, 0.32 * s], rot, tone },
      { kind: 'crown', x, y, base: 7.5 * s, size: [5 * s, 1.4 * s, 5 * s], rot, tone },
    ];
  }
  return [
    { kind: 'trunk', x, y, base: 0, size: [0.4 * s, 3.2 * s, 0.4 * s], rot, tone },
    { kind: 'canopy', x, y, base: 2.3 * s, size: [5.2 * s, 4.2 * s, 5.2 * s], rot, tone },
  ];
}

export function fixtureProps(f: Fixture): Prop[] {
  const [x, y] = f.p;
  const tone = idUnit(`${f.kind}${x},${y}`);
  const ux = Math.cos(f.rot);
  const uy = Math.sin(f.rot);
  const at = (d: number): [number, number] => [x + ux * d, y + uy * d];
  const span = f.span ?? 0;
  switch (f.kind) {
    case 'gate': {
      // Two gate pillars either side of the opening; the gate itself stands open.
      const [ax, ay] = at(-(span / 2 + 0.25));
      const [bx, by] = at(span / 2 + 0.25);
      return [
        { kind: 'pillar', x: ax, y: ay, base: 0, size: [0.5, 2.4, 0.5], rot: f.rot, tone },
        { kind: 'pillar', x: bx, y: by, base: 0, size: [0.5, 2.4, 0.5], rot: f.rot, tone },
      ];
    }
    case 'boom': {
      // Post on one side, arm down across the lane (parking entrances).
      const [px, py] = at(-(span / 2 + 0.3));
      const [cx, cy] = at(-0.15);
      return [
        { kind: 'post', x: px, y: py, base: 0, size: [0.35, 1.1, 0.35], rot: f.rot, tone },
        { kind: 'boom', x: cx, y: cy, base: 0.9, size: [span + 0.3, 0.1, 0.1], rot: f.rot, tone },
      ];
    }
    case 'bollard':
      return [{ kind: 'bollard', x, y, base: 0, size: [0.22, 0.9, 0.22], rot: 0, tone }];
    case 'block':
      return [{ kind: 'block', x, y, base: 0, size: [1.5, 0.8, 0.6], rot: f.rot, tone }];
  }
}
