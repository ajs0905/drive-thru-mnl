/**
 * Draws the map in 2D on a canvas: roads, buildings and the drivable edge. Only the
 * drivable area is drawn (everything is clipped to the edge, so roads cut off past it
 * don't show), with a soft shadow along the inside of the edge. The minimap and the big map don't call this every frame: they paste
 * cached tiles drawn with it (mapTiles.ts). Only what's in view is drawn
 * (geometry/mapView.ts buckets roads and buildings into grid cells).
 */
import { inView, type MapRoadKind, type MapViewData } from '../geometry/mapView';
import type { Point } from '../map/types';

export const MAP_COLORS = {
  ground: '#161c24',
  building: '#2a3340',
  edge: '#ff7d22',
  label: '#e8edf2',
  /** Outside the drivable area: plain dark. */
  outside: '#07090d',
  /** The shadow along the inside of the edge: strokes centered on it (meters wide, opacity), half of each clipped away. */
  edgeShadow: [
    [60, 0.14],
    [32, 0.16],
    [12, 0.2],
  ] as [number, number][],
  labelHalo: 'rgba(10,14,20,0.85)',
  road: { service: '#4f5964', minor: '#87929e', major: '#c9d1d9' } as Record<MapRoadKind, string>,
};

export interface MapViewport {
  /** Map point at the canvas center. */
  center: Point;
  /** Canvas pixels per map meter. */
  scale: number;
  /** Map rotation (radians): 0 = north up; heading-up views turn the map by headingUpRotation. */
  rotation: number;
}

export interface DrawOptions {
  buildings?: boolean;
  labels?: boolean;
  /** Smallest drawn road width (px), so thin streets stay visible zoomed out. */
  minRoadPx?: number;
}

/** Canvas pixel of a map point, for a canvas `w` x `h` (device pixels). */
export function toCanvas(p: Point, view: MapViewport, w: number, h: number): Point {
  const [dx, dy] = [p[0] - view.center[0], p[1] - view.center[1]];
  const [c, s] = [Math.cos(-view.rotation), Math.sin(-view.rotation)];
  const [rx, ry] = [dx * c - dy * s, dx * s + dy * c];
  return [w / 2 + rx * view.scale, h / 2 - ry * view.scale];
}

/** Map point of a canvas pixel (the inverse of toCanvas). */
export function toMap(q: Point, view: MapViewport, w: number, h: number): Point {
  const [rx, ry] = [(q[0] - w / 2) / view.scale, -(q[1] - h / 2) / view.scale];
  const [c, s] = [Math.cos(view.rotation), Math.sin(view.rotation)];
  return [view.center[0] + rx * c - ry * s, view.center[1] + rx * s + ry * c];
}

export function drawMap(ctx: CanvasRenderingContext2D, data: MapViewData, view: MapViewport, opts: DrawOptions = {}) {
  const { width: w, height: h } = ctx.canvas;
  const hasEdge = data.edge.length >= 3;
  ctx.fillStyle = hasEdge ? MAP_COLORS.outside : MAP_COLORS.ground;
  ctx.fillRect(0, 0, w, h);
  // The box of map space the canvas shows (its corners, whatever the rotation).
  const corners = [toMap([0, 0], view, w, h), toMap([w, 0], view, w, h), toMap([0, h], view, w, h), toMap([w, h], view, w, h)];
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const pad = 20;
  const [x0, y0, x1, y1] = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
  const near = inView(data, x0, y0, x1, y1);
  const edge = () => {
    ctx.beginPath();
    data.edge.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
  };

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(view.scale, -view.scale);
  ctx.rotate(-view.rotation);
  ctx.translate(-view.center[0], -view.center[1]);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (hasEdge) {
    // Everything from here on stays inside the edge.
    ctx.save();
    edge();
    ctx.clip();
    ctx.fillStyle = MAP_COLORS.ground;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  if (opts.buildings !== false) {
    ctx.fillStyle = MAP_COLORS.building;
    ctx.beginPath();
    for (const i of near.buildings) {
      const ring = data.buildings[i];
      ring.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
    }
    ctx.fill();
  }

  const minWidth = (opts.minRoadPx ?? 1.5) / view.scale;
  for (const i of near.roads) {
    const r = data.roads[i];
    ctx.strokeStyle = MAP_COLORS.road[r.kind];
    ctx.lineWidth = Math.max(minWidth, r.w * 0.9);
    ctx.beginPath();
    r.points.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.stroke();
  }

  if (hasEdge) {
    // A soft shadow along the inside of the edge (the outer half of each stroke is clipped).
    for (const [width, alpha] of MAP_COLORS.edgeShadow) {
      ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
      ctx.lineWidth = width;
      edge();
      ctx.stroke();
    }
    ctx.restore();
    // The edge itself: a thin solid line.
    ctx.strokeStyle = MAP_COLORS.edge;
    ctx.lineWidth = Math.max(2 / view.scale, 2.5);
    edge();
    ctx.stroke();
  }
  ctx.restore();

  if (opts.labels) drawLabels(ctx, data, view);
}

/** Street names, biggest streets first, skipping any that would overlap one already drawn. */
function drawLabels(ctx: CanvasRenderingContext2D, data: MapViewData, view: MapViewport) {
  const { width: w, height: h } = ctx.canvas;
  const dpr = Math.max(1, Math.min(3, w / Math.max(1, ctx.canvas.clientWidth || w)));
  const size = Math.round(12 * dpr);
  ctx.font = `700 ${size}px 'Overpass Variable', 'Helvetica Neue', Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const taken: { x: number; y: number; r: number }[] = [];
  for (const l of data.labels) {
    // Only names whose street is long enough on screen to hold them.
    const text = textWidth(ctx, l.name, size);
    if (l.length * view.scale < text * 1.6) continue;
    const [x, y] = toCanvas(l.p, view, w, h);
    if (x < -text || y < -size || x > w + text || y > h + size) continue;
    const r = text / 2 + size;
    if (taken.some((t) => Math.hypot(t.x - x, t.y - y) < t.r + r)) continue;
    taken.push({ x, y, r });
    let angle = -(l.angle - view.rotation);
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = MAP_COLORS.labelHalo;
    ctx.lineWidth = 4 * dpr;
    ctx.strokeText(l.name, 0, 0);
    ctx.fillStyle = MAP_COLORS.label;
    ctx.fillText(l.name, 0, 0);
    ctx.restore();
  }
}

/** Text widths by font size and text: measuring every street name on every frame was slow. */
const widths = new Map<string, number>();
function textWidth(ctx: CanvasRenderingContext2D, text: string, size: number): number {
  const key = `${size}|${text}`;
  let w = widths.get(key);
  if (w === undefined) {
    w = ctx.measureText(text).width;
    widths.set(key, w);
  }
  return w;
}

/** Draws only the street names (on top of the tiles, which have none: names stay upright and sharp at any zoom). */
export function drawMapLabels(ctx: CanvasRenderingContext2D, data: MapViewData, view: MapViewport) {
  drawLabels(ctx, data, view);
}
