import { Application, Container, Graphics, RenderTexture, Sprite } from 'pixi.js';
import { CHUNK_SIZE, createWorldConfig, findPath, findStartingPosition, key, TILE_SIZE, tileAt, worldToChunk, worldToRegion, type Tile, type WorldChunk } from './world';
import type { NearbySettlement, NearbySettlementResult } from './regions';
import { WorldWorkerClient } from './WorldWorkerClient';
import { PerformanceMonitor } from './performance';
import { tileDebugInfo, type TileDebugInfo } from './tileDebug';
import { streamingPlan, type ChunkBounds, type StreamRequest } from './streaming';
import { ChunkStreamingScheduler } from './ChunkStreamingScheduler';
import { visibleWorldBounds } from './worldViewport';
import { composeRoads, type RoadCandidate } from './roadCompositor';
import { drawBuilding, drawPlaza, drawEdgeFeature, drawFortification, drawLandmark, drawPort, drawRoad, drawTree, drawWaterRoute } from './featureRenderer';
import { advanceAdventurer, createAdventurer, pursueGoblin, sampleAdventurer, type Adventurer, type AdventurerLod, type TravelTopology } from './adventurers';
import { advanceGoblin, createGoblin, sweptContact, GOBLIN_CELL_SIZE, type Goblin } from './goblins';
import { roadGraphCell } from './roads';
import { actorMotion, applyActorMotion, createActorSprite, variantForId, type ActorSprite } from './actorSprites';

type Status = (value: string) => void;
type TileDebug = (value: TileDebugInfo) => void;
type Detail = 'terrain' | 'medium' | 'full';
type RenderNode = Container['children'][number];
interface ChunkDisplay { chunk: WorldChunk; terrain: Sprite; texture: RenderTexture; roadLayer: Container; citySurfaceLayer: Container; objectNodes: RenderNode[]; detail: Detail | null; }
interface NavigationContribution { road: string[]; bridge: string[]; waterRoute: string[]; port: string[]; blocked: string[]; links: Array<[string, string]>; }

const TERRAIN_COLORS = { 'deep-water': 0x183d5a, 'shallow-water': 0x2c7182, shore: 0xbc9d63, plain: 0x557a4d, hill: 0x71804d, mountain: 0x606975, river: 0x2b8491, 'starter-ground': 0x8a7757 } as const;
const BIOME_COLORS = { ocean: 0x245d72, lake: 0x367d8c, coast: 0xcfb270, grassland: 0x66854e, forest: 0x315b43, swamp: 0x506e50, desert: 0xb28d57, tundra: 0x92a0a1, alpine: 0xaab3b7 } as const;
const HERO_FEET_OFFSET = 16;

