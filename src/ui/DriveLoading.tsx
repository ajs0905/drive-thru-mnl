/**
 * The screen between pressing Play and driving: a green exit-style sign for where the
 * car starts with the real loading steps ticking off, a blue sign with the controls
 * (keys, or the touch layout on phones), and a tip. Once everything is ready it waits for
 * a key or a tap, so there's time to read the controls, then fades into driving.
 */
import { DRIVE_STEPS } from './drive';
import { ArrowUp, Busy, Check, Handbrake, Todo } from './icons';

export function DriveLoading({
  step,
  waiting,
  hidden,
  touch,
  background,
  place,
  tip,
}: {
  /** Index of the step in progress; DRIVE_STEPS.length when all are done. */
  step: number;
  /** Everything's ready, waiting for the player. */
  waiting: boolean;
  /** Fading out. */
  hidden: boolean;
  touch: boolean;
  background: string;
  place: string;
  tip: string;
}) {
  const done = Math.min(step, DRIVE_STEPS.length) / DRIVE_STEPS.length;
  return (
    <div className={hidden ? 'loader out' : 'loader'} aria-live="polite">
      <img className="backdrop" src={background} alt="" draggable={false} />
      <div className="row">
        <div className="sign where">
          <div className="face">
            <div className="head">
              <div>
                <small>BGC</small>
                <b>{place.toUpperCase()}</b>
              </div>
              <ArrowUp size={44} />
            </div>
            <hr />
            <ul>
              {DRIVE_STEPS.map((label, i) => (
                <li key={label} className={i > step ? 'todo' : ''}>
                  {i < step ? <Check /> : i === step ? <Busy /> : <Todo />}
                  {label}
                </li>
              ))}
            </ul>
            {waiting ? (
              <div className="start">{touch ? 'TAP TO START' : 'PRESS ANY KEY TO START'}</div>
            ) : (
              <span className="bar">
                <i style={{ width: `${Math.round(done * 100)}%` }} />
              </span>
            )}
          </div>
        </div>
        <div className="sign blue controls">
          <div className="face">
            <h3>CONTROLS</h3>
            {touch ? <TouchPicture /> : <Keys />}
          </div>
        </div>
      </div>
      <div className="tip">TIP: {tip}</div>
    </div>
  );
}

export function Keys() {
  return (
    <div className="keys">
      <span className="caps">
        <kbd>W</kbd>
        <kbd>A</kbd>
        <kbd>S</kbd>
        <kbd>D</kbd>
      </span>
      <span>Drive (arrow keys work too)</span>
      <span className="caps">
        <kbd className="wide">SPACE</kbd>
      </span>
      <span>Handbrake and drift</span>
      <span className="caps">
        <kbd>R</kbd>
      </span>
      <span>Reset the car</span>
      <span className="caps">
        <kbd>M</kbd>
      </span>
      <span>Map</span>
      <span className="caps">
        <kbd>ESC</kbd>
      </span>
      <span>Pause</span>
    </div>
  );
}

export function TouchPicture() {
  return (
    <>
      <div className="touch-picture" aria-label="Steer with the buttons on the left, handbrake, brake and gas on the right, reset and pause at the top right" role="img">
        <div className="l">
          <span className="round" style={{ width: 34, height: 34 }}>
            ‹
          </span>
          <span className="round" style={{ width: 34, height: 34 }}>
            ›
          </span>
        </div>
        <div className="r">
          <span className="round" style={{ width: 30, height: 30 }}>
            <Handbrake size={16} />
          </span>
          <span style={{ width: 34, height: 30 }}>BRAKE</span>
          <span style={{ width: 30, height: 44 }}>GAS</span>
        </div>
        <div className="t">
          <span style={{ width: 22, height: 22 }}>R</span>
          <span style={{ width: 22, height: 22 }}>II</span>
        </div>
      </div>
      <span className="step">Steer on the left, pedals on the right</span>
    </>
  );
}
