import { REGION_CHUNK_SIZE, random, worldToRegion, type WorldConfig, type WorldCoordinate } from './world';
import type { RegionBounds, SettlementShell } from './regions';
import type { RoadNode, RoadSegment } from './roads';
import type { Building, SettlementLayout, SettlementStreet } from './settlements';

const GUTTER = 1;
const MAX_ROADS = 16;
const MAX_BUILDINGS = 96;
const MAX_WALL_TILES = 128;
const inside = (point: WorldCoordinate, bounds: RegionBounds) => point.x >= bounds.minX - GUTTER && point.x <= bounds.maxX + GUTTER && point.y >= bounds.minY - GUTTER && point.y <= bounds.maxY + GUTTER;
const point = (x: number, y: number) => ({ x, y });

function line(from: WorldCoordinate, to: WorldCoordinate, bounds: RegionBounds, limit = 128) {
  const result: WorldCoordinate[] = []; let x = from.x; let y = from.y; const dx = Math.abs(to.x - x); const sx = x < to.x ? 1 : -1; const dy = -Math.abs(to.y - y); const sy = y < to.y ? 1 : -1; let error = dx + dy;
  while (result.length < limit) { if (inside({ x, y }, bounds)) result.push({ x, y }); if (x === to.x && y === to.y) break; const twice = error * 2; if (twice >= dy) { error += dy; x += sx; } if (twice <= dx) { error += dx; y += sy; } }
  return result;
}

function road(config: WorldConfig, id: string, from: RoadNode, to: RoadNode, bounds: RegionBounds): RoadSegment | undefined {
  const tiles = line(from, to, bounds); if (tiles.length < 2) return undefined;
  return { id, parentId: id, ownerRegion: worldToRegion(from.x, from.y), from, to, importance: random(config, 'chunk-road:importance', id) > .82 ? 'highway' : 'road', width: random(config, 'chunk-road:width', id) > .82 ? 4 : 2.5, tiles, points: tiles.map((tile) => ({ x: tile.x + .5, y: tile.y + .5 })), bridges: [], waterRoutes: [], ports: [] };
}

/** Fixed macro guide lines are cheap to query and exactly agree at chunk boundaries. */
export function generateChunkLocalRoads(config: WorldConfig, cx: number, cy: number, bounds: RegionBounds, settlements: SettlementShell[]): RoadSegment[] {
  const macro = REGION_CHUNK_SIZE * 4 * 24;
  const mx = Math.floor(bounds.minX / macro); const my = Math.floor(bounds.minY / macro);
  const x = mx * macro + 96 + Math.floor(random(config, 'chunk-road:vertical', mx) * (macro - 192));
  const y = my * macro + 96 + Math.floor(random(config, 'chunk-road:horizontal', my) * (macro - 192));
  const roads: RoadSegment[] = [];
  const horizontalFrom: RoadNode = { id: `${config.seed}:v${config.version}:macro:${mx},${my}:west`, ownerId: `macro:${mx},${my}`, x: bounds.minX - GUTTER, y, kind: 'region-border', importance: .65 };
  const horizontalTo: RoadNode = { ...horizontalFrom, id: `${config.seed}:v${config.version}:macro:${mx},${my}:east`, x: bounds.maxX + GUTTER };
  const verticalFrom: RoadNode = { id: `${config.seed}:v${config.version}:macro:${mx},${my}:north`, ownerId: `macro:${mx},${my}`, x, y: bounds.minY - GUTTER, kind: 'region-border', importance: .65 };
  const verticalTo: RoadNode = { ...verticalFrom, id: `${config.seed}:v${config.version}:macro:${mx},${my}:south`, y: bounds.maxY + GUTTER };
  const horizontal = road(config, `${config.seed}:v${config.version}:chunk-road:h:${mx},${my}`, horizontalFrom, horizontalTo, bounds); const vertical = road(config, `${config.seed}:v${config.version}:chunk-road:v:${mx},${my}`, verticalFrom, verticalTo, bounds);
  if (horizontal && y >= bounds.minY - GUTTER && y <= bounds.maxY + GUTTER) roads.push(horizontal);
  if (vertical && x >= bounds.minX - GUTTER && x <= bounds.maxX + GUTTER) roads.push(vertical);
  for (const settlement of settlements.slice(0, 4)) {
    const gate = settlement.accessPoints[0]; if (!gate || roads.length >= MAX_ROADS) continue;
    const target = Math.abs(gate.x - x) < Math.abs(gate.y - y) ? point(x, gate.y) : point(gate.x, y);
    const from: RoadNode = { ...gate }; const to: RoadNode = { id: `${settlement.id}:macro-link`, ownerId: `macro:${mx},${my}`, ...target, kind: 'junction', importance: .6 };
    const segment = road(config, `${settlement.id}:chunk-link:${cx},${cy}`, from, to, bounds); if (segment) roads.push(segment);
  }
  return roads.sort((a, b) => a.id.localeCompare(b.id));
}

