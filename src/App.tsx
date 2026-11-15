import { MapControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { startSpot } from './car/spawn';
import { mapViewData, streetNameLookup } from './geometry/mapView';
import { loadMap, type MapSource } from './map/loadMap';
import { BACKDROP, backdropReady } from './ui/backdrop';
import type { MapData } from './map/types';
import { City } from './scene/City';
import { ParkedCars } from './scene/ParkedCars';
import { ParkedPoses } from './scene/parkedPoses';
import { Roadblocks } from './scene/Roadblocks';
import { roadblocksFor } from './geometry/roadblocks';
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
import { DriveSession } from './scene/driveSession';
import { BigMap } from './ui/BigMap';
import { STEP, tipFor } from './ui/drive';
import { DriveLoading } from './ui/DriveLoading';
import { Hud } from './ui/Hud';
import { Menu, type LoadStatus } from './ui/Menu';
import { AboutPanel, PauseMenu, SettingsPanel } from './ui/Panels';
import { useSideways } from './ui/sideways';
import { TouchControls } from './ui/TouchControls';
import './ui/ui.css';

// Drive mode and the physics engine load only when the player starts driving.
const loadDrive = () => import('./scene/Drive');
const Drive = lazy(loadDrive);

const PARAMS = new URLSearchParams(window.location.search);
/**
 * The debug map view (free camera, Enter drives from where it looks), for checking spots
 * from map QA's camera links: `?cam=...` or `?view=map`. Players get the menu.
 */
const MAP_VIEW = PARAMS.has('cam') || PARAMS.get('view') === 'map';
/** Frame rate, draw calls and triangles in a corner: `?debug` (and always in the map view). */
const DEBUG = MAP_VIEW || PARAMS.has('debug');
/** A phone or tablet: touch controls, and the touch version of the help. */
const TOUCH = window.matchMedia?.('(pointer: coarse)').matches ?? false;

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

/** Runs `fn` after the browser has painted what's on screen now (two animation frames). */
function afterPaint(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
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

/**
 * No right-click menu over the game (it offered to save or copy the 3D view as an image),
 * except on links, so they can still be opened in a new tab.
 */
function noContextMenu(e: MouseEvent) {
  if (!(e.target instanceof Element && e.target.closest('a'))) e.preventDefault();
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

type Screen = 'menu' | 'map' | 'drive';
type Panel = 'settings' | 'about' | null;

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [download, setDownload] = useState<{ done: number | undefined; bytes: number }>({ done: 0, bytes: 0 });
  const [perf, setPerf] = useState<Perf | null>(null);
  const [built, setBuilt] = useState<CityMeshes | null>(null);
  const onBuilt = useCallback((m: CityMeshes) => setBuilt(m), []);
  // The city is built only after the menu has shown "Building ...": the build blocks the page.
  const [buildNow, setBuildNow] = useState(false);
  // Where moved parked cars and roadblock pieces are: written by the physics while driving, read by the renderer.
  const [poses] = useState(() => new ParkedPoses());
  const [blockPoses] = useState(() => new ParkedPoses());
  const [session] = useState(() => new DriveSession());
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
    if (!DEBUG) return;
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
    loadMap((done, bytes) => setDownload({ done, bytes }))
      .then(({ map, source }) => {
        setState({ status: 'ready', map, source });
        // The backdrop first: the build keeps the page too busy to paint for a while.
        void backdropReady().then(() => afterPaint(() => setBuildNow(true)));
      })
      .catch((err: Error) => setState({ status: 'error', message: err.message }));
  }, []);

  const ready = state.status === 'ready';
  const map = state.status === 'ready' ? state.map : null;
  const cityReady = ready && built !== null;
  const status: LoadStatus = useMemo(() => {
    if (state.status === 'error') return { step: 'Could not load the map', done: 0, ready: false, error: state.message };
    if (state.status === 'loading') {
      const mb = (download.bytes / 1e6).toFixed(1);
      return { step: download.done === undefined ? `Downloading the map (${mb} MB)` : 'Downloading the map', done: download.done === undefined ? undefined : download.done * 0.7, ready: false };
    }
    if (!built) return { step: `Building ${fmt(state.map.buildings.length)} buildings and ${fmt(state.map.roads.length)} roads`, done: 0.8, ready: false };
    return { step: 'Ready', done: 1, ready: true };
  }, [state, download, built]);

  // Screens: the menu (or the debug map view), and driving with its loading screen, pause menu and big map.
  const [screen, setScreen] = useState<Screen>(MAP_VIEW ? 'map' : 'menu');
  const [panel, setPanel] = useState<Panel>(null);
  const [drive, setDrive] = useState({ step: STEP.engine as number, mounted: false, waiting: false, loaderShown: false, count: 0 });
  const [paused, setPaused] = useState(false);
  const [bigMap, setBigMap] = useState(false);
  const driving = screen === 'drive';
  const loading = driving && drive.step < STEP.done;
  const holdPhysics = loading || drive.waiting || paused || bigMap || panel !== null;

  const start = useMemo(() => (map ? startSpot(map) : null), [map]);
  const viewData = useMemo(() => (map ? mapViewData(map) : null), [map]);
  const streetAt = useMemo(() => (map ? streetNameLookup(map) : null), [map]);
  const roadblocks = useMemo(() => (map ? roadblocksFor(map) : null), [map]);

  const startDriving = useCallback(() => {
    // A focused button would be pressed again by the space bar (the handbrake).
    (document.activeElement as HTMLElement | null)?.blur();
    Object.assign(session.car, { placed: false, speed: 0 });
    session.releaseTouch();
    setPanel(null);
    setPaused(false);
    setBigMap(false);
    setDrive((d) => ({ step: STEP.engine, mounted: false, waiting: false, loaderShown: true, count: d.count + 1 }));
    setScreen('drive');
    // The loading screen painted first (with its backdrop), then the physics engine's
    // chunk, then the collisions (built when Drive mounts), then the car.
    void backdropReady(BACKDROP)
      .then(() => new Promise<void>((r) => afterPaint(r)))
      .then(loadDrive)
      .then(() => {
        setDrive((d) => ({ ...d, step: STEP.solid }));
        afterPaint(() => setDrive((d) => ({ ...d, mounted: true })));
      });
  }, [session]);

  const leaveDriving = useCallback(() => {
    session.releaseTouch();
    setPaused(false);
    setBigMap(false);
    setPanel(null);
    setDrive((d) => ({ ...d, mounted: false, loaderShown: false, waiting: false }));
    setScreen(MAP_VIEW ? 'map' : 'menu');
  }, [session]);

  // The car is placed once its first frame has run: then the loading screen waits for a
  // key or a tap (so there's time to read the controls) before it fades out.
  useEffect(() => {
    if (!driving || drive.step !== STEP.solid || !drive.mounted) return;
    let frame = 0;
    const watch = () => {
      if (session.car.placed) {
        setDrive((d) => ({ ...d, step: STEP.done, waiting: true, loaderShown: true }));
        return;
      }
      frame = requestAnimationFrame(watch);
    };
    frame = requestAnimationFrame(watch);
    return () => cancelAnimationFrame(frame);
  }, [driving, drive.step, drive.mounted, session]);

  const startPlaying = useCallback(() => {
    setDrive((d) => ({ ...d, waiting: false, loaderShown: false }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (screen === 'map' && e.code === 'Enter' && cityReady) return startDriving();
      if (!driving) {
        if (e.code === 'Escape') setPanel(null);
        return;
      }
      if (drive.waiting) {
        e.preventDefault();
        return startPlaying();
      }
      if (loading) return;
      if (e.code === 'Escape') {
        if (bigMap) setBigMap(false);
        else if (panel) setPanel(null);
        else setPaused((p) => !p);
      } else if (e.code === 'KeyM' && !paused && !panel) setBigMap((m) => !m);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, driving, loading, drive.waiting, bigMap, panel, paused, cityReady, startDriving, startPlaying]);

  // Phones held upright: the drive is drawn turned a quarter, the menu stays upright.
  const sideways = useSideways(driving && TOUCH);
  const view = map ? initialView(map) : null;
  const stats = map?.stats ?? null;
  const estimated = map ? map.buildings.filter((b) => b.hSrc === 'estimate').length : 0;

  return (
    <div className={TOUCH ? 'app touch' : 'app'} style={sideways} onContextMenu={noContextMenu}>
      {view && (
        <Canvas
          // A new canvas per quality: shadows and buffers are set up once, at creation.
          key={quality}
          camera={{ position: view.position, fov: 50, near: 1, far: 12000 }}
          // Driving draws every frame; otherwise only when something changes.
          frameloop={ALWAYS_RENDER || (driving && !paused && !bigMap) ? 'always' : 'demand'}
          gl={{ reversedDepthBuffer: REVERSED_DEPTH, logarithmicDepthBuffer: !REVERSED_DEPTH, antialias: settings.msaa }}
          // PCF, not the default soft PCF: sharper and cheaper; the light is low-poly anyway.
          shadows={settings.shadowMap > 0 ? 'percentage' : false}
          dpr={dpr}
          // Measured without CSS transforms, so the sideways phone layout keeps the right shape.
          resize={{ offsetSize: true }}
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
          {/*
            The map controls only take input in the debug map view. While driving they stay (their
            target follows the car, which the sun's shadows and the prop distances use), with their
            limits opened up so their per-frame update leaves the chase camera alone.
          */}
          <MapControls
            makeDefault
            target={view.target}
            enabled={screen === 'map'}
            enableDamping={!driving}
            maxPolarAngle={driving ? Math.PI : Math.PI / 2.15}
            minDistance={driving ? 0 : 40}
            maxDistance={6000}
            dampingFactor={0.12}
          />
          {map && buildNow && <City map={map} onBuilt={onBuilt} propsDistance={settings.propsDistance} treeDistance={settings.treeDistance} treeModels={settings.treeModels} showEdgeOutline={screen === 'map'} />}
          {map && built && <Surroundings map={map} density={settings.filler} />}
          {roadblocks && built && <Roadblocks props={roadblocks.props} loose={roadblocks.loose} poses={blockPoses} far={settings.parkedFar} shadows={settings.shadowMap > 0} />}
          {map?.parked && built && (
            <Suspense fallback={null}>
              <ParkedCars cars={map.parked} near={settings.parkedNear} far={settings.parkedFar} poses={poses} shadows={settings.shadowMap > 0} />
            </Suspense>
          )}
          <Suspense fallback={null}>
            {driving && drive.mounted && map && (
              <Drive
                map={map}
                parked={poses}
                speedBlur={settings.speedBlur}
                roadblocks={roadblocks ? { loose: roadblocks.loose, poses: blockPoses } : undefined}
                start={MAP_VIEW ? undefined : start}
                session={session}
                paused={holdPhysics}
              />
            )}
          </Suspense>
          <FrameProbe onFrame={onFrame} />
        </Canvas>
      )}

      {screen === 'map' && (
        <div className="hud">
          <h1>
            Drive Thru MNL <span>No Traffic Edition?</span>
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
                {stats.clip ? `${fmt(stats.clip.playableBuildings)} buildings + ${fmt(stats.clip.sceneryBuildings)} scenery` : `${fmt(stats.buildings)} buildings`}, {fmt(stats.roads)} roads
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
              <p className="hint">Map view (debug). Drag to pan, right-drag to rotate, scroll to zoom</p>
              <div className="drive">
                <button type="button" className="primary" onClick={startDriving} disabled={!cityReady}>
                  Drive here (Enter)
                </button>
              </div>
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
      )}

      {screen === 'menu' && (
        <Menu status={state.status === 'ready' && state.source === 'sample' && status.ready ? { ...status, error: 'Sample data. Run npm run pipeline for the real map.' } : status} background={BACKDROP} quality={quality} onPlay={startDriving} onSettings={() => setPanel('settings')} onAbout={() => setPanel('about')} />
      )}

      {driving && viewData && streetAt && drive.step === STEP.done && !drive.waiting && (
        <Hud session={session} view={viewData} streetAt={streetAt} onMap={() => setBigMap(true)} touch={TOUCH}>
          {TOUCH && !paused && !bigMap && !panel && <TouchControls session={session} onPause={() => setPaused(true)} />}
        </Hud>
      )}

      {driving && drive.loaderShown && (
        <div onPointerDown={drive.waiting ? startPlaying : undefined}>
          <DriveLoading step={drive.step} waiting={drive.waiting} hidden={false} touch={TOUCH} background={BACKDROP} place="High Street" tip={tipFor(TOUCH, drive.count - 1)} />
        </div>
      )}

      {driving && bigMap && viewData && <BigMap view={viewData} session={session} touch={TOUCH} onClose={() => setBigMap(false)} />}

      {driving && paused && !panel && (
        <PauseMenu
          onResume={() => setPaused(false)}
          onReset={() => {
            session.requestReset();
            setPaused(false);
          }}
          onSettings={() => setPanel('settings')}
          onQuit={leaveDriving}
        />
      )}

      {panel === 'settings' && <SettingsPanel quality={quality} onQuality={pickQuality} onClose={() => setPanel(null)} />}
      {panel === 'about' && <AboutPanel map={map} onClose={() => setPanel(null)} />}

      {DEBUG && perf && (
        <div className={screen === 'map' ? 'perf' : 'perf debug'}>
          {perf.idle ? 'idle (draws only when something changes)' : `${perf.fps.toFixed(0)} fps`} · {perf.calls} draw calls · {fmt(perf.triangles)} tris
          {built && ` · built in ${built.ms.toFixed(0)} ms`}
        </div>
      )}

      {screen !== 'menu' && (
        <a className="attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap contributors
        </a>
      )}
    </div>
  );
}
