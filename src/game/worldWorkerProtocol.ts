import type { WorldProviderOptions } from './WorldProvider';
import type { TerrainChunk, WorldChunk, WorldConfig } from './world';
import type { NearbySettlementResult } from './regions';
import type { TravelTopology } from './adventurers';

export type WorldWorkerRequest =
  | { type: 'init'; config: WorldConfig; options?: WorldProviderOptions }
  | { type: 'getTerrainChunk'; requestId: number; cx: number; cy: number }
  | { type: 'getChunk'; requestId: number; cx: number; cy: number }
  | { type: 'getNearbySettlements'; requestId: number; x: number; y: number; radius: number; limit: number }
  | { type: 'getTravelTopology'; requestId: number; gx: number; gy: number; radius: number }
  | { type: 'clear' }
  | { type: 'dispose' };

export type WorldWorkerResponse =
  | { type: 'ready' }
  | { type: 'terrainChunk'; requestId: number; chunk: TerrainChunk; elapsedMs: number }
  | { type: 'chunk'; requestId: number; chunk: WorldChunk; elapsedMs: number }
  | { type: 'nearbySettlements'; requestId: number; result: NearbySettlementResult }
  | { type: 'travelTopology'; requestId: number; result: TravelTopology }
  | { type: 'error'; requestId?: number; message: string }
  | { type: 'disposed' };
