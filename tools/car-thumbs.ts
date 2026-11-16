/**
 * Car pictures for the CARS tab: each car's model drawn from the front quarter into a small
 * PNG, so the menu shows a picture without a second WebGL canvas (`npm run thumbs`).
 *
 * A tiny software renderer: the binary glTF files our model tools write (non-indexed
 * triangles with vertex colors, positions already placed), or a car straight from the
 * vehicle pack's FBX for cars whose model isn't in the game yet. Flat Lambert shading with
 * the game's sun direction, the same sky reflections as in the game (scene/carShine.ts:
 * clear coat on the paint, sky in the glass, bright rims), a soft ground shadow with a
 * darker contact patch under each tire, drawn at 3x and filtered down. Same output every run.
 *
 *   npx tsx tools/car-thumbs.ts ["<vehicle pack folder>"]
 *
 * Without the pack folder, the pack's cars keep the pictures already in public/models/cars.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Color, type Mesh } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { CAR_SHINE } from '../src/scene/carShine';
import { SKY } from '../src/scene/skyConfig';
import { bake, SCALE } from './car-to-glb';
import { writePng } from './png';

type V3 = [number, number, number];

interface Source {
  /** A binary glTF and a node in it, or a car in the vehicle pack (path inside the pack folder). */
  file?: string;
  node?: string;
  fbx?: string;
  paint?: V3;
  place?: Record<string, V3>;
}

/** Which model each car in the CARS tab uses. */
const MODELS: Record<string, Source> = {
  // The player's sedan: the wheels are modeled at the origin and placed by the game (car/spec.ts
  // SEDAN: track 0.873, axle 1.368, wheel centers 0.165 below the body's origin), and the
  // body's origin sits 0.51 m above the road.
  sedan: {
    file: 'public/models/sedan.glb',
    node: 'car',
    place: {
      body: [0, 0.51, 0],
      wheelFL: [0.873, 0.345, 1.368],
      wheelFR: [-0.873, 0.345, 1.368],
      wheelRL: [0.873, 0.345, -1.368],
      wheelRR: [-0.873, 0.345, -1.368],
    },
  },
  // The cargo van is the vehicle pack's van, the same one parked around the city, in white.
  van: { file: 'public/models/parked-cars.glb', node: 'van', paint: [0.9, 0.9, 0.88] },
  // Not drivable yet: drawn straight from the pack (its own paint colors).
  muscle: { fbx: 'Muscle/Muscle.fbx' },
  coupe: { fbx: 'Sports/Sports.fbx' },
};

const [W, H, SS] = [320, 160, 3];
/** View from the front-left quarter, a little above. */
const [YAW, PITCH] = [(38 * Math.PI) / 180, (16 * Math.PI) / 180];
const SUN = norm([0.45, 0.8, 0.55]);
const [AMBIENT, DIFFUSE] = [0.52, 0.62];

function norm(v: V3): V3 {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
}
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

interface Tri {
  p: [V3, V3, V3];
  color: V3;
  /** How it reflects the sky (tools/car-to-glb.ts `shineOf`): 0 matte, 1 paint, 2 glass, 3 metal. */
  shine: number;
}

/** A car from the vehicle pack's FBX: each part baked like tools/car-to-glb.ts does (meters, colors, shine), placed where the pack has it. */
function readFbx(file: string): Tri[] {
  const buf = readFileSync(file);
  const fbx = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  fbx.updateMatrixWorld(true);
  const tris: Tri[] = [];
  fbx.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const at = mesh.getWorldPosition(mesh.position.clone()).multiplyScalar(SCALE);
    for (const g of Object.values(bake(mesh))) {
      const [pos, col, shine] = [g.getAttribute('position'), g.getAttribute('color'), g.getAttribute('shine')];
      for (let v = 0; v < pos.count; v += 3) {
        const p = [0, 1, 2].map((k) => [pos.getX(v + k) + at.x, pos.getY(v + k) + at.y, pos.getZ(v + k) + at.z] as V3) as [V3, V3, V3];
        tris.push({ p, color: [col.getX(v), col.getY(v), col.getZ(v)], shine: shine.getX(v) });
      }
    }
  });
  return tris;
}

