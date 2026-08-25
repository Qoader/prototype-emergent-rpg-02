import type { SettlementShell } from './regions';
import type { RoadNode, TravelRoadLink } from './roads';
import type { WorldPoint } from './settlements';

export interface TravelTopology { settlements: SettlementShell[]; roadLinks: TravelRoadLink[]; }
export interface TravelRoute { destinationSettlementId: string; points: WorldPoint[]; cumulative: number[]; length: number; width: number; }
export type AdventurerState = 'idle' | 'travelling' | 'exploring';
export type AdventurerLod = 'live' | 'coarse' | 'sparse' | 'sleeping';
export interface Adventurer { id: string; homeSettlementId: string; state: AdventurerState; currentSettlementId: string | null; route: TravelRoute | null; routeDistance: number; speed: number; idleUntil: number; lastSimTime: number; journeyIndex: number; lod: AdventurerLod; tickPhase: number; }
export interface SampledAdventurer { x: number; y: number; rotation: number; state: AdventurerState; width: number; }

const SPEED = 3;
const MIN_DWELL = 3;
const MAX_DWELL = 10;

function hash(value: string) { let result = 2166136261; for (const character of value) { result ^= character.charCodeAt(0); result = Math.imul(result, 16777619); } return (result >>> 0) / 4294967296; }
function distance(a: WorldPoint, b: WorldPoint) { return Math.hypot(a.x - b.x, a.y - b.y); }
function samePoint(a: WorldPoint, b: WorldPoint) { return a.x === b.x && a.y === b.y; }
function cumulative(points: WorldPoint[]) { const result = [0]; for (let index = 1; index < points.length; index++) result.push(result[index - 1] + distance(points[index - 1], points[index])); return result; }
function joinedPoints(parts: Array<{ points: WorldPoint[]; reverse: boolean }>) { const result: WorldPoint[] = []; for (const part of parts) { const points = part.reverse ? part.points.slice().reverse() : part.points; for (const point of points) if (!result.length || !samePoint(result.at(-1)!, point)) result.push(point); } return result; }

/** Finds the nearest settlement reachable through roads and portal vertices. */
export function findTravelRoute(topology: TravelTopology, fromSettlementId: string, previousDestinationId?: string): TravelRoute | null {
  const linksByNode = new Map<string, Array<{ link: TravelRoadLink; next: RoadNode; reverse: boolean }>>();
  for (const link of topology.roadLinks) {
    const add = (node: RoadNode, next: RoadNode, reverse: boolean) => { const values = linksByNode.get(node.id) ?? []; values.push({ link, next, reverse }); linksByNode.set(node.id, values); };
    add(link.from, link.to, false); add(link.to, link.from, true);
  }
  const starts = topology.roadLinks.flatMap((link) => [link.from, link.to]).filter((node) => node.ownerId === fromSettlementId);
  if (!starts.length) return null;
  const costs = new Map<string, number>(); const previous = new Map<string, { node: string; link: TravelRoadLink; reverse: boolean }>(); const queue = starts.map((node) => { costs.set(node.id, 0); return node; });
  while (queue.length) {
    queue.sort((a, b) => (costs.get(a.id)! - costs.get(b.id)!) || a.id.localeCompare(b.id)); const current = queue.shift()!; const currentCost = costs.get(current.id)!;
    if (current.ownerId && current.ownerId !== fromSettlementId && current.kind === 'settlement-gate' && current.ownerId !== previousDestinationId) {
      const pieces: Array<{ points: WorldPoint[]; reverse: boolean; width: number }> = []; let cursor = current.id;
      while (previous.has(cursor)) { const step = previous.get(cursor)!; pieces.unshift({ points: step.link.points, reverse: step.reverse, width: step.link.width }); cursor = step.node; }
      const points = joinedPoints(pieces); const values = cumulative(points); return points.length > 1 ? { destinationSettlementId: current.ownerId, points, cumulative: values, length: values.at(-1)!, width: pieces[0]?.width ?? 1 } : null;
    }
    for (const edge of linksByNode.get(current.id) ?? []) {
      const nextCost = currentCost + edge.link.length; if (nextCost >= (costs.get(edge.next.id) ?? Infinity)) continue;
      costs.set(edge.next.id, nextCost); previous.set(edge.next.id, { node: current.id, link: edge.link, reverse: edge.reverse }); queue.push(edge.next);
    }
  }
  return null;
}

