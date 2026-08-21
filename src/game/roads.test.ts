import { describe, expect, it } from 'vitest';
import { generateRoadNetwork, roadGraphCell } from './roads';
import { regionBounds, type RegionData } from './regions';
import { createWorldConfig } from './world';

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
});
