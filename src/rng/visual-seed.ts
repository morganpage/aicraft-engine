/**
 * Stateless deterministic addresses for procedural visual decisions.
 *
 * These helpers produce stable unsigned 32-bit fingerprints, not
 * cryptographic hashes. The authoring-facing string API is intended for setup;
 * render hot paths should resolve strings once with {@link visualChannel} and
 * fold numeric components with {@link mixChannel} / {@link mixNumber}.
 *
 * @module
 */

/** A component accepted by {@link deriveVisualSeed}. */
export type VisualSeedPart = string | number;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const NUMBER_TAG = 0x4e554d42; // "NUMB"
const CHANNEL_TAG = 0x43484e4c; // "CHNL"

function int32(value: number): number {
  return Number.isFinite(value) ? value | 0 : 0;
}

function avalanche(value: number): number {
  let h = value >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function foldTagged(accumulator: number, tag: number, value: number): number {
  let h = int32(accumulator) >>> 0;
  h = Math.imul(h ^ tag, 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (int32(value) >>> 0), 0x85ebca77) >>> 0;
  return avalanche(h);
}

/**
 * Hash a channel name into a stable unsigned 32-bit identifier.
 *
 * The implementation hashes UTF-16 code units directly and does not use
 * locale-sensitive formatting.
 */
export function visualChannel(name: string): number {
  const text = typeof name === 'string' ? name : '';
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    hash = Math.imul(hash ^ (code & 0xff), FNV_PRIME) >>> 0;
    hash = Math.imul(hash ^ (code >>> 8), FNV_PRIME) >>> 0;
  }
  return avalanche(hash);
}

/**
 * Fold one numeric component into an address.
 *
 * Values are normalized to signed int32; non-finite values become zero.
 * Numeric components carry a distinct tag from string-derived channels.
 */
export function mixNumber(accumulator: number, value: number): number {
  return foldTagged(accumulator, NUMBER_TAG, value);
}

/**
 * Fold a channel id returned by {@link visualChannel} into an address.
 *
 * The channel tag prevents a string part from colliding with a numeric part
 * whose value happens to equal the channel id.
 */
export function mixChannel(accumulator: number, channelId: number): number {
  return foldTagged(accumulator, CHANNEL_TAG, channelId);
}

/** Finalize an accumulator as an unsigned 32-bit seed. */
export function finalizeSeed(accumulator: number): number {
  return avalanche(int32(accumulator));
}

/**
 * Derive a readable stateless visual address.
 *
 * This is implemented directly in terms of the hot-path fold helpers so both
 * API tiers agree at every arity.
 */
export function deriveVisualSeed(
  rootSeed: number,
  ...parts: readonly VisualSeedPart[]
): number {
  let accumulator = int32(rootSeed);
  for (const part of parts) {
    accumulator = typeof part === 'string'
      ? mixChannel(accumulator, visualChannel(part))
      : mixNumber(accumulator, part);
  }
  return finalizeSeed(accumulator);
}
