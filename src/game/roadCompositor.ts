export interface RoadTile { x: number; y: number; }
export interface RoadPoint { x: number; y: number; }

export interface RoadCandidate {
  id: string;
  tiles: RoadTile[];
  points: RoadPoint[];
  width: number;
  color: number;
  priority: number;
}

export interface ComposedRoad extends RoadCandidate {
  sourceId: string;
  tiles: RoadTile[];
  points: RoadPoint[];
}

export interface RoadJunction {
  x: number;
  y: number;
  width: number;
  color: number;
  priority: number;
  sourceId: string;
}

export interface RoadComposition {
  roads: ComposedRoad[];
  junctions: RoadJunction[];
}

const tileKey = (tile: RoadTile) => `${tile.x},${tile.y}`;

/** Assigns each occupied tile to one road, retaining branches and describing shared joins. */
export function composeRoads(candidates: RoadCandidate[]): RoadComposition {
  const result: ComposedRoad[] = [];
  const ordered = candidates
    .filter((candidate) => candidate.tiles.length > 0 && candidate.points.length > 0)
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => b.candidate.priority - a.candidate.priority || a.candidate.id.localeCompare(b.candidate.id) || a.index - b.index);
  const occupancy = new Map<string, { winner: RoadCandidate; count: number; tile: RoadTile }>();
  for (const { candidate } of ordered) for (const tile of candidate.tiles) {
    const id = tileKey(tile);
    const current = occupancy.get(id);
    occupancy.set(id, current ? { ...current, count: current.count + 1 } : { winner: candidate, count: 1, tile });
  }
  const junctionKeys = new Set<string>();
  const pointAt = (candidate: RoadCandidate, index: number) => candidate.points[Math.min(Math.max(index, 0), candidate.points.length - 1)];

  for (const { candidate } of ordered) {
    let runStart = -1;
    const flush = (end: number) => {
      if (runStart < 0) return;
      const tiles = candidate.tiles.slice(runStart, end);
      if (!tiles.length) { runStart = -1; return; }
      const pointStart = Math.min(runStart, candidate.points.length - 1);
      const pointEnd = Math.min(Math.max(end, pointStart + 1), candidate.points.length);
      const points = candidate.points.slice(pointStart, pointEnd);
      const before = runStart > 0 ? occupancy.get(tileKey(candidate.tiles[runStart - 1])) : undefined;
      const after = end < candidate.tiles.length ? occupancy.get(tileKey(candidate.tiles[end])) : undefined;
      if (before?.count && before.count > 1) { points.unshift(pointAt(candidate, runStart - 1)); junctionKeys.add(tileKey(candidate.tiles[runStart - 1])); }
      if (after?.count && after.count > 1) { points.push(pointAt(candidate, end)); junctionKeys.add(tileKey(candidate.tiles[end])); }
      const dedupedPoints = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
      if (dedupedPoints.length) result.push({ ...candidate, sourceId: candidate.id, tiles, points: dedupedPoints });
      runStart = -1;
    };
    for (let index = 0; index < candidate.tiles.length; index++) {
      const available = occupancy.get(tileKey(candidate.tiles[index]))?.winner === candidate;
      if (available && runStart < 0) runStart = index;
      if ((!available || index === candidate.tiles.length - 1) && runStart >= 0) flush(available && index === candidate.tiles.length - 1 ? index + 1 : index);
    }
  }
  const junctions = [...junctionKeys].map((id) => {
    const entry = occupancy.get(id)!;
    const point = pointAt(entry.winner, entry.winner.tiles.findIndex((tile) => tileKey(tile) === id));
    return { x: point.x, y: point.y, width: entry.winner.width, color: entry.winner.color, priority: entry.winner.priority, sourceId: entry.winner.id };
  }).sort((a, b) => `${a.x},${a.y}`.localeCompare(`${b.x},${b.y}`));
  return { roads: result, junctions };
}
