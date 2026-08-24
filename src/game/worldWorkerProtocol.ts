import type { WorldProviderOptions } from './WorldProvider';
import type { WorldChunk, WorldConfig } from './world';

export type WorldWorkerRequest =
  | { type: 'init'; config: WorldConfig; options?: WorldProviderOptions }
  | { type: 'getChunk'; requestId: number; cx: number; cy: number }
  | { type: 'clear' }
  | { type: 'dispose' };

export type WorldWorkerResponse =
  | { type: 'ready' }
  | { type: 'chunk'; requestId: number; chunk: WorldChunk; elapsedMs: number }
  | { type: 'error'; requestId?: number; message: string }
  | { type: 'disposed' };
