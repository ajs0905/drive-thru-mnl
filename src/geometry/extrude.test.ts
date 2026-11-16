import { describe, expect, it } from 'vitest';
import type { Ring } from '../map/types';
import { addFlatPolygon, decodeWindows, extrudeBuilding, windowCode, WINDOWS } from './extrude';
import { MeshBuilder, triangleNormal, type Vec3 } from './meshBuilder';

const colors = { wall: [1, 0, 0] as [number, number, number], roof: [0, 0, 1] as [number, number, number] };
const square: Ring = [[0, 0], [10, 0], [10, 10], [0, 10]]; // CCW
const hole: Ring = [[3, 3], [7, 3], [7, 7], [3, 7]]; // CCW on purpose, extrude must fix it

function triangles(mb: MeshBuilder) {
  const { position, normal } = mb.build();
  const out: { v: Vec3[]; n: Vec3 }[] = [];
  for (let i = 0; i < position.length; i += 9) {
    const v = [0, 3, 6].map((k): Vec3 => [position[i + k], position[i + k + 1], position[i + k + 2]]);
    out.push({ v, n: [normal[i], normal[i + 1], normal[i + 2]] });
  }
  return out;
}

/** Every triangle's vertex order must agree with its stored normal, or it'll render inside out. */
function expectConsistentWinding(mb: MeshBuilder) {
  for (const { v, n } of triangles(mb)) {
    const g = triangleNormal(v[0], v[1], v[2]);
    expect(g[0] * n[0] + g[1] * n[1] + g[2] * n[2]).toBeGreaterThan(0.99);
  }
}

describe('extrudeBuilding', () => {
  it('makes 2 wall triangles per edge plus a 2-triangle roof for a box', () => {
    const mb = new MeshBuilder();
    expect(extrudeBuilding(mb, [square], 20, colors)).toBe(true);
    expect(mb.triangleCount).toBe(4 * 2 + 2);
    expect(mb.vertexCount).toBe(mb.triangleCount * 3);
  });

  it('gives the same result for clockwise and counter-clockwise outlines', () => {
    const a = new MeshBuilder();
    const b = new MeshBuilder();
    extrudeBuilding(a, [square], 20, colors);
    extrudeBuilding(b, [[...square].reverse()], 20, colors);
    expect(a.triangleCount).toBe(b.triangleCount);
    expectConsistentWinding(b);
  });

  it('points wall normals away from the building', () => {
    const mb = new MeshBuilder();
    extrudeBuilding(mb, [square], 20, colors);
    const center: Vec3 = [5, 10, -5];
    for (const { v, n } of triangles(mb)) {
      if (n[1] !== 0) continue; // roof
      const mid = v.reduce((s, p) => [s[0] + p[0] / 3, s[1] + p[1] / 3, s[2] + p[2] / 3], [0, 0, 0] as Vec3);
      const toward = [mid[0] - center[0], 0, mid[2] - center[2]];
      expect(toward[0] * n[0] + toward[2] * n[2]).toBeGreaterThan(0);
    }
    expectConsistentWinding(mb);
  });

  it('puts the roof at base + height, facing up', () => {
    const mb = new MeshBuilder();
    extrudeBuilding(mb, [square], 20, colors, 5);
    const roof = triangles(mb).filter(({ n }) => n[1] === 1);
    expect(roof.length).toBe(2);
    for (const { v } of roof) for (const p of v) expect(p[1]).toBe(25);
  });

  it('closes the bottom of raised structures so canopies are visible from below', () => {
    const mb = new MeshBuilder();
    extrudeBuilding(mb, [square], 0.6, colors, 3.6);
    const bottom = triangles(mb).filter(({ n }) => n[1] === -1);
    expect(bottom.length).toBe(2);
    for (const { v } of bottom) for (const p of v) expect(p[1]).toBeCloseTo(3.6, 5);
    expectConsistentWinding(mb);
  });

  it('adds no bottom for buildings standing on the ground', () => {
    const mb = new MeshBuilder();
    extrudeBuilding(mb, [square], 10, colors);
    expect(triangles(mb).filter(({ n }) => n[1] === -1)).toHaveLength(0);
  });

  it('adds inward-facing walls for courtyards (holes)', () => {
    const mb = new MeshBuilder();
    extrudeBuilding(mb, [square, hole], 10, colors);
    // 4 outer + 4 hole edges, 2 tris each, plus a roof with a hole (8 triangles for a square ring).
    const walls = triangles(mb).filter(({ n }) => n[1] === 0);
    expect(walls.length).toBe(16);
    const roof = triangles(mb).filter(({ n }) => n[1] === 1);
    expect(roof.length).toBe(8);
    // Hole walls face the courtyard center.
    for (const { v, n } of walls) {
      const mx = (v[0][0] + v[1][0] + v[2][0]) / 3;
      const mz = (v[0][2] + v[1][2] + v[2][2]) / 3;
      const isHoleWall = mx > 2 && mx < 8 && mz < -2 && mz > -8;
      if (!isHoleWall) continue;
      expect((5 - mx) * n[0] + (-5 - mz) * n[2]).toBeGreaterThan(0);
    }
    expectConsistentWinding(mb);
  });

  it('handles concave footprints', () => {
    const l: Ring = [[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]];
    const mb = new MeshBuilder();
    extrudeBuilding(mb, [l], 10, colors);
    expect(mb.triangleCount).toBe(6 * 2 + 4); // 6 edges, roof of a hexagon = 4 triangles
    expectConsistentWinding(mb);
  });

  it('rejects degenerate input', () => {
    const mb = new MeshBuilder();
    expect(extrudeBuilding(mb, [], 10, colors)).toBe(false);
    expect(extrudeBuilding(mb, [[[0, 0], [1, 1]]], 10, colors)).toBe(false);
    expect(extrudeBuilding(mb, [square], 0, colors)).toBe(false);
    expect(extrudeBuilding(mb, [square], NaN, colors)).toBe(false);
    expect(mb.triangleCount).toBe(0);
  });

  it('skips zero-length edges', () => {
    const mb = new MeshBuilder();
    extrudeBuilding(mb, [[[0, 0], [10, 0], [10, 0], [10, 10], [0, 10]]], 10, colors);
    expect(triangles(mb).filter(({ n }) => n[1] === 0).length).toBe(8);
  });
});

