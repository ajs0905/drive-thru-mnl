/**
 * Builds the parked car models from the Free Low Poly Vehicles Pack by Rgsdev (CC0,
 * https://rgsdev.itch.io/free-low-poly-vehicles-pack) into one small GLB:
 *
 *   npx tsx tools/parked-cars-to-glb.ts "<pack folder>" public/models/parked-cars.glb
 *
 * - One mesh per model in `PARKED_MODELS` (src/car/parked.ts), named after it, with the
 *   wheels and lamps merged in: a parked car never moves its wheels, so each model is a
 *   single instanced draw call.
 * - Same scale, axes and baked vertex colors as tools/car-to-glb.ts (+Z forward, on the
 *   ground at y = 0).
 * - A `paint` vertex attribute (1 on the body paint, 0 on windows, trim, tires, lamps), so
 *   the game can repaint each parked car without tinting its windows and tires. The paint
 *   is the pack's "body <color>" material that isn't its black or white trim.
 * - A `shine` vertex attribute, as in tools/car-to-glb.ts (glossy paint, glass, metal).
 *
 * Runs once by hand when a model is added; the raw pack isn't in the repo.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Group, Matrix4, Mesh, MeshStandardMaterial, type BufferGeometry } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PARKED_MODELS } from '../src/car/parked';
import { bake, polyfillFileReader, SCALE } from './car-to-glb';

/** Pack folder name per model. */
const FOLDER: Record<string, string> = { sedan: 'Sedan', hatchback: 'Hatchback', suv: 'SUV', pickup: 'Pickup', van: 'Van', taxi: 'Taxi' };
const isPaint = (name: string) => name.startsWith('body ') && name !== 'body black' && name !== 'body white';

async function main() {
  const [pack, output] = process.argv.slice(2);
  if (!pack || !output) throw new Error('usage: tsx tools/parked-cars-to-glb.ts <pack folder> <out.glb>');
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 });
  const root = new Group();
  root.name = 'parked-cars';
  for (const model of PARKED_MODELS) {
    const folder = FOLDER[model.name];
    const buf = readFileSync(join(pack, folder, `${folder}.fbx`));
    const fbx = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
    fbx.updateMatrixWorld(true);
    const parts: BufferGeometry[] = [];
    fbx.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const at = new Matrix4().makeTranslation(...(mesh.getWorldPosition(mesh.position.clone()).multiplyScalar(SCALE).toArray() as [number, number, number]));
      for (const g of Object.values(bake(mesh, model.repaint ? isPaint : () => false))) parts.push(g.applyMatrix4(at));
    });
    const merged = mergeGeometries(parts);
    if (!merged) throw new Error(`${model.name}: parts don't merge`);
    merged.computeBoundingBox();
    const min = merged.boundingBox!.min;
    merged.translate(0, -min.y, 0); // wheels on the ground
    const mesh = new Mesh(merged, material);
    mesh.name = model.name;
    root.add(mesh);
    const size = merged.boundingBox!.getSize(min.clone());
    const paint = merged.getAttribute('paint');
    let painted = 0;
    for (let i = 0; i < paint.count; i++) painted += paint.getX(i);
    console.log(`${model.name}: ${merged.getAttribute('position').count / 3} triangles, ${size.z.toFixed(2)} x ${size.x.toFixed(2)} x ${size.y.toFixed(2)} m, ${((100 * painted) / paint.count).toFixed(0)}% painted`);
  }
  polyfillFileReader();
  const glb = await new GLTFExporter().parseAsync(root, { binary: true });
  writeFileSync(output, Buffer.from(glb as ArrayBuffer));
  console.log(`${output}: ${(glb as ArrayBuffer).byteLength} bytes`);
}

void main();
