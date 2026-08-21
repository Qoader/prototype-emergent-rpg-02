import { chunkAt, CHUNK_SIZE, REGION_CHUNK_SIZE, regionKey, type WorldChunk, type WorldConfig } from './world';
import { featureIntersectsBounds, generateRegion, type LandmarkAnchor, type RegionData, type ResourceAnchor, type RoadEndpoint, type SettlementShell } from './regions';
import { generateSettlementLayout, layoutIntersectsBounds, type SettlementLayout } from './settlements';

interface CacheEntry<T> { value: T; }

class LruCache<T> {
  private entries = new Map<string, CacheEntry<T>>(); hits = 0; misses = 0;
  constructor(private capacity: number) { if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Cache capacity must be a positive integer'); }
  get(key: string) { const entry = this.entries.get(key); if (!entry) { this.misses++; return undefined; } this.entries.delete(key); this.entries.set(key, entry); this.hits++; return entry.value; }
  set(key: string, value: T) { this.entries.delete(key); this.entries.set(key, { value }); while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!); }
  clear() { this.entries.clear(); }
  get size() { return this.entries.size; }
}

export interface WorldProviderOptions { chunkCapacity?: number; regionCapacity?: number; }
export interface WorldProviderStats { chunks: { size: number; hits: number; misses: number }; regions: { size: number; hits: number; misses: number }; inFlightChunks: number; inFlightRegions: number; }

function uniqueById<T>(items: T[], getId: (item: T) => string = (item) => (item as T & { id: string }).id) { return [...new Map(items.map((item) => [getId(item), item])).values()].sort((a, b) => getId(a).localeCompare(getId(b))); }
function regionRequests(cx: number, cy: number) { const regionX = Math.floor(cx / REGION_CHUNK_SIZE); const regionY = Math.floor(cy / REGION_CHUNK_SIZE); const localX = ((cx % REGION_CHUNK_SIZE) + REGION_CHUNK_SIZE) % REGION_CHUNK_SIZE; const localY = ((cy % REGION_CHUNK_SIZE) + REGION_CHUNK_SIZE) % REGION_CHUNK_SIZE; const offsets = new Set<string>(['0,0']); if (localX <= 3) for (let dy = -1; dy <= 1; dy++) offsets.add(`-1,${dy}`); if (localX >= REGION_CHUNK_SIZE - 4) for (let dy = -1; dy <= 1; dy++) offsets.add(`1,${dy}`); if (localY <= 3) for (let dx = -1; dx <= 1; dx++) offsets.add(`${dx},-1`); if (localY >= REGION_CHUNK_SIZE - 4) for (let dx = -1; dx <= 1; dx++) offsets.add(`${dx},1`); return [...offsets].sort().map((value) => { const [dx, dy] = value.split(',').map(Number); return { rx: regionX + dx, ry: regionY + dy }; }); }

export class WorldProvider {
  private chunks: LruCache<WorldChunk>;
  private regions: LruCache<RegionData>;
  private inFlightChunks = new Map<string, Promise<WorldChunk>>();
  private inFlightRegions = new Map<string, Promise<RegionData>>();
  constructor(private config: WorldConfig, options: WorldProviderOptions = {}) { this.chunks = new LruCache(options.chunkCapacity ?? 64); this.regions = new LruCache(options.regionCapacity ?? 16); }

  getRegion(rx: number, ry: number): Promise<RegionData> {
    const key = regionKey({ ...this.config, rx, ry }); const cached = this.regions.get(key); if (cached) return Promise.resolve(cached);
    const existing = this.inFlightRegions.get(key); if (existing) return existing;
    const request = Promise.resolve().then(() => generateRegion(this.config, rx, ry)).then((region) => ({ ...region, settlementLayouts: region.settlements.map((shell) => generateSettlementLayout(this.config, shell)) })).then((region) => { this.regions.set(key, region); return region; }).finally(() => this.inFlightRegions.delete(key));
    this.inFlightRegions.set(key, request); return request;
  }

  getChunk(cx: number, cy: number): Promise<WorldChunk> {
    const key = `${this.config.seed}:v${this.config.version}:chunk:${cx},${cy}`; const cached = this.chunks.get(key); if (cached) return Promise.resolve(cached);
    const existing = this.inFlightChunks.get(key); if (existing) return existing;
    const request = Promise.resolve().then(async () => {
      const chunk = chunkAt(this.config, cx, cy); const minX = cx * CHUNK_SIZE; const minY = cy * CHUNK_SIZE; const bounds = { minX, minY, maxX: minX + CHUNK_SIZE - 1, maxY: minY + CHUNK_SIZE - 1 }; const regions = await Promise.all(regionRequests(cx, cy).map((coordinate) => this.getRegion(coordinate.rx, coordinate.ry)));
      const settlements: SettlementShell[] = []; const settlementLayouts: SettlementLayout[] = []; const landmarks: LandmarkAnchor[] = []; const resources: ResourceAnchor[] = []; const roadEndpoints: RoadEndpoint[] = [];
      for (const region of regions) { for (const shell of region.settlements) if (featureIntersectsBounds(shell, bounds, shell.radius)) settlements.push(shell); for (const layout of region.settlementLayouts) if (layoutIntersectsBounds(layout, bounds)) settlementLayouts.push(layout); for (const landmark of region.landmarks) if (featureIntersectsBounds(landmark, bounds, 8)) landmarks.push(landmark); for (const resource of region.resources) if (featureIntersectsBounds(resource, bounds, 8)) resources.push(resource); for (const endpoint of region.roadEndpoints) if (featureIntersectsBounds(endpoint, bounds, 8)) roadEndpoints.push(endpoint); }
      return { ...chunk, settlements: uniqueById(settlements), settlementLayouts: uniqueById(settlementLayouts, (layout) => layout.settlementId), landmarks: uniqueById(landmarks), resources: uniqueById(resources), roadEndpoints: uniqueById(roadEndpoints) };
    }).then((chunk) => { this.chunks.set(key, chunk); return chunk; }).finally(() => this.inFlightChunks.delete(key));
    this.inFlightChunks.set(key, request); return request;
  }

  clear() { this.chunks.clear(); this.regions.clear(); }
  stats(): WorldProviderStats { return { chunks: { size: this.chunks.size, hits: this.chunks.hits, misses: this.chunks.misses }, regions: { size: this.regions.size, hits: this.regions.hits, misses: this.regions.misses }, inFlightChunks: this.inFlightChunks.size, inFlightRegions: this.inFlightRegions.size }; }
}
