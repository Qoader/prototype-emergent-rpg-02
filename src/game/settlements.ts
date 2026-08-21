import { fieldsAt, type GeographicFields } from './fields';
import { hydrologyAt } from './hydrology';
import { random, type WorldConfig, type WorldCoordinate } from './world';
import type { RegionBounds, SettlementShell } from './regions';

export type DistrictType = 'central' | 'market' | 'residential' | 'industrial' | 'religious' | 'agricultural' | 'rural-edge';
export type BuildingType = 'keep' | 'market' | 'house' | 'workshop' | 'warehouse' | 'shrine' | 'barn' | 'cottage' | 'farmhouse' | 'animal-pen';
export interface SettlementStreet { id: string; type: 'main' | 'secondary' | 'lane' | 'footpath'; tiles: WorldCoordinate[]; points: WorldPoint[]; width: number; }
export interface WorldPoint { x: number; y: number; }
export interface District { id: string; type: DistrictType; center: WorldCoordinate; radius: number; density: number; }
export interface Building { id: string; type: BuildingType; districtId: string; x: number; y: number; width: number; height: number; rotation: number; roadId: string | null; courtyard: boolean; }
export interface SettlementEdgeFeature { id: string; type: 'garden' | 'field' | 'farm' | 'cottage' | 'barn' | 'yard' | 'pen' | 'trail'; x: number; y: number; width: number; height: number; rotation: number; }
export interface SettlementLayout { settlementId: string; bounds: RegionBounds; streets: SettlementStreet[]; buildings: Building[]; districts: District[]; edgeFeatures: SettlementEdgeFeature[]; }

interface SearchNode { x: number; y: number; score: number; }
const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;

function key(x: number, y: number) { return `${x},${y}`; }
function distance(a: WorldCoordinate, b: WorldCoordinate) { return Math.hypot(a.x - b.x, a.y - b.y); }
function buildableLand(config: WorldConfig, x: number, y: number) { const fields = fieldsAt(config, x, y); return fields.elevation >= 0.28 && fields.elevation <= 0.76 && fields.slope <= 0.14 && hydrologyAt(config, x, y).waterBody === 'none'; }
function boundsFor(shell: SettlementShell): RegionBounds { const fringe = shell.type === 'city' ? 34 : shell.type === 'town' ? 28 : shell.type === 'village' ? 22 : 15; const radius = shell.radius + fringe; return { minX: Math.floor(shell.x - radius), minY: Math.floor(shell.y - radius), maxX: Math.ceil(shell.x + radius), maxY: Math.ceil(shell.y + radius) }; }
function inBounds(point: WorldCoordinate, bounds: RegionBounds) { return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY; }
function stablePoints(points: WorldCoordinate[]) { return points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y); }

function route(config: WorldConfig, shell: SettlementShell, start: WorldCoordinate, target: WorldCoordinate, existing: Set<string>, fieldCache: Map<string, GeographicFields>) {
  const bounds = boundsFor(shell); const frontier: SearchNode[] = [{ ...start, score: 0 }]; const cost = new Map<string, number>([[key(start.x, start.y), 0]]); const cameFrom = new Map<string, string | null>([[key(start.x, start.y), null]]);
  const fieldsAtPoint = (x: number, y: number) => { const cacheKey = key(x, y); const cached = fieldCache.get(cacheKey); if (cached) return cached; const fields = fieldsAt(config, x, y); fieldCache.set(cacheKey, fields); return fields; };
  while (frontier.length) {
    frontier.sort((a, b) => a.score - b.score || key(a.x, a.y).localeCompare(key(b.x, b.y))); const current = frontier.shift()!;
    if (current.x === target.x && current.y === target.y) break;
    for (const [dx, dy] of DIRECTIONS) {
      const x = current.x + dx; const y = current.y + dy; if (!inBounds({ x, y }, bounds)) continue;
      const fields = fieldsAtPoint(x, y); const walkable = fields.elevation >= 0.28 && fields.elevation <= 0.76 && fields.slope <= 0.14; if (!walkable) continue;
      const movementCost = fields.slope > 0.08 || fields.roughness > 0.65 ? 2.2 : 1; const nextKey = key(x, y); const nextCost = (cost.get(key(current.x, current.y)) ?? Infinity) + (existing.has(nextKey) ? 0.35 : movementCost) + (1 + Math.abs(x * 17 + y * 31) % 7) * 0.01;
      if (nextCost < (cost.get(nextKey) ?? Infinity)) { cost.set(nextKey, nextCost); cameFrom.set(nextKey, key(current.x, current.y)); frontier.push({ x, y, score: nextCost + Math.abs(x - target.x) + Math.abs(y - target.y) }); }
    }
  }
  const targetKey = key(target.x, target.y); if (!cameFrom.has(targetKey)) return [];
  const path: WorldCoordinate[] = []; let cursor: string | null = targetKey;
  while (cursor) { const [x, y] = cursor.split(',').map(Number); path.unshift({ x, y }); cursor = cameFrom.get(cursor) ?? null; }
  return path;
}

