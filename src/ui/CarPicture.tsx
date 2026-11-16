/**
 * A car's picture on its CARS card: the PNG drawn from its model by tools/car-thumbs.ts
 * (`picture` in game/cars.ts), or a plain side outline while its model isn't in yet.
 */
import type { CarDef } from '../game/cars';

/** Side outlines (facing right, 320 x 160 like the pictures): body, then the two wheels. */
const OUTLINES: Record<string, { body: string; wheels: [number, number]; r: number }> = {
  muscle: {
    body: 'M28 116 L32 94 Q38 86 66 84 L118 82 L148 60 Q158 53 188 53 L214 55 Q228 57 246 79 L282 85 Q294 88 294 100 L294 116 Z',
    wheels: [84, 240],
    r: 21,
  },
  coupe: {
    body: 'M26 116 L29 100 Q33 91 58 89 L122 84 Q150 62 180 60 L206 61 Q236 67 264 85 L288 91 Q296 95 294 108 L294 116 Z',
    wheels: [82, 242],
    r: 19,
  },
};

export function CarPicture({ car }: { car: CarDef }) {
  if (car.picture) return <img className="car-picture" src={`${import.meta.env.BASE_URL}${car.picture}`} alt="" width={320} height={160} loading="lazy" draggable={false} />;
  const o = OUTLINES[car.id];
  if (!o) return null;
  return (
    <svg className="car-picture outline" viewBox="0 0 320 160" aria-hidden="true">
      <ellipse cx="160" cy="134" rx="138" ry="8" className="ground" />
      <path d={o.body} />
      {o.wheels.map((x) => (
        <circle key={x} cx={x} cy={116} r={o.r} />
      ))}
    </svg>
  );
}
