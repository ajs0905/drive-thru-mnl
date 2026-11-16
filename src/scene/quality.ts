/**
 * Quality tiers: the same city everywhere, with the expensive effects switched by
 * device. Picked by hand for now (HUD, or ?q=low|medium|high); resolution adapts to
 * the frame rate within each tier. Automatic tier switching comes with the tiles and
 * tiers milestone (docs/ARCHITECTURE.md §8).
 */
export type Quality = 'low' | 'medium' | 'high';
export const QUALITIES: Quality[] = ['low', 'medium', 'high'];

export interface QualitySettings {
  /**
   * Pixel ratio range. Rendering starts at the top and steps down (to the bottom at
   * most) when the frame rate drops, then back up when there's headroom.
   */
  dpr: [number, number];
  /** Hardware anti-aliasing (MSAA) on the canvas. */
  msaa: boolean;
  /** Sun shadows near the camera: shadow map size, or 0 for none. */
  shadowMap: number;
  /** While the camera moves, re-render the shadow map at most every this many frames. */
  shadowEvery: number;
  /** Share of filler city blocks past the map (0..1). */
  filler: number;
  /** Procedural clouds in the sky shader (noise on every sky pixel). */
  clouds: boolean;
  /** Rooftop details and street fixtures are drawn only within this distance of the camera's focus (m). */
  propsDistance: number;
  /** Trees, the same way: they stay visible farther than small props. */
  treeDistance: number;
  /** Cars of light traffic kept around the player while driving. */
  traffic: number;
  /** Parked cars: real models out to `parkedNear` (m), simple box cars out to `parkedFar`, none past it. */
  parkedNear: number;
  parkedFar: number;
  /** Tree models (50 to 82 triangles, branches, palm fronds) instead of a trunk and one crown (38). */
  treeModels: boolean;
  /** Speed blur at the screen's edges while driving fast (two extra full-screen passes while it shows). */
  speedBlur: boolean;
  /**
   * Street and lot dressing (scene/Dressing.tsx): landmarks (cranes, containers, pavilions)
   * out to `dressingFar` (m), street clutter (benches, bins, hydrants, sheds) out to
   * `dressingNear`; 0 leaves the clutter out.
   */
  dressingNear: number;
  dressingFar: number;
  /** Street and traffic lights (tall, along every street) out to this distance (m). */
  dressingMid: number;
}

export const QUALITY: Record<Quality, QualitySettings> = {
  low: { dpr: [0.6, 1], msaa: false, shadowMap: 0, shadowEvery: 0, filler: 0.4, clouds: false, propsDistance: 500, treeDistance: 1000, treeModels: false, parkedNear: 35, parkedFar: 170, speedBlur: false, dressingNear: 0, dressingFar: 600, dressingMid: 220, traffic: 10 },
  medium: { dpr: [0.75, 1.25], msaa: true, shadowMap: 1024, shadowEvery: 4, filler: 1, clouds: true, propsDistance: 900, treeDistance: 1800, treeModels: true, parkedNear: 70, parkedFar: 300, speedBlur: true, dressingNear: 90, dressingFar: 900, dressingMid: 320, traffic: 14 },
  high: { dpr: [1, 1.25], msaa: true, shadowMap: 2048, shadowEvery: 2, filler: 1, clouds: true, propsDistance: 1400, treeDistance: 3000, treeModels: true, parkedNear: 100, parkedFar: 450, speedBlur: true, dressingNear: 120, dressingFar: 1400, dressingMid: 450, traffic: 18 },
};

/** Pixel ratio for a performance factor (1 = full) within a tier's range, never above the screen's. */
export function dprFor(range: [number, number], factor: number, screen: number): number {
  const [lo, hi] = range;
  return Math.min(screen, lo + (hi - lo) * Math.max(0, Math.min(1, factor)));
}

/** Frame rates below this lower the resolution; above `RAISE_FPS` raise it again. */
export const LOWER_FPS = 45;
export const RAISE_FPS = 57;

/**
 * Next performance factor after measuring an average frame rate over a run of
 * consecutive frames. Steps down faster than up, so it settles instead of bouncing.
 */
export function nextFactor(factor: number, fps: number): number {
  if (fps < LOWER_FPS) return Math.max(0, Math.round((factor - 0.2) * 10) / 10);
  if (fps > RAISE_FPS) return Math.min(1, Math.round((factor + 0.1) * 10) / 10);
  return factor;
}

/** Continuous rendering (`?render=always`), for benchmarks. Otherwise frames are drawn only when something changes. */
export function alwaysRender(): boolean {
  return new URLSearchParams(window.location.search).get('render') === 'always';
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
