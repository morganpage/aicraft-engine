import { describe, expect, it } from 'vitest';
import { IDLE_EDGE, type PolledEdge } from 'aicraft-engine';
import { derivePlatformerInput } from '../platformer-input';

const held = (h: boolean): PolledEdge => ({ held: h, pressed: false, released: false });

describe('derivePlatformerInput', () => {
  it('an empty edge map is a fully neutral input', () => {
    const input = derivePlatformerInput({});
    expect(input.moveX).toBe(0);
    expect(input.moveY).toBe(0);
    expect(input.jump).toBe(IDLE_EDGE);
    expect(input.dash).toBe(IDLE_EDGE);
    expect(input.grab).toBe(IDLE_EDGE);
  });

  it('held directionals become signed movement (up is negative Y)', () => {
    const input = derivePlatformerInput({
      left: held(true),
      up: held(true),
    });
    expect(input.moveX).toBe(-1);
    expect(input.moveY).toBe(-1);

    const opposite = derivePlatformerInput({
      right: held(true),
      down: held(true),
    });
    expect(opposite.moveX).toBe(1);
    expect(opposite.moveY).toBe(1);
  });

  it('both directions held cancel to zero', () => {
    const input = derivePlatformerInput({ left: held(true), right: held(true) });
    expect(input.moveX).toBe(0);
  });

  it('unmapped action edges fall back to the frozen IDLE_EDGE singleton', () => {
    const input = derivePlatformerInput({ jump: { held: true, pressed: true, released: false } });
    expect(input.jump.held).toBe(true);
    expect(input.grab).toBe(IDLE_EDGE);
    expect(input.grab).toBe(IDLE_EDGE); // same frozen reference, not a copy
  });

  it('pressed-but-not-held directionals contribute nothing to movement', () => {
    const input = derivePlatformerInput({
      right: { held: false, pressed: true, released: false },
    });
    expect(input.moveX).toBe(0);
  });
});
