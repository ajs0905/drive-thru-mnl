/**
 * A run on the 2D map, for the modes menu and the run's intro: north up, fitted around the
 * route, the pickup, the drop-off and the car. Its tiles are kept between openings, so
 * they're drawn once, not every time a menu opens.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { MapViewData } from '../geometry/mapView';
import type { Point } from '../map/types';
import type { Route } from '../routing/route';
import { drawRoute, drawStop, MAP_COLORS, ROUTE_COLORS, toCanvas, type MapViewport } from './mapCanvas';
import { MapTiles } from './mapTiles';

/** The run on the map: north up, fitted around the route, the pickup, the drop-off and the car. */
export function RoutePreview({ view, route, toPickup, pickup, dropoff, car }: { view: MapViewData; route: Route | null; toPickup: Route | null; pickup?: Point; dropoff?: Point; car: Point | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Shared between openings of the menu, so its tiles are drawn once, not every time it opens.
  const tiles = useMemo(() => previewTiles(view, Math.min(2, window.devicePixelRatio || 1)), [view]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const [w, h] = [Math.round(el.clientWidth * dpr), Math.round(el.clientHeight * dpr)];
      if (!w || !h) return;
      if (el.width !== w || el.height !== h) [el.width, el.height] = [w, h];
      const ctx = el.getContext('2d');
      if (!ctx) return;
      const pts: Point[] = [...(route?.points ?? []), ...(toPickup?.points ?? []), ...[pickup, dropoff, car].filter((p): p is Point => !!p)];
      if (!pts.length) return;
      const [x0, x1] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
      const [y0, y1] = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
      const vp: MapViewport = { center: [(x0 + x1) / 2, (y0 + y1) / 2], scale: Math.min(w / Math.max(200, (x1 - x0) * 1.25), h / Math.max(200, (y1 - y0) * 1.25)), rotation: 0 };
      const complete = tiles.draw(ctx, vp, MAP_COLORS.outside, 6);
      if (toPickup) drawRoute(ctx, toPickup.points, toPickup.acc, 0, vp, 2.5 * dpr, 'rgba(255,255,255,0.55)');
      if (route) drawRoute(ctx, route.points, route.acc, 0, vp, 4 * dpr);
      if (pickup) drawStop(ctx, pickup, vp, 7 * dpr, ROUTE_COLORS.pickup);
      if (dropoff) drawStop(ctx, dropoff, vp, 7 * dpr, ROUTE_COLORS.dropoff);
      if (car) {
        const [cx, cy] = toCanvas(car, vp, w, h);
        ctx.fillStyle = '#ff7d22';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.arc(cx, cy, 5 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      if (!complete) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    const resize = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, [tiles, route, toPickup, pickup, dropoff, car]);
  return <canvas ref={canvas} className="route-preview" aria-label="The run on the map" />;
}

/** The preview's tiles, one cache per map (and screen density), kept while the map stays loaded. */
const previewCaches = new WeakMap<MapViewData, { dpr: number; tiles: MapTiles }>();
function previewTiles(view: MapViewData, dpr: number): MapTiles {
  const cached = previewCaches.get(view);
  if (cached?.dpr === dpr) return cached.tiles;
  const tiles = new MapTiles(view, (level) => ({ buildings: level > 0.6 * dpr, minRoadPx: 1.5 * dpr }), 64);
  previewCaches.set(view, { dpr, tiles });
  return tiles;
}
