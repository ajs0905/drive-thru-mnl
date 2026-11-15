/**
 * Converts a car from the Free Low Poly Vehicles Pack by Rgsdev (CC0, binary FBX,
 * https://rgsdev.itch.io/free-low-poly-vehicles-pack) into
 * the small GLB the game loads:
 *
 *   npx tsx tools/car-to-glb.ts "<pack>/Sedan/Sedan.fbx" public/models/sedan.glb
 *
 * - Scale: the pack is in centimeters and about 15% oversized (the Sedan is 5.2 m long
 *   and 2.8 m wide), so everything is scaled by 0.0085 to meters at a real car's size.
 * - Axes: +Y up, +Z forward, +X to the car's left (the pack's own, after its -90 degree
 *   export rotation is applied).
 * - Nodes: `body` plus `wheelFL`, `wheelFR`, `wheelRL`, `wheelRR`, each wheel with its
 *   origin at the wheel's center so it can spin and steer. The body's lamps are split
 *   out into `headlights` and `taillights` (children of `body`), so the game can make
 *   them glow, brake lights brighter while braking.
 * - Colors: the 8 materials (paint, trim, windows, lights, rims, tires) are baked into
 *   vertex colors, so the body draws in one call and each wheel in one. Pure black
 *   (tires, trim) is lifted to a dark grey so it still shows some shading. The pack's
 *   lavender rims and headlight lenses become silver and a warm white.
 * - A `shine` vertex attribute says how each part reflects the sky (see
 *   src/scene/carShine.ts): 0 matte (tires, trim, lamps), 1 glossy paint, 2 glass,
 *   3 metal (rims).
 *
 * Runs once by hand when a car is added; the raw pack isn't in the repo.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { BufferAttribute, BufferGeometry, Color, Group, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3, type Material } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export const SCALE = 0.0085;
const MIN_LINEAR = 0.012; // darkest allowed channel value (linear), about #1c1c1c

const WHEELS: Record<string, string> = {
  front_left: 'wheelFL',
  front_right: 'wheelFR',
  rear_left: 'wheelRL',
  rear_right: 'wheelRR',
};

function nodeName(fbxName: string): string {
  const wheel = Object.entries(WHEELS).find(([k]) => fbxName.toLowerCase().endsWith(k));
  return wheel ? wheel[1] : 'body';
}

/** Pack material names of the lamps -> the part they go into. */
const LAMPS: Record<string, string> = { headlights: 'headlights', 'rear lights': 'taillights' };

/** Pack colors replaced: the lavender rims and headlight lenses. */
export const RECOLOR: Record<string, string> = { wheels: '#b9bec6', headlights: '#ece8dc' };

/** How a pack material reflects (the `shine` attribute): 0 matte, 1 glossy paint, 2 glass, 3 metal. */
export function shineOf(materialName: string): number {
  if (materialName === 'windows') return 2;
  if (materialName === 'wheels') return 3;
  if (materialName === 'body black') return 0;
  return materialName.startsWith('body ') ? 1 : 0;
}

/**
 * The mesh's geometry with its rotation and scale applied, in meters, colors baked per
 * vertex, split into parts: lamp materials into their own part, everything else into `main`.
 * Each part gets a `shine` attribute (see `shineOf`). With `isPaint`, each part also gets a
 * `paint` attribute: 1 on vertices of paint materials.
 */
export function bake(mesh: Mesh, isPaint?: (materialName: string) => boolean): Record<string, BufferGeometry> {
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  mesh.updateMatrixWorld(true);
  const pos = new Vector3();
  const rot = new Quaternion();
  const scl = new Vector3();
  mesh.matrixWorld.decompose(pos, rot, scl);
  src.applyMatrix4(new Matrix4().compose(new Vector3(), rot, scl.multiplyScalar(SCALE)));

  const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const count = src.getAttribute('position').count;
  const groups = src.groups.length ? src.groups : [{ start: 0, count, materialIndex: 0 }];
  const position = src.getAttribute('position');
  const normal = src.getAttribute('normal');
  const parts: Record<string, { p: number[]; n: number[]; c: number[]; k: number[]; s: number[] }> = {};
  for (const g of groups) {
    const m = materials[g.materialIndex ?? 0] as Material & { color?: Color };
    const part = LAMPS[m.name] ?? 'main';
    const out = (parts[part] ??= { p: [], n: [], c: [], k: [], s: [] });
    const paint = isPaint?.(m.name) ? 1 : 0;
    const shine = shineOf(m.name);
    const c = RECOLOR[m.name] ? new Color(RECOLOR[m.name]) : (m.color ?? new Color(1, 1, 1)).clone();
    c.r = Math.max(c.r, MIN_LINEAR);
    c.g = Math.max(c.g, MIN_LINEAR);
    c.b = Math.max(c.b, MIN_LINEAR);
    for (let i = g.start; i < g.start + g.count; i++) {
      out.p.push(position.getX(i), position.getY(i), position.getZ(i));
      out.n.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      out.c.push(c.r, c.g, c.b);
      out.k.push(paint);
      out.s.push(shine);
    }
  }
  return Object.fromEntries(
    Object.entries(parts).map(([name, a]) => {
      const out = new BufferGeometry();
      out.setAttribute('position', new BufferAttribute(new Float32Array(a.p), 3));
      out.setAttribute('normal', new BufferAttribute(new Float32Array(a.n), 3));
      out.setAttribute('color', new BufferAttribute(new Float32Array(a.c), 3));
      out.setAttribute('shine', new BufferAttribute(new Float32Array(a.s), 1));
      if (isPaint) out.setAttribute('paint', new BufferAttribute(new Float32Array(a.k), 1));
      return [name, out];
    }),
  );
}

/** GLTFExporter's binary output reads a Blob with FileReader, which Node doesn't have. */
export function polyfillFileReader() {
  const g = globalThis as unknown as { FileReader?: unknown };
  if (g.FileReader) return;
  g.FileReader = class {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
  };
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('usage: tsx tools/car-to-glb.ts <car.fbx> <out.glb>');
  const buf = readFileSync(input);
  const fbx = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  fbx.updateMatrixWorld(true);

  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 });
  const car = new Group();
  car.name = 'car';
  fbx.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const { main, ...lamps } = bake(mesh);
    const node = new Mesh(main, material);
    node.name = nodeName(mesh.name);
    node.position.setFromMatrixPosition(mesh.matrixWorld).multiplyScalar(SCALE);
    for (const [name, geometry] of Object.entries(lamps)) {
      const lamp = new Mesh(geometry, material);
      lamp.name = name;
      node.add(lamp);
    }
    car.add(node);
  });
  const names: string[] = [];
  car.traverse((o) => {
    if (o !== car) names.push(o.name);
  });
  names.sort();
  const expected = ['body', 'headlights', 'taillights', 'wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
  if (names.join() !== expected.join()) throw new Error(`unexpected parts: ${names.join()}`);

  polyfillFileReader();
  const glb = await new GLTFExporter().parseAsync(car, { binary: true });
  writeFileSync(output, Buffer.from(glb as ArrayBuffer));
  let tris = 0;
  car.traverse((o) => {
    if ((o as Mesh).isMesh) tris += (o as Mesh).geometry.getAttribute('position').count / 3;
  });
  console.log(`${output}: ${(glb as ArrayBuffer).byteLength} bytes, ${tris} triangles, parts ${names.join(', ')}`);
}

// Run as a script, not when another tool imports the helpers above.
if (process.argv[1]?.endsWith('car-to-glb.ts')) void main();
