/**
 * Multi-tick integration-test harness for the platformer kernel.
 *
 * Phase 0a deliverable: a small, reusable, deterministic toolbox for driving
 * `stepPlatformer` through a per-tick input script and recording a compact
 * per-tick trace. The trace captures the "(vx, vy, x, y, mode)" tuple the
 * roadmap wants — `mode` is approximated by `phase + dashTimer + wallSliding +
 * climbing` because a first-class `mode` field does not exist until Phase 0d.
 *
 * This module is a NON-TEST helper: it is type-checked by `npm run build`
 * (`tsc --noEmit`, which includes `src`) but is NOT run by vitest (only
 * `*.test.ts` files are) and is excluded from `dist` by `tsconfig.build.json`.
 * Later waves (0b onward) extend it — keep it generic and free of scenario
 * specifics.
 *
 * Determinism: built entirely on the pure `stepPlatformer` kernel + the
 * `canonicalize`/`fnv1a` pipeline. Same inputs → byte-identical trace and
 * hash, forever. Floats are rounded to 6 decimals in the trace rows so
 * snapshots stay readable without sacrificing enough precision to mask a real
 * trajectory change (a physics refactor shifts values by far more than 1e-6).
 *
 * @module
 */

import { stepPlatformer } from '../platformer/kernel';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import { canonicalize, fnv1a } from '../level/serialize';
import { createReplayRecorder } from '../replay/recorder';
import { replayHash } from '../replay/hash';
import { CURRENT_PHYSICS_VERSION } from '../replay/constants';
import type { Solid } from '../collision/types';
import type { PolledEdge } from '../input/types';
import type {
  PlatformerConfig,
  PlatformerEvents,
  PlatformerInput,
  PlatformerState,
} from '../platformer/types';

/** Fixed timestep used by every trace in the suite (60 Hz). */
export const DT = 1 / 60;

// ---------------------------------------------------------------------------
// Edge + input builders.
//
// `PolledEdge` is `{ held, pressed, released }` — a drained per-tick snapshot
// of one action. `pressed`/`released` are single-tick edges; `held` is
// continuous. Each helper returns a fresh object so recording one into a
// `Replay` and passing another to `stepPlatformer` never aliases.
// ---------------------------------------------------------------------------

/** An idle edge: nothing held, no press, no release. */
export function idleEdge(): PolledEdge {
  return { held: false, pressed: false, released: false };
}

/** A press edge: `pressed=true` for this one tick. `held` defaults to true. */
export function pressEdge(held = true): PolledEdge {
  return { held, pressed: true, released: false };
}

/** A hold edge: button down, no edge this tick (`held=true` only). */
export function holdEdge(): PolledEdge {
  return { held: true, pressed: false, released: false };
}

/** A release edge: button just released (`released=true`, `held=false`). */
export function releaseEdge(held = false): PolledEdge {
  return { held, pressed: false, released: true };
}

/** A canonical idle `PlatformerInput`: no move, no jump, no dash. */
export function idleInput(): PlatformerInput {
  return { moveX: 0, jump: idleEdge(), dash: null };
}

/** Symbolic jump-edge modes accepted by {@link makeInput}. */
export type JumpEdgeMode = 'press' | 'hold' | 'release' | 'idle';

/** Options for {@link makeInput}. Every field optional; sensible defaults. */
export interface MakeInputOptions {
  /**
   * Horizontal intent — a signed magnitude in `[-1, 1]` (Phase 9 analog
   * widening). Digital callers pass `-1`/`0`/`1` (unchanged behavior); analog
   * tests may pass a fractional value (e.g. `0.5`). Default `0`.
   */
  readonly moveX?: number;
  /**
   * Vertical intent: -1 (up), 0 (idle), +1 (down). Drives the climb ability on
   * a ladder and the fast-fall cap in the air. Omitted ⇒ `0` (idle).
   */
  readonly moveY?: -1 | 0 | 1;
  /** Jump edge mode. Default `'idle'`. */
  readonly jump?: JumpEdgeMode;
  /**
   * Dash edge. `'press'` yields a pressed `PolledEdge`; `'idle'` (default)
   * yields `null` (dash disabled for this tick). There is no dash hold — the
   * dash ability fires on `pressed` only.
   */
  readonly dash?: 'press' | 'idle';
  /**
   * Grab edge (Phase 6 — wall-grab). `'press'`/`'hold'`/`'release'` yield the
   * matching `PolledEdge`; omitted (default) leaves `grab` ABSENT from the
   * input (grab key unmapped — the wall-grab ability is a no-op regardless of
   * `wallGrabEnabled`). Keeping an absent grab the default means scenarios that
   * don't use grab record identical replay frames to before (no new key), so
   * their `traceHash` is unchanged across the Phase 6 bump.
   */
  readonly grab?: 'press' | 'hold' | 'release';
}

