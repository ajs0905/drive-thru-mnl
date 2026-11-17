/**
 * Visitor counts with Vercel Web Analytics (ADR 0032): page views without cookies, only in
 * the production build on the deployed site. The dev server, `npm run preview`, a phone on
 * the local network and the tests load and send nothing. Vercel serves the script from the
 * site itself (`/_vercel/insights/script.js`) and it reports back to the same place, so the
 * content security policy needs no outside address. Pages are reported without their query
 * string (`?debug`, `?cam=...` and the like are for testing, not separate pages).
 */
import { inject, type BeforeSendEvent } from '@vercel/analytics';

/** This machine or the local network: localhost, loopback, private IPv4 ranges, `.local` names. */
const LOCAL = /^(localhost|\[::1\]|0\.0\.0\.0|127(\.\d+){3}|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}|.*\.local)$/;

/** Report visits only from a production build served from somewhere other than this machine or network. */
export function shouldTrack(production: boolean, hostname: string): boolean {
  return production && !LOCAL.test(hostname);
}

/** The event with its URL cut at the query string or hash. */
export function withoutQuery(event: BeforeSendEvent): BeforeSendEvent {
  return { ...event, url: event.url.split(/[?#]/)[0] };
}

/** Starts the page view counting when `shouldTrack` says so (call once, at startup). */
export function startAnalytics(): void {
  if (!shouldTrack(import.meta.env.PROD, window.location.hostname)) return;
  inject({ mode: 'production', beforeSend: withoutQuery });
}
