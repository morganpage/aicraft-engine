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
  comfortRadius: 10,
  overshootFactor: 0.3,
  stepHeight: 14,
  stepDuration: 0.18,
  phaseAdvanceRate: 0.08,
  // Visual — body
  cephRadius: 10,
  abdRx: 16,
  abdRy: 12,
  abdOffsetX: -18,
  breathFrequency: 0.03,
  breathAmplitude: 0.05,
  jointRadius: 2.5,
  bodyJitterAmplitude: 1.5,
  bodyYOffset: 0,
  bodyOutlineWidth: 1.5,
  // Visual — legs
  thighLength: 18,
  shinLength: 30,
  thighWidth: 3.5,
  shinWidth: 2,
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
  // Visual — per-leg rest positions
  legRestPositions: [
    { angle: 30, distance: 38 },
    { angle: 60, distance: 35 },
    { angle: 120, distance: 35 },
    { angle: 150, distance: 38 },
  ],
  // Shared (gait + visual)
  groundSampleSteps: 3,
  motionScale: 1,
  palette: DEFAULT_SPIDER_PALETTE,
};
