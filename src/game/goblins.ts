import { tileAt, type Tile } from './world';
import type { SettlementShell } from './regions';

export const GOBLIN_CELL_SIZE = 192;
const GOBLIN_SPEED = 3;
const NOTICE_RADIUS = 8;
const LEASH_RADIUS = 18;
const WANDER_INTERVAL = 2.5;
const SETTLEMENT_FRINGE = { hamlet: 15, village: 28, town: 28, city: 34 } as const;

export type GoblinState = 'wandering' | 'pursuing-player' | 'returning-to-wilderness' | 'approaching-adventurer' | 'fighting';
export interface Goblin { id: string; x: number; y: number; previousX: number; previousY: number; state: GoblinState; path: Array<{ x: number; y: number }>; pathIndex: number; targetAdventurerId: string | null; speed: number; nextWanderAt: number; lod: 'live' | 'coarse' | 'sparse' | 'sleeping'; tickPhase: number; lastSimTime: number; }
export interface GoblinContext { seed: string; settlements: SettlementShell[]; player: { x: number; y: number }; gameTime: number; }

function hash(value: string) { let result = 2166136261; for (const character of value) { result ^= character.charCodeAt(0); result = Math.imul(result, 16777619); } return (result >>> 0) / 4294967296; }
function distance(a: { x: number; y: number }, b: { x: number; y: number }) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function settlementExclusionRadius(settlement: SettlementShell) { return settlement.radius + SETTLEMENT_FRINGE[settlement.type]; }
export function inSettlementExclusion(x: number, y: number, settlements: SettlementShell[]) { return settlements.some((settlement) => Math.hypot(x - settlement.x, y - settlement.y) <= settlementExclusionRadius(settlement)); }
export function legalWildernessTile(tile: Tile, settlements: SettlementShell[]) { return tile.walkable && !inSettlementExclusion(tile.x, tile.y, settlements); }

export function goblinCellId(seed: string, cx: number, cy: number) { return `goblin:${seed}:${cx},${cy}`; }
export function createGoblin(seed: string, cx: number, cy: number, settlements: SettlementShell[], gameTime = 0): Goblin | null {
  if (hash(`${seed}:goblin-cell:${cx},${cy}`) >= 1 / 3) return null;
  const min = { x: cx * GOBLIN_CELL_SIZE, y: cy * GOBLIN_CELL_SIZE };
  for (let index = 0; index < 48; index++) {
    const x = min.x + 8 + Math.floor(hash(`${seed}:goblin-x:${cx},${cy},${index}`) * (GOBLIN_CELL_SIZE - 16));
    const y = min.y + 8 + Math.floor(hash(`${seed}:goblin-y:${cx},${cy},${index}`) * (GOBLIN_CELL_SIZE - 16));
    if (!legalWildernessTile(tileAt(seed, x, y), settlements)) continue;
    const id = goblinCellId(seed, cx, cy);
    return { id, x, y, previousX: x, previousY: y, state: 'wandering', path: [], pathIndex: 0, targetAdventurerId: null, speed: GOBLIN_SPEED, nextWanderAt: gameTime, lod: 'sleeping', tickPhase: Math.floor(hash(`${id}:phase`) * 30), lastSimTime: gameTime };
  }
  return null;
}

function neighbors(x: number, y: number) { return [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([dx, dy]) => ({ x: x + dx, y: y + dy })); }
function pathTo(seed: string, start: { x: number; y: number }, target: { x: number; y: number }, settlements: SettlementShell[], avoidSettlements: boolean): Array<{ x: number; y: number }> {
  const origin = { x: Math.round(start.x), y: Math.round(start.y) }; const destination = { x: Math.round(target.x), y: Math.round(target.y) }; const queue = [origin]; const came = new Map<string, string | null>([[`${origin.x},${origin.y}`, null]]); const max = 900;
  while (queue.length && came.size < max) {
    const current = queue.shift()!; if (current.x === destination.x && current.y === destination.y) break;
    for (const next of neighbors(current.x, current.y)) {
      const id = `${next.x},${next.y}`; if (came.has(id)) continue;
      const tile = tileAt(seed, next.x, next.y); if (!tile.walkable || (avoidSettlements && inSettlementExclusion(next.x, next.y, settlements))) continue;
      if (Math.abs(next.x - origin.x) > 28 || Math.abs(next.y - origin.y) > 28) continue;
      came.set(id, `${current.x},${current.y}`); queue.push(next);
    }
  }
  const destinationId = `${destination.x},${destination.y}`; if (!came.has(destinationId)) return [];
  const result: Array<{ x: number; y: number }> = []; let cursor: string | null = destinationId;
  while (cursor && cursor !== `${origin.x},${origin.y}`) { const [x, y] = cursor.split(',').map(Number); result.unshift({ x, y }); cursor = came.get(cursor) ?? null; }
  return result;
}

