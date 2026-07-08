import { describe, it, expect } from 'vitest';
import {
  createFootPlantState,
  advanceFootPlant,
} from '../animation/foot-plant';
import type { FootPlantState } from '../animation/foot-plant';

describe('createFootPlantState', () => {
  it('returns a fresh state with both prev-lift values at 0', () => {
    const state = createFootPlantState();
    expect(state).toEqual({ prevLeftLift: 0, prevRightLift: 0 });
  });

  it('returns a new object each call (not a shared singleton)', () => {
    const a = createFootPlantState();
    const b = createFootPlantState();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('advanceFootPlant — edge-detection truth table', () => {
  it('fires BOTH events when both feet go from airborne (>0) to planted (0)', () => {
    const state: FootPlantState = { prevLeftLift: 3, prevRightLift: 5 };
    const result = advanceFootPlant(state, 0, 0);
    expect(result.events.leftPlanted).toBe(true);
    expect(result.events.rightPlanted).toBe(true);
  });

  it('fires ONLY the planting foot when the other stays airborne', () => {
    const state: FootPlantState = { prevLeftLift: 3, prevRightLift: 5 };
    const result = advanceFootPlant(state, 0, 4);
    expect(result.events.leftPlanted).toBe(true);
    expect(result.events.rightPlanted).toBe(false);
  });

  it('fires ONLY the right foot when left stays airborne', () => {
    const state: FootPlantState = { prevLeftLift: 3, prevRightLift: 5 };
    const result = advanceFootPlant(state, 2, 0);
    expect(result.events.leftPlanted).toBe(false);
    expect(result.events.rightPlanted).toBe(true);
  });

  it('fires NEITHER event when both were already planted (idle / standing)', () => {
    const state: FootPlantState = { prevLeftLift: 0, prevRightLift: 0 };
    const result = advanceFootPlant(state, 0, 0);
    expect(result.events.leftPlanted).toBe(false);
    expect(result.events.rightPlanted).toBe(false);
  });

  it('never fires when a foot stays airborne across the tick (prev>0, curr>0)', () => {
    const state: FootPlantState = { prevLeftLift: 3, prevRightLift: 5 };
    const result = advanceFootPlant(state, 2, 4);
    expect(result.events.leftPlanted).toBe(false);
    expect(result.events.rightPlanted).toBe(false);
  });

  it('does not fire the lift-off edge (0 → >0): plant fires only on descent', () => {
    const planted: FootPlantState = { prevLeftLift: 0, prevRightLift: 0 };
    const lifted = advanceFootPlant(planted, 4, 6);
    expect(lifted.events.leftPlanted).toBe(false);
    expect(lifted.events.rightPlanted).toBe(false);
  });

  it('fires plant after a full lift-and-land cycle (0 → >0 → 0)', () => {
    let state = createFootPlantState();
    // lift off
    state = advanceFootPlant(state, 4, 0).state;
    // swing (still airborne)
    state = advanceFootPlant(state, 5, 3).state;
    // land
    const result = advanceFootPlant(state, 0, 0);
    expect(result.events.leftPlanted).toBe(true);
    expect(result.events.rightPlanted).toBe(true);
  });

  it('is defensive against negative prev-lift: strict >0 guard never fires for prev ≤ 0', () => {
    const state: FootPlantState = { prevLeftLift: -2, prevRightLift: -0.5 };
    const result = advanceFootPlant(state, 0, 0);
    expect(result.events.leftPlanted).toBe(false);
    expect(result.events.rightPlanted).toBe(false);
  });

  it('handles staggered plants across consecutive ticks with state threading', () => {
    let state = createFootPlantState();
    // Both feet airborne at tick N.
    state = advanceFootPlant(state, 3, 3).state;
    expect(state).toEqual({ prevLeftLift: 3, prevRightLift: 3 });

    // Tick N: left plants, right stays airborne.
    const tickN = advanceFootPlant(state, 0, 2);
    expect(tickN.events.leftPlanted).toBe(true);
    expect(tickN.events.rightPlanted).toBe(false);
    expect(tickN.state).toEqual({ prevLeftLift: 0, prevRightLift: 2 });

    // Tick N+1: right plants, left already planted (no double-fire).
    const tickN1 = advanceFootPlant(tickN.state, 0, 0);
    expect(tickN1.events.leftPlanted).toBe(false);
    expect(tickN1.events.rightPlanted).toBe(true);
    expect(tickN1.state).toEqual({ prevLeftLift: 0, prevRightLift: 0 });
  });
});

describe('advanceFootPlant — purity / non-mutation', () => {
  it('does not mutate the input state (prev-lift values unchanged after call)', () => {
    const input: FootPlantState = { prevLeftLift: 4, prevRightLift: 6 };
    advanceFootPlant(input, 0, 0);
    expect(input.prevLeftLift).toBe(4);
    expect(input.prevRightLift).toBe(6);
  });

  it('returns a fresh result object (not the same reference as input state)', () => {
    const input: FootPlantState = { prevLeftLift: 4, prevRightLift: 6 };
    const result = advanceFootPlant(input, 0, 0);
    expect(result.state).not.toBe(input);
    expect(result).not.toBe(input);
  });

  it('returns a fresh state with the current lift values carried forward', () => {
    const input: FootPlantState = { prevLeftLift: 4, prevRightLift: 6 };
    const result = advanceFootPlant(input, 1.5, 2.5);
    expect(result.state).toEqual({ prevLeftLift: 1.5, prevRightLift: 2.5 });
  });
});
