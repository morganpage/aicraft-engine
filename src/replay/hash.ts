/**
 * Deterministic 32-bit fingerprint of a {@link Replay} for share-codes and
 * clear-check verification.
 *
 * Replays the canonical-JSON pipeline already shipped in
 * `src/level/serialize.ts`:
 *
 *   1. `canonicalize(replay)` — RFC 8785-ish (sorted keys, no insignificant
 *      whitespace, non-finite → `null`).
 *   2. `fnv1a(canonicalString)` — 32-bit FNV-1a hash (unsigned int).
 *
 * The result is deterministic across JS engines: same replay bytes in →
 * same hash out, forever. Suitable for:
 *
 *   - **Share-codes**: a 32-bit hash (`0`–`2^32`-`1`, displayed as 8-char hex).
 *   - **CI verification**: pin a known-good hash; fail the CI if the engine
 *     changes the replay's end state.
 *   - **Bug reproduction**: share a hash; the recipient re-runs the replay and
 *     compares the final state against the bug-report intent.
 *
 * Different replays (different inputs OR different initial state OR different
 * seed) produce different hashes with overwhelming probability (FNV-1a is
 * non-cryptographic — not collision-resistant against adversaries, but
 * collision-resistant enough for all consumer-facing purposes).
 *
 * @module
 */

import { canonicalize, fnv1a } from '../level/serialize';
import type { Replay } from './types';

/**
 * Compute the 32-bit FNV-1a hash of a {@link Replay}'s canonical JSON.
 *
 * The input `Replay` should be frozen (via `finish()`) — `canonicalize`
 * recursively visits keys and values, so a frozen input mirrors the
 * recorded shape exactly with no risk of missing fields.
 *
 * Defensive: malformed input (null, non-object, missing fields) returns
 * `0` (a stable, recognizable hash for the empty-input edge case).
 * Never throws.
 *
 * @param replay - The {@link Replay} to fingerprint.
 * @returns Unsigned 32-bit FNV-1a hash in `[0, 2^32)`.
 */
export function replayHash(replay: Replay | null | undefined): number {
  if (replay === null || typeof replay !== 'object') return 0;
  try {
    return fnv1a(canonicalize(replay));
  } catch {
    return 0;
  }
}
