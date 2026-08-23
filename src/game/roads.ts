import { fieldsAt } from './fields';
import { hydrologyAt } from './hydrology';
import { generateRegion, type RegionData, type RoadEndpoint } from './regions';
import { REGION_SIZE_TILES } from './regions';
import { findStartingPosition, key, random, tileAtConfig, worldToRegion, type RegionCoordinate, type WorldConfig, type WorldCoordinate } from './world';
import type { WorldPoint } from './settlements';

export const ROAD_NETWORK_VERSION = 11;
export const ROAD_GRAPH_REGION_SIZE = 4;
const COARSE_CELL_SIZE = 16;
const COARSE_TERRAIN_CACHE_LIMIT = 8192;
const coarseTerrainMemo = new Map<string, { fields: ReturnType<typeof fieldsAt>; waterBody: string }>();

export type RoadImportance = 'trail' | 'road' | 'highway';
export interface RoadNode { id: string; ownerId: string; x: number; y: number; kind: RoadEndpoint['kind'] | 'junction' | 'player-start'; importance: number; }
export interface Bridge { id: string; roadId: string; tiles: WorldCoordinate[]; points: WorldPoint[]; width: number; }
export interface RoadSegment { id: string; parentId: string; ownerRegion: RegionCoordinate; from: RoadNode; to: RoadNode; importance: RoadImportance; width: number; tiles: WorldCoordinate[]; points: WorldPoint[]; bridges: Bridge[]; }
export interface RoadNetwork { key: RegionCoordinate; nodes: RoadNode[]; segments: RoadSegment[]; }

function regionKey(region: RegionCoordinate) { return `${region.rx},${region.ry}`; }
function graphCell(rx: number, ry: number) { return { gx: Math.floor(rx / ROAD_GRAPH_REGION_SIZE), gy: Math.floor(ry / ROAD_GRAPH_REGION_SIZE) }; }
export function roadGraphCell(rx: number, ry: number) { return graphCell(rx, ry); }
function distance(a: WorldCoordinate, b: WorldCoordinate) { return Math.hypot(a.x - b.x, a.y - b.y); }

type PlannedRoadEdge = { from: RoadNode; to: RoadNode };

// Starter roads are generated independently from regional road cells. Keep a
// small deterministic reservation set so a regional road can leave the
// starter entry gate free without depending on request order or cache state.
const starterSettlementMemo = new Map<string, Set<string>>();
function starterSettlementIds(config: WorldConfig) {
  const cacheKey = `${config.seed}:v${config.version}`;
  const cached = starterSettlementMemo.get(cacheKey); if (cached) return cached;
  const start = findStartingPosition(config); const origin = worldToRegion(start.x, start.y); const settlements = [] as Array<{ id: string; x: number; y: number }>;
  // The starter-road generator searches this same deterministic ring. Avoid a
  // runtime dependency on route success here; fallback routing makes the
  // nearest candidates the effective reservation set in normal worlds.
  for (let ry = origin.ry - 2; ry <= origin.ry + 2; ry++) for (let rx = origin.rx - 2; rx <= origin.rx + 2; rx++) {
    for (const settlement of generateRegion(config, rx, ry).settlements) settlements.push(settlement);
  }
  settlements.sort((a, b) => distance(start, a) - distance(start, b) || a.id.localeCompare(b.id));
  const result = new Set(settlements.slice(0, 2).map((settlement) => settlement.id)); starterSettlementMemo.set(cacheKey, result); return result;
}

