import { fieldsAt, type GeographicFields } from './fields';
import { hydrologyAt, type Direction, type WaterBody } from './hydrology';
import { random, type WorldConfig, type WorldCoordinate } from './world';
import type { RegionBounds, SettlementShell } from './regions';

export type DistrictType = 'central' | 'market' | 'residential' | 'industrial' | 'religious' | 'agricultural' | 'rural-edge';
export type BuildingType = 'keep' | 'market' | 'house' | 'workshop' | 'warehouse' | 'shrine' | 'barn' | 'cottage' | 'farmhouse' | 'animal-pen';
export interface SettlementStreet { id: string; type: 'main' | 'secondary' | 'lane' | 'footpath'; tiles: WorldCoordinate[]; points: WorldPoint[]; width: number; }
export interface WorldPoint { x: number; y: number; }
export interface District { id: string; type: DistrictType; center: WorldCoordinate; radius: number; density: number; }
export interface Building { id: string; type: BuildingType; districtId: string; x: number; y: number; width: number; height: number; rotation: number; roadId: string | null; courtyard: boolean; }
export interface SettlementEdgeFeature { id: string; type: 'garden' | 'field' | 'farm' | 'cottage' | 'barn' | 'yard' | 'pen' | 'trail'; x: number; y: number; width: number; height: number; rotation: number; }
export interface CityGate { id: string; accessPointId: string; x: number; y: number; }
export interface CityFortification { intramuralTiles: WorldCoordinate[]; wallTiles: WorldCoordinate[]; wallPoints: WorldPoint[]; gates: CityGate[]; engineeredTiles: WorldCoordinate[]; }
export interface SettlementPlaza { id: string; kind: 'central' | 'peripheral'; tiles: WorldCoordinate[]; surface: 'dirt' | 'stone'; }
export interface SettlementLayout { settlementId: string; bounds: RegionBounds; streets: SettlementStreet[]; buildings: Building[]; districts: District[]; edgeFeatures: SettlementEdgeFeature[]; plazas: SettlementPlaza[]; fortification?: CityFortification; }

interface SearchNode { x: number; y: number; score: number; }
class SearchHeap {
  private values: SearchNode[] = [];
  get length() { return this.values.length; }
  push(value: SearchNode) { this.values.push(value); let index = this.values.length - 1; while (index > 0) { const parent = Math.floor((index - 1) / 2); if (this.compare(this.values[parent], value) <= 0) break; this.values[index] = this.values[parent]; index = parent; } this.values[index] = value; }
  pop() { if (!this.values.length) return undefined; const result = this.values[0]; const last = this.values.pop()!; if (this.values.length) { let index = 0; while (true) { const left = index * 2 + 1; if (left >= this.values.length) break; const right = left + 1; const child = right < this.values.length && this.compare(this.values[right], this.values[left]) < 0 ? right : left; if (this.compare(this.values[child], last) >= 0) break; this.values[index] = this.values[child]; index = child; } this.values[index] = last; } return result; }
  private compare(a: SearchNode, b: SearchNode) { return a.score - b.score || key(a.x, a.y).localeCompare(key(b.x, b.y)); }
}
const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;

function key(x: number, y: number) { return `${x},${y}`; }
function distance(a: WorldCoordinate, b: WorldCoordinate) { return Math.hypot(a.x - b.x, a.y - b.y); }
const settlementLandMemo = new Map<string, boolean>();
const settlementWaterMemo = new Map<string, WaterBody>();
const settlementFlowMemo = new Map<string, Map<string, Direction | null>>();
function memoKey(config: WorldConfig, x: number, y: number) { return `${config.seed}:v${config.version}:${x},${y}`; }
function settlementHydrology(config: WorldConfig, x: number, y: number, fields: GeographicFields) { const cacheKey = memoKey(config, x, y); const cached = settlementWaterMemo.get(cacheKey); if (cached) return cached; const flowKey = `${config.seed}:v${config.version}`; let flowCache = settlementFlowMemo.get(flowKey); if (!flowCache) { flowCache = new Map(); settlementFlowMemo.set(flowKey, flowCache); } const waterBody = hydrologyAt(config, x, y, fields, flowCache).waterBody; if (settlementWaterMemo.size >= 1_000_000) { settlementWaterMemo.clear(); settlementLandMemo.clear(); } settlementWaterMemo.set(cacheKey, waterBody); return waterBody; }
function buildableLand(config: WorldConfig, x: number, y: number) { const cacheKey = memoKey(config, x, y); const cached = settlementLandMemo.get(cacheKey); if (cached !== undefined) return cached; const fields = fieldsAt(config, x, y); const result = fields.elevation >= 0.28 && fields.elevation <= 0.76 && settlementHydrology(config, x, y, fields) === 'none'; settlementLandMemo.set(cacheKey, result); return result; }
function routeLand(config: WorldConfig, x: number, y: number, fields: GeographicFields) { if (config.version < 7) return fields.elevation >= 0.28 && fields.elevation <= 0.76 && fields.slope <= 0.14; return buildableLand(config, x, y); }
function boundsFor(shell: SettlementShell): RegionBounds { const fringe = shell.type === 'city' ? 34 : shell.type === 'town' ? 28 : shell.type === 'village' ? 22 : 15; const radius = shell.radius + fringe; return { minX: Math.floor(shell.x - radius), minY: Math.floor(shell.y - radius), maxX: Math.ceil(shell.x + radius), maxY: Math.ceil(shell.y + radius) }; }
export function settlementLayoutBounds(shell: SettlementShell) { return boundsFor(shell); }
function inBounds(point: WorldCoordinate, bounds: RegionBounds) { return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY; }
function stablePoints(points: WorldCoordinate[]) { return points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y); }

