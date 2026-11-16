import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEBRIS, propLists, PROP_PHYSICS } from '../geometry/dressing';
import type { Dressing, DressingKind } from '../map/types';
import { BREAK, Breakaways, DebrisStore } from './breakaway';
import { ParkedPoses } from './parkedPoses';
import { ParkedPool } from './parkedPool';
import { createPropBody, PROP_POOL, PROP_Y, propItem, type PropItem } from './propBodies';

beforeAll(async () => {
  await RAPIER.init();
});

const DT = 1 / 60;
function world() {
  const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  w.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, PROP_Y - 0.5, 0));
  return w;
}
const piece = (k: DressingKind, x = 0, y = 0, rot = 0): Dressing => ({ k, p: [x, y], rot });

describe('knockable props', () => {
  it('stand still, upright and asleep on their spot, turned like the model', () => {
    for (const k of ['planter', 'bin', 'hydrant', 'bench', 'lamp', 'streetlight', 'signal', 'signalpole'] as const) {
      const w = world();
      const b = createPropBody(RAPIER, w, propItem(piece(k, 0, 0, 0.7)), PROP_Y);
      for (let i = 0; i < 60; i++) w.step();
      expect(b.translation().y, k).toBeCloseTo(PROP_Y, 1);
      // Turned by the piece's rot about the vertical, as the renderer turns the model.
      expect(2 * Math.atan2(b.rotation().y, b.rotation().w), k).toBeCloseTo(0.7, 2);
      expect(b.isSleeping(), k).toBe(true);
    }
  });

  it('tip over when the car hits them: a street light falls', () => {
    const w = world();
    const b = createPropBody(RAPIER, w, propItem(piece('streetlight')), PROP_Y);
    // A 1,200 kg car at 15 m/s.
    const car = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(-4, PROP_Y + 0.7, 0).setLinvel(15, 0, 0));
    w.createCollider(RAPIER.ColliderDesc.cuboid(2.2, 0.5, 1).setMass(1200), car);
    for (let i = 0; i < 120; i++) w.step();
    const r = b.rotation();
    const up = 1 - 2 * (r.x * r.x + r.z * r.z); // the pole's up axis, vertical part
    expect(up).toBeLessThan(0.5);
  });

  it('pool at most PROP_POOL.max bodies, nearest first, and put knocked ones back to sleep after resting', () => {
    const w = world();
    const items: PropItem[] = Array.from({ length: 60 }, (_, i) => propItem(piece('bin', (i % 10) * 3, Math.floor(i / 10) * 3)));
    const poses = new ParkedPoses();
    const pool = new ParkedPool<PropItem>(RAPIER, w, items, poses, PROP_Y, [-500, -500], PROP_POOL);
    const run = (s: number) => {
      for (let i = 0; i < Math.round(s / DT); i++) {
        w.step();
        pool.update([0, 0], DT, () => true);
      }
    };
    run(0.3);
    expect(pool.bodies.size).toBe(PROP_POOL.max);
    // The ones farthest from the player are the ones left out.
    const far = Math.max(...[...pool.bodies.keys()].map((i) => Math.hypot(...items[i].p)));
    const out = items.map((it, i) => (pool.bodies.has(i) ? Infinity : Math.hypot(...it.p)));
    expect(Math.min(...out)).toBeGreaterThanOrEqual(far - 1e-9);
    const b = pool.bodies.get(0)!;
    b.applyImpulse({ x: 40, y: 0, z: 0 }, true);
    run(0.5);
    expect(poses.moved.has(0)).toBe(true);
    run(PROP_POOL.restSleep! + 2);
    expect(b.isSleeping()).toBe(true);
  });

  it('are what collision.ts leaves to the pools: every solid street piece but the pavilion', () => {
    expect(PROP_PHYSICS.pavilion).toBeUndefined();
    const lists = propLists([piece('bin'), piece('shed', 10), piece('pavilion', 20), piece('container', 30)]);
    expect(lists.knock.map((d) => d.k)).toEqual(['bin']);
    expect(lists.broke.map((d) => d.k)).toEqual(['shed']);
  });
});

describe('Breakaways', () => {
  function setup(pieces: Dressing[]) {
    const w = world();
    const poses = new ParkedPoses();
    const store = new DebrisStore();
    const breaks = new Breakaways(RAPIER, w, pieces, poses, store, PROP_Y);
    return { w, poses, store, breaks };
  }
  const v = (x: number) => ({ x, y: 0, z: 0 });

  it('stands fixed near the player, and stays whole when bumped slowly', () => {
    const { breaks, poses } = setup([piece('shed', 10, 0)]);
    breaks.update([0, 0], DT, () => true);
    expect(breaks.fixed.size).toBe(1);
    breaks.beforeStep({ p: [7.2, 0], v: v(3), heading: 0 }, DT);
    expect(breaks.broken.size).toBe(0);
    expect(poses.moved.size).toBe(0);
  });

  it('comes apart when the car is about to hit it fast: the body goes, its debris flies on with the car', () => {
    const { w, breaks, poses, store } = setup([piece('shed', 10, 0)]);
    breaks.update([0, 0], DT, () => true);
    breaks.beforeStep({ p: [7.2, 0], v: v(15), heading: 0 }, DT);
    expect(breaks.broken.has(0)).toBe(true);
    expect(breaks.fixed.size).toBe(0);
    expect(poses.moved.get(0)!.y).toBeLessThan(-50);
    expect(breaks.debris).toHaveLength(DEBRIS.shed!.length);
    expect(store.parts).toHaveLength(DEBRIS.shed!.length);
    for (const d of breaks.debris) expect(d.body.linvel().x).toBeGreaterThan(5);
    for (let i = 0; i < 30; i++) {
      w.step();
      breaks.update([0, 0], DT, () => true);
    }
    expect(store.parts.every((p) => p.pose.x > 10)).toBe(true);
  });

  it('keeps the debris within its budget, asleep once still, gone once out of sight; the piece comes back once the player is far', () => {
    const sheds = Array.from({ length: 10 }, (_, i) => piece('shed', i * 8, 0));
    const { w, breaks, poses } = setup(sheds);
    breaks.update([0, 0], DT, () => true);
    for (let i = 0; i < sheds.length; i++) breaks.breakApart(i, v(10));
    expect(breaks.debris.length).toBeLessThanOrEqual(BREAK.debris);
    for (let i = 0; i < Math.round((BREAK.rest + 3) / DT); i++) {
      w.step();
      breaks.update([0, 0], DT, () => true);
    }
    expect(breaks.debris.every((d) => d.body.isSleeping())).toBe(true);
    // Far away and nothing on screen: debris cleared, sheds whole again.
    for (let i = 0; i < Math.round((BREAK.keep + 1) / DT); i++) breaks.update([500, 500], DT, () => false);
    expect(breaks.debris).toHaveLength(0);
    expect(breaks.broken.size).toBe(0);
    expect(poses.moved.size).toBe(0);
  });
});
