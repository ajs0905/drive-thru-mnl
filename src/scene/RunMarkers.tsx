/**
 * Where to stop on a run: a curbside bay the size of a loading bay (game/run.ts ARRIVE.bay),
 * turned along the curb: a bright outline and a faint fill on the road, and a light
 * curtain rising from its edges and fading out, tall enough to spot down the street.
 * Yellow at the pickup, green at the drop-off. Drawn additively without fog or tone
 * mapping, pulled toward the camera (polygon offset) and with the scene's depth encoding,
 * so it shows on every tier and GPU; it pulses gently. Placed each frame from the game
 * session.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { AdditiveBlending, Color, CylinderGeometry, DoubleSide, Group, Mesh, Path, PlaneGeometry, ShaderMaterial, Shape, ShapeGeometry, Vector2 } from 'three';
import { yawForHeading } from '../car/spawn';
import { ARRIVE } from '../game/run';
import type { GameSession } from '../game/session';
import { ROAD_Y } from './cityGeometry';

const COLORS = { pickup: '#ffd23f', dropoff: '#2fe07f' };
/** The curtain's height (m), the outline's width (m), and how bright the fill is next to the outline. */
const BAY = { curtain: 7, line: 0.28, fill: 0.22 };
/** The outline and the fill sit just above the highest road surface (avenues). */
const LIFT = { line: ROAD_Y.major + 0.05, fill: ROAD_Y.major + 0.04 };

function glowMaterial(look: 'curtain' | 'line' | 'fill'): ShaderMaterial {
  const alpha = look === 'curtain' ? 'pow(1.0 - vUv.y, 1.8) * 0.5' : look === 'line' ? '0.85' : BAY.fill.toFixed(2);
  return new ShaderMaterial({
    uniforms: { color: { value: new Color(COLORS.pickup) }, strength: { value: 1 } },
    // The depth chunks matter: without reversed depth (most phones) the scene uses a
    // logarithmic depth buffer, and a shader writing plain depth ends up behind the road.
    vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
uniform vec3 color;
uniform float strength;
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(color * ${alpha} * strength, 1.0);
}`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
    toneMapped: false,
  });
}

/** A rectangle's outline, `line` wide, centered, in the xy plane: width along x, length along y. */
function outline(width: number, length: number, line: number): ShapeGeometry {
  const [w, l] = [width / 2, length / 2];
  const outer = new Shape([
    [-w, -l],
    [w, -l],
    [w, l],
    [-w, l],
  ].map(([x, y]) => new Vector2(x, y)));
  const [iw, il] = [w - line, l - line];
  outer.holes.push(new Path([
    [-iw, -il],
    [-iw, il],
    [iw, il],
    [iw, -il],
  ].map(([x, y]) => new Vector2(x, y))));
  return new ShapeGeometry(outer);
}

export function RunMarkers({ game }: { game: GameSession }) {
  const built = useMemo(() => {
    const { width, length } = ARRIVE.bay;
    const group = new Group();
    const materials = [glowMaterial('curtain'), glowMaterial('line'), glowMaterial('fill')];
    // A square open prism (4 sides) turned to line up with the axes, stretched to the bay.
    const curtainGeometry = new CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2, BAY.curtain, 4, 1, true).rotateY(Math.PI / 4).scale(width, 1, length).translate(0, BAY.curtain / 2, 0);
    const lineGeometry = outline(width, length, BAY.line).rotateX(-Math.PI / 2).translate(0, LIFT.line, 0);
    const fillGeometry = new PlaneGeometry(width - 2 * BAY.line, length - 2 * BAY.line).rotateX(-Math.PI / 2).translate(0, LIFT.fill, 0);
    const meshes = [new Mesh(curtainGeometry, materials[0]), new Mesh(lineGeometry, materials[1]), new Mesh(fillGeometry, materials[2])];
    for (const m of meshes) {
      m.frustumCulled = false;
      m.renderOrder = 2;
      group.add(m);
    }
    group.visible = false;
    return { group, meshes, materials };
  }, []);
  useEffect(
    () => () => {
      for (const m of built.meshes) m.geometry.dispose();
      for (const m of built.materials) m.dispose();
    },
    [built],
  );
  useFrame(({ clock }) => place(built, game, clock.elapsedTime));
  return <primitive object={built.group} />;
}

/** Shows the bay at the run's current stop (the pickup, then the drop-off), pulsing. */
function place(built: { group: Group; materials: ShaderMaterial[] }, game: GameSession, time: number) {
  const run = game.run;
  const phase = run?.phase;
  // Not at the pickup once there (the intro and countdown): the car stands in it.
  const kind = phase === 'to-pickup' ? 'pickup' : phase === 'running' ? 'dropoff' : null;
  built.group.visible = kind !== null;
  if (!run || !kind) return;
  const [p, heading] = kind === 'pickup' ? [run.pickup, run.pickupHeading] : [run.dropoff, run.dropoffHeading];
  built.group.position.set(p[0], 0, -p[1]);
  built.group.rotation.y = yawForHeading(heading);
  const strength = 0.8 + 0.2 * Math.sin(time * 3);
  for (const m of built.materials) {
    (m.uniforms.color.value as Color).set(COLORS[kind]);
    m.uniforms.strength.value = strength;
  }
}
