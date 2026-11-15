/**
 * The speed blur (SpeedBlur.tsx), drawn over the finished frame: each pixel averages a few
 * samples taken toward the middle of the screen, more the farther it is from the middle,
 * so the edges streak outward like at speed while the road ahead stays sharp. The sharp
 * middle isn't drawn at all. The samples start at a different spot per pixel (a fixed
 * noise pattern), which turns the steps between samples into fine grain instead of
 * visible copies of the edges.
 */
import { SPEED_BLUR } from '../car/speedBlur';

/** Samples per blurred pixel. */
export const BLUR_TAPS = 8;

export const SpeedBlurShader = {
  name: 'SpeedBlurShader',
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tScreen;
    uniform float strength;
    uniform float aspect;
    varying vec2 vUv;
    void main() {
      vec2 toMiddle = vec2(0.5) - vUv;
      // Distance from the middle with the screen's shape taken out (1 at a corner).
      float r = length(toMiddle * vec2(aspect, 1.0)) / length(vec2(0.5 * aspect, 0.5));
      float amount = strength * smoothstep(${SPEED_BLUR.clearRadius.toFixed(3)}, ${SPEED_BLUR.edgeRadius.toFixed(3)}, r);
      if (amount < 0.0005) discard;
      // Interleaved gradient noise: a per-pixel start offset in [0, 1).
      float start = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      vec4 color = vec4(0.0);
      for (int i = 0; i < ${BLUR_TAPS}; i++) color += texture2D(tScreen, vUv + toMiddle * amount * (float(i) + start) / ${BLUR_TAPS.toFixed(1)});
      gl_FragColor = vec4(color.rgb / ${BLUR_TAPS.toFixed(1)}, 1.0);
    }`,
};
