import { chunkAt, CHUNK_SIZE, REGION_CHUNK_SIZE, regionKey, type WorldChunk, type WorldConfig } from './world';
import { featureIntersectsBounds, generateRegion, type LandmarkAnchor, type RegionData, type ResourceAnchor, type RoadEndpoint, type SettlementShell } from './regions';

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

function uniqueById<T extends { id: string }>(items: T[]) { return [...new Map(items.map((item) => [item.id, item])).values()].sort((a, b) => a.id.localeCompare(b.id)); }

export class WorldProvider {
  private chunks: LruCache<WorldChunk>;
  private regions: LruCache<RegionData>;
  private inFlightChunks = new Map<string, Promise<WorldChunk>>();
  private inFlightRegions = new Map<string, Promise<RegionData>>();
  constructor(private config: WorldConfig, options: WorldProviderOptions = {}) { this.chunks = new LruCache(options.chunkCapacity ?? 64); this.regions = new LruCache(options.regionCapacity ?? 16); }

  getRegion(rx: number, ry: number): Promise<RegionData> {
    const key = regionKey({ ...this.config, rx, ry }); const cached = this.regions.get(key); if (cached) return Promise.resolve(cached);
    const existing = this.inFlightRegions.get(key); if (existing) return existing;
    const request = Promise.resolve().then(() => generateRegion(this.config, rx, ry)).then((region) => { this.regions.set(key, region); return region; }).finally(() => this.inFlightRegions.delete(key));
    this.inFlightRegions.set(key, request); return request;
  }

  getChunk(cx: number, cy: number): Promise<WorldChunk> {
    const key = `${this.config.seed}:v${this.config.version}:chunk:${cx},${cy}`; const cached = this.chunks.get(key); if (cached) return Promise.resolve(cached);
    const existing = this.inFlightChunks.get(key); if (existing) return existing;
    const request = Promise.resolve().then(async () => {
      const chunk = chunkAt(this.config, cx, cy); const minX = cx * CHUNK_SIZE; const minY = cy * CHUNK_SIZE; const bounds = { minX, minY, maxX: minX + CHUNK_SIZE - 1, maxY: minY + CHUNK_SIZE - 1 }; const regionX = Math.floor(cx / REGION_CHUNK_SIZE); const regionY = Math.floor(cy / REGION_CHUNK_SIZE); const regions = await Promise.all([...new Set([[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 0], [0, 1], [1, -1], [1, 0], [1, 1]].map(([dx, dy]) => `${regionX + dx},${regionY + dy}`))].sort().map((value) => { const [rx, ry] = value.split(',').map(Number); return this.getRegion(rx, ry); }));
      const settlements: SettlementShell[] = []; const landmarks: LandmarkAnchor[] = []; const resources: ResourceAnchor[] = []; const roadEndpoints: RoadEndpoint[] = [];
      for (const region of regions) { for (const shell of region.settlements) if (featureIntersectsBounds(shell, bounds, shell.radius)) settlements.push(shell); for (const landmark of region.landmarks) if (featureIntersectsBounds(landmark, bounds, 8)) landmarks.push(landmark); for (const resource of region.resources) if (featureIntersectsBounds(resource, bounds, 8)) resources.push(resource); for (const endpoint of region.roadEndpoints) if (featureIntersectsBounds(endpoint, bounds, 8)) roadEndpoints.push(endpoint); }
      return { ...chunk, settlements: uniqueById(settlements), landmarks: uniqueById(landmarks), resources: uniqueById(resources), roadEndpoints: uniqueById(roadEndpoints) };
    }).then((chunk) => { this.chunks.set(key, chunk); return chunk; }).finally(() => this.inFlightChunks.delete(key));
    this.inFlightChunks.set(key, request); return request;
  }

  clear() { this.chunks.clear(); this.regions.clear(); }
  stats(): WorldProviderStats { return { chunks: { size: this.chunks.size, hits: this.chunks.hits, misses: this.chunks.misses }, regions: { size: this.regions.size, hits: this.regions.hits, misses: this.regions.misses }, inFlightChunks: this.inFlightChunks.size, inFlightRegions: this.inFlightRegions.size }; }
}
