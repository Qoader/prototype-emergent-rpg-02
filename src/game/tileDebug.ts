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
  settlement: { id: string; name: string; type: SettlementShell['type'] } | null;
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
  if (tile.port) contents.add('Port');
  if (tile.waterRoute) contents.add('Water route');
  const settlements = chunk?.settlements ?? [];
  const containingSettlement = settlements
    .filter((settlement) => Math.hypot(tile.x - settlement.x, tile.y - settlement.y) <= settlement.radius)
    .sort((a, b) => Math.hypot(tile.x - a.x, tile.y - a.y) - Math.hypot(tile.x - b.x, tile.y - b.y) || a.id.localeCompare(b.id))[0];
  if (tile.landmark) contents.add(title(tile.landmark));
  if (chunk) {
    chunk.landmarks.filter((landmark: LandmarkAnchor) => at(landmark, tile.x, tile.y)).forEach((landmark) => contents.add(title(landmark.type)));
    chunk.resources.filter((resource: ResourceAnchor) => at(resource, tile.x, tile.y)).forEach((resource) => contents.add(`${title(resource.type)} resource`));
    settlements.filter((settlement: SettlementShell) => at(settlement, tile.x, tile.y)).forEach((settlement) => contents.add(`${title(settlement.type)} center`));
    chunk.settlements.flatMap((settlement) => settlement.anchors).filter((anchor) => at(anchor, tile.x, tile.y)).forEach((anchor) => contents.add(`${title(anchor.type)} anchor`));
    const composedRoad = chunk.tiles.some((chunkTile) => chunkTile.x === tile.x && chunkTile.y === tile.y && chunkTile.road);
    const regionalRoad = chunk.roads.some((road: RoadSegment) => road.tiles.some((point) => at(point, tile.x, tile.y)));
    const settlementStreet = chunk.settlementLayouts.some((layout) => layout.streets.some((street) => street.tiles.some((point) => at(point, tile.x, tile.y))));
    if (composedRoad || regionalRoad || settlementStreet) contents.add('Road');
    chunk.settlementLayouts.flatMap((layout) => layout.buildings).filter((building: Building) => containsRotated(building, tile.x, tile.y)).forEach((building) => contents.add(title(building.type)));
    chunk.settlementLayouts.flatMap((layout) => layout.edgeFeatures).filter((feature: SettlementEdgeFeature) => containsAxisAligned(feature, tile.x, tile.y)).forEach((feature) => contents.add(title(feature.type)));
  }
  const composed = chunk?.tiles.find((chunkTile) => chunkTile.x === tile.x && chunkTile.y === tile.y);
  if (composed?.port) contents.add('Port');
  if (composed?.waterRoute) contents.add('Water route');
  return { x: tile.x, y: tile.y, terrain: tile.terrain, biome: tile.biome, walkable: composed?.walkable ?? tile.walkable, contents: [...contents].sort((a, b) => a.localeCompare(b)), settlement: containingSettlement ? { id: containingSettlement.id, name: containingSettlement.name, type: containingSettlement.type } : null };
}
