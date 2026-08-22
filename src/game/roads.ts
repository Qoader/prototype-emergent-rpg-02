import { fieldsAt } from './fields';
import { hydrologyAt } from './hydrology';
import type { RegionData, RoadEndpoint } from './regions';
import { REGION_SIZE_TILES } from './regions';
import { key, random, tileAtConfig, worldToRegion, type RegionCoordinate, type WorldConfig, type WorldCoordinate } from './world';
import type { WorldPoint } from './settlements';

export const ROAD_NETWORK_VERSION = 4;
export const ROAD_GRAPH_REGION_SIZE = 4;
const COARSE_CELL_SIZE = 16;
const MAX_NEIGHBORS = 4;

export type RoadImportance = 'trail' | 'road' | 'highway';
export interface RoadNode { id: string; ownerId: string; x: number; y: number; kind: RoadEndpoint['kind'] | 'junction' | 'player-start'; importance: number; }
export interface Bridge { id: string; roadId: string; tiles: WorldCoordinate[]; points: WorldPoint[]; width: number; }
export interface RoadSegment { id: string; parentId: string; ownerRegion: RegionCoordinate; from: RoadNode; to: RoadNode; importance: RoadImportance; width: number; tiles: WorldCoordinate[]; points: WorldPoint[]; bridges: Bridge[]; }
export interface RoadNetwork { key: RegionCoordinate; nodes: RoadNode[]; segments: RoadSegment[]; }

function regionKey(region: RegionCoordinate) { return `${region.rx},${region.ry}`; }
function graphCell(rx: number, ry: number) { return { gx: Math.floor(rx / ROAD_GRAPH_REGION_SIZE), gy: Math.floor(ry / ROAD_GRAPH_REGION_SIZE) }; }
export function roadGraphCell(rx: number, ry: number) { return graphCell(rx, ry); }
function distance(a: WorldCoordinate, b: WorldCoordinate) { return Math.hypot(a.x - b.x, a.y - b.y); }
function stablePath(path: WorldCoordinate[]) { return path.filter((point, index) => index === 0 || point.x !== path[index - 1].x || point.y !== path[index - 1].y); }
class RouteHeap {
  private values: Array<{ x: number; y: number; score: number }> = [];
  get length() { return this.values.length; }
  push(value: { x: number; y: number; score: number }) { this.values.push(value); let index = this.values.length - 1; while (index > 0) { const parent = Math.floor((index - 1) / 2); if (this.compare(this.values[parent], value) <= 0) break; this.values[index] = this.values[parent]; index = parent; } this.values[index] = value; }
  pop() { if (!this.values.length) return undefined; const result = this.values[0]; const last = this.values.pop()!; if (this.values.length) { let index = 0; while (true) { const left = index * 2 + 1; if (left >= this.values.length) break; const right = left + 1; const child = right < this.values.length && this.compare(this.values[right], this.values[left]) < 0 ? right : left; if (this.compare(this.values[child], last) >= 0) break; this.values[index] = this.values[child]; index = child; } this.values[index] = last; } return result; }
  private compare(a: { x: number; y: number; score: number }, b: { x: number; y: number; score: number }) { return a.score - b.score || `${a.x},${a.y}`.localeCompare(`${b.x},${b.y}`); }
}

function candidateEdges(nodes: RoadNode[]) {
  const edges: Array<{ a: RoadNode; b: RoadNode; distance: number }> = [];
  for (const node of nodes) {
    const limit = node.kind === 'region-border' ? 1 : MAX_NEIGHBORS;
    nodes.filter((other) => other.id !== node.id && other.ownerId !== node.ownerId).map((other) => ({ a: node, b: other, distance: distance(node, other) })).sort((a, b) => a.distance - b.distance || a.b.id.localeCompare(b.b.id)).slice(0, limit).forEach((edge) => edges.push(edge));
  }
  return [...new Map(edges.map((edge) => { const ids = [edge.a.id, edge.b.id].sort(); return [`${ids[0]}|${ids[1]}`, { ...edge, a: nodes.find((node) => node.id === ids[0])!, b: nodes.find((node) => node.id === ids[1])! }]; })).values()].sort((a, b) => a.distance - b.distance || `${a.a.id}|${a.b.id}`.localeCompare(`${b.a.id}|${b.b.id}`));
}

