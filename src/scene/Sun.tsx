/**
 * Sunlight: a directional light from the sun's direction plus sky/ground fill light.
 * With shadows on, the shadow map covers a square around where the camera is looking
 * (the controls' target), sized by how far away the camera is, so close-ups get
 * sharp shadows and overviews still get some. The square moves in whole shadow-map
 * texels, which keeps shadow edges from crawling as the camera pans.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { DirectionalLight, Vector3, type Camera } from 'three';
import { shadowHalfSize, snapToTexel } from './shadowFrame';
import { SKY } from './skyConfig';

const SUN_DISTANCE = 2500;

function useSun(shadowMap: number) {
  const sun = useMemo(() => {
    const light = new DirectionalLight(SKY.sun, SKY.sunIntensity);
    light.castShadow = shadowMap > 0;
    if (shadowMap > 0) {
      light.shadow.mapSize.set(shadowMap, shadowMap);
      light.shadow.camera.near = 1;
      light.shadow.camera.far = SUN_DISTANCE * 2;
      light.shadow.bias = -0.0004;
      light.shadow.normalBias = 0.5;
    }
    const focus = new Vector3();
    const frame = { half: 0 };
    const update = (camera: Camera, target: Vector3 | undefined) => {
      focus.copy(target ?? new Vector3());
      const half = shadowHalfSize(camera.position.distanceTo(focus));
      if (shadowMap > 0) {
        focus.x = snapToTexel(focus.x, half, shadowMap);
        focus.z = snapToTexel(focus.z, half, shadowMap);
        if (Math.abs(half - frame.half) > half * 0.05) {
          const cam = light.shadow.camera;
          cam.left = -half;
          cam.right = half;
          cam.top = half;
          cam.bottom = -half;
          cam.updateProjectionMatrix();
          frame.half = half;
        }
      }
      light.position.copy(focus).addScaledVector(SKY.sunDir, SUN_DISTANCE);
      light.target.position.copy(focus);
      light.target.updateMatrixWorld();
    };
    return { light, update };
  }, [shadowMap]);
  useEffect(() => () => sun.light.dispose(), [sun]);
  return sun;
}

export function Sun({ shadowMap }: { shadowMap: number }) {
  const sun = useSun(shadowMap);
  const controls = useThree((s) => s.controls) as unknown as { target?: Vector3 } | null;
  useFrame(({ camera }) => sun.update(camera, controls?.target));
  return (
    <>
      <primitive object={sun.light} />
      <primitive object={sun.light.target} />
      <hemisphereLight args={[SKY.fillSky, SKY.fillGround, SKY.fillIntensity]} />
    </>
  );
}
