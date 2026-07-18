import { outlineRect } from '../primitives/outline-rect';
import type { LocomotionPose } from './locomotion';

/**
 * Simple-feet renderer: two trigonometric foot rectangles driven by a
 * locomotion pose.
 *
 * This is the lightweight alternative to the full IK rig (`drawRig` +
 * `solveLimb`): characters that only need two static body-colored foot
 * rectangles bobbing via `evaluateLocomotion`'s sin/cos output can use
 * `drawSimpleFeet` instead. There is no IK, no joints, no bones — just
 * `outlineRect` / `fillRect` positioned by the locomotion pose. The foot-lock
 * is emergent: when the character stops moving, displacement-driven phase
 * integration freezes the phase, and the feet stay planted.
 *
 * Ported from Spitekeep's `render/devil-sprite.ts:1436-1469`.
 */

/**
 * Configuration for {@link drawSimpleFeet}. Matches Spitekeep's
 * `DEFAULT_DEVIL_DESIGN.legs` rect-style config. Every field is tunable; no
 * magic numbers in the renderer.
 */
export interface SimpleFeetConfig {
  /** Foot width in px. */
  readonly footW: number;
  /** Foot height in px. */
  readonly footH: number;
  /** Horizontal distance of each foot center from the body midline, in px. */
  readonly idleSpread: number;
  /** Vertical offset from the body origin to the feet baseline (positive = below). */
  readonly baseY: number;
  /** Fill color (`#rrggbb`). */
  readonly color: string;
  /** Outline color (`#rrggbb`). Omit for a bare fill (no outline — faster). */
  readonly outline?: string;
}

/**
 * Default config matching Spitekeep's devil character. Consumers spread this
 * and override `color` (and optionally `outline`) with their palette:
 * `{ ...DEFAULT_SIMPLE_FEET, color: palette.base, outline: palette.outline }`.
 */
export const DEFAULT_SIMPLE_FEET: Readonly<SimpleFeetConfig> = {
  footW: 7,
  footH: 5,
  idleSpread: 5.5,
  baseY: 14,
  color: '#FE5701',
  outline: '#1d1128',
};

/**
 * Draw two simple foot rectangles positioned by a locomotion pose.
 *
 * ⚠ **Facing-mirror requirement (the moonwalk trap).** The foot offsets in
 * `pose` are LOCAL-space — they assume the caller has ALREADY mirrored the
 * canvas around the body's vertical axis via `ctx.scale(facing, 1)` before
 * calling this function. If you translate to the body but forget the
 * facing-mirror scale, the character will moonwalk: their feet will swing in
 * LOCAL rightward phase while the body visually faces left, so the stride
 * reads as backwards. This is silent — no error, no warning, just a wrong-
 * looking walk. The canonical wrap is:
 *
 * ```ts
 * ctx.save();
 * ctx.translate(bodyCx, bodyBottomY);
 * ctx.scale(facing, 1);            // facing: +1 right, -1 left
 * drawSimpleFeet(ctx, pose, { ...DEFAULT_SIMPLE_FEET, color: palette.base });
 * ctx.restore();
 * ```
 *
 * (The same mirror requirement applies to any body geometry you draw inside
 * the same save/restore block.) See also `evaluateLocomotion` and
 * `advanceLocomotionByDisplacement` in `./locomotion.ts` — both produce /
 * consume LOCAL-space offsets and have matching warnings.
 *
 * Draws in BODY-LOCAL coordinates — the canvas is assumed to be already
 * translated to the body's screen position and scaled by facing. The caller
 * handles the world-space transform (`ctx.translate(bodyX, bodyY);
 * ctx.scale(facing, 1)`); this function draws relative to the body origin.
 *
 * The feet are positioned at:
 *   - left foot:  `(-idleSpread - footW/2 + pose.leftFootOffset.x,
 *                   baseY       - pose.leftFootOffset.y)`
 *   - right foot: `(+idleSpread - footW/2 + pose.rightFootOffset.x,
 *                   baseY       - pose.rightFootOffset.y)`
 *
 * Positions are rounded to integers via `Math.round` (pixel-grid alignment).
 *
 * If `config.outline` is provided, uses {@link outlineRect} (1px outline,
 * pixel-grid snapped). Otherwise uses bare `ctx.fillRect` (no outline —
 * faster, matches Spitekeep's `outlineFeet: false` option).
 *
 * @param ctx    - canvas 2D context (caller owns transform/state)
 * @param pose   - locomotion pose from `evaluateLocomotion`
 * @param config - foot rendering config (size, color, spread, outline)
 *
 * @example
 * ```ts
 * const pose = evaluateLocomotion(loco, DEFAULT_GAIT);
 * ctx.save();
 * ctx.translate(bodyX, bodyY);
 * ctx.scale(facing, 1);
 * drawSimpleFeet(ctx, pose, { ...DEFAULT_SIMPLE_FEET, color: palette.base });
 * ctx.restore();
 * ```
 */
export function drawSimpleFeet(
  ctx: CanvasRenderingContext2D,
  pose: LocomotionPose,
  config: SimpleFeetConfig,
): void {
  const halfFootW = config.footW / 2;
  const leftX = Math.round(-config.idleSpread - halfFootW + pose.leftFootOffset.x);
  const leftY = Math.round(config.baseY - pose.leftFootOffset.y);
  const rightX = Math.round(config.idleSpread - halfFootW + pose.rightFootOffset.x);
  const rightY = Math.round(config.baseY - pose.rightFootOffset.y);

  if (config.outline) {
    outlineRect(ctx, leftX, leftY, config.footW, config.footH, config.color, config.outline);
    outlineRect(ctx, rightX, rightY, config.footW, config.footH, config.color, config.outline);
  } else {
    ctx.fillStyle = config.color;
    ctx.fillRect(leftX, leftY, config.footW, config.footH);
    ctx.fillRect(rightX, rightY, config.footW, config.footH);
  }
}
