import { fieldsAt } from './fields';
import { hydrologyAt } from './hydrology';
import type { Direction } from './hydrology';
import { CHUNK_SIZE, REGION_CHUNK_SIZE, featureId, random, worldToRegion, type RegionCoordinate, type WorldConfig } from './world';
import type { SettlementLayout } from './settlements';

export const REGION_SIZE_TILES = CHUNK_SIZE * REGION_CHUNK_SIZE;
const CANDIDATES_PER_REGION = 6;
const MIN_SETTLEMENT_SPACING = 120;
const SHRINE_LANDMARK_CHANCE = 0.048;
const RUIN_LANDMARK_CHANCE = 0.072;

export interface RegionBounds { minX: number; minY: number; maxX: number; maxY: number; }
export interface SettlementAnchor { id: string; type: 'center' | 'gate' | 'market' | 'well' | 'crossing' | 'harbor' | 'resource'; x: number; y: number; }
export interface SettlementShell { id: string; name: string; x: number; y: number; type: 'hamlet' | 'village' | 'town' | 'city'; radius: number; populationClass: number; footprint: { width: number; height: number; rotation: number }; anchors: SettlementAnchor[]; accessPoints: RoadEndpoint[]; }
export interface NearbySettlement { id: string; name: string; type: SettlementShell['type']; x: number; y: number; gateX: number; gateY: number; distance: number; }
export interface NearbySettlementResult { settlements: NearbySettlement[]; searchedRadius: number; complete: boolean; }
export interface LandmarkAnchor { id: string; type: 'ruin' | 'shrine' | 'watchtower' | 'natural-wonder'; x: number; y: number; importance: number; }
export interface ResourceAnchor { id: string; type: 'forest' | 'fertile-land' | 'ore' | 'stone' | 'salt' | 'water'; x: number; y: number; importance: number; }
export interface RoadEndpoint { id: string; ownerId: string; x: number; y: number; kind: 'settlement-gate' | 'landmark' | 'resource' | 'region-border'; importance: number; preferredDirections: Direction[]; }
export interface RegionData { key: RegionCoordinate; bounds: RegionBounds; settlements: SettlementShell[]; settlementLayouts: SettlementLayout[]; landmarks: LandmarkAnchor[]; resources: ResourceAnchor[]; roadEndpoints: RoadEndpoint[]; }

export function regionBounds(rx: number, ry: number): RegionBounds { const minX = rx * REGION_SIZE_TILES; const minY = ry * REGION_SIZE_TILES; return { minX, minY, maxX: minX + REGION_SIZE_TILES - 1, maxY: minY + REGION_SIZE_TILES - 1 }; }

function distance(a: { x: number; y: number }, b: { x: number; y: number }) { return Math.hypot(a.x - b.x, a.y - b.y); }
function ownerAt(x: number, y: number) { return worldToRegion(x, y); }
function candidatePoint(config: WorldConfig, rx: number, ry: number, index: number) { const bounds = regionBounds(rx, ry); const padding = 48; return { x: bounds.minX + padding + Math.floor(random(config, 'region:settlement-candidate', rx, ry, index) * (REGION_SIZE_TILES - padding * 2)), y: bounds.minY + padding + Math.floor(random(config, 'region:settlement-candidate-y', rx, ry, index) * (REGION_SIZE_TILES - padding * 2)) }; }

interface SettlementCandidate { id: string; x: number; y: number; rx: number; ry: number; score: number; type: SettlementShell['type']; }

function settlementCandidate(config: WorldConfig, rx: number, ry: number, index: number): SettlementCandidate | null {
  const point = candidatePoint(config, rx, ry, index); const fields = fieldsAt(config, point.x, point.y);
  if (fields.elevation < 0.28 || fields.elevation > 0.76 || fields.slope > 0.12 || hydrologyAt(config, point.x, point.y).waterBody !== 'none') return null;
  const waterBonus = fields.elevation < 0.4 || fields.moisture > 0.65 ? 0.2 : 0;
  const biomeBonus = fields.moisture > 0.58 ? 0.15 : fields.moisture > 0.4 ? 0.08 : 0;
  const score = fields.fertility * 0.45 + (1 - fields.slope) * 0.25 + waterBonus + biomeBonus + random(config, 'region:settlement-score', rx, ry, index) * 0.08;
  const type: SettlementShell['type'] = score > 0.72 ? 'city' : score > 0.58 ? 'town' : score > 0.42 ? 'village' : 'hamlet';
  const owner = ownerAt(point.x, point.y);
  return { id: featureId(config, 'settlement', point.x, point.y), ...point, rx: owner.rx, ry: owner.ry, score, type };
}

