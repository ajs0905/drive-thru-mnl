/**
 * Post effects for the High tier: ambient occlusion (N8AO: soft contact shadows where
 * walls meet the ground and in corners), a subtle bloom on the sun and bright glass,
 * and the same ACES tone mapping the other tiers get from the renderer.
 *
 * Loaded on demand (App.tsx uses React.lazy), so Low and Medium never download the
 * post-processing code.
 */
import { Bloom, EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

export default function Effects() {
  return (
    <EffectComposer multisampling={4}>
      <N8AO aoRadius={6} distanceFalloff={1.5} intensity={4} quality="medium" halfRes />
      <Bloom luminanceThreshold={0.92} luminanceSmoothing={0.1} intensity={0.25} mipmapBlur />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
