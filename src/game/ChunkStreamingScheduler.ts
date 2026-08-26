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
  private readonly retries = new Map<string, number>();
  private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly options: ChunkStreamingSchedulerOptions) {
    this.maxConcurrentRequests = options.maxConcurrentRequests ?? 1;
  }

  setPlan(plan: StreamingPlan) {
    if (this.stopped) return;
    this.desired = plan.visible;
    this.preload = plan.preload;
    for (const chunkKey of this.retries.keys()) if (!this.desired.has(chunkKey)) this.retries.delete(chunkKey);
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
    for (const timer of this.retryTimers) clearTimeout(timer);
    this.retryTimers.clear();
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
          this.retries.delete(chunkKey);
        })
        .catch(() => {
          if (!this.stopped && this.desired.has(chunkKey)) { this.options.failed(request); this.retry(request, chunkKey); }
        })
        .finally(() => {
          this.active.delete(chunkKey);
          this.pump();
        });
    }
  }

  private retry(request: StreamRequest, chunkKey: string) {
    const attempts = (this.retries.get(chunkKey) ?? 0) + 1;
    if (attempts > 3) return;
    this.retries.set(chunkKey, attempts);
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer);
      if (this.stopped || !this.desired.has(chunkKey) || this.active.has(chunkKey) || this.options.isLoaded(chunkKey)) return;
      this.queue = [request, ...this.queue.filter((queued) => key(queued.cx, queued.cy) !== chunkKey)];
      this.pump();
    }, 250 * attempts);
    this.retryTimers.add(timer);
  }
}
