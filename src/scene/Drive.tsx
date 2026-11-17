/**
 * Drive mode: the physics world and the car. Loaded on demand (React.lazy in App.tsx),
 * so the physics engine's download (about 830 KB gzipped) only happens when the player
 * starts driving.
 *
 * The car appears at `start` (Play starts at High Street), or, without one (the debug map
 * view), on the road nearest to where the camera was looking, facing roughly the way the
 * camera faced. `paused` stops the physics (loading screen, pause menu, big map). The ground is flat; everything else solid or drivable is
 * built from the map when driving starts (geometry/collision.ts) as two static triangle
 * meshes: walls (buildings, walls and fences, the playable edge), which the chase camera
 * keeps in front of, and structures (flyover decks and ramps, footbridge sides, posts).
 * Parked cars near the player are physics bodies too (ParkedPhysics.tsx), and so are the
 * roadblocks' cones, drums, barricades and signs. Traffic drives the avenues around the
 * player (Traffic.tsx), the traffic lights cycle (SignalLights.tsx), and the modes run
 * alongside (RunDriver.tsx). On tiers
 * that have it, fast driving blurs the screen's edges (SpeedBlur.tsx).
 */
import { useThree } from '@react-three/fiber';
import { CuboidCollider, Physics, RigidBody, TrimeshCollider, type RapierCollider, type RapierRigidBody } from '@react-three/rapier';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Vector3 } from 'three';
import { curbFinder } from '../car/curbSpot';
import { resetSpotFinder } from '../car/resetSpot';
import { headingOfDirection, spawnOnRoad, yawForHeading, type Spawn } from '../car/spawn';
import type { ResetPose } from '../car/vehicle';
import { restLift, SEDAN } from '../car/spec';
import { buildCollision } from '../geometry/collision';
import type { Dressing, MapData } from '../map/types';
import { Car } from './Car';
import { ROAD_Y } from './cityGeometry';
import { ParkedPhysics } from './ParkedPhysics';
import type { DriveSession } from './driveSession';
import type { ParkedPoses } from './parkedPoses';
import type { DebrisStore } from './breakaway';
import { PropPhysics } from './PropPhysics';
import { ROADBLOCK_POOL, ROADBLOCK_Y, type LooseProp } from './roadblockBodies';
import { RunDriver } from './RunDriver';
import { SignalLights } from './SignalLights';
import { Traffic } from './Traffic';
import { RunMarkers } from './RunMarkers';
import { SpeedBlur } from './SpeedBlur';
import type { GameSession } from '../game/session';

/** Top of the physics ground: about where roads are drawn (0.16 to 0.24 m), so tires sit on them. */
const GROUND_Y = 0.2;
const GROUND_HALF = 6000;

