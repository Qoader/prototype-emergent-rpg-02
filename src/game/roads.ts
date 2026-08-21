import { fieldsAt } from './fields';
import type { RegionData, RoadEndpoint } from './regions';
import { REGION_SIZE_TILES } from './regions';
import { random, tileAtConfig, worldToRegion, type RegionCoordinate, type WorldConfig, type WorldCoordinate } from './world';
import type { WorldPoint } from './settlements';

export const ROAD_NETWORK_VERSION = 1;
export const ROAD_GRAPH_REGION_SIZE = 4;
const COARSE_CELL_SIZE = 8;
const MAX_NEIGHBORS = 3;

export type RoadImportance = 'trail' | 'road' | 'highway';
export interface RoadNode { id: string; ownerId: string; x: number; y: number; kind: RoadEndpoint['kind']; importance: number; }
export interface Bridge { id: string; roadId: string; tiles: WorldCoordinate[]; points: WorldPoint[]; width: number; }
export interface RoadSegment { id: string; parentId: string; ownerRegion: RegionCoordinate; from: RoadNode; to: RoadNode; importance: RoadImportance; width: number; tiles: WorldCoordinate[]; points: WorldPoint[]; bridges: Bridge[]; }
export interface RoadNetwork { key: RegionCoordinate; nodes: RoadNode[]; segments: RoadSegment[]; }

function regionKey(region: RegionCoordinate) { return `${region.rx},${region.ry}`; }
function graphCell(rx: number, ry: number) { return { gx: Math.floor(rx / ROAD_GRAPH_REGION_SIZE), gy: Math.floor(ry / ROAD_GRAPH_REGION_SIZE) }; }
export function roadGraphCell(rx: number, ry: number) { return graphCell(rx, ry); }
function distance(a: WorldCoordinate, b: WorldCoordinate) { return Math.hypot(a.x - b.x, a.y - b.y); }
function stablePath(path: WorldCoordinate[]) { return path.filter((point, index) => index === 0 || point.x !== path[index - 1].x || point.y !== path[index - 1].y); }

function candidateEdges(nodes: RoadNode[]) {
  const edges: Array<{ a: RoadNode; b: RoadNode; distance: number }> = [];
  for (const node of nodes) {
    nodes.filter((other) => other.id !== node.id && other.ownerId !== node.ownerId).map((other) => ({ a: node, b: other, distance: distance(node, other) })).sort((a, b) => a.distance - b.distance || a.b.id.localeCompare(b.b.id)).slice(0, MAX_NEIGHBORS).forEach((edge) => edges.push(edge));
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

function coarseRoute(config: WorldConfig, from: RoadNode, to: RoadNode, cell: { gx: number; gy: number }) {
  const start = { x: Math.floor(from.x / COARSE_CELL_SIZE), y: Math.floor(from.y / COARSE_CELL_SIZE) }; const target = { x: Math.floor(to.x / COARSE_CELL_SIZE), y: Math.floor(to.y / COARSE_CELL_SIZE) };
  const margin = 6; const minX = Math.min(start.x, target.x) - margin; const maxX = Math.max(start.x, target.x) + margin; const minY = Math.min(start.y, target.y) - margin; const maxY = Math.max(start.y, target.y) + margin;
  const key = (x: number, y: number) => `${x},${y}`; const frontier = [{ ...start, score: 0 }]; const cost = new Map([[key(start.x, start.y), 0]]); const came = new Map<string, string | null>([[key(start.x, start.y), null]]);
  let expandedNodes = 0; while (frontier.length && expandedNodes++ < 500) {
    frontier.sort((a, b) => a.score - b.score || key(a.x, a.y).localeCompare(key(b.x, b.y))); const current = frontier.shift()!; if (current.x === target.x && current.y === target.y) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = current.x + dx; const y = current.y + dy; if (x < minX || x > maxX || y < minY || y > maxY) continue;
      const wx = x * COARSE_CELL_SIZE + Math.floor(COARSE_CELL_SIZE / 2); const wy = y * COARSE_CELL_SIZE + Math.floor(COARSE_CELL_SIZE / 2); const fields = fieldsAt(config, wx, wy);
      if (fields.elevation < 0.24 || fields.slope > 0.24) continue;
      const terrain = tileAtConfig(config, wx, wy).terrain; if (terrain === 'deep-water' || terrain === 'shallow-water' || terrain === 'mountain') continue;
      const nextKey = key(x, y); const nextCost = (cost.get(key(current.x, current.y)) ?? Infinity) + 1 + fields.slope * 10 + fields.roughness * 1.8 + random(config, 'road:cost-noise', cell.gx, cell.gy, x, y) * 0.08;
      if (nextCost < (cost.get(nextKey) ?? Infinity)) { cost.set(nextKey, nextCost); came.set(nextKey, key(current.x, current.y)); frontier.push({ x, y, score: nextCost + Math.abs(x - target.x) + Math.abs(y - target.y) }); }
    }
  }
  const result: WorldCoordinate[] = []; let cursor: string | null = key(target.x, target.y); if (!came.has(cursor)) return [];
  while (cursor) { const [x, y] = cursor.split(',').map(Number); result.unshift({ x: x * COARSE_CELL_SIZE + 4, y: y * COARSE_CELL_SIZE + 4 }); cursor = came.get(cursor) ?? null; }
  const expanded: WorldCoordinate[] = [from, ...result, to];
  const path: WorldCoordinate[] = [];
  for (let index = 0; index < expanded.length - 1; index++) { const a = expanded[index]; const b = expanded[index + 1]; const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)); for (let step = 0; step <= steps; step++) { const point = { x: Math.round(a.x + (b.x - a.x) * step / Math.max(1, steps)), y: Math.round(a.y + (b.y - a.y) * step / Math.max(1, steps)) }; const tile = tileAtConfig(config, point.x, point.y); if (!tile.walkable && tile.terrain !== 'river') return []; path.push(point); } }
  return stablePath(path);
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

