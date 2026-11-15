/**
 * The big map, over the paused game: the whole drivable area north-up with street names,
 * the car as an arrow, drag to move, scroll or pinch to zoom. Opened with M or by tapping
 * the minimap; M, Esc, the close button or (on the menu side) Resume closes it.
 */
import { useEffect, useRef } from 'react';
import type { MapViewData } from '../geometry/mapView';
import type { Point } from '../map/types';
import type { DriveSession } from '../scene/driveSession';
import { CarArrow, Close } from './icons';
import { drawMap, toCanvas, toMap, type MapViewport } from './mapCanvas';

export function BigMap({ view, session, touch, onClose }: { view: MapViewData; session: DriveSession; touch: boolean; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const me = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    return startBigMap(el, me.current, view, session);
  }, [view, session]);

  return (
    <div className="bigmap" role="dialog" aria-modal="true" aria-label="Map">
      <canvas ref={canvas} />
      <div ref={me} className="me">
        <CarArrow style={{ width: '100%', height: '100%' }} />
      </div>
      <div className="bar-top">
        <span className="hint">{touch ? 'Drag to move, pinch to zoom' : 'Drag to move, scroll to zoom, M to close'}</span>
        <button type="button" className="round-btn" aria-label="Close the map" onClick={onClose} autoFocus>
          <Close />
        </button>
      </div>
    </div>
  );
}

/** Sets up drawing and the pan and zoom gestures; returns the cleanup. */
function startBigMap(el: HTMLCanvasElement, me: HTMLElement | null, data: MapViewData, session: DriveSession): () => void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const b = data.bounds;
  const car = session.car;
  const fit = () => Math.min(el.width / (b.maxX - b.minX), el.height / (b.maxY - b.minY));
  const view: MapViewport = { center: car.placed ? [car.x, car.y] : [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2], scale: 1, rotation: 0 };
  let frame = 0;
  const size = () => {
    const [w, h] = [Math.round(el.clientWidth * dpr), Math.round(el.clientHeight * dpr)];
    if (el.width !== w || el.height !== h) [el.width, el.height] = [w, h];
  };
  size();
  // Start with about 900 m across around the car, never closer than fits the whole map.
  view.scale = Math.max(fit(), Math.min(el.width, el.height) / 900);
  const clamp = () => {
    view.scale = Math.min(6 * dpr, Math.max(fit() * 0.9, view.scale));
    view.center = [Math.min(b.maxX, Math.max(b.minX, view.center[0])), Math.min(b.maxY, Math.max(b.minY, view.center[1]))];
  };
  const draw = () => {
    frame = 0;
    size();
    clamp();
    const ctx = el.getContext('2d');
    if (!ctx) return;
    drawMap(ctx, data, view, { buildings: view.scale > 0.6 * dpr, labels: true, minRoadPx: 1.5 * dpr });
    if (me) {
      const [x, y] = toCanvas([car.x, car.y], view, el.width, el.height);
      me.style.left = `${x / dpr}px`;
      me.style.top = `${y / dpr}px`;
      me.style.transform = `rotate(${Math.PI / 2 - car.heading}rad)`;
      me.style.display = car.placed ? '' : 'none';
    }
  };
  const redraw = () => {
    if (!frame) frame = requestAnimationFrame(draw);
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
  redraw();
  return () => {
    cancelAnimationFrame(frame);
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('wheel', wheel);
    window.removeEventListener('resize', redraw);
  };
}
