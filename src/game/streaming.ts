import { key, type ChunkCoordinate } from './world';

export interface ChunkBounds {
  minChunkX: number;
  maxChunkX: number;
  minChunkY: number;
  maxChunkY: number;
}

export interface StreamRequest extends ChunkCoordinate {
  preload: boolean;
  distance: number;
}

export interface StreamingPlan {
  visible: Set<string>;
  preload: Set<string>;
  requests: StreamRequest[];
}

function coordinates(bounds: ChunkBounds, margin = 0) {
  const result: ChunkCoordinate[] = [];
  for (let cy = bounds.minChunkY - margin; cy <= bounds.maxChunkY + margin; cy++) {
    for (let cx = bounds.minChunkX - margin; cx <= bounds.maxChunkX + margin; cx++) result.push({ cx, cy });
  }
  return result;
}

export function streamingPlan(bounds: ChunkBounds, playerChunk: ChunkCoordinate, preloadMargin = 1): StreamingPlan {
  const visibleCoordinates = coordinates(bounds);
  const expanded = coordinates(bounds, preloadMargin);
  const visible = new Set(visibleCoordinates.map(({ cx, cy }) => key(cx, cy)));
  const preload = new Set(expanded.map(({ cx, cy }) => key(cx, cy)).filter((coordinate) => !visible.has(coordinate)));
  const requests = [
    ...visibleCoordinates.map(({ cx, cy }) => ({ cx, cy, preload: false, distance: Math.max(Math.abs(cx - playerChunk.cx), Math.abs(cy - playerChunk.cy)) })),
    ...expanded.filter(({ cx, cy }) => preload.has(key(cx, cy))).map(({ cx, cy }) => ({ cx, cy, preload: true, distance: Math.max(Math.abs(cx - playerChunk.cx), Math.abs(cy - playerChunk.cy)) })),
  ];
  requests.sort((a, b) => Number(a.preload) - Number(b.preload) || a.distance - b.distance || key(a.cx, a.cy).localeCompare(key(b.cx, b.cy)));
  return { visible, preload, requests };
}
