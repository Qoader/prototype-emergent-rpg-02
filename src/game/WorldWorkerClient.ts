import type { WorldChunk, WorldConfig } from './world';
import type { WorldProviderOptions } from './WorldProvider';
import type { WorldWorkerResponse } from './worldWorkerProtocol';
import type { NearbySettlementResult } from './regions';

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; }

export class WorldWorkerClient {
  private worker: Worker;
  private nextRequestId = 1;
  private pending = new Map<number, Pending>();
  private ready: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private closed = false;
  private readyTimer: ReturnType<typeof setTimeout>;
  constructor(config: WorldConfig, options?: WorldProviderOptions) {
    this.worker = new Worker(new URL('./world.worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise<void>((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.readyTimer = setTimeout(() => this.fail(new Error('World worker initialization timed out')), 8000);
    this.worker.onmessage = (event: MessageEvent<WorldWorkerResponse>) => this.handle(event.data);
    this.worker.onerror = () => this.fail(new Error('World worker failed to initialize'));
    this.worker.postMessage({ type: 'init', config, options });
  }
  private handle(message: WorldWorkerResponse) {
    if (message.type === 'ready') { clearTimeout(this.readyTimer); this.readyResolve(); return; }
    if (message.type === 'error' && message.requestId === undefined) { this.fail(new Error(message.message)); return; }
    if (message.type === 'chunk') { const pending = this.pending.get(message.requestId); if (!pending) return; this.pending.delete(message.requestId); pending.resolve(message.chunk); }
    if (message.type === 'nearbySettlements') { const pending = this.pending.get(message.requestId); if (!pending) return; this.pending.delete(message.requestId); pending.resolve(message.result as unknown as WorldChunk); }
    if (message.type === 'error' && message.requestId !== undefined) { const pending = this.pending.get(message.requestId); if (pending) { this.pending.delete(message.requestId); pending.reject(new Error(message.message)); } }
  }
  private fail(error: Error) { if (this.closed) return; this.closed = true; clearTimeout(this.readyTimer); this.readyReject(error); for (const pending of this.pending.values()) pending.reject(error); this.pending.clear(); this.worker.terminate(); }
  getChunk(cx: number, cy: number) { const requestId = this.nextRequestId++; return this.ready.then(() => new Promise<WorldChunk>((resolve, reject) => { if (this.closed) { reject(new Error('World worker is unavailable')); return; } this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject }); this.worker.postMessage({ type: 'getChunk', requestId, cx, cy }); })); }
  getNearbySettlements(x: number, y: number, radius = 1, limit = 5) { const requestId = this.nextRequestId++; return this.ready.then(() => new Promise<NearbySettlementResult>((resolve, reject) => { if (this.closed) { reject(new Error('World worker is unavailable')); return; } this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject }); this.worker.postMessage({ type: 'getNearbySettlements', requestId, x, y, radius, limit }); })); }
  whenReady() { return this.ready; }
  clear() { if (!this.closed) this.worker.postMessage({ type: 'clear' }); }
  dispose() { if (this.closed) return Promise.resolve(); this.closed = true; clearTimeout(this.readyTimer); for (const pending of this.pending.values()) pending.reject(new Error('World worker disposed')); this.pending.clear(); this.worker.postMessage({ type: 'dispose' }); this.worker.terminate(); return Promise.resolve(); }
}
