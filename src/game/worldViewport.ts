import { CHUNK_SIZE, TILE_SIZE, type WorldCoordinate } from './world';
import type { ChunkBounds } from './streaming';

export interface ScreenSize {
  width: number;
  height: number;
}

/** Calculates tile and chunk bounds using floor division, including negative world coordinates. */
export function visibleWorldBounds(player: WorldCoordinate, screen: ScreenSize): ChunkBounds & { minX: number; maxX: number; minY: number; maxY: number } {
  const halfWidth = screen.width / TILE_SIZE / 2;
  const halfHeight = screen.height / TILE_SIZE / 2;
  const minX = Math.floor(player.x - halfWidth);
  const maxX = Math.ceil(player.x + halfWidth) - 1;
  const minY = Math.floor(player.y - halfHeight);
  const maxY = Math.ceil(player.y + halfHeight) - 1;
  return { minX, maxX, minY, maxY, minChunkX: Math.floor(minX / CHUNK_SIZE), maxChunkX: Math.floor(maxX / CHUNK_SIZE), minChunkY: Math.floor(minY / CHUNK_SIZE), maxChunkY: Math.floor(maxY / CHUNK_SIZE) };
}
