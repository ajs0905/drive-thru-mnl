/** Sky settings (data only; the drawing is in Sky.tsx). */
import { Vector3 } from 'three';

export const SKY = {
  /**
   * Haze color: the fog fades the city into it, and the sky blends into it just above
   * the horizon, so there's no seam where the ground ends.
   */
  horizon: '#cdd9e3',
  sun: '#fff1d0',
  /** Toward the sun, three.js space (x east, y up, z south). Mid-morning, from the east-north-east. */
  sunDir: new Vector3(0.62, 0.62, -0.48).normalize(),
  /** Atmosphere (three.js Sky, Preetham model). Higher turbidity = hazier, whiter sky. */
  turbidity: 3,
  rayleigh: 1.6,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.8,
  /** How high above the horizon (as sin of the elevation) the haze reaches into the sky. */
  hazeHeight: 0.12,
  /** The sky shader's brightness before tone mapping. */
  exposure: 0.45,
  clouds: { coverage: 0.42, density: 0.55, elevation: 0.55, scale: 0.0002, speed: 0.00003 },
};
