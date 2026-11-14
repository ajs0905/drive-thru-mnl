import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three';
import type { MapData } from '../map/types';
import { buildCity, PALETTE, type CityMeshes, type LayerArrays } from './cityGeometry';
import { createRoadMaterial } from './roadMaterial';

function toGeometry(arrays: LayerArrays): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(arrays.position, 3));
  g.setAttribute('normal', new BufferAttribute(arrays.normal, 3));
  g.setAttribute('color', new BufferAttribute(arrays.color, 3));
  if (arrays.aux) g.setAttribute('roadAux', new BufferAttribute(arrays.aux, 4));
  g.computeBoundingSphere();
  return g;
}

function Layer({ arrays, offset = 0 }: { arrays: LayerArrays; offset?: number }) {
  const geometry = useMemo(() => toGeometry(arrays), [arrays]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (arrays.position.length === 0) return null;
  return (
    <mesh geometry={geometry}>
      <meshLambertMaterial
        vertexColors
        polygonOffset={offset !== 0}
        polygonOffsetFactor={offset}
        polygonOffsetUnits={offset}
      />
    </mesh>
  );
}

function Roads({ arrays }: { arrays: LayerArrays }) {
  const geometry = useMemo(() => toGeometry(arrays), [arrays]);
  const material = useMemo(() => createRoadMaterial(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  if (arrays.position.length === 0) return null;
  return <mesh geometry={geometry} material={material} />;
}

function Edge({ arrays }: { arrays: LayerArrays }) {
  const geometry = useMemo(() => toGeometry(arrays), [arrays]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (arrays.position.length === 0) return null;
  return (
    <mesh geometry={geometry} renderOrder={10}>
      <meshBasicMaterial vertexColors transparent opacity={0.5} side={DoubleSide} depthWrite={false} />
    </mesh>
  );
}

export function City({ map, onBuilt }: { map: MapData; onBuilt?: (m: CityMeshes) => void }) {
  const meshes = useMemo(() => buildCity(map), [map]);
  useEffect(() => onBuilt?.(meshes), [meshes, onBuilt]);

  const b = map.bounds;
  // Big enough to reach past the fog, so the ground fades into the sky's horizon color.
  const size = Math.max(b.maxX - b.minX, b.maxY - b.minY) + 30000;
  const cx = (b.minX + b.maxX) / 2;
  const cz = -(b.minY + b.maxY) / 2;

  return (
    <group>
      {/* Base ground sits a bit below 0 so big land-use areas don't flicker against it from far away. */}
      <mesh rotation-x={-Math.PI / 2} position={[cx, -0.15, cz]}>
        <planeGeometry args={[size, size]} />
        <meshLambertMaterial color={PALETTE.baseGround} />
      </mesh>
      <Layer arrays={meshes.ground} offset={-1} />
      <Roads arrays={meshes.roads} />
      <Layer arrays={meshes.buildings} />
      <Layer arrays={meshes.scenery} />
      <Layer arrays={meshes.structures} />
      <Edge arrays={meshes.edge} />
    </group>
  );
}
