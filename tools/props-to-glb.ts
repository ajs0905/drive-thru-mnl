/**
 * Builds the street and lot dressing models (src/geometry/dressing.ts) into one small GLB:
 *
 *   npx tsx tools/props-to-glb.ts "<City Kit Roads>/Models/GLB format" "<City Kit Suburban>/Models/GLB format" \
 *     "<City Kit Commercial>/Models/GLB format" public/models/props.glb
 *
 * - One mesh per dressing kind, named after it, sized to DRESSING[kind].size: length along
 *   +X, width along Z, height up, origin on the ground under the middle (poles: under the
 *   pole, the arm out along +X). Vertex colors, flat shaded, no textures.
 * - From Kenney's City Kits (CC0, www.kenney.nl), with the palette texture baked into vertex
 *   colors as in tools/kenney-to-ts.ts: the dumpster, work light and traffic light heads
 *   (Roads), the planter (Suburban), the awning on the kiosk (Commercial).
 * - Built here from boxes, cylinders and pyramids: everything the kits don't have
 *   (containers, the tower crane, dirt mounds, pipes, crates, benches, the pavilion, the
 *   guard booth, stall lines, wheel stops, the waiting shed, the kiosk, hydrants, bins),
 *   and the lamp posts and traffic light poles (the kit's, scaled to real heights, came out
 *   far too thick).
 *   Container bodies are near white: the game paints each one with its instance color.
 *
 * Runs once by hand when a model changes; the raw packs aren't in the repo.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { ARMS, DRESSING } from '../src/geometry/dressing';
import type { DressingKind } from '../src/map/types';
import { polyfillFileReader } from './car-to-glb';
import { fit, readGlb, srgbToLinear, type Baked } from './kenney-to-ts';
import { readPng } from './png';

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255)) as RGB;

/** A shape being built: flat-shaded triangles with a color each. */
class Shape implements Baked {
  position: number[] = [];
  normal: number[] = [];
  color: number[] = [];

  tri(a: number[], b: number[], c: number[], col: RGB) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    for (const p of [a, b, c]) {
      this.position.push(p[0], p[1], p[2]);
      this.normal.push(n[0] / l, n[1] / l, n[2] / l);
      this.color.push(...col);
    }
  }

  quad(a: number[], b: number[], c: number[], d: number[], col: RGB) {
    this.tri(a, b, c, col);
    this.tri(a, c, d, col);
  }

  /** A box from its center (x, z), its bottom y, and its size; turned `yaw` radians about its center; optional separate top color. */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, col: RGB, top: RGB = col, yaw = 0) {
    const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
    const p = (dx: number, dy: number, dz: number) => [x + dx * c + dz * s, y + dy, z - dx * s + dz * c];
    const [hx, hz] = [sx / 2, sz / 2];
    const v = [p(-hx, 0, -hz), p(hx, 0, -hz), p(hx, 0, hz), p(-hx, 0, hz), p(-hx, sy, -hz), p(hx, sy, -hz), p(hx, sy, hz), p(-hx, sy, hz)];
    this.quad(v[4], v[7], v[6], v[5], top); // top
    this.quad(v[0], v[1], v[2], v[3], col); // bottom
    this.quad(v[3], v[2], v[6], v[7], col); // +z
    this.quad(v[1], v[0], v[4], v[5], col); // -z
    this.quad(v[2], v[1], v[5], v[6], col); // +x
    this.quad(v[0], v[3], v[7], v[4], col); // -x
  }

  /** A cylinder standing up (or lying along x when `along` is 'x'), `n` sides. */
  cylinder(x: number, y: number, z: number, r: number, h: number, col: RGB, n = 8, along: 'y' | 'x' = 'y', top: RGB = col) {
    const ring = (t: number) =>
      Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return along === 'y' ? [x + Math.cos(a) * r, y + t, z + Math.sin(a) * r] : [x + t - h / 2, y + r + Math.sin(a) * r, z + Math.cos(a) * r];
      });
    const [lo, hi] = [ring(0), ring(h)];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad(lo[i], lo[j], hi[j], hi[i], col);
      this.tri(hi[0], hi[j], hi[i], top);
      this.tri(lo[0], lo[i], lo[j], col);
    }
  }

  /** A pyramid (or a frustum when `topScale` > 0) over a box footprint. */
  pyramid(x: number, y: number, z: number, sx: number, sz: number, h: number, col: RGB, topScale = 0) {
    const [hx, hz] = [sx / 2, sz / 2];
    const base = [[x - hx, y, z - hz], [x + hx, y, z - hz], [x + hx, y, z + hz], [x - hx, y, z + hz]];
    if (topScale <= 0) {
      const apex = [x, y + h, z];
      for (let i = 0; i < 4; i++) this.tri(base[(i + 1) % 4], base[i], apex, col);
      return;
    }
    const top = base.map((p) => [x + (p[0] - x) * topScale, y + h, z + (p[2] - z) * topScale]);
    for (let i = 0; i < 4; i++) this.quad(base[(i + 1) % 4], base[i], top[i], top[(i + 1) % 4], col);
    this.quad(top[0], top[3], top[2], top[1], col);
  }

  add(b: Baked, dx = 0, dy = 0, dz = 0) {
    for (let i = 0; i < b.position.length; i += 3) this.position.push(b.position[i] + dx, b.position[i + 1] + dy, b.position[i + 2] + dz);
    this.normal.push(...b.normal);
    this.color.push(...b.color);
  }
}

