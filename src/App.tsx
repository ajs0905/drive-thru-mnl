import { MapControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { loadMap, type MapSource } from './map/loadMap';
import type { MapData } from './map/types';
import { FitCamera } from './scene/FitCamera';
import { COLORS } from './scene/colors';
import { MapLines } from './scene/MapLines';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; map: MapData; source: MapSource };

const LEGEND: [string, string][] = [
  ['Major roads', COLORS.major],
  ['Minor roads', COLORS.minor],
  ['Service', COLORS.service],
  ['Paths', COLORS.path],
  ['Buildings', COLORS.building],
  ['Parks', COLORS.park],
  ['Water', COLORS.water],
];

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    loadMap()
      .then(({ map, source }) => setState({ status: 'ready', map, source }))
      .catch((err: Error) => setState({ status: 'error', message: err.message }));
  }, []);

  return (
    <div className="app">
      <Canvas orthographic camera={{ position: [0, 2000, 0.01], near: 1, far: 5000 }} dpr={[1, 2]}>
        <color attach="background" args={[COLORS.ground]} />
        <MapControls makeDefault enableRotate={false} screenSpacePanning={false} />
        {state.status === 'ready' && (
          <>
            <MapLines map={state.map} />
            <FitCamera bounds={state.map.bounds} />
          </>
        )}
      </Canvas>

      <div className="hud">
        <h1>
          Drive Thru MNL <span>No Traffic Edition</span>
        </h1>
        {state.status === 'loading' && <p>Loading map...</p>}
        {state.status === 'error' && <p className="warn">{state.message}</p>}
        {state.status === 'ready' && (
          <>
            {state.source === 'sample' && (
              <p className="warn">
                Sample data. Export BGC and run <code>npm run pipeline</code> for the real map.
              </p>
            )}
            <p className="stats">
              {state.map.stats.roads} roads, {state.map.stats.buildings} buildings, {state.map.stats.areas} areas
            </p>
            <ul className="legend">
              {LEGEND.map(([label, color]) => (
                <li key={label}>
                  <i style={{ background: color }} />
                  {label}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <a className="attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        © OpenStreetMap contributors
      </a>
    </div>
  );
}
