import { Application, Container, Graphics, RenderTexture, Sprite } from 'pixi.js';
import { CHUNK_SIZE, createWorldConfig, findPath, findStartingPosition, key, TILE_SIZE, tileAt, type Tile, type WorldChunk } from './world';
import { WorldWorkerClient } from './WorldWorkerClient';
import { PerformanceMonitor } from './performance';
import { tileDebugInfo, type TileDebugInfo } from './tileDebug';
import { streamingPlan, type ChunkBounds, type StreamRequest } from './streaming';
import { composeRoads, type RoadCandidate } from './roadCompositor';
import { roadOuterStrokeWidthPx, roadStrokeWidthPx } from './roadGeometry';

type Status = (value: string) => void;
type TileDebug = (value: TileDebugInfo) => void;
type Detail = 'terrain' | 'medium' | 'full';
interface ChunkDisplay { chunk: WorldChunk; container: Container; terrain: Sprite; texture: RenderTexture; roadLayer: Container; objectLayer: Container; detail: Detail | null; }

const TERRAIN_COLORS = { 'deep-water': 0x183d5a, 'shallow-water': 0x2c7182, shore: 0xbc9d63, plain: 0x557a4d, hill: 0x71804d, mountain: 0x606975, river: 0x2b8491, 'starter-ground': 0x8a7757 } as const;
const BIOME_COLORS = { ocean: 0x245d72, lake: 0x367d8c, coast: 0xcfb270, grassland: 0x66854e, forest: 0x315b43, swamp: 0x506e50, desert: 0xb28d57, tundra: 0x92a0a1, alpine: 0xaab3b7 } as const;
const HERO_FEET_OFFSET = 16;