/** A deterministic, city-only router that never leaves eligible intramural land. */
function routeInsideCity(start: WorldCoordinate, target: WorldCoordinate, eligible: Set<string>, existing: Set<string>) {
  const startKey = key(start.x, start.y); const targetKey = key(target.x, target.y);
  if (!eligible.has(startKey) || !eligible.has(targetKey)) return [];
  const frontier = new SearchHeap(); const costs = new Map<string, number>([[startKey, 0]]); const cameFrom = new Map<string, string | null>([[startKey, null]]); frontier.push({ ...start, score: 0 });
  while (frontier.length) {
    const current = frontier.pop()!; const currentKey = key(current.x, current.y);
    if (currentKey === targetKey) break;
    for (const [dx, dy] of DIRECTIONS) {
      const next = { x: current.x + dx, y: current.y + dy }; const nextKey = key(next.x, next.y); if (!eligible.has(nextKey)) continue;
      const nextCost = (costs.get(currentKey) ?? Infinity) + (existing.has(nextKey) ? 0.2 : 1);
      if (nextCost < (costs.get(nextKey) ?? Infinity)) { costs.set(nextKey, nextCost); cameFrom.set(nextKey, currentKey); frontier.push({ ...next, score: nextCost + Math.abs(next.x - target.x) + Math.abs(next.y - target.y) }); }
    }
  }
  if (!cameFrom.has(targetKey)) return [];
  const path: WorldCoordinate[] = []; let cursor: string | null = targetKey;
  while (cursor) { const [x, y] = cursor.split(',').map(Number); path.unshift({ x, y }); cursor = cameFrom.get(cursor) ?? null; }
  return path;
}

function footprint(center: WorldCoordinate, size: number) { const tiles: WorldCoordinate[] = []; const offset = Math.floor(size / 2); for (let y = center.y - offset; y <= center.y + offset; y++) for (let x = center.x - offset; x <= center.x + offset; x++) tiles.push({ x, y }); return tiles; }
function centralPlaza(shell: SettlementShell): SettlementPlaza { const size = shell.type === 'city' ? 5 : shell.type === 'village' || shell.type === 'town' ? 3 : 1; return { id: `${shell.id}:plaza:central`, kind: 'central', tiles: footprint({ x: shell.x, y: shell.y }, size), surface: shell.type === 'town' || shell.type === 'city' ? 'stone' : 'dirt' }; }