function selectEdges(config: WorldConfig, nodes: RoadNode[], cell: { gx: number; gy: number }) {
  const parent = new Map(nodes.map((node) => [node.id, node.id]));
  const root = (id: string): string => { const value = parent.get(id)!; if (value === id) return id; const result = root(value); parent.set(id, result); return result; };
  const selected: Array<{ a: RoadNode; b: RoadNode; distance: number }> = []; const candidates = candidateEdges(nodes);
  for (const edge of candidates) { const a = root(edge.a.id); const b = root(edge.b.id); if (a === b) continue; parent.set(a, b); selected.push(edge); }
  const selectedIds = new Set(selected.map((edge) => [edge.a.id, edge.b.id].sort().join('|')));
  for (const edge of candidates) { const id = [edge.a.id, edge.b.id].sort().join('|'); if (!selectedIds.has(id) && random(config, 'road:loop', cell.gx, cell.gy, edge.a.id, edge.b.id) < 0.16) { selected.push(edge); selectedIds.add(id); } }
  return selected;
}

function coarseRoute(config: WorldConfig, from: RoadNode, to: RoadNode, cell: { gx: number; gy: number }, claimedRoadTiles: Set<string>, terrainCache: Map<string, { fields: ReturnType<typeof fieldsAt>; waterBody: string }>, tileCache: Map<string, ReturnType<typeof tileAtConfig>>) {
  const start = { x: Math.floor(from.x / COARSE_CELL_SIZE), y: Math.floor(from.y / COARSE_CELL_SIZE) }; const target = { x: Math.floor(to.x / COARSE_CELL_SIZE), y: Math.floor(to.y / COARSE_CELL_SIZE) };
  const margin = 6; const minX = Math.min(start.x, target.x) - margin; const maxX = Math.max(start.x, target.x) + margin; const minY = Math.min(start.y, target.y) - margin; const maxY = Math.max(start.y, target.y) + margin;
  const key = (x: number, y: number) => `${x},${y}`; const frontier = new RouteHeap(); frontier.push({ ...start, score: 0 }); const cost = new Map([[key(start.x, start.y), 0]]); const came = new Map<string, string | null>([[key(start.x, start.y), null]]);
  const span = Math.max(maxX - minX + 1, maxY - minY + 1);
  // Keep cold generation bounded. Long routes are retried through the
  // neighbouring settlement/portal candidates rather than monopolising the
  // worker on a single blocked search.
  const expansionBudget = Math.min(2400, Math.max(360, Math.ceil(span * span * 0.08)));
  let expandedNodes = 0; while (frontier.length && expandedNodes++ < expansionBudget) {
    const current = frontier.pop()!; if (current.x === target.x && current.y === target.y) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = current.x + dx; const y = current.y + dy; if (x < minX || x > maxX || y < minY || y > maxY) continue;
      const wx = x * COARSE_CELL_SIZE + Math.floor(COARSE_CELL_SIZE / 2); const wy = y * COARSE_CELL_SIZE + Math.floor(COARSE_CELL_SIZE / 2); const terrainKey = `${wx},${wy}`; let sample = terrainCache.get(terrainKey);
      if (!sample) { const fields = fieldsAt(config, wx, wy); sample = { fields, waterBody: hydrologyAt(config, wx, wy, fields).waterBody }; terrainCache.set(terrainKey, sample); }
      const fields = sample.fields;
      if (fields.elevation < 0.24 || fields.slope > 0.24) continue;
      if (sample.waterBody === 'ocean' || sample.waterBody === 'lake' || fields.elevation > 0.76 || fields.slope > 0.14) continue;
      const nextKey = key(x, y); const roadPreference = claimedRoadTiles.has(nextKey) ? 0.2 : 1; const nextCost = (cost.get(key(current.x, current.y)) ?? Infinity) + roadPreference + fields.slope * 10 + fields.roughness * 1.8 + random(config, 'road:cost-noise', cell.gx, cell.gy, x, y) * 0.08;
      if (nextCost < (cost.get(nextKey) ?? Infinity)) { cost.set(nextKey, nextCost); came.set(nextKey, key(current.x, current.y)); frontier.push({ x, y, score: nextCost + Math.abs(x - target.x) + Math.abs(y - target.y) }); }
    }
  }
  const result: WorldCoordinate[] = []; let cursor: string | null = key(target.x, target.y); if (!came.has(cursor)) return [];
  while (cursor) { const [x, y] = cursor.split(',').map(Number); result.unshift({ x: x * COARSE_CELL_SIZE + 4, y: y * COARSE_CELL_SIZE + 4 }); cursor = came.get(cursor) ?? null; }
  const expanded: WorldCoordinate[] = [from, ...result, to];
  const validTile = (point: WorldCoordinate) => { const tileKey = `${point.x},${point.y}`; let tile = tileCache.get(tileKey); if (!tile) { tile = tileAtConfig(config, point.x, point.y); tileCache.set(tileKey, tile); } return tile.walkable || tile.terrain === 'river'; };
  const path: WorldCoordinate[] = [];
  for (let index = 0; index < expanded.length - 1; index++) { const a = expanded[index]; const b = expanded[index + 1]; const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)); for (let step = 0; step <= steps; step++) { const point = { x: Math.round(a.x + (b.x - a.x) * step / Math.max(1, steps)), y: Math.round(a.y + (b.y - a.y) * step / Math.max(1, steps)) }; if (!validTile(point)) return []; path.push(point); } }
  return stablePath(path);
}

