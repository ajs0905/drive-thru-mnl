import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { carParts } from '../src/car/carParts';
import { PARKED_MODELS } from '../src/car/parked';
import { CARS } from '../src/game/cars';
import { readPng } from './png';

/** One attribute of a node's mesh in a binary glTF written by our model tools (float accessors). */
function attribute(path: string, node: string, name: string): Float32Array {
  const buf = readFileSync(path);
  const length = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + length).toString('utf8'));
  const bin = buf.subarray(20 + length + 8);
  const mesh = gltf.nodes.find((n: { name: string }) => n.name === node).mesh;
  const acc = gltf.accessors[gltf.meshes[mesh].primitives[0].attributes[name]];
  const view = gltf.bufferViews[acc.bufferView];
  const size = { SCALAR: 1, VEC3: 3 }[acc.type as 'SCALAR' | 'VEC3'];
  const out = new Float32Array(acc.count * size);
  for (let i = 0; i < out.length; i++) out[i] = bin.readFloatLE((view.byteOffset ?? 0) + (acc.byteOffset ?? 0) + i * 4);
  return out;
}

it('finds four wheels and both pairs of lamps on every traffic model in public/models/parked-cars.glb', () => {
  for (const m of PARKED_MODELS) {
    const file = 'public/models/parked-cars.glb';
    const parts = carParts(attribute(file, m.name, 'POSITION'), attribute(file, m.name, 'COLOR_0'), attribute(file, m.name, '_SHINE'));
    expect(parts.wheelRadius, m.name).toBeCloseTo(0.275, 2);
    for (const [i, w] of parts.wheels.entries()) {
      expect(Math.sign(w[0]), `${m.name} wheel ${i} side`).toBe(i % 2 ? -1 : 1);
      expect(Math.sign(w[2]), `${m.name} wheel ${i} end`).toBe(i < 2 ? 1 : -1);
    }
    expect(parts.head, m.name).toHaveLength(2);
    expect(parts.tail, m.name).toHaveLength(2);
    // Every wheel triangle went to a wheel, the same number each.
    const per = [0, 1, 2, 3].map((w) => parts.triangle.filter((t) => t === w).length);
    expect(new Set(per).size, m.name).toBe(1);
  }
});

it('has a picture for every car in the CARS tab (tools/car-thumbs.ts)', () => {
  for (const car of CARS) {
    const png = readPng(readFileSync(`public/${car.picture}`));
    expect([png.width, png.height]).toEqual([320, 160]);
    // Transparent corners, the car in the middle.
    expect(png.data[3]).toBe(0);
    expect(png.data[(80 * 320 + 160) * 4 + 3]).toBe(255);
  }
});

it('describes every car in one sentence, without dashes', () => {
  for (const car of CARS) {
    expect(car.blurb.match(/[.!?](\s|$)/g), car.id).toHaveLength(1);
    expect(car.blurb, car.id).not.toMatch(/\u2014|\u2013| - /);
  }
});
