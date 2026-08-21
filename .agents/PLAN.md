# World Generation Expansion Plan

Implement deterministic, performant generation for biomes, settlements, and organic roads.

## Progress

- [x] Phase 1 — Deterministic generation foundation
- [x] Phase 2 — Continuous geographic fields
- [ ] Phase 3 — Biome and hydrology systems
- [ ] Phase 4 — Region-level feature planning
- [ ] Phase 5 — Organic settlement sprawl
- [ ] Phase 6 — Organic road network
- [ ] Phase 7 — Rendering and runtime performance
- [ ] Phase 8 — Validation, tuning, and acceptance

Use `[ ]` for pending, `[-]` for in progress, and `[x]` for completed work. Keep this checklist updated as implementation progresses.

## Current baseline

- `src/game/world.ts` currently generates each tile from a deterministic FNV-style hash.
- Terrain is selected from two coarse hash samples, producing clustered but blocky regions.
- The current terrain types are grass, meadow, water, mountain, and a forced central cross-shaped path.
- Landmarks are placed from a fine-grained hash value.
- Visible 24×24 chunks are generated lazily by `src/game/Game.ts`.
- Each tile currently creates its own Pixi `Graphics` object.
- Player movement uses grid-based A*; this is separate from persistent world-road generation.

## Phase 1 — Deterministic generation foundation

- [x] Add a central `GENERATOR_VERSION` and include it in generation and cache keys.
- [x] Add namespaced deterministic random helpers for terrain, fields, settlements, buildings, roads, and visual jitter.
- [x] Keep generation functions pure and free of `Math.random()`, time, mutable global RNG state, and load-order-dependent iteration.
- [x] Standardize world, chunk, and region coordinate conversion utilities.
- [x] Ensure all feature randomness uses stable world coordinates or stable feature IDs.
- [x] Add tests proving that same seed and inputs produce identical results.
- [x] Add tests proving that chunk request order and regeneration do not alter results; cache eviction is deferred until the Phase 7 cache exists.

### Phase 1 acceptance criteria

- The same seed/version produces identical tile, chunk, region, settlement, and road data.
- Different seeds produce meaningfully different data.
- Generator version changes are explicit and testable.
- No feature depends on which neighboring chunk was loaded first.

## Phase 2 — Continuous geographic fields

- [x] Add deterministic multi-octave noise or an equivalent continuous seeded field implementation.
- [x] Generate low-frequency elevation.
- [x] Generate moisture using an independent seed namespace and scale.
- [x] Generate temperature using noise, latitude, and elevation effects.
- [x] Add fertility and roughness/slope fields where useful for settlements and roads.
- [x] Keep field generation independent so each field can be tuned without changing unrelated systems.
- [x] Add a debug mode or test output for inspecting individual fields.

### Phase 2 acceptance criteria

- Field values change smoothly across neighboring coordinates.
- Fields remain deterministic across chunks and reloads.
- Field scales produce connected geographic regions rather than blocky hash patches.
- Field generation is fast enough for visible chunk generation or can be moved to a worker later.

## Phase 3 — Biome and hydrology systems

- [ ] Separate physical terrain from ecological biome classification.
- [ ] Expand terrain concepts to support deep water, shallow water, shore, plains, hills, and mountains as needed.
- [ ] Add biomes such as ocean, coast, grassland, forest, swamp, desert, tundra, and alpine.
- [ ] Centralize biome thresholds in a lookup/classification function.
- [ ] Add local high-frequency detail for clearings, forest density, meadow patches, marsh pockets, and similar variation.
- [ ] Ensure detail layers cannot destroy required connectivity or settlement suitability.
- [ ] Derive lakes, coastlines, and shore transitions from elevation and moisture.
- [ ] Add deterministic rivers from downhill flow or seeded source-to-lowland routing.
- [ ] Compute slope and movement cost from neighboring elevation values.
- [ ] Add tests for biome boundaries, water connectivity, river continuity, and chunk-edge consistency.