function assignPhysicalGates(config: WorldConfig, edges: PlannedRoadEdge[], gatesByOwner: Map<string, RoadNode[]>) {
  const reservedOwners = starterSettlementIds(config);
  const starter = findStartingPosition(config);
  const assigned = new Map<string, Set<string>>();
  const endpointFor = (node: RoadNode, opposite: RoadNode, edgeId: string) => {
    if (node.kind !== 'settlement-gate') return node;
    const gates = (gatesByOwner.get(node.ownerId) ?? [node]).slice().sort((a, b) => a.id.localeCompare(b.id));
    const used = assigned.get(node.ownerId) ?? new Set<string>(); assigned.set(node.ownerId, used);
    // Starter roads reserve the nearest entry gate. Regional edges avoid it
    // whenever there is another physical gate available.
    const starterGate = gates.slice().sort((a, b) => distance(a, starter) - distance(b, starter) || a.id.localeCompare(b.id))[0];
    const available = gates.filter((gate) => !used.has(gate.id) && !(reservedOwners.has(node.ownerId) && gate.id === starterGate?.id));
    const candidates = available.length ? available : gates.filter((gate) => !used.has(gate.id));
    const pool = candidates.length ? candidates : gates;
    const selected = pool.slice().sort((a, b) => distance(a, opposite) - distance(b, opposite) || `${a.id}|${edgeId}`.localeCompare(`${b.id}|${edgeId}`))[0];
    used.add(selected.id); return selected;
  };
  return edges.map((edge, index) => ({
    from: endpointFor(edge.from, edge.to, `${index}:from`),
    to: endpointFor(edge.to, edge.from, `${index}:to`),
  }));
}
function portalNode(config: WorldConfig, gx: number, gy: number, side: 'north' | 'east' | 'south' | 'west'): RoadNode {
  const cellSize = ROAD_GRAPH_REGION_SIZE * REGION_SIZE_TILES;
  const minX = gx * cellSize; const minY = gy * cellSize; const maxX = minX + cellSize - 1; const maxY = minY + cellSize - 1;
  const horizontal = side === 'north' || side === 'south';
  const edgeX = horizontal ? gx : side === 'east' ? gx + 1 : gx;
  const edgeY = horizontal ? side === 'south' ? gy + 1 : gy : gy;
  const axis = horizontal ? 'h' : 'v';
  const offset = 16 + Math.floor(random(config, 'road:portal-offset', axis, edgeX, edgeY) * Math.max(1, cellSize - 32));
  const point = side === 'north' ? { x: minX + offset, y: minY } : side === 'east' ? { x: maxX, y: minY + offset } : side === 'south' ? { x: minX + offset, y: maxY } : { x: minX, y: minY + offset };
  const id = `${config.seed}:v${config.version}:road-portal:${axis}:${edgeX},${edgeY}`;
  return { id, ownerId: id, x: point.x, y: point.y, kind: 'region-border', importance: 0.72 };
}
function stablePath(path: WorldCoordinate[]) { return path.filter((point, index) => index === 0 || point.x !== path[index - 1].x || point.y !== path[index - 1].y); }
class RouteHeap {
  private values: Array<{ x: number; y: number; score: number }> = [];
  get length() { return this.values.length; }
  push(value: { x: number; y: number; score: number }) { this.values.push(value); let index = this.values.length - 1; while (index > 0) { const parent = Math.floor((index - 1) / 2); if (this.compare(this.values[parent], value) <= 0) break; this.values[index] = this.values[parent]; index = parent; } this.values[index] = value; }
  pop() { if (!this.values.length) return undefined; const result = this.values[0]; const last = this.values.pop()!; if (this.values.length) { let index = 0; while (true) { const left = index * 2 + 1; if (left >= this.values.length) break; const right = left + 1; const child = right < this.values.length && this.compare(this.values[right], this.values[left]) < 0 ? right : left; if (this.compare(this.values[child], last) >= 0) break; this.values[index] = this.values[child]; index = child; } this.values[index] = last; } return result; }
  private compare(a: { x: number; y: number; score: number }, b: { x: number; y: number; score: number }) { return a.score - b.score || `${a.x},${a.y}`.localeCompare(`${b.x},${b.y}`); }
}

type RouteMode = 'preferred' | 'fallback';

