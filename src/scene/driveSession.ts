/**
 * What the drive and the screens around it share while driving, written and read every
 * frame without going through React: where the car is (for the HUD's speed, street sign
 * and maps), the touch buttons held down, and one-off requests such as a reset.
 */
import { NO_KEYS, type DriveKeys } from '../car/controls';

export class DriveSession {
  /** Written by the car every frame: map position (m), height (m), map heading (rad), forward speed (m/s). */
  readonly car = { x: 0, y: 0, height: 0, heading: 0, speed: 0, placed: false };
  /** Held by the touch controls; merged with the keyboard's. */
  readonly touch: DriveKeys = { ...NO_KEYS };
  /** Put the car back on its wheels at the next physics step. */
  private resetAsked = false;

  /** Asks for a reset (the reset button, the pause menu). */
  requestReset() {
    this.resetAsked = true;
  }

  /** True once per reset asked for: the car calls this every physics step. */
  takeReset(): boolean {
    const asked = this.resetAsked;
    this.resetAsked = false;
    return asked;
  }

  /** Lets go of every touch button (when the controls hide or the game pauses). */
  releaseTouch() {
    Object.assign(this.touch, NO_KEYS);
  }
}

/** Keyboard and touch together: a control is held if either holds it. */
export function mergeKeys(a: DriveKeys, b: DriveKeys, out: DriveKeys): DriveKeys {
  out.up = a.up || b.up;
  out.down = a.down || b.down;
  out.left = a.left || b.left;
  out.right = a.right || b.right;
  out.handbrake = a.handbrake || b.handbrake;
  return out;
}
