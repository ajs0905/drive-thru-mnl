/**
 * The menu and drive loading backdrop (public/menu.jpg). It used to sit as a CSS
 * background that only started downloading once the menu existed, and the city build
 * right after could keep the page too busy to paint it: the menu showed on black.
 * Now index.html preloads it, one decoded copy is kept here, and the heavy work (the
 * city build, the drive's physics) waits until it's decoded (or a short timeout, so a
 * failed image never holds the game up).
 */
export const BACKDROP = `${import.meta.env.BASE_URL}menu.jpg`;

let ready: Promise<void> | null = null;
let image: HTMLImageElement | null = null;

/** Resolves once the backdrop is decoded and ready to paint, or after `timeout` ms. */
export function backdropReady(timeout = 2500): Promise<void> {
  if (!ready) {
    image = new Image();
    image.src = BACKDROP;
    const decoded = image.decode().catch(() => undefined);
    ready = Promise.race([decoded, new Promise((r) => setTimeout(r, timeout))]).then(() => undefined);
  }
  return ready;
}
