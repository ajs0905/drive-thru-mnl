/**
 * The menu and drive loading backdrops (public/menu.jpg, and public/menu-portrait.jpg for
 * the menu on screens narrower than 2:3, a phone held upright, where the wide shot would
 * crop the car). They used to sit as a CSS background that only started downloading once
 * the menu existed, and the city build right after could keep the page too busy to paint
 * it: the menu showed on black. Now index.html preloads the one the screen needs, one
 * decoded copy of each is kept here, and the heavy work (the city build, the drive's
 * physics) waits until its backdrop is decoded (or a short timeout, so a failed image
 * never holds the game up). The drive loading screen is always landscape (on an upright
 * phone it's drawn turned), so it always uses the wide shot.
 */
export const BACKDROP = `${import.meta.env.BASE_URL}menu.jpg`;
export const BACKDROP_PORTRAIT = `${import.meta.env.BASE_URL}menu-portrait.jpg`;
/** Screens this narrow get the portrait menu backdrop (keep in step with index.html). */
export const PORTRAIT_QUERY = '(max-aspect-ratio: 2/3)';

/** The menu's backdrop for this screen. */
export function menuBackdrop(): string {
  return typeof window !== 'undefined' && window.matchMedia?.(PORTRAIT_QUERY).matches ? BACKDROP_PORTRAIT : BACKDROP;
}

const ready = new Map<string, Promise<void>>();
const images: HTMLImageElement[] = [];

/** Resolves once `url` is decoded and ready to paint, or after `timeout` ms. */
export function backdropReady(url = menuBackdrop(), timeout = 2500): Promise<void> {
  let done = ready.get(url);
  if (!done) {
    const image = new Image();
    image.src = url;
    images.push(image);
    const decoded = image.decode().catch(() => undefined);
    done = Promise.race([decoded, new Promise((r) => setTimeout(r, timeout))]).then(() => undefined);
    ready.set(url, done);
  }
  return done;
}