function starterTileRoute(config: WorldConfig, from: RoadNode, to: RoadNode) {
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
      const tile = getTile(x, y); if (!tile.walkable && tile.terrain !== 'river') continue;
      const nextKey = key(x, y); const step = (dx && dy ? Math.SQRT2 : 1) * (tile.terrain === 'river' ? 1.5 : Math.max(1, tile.movementCost)); const nextCost = (cost.get(currentKey) ?? Infinity) + step;
      if (nextCost < (cost.get(nextKey) ?? Infinity)) { cost.set(nextKey, nextCost); came.set(nextKey, currentKey); frontier.push({ x, y, score: nextCost + heuristic(x, y) }); }
    }
  }
  if (!came.has(targetKey)) return [];
  const result: WorldCoordinate[] = []; let cursor: string | null = targetKey; while (cursor) { const [x, y] = cursor.split(',').map(Number); result.unshift({ x, y }); cursor = came.get(cursor) ?? null; }
  return result;
}

function importance(a: RoadNode, b: RoadNode): RoadImportance { const value = Math.max(a.importance, b.importance); return value > 0.78 ? 'highway' : value > 0.5 ? 'road' : 'trail'; }
function widthFor(value: RoadImportance) { return value === 'highway' ? 4 : value === 'road' ? 2.5 : 1.4; }
function bridgeGroups(config: WorldConfig, path: WorldCoordinate[], roadId: string, width: number): Bridge[] { const bridges: Bridge[] = []; let current: WorldCoordinate[] = []; const flush = () => { if (!current.length) return; bridges.push({ id: `${roadId}:bridge:${bridges.length}`, roadId, tiles: current, points: current.map((tile) => ({ x: tile.x + 0.5, y: tile.y + 0.5 })), width }); current = []; }; for (const tile of path) { if (tileAtConfig(config, tile.x, tile.y).terrain === 'river') current.push(tile); else flush(); } flush(); return bridges; }
function smooth(path: WorldCoordinate[]) { return path.map((point, index) => ({ x: point.x + 0.5 + (index > 0 && index < path.length - 1 ? 0.08 * Math.sin(index * 2.3) : 0), y: point.y + 0.5 + (index > 0 && index < path.length - 1 ? 0.08 * Math.cos(index * 1.7) : 0) })); }

function splitSegment(parentId: string, from: RoadNode, to: RoadNode, path: WorldCoordinate[], config: WorldConfig): RoadSegment[] {
  const pieces: RoadSegment[] = []; let currentRegion: RegionCoordinate | null = null; let current: WorldCoordinate[] = [];
  const flush = () => { if (!currentRegion || current.length < 2) return; const kind = importance(from, to); const id = `${parentId}:piece:${regionKey(currentRegion)}`; pieces.push({ id, parentId, ownerRegion: currentRegion, from, to, importance: kind, width: widthFor(kind), tiles: current, points: smooth(current), bridges: bridgeGroups(config, current, id, widthFor(kind)) }); };
  for (const point of path) { const region = worldToRegion(point.x, point.y); if (!currentRegion || region.rx !== currentRegion.rx || region.ry !== currentRegion.ry) { flush(); currentRegion = region; current = current.length ? [current.at(-1)!, point] : [point]; } else current.push(point); }
  flush(); return pieces;
}

/** Builds the deterministic route from the player spawn to the nearest
 * settlement gate represented by the supplied regions. */
