import { describe, expect, it } from 'vitest';
import { toCanvas, type MapViewport } from './mapCanvas';
import { levelFor, LEVELS, TILE, tileOffset, tilesInView } from './mapTiles';

/** Where a tile pixel (u, v) lands with the transform MapTiles.draw sets up (canvas rotate, y down). */
function placed(view: MapViewport, w: number, h: number, level: number, ix: number, iy: number, u: number, v: number): [number, number] {
  const [ox, oy] = tileOffset(view, level, ix, iy);
  const k = view.scale / level;
  const [x, y] = [(ox + u) * k, (oy + v) * k];
  const [c, s] = [Math.cos(view.rotation), Math.sin(view.rotation)];
  return [w / 2 + x * c - y * s, h / 2 + x * s + y * c];
}

describe('map tiles', () => {
  it('uses the first zoom level at least as detailed as the view, so tiles only shrink', () => {
    expect(levelFor(0.6)).toBe(1);
    expect(levelFor(1)).toBe(1);
    expect(levelFor(1.3)).toBe(2);
    expect(levelFor(0.01)).toBe(LEVELS[0]);
    expect(levelFor(100)).toBe(LEVELS[LEVELS.length - 1]);
  });

  it('puts each tile where the map drawn directly would be, turned or not', () => {
    for (const rotation of [0, 0.7, -2.4]) {
      const view: MapViewport = { center: [123.4, -56.7], scale: 1.4, rotation };
      const level = levelFor(view.scale);
      const size = TILE / level;
      const [ix, iy] = [0, -1];
      // The tile's top-left pixel is its north-west corner; its bottom-right the south-east.
      const nw = toCanvas([ix * size, (iy + 1) * size], view, 400, 300);
      const se = toCanvas([(ix + 1) * size, iy * size], view, 400, 300);
      const [a, b] = [placed(view, 400, 300, level, ix, iy, 0, 0), placed(view, 400, 300, level, ix, iy, TILE, TILE)];
      expect(a[0]).toBeCloseTo(nw[0], 6);
      expect(a[1]).toBeCloseTo(nw[1], 6);
      expect(b[0]).toBeCloseTo(se[0], 6);
      expect(b[1]).toBeCloseTo(se[1], 6);
    }
  });

  it('covers the whole canvas with the tiles in view', () => {
    const view: MapViewport = { center: [500, 500], scale: 1.2, rotation: 0.5 };
    const level = levelFor(view.scale);
    const size = TILE / level;
    const tiles = tilesInView(view, 300, 300, level);
    // Every corner of the canvas falls in one of the tiles.
    for (const q of [[0, 0], [300, 0], [0, 300], [300, 300]] as const) {
      const hit = tiles.some(([ix, iy]) => {
        const a = placed(view, 300, 300, level, ix, iy, 0, 0);
        const b = placed(view, 300, 300, level, ix, iy, TILE, 0);
        const c = placed(view, 300, 300, level, ix, iy, 0, TILE);
        // Inside the tile's parallelogram: project onto its two sides.
        const [ux, uy, vx, vy] = [b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]];
        const [px, py] = [q[0] - a[0], q[1] - a[1]];
        const s = (px * ux + py * uy) / (ux * ux + uy * uy);
        const t = (px * vx + py * vy) / (vx * vx + vy * vy);
        return s >= -1e-9 && s <= 1 + 1e-9 && t >= -1e-9 && t <= 1 + 1e-9;
      });
      expect(hit, `corner ${q}`).toBe(true);
    }
    expect(tiles.length).toBeLessThan(Math.ceil((300 * Math.SQRT2) / (size * view.scale) + 2) ** 2);
  });
});
