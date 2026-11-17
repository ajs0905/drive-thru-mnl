/**
 * Rapier for the Node scripts (`npm run bench`, `npm run replay`), which run outside Vite and
 * so outside its rapierInit plugin: a module load hook applies the same fix
 * (tools/rapierInit.ts, ADR 0031) to Rapier's code as Node loads it, then Rapier is imported
 * and started. Import Rapier through this, not directly: a static import would load it before
 * the hook is in place.
 */
import { registerHooks } from 'node:module';
import type RAPIER_TYPE from '@dimforge/rapier3d-compat';
import { fixRapierInit } from './rapierInit';

const RAPIER_URL = /\/@dimforge\/rapier3d-compat\/(?:dist\/)?rapier\.(?:mjs|cjs)$/;
let hooked = false;

/** Rapier, started, with its init call fixed. */
export async function loadRapier(): Promise<typeof RAPIER_TYPE> {
  if (!hooked) {
    registerHooks({
      load(url, context, nextLoad) {
        const result = nextLoad(url, context);
        if (!RAPIER_URL.test(url) || result.source == null) return result;
        const fixed = fixRapierInit(String(result.source));
        return fixed === null ? result : { ...result, source: fixed };
      },
    });
    hooked = true;
  }
  const RAPIER = (await import('@dimforge/rapier3d-compat')).default;
  await RAPIER.init();
  return RAPIER;
}
