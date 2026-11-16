/**
 * A car's picture on its CARS card: a PNG drawn ahead of time from its model by
 * tools/car-thumbs.ts (`picture` in game/cars.ts), so the menu needs no 3D of its own. Cars
 * that aren't out yet get a lock badge in the corner.
 */
import type { CarDef } from '../game/cars';
import { Lock } from './icons';

export function CarPicture({ car, locked }: { car: CarDef; locked?: boolean }) {
  return (
    <div className={locked ? 'car-picture locked' : 'car-picture'}>
      <img src={`${import.meta.env.BASE_URL}${car.picture}`} alt="" width={320} height={160} loading="lazy" draggable={false} />
      {locked && (
        <span className="car-lock" aria-label="Locked">
          <Lock />
        </span>
      )}
    </div>
  );
}
