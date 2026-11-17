import { describe, expect, it } from 'vitest';
import { shouldTrack, withoutQuery } from './analytics';

describe('analytics', () => {
  it('counts visits only on the deployed production build', () => {
    expect(shouldTrack(true, 'drive-thru-mnl.vercel.app')).toBe(true);
    expect(shouldTrack(false, 'drive-thru-mnl.vercel.app')).toBe(false);
  });

  it('never counts this machine or the local network', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', '0.0.0.0', '192.168.1.23', '10.0.0.5', '172.16.4.2', '172.31.255.1', 'laptop.local']) {
      expect(shouldTrack(true, host), host).toBe(false);
    }
    expect(shouldTrack(true, '172.32.0.1')).toBe(true);
  });

  it('reports pages without the query string or hash', () => {
    const view = { type: 'pageview' as const, url: 'https://drive-thru-mnl.vercel.app/?cam=1,2,3,4,5,6&debug#x' };
    expect(withoutQuery(view).url).toBe('https://drive-thru-mnl.vercel.app/');
    expect(withoutQuery({ type: 'pageview', url: 'https://drive-thru-mnl.vercel.app/' }).url).toBe('https://drive-thru-mnl.vercel.app/');
  });
});
