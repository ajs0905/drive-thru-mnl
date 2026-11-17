/**
 * The big map, over the paused game: the whole drivable area north-up with street names,
 * the car as an arrow, and on a run (or on the way to one) the GPS route and the stop, to
 * plan a way there; drag to move, scroll or pinch to zoom. A highway-sign header names the
 * region and the district (MapData.district). Opened with M or by tapping the minimap; M,
 * Esc or the close button closes it.
 *
 * Opening and closing it while driving must not cost frames: it's mounted once and then
 * only shown and hidden (its full-screen canvas isn't made again each time), it draws only
 * while shown (no animation frames, no resize work while hidden), and its tiles are kept
 * between openings.
 */
import { useEffect, useRef } from 'react';
import type { GameSession } from '../game/session';
import type { MapViewData } from '../geometry/mapView';
import type { Point } from '../map/types';
import type { DriveSession } from '../scene/driveSession';
import { CarArrow, Close } from './icons';
import { drawMapLabels, drawRoute, drawStop, MAP_COLORS, ROUTE_COLORS, toCanvas, toMap, type MapViewport } from './mapCanvas';
import { MapTiles } from './mapTiles';

export function BigMap({
  view,
  session,
  game,
  touch,
  open,
  district,
  onClose,
}: {
  view: MapViewData;
  session: DriveSession;
  game: GameSession;
  touch: boolean;
  open: boolean;
  district?: { region: string; name: string };
  onClose: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const me = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const api = useRef<BigMapApi | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const started = startBigMap(el, me.current, view, session, game);
    api.current = started;
    return () => {
      started.dispose();
      api.current = null;
    };
  }, [view, session, game]);

  useEffect(() => {
    if (!open) {
      api.current?.hide();
      return;
    }
    api.current?.show();
    close.current?.focus();
  }, [open]);

  return (
    <div className="bigmap" role="dialog" aria-modal="true" aria-label="Map" hidden={!open}>
      <canvas ref={canvas} />
      <div ref={me} className="me">
        <CarArrow style={{ width: '100%', height: '100%' }} />
      </div>
      <div className="bar-top">
        <div className="sign region">
          <div className="face">
            <small>{(district?.region ?? 'Metro Manila').toUpperCase()}</small>
            <b>{(district?.name ?? '').toUpperCase()}</b>
          </div>
        </div>
        <span className="hint">{touch ? 'Drag to move, pinch to zoom' : 'Drag to move, scroll to zoom, M to close'}</span>
        <button ref={close} type="button" className="round-btn" aria-label="Close the map" onClick={onClose}>
          <Close />
        </button>
      </div>
    </div>
  );
}

interface BigMapApi {
  show: () => void;
  hide: () => void;
  dispose: () => void;
}

