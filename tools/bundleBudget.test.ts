import { describe, expect, it } from 'vitest';
import { checkBudgets, chunkName, gzipSize, OTHER_KB } from './bundleBudget';

describe('bundle budgets', () => {
  it("names a chunk without Vite's hash", () => {
    expect(chunkName('Drive-BpmFMAtp.js')).toEqual({ name: 'Drive', ext: 'js' });
    expect(chunkName('dist/assets/index-Cqx3qfCN.css')).toEqual({ name: 'index', ext: 'css' });
    expect(chunkName('rapier-CyGXTAzy.js')).toEqual({ name: 'rapier', ext: 'js' });
  });

  it('flags a chunk over its budget, and holds unknown chunks to the small default', () => {
    const budgets = [{ name: 'index', ext: 'js' as const, kb: 430, why: '' }];
    const rows = checkBudgets(
      [
        { file: 'index-aaaaaaaa.js', gzip: 410_500 },
        { file: 'index-bbbbbbbb.js', gzip: 431_000 },
        { file: 'tiny-cccccccc.js', gzip: (OTHER_KB + 1) * 1000 },
      ],
      budgets,
    );
    expect(rows.map((r) => r.over)).toEqual([false, true, true]);
    expect(rows[2].budget).toBe(OTHER_KB);
  });

  it('measures gzipped bytes', () => {
    const text = new TextEncoder().encode('a'.repeat(10_000));
    expect(gzipSize(text)).toBeLessThan(200);
  });
});
