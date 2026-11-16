/**
 * Replays: a drive recorded as the keys held at each 60 Hz physics step, plus where it
 * started. The physics is deterministic for the same inputs (Rapier steps the same way
 * every time; the car's code is plain functions of its state), so a replay played
 * headless (sim/headless.ts) ends exactly where the recorded drive did. That makes a
 * recorded drive a regression test: a tuning or collision change shows up as a replay
 * that ends somewhere else.
 *
 * Keys are a 5-bit mask per step, stored run-length encoded ("count*mask,..."): an
 * hour of driving with keys changing a few times a second stays well under 100 KB.
 */
import { NO_KEYS, type DriveKeys } from '../car/controls';

export interface Replay {
  v: 1;
  /** What it was recorded on: the map's id (see `mapId`). */
  map: string;
  /** Start pose (three.js space): position and yaw. */
  start: { x: number; y: number; z: number; yaw: number };
  /** Physics steps per second. */
  hz: number;
  /** Run-length encoded key masks, one per step. */
  keys: string;
  /** Where the car ended (three.js space), for checking a playback. */
  end?: { x: number; y: number; z: number; speed: number };
}

const BITS: [keyof DriveKeys, number][] = [
  ['up', 1],
  ['down', 2],
  ['left', 4],
  ['right', 8],
  ['handbrake', 16],
];

export function maskOf(k: DriveKeys): number {
  let m = 0;
  for (const [key, bit] of BITS) if (k[key]) m |= bit;
  return m;
}

export function keysOf(mask: number, out: DriveKeys = { ...NO_KEYS }): DriveKeys {
  for (const [key, bit] of BITS) out[key] = (mask & bit) !== 0;
  return out;
}

/** Masks to "count*mask,count*mask". */
export function encodeKeys(masks: ArrayLike<number>): string {
  const out: string[] = [];
  let i = 0;
  while (i < masks.length) {
    let j = i;
    while (j < masks.length && masks[j] === masks[i]) j++;
    out.push(`${j - i}*${masks[i]}`);
    i = j;
  }
  return out.join(',');
}

export function decodeKeys(text: string): Uint8Array {
  if (!text) return new Uint8Array(0);
  const runs = text.split(',').map((r) => {
    const m = /^(\d+)\*(\d+)$/.exec(r);
    if (!m || Number(m[2]) > 31) throw new Error(`replay: bad run "${r}"`);
    return [Number(m[1]), Number(m[2])] as const;
  });
  const out = new Uint8Array(runs.reduce((s, [n]) => s + n, 0));
  let at = 0;
  for (const [n, mask] of runs) {
    out.fill(mask, at, at + n);
    at += n;
  }
  return out;
}

/** A short id for a map's content (FNV-1a over its roads' ids and point counts), so a replay knows what it was recorded on. */
export function mapId(map: { roads: { id: string; points: unknown[] }[] }): string {
  let h = 0x811c9dc5;
  for (const r of map.roads) {
    const s = `${r.id}:${r.points.length};`;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Records the keys of a drive step by step. */
export class Recorder {
  private masks: number[] = [];
  private readonly start: Replay['start'];
  private readonly map: string;

  constructor(map: string, start: Replay['start']) {
    this.map = map;
    this.start = start;
  }

  step(keys: DriveKeys) {
    this.masks.push(maskOf(keys));
  }

  get steps(): number {
    return this.masks.length;
  }

  finish(end?: Replay['end']): Replay {
    return { v: 1, map: this.map, start: this.start, hz: 60, keys: encodeKeys(this.masks), end };
  }
}
