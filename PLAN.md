# Sub-Second Mobile Chunk Loading — Technical Plan

## Summary

The current cold path is too broad for a one-second mobile target:

```text
request
  → worker getChunk()
    → terrain: 24 × 24 rich Tile objects
    → regions: chunk bounds + 72-tile margin
    → entire 4 × 4-region road cell
      → 5 × 5-region starter-road ring
      → bounded-but-large route refinement
  → structured-clone nested object graph
  → main-thread Pixi Graphics construction
  → GPU upload/render
```

The v11 generator should produce bounded, chunk-local render data:

```text
request
  → priority worker queue
    → cached macro topology
    → 24 × 24 typed terrain payload
    → only route spans/layout cells touching this chunk
  → transferable ArrayBuffers
  → fixed-size GPU batches / chunk render texture
  → explicit render + next animation frame
```

Target: Pixel 7a-class Android Chrome; cold final-detail request-to-present p95 ≤ 1,000 ms, maximum observed ≤ 1,500 ms. “Cold” means a newly created worker with empty generation caches, after worker initialization is complete. Existing generated worlds may change; increment the generator version.

## 1. Instrument the complete critical path

- Give each scheduler request a request ID and record queue wait, terrain generation, feature generation, serialization, worker transfer, scene construction, GPU submission, and presentation.
- Start timing when the scheduler requests the chunk, not when worker execution starts.
- Finish after Pixi submits the frame and the next `requestAnimationFrame` runs.
- Extend performance snapshots with p50/p95/max request-to-present, per-stage durations, transfer bytes, cache tier, generated feature counts, display-object count, and longest main-thread task.
- Initial working budget: queue 50 ms, worker 550 ms, transfer 100 ms, main-thread render 250 ms, presentation 50 ms.

## 2. Replace broad procedural generation with bounded v11 generation

### Road topology and routing

Replace physical route generation in `generateRoadCell()` with two stages:

```ts
interface RoadMacroEdge {
  id: string;
  from: PackedNode;
  to: PackedNode;
  importance: 0 | 1 | 2;
  width: number;
  guidePoints: Int16Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface RoadMacroCell {
  gx: number;
  gy: number;
  edges: RoadMacroEdge[];
}
```

- Macro-cell generation inspects region shells and creates only nodes, edges, coarse guide points, and expanded bounds.
- Cache macro topology by `(seed, generatorVersion, gx, gy)`.
- Assign deterministic checkpoints every 12 world tiles along each guide.
- Refine only spans intersecting the requested chunk plus a two-tile routing halo.
- Each span uses a four-tile corridor and a maximum of 600 search expansions.
- On cap exhaustion, use a deterministic direct fallback so worst-case work is bounded.
- Clip spans to the chunk plus a one-tile visual gutter before packing them.
- Use fixed world-space checkpoint anchors so neighboring chunks generate matching road seams.

The starter road becomes ordinary topology in the starting macro cell. Remove the global 5×5-region starter-road dependency and the current large starter-specific A* fallback from unrelated chunk requests.

### Settlement layouts

- Incrementally generate settlement layout cells anchored to 12×12 world-tile coordinates.
- Request only cells intersecting the chunk plus one-cell halo.
- Use deterministic radial/grid streets and geometric wall/plaza footprints.
- Place buildings and props from stable hashes with an occupancy bitset or dense local grid.
- Replace repeated `sort`, `some`, string-key sets, and array overlap scans with one-pass minima, numeric local indices, and bit operations.
- Carry feature bounding boxes at creation and query spatial buckets instead of scanning complete regional arrays.
- Set explicit deterministic caps for route spans, buildings, walls, props, and layout cells per chunk.

### Terrain and hydrology

- Keep the 24×24 terrain size, but generate in dense numeric arrays with a one-tile halo.
- Cache noise lattice samples and hydrology-cell results by integer coordinate.
- Avoid allocating and copying `GeographicFields`, `Hydrology`, and rich `Tile` objects for render-only work.
- Keep object-rich structures only where gameplay APIs require them.

## 3. Use compact transferable payloads

Introduce a versioned worker-facing payload:

```ts
interface ChunkRenderPayload {
  version: 11;
  cx: number;
  cy: number;
  terrainCode: Uint8Array;
  tileFlags: Uint8Array;
  roadVertices: Float32Array;
  roadRanges: Uint32Array;
  staticInstances: Int16Array;
  staticKinds: Uint8Array;
  navigationBits: Uint8Array;
  portLinks: Uint16Array;
}
```

- `terrainCode` and `tileFlags` use local tile index `y * CHUNK_SIZE + x`.
- Encode road, port, water-route, walkable, blocked, and landmark state as bits rather than `Set<string>` entries.
- Transfer all backing buffers using the `postMessage` transfer list.
- Clip road/layout/feature data before transfer; never clone complete regional objects.
- Keep canonical worker cache entries separate from transferred response buffers so transferring does not detach cached data.

