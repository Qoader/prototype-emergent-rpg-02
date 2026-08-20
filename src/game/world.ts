export const TILE_SIZE = 32;
export const CHUNK_SIZE = 24;
export type Terrain = 'grass' | 'meadow' | 'water' | 'mountain' | 'path';
export type Landmark = 'tree' | 'ruin' | 'shrine' | null;
export interface Tile { x: number; y: number; terrain: Terrain; landmark: Landmark; walkable: boolean; }
function hash(seed: string, x: number, y: number) { let h = 2166136261; const input = `${seed}:${x}:${y}`; for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
export function tileAt(seed: string, x: number, y: number): Tile {
  const broad = (hash(seed, Math.floor(x / 5), Math.floor(y / 5)) + hash(seed, Math.floor(x / 13) + 77, Math.floor(y / 13) - 31)) / 2;
  const detail = hash(seed, x, y); let terrain: Terrain = broad < 0.24 ? 'water' : broad > 0.83 ? 'mountain' : broad > 0.67 ? 'meadow' : 'grass';
  if (Math.abs(x) < 2 || Math.abs(y) < 2) terrain = 'path';
  const walkable = terrain !== 'water' && terrain !== 'mountain';
  const landmark = walkable && detail > 0.93 ? 'shrine' : walkable && detail > 0.84 ? 'ruin' : walkable && detail > 0.68 ? 'tree' : null;
  return { x, y, terrain, landmark, walkable };
}
export function key(x: number, y: number) { return `${x},${y}`; }
export function neighbors(tile: Tile) { return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: tile.x + dx, y: tile.y + dy })); }
export function findPath(seed: string, start: Tile, target: Tile): Tile[] {
  if (!target.walkable) return [];
  const frontier: Tile[] = [start]; const cameFrom = new Map<string, string | null>([[key(start.x, start.y), null]]); const cost = new Map([[key(start.x, start.y), 0]]);
  while (frontier.length) {
    frontier.sort((a, b) => (cost.get(key(a.x, a.y))! + Math.abs(a.x - target.x) + Math.abs(a.y - target.y)) - (cost.get(key(b.x, b.y))! + Math.abs(b.x - target.x) + Math.abs(b.y - target.y)));
    const current = frontier.shift()!; if (current.x === target.x && current.y === target.y) break;
    for (const point of neighbors(current)) { const next = tileAt(seed, point.x, point.y); const nextKey = key(next.x, next.y); const nextCost = cost.get(key(current.x, current.y))! + 1; if (next.walkable && (!cost.has(nextKey) || nextCost < cost.get(nextKey)!)) { cost.set(nextKey, nextCost); cameFrom.set(nextKey, key(current.x, current.y)); frontier.push(next); } }
  }
  const result: Tile[] = []; let cursor: string | null = key(target.x, target.y); if (!cameFrom.has(cursor)) return [];
  while (cursor && cursor !== key(start.x, start.y)) { const [x, y] = cursor.split(',').map(Number); result.unshift(tileAt(seed, x, y)); cursor = cameFrom.get(cursor) ?? null; }
  return result;
}
