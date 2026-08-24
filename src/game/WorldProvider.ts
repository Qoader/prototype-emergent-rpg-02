import { chunkAt, CHUNK_SIZE, REGION_CHUNK_SIZE, regionKey, findStartingPosition, worldToRegion, type WorldChunk, type WorldConfig } from './world';
import { featureIntersectsBounds, generateRegion, type LandmarkAnchor, type NearbySettlementResult, type RegionData, type ResourceAnchor, type RoadEndpoint, type SettlementShell } from './regions';
import { generateSettlementLayout, layoutIntersectsBounds, settlementLayoutBounds, type SettlementLayout } from './settlements';
import { generateRoadCell, generateStarterRoad, roadSegmentIntersectsBounds, ROAD_NETWORK_VERSION, roadGraphCell, starterClaimsForCell, type RoadNetwork, type RoadSegment } from './roads';
import { LruCache } from './LruCache';

export interface WorldProviderOptions { chunkCapacity?: number; regionCapacity?: number; roadCapacity?: number; layoutCapacity?: number; }
export interface WorldProviderStats { chunks: { size: number; hits: number; misses: number }; regions: { size: number; hits: number; misses: number }; roads: { size: number; hits: number; misses: number }; layouts: { size: number; hits: number; misses: number }; inFlightChunks: number; inFlightRegions: number; inFlightRoads: number; inFlightLayouts: number; }

function uniqueById<T>(items: T[], getId: (item: T) => string = (item) => (item as T & { id: string }).id) { return [...new Map(items.map((item) => [getId(item), item])).values()].sort((a, b) => getId(a).localeCompare(getId(b))); }
function regionRequests(cx: number, cy: number) { const regionX = Math.floor(cx / REGION_CHUNK_SIZE); const regionY = Math.floor(cy / REGION_CHUNK_SIZE); const localX = ((cx % REGION_CHUNK_SIZE) + REGION_CHUNK_SIZE) % REGION_CHUNK_SIZE; const localY = ((cy % REGION_CHUNK_SIZE) + REGION_CHUNK_SIZE) % REGION_CHUNK_SIZE; const offsets = new Set<string>(['0,0']); if (localX <= 3) for (let dy = -1; dy <= 1; dy++) offsets.add(`-1,${dy}`); if (localX >= REGION_CHUNK_SIZE - 4) for (let dy = -1; dy <= 1; dy++) offsets.add(`1,${dy}`); if (localY <= 3) for (let dx = -1; dx <= 1; dx++) offsets.add(`${dx},-1`); if (localY >= REGION_CHUNK_SIZE - 4) for (let dx = -1; dx <= 1; dx++) offsets.add(`${dx},1`); return [...offsets].sort().map((value) => { const [dx, dy] = value.split(',').map(Number); return { rx: regionX + dx, ry: regionY + dy }; }); }

export class WorldProvider {
  private chunks: LruCache<WorldChunk>;
  private regions: LruCache<RegionData>;
  private roads: LruCache<RoadNetwork>;
  private roadCells: LruCache<RoadSegment[]>;
  private layouts: LruCache<SettlementLayout>;
  private inFlightChunks = new Map<string, Promise<WorldChunk>>();
  private inFlightRegions = new Map<string, Promise<RegionData>>();
  private inFlightRoads = new Map<string, Promise<RoadNetwork>>();
  private inFlightRoadCells = new Map<string, Promise<RoadSegment[]>>();
  private starterRoad?: RoadSegment[];
  private inFlightStarterRoad?: Promise<RoadSegment[]>;
  private inFlightLayouts = new Map<string, Promise<SettlementLayout>>();
  constructor(private config: WorldConfig, options: WorldProviderOptions = {}) { this.chunks = new LruCache(options.chunkCapacity ?? 64); this.regions = new LruCache(options.regionCapacity ?? 16); this.roads = new LruCache(options.roadCapacity ?? 16); this.roadCells = new LruCache(options.roadCapacity ?? 16); this.layouts = new LruCache(options.layoutCapacity ?? 32); }

