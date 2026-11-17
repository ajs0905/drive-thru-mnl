/**
 * The driving HUD: the speed on a speed limit sign, the street you're on on a green street
 * sign (shown when it changes, then fading), and a heading-up minimap (tap or click it,
 * or press M, for the big map). Everything reads the car from the drive session in its
 * own animation loop, so the HUD never re-renders React every frame: the speed is
 * written straight into its element, the minimap redrawn up to 20 times a second from cached
 * map tiles (mapTiles.ts), only when the car has moved or turned, and the
 * street looked up 4 times a second (when the sign shows: streetSign.ts).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GameSession } from '../game/session';
import { headingUpRotation, type MapViewData } from '../geometry/mapView';
import type { Point } from '../map/types';
import type { DriveSession } from '../scene/driveSession';
import { CarArrow } from './icons';
import { drawRoute, drawStop, MAP_COLORS, ROUTE_COLORS, type MapViewport } from './mapCanvas';
import { MapTiles } from './mapTiles';
import { RunHud } from './RunHud';
import { StreetSign } from './streetSign';

/** Minimap: meters across, redraws per second; street sign: seconds between lookups (when it shows: streetSign.ts). */
const HUD = { minimapMeters: 300, minimapFps: 20, streetEvery: 0.25 };

export function Hud({
  session,
  view,
  streetAt,
  onMap,
  onModes,
  game,
  touch,
  active = true,
  children,
}: {
  session: DriveSession;
  view: MapViewData;
  streetAt: (p: Point, raised?: boolean, heading?: number) => string | undefined;
  onMap: () => void;
  /** Opens the modes and cars menu. */
  onModes: () => void;
  /** The run in play and the GPS route, drawn on the minimap. */
  game: GameSession;
  touch: boolean;
  /** Off while the game is paused or a menu or the big map covers it: the minimap and the street sign stop updating (no animation frames). */
  active?: boolean;
  /** Extra HUD parts (the touch controls). */
  children?: ReactNode;
}) {
  const speedEl = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [street, setStreet] = useState<{ name: string; shown: boolean }>({ name: '', shown: false });
  const tiles = useMemo(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    return new MapTiles(view, () => ({ buildings: true, minRoadPx: 2 * dpr }), 48);
  }, [view]);

  useEffect(() => {
    if (!active) return;
    const state = { frame: 0, lastDraw: 0, lastStreet: 0, drawn: { x: NaN, y: 0, heading: 0, complete: false, version: -1 } };
    const sign = new StreetSign();
    const tick = (now: number) => {
      state.frame = requestAnimationFrame(tick);
      const car = session.car;
      if (!car.placed) return;
      if (speedEl.current) speedEl.current.textContent = String(Math.round(Math.abs(car.speed) * 3.6));
      const t = now / 1000;
      if (t - state.lastStreet >= HUD.streetEvery) {
        state.lastStreet = t;
        if (sign.update(streetAt([car.x, car.y], car.height > 3, car.heading), t)) setStreet({ name: sign.name, shown: sign.shown });
      }
      if (t - state.lastDraw >= 1 / HUD.minimapFps) {
        state.lastDraw = t;
        // Only when the car has moved or turned enough to see, or tiles are still missing.
        const d = state.drawn;
        if (!d.complete || d.version !== game.version || Math.hypot(car.x - d.x, car.y - d.y) > 0.25 || Math.abs(car.heading - d.heading) > 0.004) {
          Object.assign(d, { x: car.x, y: car.y, heading: car.heading, version: game.version, complete: drawMinimap(canvas.current, tiles, car, game) });
        }
      }
    };
    state.frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(state.frame);
  }, [session, tiles, streetAt, game, active]);

  return (
    <div className="hud2">
      <div className={street.shown ? 'sign street' : 'sign street hidden'} aria-live="polite">
        <div className="face">{street.name}</div>
      </div>
      <div className="hud-top-right">
        <button type="button" className="sign modes-btn" onClick={onModes}>
          <span className="face">MODES / CARS</span>
        </button>
        {!touch && (
          <div className="pause-hint">
            <kbd>ESC</kbd> Pause
          </div>
        )}
      </div>
      <RunHud game={game} />
      <button type="button" className="minimap" aria-label="Open the big map" onClick={onMap}>
        <canvas ref={canvas} />
        <CarArrow className="me" />
      </button>
      <div className="limit" role="status" aria-label="Speed in km/h">
        <b ref={speedEl}>0</b>
        <small>km/h</small>
      </div>
      {children}
    </div>
  );
}

/** One minimap frame: the map turned so the car points up, the GPS route and its stop. False if some tiles weren't drawn yet. */
function drawMinimap(canvas: HTMLCanvasElement | null, tiles: MapTiles, car: { x: number; y: number; heading: number }, game: GameSession): boolean {
  if (!canvas) return false;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const [w, h] = [Math.round(canvas.clientWidth * dpr), Math.round(canvas.clientHeight * dpr)];
  if (!w || !h) return false;
  if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h];
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const view: MapViewport = { center: [car.x, car.y], scale: w / HUD.minimapMeters, rotation: headingUpRotation(car.heading) };
  const complete = tiles.draw(ctx, view, MAP_COLORS.outside);
  const gps = game.gps;
  if (gps) {
    drawRoute(ctx, gps.route.points, gps.route.acc, gps.s, view, 4 * dpr);
    drawStop(ctx, gps.target, view, 6 * dpr, gps.kind === 'pickup' ? ROUTE_COLORS.pickup : ROUTE_COLORS.dropoff, 10 * dpr);
  } else if (game.run?.phase === 'intro' || game.run?.phase === 'countdown') drawStop(ctx, game.run.pickup, view, 6 * dpr, ROUTE_COLORS.pickup, 10 * dpr);
  return complete;
}