function advanceAlongPath(goblin: Goblin, seconds: number) {
  let remaining = seconds * goblin.speed;
  while (remaining > 0 && goblin.pathIndex < goblin.path.length) {
    const target = goblin.path[goblin.pathIndex]; const dx = target.x - goblin.x; const dy = target.y - goblin.y; const length = Math.hypot(dx, dy) || 1; const amount = Math.min(remaining, length); goblin.x += dx / length * amount; goblin.y += dy / length * amount; remaining -= amount; if (amount >= length - 1e-6) { goblin.x = target.x; goblin.y = target.y; goblin.pathIndex++; }
  }
  if (goblin.pathIndex >= goblin.path.length) { goblin.path = []; goblin.pathIndex = 0; }
}

export function advanceGoblin(goblin: Goblin, context: GoblinContext, seconds: number) {
  if (goblin.state === 'fighting') { goblin.lastSimTime = context.gameTime; return; }
  goblin.previousX = goblin.x; goblin.previousY = goblin.y;
  const playerDistance = distance(goblin, context.player);
  if (goblin.state === 'wandering' && playerDistance <= NOTICE_RADIUS) goblin.state = 'pursuing-player';
  if (goblin.state === 'pursuing-player' && playerDistance > LEASH_RADIUS) { goblin.state = 'returning-to-wilderness'; goblin.path = []; }
  if (goblin.state === 'pursuing-player') {
    if (context.gameTime >= goblin.nextWanderAt && (!goblin.path.length || goblin.pathIndex >= goblin.path.length)) { goblin.path = pathTo(context.seed, goblin, context.player, context.settlements, false); goblin.pathIndex = 0; goblin.nextWanderAt = context.gameTime + 0.5; }
  } else if (goblin.state === 'returning-to-wilderness') {
    if (!inSettlementExclusion(goblin.x, goblin.y, context.settlements)) goblin.state = 'wandering';
    else if (!goblin.path.length) { const target = neighbors(Math.round(goblin.x), Math.round(goblin.y)).find((point) => legalWildernessTile(tileAt(context.seed, point.x, point.y), context.settlements)); if (target) { goblin.path = pathTo(context.seed, goblin, target, context.settlements, false); goblin.pathIndex = 0; } }
  } else if (goblin.state === 'wandering' && context.gameTime >= goblin.nextWanderAt) {
    const candidates = neighbors(Math.round(goblin.x), Math.round(goblin.y)).filter((point) => legalWildernessTile(tileAt(context.seed, point.x, point.y), context.settlements));
    const candidate = candidates[Math.floor(hash(`${goblin.id}:wander:${Math.floor(context.gameTime / WANDER_INTERVAL)}`) * candidates.length)];
    if (candidate) { goblin.path = [candidate]; goblin.pathIndex = 0; } goblin.nextWanderAt = context.gameTime + WANDER_INTERVAL;
  }
  advanceAlongPath(goblin, seconds); goblin.lastSimTime = context.gameTime;
}

export function sweptContact(a: Goblin, b: { x: number; y: number; previousX?: number; previousY?: number }, radius = 1.25) {
  const ax = a.previousX; const ay = a.previousY; const bx = b.previousX ?? b.x; const by = b.previousY ?? b.y;
  for (let index = 0; index <= 10; index++) { const t = index / 10; const x = (ax + (a.x - ax) * t) - (bx + (b.x - bx) * t); const y = (ay + (a.y - ay) * t) - (by + (b.y - by) * t); if (Math.hypot(x, y) <= radius) return true; }
  return false;
}
