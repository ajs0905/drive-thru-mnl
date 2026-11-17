/**
 * Small settings kept in the browser (localStorage), read and written defensively: a
 * missing, broken or foreign value means the default, and a browser that refuses storage
 * (private modes) just doesn't remember.
 */

/**
 * The stats switch was renamed once (`.v2`): a phone that had it on from testing an earlier
 * build starts with it off again.
 */
const KEYS = { stats: 'drive-thru-mnl.show-stats.v2' };

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage refused: the setting lasts until the page closes.
  }
}

/** Whether the frame rate and render stats line shows while driving (off unless turned on; `?debug` shows it too). */
export function loadShowStats(): boolean {
  return read(KEYS.stats) === 'on';
}

export function saveShowStats(on: boolean) {
  write(KEYS.stats, on ? 'on' : 'off');
}
