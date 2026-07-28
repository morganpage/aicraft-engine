/**
 * End-to-end fixture tests using a custom non-platformer adapter.
 *
 * Scenario: gravity-flip two-room navigation.
 *   - Room A (start): reach x >= 10 to advance to Room B.
 *   - Room B (exit):  reach x >= 20 to win.
 *   - Gravity sign: +1 (normal) or -1 (flipped). Affects movement direction.
 *   - Action: moveX (-1/0/1) and flip (toggle gravity sign).
 */
import { describe, it, expect } from 'vitest';
import {
  verifyScenario,
  playSimulationTrace,
} from '../simtest';
import type {
  SimulationAdapter,
  SimulationPolicy,
  SimulationTrace,
} from '../simtest';

// ---------------------------------------------------------------------------
// Custom types
// ---------------------------------------------------------------------------

interface GravityFlipAction {
  readonly moveX: -1 | 0 | 1;
  readonly flip: boolean;
}

interface GravityFlipState {
  readonly roomId: string;      // 'A' | 'B'
  readonly gravitySign: 1 | -1; // direction multiplier
  readonly x: number;
  readonly y: number;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const GRAVITY_ADAPTER: SimulationAdapter<GravityFlipState, GravityFlipAction> = {
  id: 'gravity-flip-test',
  version: 1,
  scenarioFingerprint: 'two-room-v1',

  createInitialState: (_seed: number): GravityFlipState => ({
    roomId: 'A',
    gravitySign: 1,
    x: 0,
    y: 0,
  }),

  actions: (): readonly GravityFlipAction[] => [
    { moveX: -1, flip: false },
    { moveX: 0, flip: false },
    { moveX: 1, flip: false },
    { moveX: 0, flip: true },
    { moveX: 1, flip: true },
    { moveX: -1, flip: true },
  ],

  step: (state, action): GravityFlipState => {
    // Move: gravitySign flips direction
    const newX = state.x + action.moveX * state.gravitySign;
    // Flip toggles gravity
    const newGravity: 1 | -1 = action.flip
      ? (state.gravitySign === 1 ? -1 : 1)
      : state.gravitySign;

    // Room transition
    let newRoom = state.roomId;
    let adjustedX = newX;
    if (newRoom === 'A' && newX >= 10) {
      newRoom = 'B';
      adjustedX = 0;
    }

    return {
      roomId: newRoom,
      gravitySign: newGravity,
      x: adjustedX,
      y: 0,
    };
  },

  outcome: (state): 'running' | 'success' | 'failure' => {
    if (state.roomId === 'B' && state.x >= 20) return 'success';
    return 'running';
  },

  summarize: (state) => ({
    roomId: state.roomId,
    x: state.x,
    gravitySign: state.gravitySign,
  }),
};

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

/** Always moves right, never flips. */
const GO_RIGHT: SimulationPolicy<GravityFlipState, GravityFlipAction> = () => ({
  moveX: 1,
  flip: false,
});

/** Always moves right, flips every tick (useless oscillating). */
const OSCILLATE: SimulationPolicy<GravityFlipState, GravityFlipAction> = () => ({
  moveX: 1,
  flip: true,
});

/** Always moves left (can't reach exit). */
const GO_LEFT: SimulationPolicy<GravityFlipState, GravityFlipAction> = () => ({
  moveX: -1,
  flip: false,
});

/** Strategy: move right until room B, then move right some more (wins). */
const WINNING_POLICY: SimulationPolicy<GravityFlipState, GravityFlipAction> = (
  _state,
) => {
  // Just move right always. With gravitySign = 1, moveX:1 moves right positively.
  // When we transition to room B, we continue moving right.
  return { moveX: 1, flip: false };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GravityFlip fixture — verifyScenario', () => {
  it('winning policy reaches exit (proven-success)', () => {
    const result = verifyScenario(GRAVITY_ADAPTER, {
      maxTicks: 100,
      policies: [WINNING_POLICY],
    });
    expect(result.status).toBe('proven-success');
    expect(result.winningTrace).toBeDefined();
    expect(result.winningTraceHash).toBeGreaterThanOrEqual(0);
    expect(result.runs[0].termination).toBe('success');
    expect(result.runs[0].ticks).toBeGreaterThan(0);
    expect(result.runs[0].trace.actions.length).toBe(result.runs[0].ticks);
  });

  it('wrong policy (going left) cannot succeed', () => {
    const result = verifyScenario(GRAVITY_ADAPTER, {
      maxTicks: 100,
      policies: [GO_LEFT, OSCILLATE],
    });
    expect(result.status).toBe('inconclusive');
    expect(result.runs).toHaveLength(2);
    // Going left stays in room A forever (never reaches x>=10)
    expect(result.runs[0].termination).toBe('tick-budget');
  });

  it('winning policy beats failing ones (first success wins)', () => {
    const result = verifyScenario(GRAVITY_ADAPTER, {
      maxTicks: 100,
      policies: [GO_LEFT, GO_RIGHT, OSCILLATE],
    });
    expect(result.status).toBe('proven-success');
    // GO_RIGHT moves right each tick with gravitySign=1, so x increases by 1 each tick
    // Room A: 10 ticks to reach x=10 → room B, x=0
    // Room B: 20 ticks to reach x=20 → success
    // Total: ~30 ticks
    expect(result.runs[1].termination).toBe('success');
    expect(result.winningTrace).toBeDefined();
  });
});

