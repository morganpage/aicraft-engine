import { describe, it, expect } from 'vitest';
import {
  createReplayRecorder,
  playReplay,
  replayHash,
} from '../replay';
import type { Replay, ReplayFrame, ReplayConfig } from '../replay';
import type { PlatformerState, PlatformerInput } from '../platformer/types';
import { stepPlatformer } from '../platformer';

/**
 * Build a minimal but valid initial PlatformerState. The platformer kernel
 * doesn't validate field ranges (passes anything through), so a zero-init
 * state is acceptable for replay tests.
 */
function buildInitialState(tick = 0): PlatformerState {
  return Object.freeze({
    core: Object.freeze({
      x: 0,
      y: 0,
      width: 16,
      height: 24,
      vx: 0,
      vy: 0,
      facing: 1 as const,
      onGround: false,
      contacts: Object.freeze({
        groundId: null,
        leftWallId: null,
        rightWallId: null,
        ceilingId: null,
      }),
    }),
    abilities: Object.freeze({}),
    events: Object.freeze({
      justLanded: false,
      justLaunched: false,
      hitCeiling: false,
      hitWall: false,
      startedWallSlide: false,
      wallJumpLaunched: false,
      dashStarted: false,
      doubleJumped: false,
    }),
    tick,
  }) as PlatformerState;
}

const POLLED_IDLE = Object.freeze({
  held: false,
  pressed: false,
  released: false,
});

function frame(moveX: -1 | 0 | 1 = 0): PlatformerInput {
  return Object.freeze({
    moveX,
    jump: POLLED_IDLE,
    dash: null,
  });
}

const STD_CONFIG: ReplayConfig = Object.freeze({ tickRate: 60 });

describe('createReplayRecorder — purity + append semantics', () => {
  it('records inputs in order', () => {
    const r = createReplayRecorder(42, buildInitialState(0));
    r.record(frame(-1));
    r.record(frame(0));
    r.record(frame(1));
    expect(r.pending).toBe(3);
    const replay = r.finish(STD_CONFIG);
    expect(replay.frames.length).toBe(3);
    expect(replay.frames[0].moveX).toBe(-1);
    expect(replay.frames[1].moveX).toBe(0);
    expect(replay.frames[2].moveX).toBe(1);
  });

  it('returns a frozen Replay (no consumer mutation)', () => {
    const replay = createReplayRecorder(0, buildInitialState(0)).finish(STD_CONFIG);
    expect(Object.isFrozen(replay)).toBe(true);
    expect(() => {
      (replay as unknown as { seed: number }).seed = 999;
    }).toThrow();
  });

  it('records even an empty stream — pending starts at 0', () => {
    const r = createReplayRecorder(0, buildInitialState(0));
    expect(r.pending).toBe(0);
  });

  it('finish() freezes the captured frames immutably', () => {
    const r = createReplayRecorder(0, buildInitialState(0));
    r.record(frame(1));
    const replay = r.finish(STD_CONFIG);
    expect(Object.isFrozen(replay.frames)).toBe(true);
    expect(() => {
      (replay.frames as unknown as PlatformerInput[]).push(frame(0));
    }).toThrow();
  });

  it('does not mutate the input PlatformerInput', () => {
    const r = createReplayRecorder(0, buildInitialState(0));
    const input: PlatformerInput = Object.freeze({
      moveX: 1,
      jump: POLLED_IDLE,
      dash: null,
    });
    const snapshot = JSON.parse(JSON.stringify(input));
    r.record(input);
    r.finish(STD_CONFIG);
    expect(input).toEqual(snapshot);
  });

  it('swallows malformed input silently (no throw)', () => {
    const r = createReplayRecorder(0, buildInitialState(0));
    expect(() => r.record(null as unknown as ReplayFrame)).not.toThrow();
    expect(() => r.record(undefined as unknown as ReplayFrame)).not.toThrow();
    expect(() => r.record(42 as unknown as ReplayFrame)).not.toThrow();
    // The bad inputs were dropped, not appended.
    expect(r.finish(STD_CONFIG).frames.length).toBe(0);
  });

  it('finish() then further record() is a silent no-op', () => {
    const r = createReplayRecorder(0, buildInitialState(0));
    r.record(frame(1));
    const replay = r.finish(STD_CONFIG);
    expect(replay.frames.length).toBe(1);
    r.record(frame(-1));
    expect(r.pending).toBe(1); // unchanged
  });

  it('seed falls back to 0 on non-finite input (defensive)', () => {
    const replay = createReplayRecorder(
      Number.NaN,
      buildInitialState(0),
    ).finish(STD_CONFIG);
    expect(replay.seed).toBe(0);
  });
});

