/**
 * Size budgets for the production build's chunks, gzipped (what a player downloads).
 * Vite's own "chunks larger than 500 kB" warning is a general rule of thumb for websites;
 * a 3D game's chunks are past it by design (three.js and React in the main chunk, the
 * Rapier physics engine, its WebAssembly packed into the JavaScript, in the Drive chunk).
 * What matters is that they don't grow by accident, so each has a budget a few percent
 * over its size when the budget was set. Raise a budget on purpose, with a reason, when
 * something worth the bytes goes in.
 */
import { gzipSync } from 'node:zlib';

export interface Budget {
  /** The chunk's name before Vite's hash (`index` for `index-C3AgT3qL.js`). */
  name: string;
  ext: 'js' | 'css';
  /** Gzipped kB (1000 bytes) allowed. */
  kb: number;
  why: string;
}

/**
 * Set 2026-11-17 at main 406.8 kB, Drive 862.0 kB, CSS 7.0 kB as this check measures them (Node's gzip; Vite's
 * build report counts a little more: 410.5 and 874.8 kB). Any other chunk gets `OTHER_KB`.
 */
export const BUDGETS: Budget[] = [
  { name: 'index', ext: 'js', kb: 430, why: 'three.js, React, React Three Fiber, drei, the menus, map building and the game session' },
  { name: 'Drive', ext: 'js', kb: 900, why: 'the drive: about 836 kB of it is Rapier (its compat build packs the WebAssembly into the JavaScript), plus the car, traffic and props' },
  { name: 'index', ext: 'css', kb: 9, why: 'all the UI styles' },
];
export const OTHER_KB = 25;

export interface Chunk {
  file: string;
  /** Gzipped bytes. */
  gzip: number;
}

/** The chunk's name without its hash and extension (`Drive-BpmFMAtp.js` -> `Drive`), and its extension. */
export function chunkName(file: string): { name: string; ext: string } {
  const base = file.split(/[\\/]/).pop() ?? file;
  const m = /^(.*)-[A-Za-z0-9_-]{6,}\.(js|css)$/.exec(base) ?? /^(.*)\.(js|css)$/.exec(base);
  return m ? { name: m[1], ext: m[2] } : { name: base, ext: '' };
}

export function gzipSize(bytes: Uint8Array): number {
  return gzipSync(bytes).length;
}

export interface Row {
  file: string;
  kb: number;
  budget: number;
  over: boolean;
}

/** Each chunk against its budget (or `OTHER_KB`). */
export function checkBudgets(chunks: Chunk[], budgets: Budget[] = BUDGETS, other = OTHER_KB): Row[] {
  return chunks.map((c) => {
    const { name, ext } = chunkName(c.file);
    const budget = budgets.find((b) => b.name === name && b.ext === ext)?.kb ?? other;
    const kb = c.gzip / 1000;
    return { file: c.file, kb, budget, over: kb > budget };
  });
}
