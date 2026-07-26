/**
 * Default configuration constants for the procedural spider.
 *
 * Every tunable lives here — no magic numbers in the implementation.
 * Consumers spread {@link DEFAULT_SPIDER} and override individual fields.
 *
 * @module
 */

import type { SpiderConfig } from './types';
import type { SpiderPalette } from './spider-state';
import type { SpiderLegGeometryConfig } from './geometry';

/**
 * Default spider body palette. Dark purple theme.
 *
 * Every color is a config field — no magic colors in the renderer.
 * Consumers spread and override per-skin.
 */
export const DEFAULT_SPIDER_PALETTE: Readonly<SpiderPalette> = {
  cephFill: '#4a2d6b',
  abdFill: '#3d2458',
  legFg: '#5c3d8a',
  legBg: '#382455',
  eyeFill: '#ff2222',
  cheliceraeFill: '#2a1a3d',
  palpFill: '#5c3d8a',
  outline: '#1d1128',
};

/**
 * Default leg geometry configuration. Three-segment coxa/femur/tibia model.
 *
 * Consumers spread and override for their specific creature.
 */
export const DEFAULT_SPIDER_GEOMETRY: Readonly<SpiderLegGeometryConfig> = {
  hipRadius: 8,
  coxaLength: 8,
  // Short femur, long tibia (~1:2). The long distal segment reaches down-and-out
  // to the ground while the knee stays high, giving the real-spider up-and-out
  // arch instead of a stubby folded leg.
  femurLength: 22,
  tibiaLength: 44,
  minExtensionRatio: 0.50,
  maxExtensionRatio: 0.82,
  jointSafetyMargin: 0.5,
  minDistalAdvanceRatio: 0.1,
};

/**
 * Default spider configuration. Matches a Sokpop-scale side-view spider.
 *
 * Spread and override fields for your specific creature:
 *
 * ```ts
 * const mySpider: SpiderConfig = {
 *   ...DEFAULT_SPIDER,
 *   mode: 'frantic',
 *   palette: { ...DEFAULT_SPIDER_PALETTE, eyeFill: '#00ff00' },
 * };
 * ```
 */
export const DEFAULT_SPIDER: Readonly<SpiderConfig> = {
  // Gait
  mode: 'coordinated',
  legCount: 4,
  comfortRadius: 30,
  overshootFactor: 1.5,
  stepHeight: 30,
  stepDuration: 0.5,
  phaseAdvanceRate: 0.16,
  // Visual — body
  cephRadius: 10,
  abdRx: 16,
  abdRy: 12,
  abdOffsetX: -18,
  breathFrequency: 0.03,
  breathAmplitude: 0.05,
  jointRadius: 2.5,
  bodyJitterAmplitude: 1.5,
  // Neutral render offset: the body height is controlled entirely by the
  // caller's `bodyY` parameter, NOT by this field. Keeping it at 0 keeps the
  // gait and the renderer consistent — the body must clear the floor by ~28px
  // (caller-supplied) so each leg reaches the ground at mid-extension
  // (ratio 0.49–0.71) instead of dragging/compressing or deadlocking.
  bodyYOffset: 0,
  bodyOutlineWidth: 1.5,
  // Visual — legs (three-segment: coxa/femur/tibia widths)
  coxaWidth: 4,
  femurWidth: 3.5,
  tibiaWidth: 2,
  legOutlineWidth: 5,
  kneeKnobScale: 1,
  hipKnobScale: 0.8,
  kneeSpikeLength: 0,
  kneeSpikeWidth: 1.5,
  bgLegOffsetX: 2,
  bgLegOffsetY: 1,
  // Visual — eyes
  eyeDefinitions: [
    { dx: 8, dy: -5, r: 3 },
    { dx: 11, dy: -3, r: 4 },
    { dx: 12, dy: 2, r: 2 },
    { dx: 10, dy: 5, r: 2 },
    { dx: 6, dy: -8, r: 1.5 },
    { dx: 13, dy: -1, r: 1.5 },
    { dx: 9, dy: -6, r: 1.5 },
    { dx: 11, dy: 4, r: 1.5 },
  ],
  // Visual — chelicerae
  chelicerae: [
    { dx: 12, dy: 2, angle: 0.4 },
    { dx: 12, dy: 6, angle: 0.6 },
  ],
  cheliceraeLength: 8,
  cheliceraeWidth: 3,
  cheliceraeTipRadius: 1.5,
  // Visual — jitter
  jitterVertexCount: 24,
  // Visual — palps
  palpSegmentLength: 5,
  palpStiffness: 0.6,
  palpWidth: 2,
  palpTipWidth: 1,
  palpTwitchFreq: 0.8,
  palpTwitchAmp: 0.5,
  // Visual — per-leg rest positions.
  // Narrowed extension range [0.50, 0.82] keeps every leg at a moderate arch.
  // Rest positions widened so grounded coxa-to-foot distances fall at ~0.55
  // (inner) and ~0.70 (outer) at the 30px body clearance.
  legRestPositions: [
    { angle: 29, distance: 62 },
    { angle: 37, distance: 50 },
    { angle: 143, distance: 50 },
    { angle: 151, distance: 62 },
  ],
  // Shared (gait + visual)
  groundSampleSteps: 3,
  motionScale: 1,
  palette: DEFAULT_SPIDER_PALETTE,
  // Shared geometry (three-segment leg model)
  geometry: DEFAULT_SPIDER_GEOMETRY,
};
