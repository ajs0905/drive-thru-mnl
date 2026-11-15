/**
 * Speed blur in Drive mode (Medium and High): past about 95 km/h the screen's edges
 * streak outward while the middle stays sharp (speedBlurShader.ts).
 *
 * The scene is drawn to the screen as usual. While the blur shows, the finished frame is
 * copied into a texture and the blur is drawn over it, only where the screen is blurred
 * (the sharp middle is left alone). An earlier version drew the whole scene into an
 * off-screen buffer instead (MSAA, half float, then a tone mapping pass): a full extra
 * set of screen-sized passes that cost real frame time the moment it switched on.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, type RefObject } from 'react';
import {
  FramebufferTexture,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  type Camera,
  type WebGLRenderer,
} from 'three';
import { SPEED_BLUR, speedBlurAmount } from '../car/speedBlur';
import { SpeedBlurShader } from './speedBlurShader';

export function SpeedBlur({ speed }: { speed: RefObject<number> }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  const built = useMemo(() => {
    const material = new ShaderMaterial({
      name: SpeedBlurShader.name,
      uniforms: {
        tScreen: { value: null },
        strength: { value: 0 },
        aspect: { value: 1 },
      },
      vertexShader: SpeedBlurShader.vertexShader,
      fragmentShader: SpeedBlurShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    const overlay = new Scene();
    overlay.add(quad);
    const out: Built = { overlay, overlayCamera: new OrthographicCamera(-1, 1, 1, -1, 0, 1), material, quad, texture: null, size: new Vector2(), shown: { strength: 0 } };
    return out;
  }, []);
  useEffect(() => {
    // Compiled up front, so the first fast stretch doesn't stutter.
    gl.compile(built.overlay, built.overlayCamera);
    return () => {
      built.texture?.dispose();
      built.material.dispose();
      built.quad.geometry.dispose();
    };
  }, [gl, built]);

  // Priority 1: this draws the frame instead of the renderer's automatic draw.
  useFrame((_, dt) => drawFrame(built, speed.current ?? 0, dt, gl, scene, camera), 1);
  return null;
}

interface Built {
  overlay: Scene;
  overlayCamera: OrthographicCamera;
  material: ShaderMaterial;
  quad: Mesh;
  /** The finished frame, copied (made at the drawing buffer's size, remade when it changes). */
  texture: FramebufferTexture | null;
  size: Vector2;
  shown: { strength: number };
}

/** Draws one frame: the scene, then the blur over its edges when it shows. */
function drawFrame(built: Built, speed: number, dt: number, gl: WebGLRenderer, scene: Scene, camera: Camera) {
  gl.render(scene, camera);
  const shown = built.shown;
  shown.strength += (speedBlurAmount(speed) - shown.strength) * Math.min(1, SPEED_BLUR.rate * dt);
  if (shown.strength < 0.002) return;
  const size = gl.getDrawingBufferSize(built.size);
  if (!built.texture || built.texture.image.width !== size.x || built.texture.image.height !== size.y) {
    built.texture?.dispose();
    built.texture = new FramebufferTexture(size.x, size.y);
    // Blur samples fall between pixels.
    built.texture.minFilter = built.texture.magFilter = LinearFilter;
    built.material.uniforms.tScreen.value = built.texture;
  }
  gl.copyFramebufferToTexture(built.texture);
  built.material.uniforms.strength.value = shown.strength;
  built.material.uniforms.aspect.value = size.x / Math.max(1, size.y);
  const autoClear = gl.autoClear;
  gl.autoClear = false;
  gl.render(built.overlay, built.overlayCamera);
  gl.autoClear = autoClear;
}
