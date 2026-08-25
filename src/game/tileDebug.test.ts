import { describe, expect, it } from 'vitest';
import { tileAt } from './world';
import { tileDebugInfo } from './tileDebug';

describe('tile debug info', () => {
  it('reports terrain and an empty contents state for a plain tile', () => {
    const tile = { ...tileAt('DEBUG', 0, 0), landmark: null };
    expect(tileDebugInfo(tile).contents).toEqual([]);
    expect(tileDebugInfo(tile)).toMatchObject({ x: 0, y: 0, terrain: 'starter-ground', walkable: true });
  });

  it('reports exact generated and streamed features without duplicates', () => {
    const tile = { ...tileAt('DEBUG', 1, 1), landmark: 'shrine' as const };
    const chunk = {
      cx: 0, cy: 0, tiles: [],
      settlements: [{ id: 'town', name: 'Ashford', x: 1, y: 1, type: 'town' as const, radius: 2, populationClass: 1, footprint: { width: 4, height: 4, rotation: 0 }, anchors: [{ id: 'market', type: 'market' as const, x: 1, y: 1 }], accessPoints: [] }],
      settlementLayouts: [{ settlementId: 'town', bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 }, streets: [], buildings: [{ id: 'building', type: 'market' as const, districtId: 'district', x: 1, y: 1, width: 2, height: 2, rotation: 0, roadId: null, courtyard: false }], districts: [], edgeFeatures: [], plazas: [] }],
      landmarks: [{ id: 'landmark', type: 'shrine' as const, x: 1, y: 1, importance: 1 }],
      resources: [{ id: 'resource', type: 'ore' as const, x: 1, y: 1, importance: 1 }],
      roadEndpoints: [], roads: [{ id: 'road', parentId: 'road', ownerRegion: { rx: 0, ry: 0 }, from: { id: 'a', ownerId: 'a', x: 1, y: 1, kind: 'resource' as const, importance: 1 }, to: { id: 'b', ownerId: 'b', x: 2, y: 2, kind: 'resource' as const, importance: 1 }, importance: 'road' as const, width: 1, tiles: [{ x: 1, y: 1 }], points: [], bridges: [], waterRoutes: [], ports: [] }],
    };
    expect(tileDebugInfo(tile, chunk).contents).toEqual(['Market', 'Market anchor', 'Ore resource', 'Road', 'Shrine', 'Town center']);
    expect(tileDebugInfo(tile, chunk).settlement).toEqual({ id: 'town', name: 'Ashford', type: 'town' });
  });
});
