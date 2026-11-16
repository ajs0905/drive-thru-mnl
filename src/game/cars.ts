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
  /** Its picture for the CARS tab, drawn from the model by tools/car-thumbs.ts (under public/). */
  picture?: string;
}

export const CARS: CarDef[] = [
  { id: 'sedan', name: 'Sedan', price: 0, blurb: 'Easy to drive and easy to slide. Good for learning the streets.', ready: true, picture: 'models/cars/sedan.png' },
  { id: 'van', name: 'Cargo Van', price: 6000, blurb: 'Heavy and slow to get going, but it rides soft, so the cargo stays put.', ready: false, picture: 'models/cars/van.png' },
  { id: 'muscle', name: 'Muscle Car', price: 15000, blurb: 'Lots of power at the back. Go easy on the gas out of corners.', ready: false },
  { id: 'coupe', name: 'Sports Coupe', price: 30000, blurb: "Light, quick and sharp to steer. It won't forgive a lazy line.", ready: false },
];

export const CAR_IDS = new Set(CARS.map((c) => c.id));
