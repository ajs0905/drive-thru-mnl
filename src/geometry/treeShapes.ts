/**
 * Procedural low-poly tree models: three broadleaf variants and a palm, each one small
 * mesh (trunk, branches and leaves together) for a tree of size factor 1, in meters,
 * standing on y = 0 in three.js space. The renderer draws every tree of one model in a
 * grid cell as GPU instances, scaled by the tree's size and turned by its seed.
 *
 * Leaves are built in a reference green and shaded darker underneath (cheap baked
 * ambient occlusion). Each tree's own green comes from its instance color, which is the
 * ratio of the tree's green to the reference (see `treeTint`), so leaves get exactly the
 * palette color while trunks only shift slightly in brightness.
 *
 * Crowns are clusters of jittered icosahedrons; palms get a curved trunk and drooping
 * fronds (two-sided, so the palm material renders both faces). The jitter is seeded,
 * so every build makes the same trees.
 */
import { seeded } from '../map/hash';
import { hexToRgb, MeshBuilder, shade, srgbToLinear, triangleNormal, type RGB, type Vec3 } from './meshBuilder';

export type TreeModel = 'treeRound' | 'treeWide' | 'treeTall' | 'palm';
export const BROADLEAF_MODELS = ['treeRound', 'treeWide', 'treeTall'] as const satisfies readonly TreeModel[];
export const TREE_MODELS: TreeModel[] = [...BROADLEAF_MODELS, 'palm'];

/** Colors the leaves are built in (sRGB hex). Tree palettes are tinted relative to these. */
export const LEAF_REFERENCE: Record<TreeModel, string> = {
  treeRound: '#5a8a3c',
  treeWide: '#5a8a3c',
  treeTall: '#5a8a3c',
  palm: '#6d9a3a',
};
const BARK = '#5e4632';
const PALM_BARK = '#958873';
const PALM_HEART = '#7a6a45';

const linear = (hex: string): RGB => srgbToLinear(hexToRgb(hex));

/**
 * Instance color that turns a model's reference leaf color into `leafHex` (linear RGB,
 * per channel ratio; can be above 1).
 */
export function treeTint(model: TreeModel, leafHex: string): RGB {
  const want = linear(leafHex);
  const ref = linear(LEAF_REFERENCE[model]);
  return [want[0] / ref[0], want[1] / ref[1], want[2] / ref[2]];
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, f: number): Vec3 => [a[0] * f, a[1] * f, a[2] * f];
const centroid = (a: Vec3, b: Vec3, c: Vec3): Vec3 => scale(add(add(a, b), c), 1 / 3);

/** Adds a triangle facing away from `inside` (flips the winding if needed). */
function faceOut(mb: MeshBuilder, a: Vec3, b: Vec3, c: Vec3, inside: Vec3, color: RGB) {
  let n = triangleNormal(a, b, c);
  const m = centroid(a, b, c);
  if (n[0] * (m[0] - inside[0]) + n[1] * (m[1] - inside[1]) + n[2] * (m[2] - inside[2]) < 0) {
    [b, c] = [c, b];
    n = triangleNormal(a, b, c);
  }
  mb.triangle(a, b, c, n, color);
}

/** Adds a triangle whose front faces up (+y), for thin two-sided leaves. */
function faceUp(mb: MeshBuilder, a: Vec3, b: Vec3, c: Vec3, color: RGB) {
  let n = triangleNormal(a, b, c);
  if (n[1] < 0) {
    [b, c] = [c, b];
    n = triangleNormal(a, b, c);
  }
  mb.triangle(a, b, c, n, color);
}

const T = (1 + Math.sqrt(5)) / 2;
const ICO_VERTS: Vec3[] = [
  [-1, T, 0], [1, T, 0], [-1, -T, 0], [1, -T, 0],
  [0, -1, T], [0, 1, T], [0, -1, -T], [0, 1, -T],
  [T, 0, -1], [T, 0, 1], [-T, 0, -1], [-T, 0, 1],
].map((v) => scale(v as Vec3, 1 / Math.hypot(1, T)));
const ICO_FACES = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

