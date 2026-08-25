import { describe, expect, it } from 'vitest';
import { createGoblin, GOBLIN_CELL_SIZE, inSettlementExclusion, legalWildernessTile, settlementExclusionRadius } from './goblins';
import { tileAt } from './world';
import type { SettlementShell } from './regions';

const settlement = (type: SettlementShell['type'] = 'village'): SettlementShell => ({ id: 'town', name: 'Town', x: 0, y: 0, type, radius: 10, populationClass: 1, footprint: { width: 1, height: 1, rotation: 0 }, anchors: [], accessPoints: [] });

describe('goblin population and wilderness rules', () => {
  it('uses stable grid identities and candidate positions', () => {
    const first = createGoblin('GOBLIN-TEST', 4, -3, [settlement()], 2);
    const second = createGoblin('GOBLIN-TEST', 4, -3, [settlement()], 2);
    expect(second).toEqual(first);
    if (first) expect(first.x).toBeGreaterThanOrEqual(4 * GOBLIN_CELL_SIZE);
  });

  it('keeps wandering candidates outside settlement exclusion', () => {
    const town = settlement('city');
    expect(settlementExclusionRadius(town)).toBe(44);
    expect(inSettlementExclusion(20, 0, [town])).toBe(true);
    expect(inSettlementExclusion(50, 0, [town])).toBe(false);
    expect(legalWildernessTile(tileAt('GOBLIN-TEST', 50, 0), [town])).toBe(tileAt('GOBLIN-TEST', 50, 0).walkable);
  });
});
