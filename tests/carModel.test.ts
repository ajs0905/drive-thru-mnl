/**
 * The converted car (public/models/sedan.glb, from tools/car-to-glb.ts) loads with
 * three.js's GLTF loader and matches what the physics assumes about it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, type Mesh, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { SEDAN } from '../src/car/spec';
import { blobShadowGeometry, HALO, haloTexture, lampCenters, LAMPS, poseBody, prepareCarModel, setBrakeLights, updateHalos } from '../src/scene/carModel';

function load(path: string): Promise<Object3D> {
  const buf = readFileSync(path);
  return new Promise((resolve, reject) =>
    new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', (g) => resolve(g.scene), reject),
  );
}

describe('sedan.glb', async () => {
  const scene = await load(join(import.meta.dirname, '..', 'public', SEDAN.model));
  scene.updateMatrixWorld(true);
  const part = (name: string) => scene.getObjectByName(name) as Mesh;

  it('has a body with its lamps split out, and four named wheels, all with vertex colors', () => {
    expect(part('headlights').parent?.name).toBe('body');
    expect(part('taillights').parent?.name).toBe('body');
    for (const name of ['body', 'headlights', 'taillights', 'wheelFL', 'wheelFR', 'wheelRL', 'wheelRR']) {
      const mesh = part(name);
      expect(mesh?.isMesh).toBe(true);
      expect(mesh.geometry.getAttribute('color')).toBeDefined();
    }
  });

  it('stays low-poly', () => {
    let tris = 0;
    scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) tris += m.geometry.getAttribute('position').count / 3;
    });
    expect(tris).toBeLessThan(2000);
  });

  it('is a real-sized car facing +z', () => {
    const box = new Box3().setFromObject(scene);
    expect(box.max.z - box.min.z).toBeGreaterThan(4.2); // length
    expect(box.max.z - box.min.z).toBeLessThan(4.8);
    expect(box.max.y - box.min.y).toBeLessThan(1.9); // height
    expect(box.min.y).toBeCloseTo(0, 1); // tires on the ground
    const front = new Box3().setFromObject(part('wheelFL'));
    expect(front.min.z).toBeGreaterThan(0);
    // Headlights at the front, tail lights at the back.
    expect(new Box3().setFromObject(part('headlights')).min.z).toBeGreaterThan(1.5);
    expect(new Box3().setFromObject(part('taillights')).max.z).toBeLessThan(-1.5);
  });

  it('has its wheels where the physics puts them', () => {
    for (const w of SEDAN.wheels) {
      const wheel = part(w.name);
      expect(wheel.position.x).toBeCloseTo(w.x, 2);
      expect(wheel.position.z).toBeCloseTo(w.z, 2);
      expect(wheel.position.y).toBeCloseTo(SEDAN.wheelY, 2);
      const box = new Box3().setFromObject(wheel);
      expect((box.max.y - box.min.y) / 2).toBeCloseTo(SEDAN.wheelRadius, 1);
    }
  });
});

describe('prepareCarModel', async () => {
  const model = prepareCarModel(await load(join(import.meta.dirname, '..', 'public', SEDAN.model)));

  it('gives the lamps glowing materials and finds every wheel', () => {
    expect(Object.keys(model.wheels).sort()).toEqual(['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR']);
    expect((model.root.getObjectByName('headlights') as Mesh).material).toBe(model.lamps.head);
    expect(model.lamps.head.emissiveIntensity).toBeGreaterThan(0);
    expect(model.lamps.tail.toneMapped).toBe(false); // or bright and dim red look alike
  });

  it('brightens the tail lights while braking', () => {
    setBrakeLights(model, true);
    expect(model.lamps.tail.emissiveIntensity).toBe(LAMPS.tail.braking);
    setBrakeLights(model, false);
    expect(model.lamps.tail.emissiveIntensity).toBe(LAMPS.tail.idle);
    expect(LAMPS.tail.braking).toBeGreaterThan(LAMPS.tail.idle * 3);
  });
});

describe('halos', async () => {
  const model = prepareCarModel(await load(join(import.meta.dirname, '..', 'public', SEDAN.model)));

  it('puts one halo on each lamp: two tail lights, two headlights, at the back and front', () => {
    expect(model.halos.tail).toHaveLength(2);
    expect(model.halos.head).toHaveLength(2);
    expect(model.halos.tail.every((h) => h.position.z < -1.5)).toBe(true);
    expect(model.halos.head.every((h) => h.position.z > 1.5)).toBe(true);
    expect(Math.sign(model.halos.tail[0].position.x)).not.toBe(Math.sign(model.halos.tail[1].position.x));
  });

  it('glows bigger and brighter while braking', () => {
    updateHalos(model, false, 1, 0);
    const idle = { size: model.halos.tail[0].scale.x, opacity: model.halos.tail[0].material.opacity };
    updateHalos(model, true, 1, 0);
    expect(model.halos.tail[0].scale.x).toBeGreaterThan(idle.size * 1.5);
    expect(model.halos.tail[0].material.opacity).toBeGreaterThan(idle.opacity);
    expect(model.halos.tail[0].material.opacity).toBe(HALO.tail.braking.opacity);
  });

  it('hides halos whose lamps face away from the camera', () => {
    updateHalos(model, true, 1, 0); // seen from behind
    expect(model.halos.head.every((h) => !h.visible)).toBe(true);
    expect(model.halos.tail.every((h) => h.visible)).toBe(true);
    updateHalos(model, true, 0, 1); // seen from the front
    expect(model.halos.tail.every((h) => !h.visible)).toBe(true);
    expect(model.halos.head[0].material.opacity).toBeCloseTo(HALO.head.opacity);
  });

  it('is light, not paint: added on top, not tone mapped, not hiding things behind it', () => {
    const m = model.halos.tail[0].material;
    expect(m.toneMapped).toBe(false);
    expect(m.depthWrite).toBe(false);
    expect(m.blending).toBe(2); // AdditiveBlending
  });

  it('poses the body without moving the wheels', () => {
    poseBody(model, 0.03, -0.02);
    expect(model.body.rotation.x).toBeCloseTo(0.03);
    expect(model.body.rotation.z).toBeCloseTo(-0.02);
    expect(model.wheels.wheelFL.parent).not.toBe(model.body);
    poseBody(model, 0, 0);
  });
});

describe('haloTexture and lampCenters', () => {
  it('fades from opaque in the middle to clear at the edge', () => {
    const tex = haloTexture(16);
    const data = tex.image.data as Uint8Array;
    const alpha = (x: number, y: number) => data[(y * 16 + x) * 4 + 3];
    expect(alpha(8, 8)).toBeGreaterThan(200);
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(8, 8)).toBeGreaterThan(alpha(12, 8));
  });
  it('finds the left and right lamp centers', async () => {
    const { BufferGeometry, Float32BufferAttribute } = await import('three');
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([1, 0, 0, 1, 2, 0, -1, 0, 0, -1, 2, 0], 3));
    const [left, right] = lampCenters(g);
    expect(left.toArray()).toEqual([1, 1, 0]);
    expect(right.toArray()).toEqual([-1, 1, 0]);
  });
});

describe('blobShadowGeometry', () => {
  const g = blobShadowGeometry(2, 4, 0.5, 16);
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');

  it('is dark in the middle and clear at the rim', () => {
    expect(col.itemSize).toBe(4);
    expect(col.getW(0)).toBe(0.5);
    expect(col.getW(pos.count - 1)).toBe(0);
  });

  it('lies flat, a bit bigger than the car, facing up', () => {
    let maxX = 0;
    let maxZ = 0;
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBe(0);
      maxX = Math.max(maxX, pos.getX(i));
      maxZ = Math.max(maxZ, pos.getZ(i));
    }
    expect(maxX).toBeGreaterThan(1);
    expect(maxZ).toBeGreaterThan(2);
    const idx = g.getIndex()!;
    for (let i = 0; i < idx.count; i += 3) {
      const [a, b, c] = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
      // y of the cross product (b - a) x (c - a) is positive for a face seen from above
      const cross = (pos.getZ(b) - pos.getZ(a)) * (pos.getX(c) - pos.getX(a)) - (pos.getX(b) - pos.getX(a)) * (pos.getZ(c) - pos.getZ(a));
      expect(cross).toBeGreaterThanOrEqual(0);
    }
  });
});