function coarseRoute(config: WorldConfig, from: RoadNode, to: RoadNode, cell: { gx: number; gy: number }, claimedRoadTiles: Set<string>, terrainCache: Map<string, { fields: ReturnType<typeof fieldsAt>; waterBody: string }>, tileCache: Map<string, ReturnType<typeof tileAtConfig>>, mode: RouteMode) {
  const start = { x: Math.floor(from.x / COARSE_CELL_SIZE), y: Math.floor(from.y / COARSE_CELL_SIZE) }; const target = { x: Math.floor(to.x / COARSE_CELL_SIZE), y: Math.floor(to.y / COARSE_CELL_SIZE) };
  const margin = 6; const minX = Math.min(start.x, target.x) - margin; const maxX = Math.max(start.x, target.x) + margin; const minY = Math.min(start.y, target.y) - margin; const maxY = Math.max(start.y, target.y) + margin;
  const key = (x: number, y: number) => `${x},${y}`; const frontier = new RouteHeap(); frontier.push({ ...start, score: 0 }); const cost = new Map([[key(start.x, start.y), 0]]); const came = new Map<string, string | null>([[key(start.x, start.y), null]]);
  const span = Math.max(maxX - minX + 1, maxY - minY + 1);
  // Keep cold generation bounded. Long routes are retried through the
  // neighbouring settlement/portal candidates rather than monopolising the
  // worker on a single blocked search.
  const expansionBudget = Math.min(120, Math.max(40, Math.ceil(span * span * 0.004)));
  let expandedNodes = 0; while (frontier.length && expandedNodes++ < expansionBudget) {
    const current = frontier.pop()!; if (current.x === target.x && current.y === target.y) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = current.x + dx; const y = current.y + dy; if (x < minX || x > maxX || y < minY || y > maxY) continue;
      const wx = x * COARSE_CELL_SIZE + Math.floor(COARSE_CELL_SIZE / 2); const wy = y * COARSE_CELL_SIZE + Math.floor(COARSE_CELL_SIZE / 2); const terrainKey = `${config.seed}:v${config.version}:${wx},${wy}`; let sample = terrainCache.get(terrainKey);
      if (!sample) {
        sample = coarseTerrainMemo.get(terrainKey);
        if (!sample) { const fields = fieldsAt(config, wx, wy); sample = { fields, waterBody: hydrologyAt(config, wx, wy, fields).waterBody }; coarseTerrainMemo.set(terrainKey, sample); if (coarseTerrainMemo.size > COARSE_TERRAIN_CACHE_LIMIT) coarseTerrainMemo.delete(coarseTerrainMemo.keys().next().value!); }
        terrainCache.set(terrainKey, sample);
      }
      const fields = sample.fields;
      const unsuitable = sample.waterBody !== 'none' || fields.elevation < 0.24 || fields.elevation > 0.76 || fields.slope > 0.14;
      if (mode === 'preferred' && unsuitable) continue;
      const waterPenalty = sample.waterBody === 'river' ? 20 : sample.waterBody === 'none' ? 0 : 100;
      const elevationPenalty = fields.elevation < 0.24 || fields.elevation > 0.76 ? 50 : 0;
      const slopePenalty = Math.max(0, fields.slope - 0.14) * 80;
      const terrainPenalty = mode === 'fallback' ? waterPenalty + elevationPenalty + slopePenalty : 0;
      const nextKey = key(x, y); const roadPreference = claimedRoadTiles.has(nextKey) ? 0.2 : 1; const nextCost = (cost.get(key(current.x, current.y)) ?? Infinity) + roadPreference + fields.slope * 10 + fields.roughness * 1.8 + terrainPenalty + random(config, 'road:cost-noise', cell.gx, cell.gy, x, y) * 0.08;
      if (nextCost < (cost.get(nextKey) ?? Infinity)) { cost.set(nextKey, nextCost); came.set(nextKey, key(current.x, current.y)); frontier.push({ x, y, score: nextCost + Math.abs(x - target.x) + Math.abs(y - target.y) }); }
    }
  }
  const result: WorldCoordinate[] = []; let cursor: string | null = key(target.x, target.y); if (!came.has(cursor)) return [];
  while (cursor) { const [x, y] = cursor.split(',').map(Number); result.unshift({ x: x * COARSE_CELL_SIZE + 4, y: y * COARSE_CELL_SIZE + 4 }); cursor = came.get(cursor) ?? null; }
  const expanded: WorldCoordinate[] = [from, ...result, to];
  const validTile = (point: WorldCoordinate) => { if (mode === 'fallback') return true; const tileKey = `${point.x},${point.y}`; let tile = tileCache.get(tileKey); if (!tile) { tile = tileAtConfig(config, point.x, point.y); tileCache.set(tileKey, tile); } return tile.walkable; };
  const path: WorldCoordinate[] = [];
  for (let index = 0; index < expanded.length - 1; index++) { const a = expanded[index]; const b = expanded[index + 1]; const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)); for (let step = 0; step <= steps; step++) { const point = { x: Math.round(a.x + (b.x - a.x) * step / Math.max(1, steps)), y: Math.round(a.y + (b.y - a.y) * step / Math.max(1, steps)) }; if (!validTile(point)) return []; path.push(point); } }
  return stablePath(path);
}

function coarseRouteWithFallback(config: WorldConfig, from: RoadNode, to: RoadNode, cell: { gx: number; gy: number }, claimedRoadTiles: Set<string>, terrainCache: Map<string, { fields: ReturnType<typeof fieldsAt>; waterBody: string }>, tileCache: Map<string, ReturnType<typeof tileAtConfig>>) {
  const preferred = coarseRoute(config, from, to, cell, claimedRoadTiles, terrainCache, tileCache, 'preferred');
  return preferred.length > 1 ? preferred : coarseRoute(config, from, to, cell, claimedRoadTiles, terrainCache, tileCache, 'fallback');
}

