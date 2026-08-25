import { Container, Graphics } from 'pixi.js';

export type ActorKind = 'player' | 'adventurer' | 'goblin';
export interface ActorVariant { palette: number; accessory: number; phase: number; }
export interface ActorSprite extends Container { figure: Container; shadow: Graphics; }

/** Small deterministic hash used for appearance and animation phase. */
export function variantForId(id: string): ActorVariant {
  let hash = 2166136261;
  for (const character of id) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  const value = hash >>> 0;
  return { palette: value % 3, accessory: Math.floor(value / 3) % 3, phase: (value % 1000) / 1000 * Math.PI * 2 };
}

export interface ActorMotion { rotation: number; bob: number; moving: boolean; }
export function actorMotion(moving: boolean, heading: number, elapsed: number, phase = 0): ActorMotion {
  if (!moving) return { rotation: 0, bob: 0, moving: false };
  return { rotation: Math.max(-0.12, Math.min(0.12, heading * 0.08)), bob: Math.sin(elapsed * 15 + phase) * 1.5, moving: true };
}

const ADVENTURER_PALETTES = [0xb9573d, 0x527c72, 0x9b6947];
const GOBLIN_CLOTHES = [0x435744, 0x584d3d, 0x4a455a];

/** Creates a full-size actor whose local origin is the feet anchor. */
export function createActorSprite(kind: ActorKind, variant: ActorVariant = variantForId(kind)): ActorSprite {
  const root = new Container() as ActorSprite;
  const shadow = new Graphics().ellipse(0, 13, 13, 5).fill({ color: 0x10261f, alpha: 0.35 });
  const figure = new Container();
  const clothes = kind === 'goblin' ? GOBLIN_CLOTHES[variant.palette] : kind === 'adventurer' ? ADVENTURER_PALETTES[variant.palette] : 0xb9573d;
  const skin = kind === 'goblin' ? 0x78a552 : 0xefc58f;
  const g = new Graphics()
    .circle(-8, 7, 5).fill(0x283b3b).circle(8, 7, 5).fill(0x283b3b)
    .roundRect(-10, -4, 20, 20, 7).fill(clothes)
    .moveTo(-12, 4).lineTo(0, -16).lineTo(12, 4).fill(kind === 'goblin' ? 0x65764d : 0xd8874c)
    .circle(0, -13, 8).fill(skin);
  if (kind === 'goblin') {
    g.moveTo(-7, -16).lineTo(-14, -21).lineTo(-9, -10).fill(skin).moveTo(7, -16).lineTo(14, -21).lineTo(9, -10).fill(skin)
      .circle(-3, -14, 1.4).fill(0xe7d78b).circle(3, -14, 1.4).fill(0xe7d78b)
      .moveTo(-4, -8).lineTo(0, -6).lineTo(4, -8).stroke({ color: 0x273c2c, width: 1.2 });
  } else {
    g.moveTo(-8, -16).quadraticCurveTo(0, -27, 8, -16).fill(0x263b3e);
  }
  if (kind === 'adventurer' || kind === 'player') g.roundRect(-12, -2, 5, 11, 2).fill(kind === 'adventurer' ? (variant.accessory === 1 ? 0x6b4b36 : 0x75503a) : 0x75503a);
  if (kind === 'adventurer' && variant.accessory === 2) g.circle(10, -1, 3).fill(0xd4ad55);
  figure.addChild(g); root.addChild(shadow, figure); root.figure = figure; root.shadow = shadow;
  return root;
}

export function applyActorMotion(sprite: ActorSprite, motion: ActorMotion) {
  sprite.figure.rotation = motion.rotation;
  sprite.figure.y = motion.bob;
}