Replace individual unprioritized `getChunk` calls with:

```ts
type WorldWorkerRequest =
  | { type: 'requestChunks'; requestId: number; priority: 'visible' | 'preload'; chunks: ChunkCoordinate[] }
  | { type: 'cancel'; requestIds: number[] }
  | { type: 'clear' }
  | { type: 'dispose' };
```

Responses must include the packed payload and stage timings. Keep nearby-settlement and travel-topology APIs separate from render payloads.

## 4. Prioritize visible work and cancel stale preloads

- Use one explicit logical generation queue per worker. The current concurrency value of two does not parallelize synchronous computation inside one worker.
- Order visible chunks by player distance, then directional preloads.
- Do not begin preload generation while any visible request is queued.
- Cancel queued preloads immediately when the visible plan changes.
- Check cancellation between terrain, topology, route-span, settlement-cell, and packing phases.
- Batch adjacent visible chunks so terrain halos, topology queries, and spatial-index lookups are shared.
- Preserve in-flight deduplication by chunk key.

## 5. Add bounded cache tiers

Maintain separate bounded caches:

| Tier | Content | Target | Purpose |
|---|---|---:|---|
| Worker generation cache | Macro topology, field cells, canonical compact chunks | Existing LRU plus byte budget | Avoid regeneration |
| Main payload cache | Immutable decoded `ChunkRenderPayload` | 32 chunks / 16 MiB | Avoid worker transfer |
| Rendered cache | Static chunk textures and metadata | 8 chunks / 48 MiB GPU budget | Fast revisits |

Evict GPU textures first, then main payloads, then worker data. Never evict a displayed chunk. Explicitly destroy GPU resources on rendered-cache eviction.

## 6. Batch the Pixi rendering path

### Terrain

- Replace `drawTerrain()`’s per-tile vector commands with one 24×24 terrain-code texture and one custom shader/quad per chunk.
- Map terrain and biome codes to palette colors in the shader.
- Generate waves, tufts, shoreline accents, and similar cheap detail in the shader or a single batched pass.

### Roads and static features

- Pack roads and water routes into one indexed mesh per chunk.
- Use one static mesh batch per material/z band for plazas, walls, and edge features.
- Use atlas-backed instances for trees, landmarks, buildings, and ports.
- Stop creating one `Graphics` object per tree, wall tile, plaza tile, or building.
- Build the static chunk into a `RenderTexture` with a one-tile gutter, then display it as one world sprite.
- Keep dynamic actors outside the static texture.
- Replace global `objectLayer.sortChildren()` with chunk-row containers and fixed z bands.
- Remove duplicate navigation indexing: `receiveChunk()` and `drawChunk()` currently both index full chunks.

Slice staging work into tasks no longer than 50 ms using `requestAnimationFrame`, while requiring all final-detail stages to finish before the request-to-present deadline.

## 7. Tests and acceptance gates

### Correctness

- Same seed/version/chunk produces byte-identical packed payloads.
- Independently generated neighboring chunks agree on road, wall, settlement, and navigation seams.
- Spatial queries include every feature intersecting the chunk gutter exactly once.
- Adversarial seeds never exceed configured route/feature budgets.
- Stale preloads never arrive or delay a later visible request.
- Payload and rendered-cache eviction releases resources correctly.
- Screenshot coverage includes cities, road crossings, coastlines, water routes, settlement edges, and chunk boundaries.

### Performance

Run at least 120 cold requests across 12 seeds, including starter areas, dense cities, road-cell boundaries, coast, lake, river, mountain, forest, and empty wilderness. Use a fresh worker and clear all caches per cold sample.

Release gates on physical Pixel 7a-class Android Chrome:

- p95 request-to-present ≤ 1,000 ms
- Maximum observed request-to-present ≤ 1,500 ms
- No chunk-assembly main-thread task >50 ms
- Rendered-cache revisit ≤100 ms
- Main-payload-cache revisit ≤250 ms

Use CPU-throttled Playwright only as a regression signal; physical-device results are authoritative.

## Implementation order

1. Add end-to-end timing and benchmark harness.
2. Remove duplicate indexing and add payload/main/rendered cache tiers.
3. Implement packed terrain payload and batched terrain rendering.
4. Implement macro road topology plus bounded route spans.
5. Implement settlement layout cells and spatial indexes.
6. Replace feature `Graphics` creation with meshes/instances and static chunk textures.
7. Add worker batching/cancellation and enable directional prefetch.
8. Run device benchmarks, tune budgets/caps, and enforce CI performance gates.

## Assumptions

- Final terrain, roads, settlements, props, and navigation data must be presented within the SLO; terrain-only progressive rendering is insufficient.
- Generator v11 may change existing seed output.
- A literal universal one-second maximum is not enforceable because of browser/OS scheduling; the release contract is p95 ≤1 second and max observed ≤1.5 seconds on the named device.
