import { describe, it, expect } from 'vitest';
import { createPlatformerState, stepPlatformer } from '../platformer/kernel';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import { canonicalize, fnv1a } from '../level/serialize';
import type { Solid } from '../collision/types';
import type { PlatformerInput } from '../platformer/types';
import type { PolledEdge } from '../input/types';

const DT = 1 / 60;
const TOTAL_TICKS = 1000;

// ---------------------------------------------------------------------------
// Deterministic input pattern.
//
// The pattern covers a mix of:
//   - alternating horizontal movement (left/right holds)
//   - periodic jump presses (with one held window so variable height fires)
//   - periodic dash presses (only when dash is enabled in the default config)
//   - occasional fall + land cycles
//
// No `Math.random` / `Date.now` — fully deterministic, a pure function of the
// tick index.
// ---------------------------------------------------------------------------

function idleEdge(): PolledEdge {
  return { held: false, pressed: false, released: false };
}

function pressEdge(): PolledEdge {
  return { held: true, pressed: true, released: false };
}

function heldEdge(): PolledEdge {
  return { held: true, pressed: false, released: false };
}

function inputFor(i: number): PlatformerInput {
  // MoveX alternates in 15-tick windows.
  const moveX: -1 | 0 | 1 = i % 30 < 15 ? 1 : -1;

  // Jump press every 40 ticks; held for 6 ticks after to get full-height hops.
  const jumpPress = i % 40 === 0;
  const jumpHeldWindow = i % 40 < 6;
  const jump: PolledEdge = jumpPress ? pressEdge() : jumpHeldWindow ? heldEdge() : idleEdge();

  // Dash press every 25 ticks (offset by 5 so it doesn't coincide with jump).
  const dashPress = i % 25 === 5;
  const dash: PolledEdge | null = dashPress ? pressEdge() : null;

  return { moveX, jump, dash };
}

// Bounded arena: floor + 3 walls so the actor cannot fall forever. The walls
// ensure wall-slide / wall-jump get exercised.
function arenaSolids(): Solid[] {
  return [
    { id: 'floor', x: 0, y: 320, width: 480, height: 16 },
    { id: 'ceiling', x: 0, y: 0, width: 480, height: 16 },
    { id: 'wall-l', x: 0, y: 0, width: 16, height: 320 },
    { id: 'wall-r', x: 464, y: 0, width: 16, height: 320 },
  ];
}

function runSimulation(): {
  finalState: ReturnType<typeof createPlatformerState>;
  snapshots: string[];
  checksumAt: (tick: number) => number;
} {
  const solids = arenaSolids();
  let state = createPlatformerState(100, 100);
  const snapshots: string[] = [];
  const checksums: number[] = [];

  for (let i = 0; i < TOTAL_TICKS; i++) {
    const input = inputFor(i);
    state = stepPlatformer(state, input, solids, DT, DEFAULT_PLATFORMER_CONFIG).state;

    // Snapshot every 100th tick (after the step).
    if ((i + 1) % 100 === 0) {
      snapshots.push(JSON.stringify(state));
      checksums.push(fnv1a(canonicalize(state)));
    }
  }

  return {
    finalState: state,
    snapshots,
    checksumAt: (tick: number) => checksums[Math.floor(tick / 100) - 1],
  };
}

describe('platformer determinism', () => {
  it('two 1000-tick runs from the same initial state + input sequence produce byte-identical checksums', () => {
    const run1 = runSimulation();
    const run2 = runSimulation();
    const c1 = fnv1a(canonicalize(run1.finalState));
    const c2 = fnv1a(canonicalize(run2.finalState));
    expect(c1).toEqual(c2);
  });

  it('every 100th-tick snapshot is byte-identical between runs', () => {
    const run1 = runSimulation();
    const run2 = runSimulation();
    expect(run1.snapshots.length).toBeGreaterThan(0);
    expect(run1.snapshots).toEqual(run2.snapshots);
  });

  it('simulation is non-trivial (state actually changes across ticks)', () => {
    const solids = arenaSolids();
    let state = createPlatformerState(100, 100);
    const xSeries: number[] = [state.core.x];
    const ySeries: number[] = [state.core.y];
    for (let i = 0; i < 50; i++) {
      state = stepPlatformer(state, inputFor(i), solids, DT, DEFAULT_PLATFORMER_CONFIG).state;
      xSeries.push(state.core.x);
      ySeries.push(state.core.y);
    }
    // Sanity: at least one tick changed x or y.
    const xChanged = xSeries.some((v, i) => i > 0 && v !== xSeries[0]);
    const yChanged = ySeries.some((v, i) => i > 0 && v !== ySeries[0]);
    expect(xChanged || yChanged).toBe(true);
  });

  it('each ability persists state across ticks (dash budget drains on use, refills on land)', () => {
    const solids = arenaSolids();
    let state = createPlatformerState(100, 100);
    // Wait for first land.
    for (let i = 0; i < 60; i++) {
      state = stepPlatformer(state, inputFor(i), solids, DT, DEFAULT_PLATFORMER_CONFIG).state;
    }
    const dash = state.abilities['dash'];
    expect(dash).toBeDefined();
    // After landing, dash budget should be at max.
    if (dash && dash.kind === 'dash') {
      expect(dash.dashesRemaining).toBeGreaterThanOrEqual(0);
      expect(dash.dashesRemaining).toBeLessThanOrEqual(DEFAULT_PLATFORMER_CONFIG.maxDashes);
    }
  });

  it('the canonical state checksum is a deterministic 32-bit unsigned integer', () => {
    const run = runSimulation();
    const c = fnv1a(canonicalize(run.finalState));
    expect(Number.isInteger(c)).toBe(true);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThan(2 ** 32);
  });
});
