/**
 * The sign-style sheets over the menu and the pause screen (ui.css, "sheet"): Settings
 * (graphics quality, the stats line), How it's built (the numbers behind the map, and the
 * repo), and the pause menu.
 */
import type { ReactNode } from 'react';
import type { MapData } from '../map/types';
import { QUALITIES, QUALITY, type Quality, type QualitySettings } from '../scene/quality';
import { Chevron } from './icons';

/** The repo, for "How it's built". */
const REPO_URL = 'https://github.com/ajs0905/drive-thru-mnl';

/** A sheet with a title (and anything else) in its header and a close button, closing on a click outside it. */
function Sheet({ title, color = 'blue', head, onClose, children }: { title: string; color?: 'blue' | 'green'; head?: ReactNode; onClose?: () => void; children: ReactNode }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className={`sign sheet ${color === 'blue' ? 'blue' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="face">
          <div className="sheet-head">
            {onClose && (
              <button type="button" className="round-btn" aria-label="Back" onClick={onClose}>
                <Chevron dir="left" size={22} />
              </button>
            )}
            <h2>{title}</h2>
            {head}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/** What each quality tier changes, read from its settings. */
function tierLines(s: QualitySettings): [string, string][] {
  const pct = (n: number) => Math.round(n * 100);
  return [
    ['Shadows', s.shadowMap === 0 ? 'Off' : s.shadowMap < 2048 ? 'Soft' : 'Sharp'],
    ['Trees', s.treeModels ? 'Full' : 'Simple'],
    ['Traffic', `${s.traffic} cars`],
    ['Speed blur', s.speedBlur ? 'On' : 'Off'],
    ['Resolution', `${pct(s.dpr[0])} to ${pct(s.dpr[1])}%`],
  ];
}

const TIER_TAG: Record<Quality, string> = { low: 'PHONES', medium: 'MOST', high: 'FAST GPU' };

export function SettingsPanel({ quality, onQuality, stats, onStats, onClose }: { quality: Quality; onQuality: (q: Quality) => void; stats: boolean; onStats: (on: boolean) => void; onClose: () => void }) {
  return (
    <Sheet
      title="SETTINGS"
      color="green"
      onClose={onClose}
      head={
        <>
          <span className="note">GRAPHICS QUALITY</span>
          <span className="grow" />
          <label className="toggle">
            Show FPS &amp; render stats
            <input type="checkbox" checked={stats} onChange={(e) => onStats(e.target.checked)} />
          </label>
        </>
      }
    >
      <div className="sheet-body tiers" role="group" aria-label="Graphics quality">
        {QUALITIES.map((q) => (
          <button key={q} type="button" className={q === quality ? 'tier on' : 'tier'} aria-pressed={q === quality} onClick={() => onQuality(q)}>
            <span className="top">
              <b>{q.toUpperCase()}</b>
              <small>{TIER_TAG[q]}</small>
            </span>
            {tierLines(QUALITY[q]).map(([k, v]) => (
              <span key={k} className="line">
                <span>{k}</span>
                <b>{v}</b>
              </span>
            ))}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

const fmt = (n: number) => n.toLocaleString('en-US');

export function AboutPanel({ map, onClose }: { map: MapData | null; onClose: () => void }) {
  const s = map?.stats;
  const tagged = map ? map.buildings.filter((b) => b.hSrc !== 'estimate').length : 0;
  return (
    <Sheet title="HOW IT'S BUILT" onClose={onClose}>
      <div className="sheet-body about-body">
        <div className="text">
          <p>
            The streets, buildings and flyovers all come from OpenStreetMap. A pipeline turns that data into a city you can drive: it guesses building heights the map doesn&apos;t
            have, raises flyovers from bridge tags, paves the junctions, places the signs and parks cars by rule, and every build gets checked by map QA.
          </p>
          <p>
            Code, docs and decisions: <a href={REPO_URL} target="_blank" rel="noreferrer">github.com/ajs0905/drive-thru-mnl</a>
          </p>
        </div>
        {map && s && (
          <dl>
            <dt>{fmt(s.features)}</dt>
            <dd>OpenStreetMap features read</dd>
            <dt>{fmt(map.buildings.length)}</dt>
            <dd>buildings, {fmt(map.buildings.length - tagged)} with estimated heights</dd>
            <dt>{fmt(map.roads.length)}</dt>
            <dd>roads, {fmt(map.junctions.length)} junction polygons, {fmt(map.crossings.length)} zebra crossings</dd>
            {map.pillars && (
              <>
                <dt>{fmt(map.pillars.length)}</dt>
                <dd>pillars and posts under flyovers and canopies</dd>
              </>
            )}
            {map.parked && (
              <>
                <dt>{fmt(map.parked.length)}</dt>
                <dd>parked cars, placed by rule</dd>
              </>
            )}
          </dl>
        )}
      </div>
    </Sheet>
  );
}

export function PauseMenu({
  run,
  runName,
  onResume,
  onReset,
  onCheckpoint,
  onAbandon,
  onModes,
  onHelp,
  onSettings,
  onQuit,
  touch,
}: {
  /** The run in play's phase, if one is, and what it's called (for the header). */
  run: string | null;
  runName?: string;
  onResume: () => void;
  onReset: () => void;
  onCheckpoint: () => void;
  onAbandon: () => void;
  onModes: () => void;
  onHelp: () => void;
  onSettings: () => void;
  onQuit: () => void;
  touch: boolean;
}) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Paused">
      <div className="sign sheet">
        <div className="face">
          <div className="sheet-head">
            <h2>PAUSED</h2>
            {run && runName && <span className="note">On a run: {runName}</span>}
          </div>
          <div className="sheet-body pause-body">
            <button type="button" className="resume" onClick={onResume} autoFocus>
              <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5.5v13l10.5-6.5z" fill="#0b6b3a" />
              </svg>
              RESUME
              {!touch && <small>ESC</small>}
            </button>
            <div className="actions">
              {run === 'running' && (
                <button type="button" className="chip" onClick={onCheckpoint}>
                  BACK TO LAST CHECKPOINT
                </button>
              )}
              {run && (
                <button type="button" className="chip" onClick={onAbandon}>
                  ABANDON RUN
                </button>
              )}
              <button type="button" className="chip" onClick={onReset}>
                RESET CAR
              </button>
              <button type="button" className="chip" onClick={onModes}>
                MODES / CARS
              </button>
              <button type="button" className="chip" onClick={onHelp}>
                HOW TO PLAY
              </button>
              <button type="button" className="chip" onClick={onSettings}>
                SETTINGS
              </button>
              <button type="button" className="chip wide" onClick={onQuit}>
                BACK TO MAIN MENU
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
