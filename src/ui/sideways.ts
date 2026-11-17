/**
 * Phones play sideways. If the phone is held upright while driving, the game is drawn
 * turned 90 degrees clockwise, so turning the phone to the left shows it the right way up,
 * with no warning screen and no orientation lock (which also works with rotation lock on).
 */
import { useEffect, useState, type CSSProperties } from 'react';

/** The style that turns the whole app a quarter turn clockwise to fill a `width` x `height` screen held upright. */
export function sidewaysStyle(width: number, height: number): CSSProperties {
  return {
    position: 'fixed',
    left: 0,
    top: 0,
    width: `${height}px`,
    height: `${width}px`,
    transformOrigin: '0 0',
    transform: `translateX(${width}px) rotate(90deg)`,
  };
}

/** The sideways style while `on` and the screen is taller than wide, else undefined. Follows resizes and turns. */
export function useSideways(on: boolean): CSSProperties | undefined {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    if (!on) return;
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [on]);
  return on && size.h > size.w ? sidewaysStyle(size.w, size.h) : undefined;
}