/** The triangles under one node of a binary glTF (meshes of it and its children). */
function readTriangles(file: string, nodeName: string, paint?: V3, place: Record<string, V3> = {}): Tri[] {
  const buf = readFileSync(file);
  const jsonLength = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  const binStart = 20 + jsonLength + 8;
  const bin = buf.subarray(binStart);
  const read = (index: number | undefined, size: number): Float32Array | null => {
    if (index === undefined) return null;
    const acc = gltf.accessors[index];
    const view = gltf.bufferViews[acc.bufferView];
    const offset = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const copy = new Float32Array(acc.count * size);
    for (let i = 0; i < copy.length; i++) copy[i] = bin.readFloatLE(offset + i * 4);
    return copy;
  };
  const tris: Tri[] = [];
  const walk = (n: number, at: V3) => {
    const node = gltf.nodes[n];
    const move = place[node.name];
    if (move) at = [at[0] + move[0], at[1] + move[1], at[2] + move[2]];
    if (node.mesh !== undefined)
      for (const prim of gltf.meshes[node.mesh].primitives) {
        const pos = read(prim.attributes.POSITION, 3)!;
        const col = read(prim.attributes.COLOR_0, 3);
        const pnt = read(prim.attributes._PAINT, 1);
        const shn = read(prim.attributes._SHINE, 1);
        for (let v = 0; v < pos.length / 3; v += 3) {
          const p = [0, 1, 2].map((k) => [pos[(v + k) * 3] + at[0], pos[(v + k) * 3 + 1] + at[1], pos[(v + k) * 3 + 2] + at[2]] as V3) as [V3, V3, V3];
          let color: V3 = col ? [col[v * 3], col[v * 3 + 1], col[v * 3 + 2]] : [0.7, 0.7, 0.7];
          if (paint && pnt && pnt[v] > 0.5) color = paint;
          tris.push({ p, color, shine: shn ? shn[v] : 0 });
        }
      }
    for (const c of node.children ?? []) walk(c, at);
  };
  const root = gltf.nodes.findIndex((n: { name?: string }) => n.name === nodeName);
  if (root < 0) throw new Error(`${file}: no node ${nodeName}`);
  walk(root, [0, 0, 0]);
  return tris;
}

const linear = (hex: string): V3 => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};
const SUN_COLOR = linear(SKY.sun);
const [HORIZON, ZENITH, GROUND] = [linear(SKY.horizon), linear(CAR_SHINE.zenith), linear(CAR_SHINE.ground)];
const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** A face's color: Lambert, then the game's sky reflection and sun glint for shiny parts (scene/carShine.ts). */
function faceColor(t: Tri, n: V3, toCam: V3): V3 {
  const light = AMBIENT + DIFFUSE * Math.max(0, dot(n, SUN));
  let c: V3 = [t.color[0] * light, t.color[1] * light, t.color[2] * light];
  if (t.shine < 0.5) return c;
  const k = t.shine < 1.5 ? CAR_SHINE.paint : t.shine < 2.5 ? CAR_SHINE.glass : CAR_SHINE.metal;
  const nv = Math.max(0, dot(n, toCam));
  const r: V3 = [2 * nv * n[0] - toCam[0], 2 * nv * n[1] - toCam[1], 2 * nv * n[2] - toCam[2]];
  const sky = r[1] > 0 ? mix(HORIZON, ZENITH, r[1] ** 0.6) : mix(HORIZON, GROUND, Math.min(1, -r[1] * 5));
  const fresnel = (1 - nv) ** 4;
  // Less of the sky than in the game, and a softer glint: a picture on a card has no street around it to reflect.
  c = mix(c, sky, 0.55 * Math.min(1, k.base + k.grazing * fresnel));
  const glint = Math.max(0, dot(r, SUN)) ** (k.sharpness / 4) * k.glint * 0.6;
  return [c[0] + SUN_COLOR[0] * glint, c[1] + SUN_COLOR[1] * glint, c[2] + SUN_COLOR[2] * glint];
}

/** glTF vertex colors are linear; the PNG is sRGB. */
const toSrgb = (c: number) => Math.round(255 * Math.min(1, c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));

