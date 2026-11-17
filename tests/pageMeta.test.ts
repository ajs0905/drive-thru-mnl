/**
 * The page's description and link preview tags (index.html): what chat apps and social
 * sites show when the game's address is shared.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SITE = 'https://drive-thru-mnl.vercel.app/';
const html = readFileSync('index.html', 'utf8');

function meta(attr: 'name' | 'property', key: string): string | undefined {
  return html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`))?.[1];
}

/** Width and height of a JPEG, from its first frame header. */
function jpegSize(bytes: Buffer): [number, number] {
  let i = 2;
  while (i < bytes.length) {
    const marker = bytes[i + 1];
    const length = bytes.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return [bytes.readUInt16BE(i + 7), bytes.readUInt16BE(i + 5)];
    i += 2 + length;
  }
  throw new Error('no frame header');
}

describe('link previews', () => {
  it('has a description, title and the live address', () => {
    expect(meta('name', 'description')?.length).toBeGreaterThan(50);
    expect(meta('property', 'og:title')).toBe(html.match(/<title>([^<]*)<\/title>/)?.[1]);
    expect(meta('property', 'og:url')).toBe(SITE);
    expect(html).toContain(`<link rel="canonical" href="${SITE}" />`);
  });

  it('points at a 1200 x 630 picture that ships with the site, by full address', () => {
    const image = meta('property', 'og:image')!;
    expect(image.startsWith(SITE)).toBe(true);
    const file = `public/${image.slice(SITE.length)}`;
    expect(existsSync(file)).toBe(true);
    expect(jpegSize(readFileSync(file))).toEqual([1200, 630]);
    expect([meta('property', 'og:image:width'), meta('property', 'og:image:height')]).toEqual(['1200', '630']);
    expect(meta('name', 'twitter:card')).toBe('summary_large_image');
  });
});