export function generateStarterRoad(config: WorldConfig, startPoint: WorldCoordinate, regions: RegionData[]): RoadSegment[] {
  const candidates = regions.flatMap((region) => region.settlements.flatMap((settlement) => settlement.accessPoints.map((gate) => ({ settlement, gate }))));
  candidates.sort((a, b) => distance(startPoint, a.settlement) - distance(startPoint, b.settlement) || a.settlement.id.localeCompare(b.settlement.id) || distance(startPoint, a.gate) - distance(startPoint, b.gate) || a.gate.id.localeCompare(b.gate.id));
  const terrainCache = new Map<string, { fields: ReturnType<typeof fieldsAt>; waterBody: string }>();
  const tileCache = new Map<string, ReturnType<typeof tileAtConfig>>();
  const source: RoadNode = { id: `${config.seed}:v${config.version}:player-start:${startPoint.x},${startPoint.y}`, ownerId: `${config.seed}:v${config.version}:player-start`, x: startPoint.x, y: startPoint.y, kind: 'player-start', importance: 0.72 };
  const cell = roadGraphCell(worldToRegion(startPoint.x, startPoint.y).rx, worldToRegion(startPoint.x, startPoint.y).ry);
  for (const candidate of candidates) {
    const gatePoint = (() => {
      const direct = tileAtConfig(config, candidate.gate.x, candidate.gate.y);
      if (direct.walkable || direct.terrain === 'river') return { x: candidate.gate.x, y: candidate.gate.y };
      const nearby: WorldCoordinate[] = [];
      for (let radius = 1; radius <= 6; radius++) for (let y = candidate.gate.y - radius; y <= candidate.gate.y + radius; y++) for (let x = candidate.gate.x - radius; x <= candidate.gate.x + radius; x++) {
        if (Math.max(Math.abs(x - candidate.gate.x), Math.abs(y - candidate.gate.y)) !== radius) continue;
        const tile = tileAtConfig(config, x, y); if (tile.walkable || tile.terrain === 'river') nearby.push({ x, y });
      }
      nearby.sort((a, b) => distance(a, candidate.gate) - distance(b, candidate.gate) || a.y - b.y || a.x - b.x);
      return nearby[0];
    })();
    if (!gatePoint) continue;
    const gate: RoadNode = { id: candidate.gate.id, ownerId: candidate.settlement.id, x: gatePoint.x, y: gatePoint.y, kind: 'settlement-gate', importance: candidate.gate.importance };
    const coarse = coarseRoute(config, source, gate, cell, new Set(), terrainCache, tileCache);
    const path = coarse.length > 1 ? coarse : starterTileRoute(config, source, gate);
    if (path.length < 2) continue;
    const parentId = `${config.seed}:v${config.version}:starter-road:${source.x},${source.y}:${candidate.settlement.id}`;
    return splitSegment(parentId, source, gate, path, config).sort((a, b) => a.id.localeCompare(b.id));
  }
  return [];
}