function directRoute(from: RoadNode, to: RoadNode) {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  const path: WorldCoordinate[] = [];
  for (let step = 0; step <= steps; step++) path.push({ x: Math.round(from.x + (to.x - from.x) * step / Math.max(1, steps)), y: Math.round(from.y + (to.y - from.y) * step / Math.max(1, steps)) });
  return stablePath(path);
}

function routeWithGuarantee(config: WorldConfig, from: RoadNode, to: RoadNode, cell: { gx: number; gy: number }, claimedRoadTiles: Set<string>, terrainCache: Map<string, { fields: ReturnType<typeof fieldsAt>; waterBody: string }>, tileCache: Map<string, ReturnType<typeof tileAtConfig>>) {
  // Topology remains authoritative: the bounded preferred/fallback searches
  // provide natural detours, while the direct raster route guarantees that a
  // selected edge is still materialized if both searches exhaust their budget.
  const routed = coarseRouteWithFallback(config, from, to, cell, claimedRoadTiles, terrainCache, tileCache);
  return routed.length > 1 ? routed : directRoute(from, to);
}

function starterTileRoute(config: WorldConfig, from: RoadNode, to: RoadNode, mode: RouteMode) {
  const minX = Math.min(from.x, to.x) - 20; const maxX = Math.max(from.x, to.x) + 20;
  const minY = Math.min(from.y, to.y) - 20; const maxY = Math.max(from.y, to.y) + 20;
  const targetKey = key(to.x, to.y); const startKey = key(from.x, from.y); const tileCache = new Map<string, ReturnType<typeof tileAtConfig>>();
  const getTile = (x: number, y: number) => { const id = key(x, y); const cached = tileCache.get(id); if (cached) return cached; const tile = tileAtConfig(config, x, y); tileCache.set(id, tile); return tile; };
  const frontier = new RouteHeap(); frontier.push({ x: from.x, y: from.y, score: 0 }); const cost = new Map([[startKey, 0]]); const came = new Map<string, string | null>([[startKey, null]]);
  const heuristic = (x: number, y: number) => Math.hypot(x - to.x, y - to.y); let expanded = 0;
  while (frontier.length && expanded++ < 100000) {
    const current = frontier.pop()!; const currentKey = key(current.x, current.y); if (currentKey === targetKey) break;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const x = current.x + dx; const y = current.y + dy; if (x < minX || x > maxX || y < minY || y > maxY) continue;
      const tile = getTile(x, y); if (mode === 'preferred' && !tile.walkable) continue;
      const fields = fieldsAt(config, x, y);
      const waterPenalty = tile.hydrology.waterBody === 'river' ? 20 : tile.hydrology.waterBody === 'none' ? 0 : 100;
      const elevationPenalty = fields.elevation < 0.24 || fields.elevation > 0.76 ? 50 : 0;
      const slopePenalty = Math.max(0, fields.slope - 0.14) * 80;
      const terrainPenalty = mode === 'fallback' ? waterPenalty + elevationPenalty + slopePenalty : 0;
      const baseCost = Number.isFinite(tile.movementCost) ? Math.max(1, tile.movementCost) : 1;
      const nextKey = key(x, y); const step = (dx && dy ? Math.SQRT2 : 1) * (baseCost + terrainPenalty); const nextCost = (cost.get(currentKey) ?? Infinity) + step;
      if (nextCost < (cost.get(nextKey) ?? Infinity)) { cost.set(nextKey, nextCost); came.set(nextKey, currentKey); frontier.push({ x, y, score: nextCost + heuristic(x, y) }); }
    }
  }
  if (!came.has(targetKey)) return [];
  const result: WorldCoordinate[] = []; let cursor: string | null = targetKey; while (cursor) { const [x, y] = cursor.split(',').map(Number); result.unshift({ x, y }); cursor = came.get(cursor) ?? null; }
  return result;
}

function starterTileRouteWithFallback(config: WorldConfig, from: RoadNode, to: RoadNode) {
  const preferred = starterTileRoute(config, from, to, 'preferred');
  return preferred.length > 1 ? preferred : starterTileRoute(config, from, to, 'fallback');
}

