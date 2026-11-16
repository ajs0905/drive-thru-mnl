/**
 * The cars the player can drive and what they cost in pesos earned from runs. The Sedan
 * is free. The others are pre-tuned profiles (no upgrades or paint), and are listed but
 * locked until their models are in (`ready`).
 */
export interface CarDef {
  id: string;
  name: string;
  price: number;
  /** One line on what it's like. */
  blurb: string;
  /** Its model and tuning are in the game. */
  ready: boolean;
}

export const CARS: CarDef[] = [
  { id: 'sedan', name: 'Sedan', price: 0, blurb: 'Balanced and forgiving. Drifts when you ask it to.', ready: true },
  { id: 'van', name: 'Cargo Van', price: 6000, blurb: 'Slow off the line, steady with fragile cargo.', ready: false },
  { id: 'muscle', name: 'Muscle Car', price: 15000, blurb: 'Big power, loose rear end.', ready: false },
  { id: 'coupe', name: 'Sports Coupe', price: 30000, blurb: 'Fastest and sharpest. Punishes mistakes.', ready: false },
];

export const CAR_IDS = new Set(CARS.map((c) => c.id));
