/**
 * Traffic on each quality tier: cars kept around the player, and how far (m) from the
 * camera they're drawn as full models (past that, a box car). Its own file so the menu's
 * quality settings don't pull the traffic simulation into the main bundle.
 */
export const TRAFFIC_TIERS = {
  low: { count: 24, near: 60 },
  medium: { count: 32, near: 90 },
  high: { count: 40, near: 120 },
};
