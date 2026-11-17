/**
 * The frame clock React Three Fiber keeps in its state (`state.clock`), built on
 * THREE.Timer. three.js deprecated THREE.Clock (r183) in favor of Timer, but Fiber 9 still
 * creates a Clock for every canvas; the build swaps that for this class
 * (tools/fiberClock.ts), so nothing in the game uses the deprecated module.
 *
 * Same fields and methods as THREE.Clock (what Fiber and the game read and write: getDelta,
 * elapsedTime, start, stop, oldTime), the same behavior: starts on the first getDelta when
 * `autoStart`, counts nothing while stopped.
 */
import { Timer } from 'three';

export class FrameClock {
  /** Start on the first getDelta() (THREE.Clock's default). */
  autoStart: boolean;
  /** When start() was last called (ms, performance.now()). */
  startTime = 0;
  /** When getDelta() last advanced the clock (ms, performance.now()). */
  oldTime = 0;
  /** Seconds counted while running since start(). */
  elapsedTime = 0;
  running = false;
  private readonly timer = new Timer();

  constructor(autoStart = true) {
    this.autoStart = autoStart;
  }

  /** Starts counting from now, elapsed time back to 0. */
  start(): void {
    this.timer.reset();
    this.startTime = performance.now();
    this.oldTime = this.startTime;
    this.elapsedTime = 0;
    this.running = true;
  }

  /** Stops counting (and stops it starting again on its own). */
  stop(): void {
    this.getElapsedTime();
    this.running = false;
    this.autoStart = false;
  }

  /** Seconds counted since start(), up to now. */
  getElapsedTime(): number {
    this.getDelta();
    return this.elapsedTime;
  }

  /** Seconds since the last call (0 on the call that starts the clock, and while stopped). */
  getDelta(): number {
    if (this.autoStart && !this.running) {
      this.start();
      return 0;
    }
    if (!this.running) return 0;
    this.timer.update();
    const delta = this.timer.getDelta();
    this.oldTime = performance.now();
    this.elapsedTime += delta;
    return delta;
  }
}
