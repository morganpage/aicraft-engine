import type { SpiderConfig, SpiderState } from '../../src/animation/spider';
import {
  computeHipPosition,
  computeCoxaEndpoint,
  projectGroundedTargetIntoWorkspace,
} from '../../src/animation/spider';

/**
 * Cosmetic detail reference scale.
 *
 * `DEFAULT_SPIDER` is the coherent `1.0x` PHYSICAL reference: every world-space
 * gait and IK distance (segment lengths, rest distances, comfort radius, step
 * height, body radii/offsets) is authored for scale `1.0` and scales uniformly
 * by `sizeScale`. Only COSMETIC detail — stroke widths, joint knob radii, eye
 * radii, jitter amplitude — keeps a separate detail scale anchored to the
 * historical `1.2x` showcase stroke weight, so the large spider's line weight
 * stays consistent with its originally approved silhouette. Detail scaling
 * never affects gait targets or IK geometry.
 */
export const SHOWCASE_SPIDER_REFERENCE_SCALE = 1.2;
const MAX_OVERSHOOT_REACH_FRACTION = 0.50;
const MAX_SWING_TRAVEL_REACH_FRACTION = 0.16;
const MIN_VISIBLE_STEP_DURATION = 0.1;

/**
 * Scale a showcase spider by a uniform physical transform.
 *
 * Every world-space gait and IK field (segment lengths, joint safety margin,
 * rest distances, comfort radius, step height, body radii/offsets) scales by
 * `sizeScale`, so `DEFAULT_SPIDER` at `1.0x` is identity and a `1.2x` spider is
 * a uniform `1.2x` physical transform. Cosmetic detail (stroke widths, joint
 * radii, eye/fang dimensions, jitter) scales by a separate detail factor
 * anchored to {@link SHOWCASE_SPIDER_REFERENCE_SCALE} so the approved line
 * weight is preserved; detail scaling never affects gait or IK geometry.
 *
 * Gait cadence (`phaseAdvanceRate`) is normalized by reach so stride frequency
 * stays scale-invariant; it is NOT a world-space distance and is exempt from
 * uniform physical scaling (verified by the cadence test).
 */
export function scaleShowcaseSpiderConfig(
  base: SpiderConfig,
  sizeScale: number,
): SpiderConfig {
  const scale = Number.isFinite(sizeScale) && sizeScale > 0 ? sizeScale : 1;
  const detailScale = scale / SHOWCASE_SPIDER_REFERENCE_SCALE;

  return {
    ...base,
    // Physical gait thresholds (world-space px) — uniform sizeScale.
    comfortRadius: base.comfortRadius * scale,
    overshootFactor: base.overshootFactor * scale,
    stepHeight: base.stepHeight * scale,
    // Cadence normalization — exempt from physical scaling (reach-normalized).
    phaseAdvanceRate: base.phaseAdvanceRate / detailScale,
    // Physical body dimensions — uniform sizeScale.
    cephRadius: base.cephRadius * scale,
    abdRx: base.abdRx * scale,
    abdRy: base.abdRy * scale,
    abdOffsetX: base.abdOffsetX * scale,
    bodyYOffset: base.bodyYOffset * scale,
    // Physical leg geometry — uniform sizeScale.
    geometry: {
      ...base.geometry,
      hipRadius: base.geometry.hipRadius * scale,
      coxaLength: base.geometry.coxaLength * scale,
      femurLength: base.geometry.femurLength * scale,
      tibiaLength: base.geometry.tibiaLength * scale,
      jointSafetyMargin: base.geometry.jointSafetyMargin * scale,
    },
    // Physical rest distances — uniform sizeScale (kept coherent with geometry).
    legRestPositions: base.legRestPositions.map((leg) => ({
      angle: leg.angle,
      distance: leg.distance * scale,
    })),
    palpTwitchAmp: base.palpTwitchAmp * scale,
    // Cosmetic detail only — separate detail scale, never affects gait/IK.
    jointRadius: base.jointRadius * detailScale,
    bodyJitterAmplitude: base.bodyJitterAmplitude * detailScale,
    bodyOutlineWidth: base.bodyOutlineWidth * detailScale,
    coxaWidth: base.coxaWidth * detailScale,
    femurWidth: base.femurWidth * detailScale,
    tibiaWidth: base.tibiaWidth * detailScale,
    legOutlineWidth: base.legOutlineWidth * detailScale,
    kneeSpikeLength: base.kneeSpikeLength * detailScale,
    kneeSpikeWidth: base.kneeSpikeWidth * detailScale,
    bgLegOffsetX: base.bgLegOffsetX * detailScale,
    bgLegOffsetY: base.bgLegOffsetY * detailScale,
    eyeDefinitions: base.eyeDefinitions.map((eye) => ({
      dx: eye.dx * detailScale,
      dy: eye.dy * detailScale,
      r: eye.r * detailScale,
    })),
    chelicerae: base.chelicerae.map((fang) => ({
      dx: fang.dx * detailScale,
      dy: fang.dy * detailScale,
      angle: fang.angle,
    })),
    cheliceraeLength: base.cheliceraeLength * detailScale,
    cheliceraeWidth: base.cheliceraeWidth * detailScale,
    cheliceraeTipRadius: base.cheliceraeTipRadius * detailScale,
    palpSegmentLength: base.palpSegmentLength * detailScale,
    palpWidth: base.palpWidth * detailScale,
    palpTipWidth: base.palpTipWidth * detailScale,
  };
}

