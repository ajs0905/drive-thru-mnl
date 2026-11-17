/**
 * The cars the player can drive and what they cost in pesos earned from runs. The Sedan
 * is free. The others are pre-tuned profiles (no upgrades or paint), and are listed, with
 * their pictures, but locked until their models and tuning are in (`ready`).
 */
export interface CarDef {
  id: string;
  name: string;
  price: number;
  /** One sentence on what it's like. */
  blurb: string;
  /** Its model and tuning are in the game. */
  ready: boolean;
  /** Its picture for the CARS tab, drawn from its model by tools/car-thumbs.ts (under public/). */
  picture: string;
}

export const CARS: CarDef[] = [
  { id: 'sedan', name: 'Sedan', price: 0, blurb: "A comfy, easy car that's great for learning the streets of the city, and it slides around corners nicely when you tap the handbrake.", ready: true, picture: 'models/cars/sedan.png' },
  { id: 'van', name: 'Cargo Van', price: 6000, blurb: 'A big, heavy van that takes a while to get going but rides so smoothly that your cargo barely moves, so it is the one for fragile deliveries.', ready: false, picture: 'models/cars/van.png' },
  { id: 'muscle', name: 'Muscle Car', price: 15000, blurb: 'A loud car with all its power in the back wheels, really fast on the straights but easy to spin if you floor it coming out of a turn.', ready: false, picture: 'models/cars/muscle.png' },
  { id: 'coupe', name: 'Sports Coupe', price: 30000, blurb: "A light, quick car that turns the moment you steer, made for chasing the best times if you don't mind a few close calls.", ready: false, picture: 'models/cars/coupe.png' },
];

export const CAR_IDS = new Set(CARS.map((c) => c.id));
