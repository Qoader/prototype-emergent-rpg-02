import type { GeographicFields } from './fields';
import type { Direction, Hydrology } from './hydrology';
import type { WorldConfig } from './world';
import { LruCache } from './LruCache';

type CacheKeyPart = string | number;

function serialize(value: CacheKeyPart) {
  return typeof value === 'number' && Object.is(value, -0) ? '-0' : String(value);
}

function coordinateKey(config: WorldConfig, namespace: string, ...coordinates: CacheKeyPart[]) {
  return [config.seed, `v${config.version}`, namespace, ...coordinates.map(serialize)].join(':');
}

export interface QuickFields { elevation: number; moisture: number; }

const fieldsCache = new LruCache<GeographicFields>(50_000);
const quickFieldsCache = new LruCache<QuickFields>(50_000);
const hydrologyCache = new LruCache<Hydrology>(50_000);
const riverFlowCache = new LruCache<Direction | null>(16_000);

export function getCachedFields(config: WorldConfig, x: number, y: number) { return fieldsCache.get(coordinateKey(config, 'fields', x, y)); }
export function setCachedFields(config: WorldConfig, x: number, y: number, fields: GeographicFields) { fieldsCache.set(coordinateKey(config, 'fields', x, y), fields); }

export function getCachedQuickFields(config: WorldConfig, x: number, y: number) { return quickFieldsCache.get(coordinateKey(config, 'quick-fields', x, y)); }
export function setCachedQuickFields(config: WorldConfig, x: number, y: number, fields: QuickFields) { quickFieldsCache.set(coordinateKey(config, 'quick-fields', x, y), fields); }

export function getCachedHydrology(config: WorldConfig, x: number, y: number) { return hydrologyCache.get(coordinateKey(config, 'hydrology', x, y)); }
export function setCachedHydrology(config: WorldConfig, x: number, y: number, hydrology: Hydrology) { hydrologyCache.set(coordinateKey(config, 'hydrology', x, y), hydrology); }

export function getCachedRiverFlow(config: WorldConfig, cx: number, cy: number) {
  const key = coordinateKey(config, 'river-flow', cx, cy);
  const value = riverFlowCache.get(key);
  return value === undefined ? { hit: false, value: null } : { hit: true, value };
}
export function setCachedRiverFlow(config: WorldConfig, cx: number, cy: number, flow: Direction | null) { riverFlowCache.set(coordinateKey(config, 'river-flow', cx, cy), flow); }

/** Test-only reset point; production callers normally rely on bounded eviction. */
export function clearGenerationCaches() {
  fieldsCache.clear();
  quickFieldsCache.clear();
  hydrologyCache.clear();
  riverFlowCache.clear();
}
