import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { fixRapierInit, rapierInit } from './rapierInit';

const pkg = 'node_modules/@dimforge/rapier3d-compat';

describe('the Rapier init fix', () => {
  it('passes the bundled module as { module_or_path }', () => {
    const out = fixRapierInit('function dg(){return Lg(this,0,0,(function*(){yield xA(lg.toByteArray("AGFz+/==").buffer)}))}')!;
    expect(out).toContain('yield xA({module_or_path:lg.toByteArray("AGFz+/==").buffer})');
  });

  it('leaves a Rapier that already calls it the current way alone', () => {
    expect(fixRapierInit('yield EI({module_or_path:oC.toByteArray("AGFz").buffer})')).toBeNull();
  });

  it('fails the build on a call it does not know, instead of keeping the deprecated one', () => {
    expect(() => fixRapierInit('yield xA(bytes)')).toThrow(/rapierInit/);
  });

  it('fixes the installed Rapier (both builds) and only Rapier', () => {
    const plugin = rapierInit();
    for (const f of ['rapier.mjs', 'rapier.cjs']) {
      const out = plugin.transform(readFileSync(`${pkg}/${f}`, 'utf8'), `${process.cwd()}/${pkg}/${f}`);
      expect(out?.code, f).toMatch(/yield [\w$]+\(\{module_or_path:[\w$]+\.toByteArray\(/);
    }
    expect(plugin.transform('yield xA(lg.toByteArray("A").buffer)', '/p/node_modules/other/rapier.mjs')).toBeNull();
  });

  it('starts physics in the tests without the deprecation warning (the tests get the fix too)', async () => {
    const warn = vi.spyOn(console, 'warn');
    await RAPIER.init();
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/deprecated/);
    warn.mockRestore();
  });
});
