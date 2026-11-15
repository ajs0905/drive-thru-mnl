/**
 * The driving HUD: the speed on a speed limit sign, the street you're on on a green street
 * sign (shown when it changes, then fading), and a heading-up minimap (tap or click it,
 * or press M, for the big map). Everything reads the car from the drive session in its
 * own animation loop, so the HUD never re-renders React every frame: the speed is
 * written straight into its element, the minimap redrawn about 20 times a second, and the
 * street looked up 4 times a second.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { headingUpRotation, type MapViewData } from '../geometry/mapView';
import type { Point } from '../map/types';
import type { DriveSession } from '../scene/driveSession';
import { CarArrow } from './icons';
import { drawMap, toCanvas, type MapViewport } from './mapCanvas';

/** Minimap: meters across, redraws per second; street sign: seconds shown. */
const HUD = { minimapMeters: 300, minimapFps: 20, streetEvery: 0.25, streetShown: 4 };

export function Hud({
  session,
  view,
  streetAt,
  onMap,
  touch,
  children,
}: {
  session: DriveSession;
  view: MapViewData;
  streetAt: (p: Point, raised?: boolean) => string | undefined;
  onMap: () => void;
  touch: boolean;
  /** Extra HUD parts (the touch controls). */
  children?: ReactNode;
}) {
  const speedEl = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const north = useRef<HTMLSpanElement>(null);
  const [street, setStreet] = useState<{ name: string; shown: boolean }>({ name: '', shown: false });

  useEffect(() => {
    const state = { frame: 0, lastDraw: 0, lastStreet: 0, name: '', since: 0, shown: false };
    const tick = (now: number) => {
      state.frame = requestAnimationFrame(tick);
      const car = session.car;
      if (!car.placed) return;
      if (speedEl.current) speedEl.current.textContent = String(Math.round(Math.abs(car.speed) * 3.6));
      const t = now / 1000;
      if (t - state.lastStreet >= HUD.streetEvery) {
        state.lastStreet = t;
        const name = streetAt([car.x, car.y], car.height > 3) ?? '';
        if (name && name !== state.name) {
          state.name = name;
          state.since = t;
          state.shown = true;
          setStreet({ name, shown: true });
        } else if (state.shown && t - state.since > HUD.streetShown) {
          state.shown = false;
          setStreet({ name: state.name, shown: false });
        }
      }
      if (t - state.lastDraw >= 1 / HUD.minimapFps) {
        state.lastDraw = t;
        drawMinimap(canvas.current, north.current, view, car);
      }
    };
    state.frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(state.frame);
  }, [session, view, streetAt]);

  return (
    <div className="hud2">
      <div className={street.shown ? 'sign street' : 'sign street hidden'} aria-live="polite">
        <div className="face">{street.name}</div>
      </div>
      {!touch && (
        <div className="pause-hint">
          <kbd>ESC</kbd> Pause
        </div>
      )}
      <button type="button" className="minimap" aria-label="Open the big map" onClick={onMap}>
        <canvas ref={canvas} />
        <CarArrow className="me" />
        <span ref={north} className="north" aria-hidden="true">
          N
        </span>
      </button>
      <div className="limit" role="status" aria-label="Speed in km/h">
        <b ref={speedEl}>0</b>
        <small>km/h</small>
      </div>
      {children}
    </div>
  );
}

/** One minimap frame: the map turned so the car points up, and the N marker on the rim where north is. */
function drawMinimap(canvas: HTMLCanvasElement | null, north: HTMLElement | null, data: MapViewData, car: { x: number; y: number; heading: number }) {
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const [w, h] = [Math.round(canvas.clientWidth * dpr), Math.round(canvas.clientHeight * dpr)];
  if (!w || !h) return;
  if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h];
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const view: MapViewport = { center: [car.x, car.y], scale: w / HUD.minimapMeters, rotation: headingUpRotation(car.heading) };
  drawMap(ctx, data, view, { buildings: true, minRoadPx: 2 * dpr });
  if (north) {
    const [nx, ny] = toCanvas([car.x, car.y + 1000], view, w, h);
    const a = Math.atan2(ny - h / 2, nx - w / 2);
    const r = 0.4;
    north.style.left = `${(0.5 + Math.cos(a) * r) * 100}%`;
    north.style.top = `${(0.5 + Math.sin(a) * r) * 100}%`;
  }
}
