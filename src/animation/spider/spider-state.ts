/**
 * Deterministic spider state facade.
 *
 * Bundles gait advancement + pedipalp spring-rod advancement into a single
 * ergonomic call. Both underlying primitives ({@link advanceGait},
 * {@link advanceSpringRod}) remain independently composable and testable;
 * this facade exists for ergonomics at the call site.
 *
 * **Determinism contract.** Same `(state, bodyX, bodyY, vx, vy, facing, dt,
 * config, tileQuery, tileSize, tick)` → byte-identical output. No
 * `Math.random`, no `Date.now()`, no global state, no DOM reads.
 *
 * **Purity.** Every public function returns a NEW object; inputs are never
 * mutated. Never throws.
 *
 * @module
 */

import type { VerletNode } from '../spring';
import {
  createSpringRod,
  advanceSpringRod,
  DEFAULT_SPRING_ROD,
  type SpringRodConfig,
} from '../spring-rod';
import type { TileSolidityQuery } from '../../collision/types';
import type { Vec2 } from '../types';
import type { GaitState, LegRestPosition } from './gait';
import { createGaitState, advanceGait } from './gait';
import type { SpiderConfig } from './types';
import { splitSpiderConfig } from './types';
import type { SpiderLegGeometryConfig } from './geometry';
import {
  computeCoxaEndpoint,
  computeHipPosition,
  projectGroundedTargetIntoWorkspace,
} from './geometry';

/**
 * Spider body palette. All hex strings — no magic colors in the renderer.
 */
export interface SpiderPalette {
  /** Cephalothorax fill. */
  readonly cephFill: string;
  /** Abdomen fill. */
  readonly abdFill: string;
  /** Foreground leg color. */
  readonly legFg: string;
  /** Background leg color (darker shade). */
  readonly legBg: string;
  /** Eye fill (high-contrast). */
  readonly eyeFill: string;
  /** Chelicerae (fang) fill. */
  readonly cheliceraeFill: string;
  /** Pedipalp fill. */
  readonly palpFill: string;
  /** Outline color (shared). */
  readonly outline: string;
}

/**
 * Per-eye definition (offset from cephalothorax center + radius).
 */
export interface EyeDefinition {
  /** X offset from cephalothorax center (facing-relative). */
  readonly dx: number;
  /** Y offset from cephalothorax center. */
  readonly dy: number;
  /** Eye radius in px. */
  readonly r: number;
}

/**
 * Per-chelicera (fang) definition (offset from cephalothorax center + base angle).
 */
export interface CheliceraDefinition {
  /** X offset from cephalothorax center (facing-relative). */
  readonly dx: number;
  /** Y offset from cephalothorax center. */
  readonly dy: number;
  /** Base angle in radians (facing-relative — renderer multiplies by facing). */
  readonly angle: number;
}

/**
 * Spider visual configuration. Subset of {@link SpiderConfig} for rendering
 * only. Separate from {@link GaitConfig} to keep the deterministic core clean.
 *
 * Every tunable the prototype inlined (eye offsets/sizes, palp anchor offsets,
 * jitter vertex count, leg taper widths, knee knob size) lives here with
 * sensible defaults in {@link DEFAULT_SPIDER}.
 */
export interface SpiderVisualConfig {
  /** Cephalothorax radius in px. */
  readonly cephRadius: number;
  /** Abdomen horizontal radius in px. */
  readonly abdRx: number;
  /** Abdomen vertical radius in px. */
  readonly abdRy: number;
  /** Abdomen X offset from ceph center in px (facing-relative). */
  readonly abdOffsetX: number;
  /** Breathing frequency (radians per tick). */
  readonly breathFrequency: number;
  /** Breathing amplitude (fractional scale variation). */
  readonly breathAmplitude: number;
  /** Leg joint visual radius in px. */
  readonly jointRadius: number;
  /** Body outline jitter amplitude in px. */
  readonly bodyJitterAmplitude: number;
  /** Pedipalp segment length in px. */
  readonly palpSegmentLength: number;
  /** Pedipalp stiffness in `[0, 1]`. */
  readonly palpStiffness: number;
  /** Body palette. */
  readonly palette: SpiderPalette;
  /** Per-leg rest positions (angle + distance). */
  readonly legRestPositions: readonly LegRestPosition[];
  /** Number of sub-sample steps when sampling ground downward. */
  readonly groundSampleSteps: number;
  /** Scale factor for reduced-motion accessibility (0 = no animation, 1 = full). */
  readonly motionScale: number;
  /** Shared leg geometry config (three-segment coxa/femur/tibia). */
  readonly geometry: SpiderLegGeometryConfig;

