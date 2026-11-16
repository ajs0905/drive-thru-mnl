/** What the drive loading screen shows: its steps, in order, and the tips it picks from. */

export const DRIVE_STEPS = ['Loading the physics', 'Making the city solid', 'Placing your car'] as const;

/** The step indices, for whoever moves the loading along. */
export const STEP = { engine: 0, solid: 1, car: 2, done: 3 } as const;

const TIPS = {
  keys: [
    'Tap Space mid-turn to drift, stay on the gas to hold it',
    'Press M for the map',
    'Stuck or flipped? Press R',
    'Cones and drums go flying. The concrete ones don’t move',
    'Parked cars can be shoved. They go back once you look away',
  ],
  touch: [
    'Tap the handbrake mid-turn to drift, stay on the gas to hold it',
    'Tap the minimap for the full map',
    'Stuck or flipped? Tap reset at the top right',
    'Cones and drums go flying. The concrete ones don’t move',
    'Parked cars can be shoved. They go back once you look away',
  ],
};

/** A tip for this drive (`n` counts drives, so each one shows the next tip). */
export function tipFor(touch: boolean, n: number): string {
  const list = touch ? TIPS.touch : TIPS.keys;
  return list[((n % list.length) + list.length) % list.length];
}

/** What the welcome card lists (ui/Welcome.tsx): free roam always, the modes and cars once they're in. */
export const WELCOME_ROWS: { title: string; text: string }[] = [
  { title: 'FREE ROAM', text: "Drive BGC's real streets. Try the handling, take the flyovers, find your own shortcuts." },
];