/**
 * A lumpy leaf cluster: an icosahedron (20 faces) with each corner pushed in or out by
 * up to `jitter`, stretched to `radii`. Faces get darker toward the bottom.
 */
function blob(mb: MeshBuilder, center: Vec3, radii: Vec3, rand: () => number, leaf: RGB, jitter = 0.2) {
  const pts = ICO_VERTS.map((v) => {
    const k = 1 + (rand() * 2 - 1) * jitter;
    return add(center, [v[0] * radii[0] * k, v[1] * radii[1] * k, v[2] * radii[2] * k] as Vec3);
  });
  for (const [i, j, k] of ICO_FACES) {
    const m = centroid(pts[i], pts[j], pts[k]);
    const up = Math.max(-1, Math.min(1, (m[1] - center[1]) / radii[1]));
    const f = (0.8 + 0.25 * (up + 1) / 2) * (0.96 + rand() * 0.08);
    faceOut(mb, pts[i], pts[j], pts[k], center, shade(leaf, f));
  }
}

/**
 * A tapered prism along `path` (open at both ends: the bottom is in the ground, the top
 * inside the crown). Rings stay horizontal, which is fine for gentle curves.
 */
function trunk(mb: MeshBuilder, path: Vec3[], radii: number[], sides: number, color: RGB, turn = 0) {
  const rings = path.map((p, r) =>
    Array.from({ length: sides }, (_, i): Vec3 => {
      const a = turn + (i / sides) * Math.PI * 2;
      return [p[0] + Math.cos(a) * radii[r], p[1], p[2] + Math.sin(a) * radii[r]];
    }),
  );
  for (let r = 0; r + 1 < rings.length; r++) {
    const axis = scale(add(path[r], path[r + 1]), 0.5);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const [a, b, c, d] = [rings[r][i], rings[r][j], rings[r + 1][j], rings[r + 1][i]];
      const f = 0.85 + 0.15 * Math.cos((i + 0.5) / sides * Math.PI * 2 - 0.6);
      faceOut(mb, a, b, c, axis, shade(color, f));
      faceOut(mb, a, c, d, axis, shade(color, f));
    }
  }
}

function roundTree(mb: MeshBuilder) {
  const rand = seeded('tree:round');
  const leaf = linear(LEAF_REFERENCE.treeRound);
  trunk(mb, [[0, 0, 0], [0.1, 3.2, 0]], [0.24, 0.16], 5, linear(BARK));
  blob(mb, [0.1, 4.6, 0], [2.3, 1.9, 2.3], rand, leaf);
  blob(mb, [1.3, 3.8, 0.7], [1.6, 1.3, 1.5], rand, leaf);
  blob(mb, [-1.0, 4.0, -0.9], [1.5, 1.4, 1.6], rand, leaf);
}

/** Umbrella crown on two branches, like the rain trees and acacias along BGC streets. */
function wideTree(mb: MeshBuilder) {
  const rand = seeded('tree:wide');
  const leaf = linear(LEAF_REFERENCE.treeWide);
  const bark = linear(BARK);
  trunk(mb, [[0, 0, 0], [0, 2.4, 0]], [0.28, 0.2], 5, bark);
  trunk(mb, [[0, 2.2, 0], [1.6, 3.9, 0.4]], [0.16, 0.08], 3, bark);
  trunk(mb, [[0, 2.2, 0], [-1.5, 3.8, -0.5]], [0.16, 0.08], 3, bark, 1);
  blob(mb, [1.8, 4.2, 0.4], [2.2, 1.0, 2.0], rand, leaf);
  blob(mb, [-1.7, 4.1, -0.5], [2.1, 1.0, 2.0], rand, leaf);
  blob(mb, [0.1, 4.8, 0.1], [2.0, 1.1, 2.1], rand, leaf);
}

