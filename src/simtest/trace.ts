/**
 * Trace hashing for the generic deterministic simulation-test module.
 *
 * `simulationTraceHash` computes a deterministic 32-bit FNV-1a fingerprint
 * of a `SimulationTrace` using the existing `canonicalize` + `fnv1a` pipeline
 * from `src/level/serialize.ts`.
 *
 * The hash is:
 *   - **Deterministic:** same trace → same hash across JS engines.
 *   - **Sensitive to adapter identity:** id, version, and fingerprint are
 *     part of the canonical JSON, so a trace from a different adapter or
 *     world configuration produces a different hash.
 *   - **Non-cryptographic:** FNV-1a is not collision-resistant against
 *     adversaries, but collision-resistant enough for all verification
 *     purposes.
 *
 * @module
 */

import { canonicalize, fnv1a } from '../level/serialize';
import type { SimulationTrace } from './types';

/**
 * Compute the 32-bit FNV-1a hash of a {@link SimulationTrace}'s canonical
 * JSON representation.
 *
 * The hash binds together the adapter identity, scenario fingerprint, seed,
 * timestep, and action stream. It is suitable for:
 *
 *   - **CI verification:** pin a known-good hash to detect regressions.
 *   - **Trace deduplication:** compare traces by hash instead of deep-equality.
 *   - **Bug reproduction:** share a hash to replay the exact action sequence.
 *
 * **Defensive handling:**
 *   - `null` / `undefined` / non-object input → returns `0`.
 *   - Circular references in the trace → returns a hash of the
 *     cycle-handled canonical form (canonicalize replaces cycles with null).
 *   - Never throws.
 *
 * @example
 * ```ts
 * const trace: SimulationTrace<MyAction> = { ... };
 * const hash = simulationTraceHash(trace);
 * // hash is a 32-bit unsigned int in [0, 2^32)
 * ```
 *
 * @typeParam TAction - Action type (must be canonical-JSON serializable).
 * @param trace - The trace to fingerprint.
 * @returns Unsigned 32-bit FNV-1a hash in `[0, 2^32)`.
 */
export function simulationTraceHash<TAction>(
  trace: SimulationTrace<TAction>,
): number {
  if (trace === null || typeof trace !== 'object') return 0;
  try {
    return fnv1a(canonicalize(trace));
  } catch {
    return 0;
  }
}
