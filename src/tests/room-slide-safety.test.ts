import { describe, expect, it } from 'vitest';
import { createPlatformerState } from '../platformer/kernel';
import { protectGroundedRoomSlide } from '../platformer/room-slide-safety';
import type { PlatformerInput, PlatformerState } from '../platformer/types';
import type { Solid } from '../collision/types';

const EDGE = { pressed: false, released: false, held: false };

function input(overrides: Partial<PlatformerInput> = {}): PlatformerInput {
  return {
    moveX: 1,
    moveY: 0,
    jump: EDGE,
    dash: EDGE,
    grab: EDGE,
    ...overrides,
  };
}

function groundedState(x: number): PlatformerState {
  const state = createPlatformerState(x, 76);
  return {
    ...state,
    core: {
      ...state.core,
      onGround: true,
      vx: 120,
      vy: 0,
    },
  };
}

describe('protectGroundedRoomSlide', () => {
  const floor: Solid = { id: 'short-floor', x: 0, y: 100, width: 48, height: 16 };

  it('holds a grounded actor at the end of a short seam support', () => {
    const previous = groundedState(24);
    const candidate: PlatformerState = {
      ...previous,
      core: {
        ...previous.core,
        x: 40,
        y: 76,
        vx: 120,
        vy: 0,
        onGround: true,
      },
    };

    const guarded = protectGroundedRoomSlide(previous, candidate, input(), [floor], true);
    expect(guarded.core.x).toBe(32);
    expect(guarded.core.y).toBe(76);
    expect(guarded.core.vx).toBe(0);
    expect(guarded.core.vy).toBe(0);
    expect(guarded.core.onGround).toBe(true);
  });

  it('does not clamp an explicit jump during a slide', () => {
    const previous = groundedState(40);
    const candidate: PlatformerState = {
      ...previous,
      core: { ...previous.core, x: 44, y: 70, vx: 120, vy: -240, onGround: false },
    };
    const jumped = protectGroundedRoomSlide(
      previous,
      candidate,
      input({ jump: { pressed: true, released: false, held: true } }),
      [floor],
      true,
    );
    expect(jumped).toBe(candidate);
  });

  it('is inert outside an active slide or when the candidate remains supported', () => {
    const previous = groundedState(20);
    const candidate: PlatformerState = {
      ...previous,
      core: { ...previous.core, x: 24, y: 76, vx: 120 },
    };
    expect(protectGroundedRoomSlide(previous, candidate, input(), [floor], false)).toBe(candidate);
    expect(protectGroundedRoomSlide(previous, candidate, input(), [floor], true)).toBe(candidate);
  });
});
