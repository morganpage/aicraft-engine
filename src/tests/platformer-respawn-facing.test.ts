/**
 * `createPlatformerState` facing parameter — the respawn contract. A real
 * build stored the seam-entry facing on its respawn anchor and then rebuilt
 * with the default (right) facing, so every leftward entry respawned into the
 * wall it had come through. The constructor now takes the facing; this pins
 * both the parameter and the default.
 */
import { describe, expect, it } from 'vitest';
import { createPlatformerState } from '../index';

describe('createPlatformerState — facing', () => {
  it('defaults to facing right (1)', () => {
    expect(createPlatformerState(0, 0).core.facing).toBe(1);
  });

  it('applies an explicit leftward facing for respawn rebuilds', () => {
    const anchor = { x: 120, y: 40, facing: -1 as const };
    const state = createPlatformerState(anchor.x, anchor.y, undefined, 4, 12, anchor.facing);
    expect(state.core.facing).toBe(-1);
    // Everything else about a fresh state is untouched by the facing.
    expect(state.core.x).toBe(120);
    expect(state.core.y).toBe(40);
    expect(state.core.vx).toBe(0);
    expect(state.core.vy).toBe(0);
  });

  it('the anchor-rebuild spread is no longer needed (parity check)', () => {
    const fresh = createPlatformerState(10, 10, undefined, 4, 12, -1);
    const handSpread = { ...createPlatformerState(10, 10, undefined, 4, 12), core: { ...createPlatformerState(10, 10, undefined, 4, 12).core, facing: -1 as const } };
    expect(fresh.core).toEqual(handSpread.core);
  });
});
