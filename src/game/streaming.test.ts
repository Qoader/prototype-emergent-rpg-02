import { describe, expect, it } from 'vitest';
import { streamingPlan } from './streaming';

describe('chunk streaming plan', () => {
  it('creates a one-chunk perimeter without overlap', () => {
    const plan = streamingPlan({ minChunkX: 0, maxChunkX: 1, minChunkY: 0, maxChunkY: 1 }, { cx: 0, cy: 0 });
    expect(plan.visible).toEqual(new Set(['0,0', '1,0', '0,1', '1,1']));
    expect(plan.preload.size).toBe(12);
    expect([...plan.preload].every((coordinate) => !plan.visible.has(coordinate))).toBe(true);
  });

  it('handles negative chunk coordinates and prioritizes visible work', () => {
    const plan = streamingPlan({ minChunkX: -2, maxChunkX: -1, minChunkY: -1, maxChunkY: 0 }, { cx: -1, cy: 0 });
    expect(plan.visible.has('-2,-1')).toBe(true);
    expect(plan.preload.has('-3,-2')).toBe(true);
    const firstPreload = plan.requests.findIndex((request) => request.preload);
    expect(firstPreload).toBe(plan.visible.size);
  });

  it('orders each tier by player distance with a deterministic tie-breaker', () => {
    const plan = streamingPlan({ minChunkX: 0, maxChunkX: 0, minChunkY: 0, maxChunkY: 0 }, { cx: 0, cy: 0 });
    expect(plan.requests.slice(0, 1).map(({ cx, cy }) => `${cx},${cy}`)).toEqual(['0,0']);
    const preload = plan.requests.slice(1);
    expect(preload.map((request) => request.distance)).toEqual([...preload].map((request) => request.distance).sort((a, b) => a - b));
  });
});