function citySquaresFor(config: WorldConfig, shell: SettlementShell, eligible: Set<string>, fallbackEligible: Set<string>, wallKeys: Set<string>, gateKeys: Set<string>, reserved: Set<string>): SettlementPlaza[] {
  const result: SettlementPlaza[] = []; const occupied = new Set(reserved);
  for (let sector = 0; sector < 6; sector++) {
    const angle = Math.PI * 2 * sector / 6 + random(config, 'settlement:city-square-angle', shell.id, sector) * 0.5;
    const candidates: WorldCoordinate[] = [];
    for (const tileKey of eligible) { const [x, y] = tileKey.split(',').map(Number); const dx = x - shell.x; const dy = y - shell.y; const difference = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - angle), Math.cos(Math.atan2(dy, dx) - angle))); if (difference < Math.PI / 5 && distance({ x, y }, shell) > shell.radius * 0.12) candidates.push({ x, y }); }
    candidates.sort((a, b) => Math.abs(distance(a, shell) - shell.radius * 0.32) - Math.abs(distance(b, shell) - shell.radius * 0.32) || key(a.x, a.y).localeCompare(key(b.x, b.y)));
    const valid = (candidate: WorldCoordinate, source: Set<string>) => {
      for (let y = candidate.y - 1; y <= candidate.y + 1; y++) for (let x = candidate.x - 1; x <= candidate.x + 1; x++) { const tileKey = key(x, y); if (!source.has(tileKey) || wallKeys.has(tileKey) || gateKeys.has(tileKey) || occupied.has(tileKey)) return false; }
      return true;
    };
    const center = candidates.find((candidate) => valid(candidate, eligible)) ?? [...fallbackEligible].map((tileKey) => { const [x, y] = tileKey.split(',').map(Number); return { x, y }; }).sort((a, b) => key(a.x, a.y).localeCompare(key(b.x, b.y))).find((candidate) => valid(candidate, fallbackEligible));
    if (!center) continue;
    const tiles: WorldCoordinate[] = []; for (let y = center.y - 1; y <= center.y + 1; y++) for (let x = center.x - 1; x <= center.x + 1; x++) { tiles.push({ x, y }); occupied.add(key(x, y)); }
    result.push({ id: `${shell.id}:plaza:peripheral:${result.length}`, kind: 'peripheral', tiles, surface: random(config, 'settlement:city-square-surface', shell.id, sector) > 0.5 ? 'stone' : 'dirt' });
  }
  return result;
}

function route(config: WorldConfig, shell: SettlementShell, start: WorldCoordinate, target: WorldCoordinate, existing: Set<string>, fieldCache: Map<string, GeographicFields>, landCache: Map<string, boolean>, avoidWater: boolean) {
  const bounds = boundsFor(shell); const frontier = new SearchHeap(); frontier.push({ ...start, score: 0 }); const cost = new Map<string, number>([[key(start.x, start.y), 0]]); const cameFrom = new Map<string, string | null>([[key(start.x, start.y), null]]);
  const fieldsAtPoint = (x: number, y: number) => { const cacheKey = key(x, y); const cached = fieldCache.get(cacheKey); if (cached) return cached; const fields = fieldsAt(config, x, y); fieldCache.set(cacheKey, fields); return fields; };
  while (frontier.length) {
    const current = frontier.pop()!;
    if (current.x === target.x && current.y === target.y) break;
    for (const [dx, dy] of DIRECTIONS) {
      const x = current.x + dx; const y = current.y + dy; if (!inBounds({ x, y }, bounds)) continue;
      const fields = fieldsAtPoint(x, y); const terrainKey = key(x, y); let walkable = fields.elevation >= 0.28 && fields.elevation <= 0.76 && fields.slope <= 0.14; if (avoidWater) { walkable = landCache.get(terrainKey) ?? routeLand(config, x, y, fields); landCache.set(terrainKey, walkable); } if (!walkable) continue;
      const movementCost = fields.slope > 0.08 || fields.roughness > 0.65 ? 2.2 : 1; const nextKey = key(x, y); const nextCost = (cost.get(key(current.x, current.y)) ?? Infinity) + (existing.has(nextKey) ? 0.35 : movementCost) + (1 + Math.abs(x * 17 + y * 31) % 7) * 0.01;
      if (nextCost < (cost.get(nextKey) ?? Infinity)) { cost.set(nextKey, nextCost); cameFrom.set(nextKey, key(current.x, current.y)); frontier.push({ x, y, score: nextCost + Math.abs(x - target.x) + Math.abs(y - target.y) }); }
    }
  }
  const targetKey = key(target.x, target.y); if (!cameFrom.has(targetKey)) return [];
  const path: WorldCoordinate[] = []; let cursor: string | null = targetKey;
  while (cursor) { const [x, y] = cursor.split(',').map(Number); path.unshift({ x, y }); cursor = cameFrom.get(cursor) ?? null; }
  return path;
}

function routeWithoutWater(config: WorldConfig, shell: SettlementShell, start: WorldCoordinate, target: WorldCoordinate, existing: Set<string>, fieldCache: Map<string, GeographicFields>, landCache: Map<string, boolean>) {
  const candidate = route(config, shell, start, target, existing, fieldCache, landCache, false); if (config.version < 7 || candidate.every((point) => { const fields = fieldCache.get(key(point.x, point.y)) ?? fieldsAt(config, point.x, point.y); fieldCache.set(key(point.x, point.y), fields); return routeLand(config, point.x, point.y, fields); })) return candidate; return route(config, shell, start, target, existing, fieldCache, landCache, true);
}

function smoothPath(path: WorldCoordinate[]): WorldPoint[] { const points = stablePoints(path).map((point) => ({ x: point.x + 0.5, y: point.y + 0.5 })); if (points.length < 3) return points; const result: WorldPoint[] = [points[0]]; for (let index = 1; index < points.length - 1; index++) result.push({ x: points[index].x * 0.25 + points[index - 1].x * 0.375 + points[index + 1].x * 0.375, y: points[index].y * 0.25 + points[index - 1].y * 0.375 + points[index + 1].y * 0.375 }); result.push(points.at(-1)!); return result; }

