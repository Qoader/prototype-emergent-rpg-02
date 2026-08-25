import { describe, expect, it } from 'vitest';
import { findTravelRoute, selectExplorationTarget, type Adventurer, type TravelTopology } from './adventurers';
import { executePlan, type NpcPlan } from './npcPlanning';
import type { RoadNode } from './roads';
import type { RoadEndpoint } from './regions';

const node = (id: string, ownerId: string, x: number, kind: RoadNode['kind']): RoadNode => ({ id, ownerId, x, y: 0, kind, importance: 1 });
const gate = (id: string, ownerId: string, x: number): RoadEndpoint => ({ id, ownerId, x, y: 0, kind: 'settlement-gate', importance: 1, preferredDirections: ['east'] });
const topology = (): TravelTopology => {
  const a = node('a-gate', 'a', 0, 'settlement-gate'); const portal = node('portal', 'portal', 10, 'region-border'); const b = node('b-gate', 'b', 20, 'settlement-gate');
  return { settlements: [{ id: 'a', name: 'A', x: 0, y: 0, type: 'village', radius: 1, populationClass: 1, footprint: { width: 1, height: 1, rotation: 0 }, anchors: [], accessPoints: [] }, { id: 'b', name: 'B', x: 20, y: 0, type: 'village', radius: 1, populationClass: 1, footprint: { width: 1, height: 1, rotation: 0 }, anchors: [], accessPoints: [] }], arrivalPoints: [], roadLinks: [
    { id: 'a-portal', from: a, to: portal, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], length: 10, width: 1 },
    { id: 'portal-b', from: portal, to: b, points: [{ x: 10, y: 0 }, { x: 20, y: 0 }], length: 10, width: 1 },
  ] };
};

describe('adventurer travel simulation', () => {
  it('joins portal-connected road links into one settlement route', () => {
    const route = findTravelRoute(topology(), 'a'); expect(route?.destinationSettlementId).toBe('b'); expect(route?.length).toBe(20); expect(route?.points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]);
  });

  it('executes every planned waypoint without assigning the destination position', () => {
    const agent = { x: 0, y: 0, previousX: 0, previousY: 0, speed: 3 }; const plan: NpcPlan = { goal: 'visit', steps: [{ kind: 'move', label: 'road', points: [{ x: 10, y: 0 }, { x: 20, y: 0 }] }], stepIndex: 0, pointIndex: 0 };
    expect(executePlan(agent, plan, 1, 1)).toMatchObject({ complete: false }); expect(agent.x).toBeCloseTo(3);
    expect(executePlan(agent, plan, 10, 11)).toMatchObject({ complete: true }); expect(agent.x).toBe(20); expect(agent.previousX).toBeCloseTo(3);
  });

  it('selects the nearest non-home settlement and an eligible plaza for exploration', () => {
    const agent: Adventurer = { id: 'adventurer:a', homeSettlementId: 'a', state: 'idle', currentSettlementId: 'a', x: 0, y: 0, previousX: 0, previousY: 0, speed: 3, idleUntil: 0, lastSimTime: 0, journeyIndex: 0, lod: 'live', tickPhase: 0, plan: null, destinationSettlementId: null, targetGoblinId: null, exploration: { target: null, legIndex: 0, failedSettlementIds: [], consecutiveNoProgress: 0 }, resumeExploration: false };
    const base = topology(); const far: TravelTopology = { ...base, settlements: base.settlements.map((settlement) => settlement.id === 'b' ? { ...settlement, accessPoints: [gate('b-gate', 'b', 20)] } : settlement).concat({ id: 'c', name: 'C', x: 50, y: 0, type: 'city', radius: 1, populationClass: 1, footprint: { width: 1, height: 1, rotation: 0 }, anchors: [], accessPoints: [gate('c-gate', 'c', 50)] }), arrivalPoints: [{ id: 'b:plaza:central', settlementId: 'b', kind: 'central', x: 20, y: 0 }, { id: 'c:plaza:central', settlementId: 'c', kind: 'central', x: 50, y: 0 }, { id: 'c:plaza:peripheral:0', settlementId: 'c', kind: 'peripheral', x: 52, y: 0 }] };
    const target = selectExplorationTarget(agent, far);
    expect(target?.settlementId).toBe('b'); expect(target?.arrival).toMatchObject({ id: 'b:plaza:central', kind: 'central' });
  });
});
