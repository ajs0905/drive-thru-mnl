/**
 * What the drive and the screens around it share while driving, written and read every
 * frame without going through React: where the car is (for the HUD's speed, street sign
 * and maps), the touch buttons held down, and one-off requests such as a reset.
 */
import { NO_KEYS, type DriveKeys } from '../car/controls';

/** Where to move the car: map position, heading (radians counter-clockwise from east), height of the road there (m). */
export interface MapPose {
  p: [number, number];
  heading: number;
  z: number;
}

export class DriveSession {
  /**
   * Written by the car every frame: map position (m), height (m), map heading (rad), forward
   * speed (m/s); and for the cargo runs, its smoothed forward acceleration (m/s^2), drifting,
   * and its crash counter, the last crash's speed change (m/s) and whether one is going on.
   */
  readonly car = { x: 0, y: 0, height: 0, heading: 0, speed: 0, placed: false, accel: 0, drifting: false, impacts: 0, impact: 0, crashing: false };
  /** Held by the touch controls; merged with the keyboard's. */
  readonly touch: DriveKeys = { ...NO_KEYS };
  /** The car is held still (a run's countdown): input is ignored, the handbrake is on. */
  hold = false;
  /** Put the car back on its wheels at the next physics step. */
  private resetAsked = false;
  private teleportAsked: MapPose | null = null;

  /** Holds the car still, or lets it go. */
  setHold(hold: boolean) {
    this.hold = hold;
  }

  /** Moves the car (a run's start, a checkpoint) at the next physics step. */
  requestTeleport(pose: MapPose) {
    this.teleportAsked = pose;
  }

  /** The teleport asked for, once: the car calls this every physics step. */
  takeTeleport(): MapPose | null {
    const t = this.teleportAsked;
    this.teleportAsked = null;
    return t;
  }

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

  /** A touch button pressed or let go. */
  setTouch(key: keyof DriveKeys, held: boolean) {
    this.touch[key] = held;
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
