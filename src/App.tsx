import { MapControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadMap, type MapSource } from './map/loadMap';
import type { MapData } from './map/types';
import { City } from './scene/City';
import { PALETTE, type CityMeshes } from './scene/cityGeometry';
import { Sky } from './scene/Sky';
import { SKY } from './scene/skyConfig';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; map: MapData; source: MapSource };

interface Perf {
  fps: number;
  calls: number;
  triangles: number;
}

const LEGEND: [string, string][] = [
  ['Towers / commercial', PALETTE.commercial],
  ['Residential', PALETTE.residential],
  ['Schools / civic', PALETTE.civic],
  ['Parks', PALETTE.park],
  ['Scenery (not drivable)', PALETTE.scenery],
  ['Playable edge', PALETTE.playableEdge],
];

/** Samples renderer stats once a second. */
function PerfProbe({ onSample }: { onSample: (p: Perf) => void }) {
  const gl = useThree((s) => s.gl);
  const acc = useRef({ frames: 0, since: 0 });
  useFrame(() => {
    const a = acc.current;
    const now = performance.now();
    if (a.since === 0) a.since = now;
    a.frames++;
    if (now - a.since >= 1000) {
      onSample({ fps: (a.frames * 1000) / (now - a.since), calls: gl.info.render.calls, triangles: gl.info.render.triangles });
      a.frames = 0;
      a.since = now;
    }
  });
  return null;
}

/** Starts the camera south-east of the playable area, looking at its center. */
function initialView(map: MapData) {
  const ring = map.playable;
  const b = map.bounds;
  let cx = (b.minX + b.maxX) / 2;
  let cy = (b.minY + b.maxY) / 2;
  if (ring?.length) {
    cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  }
  let target: [number, number, number] = [cx, 0, -cy];
  let position: [number, number, number] = [cx + 700, 1100, -cy + 1500];
  // Debug / screenshot helper: ?cam=x,y,z,tx,ty,tz (three.js coordinates)
  const cam = new URLSearchParams(window.location.search).get('cam')?.split(',').map(Number);
  if (cam?.length === 6 && cam.every(Number.isFinite)) {
    position = [cam[0], cam[1], cam[2]];
    target = [cam[3], cam[4], cam[5]];
  }
  return { target, position };
}

const fmt = (n: number) => n.toLocaleString('en-US');

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [perf, setPerf] = useState<Perf | null>(null);
  const [built, setBuilt] = useState<CityMeshes | null>(null);
  const onBuilt = useCallback((m: CityMeshes) => setBuilt(m), []);

  useEffect(() => {
    loadMap()
      .then(({ map, source }) => setState({ status: 'ready', map, source }))
      .catch((err: Error) => setState({ status: 'error', message: err.message }));
  }, []);

  const view = state.status === 'ready' ? initialView(state.map) : null;
  const stats = state.status === 'ready' ? state.map.stats : null;
  const estimated = state.status === 'ready' ? state.map.buildings.filter((b) => b.hSrc === 'estimate').length : 0;

  return (
    <div className="app">
      {view && (
        <Canvas
          camera={{ position: view.position, fov: 50, near: 1, far: 12000 }}
          gl={{ logarithmicDepthBuffer: true, antialias: true }}
          flat
          dpr={[1, 2]}
        >
          <color attach="background" args={[SKY.horizon]} />
          <fog attach="fog" args={[SKY.horizon, 1800, 5500]} />
          <Sky />
          <MapControls makeDefault target={view.target} maxPolarAngle={Math.PI / 2.15} minDistance={40} maxDistance={6000} />
          {state.status === 'ready' && <City map={state.map} onBuilt={onBuilt} />}
          <PerfProbe onSample={setPerf} />
        </Canvas>
      )}

      <div className="hud">
        <h1>
          Drive Thru MNL <span>No Traffic Edition</span>
        </h1>
        {state.status === 'loading' && <p>Loading map...</p>}
        {state.status === 'error' && <p className="warn">{state.message}</p>}
        {state.status === 'ready' && stats && (
          <>
            {state.source === 'sample' && (
              <p className="warn">
                Sample data. Run <code>npm run pipeline</code> for the real map.
              </p>
            )}
            <p className="stats">
              {stats.clip
                ? `${fmt(stats.clip.playableBuildings)} buildings + ${fmt(stats.clip.sceneryBuildings)} scenery`
                : `${fmt(stats.buildings)} buildings`}
              , {fmt(stats.roads)} roads
              <br />
              {fmt(estimated)} of {fmt(stats.buildings)} heights estimated (no OSM height tag)
            </p>
            <ul className="legend">
              {LEGEND.map(([label, color]) => (
                <li key={label}>
                  <i style={{ background: color }} />
                  {label}
                </li>
              ))}
            </ul>
            <p className="hint">Drag to pan, right-drag to rotate, scroll to zoom</p>
          </>
        )}
      </div>

      {perf && (
        <div className="perf">
          {perf.fps.toFixed(0)} fps · {perf.calls} draw calls · {fmt(perf.triangles)} tris
          {built && ` · built in ${built.ms.toFixed(0)} ms`}
        </div>
      )}

      <a className="attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        © OpenStreetMap contributors
      </a>
    </div>
  );
}