export class Game {
  private app = new Application(); private world = new Container(); private terrainLayer = new Container(); private roadLayer = new Container(); private citySurfaceLayer = new Container(); private objectLayer = new Container(); private adventurerLayer = new Container(); private goblinLayer = new Container(); private mapOverlay = new Container(); private actor = new Container(); private hero!: ActorSprite; private boat = new Container(); private marker = new Graphics(); private seed: string; private onStatus: Status; private onTileDebug: TileDebug; private px = 0; private py = 0; private path: Tile[] = []; private displays = new Map<string, ChunkDisplay>(); private prefetched = new Map<string, WorldChunk>(); private streamDirty = true; private lastStreamBounds = ''; private provider: WorldWorkerClient; private performance = new PerformanceMonitor(); private destroyed = false; private initialTerrainMarked = false; private elapsed = 0; private gameTime = 0; private simAccumulator = 0; private lastTileDebugSignature = ''; private lastDebugAt = 0; private lastMetricsAt = 0; private scheduler: ChunkStreamingScheduler; private readonly chunkLayerKeys = new WeakMap<Container, string>(); private readonly navCounts = { road: new Map<string, number>(), bridge: new Map<string, number>(), waterRoute: new Map<string, number>(), port: new Map<string, number>(), blocked: new Map<string, number>() }; private readonly navigationIndex = { roadTileKeys: new Set<string>(), bridgeTileKeys: new Set<string>(), waterRouteTileKeys: new Set<string>(), portTileKeys: new Set<string>(), portLinks: new Map<string, Set<string>>(), blockedTileKeys: new Set<string>() }; private readonly navigationContributions = new Map<string, NavigationContribution>(); private adventurerTopology: TravelTopology | null = null; private adventurerTopologyKey = ''; private adventurerTopologyPromise: Promise<void> | null = null; private adventurers = new Map<string, Adventurer>(); private adventurerNodes = new Map<string, ActorSprite>(); private goblins = new Map<string, Goblin>(); private goblinNodes = new Map<string, ActorSprite>(); private adventurerLayerDirty = false; private goblinLayerDirty = false;
  constructor(private host: HTMLElement, seed: string, onStatus: Status, onTileDebug: TileDebug = () => undefined) { this.seed = seed; const startingPosition = findStartingPosition(createWorldConfig(seed)); this.px = startingPosition.x; this.py = startingPosition.y; this.onStatus = onStatus; this.onTileDebug = onTileDebug; this.objectLayer.sortableChildren = true; this.provider = new WorldWorkerClient(createWorldConfig(seed)); this.scheduler = new ChunkStreamingScheduler({ isLoaded: (chunkKey) => this.displays.has(chunkKey) || this.prefetched.has(chunkKey), load: (request) => this.loadChunk(request), receive: (chunk, preload) => this.receiveChunk(chunk, preload), failed: () => this.onStatus('World generation delayed') }); void this.init(); }
  private async init() { try { await this.app.init({ resizeTo: this.host, background: '#294942', antialias: true, preference: 'webgl', resolution: Math.min(devicePixelRatio, 2) }); await this.provider.whenReady(); } catch { this.onStatus('WebGL or the world worker is required to enter the Emberwild'); return; } this.host.appendChild(this.app.canvas); performance.mark('emberwild-canvas-ready'); this.world.addChild(this.terrainLayer, this.roadLayer, this.citySurfaceLayer, this.objectLayer, this.adventurerLayer, this.goblinLayer); this.mapOverlay.addChild(this.marker); this.app.stage.addChild(this.world, this.mapOverlay, this.actor); this.buildHero(); this.app.stage.eventMode = 'static'; this.app.stage.hitArea = this.app.screen; this.app.stage.on('pointertap', (event) => this.go(event.global.x, event.global.y)); this.app.ticker.add((ticker) => this.tick(ticker.deltaMS / 1000)); window.addEventListener('resize', this.resize); this.resize(); }
  private buildHero() {
    this.hero = createActorSprite('player', variantForId('player'));
    const hull = new Graphics().moveTo(-17, 4).quadraticCurveTo(0, 16, 17, 4).lineTo(12, -2).lineTo(-12, -2).fill(0x70432c).moveTo(-4, -2).lineTo(-4, -24).stroke({ color: 0x4c3528, width: 3 }).moveTo(-2, -22).lineTo(13, -8).lineTo(-2, -5).fill(0xe7d6a4);
    const wake = new Graphics().moveTo(-19, 10).quadraticCurveTo(0, 17, 19, 10).stroke({ color: 0xd5e8d4, width: 2, alpha: 0.7 });
    this.boat.addChild(wake, hull); this.boat.visible = false; this.actor.addChild(this.hero, this.boat);
  }
  private navigation() { return this.navigationIndex; }
  private count(map: Map<string, number>, values: string[], target: Set<string>, delta: 1 | -1) { for (const value of values) { const next = (map.get(value) ?? 0) + delta; if (next <= 0) { map.delete(value); target.delete(value); } else { map.set(value, next); target.add(value); } } }
  private indexChunk(chunk: WorldChunk, enabled: boolean) { const chunkKey = key(chunk.cx, chunk.cy); const previous = this.navigationContributions.get(chunkKey); if (previous) this.removeNavigationContribution(chunkKey, previous); if (!enabled) return; const contribution: NavigationContribution = { road: [], bridge: [], waterRoute: [], port: [], blocked: [], links: [] }; for (const tile of chunk.tiles) { const tileKey = key(tile.x, tile.y); if (tile.road) contribution.road.push(tileKey); if (tile.port) contribution.port.push(tileKey); if (tile.waterRoute) contribution.waterRoute.push(tileKey); if (!tile.walkable && !['deep-water', 'shallow-water', 'river', 'mountain'].includes(tile.terrain)) contribution.blocked.push(tileKey); } for (const road of chunk.roads) { for (const bridge of road.bridges) for (const tile of bridge.tiles) contribution.bridge.push(key(tile.x, tile.y)); for (const port of road.ports) { const portKey = key(port.x, port.y); for (const water of port.waterTiles) contribution.links.push([portKey, key(water.x, water.y)]); } } this.navigationContributions.set(chunkKey, contribution); this.count(this.navCounts.road, contribution.road, this.navigationIndex.roadTileKeys, 1); this.count(this.navCounts.bridge, contribution.bridge, this.navigationIndex.bridgeTileKeys, 1); this.count(this.navCounts.waterRoute, contribution.waterRoute, this.navigationIndex.waterRouteTileKeys, 1); this.count(this.navCounts.port, contribution.port, this.navigationIndex.portTileKeys, 1); this.count(this.navCounts.blocked, contribution.blocked, this.navigationIndex.blockedTileKeys, 1); for (const [port, water] of contribution.links) { const links = this.navigationIndex.portLinks.get(port) ?? new Set<string>(); links.add(water); this.navigationIndex.portLinks.set(port, links); } }
  private removeNavigationContribution(chunkKey: string, contribution: NavigationContribution) { this.navigationContributions.delete(chunkKey); this.count(this.navCounts.road, contribution.road, this.navigationIndex.roadTileKeys, -1); this.count(this.navCounts.bridge, contribution.bridge, this.navigationIndex.bridgeTileKeys, -1); this.count(this.navCounts.waterRoute, contribution.waterRoute, this.navigationIndex.waterRouteTileKeys, -1); this.count(this.navCounts.port, contribution.port, this.navigationIndex.portTileKeys, -1); this.count(this.navCounts.blocked, contribution.blocked, this.navigationIndex.blockedTileKeys, -1); for (const [port, water] of contribution.links) { const links = this.navigationIndex.portLinks.get(port); links?.delete(water); if (links?.size === 0) this.navigationIndex.portLinks.delete(port); } }
  private go(screenX: number, screenY: number) { const worldX = Math.round((screenX - this.app.screen.width / 2) / TILE_SIZE + this.px); const worldY = Math.round((screenY - this.app.screen.height / 2) / TILE_SIZE + this.py); const target = tileAt(this.seed, worldX, worldY); const start = tileAt(this.seed, Math.round(this.px), Math.round(this.py)); const navigation = this.navigation(); this.path = findPath(this.seed, start, target, undefined, navigation); const endpoint = this.path.at(-1) ?? target; this.marker.clear(); this.marker.circle(0, 0, 8).fill({ color: this.path.length ? 0xf4c86a : 0xc96855, alpha: .9 }); this.marker.position.set((endpoint.x + 0.5) * TILE_SIZE, (endpoint.y + 0.5) * TILE_SIZE); this.onStatus(this.path.length && navigation.waterRouteTileKeys.has(key(this.path[0].x, this.path[0].y)) ? 'Sailing' : this.path.length ? 'Walking' : 'Blocked terrain'); }
  getNearbySettlements(radius = 1, limit = 5): Promise<NearbySettlementResult> { return this.provider.getNearbySettlements(Math.round(this.px), Math.round(this.py), radius, limit); }
  async transportTo(destination: NearbySettlement) {
    const chunkCoordinate = worldToChunk(destination.gateX, destination.gateY); this.path = []; this.marker.clear(); this.onStatus(`Travelling to ${destination.name}`);
    try {
      const chunk = await this.provider.getChunk(chunkCoordinate.cx, chunkCoordinate.cy); if (this.destroyed) return;
      this.px = destination.gateX; this.py = destination.gateY; this.drawChunk(chunk, this.detailFor(chunk)); this.lastTileDebugSignature = ''; this.streamDirty = true; this.render(); this.onStatus(`Arrived at ${destination.name}`);
    } catch { if (!this.destroyed) this.onStatus('Travel delayed'); }
  }
  private adventurerLod(adventurer: Adventurer, bounds: ReturnType<Game['visibleBounds']>): AdventurerLod {
    const point = adventurer;
    const cx = Math.floor(point.x / CHUNK_SIZE); const cy = Math.floor(point.y / CHUNK_SIZE); const distanceX = cx < bounds.minChunkX ? bounds.minChunkX - cx : cx > bounds.maxChunkX ? cx - bounds.maxChunkX : 0; const distanceY = cy < bounds.minChunkY ? bounds.minChunkY - cy : cy > bounds.maxChunkY ? cy - bounds.maxChunkY : 0; const ring = Math.max(distanceX, distanceY);
    return ring <= 1 ? 'live' : ring === 2 ? 'coarse' : ring === 3 ? 'sparse' : 'sleeping';
  }

