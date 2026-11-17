/**
 * The game around the driving: the saved wallet and progress, the run in play, and the
 * GPS route on the minimap. Plain TypeScript (no rendering): the HUD and menus subscribe
 * to it, the drive steps it once per frame with what the car is doing (`tick`), and it
 * asks the drive to move the car through `teleport`.
 *
 * The road graph, its landmarks and the places are built on first use (about 100 ms on
 * a desktop), when the modes menu opens or a route is first asked for.
 */
import { curbFinder } from '../car/curbSpot';
import type { MapData, Point } from '../map/types';
import { anchorPose, buildRoadGraph, snap, type Anchor, type RoadGraph } from '../routing/graph';
import { pointOnRoute, progressOnRoute, Router, type Route } from '../routing/route';
import { targetTime } from './cargo';
import { playableRuns, resolvePlaces, type Place, type RunDef } from './events';
import { lastCheckpoint, newRun, startCountdown, stepRun, type CarSignals, type Checkpoint, type RunState } from './run';
import { buyCar, creditRun, loadSave, writeSave, type Save, type SaveStorage } from './save';
import { Signals } from '../traffic/signals';

/** Where to put the car: map position, heading (radians counter-clockwise from east), height of the road (m). */
export interface Pose {
  p: Point;
  heading: number;
  z: number;
}

export interface Gps {
  route: Route;
  /** How far along the route the car is (m). */
  s: number;
  target: Point;
  kind: 'pickup' | 'dropoff';
}

export const GPS = {
  /** Re-plan once the car has been this far (m) off the route for `offFor` seconds. */
  off: 25,
  offFor: 1.2,
  /** Checkpoints every this many meters along a run's route, none in its last `checkpointEnd` m. */
  checkpointEvery: 400,
  checkpointEnd: 150,
};

/** What the car reports each frame: the run's signals plus where it points and how high it is. */
export interface CarState extends CarSignals {
  heading: number;
  height: number;
}

export class GameSession {
  save: Save;
  run: RunState | null = null;
  gps: Gps | null = null;
  /** A short banner ("GO!", "CHECKPOINT") and until when (game clock, s). */
  flash: { text: string; until: number } | null = null;
  /** Bumped on every change the UI shows. */
  version = 0;
  /** Seconds of driving so far (paused time doesn't count). */
  clock = 0;
  /** Moves the car (set by the drive, `setTeleport`). */
  teleport: (pose: Pose) => void = () => {};

  setTeleport(fn: (pose: Pose) => void) {
    this.teleport = fn;
  }

  private map: MapData | null = null;
  private built: { graph: RoadGraph; router: Router; places: Map<string, Place>; runs: RunDef[] } | null = null;
  private lights: Signals | null = null;
  private plans = new Map<string, { route: Route; target: number } | null>();
  private readonly listeners = new Set<() => void>();
  private readonly storage: SaveStorage | null | undefined;
  private offRoute = 0;
  private lastCar: CarState | null = null;

  constructor(storage?: SaveStorage | null) {
    this.storage = storage;
    this.save = storage === undefined ? loadSave() : loadSave(storage);
  }

