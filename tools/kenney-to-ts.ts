/**
 * Bakes the two Kenney City Kit Roads models the roadblocks use (CC0,
 * https://kenney.nl/assets/city-kit-roads) into plain arrays in
 * src/geometry/kenneyShapes.ts, so they're drawn like the other instanced props (no
 * loading, no texture):
 *
 *   npx tsx tools/kenney-to-ts.ts "<pack>/Models/GLB format" src/geometry/kenneyShapes.ts
 *
 * - The pack colors models from a shared palette texture; each vertex gets the color at
 *   its texture coordinate (sRGB to linear, like the rest of the city's vertex colors).
 * - Sized in meters: the cone 0.7 m tall; the concrete barrier stretched to a jersey
 *   barrier's 2 m long, 0.6 m wide, 0.8 m tall (long side along x) and recolored from the
 *   pack's blue-grey to concrete, keeping its light and dark faces.
 * - Origin on the ground under the middle; +Z is the side facing the player. Flat
 *   shaded (one normal per triangle), like the rest of the city.
 *
 * Runs once by hand; the raw pack isn't in the repo.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPng, type Png } from './png';

export interface Baked {
  position: number[];
  normal: number[];
  color: number[];
}

export const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Triangles of every mesh in a GLB, with per-vertex colors from the palette texture. */
export function readGlb(path: string, palette: Png): Baked {
  const buf = readFileSync(path);
  const jsonLength = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLength));
  const bin = 20 + jsonLength + 8;
  const read = (i: number): number[][] => {
    const a = gltf.accessors[i];
    const view = gltf.bufferViews[a.bufferView];
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type as string]!;
    const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType as number]!;
    const stride = view.byteStride ?? size * n;
    const base = bin + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const get = (o: number) =>
      a.componentType === 5126 ? buf.readFloatLE(o) : a.componentType === 5125 ? buf.readUInt32LE(o) : a.componentType === 5123 ? buf.readUInt16LE(o) : buf[o];
    return Array.from({ length: a.count }, (_, k) => Array.from({ length: n }, (_, j) => get(base + k * stride + j * size)));
  };
  const out: Baked = { position: [], normal: [], color: [] };
  for (const mesh of gltf.meshes) {
    for (const prim of mesh.primitives) {
      const pos = read(prim.attributes.POSITION);
      const nor = read(prim.attributes.NORMAL);
      const uv = read(prim.attributes.TEXCOORD_0);
      const idx = prim.indices !== undefined ? read(prim.indices).map((v) => v[0]) : pos.map((_, i) => i);
      for (const i of idx) {
        const [u, v] = uv[i];
        const x = Math.min(palette.width - 1, Math.max(0, Math.floor(u * palette.width)));
        const y = Math.min(palette.height - 1, Math.max(0, Math.floor(v * palette.height)));
        const p = (y * palette.width + x) * 4;
        out.position.push(...pos[i]);
        out.normal.push(...nor[i]);
        out.color.push(...[0, 1, 2].map((k) => srgbToLinear(palette.data[p + k] / 255)));
      }
    }
  }
  return out;
}

/** Scales to a target size (meters, x/y/z), optionally turning a quarter so the long side is along x. */
export function fit(b: Baked, size: [number, number, number], quarterTurn: boolean): Baked {
  const pos = b.position.slice();
  const nor = b.normal.slice();
  if (quarterTurn) {
    for (let i = 0; i < pos.length; i += 3) {
      [pos[i], pos[i + 2]] = [pos[i + 2], -pos[i]];
      [nor[i], nor[i + 2]] = [nor[i + 2], -nor[i]];
    }
  }
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], pos[i]);
    hi[i % 3] = Math.max(hi[i % 3], pos[i]);
  }
  const s = [0, 1, 2].map((k) => size[k] / (hi[k] - lo[k]));
  for (let i = 0; i < pos.length; i++) {
    const k = i % 3;
    pos[i] = k === 1 ? (pos[i] - lo[1]) * s[1] : (pos[i] - (lo[k] + hi[k]) / 2) * s[k];
  }
  // Normals of a stretched shape: divide by the scale, then normalize.
  for (let i = 0; i < nor.length; i += 3) {
    const n = [nor[i] / s[0], nor[i + 1] / s[1], nor[i + 2] / s[2]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    [nor[i], nor[i + 1], nor[i + 2]] = [n[0] / l, n[1] / l, n[2] / l];
  }
  return { position: pos, normal: flatNormals(pos, nor), color: b.color };
}