const SETTLEMENT_NAME_PREFIXES = ['Ash', 'Briar', 'Cinder', 'Dun', 'Elder', 'Fallow', 'Glimmer', 'Grim', 'Hearth', 'Iron', 'Raven', 'Rose', 'Silver', 'Thorn', 'Wick', 'Winter', 'Amber', 'Black', 'Bright', 'Copper', 'Dragon', 'Ever', 'Fox', 'Golden', 'Green', 'High', 'Moon', 'Oak', 'Red', 'Star', 'Storm', 'White'];
const SETTLEMENT_NAME_SUFFIXES = ['barrow', 'brook', 'combe', 'crest', 'fall', 'ford', 'haven', 'mere', 'mont', 'stead', 'stone', 'vale', 'watch', 'wick', 'wood', 'bridge', 'burrow', 'cairn', 'cliff', 'dale', 'gate', 'grove', 'hearth', 'holt', 'keep', 'march', 'meadow', 'moor', 'port', 'reach', 'ridge', 'thorpe'];

export function settlementName(config: WorldConfig, id: string) {
  const prefix = SETTLEMENT_NAME_PREFIXES[Math.floor(random(config, 'region:settlement-name-prefix', id) * SETTLEMENT_NAME_PREFIXES.length)];
  const suffix = SETTLEMENT_NAME_SUFFIXES[Math.floor(random(config, 'region:settlement-name-suffix', id) * SETTLEMENT_NAME_SUFFIXES.length)];
  return `${prefix}${suffix}`;
}

function selectedSettlements(config: WorldConfig, region: RegionCoordinate) {
  const candidates: SettlementCandidate[] = [];
  for (let ry = region.ry - 1; ry <= region.ry + 1; ry++) for (let rx = region.rx - 1; rx <= region.rx + 1; rx++) for (let index = 0; index < CANDIDATES_PER_REGION; index++) {
    const candidate = settlementCandidate(config, rx, ry, index); if (candidate) candidates.push(candidate);
  }
  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)); const accepted: SettlementCandidate[] = [];
  for (const candidate of candidates) if (accepted.every((other) => distance(candidate, other) >= MIN_SETTLEMENT_SPACING)) accepted.push(candidate);
  return accepted.filter((candidate) => candidate.rx === region.rx && candidate.ry === region.ry);
}

function shellFor(config: WorldConfig, candidate: SettlementCandidate): SettlementShell {
  const radius = candidate.type === 'city' ? 42 : candidate.type === 'town' ? 32 : candidate.type === 'village' ? 23 : 14;
  const rotation = (random(config, 'region:settlement-rotation', candidate.x, candidate.y) - 0.5) * 0.35;
  const anchors: SettlementAnchor[] = [{ id: `${candidate.id}:center`, type: 'center', x: candidate.x, y: candidate.y }, { id: `${candidate.id}:market`, type: 'market', x: candidate.x + Math.round(radius * 0.2), y: candidate.y }];
  const accessPoints: RoadEndpoint[] = [];
  for (const [name, dx, dy] of [['north', 0, -1], ['east', 1, 0], ['south', 0, 1], ['west', -1, 0] ] as const) {
    if (candidate.type === 'hamlet' && name !== 'south' && random(config, 'region:gate', candidate.x, candidate.y, name) < 0.5) continue;
    const x = candidate.x + dx * radius; const y = candidate.y + dy * radius; const anchor: SettlementAnchor = { id: `${candidate.id}:gate:${name}`, type: 'gate', x, y }; anchors.push(anchor);
    accessPoints.push({ id: anchor.id, ownerId: candidate.id, x, y, kind: 'settlement-gate', importance: candidate.score, preferredDirections: [name === 'north' ? 'north' : name === 'east' ? 'east' : name === 'south' ? 'south' : 'west'] });
  }
  return { id: candidate.id, name: settlementName(config, candidate.id), x: candidate.x, y: candidate.y, type: candidate.type, radius, populationClass: Math.round(candidate.score * 100), footprint: { width: radius * 2, height: radius * 2, rotation }, anchors, accessPoints };
}

