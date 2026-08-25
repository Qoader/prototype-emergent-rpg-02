import { describe, expect, it } from 'vitest';
import { actorMotion, variantForId } from './actorSprites';

describe('actor sprite presentation', () => {
  it('keeps appearance and animation phase stable for an id', () => {
    expect(variantForId('goblin:seed:1')).toEqual(variantForId('goblin:seed:1'));
    expect(variantForId('goblin:seed:1')).not.toEqual(variantForId('goblin:seed:2'));
  });

  it('does not animate stationary actors', () => {
    expect(actorMotion(false, 2, 4, 1)).toEqual({ rotation: 0, bob: 0, moving: false });
  });

  it('limits moving lean and keeps bob within the sprite footprint', () => {
    const motion = actorMotion(true, 20, 1, 0);
    expect(motion.rotation).toBe(0.12);
    expect(Math.abs(motion.bob)).toBeLessThanOrEqual(1.5);
  });
});
