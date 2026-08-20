import { describe, expect, it } from 'vitest';
import { findPath, tileAt } from './world';
describe('procedural Emberwild', () => {
  it('is deterministic', () => expect(tileAt('EMBERWILD-01', 11, -8)).toEqual(tileAt('EMBERWILD-01', 11, -8)));
  it('changes with the seed', () => expect(tileAt('EMBERWILD-01', 11, -8)).not.toEqual(tileAt('OTHER', 11, -8)));
  it('finds a walkable route', () => { const path = findPath('EMBERWILD-01', tileAt('EMBERWILD-01', 0, 0), tileAt('EMBERWILD-01', 8, 8)); expect(path.at(-1)?.x).toBe(8); expect(path.at(-1)?.y).toBe(8); });
  it('rejects blocked destinations', () => { const blocked = { ...tileAt('EMBERWILD-01', 0, 0), walkable: false }; expect(findPath('EMBERWILD-01', tileAt('EMBERWILD-01', 1, 1), blocked)).toEqual([]); });
});
