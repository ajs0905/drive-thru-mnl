/**
 * MODES / CARS, from the HUD's top right (or the pause menu), over the paused game, as
 * one sheet (ui.css): the tabs, the wallet and close in the header, two columns below.
 *
 * - Modes: pick a mode (Cargo Run; Kamote Mode is coming), then a run from the list on
 *   the left; the right shows it on the map (the route, the pickup and the drop-off, and
 *   where the car is) with what it pays. TELEPORT & START puts the car at the pickup and
 *   opens the run; DRIVE THERE sets a GPS route to the pickup instead.
 * - Cars: the one picked, big, with what it's like and what it costs, and all four to pick
 *   from beside it.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { receipt } from '../game/cargo';
import { CARS, type CarDef } from '../game/cars';
import type { GameSession } from '../game/session';
import type { MapViewData } from '../geometry/mapView';
import { CarPicture } from './CarPicture';
import { clock, distance, pesos, price } from './format';
import { Close } from './icons';
import { RoutePreview } from './RoutePreview';

type Tab = 'modes' | 'cars';

export function ModesMenu({ game, view, touch, onClose }: { game: GameSession; view: MapViewData; touch: boolean; onClose: () => void }) {
  useSyncExternalStore(game.subscribe, game.getVersion);
  const [tab, setTab] = useState<Tab>('modes');

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Modes and cars">
      <div className="sign blue sheet">
        <div className="face">
          <div className="sheet-head">
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'modes'} className={tab === 'modes' ? 'chip on' : 'chip'} onClick={() => setTab('modes')}>
                MODES
              </button>
              <button type="button" role="tab" aria-selected={tab === 'cars'} className={tab === 'cars' ? 'chip on' : 'chip'} onClick={() => setTab('cars')}>
                CARS
              </button>
            </div>
            {tab === 'modes' && (
              <>
                <i className="divider" aria-hidden="true" />
                <div className="tabs">
                  <span className="chip mode">CARGO RUN</span>
                  <span className="chip mode soon" aria-disabled="true">
                    KAMOTE <small>SOON</small>
                  </span>
                </div>
              </>
            )}
            <span className="grow" />
            <span className="wallet" aria-label="Wallet">
              {pesos(game.save.pesos)}
            </span>
            <button type="button" className="round-btn" aria-label="Close" onClick={onClose}>
              <Close />
            </button>
          </div>
          {tab === 'modes' ? <RunsTab game={game} view={view} touch={touch} onClose={onClose} /> : <CarsTab game={game} />}
        </div>
      </div>
    </div>
  );
}

function RunsTab({ game, view, touch, onClose }: { game: GameSession; view: MapViewData; touch: boolean; onClose: () => void }) {
  const runs = game.runs;
  const [pick, setPick] = useState(runs[0]?.id ?? '');
  const def = runs.find((r) => r.id === pick);
  const plan = def ? game.plan(def.id) : null;
  // Cheap (a fraction of a millisecond), and the menu only re-renders on a pick or a purchase.
  const toPickup = def ? game.routeToPickup(def.id) : null;
  const best = def ? game.save.best[def.id] : undefined;

  const go = (how: 'teleport' | 'drive') => {
    if (!def) return;
    if (how === 'teleport') game.teleportStart(def.id);
    else game.driveThere(def.id);
    onClose();
  };

  return (
    <div className="sheet-body modes-body">
      <ul className="run-list">
        {runs.map((r) => {
          const p = game.plan(r.id);
          return (
            <li key={r.id}>
              <button type="button" className={r.id === pick ? 'run on' : 'run'} onClick={() => setPick(r.id)}>
                <span className={`tag ${r.kind}`}>{r.kind === 'vault' ? 'VAULT' : 'COURIER'}</span>
                <b>{r.name}</b>
                <small>{p ? `${distance(p.route.length)} · ${clock(p.target)}` : 'no route'}</small>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="run-detail">
        <div className="map-box">
          <RoutePreview view={view} route={plan?.route ?? null} toPickup={toPickup} pickup={def ? game.place(def.from)?.p : undefined} dropoff={def ? game.place(def.to)?.p : undefined} car={game.lastCarPosition} />
          {def && plan && (
            <p className="over">
              {def.cargo}: <b>{game.place(def.from)?.name}</b> to <b>{game.place(def.to)?.name}</b>. Pays up to {pesos(receipt(def.kind, plan.route.length, plan.target, plan.target, 100).net)}
              {best ? `, your best ${clock(best.time)}` : ''}.
            </p>
          )}
        </div>
        <div className="go">
          <button type="button" className="chip on" disabled={!plan} onClick={() => go('teleport')} autoFocus={!touch}>
            TELEPORT &amp; START
          </button>
          <button type="button" className="chip" disabled={!plan || !toPickup} onClick={() => go('drive')}>
            DRIVE THERE{toPickup ? ` (${distance(toPickup.length)})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Where a car stands for the player: driving it, owned, on sale, or not out yet. */
function standing(game: GameSession, c: CarDef): { short: string; long: string; locked: boolean } {
  if (game.save.car === c.id) return { short: 'DRIVING', long: 'DRIVING', locked: false };
  if (game.save.cars.includes(c.id)) return { short: 'OWNED', long: 'OWNED', locked: false };
  if (!c.ready) return { short: price(c.price), long: `${price(c.price)} · ARRIVING SOON`, locked: true };
  return { short: price(c.price), long: price(c.price), locked: false };
}

function CarsTab({ game }: { game: GameSession }) {
  const [shown, setShown] = useState(game.save.car);
  const car = CARS.find((c) => c.id === shown) ?? CARS[0];
  const s = standing(game, car);
  const owned = game.save.cars.includes(car.id);
  return (
    <div className="sheet-body cars-body">
      <div className="car-detail">
        <CarPicture car={car} locked={s.locked} />
        <div className="about">
          <b>{car.name}</b>
          <p>{car.blurb}</p>
          <span className="state">{s.long}</span>
          {owned && game.save.car !== car.id && (
            <button type="button" className="chip on" onClick={() => game.updateSave((v) => ({ ...v, car: car.id }))}>
              DRIVE
            </button>
          )}
          {!owned && car.ready && (
            <button type="button" className="chip on" disabled={game.save.pesos < car.price} onClick={() => game.buy(car.id)}>
              BUY {price(car.price)}
            </button>
          )}
        </div>
      </div>
      <div className="car-grid">
        {CARS.map((c) => {
          const t = standing(game, c);
          return (
            <button key={c.id} type="button" className={c.id === car.id ? 'car-thumb on' : 'car-thumb'} aria-pressed={c.id === car.id} onClick={() => setShown(c.id)}>
              <CarPicture car={c} locked={t.locked} />
              <b>{c.name}</b>
              <small>{t.short}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}
