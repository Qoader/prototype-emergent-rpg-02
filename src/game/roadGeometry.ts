import { TILE_SIZE } from './world';

/** Width of the dark outline drawn around a road, in screen pixels. */
export function roadOuterStrokeWidthPx(width: number) {
  return width * TILE_SIZE / 4 + 3;
}

/** Distance from a road centerline to the outside of its rendered outline. */
export function roadOuterHalfWidthInTiles(width: number) {
  return roadOuterStrokeWidthPx(width) / (2 * TILE_SIZE);
}
