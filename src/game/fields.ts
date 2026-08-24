import { sampleValueNoise, type NoiseSettings } from './noise';
import { getCachedFields, setCachedFields } from './generationCache';
import type { WorldConfig } from './world';

export interface FieldTuning {
  elevation: NoiseSettings;
  moisture: NoiseSettings;
  temperature: NoiseSettings;
  fertility: NoiseSettings;
  roughness: NoiseSettings;
  latitudeScale: number;
  elevationCooling: number;
}

export const DEFAULT_FIELD_TUNING: FieldTuning = {
  elevation: { scale: 0.008, octaves: 5, lacunarity: 2, persistence: 0.5 },
  moisture: { scale: 0.012, octaves: 4, lacunarity: 2, persistence: 0.52 },
  temperature: { scale: 0.006, octaves: 3, lacunarity: 2, persistence: 0.5 },
  fertility: { scale: 0.02, octaves: 3, lacunarity: 2, persistence: 0.5 },
  roughness: { scale: 0.04, octaves: 3, lacunarity: 2, persistence: 0.5 },
  latitudeScale: 0.0007,
  elevationCooling: 0.25,
};

export interface GeographicFields {
  elevation: number;
  moisture: number;
  temperature: number;
  fertility: number;
  roughness: number;
  slope: number;
}

export interface FieldSample {
  x: number;
  y: number;
  fields: GeographicFields;
}

export type FieldName = keyof GeographicFields;

function assertCoordinate(value: number, label: string) {
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`);
}

function clamp(value: number) { return Math.max(0, Math.min(1, value)); }

function elevationAt(config: WorldConfig, x: number, y: number, tuning: FieldTuning) {
  return sampleValueNoise(config, 'field:elevation', x, y, tuning.elevation);
}

export function fieldsAt(config: WorldConfig, x: number, y: number, tuning = DEFAULT_FIELD_TUNING): GeographicFields {
  assertCoordinate(x, 'x'); assertCoordinate(y, 'y');
  const cacheable = tuning === DEFAULT_FIELD_TUNING;
  if (cacheable) {
    const cached = getCachedFields(config, x, y);
    if (cached) return { ...cached };
  }
  const elevation = elevationAt(config, x, y, tuning);
  const moisture = sampleValueNoise(config, 'field:moisture', x, y, tuning.moisture);
  const temperatureNoise = sampleValueNoise(config, 'field:temperature', x, y, tuning.temperature);
  const latitude = (Math.cos(y * tuning.latitudeScale) + 1) / 2;
  const temperature = clamp(temperatureNoise * 0.45 + latitude * 0.55 - elevation * tuning.elevationCooling);
  const fertilityNoise = sampleValueNoise(config, 'field:fertility', x, y, tuning.fertility);
  const moderateElevation = 1 - Math.min(1, Math.abs(elevation - 0.45) * 2);
  const fertility = clamp(fertilityNoise * 0.55 + moisture * 0.25 + moderateElevation * 0.2);
  const roughness = sampleValueNoise(config, 'field:roughness', x, y, tuning.roughness);
  const horizontalSlope = Math.abs(elevationAt(config, x + 1, y, tuning) - elevationAt(config, x - 1, y, tuning));
  const verticalSlope = Math.abs(elevationAt(config, x, y + 1, tuning) - elevationAt(config, x, y - 1, tuning));
  const slope = clamp(horizontalSlope + verticalSlope);
  const fields = { elevation, moisture, temperature, fertility, roughness, slope };
  if (cacheable) setCachedFields(config, x, y, fields);
  return { ...fields };
}

export function fieldAt(config: WorldConfig, field: FieldName, x: number, y: number, tuning = DEFAULT_FIELD_TUNING) {
  return fieldsAt(config, x, y, tuning)[field];
}

export function sampleFieldGrid(config: WorldConfig, minX: number, minY: number, width: number, height: number, step = 1, tuning = DEFAULT_FIELD_TUNING): FieldSample[] {
  assertCoordinate(minX, 'minX'); assertCoordinate(minY, 'minY');
  if (!Number.isInteger(width) || width < 1) throw new Error('width must be a positive integer');
  if (!Number.isInteger(height) || height < 1) throw new Error('height must be a positive integer');
  if (!Number.isInteger(step) || step < 1) throw new Error('step must be a positive integer');
  const samples: FieldSample[] = [];
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const x = minX + column * step; const y = minY + row * step;
    samples.push({ x, y, fields: fieldsAt(config, x, y, tuning) });
  }
  return samples;
}
