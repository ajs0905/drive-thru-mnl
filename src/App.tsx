import { MapControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadMap, type MapSource } from './map/loadMap';
import type { MapData } from './map/types';
import { City } from './scene/City';
import { PALETTE, type CityMeshes } from './scene/cityGeometry';
import {
  alwaysRender,
  dprFor,
  initialQuality,
  nextFactor,
  QUALITIES,
  QUALITY,
  saveQuality,
  supportsReversedDepth,
  type Quality,
} from './scene/quality';
import { Sky } from './scene/Sky';
import { Sun } from './scene/Sun';
import { Surroundings } from './scene/Surroundings';
import { SKY } from './scene/skyConfig';

// Checked once: reversed depth if the GPU has it, otherwise a logarithmic depth buffer.
const REVERSED_DEPTH = supportsReversedDepth();
// Frames are drawn only when something changes (camera moves, shadows catch up), unless ?render=always.
const ALWAYS_RENDER = alwaysRender();

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; map: MapData; source: MapSource };

interface Perf {
  fps: number;
  calls: number;
  triangles: number;
  /** Nothing drawn for a while (on-demand rendering with nothing changing). */
  idle: boolean;
}

const LEGEND: [string, string][] = [
  ['Towers / commercial', PALETTE.commercial],
  ['Residential', PALETTE.residential],
  ['Schools / civic', PALETTE.civic],
  ['Parks', PALETTE.park],
  ['Scenery (not drivable)', PALETTE.scenery],
  ['Playable edge', PALETTE.playableEdge],
];

/**
 * Reports each drawn frame's renderer stats. The renderer's counters are reset by hand
 * at the start of each frame (automatic resets are off, see onCreated), so they add up
 * every pass, shadow map included, not just the last one.
 */
function FrameProbe({ onFrame }: { onFrame: (calls: number, triangles: number) => void }) {
  // Runs before the frame renders: what's in the counters is the whole previous frame.
  useFrame(({ gl }) => {
    onFrame(gl.info.render.calls, gl.info.render.triangles);
    gl.info.reset();
  });
  return null;
}

/**
 * Adaptive resolution: averages the frame rate over runs of 30 consecutive frames and
 * nudges the performance factor (see nextFactor). Gaps between frames (idle, on-demand
 * rendering) are skipped, so not drawing doesn't look like being slow.
 */
function AdaptiveResolution({ factor, onChange }: { factor: number; onChange: (f: number) => void }) {
  const run = useRef({ frames: 0, time: 0 });
  useFrame((_, delta) => {
    const r = run.current;
    if (delta > 0.1) {
      r.frames = 0;
      r.time = 0;
      return;
    }
    r.frames++;
    r.time += delta;
    if (r.frames >= 30) {
      const next = nextFactor(factor, r.frames / r.time);
      r.frames = 0;
      r.time = 0;
      if (next !== factor) onChange(next);
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
  const [quality, setQuality] = useState<Quality>(initialQuality);
  const settings = QUALITY[quality];
  // Performance factor: 1 = full resolution for the tier, lower when FPS drops.
  const [factor, setFactor] = useState(1);
  const dpr = dprFor(settings.dpr, factor, window.devicePixelRatio || 1);
  const pickQuality = (q: Quality) => {
    saveQuality(q);
    setFactor(1);
    setQuality(q);
  };

  // Frame times and the latest stats, written every frame, read twice a second for the overlay.
  const frames = useRef<{ times: number[]; calls: number; triangles: number }>({ times: [], calls: 0, triangles: 0 });
  const onFrame = useCallback((calls: number, triangles: number) => {
    const f = frames.current;
    const now = performance.now();
    f.times.push(now);
    while (f.times.length && now - f.times[0] > 1000) f.times.shift();
    f.calls = calls;
    f.triangles = triangles;
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const f = frames.current;
      if (f.calls === 0) return;
      const now = performance.now();
      const recent = f.times.filter((t) => now - t <= 1000);
      // With on-demand rendering the frame rate means nothing while nothing moves: say so.
      const idle = !ALWAYS_RENDER && (f.times.length === 0 || now - f.times[f.times.length - 1] > 1500);
      setPerf({ fps: recent.length, calls: f.calls, triangles: f.triangles, idle });
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

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
          // A new canvas per quality: shadows and buffers are set up once, at creation.
          key={quality}
          camera={{ position: view.position, fov: 50, near: 1, far: 12000 }}
          frameloop={ALWAYS_RENDER ? 'always' : 'demand'}
          gl={{ reversedDepthBuffer: REVERSED_DEPTH, logarithmicDepthBuffer: !REVERSED_DEPTH, antialias: settings.msaa }}
          // PCF, not the default soft PCF: sharper and cheaper; the light is low-poly anyway.
          shadows={settings.shadowMap > 0 ? 'percentage' : false}
          dpr={dpr}
          onCreated={({ gl }) => {
            gl.toneMappingExposure = SKY.toneExposure;
            gl.info.autoReset = false; // PerfProbe resets once per frame, so stats cover every pass
          }}
        >
          <color attach="background" args={[SKY.horizon]} />
          <fog attach="fog" args={[SKY.horizon, 1800, 5500]} />
          {/* Lower the resolution when the frame rate drops, raise it again with headroom. */}
          <AdaptiveResolution factor={factor} onChange={setFactor} />
          <Sky clouds={settings.clouds} />
          <Sun shadowMap={settings.shadowMap} shadowEvery={settings.shadowEvery} />
          {/* Snappier damping: the camera settles in about 60 frames, then rendering stops until the next input. */}
          <MapControls
            makeDefault
            target={view.target}
            maxPolarAngle={Math.PI / 2.15}
            minDistance={40}
            maxDistance={6000}
            dampingFactor={0.12}
          />
          {state.status === 'ready' && <City map={state.map} onBuilt={onBuilt} propsDistance={settings.propsDistance} treeDistance={settings.treeDistance} />}
          {state.status === 'ready' && <Surroundings map={state.map} density={settings.filler} />}
          <FrameProbe onFrame={onFrame} />
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
            <div className="quality" role="group" aria-label="Graphics quality">
              Quality
              {QUALITIES.map((q) => (
                <button key={q} type="button" className={q === quality ? 'on' : ''} onClick={() => pickQuality(q)}>
                  {q}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {perf && (
        <div className="perf">
          {perf.idle ? 'idle (draws only when something changes)' : `${perf.fps.toFixed(0)} fps`} · {perf.calls} draw calls ·{' '}
          {fmt(perf.triangles)} tris
          {built && ` · built in ${built.ms.toFixed(0)} ms`}
        </div>
      )}

      <a className="attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        © OpenStreetMap contributors
      </a>
    </div>
  );
}
