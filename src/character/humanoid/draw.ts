import { breathe } from '../../animation/squash-stretch';
import type { Vec2 } from '../../animation/types';
import { mixHex, shade } from '../../primitives/color';
import type { CharacterBodyFrame, CharacterDrawOptions } from '../types';
import {
  HUMANOID_BASE_HEIGHT,
  HUMANOID_BASE_WIDTH,
  HUMANOID_CAP_OVERHANG,
  HUMANOID_CAP_THICKNESS,
  HUMANOID_CREST_BASE_HALF,
  HUMANOID_CREST_HEIGHT,
  HUMANOID_ELBOW_HALF_WIDTH,
  HUMANOID_EYE_RADIUS,
  HUMANOID_FACE_CHEEK_CENTER,
  HUMANOID_FACE_CHEEK_DY,
  HUMANOID_FACE_CHEEK_RX,
  HUMANOID_FACE_CHEEK_RY,
  HUMANOID_FACE_MUZZLE_MIX,
  HUMANOID_FAR_SHADE,
  HUMANOID_FAR_WIDTH_GAIN,
  HUMANOID_FOOT_TOE_OUTSET,
  HUMANOID_HAND_HALF_WIDTH,
  HUMANOID_KNEE_HALF_WIDTH,
  HUMANOID_NEAR_SHADE,
  HUMANOID_NEAR_WIDTH_GAIN,
  HUMANOID_OUTLINE_WIDTH,
  HUMANOID_SHIN_HALF_WIDTH,
  HUMANOID_THIGH_HALF_WIDTH,
  HUMANOID_TOE_HALF_WIDTH,
  HUMANOID_UPPER_ARM_HALF_WIDTH,
  TWO_PI,
} from './constants';
import { composePose } from './pose';
import type { LimbChain, PoseComposition } from './pose';
import type { HumanoidConfig, HumanoidVisualState } from './types';

/**
 * Length below which a limb segment is treated as degenerate. Guards the
 * outline normal computation against a divide-by-zero; the segment borrows a
 * neighbour direction so the outline never collapses to a `NaN` point.
 */
const DEGENERATE_SEGMENT_EPSILON = 1e-6;

/**
 * Miter limit (in units of the joint half-width) beyond which a mitered corner
 * falls back to a bevel. Caps the outer spike at sharp bends (e.g. the ~90°
 * ankle into the foot) so the silhouette stays bounded, while near-straight
 * joints (idle knees/elbows) naturally fall back to an invisible bevel and read
 * as a smooth continuous taper.
 */
const MITER_LIMIT = 2.0;

/** Denominator below which two offset edges are treated as parallel (no miter). */
const PARALLEL_EPSILON = 1e-6;

/** Filled, outlined paint pair for one shape pass. */
interface Paint {
  readonly fill: string;
  readonly outline: string;
}

/**
 * Trace a whole tapered limb chain as ONE continuous closed silhouette path so
 * it can be filled and stroked a single time — the outline runs only along the
 * outer boundary, never cutting across an interior joint, wrist, or ankle.
 *
 * The path is the outer envelope of a variable-width stroke of the polyline
 * `points[0] → … → points[n-1]` with per-vertex half-widths `widths[i]`:
 *   - both silhouette edges are offset perpendicular to each segment;
 *   - interior joints are mitered (intersection of the two offset edges),
 *     falling back to a bevel when the miter would spike past
 *     {@link MITER_LIMIT} or when the edges are parallel (near-straight joints);
 *   - the two ends are capped with semicircular arcs of the endpoint radius.
 *
 * Non-finite inputs are clamped so no `NaN`/`Infinity` is ever painted. Never
 * throws.
 *
 * @param ctx - canvas context (begins and closes its own path)
 * @param points - chain landmarks (root → joint → … → end), length ≥ 1
 * @param widths - half-width at each landmark, same length as `points`
 */
