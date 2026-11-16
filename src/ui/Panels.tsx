/**
 * The sign-style panels over the menu and the pause screen: Settings (graphics quality),
 * How it's built (the numbers behind the map, and the repo), and the pause menu.
 */
import type { ReactNode } from 'react';
import type { MapData } from '../map/types';
import { QUALITIES, type Quality } from '../scene/quality';
import { Close } from './icons';

/** The repo, for "How it's built". */
const REPO_URL = 'https://github.com/ajs0905/drive-thru-mnl';

function Panel({ title, color = 'blue', onClose, children }: { title: string; color?: 'blue' | 'green'; onClose?: () => void; children: ReactNode }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className={`sign panel ${color === 'blue' ? 'blue' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="face">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h2>{title}</h2>
            {onClose && (
              <button type="button" className="round-btn" aria-label="Close" onClick={onClose}>
                <Close />
              </button>
            )}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

const QUALITY_NOTE: Record<Quality, string> = {
  low: 'For phones. No shadows or speed blur, simpler trees.',
  medium: 'Shadows, real trees, speed blur. Fine on most laptops.',
  high: 'Sharper shadows, everything drawn farther out. Needs a decent GPU.',
};

export function SettingsPanel({ quality, onQuality, onClose }: { quality: Quality; onQuality: (q: Quality) => void; onClose: () => void }) {
  return (
    <Panel title="SETTINGS" color="green" onClose={onClose}>
      <p>Graphics quality</p>
      <div className="row" role="group" aria-label="Graphics quality">
        {QUALITIES.map((q) => (
          <button key={q} type="button" className={q === quality ? 'chip on' : 'chip'} aria-pressed={q === quality} onClick={() => onQuality(q)}>
            {q}
          </button>
        ))}
      </div>
      <p>{QUALITY_NOTE[quality]} If the frame rate drops, the resolution goes down a bit on its own.</p>
    </Panel>
  );
}

const fmt = (n: number) => n.toLocaleString('en-US');

export function AboutPanel({ map, onClose }: { map: MapData | null; onClose: () => void }) {
  const s = map?.stats;
  const tagged = map ? map.buildings.filter((b) => b.hSrc !== 'estimate').length : 0;
  return (
    <Panel title="HOW IT'S BUILT" onClose={onClose}>
      <p>
        The streets, buildings and flyovers all come from OpenStreetMap. A pipeline turns that data into a city you can drive: it guesses building heights the map doesn&apos;t
        have, raises flyovers from bridge tags, paves the junctions, parks cars by rule, and every build gets checked by map QA.
      </p>
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
      <p>
        Code, docs and decisions: <a href={REPO_URL} target="_blank" rel="noreferrer">github.com/ajs0905/drive-thru-mnl</a>
      </p>
    </Panel>
  );
}

export function PauseMenu({ onResume, onReset, onHelp, onSettings, onQuit }: { onResume: () => void; onReset: () => void; onHelp: () => void; onSettings: () => void; onQuit: () => void }) {
  return (
    <Panel title="PAUSED" color="green">
      <div className="actions">
        <button type="button" className="chip on" onClick={onResume} autoFocus>
          Resume
        </button>
        <button type="button" className="chip" onClick={onReset}>
          Reset car
        </button>
        <button type="button" className="chip" onClick={onHelp}>
          How to play
        </button>
        <button type="button" className="chip" onClick={onSettings}>
          Settings
        </button>
        <button type="button" className="chip" onClick={onQuit}>
          Back to menu
        </button>
      </div>
    </Panel>
  );
}