  private refreshAdventurerTopology() {
    const region = worldToRegion(Math.floor(this.px), Math.floor(this.py)); const cell = roadGraphCell(region.rx, region.ry); const requestKey = `${cell.gx},${cell.gy}`; if (requestKey === this.adventurerTopologyKey || this.adventurerTopologyPromise) return;
    this.adventurerTopologyKey = requestKey; this.adventurerTopologyPromise = this.provider.getTravelTopology(cell.gx, cell.gy, 1).then((topology) => { if (this.destroyed) return; this.adventurerTopology = topology; for (const settlement of topology.settlements) { const adventurer = createAdventurer(settlement, 0); if (adventurer && !this.adventurers.has(adventurer.id)) { if (this.gameTime > 0) advanceAdventurer(adventurer, topology, this.gameTime, this.seed); this.adventurers.set(adventurer.id, adventurer); } } const gcx = Math.floor(this.px / GOBLIN_CELL_SIZE); const gcy = Math.floor(this.py / GOBLIN_CELL_SIZE); for (let y = gcy - 1; y <= gcy + 1; y++) for (let x = gcx - 1; x <= gcx + 1; x++) { const goblin = createGoblin(this.seed, x, y, topology.settlements, this.gameTime); if (goblin && !this.goblins.has(goblin.id)) this.goblins.set(goblin.id, goblin); } }).catch(() => undefined).finally(() => { this.adventurerTopologyPromise = null; });
  }