describe('GravityFlip fixture — playSimulationTrace', () => {
  it('can replay a winning trace from verifyScenario', () => {
    const vr = verifyScenario(GRAVITY_ADAPTER, {
      maxTicks: 100,
      policies: [WINNING_POLICY],
    });
    const trace = vr.winningTrace!;

    const playback = playSimulationTrace(GRAVITY_ADAPTER, trace);
    expect(playback.valid).toBe(true);
    expect(playback.outcome).toBe('success');
    // State should be in room B with x >= 20
    expect(playback.state!.roomId).toBe('B');
    expect(playback.state!.x).toBeGreaterThanOrEqual(20);
  });

  it('can replay a manually-constructed trace', () => {
    // Build a trace that should succeed: move right 10 times in room A,
    // then 20 times in room B
    const actions: GravityFlipAction[] = [];
    for (let i = 0; i < 10; i++) actions.push({ moveX: 1, flip: false });
    for (let i = 0; i < 20; i++) actions.push({ moveX: 1, flip: false });

    const trace: SimulationTrace<GravityFlipAction> = {
      version: 1,
      adapterId: 'gravity-flip-test',
      adapterVersion: 1,
      scenarioFingerprint: 'two-room-v1',
      seed: 0,
      fixedDt: 1 / 60,
      actions,
    };

    const result = playSimulationTrace(GRAVITY_ADAPTER, trace);
    expect(result.valid).toBe(true);
    expect(result.outcome).toBe('success');
    expect(result.state!.roomId).toBe('B');
    expect(result.state!.x).toBeGreaterThanOrEqual(20);
  });

  it('fingerprint mismatch on playback returns invalid', () => {
    const trace: SimulationTrace<GravityFlipAction> = {
      version: 1,
      adapterId: 'gravity-flip-test',
      adapterVersion: 1,
      scenarioFingerprint: 'old-version-fp',
      seed: 0,
      fixedDt: 1 / 60,
      actions: [{ moveX: 1, flip: false }],
    };
    const result = playSimulationTrace(GRAVITY_ADAPTER, trace);
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0].code).toBe('SCENARIO_FINGERPRINT_MISMATCH');
  });
});

describe('GravityFlip fixture — trace hashing', () => {
  it('same adapter/scenario/seed gives same hash', () => {
    const r1 = verifyScenario(GRAVITY_ADAPTER, {
      maxTicks: 100,
      seed: 42,
      policies: [WINNING_POLICY],
    });
    const r2 = verifyScenario(GRAVITY_ADAPTER, {
      maxTicks: 100,
      seed: 42,
      policies: [WINNING_POLICY],
    });
    expect(r1.winningTraceHash).toBe(r2.winningTraceHash);
  });
});
