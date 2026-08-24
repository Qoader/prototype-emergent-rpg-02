import { TILE_SIZE } from './world';

/** Render roads at a slimmer width without changing logical road data. */
export const ROAD_RENDER_WIDTH_SCALE = 0.75;

/** Width of the colored road stroke, in screen pixels. */
export function roadStrokeWidthPx(width: number) {
  return width * TILE_SIZE / 4 * ROAD_RENDER_WIDTH_SCALE;
}

/** Width of the dark outline drawn around a road, in screen pixels. */
export function roadOuterStrokeWidthPx(width: number) {
  return roadStrokeWidthPx(width) + 3;
}

/** Distance from a road centerline to the outside of its rendered outline. */
export function roadOuterHalfWidthInTiles(width: number) {
  return roadOuterStrokeWidthPx(width) / (2 * TILE_SIZE);
}
