import { Container, Graphics } from 'pixi.js';
import { roadOuterStrokeWidthPx, roadStrokeWidthPx } from './roadGeometry';
import { TILE_SIZE, type Tile } from './world';
import type { Building, CityFortification, CitySquare, SettlementEdgeFeature, WorldPoint } from './settlements';

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

/** A pale channel keeps boat routes legible against animated water. */
export function drawWaterRoute(features: Container, points: WorldPoint[], width: number) {
  if (!points.length) return;
  const route = new Graphics().moveTo(points[0].x * TILE_SIZE, points[0].y * TILE_SIZE);
  for (const point of points.slice(1)) route.lineTo(point.x * TILE_SIZE, point.y * TILE_SIZE);
  route.stroke({ color: 0x163f55, width: Math.max(5, roadStrokeWidthPx(width) * 0.72), alpha: 0.7 });
  route.stroke({ color: 0xd8e8cd, width: Math.max(2, roadStrokeWidthPx(width) * 0.18), alpha: 0.9 });
  route.zIndex = points.at(-1)!.y * TILE_SIZE - 1;
  features.addChild(route);
}

export function drawPort(features: Container, x: number, y: number, waterTiles: Array<{ x: number; y: number }>) {
  const centerX = x * TILE_SIZE + TILE_SIZE / 2; const centerY = y * TILE_SIZE + TILE_SIZE / 2; const g = new Graphics();
  g.roundRect(-14, -8, 28, 16, 3).fill(0x70472c).rect(-13, -5, 26, 3).fill({ color: 0xd0a66b, alpha: 0.72 });
  for (const water of waterTiles) { const dx = water.x - x; const dy = water.y - y; g.moveTo(dx * 13, dy * 13).lineTo(dx * 21, dy * 21).stroke({ color: 0x8a5b35, width: 7 }); }
  g.circle(0, -11, 4).fill(0xf0cf75).moveTo(0, -8).lineTo(0, 2).stroke({ color: 0x4a3426, width: 2 });
  g.position.set(centerX, centerY); g.zIndex = centerY + 14; features.addChild(g);
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

/** Drawn above roads so plaza paving visually absorbs any street crossing it. */
export function drawCitySquare(features: Container, square: CitySquare, bounds?: { minX: number; minY: number; maxX: number; maxY: number }) {
  for (const tile of square.tiles) {
    if (bounds && (tile.x < bounds.minX || tile.x > bounds.maxX || tile.y < bounds.minY || tile.y > bounds.maxY)) continue;
    const x = tile.x * TILE_SIZE; const y = tile.y * TILE_SIZE; const g = new Graphics();
    if (square.surface === 'stone') {
      g.rect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2).fill(0x9b9685);
      g.moveTo(x + 2, y + TILE_SIZE / 2).lineTo(x + TILE_SIZE - 2, y + TILE_SIZE / 2).stroke({ color: 0x716e65, width: 1, alpha: 0.65 });
      g.moveTo(x + TILE_SIZE / 2, y + 2).lineTo(x + TILE_SIZE / 2, y + TILE_SIZE - 2).stroke({ color: 0x716e65, width: 1, alpha: 0.55 });
    } else {
      g.rect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2).fill(0x9d8158);
      g.moveTo(x + 6, y + 12).lineTo(x + TILE_SIZE - 7, y + 10).stroke({ color: 0x765c3e, width: 1, alpha: 0.28 });
    }
    features.addChild(g);
  }
}

export function drawEdgeFeature(features: Container, edge: SettlementEdgeFeature) {
  const g = new Graphics().rect(edge.x * TILE_SIZE + 2, edge.y * TILE_SIZE + 2, edge.width * TILE_SIZE - 4, edge.height * TILE_SIZE - 4).fill({ color: edge.type === 'farm' || edge.type === 'field' ? 0xb0a65b : 0x6c744b, alpha: 0.38 });
  g.zIndex = (edge.y + edge.height) * TILE_SIZE - 5;
  features.addChild(g);
}

export function drawFortification(features: Container, fortification: CityFortification, bounds?: { minX: number; minY: number; maxX: number; maxY: number }) {
  const gates = new Set(fortification.gates.map((gate) => `${gate.x},${gate.y}`));
  for (const tile of fortification.wallTiles) {
    if (bounds && (tile.x < bounds.minX || tile.x > bounds.maxX || tile.y < bounds.minY || tile.y > bounds.maxY)) continue;
    const engineered = fortification.engineeredTiles.some((other) => other.x === tile.x && other.y === tile.y);
    const g = new Graphics().rect(tile.x * TILE_SIZE + 2, tile.y * TILE_SIZE + 5, TILE_SIZE - 4, TILE_SIZE - 8).fill(engineered ? 0x8a9ba0 : 0x6e716b).rect(tile.x * TILE_SIZE + 4, tile.y * TILE_SIZE + 7, TILE_SIZE - 8, 5).fill(0xa7a58c);
    g.zIndex = tile.y * TILE_SIZE + TILE_SIZE; features.addChild(g);
  }
  for (const gate of fortification.gates) {
    if (bounds && (gate.x < bounds.minX || gate.x > bounds.maxX || gate.y < bounds.minY || gate.y > bounds.maxY)) continue;
    if (gates.has(`${gate.x},${gate.y}`)) { const g = new Graphics().rect(gate.x * TILE_SIZE + 10, gate.y * TILE_SIZE + 14, TILE_SIZE - 20, TILE_SIZE - 10).fill(0x4b372d); g.zIndex = gate.y * TILE_SIZE + TILE_SIZE + 1; features.addChild(g); }
  }
}
