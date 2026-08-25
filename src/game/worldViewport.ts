import { TILE_SIZE, worldToChunk, type ChunkGridOrigin, type WorldCoordinate } from './world';
import type { ChunkBounds } from './streaming';

export interface ScreenSize {
  width: number;
  height: number;
}

/** Calculates tile and chunk bounds using floor division, including negative world coordinates. */
export function visibleWorldBounds(player: WorldCoordinate, screen: ScreenSize, origin: ChunkGridOrigin = { x: 0, y: 0 }): ChunkBounds & { minX: number; maxX: number; minY: number; maxY: number } {
  const halfWidth = screen.width / TILE_SIZE / 2;
  const halfHeight = screen.height / TILE_SIZE / 2;
  const minX = Math.floor(player.x - halfWidth);
  const maxX = Math.ceil(player.x + halfWidth) - 1;
  const minY = Math.floor(player.y - halfHeight);
  const maxY = Math.ceil(player.y + halfHeight) - 1;
  const minimumChunk = worldToChunk(minX, minY, origin); const maximumChunk = worldToChunk(maxX, maxY, origin);
  return { minX, maxX, minY, maxY, minChunkX: minimumChunk.cx, maxChunkX: maximumChunk.cx, minChunkY: minimumChunk.cy, maxChunkY: maximumChunk.cy };
}
