/**
 * Helpers for drawing the car: its model ready for the scene (with glowing lamps and
 * shiny paint, glass and rims, see carShine.ts), and a soft blob shadow.
 *
 * Lamps glow by their material's emissive color, not by real lights: headlights a soft
 * warm white, tail lights a dim red that flares while braking. Real light sources would
 * add shading work to every lit pixel of the city; beams that light up the road come
 * with night mode. Lamps skip tone mapping: the filmic curve squeezes saturated red
 * toward one ceiling, so a dim and a bright tail light would look the same.
 *
 * Each lamp also gets a halo: a glow on a camera-facing sprite, added on top of the scene
 * (additive), so light seems to spill past the lamp. Headlights get a flare (a round core
 * with a thin horizontal streak, like a camera lens catches a lamp); tail halos are round
 * and grow and brighten while braking; the white reverse lights (built here, the model has
 * none) glow only while backing up. Halos fade out as their lamp turns away from the
 * camera, so headlights don't glow through the car seen from behind. Each halo is drawn
 * pulled toward the camera (`HALO.toward`): it used to sit just in front of its lamp and
 * the car's own bumper cut it off at most angles; buildings, always farther away than
 * that, still hide it.
 *
 * The car doesn't cast into the sun's shadow map: that map is re-rendered at most every
 * few frames while things move (Sun.tsx), so a fast car's shadow would trail behind it.
 * A blob under the car (darkest in the middle, fading out at the edges) follows it every
 * frame, works on Low where shadow maps are off, and costs one draw call. Buildings still
 * shade the car.
 */
