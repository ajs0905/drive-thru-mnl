/** What the drive loading screen shows: its steps, in order, and the tips it picks from. */

export const DRIVE_STEPS = ['Physics engine', 'Solid buildings and flyovers', 'Placing your car'] as const;

/** The step indices, for whoever moves the loading along. */
export const STEP = { engine: 0, solid: 1, car: 2, done: 3 } as const;

const TIPS = {
  keys: [
    'Tap Space while steering to start a drift, then hold the gas to keep it going',
    'Press M for the big map',
    'Stuck or upside down? Press R',
    'Cones, drums and barricades go flying. Concrete barriers don’t',
    'Parked cars can be pushed around, and go back to their spot once you look away',
  ],
  touch: [
    'Tap the handbrake while steering to start a drift',
    'Tap the minimap for the big map',
    'Stuck or upside down? Tap the reset button at the top',
    'Cones, drums and barricades go flying. Concrete barriers don’t',
    'Parked cars can be pushed around, and go back to their spot once you look away',
  ],
};

/** A tip for this drive (`n` counts drives, so each one shows the next tip). */
export function tipFor(touch: boolean, n: number): string {
  const list = touch ? TIPS.touch : TIPS.keys;
  return list[((n % list.length) + list.length) % list.length];
}
