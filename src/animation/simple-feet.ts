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
  /**
   * Horizontal distance of each foot CENTER from the body midline at neutral
   * phase, in px.
   *
   * Controls the stance / crossing behavior of the gait. The foot CENTER at
   * phase φ is `∓idleSpread ± cos(φ) · strideLength` (left / right); the rect
   * corner that `drawSimpleFeet` actually draws is offset by `-footW/2` from
   * that center.
   *
   * - **`0`** — orbital crossing / IK-parity. Both feet center on the midline
   *   and orbit symmetrically via `cos(phase) · strideLength`. At each
   *   footfall endpoint (phase `0` and `π`) both feet have equal magnitude
   *   from the midline on opposite sides, swapping sides each half-cycle.
   *   This is the same foot-target trajectory as the full IK rig with
   *   co-located hips. See {@link IK_PARITY_FEET}.
   * - **`strideLength`** — feet just touch at the midline crossing; partial
   *   crossing gait.
   * - **default `5.5`** — wide stance; the stride amplitude never overcomes
   *   the spread, so the feet swing in parallel arcs and never cross.
   *
   * Values between `0` and `strideLength` produce partial crossing; values
   * greater than `strideLength` produce a parallel-arc "waddle" with no
   * crossing.
   */
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
 * IK-parity orbital-gait preset: {@link DEFAULT_SIMPLE_FEET} with
 * {@link SimpleFeetConfig.idleSpread} overridden to `0`.
 *
 * With `idleSpread: 0`, both feet center on the body midline and the
 * locomotion pose's `cos(phase) · strideLength` term drives them symmetrically
 * across it. At each footfall endpoint (phase `0` and `π`), both feet have
 * equal magnitude from the midline on opposite sides:
 *
 * ```
 * leftCenter  = cos(φ) · strideLength
 * rightCenter = -cos(φ) · strideLength
 * ```
 *
 * - Phase `0`:    left at `+strideLength`, right at `-strideLength` (sides swapped).
 * - Phase `π/2`:  both feet at `0` (midline crossing / overlap).
 * - Phase `π`:    left at `-strideLength`, right at `+strideLength` (sides swapped back).
 *
 * This is the same foot-target trajectory the full IK rig produces when both
 * hips are co-located on the body midline (the canonical slime-knight setup),
 * without requiring bones or a solver. Use this preset to mimic the IK
 * version's silhouette with the cheap two-rect renderer.
 *
 * Consumers spread this and override palette / size fields:
 *
 * ```ts
 * drawSimpleFeet(ctx, pose, {
 *   ...IK_PARITY_FEET,
 *   footW: 5, footH: 4, baseY: -3,
 *   color: shade(palette.base, 0.65), outline: palette.outline,
 * });
 * ```
 *
 * See also the "Orbital gait" section on {@link drawSimpleFeet}.
 */
export const IK_PARITY_FEET: Readonly<SimpleFeetConfig> = {
  ...DEFAULT_SIMPLE_FEET,
  idleSpread: 0,
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
 * **Orbital gait.** The foot CENTER positions are
 * `∓idleSpread ± cos(phase) · strideLength` (left / right). At
 * {@link IK_PARITY_FEET} (`idleSpread: 0`), both feet center on the midline
 * and the stride term drives them symmetrically across it: at each footfall
 * endpoint both feet have equal magnitude (`strideLength`) from the midline
 * on opposite sides, swapping sides each half-cycle, and they cross at the
 * midline every half-cycle. This is IK-parity without bones. With the default
 * `idleSpread: 5.5`, the spread exceeds the stride amplitude and the feet
 * swing in parallel arcs without crossing (wide stance). Values between `0`
 * and `strideLength` produce partial crossing. See
 * {@link SimpleFeetConfig.idleSpread} for the full formula.
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
