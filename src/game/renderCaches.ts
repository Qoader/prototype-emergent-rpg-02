import { ByteLruCache } from './byteLruCache';
import type { ChunkRenderPayload } from './chunkRenderPayload';

export interface RenderedChunkResource { destroy: () => void; }

/** Main-thread cache tiers. Callers should remove displayed keys before inserting/evicting. */
export class RenderCaches {
  readonly payloads = new ByteLruCache<ChunkRenderPayload>(16 * 1024 * 1024);
  readonly rendered = new ByteLruCache<RenderedChunkResource>(48 * 1024 * 1024, (resource) => resource.destroy());
  private displayed = new Set<string>();

  markDisplayed(key: string, displayed: boolean) { if (displayed) this.displayed.add(key); else this.displayed.delete(key); }
  putPayload(key: string, payload: ChunkRenderPayload) { this.payloads.set(key, payload, payload.terrainCode.byteLength + payload.tileFlags.byteLength + payload.roadVertices.byteLength + payload.roadRanges.byteLength + payload.staticInstances.byteLength + payload.staticKinds.byteLength + payload.navigationBits.byteLength + payload.portLinks.byteLength); }
  putRendered(key: string, resource: RenderedChunkResource, bytes: number) { if (!this.displayed.has(key)) this.rendered.set(key, resource, bytes); }
  clear() { this.rendered.clear(); this.payloads.clear(); this.displayed.clear(); }
}
