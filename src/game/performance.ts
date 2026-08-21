export interface PerformanceSnapshot { frames: number; frameMs: number; maxFrameMs: number; chunks: number; chunkMs: number; maxChunkMs: number; displayObjects: number; }

export class PerformanceMonitor {
  private snapshot: PerformanceSnapshot = { frames: 0, frameMs: 0, maxFrameMs: 0, chunks: 0, chunkMs: 0, maxChunkMs: 0, displayObjects: 0 };
  measureFrame<T>(work: () => T) { const start = performance.now(); const result = work(); this.recordFrame(performance.now() - start); return result; }
  recordFrame(milliseconds: number) { this.snapshot.frames++; this.snapshot.frameMs = milliseconds; this.snapshot.maxFrameMs = Math.max(this.snapshot.maxFrameMs, milliseconds); }
  recordChunk(milliseconds: number) { this.snapshot.chunks++; this.snapshot.chunkMs += milliseconds; this.snapshot.maxChunkMs = Math.max(this.snapshot.maxChunkMs, milliseconds); }
  setDisplayObjects(count: number) { this.snapshot.displayObjects = count; }
  read() { return { ...this.snapshot }; }
}
