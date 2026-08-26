import { describe, expect, it } from 'vitest';
import { generateRegion, regionBounds, settlementName } from './regions';
import { WorldProvider } from './WorldProvider';
import { createWorldConfig, REGION_CHUNK_SIZE } from './world';

const config = createWorldConfig('EMBERWILD-01');

describe('region-level feature planning', () => {
  it('generates deterministic region data and bounds', () => {
    const first = generateRegion(config, -1, 2);
    expect(first).toEqual(generateRegion(config, -1, 2));
    expect(first.bounds).toEqual(regionBounds(-1, 2));
    expect(first.bounds.minX).toBe(-REGION_CHUNK_SIZE * 24);
    expect(first.bounds.maxY - first.bounds.minY + 1).toBe(384);
  });

  it('generates valid, uniquely identified feature data', () => {
    const region = generateRegion(config, 0, 0);
    const features = [...region.settlements, ...region.landmarks, ...region.resources, ...region.roadEndpoints];
    expect(new Set(features.map((feature) => feature.id)).size).toBe(features.length);
    for (const settlement of region.settlements) {
      expect(settlement.name).toBe(settlementName(config, settlement.id));
      expect(settlement.name.length).toBeGreaterThan(0);
      expect(settlement.radius).toBeGreaterThan(0);
      expect(settlement.anchors.every((anchor) => anchor.id.startsWith(settlement.id))).toBe(true);
      expect(settlement.accessPoints.every((endpoint) => endpoint.ownerId === settlement.id)).toBe(true);
    }
    for (const endpoint of region.roadEndpoints) expect(features.some((feature) => feature.id === endpoint.ownerId)).toBe(true);
  });

  it('changes region features with the world seed', () => {
    expect(generateRegion(config, 1, -1)).not.toEqual(generateRegion(createWorldConfig('OTHER'), 1, -1));
  });

  it('generates stable settlement names for a seed and settlement id', () => {
    expect(settlementName(config, 'town-id')).toBe(settlementName(config, 'town-id'));
    expect(settlementName(config, 'town-id')).not.toBe(settlementName(createWorldConfig('OTHER'), 'town-id'));
  });

  it('deduplicates concurrent requests and regenerates after eviction', async () => {
    const provider = new WorldProvider(config, { regionCapacity: 1, chunkCapacity: 2 });
    const firstRequest = provider.getRegion(0, 0); const secondRequest = provider.getRegion(0, 0);
    expect(firstRequest).toBe(secondRequest);
    const first = await firstRequest;
    await provider.getRegion(1, 0);
    expect(provider.stats().regions.size).toBe(1);
    expect(await provider.getRegion(0, 0)).toEqual(first);
    expect(provider.stats().regions.misses).toBeGreaterThanOrEqual(3);
  });

  it('returns chunk tiles with neighboring-region feature data', async () => {
    const provider = new WorldProvider(config, { regionCapacity: 16, chunkCapacity: 4 });
    const chunk = await provider.getChunk(0, 0);
    expect(chunk.tiles).toHaveLength(24 * 24);
    const tilesByCoordinate = new Map(chunk.tiles.map((tile) => [`${tile.x},${tile.y}`, tile]));
    for (const road of chunk.roads) for (const point of road.tiles) {
      const tile = tilesByCoordinate.get(`${point.x},${point.y}`);
      if (tile) { expect(tile.road).toBe(true); expect(tile.landmark).not.toBe('tree'); }
    }
    for (const layout of chunk.settlementLayouts) for (const street of layout.streets) for (const point of street.tiles) {
      const tile = tilesByCoordinate.get(`${point.x},${point.y}`);
      if (tile) { expect(tile.road).toBe(true); expect(tile.landmark).not.toBe('tree'); }
    }
    expect(chunk.settlements).toEqual([...chunk.settlements].sort((a, b) => a.id.localeCompare(b.id)));
    expect(chunk.roadEndpoints).toEqual([...chunk.roadEndpoints].sort((a, b) => a.id.localeCompare(b.id)));
    expect(provider.stats().regions.size).toBeLessThanOrEqual(16);
  }, 30000);

  it('hydrates a cached terrain chunk into the deterministic full chunk', async () => {
    const provider = new WorldProvider(config, { regionCapacity: 16, chunkCapacity: 4 });
    const terrain = await provider.getTerrainChunk(0, 0);
    const full = await provider.getChunk(0, 0);

    expect(terrain.detail).toBe('terrain');
    expect(full.detail).toBe('full');
    expect(full.tiles.map((tile) => ({ x: tile.x, y: tile.y, terrain: tile.terrain, biome: tile.biome }))).toEqual(
      terrain.tiles.map((tile) => ({ x: tile.x, y: tile.y, terrain: tile.terrain, biome: tile.biome })),
    );
    expect(provider.stats().terrainChunks.hits).toBeGreaterThan(0);
  }, 30000);

  it('clearing caches does not change deterministic content', async () => {
    const provider = new WorldProvider(config, { regionCapacity: 2, chunkCapacity: 2 });
    const before = await provider.getChunk(-2, -2);
    provider.clear();
    expect(await provider.getChunk(-2, -2)).toEqual(before);
  }, 30000);

  it('keeps isolated v11 cold chunk generation within the one-second p95 budget', async () => {
    const samples: number[] = [];
    const coordinates = [[0, 0], [1, 0], [-1, 1], [2, -2], [-2, -2], [3, 1], [0, 3], [-3, 0], [4, -1], [-1, 4], [2, 2], [-4, -3]] as const;
    for (const [cx, cy] of coordinates) {
      const provider = new WorldProvider(createWorldConfig(`COLD-${cx},${cy}`), { regionCapacity: 16, chunkCapacity: 4 });
      const started = performance.now(); const chunk = await provider.getChunk(cx, cy); samples.push(performance.now() - started);
      expect(chunk.detail).toBe('full'); provider.clear();
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length * .95)]).toBeLessThan(1000);
  }, 30000);
});
