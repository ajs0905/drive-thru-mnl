/**
 * What the game remembers between visits, in the browser's localStorage under one key.
 *
 * Whatever is stored is read back through `parseSave`, which keeps only fields of the
 * right type and range and fills in the rest with defaults: a save edited by hand, left
 * over from an older version, or cut short can't crash the game or give it impossible
 * values. It isn't protection against cheating (there's no server, and anything in the
 * browser can be changed); it keeps the game working whatever it finds.
 */

export const SAVE_KEY = 'drive-thru-mnl.save';

export interface Save {
  v: 1;
  /** The first-drive welcome card has been closed once. */
  seenWelcome: boolean;
}

export const NEW_SAVE: Save = { v: 1, seenWelcome: false };

/** A save from whatever was stored (JSON text or nothing): valid fields kept, the rest defaults. */
export function parseSave(text: string | null): Save {
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { v: 1, seenWelcome: o.seenWelcome === true };
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
