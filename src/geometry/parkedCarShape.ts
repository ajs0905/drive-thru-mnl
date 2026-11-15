/**
 * The far version of a parked car: a 32-triangle box car (body, cabin with dark windows,
 * a dark band where the wheels are) in a unit size, stretched per car to its model's
 * length, width and height. Past the near distance the real model's 1,400 to 1,750
 * triangles aren't worth it; this keeps hundreds of parked cars cheap.
 *
 * Same conventions as the car models: +Z forward, +Y up, standing on y = 0, centered.
 * `paint` is 1 on the painted parts (body, roof), 0 elsewhere, like the models, and
 * `shine` says how each part reflects (1 paint, 2 glass, 0 matte; see scene/carShine.ts).
 */

const DARK: [number, number, number] = [0.02, 0.02, 0.025];
const GLASS: [number, number, number] = [0.025, 0.035, 0.06];
const WHITE: [number, number, number] = [1, 1, 1];

/** Unit box car arrays, plus the paint mask (one value per vertex). */
export function parkedCarShape(): { position: Float32Array; normal: Float32Array; color: Float32Array; paint: Float32Array; shine: Float32Array } {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const paint: number[] = [];
  const shine: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], color: [number, number, number], painted: boolean) => {
    for (const v of [a, b, c, a, c, d]) {
      pos.push(...v);
      nor.push(...n);
      col.push(...color);
      paint.push(painted ? 1 : 0);
      shine.push(painted ? 1 : color === GLASS ? 2 : 0);
    }
  };
  /** A box from (x0, y0, z0) to (x1, y1, z1); sides in `side` color, top in `top`, no bottom. */
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, side: [number, number, number], top: [number, number, number], sidePaint: boolean, topPaint: boolean) => {
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], side, sidePaint); // front
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], side, sidePaint); // back
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], side, sidePaint); // left (+x)
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], side, sidePaint); // right
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], top, topPaint); // top
  };
  box(-0.47, 0, -0.44, 0.47, 0.2, 0.44, DARK, DARK, false, false); // wheels and underside
  box(-0.5, 0.2, -0.5, 0.5, 0.55, 0.5, WHITE, WHITE, true, true); // body
  box(-0.43, 0.55, -0.28, 0.43, 0.95, 0.18, GLASS, WHITE, false, true); // cabin: windows, painted roof
  return { position: new Float32Array(pos), normal: new Float32Array(nor), color: new Float32Array(col), paint: new Float32Array(paint), shine: new Float32Array(shine) };
}