function insidePolygon(point: WorldCoordinate, polygon: WorldPoint[]) { let inside = false; for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) { const a = polygon[index]; const b = polygon[previous]; if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside; } return inside; }

function ringPath(config: WorldConfig, shell: SettlementShell, start: WorldCoordinate, target: WorldCoordinate, radius: number, forbidden: Set<string>, fieldCache: Map<string, GeographicFields>, landCache: Map<string, boolean>, allowBadTerrain = false) {
  const bounds = boundsFor(shell); const frontier = new SearchHeap(); const startKey = key(start.x, start.y); const costs = new Map<string, number>([[startKey, 0]]); const cameFrom = new Map<string, string | null>([[startKey, null]]); frontier.push({ ...start, score: 0 });
  const getFields = (x: number, y: number) => { const value = key(x, y); const cached = fieldCache.get(value); if (cached) return cached; const fields = fieldsAt(config, x, y); fieldCache.set(value, fields); return fields; };
  while (frontier.length) { const current = frontier.pop()!; if (current.x === target.x && current.y === target.y) break;
    for (const [dx, dy] of DIRECTIONS) { const x = current.x + dx; const y = current.y + dy; if (!inBounds({ x, y }, bounds)) continue; const nextKey = key(x, y); if (forbidden.has(nextKey) && nextKey !== key(target.x, target.y)) continue; const fields = getFields(x, y); const land = landCache.get(nextKey) ?? routeLand(config, x, y, fields); landCache.set(nextKey, land); if (!land && !allowBadTerrain) continue; const radialPenalty = Math.abs(distance({ x, y }, shell) - radius) * 0.45; const terrainPenalty = land ? (fields.slope > 0.08 || fields.roughness > 0.65 ? 2 : 1) : 30; const nextCost = (costs.get(key(current.x, current.y)) ?? Infinity) + terrainPenalty + radialPenalty; if (nextCost < (costs.get(nextKey) ?? Infinity)) { costs.set(nextKey, nextCost); cameFrom.set(nextKey, key(current.x, current.y)); frontier.push({ x, y, score: nextCost + distance({ x, y }, target) }); } }
  }
  const targetKey = key(target.x, target.y); if (!cameFrom.has(targetKey)) return []; const result: WorldCoordinate[] = []; let cursor: string | null = targetKey; while (cursor) { const [x, y] = cursor.split(',').map(Number); result.unshift({ x, y }); cursor = cameFrom.get(cursor) ?? null; } return result;
}