function traceChainOutline(
  ctx: CanvasRenderingContext2D,
  points: readonly Readonly<Vec2>[],
  widths: readonly number[],
): void {
  const n = points.length;
  const px: number[] = new Array(n);
  const py: number[] = new Array(n);
  const w: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    px[i] = Number.isFinite(points[i].x) ? points[i].x : 0;
    py[i] = Number.isFinite(points[i].y) ? points[i].y : 0;
    const wi = widths[i];
    w[i] = wi > 0 && Number.isFinite(wi) ? wi : 0;
  }
  ctx.beginPath();
  if (n < 2) {
    ctx.arc(px[0], py[0], w[0], 0, TWO_PI);
    ctx.closePath();
    return;
  }

  const dx: number[] = new Array(n - 1);
  const dy: number[] = new Array(n - 1);
  const nx: number[] = new Array(n - 1);
  const ny: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i += 1) {
    let sx = px[i + 1] - px[i];
    let sy = py[i + 1] - py[i];
    const sl = Math.hypot(sx, sy);
    if (sl < DEGENERATE_SEGMENT_EPSILON) {
      sx = 0;
      sy = 0;
    } else {
      sx /= sl;
      sy /= sl;
    }
    dx[i] = sx;
    dy[i] = sy;
    nx[i] = -sy;
    ny[i] = sx;
  }
  for (let i = 0; i < n - 1; i += 1) {
    if (dx[i] === 0 && dy[i] === 0) {
      const j = i > 0 ? i - 1 : i + 1 < n - 1 ? i + 1 : -1;
      if (j >= 0) {
        dx[i] = dx[j];
        dy[i] = dy[j];
        nx[i] = nx[j];
        ny[i] = ny[j];
      }
    }
  }

  const angleDelta = (a: number, b: number): number => {
    let d = a - b;
    while (d > Math.PI) d -= TWO_PI;
    while (d < -Math.PI) d += TWO_PI;
    return d;
  };

  /** Miter intersection at interior vertex `i` on `side` (+1 / -1), or null. */
  const miterAt = (i: number, side: 1 | -1): { x: number; y: number } | null => {
    const mInX = nx[i - 1];
    const mInY = ny[i - 1];
    const mOutX = nx[i];
    const mOutY = ny[i];
    const dInX = dx[i - 1];
    const dInY = dy[i - 1];
    const dOutX = dx[i];
    const dOutY = dy[i];
    const aX = px[i] + side * mInX * w[i];
    const aY = py[i] + side * mInY * w[i];
    const bX = px[i] + side * mOutX * w[i];
    const bY = py[i] + side * mOutY * w[i];
    const denom = dInX * -dOutY - dInY * -dOutX;
    if (Math.abs(denom) < PARALLEL_EPSILON) return null;
    const rhsX = bX - aX;
    const rhsY = bY - aY;
    const t = (rhsX * -dOutY - rhsY * -dOutX) / denom;
    return { x: aX + dInX * t, y: aY + dInY * t };
  };

  /** Sweeps a semicircular cap on the side containing `targetAngle`. */
  const capArc = (
    cx: number,
    cy: number,
    radius: number,
    fromNormalX: number,
    fromNormalY: number,
    alongDirX: number,
    alongDirY: number,
  ): void => {
    const start = Math.atan2(fromNormalY, fromNormalX);
    const end = Math.atan2(-fromNormalY, -fromNormalX);
    const target = Math.atan2(alongDirY, alongDirX);
    const midDec = start - Math.PI / 2;
    const midInc = start + Math.PI / 2;
    const ccw =
      Math.abs(angleDelta(midDec, target)) < Math.abs(angleDelta(midInc, target));
    ctx.arc(cx, cy, radius, start, end, ccw);
  };

  // +side forward: root → … → end (miter/bevel at each interior joint).
  ctx.moveTo(px[0] + nx[0] * w[0], py[0] + ny[0] * w[0]);
  for (let i = 0; i <= n - 2; i += 1) {
    ctx.lineTo(px[i + 1] + nx[i] * w[i + 1], py[i + 1] + ny[i] * w[i + 1]);
    const j = i + 1;
    if (j >= 1 && j <= n - 2) {
      const m = miterAt(j, 1);
      if (m && Math.hypot(m.x - px[j], m.y - py[j]) <= MITER_LIMIT * w[j]) {
        ctx.lineTo(m.x, m.y);
      }
      ctx.lineTo(px[j] + nx[j] * w[j], py[j] + ny[j] * w[j]);
    }
  }
  // End cap: semicircle through +dir[last].
  const last = n - 2;
  capArc(
    px[n - 1],
    py[n - 1],
    w[n - 1],
    nx[last],
    ny[last],
    dx[last],
    dy[last],
  );
  // -side backward: end → … → root (miter/bevel at each interior joint).
  for (let i = n - 2; i >= 0; i -= 1) {
    ctx.lineTo(px[i] - nx[i] * w[i], py[i] - ny[i] * w[i]);
    if (i >= 1 && i <= n - 2) {
      const m = miterAt(i, -1);
      if (m && Math.hypot(m.x - px[i], m.y - py[i]) <= MITER_LIMIT * w[i]) {
        ctx.lineTo(m.x, m.y);
      }
      ctx.lineTo(px[i] - nx[i - 1] * w[i], py[i] - ny[i - 1] * w[i]);
    }
  }
  // Start cap: semicircle through -dir[0], closing back to the +side root.
  capArc(px[0], py[0], w[0], -nx[0], -ny[0], -dx[0], -dy[0]);
  ctx.closePath();
}

