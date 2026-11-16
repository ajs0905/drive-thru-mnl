/**
 * The welcome card: what there is to do and the controls (keys, or the touch layout on
 * phones), on road signs. It opens by itself on the very first drive, once the car has
 * landed (instead of the loading screen's "press any key"), and from the pause menu's
 * "How to play" any time.
 */
import { WELCOME_ROWS } from './drive';
import { Keys, TouchPicture } from './DriveLoading';

export function Welcome({ touch, first, onClose }: { touch: boolean; first: boolean; onClose: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="How to play">
      <div className="welcome">
        <div className="sign welcome-head">
          <div className="face">
            <b>HOW TO PLAY</b>
          </div>
        </div>
        <div className="welcome-body">
          <div className="sign blue welcome-what">
            <div className="face">
              {WELCOME_ROWS.map((r) => (
                <div key={r.title} className="welcome-row">
                  <h3>{r.title}</h3>
                  <p>{r.text}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="sign blue welcome-controls">
            <div className="face">
              <h3>CONTROLS</h3>
              {touch ? <TouchPicture /> : <Keys />}
            </div>
          </div>
        </div>
        <button type="button" className="sign welcome-go" onClick={onClose} autoFocus>
          <span className="face">{first ? "GOT IT, LET'S DRIVE" : 'BACK'}</span>
        </button>
      </div>
    </div>
  );
}