  // --- Renderer-adjacent fields ---

  /** Per-eye definitions (offsets from cephalothorax center + radius). */
  readonly eyeDefinitions: readonly EyeDefinition[];
  /** Per-chelicera (fang) definitions. */
  readonly chelicerae: readonly CheliceraDefinition[];
  /** Chelicera fang length in px. */
  readonly cheliceraeLength: number;
  /** Chelicera fang stroke width in px. */
  readonly cheliceraeWidth: number;
  /** Chelicera fang tip circle radius in px. */
  readonly cheliceraeTipRadius: number;
  /** Number of jitter vertices for body outline shapes. */
  readonly jitterVertexCount: number;
  /** Leg thickness at coxa (first segment, closest to body) in px. */
  readonly coxaWidth: number;
  /** Leg thickness at femur (second segment) in px. */
  readonly femurWidth: number;
  /** Leg thickness at tibia (third segment, foot end) in px. */
  readonly tibiaWidth: number;
  /** Leg outline stroke width in px. */
  readonly legOutlineWidth: number;
  /** Knee knob radius as multiplier of `jointRadius`. */
  readonly kneeKnobScale: number;
  /** Hip knob radius as multiplier of `jointRadius`. */
  readonly hipKnobScale: number;
  /** Knee spike length in px. 0 = no spike. */
  readonly kneeSpikeLength: number;
  /** Knee spike stroke width in px. */
  readonly kneeSpikeWidth: number;
  /**
   * Body Y offset from default in px (positive = closer to ground).
   * Tuning item 2: lower posture for heavier, more predatory feel.
   */
  readonly bodyYOffset: number;
  /**
   * Palp twitch frequency (radians per tick).
   * Tuning item 3: high-frequency micro-jitter on pedipalp tips.
   */
  readonly palpTwitchFreq: number;
  /**
   * Palp twitch amplitude in px.
   * Tuning item 3: micro-jitter amplitude on pedipalp tips.
   */
  readonly palpTwitchAmp: number;
  /** Pedipalp polyline stroke width in px. */
  readonly palpWidth: number;
  /** Pedipalp polyline stroke width at tip (tapering) in px. */
  readonly palpTipWidth: number;
  /** Background leg draw offset X in px. */
  readonly bgLegOffsetX: number;
  /** Background leg draw offset Y in px. */
  readonly bgLegOffsetY: number;
  /** Jittered body outline stroke width in px. */
  readonly bodyOutlineWidth: number;
}

/**
 * Bundled spider state: gait + pedipalp spring-rod nodes + jitter seed.
 *
 * Deterministic core — no `Canvas2D`, no renderer imports. This is a
 * convenience facade over {@link advanceGait} + {@link advanceSpringRod}.
 *
 * Both primitives remain independently available and TDD-able; the facade
 * exists for ergonomics and does NOT reduce testability.
 */
export interface SpiderState {
  /** Gait solver state (authoritative deterministic-core state). */
  readonly gait: GaitState;
  /** Left pedipalp spring-rod nodes. */
  readonly palpL: readonly VerletNode[];
  /** Right pedipalp spring-rod nodes. */
  readonly palpR: readonly VerletNode[];
  /** Body jitter seed (for per-spider outline uniqueness via mulberry32). */
  readonly jitterSeed: number;
}

/**
 * Compute world-space rest positions for all legs.
 *
 * The `legRestPositions` config defines positions for one side (4 entries).
 * This function mirrors them to produce `legCount * 2` total positions:
 * right side (facing=1) then left side (facing=-1, mirrored X).
 *
 * @param legRestPositions - per-leg rest angle + distance definitions (one side)
 * @param bodyX - body center X
 * @param bodyY - body center Y
 * @param facing - +1 right, -1 left
 * @returns world-space rest positions for all legs
 */
