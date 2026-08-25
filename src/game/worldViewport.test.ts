import { describe, expect, it } from 'vitest';
import { visibleWorldBounds } from './worldViewport';

describe('visibleWorldBounds', () => {
  it('uses floor chunk conversion on negative coordinates', () => {
    expect(visibleWorldBounds({ x: -0.25, y: -24.25 }, { width: 80, height: 80 })).toMatchObject({ minX: -2, maxX: 0, minY: -26, maxY: -24, minChunkX: -1, maxChunkX: 0, minChunkY: -2, maxChunkY: -1 });
  });
  it('uses the supplied shifted chunk origin', () => {
    expect(visibleWorldBounds({ x: 12, y: 12 }, { width: 40, height: 40 }, { x: 0, y: 0 })).toMatchObject({ minChunkX: 0, maxChunkX: 0, minChunkY: 0, maxChunkY: 0 });
    expect(visibleWorldBounds({ x: 12, y: 12 }, { width: 40, height: 40 }, { x: 12, y: 12 })).toMatchObject({ minChunkX: -1, maxChunkX: 0, minChunkY: -1, maxChunkY: 0 });
  });
});
