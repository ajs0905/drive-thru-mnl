import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { DRESSING } from '../src/geometry/dressing';

/** The JSON chunk of a binary glTF file. */
function glbJson(path: string): { nodes: { name: string; mesh?: number }[] } {
  const buf = readFileSync(path);
  const length = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + length).toString('utf8'));
}

it('has one model per dressing kind in public/models/props.glb (built by tools/props-to-glb.ts)', () => {
  const gltf = glbJson('public/models/props.glb');
  expect(new Set(gltf.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name))).toEqual(new Set(Object.keys(DRESSING)));
});
