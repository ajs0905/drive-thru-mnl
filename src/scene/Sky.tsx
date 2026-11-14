/**
 * Sky: three.js's physically based sky (Preetham scattering model, with its built-in
 * procedural clouds), following the camera. No textures to download. The fog uses
 * the sky's horizon color and the sunlight comes from the sun's direction, so the
 * city blends into the sky and its shading matches the sun. One draw call.
 *
 * The sky shader expects a tone-mapped renderer; the city renders without tone
 * mapping (flat colors), so the sky applies its own ACES curve instead. Just above
 * the horizon the sky blends into the fog's haze color, so the ground's far edge
 * disappears into it.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Color, type Camera, type ShaderMaterial } from 'three';
import { Sky as SkyMesh } from 'three/examples/jsm/objects/Sky.js';
import { SKY } from './skyConfig';

const TONE_MAP = /* glsl */ `
uniform vec3 hazeColor;
vec3 skyAces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
`;

function useSkyMesh() {
  const sky = useMemo(() => {
    const mesh = new SkyMesh();
    mesh.scale.setScalar(10000);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    const m = mesh.material as ShaderMaterial;
    m.depthTest = false;
    m.fragmentShader =
      TONE_MAP +
      m.fragmentShader.replace(
        '#include <tonemapping_fragment>',
        `gl_FragColor.rgb = skyAces(gl_FragColor.rgb * ${SKY.exposure.toFixed(3)});
        gl_FragColor.rgb = mix(hazeColor, gl_FragColor.rgb, smoothstep(0.0, ${SKY.hazeHeight.toFixed(3)}, direction.y));`,
      );
    const u = m.uniforms;
    u.hazeColor = { value: new Color(SKY.horizon) };
    u.turbidity.value = SKY.turbidity;
    u.rayleigh.value = SKY.rayleigh;
    u.mieCoefficient.value = SKY.mieCoefficient;
    u.mieDirectionalG.value = SKY.mieDirectionalG;
    u.sunPosition.value.copy(SKY.sunDir);
    u.cloudCoverage.value = SKY.clouds.coverage;
    u.cloudDensity.value = SKY.clouds.density;
    u.cloudElevation.value = SKY.clouds.elevation;
    u.cloudScale.value = SKY.clouds.scale;
    u.cloudSpeed.value = SKY.clouds.speed;
    /** Per frame: stay centered on the camera (so the sky never gets closer) and drift the clouds. */
    const update = (camera: Camera, time: number) => {
      mesh.position.copy(camera.position);
      u.time.value = time;
    };
    return { mesh, update };
  }, []);
  useEffect(() => () => (sky.mesh.geometry.dispose(), (sky.mesh.material as ShaderMaterial).dispose()), [sky]);
  return sky;
}

/** Sky, clouds and sunlight. */
export function Sky() {
  const sky = useSkyMesh();
  const sun = useMemo(() => SKY.sunDir.clone().multiplyScalar(1500), []);
  useFrame(({ camera, clock }) => sky.update(camera, clock.elapsedTime));
  return (
    <>
      <primitive object={sky.mesh} />
      <hemisphereLight args={['#dceaf7', '#8f8a78', 1.1]} />
      {/* No shadows, so only the direction matters: from the sun toward the origin. */}
      <directionalLight position={[sun.x, sun.y, sun.z]} intensity={2.2} color={SKY.sun} />
    </>
  );
}
