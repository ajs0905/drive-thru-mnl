/**
 * The game's version (package.json, put in by the build: `define` in vite.config.ts), shown
 * on the main menu so a screenshot or bug report says which release it came from.
 */
declare const __APP_VERSION__: string;

export const APP_VERSION: string = __APP_VERSION__;