function importance(a: RoadNode, b: RoadNode): RoadImportance { const value = Math.max(a.importance, b.importance); return value > 0.78 ? 'highway' : value > 0.5 ? 'road' : 'trail'; }
function widthFor(value: RoadImportance) { return value === 'highway' ? 4 : value === 'road' ? 2.5 : 1.4; }
function bridgeGroups(config: WorldConfig, path: WorldCoordinate[], roadId: string, width: number): Bridge[] { const bridges: Bridge[] = []; let current: WorldCoordinate[] = []; const flush = () => { if (!current.length) return; bridges.push({ id: `${roadId}:bridge:${bridges.length}`, roadId, tiles: current, points: current.map((tile) => ({ x: tile.x + 0.5, y: tile.y + 0.5 })), width }); current = []; }; for (const tile of path) { const terrain = tileAtConfig(config, tile.x, tile.y).terrain; if (terrain === 'river' || terrain === 'shallow-water' || terrain === 'deep-water') current.push(tile); else flush(); } flush(); return bridges; }
function smooth(path: WorldCoordinate[]) { return path.map((point, index) => ({ x: point.x + 0.5 + (index > 0 && index < path.length - 1 ? 0.08 * Math.sin(index * 2.3) : 0), y: point.y + 0.5 + (index > 0 && index < path.length - 1 ? 0.08 * Math.cos(index * 1.7) : 0) })); }

function splitSegment(parentId: string, from: RoadNode, to: RoadNode, path: WorldCoordinate[], config: WorldConfig): RoadSegment[] {
  const pieces: RoadSegment[] = []; let currentRegion: RegionCoordinate | null = null; let current: WorldCoordinate[] = [];
  const flush = () => { if (!currentRegion || current.length < 2) return; const kind = importance(from, to); const id = `${parentId}:piece:${regionKey(currentRegion)}`; pieces.push({ id, parentId, ownerRegion: currentRegion, from, to, importance: kind, width: widthFor(kind), tiles: current, points: smooth(current), bridges: bridgeGroups(config, current, id, widthFor(kind)) }); };
  for (const point of path) { const region = worldToRegion(point.x, point.y); if (!currentRegion || region.rx !== currentRegion.rx || region.ry !== currentRegion.ry) { flush(); currentRegion = region; current = current.length ? [current.at(-1)!, point] : [point]; } else current.push(point); }
  flush(); return pieces;
}

/** Builds deterministic routes from the player spawn to distinct destinations. */
export function generateStarterRoad(config: WorldConfig, startPoint: WorldCoordinate, regions: RegionData[]): RoadSegment[] {
  const settlementCandidates = [...new Map(regions.flatMap((region) => region.settlements).map((settlement) => [settlement.id, settlement])).values()];
  settlementCandidates.sort((a, b) => distance(startPoint, a) - distance(startPoint, b) || a.id.localeCompare(b.id));
  const terrainCache = new Map<string, { fields: ReturnType<typeof fieldsAt>; waterBody: string }>();
  const tileCache = new Map<string, ReturnType<typeof tileAtConfig>>();
  const source: RoadNode = { id: `${config.seed}:v${config.version}:player-start:${startPoint.x},${startPoint.y}`, ownerId: `${config.seed}:v${config.version}:player-start`, x: startPoint.x, y: startPoint.y, kind: 'player-start', importance: 0.72 };
  const cell = roadGraphCell(worldToRegion(startPoint.x, startPoint.y).rx, worldToRegion(startPoint.x, startPoint.y).ry);
  const routeTo = (destination: RoadNode) => {
    const path = coarseRouteWithFallback(config, source, destination, cell, new Set(), terrainCache, tileCache);
    const finalPath = path.length > 1 ? path : starterTileRouteWithFallback(config, source, destination);
    return finalPath.length > 1 ? { destination, path: finalPath } : undefined;
  };
  const reachable: Array<{ settlementId: string; destination: RoadNode; path: WorldCoordinate[] }> = [];
  for (const settlement of settlementCandidates) {
    const gate = [...settlement.accessPoints].sort((a, b) => distance(startPoint, a) - distance(startPoint, b) || a.id.localeCompare(b.id))[0];
    const route = gate ? routeTo({ id: gate.id, ownerId: settlement.id, x: gate.x, y: gate.y, kind: gate.kind, importance: gate.importance }) : undefined;
    if (route) reachable.push({ settlementId: settlement.id, destination: route.destination, path: route.path });
    if (reachable.length >= 2) break;
  }
  if (reachable.length < 2) {
    const portals = (['north', 'east', 'south', 'west'] as const).map((side) => portalNode(config, cell.gx, cell.gy, side)).sort((a, b) => distance(startPoint, a) - distance(startPoint, b) || a.id.localeCompare(b.id));
    for (const portal of portals) {
      if (reachable.some((item) => item.destination.ownerId === portal.ownerId)) continue;
      const route = routeTo(portal); if (route) reachable.push({ settlementId: portal.ownerId, destination: route.destination, path: route.path });
      if (reachable.length >= 2) break;
    }
  }
  if (reachable.length < 2) return [];
  const parentBase = `${config.seed}:v${config.version}:starter-road:${source.x},${source.y}`;
  return reachable.slice(0, 2).flatMap((item) => splitSegment(`${parentBase}:${item.destination.id}`, source, item.destination, item.path, config)).sort((a, b) => a.id.localeCompare(b.id));
}

