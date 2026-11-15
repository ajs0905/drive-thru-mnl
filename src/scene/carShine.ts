/**
 * Car paint, glass and rims that catch the sky, on top of the city's flat Lambert look.
 *
 * Each car vertex has a `shine` value (baked by tools/car-to-glb.ts): 0 matte (tires,
 * trim, lamps), 1 glossy paint, 2 glass, 3 metal. Shiny parts reflect a simple sky:
 * a gradient from the haze color at the horizon up to blue overhead, and a dark ground
 * below, picked by the reflected view direction. No environment map, no extra pass: a
 * few math operations per car pixel, so it's the same on every quality tier.
 *
 * - Paint mixes in a little of the sky, much more at grazing angles (Fresnel), plus a
 *   small sharp glint toward the sun: reads as clear coat.
 * - Glass is mostly reflection: dark windows that show the sky on top and the street below.
 * - Metal (rims) reflects a lot, with a softer glint.
 */
import { Color, type Material, type WebGLProgramParametersWithUniforms } from 'three';
import { SKY } from './skyConfig';

export const CAR_SHINE = {
  /** The reflected sky: straight up, and the ground below the horizon (the haze color is in between). */
  zenith: '#7aa5d6',
  ground: '#4a4943',
  /** Paint: reflection facing the camera and at grazing angles, and the sun glint (strength, sharpness). */
  paint: { base: 0.05, grazing: 0.5, glint: 0.7, sharpness: 120 },
  glass: { base: 0.4, grazing: 0.5, glint: 1.2, sharpness: 200 },
  metal: { base: 0.45, grazing: 0.3, glint: 0.5, sharpness: 40 },
};

const vec3 = (hex: string) => {
  const c = new Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};
const num = (n: number) => n.toFixed(4);

/** GLSL for the shine, added to the end of a Lambert material's lighting. */
function shineChunk(): string {
  const s = SKY.sunDir;
  const [p, g, m] = [CAR_SHINE.paint, CAR_SHINE.glass, CAR_SHINE.metal];
  const pick = (k: 'base' | 'grazing' | 'glint' | 'sharpness') =>
    `(vShine < 1.5 ? ${num(p[k])} : vShine < 2.5 ? ${num(g[k])} : ${num(m[k])})`;
  return `
  if (vShine > 0.5) {
    vec3 shineN = normalize(normal);
    vec3 shineV = normalize(vViewPosition);
    vec3 shineR = transformDirectionByInverseViewMatrix(reflect(-shineV, shineN), viewMatrix);
    vec3 skyColor = shineR.y > 0.0
      ? mix(${vec3(SKY.horizon)}, ${vec3(CAR_SHINE.zenith)}, pow(shineR.y, 0.6))
      : mix(${vec3(SKY.horizon)}, ${vec3(CAR_SHINE.ground)}, min(1.0, -shineR.y * 5.0));
    float fresnel = pow(1.0 - clamp(dot(shineN, shineV), 0.0, 1.0), 4.0);
    float glint = pow(max(dot(shineR, vec3(${num(s.x)}, ${num(s.y)}, ${num(s.z)})), 0.0), ${pick('sharpness')});
    outgoingLight = mix(outgoingLight, skyColor, clamp(${pick('base')} + ${pick('grazing')} * fresnel, 0.0, 1.0))
      + ${vec3(SKY.sun)} * glint * ${pick('glint')};
  }
`;
}

/** Adds the shine to a Lambert shader (call from onBeforeCompile). */
export function addCarShine(shader: WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float shine;\nvarying float vShine;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShine = shine;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vShine;')
    .replace('#include <opaque_fragment>', `${shineChunk()}\n#include <opaque_fragment>`);
}

/** Makes a car material shiny (its geometry needs a `shine` attribute). */
export function withCarShine<M extends Material>(material: M, key: string, extra?: (shader: WebGLProgramParametersWithUniforms) => void): M {
  material.onBeforeCompile = (shader) => {
    extra?.(shader);
    addCarShine(shader);
  };
  material.customProgramCacheKey = () => `car-shine-${key}`;
  return material;
}
