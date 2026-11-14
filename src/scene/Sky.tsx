/**
 * Sky: three.js's physically based sky (Preetham scattering model, with its built-in
 * procedural clouds), following the camera. No textures to download. One draw call.
 *
 * It goes through the same tone mapping as the city. Just above the horizon it blends
 * into the fog's haze color (after tone mapping, like fog on three.js materials), so
 * the ground's far edge disappears into it on every quality tier.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Color, type Camera, type ShaderMaterial } from 'three';
import { Sky as SkyMesh } from 'three/examples/jsm/objects/Sky.js';
import { SKY } from './skyConfig';

function useSkyMesh(clouds: boolean) {
  const sky = useMemo(() => {
    const mesh = new SkyMesh();
    mesh.scale.setScalar(10000);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    const m = mesh.material as ShaderMaterial;
    m.depthTest = false;
    m.fragmentShader =
      'uniform vec3 hazeColor;\n' +
      m.fragmentShader.replace(
        '#include <tonemapping_fragment>',
        // Haze after tone mapping, matching three.js materials, which apply fog after it.
        `gl_FragColor.rgb *= ${SKY.exposure.toFixed(3)};
        #include <tonemapping_fragment>
        gl_FragColor.rgb = mix(hazeColor, gl_FragColor.rgb, smoothstep(0.0, ${SKY.hazeHeight.toFixed(3)}, direction.y));`,
      );
    const u = m.uniforms;
    u.hazeColor = { value: new Color(SKY.horizon) };
    u.turbidity.value = SKY.turbidity;
    u.rayleigh.value = SKY.rayleigh;
    u.mieCoefficient.value = SKY.mieCoefficient;
    u.mieDirectionalG.value = SKY.mieDirectionalG;
    u.sunPosition.value.copy(SKY.sunDir);
    // Coverage 0 skips the cloud noise in the shader entirely (Low tier).
    u.cloudCoverage.value = clouds ? SKY.clouds.coverage : 0;
    u.cloudDensity.value = SKY.clouds.density;
    u.cloudElevation.value = SKY.clouds.elevation;
    u.cloudScale.value = SKY.clouds.scale;
    u.cloudSpeed.value = SKY.clouds.speed;
    /**
     * Per frame: stay centered on the camera (so the sky never gets closer) and drift the
     * clouds. Cloud time only advances while frames are drawn, so they don't jump after idle.
     */
    const update = (camera: Camera, delta: number) => {
      mesh.position.copy(camera.position);
      u.time.value += Math.min(delta, 0.1);
    };
    return { mesh, update };
  }, [clouds]);
  useEffect(() => () => (sky.mesh.geometry.dispose(), (sky.mesh.material as ShaderMaterial).dispose()), [sky]);
  return sky;
}

export function Sky({ clouds = true }: { clouds?: boolean }) {
  const sky = useSkyMesh(clouds);
  useFrame(({ camera }, delta) => sky.update(camera, delta));
  return <primitive object={sky.mesh} />;
}
