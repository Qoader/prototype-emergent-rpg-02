import { describe, expect, it } from 'vitest';
import { DEFAULT_FIELD_TUNING, fieldAt, fieldsAt, sampleFieldGrid } from './fields';
import { sampleValueNoise } from './noise';
import { createWorldConfig } from './world';

const config = createWorldConfig('EMBERWILD-01');

describe('continuous geographic fields', () => {
  it('is deterministic and changes with the seed', () => {
    expect(fieldsAt(config, 11, -8)).toEqual(fieldsAt(config, 11, -8));
    expect(fieldsAt(config, 11, -8)).not.toEqual(fieldsAt(createWorldConfig('OTHER'), 11, -8));
  });

  it('keeps fixed field fixtures stable for version 6', () => {
    expect(fieldsAt(config, 11, -8)).toEqual({
      elevation: 0.3032295496772489,
      moisture: 0.5611984180736423,
      temperature: 0.7873357549871968,
      fertility: 0.6389234715161743,
      roughness: 0.27864467769437323,
      slope: 0.015441446147261506,
    });
    expect(fieldsAt(config, -241, -385)).toEqual({
      elevation: 0.3670456761345615,
      moisture: 0.3283408332198059,
      temperature: 0.6782952763553383,
      fertility: 0.5971017988316079,
      roughness: 0.7110149039293275,
      slope: 0.0007668037729866017,
    });
  });

  it('returns normalized finite fields', () => {
    for (const sample of sampleFieldGrid(config, -12, -12, 25, 25).map((entry) => entry.fields)) {
      for (const value of Object.values(sample)) expect(value).toBeGreaterThanOrEqual(0);
      for (const value of Object.values(sample)) expect(value).toBeLessThanOrEqual(1);
      for (const value of Object.values(sample)) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('changes smoothly across adjacent coordinates', () => {
    const left = fieldsAt(config, 100, 200);
    const right = fieldsAt(config, 101, 200);
    expect(Math.abs(left.elevation - right.elevation)).toBeLessThan(0.1);
    expect(Math.abs(left.moisture - right.moisture)).toBeLessThan(0.1);
    expect(Math.abs(left.temperature - right.temperature)).toBeLessThan(0.1);
  });

  it('keeps elevation variation directionally balanced', () => {
    let horizontal = 0; let vertical = 0;
    for (let y = -128; y < 128; y++) for (let x = -128; x < 128; x++) {
      const current = sampleValueNoise(config, 'field:elevation', x, y, DEFAULT_FIELD_TUNING.elevation);
      horizontal += Math.abs(current - sampleValueNoise(config, 'field:elevation', x + 1, y, DEFAULT_FIELD_TUNING.elevation));
      vertical += Math.abs(current - sampleValueNoise(config, 'field:elevation', x, y + 1, DEFAULT_FIELD_TUNING.elevation));
    }
    const ratio = Math.max(horizontal, vertical) / Math.min(horizontal, vertical);
    expect(ratio).toBeLessThan(1.15);
  });

  it('keeps fields independent when unrelated tuning changes', () => {
    const tuning = structuredClone(DEFAULT_FIELD_TUNING);
    tuning.moisture.scale = 0.2;
    tuning.roughness.scale = 0.2;
    const baseline = fieldsAt(config, 42, -17);
    const changed = fieldsAt(config, 42, -17, tuning);
    expect(changed.elevation).toBe(baseline.elevation);
    expect(changed.temperature).toBe(baseline.temperature);
    expect(changed.moisture).not.toBe(baseline.moisture);
    expect(changed.roughness).not.toBe(baseline.roughness);
  });

  it('supports negative coordinates and field selection', () => {
    const fields = fieldsAt(config, -241, -385);
    expect(fieldAt(config, 'elevation', -241, -385)).toBe(fields.elevation);
    expect(fieldAt(config, 'slope', -241, -385)).toBe(fields.slope);
  });

  it('samples a serializable field grid with the requested shape', () => {
    const samples = sampleFieldGrid(config, -4, -3, 3, 2, 2);
    expect(samples).toHaveLength(6);
    expect(samples[0]).toEqual({ x: -4, y: -3, fields: fieldsAt(config, -4, -3) });
    expect(samples.at(-1)?.x).toBe(0);
    expect(samples.at(-1)?.y).toBe(-1);
  });

  it('rejects invalid field coordinates and grid arguments', () => {
    expect(() => fieldsAt(config, 1.5, 2)).toThrow('x must be an integer');
    expect(() => sampleFieldGrid(config, 0, 0, 0, 1)).toThrow('width must be a positive integer');
    expect(() => sampleFieldGrid(config, 0, 0, 1, 1, 0)).toThrow('step must be a positive integer');
  });
});
