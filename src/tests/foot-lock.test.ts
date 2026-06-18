import { describe, it, expect } from 'vitest';
import { advanceFootLock, getFootLockTarget } from '../animation/foot-lock';
import type { FootLockState } from '../animation/foot-lock';
import { FOOT_LOCK_DEFAULT_BLEND_SPEED } from '../animation/constants';

describe('advanceFootLock', () => {
  it('locks and ramps blendWeight toward 1 when grounded', () => {
    const state: FootLockState = {
      isLocked: false,
      lockPos: { x: 0, y: 0 },
      blendWeight: 0,
    };
    const next = advanceFootLock(state, true, { x: 5, y: 5 }, 0.1, 10);
    expect(next.isLocked).toBe(true);
    expect(next.blendWeight).toBeCloseTo(1, 5);
    expect(next.lockPos).toEqual({ x: 5, y: 5 });
  });

  it('unlocks and ramps blendWeight toward 0 when airborne', () => {
    const state: FootLockState = {
      isLocked: true,
      lockPos: { x: 5, y: 5 },
      blendWeight: 1,
    };
    const next = advanceFootLock(state, false, { x: 6, y: 6 }, 0.1, 10);
    expect(next.isLocked).toBe(false);
    expect(next.blendWeight).toBeCloseTo(0, 5);
  });

  it('clamps blendWeight to [0, 1] on large steps', () => {
    const grounded = advanceFootLock(
      { isLocked: true, lockPos: { x: 0, y: 0 }, blendWeight: 1 },
      true,
      { x: 0, y: 0 },
      1,
      100,
    );
    expect(grounded.blendWeight).toBe(1);
    const airborne = advanceFootLock(
      { isLocked: false, lockPos: { x: 0, y: 0 }, blendWeight: 0 },
      false,
      { x: 0, y: 0 },
      1,
      100,
    );
    expect(airborne.blendWeight).toBe(0);
  });

  it('holds the original lockPos once locked (does not recapture)', () => {
    const state: FootLockState = {
      isLocked: true,
      lockPos: { x: 5, y: 5 },
      blendWeight: 0.5,
    };
    const next = advanceFootLock(state, true, { x: 99, y: 99 }, 0.1, 10);
    expect(next.lockPos).toEqual({ x: 5, y: 5 });
  });

  it('defaults blendSpeed to FOOT_LOCK_DEFAULT_BLEND_SPEED', () => {
    const state: FootLockState = {
      isLocked: false,
      lockPos: { x: 0, y: 0 },
      blendWeight: 0,
    };
    const next = advanceFootLock(state, true, { x: 0, y: 0 }, 0.1);
    expect(next.blendWeight).toBeCloseTo(FOOT_LOCK_DEFAULT_BLEND_SPEED * 0.1, 5);
  });

  it('does not mutate the input state', () => {
    const state: FootLockState = {
      isLocked: false,
      lockPos: { x: 0, y: 0 },
      blendWeight: 0,
    };
    const snap = JSON.parse(JSON.stringify(state));
    advanceFootLock(state, true, { x: 5, y: 5 }, 0.1, 10);
    expect(state).toEqual(snap);
  });
});

describe('getFootLockTarget', () => {
  it('returns the animated position when blendWeight is 0', () => {
    const state: FootLockState = {
      isLocked: false,
      lockPos: { x: 100, y: 100 },
      blendWeight: 0,
    };
    expect(getFootLockTarget(state, { x: 5, y: 7 })).toEqual({ x: 5, y: 7 });
  });

  it('returns the lock position when blendWeight is 1', () => {
    const state: FootLockState = {
      isLocked: true,
      lockPos: { x: 10, y: 20 },
      blendWeight: 1,
    };
    expect(getFootLockTarget(state, { x: 5, y: 7 })).toEqual({ x: 10, y: 20 });
  });

  it('lerps at the midpoint (blendWeight 0.5)', () => {
    const state: FootLockState = {
      isLocked: true,
      lockPos: { x: 10, y: 20 },
      blendWeight: 0.5,
    };
    expect(getFootLockTarget(state, { x: 0, y: 0 })).toEqual({ x: 5, y: 10 });
  });

  it('does not mutate the input state or animated position', () => {
    const state: FootLockState = {
      isLocked: true,
      lockPos: { x: 10, y: 20 },
      blendWeight: 0.5,
    };
    const animated = { x: 0, y: 0 };
    const stateSnap = JSON.parse(JSON.stringify(state));
    const animSnap = { ...animated };
    getFootLockTarget(state, animated);
    expect(state).toEqual(stateSnap);
    expect(animated).toEqual(animSnap);
  });
});