describe('playReplay — determinism (byte-identical re-sim)', () => {
  it('matches an equivalent stepPlatformer live run for the same inputs', () => {
    // A no-op solids set (empty array). The kernel still walks the input
    // pipeline and updates tick numbers — that's the determinism surface
    // we can compare on.
    const initial = buildInitialState(0);
    const emptySolids: never[] = [];

    const live: PlatformerState[] = [initial];
    for (let i = 0; i < 5; i++) {
      live.push(stepPlatformer(live[i], frame(1), emptySolids, 1 / 60).state);
    }

    const recorder = createReplayRecorder(42, initial);
    for (let i = 0; i < 5; i++) recorder.record(frame(1));
    const replay = recorder.finish(STD_CONFIG);

    const replayed = playReplay(
      replay,
      (s, f, dt) => stepPlatformer(s, f, emptySolids, dt).state,
      1 / 60,
    );

    // Compare tick + core.vx + core.x — these are what stepPlatformer
    // updates deterministically. Bytes-equal proves the harness re-sim
    // contract.
    expect(replayed.tick).toBe(live[5].tick);
    expect(replayed.core.x).toBe(live[5].core.x);
    expect(replayed.core.vx).toBe(live[5].core.vx);
    expect(replayed.core.y).toBe(live[5].core.y);
  });

  it('an empty frames list returns the initial state without invoking step', () => {
    const initial = buildInitialState(7);
    let stepCalls = 0;
    const step = (s: PlatformerState): PlatformerState => {
      stepCalls++;
      return s;
    };
    const replay: Replay = createReplayRecorder(0, initial).finish(STD_CONFIG);
    const final = playReplay(replay, step, 1 / 60);
    expect(final.tick).toBe(7);
    expect(stepCalls).toBe(0);
  });

  it('identical (replay, step, dt) → byte-identical output (determinism)', () => {
    const initial = buildInitialState(0);
    const recorder = createReplayRecorder(1, initial);
    for (let i = 0; i < 3; i++) recorder.record(frame(0));
    const replay = recorder.finish(STD_CONFIG);
    const step = (s: PlatformerState): PlatformerState => ({ ...s, tick: s.tick + 1 } as unknown as PlatformerState);
    const a = JSON.stringify(playReplay(replay, step, 1 / 60));
    const b = JSON.stringify(playReplay(replay, step, 1 / 60));
    expect(a).toBe(b);
  });

  it('swallows step throws — returns the highest state we reached', () => {
    const initial = buildInitialState(0);
    const recorder = createReplayRecorder(0, initial);
    for (let i = 0; i < 4; i++) recorder.record(frame(0));
    const replay = recorder.finish(STD_CONFIG);

    let calls = 0;
    const step = (s: PlatformerState): PlatformerState => {
      calls++;
      if (calls === 3) throw new Error('simulated crash on tick 3');
      return { ...s, tick: s.tick + 1 } as unknown as PlatformerState;
    };
    const final = playReplay(replay, step, 1 / 60);
    // Step called 3 times; the third threw; we returned state at the end of
    // step #2 (tick == 2).
    expect(calls).toBe(3);
    expect(final.tick).toBe(2);
  });

  it('clamps negative or non-finite dt to 0 (silent no-op)', () => {
    const initial = buildInitialState(0);
    const recorder = createReplayRecorder(0, initial);
    recorder.record(frame(1));
    const replay = recorder.finish(STD_CONFIG);
    const step = (s: PlatformerState): PlatformerState => s;
    expect(() => playReplay(replay, step, -1)).not.toThrow();
    expect(() => playReplay(replay, step, Number.NaN)).not.toThrow();
    expect(() => playReplay(replay, step, Number.POSITIVE_INFINITY)).not.toThrow();
  });

  it('never throws on a null / non-object replay', () => {
    expect(() =>
      playReplay(null as unknown as Replay, (s) => s, 1 / 60),
    ).not.toThrow();
    expect(() =>
      playReplay(42 as unknown as Replay, (s) => s, 1 / 60),
    ).not.toThrow();
  });

  it('never throws on a null step function', () => {
    const replay = createReplayRecorder(0, buildInitialState(0))
      .record(frame(1))
      .finish(STD_CONFIG);
    expect(() =>
      playReplay(replay, null as unknown as (s: PlatformerState) => PlatformerState, 1 / 60),
    ).not.toThrow();
  });
});

describe('replayHash — determinism + tamper detection', () => {
  it('same replay → same hash (determinism)', () => {
    const initial = buildInitialState(0);
    const replay = createReplayRecorder(0, initial).record(frame(0)).finish(STD_CONFIG);
    const a = replayHash(replay);
    const b = replayHash(replay);
    expect(a).toBe(b);
  });

  it('different inputs → different hash with overwhelming probability', () => {
    const initial = buildInitialState(0);
    const r1 = createReplayRecorder(0, initial).record(frame(-1)).finish(STD_CONFIG);
    const r2 = createReplayRecorder(0, initial).record(frame(1)).finish(STD_CONFIG);
    expect(replayHash(r1)).not.toBe(replayHash(r2));
  });

  it('canonical key ordering (swapping field order in config does NOT change hash)', () => {
    const initial = buildInitialState(0);
    // Two configs with the same logical content but different insertion
    // order. canonicalize sorts keys → same hash.
    const cfgA: ReplayConfig = Object.freeze({ tickRate: 60, label: 'test' } as ReplayConfig);
    const cfgB: ReplayConfig = Object.freeze({ label: 'test', tickRate: 60 } as ReplayConfig);
    const rA = createReplayRecorder(0, initial).record(frame(0)).finish(cfgA);
    const rB = createReplayRecorder(0, initial).record(frame(0)).finish(cfgB);
    // cfgA === cfgB content-wise, canonicalization normalizes order.
    // Same hash (modulo any field order — FNV-1a is order-sensitive but
    // canonicalize sorts first).
    expect(replayHash(rA)).toBe(replayHash(rB));
  });

  it('returns 0 (stable) for null / non-object input', () => {
    expect(replayHash(null as unknown as Replay)).toBe(0);
    expect(replayHash(undefined as unknown as Replay)).toBe(0);
    expect(replayHash(42 as unknown as Replay)).toBe(0);
  });

  it('returns a non-negative integer', () => {
    const replay = createReplayRecorder(0, buildInitialState(0))
      .record(frame(0))
      .finish(STD_CONFIG);
    const h = replayHash(replay);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });
});
