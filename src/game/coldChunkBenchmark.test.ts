import { describe, expect, it } from 'vitest';
import { benchmarkColdChunks } from './coldChunkBenchmark';

describe('v11 cold chunk performance', () => {
  it('keeps the 120-sample cold corpus below the generation SLO', async () => {
    const result = await benchmarkColdChunks();
    expect(result.samples).toHaveLength(120);
    expect(result.p95).toBeLessThanOrEqual(1000);
    expect(result.max).toBeLessThanOrEqual(1500);
  }, 120000);
});
