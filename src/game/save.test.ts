import { describe, expect, it } from 'vitest';
import { buyCar, creditRun, loadSave, MAX_PESOS, NEW_SAVE, parseSave, SAVE_KEY, writeSave, type SaveStorage } from './save';
import { CARS } from './cars';

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
    expect(JSON.parse(s.data.get(SAVE_KEY)!)).toEqual({ ...NEW_SAVE, seenWelcome: true });
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

  it('clamps the wallet, drops unknown cars and bad best times, and always owns the Sedan', () => {
    const s = parseSave(JSON.stringify({ pesos: -50, cars: ['coupe', 'hovercraft', 7], car: 'hovercraft', best: { a: { time: 61.5, net: 812.345 }, b: { time: -1, net: 5 }, c: 'x' }, runs: 2.7 }));
    expect(s.pesos).toBe(0);
    expect(s.cars).toEqual(['sedan', 'coupe']);
    expect(s.car).toBe('sedan');
    expect(s.best).toEqual({ a: { time: 61.5, net: 812.35 } });
    expect(s.runs).toBe(2);
    expect(parseSave(JSON.stringify({ pesos: 1e12 })).pesos).toBe(0);
    expect(parseSave(JSON.stringify({ pesos: 'lots' })).pesos).toBe(0);
  });

  it('shrugs off hostile saves: prototype keys, NaN and huge numbers, nested junk, wrong types everywhere', () => {
    const hostile = [
      '{"__proto__":{"pesos":5},"best":{"__proto__":{"time":5,"net":1},"constructor":{"time":5,"net":1},"morning-parcels":{"time":40,"net":300}}}',
      '{"pesos":-5,"runs":-1,"cars":"coupe","car":{"toString":1},"best":[1,2,3],"seenWelcome":"yes"}',
      '{"pesos":1e400,"runs":1e400,"best":{"a":{"time":"NaN","net":null},"b":null,"c":[1]}}',
      '{"pesos":"NaN","cars":[null,{},["coupe"],"sedan","muscle","muscle","not-a-car"]}',
      '[1,2,3]',
      '"just a string"',
      'null',
      '{"best":{"' + 'x'.repeat(5000) + '":{"time":5,"net":1}}}',
    ];
    for (const text of hostile) {
      const s = parseSave(text);
      expect(Object.getPrototypeOf(s)).toBe(Object.prototype);
      expect(Object.getPrototypeOf(s.best)).toBe(Object.prototype);
      expect(Object.keys(s.best).every((k) => /^[a-z0-9-]+$/.test(k) && k.length < 64)).toBe(true);
      expect(Number.isFinite(s.pesos) && s.pesos >= 0 && s.pesos <= MAX_PESOS).toBe(true);
      expect(Number.isInteger(s.runs) && s.runs >= 0).toBe(true);
      expect(s.cars[0]).toBe('sedan');
      expect(s.cars.includes(s.car)).toBe(true);
      expect(typeof s.seenWelcome).toBe('boolean');
    }
    // Nothing leaked onto Object.prototype either.
    expect(({} as Record<string, unknown>).pesos).toBeUndefined();
    expect(({} as Record<string, unknown>).time).toBeUndefined();
    // And what was valid survived.
    expect(parseSave(hostile[0]).best['morning-parcels']).toEqual({ time: 40, net: 300 });
    expect(parseSave(hostile[3]).cars).toEqual(['sedan', 'muscle']);
  });

  it('credits runs, keeps the best time and pay, and never goes below zero', () => {
    let s = creditRun(NEW_SAVE, 'r', 500.5, 90);
    s = creditRun(s, 'r', 300, 80);
    expect(s.pesos).toBeCloseTo(800.5);
    expect(s.best.r).toEqual({ time: 80, net: 500.5 });
    expect(s.runs).toBe(2);
    expect(creditRun(NEW_SAVE, 'r', -100, 50).pesos).toBe(0);
    expect(creditRun({ ...NEW_SAVE, pesos: MAX_PESOS }, 'r', 100, 50).pesos).toBe(MAX_PESOS);
  });

  it('buys a car only when it is ready, not owned and affordable', () => {
    const ready = CARS.find((c) => c.id !== 'sedan' && c.ready);
    const locked = CARS.find((c) => !c.ready)!;
    const rich = { ...NEW_SAVE, pesos: 1e6 };
    expect(buyCar(rich, locked.id)).toBe(rich);
    expect(buyCar(rich, 'nope')).toBe(rich);
    expect(buyCar(rich, 'sedan')).toBe(rich);
    if (ready) {
      expect(buyCar({ ...NEW_SAVE, pesos: ready.price - 1 }, ready.id).cars).toEqual(['sedan']);
      const bought = buyCar(rich, ready.id);
      expect(bought.cars).toContain(ready.id);
      expect(bought.pesos).toBe(1e6 - ready.price);
    }
  });
});
