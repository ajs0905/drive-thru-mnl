/**
 * The map as cached image tiles, for the minimap and the big map. Drawing every road and
 * building in view as shapes on every frame (20 times a second on the minimap, every
 * step of a pan or zoom on the big map) cost frame time while driving; now each square
 * of the map is drawn once per zoom level (mapCanvas.ts's drawMap) into a small canvas,
 * and a frame only pastes the tiles in view, turned and scaled.
 *
 * Zoom levels double from 0.25 to 16 canvas pixels per meter; a view uses the first
 * level at least as detailed as itself, so tiles are only ever shrunk (sharp), by at most
 * half. Tiles are drawn with a pixel of overlap on every side, so no seams show between
 * them, and the least recently used ones are dropped past `max` (or twice what the view
 * needs, if that's more).
 */
import type { MapViewData } from '../geometry/mapView';
import { drawMap, toMap, type DrawOptions, type MapViewport } from './mapCanvas';

/** Tile size (canvas pixels, without the overlap) and the zoom levels (pixels per meter). */
export const TILE = 256;
const OVERLAP = 1;
export const LEVELS = [0.25, 0.5, 1, 2, 4, 8, 16];

/** The zoom level (pixels per meter) for a view's scale: the first at least as detailed. */
export function levelFor(scale: number): number {
  return LEVELS.find((l) => l >= scale) ?? LEVELS[LEVELS.length - 1];
}

/** The tiles (column, row) covering what a canvas `w` x `h` shows of the map at a level. */
export function tilesInView(view: MapViewport, w: number, h: number, level: number): [number, number][] {
  const corners = [toMap([0, 0], view, w, h), toMap([w, 0], view, w, h), toMap([0, h], view, w, h), toMap([w, h], view, w, h)];
  const size = TILE / level;
  const [x0, x1] = [Math.floor(Math.min(...corners.map((p) => p[0])) / size), Math.floor(Math.max(...corners.map((p) => p[0])) / size)];
  const [y0, y1] = [Math.floor(Math.min(...corners.map((p) => p[1])) / size), Math.floor(Math.max(...corners.map((p) => p[1])) / size)];
  const out: [number, number][] = [];
  for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) out.push([ix, iy]);
  return out;
}

/**
 * Where a tile goes on the canvas: the canvas transform is translate(w/2, h/2), rotate(rotation),
 * scale(scale / level), then the tile is drawn at this offset (its top-left corner, tile pixels).
 */
export function tileOffset(view: MapViewport, level: number, ix: number, iy: number): [number, number] {
  const size = TILE / level;
  return [level * (ix * size - view.center[0]), level * (view.center[1] - (iy + 1) * size)];
}

type TileCanvas = HTMLCanvasElement | OffscreenCanvas;

export class MapTiles {
  private cache = new Map<string, TileCanvas>();
  private readonly data: MapViewData;
  private readonly options: (level: number) => DrawOptions;
  private readonly max: number;

  /** `options` per level (buildings only when zoomed in, say); `max` tiles kept. */
  constructor(data: MapViewData, options: (level: number) => DrawOptions, max = 64) {
    this.data = data;
    this.options = options;
    this.max = max;
  }

  /**
   * Draws the view onto `ctx`. At most `budget` missing tiles are drawn per call (each is a
   * few milliseconds); returns false if some are still missing, so the caller can ask for
   * another frame.
   */
  draw(ctx: CanvasRenderingContext2D, view: MapViewport, background: string, budget = 4): boolean {
    const { width: w, height: h } = ctx.canvas;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    const level = levelFor(view.scale);
    let complete = true;
    const tiles = tilesInView(view, w, h, level);
    // Always room for everything in view, or tiles would push each other out every frame.
    const keep = Math.max(this.max, tiles.length * 2);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(view.rotation);
    ctx.scale(view.scale / level, view.scale / level);
    for (const [ix, iy] of tiles) {
      const key = `${level}/${ix}/${iy}`;
      let tile = this.cache.get(key);
      if (tile) {
        // Most recently used last.
        this.cache.delete(key);
        this.cache.set(key, tile);
      } else if (budget > 0) {
        budget--;
        tile = this.render(level, ix, iy);
        this.cache.set(key, tile);
        while (this.cache.size > keep) this.cache.delete(this.cache.keys().next().value!);
      } else {
        complete = false;
        continue;
      }
      const [x, y] = tileOffset(view, level, ix, iy);
      ctx.drawImage(tile, x - OVERLAP, y - OVERLAP);
    }
    ctx.restore();
    return complete;
  }

  private render(level: number, ix: number, iy: number): TileCanvas {
    const px = TILE + 2 * OVERLAP;
    const canvas: TileCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(px, px) : Object.assign(document.createElement('canvas'), { width: px, height: px });
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (!ctx) return canvas;
    const size = TILE / level;
    drawMap(ctx, this.data, { center: [(ix + 0.5) * size, (iy + 0.5) * size], scale: level, rotation: 0 }, this.options(level));
    return canvas;
  }
}