export function generateRoadCell(config: WorldConfig, regions: RegionData[], gx: number, gy: number) {
  const cell = { gx, gy }; const nodeMap = new Map<string, RoadNode>(); const terrainCache = new Map<string, { fields: ReturnType<typeof fieldsAt>; waterBody: string }>(); const tileCache = new Map<string, ReturnType<typeof tileAtConfig>>();
  // Settlements are the backbone graph. Landmarks and resources remain
  // optional future spurs and must not multiply the expensive long routes.
  for (const region of regions) for (const settlement of region.settlements) {
    const endpoint = [...settlement.accessPoints].sort((a, b) => a.id.localeCompare(b.id))[0];
    if (endpoint) nodeMap.set(settlement.id, { id: endpoint.id, ownerId: settlement.id, x: endpoint.x, y: endpoint.y, kind: endpoint.kind, importance: endpoint.importance });
  }
  const cellSize = ROAD_GRAPH_REGION_SIZE * REGION_SIZE_TILES;
  const minX = gx * cellSize; const minY = gy * cellSize; const maxX = minX + cellSize - 1; const maxY = minY + cellSize - 1;
  const portal = (side: 'north' | 'east' | 'south' | 'west'): RoadNode => {
    const horizontal = side === 'north' || side === 'south';
    const edgeX = horizontal ? gx : side === 'east' ? gx + 1 : gx;
    const edgeY = horizontal ? side === 'south' ? gy + 1 : gy : gy;
    const axis = horizontal ? 'h' : 'v';
    const offset = 16 + Math.floor(random(config, 'road:portal-offset', axis, edgeX, edgeY) * Math.max(1, cellSize - 32));
    const point = side === 'north' ? { x: minX + offset, y: minY } : side === 'east' ? { x: maxX, y: minY + offset } : side === 'south' ? { x: minX + offset, y: maxY } : { x: minX, y: minY + offset };
    const id = `${config.seed}:v${config.version}:road-portal:${axis}:${edgeX},${edgeY}`;
    return { id, ownerId: id, x: point.x, y: point.y, kind: 'region-border', importance: 0.72 };
  };
  // Portals are part of the settlement backbone only when this cell contains
  // a settlement. Resource/landmark-only cells stay cheap and do not create
  // long exploratory corridors with no settlement to serve.
  if ([...nodeMap.values()].some((node) => node.kind === 'settlement-gate')) {
    // Keep only portals that are near a settlement in this cell. This avoids
    // spending the cold-generation budget routing four empty wilderness
    // corridors while still providing deterministic cross-cell anchors where
    // the settlement network can actually reach them.
    const sides = (['north', 'east', 'south', 'west'] as const).map((side) => portal(side));
    for (const node of sides) if ([...nodeMap.values()].some((other) => other.kind === 'settlement-gate' && distance(node, other) < cellSize * 0.45)) nodeMap.set(node.id, node);
  }
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const settlementNodes = [...nodeMap.values()].filter((node) => node.kind === 'settlement-gate').sort((a, b) => distance(a, center) - distance(b, center) || b.importance - a.importance || a.id.localeCompare(b.id));
  const portalNodes = [...nodeMap.values()].filter((node) => node.kind === 'region-border');
  // Bound cold-plan work while retaining a deterministic cross-cell backbone.
  // Additional settlements are still present in RegionData and can be picked
  // up by a later denser plan tier without changing chunk ownership.
  const nodes = [...settlementNodes.slice(0, 6), ...portalNodes].sort((a, b) => a.id.localeCompare(b.id)); const segments: RoadSegment[] = []; const claimed = new Map<string, RoadNode>();
  const junctionFor = (point: WorldCoordinate, importanceValue: number) => { const id = `${config.seed}:v${config.version}:road-junction:${cell.gx},${cell.gy}:${point.x},${point.y}`; const existing = claimed.get(key(point.x, point.y)); if (existing?.kind === 'junction') return existing; const node: RoadNode = { id, ownerId: id, x: point.x, y: point.y, kind: 'junction', importance: Math.max(importanceValue, existing?.importance ?? 0) }; claimed.set(key(point.x, point.y), node); return node; };
  for (const edge of selectEdges(config, nodes, cell).sort((a, b) => `${a.a.id}|${a.b.id}`.localeCompare(`${b.a.id}|${b.b.id}`))) {
    const claimedCoarse = new Set([...claimed.keys()].map((value) => { const [x, y] = value.split(',').map(Number); return key(Math.floor(x / COARSE_CELL_SIZE), Math.floor(y / COARSE_CELL_SIZE)); }));
    const path = coarseRoute(config, edge.a, edge.b, cell, claimedCoarse, terrainCache, tileCache); if (path.length < 2) continue;
    const parentId = `${config.seed}:v${config.version}:road:${edge.a.id}|${edge.b.id}`; let destination = edge.b; let emitted = path;
    for (let index = 1; index < path.length; index++) { const existing = claimed.get(key(path[index].x, path[index].y)); if (!existing) continue; destination = index === path.length - 1 && path[index].x === edge.b.x && path[index].y === edge.b.y ? edge.b : junctionFor(path[index], Math.max(edge.a.importance, edge.b.importance)); emitted = path.slice(0, index + 1); break; }
    if (emitted.length < 2) continue;
    for (let index = 0; index < emitted.length; index++) { const point = emitted[index]; if (!claimed.has(key(point.x, point.y))) claimed.set(key(point.x, point.y), index === emitted.length - 1 && point.x === destination.x && point.y === destination.y ? destination : edge.a); }
    segments.push(...splitSegment(parentId, edge.a, destination, emitted, config));
  }
  return { nodes, segments: segments.sort((a, b) => a.id.localeCompare(b.id)) };
}

export function generateRoadNetwork(config: WorldConfig, rx: number, ry: number, regions: RegionData[]): RoadNetwork {
  const cell = graphCell(rx, ry); const generated = generateRoadCell(config, regions, cell.gx, cell.gy);
  return { key: { rx, ry }, nodes: generated.nodes, segments: generated.segments.filter((segment) => segment.ownerRegion.rx === rx && segment.ownerRegion.ry === ry) };
}

export function roadSegmentIntersectsBounds(segment: RoadSegment, bounds: { minX: number; minY: number; maxX: number; maxY: number }) { return segment.tiles.some((tile) => tile.x >= bounds.minX && tile.x <= bounds.maxX && tile.y >= bounds.minY && tile.y <= bounds.maxY); }
