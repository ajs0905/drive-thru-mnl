/**
 * Where to stop on a run: a tall glowing column and a ring on the road, yellow at the
 * pickup, green at the drop-off. Drawn additively without fog, so it reads from far
 * down the street; it pulses gently. Placed each frame from the game session.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { AdditiveBlending, Color, CylinderGeometry, DoubleSide, Group, Mesh, RingGeometry, ShaderMaterial } from 'three';
import type { GameSession } from '../game/session';

const COLORS = { pickup: '#ffd23f', dropoff: '#2fe07f' };
const COLUMN = { radius: 2.4, height: 18 };

function glowMaterial(fade: boolean): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { color: { value: new Color(COLORS.pickup) }, strength: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // The column fades out toward its top; the ring is even.
    fragmentShader: `uniform vec3 color; uniform float strength; varying vec2 vUv;
      void main() { float a = ${fade ? 'pow(1.0 - vUv.y, 1.6) * 0.55' : '0.75'}; gl_FragColor = vec4(color * a * strength, 1.0); }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
    toneMapped: false,
  });
}

export function RunMarkers({ game }: { game: GameSession }) {
  const built = useMemo(() => {
    const group = new Group();
    const columnMaterial = glowMaterial(true);
    const ringMaterial = glowMaterial(false);
    const column = new Mesh(new CylinderGeometry(COLUMN.radius, COLUMN.radius, COLUMN.height, 28, 1, true), columnMaterial);
    column.position.y = COLUMN.height / 2;
    const ring = new Mesh(new RingGeometry(COLUMN.radius, COLUMN.radius + 0.5, 40), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.32;
    for (const m of [column, ring]) {
      m.frustumCulled = false;
      m.renderOrder = 2;
      group.add(m);
    }
    group.visible = false;
    return { group, column, ring, materials: [columnMaterial, ringMaterial] };
  }, []);
  useEffect(
    () => () => {
      built.column.geometry.dispose();
      built.ring.geometry.dispose();
      for (const m of built.materials) m.dispose();
    },
    [built],
  );
  useFrame(({ clock }) => place(built, game, clock.elapsedTime));
  return <primitive object={built.group} />;
}

/** Shows the marker at the run's current stop (the pickup, then the drop-off), pulsing. */
function place(built: { group: Group; materials: ShaderMaterial[] }, game: GameSession, time: number) {
  const run = game.run;
  const phase = run?.phase;
  // Not at the pickup once there (the intro and countdown): the car stands in it.
  const kind = phase === 'to-pickup' ? 'pickup' : phase === 'running' ? 'dropoff' : null;
  built.group.visible = kind !== null;
  if (!run || !kind) return;
  const p = kind === 'pickup' ? run.pickup : run.dropoff;
  built.group.position.set(p[0], 0, -p[1]);
  const strength = 0.8 + 0.2 * Math.sin(time * 3);
  for (const m of built.materials) {
    (m.uniforms.color.value as Color).set(COLORS[kind]);
    m.uniforms.strength.value = strength;
  }
}