/** Fill then stroke the current path with a consistent outline weight + round joins. */
function paintCurrentPath(ctx: CanvasRenderingContext2D, paint: Paint): void {
  ctx.fillStyle = paint.fill;
  ctx.strokeStyle = paint.outline;
  ctx.lineWidth = HUMANOID_OUTLINE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fill();
  ctx.stroke();
}

/**
 * Draw an arm (shoulder → elbow → hand) as one continuous tapered outline whose
 * rounded end cap IS the hand/fist. Because the hand is just the widened
 * termination of the forearm's silhouette, no separate hand shape (and no
 * wrist seam) is ever stroked.
 *
 * @param widths - `[upperArm, elbow, hand]` half-widths (already depth-scaled)
 */
function drawArmLimb(
  ctx: CanvasRenderingContext2D,
  chain: LimbChain,
  widths: readonly [number, number, number],
  paint: Paint,
): void {
  traceChainOutline(ctx, [chain.root, chain.joint, chain.end], widths);
  paintCurrentPath(ctx, paint);
}

/**
 * Draw a leg (hip → knee → ankle → toe) as one continuous tapered outline. The
 * final horizontal segment from the ankle toward +x (the travel side) IS the
 * foot, sharing the shin's outline so no ankle seam is stroked. The ~90° bend
 * at the ankle becomes a mitered shoe corner.
 *
 * @param widths - `[thigh, knee, shin, toe]` half-widths (already depth-scaled)
 * @param footOutset - forward length of the foot segment past the ankle
 */
function drawLegLimb(
  ctx: CanvasRenderingContext2D,
  chain: LimbChain,
  widths: readonly [number, number, number, number],
  paint: Paint,
  footOutset: number,
): void {
  const toe: Vec2 = { x: chain.end.x + footOutset, y: chain.end.y };
  traceChainOutline(ctx, [chain.root, chain.joint, chain.end, toe], widths);
  paintCurrentPath(ctx, paint);
}

/**
 * Draw the torso three-quarter quad with render-time breathing. The former
 * straight sternum centerline is intentionally omitted: it read as a debug
 * axis, and a clean filled mass reads as a torso without it.
 */
