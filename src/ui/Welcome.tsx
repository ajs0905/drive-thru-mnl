/**
 * How to play: what there is to do and the controls (the keys, or a sketch of the phone's
 * driving screen with every button where it is), on its own orange board with cream panels
 * (ui.css, "howto"). It opens by itself on the very first drive, once the car has landed
 * (instead of the loading screen's "press any key"), and from the pause menu any time.
 */
import { WELCOME_ROWS } from './drive';
import { Keys } from './DriveLoading';
import { Chevron, Handbrake, Pause, Reset } from './icons';

const PEACH = '#ffb07a';

/** The phone's driving screen: minimap and street sign at the top, reset and pause at the top right, steering bottom left, the speed sign in the middle, handbrake, brake and gas bottom right. */
function TouchMap() {
  return (
    <div className="touch-map" role="img" aria-label="The map at the top left, reset and pause at the top right, steering on the left, handbrake, brake and gas on the right">
      <span style={{ left: 6, top: 6 }}>
        <i style={{ width: 58, height: 36 }}>MAP</i>
      </span>
      <span style={{ left: '50%', top: 6, transform: 'translateX(-50%)' }}>
        <i style={{ padding: '3px 8px 1px', borderRadius: 4 }}>STREET</i>
      </span>
      <span style={{ right: 6, top: 6 }}>
        <i style={{ width: 34, height: 34 }} aria-label="Reset">
          <Reset size={15} color={PEACH} />
        </i>
        <i style={{ width: 34, height: 34 }} aria-label="Pause">
          <Pause size={13} color={PEACH} />
        </i>
      </span>
      <span style={{ left: 6, bottom: 6 }}>
        <i style={{ width: 40, height: 40 }}>
          <Chevron dir="left" size={16} color={PEACH} />
        </i>
        <i style={{ width: 40, height: 40 }}>
          <Chevron dir="right" size={16} color={PEACH} />
        </i>
      </span>
      <span style={{ left: '50%', bottom: 6, transform: 'translateX(-50%)' }}>
        <i className="round" style={{ width: 36, height: 36 }}>
          KM/H
        </i>
      </span>
      <span style={{ right: 6, bottom: 6 }}>
        <i className="round" style={{ width: 32, height: 32 }} aria-label="Handbrake">
          <Handbrake size={16} color={PEACH} />
        </i>
        <i style={{ width: 40, height: 40 }}>BRK</i>
        <i className="fill" style={{ width: 40, height: 58 }}>
          GAS
        </i>
      </span>
    </div>
  );
}

export function Welcome({ touch, first, onClose }: { touch: boolean; first: boolean; onClose: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="How to play">
      <div className="sign sheet howto">
        <div className="face">
          <div className="sheet-head">
            <h2>HOW TO PLAY</h2>
            <span className="grow" />
            <button type="button" className="go-btn" onClick={onClose} autoFocus>
              {first ? "GOT IT, LET'S DRIVE" : 'BACK'}
            </button>
          </div>
          <div className="sheet-body howto-body">
            <div className="howto-rows">
              {WELCOME_ROWS.map((r) => (
                <div key={r.title} className="howto-row">
                  <h3>{r.title}</h3>
                  <p>{r.text}</p>
                </div>
              ))}
            </div>
            <div className="howto-controls">
              <h3>CONTROLS</h3>
              {touch ? <TouchMap /> : <Keys />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