function fortificationFor(config: WorldConfig, shell: SettlementShell, streets: SettlementStreet[], fieldCache: Map<string, GeographicFields>, landCache: Map<string, boolean>): CityFortification | undefined {
  if (shell.type !== 'city') return undefined;
  const mainStreets = streets.filter((street) => street.type === 'main' && street.id !== `${shell.id}:main:center-market`); if (mainStreets.length < 4) return undefined;
  const center = { x: shell.x, y: shell.y }; const minimumRadius = Math.max(8, Math.floor(shell.radius * 0.35));
  for (let radius = Math.floor(shell.radius * 0.58); radius >= minimumRadius; radius--) {
    const gates: CityGate[] = []; const gateKeys = new Set<string>(); let valid = true;
    for (const street of mainStreets.slice().sort((a, b) => a.id.localeCompare(b.id))) { const candidates = street.tiles.filter((tile) => buildableLand(config, tile.x, tile.y)).sort((a, b) => Math.abs(distance(a, center) - radius) - Math.abs(distance(b, center) - radius) || key(a.x, a.y).localeCompare(key(b.x, b.y))); const tile = candidates[0]; if (!tile || gateKeys.has(key(tile.x, tile.y))) { valid = false; break; } const accessPointId = street.id; gates.push({ id: `${shell.id}:gate:${gates.length}`, accessPointId, x: tile.x, y: tile.y }); gateKeys.add(key(tile.x, tile.y)); }
    if (!valid) continue;
    const controls: WorldCoordinate[] = []; const gateByDirection = gates.slice().sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
    for (let index = 0; index < gateByDirection.length; index++) { const gate = gateByDirection[index]; controls.push(gate); const next = gateByDirection[(index + 1) % gateByDirection.length]; const angle = Math.atan2(next.y - center.y, next.x - center.x); const midpoint = angle + (index === gateByDirection.length - 1 ? Math.PI * 2 : 0); const wobble = (random(config, 'settlement:wall-wobble', shell.id, index) - 0.5) * 5; controls.push({ x: Math.round(center.x + Math.cos(midpoint - Math.PI / 4) * (radius + wobble)), y: Math.round(center.y + Math.sin(midpoint - Math.PI / 4) * (radius + wobble)) }); }
    const forbidden = new Set(streets.flatMap((street) => street.tiles.map((tile) => key(tile.x, tile.y)))); for (const gate of gates) forbidden.delete(key(gate.x, gate.y)); const wall: WorldCoordinate[] = [];
    for (let index = 0; index < controls.length; index++) { const start = controls[index]; const target = controls[(index + 1) % controls.length]; const path = ringPath(config, shell, start, target, radius, forbidden, fieldCache, landCache, radius === minimumRadius); if (path.length < 2) { valid = false; break; } for (const tile of path) if (!wall.some((other) => other.x === tile.x && other.y === tile.y)) wall.push(tile); }
    if (!valid) continue;
    const wallKeys = new Set(wall.map((tile) => key(tile.x, tile.y))); for (const gate of gates) wallKeys.delete(key(gate.x, gate.y)); const wallTiles = [...wallKeys].map((value) => { const [x, y] = value.split(',').map(Number); return { x, y }; }).sort((a, b) => key(a.x, a.y).localeCompare(key(b.x, b.y))); const wallPoints = stablePoints(wall.map((tile) => ({ x: tile.x + 0.5, y: tile.y + 0.5 })));
    const minX = Math.min(...wallTiles.map((tile) => tile.x), shell.x - radius); const maxX = Math.max(...wallTiles.map((tile) => tile.x), shell.x + radius); const minY = Math.min(...wallTiles.map((tile) => tile.y), shell.y - radius); const maxY = Math.max(...wallTiles.map((tile) => tile.y), shell.y + radius); const intramuralTiles: WorldCoordinate[] = [];
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if (!wallKeys.has(key(x, y)) && insidePolygon({ x: x + 0.5, y: y + 0.5 }, wallPoints)) intramuralTiles.push({ x, y });
    const engineeredTiles = wallTiles.filter((tile) => !buildableLand(config, tile.x, tile.y)); return { intramuralTiles, wallTiles, wallPoints, gates: gates.sort((a, b) => a.id.localeCompare(b.id)), engineeredTiles };
  }
  return undefined;
}

function districtSet(config: WorldConfig, shell: SettlementShell): District[] {
  const districts: District[] = [{ id: `${shell.id}:district:central`, type: 'central', center: { x: shell.x, y: shell.y }, radius: shell.radius * 0.45, density: 1 }];
  const market = shell.anchors.find((anchor) => anchor.type === 'market'); if (market) districts.push({ id: `${shell.id}:district:market`, type: 'market', center: market, radius: shell.radius * 0.4, density: 0.95 });
  if (shell.type !== 'hamlet') districts.push({ id: `${shell.id}:district:residential`, type: 'residential', center: { x: shell.x - Math.round(shell.radius * 0.35), y: shell.y + Math.round(shell.radius * 0.25) }, radius: shell.radius * 0.75, density: 0.72 });
  if (shell.type === 'town' || shell.type === 'city') districts.push({ id: `${shell.id}:district:industrial`, type: 'industrial', center: { x: shell.x + Math.round(shell.radius * 0.55), y: shell.y }, radius: shell.radius * 0.55, density: 0.6 });
  districts.push({ id: `${shell.id}:district:agricultural`, type: 'agricultural', center: { x: shell.x, y: shell.y + Math.round(shell.radius * 0.7) }, radius: shell.radius * 0.8, density: 0.35 });
  districts.push({ id: `${shell.id}:district:rural-edge`, type: 'rural-edge', center: { x: shell.x, y: shell.y }, radius: shell.radius * 1.3, density: 0.18 });
  if (random(config, 'settlement:religious', shell.id) > 0.45) districts.push({ id: `${shell.id}:district:religious`, type: 'religious', center: { x: shell.x - Math.round(shell.radius * 0.45), y: shell.y - Math.round(shell.radius * 0.45) }, radius: shell.radius * 0.35, density: 0.45 });
  return districts;
}

function nearestDistrict(districts: District[], point: WorldCoordinate) { return districts.slice().sort((a, b) => distance(a.center, point) - distance(b.center, point) || a.id.localeCompare(b.id))[0]; }
function buildingType(district: DistrictType, index: number): BuildingType { if (district === 'central') return index === 0 ? 'keep' : 'house'; if (district === 'market') return index % 3 === 0 ? 'market' : 'house'; if (district === 'industrial') return index % 2 ? 'workshop' : 'warehouse'; if (district === 'religious') return index === 0 ? 'shrine' : 'house'; if (district === 'agricultural') return index % 3 ? 'farmhouse' : 'barn'; if (district === 'rural-edge') return index % 3 ? 'cottage' : 'barn'; return 'house'; }
function overlaps(a: Building, b: Building) { return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + 1 && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + 1; }

