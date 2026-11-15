/**
 * The speed blur pass (SpeedBlur.tsx): each pixel averages a few samples taken toward the
 * middle of the screen, more the farther it is from the middle, so the edges streak
 * outward like at speed while the road ahead stays sharp.
 */
import { SPEED_BLUR } from '../car/speedBlur';

/** Samples per pixel (where there's any blur; the sharp middle takes one). */
export const BLUR_TAPS = 8;

export const SpeedBlurShader = {
  name: 'SpeedBlurShader',
  uniforms: {
    tDiffuse: { value: null },
    strength: { value: 0 },
    aspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float aspect;
    varying vec2 vUv;
    void main() {
      vec2 toMiddle = vec2(0.5) - vUv;
      // Distance from the middle with the screen's shape taken out (1 at a corner).
      float r = length(toMiddle * vec2(aspect, 1.0)) / length(vec2(0.5 * aspect, 0.5));
      float amount = strength * smoothstep(${SPEED_BLUR.clearRadius.toFixed(3)}, ${SPEED_BLUR.edgeRadius.toFixed(3)}, r);
      vec4 color = texture2D(tDiffuse, vUv);
      if (amount > 0.0005) {
        for (int i = 1; i < ${BLUR_TAPS}; i++) color += texture2D(tDiffuse, vUv + toMiddle * amount * float(i) / ${(BLUR_TAPS - 1).toFixed(1)});
        color /= ${BLUR_TAPS.toFixed(1)};
      }
      gl_FragColor = color;
    }`,
};
