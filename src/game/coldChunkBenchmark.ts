import { clearGenerationCaches } from './generationCache';
import { WorldProvider } from './WorldProvider';
import { createWorldConfig } from './world';

export interface ColdChunkSample { seed: string; cx: number; cy: number; milliseconds: number; }
export interface ColdChunkBenchmark { samples: ColdChunkSample[]; p50: number; p95: number; max: number; }

const coordinates = [[0, 0], [1, 0], [-1, 1], [2, -2], [-2, -2], [3, 1], [0, 3], [-3, 0], [4, -1], [-1, 4]] as const;
const seeds = ['STARTER', 'CITY', 'COAST', 'LAKE', 'RIVER', 'MOUNTAIN', 'FOREST', 'WILDERNESS', 'BOUNDARY', 'NORTH', 'SOUTH', 'ADVERSARIAL'] as const;

/** Runs the 120-sample cold corpus with a new provider and empty shared caches per sample. */
export async function benchmarkColdChunks(): Promise<ColdChunkBenchmark> {
  const samples: ColdChunkSample[] = [];
  for (const seed of seeds) for (const [cx, cy] of coordinates) {
    clearGenerationCaches(); const provider = new WorldProvider(createWorldConfig(seed)); const started = performance.now(); await provider.getChunk(cx, cy); samples.push({ seed, cx, cy, milliseconds: performance.now() - started }); provider.clear();
  }
  const sorted = samples.map((sample) => sample.milliseconds).sort((a, b) => a - b);
  return { samples, p50: sorted[Math.floor(sorted.length * .5)] ?? 0, p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] ?? 0, max: sorted.at(-1) ?? 0 };
}