function routeWidth(route: TravelRoute) { return route.width || 1; }
function pointAt(route: TravelRoute, progress: number) {
  const target = Math.max(0, Math.min(route.length, progress)); let index = 1;
  while (index < route.cumulative.length && route.cumulative[index] < target) index++;
  const a = route.points[Math.max(0, index - 1)]; const b = route.points[Math.min(route.points.length - 1, index)]; const segmentStart = route.cumulative[Math.max(0, index - 1)]; const segmentLength = Math.max(0.0001, route.cumulative[Math.min(route.cumulative.length - 1, index)] - segmentStart); const ratio = (target - segmentStart) / segmentLength;
  return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio, rotation: Math.atan2(b.y - a.y, b.x - a.x) };
}

export function createAdventurer(settlement: SettlementShell, gameTime = 0): Adventurer | null {
  if (hash(`home:${settlement.id}`) >= 1 / 3) return null;
  const id = `adventurer:${settlement.id}`; const dwell = MIN_DWELL + hash(`${id}:initial-dwell`) * (MAX_DWELL - MIN_DWELL);
  return { id, homeSettlementId: settlement.id, state: 'idle', currentSettlementId: settlement.id, route: null, routeDistance: 0, speed: SPEED, idleUntil: gameTime + dwell, lastSimTime: gameTime, journeyIndex: 0, lod: 'sleeping', tickPhase: Math.floor(hash(`${id}:phase`) * 30) };
}

export function advanceAdventurer(adventurer: Adventurer, topology: TravelTopology, gameTime: number, previousDestinationId?: string) {
  if (gameTime <= adventurer.lastSimTime) return;
  let remaining = gameTime - adventurer.lastSimTime; let guard = 0;
  while (remaining > 0 && guard++ < 128) {
    if (adventurer.state === 'idle' || adventurer.state === 'exploring') {
      const wait = Math.max(0, adventurer.idleUntil - adventurer.lastSimTime);
      if (wait > remaining) { adventurer.lastSimTime = gameTime; return; }
      remaining -= wait; adventurer.lastSimTime += wait;
      const route = adventurer.currentSettlementId ? findTravelRoute(topology, adventurer.currentSettlementId, previousDestinationId) : null;
      if (!route) { adventurer.state = 'exploring'; adventurer.idleUntil = adventurer.lastSimTime + MIN_DWELL; continue; }
      adventurer.route = route; adventurer.routeDistance = 0; adventurer.state = 'travelling'; adventurer.currentSettlementId = null;
    }
    if (adventurer.state === 'travelling' && adventurer.route) {
      const travelTime = (adventurer.route.length - adventurer.routeDistance) / adventurer.speed;
      if (travelTime > remaining) { adventurer.routeDistance += remaining * adventurer.speed; adventurer.lastSimTime = gameTime; return; }
      remaining -= travelTime; adventurer.lastSimTime += travelTime; adventurer.currentSettlementId = adventurer.route.destinationSettlementId; adventurer.routeDistance = adventurer.route.length; adventurer.state = 'idle'; adventurer.journeyIndex++; adventurer.idleUntil = adventurer.lastSimTime + MIN_DWELL + hash(`${adventurer.id}:dwell:${adventurer.journeyIndex}`) * (MAX_DWELL - MIN_DWELL); adventurer.route = null;
    }
  }
  adventurer.lastSimTime = gameTime;
}

export function sampleAdventurer(adventurer: Adventurer, gameTime: number): SampledAdventurer | null {
  if (!adventurer.route || adventurer.state !== 'travelling') return null;
  const progress = adventurer.routeDistance + Math.max(0, gameTime - adventurer.lastSimTime) * adventurer.speed; const point = pointAt(adventurer.route, progress);
  return { ...point, width: routeWidth(adventurer.route), state: adventurer.state };
}