function computeRestPositions(
  legRestPositions: readonly LegRestPosition[],
  legCount: number,
  bodyX: number,
  bodyY: number,
  facing: 1 | -1,
): Vec2[] {
  const positions: Vec2[] = [];
  const count = Math.max(0, Math.min(
    legRestPositions.length,
    Number.isFinite(legCount) ? Math.floor(legCount) : legRestPositions.length,
  ));
  // Odd counts interpolate a leg onto exactly 90° (straight down), giving it a
  // zero fore/aft offset and thus no anatomical outward direction — the leg
  // then over-reaches instead of stepping. Nudge any leg out of a small band
  // around vertical so every leg keeps a definite forward/backward side.
  const VERTICAL_GAP_DEG = 12;
  const avoidVertical = (angle: number): number => {
    if (angle > 90 - VERTICAL_GAP_DEG && angle <= 90) return 90 - VERTICAL_GAP_DEG;
    if (angle > 90 && angle < 90 + VERTICAL_GAP_DEG) return 90 + VERTICAL_GAP_DEG;
    return angle;
  };
  const selected = count === 1
    ? [legRestPositions[Math.ceil((legRestPositions.length - 1) / 2)]]
    : count === legRestPositions.length
      ? [...legRestPositions]
      : Array.from({ length: count }, (_, i) => {
          const idx = Math.round((i / Math.max(1, count - 1)) * (legRestPositions.length - 1));
          const pos = legRestPositions[idx];
          return {
            angle: avoidVertical(pos.angle),
            distance: pos.distance,
          };
        });

  // Right side (facing=1)
  for (const lp of selected) {
    const rad = (lp.angle * Math.PI) / 180;
    positions.push({
      x: bodyX + Math.cos(rad) * lp.distance * facing,
      y: bodyY + Math.sin(rad) * lp.distance,
    });
  }

  // Far side uses the same fore-aft topology and advances independently.
  for (const lp of selected) {
    // With one leg per side, expose a useful support pair: near trails while
    // far reaches forward. Higher counts use matching anatomical ordinals.
    const farAngle = count === 1 ? 180 - lp.angle : lp.angle;
    const rad = (farAngle * Math.PI) / 180;
    positions.push({
      x: bodyX + Math.cos(rad) * lp.distance * facing,
      y: bodyY + Math.sin(rad) * lp.distance,
    });
  }

  return positions;
}

/**
 * Build the pedipalp spring-rod config from the spider config.
 */
function buildPalpConfig(
  visual: SpiderVisualConfig,
  facing: 1 | -1,
): SpringRodConfig {
  return {
    ...DEFAULT_SPRING_ROD,
    segmentLength: visual.palpSegmentLength,
    restDirection: { x: 0.5 * facing, y: -1 },
    stiffness: visual.palpStiffness,
    tipWeight: 0.05,
  };
}

/**
 * Compute pedipalp anchor position (at the front of the cephalothorax).
 */
function palpAnchor(
  bodyX: number,
  bodyY: number,
  cephRadius: number,
  facing: 1 | -1,
): { x: number; y: number } {
  return {
    x: bodyX + cephRadius * 1.0 * facing,
    y: bodyY - cephRadius * 0.3,
  };
}

/**
 * Initialise bundled spider state: gait (via {@link createGaitState}) + both
 * pedipalp spring-rods (via {@link createSpringRod}).
 *
 * Pure, never throws. Degenerate inputs produce a safe default state.
 *
 * @param config - combined spider configuration (internally split)
 * @param jitterSeed - seed for per-spider body jitter
 * @param initialBodyX - initial body center X in world space
 * @param initialBodyY - initial body center Y in world space
 * @param initialFacing - initial body facing for turn-safe leg pairing
 * @returns fresh {@link SpiderState}
 */
export function createSpiderState(
  config: SpiderConfig,
  jitterSeed: number,
  initialBodyX: number,
  initialBodyY: number,
  initialFacing: 1 | -1 = 1,
): SpiderState {
  const safeX = Number.isFinite(initialBodyX) ? initialBodyX : 0;
  const safeY = Number.isFinite(initialBodyY) ? initialBodyY : 0;
  const safeSeed = Number.isFinite(jitterSeed) ? jitterSeed : 0;
  const safeFacing: 1 | -1 = initialFacing === -1 ? -1 : 1;

  const { gait: gaitCfg, visual } = splitSpiderConfig(config);

  // Compute rest positions for all legs
  const restPositions = computeRestPositions(
    visual.legRestPositions,
    gaitCfg.legCount,
    safeX,
    safeY,
    safeFacing,
  );

  const gait = createGaitState(gaitCfg, restPositions, safeX, safeY, safeFacing);

  // Create pedipalp spring-rods
  const anchor = palpAnchor(safeX, safeY, visual.cephRadius, safeFacing);
  const palpConfig = buildPalpConfig(visual, safeFacing);

  const palpL = createSpringRod(
    4,
    anchor.x - 3,
    anchor.y,
    palpConfig.segmentLength,
    palpConfig.restDirection,
  );
  const palpR = createSpringRod(
    4,
    anchor.x + 3,
    anchor.y,
    palpConfig.segmentLength,
    palpConfig.restDirection,
  );

  return { gait, palpL, palpR, jitterSeed: safeSeed };
}

