import { findPath, tileAt } from './world';
import type { SettlementShell } from './regions';
import type { RoadNode, TravelRoadLink } from './roads';
import type { WorldPoint } from './settlements';
import { executePlan, type NpcPlan } from './npcPlanning';

export interface TravelTopology { settlements: SettlementShell[]; roadLinks: TravelRoadLink[]; }
export interface TravelRoute { destinationSettlementId: string; sourceGate: RoadNode; destinationGate: RoadNode; points: WorldPoint[]; length: number; width: number; }
export type AdventurerState = 'idle' | 'travelling' | 'exploring' | 'pursuing-opponent' | 'fighting';
export type AdventurerLod = 'live' | 'coarse' | 'sparse' | 'sleeping';
export interface Adventurer { id: string; homeSettlementId: string; state: AdventurerState; currentSettlementId: string | null; x: number; y: number; previousX: number; previousY: number; speed: number; idleUntil: number; lastSimTime: number; journeyIndex: number; lod: AdventurerLod; tickPhase: number; plan: NpcPlan | null; destinationSettlementId: string | null; targetGoblinId: string | null; }
export interface SampledAdventurer { x: number; y: number; rotation: number; state: AdventurerState; width: number; }

const SPEED = 3; const MIN_DWELL = 3; const MAX_DWELL = 10;
function hash(value: string) { let result = 2166136261; for (const character of value) { result ^= character.charCodeAt(0); result = Math.imul(result, 16777619); } return (result >>> 0) / 4294967296; }
function distance(a: WorldPoint, b: WorldPoint) { return Math.hypot(a.x - b.x, a.y - b.y); }
function samePoint(a: WorldPoint, b: WorldPoint) { return a.x === b.x && a.y === b.y; }
function joinedPoints(parts: Array<{ points: WorldPoint[]; reverse: boolean }>) { const result: WorldPoint[] = []; for (const part of parts) for (const point of (part.reverse ? part.points.slice().reverse() : part.points)) if (!result.length || !samePoint(result.at(-1)!, point)) result.push(point); return result; }

/** Finds the nearest reachable settlement and preserves both physical road gates. */
export function findTravelRoute(topology: TravelTopology, fromSettlementId: string, previousDestinationId?: string): TravelRoute | null {
  const linksByNode = new Map<string, Array<{ link: TravelRoadLink; next: RoadNode; reverse: boolean }>>(); const nodes = new Map<string, RoadNode>();
  for (const link of topology.roadLinks) { nodes.set(link.from.id, link.from); nodes.set(link.to.id, link.to); const add = (node: RoadNode, next: RoadNode, reverse: boolean) => { const values = linksByNode.get(node.id) ?? []; values.push({ link, next, reverse }); linksByNode.set(node.id, values); }; add(link.from, link.to, false); add(link.to, link.from, true); }
  const starts = [...nodes.values()].filter((node) => node.ownerId === fromSettlementId && node.kind === 'settlement-gate'); if (!starts.length) return null;
  const costs = new Map<string, number>(); const previous = new Map<string, { node: string; link: TravelRoadLink; reverse: boolean }>(); const queue = starts.map((node) => { costs.set(node.id, 0); return node; });
  while (queue.length) { queue.sort((a, b) => (costs.get(a.id)! - costs.get(b.id)!) || a.id.localeCompare(b.id)); const current = queue.shift()!; const currentCost = costs.get(current.id)!;
    if (current.ownerId !== fromSettlementId && current.kind === 'settlement-gate' && current.ownerId !== previousDestinationId) { const parts: Array<{ points: WorldPoint[]; reverse: boolean }> = []; let cursor = current.id; while (previous.has(cursor)) { const step = previous.get(cursor)!; parts.unshift({ points: step.link.points, reverse: step.reverse }); cursor = step.node; } const points = joinedPoints(parts); const sourceGate = nodes.get(cursor); if (sourceGate && points.length > 1) return { destinationSettlementId: current.ownerId, sourceGate, destinationGate: current, points, length: points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0), width: 1 }; }
    for (const edge of linksByNode.get(current.id) ?? []) { const nextCost = currentCost + edge.link.length; if (nextCost >= (costs.get(edge.next.id) ?? Infinity)) continue; costs.set(edge.next.id, nextCost); previous.set(edge.next.id, { node: current.id, link: edge.link, reverse: edge.reverse }); queue.push(edge.next); }
  }
  return null;
}

function localPath(seed: string, from: WorldPoint, to: WorldPoint) { if (samePoint(from, to)) return []; const points = findPath(seed, tileAt(seed, Math.round(from.x), Math.round(from.y)), tileAt(seed, Math.round(to.x), Math.round(to.y))); const last = points.at(-1); return last && last.x === Math.round(to.x) && last.y === Math.round(to.y) ? points : null; }
function visitAnchor(settlement: SettlementShell) { const choices = settlement.anchors.filter((anchor) => anchor.type === 'center' || anchor.type === 'market'); return choices[Math.floor(Math.random() * choices.length)] ?? settlement.anchors[0]; }