function generateLegacyRoadCell(config: WorldConfig, regions: RegionData[], gx: number, gy: number) {
  const cell = { gx, gy }; const nodeMap = new Map<string, RoadNode>(); const terrainCache = new Map<string, { fields: ReturnType<typeof fieldsAt>; waterBody: string }>(); const tileCache = new Map<string, ReturnType<typeof tileAtConfig>>();
  // Settlements are the backbone graph. Landmarks and resources remain
  // optional future spurs and must not multiply the expensive long routes.
  for (const region of regions) for (const settlement of region.settlements) {
    // One physical gate can carry both external roads; keeping one endpoint
    // per settlement bounds cold-generation cost while the logical owner
    // degree remains enforced below.
    const endpoints = [...settlement.accessPoints].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 1);
    for (const endpoint of endpoints) nodeMap.set(endpoint.id, { id: endpoint.id, ownerId: settlement.id, x: endpoint.x, y: endpoint.y, kind: endpoint.kind, importance: endpoint.importance });
  }
  // Every planning cell participates in the backbone, including empty cells.
  // Shared portal IDs/offsets make neighboring cell cycles meet at borders.
  const sides = (['north', 'east', 'south', 'west'] as const).map((side) => portalNode(config, gx, gy, side));
  for (const node of sides) nodeMap.set(node.id, node);
  const cellSize = ROAD_GRAPH_REGION_SIZE * REGION_SIZE_TILES;
  const minX = gx * cellSize; const minY = gy * cellSize; const maxX = minX + cellSize - 1; const maxY = minY + cellSize - 1;
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const settlementNodes = [...nodeMap.values()].filter((node) => node.kind === 'settlement-gate').sort((a, b) => distance(a, center) - distance(b, center) || b.importance - a.importance || a.id.localeCompare(b.id));
  const portalNodes = [...nodeMap.values()].filter((node) => node.kind === 'region-border');
  const nodes = [...portalNodes, ...settlementNodes].sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x) || distance(a, center) - distance(b, center) || a.id.localeCompare(b.id));
  const planned: Array<{ from: RoadNode; to: RoadNode; path: WorldCoordinate[] }> = [];
  const claimedCoarse = new Set<string>();
  const parent = new Map(nodes.map((node) => [node.id, node.id]));
  const find = (id: string): string => {
    const root = parent.get(id);
    if (!root || root === id) return root ?? id;
    const resolved = find(root);
    parent.set(id, resolved);
    return resolved;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a); const rootB = find(b);
    if (rootA === rootB) return false;
    parent.set(rootA, rootB);
    return true;
  };
  // All gates of one settlement are one logical graph component. This lets
  // two physical gates carry two roads without making the settlement itself
  // a shortcut around the cycle detector.
  const ownerNodes = new Map<string, RoadNode[]>();
  for (const node of nodes) if (node.kind === 'settlement-gate') ownerNodes.set(node.ownerId, [...(ownerNodes.get(node.ownerId) ?? []), node]);
  for (const group of ownerNodes.values()) for (let index = 1; index < group.length; index++) union(group[0].id, group[index].id);
  const settlementDegree = new Map<string, number>();
  const settlementDestinations = new Map<string, Set<string>>();
  const degreeOf = (node: RoadNode) => node.kind === 'settlement-gate' ? settlementDegree.get(node.ownerId) ?? 0 : 0;
  const destinationCount = (node: RoadNode) => settlementDestinations.get(node.ownerId)?.size ?? 0;
  const underConnected = (node: RoadNode) => node.kind === 'settlement-gate' && destinationCount(node) < 2;
  const recordEdge = (from: RoadNode, to: RoadNode) => {
    for (const [settlement, other] of [[from, to], [to, from]] as const) if (settlement.kind === 'settlement-gate') {
      settlementDegree.set(settlement.ownerId, degreeOf(settlement) + 1);
      const destinations = settlementDestinations.get(settlement.ownerId) ?? new Set<string>(); destinations.add(other.ownerId); settlementDestinations.set(settlement.ownerId, destinations);
    }
  };
  const candidates: Array<{ from: RoadNode; to: RoadNode; score: number }> = [];
  for (let fromIndex = 0; fromIndex < nodes.length; fromIndex++) for (let toIndex = fromIndex + 1; toIndex < nodes.length; toIndex++) {
    const from = nodes[fromIndex]; const to = nodes[toIndex];
    if (from.ownerId === to.ownerId) continue;
    candidates.push({ from, to, score: (from.x - to.x) ** 2 + (from.y - to.y) ** 2 });
  }
  // Keep route planning bounded as cells contain more settlements. Every
  // node retains its nearest alternatives, so degree repair can still use a
  // different owner when the cheapest route is blocked.
  const localCandidates = new Map<string, Array<{ from: RoadNode; to: RoadNode; score: number }>>();
  for (const candidate of candidates) {
    localCandidates.set(candidate.from.id, [...(localCandidates.get(candidate.from.id) ?? []), candidate]);
    localCandidates.set(candidate.to.id, [...(localCandidates.get(candidate.to.id) ?? []), candidate]);
  }
  const boundedCandidates = [...new Set([...localCandidates.values()].flatMap((items) => items.sort((a, b) => a.score - b.score || `${a.from.id}|${a.to.id}`.localeCompare(`${b.from.id}|${b.to.id}`)).slice(0, 2)))];
  const attempted = new Set<string>();
  const componentCount = new Set(nodes.map((node) => find(node.id))).size;
  const edgeBudget = nodes.length - componentCount;
  while (planned.length < edgeBudget) {
    const eligible = boundedCandidates.filter((candidate) => {
      const id = `${candidate.from.id}|${candidate.to.id}`;
      if (attempted.has(id) || find(candidate.from.id) === find(candidate.to.id)) return false;
      for (const [settlement, other] of [[candidate.from, candidate.to], [candidate.to, candidate.from]] as const) {
        if (settlement.kind === 'settlement-gate' && underConnected(settlement) && settlementDestinations.get(settlement.ownerId)?.has(other.ownerId)) return false;
      }
      // Once a settlement has two distinct destinations, it remains eligible
      // only for ordinary component-joining edges.
      return true;
    }).sort((a, b) => {
      const aRequired = Number(underConnected(a.from) || underConnected(a.to)); const bRequired = Number(underConnected(b.from) || underConnected(b.to));
      const aNew = Number(a.from.kind === 'settlement-gate' && !settlementDestinations.get(a.from.ownerId)?.has(a.to.ownerId)) + Number(a.to.kind === 'settlement-gate' && !settlementDestinations.get(a.to.ownerId)?.has(a.from.ownerId));
      const bNew = Number(b.from.kind === 'settlement-gate' && !settlementDestinations.get(b.from.ownerId)?.has(b.to.ownerId)) + Number(b.to.kind === 'settlement-gate' && !settlementDestinations.get(b.to.ownerId)?.has(b.from.ownerId));
      return bRequired - aRequired || bNew - aNew || a.score - b.score || `${a.from.id}|${a.to.id}`.localeCompare(`${b.from.id}|${b.to.id}`);
    });
    if (!eligible.length) break;
    const candidate = eligible[0]; const candidateId = `${candidate.from.id}|${candidate.to.id}`; attempted.add(candidateId);
    const path = coarseRouteWithFallback(config, candidate.from, candidate.to, cell, claimedCoarse, terrainCache, tileCache);
    if (path.length < 2 || !union(candidate.from.id, candidate.to.id)) continue;
    planned.push({ from: candidate.from, to: candidate.to, path });
    recordEdge(candidate.from, candidate.to);
    for (const point of path) claimedCoarse.add(key(Math.floor(point.x / COARSE_CELL_SIZE), Math.floor(point.y / COARSE_CELL_SIZE)));
  }
  const segments: RoadSegment[] = [];
  for (const edge of planned) {
    const parentId = `${config.seed}:v${config.version}:road:${edge.from.id}|${edge.to.id}`;
    segments.push(...splitSegment(parentId, edge.from, edge.to, edge.path, config));
  }
  return { nodes, segments: segments.sort((a, b) => a.id.localeCompare(b.id)) };
}