/** A lamp post: a pole `r` thick and `h` tall at the origin, an arm `arm` m out along +x, and a lamp head (length, height, width) under its end. */
function lampPost(h: number, arm: number, r: number, head: [number, number, number]): Shape {
  const s = new Shape();
  s.cylinder(0, 0, 0, r * 1.6, 0.6, C.signal, 8); // base
  s.cylinder(0, 0.6, 0, r, h - 0.6, C.lampPole, 8);
  s.box(arm / 2, h - 0.12, 0, arm, 0.12, 0.12, C.lampPole);
  s.box(arm - head[0] / 2 + 0.05, h - 0.12 - head[1], 0, head[0], head[1], head[2], C.lampHead);
  s.box(arm - head[0] / 2 + 0.05, h - 0.13 - head[1], 0, head[0] * 0.8, 0.02, head[2] * 0.8, C.lampGlass);
  return s;
}

/**
 * Turns a Kenney signal head so its lamps face -z (the traffic it controls, as
 * pipeline/lights.ts turns it). Kenney's lenses face -x (their normals, checked in the
 * model): a quarter turn, (x, z) to (-z, x).
 */
function facingNegZ(b: Baked): Baked {
  const pos = b.position.slice();
  const nor = b.normal.slice();
  for (let i = 0; i < pos.length; i += 3) {
    [pos[i], pos[i + 2]] = [-pos[i + 2], pos[i]];
    [nor[i], nor[i + 2]] = [-nor[i + 2], nor[i]];
  }
  return { position: pos, normal: nor, color: b.color };
}

const C = {
  signal: hex('#3a3f44'),
  lampPole: hex('#7d858c'),
  lampHead: hex('#5c636a'),
  lampGlass: hex('#f4efd8'),
  white: hex('#e8e8e4'),
  doors: hex('#9a9a96'),
  yellow: hex('#e9b324'),
  yellowDark: hex('#b9861a'),
  steel: hex('#3b3f42'),
  concrete: hex('#b9b5ab'),
  concreteDark: hex('#8f8b82'),
  dirt: hex('#8a6a46'),
  dirtDark: hex('#735638'),
  wood: hex('#a87c4f'),
  woodDark: hex('#7d5a37'),
  green: hex('#2f5d49'),
  red: hex('#c23a2c'),
  glass: hex('#5d7f95'),
  roof: hex('#6b4f3a'),
  paint: hex('#f2f2ec'),
  stop: hex('#d9c25a'),
  booth: hex('#d8d2c4'),
  kiosk: hex('#d65f2c'),
};

/** Kenney model scaled to a size (x length, y height, z width), keeping its proportions when `uniform`. */
function kenney(folder: string, name: string, size: [number, number, number], quarterTurn = false): Baked {
  const palette = readPng(readFileSync(join(folder, 'Textures', 'colormap.png')));
  return fit(readGlb(join(folder, name), palette), size, quarterTurn);
}