/** Bound active gait travel to the configured limb reach at a given speed. */
export function tuneShowcaseSpiderSpeed(
  config: SpiderConfig,
  movementSpeed: number,
): SpiderConfig {
  const speed = Number.isFinite(movementSpeed) ? Math.abs(movementSpeed) : 0;
  if (speed === 0) return { ...config };

  const reach =
    config.geometry.hipRadius +
    config.geometry.coxaLength +
    config.geometry.femurLength +
    config.geometry.tibiaLength;
  return {
    ...config,
    overshootFactor: Math.min(
      config.overshootFactor,
      reach * MAX_OVERSHOOT_REACH_FRACTION / speed,
    ),
    stepDuration: Math.min(
      config.stepDuration,
      Math.max(
        MIN_VISIBLE_STEP_DURATION,
        reach * MAX_SWING_TRAVEL_REACH_FRACTION / speed,
      ),
    ),
  };
}

export interface ShowcaseSpiderLane {
  readonly min: number;
  readonly max: number;
  readonly center: number;
  readonly extent: number;
}

/**
 * Horizontal half-span a spider occupies, used to isolate patrol lanes.
 *
 * Uses the legs' HORIZONTAL foot reach — `max(|cos(angle)·distance|)` over the
 * rest positions — not the full diagonal leg length. Legs arch up and back down
 * to the ground, so they never extend their whole `hip+coxa+femur+tibia` length
 * sideways; counting that diagonal (which grew large once the tibia lengthened)
 * over-reserves lane space and can collapse a spider's patrol travel to zero.
 *
 * Lanes keep the opaque bodies from overlapping; thin, translucent legs may
 * interleave into neighbouring zones, which reads naturally.
 */
export function spiderSilhouetteExtent(config: SpiderConfig): number {
  const footHalfSpan = config.legRestPositions.reduce((max, leg) => {
    const dx = Math.abs(Math.cos((leg.angle * Math.PI) / 180) * leg.distance);
    return dx > max ? dx : max;
  }, 0);
  return Math.max(
    footHalfSpan + config.cephRadius * 0.8,
    Math.abs(config.abdOffsetX) + config.abdRx,
  );
}

/** Divide a canvas into non-overlapping patrol lanes with reach-aware margins. */
export function createShowcaseSpiderLanes(
  configs: readonly SpiderConfig[],
  canvasWidth: number,
  gap: number = 24,
): readonly ShowcaseSpiderLane[] {
  if (configs.length === 0) return [];
  const width = Number.isFinite(canvasWidth) && canvasWidth > 0 ? canvasWidth : 1;
  const safeGap = Number.isFinite(gap) && gap > 0 ? gap : 0;
  const zoneWidth = width / configs.length;

  return configs.map((config, index) => {
    const center = zoneWidth * (index + 0.5);
    const extent = spiderSilhouetteExtent(config);
    const travel = Math.max(0, zoneWidth / 2 - extent - safeGap / 2);
    return { min: center - travel, max: center + travel, center, extent };
  });
}

/**
 * Ground every planted foot into a sector-valid, floor-touching pose.
 *
 * For each leg this computes the hip and coxa at the supplied body pose,
 * sets the desired foot to its authored rest X on the floor, and projects
 * that target through {@link projectGroundedTargetIntoWorkspace} so the
 * grounded foot is BOTH radially feasible and anatomically valid (outward
 * tibia, no folded-Z). The projected point is assigned consistently to
 * `foot`, `start`, `end`, and `mid` so the first frame needs no renderer
 * correction and no immediate recovery step.
 *
 * Pure, never throws: returns a fresh state, input is not mutated, and
 * degenerate inputs fall back to safe defaults inside the geometry helpers.
 *
 * @param state - current spider state (fresh copy returned; input not mutated)
 * @param bodyX - body center X used to compute each leg's hip/coxa
 * @param bodyY - body center Y used to compute each leg's hip/coxa
 * @param facing - body facing (+1 right, -1 left) for hip/coxa/rest mirroring
 * @param floorY - world Y of the floor surface every foot must touch
 * @param config - spider config (provides geometry + rest-local offsets via state)
 * @returns fresh {@link SpiderState} with all feet grounded and sector-valid
 */
export function groundShowcaseSpiderState(
  state: SpiderState,
  bodyX: number,
  bodyY: number,
  facing: 1 | -1,
  floorY: number,
  config: SpiderConfig,
): SpiderState {
  const safeFacing: 1 | -1 = facing === -1 ? -1 : 1;
  const bx = Number.isFinite(bodyX) ? bodyX : 0;
  const by = Number.isFinite(bodyY) ? bodyY : 0;
  const fy = Number.isFinite(floorY) ? floorY : by;
  const geometry = config.geometry;

  return {
    ...state,
    gait: {
      ...state.gait,
      legs: state.gait.legs.map((leg) => {
        const restLocal = { x: leg.restLocalX, y: leg.restLocalY };
        const hip = computeHipPosition(bx, by, safeFacing, restLocal, geometry);
        const coxa = computeCoxaEndpoint(hip, safeFacing, restLocal, geometry);
        // Desired foot: authored rest X (mirrored by facing) snapped to the floor.
        const desiredX = bx + leg.restLocalX * safeFacing;
        const desired = { x: desiredX, y: fy };
        const projected = projectGroundedTargetIntoWorkspace(
          coxa,
          desired,
          geometry,
          safeFacing,
          leg.restLocalX,
        );
        return {
          ...leg,
          footX: projected.x,
          footY: projected.y,
          startX: projected.x,
          startY: projected.y,
          endX: projected.x,
          endY: projected.y,
          midX: projected.x,
          midY: projected.y,
        };
      }),
    },
  };
}
