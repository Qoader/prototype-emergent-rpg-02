import { WorldProvider } from './WorldProvider';
import type { WorldChunk } from './world';
import type { WorldWorkerRequest } from './worldWorkerProtocol';
import { chunkRenderPayloadTransferList, cloneChunkRenderPayload, packChunkRenderPayload } from './chunkRenderPayload';

let provider: WorldProvider | undefined;
let disposed = false;
const cancelled = new Set<number>();
const payloadCache = new Map<string, ReturnType<typeof packChunkRenderPayload>>();
const batchQueue: Array<{ requestId: number; chunks: Array<{ cx: number; cy: number }> }> = [];
let batchRunning = false;

const post = (message: unknown, transfer?: Transferable[]) => self.postMessage(message, { transfer: transfer ?? [] });

self.onmessage = (event: MessageEvent<WorldWorkerRequest>) => {
  const message = event.data;
  if (message.type === 'init') {
    try { provider = new WorldProvider(message.config, message.options); disposed = false; post({ type: 'ready' }); }
    catch (error) { post({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
    return;
  }
  if (message.type === 'clear') { provider?.clear(); payloadCache.clear(); cancelled.clear(); return; }
  if (message.type === 'dispose') { disposed = true; provider?.clear(); payloadCache.clear(); cancelled.clear(); provider = undefined; post({ type: 'disposed' }); return; }
  if (message.type === 'cancel') { for (const id of message.requestIds) { cancelled.add(id); const index = batchQueue.findIndex((job) => job.requestId === id); if (index >= 0) batchQueue.splice(index, 1); } return; }
  if (message.type === 'requestChunks') {
    if (disposed || !provider) { post({ type: 'error', requestId: message.requestId, message: 'World worker is not ready' }); return; }
    batchQueue.push({ requestId: message.requestId, chunks: message.chunks });
    if (batchRunning) return;
    batchRunning = true;
    void (async () => {
      while (batchQueue.length && !disposed) {
        const job = batchQueue.shift()!; if (cancelled.has(job.requestId)) { cancelled.delete(job.requestId); continue; }
      const started = performance.now(); const payloads = [] as ReturnType<typeof packChunkRenderPayload>[];
      for (const coordinate of job.chunks) {
        if (cancelled.has(job.requestId)) { cancelled.delete(job.requestId); break; }
        const cacheKey = `${coordinate.cx},${coordinate.cy}`;
        const canonical = payloadCache.get(cacheKey) ?? packChunkRenderPayload(await provider!.getChunk(coordinate.cx, coordinate.cy));
        payloadCache.set(cacheKey, canonical); payloads.push(cloneChunkRenderPayload(canonical));
      }
      const transfer = payloads.flatMap(chunkRenderPayloadTransferList);
      if (payloads.length === job.chunks.length && !cancelled.has(job.requestId)) post({ type: 'chunkPayloads', requestId: job.requestId, payloads, timings: { workerMs: performance.now() - started }, transferBytes: transfer.reduce((sum, buffer) => sum + buffer.byteLength, 0) }, transfer);
      cancelled.delete(job.requestId);
      }
    })().catch((error) => post({ type: 'error', message: error instanceof Error ? error.message : String(error) })).finally(() => { batchRunning = false; });
  }
  if (message.type === 'getChunk') {
    if (disposed || !provider) { post({ type: 'error', requestId: message.requestId, message: 'World worker is not ready' }); return; }
    const started = performance.now();
    void provider.getChunk(message.cx, message.cy).then((chunk: WorldChunk) => {
      if (!disposed) post({ type: 'chunk', requestId: message.requestId, chunk, elapsedMs: performance.now() - started });
    }).catch((error) => post({ type: 'error', requestId: message.requestId, message: error instanceof Error ? error.message : String(error) }));
  }
  if (message.type === 'getTerrainChunk') {
    if (disposed || !provider) { post({ type: 'error', requestId: message.requestId, message: 'World worker is not ready' }); return; }
    const started = performance.now();
    void provider.getTerrainChunk(message.cx, message.cy).then((chunk) => {
      if (!disposed) post({ type: 'terrainChunk', requestId: message.requestId, chunk, elapsedMs: performance.now() - started });
    }).catch((error) => post({ type: 'error', requestId: message.requestId, message: error instanceof Error ? error.message : String(error) }));
  }
  if (message.type === 'getNearbySettlements') {
    if (disposed || !provider) { post({ type: 'error', requestId: message.requestId, message: 'World worker is not ready' }); return; }
    void provider.getNearbySettlements(message.x, message.y, message.radius, message.limit).then((result) => {
      if (!disposed) post({ type: 'nearbySettlements', requestId: message.requestId, result });
    }).catch((error) => post({ type: 'error', requestId: message.requestId, message: error instanceof Error ? error.message : String(error) }));
  }
  if (message.type === 'getTravelTopology') {
    if (disposed || !provider) { post({ type: 'error', requestId: message.requestId, message: 'World worker is not ready' }); return; }
    void provider.getTravelTopology(message.gx, message.gy, message.radius).then((result) => {
      if (!disposed) post({ type: 'travelTopology', requestId: message.requestId, result });
    }).catch((error) => post({ type: 'error', requestId: message.requestId, message: error instanceof Error ? error.message : String(error) }));
  }
};
