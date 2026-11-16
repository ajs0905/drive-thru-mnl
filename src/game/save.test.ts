import { describe, expect, it } from 'vitest';
import { loadSave, NEW_SAVE, parseSave, SAVE_KEY, writeSave, type SaveStorage } from './save';

const memory = (): SaveStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe('save', () => {
  it('starts fresh with nothing stored, broken JSON or the wrong shape', () => {
    for (const text of [null, '', '{', 'null', '42', '"x"', '[]']) expect(parseSave(text)).toEqual(NEW_SAVE);
  });

  it('keeps valid fields and drops wrong types', () => {
    expect(parseSave('{"seenWelcome":true}').seenWelcome).toBe(true);
    expect(parseSave('{"seenWelcome":"yes"}').seenWelcome).toBe(false);
  });

  it('round-trips through storage, and copes with storage that throws', () => {
    const s = memory();
    writeSave({ ...NEW_SAVE, seenWelcome: true }, s);
    expect(JSON.parse(s.data.get(SAVE_KEY)!)).toEqual({ v: 1, seenWelcome: true });
    expect(loadSave(s).seenWelcome).toBe(true);
    const broken: SaveStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(loadSave(broken)).toEqual(NEW_SAVE);
    expect(() => writeSave(NEW_SAVE, broken)).not.toThrow();
    expect(loadSave(null)).toEqual(NEW_SAVE);
  });
});
