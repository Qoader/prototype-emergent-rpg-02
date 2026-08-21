import type { LandmarkAnchor, ResourceAnchor, SettlementShell } from './regions';
import type { Building, SettlementEdgeFeature } from './settlements';
import type { RoadSegment } from './roads';
import type { Tile, WorldChunk } from './world';

export interface TileDebugInfo {
  x: number;
  y: number;
  terrain: Tile['terrain'];
  biome: Tile['biome'];
  walkable: boolean;
  contents: string[];
}

const title = (value: string) => value.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const at = (point: { x: number; y: number }, x: number, y: number) => point.x === x && point.y === y;

function containsRotated(building: { x: number; y: number; width: number; height: number; rotation: number }, x: number, y: number) {
  const dx = x + 0.5 - building.x;
  const dy = y + 0.5 - building.y;
  const cos = Math.cos(-building.rotation);
  const sin = Math.sin(-building.rotation);
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  return Math.abs(localX) <= building.width / 2 && Math.abs(localY) <= building.height / 2;
}

function containsAxisAligned(feature: { x: number; y: number; width: number; height: number }, x: number, y: number) {
  return x >= feature.x && x < feature.x + feature.width && y >= feature.y && y < feature.y + feature.height;
}

export function tileDebugInfo(tile: Tile, chunk?: WorldChunk): TileDebugInfo {
  const contents = new Set<string>();
  if (tile.landmark) contents.add(title(tile.landmark));
  if (chunk) {
    chunk.landmarks.filter((landmark: LandmarkAnchor) => at(landmark, tile.x, tile.y)).forEach((landmark) => contents.add(title(landmark.type)));
    chunk.resources.filter((resource: ResourceAnchor) => at(resource, tile.x, tile.y)).forEach((resource) => contents.add(`${title(resource.type)} resource`));
    chunk.settlements.filter((settlement: SettlementShell) => at(settlement, tile.x, tile.y)).forEach((settlement) => contents.add(`${title(settlement.type)} center`));
    chunk.settlements.flatMap((settlement) => settlement.anchors).filter((anchor) => at(anchor, tile.x, tile.y)).forEach((anchor) => contents.add(`${title(anchor.type)} anchor`));
    if (chunk.roads.some((road: RoadSegment) => road.tiles.some((point) => at(point, tile.x, tile.y)))) contents.add('Road');
    chunk.settlementLayouts.flatMap((layout) => layout.buildings).filter((building: Building) => containsRotated(building, tile.x, tile.y)).forEach((building) => contents.add(title(building.type)));
    chunk.settlementLayouts.flatMap((layout) => layout.edgeFeatures).filter((feature: SettlementEdgeFeature) => containsAxisAligned(feature, tile.x, tile.y)).forEach((feature) => contents.add(title(feature.type)));
  }
  return { x: tile.x, y: tile.y, terrain: tile.terrain, biome: tile.biome, walkable: tile.walkable, contents: [...contents].sort((a, b) => a.localeCompare(b)) };
}