  getRoadNetwork(rx: number, ry: number): Promise<RoadNetwork> {
    const key = `${this.config.seed}:v${this.config.version}:roads-v${ROAD_NETWORK_VERSION}:${rx},${ry}`; const cached = this.roads.get(key); if (cached) return Promise.resolve(cached);
    const existing = this.inFlightRoads.get(key); if (existing) return existing;
    const coordinates: Array<{ rx: number; ry: number }> = [];
    const cell = roadGraphCell(rx, ry); const cellKey = `${this.config.seed}:v${this.config.version}:roads-cell:${cell.gx},${cell.gy}`;
    const firstRx = cell.gx * 4; const firstRy = cell.gy * 4;
    for (let y = firstRy; y < firstRy + 4; y++) for (let x = firstRx; x < firstRx + 4; x++) coordinates.push({ rx: x, ry: y });
    const regionSource = Promise.all(coordinates.map((coordinate) => this.getRegion(coordinate.rx, coordinate.ry)));
    const starterSource = this.getStarterRoad();
    const cellGenerated = Promise.resolve(this.roadCells.get(cellKey) ?? this.inFlightRoadCells.get(cellKey) ?? Promise.all([regionSource, starterSource]).then(([regions, starterRoad]) => generateRoadCell(this.config, regions, cell.gx, cell.gy, starterClaimsForCell(starterRoad, cell.gx, cell.gy)).segments).then((segments) => { this.roadCells.set(cellKey, segments); return segments; }).finally(() => this.inFlightRoadCells.delete(cellKey)));
    if (!this.roadCells.get(cellKey) && !this.inFlightRoadCells.has(cellKey)) this.inFlightRoadCells.set(cellKey, cellGenerated);
    const request = Promise.resolve(cellGenerated).then((segments) => { const network = { key: { rx, ry }, nodes: [], segments: segments.filter((segment) => segment.ownerRegion.rx === rx && segment.ownerRegion.ry === ry) }; this.roads.set(key, network); return network; }).finally(() => this.inFlightRoads.delete(key)); this.inFlightRoads.set(key, request); return request;
  }

  getRegion(rx: number, ry: number): Promise<RegionData> {
    const key = regionKey({ ...this.config, rx, ry }); const cached = this.regions.get(key); if (cached) return Promise.resolve(cached);
    const existing = this.inFlightRegions.get(key); if (existing) return existing;
    const request = Promise.resolve().then(() => generateRegion(this.config, rx, ry)).then((region) => { this.regions.set(key, region); return region; }).finally(() => this.inFlightRegions.delete(key));
    this.inFlightRegions.set(key, request); return request;
  }