  private simulateAdventurers(stepSeconds: number) {
    this.refreshAdventurerTopology(); if (!this.adventurerTopology) return; const bounds = this.visibleBounds();
    for (const adventurer of this.adventurers.values()) { const target = [...this.goblins.values()].map((goblin) => ({ goblin, distance: Math.hypot(goblin.x - adventurer.x, goblin.y - adventurer.y) })).filter((candidate) => candidate.distance <= 8).sort((a, b) => a.distance - b.distance || a.goblin.id.localeCompare(b.goblin.id))[0]; if (target && adventurer.state !== 'fighting') pursueGoblin(adventurer, target.goblin, this.gameTime, this.seed); adventurer.lod = this.adventurerLod(adventurer, bounds); const phase = adventurer.tickPhase; const due = adventurer.lod === 'live' || (adventurer.lod === 'coarse' && this.simulationStep % 5 === phase % 5) || (adventurer.lod === 'sparse' && this.simulationStep % 30 === phase % 30); if (due) advanceAdventurer(adventurer, this.adventurerTopology, this.gameTime, this.seed); }
    const adventurerPoints = [...this.adventurers.values()].map((adventurer) => ({ id: adventurer.id, x: adventurer.x, y: adventurer.y, state: adventurer.state }));
    for (const goblin of this.goblins.values()) { const point = { x: goblin.x, y: goblin.y }; const cx = Math.floor(point.x / CHUNK_SIZE); const cy = Math.floor(point.y / CHUNK_SIZE); const ring = Math.max(cx < bounds.minChunkX ? bounds.minChunkX - cx : cx > bounds.maxChunkX ? cx - bounds.maxChunkX : 0, cy < bounds.minChunkY ? bounds.minChunkY - cy : cy > bounds.maxChunkY ? cy - bounds.maxChunkY : 0); goblin.lod = ring <= 1 ? 'live' : ring === 2 ? 'coarse' : ring === 3 ? 'sparse' : 'sleeping'; const phase = goblin.tickPhase; const due = goblin.lod === 'live' || (goblin.lod === 'coarse' && this.simulationStep % 5 === phase % 5) || (goblin.lod === 'sparse' && this.simulationStep % 30 === phase % 30); if (due) advanceGoblin(goblin, { seed: this.seed, settlements: this.adventurerTopology.settlements, player: { x: this.px, y: this.py }, adventurers: adventurerPoints, gameTime: this.gameTime }, Math.max(0, this.gameTime - goblin.lastSimTime)); }
    for (const goblin of this.goblins.values()) for (const adventurer of this.adventurers.values()) if (sweptContact(goblin, adventurer)) { goblin.state = 'fighting'; goblin.targetAdventurerId = adventurer.id; adventurer.state = 'fighting'; adventurer.targetGoblinId = goblin.id; }
    void stepSeconds;
  }

