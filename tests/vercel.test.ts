/**
 * The hosting config (vercel.json): the security headers every response gets, and caching
 * that never strands a player on old files (only Vite's hashed /assets are cached for good).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Rule {
  source: string;
  headers: { key: string; value: string }[];
}
const config = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'vercel.json'), 'utf8')) as { headers: Rule[] };

/** The headers a path gets, as Vercel applies them: every matching rule, later ones winning. */
function headersFor(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of config.headers) if (new RegExp(`^${rule.source}$`).test(path)) for (const h of rule.headers) out[h.key.toLowerCase()] = h.value;
  return out;
}

describe('vercel.json', () => {
  it('sends the security headers with every file', () => {
    for (const path of ['/', '/index.html', '/assets/index-abc123.js', '/data/bgc.json', '/models/sedan.glb', '/menu.jpg']) {
      const h = headersFor(path);
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['x-frame-options']).toBe('DENY');
      expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(h['cross-origin-opener-policy']).toBe('same-origin');
      expect(h['strict-transport-security']).toMatch(/^max-age=\d{8}/);
      expect(h['permissions-policy']).toMatch(/camera=\(\).*microphone=\(\).*geolocation=\(\)/);
    }
  });

  it('has a content security policy that lets the game run and nothing else in', () => {
    const csp = Object.fromEntries(
      headersFor('/')['content-security-policy']
        .split(';')
        .map((d) => d.trim().split(/\s+/))
        .map(([name, ...values]) => [name, values]),
    );
    expect(csp['default-src']).toEqual(["'self'"]);
    // Rapier's physics is WebAssembly compiled from bytes in its script: it needs this, and no other eval.
    expect(csp['script-src']).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['form-action']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    // Nothing is fetched from anywhere but the site itself.
    for (const values of Object.values(csp) as string[][]) expect(values.some((v) => /^https?:/.test(v))).toBe(false);
  });

  it('caches the hashed build files for good, and makes everything else check for a newer copy', () => {
    expect(headersFor('/assets/Drive-DF1KYVkO.js')['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(headersFor('/')['cache-control']).toBe('no-cache');
    expect(headersFor('/index.html')['cache-control']).toBe('no-cache');
    // The map, models and pictures keep their names between releases: never cached for good.
    for (const path of ['/data/bgc.json', '/models/props.glb', '/models/cars/sedan.png', '/menu.jpg', '/favicon.svg']) expect(headersFor(path)['cache-control']).toBe('public, max-age=0, must-revalidate');
  });
});
