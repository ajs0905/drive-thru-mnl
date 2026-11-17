/**
 * Runs before every test file (vite.config.ts, `test.setupFiles`): any deprecation warning
 * printed while the file's tests run (three.js, Rapier, any library's console, or a Node
 * DeprecationWarning) fails that file, so a dependency update that brings one back is caught
 * in its pull request (ADR 0031, ADR 0033). The messages still print as usual.
 */
import { afterAll } from 'vitest';
import { deprecationLines } from '../../tools/deprecations';

const seen: string[] = [];

for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    seen.push(...deprecationLines(args.map(String).join(' ')));
    original(...args);
  };
}

process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning') seen.push(`${warning.name}: ${warning.message}`);
});

afterAll(() => {
  if (seen.length > 0) {
    throw new Error(`Deprecation warnings while these tests ran (ADR 0031: no deprecated APIs):\n${seen.join('\n')}`);
  }
});
