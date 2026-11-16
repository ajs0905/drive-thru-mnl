import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { DRAWN, DRESSING } from '../src/geometry/dressing';

/** The JSON chunk of a binary glTF file. */
function glbJson(path: string): { nodes: { name: string; mesh?: number }[]; meshes: { primitives: { attributes: { POSITION: number } }[] }[]; accessors: { min: number[]; max: number[] }[] } {
  const buf = readFileSync(path);
  const length = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + length).toString('utf8'));
}

it('has one model per dressing kind in public/models/props.glb (built by tools/props-to-glb.ts)', () => {
  const gltf = glbJson('public/models/props.glb');
  expect(new Set(gltf.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name))).toEqual(new Set(Object.keys(DRESSING)));
});

it('records how far each model reaches past its size (DRAWN) as props.glb draws it', () => {
  const gltf = glbJson('public/models/props.glb');
  for (const n of gltf.nodes) {
    if (n.mesh === undefined) continue;
    const acc = gltf.accessors[gltf.meshes[n.mesh].primitives[0].attributes.POSITION];
    const box = DRAWN[n.name as keyof typeof DRAWN];
    const [l, w] = DRESSING[n.name as keyof typeof DRESSING].size;
    if (box) {
      expect([acc.min[0], acc.max[0], acc.min[2], acc.max[2]].map((v) => Math.round(v * 20) / 20), n.name).toEqual(box);
    } else if (!['streetlight', 'signal', 'signalpole', 'lamp', 'crane'].includes(n.name)) {
      // Everything else stays within its size (to a few centimeters), so its size is its footprint.
      expect(Math.max(-acc.min[0], acc.max[0]), n.name).toBeLessThanOrEqual(l / 2 + 0.06);
      expect(Math.max(-acc.min[2], acc.max[2]), n.name).toBeLessThanOrEqual(w / 2 + 0.06);
    }
  }
});

it('turns the traffic light heads to face -z, the traffic pipeline/lights.ts aims them at', () => {
  const buf = readFileSync('public/models/props.glb');
  const json = glbJson('public/models/props.glb') as unknown as {
    nodes: { name: string; mesh?: number }[];
    meshes: { primitives: { attributes: Record<string, number> }[] }[];
    accessors: { bufferView: number; byteOffset?: number; count: number }[];
    bufferViews: { byteOffset?: number }[];
  };
  const bin = 20 + buf.readUInt32LE(12) + 8;
  const floats = (index: number) => {
    const a = json.accessors[index];
    const start = bin + (json.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0);
    return new Float32Array(buf.buffer.slice(buf.byteOffset + start, buf.byteOffset + start + a.count * 12));
  };
  for (const name of ['signal', 'signalpole']) {
    const attrs = json.meshes[json.nodes.find((n) => n.name === name)!.mesh!].primitives[0].attributes;
    const [normal, color] = [floats(attrs.NORMAL), floats(attrs.COLOR_0)];
    // The lenses: bright red, amber or green (linear colors).
    let [sum, n] = [0, 0];
    for (let i = 0; i < color.length; i += 3) {
      const [r, g, b] = [color[i], color[i + 1], color[i + 2]];
      const lens = (r > 0.5 && g < 0.2 && b < 0.1) || (g > 0.15 && r < 0.12 && b < 0.3 && g > b);
      if (!lens) continue;
      sum += normal[i + 2];
      n++;
    }
    expect(n, name).toBeGreaterThan(0);
    expect(sum / n, name).toBeLessThan(-0.5);
  }
});
