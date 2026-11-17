import { describe, expect, it } from 'vitest';
import { deprecationLines } from './deprecations';

describe('deprecation warnings', () => {
  it('spots the ones the libraries and tools print', () => {
    const output = [
      'THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.',
      'using deprecated parameters for the initialization function; pass a single object instead',
      '(node:1234) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.',
      'npm warn deprecated inflight@1.0.6: This module is not supported',
      '(!) optimizeDeps.esbuildOptions option is deprecated, use optimizeDeps.rolldownOptions',
      '(node:99) [DEP0190] something new',
    ].join('\n');
    expect(deprecationLines(output)).toHaveLength(6);
  });

  it('leaves ordinary output alone', () => {
    const output = ['✓ built in 1.24s', 'dist/assets/index-Fgat2ZBq.js  1,443.11 kB', 'Bundle sizes within budget.', ' Test Files  92 passed (92)'].join('\n');
    expect(deprecationLines(output)).toEqual([]);
  });
});
