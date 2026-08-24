import { WorldProvider } from './WorldProvider';
import type { WorldChunk } from './world';
import type { WorldWorkerRequest } from './worldWorkerProtocol';

let provider: WorldProvider | undefined;
let disposed = false;

const post = (message: unknown) => self.postMessage(message);

self.onmessage = (event: MessageEvent<WorldWorkerRequest>) => {
  const message = event.data;
  if (message.type === 'init') {
    try { provider = new WorldProvider(message.config, message.options); disposed = false; post({ type: 'ready' }); }
    catch (error) { post({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
    return;
  }
  if (message.type === 'clear') { provider?.clear(); return; }
  if (message.type === 'dispose') { disposed = true; provider?.clear(); provider = undefined; post({ type: 'disposed' }); return; }
  if (message.type === 'getChunk') {
    if (disposed || !provider) { post({ type: 'error', requestId: message.requestId, message: 'World worker is not ready' }); return; }
    const started = performance.now();
    void provider.getChunk(message.cx, message.cy).then((chunk: WorldChunk) => {
      if (!disposed) post({ type: 'chunk', requestId: message.requestId, chunk, elapsedMs: performance.now() - started });
    }).catch((error) => post({ type: 'error', requestId: message.requestId, message: error instanceof Error ? error.message : String(error) }));
  }
  if (message.type === 'getNearbySettlements') {
    if (disposed || !provider) { post({ type: 'error', requestId: message.requestId, message: 'World worker is not ready' }); return; }
    void provider.getNearbySettlements(message.x, message.y, message.radius, message.limit).then((result) => {
      if (!disposed) post({ type: 'nearbySettlements', requestId: message.requestId, result });
    }).catch((error) => post({ type: 'error', requestId: message.requestId, message: error instanceof Error ? error.message : String(error) }));
  }
};
