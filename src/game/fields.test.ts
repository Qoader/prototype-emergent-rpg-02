import { describe, expect, it } from 'vitest';
import { DEFAULT_FIELD_TUNING, fieldAt, fieldsAt, sampleFieldGrid } from './fields';
import { createWorldConfig } from './world';

const config = createWorldConfig('EMBERWILD-01');

describe('continuous geographic fields', () => {
  it('is deterministic and changes with the seed', () => {
    expect(fieldsAt(config, 11, -8)).toEqual(fieldsAt(config, 11, -8));
    expect(fieldsAt(config, 11, -8)).not.toEqual(fieldsAt(createWorldConfig('OTHER'), 11, -8));
  });

  it('keeps fixed field fixtures stable for version 1', () => {
    expect(fieldsAt(config, 11, -8)).toEqual({
      elevation: 0.602754086909083,
      moisture: 0.4596169226865674,
      temperature: 0.5917011916503431,
      fertility: 0.4541453567591604,
      roughness: 0.43163202035934034,
      slope: 0.013073188626502197,
    });
    expect(fieldsAt(config, -241, -385)).toEqual({
      elevation: 0.43562771191304006,
      moisture: 0.5585024937038815,
      temperature: 0.6859793504724008,
      fertility: 0.4366309901467635,
      roughness: 0.4601894980171604,
      slope: 0.00446450081572608,
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
