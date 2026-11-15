/**
 * The roadblock pieces not in the Kenney pack, built in code in the same low-poly style:
 * an orange and white traffic drum, a barricade with diagonal orange and white boards,
 * and a sign stand. Same conventions as the Kenney shapes: meters, origin on the ground
 * under the middle, +Z facing the player, long side along x.
 *
 * The sign also has texture coordinates: its face shows the sign texture (made at run
 * time, scene/roadblockSign.ts); everything else points at a plain orange or black spot
 * of the same texture, so the whole sign is one draw call.
 */
import { hexToRgb, srgbToLinear, type RGB, type Vec3 } from './meshBuilder';

export interface ShapeArrays {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  uv?: Float32Array;
}

const lin = (hex: string): RGB => srgbToLinear(hexToRgb(hex));
export const ROADBLOCK_COLORS = { orange: '#ff7d22', white: '#efefea', post: '#e9e9e4', foot: '#2b2b2b' };
const ORANGE = lin(ROADBLOCK_COLORS.orange);
const WHITE = lin(ROADBLOCK_COLORS.white);
const POST = lin(ROADBLOCK_COLORS.post);
const FOOT = lin(ROADBLOCK_COLORS.foot);

class Shape {
  p: number[] = [];
  n: number[] = [];
  c: number[] = [];
  uv: number[] = [];
  /** A quad a-b-c-d, counter-clockwise seen from the front. */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: RGB, uv: [number, number] | [number, number][] = [0, 0]) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const uvs = Array.isArray(uv[0]) ? (uv as [number, number][]) : [uv, uv, uv, uv];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      this.p.push(...[a, b, c, d][k]);
      this.n.push(n[0] / l, n[1] / l, n[2] / l);
      this.c.push(...color);
      this.uv.push(...(uvs[k] as [number, number]));
    }
  }
  /** A triangle a-b-c, counter-clockwise seen from the front. */
  tri(a: Vec3, b: Vec3, c: Vec3, color: RGB) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    for (const v of [a, b, c]) {
      this.p.push(...v);
      this.n.push(n[0] / l, n[1] / l, n[2] / l);
      this.c.push(...color);
      this.uv.push(0, 0);
    }
  }
  /** A box from (x0, y0, z0) to (x1, y1, z1), no bottom. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: RGB, uv: [number, number] = [0, 0]) {
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, uv);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color, uv);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color, uv);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color, uv);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], color, uv);
  }
  build(withUv = false): ShapeArrays {
    const out: ShapeArrays = { position: new Float32Array(this.p), normal: new Float32Array(this.n), color: new Float32Array(this.c) };
    return withUv ? { ...out, uv: new Float32Array(this.uv) } : out;
  }
}

/** Traffic drum: 0.6 m across, 0.95 m tall, orange with two white bands, on a dark base ring. */
export function drumShape(sides = 8): ShapeArrays {
  const s = new Shape();
  const r = 0.3;
  const bands: [number, number, RGB][] = [
    [0, 0.08, FOOT],
    [0.08, 0.3, ORANGE],
    [0.3, 0.45, WHITE],
    [0.45, 0.62, ORANGE],
    [0.62, 0.77, WHITE],
    [0.77, 0.95, ORANGE],
  ];
  const at = (i: number, y: number, rr = r): Vec3 => [Math.cos((i / sides) * Math.PI * 2) * rr, y, -Math.sin((i / sides) * Math.PI * 2) * rr];
  for (const [y0, y1, color] of bands) {
    // The base ring flares out a little, like the drum's weighted base.
    const [r0, r1] = y1 <= 0.08 ? [r * 1.25, r * 1.1] : [r, r * (1 - 0.06 * y1)];
    for (let i = 0; i < sides; i++) s.quad(at(i, y0, r0), at(i + 1, y0, r0), at(i + 1, y1, r1), at(i, y1, r1), color);
  }
  const top = 0.95;
  const rt = r * (1 - 0.06 * top);
  for (let i = 1; i < sides - 1; i++) s.tri(at(0, top, rt), at(i, top, rt), at(i + 1, top, rt), ORANGE);
  return s.build();
}

