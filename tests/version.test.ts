/**
 * The version on the main menu, package.json's version and the changelog's latest entry agree.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../src/ui/version';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const changelog = readFileSync('CHANGELOG.md', 'utf8');

describe('version', () => {
  it('shows package.json\'s version in the game', () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('has a changelog entry for it, the newest one, with a date', () => {
    const entries = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/gm)].map((m) => m[1]);
    expect(entries[0]).toBe(pkg.version);
  });
});
