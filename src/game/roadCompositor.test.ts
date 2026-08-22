import { describe, expect, it } from 'vitest';
import { composeRoads, type RoadCandidate } from './roadCompositor';

const road = (id: string, tiles: Array<[number, number]>, priority = 0, color = 0): RoadCandidate => ({ id, tiles: tiles.map(([x, y]) => ({ x, y })), points: tiles.map(([x, y]) => ({ x, y })), width: 1, color, priority });

describe('road composition', () => {
  it('draws shared tiles once and keeps unique branches', () => {
    const result = composeRoads([road('main', [[0, 0], [1, 0], [2, 0]], 10), road('branch', [[1, 0], [1, 1], [1, 2]], 1)]);
    expect(result.roads.map((item) => [item.sourceId, item.tiles.map((tile) => `${tile.x},${tile.y}`)])).toEqual([['main', ['0,0', '1,0', '2,0']], ['branch', ['1,1', '1,2']]]);
    expect(result.roads[1].points.map((point) => `${point.x},${point.y}`)).toEqual(['1,0', '1,1', '1,2']);
    expect(result.junctions).toEqual([{ x: 1, y: 0, width: 1, color: 0, priority: 10, sourceId: 'main' }]);
  });

  it('uses priority and stable IDs for exact duplicates', () => {
    const result = composeRoads([road('z', [[0, 0], [1, 0]], 1), road('a', [[0, 0], [1, 0]], 1)]);
    expect(result.roads).toHaveLength(1);
    expect(result.roads[0].sourceId).toBe('a');
    expect(result.junctions).toHaveLength(0);
  });

  it('keeps an isolated one-tile remainder drawable', () => {
    const result = composeRoads([road('main', [[0, 0]], 1)]);
    expect(result.roads[0].points).toHaveLength(1);
  });

  it('uses the higher-priority styling for a mixed-class junction', () => {
    const result = composeRoads([road('trail', [[1, 0], [1, 1]], 1, 0x111111), road('highway', [[0, 0], [1, 0], [2, 0]], 10, 0xeeeeee)]);
    expect(result.junctions[0]).toMatchObject({ x: 1, y: 0, color: 0xeeeeee, priority: 10, sourceId: 'highway' });
  });
});