  private simulationStep = 0;

  private tick(dt: number) { const start = performance.now(); this.elapsed += dt; const simulationDt = dt > 0.25 ? 0 : dt; this.simAccumulator += simulationDt; let steps = 0; while (this.simAccumulator >= 0.1 && steps++ < 5) { this.simAccumulator -= 0.1; this.gameTime += 0.1; this.simulationStep++; this.simulateAdventurers(0.1); } if (steps >= 5) this.simAccumulator = 0; let heading = 0; if (this.path.length) { const target = this.path[0]; const dx = target.x - this.px; const dy = target.y - this.py; const distance = Math.hypot(dx, dy); heading = Math.atan2(dy, dx); const amount = dt * 4.2; if (distance <= amount) { this.px = target.x; this.py = target.y; this.path.shift(); } else { this.px += (dx / distance) * amount; this.py += (dy / distance) * amount; } const water = this.navigationIndex.waterRouteTileKeys.has(key(Math.round(this.px), Math.round(this.py))); this.hero.visible = !water; this.boat.visible = water; this.onStatus(this.path.length ? water ? 'Sailing' : 'Walking' : 'Exploring the Emberwild'); } const moving = this.path.length > 0; applyActorMotion(this.hero, actorMotion(moving, heading, this.elapsed, 0)); const bob = moving ? 0 : Math.sin(this.elapsed * 2) * 0.45; this.hero.figure.y = bob; this.boat.y = bob; this.boat.rotation = Math.max(-0.12, Math.min(0.12, heading * 0.08)); this.render(); this.performance.recordFrame(performance.now() - start); }

