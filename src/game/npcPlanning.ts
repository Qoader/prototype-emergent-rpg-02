export interface WorldPoint { x: number; y: number; }

export interface GoalDefinition<F> { id: string; priority: (facts: F) => number; desired: (facts: F) => boolean; }
export interface ActionDefinition<F> { id: string; cost: number; applicable: (facts: F) => boolean; apply: (facts: F) => F; }

/** Small, deterministic forward planner. NPC adapters materialize the selected symbolic actions into paths. */
export function planGoals<F>(initial: F, goals: GoalDefinition<F>[], actions: ActionDefinition<F>[], key: (facts: F) => string, maxStates = 64) {
  const goal = goals.filter((candidate) => candidate.priority(initial) > 0).sort((a, b) => b.priority(initial) - a.priority(initial) || a.id.localeCompare(b.id))[0];
  if (!goal) return null;
  const queue: Array<{ facts: F; actions: ActionDefinition<F>[]; cost: number }> = [{ facts: initial, actions: [], cost: 0 }];
  const seen = new Map<string, number>([[key(initial), 0]]);
  while (queue.length && seen.size <= maxStates) {
    queue.sort((a, b) => a.cost - b.cost || a.actions.map((action) => action.id).join('|').localeCompare(b.actions.map((action) => action.id).join('|')));
    const current = queue.shift()!;
    if (goal.desired(current.facts)) return { goal: goal.id, actions: current.actions };
    for (const action of actions.filter((candidate) => candidate.applicable(current.facts)).sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))) {
      const next = action.apply(current.facts); const nextCost = current.cost + action.cost; const nextKey = key(next);
      if ((seen.get(nextKey) ?? Infinity) <= nextCost) continue;
      seen.set(nextKey, nextCost); queue.push({ facts: next, actions: [...current.actions, action], cost: nextCost });
    }
  }
  return null;
}

export type PlanStep =
  | { kind: 'move'; points: WorldPoint[]; label: string }
  | { kind: 'wait'; until: number; label: string }
  | { kind: 'hold'; label: string };
export interface NpcPlan { goal: string; steps: PlanStep[]; stepIndex: number; pointIndex: number; }
export interface MovingAgent { x: number; y: number; previousX: number; previousY: number; speed: number; }

export function executePlan(agent: MovingAgent, plan: NpcPlan | null, seconds: number, gameTime: number) {
  agent.previousX = agent.x; agent.previousY = agent.y;
  if (!plan) return { complete: false, moved: false };
  let remaining = seconds * agent.speed; let moved = false;
  while (plan.stepIndex < plan.steps.length) {
    const step = plan.steps[plan.stepIndex];
    if (step.kind === 'hold') return { complete: false, moved };
    if (step.kind === 'wait') { if (gameTime < step.until) return { complete: false, moved }; plan.stepIndex++; continue; }
    while (remaining > 0 && plan.pointIndex < step.points.length) {
      const target = step.points[plan.pointIndex]; const dx = target.x - agent.x; const dy = target.y - agent.y; const length = Math.hypot(dx, dy);
      if (length < 1e-6) { plan.pointIndex++; continue; }
      const amount = Math.min(remaining, length); agent.x += dx / length * amount; agent.y += dy / length * amount; remaining -= amount; moved = true;
      if (amount >= length - 1e-6) { agent.x = target.x; agent.y = target.y; plan.pointIndex++; }
    }
    if (plan.pointIndex < step.points.length) return { complete: false, moved };
    plan.stepIndex++; plan.pointIndex = 0;
  }
  return { complete: true, moved };
}

export function exactPath(points: WorldPoint[], destination: WorldPoint) {
  const last = points.at(-1); return Boolean(last && Math.hypot(last.x - destination.x, last.y - destination.y) < 1e-6);
}
