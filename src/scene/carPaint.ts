/**
 * The parked-car models (public/models/parked-cars.glb) ready to draw as instances, and
 * their materials: shared by the parked cars and the traffic. Traffic also gets the
 * wheels split off (to spin and steer) and lamps that light up (car/carParts.ts).
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, InstancedBufferAttribute, MeshBasicMaterial, MeshLambertMaterial, ShaderMaterial, type Mesh, type Object3D } from 'three';
import { carParts, type CarParts } from '../car/carParts';
import { PARKED_MODELS } from '../car/parked';
import { restoreShine } from './carModel';
import { withCarShine } from './carShine';

/** Lambert with vertex colors where instance color replaces the painted parts, plus the shine. */
export function paintMaterial(): MeshLambertMaterial {
  return withCarShine(new MeshLambertMaterial({ vertexColors: true }), 'parked', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float paint;')
      // After three's own color code (vertex color times instance color): paint takes the
      // instance color outright, everything else keeps its vertex color.
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\n  vColor.rgb = mix(color.rgb, instanceColor.rgb, paint);\n#endif');
  });
}

/** The soft blob shadow under each car. */
export function blobMaterial(): MeshBasicMaterial {
  // Drawn just over the road surface without fighting it (like the player's blob).
  return new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}

/** One geometry per parked-car model (in PARKED_MODELS order), with its paint and shine attributes. */
export function parkedGeometries(scene: Object3D): BufferGeometry[] {
  return PARKED_MODELS.map((m) => {
    const mesh = scene.getObjectByName(m.name) as Mesh | undefined;
    if (!mesh) throw new Error(`parked-cars.glb has no ${m.name}`);
    const g = (mesh.geometry as BufferGeometry).clone();
    g.setAttribute('paint', g.getAttribute('_paint') ?? new BufferAttribute(new Float32Array(g.getAttribute('position').count), 1));
    g.deleteAttribute('_paint');
    restoreShine(g);
    return g;
  });
}

/** Lamp glow on traffic (emissive): headlights always on, tail lights dim, bright when braking (per car, the `brake` instance attribute). */
export const TRAFFIC_LAMPS = { head: [1, 0.93, 0.78], headStrength: 0.9, tail: [1, 0.05, 0.02], tailIdle: 0.3, tailBraking: 1.1 };

/** Like `paintMaterial`, plus lit lamp lenses (the `lamp` vertex attribute) and brake lights. */
export function trafficMaterial(): MeshLambertMaterial {
  const [h, t] = [TRAFFIC_LAMPS.head.map((v) => v.toFixed(3)).join(', '), TRAFFIC_LAMPS.tail.map((v) => v.toFixed(3)).join(', ')];
  return withCarShine(new MeshLambertMaterial({ vertexColors: true }), 'traffic', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float paint;\nattribute float lamp;\nattribute float brake;\nvarying float vLamp;\nvarying float vBrake;')
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\n  vColor.rgb = mix(color.rgb, instanceColor.rgb, paint);\n#endif\n  vLamp = lamp;\n  vBrake = brake;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLamp;\nvarying float vBrake;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  if (vLamp > 0.5 && vLamp < 1.5) totalEmissiveRadiance += vec3(${h}) * ${TRAFFIC_LAMPS.headStrength.toFixed(3)};
  else if (vLamp > 1.5) totalEmissiveRadiance += vec3(${t}) * mix(${TRAFFIC_LAMPS.tailIdle.toFixed(3)}, ${TRAFFIC_LAMPS.tailBraking.toFixed(3)}, vBrake);`,
      );
  });
}

export interface TrafficModels {
  /** Per model (PARKED_MODELS order): the body without its wheels, with `lamp`, and where its wheels and lamps are. */
  bodies: BufferGeometry[];
  parts: CarParts[];
  /** One wheel (the sedan's front left), centered on its axle, for every wheel of every model (they share the size). */
  wheel: BufferGeometry;
}

/** The traffic's geometries: bodies and one wheel. `brake` instance attributes are added for `count` cars. */
export function trafficGeometries(scene: Object3D, count: number): TrafficModels {
  const whole = parkedGeometries(scene);
  const parts: CarParts[] = [];
  const bodies = whole.map((g) => {
    const p = carParts(g.getAttribute('position').array, g.getAttribute('color').array, g.getAttribute('shine').array);
    parts.push(p);
    g.setAttribute('lamp', new BufferAttribute(p.lamp, 1));
    const body = pick(g, (t) => p.triangle[t] < 0);
    body.setAttribute('brake', new InstancedBufferAttribute(new Float32Array(Math.max(1, count)), 1));
    return body;
  });
  const wheel = pick(whole[0], (t) => parts[0].triangle[t] === 0);
  const [cx, cy, cz] = parts[0].wheels[0];
  wheel.translate(-cx, -cy, -cz);
  wheel.setAttribute('brake', new InstancedBufferAttribute(new Float32Array(Math.max(1, count * 4)), 1));
  for (const g of whole) g.dispose();
  return { bodies, parts, wheel };
}

/** A new non-indexed geometry with the triangles `keep` says yes to (all attributes). */
function pick(g: BufferGeometry, keep: (triangle: number) => boolean): BufferGeometry {
  const triangles = g.getAttribute('position').count / 3;
  const kept: number[] = [];
  for (let t = 0; t < triangles; t++) if (keep(t)) kept.push(t);
  const out = new BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const size = attr.itemSize;
    const src = attr.array as Float32Array;
    const dst = new Float32Array(kept.length * 3 * size);
    kept.forEach((t, k) => dst.set(src.subarray(t * 3 * size, (t + 1) * 3 * size), k * 3 * size));
    out.setAttribute(name, new BufferAttribute(dst, size));
  }
  return out;
}

/**
 * Soft lamp halos, one camera-facing quad per instance: the instance matrix gives the
 * center and the size (its scale), the instance color the brightness (added, so black is
 * off). Pulled `pull` meters toward the camera so the car's own body doesn't cut it.
 */
export function haloMaterial(pull = 0.35): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { pull: { value: pull } },
    vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
uniform float pull;
varying vec2 vUv;
varying vec3 vGlow;
void main() {
  vUv = uv;
  vGlow = instanceColor;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xyz += normalize(-mv.xyz) * pull;
  mv.xy += position.xy * length(instanceMatrix[0].xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
varying vec2 vUv;
varying vec3 vGlow;
void main() {
  #include <logdepthbuf_fragment>
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.2);
  gl_FragColor = vec4(vGlow * a, 1.0);
}`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
}
