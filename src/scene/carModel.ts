/**
 * Helpers for drawing the car: its model ready for the scene (with glowing lamps), and
 * a soft blob shadow.
 *
 * Lamps glow by their material's emissive color, not by real lights: headlights a soft
 * warm white, tail lights a dim red that flares while braking. Real light sources would
 * add shading work to every lit pixel of the city; beams that light up the road come
 * with night mode. Lamps skip tone mapping: the filmic curve squeezes saturated red
 * toward one ceiling, so a dim and a bright tail light would look the same.
 *
 * The car doesn't cast into the sun's shadow map: that map is re-rendered at most every
 * few frames while things move (Sun.tsx), so a fast car's shadow would trail behind it.
 * A blob under the car (darkest in the middle, fading out at the edges) follows it every
 * frame, works on Low where shadow maps are off, and costs one draw call. Buildings still
 * shade the car.
 */
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, type Object3D } from 'three';
import type { CarSpec, WheelName } from '../car/spec';

export interface CarModel {
  root: Group;
  wheels: Record<WheelName, Object3D>;
  lamps: { head: MeshLambertMaterial; tail: MeshLambertMaterial };
  dispose: () => void;
}

/** Lamp glow (emissive color and strength): headlights always on, tail lights dim, brighter when braking. */
export const LAMPS = {
  head: { color: '#fff1d0', intensity: 0.9 },
  tail: { color: '#ff2414', idle: 0.18, braking: 1.6 },
};

const WHEEL_NAMES: WheelName[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];

/** A copy of the loaded model with the city's flat Lambert look (colors are per vertex). */
export function prepareCarModel(scene: Object3D): CarModel {
  const root = new Group();
  root.add(scene.clone(true));
  const material = new MeshLambertMaterial({ vertexColors: true });
  const lamp = (color: string, intensity: number) =>
    new MeshLambertMaterial({ vertexColors: true, emissive: color, emissiveIntensity: intensity, toneMapped: false });
  const head = lamp(LAMPS.head.color, LAMPS.head.intensity);
  const tail = lamp(LAMPS.tail.color, LAMPS.tail.idle);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = mesh.name === 'headlights' ? head : mesh.name === 'taillights' ? tail : material;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
  });
  const wheels = {} as Record<WheelName, Object3D>;
  for (const name of WHEEL_NAMES) {
    const wheel = root.getObjectByName(name);
    if (!wheel) throw new Error(`car model has no ${name}`);
    wheel.rotation.order = 'YXZ'; // steer around the vertical, then spin around the axle
    wheels[name] = wheel;
  }
  return {
    root,
    wheels,
    lamps: { head, tail },
    dispose: () => [material, head, tail].forEach((m) => m.dispose()),
  };
}

/** Brake lights on or off. */
export function setBrakeLights(model: CarModel, on: boolean) {
  model.lamps.tail.emissiveIntensity = on ? LAMPS.tail.braking : LAMPS.tail.idle;
}

/**
 * Blob shadow geometry on the ground plane (y = 0), centered on the car: a rounded
 * rectangle a bit bigger than the car, opaque in the middle, transparent at the rim.
 * Colors are RGBA per vertex.
 */
export function blobShadowGeometry(width: number, length: number, darkness = 0.45, segments = 20): BufferGeometry {
  const ring = (scale: number) =>
    Array.from({ length: segments }, (_, i) => {
      const a = (i / segments) * Math.PI * 2;
      // Superellipse: boxy like a car, with rounded corners.
      const c = Math.cos(a);
      const s = Math.sin(a);
      const x = Math.sign(c) * Math.abs(c) ** 0.5 * (width / 2) * scale;
      const z = Math.sign(s) * Math.abs(s) ** 0.5 * (length / 2) * scale;
      return [x, z];
    });
  const inner = ring(0.75);
  const outer = ring(1.15);
  const pos: number[] = [0, 0, 0];
  const col: number[] = [0, 0, 0, darkness];
  for (const [x, z] of inner) {
    pos.push(x, 0, z);
    col.push(0, 0, 0, darkness);
  }
  for (const [x, z] of outer) {
    pos.push(x, 0, z);
    col.push(0, 0, 0, 0);
  }
  const index: number[] = [];
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    const [a, b] = [1 + i, 1 + j];
    const [c, d] = [1 + segments + i, 1 + segments + j];
    index.push(0, b, a, a, b, d, a, d, c); // counter-clockwise seen from above
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 4));
  g.setIndex(index);
  return g;
}

export function blobShadow(spec: CarSpec): Mesh<BufferGeometry, MeshBasicMaterial> {
  const geometry = blobShadowGeometry(spec.halfExtents[0] * 2, spec.halfExtents[2] * 2);
  const material = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    // Drawn just over the road surface without fighting it.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 1;
  return mesh;
}

/** Puts the blob shadow at a ground height under the car, turned with it; hidden when no wheel touches the ground. */
export function placeShadow(shadow: Mesh, x: number, groundY: number | null, z: number, yaw: number) {
  shadow.visible = groundY !== null;
  if (groundY === null) return;
  shadow.position.set(x, groundY + 0.04, z);
  shadow.rotation.set(0, yaw, 0);
}