export class Game {
  private app = new Application(); private world = new Container(); private mapOverlay = new Container(); private actor = new Container(); private hero = new Container(); private marker = new Graphics(); private seed: string; private onStatus: Status; private onTileDebug: TileDebug; private px = 0; private py = 0; private path: Tile[] = []; private displays = new Map<string, ChunkDisplay>(); private prefetched = new Map<string, WorldChunk>(); private requested = new Set<string>(); private queue: StreamRequest[] = []; private activeRequests = 0; private maxConcurrentRequests = 1; private desired = new Set<string>(); private preload = new Set<string>(); private streamDirty = true; private lastStreamBounds = ''; private provider: WorldWorkerClient; private performance = new PerformanceMonitor(); private destroyed = false; private initialTerrainMarked = false; private elapsed = 0; private lastTileDebugSignature = '';
  constructor(private host: HTMLElement, seed: string, onStatus: Status, onTileDebug: TileDebug = () => undefined) { this.seed = seed; const startingPosition = findStartingPosition(createWorldConfig(seed)); this.px = startingPosition.x; this.py = startingPosition.y; this.onStatus = onStatus; this.onTileDebug = onTileDebug; this.provider = new WorldWorkerClient(createWorldConfig(seed)); void this.init(); }
  private async init() { try { await this.app.init({ resizeTo: this.host, background: '#294942', antialias: true, preference: 'webgl', resolution: Math.min(devicePixelRatio, 2) }); await this.provider.whenReady(); } catch { this.onStatus('WebGL or the world worker is required to enter the Emberwild'); return; } this.host.appendChild(this.app.canvas); performance.mark('emberwild-canvas-ready'); this.mapOverlay.addChild(this.marker); this.app.stage.addChild(this.world, this.mapOverlay, this.actor); this.buildHero(); this.app.stage.eventMode = 'static'; this.app.stage.hitArea = this.app.screen; this.app.stage.on('pointertap', (event) => this.go(event.global.x, event.global.y)); this.app.ticker.add((ticker) => this.tick(ticker.deltaMS / 1000)); window.addEventListener('resize', this.resize); this.resize(); }
  private buildHero() {
    const shadow = new Graphics().ellipse(0, 13, 13, 5).fill({ color: 0x10261f, alpha: 0.35 });
    const figure = new Graphics()
      .circle(-8, 7, 5).fill(0x283b3b).circle(8, 7, 5).fill(0x283b3b)
      .roundRect(-10, -4, 20, 20, 7).fill(0xb9573d)
      .moveTo(-12, 4).lineTo(0, -16).lineTo(12, 4).fill(0xd8874c)
      .circle(0, -13, 8).fill(0xefc58f)
      .moveTo(-8, -16).quadraticCurveTo(0, -27, 8, -16).fill(0x263b3e)
      .roundRect(-12, -2, 5, 11, 2).fill(0x75503a);
    this.hero.addChild(figure); this.actor.addChild(shadow, this.hero);
  }
  private roadTileKeys() { const roadTiles = new Set<string>(); const chunks = [...this.displays.values()].map((display) => display.chunk).concat([...this.prefetched.values()]); for (const chunk of chunks) for (const tile of chunk.tiles) if (tile.road) roadTiles.add(key(tile.x, tile.y)); return roadTiles; }
  private go(screenX: number, screenY: number) { const worldX = Math.round((screenX - this.app.screen.width / 2) / TILE_SIZE + this.px); const worldY = Math.round((screenY - this.app.screen.height / 2) / TILE_SIZE + this.py); const target = tileAt(this.seed, worldX, worldY); const start = tileAt(this.seed, Math.round(this.px), Math.round(this.py)); this.path = findPath(this.seed, start, target, undefined, { roadTileKeys: this.roadTileKeys() }); const endpoint = this.path.at(-1) ?? target; this.marker.clear(); this.marker.circle(0, 0, 8).fill({ color: this.path.length ? 0xf4c86a : 0xc96855, alpha: .9 }); this.marker.position.set((endpoint.x + 0.5) * TILE_SIZE, (endpoint.y + 0.5) * TILE_SIZE); this.onStatus(this.path.length ? 'Walking' : 'Blocked terrain'); }
  private tick(dt: number) { const start = performance.now(); this.elapsed += dt; if (this.path.length) { const target = this.path[0]; const dx = target.x - this.px; const dy = target.y - this.py; const distance = Math.hypot(dx, dy); const amount = dt * 4.2; if (distance <= amount) { this.px = target.x; this.py = target.y; this.path.shift(); } else { this.px += (dx / distance) * amount; this.py += (dy / distance) * amount; this.hero.rotation = Math.atan2(dy, dx) * 0.08; } if (!this.path.length) this.onStatus('Exploring the Emberwild'); } this.hero.y = this.path.length ? Math.sin(this.elapsed * 15) * 1.5 : Math.sin(this.elapsed * 2) * 0.45; this.render(); this.performance.recordFrame(performance.now() - start); }
  private render() { const centerX = this.app.screen.width / 2; const centerY = this.app.screen.height / 2; const cameraX = centerX - this.px * TILE_SIZE; const cameraY = centerY - this.py * TILE_SIZE; this.world.position.set(cameraX, cameraY); this.mapOverlay.position.set(cameraX, cameraY); this.actor.position.set(centerX + TILE_SIZE / 2, centerY + TILE_SIZE * 2 / 3 - HERO_FEET_OFFSET); const bounds = this.visibleBounds(); const signature = `${bounds.minChunkX},${bounds.maxChunkX},${bounds.minChunkY},${bounds.maxChunkY}`; if (this.streamDirty || signature !== this.lastStreamBounds) { this.streamDirty = false; this.lastStreamBounds = signature; this.syncStreaming(bounds); } this.publishTileDebug(); this.performance.setDisplayObjects(this.world.children.reduce((count, child) => count + child.children.length + 1, 0)); }
  private publishTileDebug() { const x = Math.round(this.px); const y = Math.round(this.py); const chunk = this.displays.get(key(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE)))?.chunk; const signature = `${x},${y}:${chunk ? `${chunk.cx},${chunk.cy}` : 'pending'}`; if (signature === this.lastTileDebugSignature) return; this.lastTileDebugSignature = signature; this.onTileDebug(tileDebugInfo(tileAt(this.seed, x, y), chunk)); }
  private visibleBounds() { const halfWidth = this.app.screen.width / TILE_SIZE / 2; const halfHeight = this.app.screen.height / TILE_SIZE / 2; const minX = Math.floor(this.px - halfWidth); const maxX = Math.ceil(this.px + halfWidth) - 1; const minY = Math.floor(this.py - halfHeight); const maxY = Math.ceil(this.py + halfHeight) - 1; return { minX, maxX, minY, maxY, minChunkX: Math.floor(minX / CHUNK_SIZE), maxChunkX: Math.floor(maxX / CHUNK_SIZE), minChunkY: Math.floor(minY / CHUNK_SIZE), maxChunkY: Math.floor(maxY / CHUNK_SIZE) }; }
  private syncStreaming(bounds: ChunkBounds) { const plan = streamingPlan(bounds, { cx: Math.floor(this.px / CHUNK_SIZE), cy: Math.floor(this.py / CHUNK_SIZE) });
    for (const [chunkKey, display] of this.displays) if (!plan.visible.has(chunkKey)) this.evict(chunkKey, display);
    for (const chunkKey of this.prefetched.keys()) if (!plan.visible.has(chunkKey) && !plan.preload.has(chunkKey)) this.prefetched.delete(chunkKey);
    this.desired = plan.visible; this.preload = plan.preload;
    for (const chunkKey of plan.visible) { const chunk = this.prefetched.get(chunkKey); if (chunk) { this.prefetched.delete(chunkKey); this.drawChunk(chunk, this.detailFor(chunk)); } }
    this.queue = plan.requests.filter((request) => !this.displays.has(key(request.cx, request.cy)) && !this.prefetched.has(key(request.cx, request.cy)) && !this.requested.has(key(request.cx, request.cy))); for (const display of this.displays.values()) this.updateDetail(display, this.detailFor(display.chunk)); this.pumpRequests();
  }
  private detailFor(chunk: WorldChunk): Detail { const playerChunkX = Math.floor(this.px / CHUNK_SIZE); const playerChunkY = Math.floor(this.py / CHUNK_SIZE); const distance = Math.max(Math.abs(chunk.cx - playerChunkX), Math.abs(chunk.cy - playerChunkY)); return distance <= 1 ? 'full' : distance <= 2 ? 'medium' : 'terrain'; }
  private pumpRequests() { while (!this.destroyed && this.activeRequests < this.maxConcurrentRequests && this.queue.length) { const request = this.queue.shift()!; const chunkKey = key(request.cx, request.cy); if ((!this.desired.has(chunkKey) && !this.preload.has(chunkKey)) || this.displays.has(chunkKey) || this.prefetched.has(chunkKey) || this.requested.has(chunkKey)) continue; this.requested.add(chunkKey); this.activeRequests++; const started = performance.now(); void this.provider.getChunk(request.cx, request.cy).then((chunk) => { if (this.destroyed) return; this.performance.recordChunk(performance.now() - started); if (this.desired.has(chunkKey)) this.drawChunk(chunk, this.detailFor(chunk)); else if (this.preload.has(chunkKey)) this.prefetched.set(chunkKey, chunk); }).catch(() => { if (!this.destroyed && !request.preload) this.onStatus('World generation delayed'); }).finally(() => { this.requested.delete(chunkKey); this.activeRequests--; this.pumpRequests(); }); } }
  private variation(namespace: string, x: number, y: number) { let hash = 2166136261; for (const character of `${this.seed}:${namespace}:${x},${y}`) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0) / 4294967296; }
  private drawTerrain(chunk: WorldChunk) {
    const texture = RenderTexture.create({ width: CHUNK_SIZE * TILE_SIZE, height: CHUNK_SIZE * TILE_SIZE, resolution: 1 }); const graphics = new Graphics();
    for (const tile of chunk.tiles) {
      const localX = (tile.x - chunk.cx * CHUNK_SIZE) * TILE_SIZE; const localY = (tile.y - chunk.cy * CHUNK_SIZE) * TILE_SIZE; const tone = BIOME_COLORS[tile.biome]; const variation = this.variation('terrain', tile.x, tile.y);
      graphics.rect(localX, localY, TILE_SIZE + 1, TILE_SIZE + 1).fill(TERRAIN_COLORS[tile.terrain]);
      if (!['deep-water', 'shallow-water', 'river'].includes(tile.terrain)) {
        graphics.roundRect(localX + 3, localY + 3, TILE_SIZE - 6, TILE_SIZE - 6, 8).fill({ color: tone, alpha: 0.13 + variation * 0.09 });
      }
      if (tile.terrain === 'deep-water' || tile.terrain === 'shallow-water' || tile.terrain === 'river') {
        const wave = 8 + variation * 4; graphics.moveTo(localX + 5, localY + 10).quadraticCurveTo(localX + 14, localY + 6, localX + 23, localY + 10).quadraticCurveTo(localX + 30, localY + 13, localX + 36, localY + 10).stroke({ color: 0xa4d2cc, width: 1.2, alpha: 0.25 });
        graphics.moveTo(localX + 3, localY + wave + 14).quadraticCurveTo(localX + 14, localY + wave + 10, localX + 27, localY + wave + 14).stroke({ color: 0xc4e0c8, width: 1, alpha: 0.18 });
      } else if (tile.terrain === 'mountain') {
        graphics.moveTo(localX + 4, localY + 35).lineTo(localX + 17, localY + 7).lineTo(localX + 29, localY + 35).fill({ color: 0xd3d8ce, alpha: 0.27 });
        graphics.moveTo(localX + 17, localY + 7).lineTo(localX + 25, localY + 28).lineTo(localX + 17, localY + 23).fill({ color: 0xf0e5ca, alpha: 0.28 });
      } else if (tile.terrain === 'hill') {
        for (let line = 0; line < 2; line++) graphics.moveTo(localX + 7, localY + 14 + line * 10).quadraticCurveTo(localX + 20, localY + 5 + line * 10, localX + 34, localY + 14 + line * 10).stroke({ color: 0xd6d288, width: 1.1, alpha: 0.22 });
      } else if (tile.terrain === 'shore' || tile.hydrology.shoreline) {
        graphics.moveTo(localX + 4, localY + 30).quadraticCurveTo(localX + 17, localY + 25, localX + 36, localY + 30).stroke({ color: 0xf0d99c, width: 2, alpha: 0.42 });
      } else {
        const tuftX = localX + 8 + variation * 19; const tuftY = localY + 13 + this.variation('tuft', tile.x, tile.y) * 16;
        graphics.moveTo(tuftX, tuftY + 6).lineTo(tuftX + 2, tuftY).lineTo(tuftX + 4, tuftY + 6).stroke({ color: tile.biome === 'desert' ? 0xd9c580 : 0xb7c87b, width: 1, alpha: 0.4 });
      }
    }
    this.app.renderer.render({ container: graphics, target: texture, clear: true }); graphics.destroy(); return texture;
  }
  private drawChunk(chunk: WorldChunk, detail: Detail) { const chunkKey = key(chunk.cx, chunk.cy); const existing = this.displays.get(chunkKey); if (existing) { existing.chunk = chunk; this.updateDetail(existing, detail); this.lastTileDebugSignature = ''; return; } const texture = this.drawTerrain(chunk); const container = new Container(); const terrain = new Sprite(texture); terrain.position.set(chunk.cx * CHUNK_SIZE * TILE_SIZE, chunk.cy * CHUNK_SIZE * TILE_SIZE); const roadLayer = new Container(); const objectLayer = new Container(); objectLayer.sortableChildren = true; container.addChild(terrain, roadLayer, objectLayer); this.world.addChild(container); const display: ChunkDisplay = { chunk, container, terrain, texture, roadLayer, objectLayer, detail: null }; this.displays.set(chunkKey, display); this.updateDetail(display, detail); this.lastTileDebugSignature = ''; if (!this.initialTerrainMarked) { this.initialTerrainMarked = true; performance.mark('emberwild-first-terrain-ready'); } }
  private addRoad(features: Container, points: Array<{ x: number; y: number }>, width: number, color: number) { if (!points.length) return; const road = new Graphics().moveTo(points[0].x * TILE_SIZE, points[0].y * TILE_SIZE); for (const point of points.slice(1)) road.lineTo(point.x * TILE_SIZE, point.y * TILE_SIZE); if (points.length === 1) road.circle(points[0].x * TILE_SIZE, points[0].y * TILE_SIZE, Math.max(2, roadStrokeWidthPx(width) / 2)); road.stroke({ color: 0x3b342b, width: roadOuterStrokeWidthPx(width), alpha: 1 }); road.stroke({ color, width: roadStrokeWidthPx(width), alpha: 1 }); road.zIndex = points[points.length - 1].y * TILE_SIZE - 2; features.addChild(road); }
  private addTree(features: Container, x: number, y: number, size = 1) { const g = new Graphics(); const radius = TILE_SIZE * (0.22 + size * 0.08); g.moveTo(0, radius * 1.25).lineTo(0, -radius * 0.2).stroke({ color: 0x5f4932, width: Math.max(3, radius * 0.28) }); g.circle(-radius * 0.45, -radius * 0.15, radius * 0.72).fill(0x244a35).circle(radius * 0.42, -radius * 0.36, radius * 0.75).fill(0x315c3d).circle(0, -radius * 0.73, radius * 0.7).fill(0x426d45); g.position.set(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2); g.zIndex = g.y + radius; features.addChild(g); }
  private addLandmark(features: Container, tile: Tile) { const x = tile.x * TILE_SIZE + TILE_SIZE / 2; const y = tile.y * TILE_SIZE + TILE_SIZE / 2; if (tile.landmark === 'tree') return this.addTree(features, tile.x, tile.y, 1.25); const g = new Graphics(); if (tile.landmark === 'shrine') { g.moveTo(0, -15).lineTo(9, -5).lineTo(6, 13).lineTo(-6, 13).lineTo(-9, -5).fill(0xddd0a5).moveTo(0, -20).lineTo(0, -5).stroke({ color: 0xf6dc82, width: 2, alpha: 0.9 }); } else { g.moveTo(-13, 12).lineTo(-8, -10).lineTo(-1, -4).lineTo(5, -15).lineTo(14, 11).fill(0x7a7563).rect(-9, 2, 6, 7).fill(0x343c3c).rect(5, 1, 5, 8).fill(0x343c3c); } g.position.set(x, y); g.zIndex = y + 16; features.addChild(g); }
  private addBuilding(features: Container, building: { x: number; y: number; width: number; height: number; rotation: number; type: string }) { const width = Math.min(TILE_SIZE - 8, building.width * TILE_SIZE - 8); const height = Math.min(TILE_SIZE - 8, building.height * TILE_SIZE - 8); const wall = building.type === 'keep' || building.type === 'market' ? 0xb36d4a : building.type === 'workshop' || building.type === 'warehouse' ? 0x80634b : 0xa98660; const roof = building.type === 'keep' ? 0x53606b : 0x6c4038; const g = new Graphics().roundRect(-width / 2, -height / 2 + 5, width, height - 5, 4).fill(wall).rect(-width / 2 + 4, -height / 2 + 9, width - 8, 3).fill({ color: 0xe5bb79, alpha: 0.38 }).moveTo(-width / 2 - 2, -height / 2 + 6).lineTo(0, -height / 2 + 1).lineTo(width / 2 + 2, -height / 2 + 6).fill(roof); g.position.set(building.x * TILE_SIZE + TILE_SIZE / 2, building.y * TILE_SIZE + TILE_SIZE / 2); g.zIndex = g.y + height / 2; features.addChild(g); }
  private updateDetail(display: ChunkDisplay, detail: Detail) {
    if (display.detail === detail) return; display.detail = detail; display.roadLayer.removeChildren().forEach((child) => child.destroy()); display.objectLayer.removeChildren().forEach((child) => child.destroy()); if (detail === 'terrain') return; const { chunk, roadLayer, objectLayer } = display;
    const candidates: RoadCandidate[] = [];
    for (const road of chunk.roads) if (detail === 'full' || road.importance !== 'trail') {
      const color = road.importance === 'highway' ? 0xd8b46e : road.importance === 'road' ? 0xba9563 : 0x8d7657;
      const priority = road.importance === 'highway' ? 300 : road.importance === 'road' ? 200 : 100;
      candidates.push({ id: road.id, tiles: road.tiles, points: road.points, width: road.width, color, priority: priority + road.width });
    }
    if (detail === 'full') for (const road of chunk.roads) for (const bridge of road.bridges) candidates.push({ id: bridge.id, tiles: bridge.tiles, points: bridge.points, width: bridge.width, color: 0xc98b53, priority: 1000 + bridge.width });
    if (detail === 'full') for (const layout of chunk.settlementLayouts) for (const street of layout.streets) {
      const color = street.type === 'main' ? 0xc4a16d : 0x9b805c;
      const priority = street.type === 'main' ? 250 : street.type === 'secondary' ? 150 : street.type === 'lane' ? 100 : 50;
      candidates.push({ id: street.id, tiles: street.tiles, points: street.points, width: street.width, color, priority: priority + street.width });
    }
    const composition = composeRoads(candidates);
    for (const road of [...composition.roads].reverse()) this.addRoad(roadLayer, road.points, road.width, road.color);
    if (detail === 'medium') for (const settlement of chunk.settlements) { const g = new Graphics().moveTo(settlement.x * TILE_SIZE, settlement.y * TILE_SIZE - 10).lineTo(settlement.x * TILE_SIZE + 8, settlement.y * TILE_SIZE + 4).lineTo(settlement.x * TILE_SIZE - 8, settlement.y * TILE_SIZE + 4).fill({ color: 0xe8c67b, alpha: 0.72 }); g.zIndex = settlement.y * TILE_SIZE; objectLayer.addChild(g); }
    if (detail !== 'full') return;
    for (const tile of chunk.tiles) { const density = this.variation('props', tile.x, tile.y); if (tile.road) continue; if (tile.landmark && tile.walkable) this.addLandmark(objectLayer, tile); else if (tile.walkable && tile.biome === 'forest' && density > 0.89) this.addTree(objectLayer, tile.x, tile.y, density); else if (tile.walkable && (tile.biome === 'grassland' || tile.biome === 'swamp') && density > 0.9775) this.addTree(objectLayer, tile.x, tile.y, 0.7); }
    for (const layout of chunk.settlementLayouts) { for (const building of layout.buildings) this.addBuilding(objectLayer, building); for (const edge of layout.edgeFeatures) { const g = new Graphics().rect(edge.x * TILE_SIZE + 2, edge.y * TILE_SIZE + 2, edge.width * TILE_SIZE - 4, edge.height * TILE_SIZE - 4).fill({ color: edge.type === 'farm' || edge.type === 'field' ? 0xb0a65b : 0x6c744b, alpha: 0.38 }); g.zIndex = (edge.y + edge.height) * TILE_SIZE - 5; objectLayer.addChild(g); } }
    objectLayer.sortChildren();
  }
  private evict(chunkKey: string, display: ChunkDisplay) { this.world.removeChild(display.container); display.roadLayer.destroy({ children: true }); display.objectLayer.destroy({ children: true }); display.container.destroy({ children: true }); display.texture.destroy(true); this.displays.delete(chunkKey); }
  private resize = () => { this.app.stage.hitArea = this.app.screen; this.streamDirty = true; this.render(); };
  destroy() { this.destroyed = true; window.removeEventListener('resize', this.resize); for (const [chunkKey, display] of this.displays) this.evict(chunkKey, display); this.prefetched.clear(); void this.provider.dispose(); this.app.destroy(true, { children: true }); }
}