describe('addFlatPolygon', () => {
  it('triangulates facing up at the given height', () => {
    const mb = new MeshBuilder();
    addFlatPolygon(mb, [[...square].reverse()], 0.5, colors.roof);
    expect(mb.triangleCount).toBe(2);
    for (const { v, n } of triangles(mb)) {
      expect(n).toEqual([0, 1, 0]);
      for (const p of v) expect(p[1]).toBe(0.5);
    }
    expectConsistentWinding(mb);
  });

  it('ignores empty input', () => {
    const mb = new MeshBuilder();
    expect(addFlatPolygon(mb, [], 0, colors.roof)).toBe(0);
  });
});

describe('wall coordinates for windows', () => {
  it('packs and unpacks a window style', () => {
    const code = windowCode(WINDOWS.glass, 11, 42);
    expect(decodeWindows(code)).toEqual({ kind: WINDOWS.glass, variant: 11, floors: 42, shops: false });
    expect(decodeWindows(windowCode(WINDOWS.office, 4, 200, true))).toEqual({ kind: WINDOWS.office, variant: 4, floors: 200, shops: true });
    expect(decodeWindows(windowCode(WINDOWS.house, 99, -3))).toEqual({ kind: WINDOWS.house, variant: 15, floors: 0, shops: false });
  });

  it('gives wall vertices meters along the wall, meters up, the wall length and the style', () => {
    const mb = new MeshBuilder({ aux: true });
    const code = windowCode(WINDOWS.office, 3, 6);
    extrudeBuilding(mb, [square], 20, { ...colors, windows: code }, 0);
    const aux = mb.build().aux!;
    const walls = [];
    for (let v = 0; v < aux.length / 4; v++) if (aux[v * 4 + 3] === code) walls.push([aux[v * 4], aux[v * 4 + 1], aux[v * 4 + 2]]);
    expect(walls).toHaveLength(4 * 6); // 4 walls, 2 triangles each
    expect(Math.max(...walls.map((w) => w[0]))).toBeCloseTo(10); // the square's side
    expect(Math.max(...walls.map((w) => w[1]))).toBeCloseTo(20);
    expect(walls.every((w) => Math.abs(w[2] - 10) < 1e-6)).toBe(true);
  });

  it('leaves roofs without windows', () => {
    const mb = new MeshBuilder({ aux: true });
    extrudeBuilding(mb, [square], 20, { ...colors, windows: windowCode(WINDOWS.office, 0, 6) });
    const { aux, normal } = mb.build();
    for (let v = 0; v < normal.length / 3; v++) if (normal[v * 3 + 1] > 0.9) expect(aux![v * 4 + 3]).toBe(0);
  });
});
