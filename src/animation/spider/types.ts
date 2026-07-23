/**
 * Shared types for the procedural spider module.
 *
 * These types define the configuration surface for the spider's deterministic
 * gait core and its renderer-adjacent visual layer. Consumers spread
 * {@link DEFAULT_SPIDER} and override individual fields.
 *
 * @module
 */

import type { SpiderGaitConfig, SpiderGaitMode } from './gait';
import type { SpiderVisualConfig, SpiderPalette, EyeDefinition, CheliceraDefinition } from './spider-state';
import type { SpiderLegGeometryConfig } from './geometry';

export type { SpiderGaitMode };
export type { SpiderGaitConfig };
export type { SpiderVisualConfig };
export type { SpiderPalette };
export type { EyeDefinition };
export type { CheliceraDefinition };
export type { SpiderLegGeometryConfig };

export { DEFAULT_SPIDER, DEFAULT_SPIDER_PALETTE } from './constants';

/**
 * Combined spider configuration. Consumers spread {@link DEFAULT_SPIDER} and
 * override fields as needed.
 *
 * Internally split via {@link splitSpiderConfig} into:
 * - {@link SpiderGaitConfig} — deterministic core (gait solver).
 * - {@link SpiderVisualConfig} — renderer-adjacent (body drawing, IK, springs).
 *
 * The `geometry` field is shared between both sub-configs and defines the
 * three-segment leg geometry (coxa/femur/tibia lengths and workspace bounds).
 *
 * Every tunable value is a field — no magic numbers in the implementation.
 */
export interface SpiderConfig extends SpiderGaitConfig, SpiderVisualConfig {
  /** Shared leg geometry config (three-segment coxa/femur/tibia). */
  readonly geometry: SpiderLegGeometryConfig;
}

/**
 * Split a combined {@link SpiderConfig} into its deterministic-core
 * ({@link SpiderGaitConfig}) and renderer-adjacent ({@link SpiderVisualConfig})
 * halves.
 *
 * Pure, never throws. Used internally by {@link createSpiderState} and
 * {@link stepSpider}.
 *
 * @param config - combined spider configuration
 * @returns `{ gait, visual }` partition
 */
export function splitSpiderConfig(config: SpiderConfig): {
  readonly gait: SpiderGaitConfig;
  readonly visual: SpiderVisualConfig;
} {
  const {
    // Gait fields
    mode, legCount, comfortRadius, overshootFactor,
    stepHeight, stepDuration, phaseAdvanceRate,
    // Visual — body
    cephRadius, abdRx, abdRy, abdOffsetX,
    breathFrequency, breathAmplitude,
    jointRadius, bodyJitterAmplitude,
    bodyYOffset, bodyOutlineWidth,
    // Visual — legs
    coxaWidth, femurWidth, tibiaWidth, legOutlineWidth,
    kneeKnobScale, hipKnobScale,
    kneeSpikeLength, kneeSpikeWidth,
    bgLegOffsetX, bgLegOffsetY,
    // Visual — eyes/chelicerae
    eyeDefinitions, chelicerae,
    cheliceraeLength, cheliceraeWidth, cheliceraeTipRadius,
    // Visual — jitter
    jitterVertexCount,
    // Visual — palps
    palpSegmentLength, palpStiffness,
    palpWidth, palpTipWidth,
    palpTwitchFreq, palpTwitchAmp,
    // Shared
    palette, geometry,
    groundSampleSteps, motionScale,
    legRestPositions,
  } = config as SpiderConfig & Record<string, unknown>;

  return {
    gait: {
      mode: mode as SpiderGaitMode,
      legCount: legCount as number,
      comfortRadius: comfortRadius as number,
      overshootFactor: overshootFactor as number,
      stepHeight: stepHeight as number,
      stepDuration: stepDuration as number,
      phaseAdvanceRate: phaseAdvanceRate as number,
      legRestPositions: legRestPositions as SpiderVisualConfig['legRestPositions'],
      groundSampleSteps: groundSampleSteps as number,
      motionScale: motionScale as number,
      geometry: geometry as SpiderLegGeometryConfig,
    },
    visual: {
      cephRadius: cephRadius as number,
      abdRx: abdRx as number,
      abdRy: abdRy as number,
      abdOffsetX: abdOffsetX as number,
      breathFrequency: breathFrequency as number,
      breathAmplitude: breathAmplitude as number,
      jointRadius: jointRadius as number,
      bodyJitterAmplitude: bodyJitterAmplitude as number,
      bodyYOffset: bodyYOffset as number,
      bodyOutlineWidth: bodyOutlineWidth as number,
      coxaWidth: coxaWidth as number,
      femurWidth: femurWidth as number,
      tibiaWidth: tibiaWidth as number,
      legOutlineWidth: legOutlineWidth as number,
      kneeKnobScale: kneeKnobScale as number,
      hipKnobScale: hipKnobScale as number,
      kneeSpikeLength: kneeSpikeLength as number,
      kneeSpikeWidth: kneeSpikeWidth as number,
      bgLegOffsetX: bgLegOffsetX as number,
      bgLegOffsetY: bgLegOffsetY as number,
      eyeDefinitions: eyeDefinitions as SpiderVisualConfig['eyeDefinitions'],
      chelicerae: chelicerae as SpiderVisualConfig['chelicerae'],
      cheliceraeLength: cheliceraeLength as number,
      cheliceraeWidth: cheliceraeWidth as number,
      cheliceraeTipRadius: cheliceraeTipRadius as number,
      jitterVertexCount: jitterVertexCount as number,
      palpSegmentLength: palpSegmentLength as number,
      palpStiffness: palpStiffness as number,
      palpWidth: palpWidth as number,
      palpTipWidth: palpTipWidth as number,
      palpTwitchFreq: palpTwitchFreq as number,
      palpTwitchAmp: palpTwitchAmp as number,
      palette: palette as SpiderPalette,
      legRestPositions: legRestPositions as SpiderVisualConfig['legRestPositions'],
      groundSampleSteps: groundSampleSteps as number,
      motionScale: motionScale as number,
      geometry: geometry as SpiderLegGeometryConfig,
    },
  };
}
