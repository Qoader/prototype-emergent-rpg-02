export const TILE_SIZE = 32;
export const CHUNK_SIZE = 24;
export const REGION_CHUNK_SIZE = 16;
export const GENERATOR_VERSION = 2;
import { fieldsAt } from './fields';
import { hydrologyAt, type Hydrology } from './hydrology';
import type { LandmarkAnchor, ResourceAnchor, RoadEndpoint, SettlementShell } from './regions';
import type { SettlementLayout } from './settlements';
import type { RoadSegment, RoadNetwork } from './roads';
export type Terrain = 'deep-water' | 'shallow-water' | 'shore' | 'plain' | 'hill' | 'mountain' | 'river' | 'starter-ground';
export type Biome = 'ocean' | 'lake' | 'coast' | 'grassland' | 'forest' | 'swamp' | 'desert' | 'tundra' | 'alpine';
export type Landmark = 'tree' | 'ruin' | 'shrine' | null;
export interface Tile { x: number; y: number; terrain: Terrain; biome: Biome; hydrology: Hydrology; elevation: number; movementCost: number; landmark: Landmark; walkable: boolean; }
export interface WorldConfig { seed: string; version: number; }
export interface WorldCoordinate { x: number; y: number; }
export interface ChunkCoordinate { cx: number; cy: number; }
export interface RegionCoordinate { rx: number; ry: number; }
export interface ChunkKey extends ChunkCoordinate { seed: string; version: number; }
export interface RegionKey extends RegionCoordinate { seed: string; version: number; }
export interface WorldChunk extends ChunkCoordinate { tiles: Tile[]; settlements: SettlementShell[]; settlementLayouts: SettlementLayout[]; landmarks: LandmarkAnchor[]; resources: ResourceAnchor[]; roadEndpoints: RoadEndpoint[]; roads: RoadSegment[]; }

export function createWorldConfig(seed: string, version = GENERATOR_VERSION): WorldConfig { return { seed, version }; }

function hashInput(input: string) { let h = 2166136261; for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }

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

export function tileAt(seed: string, x: number, y: number): Tile { return tileAtConfig(createWorldConfig(seed), x, y); }

export function tileAtConfig(config: WorldConfig, x: number, y: number): Tile {
  if (config.version !== GENERATOR_VERSION) throw new Error(`Unsupported world generator version: ${config.version}`);
  const fields = fieldsAt(config, x, y); const hydrology = hydrologyAt(config, x, y); const starter = Math.hypot(x, y) <= 2;
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
  const detail = random(config, 'landmark', x, y); const landmark = walkable && detail > 0.95 ? 'shrine' : walkable && detail > 0.84 ? 'ruin' : walkable && detail > 0.68 ? 'tree' : null;
  return { x, y, terrain, biome, hydrology, elevation: fields.elevation, movementCost, landmark, walkable };
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
  for (let y = 0; y < CHUNK_SIZE; y++) for (let x = 0; x < CHUNK_SIZE; x++) tiles.push(tileAtConfig(config, cx * CHUNK_SIZE + x, cy * CHUNK_SIZE + y));
  return { cx, cy, tiles, settlements: [], settlementLayouts: [], landmarks: [], resources: [], roadEndpoints: [], roads: [] };
}
export function key(x: number, y: number) { return `${x},${y}`; }
export function neighbors(tile: Tile) { return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: tile.x + dx, y: tile.y + dy })); }
interface PathEntry { tile: Tile; cost: number; priority: number; }
class PathHeap {
  private values: PathEntry[] = [];
  push(value: PathEntry) { this.values.push(value); let index = this.values.length - 1; while (index > 0) { const parent = Math.floor((index - 1) / 2); if (this.compare(this.values[parent], value) <= 0) break; this.values[index] = this.values[parent]; index = parent; } this.values[index] = value; }
  pop() { if (!this.values.length) return undefined; const result = this.values[0]; const last = this.values.pop()!; if (this.values.length) { let index = 0; while (true) { const left = index * 2 + 1; if (left >= this.values.length) break; const right = left + 1; const child = right < this.values.length && this.compare(this.values[right], this.values[left]) < 0 ? right : left; if (this.compare(this.values[child], last) >= 0) break; this.values[index] = this.values[child]; index = child; } this.values[index] = last; } return result; }
  get size() { return this.values.length; }
  private compare(a: PathEntry, b: PathEntry) { return a.priority - b.priority || a.cost - b.cost || key(a.tile.x, a.tile.y).localeCompare(key(b.tile.x, b.tile.y)); }
}
export interface PathOptions { maxExpandedNodes?: number; maxPathLength?: number; }
export function findPath(seed: string, start: Tile, target: Tile, roadNetwork?: RoadNetwork, options: PathOptions = {}): Tile[] {
  const bridgeTiles = new Set(roadNetwork?.segments.flatMap((segment) => segment.bridges.flatMap((bridge) => bridge.tiles.map((tile) => key(tile.x, tile.y)))) ?? []);
  if (!target.walkable && !bridgeTiles.has(key(target.x, target.y))) return [];
  const frontier = new PathHeap(); const startKey = key(start.x, start.y); const cameFrom = new Map<string, string | null>([[startKey, null]]); const cost = new Map([[startKey, 0]]); frontier.push({ tile: start, cost: 0, priority: Math.abs(start.x - target.x) + Math.abs(start.y - target.y) }); let expanded = 0; const maxExpandedNodes = options.maxExpandedNodes ?? 1200;
  while (frontier.size && expanded++ < maxExpandedNodes) {
    const entry = frontier.pop()!; const current = entry.tile; const currentKey = key(current.x, current.y); if (entry.cost !== cost.get(currentKey)) continue; if (current.x === target.x && current.y === target.y) break;
    for (const point of neighbors(current)) { const next = tileAt(seed, point.x, point.y); const nextKey = key(next.x, next.y); const bridge = bridgeTiles.has(nextKey); const nextCost = entry.cost + (bridge ? 1.2 : next.movementCost); if ((next.walkable || bridge) && (!cost.has(nextKey) || nextCost < cost.get(nextKey)!)) { cost.set(nextKey, nextCost); cameFrom.set(nextKey, currentKey); frontier.push({ tile: next, cost: nextCost, priority: nextCost + Math.abs(next.x - target.x) + Math.abs(next.y - target.y) }); } }
  }
  const result: Tile[] = []; let cursor: string | null = key(target.x, target.y); if (!cameFrom.has(cursor)) return [];
  while (cursor && cursor !== key(start.x, start.y)) { const [x, y] = cursor.split(',').map(Number); result.unshift(tileAt(seed, x, y)); cursor = cameFrom.get(cursor) ?? null; }
  return options.maxPathLength ? result.slice(0, options.maxPathLength) : result;
}