/**
 * Barricade: two boards with diagonal orange and white stripes on both faces, held up by
 * two white posts on dark feet. 2 m wide, 1.15 m tall.
 */
export function barricadeShape(): ShapeArrays {
  const s = new Shape();
  const half = 1;
  const boards: [number, number][] = [
    [0.5, 0.72],
    [0.88, 1.1],
  ];
  const t = 0.03;
  const stripe = 0.28;
  for (const [y0, y1] of boards) {
    const slant = y1 - y0; // 45 degree stripes
    const n = Math.ceil((2 * half + slant) / stripe) + 1;
    const clamp = (x: number) => Math.max(-half, Math.min(half, x));
    for (let k = -1; k < n; k++) {
      const b0 = -half - slant + k * stripe;
      const [bx0, bx1, tx0, tx1] = [clamp(b0), clamp(b0 + stripe), clamp(b0 + slant), clamp(b0 + stripe + slant)];
      if (bx1 - bx0 < 1e-4 && tx1 - tx0 < 1e-4) continue;
      const color = k % 2 === 0 ? ORANGE : WHITE;
      s.quad([bx0, y0, t], [bx1, y0, t], [tx1, y1, t], [tx0, y1, t], color); // front
      s.quad([-bx0, y0, -t], [-bx1, y0, -t], [-tx1, y1, -t], [-tx0, y1, -t], color); // back, mirrored
    }
    s.quad([-half, y1, t], [half, y1, t], [half, y1, -t], [-half, y1, -t], WHITE); // top edge
    s.quad([half, y0, t], [half, y0, -t], [half, y1, -t], [half, y1, t], WHITE); // ends
    s.quad([-half, y0, -t], [-half, y0, t], [-half, y1, t], [-half, y1, -t], WHITE);
  }
  for (const x of [-0.8, 0.8]) {
    s.box(x - 0.03, 0.05, -0.07 - t, x + 0.03, 1.15, -0.01 - t, POST);
    s.box(x - 0.05, 0, -0.35, x + 0.05, 0.06, 0.35, FOOT);
  }
  return s.build();
}

/** Where the sign texture is plain orange (around the border) and black (the border itself). */
export const SIGN_UV = { orange: [0.012, 0.012] as [number, number], black: [0.05, 0.05] as [number, number] };
/** Sign stand: a 1.2 x 0.9 m panel from 1.0 to 1.9 m up, on two black posts with feet. */
export const SIGN = { width: 1.2, bottom: 1.0, top: 1.9 };

export function signShape(): ShapeArrays {
  const s = new Shape();
  const [hw, y0, y1, t] = [SIGN.width / 2, SIGN.bottom, SIGN.top, 0.02];
  // Face (+Z) with the texture; back and edges plain orange.
  s.quad([-hw, y0, t], [hw, y0, t], [hw, y1, t], [-hw, y1, t], [1, 1, 1], [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]);
  s.quad([hw, y0, -t], [-hw, y0, -t], [-hw, y1, -t], [hw, y1, -t], [1, 1, 1], SIGN_UV.orange);
  s.quad([-hw, y1, t], [hw, y1, t], [hw, y1, -t], [-hw, y1, -t], [1, 1, 1], SIGN_UV.orange);
  for (const x of [-0.45, 0.45]) {
    s.box(x - 0.025, 0.05, -0.025 - 2 * t, x + 0.025, y1 - 0.05, 0.025 - 2 * t, [1, 1, 1], SIGN_UV.black);
    s.box(x - 0.05, 0, -0.35, x + 0.05, 0.06, 0.35, [1, 1, 1], SIGN_UV.black);
  }
  return s.build(true);
}
