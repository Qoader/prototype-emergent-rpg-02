import { DEFAULT_FIELD_TUNING, fieldsAt, type GeographicFields } from './fields';
import { sampleValueNoise } from './noise';
import { random, type WorldConfig } from './world';

export const HYDROLOGY_CELL_SIZE = 8;
export type WaterBody = 'none' | 'ocean' | 'lake' | 'river';
export type Direction = 'north' | 'northeast' | 'east' | 'southeast' | 'south' | 'southwest' | 'west' | 'northwest';
export interface Hydrology { waterBody: WaterBody; flowDirection: Direction | null; shoreline: boolean; }

const DIRECTIONS: Array<{ dx: number; dy: number; direction: Direction }> = [
  { dx: 0, dy: -1, direction: 'north' }, { dx: 1, dy: -1, direction: 'northeast' }, { dx: 1, dy: 0, direction: 'east' }, { dx: 1, dy: 1, direction: 'southeast' },
  { dx: 0, dy: 1, direction: 'south' }, { dx: -1, dy: 1, direction: 'southwest' }, { dx: -1, dy: 0, direction: 'west' }, { dx: -1, dy: -1, direction: 'northwest' },
];
const SEA_LEVEL = 0.28;
const LAKE_LEVEL = 0.36;
const SOURCE_ELEVATION = 0.62;
const MAX_RIVER_CELLS = 64;
const SOURCE_SEARCH_RADIUS = 2;

function quickFields(config: WorldConfig, x: number, y: number) { return { elevation: sampleValueNoise(config, 'field:elevation', x, y, DEFAULT_FIELD_TUNING.elevation), moisture: sampleValueNoise(config, 'field:moisture', x, y, DEFAULT_FIELD_TUNING.moisture) }; }
function cellFields(config: WorldConfig, cx: number, cy: number) { return quickFields(config, cx * HYDROLOGY_CELL_SIZE + HYDROLOGY_CELL_SIZE / 2, cy * HYDROLOGY_CELL_SIZE + HYDROLOGY_CELL_SIZE / 2); }
function cellElevation(config: WorldConfig, cx: number, cy: number) { return cellFields(config, cx, cy).elevation; }

function waterBodyAt(config: WorldConfig, fields: GeographicFields, x: number, y: number): Exclude<WaterBody, 'river'> {
  if (fields.elevation < SEA_LEVEL) return 'ocean';
  if (fields.elevation >= LAKE_LEVEL || fields.moisture < 0.6) return 'none';
  let lowerNeighbors = 0;
  for (const point of DIRECTIONS) {
    const dx = point.dx; const dy = point.dy;
    if (dx === 0 && dy === 0) continue;
    if (quickFields(config, x + dx, y + dy).elevation < fields.elevation) lowerNeighbors++;
  }
  return lowerNeighbors === 0 ? 'lake' : 'none';
}

function nextCell(config: WorldConfig, cx: number, cy: number) {
  const current = cellElevation(config, cx, cy); let best: { cx: number; cy: number; direction: Direction; elevation: number } | null = null;
  for (const point of DIRECTIONS) {
    const elevation = cellElevation(config, cx + point.dx, cy + point.dy);
    if (elevation >= current - 0.002) continue;
    if (!best || elevation < best.elevation || elevation === best.elevation && random(config, 'river-tiebreak', cx, cy, point.dx, point.dy) < random(config, 'river-tiebreak', cx, cy, best.cx - cx, best.cy - cy)) best = { cx: cx + point.dx, cy: cy + point.dy, direction: point.direction, elevation };
  }
  return best;
}

function isRiverSource(config: WorldConfig, cx: number, cy: number) {
  const fields = cellFields(config, cx, cy);
  return fields.elevation >= SOURCE_ELEVATION && fields.moisture >= 0.45 && random(config, 'river-source', cx, cy) > 0.985;
}

function riverFlowAt(config: WorldConfig, targetX: number, targetY: number) {
  const targetCx = Math.floor(targetX / HYDROLOGY_CELL_SIZE); const targetCy = Math.floor(targetY / HYDROLOGY_CELL_SIZE);
  for (let sy = targetCy - SOURCE_SEARCH_RADIUS; sy <= targetCy + SOURCE_SEARCH_RADIUS; sy++) for (let sx = targetCx - SOURCE_SEARCH_RADIUS; sx <= targetCx + SOURCE_SEARCH_RADIUS; sx++) {
    if (!isRiverSource(config, sx, sy)) continue;
    let cx = sx; let cy = sy;
    for (let step = 0; step < MAX_RIVER_CELLS; step++) {
      if (cx === targetCx && cy === targetCy) return nextCell(config, cx, cy)?.direction ?? null;
      const next = nextCell(config, cx, cy);
      if (!next) break;
      cx = next.cx; cy = next.cy;
      if (cellElevation(config, cx, cy) < SEA_LEVEL) break;
    }
  }
  return null;
}

export function hydrologyAt(config: WorldConfig, x: number, y: number): Hydrology {
  const fields = fieldsAt(config, x, y); const baseWater = waterBodyAt(config, fields, x, y);
  const flowDirection = baseWater === 'none' ? riverFlowAt(config, x, y) : null;
  const waterBody: WaterBody = flowDirection ? 'river' : baseWater;
  let shoreline = false;
  if (waterBody === 'none' || waterBody === 'river') for (const point of DIRECTIONS.filter((entry) => entry.dx === 0 || entry.dy === 0)) {
    const neighborPoint = quickFields(config, x + point.dx, y + point.dy); const neighbor = { ...neighborPoint, temperature: 0, fertility: 0, roughness: 0, slope: 0 }; const neighborWater = waterBodyAt(config, neighbor, x + point.dx, y + point.dy);
    if (neighborWater !== 'none') { shoreline = true; break; }
  }
  return { waterBody, flowDirection, shoreline };
}