function tallTree(mb: MeshBuilder) {
  const rand = seeded('tree:tall');
  const leaf = linear(LEAF_REFERENCE.treeTall);
  trunk(mb, [[0, 0, 0], [0, 4.0, 0]], [0.22, 0.14], 5, linear(BARK));
  blob(mb, [0, 4.6, 0], [1.8, 1.8, 1.8], rand, leaf);
  blob(mb, [0.15, 6.3, 0.1], [1.4, 1.7, 1.4], rand, leaf);
}

/** Palm: gently curved trunk, a heart where the fronds meet, drooping fronds and a few young upright ones. */
function palm(mb: MeshBuilder) {
  const rand = seeded('tree:palm');
  const leaf = linear(LEAF_REFERENCE.palm);
  const top: Vec3 = [0.55, 8.1, 0];
  trunk(mb, [[0, 0, 0], [0.12, 4.2, 0], top], [0.24, 0.19, 0.15], 5, linear(PALM_BARK));
  // Heart: an octahedron hiding the trunk's open top.
  const h = linear(PALM_HEART);
  const c: Vec3 = add(top, [0, 0.15, 0]);
  const ring: Vec3[] = [0, 1, 2, 3].map((i) => add(c, [Math.cos(i * Math.PI / 2) * 0.42, 0, Math.sin(i * Math.PI / 2) * 0.42]));
  for (let i = 0; i < 4; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % 4]];
    faceOut(mb, a, b, add(c, [0, 0.45, 0]), c, shade(h, 1));
    faceOut(mb, a, b, add(c, [0, -0.6, 0]), c, shade(h, 0.75));
  }
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const a = (i + rand() * 0.5) / fronds * Math.PI * 2;
    frond(mb, add(c, [0, 0.2, 0]), a, 4.4 + rand() * 0.8, 2.4 + rand() * 0.6, 0.95, leaf, rand);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i + 0.3 + rand() * 0.4) / 3 * Math.PI * 2;
    frond(mb, add(c, [0, 0.35, 0]), a, 2.6, 0.2, 0.6, leaf, rand);
  }
}

/**
 * One palm frond as four triangles: a spine arching out from `base` and drooping by
 * `droop` at its tip, with both leaf edges hanging below the spine (a folded V).
 */
function frond(mb: MeshBuilder, base: Vec3, angle: number, length: number, droop: number, width: number, leaf: RGB, rand: () => number) {
  const d: Vec3 = [Math.cos(angle), 0, Math.sin(angle)];
  const side: Vec3 = [-d[2], 0, d[0]];
  const b = add(base, scale(d, 0.25));
  const m = add(base, [d[0] * length * 0.45, 0.45 + length * 0.08, d[2] * length * 0.45]);
  const tip = add(base, [d[0] * length, -droop, d[2] * length]);
  const fold: Vec3 = [0, -0.28 * width, 0];
  const l = add(add(m, scale(side, width)), fold);
  const r = add(add(m, scale(side, -width)), fold);
  const f = 1.0 + rand() * 0.12;
  faceUp(mb, b, m, l, shade(leaf, f));
  faceUp(mb, b, r, m, shade(leaf, f * 0.92));
  faceUp(mb, m, tip, l, shade(leaf, f * 0.95));
  faceUp(mb, m, r, tip, shade(leaf, f * 0.87));
}

const BUILD: Record<TreeModel, (mb: MeshBuilder) => void> = {
  treeRound: roundTree,
  treeWide: wideTree,
  treeTall: tallTree,
  palm,
};

/** Mesh arrays (three.js space, flat-shaded, linear vertex colors) for one tree model of size factor 1. */
export function treeMesh(model: TreeModel): ReturnType<MeshBuilder['build']> {
  const mb = new MeshBuilder();
  BUILD[model](mb);
  return mb.build();
}
