/**
 * Quality tiers: the same city everywhere, with the expensive effects switched by
 * device. Picked by hand for now (HUD, or ?q=low|medium|high); automatic detection
 * from frame times comes with the tiles and tiers milestone (docs/ARCHITECTURE.md §8).
 */
export type Quality = 'low' | 'medium' | 'high';
export const QUALITIES: Quality[] = ['low', 'medium', 'high'];

export interface QualitySettings {
  /** Device pixel ratio range for rendering. */
  dpr: [number, number];
  /** Sun shadows near the camera: shadow map size, or 0 for none. */
  shadowMap: number;
  /** Post effects (ambient occlusion, bloom, multisampled buffers). */
  post: boolean;
  /** Share of filler city blocks past the map (0..1). */
  filler: number;
}

export const QUALITY: Record<Quality, QualitySettings> = {
  low: { dpr: [0.75, 1], shadowMap: 0, post: false, filler: 0.4 },
  medium: { dpr: [1, 1.5], shadowMap: 2048, post: false, filler: 1 },
  high: { dpr: [1, 2], shadowMap: 4096, post: true, filler: 1 },
};

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