### Phase 3 acceptance criteria

- Biomes form coherent regions based on elevation, moisture, and temperature.
- Water, mountains, and steep terrain correctly affect walkability and movement cost.
- Rivers and shorelines do not visibly break at chunk boundaries.
- Biome classification is independent from rendering colors.

## Phase 4 — Region-level feature planning

- [ ] Define a region size larger than a chunk, such as 16×16 chunks.
- [ ] Derive a stable region seed from world seed, generator version, and region coordinates.
- [ ] Generate settlements, major landmarks, resource anchors, and road endpoints at region scope.
- [ ] Query the current and neighboring regions when a chunk requests features near its bounds.
- [ ] Add bounded region and chunk caches with deterministic keys.
- [ ] Ensure global features are generated once logically and clipped only during rendering.
- [ ] Define stable IDs for settlements, road segments, anchors, buildings, and districts.

### Phase 4 acceptance criteria

- A chunk can be generated independently while still seeing relevant neighboring-region features.
- Large features remain continuous across chunk and region boundaries.
- Cache eviction changes timing and memory use only; it never changes world content.
- Region generation does not require scanning the whole world.

## Phase 5 — Organic settlement sprawl

- [ ] Generate candidate settlement points using deterministic Poisson-disc sampling or seeded region-local candidates.
- [ ] Score candidates using slope, water access, fertility, biome, resources, landmarks, and distance from other settlements.
- [ ] Reject deep water, steep slopes, unsuitable mountains, and candidates that violate spacing rules.
- [ ] Select hamlets, villages, towns, and cities using stable score ordering and deterministic tie-breaking.
- [ ] Add settlement metadata: stable ID, type, radius, population class, center, and anchors.
- [ ] Place anchors such as center/keep, market, well, gates, river crossings, harbors, shrines, and resource sites.
- [ ] Generate main streets between anchors using terrain-aware routing.
- [ ] Generate secondary streets with branching, dead ends, and controlled deterministic irregularity.
- [ ] Assign districts using road proximity, anchor influence, terrain suitability, water, and seeded variation.
- [ ] Generate building plots near roads with Poisson-disc/rejection sampling.
- [ ] Orient buildings toward nearby roads while varying setback, rotation, scale, and spacing.
- [ ] Add gardens, yards, barns, pens, workshops, and other district-specific structures.
- [ ] Add a low-density settlement fringe with cottages, farms, fields, and informal paths.
- [ ] Ensure buildings do not overlap and remain within valid terrain and settlement bounds.

### Phase 5 acceptance criteria

- Settlements form around meaningful geographic and social anchors.
- Central districts are denser than residential and rural-edge districts.
- Buildings are irregular but non-overlapping and generally road-oriented.
- Settlement boundaries transition gradually into farms and wilderness.
- Settlement placement is reproducible and independent of chunk load order.

## Phase 6 — Organic road network

- [ ] Build a sparse settlement graph from nearby settlements and important geographic anchors.
- [ ] Use a minimum spanning tree or equivalent sparse connectivity method.
- [ ] Add a limited number of deterministic extra links to create useful loops.
- [ ] Route major roads with weighted A*/Dijkstra using terrain, slope, water, rivers, and existing-road costs.
- [ ] Prefer valleys, passes, bridges, river crossings, and gentle terrain.
- [ ] Add small deterministic cost noise so roads are not perfectly symmetrical.
- [ ] Use hierarchical routing for long-distance roads and tile-level routing only for final local segments.
- [ ] Represent roads as stable logical segments rather than replacing biome/terrain with a `path` terrain.
- [ ] Simplify tile paths into polylines.
- [ ] Smooth and slightly perturb visible road curves deterministically.
- [ ] Support road importance and width: trail, road, and highway.
- [ ] Merge overlapping roads and preserve shared segments.
- [ ] Add bridges or crossings where roads intersect rivers.
- [ ] Test road continuity and endpoint correctness across chunk and region boundaries.

