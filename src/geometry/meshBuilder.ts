/**
 * Accumulates flat-shaded triangles (position, normal, color) into growable
 * typed arrays, so a whole layer of the city becomes ONE geometry / draw call.
 *
 * Everything here is in three.js space: x east, y up, z south (map y -> -z).
 */

export type Vec3 = [number, number, number];
export type RGB = [number, number, number];

class FloatList {
  data: Float32Array;
  length = 0;
  constructor(initial = 1024) {
    this.data = new Float32Array(initial);
  }
  push3(a: number, b: number, c: number) {
    if (this.length + 3 > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = a;
    this.data[this.length++] = b;
    this.data[this.length++] = c;
  }
  toArray(): Float32Array {
    return this.data.slice(0, this.length);
  }
}

export class MeshBuilder {
  private pos = new FloatList();
  private nrm = new FloatList();
  private col = new FloatList();

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.vertexCount / 3;
  }

  /** Adds one triangle. Vertices must be counter-clockwise when seen from the side the normal points to. */
  triangle(a: Vec3, b: Vec3, c: Vec3, n: Vec3, color: RGB) {
    for (const v of [a, b, c]) {
      this.pos.push3(v[0], v[1], v[2]);
      this.nrm.push3(n[0], n[1], n[2]);
      this.col.push3(color[0], color[1], color[2]);
    }
  }

  build(): { position: Float32Array; normal: Float32Array; color: Float32Array } {
    return { position: this.pos.toArray(), normal: this.nrm.toArray(), color: this.col.toArray() };
  }
}

/** Map space [x, y] at height h -> three.js [x, h, -y]. */
export const to3 = (x: number, y: number, h: number): Vec3 => [x, h, -y];

/** Geometric normal of a triangle (right-hand rule, counter-clockwise front). */
export function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** sRGB (what color pickers show) -> linear (what lighting math and vertex colors expect). */
export function srgbToLinear([r, g, b]: RGB): RGB {
  const f = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [f(r), f(g), f(b)];
}

export function shade(c: RGB, f: number): RGB {
  return [Math.min(1, c[0] * f), Math.min(1, c[1] * f), Math.min(1, c[2] * f)];
}