  private renderAdventurers() {
    const bounds = this.visibleBounds(); const visible = new Set<string>();
    for (const adventurer of this.adventurers.values()) {
      const sampled = sampleAdventurer(adventurer); const point = adventurer;
      if (point.x < bounds.minX || point.x > bounds.maxX || point.y < bounds.minY || point.y > bounds.maxY) continue;
      visible.add(adventurer.id); let node = this.adventurerNodes.get(adventurer.id); if (!node) { node = createActorSprite('adventurer', variantForId(adventurer.id)); this.adventurerNodes.set(adventurer.id, node); this.adventurerLayer.addChild(node); this.adventurerLayerDirty = true; }
      const normalX = sampled ? -Math.sin(sampled.rotation) : 0; const normalY = sampled ? Math.cos(sampled.rotation) : 0; const side = adventurer.id.charCodeAt(adventurer.id.length - 1) % 2 ? 1 : -1; const offset = sampled ? Math.min(0.1, sampled.width * 0.04) * side : 0;
      const x = point.x + normalX * offset + 0.5; const y = point.y + normalY * offset + 0.5; node.position.set(x * TILE_SIZE, y * TILE_SIZE); const moving = Boolean(sampled && (adventurer.state === 'travelling' || adventurer.state === 'exploring') && adventurer.plan); const heading = sampled?.rotation ?? 0; applyActorMotion(node, actorMotion(moving, heading, this.elapsed, variantForId(adventurer.id).phase)); const zIndex = y * TILE_SIZE; if (node.zIndex !== zIndex) this.adventurerLayerDirty = true; node.zIndex = zIndex; node.visible = true;
    }
    for (const [id, node] of this.adventurerNodes) if (!visible.has(id)) { this.adventurerLayer.removeChild(node); node.destroy({ children: true }); this.adventurerNodes.delete(id); this.adventurerLayerDirty = true; }
    if (this.adventurerLayerDirty) { this.adventurerLayer.sortChildren(); this.adventurerLayerDirty = false; }
  }
  private renderGoblins() {
    const bounds = this.visibleBounds(); const visible = new Set<string>();
    for (const goblin of this.goblins.values()) {
      if (goblin.x < bounds.minX || goblin.x > bounds.maxX || goblin.y < bounds.minY || goblin.y > bounds.maxY) continue;
      visible.add(goblin.id); let node = this.goblinNodes.get(goblin.id); if (!node) { node = createActorSprite('goblin', variantForId(goblin.id)); this.goblinNodes.set(goblin.id, node); this.goblinLayer.addChild(node); this.goblinLayerDirty = true; }
      const dx = goblin.x - goblin.previousX; const dy = goblin.y - goblin.previousY; const moving = Math.hypot(dx, dy) > 1e-4 && goblin.state !== 'fighting'; const heading = moving ? Math.atan2(dy, dx) : 0; const x = goblin.x + 0.5; const y = goblin.y + 0.5; node.position.set(x * TILE_SIZE, y * TILE_SIZE); applyActorMotion(node, actorMotion(moving, heading, this.elapsed, variantForId(goblin.id).phase)); const zIndex = y * TILE_SIZE; if (node.zIndex !== zIndex) this.goblinLayerDirty = true; node.zIndex = zIndex; node.visible = true;
    }
    for (const [id, node] of this.goblinNodes) if (!visible.has(id)) { this.goblinLayer.removeChild(node); node.destroy({ children: true }); this.goblinNodes.delete(id); this.goblinLayerDirty = true; }
    if (this.goblinLayerDirty) { this.goblinLayer.sortChildren(); this.goblinLayerDirty = false; }
  }
  private render() { const centerX = this.app.screen.width / 2; const centerY = this.app.screen.height / 2; const cameraX = centerX - this.px * TILE_SIZE; const cameraY = centerY - this.py * TILE_SIZE; this.world.position.set(cameraX, cameraY); this.mapOverlay.position.set(cameraX, cameraY); this.actor.position.set(centerX + TILE_SIZE / 2, centerY + TILE_SIZE * 2 / 3 - HERO_FEET_OFFSET); const bounds = this.visibleBounds(); const signature = `${bounds.minChunkX},${bounds.maxChunkX},${bounds.minChunkY},${bounds.maxChunkY}`; if (this.streamDirty || signature !== this.lastStreamBounds) { this.streamDirty = false; this.lastStreamBounds = signature; this.syncStreaming(bounds); } this.renderAdventurers(); this.renderGoblins(); const now = performance.now(); if (now - this.lastDebugAt >= 250) { this.lastDebugAt = now; this.publishTileDebug(); } if (now - this.lastMetricsAt >= 1000) { this.lastMetricsAt = now; this.performance.setDisplayObjects(this.world.children.reduce((count, child) => count + child.children.length + 1, 0)); } }
  private publishTileDebug() { const x = Math.round(this.px); const y = Math.round(this.py); const chunk = this.displays.get(key(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE)))?.chunk; const signature = `${x},${y}:${chunk ? `${chunk.cx},${chunk.cy}` : 'pending'}`; if (signature === this.lastTileDebugSignature) return; this.lastTileDebugSignature = signature; this.onTileDebug(tileDebugInfo(tileAt(this.seed, x, y), chunk)); }
  private visibleBounds() { return visibleWorldBounds({ x: this.px, y: this.py }, this.app.screen); }
  private syncStreaming(bounds: ChunkBounds) { const plan = streamingPlan(bounds, { cx: Math.floor(this.px / CHUNK_SIZE), cy: Math.floor(this.py / CHUNK_SIZE) });
    for (const [chunkKey, display] of this.displays) if (!plan.visible.has(chunkKey)) this.evict(chunkKey, display);
    for (const chunkKey of [...this.prefetched.keys()]) if (!plan.visible.has(chunkKey) && !plan.preload.has(chunkKey)) { this.prefetched.delete(chunkKey); const contribution = this.navigationContributions.get(chunkKey); if (contribution) this.removeNavigationContribution(chunkKey, contribution); }
    for (const chunkKey of plan.visible) { const chunk = this.prefetched.get(chunkKey); if (chunk) { this.prefetched.delete(chunkKey); this.drawChunk(chunk, this.detailFor(chunk)); } }
    for (const display of this.displays.values()) this.updateDetail(display, this.detailFor(display.chunk)); this.scheduler.setPlan(plan);
  }
  private detailFor(chunk: WorldChunk): Detail { const playerChunkX = Math.floor(this.px / CHUNK_SIZE); const playerChunkY = Math.floor(this.py / CHUNK_SIZE); const distance = Math.max(Math.abs(chunk.cx - playerChunkX), Math.abs(chunk.cy - playerChunkY)); return distance <= 1 ? 'full' : distance <= 2 ? 'medium' : 'terrain'; }
  private async loadChunk(request: StreamRequest) { const started = performance.now(); const chunk = await this.provider.getChunk(request.cx, request.cy); this.performance.recordChunk(performance.now() - started); return chunk; }
  private receiveChunk(chunk: WorldChunk, preload: boolean) { this.indexChunk(chunk, true); if (preload) this.prefetched.set(key(chunk.cx, chunk.cy), chunk); else this.drawChunk(chunk, this.detailFor(chunk)); }
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
  private drawChunk(chunk: WorldChunk, detail: Detail) { const chunkKey = key(chunk.cx, chunk.cy); const existing = this.displays.get(chunkKey); if (existing) { this.indexChunk(chunk, true); existing.chunk = chunk; this.updateDetail(existing, detail); this.lastTileDebugSignature = ''; return; } this.indexChunk(chunk, true); const texture = this.drawTerrain(chunk); const terrain = new Sprite(texture); terrain.position.set(chunk.cx * CHUNK_SIZE * TILE_SIZE, chunk.cy * CHUNK_SIZE * TILE_SIZE); const roadLayer = new Container(); const citySurfaceLayer = new Container(); const display: ChunkDisplay = { chunk, terrain, texture, roadLayer, citySurfaceLayer, objectNodes: [], detail: null }; this.insertChunkLayer(this.terrainLayer, terrain, chunkKey); this.insertChunkLayer(this.roadLayer, roadLayer, chunkKey); this.insertChunkLayer(this.citySurfaceLayer, citySurfaceLayer, chunkKey); this.displays.set(chunkKey, display); this.updateDetail(display, detail); this.lastTileDebugSignature = ''; if (!this.initialTerrainMarked) { this.initialTerrainMarked = true; performance.mark('emberwild-first-terrain-ready'); } }
  private insertChunkLayer(layer: Container, child: RenderNode, chunkKey: string) { const index = layer.children.findIndex((existing) => (this.chunkLayerKeys.get(existing as Container) ?? '').localeCompare(chunkKey) > 0); this.chunkLayerKeys.set(child as Container, chunkKey); layer.addChildAt(child, index < 0 ? layer.children.length : index); }
  private captureObjects(display: ChunkDisplay, draw: () => void) { const before = this.objectLayer.children.length; draw(); display.objectNodes.push(...this.objectLayer.children.slice(before)); }
  private clearObjects(display: ChunkDisplay) { for (const node of display.objectNodes) { this.objectLayer.removeChild(node); node.destroy(); } display.objectNodes = []; }
  private updateDetail(display: ChunkDisplay, detail: Detail) {
    if (display.detail === detail) return; display.detail = detail; display.roadLayer.removeChildren().forEach((child) => child.destroy()); display.citySurfaceLayer.removeChildren().forEach((child) => child.destroy()); this.clearObjects(display); if (detail === 'terrain') return; const { chunk, roadLayer, citySurfaceLayer } = display; const bounds = { minX: chunk.cx * CHUNK_SIZE, minY: chunk.cy * CHUNK_SIZE, maxX: chunk.cx * CHUNK_SIZE + CHUNK_SIZE - 1, maxY: chunk.cy * CHUNK_SIZE + CHUNK_SIZE - 1 };
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
    for (const road of [...composition.roads].reverse()) drawRoad(roadLayer, road.points, road.width, road.color);
    const drawnPorts = new Map<string, Array<{ x: number; y: number }>>();
    for (const road of chunk.roads) {
      for (const route of road.waterRoutes) drawWaterRoute(roadLayer, route.points, route.width);
      for (const port of road.ports) { const portKey = key(port.x, port.y); drawnPorts.set(portKey, [...(drawnPorts.get(portKey) ?? []), ...port.waterTiles]); }
    }
    for (const [portKey, waterTiles] of drawnPorts) { const [x, y] = portKey.split(',').map(Number); this.captureObjects(display, () => drawPort(this.objectLayer, x, y, waterTiles)); }
    if (detail === 'full') for (const layout of chunk.settlementLayouts) for (const square of layout.plazas) drawPlaza(citySurfaceLayer, square, bounds);
    if (detail === 'medium') { for (const settlement of chunk.settlements) this.captureObjects(display, () => { const g = new Graphics().moveTo(settlement.x * TILE_SIZE, settlement.y * TILE_SIZE - 10).lineTo(settlement.x * TILE_SIZE + 8, settlement.y * TILE_SIZE + 4).lineTo(settlement.x * TILE_SIZE - 8, settlement.y * TILE_SIZE + 4).fill({ color: 0xe8c67b, alpha: 0.72 }); g.zIndex = settlement.y * TILE_SIZE; this.objectLayer.addChild(g); }); for (const layout of chunk.settlementLayouts) if (layout.fortification) this.captureObjects(display, () => drawFortification(this.objectLayer, layout.fortification!, { minX: chunk.cx * CHUNK_SIZE, minY: chunk.cy * CHUNK_SIZE, maxX: chunk.cx * CHUNK_SIZE + CHUNK_SIZE - 1, maxY: chunk.cy * CHUNK_SIZE + CHUNK_SIZE - 1 })); }
    if (detail !== 'full') return;
    const intramural = new Set(chunk.settlementLayouts.flatMap((layout) => layout.fortification?.intramuralTiles ?? []).map((tile) => key(tile.x, tile.y)));
    for (const tile of chunk.tiles) { const density = this.variation('props', tile.x, tile.y); if (tile.road || intramural.has(key(tile.x, tile.y))) continue; if (tile.landmark && tile.walkable) this.captureObjects(display, () => drawLandmark(this.objectLayer, tile)); else if (tile.walkable && tile.biome === 'forest' && density > 0.89) this.captureObjects(display, () => drawTree(this.objectLayer, tile.x, tile.y, density)); else if (tile.walkable && (tile.biome === 'grassland' || tile.biome === 'swamp') && density > 0.9775) this.captureObjects(display, () => drawTree(this.objectLayer, tile.x, tile.y, 0.7)); }
    for (const layout of chunk.settlementLayouts) { if (layout.fortification) this.captureObjects(display, () => drawFortification(this.objectLayer, layout.fortification!, bounds)); for (const building of layout.buildings) if (building.x >= bounds.minX && building.x <= bounds.maxX && building.y >= bounds.minY && building.y <= bounds.maxY) this.captureObjects(display, () => drawBuilding(this.objectLayer, building)); for (const edge of layout.edgeFeatures) if (edge.x <= bounds.maxX && edge.x + edge.width - 1 >= bounds.minX && edge.y <= bounds.maxY && edge.y + edge.height - 1 >= bounds.minY) this.captureObjects(display, () => drawEdgeFeature(this.objectLayer, edge)); }
    this.objectLayer.sortChildren();
  }
  private evict(chunkKey: string, display: ChunkDisplay) { this.terrainLayer.removeChild(display.terrain); this.roadLayer.removeChild(display.roadLayer); this.citySurfaceLayer.removeChild(display.citySurfaceLayer); display.roadLayer.destroy({ children: true }); display.citySurfaceLayer.destroy({ children: true }); this.clearObjects(display); display.terrain.destroy(); display.texture.destroy(true); this.displays.delete(chunkKey); const contribution = this.navigationContributions.get(chunkKey); if (contribution) this.removeNavigationContribution(chunkKey, contribution); }
  private resize = () => { this.app.stage.hitArea = this.app.screen; this.streamDirty = true; this.render(); };
  destroy() { this.destroyed = true; this.scheduler.stop(); window.removeEventListener('resize', this.resize); for (const [chunkKey, display] of this.displays) this.evict(chunkKey, display); this.prefetched.clear(); void this.provider.dispose(); this.app.destroy(true, { children: true }); }
}