export function render(tris: Tri[]): { width: number; height: number; data: Uint8Array } {
  const toCam: V3 = [Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH)];
  const right = norm(cross([0, 1, 0], toCam));
  const up = cross(toCam, right);
  const project = (p: V3): V3 => [dot(p, right), dot(p, up), dot(p, toCam)];

  // The shadow: the car's footprint on the ground, a little larger.
  let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const t of tris)
    for (const p of t.p) {
      [x0, x1, z0, z1] = [Math.min(x0, p[0]), Math.max(x1, p[0]), Math.min(z0, p[2]), Math.max(z1, p[2])];
    }
  const grow = 0.25;
  const shadow: V3[] = [
    [x0 - grow, 0, z0 - grow],
    [x1 + grow, 0, z0 - grow],
    [x1 + grow, 0, z1 + grow],
    [x0 - grow, 0, z1 + grow],
  ];

  // Fit everything into the picture with a margin.
  const all = [...tris.flatMap((t) => t.p), ...shadow].map(project);
  const [minX, maxX] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
  const [minY, maxY] = [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
  const [w, h] = [W * SS, H * SS];
  const margin = 0.06;
  const scale = Math.min((w * (1 - 2 * margin)) / (maxX - minX), (h * (1 - 2 * margin)) / (maxY - minY));
  const [cx, cy] = [(minX + maxX) / 2, (minY + maxY) / 2];
  const screen = (p: V3): V3 => [w / 2 + (p[0] - cx) * scale, h / 2 - (p[1] - cy) * scale, p[2]];

  const rgb = new Float32Array(w * h * 3);
  const alpha = new Float32Array(w * h);
  const depth = new Float32Array(w * h).fill(-Infinity);

  const fill = (a: V3, b: V3, c: V3, each: (i: number, z: number) => void) => {
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) return;
    const [lx, hx] = [Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])))];
    const [ly, hy] = [Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])))];
    for (let y = ly; y <= hy; y++)
      for (let x = lx; x <= hx; x++) {
        const [px, py] = [x + 0.5, y + 0.5];
        const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
        const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        each(y * w + x, w0 * a[2] + w1 * b[2] + w2 * c[2]);
      }
  };

  // Shadow first, softened with a few box blurs, then the car on top.
  const s = shadow.map((p) => screen(project(p)));
  const shade = new Float32Array(w * h);
  for (const [a, b, c] of [
    [s[0], s[1], s[2]],
    [s[0], s[2], s[3]],
  ])
    fill(a, b, c, (i) => (shade[i] = 0.36));
  // Contact patches: a darker spot under each tire, so the car sits on the ground.
  const touching = new Set<string>();
  for (const t of tris)
    for (const p of t.p) {
      if (p[1] > 0.05) continue;
      // One spot per few centimeters of tread.
      const key = `${Math.round(p[0] * 10)},${Math.round(p[2] * 10)}`;
      if (touching.has(key)) continue;
      touching.add(key);
      const q = screen(project([p[0], 0, p[2]]));
      const r = 5 * SS;
      for (let y = Math.max(0, Math.floor(q[1] - r)); y <= Math.min(h - 1, Math.ceil(q[1] + r)); y++)
        for (let x = Math.max(0, Math.floor(q[0] - 2 * r)); x <= Math.min(w - 1, Math.ceil(q[0] + 2 * r)); x++) if (((x - q[0]) / 2) ** 2 + (y - q[1]) ** 2 < r * r) shade[y * w + x] = 0.75;
    }
  const blur = (src: Float32Array, r: number, horizontal: boolean) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) {
          const [xx, yy] = horizontal ? [x + k, y] : [x, y + k];
          if (xx >= 0 && xx < w && yy >= 0 && yy < h) sum += src[yy * w + xx];
        }
        out[y * w + x] = sum / (2 * r + 1);
      }
    return out;
  };
  let soft = shade;
  for (let k = 0; k < 2; k++) soft = blur(blur(soft, 4 * SS, true), 4 * SS, false);
  for (let i = 0; i < w * h; i++) alpha[i] = soft[i];

  for (const t of tris) {
    const n = norm(cross([t.p[1][0] - t.p[0][0], t.p[1][1] - t.p[0][1], t.p[1][2] - t.p[0][2]], [t.p[2][0] - t.p[0][0], t.p[2][1] - t.p[0][1], t.p[2][2] - t.p[0][2]]));
    // Both sides drawn (some model faces are single-sided the other way); light the side we see.
    const facing = dot(n, toCam) < 0 ? ([-n[0], -n[1], -n[2]] as V3) : n;
    const color = faceColor(t, facing, toCam);
    const [a, b, c] = t.p.map((p) => screen(project(p)));
    fill(a, b, c, (i, z) => {
      if (z <= depth[i]) return;
      depth[i] = z;
      rgb.set(color, i * 3);
      alpha[i] = 1;
    });
  }

  // Down to the picture size: average the samples, colors weighted by coverage.
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let [r, g, b, a, solid] = [0, 0, 0, 0, 0];
      for (let j = 0; j < SS; j++)
        for (let i = 0; i < SS; i++) {
          const k = (y * SS + j) * w + x * SS + i;
          a += alpha[k];
          if (depth[k] > -Infinity) {
            r += rgb[k * 3];
            g += rgb[k * 3 + 1];
            b += rgb[k * 3 + 2];
            solid++;
          }
        }
      const n = SS * SS;
      const cover = solid / n;
      // Shadow pixels are black at their alpha; car pixels keep their color.
      data.set([solid ? toSrgb(r / solid) : 0, solid ? toSrgb(g / solid) : 0, solid ? toSrgb(b / solid) : 0, Math.round(255 * Math.min(1, cover + (a / n - cover)))], (y * W + x) * 4);
    }
  return { width: W, height: H, data };
}

if (process.argv[1]?.endsWith('car-thumbs.ts')) {
  mkdirSync('public/models/cars', { recursive: true });
  const pack = process.argv[2];
  for (const [id, m] of Object.entries(MODELS)) {
    if (m.fbx && !(pack && existsSync(join(pack, m.fbx)))) {
      console.log(`${id}: kept (give the vehicle pack folder to redraw it)`);
      continue;
    }
    const png = writePng(render(m.fbx ? readFbx(join(pack!, m.fbx)) : readTriangles(m.file!, m.node!, m.paint, m.place)));
    writeFileSync(`public/models/cars/${id}.png`, png);
    console.log(`public/models/cars/${id}.png: ${(png.length / 1024).toFixed(1)} KB`);
  }
}