/**
 * Build a `PlatformerInput` from symbolic modes. The single canonical way to
 * construct inputs in the trace suite, so a scenario script reads as intent.
 *
 * @example
 * ```ts
 * makeInput({ jump: 'press' })                       // ground jump press
 * makeInput({ moveX: 1, jump: 'hold' })              // hold right + jump
 * makeInput({ moveX: 1, dash: 'press' })             // dash right
 * makeInput({ grab: 'hold' })                        // hold the grab key
 * ```
 */
export function makeInput(opts: MakeInputOptions = {}): PlatformerInput {
  let jump: PolledEdge;
  switch (opts.jump ?? 'idle') {
    case 'press':
      jump = pressEdge(true);
      break;
    case 'hold':
      jump = holdEdge();
      break;
    case 'release':
      jump = releaseEdge(false);
      break;
    default:
      jump = idleEdge();
      break;
  }
  let grab: PolledEdge | undefined;
  switch (opts.grab) {
    case 'press':
      grab = pressEdge(true);
      break;
    case 'hold':
      grab = holdEdge();
      break;
    case 'release':
      grab = releaseEdge(false);
      break;
    default:
      grab = undefined;
      break;
  }
  // `PlatformerInput` fields are `readonly`, so the optional `moveY`/`grab`
  // keys are folded in via a conditional spread at construction (not post-hoc
  // assign) — absent keys stay absent so recorded replay frames don't gain a
  // spurious `grab: undefined` key (which would shift the frame hash).
  const input: PlatformerInput = {
    moveX: opts.moveX ?? 0,
    jump,
    dash: opts.dash === 'press' ? pressEdge(true) : null,
    ...(opts.moveY !== undefined ? { moveY: opts.moveY } : {}),
    ...(grab !== undefined ? { grab } : {}),
  };
  return input;
}

// ---------------------------------------------------------------------------
// Trace row + runner.
// ---------------------------------------------------------------------------

/**
 * One per-tick observation. The compact "(vx, vy, x, y, mode)" tuple the
 * roadmap calls for, with `mode` approximated by `phase + dashTimer +
 * wallSliding + climbing`. Every numeric field is rounded to 6 decimals.
 *
 * `tick` is the 0-based index of the input that produced this row (NOT
 * `state.tick`, which starts at 1 after the first step) so scenarios can speak
 * of "tick 0" meaning the first input.
 */
export interface TraceRow {
  /** 0-based index of the input that produced this row. */
  readonly tick: number;
  /** World X of the body's top-left corner. */
  readonly x: number;
  /** World Y of the body's top-left corner (+Y is down). */
  readonly y: number;
  /** Horizontal velocity in px/s. */
  readonly vx: number;
  /** Vertical velocity in px/s (+Y is down; upward is negative). */
  readonly vy: number;
  /** `true` when supported against gravity this tick. */
  readonly onGround: boolean;
  /** Jump phase (`'grounded'|'anticipating'|'rising'|'falling'|'landing'`), or `'none'`. */
  readonly phase: string;
  /** Remaining dash timer in seconds (0 when not dashing). */
  readonly dashTimer: number;
  /** `true` while the wall-slide ability is sliding this tick. */
  readonly wallSliding: boolean;
  /** `true` while the climb ability is on a ladder this tick. */
  readonly climbing: boolean;
}

