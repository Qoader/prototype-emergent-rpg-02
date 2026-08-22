import { describe, expect, it } from 'vitest';
import { generateRoadNetwork, generateStarterRoad, roadGraphCell } from './roads';
import { generateRegion, regionBounds, type RegionData } from './regions';
import { createWorldConfig, findStartingPosition, worldToRegion } from './world';

function fixture(rx: number, ry: number): RegionData {
  const endpoints = [
    { id: `anchor:${rx},${ry}:a`, ownerId: `owner:${rx},${ry}:a`, x: rx * 384 + 80, y: ry * 384 + 80, kind: 'landmark' as const, importance: 0.8, preferredDirections: [] },
    { id: `anchor:${rx},${ry}:b`, ownerId: `owner:${rx},${ry}:b`, x: rx * 384 + 180, y: ry * 384 + 180, kind: 'resource' as const, importance: 0.5, preferredDirections: [] },
  ];
  return { key: { rx, ry }, bounds: regionBounds(rx, ry), settlements: [], settlementLayouts: [], landmarks: [], resources: [], roadEndpoints: endpoints };
}

describe('organic road planning', () => {
  it('uses a stable graph cell and deterministic segment IDs', () => {
    const config = createWorldConfig('ROAD-TEST'); const regions = [fixture(0, 0)];
    const first = generateRoadNetwork(config, 0, 0, regions); const second = generateRoadNetwork(config, 0, 0, regions);
    expect(roadGraphCell(0, 0)).toEqual(roadGraphCell(0, 0)); expect(first).toEqual(second); expect(new Set(first.segments.map((segment) => segment.id)).size).toBe(first.segments.length); expect(first.segments.every((segment) => segment.ownerRegion.rx === 0 && segment.ownerRegion.ry === 0)).toBe(true);
  }, 30000);

  it('connects the deterministic spawn to a reachable settlement gate', () => {
    const config = createWorldConfig('EMBERWILD-01'); const start = findStartingPosition(config); const origin = worldToRegion(start.x, start.y); const regions: RegionData[] = [];
    for (let ry = origin.ry - 2; ry <= origin.ry + 2; ry++) for (let rx = origin.rx - 2; rx <= origin.rx + 2; rx++) regions.push(generateRegion(config, rx, ry));
    const segments = generateStarterRoad(config, start, regions);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0].from.kind).toBe('player-start');
    expect(segments.some((segment) => segment.to.kind === 'settlement-gate')).toBe(true);
    expect(segments.flatMap((segment) => segment.tiles)).toContainEqual(start);
  }, 30000);
});
