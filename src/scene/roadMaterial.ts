/**
 * Road shader: a Lambert material that paints markings from per-vertex data instead
 * of textures. Each vertex carries roadAux = [u, v, half, mark]:
 *   u     meters along the road (dashes)
 *   v     meters across from the centerline, left positive (lines)
 *   half  half the road width (edge lines, lane spacing)
 *   mark  style packed by markCode() in src/geometry/road.ts
 *
 * Modes: 0 plain asphalt (junctions, paths), 1 lane markings, 2 zebra crossing
 * (white bars on the road's asphalt color, covering lane lines), 3 sidewalk (curb
 * and slab joints).
 * Lines fade out once they get thinner than a pixel, so distant roads don't shimmer.
 */
import { MeshLambertMaterial } from 'three';
import { hexToRgb, srgbToLinear } from '../geometry/meshBuilder';
import { PALETTE } from './cityGeometry';

const vec3 = (hex: string) => `vec3(${srgbToLinear(hexToRgb(hex)).map((c) => c.toFixed(4)).join(', ')})`;

const FUNCTIONS = /* glsl */ `
varying vec4 vRoadAux;

// Coverage of a line of width w centered at c, antialiased.
float roadLine(float x, float c, float w) {
  float aa = max(fwidth(x), 1e-4);
  float d = abs(x - c);
  return clamp((w * 0.5 - d) / aa + 0.5, 0.0, 1.0) * min(1.0, w / aa);
}

// 1 on the dash, 0 in the gap; blends to the average coverage when dashes get tiny.
float roadDash(float u, float period, float duty) {
  float f = fract(u / period);
  float aa = max(fwidth(u) / period, 1e-4);
  float on = smoothstep(0.0, aa, f) * (1.0 - smoothstep(duty - aa, duty, f));
  return mix(on, duty, clamp(aa * 4.0 - 1.0, 0.0, 1.0));
}
`;

const PAINT = /* glsl */ `
{
  float u = vRoadAux.x;
  float v = vRoadAux.y;
  float h = vRoadAux.z;
  float code = floor(vRoadAux.w + 0.5);
  float mode = mod(code, 4.0);
  float oneway = mod(floor(code / 4.0), 2.0);
  float rank = mod(floor(code / 8.0), 4.0);
  float lanes = floor(code / 32.0);

  if (mode > 0.5 && mode < 1.5) {
    float white = 0.0;
    float yellow = 0.0;
    if (rank >= 1.0 && h >= 2.8) white = roadLine(abs(v), h - 0.35, 0.15);
    if (oneway > 0.5) {
      float lw = 2.0 * h / lanes;
      for (int k = 1; k < 7; k++) {
        if (float(k) < lanes) white = max(white, roadLine(v, -h + float(k) * lw, 0.12) * roadDash(u, 9.0, 0.35));
      }
    } else if (rank >= 1.0 && lanes >= 2.0) {
      if (rank >= 2.0) yellow = max(roadLine(v, -0.2, 0.15), roadLine(v, 0.2, 0.15));
      else yellow = roadLine(v, 0.0, 0.15) * roadDash(u, 6.0, 0.5);
      float per = max(1.0, floor(lanes / 2.0));
      float lw = h / per;
      for (int k = 1; k < 4; k++) {
        if (float(k) < per) white = max(white, roadLine(abs(v), float(k) * lw, 0.12) * roadDash(u, 9.0, 0.35));
      }
    }
    diffuseColor.rgb = mix(diffuseColor.rgb, ${vec3(PALETTE.marking)}, white * 0.9);
    diffuseColor.rgb = mix(diffuseColor.rgb, ${vec3(PALETTE.markingYellow)}, yellow * 0.9);
  } else if (mode > 1.5 && mode < 2.5) {
    float stripe = roadDash(u, 1.2, 0.5) * step(abs(v), h - 0.25);
    diffuseColor.rgb = mix(diffuseColor.rgb, ${vec3(PALETTE.marking)}, stripe * 0.92);
  } else if (mode > 2.5) {
    float curb = 1.0 - smoothstep(0.2, 0.28, v);
    float joint = roadLine(fract(u / 1.5) * 1.5, 0.75, 0.04);
    diffuseColor.rgb *= mix(1.0, 0.72, curb) * mix(1.0, 0.9, joint);
  }
}
`;

export function createRoadMaterial(): MeshLambertMaterial {
  const m = new MeshLambertMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 roadAux;\nvarying vec4 vRoadAux;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoadAux = roadAux;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FUNCTIONS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${PAINT}`);
  };
  m.customProgramCacheKey = () => 'road-markings-v1';
  return m;
}
