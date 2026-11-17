/**
 * The traffic lights' lamps, lit by the live signals (traffic/signals.ts): on every signal
 * head a disc over each lens, the one lit bright (unlit color, no tone mapping) and the
 * others dark, plus a soft halo on the lit one, seen from the front only. The signals'
 * clock runs here, with the drive (stopped while paused), and the traffic reads the same
 * clock.
 *
 * Where the lenses are comes from how tools/props-to-glb.ts builds the poles: a mast arm
 * (`signal`) has a head near the arm's end and one on the pole, a short pole
 * (`signalpole`) one on top; each head's three lenses face -z (the traffic coming at it).
 * A pole the car has knocked over goes dark.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { CircleGeometry, Color, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { ARMS, DRESSING } from '../geometry/dressing';
import type { GameSession } from '../game/session';
import type { Dressing } from '../map/types';
import type { Lamp, Signals } from '../traffic/signals';
import { haloMaterial } from './carPaint';
import type { ParkedPoses } from './parkedPoses';

/** Dressing stands this high (scene/Dressing.tsx), the lens discs' radius (m), and the halo's size (m) and brightness. */
const LIGHTS = { base: 0.1, lens: 0.095, halo: 0.75, glow: 0.55, refill: 15 };
/** Each lens over its head's origin (m): red on top, amber, green; and how far in front of the head's origin the lenses are. */
const LENS: Record<Lamp, number> = { red: 0.785, amber: 0.5, green: 0.215 };
const LENS_Z = -0.18;
/** Head origins in the pole's model frame (+x along the arm, +y up, -z toward the traffic). */
const HEADS: Record<'signal' | 'signalpole', [number, number, number][]> = {
  signal: [
    [ARMS.signal - 0.45, DRESSING.signal.size[2] - 1.55, 0],
    [0, 2.4, -0.22],
  ],
  signalpole: [[0, DRESSING.signalpole.size[2] - 1.0, -0.12]],
};
const LAMPS: Lamp[] = ['red', 'amber', 'green'];
/** Lit and unlit lens colors (linear, unlit material: over 1 reads as glowing). */
const LIT: Record<Lamp, Color> = { red: new Color(1.6, 0.12, 0.06), amber: new Color(1.6, 0.75, 0.05), green: new Color(0.1, 1.4, 0.55) };
const DARK: Record<Lamp, Color> = { red: new Color(0.09, 0.02, 0.02), amber: new Color(0.1, 0.06, 0.01), green: new Color(0.01, 0.07, 0.04) };
const HALO: Record<Lamp, Color> = { red: new Color(1, 0.12, 0.06), amber: new Color(1, 0.55, 0.05), green: new Color(0.15, 1, 0.5) };

interface Head {
  pole: number;
  /** World position of the head's lenses' middle, its red/amber/green lens positions, and the way it faces (unit, three.js). */
  lenses: [Vector3, Vector3, Vector3];
  facing: Vector3;
  /** The pole's index in the knockable list (-1: not knockable). */
  knock: number;
}

export function SignalLights({ game, pieces, near, paused, knock, knockPoses }: { game: GameSession; pieces: Dressing[]; near: number; paused: boolean; knock?: Dressing[]; knockPoses?: ParkedPoses }) {
  const signals = game.signals;
  const built = useMemo(() => buildLights(signals, pieces, knock), [signals, pieces, knock]);
  useEffect(
    () => () => {
      built.disc.dispose();
      built.discMaterial.dispose();
      built.discs.dispose();
      built.haloGeometry.dispose();
      built.glow.dispose();
      built.halos.dispose();
    },
    [built],
  );

  useFrame(({ camera }, dt) => drawLights(built, signals, camera.position, near, paused ? 0 : Math.min(dt, 0.1), knockPoses));

  return (
    <>
      <primitive object={built.discs} />
      <primitive object={built.halos} />
    </>
  );
}

const m = new Matrix4();
const turn = new Quaternion();
const none = new Quaternion();
const back = new Vector3(0, 0, -1);
const one = new Vector3(1, 1, 1);
const size = new Vector3();
const toCamera = new Vector3();
const glow = new Color();

