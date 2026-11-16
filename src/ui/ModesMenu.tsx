/**
 * MODES / CARS, from the HUD's top right (or the pause menu), over the paused game.
 *
 * - Modes: pick a mode (Cargo Run; Kamote Mode is coming), then a run from the list on
 *   the left; the right shows it on the map (the route, the pickup and the drop-off, and
 *   where the car is) with what it pays. TELEPORT & START puts the car at the pickup and
 *   opens the run; DRIVE THERE sets a GPS route to the pickup instead.
 * - Cars: the lineup, what each costs in pesos from runs, and which one is driven.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { receipt } from '../game/cargo';
import { CARS } from '../game/cars';
import { CarPicture } from './CarPicture';
import type { GameSession } from '../game/session';
import type { MapViewData } from '../geometry/mapView';
import type { Point } from '../map/types';
import type { Route } from '../routing/route';
import { clock, distance, pesos, price } from './format';
import { Close } from './icons';
import { drawRoute, drawStop, MAP_COLORS, ROUTE_COLORS, toCanvas, type MapViewport } from './mapCanvas';
import { MapTiles } from './mapTiles';

type Tab = 'modes' | 'cars';

export function ModesMenu({ game, view, touch, onClose }: { game: GameSession; view: MapViewData; touch: boolean; onClose: () => void }) {
  useSyncExternalStore(game.subscribe, game.getVersion);
  const [tab, setTab] = useState<Tab>('modes');
  const runs = game.runs;
  const [pick, setPick] = useState(runs[0]?.id ?? '');
  const def = runs.find((r) => r.id === pick);
  const plan = def ? game.plan(def.id) : null;
  // Cheap (a fraction of a millisecond), and the menu only re-renders on a pick or a purchase.
  const toPickup = def ? game.routeToPickup(def.id) : null;
  const best = def ? game.save.best[def.id] : undefined;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const go = (how: 'teleport' | 'drive') => {
    if (!def) return;
    if (how === 'teleport') game.teleportStart(def.id);
    else game.driveThere(def.id);
    onClose();
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Modes and cars">
      <div className="sign blue modes">
        <div className="face">
          <div className="modes-head">
            <div className="row tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'modes'} className={tab === 'modes' ? 'chip on' : 'chip'} onClick={() => setTab('modes')}>
                MODES
              </button>
              <button type="button" role="tab" aria-selected={tab === 'cars'} className={tab === 'cars' ? 'chip on' : 'chip'} onClick={() => setTab('cars')}>
                CARS
              </button>
            </div>
            <span className="wallet" aria-label="Wallet">
              {pesos(game.save.pesos)}
            </span>
            <button type="button" className="round-btn" aria-label="Close" onClick={onClose}>
              <Close />
            </button>
          </div>

          {tab === 'modes' ? (
            <>
              <div className="row mode-pick">
                <span className="chip on">CARGO RUN</span>
                <span className="chip soon" aria-disabled="true">
                  KAMOTE MODE <small>SOON</small>
                </span>
              </div>
              <div className="modes-body">
                <ul className="run-list">
                  {runs.map((r) => {
                    const p = game.plan(r.id);
                    const b = game.save.best[r.id];
                    return (
                      <li key={r.id}>
                        <button type="button" className={r.id === pick ? 'run on' : 'run'} onClick={() => setPick(r.id)}>
                          <span className={`tag ${r.kind}`}>{r.kind === 'vault' ? 'VAULT' : 'COURIER'}</span>
                          <b>{r.name}</b>
                          <small>
                            {p ? `${distance(p.route.length)} · beat ${clock(p.target)}` : 'no route'}
                            {b ? ` · best ${clock(b.time)}` : ''}
                          </small>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="run-detail">
                  <RoutePreview view={view} route={plan?.route ?? null} toPickup={toPickup} pickup={def ? game.place(def.from)?.p : undefined} dropoff={def ? game.place(def.to)?.p : undefined} car={game.lastCarPosition} />
                  {def && plan && (
                    <p>
                      {def.cargo}: <b>{game.place(def.from)?.name}</b> to <b>{game.place(def.to)?.name}</b>. Pays up to {pesos(receipt(def.kind, plan.route.length, plan.target, plan.target, 100).net)}
                      {best ? `, your best ${clock(best.time)}` : ''}.
                    </p>
                  )}
                </div>
              </div>
              <div className="row go">
                <button type="button" className="chip on" disabled={!plan} onClick={() => go('teleport')} autoFocus={!touch}>
                  TELEPORT &amp; START
                </button>
                <button type="button" className="chip" disabled={!plan || !toPickup} onClick={() => go('drive')}>
                  DRIVE THERE{toPickup ? ` (${distance(toPickup.length)})` : ''}
                </button>
              </div>
            </>
          ) : (
            <ul className="car-list">
              {CARS.map((c) => {
                const owned = game.save.cars.includes(c.id);
                const driving = game.save.car === c.id;
                return (
                  <li key={c.id} className={driving ? 'car on' : c.ready ? 'car' : 'car soon'}>
                    <CarPicture car={c} />
                    <b>{c.name}</b>
                    <small>{c.blurb}</small>
                    {driving ? (
                      <span className="state">DRIVING</span>
                    ) : owned ? (
                      <button type="button" className="chip" onClick={() => game.updateSave((s) => ({ ...s, car: c.id }))}>
                        DRIVE
                      </button>
                    ) : !c.ready ? (
                      <span className="state">{price(c.price)} · ARRIVING SOON</span>
                    ) : (
                      <button type="button" className="chip" disabled={game.save.pesos < c.price} onClick={() => game.buy(c.id)}>
                        BUY {price(c.price)}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** The run on the map: north up, fitted around the route, the pickup, the drop-off and the car. */
function RoutePreview({ view, route, toPickup, pickup, dropoff, car }: { view: MapViewData; route: Route | null; toPickup: Route | null; pickup?: Point; dropoff?: Point; car: Point | null }) {
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
