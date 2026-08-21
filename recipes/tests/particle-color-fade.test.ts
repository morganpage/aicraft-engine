import { describe, expect, it } from 'vitest';
import { advance, mixHex, type Particle } from 'aicraft-engine';
import { advanceWithColorFade, particleColorAt, type ColorFadeParticle } from '../particle-color-fade';

const fresh: ColorFadeParticle = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  life: 60,
  maxLife: 60,
  size: 2,
  color: '#000000',
  colorEnd: '#ffffff',
};

describe('advanceWithColorFade', () => {
  it('preserves colorEnd across an advance (the engine drops it)', () => {
    const stepped = advanceWithColorFade([fresh], 30);
    expect(stepped[0].colorEnd).toBe('#ffffff');
    expect(stepped[0].life).toBe(30);

    // The contrast case — the engine's own advance enumerates fields and
    // destroys the tag after one tick. This is why the recipe exists.
    const engineStepped: Particle[] = advance([fresh], 30);
    expect('colorEnd' in engineStepped[0]).toBe(false);
  });

  it('physics output is byte-identical to the engine advance', () => {
    const withFade = advanceWithColorFade([fresh], 30, { gravity: 0.5, drag: 0.9 });
    const plain = advance([fresh], 30, { gravity: 0.5, drag: 0.9 });
    const { colorEnd: _tag, ...fadeParticle } = withFade[0];
    expect(fadeParticle).toEqual(plain[0]);
  });

  it('leaves particles without a tag untouched (no extra fields added)', () => {
    const untagged: ColorFadeParticle = { ...fresh, colorEnd: undefined };
    const stepped = advanceWithColorFade([untagged], 10);
    expect('colorEnd' in stepped[0]).toBe(false);
  });
});

describe('particleColorAt', () => {
  it('lerps color → colorEnd over remaining life', () => {
    expect(particleColorAt(fresh)).toBe('#000000');
    const half = { ...fresh, life: 30 };
    expect(particleColorAt(half)).toBe(mixHex('#000000', '#ffffff', 0.5));
    const dead = { ...fresh, life: 0 };
    expect(particleColorAt(dead)).toBe('#ffffff');
  });

  it('returns the start color unchanged when there is no tag', () => {
    expect(particleColorAt({ ...fresh, colorEnd: undefined })).toBe('#000000');
  });
});
