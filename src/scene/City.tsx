import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide, MeshLambertMaterial, type Material } from 'three';
import type { MapData } from '../map/types';
import { buildCity, PALETTE, type CityMeshes, type LayerArrays } from './cityGeometry';
import { createBuildingMaterial } from './buildingMaterial';
import { createRoadMaterial } from './roadMaterial';
import { Props } from './Props';

function toGeometry(arrays: LayerArrays, auxName = 'roadAux'): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(arrays.position, 3));
  g.setAttribute('normal', new BufferAttribute(arrays.normal, 3));
  g.setAttribute('color', new BufferAttribute(arrays.color, 3));
  if (arrays.aux) g.setAttribute(auxName, new BufferAttribute(arrays.aux, 4));
  g.computeBoundingSphere();
  return g;
}

/** One chunk of a layer, with the layer's shared material. */
function ChunkMesh({
  arrays,
  material,
  auxName,
  cast = false,
}: {
  arrays: LayerArrays;
  material: Material;
  auxName?: string;
  cast?: boolean;
}) {
  const geometry = useMemo(() => toGeometry(arrays, auxName), [arrays, auxName]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (arrays.position.length === 0) return null;
  return <mesh geometry={geometry} material={material} castShadow={cast} receiveShadow />;
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

/** One material per layer, shared by all of its chunks. */
function useMaterials() {
  const materials = useMemo(
    () => ({
      buildings: createBuildingMaterial(),
      roads: createRoadMaterial(),
      // Small polygon offsets so land use never flickers against roads drawn over it.
      ground: new MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      structures: new MeshLambertMaterial({ vertexColors: true }),
    }),
    [],
  );
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);
  return materials;
}

export function City({
  map,
  onBuilt,
  propsDistance,
  treeDistance,
}: {
  map: MapData;
  onBuilt?: (m: CityMeshes) => void;
  propsDistance: number;
  treeDistance: number;
}) {
  const meshes = useMemo(() => buildCity(map), [map]);
  const materials = useMaterials();
  useEffect(() => onBuilt?.(meshes), [meshes, onBuilt]);

  const b = map.bounds;
  // Big enough to reach past the fog, so the ground fades into the sky's horizon color.
  const size = Math.max(b.maxX - b.minX, b.maxY - b.minY) + 30000;
  const cx = (b.minX + b.maxX) / 2;
  const cz = -(b.minY + b.maxY) / 2;

  return (
    <group>
      {/* Base ground sits a bit below 0 so big land-use areas don't flicker against it from far away. */}
      <mesh rotation-x={-Math.PI / 2} position={[cx, -0.15, cz]} receiveShadow>
        <planeGeometry args={[size, size]} />
        <meshLambertMaterial color={PALETTE.baseGround} />
      </mesh>
      {meshes.ground.map((c) => (
        <ChunkMesh key={`g${c.key}`} arrays={c.arrays} material={materials.ground} />
      ))}
      {meshes.roads.map((c) => (
        <ChunkMesh key={`r${c.key}`} arrays={c.arrays} material={materials.roads} auxName="roadAux" />
      ))}
      {meshes.buildings.map((c) => (
        <ChunkMesh key={`b${c.key}`} arrays={c.arrays} material={materials.buildings} auxName="wallAux" cast />
      ))}
      {/* The scenery ring is far outside the shadowed area around the camera's focus. */}
      {meshes.scenery.map((c) => (
        <ChunkMesh key={`s${c.key}`} arrays={c.arrays} material={materials.buildings} auxName="wallAux" />
      ))}
      {meshes.structures.map((c) => (
        <ChunkMesh key={`t${c.key}`} arrays={c.arrays} material={materials.structures} cast />
      ))}
      <Props cells={meshes.props} maxDistance={propsDistance} />
      <Props cells={meshes.trees} maxDistance={treeDistance} />
      <Edge arrays={meshes.edge} />
    </group>
  );
}
