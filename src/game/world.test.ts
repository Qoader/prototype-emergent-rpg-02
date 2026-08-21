import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, GENERATOR_VERSION, REGION_CHUNK_SIZE, chunkAt, chunkKey, createWorldConfig, featureId, findPath, random, regionKey, tileAt, tileAtConfig, worldToChunk, worldToRegion } from './world';
describe('procedural Emberwild', () => {
  it('is deterministic', () => expect(tileAt('EMBERWILD-01', 11, -8)).toEqual(tileAt('EMBERWILD-01', 11, -8)));
  it('changes with the seed', () => expect(tileAt('EMBERWILD-01', 11, -8)).not.toEqual(tileAt('OTHER', 11, -8)));
  it('preserves the default tile generator through the config API', () => {
    expect(tileAtConfig(createWorldConfig('EMBERWILD-01'), 11, -8)).toEqual(tileAt('EMBERWILD-01', 11, -8));
  });
  it('provides deterministic namespaced random access', () => {
    const config = createWorldConfig('EMBERWILD-01');
    expect(random(config, 'settlement', 12, -4)).toBe(0.679822172736749);
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
    expect(chunkKey({ ...config, cx: 2, cy: -3 })).toBe('EMBERWILD-01:v3:chunk:2,-3');
    expect(regionKey({ ...config, rx: -2, ry: 3 })).toBe('EMBERWILD-01:v3:region:-2,3');
    expect(featureId(config, 'settlement', 12, -4)).toBe('EMBERWILD-01:v3:settlement:12,-4');
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
  it('finds a walkable route', () => { const path = findPath('EMBERWILD-01', tileAt('EMBERWILD-01', 0, 0), tileAt('EMBERWILD-01', 8, 8)); expect(path.at(-1)?.x).toBe(8); expect(path.at(-1)?.y).toBe(8); });
  it('rejects blocked destinations', () => { const blocked = { ...tileAt('EMBERWILD-01', 0, 0), walkable: false }; expect(findPath('EMBERWILD-01', tileAt('EMBERWILD-01', 1, 1), blocked)).toEqual([]); });

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
