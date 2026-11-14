/**
 * Quality tiers: the same city everywhere, with the expensive effects switched by
 * device. Picked by hand for now (HUD, or ?q=low|medium|high); automatic detection
 * from frame times comes with the tiles and tiers milestone (docs/ARCHITECTURE.md §8).
 */
export type Quality = 'low' | 'medium' | 'high';
export const QUALITIES: Quality[] = ['low', 'medium', 'high'];

export interface QualitySettings {
  /**
   * Pixel ratio range. Rendering starts at the top and steps down (to the bottom at
   * most) when the frame rate drops, then back up when there's headroom.
   */
  dpr: [number, number];
  /** Sun shadows near the camera: shadow map size, or 0 for none. */
  shadowMap: number;
  /** Post effects (bloom, tone mapping pass, SMAA). */
  post: boolean;
  /** Share of filler city blocks past the map (0..1). */
  filler: number;
  /** Procedural clouds in the sky shader (noise on every sky pixel). */
  clouds: boolean;
}

export const QUALITY: Record<Quality, QualitySettings> = {
  low: { dpr: [0.6, 1], shadowMap: 0, post: false, filler: 0.4, clouds: false },
  medium: { dpr: [0.75, 1.25], shadowMap: 1024, post: false, filler: 1, clouds: true },
  high: { dpr: [1, 1.5], shadowMap: 2048, post: true, filler: 1, clouds: true },
};

/** Pixel ratio for a performance factor (1 = full) within a tier's range, never above the screen's. */
export function dprFor(range: [number, number], factor: number, screen: number): number {
  const [lo, hi] = range;
  return Math.min(screen, lo + (hi - lo) * Math.max(0, Math.min(1, factor)));
}

const KEY = 'drive-thru-mnl.quality';
const isQuality = (q: unknown): q is Quality => typeof q === 'string' && (QUALITIES as string[]).includes(q);

/** URL (?q=) first, then the saved choice, then a guess from the device. */
export function initialQuality(): Quality {
  const fromUrl = new URLSearchParams(window.location.search).get('q');
  if (isQuality(fromUrl)) return fromUrl;
  try {
    const saved = window.localStorage.getItem(KEY);
    if (isQuality(saved)) return saved;
  } catch {
    // storage can be unavailable (private mode, sandboxed frames)
  }
  return guessQuality({
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    cores: navigator.hardwareConcurrency,
  });
}

/** Phones and tablets start on Low, small desktops on Medium, the rest on High. */
export function guessQuality(d: { coarsePointer: boolean; memoryGb?: number; cores?: number }): Quality {
  if (d.coarsePointer) return 'low';
  if ((d.memoryGb !== undefined && d.memoryGb <= 4) || (d.cores !== undefined && d.cores <= 4)) return 'medium';
  return 'high';
}

export function saveQuality(q: Quality) {
  try {
    window.localStorage.setItem(KEY, q);
  } catch {
    // ignore: the choice just won't be remembered
  }
}

/**
 * Reversed depth (EXT_clip_control) keeps depth precise far away without writing depth
 * from the shader, so the GPU can skip hidden pixels early. Without the extension the
 * renderer falls back to a logarithmic depth buffer (slower, same precision).
 */
export function supportsReversedDepth(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ok = !!gl?.getExtension('EXT_clip_control');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}
