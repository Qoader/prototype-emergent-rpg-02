// A middle-distance view: enough room to navigate a settlement without turning
// the wilderness into a field of tiny symbols.
export const TILE_SIZE = 40;
export const CHUNK_SIZE = 24;
export const REGION_CHUNK_SIZE = 16;
export const GENERATOR_VERSION = 8;
export const SUPPORTED_GENERATOR_VERSIONS = [6, 7, GENERATOR_VERSION] as const;
export const TREE_LANDMARK_THRESHOLD = 0.84;
export const STARTER_RADIUS = 2;
const START_SEARCH_RADIUS = 96;
// Rare points of interest should stay special even across large explored areas.
const SHRINE_DETAIL_THRESHOLD = 0.9992;
const RUIN_DETAIL_THRESHOLD = 0.996;
import { fieldsAt } from './fields';
import { hydrologyAt, type Hydrology } from './hydrology';
import type { LandmarkAnchor, ResourceAnchor, RoadEndpoint, SettlementShell } from './regions';
import type { SettlementLayout } from './settlements';
import type { RoadSegment, RoadNetwork } from './roads';
export type Terrain = 'deep-water' | 'shallow-water' | 'shore' | 'plain' | 'hill' | 'mountain' | 'river' | 'starter-ground';
export type Biome = 'ocean' | 'lake' | 'coast' | 'grassland' | 'forest' | 'swamp' | 'desert' | 'tundra' | 'alpine';
export type Landmark = 'tree' | 'ruin' | 'shrine' | null;
export interface Tile { x: number; y: number; terrain: Terrain; biome: Biome; hydrology: Hydrology; elevation: number; movementCost: number; landmark: Landmark; walkable: boolean; road: boolean; }
export interface WorldConfig { seed: string; version: number; }
export interface WorldCoordinate { x: number; y: number; }
export interface ChunkCoordinate { cx: number; cy: number; }
export interface RegionCoordinate { rx: number; ry: number; }
export interface ChunkKey extends ChunkCoordinate { seed: string; version: number; }
export interface RegionKey extends RegionCoordinate { seed: string; version: number; }
export interface WorldChunk extends ChunkCoordinate { tiles: Tile[]; settlements: SettlementShell[]; settlementLayouts: SettlementLayout[]; landmarks: LandmarkAnchor[]; resources: ResourceAnchor[]; roadEndpoints: RoadEndpoint[]; roads: RoadSegment[]; }

export function createWorldConfig(seed: string, version = GENERATOR_VERSION): WorldConfig { return { seed, version }; }

const startingPositions = new Map<string, WorldCoordinate>();

