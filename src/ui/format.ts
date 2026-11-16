/** How the game writes money, times and distances. */

/** Pesos with centavos: "₱1,234.50" (a minus sign in front for deductions). */
export function pesos(n: number): string {
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '-' : ''}₱${s}`;
}

/** Whole pesos for prices: "₱6,000". */
export function price(n: number): string {
  return `₱${Math.round(n).toLocaleString('en-US')}`;
}

/** Minutes and seconds: "2:05". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "850 m" under a kilometer, then "1.4 km". */
export function distance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}