  setMap(map: MapData) {
    if (map === this.map) return;
    this.map = map;
    this.built = null;
    this.lights = null;
    this.plans.clear();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  private changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private get world() {
    if (!this.built) {
      if (!this.map) throw new Error('GameSession: no map yet');
      const graph = buildRoadGraph(this.map);
      const router = new Router(graph);
      const places = resolvePlaces(this.map, graph, undefined, curbFinder(this.map));
      this.built = { graph, router, places, runs: playableRuns(places) };
    }
    return this.built;
  }

  /** Where the car was last seen (map space), or null before the first frame. */
  get lastCarPosition(): Point | null {
    return this.lastCar ? [this.lastCar.p[0], this.lastCar.p[1]] : null;
  }

  get ready(): boolean {
    return this.map !== null;
  }

  /** The road graph (built on first use): routes, and the traffic. */
  get graph(): RoadGraph {
    return this.world.graph;
  }

  /** The intersections' traffic signals (built on first use with the road graph): the traffic obeys them, the lights show them. */
  get signals(): Signals {
    this.lights ??= new Signals(this.graph, this.map?.dressing ?? []);
    return this.lights;
  }

  get runs(): RunDef[] {
    return this.world.runs;
  }

  place(id: string): Place | undefined {
    return this.world.places.get(id);
  }

  updateSave(change: (s: Save) => Save) {
    const next = change(this.save);
    if (next === this.save) return;
    this.save = next;
    if (this.storage === undefined) writeSave(next);
    else writeSave(next, this.storage);
    this.changed();
  }

  buy(carId: string) {
    this.updateSave((s) => buyCar(s, carId));
  }

  /** A run's planned route (pickup to drop-off) and target time, or null if there's no way. */
  plan(runId: string): { route: Route; target: number } | null {
    if (!this.plans.has(runId)) {
      const def = this.runs.find((r) => r.id === runId);
      const [a, b] = def ? [this.place(def.from), this.place(def.to)] : [];
      const route = a && b ? this.world.router.route(a.anchor, b.anchor) : null;
      this.plans.set(runId, route && { route, target: targetTime(route.time) });
    }
    return this.plans.get(runId) ?? null;
  }

  /** A route from the car (or wherever it last was) to an anchor. */
  private routeFromCar(to: Anchor): Route | null {
    const car = this.lastCar;
    if (!car) return null;
    const from = snap(this.world.graph, car.p, { heading: car.heading, z: car.height, reach: 120 });
    return from ? this.world.router.route(from, to) : null;
  }

  /** The route from where the car is to a run's pickup (for the menu's preview), if known. */
  routeToPickup(runId: string): Route | null {
    const def = this.runs.find((r) => r.id === runId);
    const pickup = def && this.place(def.from);
    return pickup ? this.routeFromCar(pickup.anchor) : null;
  }

  private startRun(runId: string, atPickup: boolean): boolean {
    const def = this.runs.find((r) => r.id === runId);
    const plan = this.plan(runId);
    const [a, b] = def ? [this.place(def.from), this.place(def.to)] : [];
    if (!def || !plan || !a || !b) return false;
    const checkpoints: Checkpoint[] = [];
    for (let s = GPS.checkpointEvery; s < plan.route.length - GPS.checkpointEnd; s += GPS.checkpointEvery) checkpoints.push(pointOnRoute(plan.route, s));
    this.run = newRun(def, { pickup: a.p, dropoff: b.p, pickupHeading: a.heading, dropoffHeading: b.heading, meters: plan.route.length, target: plan.target, checkpoints, atPickup });
    return true;
  }

  /** TELEPORT & START: the car to the pickup, and the run's intro. */
  teleportStart(runId: string) {
    if (!this.startRun(runId, true)) return;
    const a = this.place(this.run!.def.from)!;
    this.teleport({ p: a.p, heading: a.heading, z: 0 });
    this.gps = null;
    this.changed();
  }

  /** DRIVE THERE: a GPS route to the pickup; the intro opens once the car stops there. */
  driveThere(runId: string) {
    if (!this.startRun(runId, false)) return;
    const a = this.place(this.run!.def.from)!;
    const route = this.routeFromCar(a.anchor);
    this.gps = route && { route, s: 0, target: a.p, kind: 'pickup' };
    this.offRoute = 0;
    this.changed();
  }

  /** From the intro: the countdown (the car is held), then the run. */
  begin() {
    if (!this.run || this.run.phase !== 'intro') return;
    this.run = startCountdown(this.run, { impacts: this.lastCar?.impacts ?? 0 });
    const plan = this.plan(this.run.def.id);
    const b = this.place(this.run.def.to);
    this.gps = plan && b ? { route: plan.route, s: 0, target: b.p, kind: 'dropoff' } : null;
    this.offRoute = 0;
    this.changed();
  }

  /** The car is held still (the intro, so a teleport there settles, and the countdown). */
  get holding(): boolean {
    const p = this.run?.phase;
    return p === 'intro' || p === 'countdown';
  }

  /** An overlay is up that stops the game (the results). */
  get blocking(): boolean {
    const p = this.run?.phase;
    return p === 'done' || p === 'failed';
  }

  /** Back to free roam. */
  abandon() {
    this.run = null;
    this.gps = null;
    this.flash = null;
    this.changed();
  }

  /** The same run again from its pickup. */
  retry() {
    const id = this.run?.def.id;
    if (id) this.teleportStart(id);
  }

  /** Back to the last checkpoint passed (or the pickup); the clock keeps running. */
  toCheckpoint() {
    const r = this.run;
    if (!r || r.phase !== 'running') return;
    const c = lastCheckpoint(r);
    if (c) {
      // The checkpoint is on the road's centerline: keep right on two-way roads.
      const at = snap(this.world.graph, c.p, { heading: c.heading, reach: 10 });
      const e = at && this.world.graph.edges[at.edge];
      const off = e && !e.oneway ? Math.min(e.w / 4, 2) : 0;
      this.teleport({ p: [c.p[0] + Math.sin(c.heading) * off, c.p[1] - Math.cos(c.heading) * off], heading: c.heading, z: at ? anchorPose(this.world.graph, at).z : 0 });
    } else this.teleport({ p: r.pickup, heading: this.place(r.def.from)?.heading ?? 0, z: 0 });
    this.offRoute = GPS.offFor; // re-plan from the new spot right away
  }

  /** One frame of driving (not called while paused). */
  tick(car: CarState, dt: number) {
    this.lastCar = car;
    this.clock += dt;
    let changed = false;
    if (this.flash && this.clock > this.flash.until) {
      this.flash = null;
      changed = true;
    }
    if (this.run) {
      const before = this.run.phase;
      const { state, events } = stepRun(this.run, car, dt);
      this.run = state;
      for (const e of events) {
        if (e === 'go') this.flash = { text: 'GO!', until: this.clock + 1.2 };
        if (e === 'checkpoint') this.flash = { text: 'CHECKPOINT', until: this.clock + 1.5 };
        if (e === 'arrived') this.gps = null;
        if (e === 'done' && state.result?.receipt) {
          const net = state.result.receipt.net;
          this.updateSave((s) => creditRun(s, state.def.id, net, state.time));
          this.gps = null;
        }
        if (e === 'failed') this.gps = null;
      }
      // The running HUD shows the clock and integrity: a few updates a second are plenty for React.
      if (events.length || state.phase !== before || Math.floor(state.time * 4) !== Math.floor((state.time - dt) * 4) || (state.phase === 'countdown' && Math.ceil(state.countdown) !== Math.ceil(state.countdown + dt))) changed = true;
    }
    if (this.gps) {
      // The distance left on the HUD: a few updates a second.
      if (Math.floor(this.clock * 4) !== Math.floor((this.clock - dt) * 4)) changed = true;
      const at = progressOnRoute(this.gps.route, car.p, this.gps.s);
      this.gps.s = at.s;
      this.offRoute = at.off > GPS.off ? this.offRoute + dt : 0;
      if (this.offRoute >= GPS.offFor) {
        this.offRoute = 0;
        const to = this.gps.route.to;
        const route = this.routeFromCar(to);
        if (route) {
          this.gps = { ...this.gps, route, s: 0 };
          changed = true;
        }
      }
    }
    if (changed) this.changed();
  }

  /** Free roam again after a result. */
  closeResult() {
    if (this.run?.phase === 'done' || this.run?.phase === 'failed') this.abandon();
  }
}