/** One normal per triangle, from its corners (the city is flat shaded); falls back to the model's where a triangle is degenerate. */
function flatNormals(pos: number[], given: number[]): number[] {
  const out = given.slice();
  for (let i = 0; i < pos.length; i += 9) {
    const e1 = [pos[i + 3] - pos[i], pos[i + 4] - pos[i + 1], pos[i + 5] - pos[i + 2]];
    const e2 = [pos[i + 6] - pos[i], pos[i + 7] - pos[i + 1], pos[i + 8] - pos[i + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-9) continue;
    for (let k = 0; k < 3; k++) out.splice(i + k * 3, 3, n[0] / l, n[1] / l, n[2] / l);
  }
  return out;
}

/** Recolors to concrete, keeping each face's brightness relative to the brightest. */
function concrete(b: Baked, linear: [number, number, number]): Baked {
  const lum = (i: number) => 0.2126 * b.color[i] + 0.7152 * b.color[i + 1] + 0.0722 * b.color[i + 2];
  let max = 0;
  for (let i = 0; i < b.color.length; i += 3) max = Math.max(max, lum(i));
  const color = b.color.slice();
  for (let i = 0; i < color.length; i += 3) {
    const f = 0.55 + 0.45 * (lum(i) / max);
    for (let k = 0; k < 3; k++) color[i + k] = linear[k] * f;
  }
  return { ...b, color };
}

const round = (v: number) => Math.round(v * 10000) / 10000;
const arrays = (name: string, b: Baked, note: string) =>
  `/** ${note} (${b.position.length / 9} triangles). */\nexport const ${name} = {\n  position: new Float32Array([${b.position.map(round).join(',')}]),\n  normal: new Float32Array([${b.normal.map(round).join(',')}]),\n  color: new Float32Array([${b.color.map(round).join(',')}]),\n};\n`;

function main() {
  const [folder, output] = process.argv.slice(2);
  if (!folder || !output) throw new Error('usage: tsx tools/kenney-to-ts.ts <pack>/Models/GLB\\ format <out.ts>');
  const palette = readPng(readFileSync(join(folder, 'Textures', 'colormap.png')));
  const cone = fit(readGlb(join(folder, 'construction-cone.glb'), palette), [0.42, 0.7, 0.42], false);
  const grey = [0xc4, 0xc0, 0xb6].map((c) => srgbToLinear(c / 255)) as [number, number, number];
  const barrier = concrete(fit(readGlb(join(folder, 'construction-barrier.glb'), palette), [2, 0.8, 0.6], true), grey);
  const text =
    `/**\n * Generated by tools/kenney-to-ts.ts from Kenney's City Kit Roads (CC0, www.kenney.nl): don't edit.\n` +
    ` * Unit: meters; origin on the ground under the middle; +Z faces the player.\n */\n\n` +
    arrays('KENNEY_CONE', cone, 'Traffic cone, 0.7 m tall') +
    '\n' +
    arrays('KENNEY_BARRIER', barrier, 'Concrete jersey barrier, 2 m long (along x), 0.6 m wide, 0.8 m tall');
  writeFileSync(output, text);
  console.log(`${output}: cone ${cone.position.length / 9} triangles, barrier ${barrier.position.length / 9} triangles`);
}

if (process.argv[1]?.endsWith('kenney-to-ts.ts')) main();
