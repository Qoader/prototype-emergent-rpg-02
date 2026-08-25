import { describe, expect, it } from 'vitest';
import { findTravelRoute, type TravelTopology } from './adventurers';
import { executePlan, type NpcPlan } from './npcPlanning';
import type { RoadNode } from './roads';

const node = (id: string, ownerId: string, x: number, kind: RoadNode['kind']): RoadNode => ({ id, ownerId, x, y: 0, kind, importance: 1 });
const topology = (): TravelTopology => {
  const a = node('a-gate', 'a', 0, 'settlement-gate'); const portal = node('portal', 'portal', 10, 'region-border'); const b = node('b-gate', 'b', 20, 'settlement-gate');
  return { settlements: [{ id: 'a', name: 'A', x: 0, y: 0, type: 'village', radius: 1, populationClass: 1, footprint: { width: 1, height: 1, rotation: 0 }, anchors: [], accessPoints: [] }, { id: 'b', name: 'B', x: 20, y: 0, type: 'village', radius: 1, populationClass: 1, footprint: { width: 1, height: 1, rotation: 0 }, anchors: [], accessPoints: [] }], roadLinks: [
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
});