function smoothPath(path: WorldCoordinate[]): WorldPoint[] { const points = stablePoints(path).map((point) => ({ x: point.x + 0.5, y: point.y + 0.5 })); if (points.length < 3) return points; const result: WorldPoint[] = [points[0]]; for (let index = 1; index < points.length - 1; index++) result.push({ x: points[index].x * 0.25 + points[index - 1].x * 0.375 + points[index + 1].x * 0.375, y: points[index].y * 0.25 + points[index - 1].y * 0.375 + points[index + 1].y * 0.375 }); result.push(points.at(-1)!); return result; }

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
  const bounds = boundsFor(shell); const districts = districtSet(config, shell); const streetTiles = new Set<string>(); const fieldCache = new Map<string, GeographicFields>(); const streets: SettlementStreet[] = []; const connections = [{ id: `${shell.id}:main:center-market`, target: shell.anchors.find((anchor) => anchor.type === 'market') }, ...shell.accessPoints.map((endpoint) => ({ id: endpoint.id, target: endpoint }))].filter((connection) => connection.target).sort((a, b) => a.id.localeCompare(b.id));
  const center = { x: shell.x, y: shell.y };
  for (const connection of connections) { const target = connection.target!; const path = route(config, shell, center, target, streetTiles, fieldCache); if (path.length < 2) continue; path.forEach((point) => streetTiles.add(key(point.x, point.y))); streets.push({ id: connection.id, type: 'main', tiles: path, points: smoothPath(path), width: shell.type === 'city' ? 3 : 2 }); }
  const budget = shell.type === 'city' ? 30 : shell.type === 'town' ? 16 : shell.type === 'village' ? 8 : 3; const mainTiles = [...streetTiles].map((value) => { const [x, y] = value.split(',').map(Number); return { x, y }; });
  for (let index = 0; index < budget; index++) { if (!mainTiles.length) break; const base = mainTiles[Math.floor(random(config, 'settlement:branch-base', shell.id, index) * mainTiles.length)]; const angle = random(config, 'settlement:branch-angle', shell.id, index) * Math.PI * 2; const length = 4 + Math.floor(random(config, 'settlement:branch-length', shell.id, index) * Math.max(4, shell.radius * 0.5)); const target = { x: Math.round(base.x + Math.cos(angle) * length), y: Math.round(base.y + Math.sin(angle) * length) }; if (!inBounds(target, bounds)) continue; const path = route(config, shell, base, target, streetTiles, fieldCache); if (path.length < 3) continue; path.forEach((point) => streetTiles.add(key(point.x, point.y))); streets.push({ id: `${shell.id}:secondary:${index}`, type: index % 3 === 0 ? 'lane' : 'secondary', tiles: path, points: smoothPath(path), width: 1 }); }
  const buildings: Building[] = []; const occupiedStreet = new Set(streetTiles); const buildingBudget = shell.type === 'city' ? 70 : shell.type === 'town' ? 42 : shell.type === 'village' ? 24 : 10;
  const required: Array<{ type: BuildingType; x: number; y: number; district: District }> = [{ type: shell.type === 'hamlet' || shell.type === 'village' ? 'house' : 'keep', x: shell.x, y: shell.y, district: districts[0] }]; const market = shell.anchors.find((anchor) => anchor.type === 'market'); if (market) required.push({ type: 'market', x: market.x, y: market.y, district: districts.find((district) => district.type === 'market') ?? districts[0] });
  for (const [index, item] of required.entries()) if (buildableLand(config, item.x, item.y)) buildings.push({ id: `${shell.id}:building:anchor:${index}`, type: item.type, districtId: item.district.id, x: item.x, y: item.y, width: 1, height: 1, rotation: 0, roadId: null, courtyard: false });
  const streetList = streets.flatMap((street) => street.tiles.map((tile, pointIndex) => ({ street, tile, pointIndex }))).sort((a, b) => `${a.street.id}:${a.pointIndex}`.localeCompare(`${b.street.id}:${b.pointIndex}`));
  for (let index = 0; index < streetList.length && buildings.length < buildingBudget; index++) { const sample = streetList[index]; if (sample.pointIndex % 2) continue; const next = sample.street.tiles[Math.min(sample.pointIndex + 1, sample.street.tiles.length - 1)]; const dx = next.x - sample.tile.x; const dy = next.y - sample.tile.y; const length = Math.hypot(dx, dy) || 1; const side = random(config, 'settlement:building-side', shell.id, index) > 0.5 ? 1 : -1; const setback = 2 + Math.floor(random(config, 'settlement:building-setback', shell.id, index) * 3); const candidate = { x: Math.round(sample.tile.x - dy / length * side * setback), y: Math.round(sample.tile.y + dx / length * side * setback) }; const district = nearestDistrict(districts, candidate); const building: Building = { id: `${shell.id}:building:${index}`, type: buildingType(district.type, index), districtId: district.id, x: candidate.x, y: candidate.y, width: 1, height: 1, rotation: 0, roadId: sample.street.id, courtyard: random(config, 'settlement:courtyard', shell.id, index) > 0.65 }; if (!buildableLand(config, candidate.x, candidate.y) || occupiedStreet.has(key(candidate.x, candidate.y)) || distance(candidate, center) > shell.radius + 16 || buildings.some((other) => overlaps(building, other))) continue; buildings.push(building); }
  const edgeFeatures: SettlementEdgeFeature[] = []; const edgeBudget = shell.type === 'city' ? 20 : shell.type === 'town' ? 14 : shell.type === 'village' ? 9 : 5;
  for (let index = 0; index < edgeBudget; index++) { const angle = random(config, 'settlement:edge-angle', shell.id, index) * Math.PI * 2; const radius = shell.radius + 5 + random(config, 'settlement:edge-radius', shell.id, index) * 14; const x = Math.round(shell.x + Math.cos(angle) * radius); const y = Math.round(shell.y + Math.sin(angle) * radius); if (!buildableLand(config, x, y)) continue; const type: SettlementEdgeFeature['type'] = index % 4 === 0 ? 'farm' : index % 3 === 0 ? 'barn' : index % 2 ? 'garden' : 'cottage'; edgeFeatures.push({ id: `${shell.id}:edge:${index}`, type, x, y, width: type === 'farm' ? 8 : 3, height: type === 'farm' ? 5 : 3, rotation: random(config, 'settlement:edge-rotation', shell.id, index) * Math.PI }); }
  return { settlementId: shell.id, bounds, streets: streets.sort((a, b) => a.id.localeCompare(b.id)), buildings: buildings.sort((a, b) => a.id.localeCompare(b.id)), districts: districts.sort((a, b) => a.id.localeCompare(b.id)), edgeFeatures: edgeFeatures.sort((a, b) => a.id.localeCompare(b.id)) };
}

export function layoutIntersectsBounds(layout: SettlementLayout, bounds: RegionBounds) { return layout.bounds.maxX >= bounds.minX && layout.bounds.minX <= bounds.maxX && layout.bounds.maxY >= bounds.minY && layout.bounds.minY <= bounds.maxY; }
