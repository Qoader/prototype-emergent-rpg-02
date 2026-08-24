import { describe, expect, it } from 'vitest';
import { visibleWorldBounds } from './worldViewport';

describe('visibleWorldBounds', () => {
  it('uses floor chunk conversion on negative coordinates', () => {
    expect(visibleWorldBounds({ x: -0.25, y: -24.25 }, { width: 80, height: 80 })).toMatchObject({ minX: -2, maxX: 0, minY: -26, maxY: -24, minChunkX: -1, maxChunkX: 0, minChunkY: -2, maxChunkY: -1 });
  });
});
