/**
 * A minimal PNG reader for the tools: 8-bit RGB or RGBA, not interlaced (what the model
 * packs' color maps are). Enough to look up colors; not a general decoder.
 */
import { inflateSync } from 'node:zlib';

export interface Png {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, rows from the top. */
  data: Uint8Array;
}

export function readPng(buf: Buffer): Png {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let [width, height, colorType] = [0, 0, 0];
  const idat: Buffer[] = [];
  for (let at = 8; at < buf.length; ) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      [width, height] = [body.readUInt32BE(0), body.readUInt32BE(4)];
      const [depth, interlace] = [body[8], body[12]];
      colorType = body[9];
      if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) throw new Error('only 8-bit RGB/RGBA, not interlaced');
    } else if (type === 'IDAT') idat.push(body);
    at += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  if (bpp === 4) return { width, height, data: px };
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([px[i * 3], px[i * 3 + 1], px[i * 3 + 2], 255], i * 4);
  return { width, height, data };
}