function clippedStreet(id: string, type: SettlementStreet['type'], from: WorldCoordinate, to: WorldCoordinate, bounds: RegionBounds, width: number): SettlementStreet | undefined {
  const tiles = line(from, to, bounds); return tiles.length < 2 ? undefined : { id, type, tiles, points: tiles.map((tile) => ({ x: tile.x + .5, y: tile.y + .5 })), width };
}

/** Constant-work layout cells: a settlement is represented by only the visible portion of its grid. */
export function generateChunkLocalLayouts(config: WorldConfig, bounds: RegionBounds, shells: SettlementShell[]): SettlementLayout[] {
  const layouts: SettlementLayout[] = [];
  for (const shell of shells.slice(0, 4)) {
    const radius = shell.radius + 16; const layoutBounds = { minX: shell.x - radius, minY: shell.y - radius, maxX: shell.x + radius, maxY: shell.y + radius };
    if (layoutBounds.maxX < bounds.minX - 12 || layoutBounds.minX > bounds.maxX + 12 || layoutBounds.maxY < bounds.minY - 12 || layoutBounds.minY > bounds.maxY + 12) continue;
    const streets = [
      clippedStreet(`${shell.id}:local:h`, 'main', point(shell.x - radius, shell.y), point(shell.x + radius, shell.y), bounds, shell.type === 'city' ? 3 : 2),
      clippedStreet(`${shell.id}:local:v`, 'main', point(shell.x, shell.y - radius), point(shell.x, shell.y + radius), bounds, shell.type === 'city' ? 3 : 2),
    ].filter((street): street is SettlementStreet => Boolean(street));
    const plazas = [{ id: `${shell.id}:plaza:central`, kind: 'central' as const, surface: shell.type === 'city' || shell.type === 'town' ? 'stone' as const : 'dirt' as const, tiles: [point(shell.x, shell.y)].filter((tile) => inside(tile, bounds)) }].filter((plaza) => plaza.tiles.length);
    const buildings: Building[] = [];
    for (let y = bounds.minY; y <= bounds.maxY && buildings.length < MAX_BUILDINGS; y++) for (let x = bounds.minX; x <= bounds.maxX && buildings.length < MAX_BUILDINGS; x++) {
      const dx = Math.abs(x - shell.x); const dy = Math.abs(y - shell.y); if (Math.max(dx, dy) > shell.radius || dx < 2 || dy < 2 || (x !== shell.x && y !== shell.y) || random(config, 'chunk-layout:building', shell.id, x, y) < .72) continue;
      buildings.push({ id: `${shell.id}:local-building:${x},${y}`, type: x === shell.x ? 'house' : 'workshop', districtId: `${shell.id}:district:central`, x, y, width: 1, height: 1, rotation: 0, roadId: streets[0]?.id ?? null, courtyard: false });
    }
    const wallTiles: WorldCoordinate[] = [];
    if (shell.type === 'city') for (let x = shell.x - shell.radius; x <= shell.x + shell.radius && wallTiles.length < MAX_WALL_TILES; x++) for (const y of [shell.y - shell.radius, shell.y + shell.radius]) if (inside({ x, y }, bounds)) wallTiles.push({ x, y });
    const fortification = wallTiles.length ? { wallTiles, intramuralTiles: [], wallPoints: wallTiles.map((tile) => ({ x: tile.x + .5, y: tile.y + .5 })), gates: [], engineeredTiles: [] } : undefined;
    layouts.push({ settlementId: shell.id, bounds: layoutBounds, streets, buildings, districts: [{ id: `${shell.id}:district:central`, type: 'central', center: point(shell.x, shell.y), radius: shell.radius, density: .7 }], edgeFeatures: [], plazas, fortification });
  }
  return layouts.sort((a, b) => a.settlementId.localeCompare(b.settlementId));
}
