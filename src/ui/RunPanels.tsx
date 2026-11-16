/**
 * A run's cards over the paused game: the intro at the pickup (what, where to, how long,
 * what it pays; START or CANCEL), and the result: a delivery receipt (gross fee, integrity
 * bonus, VAT, withholding, take-home pay credited to the wallet) or the failed delivery.
 * Enter is the main button, Esc the other.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { receipt } from '../game/cargo';
import type { GameSession } from '../game/session';
import { clock, distance, pesos } from './format';

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

export function RunIntro({ game, touch }: { game: GameSession; touch: boolean }) {
  useSyncExternalStore(game.subscribe, game.getVersion);
  const run = game.run;
  const start = () => game.begin();
  const cancel = () => game.abandon();
  useKeys(start, cancel);
  if (!run) return null;
  const [from, to] = [game.place(run.def.from), game.place(run.def.to)];
  const best = game.save.best[run.def.id];
  const top = receipt(run.def.kind, run.meters, run.target, run.target, 100).net;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={run.def.name}>
      <div className="sign panel run-card">
        <div className="face">
          <div className="run-title">
            <span className={`tag ${run.def.kind}`}>{run.def.kind === 'vault' ? 'VAULT RUN' : 'COURIER RUN'}</span>
            <h2>{run.def.name.toUpperCase()}</h2>
          </div>
          <p>
            {run.def.cargo} from <b>{from?.name}</b> to <b>{to?.name}</b>.
          </p>
          <dl>
            <dt>{distance(run.meters)}</dt>
            <dd>by the best route</dd>
            <dt>{clock(run.target)}</dt>
            <dd>to beat (late deliveries pay less)</dd>
            <dt>{pesos(top)}</dt>
            <dd>take-home pay, on time with the cargo perfect</dd>
            {best && (
              <>
                <dt>{clock(best.time)}</dt>
                <dd>your best ({pesos(best.net)})</dd>
              </>
            )}
          </dl>
          <p>
            Follow the blue line and park in the green bay at the curb. Crashes hurt the cargo; slamming the brakes or drifting at speed only scuffs it.{run.def.kind === 'vault' ? ' This one is fragile, so it all counts a bit more.' : ''}
          </p>
          <div className="row">
            <button type="button" className="chip on" onClick={start} autoFocus>
              START{touch ? '' : ' (ENTER)'}
            </button>
            <button type="button" className="chip" onClick={cancel}>
              CANCEL
            </button>
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
        <div className="sign panel run-card failed">
          <div className="face">
            <h2>DELIVERY FAILED</h2>
            <p>{run.result.reason === 'destroyed' ? `The ${run.def.cargo.toLowerCase()} didn't survive the trip.` : `Took over ${clock(run.target * 2)}: the client gave up.`}</p>
            <div className="row">
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
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Delivery receipt">
      <div className="receipt-wrap">
        <div className="receipt">
          <header>
            <b>BGC EXPRESS CARGO</b>
            <span>Delivery receipt · No. {String(game.save.runs).padStart(6, '0')}</span>
          </header>
          <div className="meta">
            <span>{run.def.name}</span>
            <span>{distance(run.meters)}</span>
            <span>
              {clock(run.time)} / {clock(run.target)}
              {newBest ? ' · BEST' : ''}
            </span>
            <span>Cargo {Math.round(run.integrity)}%</span>
          </div>
          <ul>
            {r.lines.map((l) => (
              <li key={l.label}>
                <span>{l.label}</span>
                <span>{pesos(l.amount)}</span>
              </li>
            ))}
          </ul>
          <div className="net">
            <span>NET TAKE-HOME PAY</span>
            <span>{pesos(r.net)}</span>
          </div>
          <footer>Credited to your wallet. Balance {pesos(game.save.pesos)}</footer>
        </div>
        <div className="row">
          <button type="button" className="chip on" onClick={close} autoFocus>
            CONTINUE{touch ? '' : ' (ENTER)'}
          </button>
          <button type="button" className="chip" onClick={retry}>
            RUN IT AGAIN
          </button>
        </div>
      </div>
    </div>
  );
}