  async getNearbySettlements(x: number, y: number, radius = 1, limit = 5): Promise<NearbySettlementResult> {
    const origin = worldToRegion(x, y); const regions: RegionData[] = [];
    for (let ry = origin.ry - radius; ry <= origin.ry + radius; ry++) for (let rx = origin.rx - radius; rx <= origin.rx + radius; rx++) regions.push(await this.getRegion(rx, ry));
    const settlements = [...new Map(regions.flatMap((region) => region.settlements).map((settlement) => [settlement.id, settlement])).values()];
    const result = settlements.map((settlement) => {
      const gate = settlement.accessPoints.slice().sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y) || a.id.localeCompare(b.id))[0];
      return gate ? { id: settlement.id, name: settlement.name, type: settlement.type, x: settlement.x, y: settlement.y, gateX: gate.x, gateY: gate.y, distance: Math.hypot(settlement.x - x, settlement.y - y) } : undefined;
    }).filter((value): value is NonNullable<typeof value> => Boolean(value)).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id)).slice(0, limit);
    return { settlements: result, searchedRadius: radius, complete: settlements.length >= limit };
  }

  private getStarterRoad(): Promise<RoadSegment[]> {
    if (this.starterRoad) return Promise.resolve(this.starterRoad);
    if (this.inFlightStarterRoad) return this.inFlightStarterRoad;
    const start = findStartingPosition(this.config); const origin = worldToRegion(start.x, start.y);
    const regions: Promise<RegionData>[] = [];
    // The procedural settlement spacing and candidate density make this ring
    // sufficient for normal worlds while keeping the first chunk bounded.
    for (let ry = origin.ry - 2; ry <= origin.ry + 2; ry++) for (let rx = origin.rx - 2; rx <= origin.rx + 2; rx++) regions.push(this.getRegion(rx, ry));
    this.inFlightStarterRoad = Promise.all(regions).then((data) => generateStarterRoad(this.config, start, data)).then((roads) => { this.starterRoad = roads; return roads; }).finally(() => { this.inFlightStarterRoad = undefined; });
    return this.inFlightStarterRoad;
  }

  private getSettlementLayout(shell: SettlementShell) {
    const key = `${this.config.seed}:v${this.config.version}:layout:${shell.id}`; const cached = this.layouts.get(key); if (cached) return Promise.resolve(cached);
    const existing = this.inFlightLayouts.get(key); if (existing) return existing;
    const request = Promise.resolve().then(() => generateSettlementLayout(this.config, shell)).then((layout) => { this.layouts.set(key, layout); return layout; }).finally(() => this.inFlightLayouts.delete(key));
    this.inFlightLayouts.set(key, request); return request;
  }

  getChunk(cx: number, cy: number): Promise<WorldChunk> {
    const key = `${this.config.seed}:v${this.config.version}:chunk:${cx},${cy}`; const cached = this.chunks.get(key); if (cached) return Promise.resolve(cached);
    const existing = this.inFlightChunks.get(key); if (existing) return existing;
    const request = Promise.resolve().then(async () => {
      const chunk = chunkAt(this.config, cx, cy); const minX = cx * CHUNK_SIZE; const minY = cy * CHUNK_SIZE; const bounds = { minX, minY, maxX: minX + CHUNK_SIZE - 1, maxY: minY + CHUNK_SIZE - 1 }; const regions = await Promise.all(regionRequests(cx, cy).map((coordinate) => this.getRegion(coordinate.rx, coordinate.ry)));
      const roadNetworks = await Promise.all([this.getRoadNetwork(Math.floor(cx / REGION_CHUNK_SIZE), Math.floor(cy / REGION_CHUNK_SIZE))]); const starterRoad = await this.getStarterRoad(); const settlements: SettlementShell[] = []; const settlementLayouts: SettlementLayout[] = []; const landmarks: LandmarkAnchor[] = []; const resources: ResourceAnchor[] = []; const roadEndpoints: RoadEndpoint[] = []; const layoutRequests: Promise<SettlementLayout>[] = [];
      const roads = [...roadNetworks.flatMap((network) => network.segments), ...starterRoad].filter((segment, index, all) => all.findIndex((other) => other.id === segment.id) === index).filter((segment) => roadSegmentIntersectsBounds(segment, bounds));
      for (const region of regions) { for (const shell of region.settlements) { if (featureIntersectsBounds(shell, bounds, shell.radius)) settlements.push(shell); if (layoutIntersectsBounds({ bounds: settlementLayoutBounds(shell) }, bounds)) layoutRequests.push(this.getSettlementLayout(shell)); } for (const landmark of region.landmarks) if (featureIntersectsBounds(landmark, bounds, 8)) landmarks.push(landmark); for (const resource of region.resources) if (featureIntersectsBounds(resource, bounds, 8)) resources.push(resource); for (const endpoint of region.roadEndpoints) if (featureIntersectsBounds(endpoint, bounds, 8)) roadEndpoints.push(endpoint); }
      for (const layout of await Promise.all(layoutRequests)) if (layoutIntersectsBounds(layout, bounds)) settlementLayouts.push(layout);
      const roadTiles = new Set<string>();
      for (const road of roads) for (const tile of road.tiles) if (tile.x >= bounds.minX && tile.x <= bounds.maxX && tile.y >= bounds.minY && tile.y <= bounds.maxY) roadTiles.add(`${tile.x},${tile.y}`);
      for (const layout of settlementLayouts) for (const street of layout.streets) for (const tile of street.tiles) if (tile.x >= bounds.minX && tile.x <= bounds.maxX && tile.y >= bounds.minY && tile.y <= bounds.maxY) roadTiles.add(`${tile.x},${tile.y}`);
      const blockedTiles = new Set<string>(); const gateTiles = new Set<string>(); const intramuralTiles = new Set<string>(); const buildingTiles = new Set<string>(); const plazaTiles = new Set<string>();
      for (const layout of settlementLayouts) for (const plaza of layout.plazas) for (const tile of plaza.tiles) if (tile.x >= bounds.minX && tile.x <= bounds.maxX && tile.y >= bounds.minY && tile.y <= bounds.maxY) plazaTiles.add(`${tile.x},${tile.y}`);
      for (const layout of settlementLayouts) if (layout.fortification) { for (const tile of layout.fortification.wallTiles) if (tile.x >= bounds.minX && tile.x <= bounds.maxX && tile.y >= bounds.minY && tile.y <= bounds.maxY) blockedTiles.add(`${tile.x},${tile.y}`); for (const gate of layout.fortification.gates) gateTiles.add(`${gate.x},${gate.y}`); for (const tile of layout.fortification.intramuralTiles) if (tile.x >= bounds.minX && tile.x <= bounds.maxX && tile.y >= bounds.minY && tile.y <= bounds.maxY) intramuralTiles.add(`${tile.x},${tile.y}`); }
      for (const gate of gateTiles) blockedTiles.delete(gate);
      for (const layout of settlementLayouts) if (layout.fortification) for (const building of layout.buildings) { const tileKey = `${building.x},${building.y}`; if (intramuralTiles.has(tileKey) && building.x >= bounds.minX && building.x <= bounds.maxX && building.y >= bounds.minY && building.y <= bounds.maxY) buildingTiles.add(tileKey); }
      const portTiles = new Set<string>(); const waterRouteTiles = new Set<string>();
      for (const road of roads) { for (const port of road.ports) portTiles.add(`${port.x},${port.y}`); for (const route of road.waterRoutes) for (const tile of route.tiles) waterRouteTiles.add(`${tile.x},${tile.y}`); }
      const composedTiles = chunk.tiles.map((tile) => { const tileKey = `${tile.x},${tile.y}`; const port = portTiles.has(tileKey); const waterRoute = waterRouteTiles.has(tileKey); const plaza = plazaTiles.has(tileKey); const road = roadTiles.has(tileKey) || gateTiles.has(tileKey); const blocked = !port && !plaza && (blockedTiles.has(tileKey) || (buildingTiles.has(tileKey) && !road)); if (!road && !blocked && !intramuralTiles.has(tileKey) && !plaza && !port && !waterRoute) return tile; return { ...tile, road, port, waterRoute, walkable: port || plaza ? true : blocked ? false : tile.walkable, movementCost: port || plaza ? 1 : blocked ? Infinity : tile.movementCost, landmark: road || plaza || port || waterRoute || intramuralTiles.has(tileKey) ? (tile.landmark === 'tree' ? null : tile.landmark) : tile.landmark }; });
      return { ...chunk, tiles: composedTiles, settlements: uniqueById(settlements), settlementLayouts: uniqueById(settlementLayouts, (layout) => layout.settlementId), landmarks: uniqueById(landmarks), resources: uniqueById(resources), roadEndpoints: uniqueById(roadEndpoints), roads: uniqueById(roads) };
    }).then((chunk) => { this.chunks.set(key, chunk); return chunk; }).finally(() => this.inFlightChunks.delete(key));
    this.inFlightChunks.set(key, request); return request;
  }

  clear() { this.chunks.clear(); this.regions.clear(); this.roads.clear(); this.roadCells.clear(); this.layouts.clear(); this.starterRoad = undefined; this.inFlightStarterRoad = undefined; this.inFlightChunks.clear(); this.inFlightRegions.clear(); this.inFlightRoads.clear(); this.inFlightRoadCells.clear(); this.inFlightLayouts.clear(); }
  stats(): WorldProviderStats { return { chunks: { size: this.chunks.size, hits: this.chunks.hits, misses: this.chunks.misses }, regions: { size: this.regions.size, hits: this.regions.hits, misses: this.regions.misses }, roads: { size: this.roads.size, hits: this.roads.hits, misses: this.roads.misses }, layouts: { size: this.layouts.size, hits: this.layouts.hits, misses: this.layouts.misses }, inFlightChunks: this.inFlightChunks.size, inFlightRegions: this.inFlightRegions.size, inFlightRoads: this.inFlightRoads.size, inFlightLayouts: this.inFlightLayouts.size }; }
}
