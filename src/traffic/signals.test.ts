import { describe, expect, it } from 'vitest';
import bgcRaw from '../../public/data/bgc.json?raw';
import { PARKED_MODELS, PARKED_PAINTS } from '../car/parked';
import type { MapData } from '../map/types';
import { buildRoadGraph } from '../routing/graph';
import { CYCLE, lampAt, phaseOf, SIGNAL, Signals } from './signals';
import { parkingRoom, TrafficSim } from './sim';

describe('the signal cycle', () => {
  it('never shows green both ways, and gives each phase green, amber, then red', () => {
    let both = 0;
    const seen = { 0: new Set<string>(), 1: new Set<string>() };
    for (let t = 0; t < CYCLE * 2; t += 0.25) {
      const [a, b] = [lampAt(0, t), lampAt(1, t)];
      if (a !== 'red' && b !== 'red') both++;
      seen[0].add(a);
      seen[1].add(b);
    }
    expect(both).toBe(0);
    expect([...seen[0]].sort()).toEqual(['amber', 'green', 'red']);
    expect([...seen[1]].sort()).toEqual(['amber', 'green', 'red']);
    expect(lampAt(0, 0)).toBe('green');
    expect(lampAt(0, SIGNAL.green + 0.1)).toBe('amber');
    expect(lampAt(1, 0)).toBe('red');
  });

  it('puts both ways along an axis in one phase, and across it in the other', () => {
    expect(phaseOf(0, 0)).toBe(0);
    expect(phaseOf(Math.PI, 0)).toBe(0);
    expect(phaseOf(Math.PI / 2, 0)).toBe(1);
    expect(phaseOf(-Math.PI / 2 + 0.2, 0)).toBe(1);
  });
});

describe('signals on the real map', () => {
  const map = JSON.parse(bgcRaw) as MapData;
  const graph = buildRoadGraph(map);
  const signals = new Signals(graph, map.dressing ?? []);
  const poles = (map.dressing ?? []).filter((d) => d.k === 'signal' || d.k === 'signalpole');

  it('finds the signalled intersections, with every pole on one, and approaches in both phases', () => {
    expect(signals.poles.length).toBe(poles.length);
    expect(signals.junctions.length).toBeGreaterThan(30);
    let approaches = 0;
    const phases = signals.junctions.map(() => new Set<number>());
    graph.edges.forEach((_, ei) => {
      const p = signals.phaseOfEdge(ei);
      if (p < 0) return;
      approaches++;
    });
    for (const pole of signals.poles) phases[pole.junction].add(pole.phase);
    expect(approaches).toBeGreaterThan(signals.junctions.length * 2);
    // Most intersections have lights for both phases (a few T-junctions only one way).
    expect(phases.filter((s) => s.size === 2).length).toBeGreaterThan(signals.junctions.length * 0.6);
  });

  it('stops traffic on red: cars wait at red lights, and few enter a junction while their light is red', () => {
    const sim = new TrafficSim(graph, {
      count: 40,
      models: PARKED_MODELS.map((m) => ({ size: [m.size[0], m.size[1]] as [number, number], weight: m.weight })),
      paints: PARKED_PAINTS.map((p) => p.weight),
      room: parkingRoom(map.roads, map.parked ?? []),
      signals,
      seed: 'signals',
    });
    // Parked in the middle of BGC, where the avenues have lights.
    const at: [number, number] = [0, 0];
    const last = new Map<number, number>();
    let [entries, onRed, waiting] = [0, 0, 0];
    // Four minutes: five cycles (46 s each), enough junction entries to count.
    for (let i = 0; i < 60 * 240; i++) {
      signals.advance(1 / 60);
      sim.step(1 / 60, at, []);
      for (const a of sim.agents) {
        const before = last.get(a.id);
        if (before !== undefined && before !== a.edge && signals.edgeLamp(before) !== undefined) {
          entries++;
          if (signals.edgeLamp(before) === 'red') onRed++;
        }
        last.set(a.id, a.edge);
        if (i % 60 === 0 && a.v < 0.2 && signals.edgeLamp(a.edge) === 'red') waiting++;
      }
    }
    expect(entries).toBeGreaterThan(50);
    expect(waiting).toBeGreaterThan(20);
    // Only cars already committed when it turned (they had the junction before the amber) go on red.
    expect(onRed / entries).toBeLessThan(0.1);
  });
});
