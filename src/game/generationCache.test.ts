import { describe, expect, it, beforeEach } from 'vitest';
import { clearGenerationCaches } from './generationCache';
import { fieldsAt } from './fields';
import { hydrologyAt } from './hydrology';
import { createWorldConfig } from './world';

describe('shared generation caches', () => {
  beforeEach(() => clearGenerationCaches());

  it('does not expose mutable cached field or hydrology objects', () => {
    const config = createWorldConfig('CACHE-TEST');
    const fields = fieldsAt(config, 12, -9);
    const hydrology = hydrologyAt(config, 12, -9);
    fields.elevation = -1;
    hydrology.waterBody = 'ocean';

    expect(fieldsAt(config, 12, -9).elevation).toBeGreaterThanOrEqual(0);
    expect(hydrologyAt(config, 12, -9).waterBody).not.toBe('ocean');
  });

  it('isolates values by seed and generator version', () => {
    const coordinate = { x: 12, y: -9 };
    const first = fieldsAt(createWorldConfig('CACHE-A'), coordinate.x, coordinate.y);
    const second = fieldsAt(createWorldConfig('CACHE-B'), coordinate.x, coordinate.y);
    const legacy = fieldsAt(createWorldConfig('CACHE-A', 6), coordinate.x, coordinate.y);

    expect(second).not.toEqual(first);
    expect(legacy).not.toEqual(first);
  });

  it('preserves custom field tuning behavior', () => {
    const config = createWorldConfig('CACHE-TUNING');
    const custom = { ...fieldsAt(config, 12, -9), elevation: 0.1 };
    const tuning = { elevation: { scale: 0.02, octaves: 1, lacunarity: 2, persistence: 0.5 }, moisture: { scale: 0.012, octaves: 4, lacunarity: 2, persistence: 0.52 }, temperature: { scale: 0.006, octaves: 3, lacunarity: 2, persistence: 0.5 }, fertility: { scale: 0.02, octaves: 3, lacunarity: 2, persistence: 0.5 }, roughness: { scale: 0.04, octaves: 3, lacunarity: 2, persistence: 0.5 }, latitudeScale: 0.0007, elevationCooling: 0.25 };

    expect(fieldsAt(config, 12, -9, tuning)).not.toEqual(custom);
  });
});
