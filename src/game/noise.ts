import { random, type WorldConfig } from './world';

export interface NoiseSettings {
  scale: number;
  octaves: number;
  lacunarity: number;
  persistence: number;
}

function validate(settings: NoiseSettings) {
  if (!(settings.scale > 0)) throw new Error('Noise scale must be greater than zero');
  if (!Number.isInteger(settings.octaves) || settings.octaves < 1) throw new Error('Noise octaves must be a positive integer');
  if (!(settings.lacunarity > 0)) throw new Error('Noise lacunarity must be greater than zero');
  if (!(settings.persistence > 0)) throw new Error('Noise persistence must be greater than zero');
}

function smoothstep(value: number) { return value * value * (3 - 2 * value); }

function lattice(config: WorldConfig, namespace: string, x: number, y: number) {
  return random(config, namespace, x, y);
}

function octave(config: WorldConfig, namespace: string, x: number, y: number) {
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const tx = smoothstep(x - x0); const ty = smoothstep(y - y0);
  const top = lattice(config, namespace, x0, y0) * (1 - tx) + lattice(config, namespace, x0 + 1, y0) * tx;
  const bottom = lattice(config, namespace, x0, y0 + 1) * (1 - tx) + lattice(config, namespace, x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

export function sampleValueNoise(config: WorldConfig, namespace: string, x: number, y: number, settings: NoiseSettings) {
  validate(settings);
  let frequency = settings.scale; let amplitude = 1; let total = 0; let amplitudeTotal = 0;
  for (let octaveIndex = 0; octaveIndex < settings.octaves; octaveIndex++) {
    total += octave(config, `${namespace}:${octaveIndex}`, x * frequency, y * frequency) * amplitude;
    amplitudeTotal += amplitude;
    frequency *= settings.lacunarity;
    amplitude *= settings.persistence;
  }
  return total / amplitudeTotal;
}
