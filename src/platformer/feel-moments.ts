/**
 * Phase D2 — pure helpers for the structured feel-moment channel
 * ({@link FeelMoment} / {@link PlatformerState.moments}).
 *
 * Everything here is presentation-only and deterministic: it derives feel data
 * the kernel already computes but, before D2, discarded. None of it feeds
 * velocity or position, so calling these helpers cannot perturb the simulation
 * (mirrors the camera brain's presentation-only contract).
 *
 * The headline invariant — "hard-landing feel is identical at 8/16/32 px tiles"
 * — falls out of expressing the threshold as a *ratio* against the gravity-max
 * fall speed (`normalizedImpact`), never a raw px/s literal.
 */

import type { FeelMoment, PlatformerConfig } from './types';

/**
 * Default hard-landing threshold (ratio in `[0, 1]`). Pegged to Celeste's
 * feel band: a landing at ~72% of max fall speed reads as a hard impact (screen
 * shake / heavy squat). Compared against {@link normalizedImpactFor}, which is
 * scale-invariant, so this single default fires identically at every tile size
 * — the fix for the unscaled `prevVy > 520` magic number that never fired at
 * 8 px (ISSUES §4.2).
 */
export const DEFAULT_HARD_LANDING_THRESHOLD = 0.72;

/**
 * Resolved hard-landing threshold for a config: the optional
 * {@link PlatformerConfig.hardLandingThreshold} clamped to `[0, 1]`, defaulting
 * to {@link DEFAULT_HARD_LANDING_THRESHOLD} when absent/non-finite.
 *
 * Clamping is defensive: an out-of-range override can never disable the ratio
 * contract (a `> 1` value would make `hard` unreachable; a `< 0` value would
 * make every landing hard). Both are folded to the valid range.
 */
export function hardLandingThresholdFor(
  config: Readonly<PlatformerConfig>,
): number {
  const raw = config.hardLandingThreshold;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_HARD_LANDING_THRESHOLD;
  }
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

/**
 * Scale- and gravity-sign-invariant landing intensity: the absolute pre-zero
 * landing speed as a fraction of the gravity-facing max fall speed.
 *
 * `normalizedImpact = clamp(impactSpeed / max(|config.maxFallSpeed|, ε), 0, 1)`.
 * Using the magnitude of `maxFallSpeed` (it is documented as a magnitude) keeps
 * the ratio correct under BOTH gravity signs: positive gravity falls toward a
 * floor, negative gravity falls toward a ceiling, but the speed magnitude and
 * the cap magnitude are both positive. The `ε` guards a zero/absent cap.
 *
 * Because both `impactSpeed` and the cap scale together with tile size, the
 * ratio is identical at 8/16/32 px — the feel-invariance guarantee.
 */
export function normalizedImpactFor(
  impactSpeed: number,
  config: Readonly<PlatformerConfig>,
): number {
  const cap = Math.abs(config.maxFallSpeed);
  const safeCap = cap > 1e-6 ? cap : 1e-6;
  const ratio = Math.abs(impactSpeed) / safeCap;
  if (!Number.isFinite(ratio) || ratio < 0) return 0;
  if (ratio > 1) return 1;
  return ratio;
}

/**
 * Build a `landing` feel moment for an unsupported→supported transition.
 *
 * `impactSpeed` is the absolute pre-zero `vy` (capture it before the Y resolver
 * zeroes it). `supportId` is the gravity-facing support id — the caller passes
 * `ceilingId` under negative gravity and `groundId` under positive gravity (the
 * kernel already derives `invertedGravity = config.gravity < 0`). The moment's
 * `hard` flag is `normalizedImpact ≥ hardLandingThresholdFor(config)`.
 */
export function landingMomentFor(
  impactSpeed: number,
  supportId: string | null,
  config: Readonly<PlatformerConfig>,
): Extract<FeelMoment, { kind: 'landing' }> {
  const normalizedImpact = normalizedImpactFor(impactSpeed, config);
  return {
    kind: 'landing',
    impactSpeed: Math.abs(impactSpeed),
    normalizedImpact,
    hard: normalizedImpact >= hardLandingThresholdFor(config),
    solidId: supportId,
  };
}
