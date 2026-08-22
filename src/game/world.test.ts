import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, GENERATOR_VERSION, REGION_CHUNK_SIZE, STARTER_RADIUS, chunkAt, chunkKey, createWorldConfig, featureId, findPath, findStartingPosition, random, regionKey, tileAt, tileAtConfig, worldToChunk, worldToRegion } from './world';
describe('procedural Emberwild', () => {
  it('selects a deterministic land starting zone', () => {
    for (const seed of ['EMBERWILD-01', 'OTHER', 'PHASE7']) {
      const config = createWorldConfig(seed); const first = findStartingPosition(config); const second = findStartingPosition(config);
      expect(second).toEqual(first);
      for (let y = -STARTER_RADIUS; y <= STARTER_RADIUS; y++) for (let x = -STARTER_RADIUS; x <= STARTER_RADIUS; x++) {
        if (Math.hypot(x, y) > STARTER_RADIUS) continue;
        const tile = tileAt(seed, first.x + x, first.y + y);
        expect(tile.hydrology.waterBody).toBe('none'); expect(tile.walkable).toBe(true); expect(tile.terrain).toBe('starter-ground');
      }
    }
  });
  it('is deterministic', () => expect(tileAt('EMBERWILD-01', 11, -8)).toEqual(tileAt('EMBERWILD-01', 11, -8)));
  it('changes with the seed', () => expect(tileAt('EMBERWILD-01', 11, -8)).not.toEqual(tileAt('OTHER', 11, -8)));
  it('does not place trees on coastal tiles', () => {
    const coastal = [];
    for (let y = -96; y <= 96; y += 8) for (let x = -96; x <= 96; x += 8) {
      const tile = tileAt('EMBERWILD-01', x, y);
      if (tile.terrain === 'shore' || tile.biome === 'coast' || tile.hydrology.shoreline) coastal.push(tile);
    }
    expect(coastal.length).toBeGreaterThan(0);
    expect(coastal.every((tile) => tile.landmark !== 'tree')).toBe(true);
  }, 15000);
  it('preserves the default tile generator through the config API', () => {
    expect(tileAtConfig(createWorldConfig('EMBERWILD-01'), 11, -8)).toEqual(tileAt('EMBERWILD-01', 11, -8));
  });
  it('provides deterministic namespaced random access', () => {
    const config = createWorldConfig('EMBERWILD-01');
    expect(random(config, 'settlement', 12, -4)).toBe(0.5358250746503472);
    expect(random(config, 'settlement', 12, -4)).toBe(random(config, 'settlement', 12, -4));
    expect(random(config, 'settlement', 12, -4)).not.toBe(random(config, 'road', 12, -4));
    expect(random(config, 'settlement', 12, -4)).not.toBe(random(createWorldConfig('OTHER'), 'settlement', 12, -4));
  });
  it('changes namespaced random values when the generator version changes', () => {
    expect(random(createWorldConfig('EMBERWILD-01', 1), 'field', 12, -4)).not.toBe(random(createWorldConfig('EMBERWILD-01', 2), 'field', 12, -4));
  });
  it('maps negative world coordinates using floor division', () => {
    expect(worldToChunk(-1, -CHUNK_SIZE)).toEqual({ cx: -1, cy: -1 });
    expect(worldToChunk(-CHUNK_SIZE - 1, -1)).toEqual({ cx: -2, cy: -1 });
    expect(worldToRegion(-1, -REGION_CHUNK_SIZE * CHUNK_SIZE)).toEqual({ rx: -1, ry: -1 });
  });
  it('creates versioned stable chunk, region, and feature identities', () => {
    const config = createWorldConfig('EMBERWILD-01');
    expect(chunkKey({ ...config, cx: 2, cy: -3 })).toBe('EMBERWILD-01:v6:chunk:2,-3');
    expect(regionKey({ ...config, rx: -2, ry: 3 })).toBe('EMBERWILD-01:v6:region:-2,3');
    expect(featureId(config, 'settlement', 12, -4)).toBe('EMBERWILD-01:v6:settlement:12,-4');
  });
  it('regenerates identical chunk data regardless of request order', () => {
    const config = createWorldConfig('EMBERWILD-01');
    const direct = chunkAt(config, 2, -3);
    chunkAt(config, 1, -3);
    chunkAt(config, 3, -3);
    expect(chunkAt(config, 2, -3)).toEqual(direct);
  });
  it('rejects unsupported tile generator versions explicitly', () => {
    expect(() => tileAtConfig(createWorldConfig('EMBERWILD-01', GENERATOR_VERSION + 1), 0, 0)).toThrow('Unsupported world generator version');
  });
  it('finds the geometric diagonal route', () => {
    const start = findStartingPosition(createWorldConfig('EMBERWILD-01')); const path = findPath('EMBERWILD-01', tileAt('EMBERWILD-01', start.x, start.y), tileAt('EMBERWILD-01', start.x + 3, start.y + 3));
    expect(path.length).toBeGreaterThan(0);
    expect(path.every((tile, index) => { const previous = index === 0 ? start : path[index - 1]; return Math.abs(tile.x - previous.x) <= 1 && Math.abs(tile.y - previous.y) <= 1; })).toBe(true);
  });
  it('keeps paths inside the current and neighboring chunks', () => {
    const start = findStartingPosition(createWorldConfig('EMBERWILD-01')); const path = findPath('EMBERWILD-01', tileAt('EMBERWILD-01', start.x, start.y), tileAt('EMBERWILD-01', 100, 100));
    expect(path.length).toBeGreaterThan(0);
    expect(path.every((tile) => tile.x >= -CHUNK_SIZE && tile.x < CHUNK_SIZE * 2 && tile.y >= -CHUNK_SIZE && tile.y < CHUNK_SIZE * 2)).toBe(true);
  });
  it('stops at the closest reachable tile when the destination is blocked', () => {
    const start = findStartingPosition(createWorldConfig('EMBERWILD-01')); const blocked = { ...tileAt('EMBERWILD-01', start.x, start.y), walkable: false };
    const path = findPath('EMBERWILD-01', tileAt('EMBERWILD-01', start.x + 1, start.y + 1), blocked);
    expect(path.length).toBeGreaterThan(0);
    expect(path.at(-1)).not.toMatchObject(start);
  });

  it('keeps random-access variation directionally balanced', () => {
    const spatialConfig = createWorldConfig('SPATIAL-TEST');
    let horizontal = 0; let vertical = 0;
    for (let y = -32; y < 32; y++) for (let x = -32; x < 32; x++) {
      const current = random(spatialConfig, 'spatial-balance', x, y);
      horizontal += Math.abs(current - random(spatialConfig, 'spatial-balance', x + 1, y));
      vertical += Math.abs(current - random(spatialConfig, 'spatial-balance', x, y + 1));
    }
    const ratio = Math.max(horizontal, vertical) / Math.min(horizontal, vertical);
    expect(ratio).toBeLessThan(1.15);
  });
});
