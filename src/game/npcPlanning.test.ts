import { describe, expect, it } from 'vitest';
import { executePlan, planGoals, type NpcPlan } from './npcPlanning';

describe('NPC planning', () => {
  it('chooses the highest-priority reachable goal with stable action ordering', () => {
    type Facts = { armed: boolean; safe: boolean };
    const result = planGoals<Facts>({ armed: false, safe: false }, [{ id: 'survive', priority: () => 10, desired: (facts) => facts.safe }], [
      { id: 'z-arm', cost: 1, applicable: (facts) => !facts.armed, apply: (facts) => ({ ...facts, armed: true }) },
      { id: 'a-hide', cost: 1, applicable: (facts) => facts.armed, apply: (facts) => ({ ...facts, safe: true }) },
    ], (facts) => `${facts.armed}:${facts.safe}`);
    expect(result?.goal).toBe('survive'); expect(result?.actions.map((action) => action.id)).toEqual(['z-arm', 'a-hide']);
  });

  it('moves only through the active plan waypoints', () => {
    const agent = { x: 0, y: 0, previousX: 0, previousY: 0, speed: 2 }; const plan: NpcPlan = { goal: 'move', steps: [{ kind: 'move', label: 'test', points: [{ x: 1, y: 0 }, { x: 1, y: 2 }] }], stepIndex: 0, pointIndex: 0 };
    executePlan(agent, plan, 1, 1); expect(agent).toMatchObject({ x: 1, y: 1 });
    expect(executePlan(agent, plan, 1, 2)).toMatchObject({ complete: true }); expect(agent).toMatchObject({ x: 1, y: 2 });
  });
});
