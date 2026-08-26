import { CHUNK_SIZE, chunkBounds, type WorldChunk } from './world';

export const CHUNK_RENDER_PAYLOAD_VERSION = 11;
export const enum TileFlag {
  Road = 1 << 0, Port = 1 << 1, WaterRoute = 1 << 2, Walkable = 1 << 3,
  Blocked = 1 << 4, Landmark = 1 << 5,
}

export interface ChunkRenderPayload {
  version: 11;
  cx: number;
  cy: number;
  terrainCode: Uint8Array;
  tileFlags: Uint8Array;
  roadVertices: Float32Array;
  /** Four values per road: vertex offset, vertex count, width in 1/100 tiles, material. */
  roadRanges: Uint32Array;
  /** Three values per static instance: local x, local y, kind. */
  staticInstances: Int16Array;
  staticKinds: Uint8Array;
  navigationBits: Uint8Array;
  /** Pairs of local port index and local water-tile index. */
  portLinks: Uint16Array;
}

const terrainCodes: Record<string, number> = {
  'deep-water': 0, 'shallow-water': 1, shore: 2, plain: 3, hill: 4,
  mountain: 5, river: 6, 'starter-ground': 7,
};
const materialFor = (width: number) => width >= 3 ? 2 : width >= 2 ? 1 : 0;
const indexAt = (x: number, y: number, bounds: ReturnType<typeof chunkBounds>) => (y - bounds.minY) * CHUNK_SIZE + x - bounds.minX;

/** Packs only chunk-local render state. It deliberately never retains references to the source graph. */
export function packChunkRenderPayload(chunk: WorldChunk): ChunkRenderPayload {
  const bounds = chunkBounds(chunk.cx, chunk.cy);
  const terrainCode = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  const tileFlags = new Uint8Array(terrainCode.length);
  const navigationBits = new Uint8Array(terrainCode.length);
  const staticValues: number[] = [];
  const staticKinds: number[] = [];
  for (const tile of chunk.tiles) {
    const index = indexAt(tile.x, tile.y, bounds);
    if (index < 0 || index >= terrainCode.length) continue;
    terrainCode[index] = terrainCodes[tile.terrain] ?? 0;
    let flags = 0;
    if (tile.road) flags |= TileFlag.Road;
    if (tile.port) flags |= TileFlag.Port;
    if (tile.waterRoute) flags |= TileFlag.WaterRoute;
    if (tile.walkable) flags |= TileFlag.Walkable;
    if (!tile.walkable) flags |= TileFlag.Blocked;
    if (tile.landmark) flags |= TileFlag.Landmark;
    tileFlags[index] = flags;
    navigationBits[index] = flags & (TileFlag.Road | TileFlag.Port | TileFlag.WaterRoute | TileFlag.Walkable | TileFlag.Blocked);
    if (tile.landmark) { staticValues.push(tile.x - bounds.minX, tile.y - bounds.minY); staticKinds.push(tile.landmark === 'tree' ? 0 : tile.landmark === 'ruin' ? 1 : 2); }
  }
  const roadVertices: number[] = [];
  const roadRanges: number[] = [];
  const addRoad = (points: Array<{ x: number; y: number }>, width: number, material: number) => {
    if (points.length < 1) return;
    const offset = roadVertices.length / 2;
    for (const point of points) roadVertices.push(point.x - bounds.minX, point.y - bounds.minY);
    roadRanges.push(offset, points.length, Math.round(width * 100), material);
  };
  for (const road of chunk.roads) {
    if (road.tiles.some((tile) => tile.x >= bounds.minX && tile.x < bounds.minX + CHUNK_SIZE && tile.y >= bounds.minY && tile.y < bounds.minY + CHUNK_SIZE)) addRoad(road.points, road.width, materialFor(road.width));
    for (const route of road.waterRoutes) if (route.tiles.some((tile) => tile.x >= bounds.minX && tile.x < bounds.minX + CHUNK_SIZE && tile.y >= bounds.minY && tile.y < bounds.minY + CHUNK_SIZE)) addRoad(route.points, route.width, 3);
  }
  for (const layout of chunk.settlementLayouts) for (const street of layout.streets) if (street.tiles.some((tile) => tile.x >= bounds.minX && tile.x < bounds.minX + CHUNK_SIZE && tile.y >= bounds.minY && tile.y < bounds.minY + CHUNK_SIZE)) addRoad(street.points, street.width, materialFor(street.width));
  for (const layout of chunk.settlementLayouts) for (const building of layout.buildings) if (building.x >= bounds.minX && building.x < bounds.minX + CHUNK_SIZE && building.y >= bounds.minY && building.y < bounds.minY + CHUNK_SIZE) { staticValues.push(building.x - bounds.minX, building.y - bounds.minY); staticKinds.push(8); }
  return { version: CHUNK_RENDER_PAYLOAD_VERSION, cx: chunk.cx, cy: chunk.cy, terrainCode, tileFlags, roadVertices: new Float32Array(roadVertices), roadRanges: new Uint32Array(roadRanges), staticInstances: new Int16Array(staticValues), staticKinds: new Uint8Array(staticKinds), navigationBits, portLinks: new Uint16Array() };
}

export function chunkRenderPayloadTransferList(payload: ChunkRenderPayload): ArrayBuffer[] {
  return [payload.terrainCode.buffer, payload.tileFlags.buffer, payload.roadVertices.buffer, payload.roadRanges.buffer, payload.staticInstances.buffer, payload.staticKinds.buffer, payload.navigationBits.buffer, payload.portLinks.buffer] as ArrayBuffer[];
}

/** Copies a cached canonical payload before transfer so worker caches never hold detached buffers. */
export function cloneChunkRenderPayload(payload: ChunkRenderPayload): ChunkRenderPayload {
  return { ...payload, terrainCode: payload.terrainCode.slice(), tileFlags: payload.tileFlags.slice(), roadVertices: payload.roadVertices.slice(), roadRanges: payload.roadRanges.slice(), staticInstances: payload.staticInstances.slice(), staticKinds: payload.staticKinds.slice(), navigationBits: payload.navigationBits.slice(), portLinks: payload.portLinks.slice() };
}
