import { key, type WorldChunk } from './world';
import type { StreamRequest, StreamingPlan } from './streaming';

export interface ChunkStreamingSchedulerOptions {
  maxConcurrentRequests?: number;
  isLoaded(chunkKey: string): boolean;
  load(request: StreamRequest): Promise<WorldChunk>;
  receive(chunk: WorldChunk, preload: boolean): void;
  failed(request: StreamRequest): void;
}

/**
 * Owns request priority and stale-result handling, but not chunk retention.
 * Consumers decide whether a received chunk is drawn or prefetched.
 */
export class ChunkStreamingScheduler {
  private readonly active = new Map<string, StreamRequest>();
  private queue: StreamRequest[] = [];
  private desired = new Set<string>();
  private preload = new Set<string>();
  private stopped = false;
  private readonly maxConcurrentRequests: number;

  constructor(private readonly options: ChunkStreamingSchedulerOptions) {
    this.maxConcurrentRequests = options.maxConcurrentRequests ?? 2;
  }

  setPlan(plan: StreamingPlan) {
    if (this.stopped) return;
    this.desired = plan.visible;
    this.preload = plan.preload;
    this.queue = plan.requests.filter((request) => {
      const chunkKey = key(request.cx, request.cy);
      return !this.active.has(chunkKey) && !this.options.isLoaded(chunkKey);
    });
    this.pump();
  }

  stop() {
    this.stopped = true;
    this.queue = [];
    this.desired.clear();
    this.preload.clear();
  }

  private pump() {
    while (!this.stopped && this.active.size < this.maxConcurrentRequests && this.queue.length) {
      const request = this.queue.shift()!;
      const chunkKey = key(request.cx, request.cy);
      if (this.active.has(chunkKey) || this.options.isLoaded(chunkKey) || (!this.desired.has(chunkKey) && !this.preload.has(chunkKey))) continue;
      this.active.set(chunkKey, request);
      void this.options.load(request)
        .then((chunk) => {
          if (this.stopped) return;
          if (this.desired.has(chunkKey)) this.options.receive(chunk, false);
          else if (this.preload.has(chunkKey)) this.options.receive(chunk, true);
        })
        .catch(() => {
          if (!this.stopped && this.desired.has(chunkKey)) this.options.failed(request);
        })
        .finally(() => {
          this.active.delete(chunkKey);
          this.pump();
        });
    }
  }
}
