import { describe, expect, it, vi } from 'vitest';
import { ChunkStreamingScheduler } from './ChunkStreamingScheduler';
import type { StreamRequest, StreamingPlan } from './streaming';
import type { WorldChunk } from './world';

const request = (cx: number, cy: number, preload = false): StreamRequest => ({ cx, cy, preload, distance: Math.max(Math.abs(cx), Math.abs(cy)) });
const plan = (visible: StreamRequest[], preload: StreamRequest[] = []): StreamingPlan => ({ visible: new Set(visible.map(({ cx, cy }) => `${cx},${cy}`)), preload: new Set(preload.map(({ cx, cy }) => `${cx},${cy}`)), requests: [...visible, ...preload] });
const chunk = (cx: number, cy: number) => ({ cx, cy } as WorldChunk);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

const flushRequests = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('ChunkStreamingScheduler', () => {
  it('drops stale chunks while continuing to prioritize the current plan', async () => {
    const first = deferred<WorldChunk>();
    const second = deferred<WorldChunk>();
    const load = vi.fn((entry: StreamRequest) => entry.cx === 0 ? first.promise : second.promise);
    const receive = vi.fn();
    const scheduler = new ChunkStreamingScheduler({ maxConcurrentRequests: 1, isLoaded: () => false, load, receive, failed: vi.fn() });

    scheduler.setPlan(plan([request(0, 0)]));
    scheduler.setPlan(plan([request(1, 0)]));
    first.resolve(chunk(0, 0));
    await first.promise;
    await flushRequests();
    expect(receive).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledWith(request(1, 0));

    second.resolve(chunk(1, 0));
    await second.promise;
    await flushRequests();
    expect(receive).toHaveBeenCalledWith(chunk(1, 0), false);
  });

  it('promotes an in-flight preload to visible when it resolves', async () => {
    const pending = deferred<WorldChunk>();
    const receive = vi.fn();
    const scheduler = new ChunkStreamingScheduler({ maxConcurrentRequests: 1, isLoaded: () => false, load: () => pending.promise, receive, failed: vi.fn() });

    scheduler.setPlan(plan([], [request(2, 0, true)]));
    scheduler.setPlan(plan([request(2, 0)]));
    pending.resolve(chunk(2, 0));
    await pending.promise;
    await flushRequests();

    expect(receive).toHaveBeenCalledWith(chunk(2, 0), false);
  });

  it('reports a visible failure once and retries after the next plan', async () => {
    const failed = vi.fn();
    const load = vi.fn().mockRejectedValue(new Error('unavailable'));
    const scheduler = new ChunkStreamingScheduler({ maxConcurrentRequests: 1, isLoaded: () => false, load, receive: vi.fn(), failed });

    scheduler.setPlan(plan([request(0, 0)]));
    await flushRequests();
    expect(failed).toHaveBeenCalledTimes(1);
    scheduler.setPlan(plan([request(0, 0)]));
    await flushRequests();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
