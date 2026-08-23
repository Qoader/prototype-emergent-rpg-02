import { describe, expect, it } from 'vitest';
import { generateRoadCell, generateRoadNetwork, generateStarterRoad, roadGraphCell } from './roads';
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
  it('always plans all four border portals for an empty cell', () => {
    const config = createWorldConfig('PORTAL-TEST');
    const generated = generateRoadCell(config, [fixture(0, 0)], 0, 0);
    expect(generated.nodes.filter((node) => node.kind === 'region-border')).toHaveLength(4);
    expect(new Set(generated.nodes.filter((node) => node.kind === 'region-border').map((node) => node.id)).size).toBe(4);
  }, 30000);

  it('uses a stable graph cell and deterministic segment IDs', () => {
    const config = createWorldConfig('ROAD-TEST'); const regions = [fixture(0, 0)];
    const first = generateRoadNetwork(config, 0, 0, regions); const second = generateRoadNetwork(config, 0, 0, regions);
    expect(roadGraphCell(0, 0)).toEqual(roadGraphCell(0, 0)); expect(first).toEqual(second); expect(new Set(first.segments.map((segment) => segment.id)).size).toBe(first.segments.length); expect(first.segments.every((segment) => segment.ownerRegion.rx === 0 && segment.ownerRegion.ry === 0)).toBe(true);
  }, 30000);

  it('keeps the planning-cell graph acyclic and avoids same-settlement links', () => {
    const config = createWorldConfig('ROAD-TOPOLOGY-TEST');
    const settlementId = 'settlement:test';
    const settlement = {
      id: settlementId,
      name: 'Teststead',
      x: 120,
      y: 120,
      type: 'town' as const,
      radius: 32,
      populationClass: 60,
      footprint: { width: 64, height: 64, rotation: 0 },
      anchors: [],
      accessPoints: [
        { id: `${settlementId}:gate:north`, ownerId: settlementId, x: 120, y: 88, kind: 'settlement-gate' as const, importance: 0.6, preferredDirections: ['north' as const] },
        { id: `${settlementId}:gate:south`, ownerId: settlementId, x: 120, y: 152, kind: 'settlement-gate' as const, importance: 0.6, preferredDirections: ['south' as const] },
      ],
    };
    const region: RegionData = { ...fixture(0, 0), settlements: [settlement] };
    const generated = generateRoadCell(config, [region], 0, 0);
    const parents = new Map<string, { from: string; to: string; fromOwner: string; toOwner: string }>();
    for (const segment of generated.segments) parents.set(segment.parentId, { from: segment.from.id, to: segment.to.id, fromOwner: segment.from.ownerId, toOwner: segment.to.ownerId });
    const parentOf = new Map(generated.nodes.map((node) => [node.id, node.id]));
    const find = (id: string): string => { const root = parentOf.get(id) ?? id; if (root === id) return id; const resolved = find(root); parentOf.set(id, resolved); return resolved; };
    for (const edge of parents.values()) {
      expect(edge.fromOwner).not.toBe(edge.toOwner);
      expect(find(edge.from)).not.toBe(find(edge.to));
      parentOf.set(find(edge.from), find(edge.to));
    }
    const destinations = new Map<string, Set<string>>();
    for (const edge of parents.values()) for (const [owner, destination] of [[edge.fromOwner, edge.toOwner], [edge.toOwner, edge.fromOwner]]) {
      if (owner !== settlementId) continue;
      const values = destinations.get(owner) ?? new Set<string>(); values.add(destination); destinations.set(owner, values);
    }
    expect(destinations.get(settlementId)?.size).toBeGreaterThanOrEqual(2);
    expect(parents.size).toBe(generated.nodes.length - 1);
  }, 30000);

  it('gives every settlement two distinct destinations in a multi-settlement cell', () => {
    const config = createWorldConfig('ROAD-DEGREE-TEST');
    const makeSettlement = (id: string, x: number, y: number) => ({
      id, name: id, x, y, type: 'village' as const, radius: 23, populationClass: 50, footprint: { width: 46, height: 46, rotation: 0 }, anchors: [],
      accessPoints: [
        { id: `${id}:north`, ownerId: id, x, y: y - 23, kind: 'settlement-gate' as const, importance: 0.5, preferredDirections: ['north' as const] },
      ],
    });
    const settlements = [makeSettlement('settlement:a', 96, 96), makeSettlement('settlement:b', 224, 128), makeSettlement('settlement:c', 144, 256)];
    const generated = generateRoadCell(config, [{ ...fixture(0, 0), settlements }], 0, 0);
    const parents = new Map<string, { fromOwner: string; toOwner: string }>();
    for (const segment of generated.segments) parents.set(segment.parentId, { fromOwner: segment.from.ownerId, toOwner: segment.to.ownerId });
    for (const settlement of settlements) {
      const destinations = new Set<string>();
      for (const edge of parents.values()) {
        if (edge.fromOwner === settlement.id) destinations.add(edge.toOwner);
        if (edge.toOwner === settlement.id) destinations.add(edge.fromOwner);
      }
      expect(destinations.size).toBeGreaterThanOrEqual(2);
    }
    expect(parents.size).toBe(generated.nodes.length - 1);
  }, 30000);

  it('connects the deterministic spawn to a reachable settlement gate', () => {
    const config = createWorldConfig('EMBERWILD-01'); const start = findStartingPosition(config); const origin = worldToRegion(start.x, start.y); const regions: RegionData[] = [];
    for (let ry = origin.ry - 2; ry <= origin.ry + 2; ry++) for (let rx = origin.rx - 2; rx <= origin.rx + 2; rx++) regions.push(generateRegion(config, rx, ry));
    const segments = generateStarterRoad(config, start, regions);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0].from.kind).toBe('player-start');
    expect(segments.filter((segment) => segment.from.kind === 'player-start').length).toBeGreaterThanOrEqual(2);
    expect(new Set(segments.filter((segment) => segment.from.kind === 'player-start').map((segment) => segment.to.ownerId)).size).toBeGreaterThanOrEqual(2);
    expect(segments.some((segment) => segment.to.kind === 'settlement-gate')).toBe(true);
    expect(segments.flatMap((segment) => segment.tiles)).toContainEqual(start);
  }, 30000);
});
