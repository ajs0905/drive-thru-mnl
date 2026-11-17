import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FRAME_CLOCK_ID, fiberClock, swapFiberClock } from './fiberClock';

const dist = 'node_modules/@react-three/fiber/dist';

describe('the Fiber clock swap', () => {
  it('replaces Fiber\'s THREE.Clock with a FrameClock import', () => {
    const out = swapFiberClock('const s = { clock: new THREE.Clock(), dpr: 1 };', '/x/frameClock.ts')!;
    expect(out).toContain('import { FrameClock as __FrameClock } from "/x/frameClock.ts";');
    expect(out).toContain('clock: new __FrameClock()');
    expect(out).not.toContain('THREE.Clock');
  });

  it('leaves code without a Clock alone', () => {
    expect(swapFiberClock('const t = new THREE.Timer();', '/x')).toBeNull();
  });

  it('fails the build on a Clock use it does not know, instead of keeping it', () => {
    expect(() => swapFiberClock('const c = new THREE.Clock(false);', '/x')).toThrow(/fiberClock/);
  });

  it('leaves no THREE.Clock in the installed Fiber (ES modules the game bundles)', () => {
    const plugin = fiberClock();
    let swapped = 0;
    for (const f of readdirSync(dist).filter((f) => f.endsWith('.esm.js'))) {
      const id = `${process.cwd()}/${dist}/${f}`;
      const code = readFileSync(`${dist}/${f}`, 'utf8');
      const out = plugin.transform(code, id);
      if (out) swapped++;
      expect((out?.code ?? code).includes('THREE.Clock'), f).toBe(false);
    }
    // Fiber 9 has it in one file; if this drops to 0 Fiber moved off Clock and the swap can go.
    expect(swapped).toBeGreaterThanOrEqual(1);
  });

  it('resolves the clock it imports to the game\'s FrameClock file', () => {
    const file = fiberClock().resolveId(FRAME_CLOCK_ID);
    expect(file).toMatch(/frameClock\.ts$/);
    expect(existsSync(file!)).toBe(true);
    expect(fiberClock().resolveId('three')).toBeNull();
  });

  it('only touches Fiber\'s files', () => {
    expect(fiberClock().transform('new THREE.Clock()', '/p/node_modules/other/dist/a.js')).toBeNull();
  });
});
