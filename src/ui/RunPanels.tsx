/**
 * A run's cards over the paused game, as sheets (ui.css): the intro at the pickup (the
 * route on the map beside what, where to, how long, what it pays; START or CANCEL), and
 * the result: the courier's paper receipt (gross fee, integrity bonus, VAT, withholding,
 * take-home pay credited to the wallet) beside the numbers and what's next, or the failed
 * delivery. Enter is the main button, Esc the other.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { receipt } from '../game/cargo';
import type { GameSession } from '../game/session';
import type { MapViewData } from '../geometry/mapView';
import { clock, distance, pesos } from './format';
import { RoutePreview } from './RoutePreview';

/** The courier the runs are for (a made-up one), on the receipt. */
const COURIER = 'LalaDrop';

function useKeys(onEnter: () => void, onEscape: () => void) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        onEnter();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        onEscape();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onEnter, onEscape]);
}

export function RunIntro({ game, view, touch }: { game: GameSession; view: MapViewData; touch: boolean }) {
  useSyncExternalStore(game.subscribe, game.getVersion);
  const run = game.run;
  const start = () => game.begin();
  const cancel = () => game.abandon();
  useKeys(start, cancel);
  if (!run) return null;
  const [from, to] = [game.place(run.def.from), game.place(run.def.to)];
  const best = game.save.best[run.def.id];
  const top = receipt(run.def.kind, run.meters, run.target, run.target, 100).net;
  const route = game.plan(run.def.id)?.route ?? null;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={run.def.name}>
      <div className="sign blue sheet">
        <div className="face">
          <div className="sheet-body intro-body">
            <div className="map-box">
              <RoutePreview view={view} route={route} toPickup={null} pickup={run.pickup} dropoff={run.dropoff} car={null} />
              <div className="legend" aria-hidden="true">
                <span>
                  <i style={{ background: '#ffd23f' }} />
                  Pickup
                </span>
                <span>
                  <i style={{ background: '#2fe07f' }} />
                  Drop-off
                </span>
              </div>
              <p className="over">
                Follow the blue line and park in the green bay at the curb. Crashes hurt the cargo; slamming the brakes or drifting at speed only scuffs it.
                {run.def.kind === 'vault' ? ' This one is fragile, so it all counts a bit more.' : ''}
              </p>
            </div>
            <div className="intro-side">
              <span className={`tag ${run.def.kind}`}>{run.def.kind === 'vault' ? 'VAULT RUN' : 'COURIER RUN'}</span>
              <h2>{run.def.name.toUpperCase()}</h2>
              <p>
                {run.def.cargo} from <b>{from?.name}</b> to <b>{to?.name}</b>.
              </p>
              <div className="tiles">
                <div className="tile">
                  <b>{distance(run.meters)}</b>
                  <span>best route</span>
                </div>
                <div className="tile">
                  <b>{clock(run.target)}</b>
                  <span>to beat</span>
                </div>
                <div className="tile">
                  <b>{pesos(top)}</b>
                  <span>top pay</span>
                </div>
                <div className="tile">
                  <b>{best ? clock(best.time) : 'none yet'}</b>
                  <span>your best</span>
                </div>
              </div>
              <span className="grow" />
              <div className="start">
                <button type="button" className="chip on" onClick={start} autoFocus>
                  START
                </button>
                <button type="button" className="chip" onClick={cancel}>
                  CANCEL
                </button>
              </div>
              {!touch && <small className="keys-hint">Enter to start, Esc to cancel</small>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RunResult({ game, touch }: { game: GameSession; touch: boolean }) {
  useSyncExternalStore(game.subscribe, game.getVersion);
  const run = game.run;
  const close = () => game.closeResult();
  const retry = () => game.retry();
  useKeys(close, close);
  if (!run?.result) return null;
  const r = run.result.receipt;
  if (!r) {
    return (
      <div className="overlay" role="dialog" aria-modal="true" aria-label="Delivery failed">
        <div className="sign sheet small failed">
          <div className="face">
            <div className="sheet-head">
              <h2>DELIVERY FAILED</h2>
            </div>
            <p>{run.result.reason === 'destroyed' ? `The ${run.def.cargo.toLowerCase()} didn't survive the trip.` : `Took over ${clock(run.target * 2)}: the client gave up.`}</p>
            <div className="go">
              <button type="button" className="chip on" onClick={retry} autoFocus>
                TRY AGAIN
              </button>
              <button type="button" className="chip" onClick={close}>
                FREE ROAM{touch ? '' : ' (ESC)'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  const best = game.save.best[run.def.id];
  const newBest = best && Math.abs(best.time - run.time) < 1e-6;
  const [from, to] = [game.place(run.def.from), game.place(run.def.to)];
  const under = Math.round(run.target - run.time);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Delivery receipt">
      <div className="result">
        <div className="receipt">
          <header>
            <b>{COURIER}</b>
            <span>Delivery receipt · No. {String(game.save.runs).padStart(6, '0')}</span>
          </header>
          <div className="row">
            <span>Run</span>
            <span>{run.def.name}</span>
          </div>
          <div className="row">
            <span>Route</span>
            <span>
              {from?.name} to {to?.name}
            </span>
          </div>
          <div className="row">
            <span>Time / to beat</span>
            <span>
              {clock(run.time)} / {clock(run.target)}
            </span>
          </div>
          <hr />
          <ul>
            {r.lines.map((l) => (
              <li key={l.label}>
                <span>{l.label}</span>
                <span>{pesos(l.amount)}</span>
              </li>
            ))}
          </ul>
          <hr />
          <div className="net">
            <span>NET TAKE-HOME PAY</span>
            <span>{pesos(r.net)}</span>
          </div>
          <span className="grow" />
          <footer>Credited to your wallet. Thank you for driving with {COURIER}</footer>
        </div>
        <div className="sign sheet result-side">
          <div className="face">
            <div className="sheet-head">
              <h2>DELIVERED</h2>
              <span className="grow" />
              {newBest && <span className="tag best">NEW BEST</span>}
            </div>
            <div className="tiles">
              <div className="tile">
                <b>{clock(run.time)}</b>
                <span>{under >= 0 ? `${under} s under` : `${-under} s late`}</span>
              </div>
              <div className="tile">
                <b>{Math.round(run.integrity)}%</b>
                <span>cargo integrity</span>
              </div>
              <div className="tile">
                <b>{distance(run.meters)}</b>
                <span>delivered</span>
              </div>
              <div className="tile">
                <b>{pesos(game.save.pesos)}</b>
                <span>wallet now</span>
              </div>
            </div>
            <button type="button" className="chip on" onClick={close} autoFocus>
              CONTINUE{touch ? '' : ' (ENTER)'}
            </button>
            <button type="button" className="chip" onClick={retry}>
              RUN IT AGAIN
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
