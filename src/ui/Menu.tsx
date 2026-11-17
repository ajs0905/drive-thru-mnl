/**
 * The main menu: the title board and three road signs over a still screenshot of the
 * city. It shows at once; the city loads behind it and the Play sign shows how far along
 * that is (the download, then building the city) until it turns into "PLAY".
 */
import { BACKDROP_PORTRAIT, PORTRAIT_QUERY } from './backdrop';
import { ArrowRight } from './icons';
import { APP_VERSION } from './version';

export interface LoadStatus {
  /** What's happening now, e.g. "Building 11,687 buildings". */
  step: string;
  /** Share done (0..1), or undefined when it can't be known (the bar shows stripes). */
  done: number | undefined;
  ready: boolean;
  error?: string;
}

export function Menu({ status, background, quality, onPlay, onSettings, onAbout }: { status: LoadStatus; background: string; quality: string; onPlay: () => void; onSettings: () => void; onAbout: () => void }) {
  return (
    <div className="menu">
      <picture>
        <source media={PORTRAIT_QUERY} srcSet={BACKDROP_PORTRAIT} />
        <img className="backdrop" src={background} alt="" draggable={false} fetchPriority="high" />
      </picture>
      <div className="inner">
        <Title />
        {status.error && <p className="error">{status.error}</p>}
        <div className="spacer" />
        <div className="buttons">
          {status.ready ? (
            <button type="button" className="sign play" onClick={onPlay} autoFocus>
              <span className="face">
                <span className="go">
                  PLAY
                  <ArrowRight size={56} />
                </span>
              </span>
            </button>
          ) : (
            <button type="button" className="sign play" disabled aria-label={`Play: ${status.step}`}>
              <span className="face">
                <span className="loading">
                  <span>LOADING BGC</span>
                  <span>{status.done === undefined ? '' : `${Math.round(status.done * 100)}%`}</span>
                </span>
                <span className={status.done === undefined ? 'bar busy' : 'bar'}>
                  <i style={{ width: `${Math.round((status.done ?? 0) * 100)}%` }} />
                </span>
                <span className="step">{status.step}</span>
              </span>
            </button>
          )}
          <div className="side">
            <button type="button" className="sign" onClick={onSettings}>
              <span className="face">SETTINGS</span>
            </button>
            <button type="button" className="sign blue" onClick={onAbout}>
              <span className="face">HOW IT&apos;S BUILT</span>
            </button>
          </div>
        </div>
        <div className="footer">
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            © OpenStreetMap contributors
          </a>
          <span>
            <span className="menu-tier">{quality.charAt(0).toUpperCase() + quality.slice(1)} quality · </span>v{APP_VERSION}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The game's name on an orange board, "NO TRAFFIC EDITION?" on the plate under it. */
export function Title() {
  return (
    <div className="title">
      <div className="board">
        <div>DRIVE THRU MNL</div>
      </div>
      <div className="plate">NO TRAFFIC EDITION?</div>
    </div>
  );
}