/** Sets up drawing and the pan and zoom gestures; nothing is drawn until `show`. */
function startBigMap(el: HTMLCanvasElement, me: HTMLElement | null, data: MapViewData, session: DriveSession, game: GameSession): BigMapApi {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const b = data.bounds;
  const car = session.car;
  const fit = () => Math.min(el.width / (b.maxX - b.minX), el.height / (b.maxY - b.minY));
  const view: MapViewport = { center: car.placed ? [car.x, car.y] : [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2], scale: 1, rotation: 0 };
  let frame = 0;
  // Buildings once zoomed in enough to make them out. Kept between openings of the map.
  const tiles = tilesFor(data, dpr);
  let shown = false;
  const size = () => {
    const [w, h] = [Math.round(el.clientWidth * dpr), Math.round(el.clientHeight * dpr)];
    if (w && h && (el.width !== w || el.height !== h)) [el.width, el.height] = [w, h];
  };
  const clamp = () => {
    view.scale = Math.min(6 * dpr, Math.max(fit() * 0.9, view.scale));
    view.center = [Math.min(b.maxX, Math.max(b.minX, view.center[0])), Math.min(b.maxY, Math.max(b.minY, view.center[1]))];
  };
  const draw = () => {
    frame = 0;
    if (!shown) return;
    size();
    clamp();
    const ctx = el.getContext('2d');
    if (!ctx) return;
    // Missing tiles are drawn a few per frame: keep going until they're all there.
    if (!tiles.draw(ctx, view, MAP_COLORS.outside, 8)) redraw();
    // The GPS route from where the car is on it, under the street names; the stop on top.
    const gps = game.gps;
    if (gps) drawRoute(ctx, gps.route.points, gps.route.acc, gps.s, view, 5 * dpr);
    drawMapLabels(ctx, data, view);
    if (gps) drawStop(ctx, gps.target, view, 8 * dpr, gps.kind === 'pickup' ? ROUTE_COLORS.pickup : ROUTE_COLORS.dropoff, 12 * dpr);
    else if (game.run?.phase === 'intro' || game.run?.phase === 'countdown') drawStop(ctx, game.run.pickup, view, 8 * dpr, ROUTE_COLORS.pickup, 12 * dpr);
    if (me) {
      const [x, y] = toCanvas([car.x, car.y], view, el.width, el.height);
      me.style.left = `${x / dpr}px`;
      me.style.top = `${y / dpr}px`;
      me.style.transform = `rotate(${Math.PI / 2 - car.heading}rad)`;
      me.style.display = car.placed ? '' : 'none';
    }
  };
  const redraw = () => {
    if (shown && !frame) frame = requestAnimationFrame(draw);
  };
  /** Zooms by `k` keeping the map point under (x, y) (CSS px) where it is. */
  const zoomAt = (k: number, x: number, y: number) => {
    const at = toMap([x * dpr, y * dpr], view, el.width, el.height);
    view.scale *= k;
    clamp();
    const moved = toMap([x * dpr, y * dpr], view, el.width, el.height);
    view.center = [view.center[0] + at[0] - moved[0], view.center[1] + at[1] - moved[1]];
    redraw();
  };

  const pointers = new Map<number, Point>();
  let pinch = 0;
  const down = (e: PointerEvent) => {
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      pinch = Math.hypot(p[0] - q[0], p[1] - q[1]);
    }
  };
  const move = (e: PointerEvent) => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    const now: Point = [e.offsetX, e.offsetY];
    pointers.set(e.pointerId, now);
    if (pointers.size === 1) {
      view.center = [view.center[0] - ((now[0] - last[0]) * dpr) / view.scale, view.center[1] + ((now[1] - last[1]) * dpr) / view.scale];
      redraw();
    } else if (pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (pinch > 0) zoomAt(d / pinch, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      pinch = d;
    }
  };
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    pinch = 0;
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY);
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', wheel, { passive: false });
  window.addEventListener('resize', redraw);
  let first = true;
  return {
    // Each time it opens: centered on the car again, at about 900 m across the first time (never closer than the whole map fits).
    show: () => {
      shown = true;
      size();
      if (car.placed) view.center = [car.x, car.y];
      if (first) view.scale = Math.max(fit(), Math.min(el.width, el.height) / 900);
      first = false;
      clamp();
      redraw();
    },
    hide: () => {
      shown = false;
      cancelAnimationFrame(frame);
      frame = 0;
      pointers.clear();
    },
    dispose: () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      window.removeEventListener('resize', redraw);
    },
  };
}

/** The big map's tiles, one cache per map (and screen density), kept while the map stays loaded. */
const tileCaches = new WeakMap<MapViewData, { dpr: number; tiles: MapTiles }>();
function tilesFor(data: MapViewData, dpr: number): MapTiles {
  const cached = tileCaches.get(data);
  if (cached?.dpr === dpr) return cached.tiles;
  const tiles = new MapTiles(data, (level) => ({ buildings: level > 0.6 * dpr, minRoadPx: 1.5 * dpr }), 96);
  tileCaches.set(data, { dpr, tiles });
  return tiles;
}
