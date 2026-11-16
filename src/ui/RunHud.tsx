/**
 * The run on the HUD: a banner under the street sign (where to drive, the clock against
 * the target, the cargo's condition, the distance left), the countdown's big numbers,
 * and short flashes ("GO!", "CHECKPOINT"). Re-renders only when the game session says
 * something changed (a few times a second while a run is on).
 */
import { useSyncExternalStore } from 'react';
import type { GameSession } from '../game/session';
import { clock, distance } from './format';

export function RunHud({ game }: { game: GameSession }) {
  useSyncExternalStore(game.subscribe, game.getVersion);
  const run = game.run;
  const gps = game.gps;
  const left = gps ? Math.max(0, gps.route.length - gps.s) : null;
  return (
    <>
      {run?.phase === 'to-pickup' && (
        <div className="run-banner">
          <span className="tag pickup">PICKUP</span>
          <span className="where">{game.place(run.def.from)?.name}</span>
          {left !== null && <b>{distance(left)}</b>}
        </div>
      )}
      {(run?.phase === 'running' || run?.phase === 'countdown') && (
        <div className="run-banner">
          <span className="tag dropoff">{run.def.kind === 'vault' ? 'VAULT' : 'CARGO'}</span>
          <span className="where">{game.place(run.def.to)?.name}</span>
          <b className={run.time > run.target ? 'late' : ''}>
            {clock(run.time)} <small>/ {clock(run.target)}</small>
          </b>
          <span className="integrity" aria-label={`Cargo ${Math.round(run.integrity)}%`}>
            <i style={{ width: `${run.integrity}%` }} className={run.integrity < 35 ? 'low' : ''} />
          </span>
          {left !== null && <b>{distance(left)}</b>}
        </div>
      )}
      {run?.phase === 'countdown' && (
        <div className="run-flash count" key={Math.ceil(run.countdown)}>
          {Math.ceil(run.countdown)}
        </div>
      )}
      {game.flash && run?.phase !== 'countdown' && (
        <div className="run-flash" key={game.flash.text + game.flash.until}>
          {game.flash.text}
        </div>
      )}
    </>
  );
}
