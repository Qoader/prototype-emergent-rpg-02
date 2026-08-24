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

function overlaps(a: Building, b: Building) { return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + 1 && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + 1; }

describe('organic settlement layouts', () => {
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
});
