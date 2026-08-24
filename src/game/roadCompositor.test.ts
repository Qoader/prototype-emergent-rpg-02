import { describe, expect, it } from 'vitest';
import { composeRoads, type RoadCandidate } from './roadCompositor';

const road = (id: string, tiles: Array<[number, number]>, priority = 0, color = 0, width = 1): RoadCandidate => ({ id, tiles: tiles.map(([x, y]) => ({ x, y })), points: tiles.map(([x, y]) => ({ x, y })), width, color, priority });

describe('road composition', () => {
  it('draws shared tiles once and keeps unique branches', () => {
    const result = composeRoads([road('main', [[0, 0], [1, 0], [2, 0]], 10), road('branch', [[1, 0], [1, 1], [1, 2]], 1)]);
    expect(result.roads.map((item) => [item.sourceId, item.tiles.map((tile) => `${tile.x},${tile.y}`)])).toEqual([['main', ['0,0', '1,0', '2,0']], ['branch', ['1,1', '1,2']]]);
    expect(result.roads[1].points.map((point) => `${point.x},${point.y}`)).toEqual(['1,0', '1,1', '1,2']);
  });

  it('uses priority and stable IDs for exact duplicates', () => {
    const result = composeRoads([road('z', [[0, 0], [1, 0]], 1), road('a', [[0, 0], [1, 0]], 1)]);
    expect(result.roads).toHaveLength(1);
    expect(result.roads[0].sourceId).toBe('a');
  });

  it('keeps an isolated one-tile remainder drawable', () => {
    const result = composeRoads([road('main', [[0, 0]], 1)]);
    expect(result.roads[0].points).toHaveLength(1);
  });

  it('uses the higher-priority styling for a mixed-class junction', () => {
    const result = composeRoads([road('trail', [[1, 0], [1, 1]], 1, 0x111111), road('highway', [[0, 0], [1, 0], [2, 0]], 10, 0xeeeeee)]);
    expect(result.roads[1].points[0]).toEqual({ x: 1, y: 0 });
  });

  it('extends a lower road into a wider winning road', () => {
    const result = composeRoads([road('branch', [[1, 0], [1, 1]], 1, 0x111111, 1), road('highway', [[0, 0], [1, 0], [2, 0]], 10, 0xeeeeee, 3)]);
    expect(result.roads[1].points[0]).toEqual({ x: 1, y: -0.4125 });
  });

  it('extends a lower road from its trailing endpoint into a wider winner', () => {
    const result = composeRoads([road('branch', [[1, -1], [1, 0]], 1, 0x111111, 1), road('highway', [[0, 0], [1, 0], [2, 0]], 10, 0xeeeeee, 3)]);
    expect(result.roads[1].points.at(-1)).toEqual({ x: 1, y: 0.4125 });
  });

  it('extends along diagonal branch direction', () => {
    const result = composeRoads([road('branch', [[0, 0], [1, 1]], 1, 0x111111, 1), road('highway', [[0, 0], [1, 0], [2, 0]], 10, 0xeeeeee, 3)]);
    expect(result.roads[1].points[0].x).toBeCloseTo(-0.292);
    expect(result.roads[1].points[0].y).toBeCloseTo(-0.292);
  });

  it('does not leave a visible tail when the winner is narrower', () => {
    const result = composeRoads([road('branch', [[1, 0], [1, 1]], 10, 0x111111, 3), road('lane', [[0, 0], [1, 0], [2, 0]], 20, 0xeeeeee, 1)]);
    expect(result.roads[1].points[0]).toEqual({ x: 1, y: 0 });
  });
});