export function generateSettlementLayout(config: WorldConfig, shell: SettlementShell): SettlementLayout {
  const bounds = boundsFor(shell); const districts = districtSet(config, shell); const plaza = centralPlaza(shell); const plazas: SettlementPlaza[] = [plaza]; const plazaKeys = new Set(plaza.tiles.map((tile) => key(tile.x, tile.y))); const streetTiles = new Set<string>(); const fieldCache = new Map<string, GeographicFields>(); const landCache = new Map<string, boolean>(); const streets: SettlementStreet[] = []; const connections = [{ id: `${shell.id}:main:center-market`, target: shell.anchors.find((anchor) => anchor.type === 'market') }, ...shell.accessPoints.map((endpoint) => ({ id: endpoint.id, target: endpoint }))].filter((connection) => connection.target).sort((a, b) => a.id.localeCompare(b.id));
  const center = { x: shell.x, y: shell.y };
  for (const connection of connections) { const target = connection.target!; const path = routeWithoutWater(config, shell, center, target, streetTiles, fieldCache, landCache); if (path.length < 2) continue; path.forEach((point) => streetTiles.add(key(point.x, point.y))); streets.push({ id: connection.id, type: 'main', tiles: path, points: smoothPath(path), width: shell.type === 'city' ? 3 : 2 }); }
  const fortification = fortificationFor(config, shell, streets, fieldCache, landCache); const intramuralKeys = new Set(fortification?.intramuralTiles.map((tile) => key(tile.x, tile.y)) ?? []); const wallKeys = new Set(fortification?.wallTiles.map((tile) => key(tile.x, tile.y)) ?? []); const gateKeys = new Set(fortification?.gates.map((gate) => key(gate.x, gate.y)) ?? []);
  const cityEligible = new Set([...intramuralKeys].filter((tileKey) => { const [x, y] = tileKey.split(',').map(Number); return buildableLand(config, x, y); }));
  for (const tileKey of plazaKeys) if (intramuralKeys.has(tileKey) && !wallKeys.has(tileKey) && !gateKeys.has(tileKey)) cityEligible.add(tileKey);
  const isDenseCity = config.version >= 9 && shell.type === 'city' && Boolean(fortification);
  if (isDenseCity) {
    const addCityStreet = (id: string, type: SettlementStreet['type'], base: WorldCoordinate, target: WorldCoordinate) => {
      const path = routeInsideCity(base, target, cityEligible, streetTiles); if (path.length < 2) return;
      path.forEach((tile) => streetTiles.add(key(tile.x, tile.y))); streets.push({ id, type, tiles: path, points: smoothPath(path), width: type === 'main' ? 3 : 1 });
    };
    const connected = () => [...streetTiles].map((tileKey) => { const [x, y] = tileKey.split(',').map(Number); return { x, y }; }).filter((tile) => cityEligible.has(key(tile.x, tile.y)));
    // Fan streets ensure every viable cardinal and corner sector is reached.
    for (let sector = 0; sector < 8; sector++) {
      const angle = Math.PI * 2 * sector / 8; const targets = [...cityEligible].map((tileKey) => { const [x, y] = tileKey.split(',').map(Number); return { x, y }; }).filter((tile) => Math.abs(Math.atan2(Math.sin(Math.atan2(tile.y - shell.y, tile.x - shell.x) - angle), Math.cos(Math.atan2(tile.y - shell.y, tile.x - shell.x) - angle))) < Math.PI / 8).sort((a, b) => distance(b, shell) - distance(a, shell) || key(a.x, a.y).localeCompare(key(b.x, b.y)));
      const bases = connected().sort((a, b) => distance(a, targets[0] ?? shell) - distance(b, targets[0] ?? shell) || key(a.x, a.y).localeCompare(key(b.x, b.y)));
      if (targets[0] && bases[0]) addCityStreet(`${shell.id}:fan:${sector}`, 'secondary', bases[0], targets[0]);
    }
    // Dense local lanes and cross-links, each deterministically connected to the growing network.
    for (let index = 0; index < 72; index++) {
      const allEligible = [...cityEligible].map((tileKey) => { const [x, y] = tileKey.split(',').map(Number); return { x, y }; }); const target = allEligible[Math.floor(random(config, 'settlement:city-lane-target', shell.id, index) * allEligible.length)]; const bases = connected().sort((a, b) => distance(a, target) - distance(b, target) || key(a.x, a.y).localeCompare(key(b.x, b.y)));
      if (target && bases[0]) addCityStreet(`${shell.id}:lane:${index}`, index % 4 === 0 ? 'secondary' : 'lane', bases[0], target);
    }
  } else {
    const budget = shell.type === 'city' ? 44 : shell.type === 'town' ? 16 : shell.type === 'village' ? 8 : 3; const mainTiles = [...streetTiles].map((value) => { const [x, y] = value.split(',').map(Number); return { x, y }; });
    for (let index = 0; index < budget; index++) { if (!mainTiles.length) break; const base = mainTiles[Math.floor(random(config, 'settlement:branch-base', shell.id, index) * mainTiles.length)]; const angle = random(config, 'settlement:branch-angle', shell.id, index) * Math.PI * 2; const length = 4 + Math.floor(random(config, 'settlement:branch-length', shell.id, index) * Math.max(4, shell.radius * 0.5)); const target = { x: Math.round(base.x + Math.cos(angle) * length), y: Math.round(base.y + Math.sin(angle) * length) }; if (!inBounds(target, bounds)) continue; const path = routeWithoutWater(config, shell, base, target, streetTiles, fieldCache, landCache); if (path.length < 3 || path.some((point) => wallKeys.has(key(point.x, point.y)) && !gateKeys.has(key(point.x, point.y)))) continue; path.forEach((point) => streetTiles.add(key(point.x, point.y))); streets.push({ id: `${shell.id}:secondary:${index}`, type: index % 3 === 0 ? 'lane' : 'secondary', tiles: path, points: smoothPath(path), width: 1 }); }
  }
  if (isDenseCity) {
    const peripheral = citySquaresFor(config, shell, cityEligible, intramuralKeys, wallKeys, gateKeys, plazaKeys);
    for (const square of peripheral) { plazas.push(square); for (const tile of square.tiles) { const tileKey = key(tile.x, tile.y); plazaKeys.add(tileKey); cityEligible.add(tileKey); } }
    const connected = () => [...streetTiles].map((tileKey) => { const [x, y] = tileKey.split(',').map(Number); return { x, y }; }).filter((tile) => cityEligible.has(key(tile.x, tile.y)));
    for (const square of peripheral) { const target = square.tiles[0]; const base = connected().sort((a, b) => distance(a, target) - distance(b, target) || key(a.x, a.y).localeCompare(key(b.x, b.y)))[0]; if (!base) continue; const path = routeInsideCity(base, target, cityEligible, streetTiles); if (path.length < 2) continue; path.forEach((tile) => streetTiles.add(key(tile.x, tile.y))); streets.push({ id: `${shell.id}:plaza-connector:${square.id}`, type: 'secondary', tiles: path, points: smoothPath(path), width: 1 }); }
  }
  const squareKeys = plazaKeys;
  const buildings: Building[] = []; const occupiedStreet = new Set(streetTiles); const buildingBudget = shell.type === 'city' ? 130 : shell.type === 'town' ? 42 : shell.type === 'village' ? 24 : 10;
  const required: Array<{ type: BuildingType; x: number; y: number; district: District }> = []; const market = shell.anchors.find((anchor) => anchor.type === 'market'); if (market) required.push({ type: 'market', x: market.x, y: market.y, district: districts.find((district) => district.type === 'market') ?? districts[0] });
  if (isDenseCity) {
    const reserved = new Set([...occupiedStreet, ...squareKeys, ...wallKeys, ...gateKeys]);
    for (const [index, item] of required.entries()) {
      const candidates = [...cityEligible].map((tileKey) => { const [x, y] = tileKey.split(',').map(Number); return { x, y }; }).filter((tile) => !reserved.has(key(tile.x, tile.y))).sort((a, b) => distance(a, item) - distance(b, item) || key(a.x, a.y).localeCompare(key(b.x, b.y)));
      const candidate = candidates[0]; if (!candidate) continue; reserved.add(key(candidate.x, candidate.y)); buildings.push({ id: `${shell.id}:building:anchor:${index}`, type: item.type, districtId: item.district.id, x: candidate.x, y: candidate.y, width: 1, height: 1, rotation: 0, roadId: null, courtyard: false });
    }
    for (const tileKey of [...cityEligible].sort()) if (!reserved.has(tileKey)) { const [x, y] = tileKey.split(',').map(Number); const district = nearestDistrict(districts, { x, y }); const building: Building = { id: `${shell.id}:building:house:${tileKey}`, type: 'house', districtId: district.id, x, y, width: 1, height: 1, rotation: 0, roadId: null, courtyard: false }; if (buildings.some((other) => overlaps(building, other))) continue; buildings.push(building); }
  } else {
    for (const [index, item] of required.entries()) if (buildableLand(config, item.x, item.y) && !plazaKeys.has(key(item.x, item.y))) buildings.push({ id: `${shell.id}:building:anchor:${index}`, type: item.type, districtId: item.district.id, x: item.x, y: item.y, width: 1, height: 1, rotation: 0, roadId: null, courtyard: false });
    const streetList = streets.flatMap((street) => street.tiles.map((tile, pointIndex) => ({ street, tile, pointIndex }))).sort((a, b) => `${a.street.id}:${a.pointIndex}`.localeCompare(`${b.street.id}:${b.pointIndex}`));
    for (let index = 0; index < streetList.length && buildings.length < buildingBudget; index++) { const sample = streetList[index]; const sampleInside = intramuralKeys.has(key(sample.tile.x, sample.tile.y)); if (sample.pointIndex % (sampleInside ? 1 : 3)) continue; const next = sample.street.tiles[Math.min(sample.pointIndex + 1, sample.street.tiles.length - 1)]; const dx = next.x - sample.tile.x; const dy = next.y - sample.tile.y; const length = Math.hypot(dx, dy) || 1; const side = random(config, 'settlement:building-side', shell.id, index) > 0.5 ? 1 : -1; const setback = sampleInside ? 1 + Math.floor(random(config, 'settlement:building-setback', shell.id, index) * 2) : 2 + Math.floor(random(config, 'settlement:building-setback', shell.id, index) * 3); const candidate = { x: Math.round(sample.tile.x - dy / length * side * setback), y: Math.round(sample.tile.y + dx / length * side * setback) }; const candidateInside = intramuralKeys.has(key(candidate.x, candidate.y)); const district = nearestDistrict(districts, candidate); const effectiveDistrict = candidateInside && (district.type === 'agricultural' || district.type === 'rural-edge') ? districts.find((item) => item.type === 'residential') ?? district : district; const building: Building = { id: `${shell.id}:building:${index}`, type: buildingType(effectiveDistrict.type, index), districtId: effectiveDistrict.id, x: candidate.x, y: candidate.y, width: 1, height: 1, rotation: 0, roadId: sample.street.id, courtyard: random(config, 'settlement:courtyard', shell.id, index) > 0.65 }; if (!buildableLand(config, candidate.x, candidate.y) || plazaKeys.has(key(candidate.x, candidate.y)) || occupiedStreet.has(key(candidate.x, candidate.y)) || wallKeys.has(key(candidate.x, candidate.y)) || distance(candidate, center) > shell.radius + 16 || buildings.some((other) => overlaps(building, other))) continue; buildings.push(building); }
  }
  const edgeFeatures: SettlementEdgeFeature[] = []; const edgeBudget = shell.type === 'city' ? 20 : shell.type === 'town' ? 14 : shell.type === 'village' ? 9 : 5;
  for (let index = 0; index < edgeBudget; index++) { const angle = random(config, 'settlement:edge-angle', shell.id, index) * Math.PI * 2; const radius = shell.radius + 5 + random(config, 'settlement:edge-radius', shell.id, index) * 14; const x = Math.round(shell.x + Math.cos(angle) * radius); const y = Math.round(shell.y + Math.sin(angle) * radius); if (!buildableLand(config, x, y) || (isDenseCity && intramuralKeys.has(key(x, y)))) continue; const type: SettlementEdgeFeature['type'] = index % 4 === 0 ? 'farm' : index % 3 === 0 ? 'barn' : index % 2 ? 'garden' : 'cottage'; edgeFeatures.push({ id: `${shell.id}:edge:${index}`, type, x, y, width: type === 'farm' ? 8 : 3, height: type === 'farm' ? 5 : 3, rotation: random(config, 'settlement:edge-rotation', shell.id, index) * Math.PI }); }
  return { settlementId: shell.id, bounds, streets: streets.sort((a, b) => a.id.localeCompare(b.id)), buildings: buildings.sort((a, b) => a.id.localeCompare(b.id)), districts: districts.sort((a, b) => a.id.localeCompare(b.id)), edgeFeatures: edgeFeatures.sort((a, b) => a.id.localeCompare(b.id)), plazas: plazas.sort((a, b) => a.id.localeCompare(b.id)), fortification };
}

export function layoutIntersectsBounds(layout: Pick<SettlementLayout, 'bounds'>, bounds: RegionBounds) { return layout.bounds.maxX >= bounds.minX && layout.bounds.minX <= bounds.maxX && layout.bounds.maxY >= bounds.minY && layout.bounds.minY <= bounds.maxY; }
