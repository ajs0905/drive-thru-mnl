/**
 * Build step: Rapier 0.19's compat package starts its WebAssembly with the deprecated way of
 * calling the generated init function (the module as a bare argument), which logs "using
 * deprecated parameters for the initialization function" every time physics starts. Rapier
 * 0.20 changed that one call to the current form, `{ module_or_path }`, but 0.20 and later
 * are 1.3 to 2 times the download (0.21: 1.65 MB gzipped against 0.86 MB), too much for
 * phones (docs/decisions/0031). So the build makes that same one-call change in the
 * pinned 0.19.2: in the production build, the dev server's pre-bundling and the tests
 * (vite.config.ts), and in the Node scripts through a module load hook (tools/rapierNode.ts).
 *
 * If a Rapier update already calls it the current way, this does nothing. If it calls it a
 * way this doesn't know, the build fails instead of keeping the deprecated call.
 */
const RAPIER = /[\\/]@dimforge[\\/]rapier3d-compat[\\/](?:dist[\\/])?rapier\.(?:mjs|cjs)$/;
/** `yield init(base64.toByteArray("...").buffer)`, the bundled module passed bare. */
const BARE_CALL = /yield ([\w$]+)\(([\w$]+\.toByteArray\("[A-Za-z0-9+/=]*"\)\.buffer)\)/g;
/** `yield init({module_or_path: base64.toByteArray(...)})`, the current way. */
const CURRENT_CALL = /yield [\w$]+\(\{module_or_path:[\w$]+\.toByteArray\(/;

/** The module's code with the init call given `{ module_or_path }`, or null when it already is. */
export function fixRapierInit(code: string): string | null {
  if (CURRENT_CALL.test(code)) return null;
  const calls = code.match(BARE_CALL)?.length ?? 0;
  if (calls !== 1) {
    throw new Error(`Rapier's init call isn't the one tools/rapierInit.ts knows (${calls} found): update the fix.`);
  }
  return code.replace(BARE_CALL, 'yield $1({module_or_path:$2})');
}

/** The Vite (and Rolldown, for the dev server's dependency pre-bundling) plugin. */
export function rapierInit() {
  return {
    name: 'rapier-init',
    transform(code: string, id: string) {
      if (!RAPIER.test(id)) return null;
      const out = fixRapierInit(code);
      return out === null ? null : { code: out, map: null };
    },
  };
}