/** Every head's lens positions and facing, and the instanced discs and halos. */
function buildLights(signals: Signals, pieces: Dressing[], knock?: Dressing[]) {
  const knockOf = new Map<Dressing, number>((knock ?? []).map((d, i) => [d, i]));
  const heads: Head[] = [];
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  signals.poles.forEach((pole, pi) => {
    const d = pieces[pole.piece];
    if (d.k !== 'signal' && d.k !== 'signalpole') return;
    q.setFromAxisAngle(up, d.rot);
    const origin = new Vector3(d.p[0], LIGHTS.base, -d.p[1]);
    for (const [x, y, z] of HEADS[d.k]) {
      const at = (lamp: Lamp) => new Vector3(x, y + LENS[lamp], z + LENS_Z - 0.012).applyQuaternion(q).add(origin);
      heads.push({ pole: pi, lenses: [at('red'), at('amber'), at('green')], facing: new Vector3(0, 0, -1).applyQuaternion(q), knock: knockOf.get(d) ?? -1 });
    }
  });
  const disc = new CircleGeometry(LIGHTS.lens, 10).rotateY(Math.PI);
  const discMaterial = new MeshBasicMaterial({ toneMapped: false });
  const discs = new InstancedMesh(disc, discMaterial, Math.max(1, heads.length * 3));
  discs.count = 0;
  discs.frustumCulled = false;
  discs.setColorAt(0, new Color());
  const haloGeometry = new PlaneGeometry(1, 1);
  const glow = haloMaterial(0.25);
  const halos = new InstancedMesh(haloGeometry, glow, Math.max(1, heads.length));
  halos.count = 0;
  halos.frustumCulled = false;
  halos.renderOrder = 2;
  halos.setColorAt(0, new Color());
  return { heads, disc, discMaterial, discs, haloGeometry, glow, halos, near: [] as number[], at: new Vector3(Infinity, 0, 0), version: -1 };
}

type Built = ReturnType<typeof buildLights>;

/** Advances the signals' clock by `dt` and fills the lens discs and halos of the heads near the camera. */
function drawLights(built: Built, signals: Signals, camera: Vector3, near: number, dt: number, knockPoses?: ParkedPoses) {
  signals.advance(dt);
  // The heads within reach, refilled when the camera has moved a bit or a pole was knocked.
  const version = knockPoses?.version ?? 0;
  if (built.at.distanceTo(camera) > LIGHTS.refill || version !== built.version) {
    built.at.copy(camera);
    built.version = version;
    built.near.length = 0;
    const r2 = (near + LIGHTS.refill) ** 2;
    built.heads.forEach((h, i) => {
      if (h.knock >= 0 && knockPoses?.moved.has(h.knock)) return;
      if (h.lenses[0].distanceToSquared(camera) < r2) built.near.push(i);
    });
  }
  let [n, k] = [0, 0];
  for (const i of built.near) {
    const h = built.heads[i];
    const pole = signals.poles[h.pole];
    const lit = signals.lamp(pole.junction, pole.phase);
    for (let l = 0; l < 3; l++) {
      const lamp = LAMPS[l];
      m.compose(h.lenses[l], turn.setFromUnitVectors(back, h.facing), one);
      built.discs.setMatrixAt(n, m);
      built.discs.setColorAt(n++, lamp === lit ? LIT[lamp] : DARK[lamp]);
    }
    // The halo: brighter the more the head faces the camera.
    const p = h.lenses[LAMPS.indexOf(lit)];
    toCamera.subVectors(camera, p).normalize();
    const facing = Math.max(0, Math.min(1, (toCamera.dot(h.facing) - 0.1) * 1.6));
    if (facing <= 0) continue;
    built.halos.setMatrixAt(k, m.compose(p, none, size.set(LIGHTS.halo, LIGHTS.halo, LIGHTS.halo)));
    built.halos.setColorAt(k++, glow.copy(HALO[lit]).multiplyScalar(LIGHTS.glow * facing));
  }
  built.discs.count = n;
  built.discs.instanceMatrix.needsUpdate = true;
  if (built.discs.instanceColor) built.discs.instanceColor.needsUpdate = true;
  built.halos.count = k;
  built.halos.instanceMatrix.needsUpdate = true;
  if (built.halos.instanceColor) built.halos.instanceColor.needsUpdate = true;
  }
