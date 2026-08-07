import { describe, expect, it } from 'vitest';
import { deriveSpriteAnimKind } from '../sprites/anim-state';
import type { SpriteAnimInputs } from '../sprites/anim-state';

function inputs(partial: Partial<SpriteAnimInputs>): SpriteAnimInputs {
  return { supported: true, speedX: 0, velocityY: 0, gravityDir: 1, ...partial };
}

describe('deriveSpriteAnimKind', () => {
  it('grounded + slow → idle', () => {
    expect(deriveSpriteAnimKind(inputs({ supported: true, speedX: 0 }))).toBe('idle');
    expect(deriveSpriteAnimKind(inputs({ supported: true, speedX: 5 }))).toBe('idle');
  });

  it('grounded + fast → walk', () => {
    expect(deriveSpriteAnimKind(inputs({ supported: true, speedX: 50 }))).toBe('walk');
    expect(deriveSpriteAnimKind(inputs({ supported: true, speedX: -50 }))).toBe('walk');
  });

  it('airborne + moving up → ascent', () => {
    expect(deriveSpriteAnimKind(inputs({ supported: false, velocityY: -200 }))).toBe('ascent');
  });

  it('airborne + moving down → descent', () => {
    expect(deriveSpriteAnimKind(inputs({ supported: false, velocityY: 200 }))).toBe('descent');
  });

  it('airborne + near-zero vertical → apex', () => {
    expect(deriveSpriteAnimKind(inputs({ supported: false, velocityY: 0 }))).toBe('apex');
  });

  it('respects inverted gravity (ceiling climb)', () => {
    // gravityDir -1 flips the sign convention: +vy is "up" relative to gravity.
    expect(deriveSpriteAnimKind(inputs({ supported: false, velocityY: 200, gravityDir: -1 }))).toBe('ascent');
    expect(deriveSpriteAnimKind(inputs({ supported: false, velocityY: -200, gravityDir: -1 }))).toBe('descent');
  });

  it('honors a custom walk threshold', () => {
    expect(deriveSpriteAnimKind(inputs({ supported: true, speedX: 20, walkThreshold: 100 }))).toBe('idle');
    expect(deriveSpriteAnimKind(inputs({ supported: true, speedX: 20, walkThreshold: 10 }))).toBe('walk');
  });
});
