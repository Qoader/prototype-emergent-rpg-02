import { describe, expect, it } from 'vitest';
import { generateRegion } from './regions';
import { generateSettlementLayout, type Building, type SettlementLayout } from './settlements';
import { hydrologyAt } from './hydrology';
import { createWorldConfig } from './world';

const config = createWorldConfig('EMBERWILD-01');

function sampleLayout() {
  const region = generateRegion(config, 0, 0); if (!region.settlements.length) throw new Error('Expected a representative settlement shell');
  return generateSettlementLayout(config, region.settlements[0]);
}

function cityLayout() {
  for (let ry = -2; ry <= 2; ry++) for (let rx = -2; rx <= 2; rx++) {
    const shell = generateRegion(config, rx, ry).settlements.find((settlement) => settlement.type === 'city');
    if (shell) return generateSettlementLayout(config, shell);
  }
  throw new Error('Expected a representative city shell');
}

function layoutForType(type: 'hamlet' | 'village' | 'town') {
  for (let ry = -12; ry <= 12; ry++) for (let rx = -12; rx <= 12; rx++) {
    const shell = generateRegion(config, rx, ry).settlements.find((settlement) => settlement.type === type);
    if (shell) return generateSettlementLayout(config, shell);
  }
  if (type === 'hamlet') return generateSettlementLayout(config, { id: 'test:hamlet', name: 'Test Hamlet', x: 93, y: 228, type, radius: 14, populationClass: 0, footprint: { width: 1, height: 1, rotation: 0 }, anchors: [], accessPoints: [] });
  throw new Error(`Expected a representative ${type} shell`);
}

function overlaps(a: Building, b: Building) { return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + 1 && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + 1; }

describe('organic settlement layouts', () => {
  it('gives every settlement a correctly sized central plaza', () => {
    const expected = { hamlet: [1, 'dirt'], village: [9, 'dirt'], town: [9, 'stone'] } as const;
    for (const type of ['hamlet', 'village', 'town'] as const) {
      const layout = layoutForType(type); const plaza = layout.plazas.find((item) => item.kind === 'central')!;
      expect(plaza.tiles).toHaveLength(expected[type][0]); expect(plaza.surface).toBe(expected[type][1]);
    }
    const city = cityLayout(); const central = city.plazas.find((item) => item.kind === 'central')!;
    expect(central.tiles).toHaveLength(25); expect(central.surface).toBe('stone');
  }, 30000);

  it('is deterministic and has stable sorted collections', () => {
    const first = sampleLayout(); const second = sampleLayout();
    expect(first).toEqual(second);
    expect(first.streets).toEqual([...first.streets].sort((a, b) => a.id.localeCompare(b.id)));
    expect(first.buildings).toEqual([...first.buildings].sort((a, b) => a.id.localeCompare(b.id)));
  }, 15000);

  it('generates connected street paths and branches', () => {
    const layout = sampleLayout();
    expect(layout.streets.length).toBeGreaterThan(0);
    for (const street of layout.streets) {
      expect(street.tiles.length).toBeGreaterThan(1);
      expect(street.tiles.every((tile) => hydrologyAt(config, tile.x, tile.y).waterBody === 'none')).toBe(true);
      for (let index = 1; index < street.tiles.length; index++) expect(Math.abs(street.tiles[index].x - street.tiles[index - 1].x) + Math.abs(street.tiles[index].y - street.tiles[index - 1].y)).toBe(1);
      expect(street.points.length).toBeGreaterThan(1);
    }
  }, 15000);

  it('creates non-overlapping buildings assigned to valid districts', () => {
    const layout = sampleLayout(); const districtIds = new Set(layout.districts.map((district) => district.id));
    expect(layout.buildings.length).toBeGreaterThan(0);
    for (let index = 0; index < layout.buildings.length; index++) {
      const building = layout.buildings[index]; expect(districtIds.has(building.districtId)).toBe(true); expect(building.width).toBe(1); expect(building.height).toBe(1); expect(building.rotation).toBe(0);
      for (let otherIndex = index + 1; otherIndex < layout.buildings.length; otherIndex++) expect(overlaps(building, layout.buildings[otherIndex])).toBe(false);
    }
  }, 15000);

  it('keeps edge features deterministic and bounded by the layout fringe', () => {
    const layout: SettlementLayout = sampleLayout();
    for (const edge of layout.edgeFeatures) {
      expect(edge.width).toBeGreaterThan(0); expect(edge.height).toBeGreaterThan(0);
      expect(edge.x).toBeGreaterThanOrEqual(layout.bounds.minX - 16); expect(edge.x).toBeLessThanOrEqual(layout.bounds.maxX + 16);
      expect(edge.y).toBeGreaterThanOrEqual(layout.bounds.minY - 16); expect(edge.y).toBeLessThanOrEqual(layout.bounds.maxY + 16);
    }
  }, 15000);

  it('packs eligible intramural city tiles with houses, roads, or plazas', () => {
    const layout = cityLayout(); const fortification = layout.fortification!; const roadTiles = new Set(layout.streets.flatMap((street) => street.tiles.map((tile) => `${tile.x},${tile.y}`))); const plazaTiles = new Set(layout.plazas.flatMap((square) => square.tiles.map((tile) => `${tile.x},${tile.y}`))); const buildingTiles = new Set(layout.buildings.map((building) => `${building.x},${building.y}`));
    expect(layout.plazas.filter((plaza) => plaza.kind === 'peripheral')).toHaveLength(6);
    expect(layout.plazas.find((plaza) => plaza.kind === 'central')?.tiles).toHaveLength(25);
    expect(layout.streets.filter((street) => street.id.includes(':fan:')).length).toBeGreaterThanOrEqual(5);
    expect(layout.buildings.length).toBeGreaterThan(fortification.intramuralTiles.length * 0.15);
    expect(buildingTiles.size).toBe(layout.buildings.length);
    for (const tileKey of plazaTiles) expect(buildingTiles.has(tileKey)).toBe(false);
    for (const building of layout.buildings.filter((building) => building.type === 'house')) expect(roadTiles.has(`${building.x},${building.y}`)).toBe(false);
  }, 30000);
});
