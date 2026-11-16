/**
 * The parked-car models (public/models/parked-cars.glb) ready to draw as instances, and
 * their materials: shared by the parked cars and the traffic.
 */
import { BufferAttribute, MeshBasicMaterial, MeshLambertMaterial, type BufferGeometry, type Mesh, type Object3D } from 'three';
import { PARKED_MODELS } from '../car/parked';
import { restoreShine } from './carModel';
import { withCarShine } from './carShine';

/** Lambert with vertex colors where instance color replaces the painted parts, plus the shine. */
export function paintMaterial(): MeshLambertMaterial {
  return withCarShine(new MeshLambertMaterial({ vertexColors: true }), 'parked', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float paint;')
      // After three's own color code (vertex color times instance color): paint takes the
      // instance color outright, everything else keeps its vertex color.
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\n  vColor.rgb = mix(color.rgb, instanceColor.rgb, paint);\n#endif');
  });
}

/** The soft blob shadow under each car. */
export function blobMaterial(): MeshBasicMaterial {
  // Drawn just over the road surface without fighting it (like the player's blob).
  return new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}

/** One geometry per parked-car model (in PARKED_MODELS order), with its paint and shine attributes. */
export function parkedGeometries(scene: Object3D): BufferGeometry[] {
  return PARKED_MODELS.map((m) => {
    const mesh = scene.getObjectByName(m.name) as Mesh | undefined;
    if (!mesh) throw new Error(`parked-cars.glb has no ${m.name}`);
    const g = (mesh.geometry as BufferGeometry).clone();
    g.setAttribute('paint', g.getAttribute('_paint') ?? new BufferAttribute(new Float32Array(g.getAttribute('position').count), 1));
    g.deleteAttribute('_paint');
    restoreShine(g);
    return g;
  });
}
