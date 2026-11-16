/**
 * A minimal PNG reader for the tools: 8-bit RGB, RGBA or palette, not interlaced (what the
 * model packs' color maps are). Enough to look up colors; not a general decoder.
 */
import { deflateSync, inflateSync } from 'node:zlib';

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
  let palette: Buffer | undefined;
  let alpha: Buffer | undefined;
  for (let at = 8; at < buf.length; ) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      [width, height] = [body.readUInt32BE(0), body.readUInt32BE(4)];
      const [depth, interlace] = [body[8], body[12]];
      colorType = body[9];
      if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 3 && colorType !== 6)) throw new Error('only 8-bit RGB/RGBA/palette, not interlaced');
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') alpha = body;
    else if (type === 'IDAT') idat.push(body);
    at += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 3 ? 1 : 3;
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
  if (bpp === 1) {
    if (!palette) throw new Error('palette PNG without PLTE');
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const k = px[i];
      data.set([palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2], alpha && k < alpha.length ? alpha[k] : 255], i * 4);
    }
    return { width, height, data };
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([px[i * 3], px[i * 3 + 1], px[i * 3 + 2], 255], i * 4);
  return { width, height, data };
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/** A minimal PNG writer: 8-bit RGBA, no filtering. Same input shape `readPng` returns. */
export function writePng({ width, height, data }: Png): Buffer {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