function drawTorso(
  ctx: CanvasRenderingContext2D,
  pose: PoseComposition,
  breath: { readonly scaleX: number; readonly scaleY: number },
  paint: Paint,
): void {
  const centreX = (pose.torso.topCentre.x + pose.torso.bottomCentre.x) / 2;
  const centreY = (pose.torso.topCentre.y + pose.torso.bottomCentre.y) / 2;
  ctx.save();
  ctx.translate(centreX, centreY);
  ctx.scale(breath.scaleX, breath.scaleY);
  ctx.beginPath();
  ctx.moveTo(pose.torso.topFar.x - centreX, pose.torso.topFar.y - centreY);
  ctx.lineTo(pose.torso.topNear.x - centreX, pose.torso.topNear.y - centreY);
  ctx.lineTo(pose.torso.bottomNear.x - centreX, pose.torso.bottomNear.y - centreY);
  ctx.lineTo(pose.torso.bottomFar.x - centreX, pose.torso.bottomFar.y - centreY);
  ctx.closePath();
  paintCurrentPath(ctx, paint);
  ctx.restore();
}

/**
 * Draw the `cap` head style as a stroked arc band that follows the head curve.
 * An outline underlay is stroked first, then the feature band on top, so the
 * cap reads as a snug curved beanie, not a box.
 */
function drawCap(
  ctx: CanvasRenderingContext2D,
  centre: Readonly<Vec2>,
  radius: number,
  paint: Paint,
): void {
  const bandRadius = radius - HUMANOID_CAP_THICKNESS / 2;
  if (bandRadius <= 0) return;
  const start = Math.PI + HUMANOID_CAP_OVERHANG;
  const end = Math.PI * 2 - HUMANOID_CAP_OVERHANG;
  ctx.lineCap = 'round';
  ctx.strokeStyle = paint.outline;
  ctx.lineWidth = HUMANOID_CAP_THICKNESS + HUMANOID_OUTLINE_WIDTH * 2;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, bandRadius, start, end, false);
  ctx.stroke();
  ctx.strokeStyle = paint.fill;
  ctx.lineWidth = HUMANOID_CAP_THICKNESS;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, bandRadius, start, end, false);
  ctx.stroke();
}

/**
 * Draw the `crest` head style as a smooth pointed tuft rising from the crown.
 * Two quadratic curves belly out from a shared base to a pointed apex, giving
 * a clean leaf/spike silhouette.
 */
function drawCrest(
  ctx: CanvasRenderingContext2D,
  crown: Readonly<Vec2>,
  paint: Paint,
): void {
  const baseY = crown.y;
  const apexX = crown.x;
  const apexY = baseY - HUMANOID_CREST_HEIGHT;
  const curl = HUMANOID_CREST_BASE_HALF;
  ctx.beginPath();
  ctx.moveTo(apexX - HUMANOID_CREST_BASE_HALF, baseY);
  ctx.quadraticCurveTo(apexX - curl, apexY + curl, apexX, apexY);
  ctx.quadraticCurveTo(apexX + curl, apexY + curl, apexX + HUMANOID_CREST_BASE_HALF, baseY);
  ctx.closePath();
  paintCurrentPath(ctx, paint);
}

/**
 * Draw a minimal three-quarter face on the +x travel side of the head: a
 * shaded "muzzle/cheek" plane (a filled ellipse clipped to the head circle, so
 * the marks never escape the silhouette) with the eye dot set into it. There
 * are no thin high-contrast strokes — at 16×24 / 8×12 the face degrades to a
 * soft shaded plane + eye instead of spiky vector lines.
 */
