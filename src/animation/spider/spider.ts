/**
 * Renderer-adjacent spider module: pose evaluation and body/leg drawing.
 *
 * Composes the deterministic core's gait + spring-rod state into a visual
 * {@link SpiderPose}, then draws it via {@link drawSpider}. This module
 * MAY use `Math.sin`/`Math.cos` for breathing oscillation (visual only),
 * but MUST NOT mutate `state` or `pose`.
 *
 * **Never-throw contract.** Degenerate pose (zero legs, NaN positions),
 * missing palp chains, off-screen coords → no throw.
 *
 * @module
 */

import type { Vec2 } from '../types';
import type { VerletNode } from '../spring';
import { breathe } from '../squash-stretch';
import { mulberry32 } from '../../rng/mulberry32';
import { getGaitFootPosition, type GaitLegState } from './gait';
import type { SpiderState, SpiderVisualConfig, EyeDefinition, CheliceraDefinition } from './spider-state';
import { solveThreeSegmentLeg } from './geometry';

/**
 * Resolved leg pose: hip, coxa, knee, and foot positions in world space.
 *
 * Three-segment model: hip → coxa → knee (femur/tibia junction) → foot.
 */
export interface LegPose {
  /** Hip (root) world X. */
  readonly hipX: number;
  /** Hip (root) world Y. */
  readonly hipY: number;
  /** Coxa endpoint (femur root) world X. */
  readonly coxaX: number;
  /** Coxa endpoint (femur root) world Y. */
  readonly coxaY: number;
  /** Knee (femur/tibia junction) world X. */
  readonly kneeX: number;
  /** Knee (femur/tibia junction) world Y. */
  readonly kneeY: number;
  /** Foot (end-effector) world X. */
  readonly footX: number;
  /** Foot (end-effector) world Y. */
  readonly footY: number;
  /** Whether this leg is background (drawn darker, behind body). */
  readonly isBg: boolean;
}

/**
 * Fully resolved spider pose ready for drawing.
 *
 * All positions are in world space. The renderer reads this structure and
 * draws it — no further computation needed at the draw call.
 */
export interface SpiderPose {
  /** Cephalothorax center and radius. */
  readonly cephalothorax: { readonly x: number; readonly y: number; readonly radius: number };
  /** Abdomen center and radii (breathing-scaled). */
  readonly abdomen: { readonly x: number; readonly y: number; readonly rx: number; readonly ry: number };
  /** 8 eye positions and radii. */
  readonly eyes: readonly { readonly x: number; readonly y: number; readonly radius: number }[];
  /** 2 chelicera (fang) positions and angles. */
  readonly chelicerae: readonly { readonly x: number; readonly y: number; readonly angle: number }[];
  /** 8 leg poses (4 foreground + 4 background). */
  readonly legPoses: readonly LegPose[];
  /** 2 pedipalp chains (left and right), each a polyline of world-space points. */
  readonly palpChains: readonly (readonly Vec2[])[];
  /** Seeded body-outline jitter offsets (stable per spider via `mulberry32(jitterSeed)` alone). */
  readonly jitterOffsets: readonly number[];
}

// ---------------------------------------------------------------------------
// Helper: safe number
// ---------------------------------------------------------------------------

