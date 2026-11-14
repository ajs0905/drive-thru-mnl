/**
 * Drive mode: the physics world and the car. Loaded on demand (React.lazy in App.tsx),
 * so the physics engine's download (about 830 KB gzipped) only happens when the player
 * starts driving.
 *
 * The car appears on the road nearest to where the camera was looking, facing roughly
 * the way the camera faced. The ground is flat; buildings, walls, the playable edge and
 * posts (pillars, trunks, bollards) are one static triangle mesh built from the map when
 * driving starts (geometry/collision.ts, about 110 ms for BGC). Flyover decks become
 * drivable in the next step.
 */
import { useThree } from '@react-three/fiber';
import { CuboidCollider, Physics, RigidBody, TrimeshCollider } from '@react-three/rapier';
import { useMemo } from 'react';
import { Vector3 } from 'three';
import { headingOfDirection, spawnOnRoad, yawForHeading } from '../car/spawn';
import { SEDAN } from '../car/spec';
import { buildCollision } from '../geometry/collision';
import type { MapData } from '../map/types';
import { Car } from './Car';

/** Top of the physics ground: about where roads are drawn (0.16 to 0.24 m), so tires sit on them. */
const GROUND_Y = 0.2;
const GROUND_HALF = 6000;

export default function Drive({ map, onSpeed }: { map: MapData; onSpeed?: (speed: number) => void }) {
  const get = useThree((s) => s.get);
  // Decided once, when driving starts.
  const spawn = useMemo(() => {
    const { controls, camera } = get();
    const target = (controls as unknown as { target?: Vector3 } | null)?.target ?? new Vector3();
    const dir = camera.getWorldDirection(new Vector3());
    const facing = headingOfDirection(dir.x, dir.z);
    const s = spawnOnRoad(map, [target.x, -target.z], facing) ?? { p: [target.x, -target.z], heading: facing };
    return { position: [s.p[0], GROUND_Y + 0.3, -s.p[1]] as [number, number, number], yaw: yawForHeading(s.heading) };
  }, [map, get]);

  const solid = useMemo(() => buildCollision(map), [map]);

  return (
    // Stepped in the render loop just before other per-frame work (camera, wheels, shadow).
    <Physics timeStep={1 / 60} updatePriority={-1}>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[GROUND_HALF, 0.5, GROUND_HALF]} position={[spawn.position[0], GROUND_Y - 0.5, spawn.position[2]]} friction={1} />
        {/* Low friction so the car scrapes along walls instead of sticking to them. */}
        <TrimeshCollider args={[solid.vertices, solid.indices]} friction={0.2} restitution={0.1} />
      </RigidBody>
      <Car spec={SEDAN} spawn={spawn} onSpeed={onSpeed} />
    </Physics>
  );
}
