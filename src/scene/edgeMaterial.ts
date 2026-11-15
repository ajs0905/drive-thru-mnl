/**
 * Materials for the playable edge (City.tsx):
 *
 * - The hoarding (geometry/edgeFence.ts): Lambert, colored in the shader from each
 *   vertex's edge data: green corrugated sheet with darker seams every panel and an
 *   orange band along the top. The fine ripples fade out with distance (by screen-space
 *   derivatives), so they don't shimmer. (Roads get roadblocks instead: Roadblocks.tsx.)
 * - The map-view outline: the old see-through orange wall, so the edge still reads from
 *   high above. It fades out near the camera, where the fence takes over, and is hidden
 *   while driving.
 */
import { Color, DoubleSide, MeshBasicMaterial, MeshLambertMaterial } from 'three';

export const EDGE_LOOK = {
  hoarding: '#3d6e58',
  band: '#f0a531',
  /** Corrugation spacing, panel width and the top band's depth (m). */
  ripple: 0.18,
  panel: 2.4,
  bandDepth: 0.3,
  /** The map-view outline is invisible within `fadeFrom` of the camera and full past `fadeTo` (m). */
  fadeFrom: 120,
  fadeTo: 400,
  outlineOpacity: 0.5,
};

const vec3 = (hex: string) => {
  const c = new Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};

export function createFenceMaterial(): MeshLambertMaterial {
  const m = new MeshLambertMaterial();
  const L = EDGE_LOOK;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 edgeAux;\nvarying vec4 vEdge;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = edgeAux;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vEdge;').replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        float along = vEdge.x;
        float y = vEdge.y;
        float blur = clamp(fwidth(along) / ${L.ripple.toFixed(3)}, 0.0, 1.0);
        float ripple = 0.5 + 0.5 * sin(along * ${((2 * Math.PI) / L.ripple).toFixed(4)});
        vec3 c = ${vec3(L.hoarding)} * mix(0.86 + 0.14 * ripple, 0.93, blur);
        float seamWidth = 0.05 + fwidth(along);
        float seam = 1.0 - smoothstep(0.0, seamWidth, abs(fract(along / ${L.panel.toFixed(3)} + 0.5) - 0.5) * ${L.panel.toFixed(3)});
        c *= 1.0 - 0.3 * seam;
        if (y > vEdge.w - ${L.bandDepth.toFixed(3)}) c = ${vec3(L.band)};
        diffuseColor.rgb = c;
      }`,
    );
  };
  m.customProgramCacheKey = () => 'edge-fence';
  return m;
}

export function createOutlineMaterial(): MeshBasicMaterial {
  const L = EDGE_LOOK;
  const m = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: L.outlineOpacity, side: DoubleSide, depthWrite: false });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCamDist;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCamDist = length((modelMatrix * vec4(transformed, 1.0)).xyz - cameraPosition);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCamDist;')
      .replace('#include <opaque_fragment>', `diffuseColor.a *= smoothstep(${L.fadeFrom.toFixed(1)}, ${L.fadeTo.toFixed(1)}, vCamDist);\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'edge-outline';
  return m;
}
