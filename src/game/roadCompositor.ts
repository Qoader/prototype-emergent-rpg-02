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

const tileKey = (tile: RoadTile) => `${tile.x},${tile.y}`;

/** Assigns each occupied tile to one road, retaining all non-overlapping branches. */
export function composeRoads(candidates: RoadCandidate[]): ComposedRoad[] {
  const claimed = new Set<string>();
  const result: ComposedRoad[] = [];
  const ordered = candidates
    .filter((candidate) => candidate.tiles.length > 0 && candidate.points.length > 0)
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => b.candidate.priority - a.candidate.priority || a.candidate.id.localeCompare(b.candidate.id) || a.index - b.index);

  for (const { candidate } of ordered) {
    let runStart = -1;
    const flush = (end: number) => {
      if (runStart < 0) return;
      const tiles = candidate.tiles.slice(runStart, end);
      if (!tiles.length) { runStart = -1; return; }
      const pointStart = Math.min(runStart, candidate.points.length - 1);
      const pointEnd = Math.min(Math.max(end, pointStart + 1), candidate.points.length);
      const points = candidate.points.slice(pointStart, pointEnd);
      if (points.length) result.push({ ...candidate, sourceId: candidate.id, tiles, points });
      runStart = -1;
    };
    for (let index = 0; index < candidate.tiles.length; index++) {
      const available = !claimed.has(tileKey(candidate.tiles[index]));
      if (available && runStart < 0) runStart = index;
      if ((!available || index === candidate.tiles.length - 1) && runStart >= 0) flush(available && index === candidate.tiles.length - 1 ? index + 1 : index);
      if (available) claimed.add(tileKey(candidate.tiles[index]));
    }
  }
  return result;
}