### Phase 6 acceptance criteria

- Major settlements are connected without creating a fully saturated road grid.
- Roads follow terrain while retaining controlled organic variation.
- Roads form occasional loops and branches rather than only a tree or perfect grid.
- Road geometry is continuous across chunk boundaries.
- Roads do not cross blocked terrain unless a bridge or special crossing exists.

## Phase 7 — Rendering and runtime performance

- [ ] Separate generated world data from Pixi display objects.
- [ ] Replace one `Graphics` object per tile with batched per-chunk rendering, a tilemap, or a render texture.
- [ ] Keep terrain, roads, buildings, landmarks, effects, and actors in separate render layers.
- [ ] Add visible-chunk and prefetch radii.
- [ ] Add LRU eviction for distant chunk data and display objects.
- [ ] Add bounded region/feature caches.
- [ ] Prioritize generation by distance from the player.
- [ ] Replace frontier sorting in current A* with a binary heap priority queue.
- [ ] Add search limits and hierarchical routing for long paths.
- [ ] Add level of detail: biome colors far away, roads and silhouettes at medium distance, buildings and props nearby.
- [ ] Profile before moving generation to a Web Worker; if needed, move pure chunk/region generation to a worker and return plain serializable data.
- [ ] Ensure worker generation uses the same seed/version/config and produces the same results as main-thread generation.
- [ ] Measure generation time, frame time, display-object count, cache size, and memory during long exploration.

### Phase 7 acceptance criteria

- Visible rendering remains responsive during chunk transitions.
- Terrain rendering does not create one display object per tile.
- Distant exploration does not cause unbounded memory or Pixi object growth.
- Worker and main-thread generation produce identical data when both are used.
- Cache eviction and prefetching do not introduce visual seams or content changes.

## Phase 8 — Validation, tuning, and release criteria

- [ ] Add unit tests for fields, biomes, settlement scoring, spacing, building placement, road costs, and stable IDs.
- [ ] Add property tests for non-overlap, walkability, road contiguity, and valid boundary behavior.
- [ ] Add integration tests for random chunk load order, eviction/regeneration, and continuous movement across boundaries.
- [ ] Add performance tests for chunk generation, region generation, road generation, rendering, and long-distance exploration.
- [ ] Add debug overlays for elevation, moisture, temperature, biome, region boundaries, settlement scores, roads, and generation timing.
- [ ] Expose tuning parameters for biome scale, settlement density, spacing, road wander, road loops, building density, and edge falloff.
- [ ] Version tuning configuration together with the generator version.
- [ ] Validate several fixed seeds visually and through automated snapshots/data assertions.
- [ ] Document the generator version and migration expectations for future algorithm changes.

### Final acceptance criteria

- Identical seed, version, and configuration produce identical worlds across reloads, cache states, chunk orders, and worker/main-thread execution.
- Biomes are continuous and geographically plausible.
- Settlements grow around water, roads, resources, and anchors with irregular but coherent sprawl.
- Roads connect meaningful destinations, follow terrain, and remain organic rather than grid-like.
- Roads, rivers, settlements, and biome boundaries remain continuous across chunks.
- Rendering and memory remain bounded during extended exploration.
- The behavior is covered by deterministic, boundary, integration, and performance tests.

## Defaults and design decisions

- Use deterministic continuous noise for geographic fields.
- Keep terrain, biome, roads, and settlements as separate data layers.
- Plan major features at region scope and render them at chunk scope.
- Use weighted pathfinding for roads, with stable noise-based tie-breaking.
- Use anchor-driven, road-attracted settlement growth with density falloff toward the edge.
- Use Poisson-disc or rejection sampling for non-overlapping irregular placement.
- Use batched chunk rendering rather than one Pixi display object per tile.
- Preserve deterministic regeneration over retaining every explored chunk in memory.
- Do not begin implementation until this checklist is explicitly used as the progress tracker.
