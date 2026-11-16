/**
 * What the game remembers between visits, in the browser's localStorage under one key.
 *
 * Whatever is stored is read back through `parseSave`, which keeps only fields of the
 * right type and range and fills in the rest with defaults: a save edited by hand, left
 * over from an older version, or cut short can't crash the game or give it impossible
 * values. It isn't protection against cheating (there's no server, and anything in the
 * browser can be changed); it keeps the game working whatever it finds.
 */

import { CAR_IDS, CARS } from './cars';

export const SAVE_KEY = 'drive-thru-mnl.save';

export interface Best {
  /** Fastest delivery (s) and best take-home pay (PHP) for a run. */
  time: number;
  net: number;
}

export interface Save {
  v: 1;
  /** The first-drive welcome card has been closed once. */
  seenWelcome: boolean;
  /** Pesos in the wallet (centavos kept, never negative). */
  pesos: number;
  /** Cars bought (the Sedan always), and the one driven. */
  cars: string[];
  car: string;
  /** Per run id. */
  best: Record<string, Best>;
  /** Runs delivered. */
  runs: number;
}

export const NEW_SAVE: Save = { v: 1, seenWelcome: false, pesos: 0, cars: ['sedan'], car: 'sedan', best: {}, runs: 0 };

/** The most a wallet holds: a sanity cap, far past anything the runs pay. */
export const MAX_PESOS = 10_000_000;

const finite = (n: unknown, lo: number, hi: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;

/** A save from whatever was stored (JSON text or nothing): valid fields kept, the rest defaults. */
export function parseSave(text: string | null): Save {
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const cars = ['sedan', ...(Array.isArray(o.cars) ? o.cars.filter((c): c is string => typeof c === 'string' && CAR_IDS.has(c) && c !== 'sedan') : [])];
  const best: Record<string, Best> = {};
  if (o.best && typeof o.best === 'object' && !Array.isArray(o.best)) {
    for (const [id, b] of Object.entries(o.best as Record<string, unknown>)) {
      const x = b as Partial<Best> | null;
      if (typeof id === 'string' && id.length < 64 && x && finite(x.time, 0.1, 86400) && finite(x.net, -MAX_PESOS, MAX_PESOS)) best[id] = { time: x.time, net: Math.round(x.net * 100) / 100 };
    }
  }
  return {
    v: 1,
    seenWelcome: o.seenWelcome === true,
    pesos: finite(o.pesos, 0, MAX_PESOS) ? Math.round(o.pesos * 100) / 100 : 0,
    cars: [...new Set(cars)],
    car: typeof o.car === 'string' && cars.includes(o.car) ? o.car : 'sedan',
    best,
    runs: finite(o.runs, 0, 1e7) ? Math.floor(o.runs) : 0,
  };
}

/** Adds a run's pay (which can't take the wallet below zero or past the cap) and keeps its best. */
export function creditRun(save: Save, runId: string, net: number, time: number): Save {
  const prev = save.best[runId];
  const best = { time: prev ? Math.min(prev.time, time) : time, net: prev ? Math.max(prev.net, net) : net };
  const pesos = Math.round(Math.min(MAX_PESOS, Math.max(0, save.pesos + net)) * 100) / 100;
  return { ...save, pesos, best: { ...save.best, [runId]: best }, runs: save.runs + 1 };
}

/** Buys a car if it's ready, not owned and affordable; otherwise the save as it was. */
export function buyCar(save: Save, id: string): Save {
  const car = CARS.find((c) => c.id === id);
  if (!car || !car.ready || save.cars.includes(id) || save.pesos < car.price) return save;
  return { ...save, pesos: Math.round((save.pesos - car.price) * 100) / 100, cars: [...save.cars, id], car: id };
}

/** The bits of `Storage` used here, so tests can pass a plain object. */
export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The browser's storage, or nothing where it's unavailable (private modes, sandboxed frames). */
export function browserStorage(): SaveStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSave(storage: SaveStorage | null = browserStorage()): Save {
  try {
    return parseSave(storage?.getItem(SAVE_KEY) ?? null);
  } catch {
    return { ...NEW_SAVE };
  }
}

export function writeSave(save: Save, storage: SaveStorage | null = browserStorage()) {
  try {
    storage?.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Full or unavailable: progress just isn't kept.
  }
}
