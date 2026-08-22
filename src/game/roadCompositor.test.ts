import { describe, expect, it } from 'vitest';
import { composeRoads, type RoadCandidate } from './roadCompositor';

const road = (id: string, tiles: Array<[number, number]>, priority = 0): RoadCandidate => ({ id, tiles: tiles.map(([x, y]) => ({ x, y })), points: tiles.map(([x, y]) => ({ x, y })), width: 1, color: 0, priority });

describe('road composition', () => {
  it('draws shared tiles once and keeps unique branches', () => {
    const result = composeRoads([road('main', [[0, 0], [1, 0], [2, 0]], 10), road('branch', [[1, 0], [1, 1], [1, 2]], 1)]);
    expect(result.map((item) => [item.sourceId, item.tiles.map((tile) => `${tile.x},${tile.y}`)])).toEqual([['main', ['0,0', '1,0', '2,0']], ['branch', ['1,1', '1,2']]]);
  });

  it('uses priority and stable IDs for exact duplicates', () => {
    const result = composeRoads([road('z', [[0, 0], [1, 0]], 1), road('a', [[0, 0], [1, 0]], 1)]);
    expect(result).toHaveLength(1);
    expect(result[0].sourceId).toBe('a');
  });

  it('keeps an isolated one-tile remainder drawable', () => {
    const result = composeRoads([road('main', [[0, 0]], 1)]);
    expect(result[0].points).toHaveLength(1);
  });
});
