import { describe, it, expect } from 'vitest';
import { createRidingTracker } from '../platformer/riding-tracker';
import type { ActorCore } from '../platformer/types';

/**
 * Unit tests for the moving-platform carry tracker (`createRidingTracker`).
 *
 * The tracker is the entirety of the kernel's step-2 logic: read
 * `core.contacts.groundId`, ask the consumer's provider for that solid's
 * per-tick displacement, and apply it to the actor's position BEFORE ability
 * processing. Pure, never throws.
 */

function makeCore(groundId: string | null): ActorCore {
  return {
    x: 100,
    y: 50,
    width: 16,
    height: 24,
    vx: 0,
    vy: 0,
    facing: 1,
    onGround: groundId !== null,
    contacts: {
      groundId,
      leftWallId: null,
      rightWallId: null,
      ceilingId: null,
    },
  };
}

describe('createRidingTracker', () => {
  it('swallows throwing and malformed displacement providers', () => {
    const tracker = createRidingTracker();
    const core = makeCore('platform');
    expect(() => tracker.applyCarry(core, () => { throw new Error('hostile'); })).not.toThrow();
    expect(tracker.applyCarry(core, () => ({ dx: Number.NaN, dy: 1 }))).toBe(core);
    expect(tracker.applyCarry(core, () => undefined as never)).toBe(core);
  });

  it('no groundId: returns the input core unchanged', () => {
    const tracker = createRidingTracker();
    const core = makeCore(null);
    const result = tracker.applyCarry(core, () => ({ dx: 5, dy: 0 }));
    expect(result).toBe(core);
  });

  it('displacement applied: groundId set + provider returns dx/dy → x/y adjusted', () => {
    const tracker = createRidingTracker();
    const core = makeCore('plat-1');
    const result = tracker.applyCarry(core, () => ({ dx: 5, dy: -3 }));
    expect(result.x).toBe(105);
    expect(result.y).toBe(47);
  });

  it('provider returns null: core returned unchanged', () => {
    const tracker = createRidingTracker();
    const core = makeCore('plat-1');
    const result = tracker.applyCarry(core, () => null);
    expect(result).toBe(core);
  });

  it('no provider: core returned unchanged', () => {
    const tracker = createRidingTracker();
    const core = makeCore('plat-1');
    const result = tracker.applyCarry(core, null);
    expect(result).toBe(core);
  });

  it('zero displacement: core returned unchanged (no-op short-circuit)', () => {
    const tracker = createRidingTracker();
    const core = makeCore('plat-1');
    const result = tracker.applyCarry(core, () => ({ dx: 0, dy: 0 }));
    expect(result).toBe(core);
  });

  it('provider receives the groundId from the core', () => {
    const tracker = createRidingTracker();
    const core = makeCore('plat-7');
    let received: string | null = null;
    tracker.applyCarry(core, (id) => {
      received = id;
      return { dx: 1, dy: 0 };
    });
    expect(received).toBe('plat-7');
  });

  it('pure: input core not mutated', () => {
    const tracker = createRidingTracker();
    const core = makeCore('plat-1');
    const snap = JSON.parse(JSON.stringify(core)) as ActorCore;
    tracker.applyCarry(core, () => ({ dx: 5, dy: -3 }));
    expect(core).toEqual(snap);
  });

  it('pure: returns a fresh object (not the input reference) when displacement applied', () => {
    const tracker = createRidingTracker();
    const core = makeCore('plat-1');
    const result = tracker.applyCarry(core, () => ({ dx: 5, dy: -3 }));
    expect(result).not.toBe(core);
  });
});
