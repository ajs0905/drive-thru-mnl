/**
 * Building shader: a Lambert material that paints windows from per-vertex data
 * instead of textures. Each wall vertex carries wallAux = [u, v, length, windows]:
 *   u        meters along this wall
 *   v        meters above the building's base
 *   length   the wall's length (windows are spaced evenly to fill it)
 *   windows  style packed by windowCode() in src/geometry/extrude.ts
 *
 * Kinds: 0 plain (roofs, warehouses), 1 glass curtain wall, 2 office grid,
 * 3 apartment rows, 4 house windows, 5 parking decks (open bands between posts).
 * Walls also darken over their bottom 4 m (cheap baked ambient occlusion: the
 * ground blocks part of the sky there). Each window gets a slightly different tint from a hash of its column, floor and
 * the building's variant, so facades don't look stamped. Once windows get smaller
 * than a few pixels the pattern blends to its average color, so distant towers
 * don't shimmer.
 */
import { MeshLambertMaterial } from 'three';
import { hexToRgb, srgbToLinear } from '../geometry/meshBuilder';
import { FLOOR_HEIGHT } from '../geometry/extrude';

const vec3 = (hex: string) => `vec3(${srgbToLinear(hexToRgb(hex)).map((c) => c.toFixed(4)).join(', ')})`;

/** Window colors: [dark, light] per kind, picked between by the per-window hash. */
export const WINDOW_COLORS = {
  glass: ['#456682', '#7fa3bf'],
  office: ['#3a4a58', '#6d8291'],
  apartment: ['#33383d', '#6b6f6a'],
  house: ['#2e3236', '#5c5a52'],
  parking: ['#3a3c3e', '#46484a'],
} as const;

const FUNCTIONS = /* glsl */ `
varying vec4 vWallAux;

float winHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

// 1 inside [lo, hi], 0 outside, antialiased by aa (in the same units as x).
float winBand(float x, float lo, float hi, float aa) {
  return smoothstep(lo - aa, lo + aa, x) * (1.0 - smoothstep(hi - aa, hi + aa, x));
}
`;

const PAINT = /* glsl */ `
{
  // Baked contact shading: walls darken toward the ground, where little sky reaches.
  if (vWallAux.z > 0.0) diffuseColor.rgb *= mix(0.68, 1.0, smoothstep(0.0, 4.0, vWallAux.y));
  float code = floor(vWallAux.w + 0.5);
  float kind = mod(code, 8.0);
  if (kind > 0.5) {
    float variant = mod(floor(code / 8.0), 16.0);
    float floors = floor(code / 128.0);
    float u = vWallAux.x;
    float v = vWallAux.y;
    float len = vWallAux.z;

    // Per kind: column spacing (m), window width (share of a column), window band within a floor.
    float spacing = 2.4; float width = 0.7; float lo = 0.3; float hi = 0.85;
    vec3 dark = ${vec3(WINDOW_COLORS.office[0])}; vec3 light = ${vec3(WINDOW_COLORS.office[1])};
    if (kind < 1.5) { spacing = 1.5; width = 0.9; lo = 0.1; hi = 0.92;
      dark = ${vec3(WINDOW_COLORS.glass[0])}; light = ${vec3(WINDOW_COLORS.glass[1])}; }
    else if (kind > 2.5 && kind < 3.5) { spacing = 3.0; width = 0.55; lo = 0.3; hi = 0.8;
      dark = ${vec3(WINDOW_COLORS.apartment[0])}; light = ${vec3(WINDOW_COLORS.apartment[1])}; }
    else if (kind > 3.5 && kind < 4.5) { spacing = 3.6; width = 0.36; lo = 0.33; hi = 0.75;
      dark = ${vec3(WINDOW_COLORS.house[0])}; light = ${vec3(WINDOW_COLORS.house[1])}; }
    else if (kind > 4.5) { spacing = 7.5; width = 0.93; lo = 0.38; hi = 0.92;
      dark = ${vec3(WINDOW_COLORS.parking[0])}; light = ${vec3(WINDOW_COLORS.parking[1])}; }
    spacing *= 0.9 + 0.2 * variant / 15.0;

    // Whole windows only: spread an exact number of columns along the wall.
    float cols = max(1.0, floor(len / spacing));
    float cell = u / (len / cols);
    float row = v / ${FLOOR_HEIGHT.toFixed(2)};
    float col = floor(cell);
    float level = floor(row);

    float aaU = fwidth(cell);
    float aaV = fwidth(row);
    float mask = winBand(fract(cell), 0.5 - width * 0.5, 0.5 + width * 0.5, aaU)
               * winBand(fract(row), lo, hi, aaV);
    // Far away: the average share of glass instead of sub-pixel windows.
    float far = smoothstep(0.15, 0.45, max(aaU, aaV));
    mask = mix(mask, width * (hi - lo), far);
    // No windows above the top floor, on walls too short for one, or in the dark below 0.
    mask *= step(level + 0.5, floors) * step(1.6, len) * step(0.0, v);

    float tint = winHash(vec3(col, level, variant));
    // Curtain walls vary less window to window; everything blends to the middle far away.
    if (kind < 1.5) tint = 0.35 + 0.3 * tint;
    vec3 glass = mix(dark, light, mix(tint, 0.5, far));
    // A hint of sky reflected toward the top of tall glass.
    if (kind < 2.5) glass = mix(glass, ${vec3('#b9d3e6')}, 0.25 * clamp(level / max(floors, 1.0), 0.0, 1.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, glass, mask * mix(1.0, 0.75, far));
  }
}
`;

export function createBuildingMaterial(): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 wallAux;\nvarying vec4 vWallAux;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWallAux = wallAux;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FUNCTIONS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${PAINT}`);
  };
  m.customProgramCacheKey = () => 'building-windows-v3';
  return m;
}