export default function Drive({
  map,
  parked,
  speedBlur = false,
  roadblocks,
  start,
  session,
  paused = false,
  props,
  game,
  traffic = 0,
  trafficNear = 90,
  signalsNear = 300,
}: {
  map: MapData;
  parked?: ParkedPoses;
  speedBlur?: boolean;
  /** The roadblocks' loose pieces and where moved ones are (shared with the renderer). */
  roadblocks?: { loose: LooseProp[]; poses: ParkedPoses };
  /** Where the car starts; nearest the camera's target if not given. */
  start?: Spawn | null;
  session?: DriveSession;
  paused?: boolean;
  /** Street furniture the car can knock over or break, and where moved pieces and debris are (shared with the renderer). */
  props?: { knock: Dressing[]; broke: Dressing[]; knockPoses: ParkedPoses; breakPoses: ParkedPoses; debris: DebrisStore };
  /** The modes (cargo runs): stepped every frame, and their markers drawn. */
  game?: GameSession;
  /** Cars of traffic to keep around the player (0: none), and how far (m) they're drawn as full models. */
  traffic?: number;
  trafficNear?: number;
  /** How far (m) the traffic lights' lamps are drawn lit (as far as the poles themselves). */
  signalsNear?: number;
}) {
  const get = useThree((s) => s.get);
  const speed = useRef(0);
  const reportSpeed = useCallback((v: number) => {
    speed.current = v;
  }, []);
  // Decided once, when driving starts.
  const spawn = useMemo(() => {
    if (start) return { position: [start.p[0], GROUND_Y + restLift(SEDAN), -start.p[1]] as [number, number, number], yaw: yawForHeading(start.heading) };
    const { controls, camera } = get();
    const target = (controls as unknown as { target?: Vector3 } | null)?.target ?? new Vector3();
    const dir = camera.getWorldDirection(new Vector3());
    const facing = headingOfDirection(dir.x, dir.z);
    const s = spawnOnRoad(map, [target.x, -target.z], facing) ?? { p: [target.x, -target.z], heading: facing };
    return { position: [s.p[0], GROUND_Y + restLift(SEDAN), -s.p[1]] as [number, number, number], yaw: yawForHeading(s.heading) };
  }, [map, get, start]);

  const solid = useMemo(() => buildCollision(map, { surfaceY: ROAD_Y }), [map]);
  // The reset key's open-road search (car/resetSpot.ts). Building it takes about 100 ms
  // on a desktop, so it's done a moment after the drive starts rather than while loading
  // (or right away, if the reset key comes first).
  const finder = useMemo(() => ({ find: null as ReturnType<typeof resetSpotFinder> | null }), []);
  const avoid = useMemo(() => (roadblocks?.loose ?? []).map((r) => r.p), [roadblocks]);
  useEffect(() => {
    const t = setTimeout(() => (finder.find ??= resetSpotFinder(map, avoid, curbFinder(map, avoid))), 2000);
    return () => clearTimeout(t);
  }, [map, finder, avoid]);
  const findReset = useMemo(
    () =>
      (x: number, y: number, z: number, heading: number): ResetPose | null => {
        finder.find ??= resetSpotFinder(map, avoid, curbFinder(map, avoid));
        const s = finder.find([x, -z], heading, Math.max(0, y - GROUND_Y));
        return s && { x: s.p[0], y: ROAD_Y[s.cls] + s.z, z: -s.p[1], yaw: yawForHeading(s.heading) };
      },
    [map, finder, avoid],
  );
  const spawnAt = useMemo((): [number, number] => [spawn.position[0], -spawn.position[2]], [spawn]);
  const walls = useRef<RapierCollider>(null);
  const carBody = useRef<RapierRigidBody>(null);

  return (
    // Stepped in the render loop just before other per-frame work (camera, wheels, shadow).
    <Physics timeStep={1 / 60} updatePriority={-1} paused={paused}>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[GROUND_HALF, 0.5, GROUND_HALF]} position={[spawn.position[0], GROUND_Y - 0.5, spawn.position[2]]} friction={1} />
        {/* Low friction so the car scrapes along walls instead of sticking to them. (Rapier can't build an empty mesh: the sample map has none.) */}
        {solid.walls.indices.length > 0 && <TrimeshCollider ref={walls} args={[solid.walls.vertices, solid.walls.indices]} friction={0.2} restitution={0.1} />}
        {/* Decks need road grip; their sides are thin enough that it barely matters. */}
        {solid.structures.indices.length > 0 && <TrimeshCollider args={[solid.structures.vertices, solid.structures.indices]} friction={1} restitution={0.1} />}
      </RigidBody>
      <Car spec={SEDAN} spawn={spawn} onSpeed={reportSpeed} cameraBlockers={walls} session={session} paused={paused} findReset={findReset} bodyRef={carBody} />
      {props && <PropPhysics knock={props.knock} broke={props.broke} knockPoses={props.knockPoses} breakPoses={props.breakPoses} debris={props.debris} spawn={spawnAt} car={carBody} />}
      {parked && map.parked && <ParkedPhysics cars={map.parked} poses={parked} spawn={spawnAt} />}
      {roadblocks && roadblocks.loose.length > 0 && (
        <ParkedPhysics cars={roadblocks.loose} poses={roadblocks.poses} spawn={spawnAt} options={ROADBLOCK_POOL} groundY={ROADBLOCK_Y} />
      )}
      {game && session && <RunDriver game={game} session={session} paused={paused} />}
      {game && <RunMarkers game={game} />}
      {game && map.dressing && <SignalLights game={game} pieces={map.dressing} near={signalsNear} paused={paused} knock={props?.knock} knockPoses={props?.knockPoses} />}
      {game && session && traffic > 0 && <Traffic game={game} map={map} count={traffic} near={trafficNear} car={carBody} />}
      {speedBlur && <SpeedBlur speed={speed} />}
    </Physics>
  );
}
