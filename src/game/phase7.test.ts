import { describe, expect, it } from 'vitest';
import { chunkAt, createWorldConfig, findPath, tileAt } from './world';
import { PerformanceMonitor } from './performance';

describe('phase 7 runtime safeguards', () => {
  it('keeps generated chunks structured-clone compatible', () => {
    const chunk = chunkAt(createWorldConfig('PHASE7'), 0, 0);
    expect(structuredClone(chunk)).toEqual(chunk);
  });

  it('bounds player path expansion and returned path length', () => {
    const path = findPath('PHASE7', tileAt('PHASE7', 0, 0), tileAt('PHASE7', 8, 8), undefined, { maxExpandedNodes: 1200, maxPathLength: 3 });
    expect(path.length).toBeLessThanOrEqual(3);
  });

  it('records frame and chunk timing without changing generation data', () => {
    const monitor = new PerformanceMonitor();
    monitor.measureFrame(() => 1); monitor.recordChunk(4); monitor.setDisplayObjects(2);
    expect(monitor.read()).toMatchObject({ frames: 1, chunks: 1, chunkMs: 4, displayObjects: 2 });
  });
});