/** Kenney model scaled evenly so it stands `height` tall, keeping its proportions. */
function kenneyToHeight(folder: string, name: string, height: number, quarterTurn = false): Baked {
  const palette = readPng(readFileSync(join(folder, 'Textures', 'colormap.png')));
  const raw = readGlb(join(folder, name), palette);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < raw.position.length; i++) [lo[i % 3], hi[i % 3]] = [Math.min(lo[i % 3], raw.position[i]), Math.max(hi[i % 3], raw.position[i])];
  const k = height / (hi[1] - lo[1]);
  const [x, z] = quarterTurn ? [hi[2] - lo[2], hi[0] - lo[0]] : [hi[0] - lo[0], hi[2] - lo[2]];
  return fit(raw, [x * k, height, z * k], quarterTurn);
}

function build(roads: string, suburban: string, commercial: string): Record<DressingKind, Baked> {
  const size = (k: DressingKind) => DRESSING[k].size;
  const shapes = {} as Record<DressingKind, Baked>;

  {
    // Shipping container: a body with ribbed long sides, doors at one end.
    const [l, w, h] = size('container');
    const s = new Shape();
    s.box(0, 0, 0, l, h, w, C.white);
    for (let i = 1; i < 12; i++) {
      const x = -l / 2 + (i * l) / 12;
      for (const side of [-1, 1]) s.box(x, 0.1, side * (w / 2 + 0.02), 0.12, h - 0.2, 0.04, C.white);
    }
    s.box(l / 2 + 0.02, 0.05, 0, 0.04, h - 0.1, w - 0.1, C.doors);
    shapes.container = s;
  }
  {
    // Tower crane: a mast with dark corner chords, a jib along +x, a counter-jib with its weights, the cab.
    const s = new Shape();
    const [, , h] = size('crane');
    const mast = 1.6;
    s.box(0, 0, 0, 3.2, 1, 3.2, C.concrete);
    s.box(0, 1, 0, mast, h - 7, mast, C.yellow);
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) s.box((dx * mast) / 2, 1, (dz * mast) / 2, 0.22, h - 7, 0.22, C.yellowDark);
    for (let y = 4; y < h - 7; y += 3) s.box(0, y, 0, mast + 0.1, 0.18, mast + 0.1, C.yellowDark);
    const top = h - 6;
    s.box(0, top, 0, 2.4, 2.2, 2.2, C.white); // cab
    s.box(14, top + 2.2, 0, 30, 1.1, 1.1, C.yellow); // jib
    s.box(-6, top + 2.2, 0, 12, 1.1, 1.6, C.yellow); // counter-jib
    s.box(-10.5, top + 0.8, 0, 3, 1.6, 2, C.concrete); // counterweights
    s.pyramid(0, top + 3.3, 0, 1.6, 1.6, 2.7, C.yellowDark); // apex
    s.box(25, top + 1, 0, 0.3, 1.2, 0.3, C.steel); // trolley and hook block
    shapes.crane = s;
  }
  {
    // Dirt mound: a lumpy frustum with a second smaller heap on top.
    const [l, w, h] = size('mound');
    const s = new Shape();
    s.pyramid(0, 0, 0, l, w, h * 0.65, C.dirt, 0.55);
    s.pyramid(l * 0.08, h * 0.65, -w * 0.05, l * 0.5, w * 0.5, h * 0.35, C.dirtDark);
    shapes.mound = s;
  }
  {
    // Concrete pipes: three on the ground, two on top.
    const [l] = size('pipes');
    const s = new Shape();
    const r = 0.38;
    for (const z of [-0.8, 0, 0.8]) s.cylinder(0, 0, z, r, l, C.concrete, 8, 'x', C.concreteDark);
    for (const z of [-0.4, 0.4]) s.cylinder(0, 2 * r * 0.88, z, r, l, C.concrete, 8, 'x', C.concreteDark);
    shapes.pipes = s;
  }
  {
    const s = new Shape();
    s.box(-0.5, 0, 0, 1.2, 0.9, 1.6, C.wood, C.woodDark);
    s.box(0.65, 0, 0.1, 1, 0.8, 1.2, C.woodDark, C.wood);
    s.box(-0.4, 0.9, 0.1, 0.9, 0.7, 1, C.wood, C.woodDark, 0.3);
    shapes.crates = s;
  }
  shapes.dumpster = kenney(roads, 'dumpster.glb', [size('dumpster')[0], size('dumpster')[2], size('dumpster')[1]], false);
  shapes.worklight = kenney(roads, 'construction-light.glb', [size('worklight')[0], size('worklight')[2], size('worklight')[1]], false);
  // Lamps built in code: Kenney's, scaled up evenly to a real lamp's height, came out with
  // poles 0.4 to 0.8 m thick (toy-like next to the car). Real proportions instead: a slim
  // pole at the origin, the arm out along +x, the lamp head under its end.
  shapes.lamp = lampPost(size('lamp')[2], ARMS.lamp, 0.07, [0.45, 0.22, 0.3]);
  shapes.streetlight = lampPost(size('streetlight')[2], ARMS.streetlight, 0.12, [0.8, 0.18, 0.38]);
  {
    // Traffic light on a mast arm: a dark pole, an arm out over the road along +x, a signal
    // head (Kenney's) hanging near its end and a second one on the pole, facing -z: the
    // traffic coming toward it (pipeline/lights.ts turns the arm over the lanes).
    const h = size('signal')[2];
    const arm = ARMS.signal;
    const s = new Shape();
    s.cylinder(0, 0, 0, 0.16, h, C.signal, 8);
    s.box(arm / 2, h - 0.55, 0, arm, 0.18, 0.18, C.signal);
    s.box(arm * 0.28, h - 1.3, 0, 0.08, 0.8, 0.08, C.signal); // brace
    const head = kenneyToHeight(roads, 'traffic-light-object-vertical.glb', 1.0, false);
    s.add(facingNegZ(head), arm - 0.45, h - 1.55, 0);
    s.add(facingNegZ(head), 0, 2.4, -0.22);
    shapes.signal = s;
  }
  {
    // Pole-mounted traffic light for narrower streets: a 3.6 m pole with a head on top.
    const h = size('signalpole')[2];
    const s = new Shape();
    s.cylinder(0, 0, 0, 0.1, h - 0.9, C.signal, 8);
    s.add(facingNegZ(kenneyToHeight(roads, 'traffic-light-object-vertical.glb', 1.0, false)), 0, h - 1.0, -0.12);
    shapes.signalpole = s;
  }
  {
    const [l, w] = size('bench');
    const s = new Shape();
    s.box(0, 0.42, 0, l, 0.06, w * 0.75, C.wood);
    s.box(0, 0.48, -w / 2 + 0.05, l, 0.36, 0.05, C.wood);
    for (const x of [-l / 2 + 0.15, l / 2 - 0.15]) s.box(x, 0, 0, 0.08, 0.42, w * 0.7, C.steel);
    shapes.bench = s;
  }
  {
    // Pavilion: a low floor, four posts, a pyramid roof.
    const [l, w, h] = size('pavilion');
    const s = new Shape();
    s.box(0, 0, 0, l - 0.6, 0.2, w - 0.6, C.concrete);
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) s.box(dx * (l / 2 - 0.9), 0.2, dz * (w / 2 - 0.9), 0.3, h - 1.4, 0.3, C.woodDark);
    s.box(0, h - 1.2, 0, l, 0.15, w, C.roof);
    s.pyramid(0, h - 1.05, 0, l, w, 1.05, C.roof);
    shapes.pavilion = s;
  }
  {
    // Guard booth: walls, a window band all round, a roof slab with an overhang.
    const [l, w, h] = size('booth');
    const s = new Shape();
    s.box(0, 0, 0, l - 0.3, 1.0, w - 0.3, C.booth);
    s.box(0, 1.0, 0, l - 0.3, 1.0, w - 0.3, C.glass);
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) s.box((dx * (l - 0.4)) / 2, 1.0, (dz * (w - 0.4)) / 2, 0.12, 1.0, 0.12, C.booth);
    s.box(0, 2.0, 0, l - 0.3, 0.45, w - 0.3, C.booth);
    s.box(0, h - 0.25, 0, l, 0.25, w, C.steel);
    shapes.booth = s;
  }
  {
    const [l, w, h] = size('stall');
    const s = new Shape();
    s.box(0, 0, 0, l, h, w, C.paint);
    shapes.stall = s;
  }
  {
    const [l, w, h] = size('wheelstop');
    const s = new Shape();
    s.box(0, 0, 0, l, h, w, C.stop, C.stop);
    shapes.wheelstop = s;
  }
  {
    // Waiting shed: a roof sloping to the back, two posts, a glass back panel, a bench.
    const [l, w, h] = size('shed');
    const s = new Shape();
    for (const x of [-l / 2 + 0.2, l / 2 - 0.2]) s.box(x, 0, -w / 2 + 0.15, 0.12, h - 0.15, 0.12, C.steel);
    s.box(0, 0.3, -w / 2 + 0.12, l - 0.6, h - 0.8, 0.05, C.glass);
    s.box(0, h - 0.15, -0.1, l, 0.15, w + 0.2, C.green, C.green);
    s.box(0, 0.45, -w / 2 + 0.45, l - 0.8, 0.06, 0.4, C.steel);
    shapes.shed = s;
  }
  {
    // Kiosk: a small painted booth with a counter window and Kenney's awning over it.
    const [l, w] = size('kiosk');
    const s = new Shape();
    s.box(0, 0, 0, l, 1.0, w, C.kiosk);
    s.box(0, 1.0, -0.15, l, 1.2, w - 0.3, C.booth);
    s.box(0, 1.0, w / 2 - 0.1, l - 0.4, 0.04, 0.2, C.woodDark); // counter
    s.box(0, 2.2, 0, l + 0.1, 0.25, w, C.kiosk);
    s.add(kenney(commercial, 'detail-awning-wide.glb', [l, 0.6, 0.8], false), 0, 1.75, w / 2 + 0.3);
    shapes.kiosk = s;
  }
  shapes.planter = kenney(suburban, 'planter.glb', [size('planter')[0], size('planter')[2], size('planter')[1]], false);
  {
    // Fire hydrant: red body, yellow cap, two side outlets.
    const [, , h] = size('hydrant');
    const s = new Shape();
    s.cylinder(0, 0, 0, 0.16, 0.06, C.concrete, 8);
    s.cylinder(0, 0.06, 0, 0.12, h - 0.2, C.red, 8);
    s.cylinder(0, h - 0.14, 0, 0.14, 0.14, C.yellow, 8);
    s.cylinder(0, h * 0.55, 0, 0.05, 0.4, C.red, 6, 'x');
    shapes.hydrant = s;
  }
  {
    const [, , h] = size('bin');
    const s = new Shape();
    s.cylinder(0, 0, 0, 0.26, h - 0.1, C.green, 8);
    s.cylinder(0, h - 0.1, 0, 0.29, 0.1, C.steel, 8);
    shapes.bin = s;
  }
  return shapes;
}

async function main() {
  const [roads, suburban, commercial, output] = process.argv.slice(2);
  if (!roads || !suburban || !commercial || !output) throw new Error('usage: tsx tools/props-to-glb.ts <roads GLB folder> <suburban GLB folder> <commercial GLB folder> <out.glb>');
  const shapes = build(roads, suburban, commercial);
  const group = new Group();
  const material = new MeshStandardMaterial({ vertexColors: true });
  let tris = 0;
  const report: string[] = [];
  for (const [name, b] of Object.entries(shapes)) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(b.position), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(b.normal), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(b.color), 3));
    const mesh = new Mesh(g, material);
    mesh.name = name;
    group.add(mesh);
    tris += b.position.length / 9;
    report.push(`${name} ${b.position.length / 9}`);
  }
  polyfillFileReader();
  const glb = await new GLTFExporter().parseAsync(group, { binary: true });
  writeFileSync(output, Buffer.from(glb as ArrayBuffer));
  console.log(`${output}: ${Object.keys(shapes).length} models, ${tris} triangles (${report.join(', ')})`);
}

if (process.argv[1]?.endsWith('props-to-glb.ts')) void main();
