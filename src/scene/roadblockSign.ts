/**
 * The roadblock sign's face, drawn once at run time on a canvas: black text on
 * construction orange with a black border, and a plain orange margin and black border
 * that the sign's back and posts use (SIGN_UV in geometry/roadblockShapes.ts).
 */
import { CanvasTexture, SRGBColorSpace } from 'three';
import { ROADBLOCK_COLORS } from '../geometry/roadblockShapes';

export const SIGN_TEXT = ['ROAD', 'UNDER', 'CONSTRUCTION'];

export function createSignTexture(width = 512, height = 384): CanvasTexture {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [width, height];
  const g = canvas.getContext('2d')!;
  g.fillStyle = ROADBLOCK_COLORS.orange;
  g.fillRect(0, 0, width, height);
  // Border from 3% to 7% of the size: SIGN_UV.black (0.05) lands on it, SIGN_UV.orange (0.012) outside it.
  g.strokeStyle = '#111111';
  g.lineWidth = 0.04 * height;
  g.strokeRect(0.05 * width, 0.05 * height, 0.9 * width, 0.9 * height);
  g.fillStyle = '#111111';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lines = SIGN_TEXT.length;
  const room = 0.72 * width;
  for (let i = 0; i < lines; i++) {
    let size = 0.2 * height;
    g.font = `bold ${size}px Arial, Helvetica, sans-serif`;
    const w = g.measureText(SIGN_TEXT[i]).width;
    if (w > room) {
      size *= room / w;
      g.font = `bold ${size}px Arial, Helvetica, sans-serif`;
    }
    g.fillText(SIGN_TEXT[i], width / 2, height * (0.27 + (0.46 * i) / (lines - 1)));
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
