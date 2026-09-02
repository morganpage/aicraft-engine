/**
 * Serializable RNG state for deterministic simulation streams.
 *
 * The closure API (`mulberry32`) hides its cursor inside a function, which
 * cannot be saved, restored, or branched. Gameplay systems that must survive
 * save/reload and mid-battle replay (encounters, battle rolls) use this
 * pure-state API instead: the entire stream is one unsigned 32-bit word, so a
 * stream is a plain JSON value.
 *
 * The stream is byte-identical to `mulberry32` — both wrap the same internal
 * step, and known-answer tests pin the shared output vectors.
 */

/**
 * The complete state of one Mulberry32 stream: a single unsigned 32-bit word.
 * JSON-serializable by construction.
 */
export interface SerializableRngState {
  readonly value: number;
}

/** One draw from a stream: the next state plus the float it produced. */
export interface RngDraw {
  readonly state: SerializableRngState;
  readonly value: number;
}

/**
 * Normalize any input to the unsigned 32-bit state word of a fresh stream.
 * Negative and non-finite seeds coerce via `ToUint32` (so `-1` and
 * `0xffffffff` name the same stream, `NaN` names the same stream as `0`).
 */
export function createRngState(seed: number): SerializableRngState {
  return { value: seed >>> 0 };
}

/**
 * The single Mulberry32 step, shared by the closure and pure-state APIs so
 * their output vectors can never diverge. Not part of the public surface.
 */
export function stepMulberry32(word: number): {
  readonly word: number;
  readonly float: number;
} {
  const a = ((word | 0) + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { word: a >>> 0, float: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

/**
 * Advance a stream by one draw, returning the next state and a float in
 * `[0, 1)`. Pure: the input state is never mutated, so the same state can be
 * advanced repeatedly to branch a stream.
 */
export function advanceRng(state: SerializableRngState): RngDraw {
  const step = stepMulberry32(state.value >>> 0);
  return { state: { value: step.word }, value: step.float };
}

function coerceBound(value: number): number {
  return Number.isFinite(value) ? Math.floor(value) : 0;
}

/**
 * Draw an inclusive integer in `[min, max]`, consuming exactly one underlying
 * draw (the returned state equals `advanceRng(state).state`).
 *
 * Never throws: non-finite bounds coerce to zero; an inverted range
 * (`min > max`) is empty and returns the coerced `min`, still consuming the
 * draw so accidental misuse cannot desynchronize a stream's cursor.
 */
export function nextRngInt(
  state: SerializableRngState,
  min: number,
  max: number,
): RngDraw {
  const draw = advanceRng(state);
  const lo = coerceBound(min);
  const hi = coerceBound(max);
  if (lo > hi) return { state: draw.state, value: lo };
  return { state: draw.state, value: Math.floor(draw.value * (hi - lo + 1)) + lo };
}
