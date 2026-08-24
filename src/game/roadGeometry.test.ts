import { describe, expect, it } from 'vitest';
import { ROAD_RENDER_WIDTH_SCALE, roadOuterHalfWidthInTiles, roadOuterStrokeWidthPx, roadStrokeWidthPx } from './roadGeometry';

describe('road render geometry', () => {
  it('scales the colored stroke for every logical road width', () => {
    expect(ROAD_RENDER_WIDTH_SCALE).toBe(0.75);
    expect(roadStrokeWidthPx(4)).toBe(30);
    expect(roadStrokeWidthPx(2.5)).toBe(18.75);
    expect(roadStrokeWidthPx(1.4)).toBe(10.5);
  });

  it('keeps the outline tied to the scaled stroke', () => {
    expect(roadOuterStrokeWidthPx(3)).toBe(25.5);
    expect(roadOuterHalfWidthInTiles(3)).toBe(0.31875);
  });
});
