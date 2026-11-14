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
 * Each lamp also gets a halo: a soft round glow on a camera-facing sprite, added on top
 * of the scene (additive), so light seems to spill past the lamp. Tail halos grow and
 * brighten while braking. Halos fade out as their lamp turns away from the camera, so
 * headlights don't glow through the car seen from behind.
 *
 * The car doesn't cast into the sun's shadow map: that map is re-rendered at most every
 * few frames while things move (Sun.tsx), so a fast car's shadow would trail behind it.
 * A blob under the car (darkest in the middle, fading out at the edges) follows it every
 * frame, works on Low where shadow maps are off, and costs one draw call. Buildings still
 * shade the car.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  RGBAFormat,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Object3D,
} from 'three';
import type { CarSpec, WheelName } from '../car/spec';

export interface CarModel {
  root: Group;
  /** The body (with its lamps), posed separately from the wheels for pitch and roll. */
  body: Object3D;
  wheels: Record<WheelName, Object3D>;
  lamps: { head: MeshLambertMaterial; tail: MeshLambertMaterial };
  halos: { head: Sprite[]; tail: Sprite[] };
  dispose: () => void;
}

/** Halo size (m) and strength: tail halos dim and small, bigger and full while braking; headlights in between. */
export const HALO = {
  tail: { color: '#ff3a22', idle: { size: 0.55, opacity: 0.45 }, braking: { size: 1.25, opacity: 1 } },
  head: { color: '#fff1d0', size: 0.9, opacity: 0.7 },
  /** How far in front of the lamp face the glow sits (m). */
  offset: 0.08,
};

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
  const body = root.getObjectByName('body');
  if (!body) throw new Error('car model has no body');
  const glow = haloTexture();
  const haloMaterial = (color: string) =>
    new SpriteMaterial({ map: glow, color, blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
  const tailHalo = haloMaterial(HALO.tail.color);
  const headHalo = haloMaterial(HALO.head.color);
  const halos = {
    tail: addHalos(root.getObjectByName('taillights') as Mesh | undefined, tailHalo, -HALO.offset),
    head: addHalos(root.getObjectByName('headlights') as Mesh | undefined, headHalo, HALO.offset),
  };
  const wheels = {} as Record<WheelName, Object3D>;
  for (const name of WHEEL_NAMES) {
    const wheel = root.getObjectByName(name);
    if (!wheel) throw new Error(`car model has no ${name}`);
    wheel.rotation.order = 'YXZ'; // steer around the vertical, then spin around the axle
    wheels[name] = wheel;
  }
  return {
    root,
    body,
    wheels,
    lamps: { head, tail },
    halos,
    dispose: () => {
      [material, head, tail, tailHalo, headHalo].forEach((m) => m.dispose());
      glow.dispose();
    },
  };
}

/** Brake lights on or off. */
export function setBrakeLights(model: CarModel, on: boolean) {
  model.lamps.tail.emissiveIntensity = on ? LAMPS.tail.braking : LAMPS.tail.idle;
}

/**
 * Halo size and strength for this frame. `facingTail` and `facingHead` are how directly
 * the back and the front of the car face the camera (0..1).
 */
export function updateHalos(model: CarModel, braking: boolean, facingTail: number, facingHead: number) {
  const t = braking ? HALO.tail.braking : HALO.tail.idle;
  setHalos(model.halos.tail, t.size, t.opacity * Math.sqrt(Math.max(0, facingTail)));
  setHalos(model.halos.head, HALO.head.size, HALO.head.opacity * Math.sqrt(Math.max(0, facingHead)));
}

function setHalos(sprites: Sprite[], size: number, opacity: number) {
  for (const sprite of sprites) {
    sprite.scale.set(size, size, 1);
    sprite.material.opacity = opacity;
    sprite.visible = opacity > 0.01;
  }
}

/** Pitch and roll of the body (radians; see car/bodyMotion.ts). */
export function poseBody(model: CarModel, pitch: number, roll: number) {
  model.body.rotation.set(pitch, 0, roll);
}

/** A soft round glow: white, fully opaque in the middle, fading to nothing at the edge. */
export function haloTexture(size = 64): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const a = r >= 1 ? 0 : (1 - r) ** 2;
      data.set([255, 255, 255, Math.round(a * 255)], (y * size + x) * 4);
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Centers of the lamps on the car's left (+x) and right side, in the lamp mesh's frame. */
export function lampCenters(geometry: BufferGeometry): Vector3[] {
  const pos = geometry.getAttribute('position');
  const sums = [new Vector3(), new Vector3()];
  const counts = [0, 0];
  for (let i = 0; i < pos.count; i++) {
    const side = pos.getX(i) >= 0 ? 0 : 1;
    sums[side].add(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    counts[side]++;
  }
  return sums.flatMap((v, i) => (counts[i] > 0 ? [v.divideScalar(counts[i])] : []));
}

/** One halo sprite per lamp, `dz` meters in front of (or behind) it, attached to the lamp mesh. */
function addHalos(lamp: Mesh | undefined, material: SpriteMaterial, dz: number): Sprite[] {
  if (!lamp) return [];
  return lampCenters(lamp.geometry).map((c) => {
    const sprite = new Sprite(material);
    sprite.position.set(c.x, c.y, c.z + dz);
    sprite.renderOrder = 2;
    lamp.add(sprite);
    return sprite;
  });
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