export function createAdventurer(settlement: SettlementShell, gameTime = 0): Adventurer | null { if (hash(`home:${settlement.id}`) >= 1 / 3) return null; const id = `adventurer:${settlement.id}`; const dwell = MIN_DWELL + hash(`${id}:initial-dwell`) * (MAX_DWELL - MIN_DWELL); const anchor = settlement.anchors.find((candidate) => candidate.type === 'center') ?? settlement.anchors[0] ?? settlement; return { id, homeSettlementId: settlement.id, state: 'idle', currentSettlementId: settlement.id, x: anchor.x, y: anchor.y, previousX: anchor.x, previousY: anchor.y, speed: SPEED, idleUntil: gameTime + dwell, lastSimTime: gameTime, journeyIndex: 0, lod: 'sleeping', tickPhase: Math.floor(hash(`${id}:phase`) * 30), plan: null, destinationSettlementId: null, targetGoblinId: null }; }

export function advanceAdventurer(adventurer: Adventurer, topology: TravelTopology, gameTime: number, seed: string) {
  const seconds = Math.max(0, gameTime - adventurer.lastSimTime); if (!seconds) return;
  if (adventurer.state === 'fighting') { adventurer.previousX = adventurer.x; adventurer.previousY = adventurer.y; adventurer.lastSimTime = gameTime; return; }
  if (adventurer.plan) { const result = executePlan(adventurer, adventurer.plan, seconds, gameTime); if (result.complete) { const destination = topology.settlements.find((settlement) => settlement.id === adventurer.destinationSettlementId); adventurer.plan = null; if (adventurer.state === 'pursuing-opponent') { adventurer.state = 'idle'; adventurer.targetGoblinId = null; } else { adventurer.currentSettlementId = destination?.id ?? null; adventurer.destinationSettlementId = null; adventurer.state = 'idle'; adventurer.journeyIndex++; adventurer.idleUntil = gameTime + MIN_DWELL + hash(`${adventurer.id}:dwell:${adventurer.journeyIndex}`) * (MAX_DWELL - MIN_DWELL); } } adventurer.lastSimTime = gameTime; return; }
  adventurer.previousX = adventurer.x; adventurer.previousY = adventurer.y;
  if (gameTime < adventurer.idleUntil || !adventurer.currentSettlementId) { adventurer.lastSimTime = gameTime; return; }
  const route = findTravelRoute(topology, adventurer.currentSettlementId); const destination = route && topology.settlements.find((settlement) => settlement.id === route.destinationSettlementId); if (!route || !destination) { adventurer.idleUntil = gameTime + MIN_DWELL; adventurer.state = 'exploring'; adventurer.lastSimTime = gameTime; return; }
  const anchor = visitAnchor(destination); const departure = localPath(seed, adventurer, route.sourceGate); const arrival = localPath(seed, route.destinationGate, anchor); if (!departure || !arrival) { adventurer.idleUntil = gameTime + MIN_DWELL; adventurer.lastSimTime = gameTime; return; }
  adventurer.plan = { goal: 'visit-settlement', steps: [{ kind: 'move', points: departure, label: 'leave-settlement' }, { kind: 'move', points: route.points, label: 'follow-road' }, { kind: 'move', points: arrival, label: 'enter-settlement' }], stepIndex: 0, pointIndex: 0 }; adventurer.destinationSettlementId = destination.id; adventurer.currentSettlementId = null; adventurer.state = 'travelling'; adventurer.lastSimTime = gameTime;
}

/** Materializes an exact local interception path; the caller keeps the target valid and replans as it moves. */
export function pursueGoblin(adventurer: Adventurer, goblin: WorldPoint & { id: string }, gameTime: number, seed: string) {
  if (adventurer.state === 'fighting' || (adventurer.targetGoblinId === goblin.id && adventurer.plan)) return;
  const points = localPath(seed, adventurer, goblin); if (!points) return;
  adventurer.plan = { goal: 'engage-opponent', steps: [{ kind: 'move', points, label: 'pursue-goblin' }], stepIndex: 0, pointIndex: 0 }; adventurer.targetGoblinId = goblin.id; adventurer.destinationSettlementId = null; adventurer.currentSettlementId = null; adventurer.state = 'pursuing-opponent'; adventurer.lastSimTime = gameTime;
}

export function sampleAdventurer(adventurer: Adventurer): SampledAdventurer { const dx = adventurer.x - adventurer.previousX; const dy = adventurer.y - adventurer.previousY; return { x: adventurer.x, y: adventurer.y, rotation: Math.atan2(dy, dx), width: 1, state: adventurer.state }; }