export function generateRoadCell(config: WorldConfig, regions: RegionData[], gx: number, gy: number) {
  const cell = { gx, gy }; const nodeMap = new Map<string, RoadNode>(); for (const region of regions) for (const endpoint of region.roadEndpoints) nodeMap.set(endpoint.ownerId, { id: endpoint.id, ownerId: endpoint.ownerId, x: endpoint.x, y: endpoint.y, kind: endpoint.kind, importance: endpoint.importance });
  const center = { x: (cell.gx * ROAD_GRAPH_REGION_SIZE + 2) * REGION_SIZE_TILES, y: (cell.gy * ROAD_GRAPH_REGION_SIZE + 2) * REGION_SIZE_TILES }; const nodes = [...nodeMap.values()].sort((a, b) => distance(a, center) - distance(b, center) || b.importance - a.importance || a.id.localeCompare(b.id)).slice(0, 3).sort((a, b) => a.id.localeCompare(b.id)); const segments: RoadSegment[] = [];
  for (const edge of selectEdges(config, nodes, cell)) { const path = coarseRoute(config, edge.a, edge.b, cell); if (path.length < 2) continue; const parentId = `${config.seed}:v${config.version}:road:${edge.a.id}|${edge.b.id}`; segments.push(...splitSegment(parentId, edge.a, edge.b, path, config)); }
  return { nodes, segments: segments.sort((a, b) => a.id.localeCompare(b.id)) };
}

export function generateRoadNetwork(config: WorldConfig, rx: number, ry: number, regions: RegionData[]): RoadNetwork {
  const cell = graphCell(rx, ry); const generated = generateRoadCell(config, regions, cell.gx, cell.gy);
  return { key: { rx, ry }, nodes: generated.nodes, segments: generated.segments.filter((segment) => segment.ownerRegion.rx === rx && segment.ownerRegion.ry === ry) };
}

export function roadSegmentIntersectsBounds(segment: RoadSegment, bounds: { minX: number; minY: number; maxX: number; maxY: number }) { return segment.tiles.some((tile) => tile.x >= bounds.minX && tile.x <= bounds.maxX && tile.y >= bounds.minY && tile.y <= bounds.maxY); }
