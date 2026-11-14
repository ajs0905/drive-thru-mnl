/**
 * Post effects for the High tier: a subtle bloom on the sun and bright glass, the same
 * ACES tone mapping the other tiers get from the renderer, and SMAA edge smoothing.
 * (Screen-space ambient occlusion was tried and dropped: it was the most expensive
 * pass and misread the reversed depth buffer; walls get baked contact shading instead.)
 *
 * Loaded on demand (App.tsx uses React.lazy), so Low and Medium never download the
 * post-processing code.
 */
import { Bloom, EffectComposer, SMAA, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

export default function Effects() {
  return (
    // No multisampled buffers (costly with half-float targets); SMAA smooths edges instead.
    <EffectComposer multisampling={0}>
      <Bloom luminanceThreshold={0.92} luminanceSmoothing={0.1} intensity={0.25} mipmapBlur levels={5} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <SMAA />
    </EffectComposer>
  );
}
