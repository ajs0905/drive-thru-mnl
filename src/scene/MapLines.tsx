import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry } from 'three';
import { toSegmentPositions } from '../map/segments';
import type { MapData, Point, RoadClass } from '../map/types';
import { COLORS } from './colors';


interface LayerProps {
  lines: Point[][];
  closed: boolean;
  color: string;
  order: number;
  opacity?: number;
}

/** One merged LineSegments mesh = one draw call for the whole layer. */
function Layer({ lines, closed, color, order, opacity = 1 }: LayerProps) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(toSegmentPositions(lines, closed, order * 0.01), 3));
    g.computeBoundingSphere();
    return g;
  }, [lines, closed, order]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  if (geometry.getAttribute('position').count === 0) return null;
  return (
    <lineSegments geometry={geometry} renderOrder={order}>
      <lineBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} depthWrite={false} />
    </lineSegments>
  );
}

const ROAD_LAYERS: RoadClass[] = ['path', 'service', 'minor', 'major'];

export function MapLines({ map }: { map: MapData }) {
  const layers = useMemo(() => {
    const roads = Object.fromEntries(
      ROAD_LAYERS.map((cls) => [cls, map.roads.filter((r) => r.cls === cls).map((r) => r.points)]),
    ) as Record<RoadClass, Point[][]>;
    const areaRings = (kind: string) => map.areas.filter((a) => a.kind === kind).flatMap((a) => a.rings);
    return {
      roads,
      landuse: areaRings('landuse'),
      park: areaRings('park'),
      water: areaRings('water'),
      buildings: map.buildings.flatMap((b) => b.rings),
    };
  }, [map]);

  return (
    <group>
      <Layer lines={layers.landuse} closed color={COLORS.landuse} order={1} opacity={0.8} />
      <Layer lines={layers.park} closed color={COLORS.park} order={2} />
      <Layer lines={layers.water} closed color={COLORS.water} order={3} />
      {ROAD_LAYERS.map((cls, i) => (
        <Layer key={cls} lines={layers.roads[cls]} closed={false} color={COLORS[cls]} order={4 + i} />
      ))}
      <Layer lines={layers.buildings} closed color={COLORS.building} order={9} />
    </group>
  );
}