function hashInput(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function serializeCoordinate(value: string | number) { return typeof value === 'number' && Object.is(value, -0) ? '-0' : String(value); }

/** Returns stable random-access randomness; it does not consume mutable RNG state. */
export function random(config: WorldConfig, namespace: string, ...coordinates: Array<string | number>) {
  const input = [config.seed, `v${config.version}`, namespace, ...coordinates.map(serializeCoordinate)].join(':');
  return hashInput(input);
}

function assertInteger(value: number, label: string) {
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`);
}

function floorDiv(value: number, divisor: number) { return Math.floor(value / divisor); }

function assertSupportedGeneratorVersion(config: WorldConfig) {
  if (!(SUPPORTED_GENERATOR_VERSIONS as readonly number[]).includes(config.version)) throw new Error(`Unsupported world generator version: ${config.version}`);
}

export function worldToChunk(x: number, y: number): ChunkCoordinate {
  assertInteger(x, 'x'); assertInteger(y, 'y');
  return { cx: floorDiv(x, CHUNK_SIZE), cy: floorDiv(y, CHUNK_SIZE) };
}

export function worldToRegion(x: number, y: number): RegionCoordinate {
  const chunk = worldToChunk(x, y);
  return { rx: floorDiv(chunk.cx, REGION_CHUNK_SIZE), ry: floorDiv(chunk.cy, REGION_CHUNK_SIZE) };
}

export function chunkKey(key: ChunkKey) { return `${key.seed}:v${key.version}:chunk:${key.cx},${key.cy}`; }
export function regionKey(key: RegionKey) { return `${key.seed}:v${key.version}:region:${key.rx},${key.ry}`; }
export function featureId(config: WorldConfig, namespace: string, x: number, y: number) { return `${config.seed}:v${config.version}:${namespace}:${x},${y}`; }

function startingPositionKey(config: WorldConfig) { return `${config.seed}:v${config.version}`; }

function starterLand(config: WorldConfig, x: number, y: number) {
  const fields = fieldsAt(config, x, y);
  return fields.elevation >= 0.28 && fields.elevation <= 0.76 && fields.slope <= 0.14 && hydrologyAt(config, x, y).waterBody === 'none';
}

/** Finds a stable patch of contiguous land for the player's initial position. */
export function findStartingPosition(config: WorldConfig): WorldCoordinate {
  assertSupportedGeneratorVersion(config);
  const cacheKey = startingPositionKey(config); const cached = startingPositions.get(cacheKey); if (cached) return { ...cached };
  for (let radius = 0; radius <= START_SEARCH_RADIUS; radius++) {
    const candidates: WorldCoordinate[] = [];
    for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
      if (Math.max(Math.abs(x), Math.abs(y)) !== radius || !starterLand(config, x, y)) continue;
      let surroundingLand = true;
      for (let dy = -STARTER_RADIUS; dy <= STARTER_RADIUS && surroundingLand; dy++) for (let dx = -STARTER_RADIUS; dx <= STARTER_RADIUS; dx++) {
        if (!starterLand(config, x + dx, y + dy)) { surroundingLand = false; break; }
      }
      if (surroundingLand) candidates.push({ x, y });
    }
    if (candidates.length) {
      candidates.sort((a, b) => a.y - b.y || a.x - b.x);
      const position = candidates[0]; startingPositions.set(cacheKey, position); return { ...position };
    }
  }
  throw new Error(`Unable to find a land starting position within ${START_SEARCH_RADIUS} tiles`);
}

export function tileAt(seed: string, x: number, y: number): Tile { return tileAtConfig(createWorldConfig(seed), x, y); }

export function tileAtConfig(config: WorldConfig, x: number, y: number): Tile {
  assertSupportedGeneratorVersion(config);
  const fields = fieldsAt(config, x, y); const hydrology = hydrologyAt(config, x, y); return tileFromFields(config, x, y, fields, hydrology);
}

function tileFromFields(config: WorldConfig, x: number, y: number, fields: ReturnType<typeof fieldsAt>, hydrology: Hydrology): Tile {
  const startingPosition = findStartingPosition(config); const starter = Math.hypot(x - startingPosition.x, y - startingPosition.y) <= STARTER_RADIUS;
  let terrain: Terrain;
  if (starter) terrain = 'starter-ground';
  else if (hydrology.waterBody === 'ocean' || hydrology.waterBody === 'lake') terrain = fields.elevation < 0.22 ? 'deep-water' : 'shallow-water';
  else if (hydrology.waterBody === 'river') terrain = 'river';
  else if (hydrology.shoreline) terrain = 'shore';
  else if (fields.elevation > 0.76 || fields.slope > 0.14) terrain = 'mountain';
  else if (fields.elevation > 0.58 || fields.roughness > 0.65) terrain = 'hill';
  else terrain = 'plain';
  const biome = classifyBiome(fields, terrain, hydrology.waterBody);
  const walkable = terrain !== 'deep-water' && terrain !== 'shallow-water' && terrain !== 'river' && terrain !== 'mountain';
  const movementCost = terrain === 'starter-ground' || terrain === 'plain' ? 1 : terrain === 'shore' ? 1.5 : biome === 'forest' ? 1.8 : biome === 'swamp' ? 2.5 : biome === 'desert' ? 1.4 : biome === 'tundra' ? 1.8 : terrain === 'hill' ? 2.2 : Infinity;
  const detail = random(config, 'landmark', x, y); const coastal = terrain === 'shore' || biome === 'coast' || hydrology.shoreline;
  const landmark = walkable && detail > SHRINE_DETAIL_THRESHOLD ? 'shrine' : walkable && detail > RUIN_DETAIL_THRESHOLD ? 'ruin' : walkable && !coastal && detail > TREE_LANDMARK_THRESHOLD ? 'tree' : null;
  return { x, y, terrain, biome, hydrology, elevation: fields.elevation, movementCost, landmark, walkable, road: false };
}

export function classifyBiome(fields: ReturnType<typeof fieldsAt>, terrain: Terrain, waterBody: Hydrology['waterBody']): Biome {
  if (waterBody === 'ocean') return 'ocean';
  if (waterBody === 'lake') return 'lake';
  if (terrain === 'shore') return 'coast';
  if (fields.elevation > 0.76 && fields.temperature < 0.45) return 'alpine';
  if (fields.temperature < 0.28) return 'tundra';
  if (fields.temperature > 0.7 && fields.moisture < 0.3) return 'desert';
  if (fields.moisture > 0.72 && fields.elevation < 0.42) return 'swamp';
  if (fields.moisture > 0.58) return 'forest';
  return 'grassland';
}

export function chunkAt(config: WorldConfig, cx: number, cy: number): WorldChunk {
  assertInteger(cx, 'cx'); assertInteger(cy, 'cy');
  const tiles: Tile[] = [];
  for (let y = 0; y < CHUNK_SIZE; y++) for (let x = 0; x < CHUNK_SIZE; x++) {
    const worldX = cx * CHUNK_SIZE + x; const worldY = cy * CHUNK_SIZE + y; const fields = fieldsAt(config, worldX, worldY); const hydrology = hydrologyAt(config, worldX, worldY); tiles.push(tileFromFields(config, worldX, worldY, fields, hydrology));
  }
  return { cx, cy, tiles, settlements: [], settlementLayouts: [], landmarks: [], resources: [], roadEndpoints: [], roads: [] };
}
export function key(x: number, y: number) { return `${x},${y}`; }
export function neighbors(tile: Tile) {
  return [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]].map(([dx, dy]) => ({ x: tile.x + dx, y: tile.y + dy }));
}
interface PathEntry { tile: Tile; cost: number; priority: number; }
class PathHeap {
  private values: PathEntry[] = [];
  push(value: PathEntry) { this.values.push(value); let index = this.values.length - 1; while (index > 0) { const parent = Math.floor((index - 1) / 2); if (this.compare(this.values[parent], value) <= 0) break; this.values[index] = this.values[parent]; index = parent; } this.values[index] = value; }
  pop() { if (!this.values.length) return undefined; const result = this.values[0]; const last = this.values.pop()!; if (this.values.length) { let index = 0; while (true) { const left = index * 2 + 1; if (left >= this.values.length) break; const right = left + 1; const child = right < this.values.length && this.compare(this.values[right], this.values[left]) < 0 ? right : left; if (this.compare(this.values[child], last) >= 0) break; this.values[index] = this.values[child]; index = child; } this.values[index] = last; } return result; }
  get size() { return this.values.length; }
  private compare(a: PathEntry, b: PathEntry) { return a.priority - b.priority || a.cost - b.cost || key(a.tile.x, a.tile.y).localeCompare(key(b.tile.x, b.tile.y)); }
}
export interface PathOptions { maxExpandedNodes?: number; maxPathLength?: number; roadTileKeys?: ReadonlySet<string>; blockedTileKeys?: ReadonlySet<string>; }
export function findPath(seed: string, start: Tile, target: Tile, roadNetwork?: RoadNetwork, options: PathOptions = {}): Tile[] {
  const roadTiles = new Set(options.roadTileKeys ?? []);
  const blockedTiles = options.blockedTileKeys ?? new Set<string>();
  for (const segment of roadNetwork?.segments ?? []) for (const tile of segment.tiles) roadTiles.add(key(tile.x, tile.y));
  for (const segment of roadNetwork?.segments ?? []) for (const bridge of segment.bridges) for (const tile of bridge.tiles) roadTiles.add(key(tile.x, tile.y));
  const traversable = (tile: Tile, tileKey = key(tile.x, tile.y)) => !blockedTiles.has(tileKey) && (tile.walkable || roadTiles.has(tileKey));
  const tileCache = new Map<string, Tile>(); const getTile = (x: number, y: number) => { const tileKey = key(x, y); const cached = tileCache.get(tileKey); if (cached) return cached; const tile = tileAt(seed, x, y); tileCache.set(tileKey, tile); return tile; };
  const startChunk = worldToChunk(start.x, start.y); const minX = (startChunk.cx - 1) * CHUNK_SIZE; const minY = (startChunk.cy - 1) * CHUNK_SIZE; const maxX = (startChunk.cx + 2) * CHUNK_SIZE - 1; const maxY = (startChunk.cy + 2) * CHUNK_SIZE - 1;
  const boundedTarget = { x: Math.max(minX, Math.min(maxX, target.x)), y: Math.max(minY, Math.min(maxY, target.y)) };
  const targetKey = key(boundedTarget.x, boundedTarget.y); const effectiveTarget = target.x === boundedTarget.x && target.y === boundedTarget.y ? target : getTile(boundedTarget.x, boundedTarget.y); const targetBlocked = !traversable(effectiveTarget, targetKey);
  let searchTarget = boundedTarget;
  if (targetBlocked) {
    for (let radius = 1; radius <= Math.max(maxX - minX, maxY - minY) && searchTarget === boundedTarget; radius++) {
      for (let x = boundedTarget.x - radius; x <= boundedTarget.x + radius; x++) for (const y of [boundedTarget.y - radius, boundedTarget.y + radius]) {
        if (x < minX || x > maxX || y < minY || y > maxY) continue; const candidate = getTile(x, y); if (traversable(candidate)) { searchTarget = { x, y }; break; }
      }
      for (let y = boundedTarget.y - radius + 1; y < boundedTarget.y + radius && searchTarget === boundedTarget; y++) for (const x of [boundedTarget.x - radius, boundedTarget.x + radius]) {
        if (x < minX || x > maxX || y < minY || y > maxY) continue; const candidate = getTile(x, y); if (traversable(candidate)) { searchTarget = { x, y }; break; }
      }
    }
  }
  const searchTargetKey = key(searchTarget.x, searchTarget.y); const frontier = new PathHeap(); const startKey = key(start.x, start.y); const cameFrom = new Map<string, string | null>([[startKey, null]]); const cost = new Map([[startKey, 0]]); const octile = (x: number, y: number) => { const dx = Math.abs(x - searchTarget.x); const dy = Math.abs(y - searchTarget.y); return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy); }; frontier.push({ tile: start, cost: 0, priority: octile(start.x, start.y) }); let expanded = 0; const maxExpandedNodes = options.maxExpandedNodes ?? Number.POSITIVE_INFINITY;
  while (frontier.size && expanded++ < maxExpandedNodes) {
    const entry = frontier.pop()!; const current = entry.tile; const currentKey = key(current.x, current.y); if (entry.cost !== cost.get(currentKey)) continue; if (currentKey === searchTargetKey) break;
    for (const point of neighbors(current)) {
      if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) continue;
      const next = getTile(point.x, point.y); const nextKey = key(next.x, next.y); if (!traversable(next, nextKey) || (nextKey === targetKey && targetBlocked)) continue;
      const diagonal = point.x !== current.x && point.y !== current.y;
      if (diagonal && (blockedTiles.has(key(point.x, current.y)) || blockedTiles.has(key(current.x, point.y)))) continue;
      const nextCost = entry.cost + (diagonal ? Math.SQRT2 : 1); if (!cost.has(nextKey) || nextCost < cost.get(nextKey)!) { cost.set(nextKey, nextCost); cameFrom.set(nextKey, currentKey); frontier.push({ tile: next, cost: nextCost, priority: nextCost + octile(next.x, next.y) }); }
    }
  }
  let destinationKey = searchTargetKey;
  if (!cameFrom.has(destinationKey)) {
    const reachable = [...cameFrom.keys()].filter((candidate) => candidate !== startKey); reachable.sort((a, b) => { const [ax, ay] = a.split(',').map(Number); const [bx, by] = b.split(',').map(Number); const distance = (x: number, y: number) => (x - boundedTarget.x) ** 2 + (y - boundedTarget.y) ** 2; return distance(ax, ay) - distance(bx, by) || (cost.get(a)! - cost.get(b)!) || a.localeCompare(b); });
    destinationKey = reachable[0] ?? startKey;
  }
  const result: Tile[] = []; let cursor: string | null = destinationKey;
  while (cursor && cursor !== key(start.x, start.y)) { const [x, y] = cursor.split(',').map(Number); result.unshift(getTile(x, y)); cursor = cameFrom.get(cursor) ?? null; }
  return options.maxPathLength ? result.slice(0, options.maxPathLength) : result;
}
