import { Container, Graphics } from 'pixi.js';
import { roadOuterStrokeWidthPx, roadStrokeWidthPx } from './roadGeometry';
import { TILE_SIZE, type Tile } from './world';
import type { Building, SettlementEdgeFeature, WorldPoint } from './settlements';

export function drawRoad(features: Container, points: WorldPoint[], width: number, color: number) {
  if (!points.length) return;
  const road = new Graphics().moveTo(points[0].x * TILE_SIZE, points[0].y * TILE_SIZE);
  for (const point of points.slice(1)) road.lineTo(point.x * TILE_SIZE, point.y * TILE_SIZE);
  if (points.length === 1) road.circle(points[0].x * TILE_SIZE, points[0].y * TILE_SIZE, Math.max(2, roadStrokeWidthPx(width) / 2));
  road.stroke({ color: 0x3b342b, width: roadOuterStrokeWidthPx(width), alpha: 1 });
  road.stroke({ color, width: roadStrokeWidthPx(width), alpha: 1 });
  road.zIndex = points[points.length - 1].y * TILE_SIZE - 2;
  features.addChild(road);
}

export function drawTree(features: Container, x: number, y: number, size = 1) {
  const g = new Graphics();
  const radius = TILE_SIZE * (0.22 + size * 0.08);
  g.moveTo(0, radius * 1.25).lineTo(0, -radius * 0.2).stroke({ color: 0x5f4932, width: Math.max(3, radius * 0.28) });
  g.circle(-radius * 0.45, -radius * 0.15, radius * 0.72).fill(0x244a35).circle(radius * 0.42, -radius * 0.36, radius * 0.75).fill(0x315c3d).circle(0, -radius * 0.73, radius * 0.7).fill(0x426d45);
  g.position.set(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2);
  g.zIndex = g.y + radius;
  features.addChild(g);
}

export function drawLandmark(features: Container, tile: Tile) {
  const x = tile.x * TILE_SIZE + TILE_SIZE / 2;
  const y = tile.y * TILE_SIZE + TILE_SIZE / 2;
  if (tile.landmark === 'tree') return drawTree(features, tile.x, tile.y, 1.25);
  const g = new Graphics();
  if (tile.landmark === 'shrine') {
    g.moveTo(0, -15).lineTo(9, -5).lineTo(6, 13).lineTo(-6, 13).lineTo(-9, -5).fill(0xddd0a5).moveTo(0, -20).lineTo(0, -5).stroke({ color: 0xf6dc82, width: 2, alpha: 0.9 });
  } else {
    g.moveTo(-13, 12).lineTo(-8, -10).lineTo(-1, -4).lineTo(5, -15).lineTo(14, 11).fill(0x7a7563).rect(-9, 2, 6, 7).fill(0x343c3c).rect(5, 1, 5, 8).fill(0x343c3c);
  }
  g.position.set(x, y);
  g.zIndex = y + 16;
  features.addChild(g);
}

export function drawBuilding(features: Container, building: Building) {
  const width = Math.min(TILE_SIZE - 8, building.width * TILE_SIZE - 8);
  const height = Math.min(TILE_SIZE - 8, building.height * TILE_SIZE - 8);
  const wall = building.type === 'keep' || building.type === 'market' ? 0xb36d4a : building.type === 'workshop' || building.type === 'warehouse' ? 0x80634b : 0xa98660;
  const roof = building.type === 'keep' ? 0x53606b : 0x6c4038;
  const g = new Graphics().roundRect(-width / 2, -height / 2 + 5, width, height - 5, 4).fill(wall).rect(-width / 2 + 4, -height / 2 + 9, width - 8, 3).fill({ color: 0xe5bb79, alpha: 0.38 }).moveTo(-width / 2 - 2, -height / 2 + 6).lineTo(0, -height / 2 + 1).lineTo(width / 2 + 2, -height / 2 + 6).fill(roof);
  g.position.set(building.x * TILE_SIZE + TILE_SIZE / 2, building.y * TILE_SIZE + TILE_SIZE / 2);
  g.zIndex = g.y + height / 2;
  features.addChild(g);
}

export function drawEdgeFeature(features: Container, edge: SettlementEdgeFeature) {
  const g = new Graphics().rect(edge.x * TILE_SIZE + 2, edge.y * TILE_SIZE + 2, edge.width * TILE_SIZE - 4, edge.height * TILE_SIZE - 4).fill({ color: edge.type === 'farm' || edge.type === 'field' ? 0xb0a65b : 0x6c744b, alpha: 0.38 });
  g.zIndex = (edge.y + edge.height) * TILE_SIZE - 5;
  features.addChild(g);
}