function restoreSpiderLegFan(
  gait: GaitState,
  bodyX: number,
  bodyY: number,
  facing: 1 | -1,
  geometry: SpiderLegGeometryConfig,
): GaitState {
  const sideCount = Math.floor(gait.legs.length / 2);
  const totalReach = geometry.hipRadius + geometry.coxaLength +
    geometry.femurLength + geometry.tibiaLength;
  const minSeparation = Math.max(0, geometry.minDistalAdvanceRatio) * totalReach;
  const collapsed = new Set<number>();

  for (const sideStart of [0, sideCount]) {
    for (let ordinal = 0; ordinal + 1 < sideCount; ordinal++) {
      const firstIndex = sideStart + ordinal;
      const secondIndex = firstIndex + 1;
      const first = gait.legs[firstIndex];
      const second = gait.legs[secondIndex];
      if (first.isSwinging || second.isSwinging) continue;
      if (Math.abs(first.footX - second.footX) < minSeparation) {
        collapsed.add(firstIndex);
        collapsed.add(secondIndex);
      }
    }
  }

  if (collapsed.size === 0) return gait;

  return {
    ...gait,
    legs: gait.legs.map((leg, index) => {
      if (!collapsed.has(index)) return leg;
      const restLocal = { x: leg.restLocalX, y: leg.restLocalY };
      const hip = computeHipPosition(bodyX, bodyY, facing, restLocal, geometry);
      const coxa = computeCoxaEndpoint(hip, facing, restLocal, geometry);
      const recovered = projectGroundedTargetIntoWorkspace(
        coxa,
        { x: bodyX + leg.restLocalX * facing, y: leg.footY },
        geometry,
        facing,
        leg.restLocalX,
      );
      return {
        ...leg,
        footX: recovered.x,
        footY: recovered.y,
        startX: recovered.x,
        startY: recovered.y,
        endX: recovered.x,
        endY: recovered.y,
        midX: recovered.x,
        midY: recovered.y,
      };
    }),
  };
}

/**
 * Advance the whole spider one tick: {@link advanceGait} +
 * {@link advanceSpringRod} (both palps).
 *
 * Pure composition of two deterministic primitives. Pure, deterministic,
 * never throws. The underlying `advanceGait` and `advanceSpringRod` remain
 * independently composable and testable; this facade exists for ergonomics.
 *
 * @param state - current spider state (fresh copy returned; input not mutated)
 * @param bodyX - body center X in world space
 * @param bodyY - body center Y in world space
 * @param vx - body horizontal velocity in px/s
 * @param vy - body vertical velocity in px/s
 * @param facing - +1 right, -1 left
 * @param dt - fixed timestep in seconds
 * @param config - combined spider configuration
 * @param tileQuery - tile solidity query (pure, no host access)
 * @param tileSize - tile grid cell size in px
 * @param tick - current simulation tick
 * @returns fresh {@link SpiderState}
 */
export function stepSpider(
  state: SpiderState,
  bodyX: number,
  bodyY: number,
  vx: number,
  vy: number,
  facing: 1 | -1,
  dt: number,
  config: SpiderConfig,
  tileQuery: TileSolidityQuery,
  tileSize: number,
  tick: number,
): SpiderState {
  const safeFacing: 1 | -1 = facing === 1 || facing === -1 ? facing : 1;
  const { gait: gaitCfg, visual } = splitSpiderConfig(config);

  // Advance gait
  const advancedGait = advanceGait(
    state.gait,
    bodyX, bodyY,
    vx, vy,
    safeFacing,
    dt,
    gaitCfg,
    tileQuery,
    tileSize,
    tick,
  );
  const newGait = restoreSpiderLegFan(
    advancedGait,
    bodyX,
    bodyY,
    safeFacing,
    gaitCfg.geometry,
  );

  // Advance pedipalps
  const palpCfg = buildPalpConfig(visual, safeFacing);
  const anchor = palpAnchor(bodyX, bodyY, visual.cephRadius, safeFacing);

  const palpL = advanceSpringRod(
    state.palpL as VerletNode[],
    anchor.x - 3,
    anchor.y,
    dt,
    palpCfg,
  );
  const palpR = advanceSpringRod(
    state.palpR as VerletNode[],
    anchor.x + 3,
    anchor.y,
    dt,
    palpCfg,
  );

  return {
    gait: newGait,
    palpL,
    palpR,
    jitterSeed: state.jitterSeed,
  };
}
