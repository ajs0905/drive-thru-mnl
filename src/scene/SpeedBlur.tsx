/**
 * Speed blur in Drive mode (Medium and High): past about 100 km/h the screen's edges
 * streak outward while the middle stays sharp (speedBlurShader.ts).
 *
 * It takes over drawing the frame: below the blur speed the scene is drawn straight to
 * the screen as usual, so the extra passes only cost anything while the blur shows.
 * While it shows, the scene is drawn into an off-screen buffer (with MSAA when the tier
 * has it), blurred, then tone mapped and converted to the screen's colors (OutputPass:
 * three.js skips both when drawing into a buffer).
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, type RefObject } from 'react';
import { DepthTexture, FloatType, HalfFloatType, WebGLRenderTarget, type Camera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SPEED_BLUR, speedBlurAmount } from '../car/speedBlur';
import { SpeedBlurShader } from './speedBlurShader';

export function SpeedBlur({ speed, msaa }: { speed: RefObject<number>; msaa: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const built = useMemo(() => {
    // Float depth, so the reversed depth buffer keeps its precision off-screen too.
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: msaa ? 4 : 0 });
    target.depthTexture = new DepthTexture(1, 1, FloatType);
    const composer = new EffectComposer(gl, target);
    composer.addPass(new RenderPass(scene, camera));
    const blur = new ShaderPass(SpeedBlurShader);
    composer.addPass(blur);
    composer.addPass(new OutputPass());
    const out: Built = { composer, blur, shown: { strength: 0 } };
    return out;
  }, [gl, scene, camera, msaa]);
  useEffect(() => () => built.composer.dispose(), [built]);
  useEffect(() => resize(built.composer, size.width, size.height, gl.getPixelRatio()), [built, size, gl]);

  // Priority 1: this draws the frame instead of the renderer's automatic draw.
  useFrame((_, dt) => drawFrame(built, speed.current ?? 0, dt, gl, scene, camera, size), 1);
  return null;
}

interface Built {
  composer: EffectComposer;
  blur: ShaderPass;
  shown: { strength: number };
}

/** Draws one frame: straight to the screen, or through the blur when it shows. */
function drawFrame(built: Built, speed: number, dt: number, gl: WebGLRenderer, scene: Scene, camera: Camera, size: { width: number; height: number }) {
  const shown = built.shown;
  shown.strength += (speedBlurAmount(speed) - shown.strength) * Math.min(1, SPEED_BLUR.rate * dt);
  if (shown.strength < 0.002) {
    gl.render(scene, camera);
    return;
  }
  if (pixelRatioOf(built.composer) !== gl.getPixelRatio()) resize(built.composer, size.width, size.height, gl.getPixelRatio());
  built.blur.uniforms.strength.value = shown.strength;
  built.blur.uniforms.aspect.value = size.width / Math.max(1, size.height);
  built.composer.render(dt);
}

/** The composer's pixel ratio (EffectComposer keeps it but doesn't expose it in its types). */
function pixelRatioOf(composer: EffectComposer): number {
  return (composer as unknown as { _pixelRatio: number })._pixelRatio;
}

function resize(composer: EffectComposer, width: number, height: number, pixelRatio: number) {
  composer.setPixelRatio(pixelRatio);
  composer.setSize(width, height);
}
