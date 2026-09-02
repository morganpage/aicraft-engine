/**
 * Stateless deterministic addressing for simulation streams.
 *
 * `deriveVisualSeed` (in `visual-seed.ts`) addresses decorative randomness.
 * This module addresses gameplay streams — battle seeds, encounter creature
 * seeds, generation seeds — whose values are authoritative simulation input.
 * The two APIs fold differently by construction, so a visual address can
 * never alias a simulation address derived from the same root and parts.
 */

/** A component accepted by {@link deriveSeed}. */
export type RngSeedPart = string | number;

import {
  mixNumber,
  mixChannel,
  visualChannel,
  finalizeSeed,
} from './visual-seed';

// "SIMU" — folded before the caller's parts so simulation addresses occupy a
// different hash region than the visually identical call into visual-seed.
const SIMULATION_DOMAIN_TAG = 0x53494d55;

/**
 * Derive a stable unsigned 32-bit seed for one named stream address.
 *
 * Order-sensitive (`'a', 'b'` ≠ `'b', 'a'`) and type-sensitive
 * (`12345` ≠ `'12345'`). Use one derivation site per logical stream —
 * for example `deriveSeed(rootSeed, 'encounter', encounterIndex)` — so
 * adding a visual roll or a sibling stream can never shift another stream's
 * values.
 */
export function deriveSeed(
  rootSeed: number,
  ...parts: readonly RngSeedPart[]
): number {
  let accumulator = mixNumber(rootSeed, SIMULATION_DOMAIN_TAG);
  for (const part of parts) {
    accumulator = typeof part === 'string'
      ? mixChannel(accumulator, visualChannel(part))
      : mixNumber(accumulator, part);
  }
  return finalizeSeed(accumulator);
}