import {
  AdditiveBlending,
  BoxGeometry,
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
import { withCarShine } from './carShine';

export interface CarModel {
  root: Group;
  /** The body (with its lamps), posed separately from the wheels for pitch and roll. */
  body: Object3D;
  wheels: Record<WheelName, Object3D>;
  lamps: { head: MeshLambertMaterial; tail: MeshLambertMaterial; reverse: MeshLambertMaterial };
  halos: { head: Sprite[]; tail: Sprite[]; reverse: Sprite[] };
  dispose: () => void;
}

/** Halo size (m) and strength: tail halos dim and small, bigger and full while braking; headlights in between. */
export const HALO = {
  tail: { color: '#ff3a22', idle: { size: 0.4, opacity: 0.3 }, braking: { size: 0.8, opacity: 0.65 } },
  /** Headlight flares: `size` is the core's height; the streak runs FLARE.aspect times as wide. */
  head: { color: '#fff1d0', size: 0.7, opacity: 0.75 },
  reverse: { color: '#ffffff', size: 0.45, opacity: 0.55 },
  /** How far in front of the lamp face the glow sits (m). */
  offset: 0.15,
  /** How far toward the camera the glow is drawn (m), so the car's own body never cuts it off. */
  toward: 0.6,
};

/** Lamp glow (emissive color and strength): headlights always on, tail lights dim, brighter when braking, reverse lights off unless backing up. */
export const LAMPS = {
  head: { color: '#fff1d0', intensity: 0.7 },
  tail: { color: '#ff2414', idle: 0.18, braking: 1.6 },
  reverse: { color: '#ffffff', lens: '#c9ced6', on: 1.4 },
};

/**
 * The reverse lights, in the body's frame (m): a small lens inboard of each tail light, on
 * the flat of the rear panel (the tail lights end at x = 0.49; the panel is at z = -2.143).
 */
export const REVERSE_LAMP = { x: 0.42, y: 0.4, z: -2.151, size: [0.12, 0.09, 0.014] as [number, number, number] };

/** The headlight flare texture: a round core and a horizontal streak, `aspect` times as wide as tall. */
export const FLARE = { aspect: 4, streak: { thickness: 0.06, strength: 0.55 } };

const WHEEL_NAMES: WheelName[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];

/** GLTF keeps custom attributes with a leading underscore: `_shine` back to `shine` (0 where missing). */
export function restoreShine(geometry: BufferGeometry) {
  if (geometry.getAttribute('shine')) return;
  const loaded = geometry.getAttribute('_shine');
  geometry.setAttribute('shine', loaded ?? new BufferAttribute(new Float32Array(geometry.getAttribute('position').count), 1));
  if (loaded) geometry.deleteAttribute('_shine');
}

/** A copy of the loaded model with the city's flat Lambert look (colors are per vertex), plus the shine. */
export function prepareCarModel(scene: Object3D): CarModel {
  const root = new Group();
  root.add(scene.clone(true));
  const material = withCarShine(new MeshLambertMaterial({ vertexColors: true }), 'player');
  const lamp = (color: string, intensity: number) =>
    new MeshLambertMaterial({ vertexColors: true, emissive: color, emissiveIntensity: intensity, toneMapped: false });
  const head = lamp(LAMPS.head.color, LAMPS.head.intensity);
  const tail = lamp(LAMPS.tail.color, LAMPS.tail.idle);
  const reverse = new MeshLambertMaterial({ color: LAMPS.reverse.lens, emissive: LAMPS.reverse.color, emissiveIntensity: 0, toneMapped: false });
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    restoreShine(mesh.geometry);
    mesh.material = mesh.name === 'headlights' ? head : mesh.name === 'taillights' ? tail : material;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
  });
  const body = root.getObjectByName('body');
  if (!body) throw new Error('car model has no body');
  const glow = haloTexture();
  const flare = flareTexture();
  const haloMaterial = (color: string, map: DataTexture) => towardCamera(new SpriteMaterial({ map, color, blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
  const tailHalo = haloMaterial(HALO.tail.color, glow);
  const headHalo = haloMaterial(HALO.head.color, flare);
  const reverseHalo = haloMaterial(HALO.reverse.color, glow);
  const taillights = root.getObjectByName('taillights') as Mesh | undefined;
  const lensGeometry = new BoxGeometry(...REVERSE_LAMP.size);
  const reverseLamps = taillights
    ? [1, -1].map((side) => {
        const lens = new Mesh(lensGeometry, reverse);
        lens.name = 'reverselight';
        lens.position.set(side * REVERSE_LAMP.x, REVERSE_LAMP.y, REVERSE_LAMP.z);
        lens.receiveShadow = true;
        taillights.add(lens);
        return lens;
      })
    : [];
  const halos = {
    tail: addHalos(taillights, tailHalo, -HALO.offset),
    head: addHalos(root.getObjectByName('headlights') as Mesh | undefined, headHalo, HALO.offset),
    reverse: reverseLamps.map((lens) => {
      const sprite = new Sprite(reverseHalo);
      sprite.position.set(lens.position.x, lens.position.y, lens.position.z - HALO.offset);
      sprite.renderOrder = 2;
      sprite.visible = false;
      taillights!.add(sprite);
      return sprite;
    }),
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
    lamps: { head, tail, reverse },
    halos,
    dispose: () => {
      [material, head, tail, reverse, tailHalo, headHalo, reverseHalo].forEach((m) => m.dispose());
      [glow, flare].forEach((t) => t.dispose());
      lensGeometry.dispose();
    },
  };
}

/** Brake lights on or off. */
export function setBrakeLights(model: CarModel, on: boolean) {
  model.lamps.tail.emissiveIntensity = on ? LAMPS.tail.braking : LAMPS.tail.idle;
}

/** Reverse lights on (backing up) or off. */
export function setReverseLights(model: CarModel, on: boolean) {
  model.lamps.reverse.emissiveIntensity = on ? LAMPS.reverse.on : 0;
}

/**
 * Halo size and strength for this frame. `facingTail` and `facingHead` are how directly
 * the back and the front of the car face the camera (0..1).
 */
export function updateHalos(model: CarModel, braking: boolean, facingTail: number, facingHead: number, reversing = false) {
  const t = braking ? HALO.tail.braking : HALO.tail.idle;
  setHalos(model.halos.tail, t.size, t.opacity * Math.sqrt(Math.max(0, facingTail)));
  setHalos(model.halos.head, HALO.head.size, HALO.head.opacity * Math.sqrt(Math.max(0, facingHead)), FLARE.aspect);
  setHalos(model.halos.reverse, HALO.reverse.size, reversing ? HALO.reverse.opacity * Math.sqrt(Math.max(0, facingTail)) : 0);
}

function setHalos(sprites: Sprite[], size: number, opacity: number, aspect = 1) {
  for (const sprite of sprites) {
    sprite.scale.set(size * aspect, size, 1);
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

/**
 * The headlight flare: a round core (height of the texture) and a thin horizontal streak
 * across the whole width, fading toward its ends. White; the sprite tints it.
 */
export function flareTexture(height = 32): DataTexture {
  const width = height * FLARE.aspect;
  const data = new Uint8Array(width * height * 4);
  const { thickness, strength } = FLARE.streak;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // In units of the texture's height, from the middle: u across, v up.
      const u = (x + 0.5 - width / 2) / height;
      const v = (y + 0.5 - height / 2) / height;
      const r = Math.hypot(u, v) / 0.5;
      const core = r >= 1 ? 0 : (1 - r) ** 2;
      const streak = strength * Math.exp(-((v / thickness) ** 2)) * Math.max(0, 1 - Math.abs(u) / (FLARE.aspect / 2)) ** 1.5;
      data.set([255, 255, 255, Math.round(Math.min(1, core + streak) * 255)], (y * width + x) * 4);
    }
  }
  const tex = new DataTexture(data, width, height, RGBAFormat);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** A halo material drawn HALO.toward meters closer to the camera than it is (same spot on screen). */
function towardCamera(material: SpriteMaterial): SpriteMaterial {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      'gl_Position = projectionMatrix * mvPosition;',
      `mvPosition.xyz += normalize( - mvPosition.xyz ) * min( ${HALO.toward.toFixed(2)}, 0.5 * length( mvPosition.xyz ) );
gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  material.customProgramCacheKey = () => 'halo-toward-camera';
  return material;
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