function safeNum(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

// ---------------------------------------------------------------------------
// evaluateSpiderPose
// ---------------------------------------------------------------------------

/**
 * Evaluate the full spider pose from deterministic state.
 *
 * Composes body math (cephalothorax, lagging breathing abdomen via
 * {@link breathe}, eyes, chelicerae), per-leg three-segment IK via
 * {@link solveThreeSegmentLeg} using fixed coxa + analytical femur/tibia
 * solve, palp chains from `state.palpL`/`state.palpR`, and seeded
 * body-outline jitter via `mulberry32(state.jitterSeed)` alone (no tick —
 * stable per spider).
 *
 * Pure; no simulation mutation. Never throws.
 *
 * @param state - current spider state (read-only)
 * @param bodyX - body center X in world space
 * @param bodyY - body center Y in world space
 * @param facing - +1 right, -1 left
 * @param vx - body horizontal velocity (for abdomen lag)
 * @param vy - body vertical velocity (unused, reserved)
 * @param tick - current simulation tick (for breathing oscillation)
 * @param visualConfig - visual configuration
 * @returns resolved {@link SpiderPose}
 */
export function evaluateSpiderPose(
  state: SpiderState,
  bodyX: number,
  bodyY: number,
  facing: 1 | -1,
  vx: number,
  _vy: number,
  tick: number,
  visualConfig: SpiderVisualConfig,
): SpiderPose {
  const safeFacing: 1 | -1 = facing === 1 || facing === -1 ? facing : 1;
  const cephX = safeNum(bodyX, 0);
  const cephY = safeNum(bodyY, 0) + safeNum(visualConfig.bodyYOffset, 0);
  const cephRadius = safeNum(visualConfig.cephRadius, 10);

  // Abdomen: lagging behind + breathing oscillation
  const lagX = -safeNum(vx, 0) * 0.15;
  const breath = breathe(safeNum(tick, 0), {
    frequency: safeNum(visualConfig.breathFrequency, 0.03),
    amplitude: safeNum(visualConfig.breathAmplitude, 0.05),
  });
  const abdRx = safeNum(visualConfig.abdRx, 16) * breath.scaleX;
  const abdRy = safeNum(visualConfig.abdRy, 12) * breath.scaleY;
  const rawAbdOffset = safeNum(visualConfig.abdOffsetX, -18) * safeFacing + lagX;
  const maxAbdOffset = Math.max(0, cephRadius + abdRx);
  const abdX = cephX + Math.max(-maxAbdOffset, Math.min(maxAbdOffset, rawAbdOffset));
  const abdY = cephY;

  // Eyes: per-eye definitions from config, mirrored by facing
  const eyes = visualConfig.eyeDefinitions.map((e: EyeDefinition) => ({
    x: cephX + safeNum(e.dx, 0) * safeFacing,
    y: cephY + safeNum(e.dy, 0),
    radius: Math.max(0, safeNum(e.r, 1)),
  }));

  // Chelicerae (fangs): per-definition from config, mirrored by facing
  const chelicerae = visualConfig.chelicerae.map((ch: CheliceraDefinition) => ({
    x: cephX + safeNum(ch.dx, 12) * safeFacing,
    y: cephY + safeNum(ch.dy, 0),
    angle: safeNum(ch.angle, 0.5) * safeFacing,
  }));

  // Legs: three-segment IK via solveThreeSegmentLeg
  const geometry = visualConfig.geometry;
  const legPoses: LegPose[] = state.gait.legs.map((leg: GaitLegState, i: number) => {
    const restLocal = {
      x: safeNum(leg.restLocalX, 0),
      y: safeNum(leg.restLocalY, cephRadius),
    };

    const foot = getGaitFootPosition(leg);
    const footTarget = {
      x: safeNum(foot.x, cephX),
      y: safeNum(foot.y, cephY + 30),
    };

    const result = solveThreeSegmentLeg(
      cephX, cephY, safeFacing, restLocal, footTarget, geometry,
    );

    return {
      hipX: result.hipX,
      hipY: result.hipY,
      coxaX: result.coxaX,
      coxaY: result.coxaY,
      kneeX: result.kneeX,
      kneeY: result.kneeY,
      footX: result.footX,
      footY: result.footY,
      isBg: i >= state.gait.legs.length / 2,
    };
  });

  // Pedipalp chains: read from state, with optional twitch on tips
  const twitchFreq = safeNum(visualConfig.palpTwitchFreq, 0.8);
  const twitchAmp = safeNum(visualConfig.palpTwitchAmp, 0.5);
  const motionScale = safeNum(visualConfig.motionScale, 1);
  const effectiveTwitchAmp = twitchAmp * motionScale;

  const palpChains: (readonly Vec2[])[] = [state.palpL, state.palpR].map(
    (chain: readonly VerletNode[]) => {
      const pts: Vec2[] = chain.map((n: VerletNode) => ({ x: n.x, y: n.y }));
      if (pts.length >= 2 && effectiveTwitchAmp > 0) {
        const tip = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        const dx = tip.x - prev.x;
        const dy = tip.y - prev.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const twitch = Math.sin(safeNum(tick, 0) * twitchFreq) * effectiveTwitchAmp;
        pts[pts.length - 1] = { x: tip.x + nx * twitch, y: tip.y + ny * twitch };
      }
      return pts;
    },
  );

  // Body-outline jitter: seeded per-spider via mulberry32(jitterSeed) alone
  const jitterRng = mulberry32(safeNum(state.jitterSeed, 0));
  const jitterCount = Math.max(1, Math.round(safeNum(visualConfig.jitterVertexCount, 24)));
  const jitterAmp = safeNum(visualConfig.bodyJitterAmplitude, 1.5);
  const jitterOffsets: number[] = [];
  for (let i = 0; i < jitterCount; i++) {
    jitterOffsets.push((jitterRng() - 0.5) * 2 * jitterAmp);
  }

  return {
    cephalothorax: { x: cephX, y: cephY, radius: cephRadius },
    abdomen: { x: abdX, y: abdY, rx: abdRx, ry: abdRy },
    eyes,
    chelicerae,
    legPoses,
    palpChains,
    jitterOffsets,
  };
}

// ---------------------------------------------------------------------------
// drawSpider
// ---------------------------------------------------------------------------

/**
 * Draw a resolved spider pose to a canvas context.
 *
 * Drawing order:
 * 1. Background legs (darker shade, slight offset)
 * 2. Abdomen jittered outline
 * 3. Cephalothorax jittered outline
 * 4. 8 eyes (high-contrast)
 * 5. Chelicerae fangs
 * 6. Foreground legs (full color, three tapered segments with knee knob and optional spike)
 * 7. Pedipalps (tapered polylines)
 *
 * `ctx.save()`/`ctx.restore()` around the whole thing; restores
 * fillStyle/strokeStyle/lineWidth/globalAlpha/globalCompositeOperation.
 * Never throws.
 *
 * @param ctx - canvas 2D rendering context
 * @param pose - resolved spider pose
 * @param visualConfig - visual configuration
 */
export function drawSpider(
  ctx: CanvasRenderingContext2D,
  pose: SpiderPose,
  visualConfig: SpiderVisualConfig,
): void {
  ctx.save();

  const palette = visualConfig.palette;
  const cephRadius = safeNum(visualConfig.cephRadius, 10);
  const jointRadius = safeNum(visualConfig.jointRadius, 2.5);
  const bgOX = safeNum(visualConfig.bgLegOffsetX, 2);
  const bgOY = safeNum(visualConfig.bgLegOffsetY, 1);
  const kneeKnobR = jointRadius * safeNum(visualConfig.kneeKnobScale, 1);
  const hipKnobR = jointRadius * safeNum(visualConfig.hipKnobScale, 0.8);
  const coxaW = safeNum(visualConfig.coxaWidth, 4);
  const femurW = safeNum(visualConfig.femurWidth, 3.5);
  const tibiaW = safeNum(visualConfig.tibiaWidth, 2);
  const legOutlineW = safeNum(visualConfig.legOutlineWidth, 5);
  const spikeLen = safeNum(visualConfig.kneeSpikeLength, 0);
  const spikeW = safeNum(visualConfig.kneeSpikeWidth, 1.5);
  const palpW = safeNum(visualConfig.palpWidth, 2);
  const palpTipW = safeNum(visualConfig.palpTipWidth, 1);
  const cheliceraeLen = safeNum(visualConfig.cheliceraeLength, 8);
  const cheliceraeW = safeNum(visualConfig.cheliceraeWidth, 3);
  const cheliceraeTipR = safeNum(visualConfig.cheliceraeTipRadius, 1.5);
  const bodyOutlineW = safeNum(visualConfig.bodyOutlineWidth, 1.5);

  // 1. Background legs (darker shade, slight offset)
  for (const leg of pose.legPoses) {
    if (!leg.isBg) continue;
    drawLeg(ctx, leg, palette.legBg, palette.outline, kneeKnobR, hipKnobR,
      coxaW, femurW, tibiaW, legOutlineW, bgOX, bgOY, spikeLen, spikeW);
  }

  // 2. Abdomen with jittered outline
  drawJitteredEllipse(
    ctx,
    pose.abdomen.x,
    pose.abdomen.y,
    pose.abdomen.rx,
    pose.abdomen.ry,
    pose.jitterOffsets,
    0,
    palette.abdFill,
    palette.outline,
    bodyOutlineW,
  );

  // 3. Cephalothorax with jittered outline
  drawJitteredEllipse(
    ctx,
    pose.cephalothorax.x,
    pose.cephalothorax.y,
    cephRadius,
    cephRadius,
    pose.jitterOffsets,
    Math.round(safeNum(visualConfig.jitterVertexCount, 24) / 2),
    palette.cephFill,
    palette.outline,
    bodyOutlineW,
  );

  // 4. Eyes
  for (const eye of pose.eyes) {
    ctx.beginPath();
    ctx.arc(eye.x, eye.y, eye.radius, 0, Math.PI * 2);
    ctx.fillStyle = palette.eyeFill;
    ctx.fill();
    ctx.strokeStyle = palette.outline;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  // 5. Chelicerae (fangs)
  for (const ch of pose.chelicerae) {
    const tipX = ch.x + Math.cos(ch.angle) * cheliceraeLen;
    const tipY = ch.y + Math.sin(ch.angle) * cheliceraeLen;
    ctx.beginPath();
    ctx.moveTo(ch.x, ch.y);
    ctx.lineTo(tipX, tipY);
    ctx.strokeStyle = palette.cheliceraeFill;
    ctx.lineWidth = cheliceraeW;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(tipX, tipY, cheliceraeTipR, 0, Math.PI * 2);
    ctx.fillStyle = palette.cheliceraeFill;
    ctx.fill();
  }

  // 6. Foreground legs (full color, three segments)
  for (const leg of pose.legPoses) {
    if (leg.isBg) continue;
    drawLeg(ctx, leg, palette.legFg, palette.outline, kneeKnobR, hipKnobR,
      coxaW, femurW, tibiaW, legOutlineW, 0, 0, spikeLen, spikeW);
  }

  // 7. Pedipalps (tapered polylines)
  for (const chain of pose.palpChains) {
    if (chain.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(chain[0].x, chain[0].y);
    for (let i = 1; i < chain.length; i++) {
      ctx.lineTo(chain[i].x, chain[i].y);
    }
    ctx.strokeStyle = palette.palpFill;
    ctx.lineWidth = palpW;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Tapered tip segment
    if (chain.length >= 2) {
      const a = chain[chain.length - 2];
      const b = chain[chain.length - 1];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = palette.palpFill;
      ctx.lineWidth = palpTipW;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Internal drawing helpers
// ---------------------------------------------------------------------------

/**
 * Draw a single leg (coxa + femur + tibia + knee knob + hip knob + optional knee spike).
 */
function drawLeg(
  ctx: CanvasRenderingContext2D,
  leg: LegPose,
  color: string,
  outlineColor: string,
  kneeKnobR: number,
  hipKnobR: number,
  coxaWidth: number,
  femurWidth: number,
  tibiaWidth: number,
  outlineWidth: number,
  offsetX: number,
  offsetY: number,
  spikeLength: number,
  spikeWidth: number,
): void {
  const ox = offsetX;
  const oy = offsetY;

  // Outline pass (full polyline: hip → coxa → knee → foot)
  ctx.beginPath();
  ctx.moveTo(leg.hipX + ox, leg.hipY + oy);
  ctx.lineTo(leg.coxaX + ox, leg.coxaY + oy);
  ctx.lineTo(leg.kneeX + ox, leg.kneeY + oy);
  ctx.lineTo(leg.footX + ox, leg.footY + oy);
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = outlineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Coxa segment (thickest)
  ctx.beginPath();
  ctx.moveTo(leg.hipX + ox, leg.hipY + oy);
  ctx.lineTo(leg.coxaX + ox, leg.coxaY + oy);
  ctx.strokeStyle = color;
  ctx.lineWidth = coxaWidth;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Femur segment (medium)
  ctx.beginPath();
  ctx.moveTo(leg.coxaX + ox, leg.coxaY + oy);
  ctx.lineTo(leg.kneeX + ox, leg.kneeY + oy);
  ctx.strokeStyle = color;
  ctx.lineWidth = femurWidth;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Tibia segment (thinnest)
  ctx.beginPath();
  ctx.moveTo(leg.kneeX + ox, leg.kneeY + oy);
  ctx.lineTo(leg.footX + ox, leg.footY + oy);
  ctx.strokeStyle = color;
  ctx.lineWidth = tibiaWidth;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Knee spike (at femur/tibia junction)
  if (spikeLength > 0) {
    const dx = leg.footX - leg.coxaX;
    const dy = leg.footY - leg.coxaY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    ctx.beginPath();
    ctx.moveTo(leg.kneeX + ox, leg.kneeY + oy);
    ctx.lineTo(
      leg.kneeX + ox + nx * spikeLength,
      leg.kneeY + oy + ny * spikeLength,
    );
    ctx.strokeStyle = color;
    ctx.lineWidth = spikeWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // Joint (knee) knob — at femur/tibia junction
  ctx.beginPath();
  ctx.arc(leg.kneeX + ox, leg.kneeY + oy, kneeKnobR, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Coxa knob — at coxa/femur junction
  ctx.beginPath();
  ctx.arc(leg.coxaX + ox, leg.coxaY + oy, hipKnobR, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Hip knob
  ctx.beginPath();
  ctx.arc(leg.hipX + ox, leg.hipY + oy, hipKnobR, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Draw a jittered ellipse (body segment) with seeded outline distortion.
 */
function drawJitteredEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  jitterOffsets: readonly number[],
  offsetIndex: number,
  fill: string,
  outline: string,
  outlineWidth: number,
): void {
  const segments = jitterOffsets.length > 0 ? jitterOffsets.length : 20;
  const points: Vec2[] = [];

  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const px = cx + Math.cos(angle) * rx;
    const py = cy + Math.sin(angle) * ry;
    const jitter = jitterOffsets[(i + offsetIndex) % jitterOffsets.length] ?? 0;

    const dx = px - cx;
    const dy = py - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / len;
    const ny = dy / len;

    points.push({
      x: px + nx * jitter,
      y: py + ny * jitter,
    });
  }

  if (points.length === 0) return;

  // Fill
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  // Outline
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  ctx.strokeStyle = outline;
  ctx.lineWidth = outlineWidth;
  ctx.stroke();
}
