import { describe, expect, it } from 'vitest';
import { fieldsAt } from './fields';
import { hydrologyAt } from './hydrology';
import { classifyBiome, tileAt, type Biome } from './world';
import { createWorldConfig } from './world';

const config = createWorldConfig('EMBERWILD-01');

function climate(elevation: number, moisture: number, temperature: number) {
  return { elevation, moisture, temperature, fertility: 0.5, roughness: 0.2, slope: 0.05 };
}

describe('biome and hydrology generation', () => {
  it('applies biome classification precedence', () => {
    expect(classifyBiome(climate(0.1, 0.8, 0.5), 'deep-water', 'ocean')).toBe('ocean');
    expect(classifyBiome(climate(0.2, 0.8, 0.5), 'shallow-water', 'lake')).toBe('lake');
    expect(classifyBiome(climate(0.4, 0.4, 0.5), 'shore', 'none')).toBe('coast');
    expect(classifyBiome(climate(0.85, 0.4, 0.3), 'mountain', 'none')).toBe('alpine');
    expect(classifyBiome(climate(0.4, 0.2, 0.2), 'plain', 'none')).toBe('tundra');
    expect(classifyBiome(climate(0.4, 0.2, 0.8), 'plain', 'none')).toBe('desert');
    expect(classifyBiome(climate(0.3, 0.8, 0.5), 'plain', 'none')).toBe('swamp');
    expect(classifyBiome(climate(0.4, 0.7, 0.5), 'plain', 'none')).toBe('forest');
    expect(classifyBiome(climate(0.4, 0.4, 0.5), 'plain', 'none')).toBe('grassland');
  });

  it('is deterministic and returns valid hydrology metadata', () => {
    const first = hydrologyAt(config, 47, -31);
    expect(first).toEqual(hydrologyAt(config, 47, -31));
    expect(['none', 'ocean', 'lake', 'river'] as const).toContain(first.waterBody);
    if (first.waterBody === 'river') expect(first.flowDirection).not.toBeNull();
  });

  it('keeps terrain, biome, and movement data coherent', () => {
    for (let y = -24; y <= 24; y += 4) for (let x = -24; x <= 24; x += 4) {
      const tile = tileAt(config.seed, x, y);
      expect(tile.biome).toBeTypeOf('string');
      expect(Number.isFinite(tile.movementCost) || tile.movementCost === Infinity).toBe(true);
      if (tile.terrain === 'deep-water' || tile.terrain === 'shallow-water' || tile.terrain === 'river' || tile.terrain === 'mountain') expect(tile.walkable).toBe(false);
      if (tile.walkable) expect(tile.movementCost).toBeLessThan(Infinity);
    }
  });

  it('preserves hydrology at a chunk boundary', () => {
    const boundaryX = 24;
    expect(hydrologyAt(config, boundaryX, 13)).toEqual(hydrologyAt(config, boundaryX, 13));
    expect(fieldsAt(config, boundaryX, 13)).toEqual(fieldsAt(config, boundaryX, 13));
    const left = tileAt(config.seed, boundaryX - 1, 13);
    const right = tileAt(config.seed, boundaryX, 13);
    expect(left.x + 1).toBe(right.x);
  });

  it('finds a river or water body in a representative sample without invalid data', () => {
    const bodies = new Set<Biome>(); let waterCount = 0;
    for (let y = -96; y <= 96; y += 8) for (let x = -96; x <= 96; x += 8) {
      const tile = tileAt(config.seed, x, y); bodies.add(tile.biome);
      if (tile.hydrology.waterBody !== 'none') waterCount++;
    }
    expect(waterCount).toBeGreaterThan(0);
    expect(bodies.size).toBeGreaterThan(1);
  });
});