// Kept temporarily as a reference while the topology planner is validated.
void generateLegacyRoadCell;

export function generateRoadCell(config: WorldConfig, regions: RegionData[], gx: number, gy: number) {
  const cell = { gx, gy }; const nodeMap = new Map<string, RoadNode>();
  const gatesByOwner = new Map<string, RoadNode[]>();
  const terrainCache = new Map<string, { fields: ReturnType<typeof fieldsAt>; waterBody: string }>(); const tileCache = new Map<string, ReturnType<typeof tileAtConfig>>();
  for (const region of regions) for (const settlement of region.settlements) {
    const endpoints = [...settlement.accessPoints].sort((a, b) => a.id.localeCompare(b.id));
    const gateNodes = endpoints.map((endpoint) => ({ id: endpoint.id, ownerId: settlement.id, x: endpoint.x, y: endpoint.y, kind: endpoint.kind, importance: endpoint.importance } satisfies RoadNode));
    if (gateNodes.length) { nodeMap.set(gateNodes[0].id, gateNodes[0]); gatesByOwner.set(settlement.id, gateNodes); }
  }
  for (const side of ['north', 'east', 'south', 'west'] as const) { const node = portalNode(config, gx, gy, side); nodeMap.set(node.id, node); }
  const cellSize = ROAD_GRAPH_REGION_SIZE * REGION_SIZE_TILES; const center = { x: gx * cellSize + (cellSize - 1) / 2, y: gy * cellSize + (cellSize - 1) / 2 };
  const portals = [...nodeMap.values()].filter((node) => node.kind === 'region-border').sort((a, b) => a.id.localeCompare(b.id));
  const settlements = [...nodeMap.values()].filter((node) => node.kind === 'settlement-gate').sort((a, b) => b.importance - a.importance || distance(a, center) - distance(b, center) || a.id.localeCompare(b.id));
  const nodes = [...portals, ...settlements];
  const planned: Array<{ from: RoadNode; to: RoadNode }> = [];
  const spine: RoadNode[] = [];
  if (portals.length) {
    let first = portals[0]; let last = portals[0]; let best = -1;
    for (const from of portals) for (const to of portals) if (from.id < to.id) { const score = distance(from, to); if (score > best) { first = from; last = to; best = score; } }
    spine.push(first, last);
  }
  for (const settlement of settlements) {
    let insertion = 0; let best = Infinity;
    for (let index = 0; index < spine.length - 1; index++) {
      const score = distance(spine[index], settlement) + distance(settlement, spine[index + 1]) - distance(spine[index], spine[index + 1]);
      if (score < best || (score === best && `${spine[index].id}|${spine[index + 1].id}`.localeCompare(`${spine[insertion].id}|${spine[insertion + 1].id}`) < 0)) { insertion = index; best = score; }
    }
    spine.splice(insertion + 1, 0, settlement);
  }
  for (let index = 0; index + 1 < spine.length; index++) planned.push({ from: spine[index], to: spine[index + 1] });
  const spineIds = new Set(spine.map((node) => node.id));
  for (const portal of portals) if (!spineIds.has(portal.id)) {
    const target = [...spine].sort((a, b) => distance(portal, a) - distance(portal, b) || a.id.localeCompare(b.id))[0];
    if (target) planned.push({ from: portal, to: target });
  }
  const physicalPlanned = assignPhysicalGates(config, planned, gatesByOwner);
  const claimedCoarse = new Set<string>(); const segments: RoadSegment[] = [];
  for (const edge of physicalPlanned) {
    const path = routeWithGuarantee(config, edge.from, edge.to, cell, claimedCoarse, terrainCache, tileCache);
    const parentId = `${config.seed}:v${config.version}:road:${edge.from.id}|${edge.to.id}`;
    segments.push(...splitSegment(parentId, edge.from, edge.to, path, config));
    for (const point of path) claimedCoarse.add(key(Math.floor(point.x / COARSE_CELL_SIZE), Math.floor(point.y / COARSE_CELL_SIZE)));
  }
  return { nodes, segments: segments.sort((a, b) => a.id.localeCompare(b.id)) };
}

export function generateRoadNetwork(config: WorldConfig, rx: number, ry: number, regions: RegionData[]): RoadNetwork {
  const cell = graphCell(rx, ry); const generated = generateRoadCell(config, regions, cell.gx, cell.gy);
  return { key: { rx, ry }, nodes: generated.nodes, segments: generated.segments.filter((segment) => segment.ownerRegion.rx === rx && segment.ownerRegion.ry === ry) };
}

export function roadSegmentIntersectsBounds(segment: RoadSegment, bounds: { minX: number; minY: number; maxX: number; maxY: number }) { return segment.tiles.some((tile) => tile.x >= bounds.minX && tile.x <= bounds.maxX && tile.y >= bounds.minY && tile.y <= bounds.maxY); }