function regionAnchors(config: WorldConfig, region: RegionCoordinate) {
  const bounds = regionBounds(region.rx, region.ry); const landmarks: LandmarkAnchor[] = []; const resources: ResourceAnchor[] = [];
  for (let index = 0; index < 4; index++) {
    const x = bounds.minX + 24 + Math.floor(random(config, 'region:landmark-x', region.rx, region.ry, index) * (REGION_SIZE_TILES - 48)); const y = bounds.minY + 24 + Math.floor(random(config, 'region:landmark-y', region.rx, region.ry, index) * (REGION_SIZE_TILES - 48)); const fields = fieldsAt(config, x, y);
    if (fields.elevation >= 0.28 && fields.slope < 0.18 && random(config, 'region:landmark-keep', region.rx, region.ry, index) > 0.55) { const typeRoll = random(config, 'region:landmark-type', region.rx, region.ry, index); const type: LandmarkAnchor['type'] = typeRoll < SHRINE_LANDMARK_CHANCE ? 'shrine' : typeRoll < SHRINE_LANDMARK_CHANCE + RUIN_LANDMARK_CHANCE ? 'ruin' : typeRoll < 0.65 ? 'watchtower' : 'natural-wonder'; landmarks.push({ id: featureId(config, 'landmark', x, y), type, x, y, importance: 0.4 + random(config, 'region:landmark-importance', x, y) * 0.6 }); }
  }
  for (let index = 0; index < 4; index++) {
    const x = bounds.minX + 24 + Math.floor(random(config, 'region:resource-x', region.rx, region.ry, index) * (REGION_SIZE_TILES - 48)); const y = bounds.minY + 24 + Math.floor(random(config, 'region:resource-y', region.rx, region.ry, index) * (REGION_SIZE_TILES - 48)); const fields = fieldsAt(config, x, y); const types: ResourceAnchor['type'][] = ['forest', 'fertile-land', 'ore', 'stone', 'salt', 'water'];
    if (fields.elevation >= 0.28 && fields.slope < 0.18 && random(config, 'region:resource-keep', region.rx, region.ry, index) > 0.48) { const type = types[Math.floor(random(config, 'region:resource-type', region.rx, region.ry, index) * types.length)]; resources.push({ id: featureId(config, 'resource', x, y), type, x, y, importance: 0.35 + random(config, 'region:resource-importance', x, y) * 0.65 }); }
  }
  return { landmarks, resources };
}

export function generateRegion(config: WorldConfig, rx: number, ry: number): RegionData {
  const key = { rx, ry }; const shells = selectedSettlements(config, key).map((candidate) => shellFor(config, candidate)); const anchors = regionAnchors(config, key); const roadEndpoints = [...shells.flatMap((shell) => shell.accessPoints), ...anchors.landmarks.map((anchor) => ({ id: `${anchor.id}:endpoint`, ownerId: anchor.id, x: anchor.x, y: anchor.y, kind: 'landmark' as const, importance: anchor.importance, preferredDirections: ['north', 'east', 'south', 'west'] as Direction[] })), ...anchors.resources.map((anchor) => ({ id: `${anchor.id}:endpoint`, ownerId: anchor.id, x: anchor.x, y: anchor.y, kind: 'resource' as const, importance: anchor.importance, preferredDirections: ['north', 'east', 'south', 'west'] as Direction[] }))];
  return { key, bounds: regionBounds(rx, ry), settlements: shells, settlementLayouts: [], landmarks: anchors.landmarks, resources: anchors.resources, roadEndpoints: roadEndpoints.sort((a, b) => a.id.localeCompare(b.id)) };
}

export function featureIntersectsBounds(feature: { x: number; y: number }, bounds: RegionBounds, radius = 0) { return feature.x + radius >= bounds.minX && feature.x - radius <= bounds.maxX && feature.y + radius >= bounds.minY && feature.y - radius <= bounds.maxY; }