function drawFace(
  ctx: CanvasRenderingContext2D,
  head: Readonly<Vec2>,
  headRadius: number,
  eye: Readonly<Vec2>,
  accent: string,
  outline: string,
): void {
  const muzzle = mixHex(accent, outline, HUMANOID_FACE_MUZZLE_MIX);
  ctx.save();
  ctx.beginPath();
  ctx.arc(head.x, head.y, headRadius, 0, TWO_PI);
  ctx.clip();
  const cx = head.x + (eye.x - head.x) * HUMANOID_FACE_CHEEK_CENTER;
  const cy = eye.y + HUMANOID_FACE_CHEEK_DY;
  ctx.fillStyle = muzzle;
  ctx.beginPath();
  ctx.ellipse(cx, cy, HUMANOID_FACE_CHEEK_RX, HUMANOID_FACE_CHEEK_RY, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.arc(eye.x, eye.y, HUMANOID_EYE_RADIUS, 0, TWO_PI);
  ctx.fill();
}

/**
 * Draw the head: filled circle, optional curved cap / smooth crest treatment,
 * and the clipped three-quarter face. Drawn last in the depth order.
 */
function drawHead(
  ctx: CanvasRenderingContext2D,
  pose: PoseComposition,
  config: HumanoidConfig,
  accent: string,
  feature: string,
  outline: string,
): void {
  const centre = pose.head.centre;
  const radius =
    Number.isFinite(config.headRadius) && config.headRadius > 0
      ? config.headRadius
      : 0;
  if (radius <= 0) return;

  const skin: Paint = { fill: accent, outline };
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius, 0, TWO_PI);
  ctx.closePath();
  paintCurrentPath(ctx, skin);

  const treatment: Paint = { fill: feature, outline };
  if (config.headStyle === 'cap') {
    drawCap(ctx, centre, radius, treatment);
  } else if (config.headStyle === 'crest') {
    drawCrest(ctx, pose.head.crown, treatment);
  }

  drawFace(ctx, centre, radius, pose.head.eye, accent, outline);
}

/**
 * Draw a procedural humanoid inside a consumer-owned body frame.
 *
 * Rendering is a pure consumer of {@link composePose}: the pose evaluator
 * resolves all canonical right-facing geometry, and this function renders it in
 * explicit depth passes (`farLeg → farArm → torso → nearLeg → nearArm → head`).
 * Each limb is painted as a single continuous tapered outline (root → joint →
 * end, plus a merged hand or foot termination) filled and stroked once, so the
 * outline runs only along the outer silhouette — no internal seam crosses a
 * knee, elbow, wrist, or ankle. Near limbs are thicker + brighter (foreground);
 * far limbs modestly thinner + slightly darker (recessed but still solid).
 * Breathing is applied here as a render-time torso scale via
 * `breathe(tick, config.breath)`; it never enters the pose evaluator.
 *
 * The only world-space work this renderer owns is the conversion of the
 * optional world `armTarget` / `lookTarget` into canonical right-facing local
 * space before passing it to `composePose`. The final screen mirror is
 * `ctx.scale(facing * scale, scale)`; near/far depth roles never flip.
 *
 * Outline weight is a thin fraction of a canonical pixel so it stays
 * proportional across the 32×48, 16×24, and 8×12 sheet scales instead of
 * crushing the smallest silhouettes.
 *
 * Deterministic and finite: output is a pure function of the inputs; no
 * `Math.random` / `Date.now`; every painted coordinate is finite (the pose is
 * finite by contract and the renderer's own math guards against NaN).
 *
 * State-read-only: restores the passed canvas context.
 */