/** Round to 6 decimals — trims float noise (e.g. 0.30000000000000004 → 0.3). */
function round6(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Project a post-step `PlatformerState` into a compact {@link TraceRow}.
 *
 * Narrows each ability slice by its `kind` discriminator so the row is correct
 * regardless of which abilities are present. `tick` is supplied by the caller
 * (the 0-based input index).
 */
function rowFromState(state: PlatformerState, tick: number): TraceRow {
  const c = state.core;

  const jumpAny = state.abilities['jump'];
  const phase = jumpAny !== undefined && jumpAny.kind === 'jump' ? jumpAny.jump.phase : 'none';

  const dashAny = state.abilities['dash'];
  const dashTimer = dashAny !== undefined && dashAny.kind === 'dash' ? dashAny.timer : 0;

  const wsAny = state.abilities['wallSlide'];
  const wallSliding = wsAny !== undefined && wsAny.kind === 'wallSlide' ? wsAny.sliding : false;

  const climbAny = state.abilities['climb'];
  const climbing = climbAny !== undefined && climbAny.kind === 'climb' ? climbAny.climbing : false;

  return {
    tick,
    x: round6(c.x),
    y: round6(c.y),
    vx: round6(c.vx),
    vy: round6(c.vy),
    onGround: c.onGround,
    phase,
    dashTimer: round6(dashTimer),
    wallSliding,
    climbing,
  };
}

/** Options for {@link runTrace} / {@link runTraceDetailed}. */
export interface RunTraceOptions {
  /** Starting state (from `createPlatformerState`, possibly ability-overridden). */
  readonly initial: PlatformerState;
  /** Per-tick input script; one entry per tick. Trace length === inputs length. */
  readonly inputs: readonly PlatformerInput[];
  /** Collision surfaces, constant across the trace (solids do not move here). */
  readonly solids: readonly Solid[];
  /** Platformer tuning. Default `DEFAULT_PLATFORMER_CONFIG`. */
  readonly config?: Readonly<PlatformerConfig>;
  /** Fixed timestep in seconds. Default {@link DT} (1/60). */
  readonly dt?: number;
}

/**
 * Advance a per-tick input script through `stepPlatformer` and return the
 * per-tick trace. The canonical multi-tick integration entry point.
 *
 * Pure + deterministic: same opts → byte-identical trace. Never mutates
 * `initial` or `inputs`.
 */
export function runTrace(opts: RunTraceOptions): TraceRow[] {
  const dt = opts.dt ?? DT;
  const config = opts.config ?? DEFAULT_PLATFORMER_CONFIG;
  const rows: TraceRow[] = [];
  let state = opts.initial;
  for (let i = 0; i < opts.inputs.length; i++) {
    state = stepPlatformer(state, opts.inputs[i], opts.solids, dt, config).state;
    rows.push(rowFromState(state, i));
  }
  return rows;
}

/** Richer result from {@link runTraceDetailed}: trace + per-tick events + final state. */
export interface TraceDetail {
  /** Per-tick trace rows (same as {@link runTrace}). */
  readonly trace: TraceRow[];
  /** Per-tick kernel events (aligned with `trace` by index). */
  readonly events: PlatformerEvents[];
  /** The final state after the last tick (for follow-up assertions). */
  readonly finalState: PlatformerState;
}

/**
 * Variant of {@link runTrace} that also collects per-tick `PlatformerEvents`
 * and the final state. Use this in scenarios that assert on events (e.g. a
 * buffered jump firing exactly one `justLaunched`).
 */
export function runTraceDetailed(opts: RunTraceOptions): TraceDetail {
  const dt = opts.dt ?? DT;
  const config = opts.config ?? DEFAULT_PLATFORMER_CONFIG;
  const trace: TraceRow[] = [];
  const events: PlatformerEvents[] = [];
  let state = opts.initial;
  for (let i = 0; i < opts.inputs.length; i++) {
    state = stepPlatformer(state, opts.inputs[i], opts.solids, dt, config).state;
    trace.push(rowFromState(state, i));
    events.push(state.events);
  }
  return { trace, events, finalState: state };
}

// ---------------------------------------------------------------------------
// Hashing canaries.
// ---------------------------------------------------------------------------

/**
 * 32-bit FNV-1a hash of a trace's canonical JSON. A compact canary: if ANY row
 * field changes by more than 1e-6, this number changes. Pin it alongside an
 * inline snapshot for a cheap CI regression gate.
 */
export function traceHash(trace: readonly TraceRow[]): number {
  return fnv1a(canonicalize(trace));
}

/**
 * Build a `Replay` from a seed + initial state + input script and return its
 * 32-bit FNV-1a hash. The platformer `config` is folded into the replay's
 * `ReplayConfig` so a config change is reflected in the hash.
 *
 * Uses `createReplayRecorder` + `replayHash` exactly as the replay module's
 * public API intends. Deterministic: same args → same hash, forever.
 */
export function replayHashFor(
  seed: number,
  initial: PlatformerState,
  inputs: readonly PlatformerInput[],
  config?: Readonly<PlatformerConfig>,
): number {
  const recorder = createReplayRecorder(seed, initial);
  for (const input of inputs) {
    recorder.record(input);
  }
  const replay = recorder.finish(
    config !== undefined
      ? { tickRate: 60, physicsVersion: CURRENT_PHYSICS_VERSION, config }
      : { tickRate: 60, physicsVersion: CURRENT_PHYSICS_VERSION },
  );
  return replayHash(replay);
}
