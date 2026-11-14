/** Sky settings (data only; the drawing is in Sky.tsx). */
import { Vector3 } from 'three';

export const SKY = {
  /**
   * Haze color: the fog fades the city into it, and the sky blends into it just above
   * the horizon, so there's no seam where the ground ends.
   */
  horizon: '#cdd9e3',
  sun: '#ffe4bf',
  /**
   * Toward the sun, three.js space (x east, y up, z south). Morning, low (about 28
   * degrees) from the east-southeast: behind the default camera, so facades are lit
   * and shadows fall long and away from you.
   */
  sunDir: new Vector3(0.75, 0.47, 0.47).normalize(),
  /** Atmosphere (three.js Sky, Preetham model). Higher turbidity = hazier, whiter sky. */
  turbidity: 3,
  rayleigh: 1.6,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.8,
  /** How high above the horizon (as sin of the elevation) the haze reaches into the sky. */
  hazeHeight: 0.12,
  /** Scales the sky shader's output before the shared tone mapping. */
  exposure: 0.27,
  /** Overall brightness going into the ACES tone mapping (every tier). */
  toneExposure: 0.85,
  /** Sunlight and the sky/ground fill light. */
  sunIntensity: 2.2,
  fillSky: '#dceaf7',
  fillGround: '#8f8a78',
  fillIntensity: 1.1,
  clouds: { coverage: 0.42, density: 0.55, elevation: 0.55, scale: 0.0002, speed: 0.00003 },
};

/** The city past the map and the hills on the horizon (src/scene/Surroundings.tsx). */
export const SURROUNDINGS = {
  /** Filler blocks: concrete, beige and tan, like the low-rise city around BGC. */
  blocks: ['#a9acb0', '#bdb6a8', '#c7b99c', '#9fa6ad', '#b7ab95'],
  /** Towers in the skylines: glassy blues and pale concrete. */
  towers: ['#8fa4b8', '#a7b8c8', '#7f93a8', '#c2c6c9'],
  /** Hill color before haze, and how much haze each ridge layer gets (near, far). */
  hills: '#5f7a5c',
  hillHaze: [0.4, 0.6],
  /** How far below the ground the ridges start (hides their bottom edge). */
  hillBase: 200,
};