export function drawHumanoid(
  ctx: CanvasRenderingContext2D,
  body: CharacterBodyFrame,
  config: HumanoidConfig,
  state: HumanoidVisualState,
  tick: number,
  options?: CharacterDrawOptions,
): void {
  const scale = Math.max(
    0.05,
    Math.min(body.width / HUMANOID_BASE_WIDTH, body.height / HUMANOID_BASE_HEIGHT),
  );
  const breathScale = breathe(tick, config.breath);
  const palette = config.palette;

  const target = state.armTarget ?? options?.lookTarget;
  const localTarget: Vec2 | undefined = target
    ? {
        x: ((target.x - (body.x + body.width / 2)) / scale) * body.facing,
        y: (target.y - (body.y + body.height)) / scale,
      }
    : undefined;

  const pose = composePose(state, config, localTarget);

  // Depth-modulated half-width profiles. Near = thicker + brighter, far =
  // thinner + slightly darker, layered on the palette slot each limb uses.
  const farLegWidths = [
    HUMANOID_THIGH_HALF_WIDTH * HUMANOID_FAR_WIDTH_GAIN,
    HUMANOID_KNEE_HALF_WIDTH * HUMANOID_FAR_WIDTH_GAIN,
    HUMANOID_SHIN_HALF_WIDTH * HUMANOID_FAR_WIDTH_GAIN,
    HUMANOID_TOE_HALF_WIDTH * HUMANOID_FAR_WIDTH_GAIN,
  ] as const;
  const farArmWidths = [
    HUMANOID_UPPER_ARM_HALF_WIDTH * HUMANOID_FAR_WIDTH_GAIN,
    HUMANOID_ELBOW_HALF_WIDTH * HUMANOID_FAR_WIDTH_GAIN,
    HUMANOID_HAND_HALF_WIDTH * HUMANOID_FAR_WIDTH_GAIN,
  ] as const;
  const nearLegWidths = [
    HUMANOID_THIGH_HALF_WIDTH * HUMANOID_NEAR_WIDTH_GAIN,
    HUMANOID_KNEE_HALF_WIDTH * HUMANOID_NEAR_WIDTH_GAIN,
    HUMANOID_SHIN_HALF_WIDTH * HUMANOID_NEAR_WIDTH_GAIN,
    HUMANOID_TOE_HALF_WIDTH * HUMANOID_NEAR_WIDTH_GAIN,
  ] as const;
  const nearArmWidths = [
    HUMANOID_UPPER_ARM_HALF_WIDTH * HUMANOID_NEAR_WIDTH_GAIN,
    HUMANOID_ELBOW_HALF_WIDTH * HUMANOID_NEAR_WIDTH_GAIN,
    HUMANOID_HAND_HALF_WIDTH * HUMANOID_NEAR_WIDTH_GAIN,
  ] as const;

  const farPaint: Paint = {
    fill: shade(palette.base, HUMANOID_FAR_SHADE),
    outline: palette.outline,
  };
  const nearLegPaint: Paint = {
    fill: shade(palette.accent, HUMANOID_NEAR_SHADE),
    outline: palette.outline,
  };
  const nearArmPaint: Paint = {
    fill: shade(palette.feature, HUMANOID_NEAR_SHADE),
    outline: palette.outline,
  };

  ctx.save();
  ctx.translate(body.x + body.width / 2, body.y + body.height);
  ctx.scale(body.facing * scale, scale);

  // Pass 1: far leg (recedes behind the torso).
  drawLegLimb(ctx, pose.farLeg, farLegWidths, farPaint, HUMANOID_FOOT_TOE_OUTSET);

  // Pass 2: far arm (partly occluded by the torso mass).
  drawArmLimb(ctx, pose.farArm, farArmWidths, farPaint);

  // Pass 3: torso + pelvis mass. Breathing is a render-time scale around the
  // torso centre; it never feeds back into pose geometry.
  drawTorso(ctx, pose, breathScale, {
    fill: palette.base,
    outline: palette.outline,
  });

  // Pass 4: near leg (stronger read, drawn over the torso).
  drawLegLimb(ctx, pose.nearLeg, nearLegWidths, nearLegPaint, HUMANOID_FOOT_TOE_OUTSET);

  // Pass 5: near arm (most exposed).
  drawArmLimb(ctx, pose.nearArm, nearArmWidths, nearArmPaint);

  // Pass 6: head, face, and head treatment (drawn last).
  drawHead(
    ctx,
    pose,
    config,
    palette.accent,
    palette.feature,
    palette.outline,
  );

  ctx.restore();
}
