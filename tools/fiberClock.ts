/**
 * Build step: React Three Fiber 9 creates a THREE.Clock for every canvas, a module three.js
 * deprecated in r183 (it logs a warning). This swaps it for the game's FrameClock
 * (src/scene/frameClock.ts, built on THREE.Timer), in the production build and in the dev
 * server's pre-bundled dependencies alike (vite.config.ts), so the game never uses Clock.
 *
 * If a future Fiber stops using Clock, this does nothing. If it uses Clock in a way the swap
 * doesn't know, the build fails instead of quietly keeping it.
 */
import { fileURLToPath } from 'node:url';

const FIBER = /[\\/]@react-three[\\/]fiber[\\/]dist[\\/][^\\/]+\.js$/;
/** The id Fiber's code imports the clock by; the plugin resolves it to the file (any OS's paths). */
export const FRAME_CLOCK_ID = 'drive-thru-mnl:frame-clock';
const FRAME_CLOCK = fileURLToPath(new URL('../src/scene/frameClock.ts', import.meta.url));

/** The module's code with Fiber's `new THREE.Clock()` replaced by a FrameClock imported from `frameClock`, or null when it has no Clock. */
export function swapFiberClock(code: string, frameClock: string): string | null {
  if (!code.includes('THREE.Clock')) return null;
  const out = code.replaceAll('new THREE.Clock()', 'new __FrameClock()');
  if (out.includes('THREE.Clock')) {
    throw new Error('React Three Fiber uses THREE.Clock in a way tools/fiberClock.ts does not swap: update the swap.');
  }
  return `import { FrameClock as __FrameClock } from ${JSON.stringify(frameClock)};\n${out}`;
}

/** The Vite (and Rolldown, for the dev server's dependency pre-bundling) plugin. */
export function fiberClock() {
  return {
    name: 'fiber-frame-clock',
    resolveId(id: string) {
      return id === FRAME_CLOCK_ID ? FRAME_CLOCK : null;
    },
    transform(code: string, id: string) {
      if (!FIBER.test(id)) return null;
      const out = swapFiberClock(code, FRAME_CLOCK_ID);
      return out === null ? null : { code: out, map: null };
    },
  };
}
