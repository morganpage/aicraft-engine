/**
 * Enemy and projectile renderer helpers (renderer-adjacent layer).
 *
 * Draws enemies with per-archetype visual treatment (spinny enemies rotate,
 * turret enemies show a direction indicator, spider enemies draw procedural
 * legs and body segments) and projectiles as small outlined rects. Touches
 * only the `CanvasRenderingContext2D` passed in by the caller — no global
 * state, no DOM reads.
 *
 * Uses `Math.sin` / `Math.cos` for rotation — these are renderer-adjacent
 * visual transforms, not simulation logic, so trigonometric functions are
 * acceptable here (same policy as `src/animation/oscillators.ts`).
 *
 * @module
 */

import type { CompiledEnemy, ProjectileState } from './types';
import { outlineRect, DEFAULT_OUTLINE_COLOR } from '../../primitives/outline-rect';
import type { SpiderState, SpiderPalette } from '../../animation/spider/spider-state';
import type { SpiderConfig } from '../../animation/spider/types';
import { createSpiderState } from '../../animation/spider/spider-state';
import { splitSpiderConfig, DEFAULT_SPIDER, DEFAULT_SPIDER_PALETTE } from '../../animation/spider/types';
import { evaluateSpiderPose, drawSpider } from '../../animation/spider/spider';
import {
  DEFAULT_CHARGER_PALETTE,
  drawCharger,
} from './archetypes/charger';

/**
 * Default enemy body width (px) for drawing.
 */
const ENEMY_SIZE = 16;
/**
 * Half enemy size — used for rotation center offset.
 */
const HALF_SIZE = ENEMY_SIZE / 2;
/**
 * Spinny angular speed in radians per tick. Full rotation every ~120 ticks (~2s at 60fps).
 */
const SPINNY_ANGULAR_SPEED = Math.PI * 2 / 120;
/**
 * Sawblade body radius (px) — the central disc.
 */
const SAWBLADE_BODY_RADIUS = 5;
/**
 * Sawblade spike count — triangular teeth around the edge.
 */
const SAWBLADE_SPIKE_COUNT = 8;
/**
 * Sawblade spike tip radius (px) — how far the spikes extend from center.
 */
const SAWBLADE_SPIKE_TIP_RADIUS = HALF_SIZE;
/**
 * Sawblade spike half-width at the base (px) — angular width of each tooth.
 */
const SAWBLADE_SPIKE_BASE_HALF_ANGLE = Math.PI / SAWBLADE_SPIKE_COUNT * 0.4;
/**
 * Turret direction-indicator length in px.
 */
const TURRET_INDICATOR_LENGTH = 10;

/**
 * Color palette for enemy rendering. All hex strings.
 */
export interface EnemyPalette {
  /** Spinny enemy fill color. */
  readonly spinny?: string;
  /** Turret enemy fill color. */
  readonly turret?: string;
  /** Charger body fill color. */
  readonly charger?: string;
  /** Default fill for unknown archetypes. */
  readonly default?: string;
  /** Direction indicator color for turrets. */
  readonly indicator?: string;
  /** Projectile fill color. */
  readonly projectile?: string;
}

/**
 * Default enemy palette.
 */
const DEFAULT_ENEMY_PALETTE: Readonly<EnemyPalette> = {
  spinny: '#ff3a3a',
  turret: '#ff6a00',
  charger: DEFAULT_CHARGER_PALETTE.body,
  default: '#ff3a3a',
  indicator: '#ffffff',
  projectile: '#ffaa00',
};

/**
 * Draw all enemies with per-archetype visual treatment.
 *
 * - **Spinny enemies**: rotate around their center by `tick * angularSpeed`.
 *   The rotation is visual-only (save/restore) and does not affect the
 *   enemy's logical position.
 * - **Turret enemies**: drawn with a direction indicator line showing the
 *   `aimDirection` from their params (defaults to right).
 * - **Spider enemies**: procedural legs, segmented body (cephalothorax +
 *   abdomen), eyes, chelicerae, pedipalps, and seeded jitter outline.
 *   Reads `state.data.spider` for the deterministic gait state; lazily
 *   initialises on first render if missing (legacy/external state).
 * - **Unknown archetypes**: drawn as a static outlined rect (same as the
 *   default entity renderer).
 *
 * Dead enemies (`state.alive === false`) are silently skipped.
 *
 * Touches only the passed `ctx`. Never throws.
 *
 * @param ctx - the canvas 2D context (caller owns transform/state)
 * @param enemies - the compiled enemies to draw
 * @param tick - current render tick (drives spinny rotation)
 * @param palette - optional color overrides
 */
export function drawEnemies(
  ctx: CanvasRenderingContext2D,
  enemies: readonly CompiledEnemy[],
  tick: number,
  palette?: EnemyPalette,
): void {
  const pal: EnemyPalette = { ...DEFAULT_ENEMY_PALETTE, ...(palette ?? {}) };

  for (const enemy of enemies) {
    if (!enemy || !enemy.state.alive) continue;

    const { x, y } = enemy.state;
    const w = ENEMY_SIZE;
    const h = ENEMY_SIZE;
    const fill = pal[enemy.archetype as keyof EnemyPalette] ?? pal.default ?? '#ff3a3a';

    if (enemy.archetype === 'spinny') {
      // Sawblade: circle body + triangular spikes, rotated by spinAngle.
      // Prefer the deterministic spinAngle stored by spinnyBehavior; fall
      // back to a direction-aware formula for legacy/external states that
      // lack it. The fallback multiplies by `facing` so left-facing spinners
      // rotate in the opposite visual direction (the old formula was
      // always-positive regardless of movement direction).
      const cx = x + HALF_SIZE;
      const cy = y + HALF_SIZE;
      const storedAngle = enemy.state.data.spinAngle;
      const rotation = typeof storedAngle === 'number' && Number.isFinite(storedAngle)
        ? storedAngle
        : tick * SPINNY_ANGULAR_SPEED * enemy.state.facing;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotation);

      // Draw sawblade path: alternating spike tips and valley arcs.
      ctx.beginPath();
      for (let i = 0; i < SAWBLADE_SPIKE_COUNT; i++) {
        const baseAngle = (i / SAWBLADE_SPIKE_COUNT) * Math.PI * 2;
        // Spike tip: narrow triangle pointing outward.
        const tipAngle = baseAngle;
        const tipX = Math.cos(tipAngle) * SAWBLADE_SPIKE_TIP_RADIUS;
        const tipY = Math.sin(tipAngle) * SAWBLADE_SPIKE_TIP_RADIUS;
        // Left base of spike (on the body circle).
        const leftAngle = baseAngle - SAWBLADE_SPIKE_BASE_HALF_ANGLE;
        const leftX = Math.cos(leftAngle) * SAWBLADE_BODY_RADIUS;
        const leftY = Math.sin(leftAngle) * SAWBLADE_BODY_RADIUS;
        // Right base of spike (on the body circle).
        const rightAngle = baseAngle + SAWBLADE_SPIKE_BASE_HALF_ANGLE;
        const rightX = Math.cos(rightAngle) * SAWBLADE_BODY_RADIUS;
        const rightY = Math.sin(rightAngle) * SAWBLADE_BODY_RADIUS;

        if (i === 0) {
          ctx.moveTo(leftX, leftY);
        } else {
          ctx.lineTo(leftX, leftY);
        }
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(rightX, rightY);
        // Arc along the body circle to the next spike's left base.
        const nextLeftAngle = ((i + 1) / SAWBLADE_SPIKE_COUNT) * Math.PI * 2 - SAWBLADE_SPIKE_BASE_HALF_ANGLE;
        ctx.arc(0, 0, SAWBLADE_BODY_RADIUS, rightAngle, nextLeftAngle, false);
      }
      ctx.closePath();

      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = DEFAULT_OUTLINE_COLOR;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.restore();
    } else if (enemy.archetype === 'turret') {
      // Draw the body.
      outlineRect(ctx, x, y, w, h, fill, DEFAULT_OUTLINE_COLOR);
      // Draw a direction indicator line from center.
      // Use shootTo direction when present; fall back to aimDirection.
      // Uses Number.isFinite (not || 0) to preserve zero components.
      const params = enemy.params;
      let indDirX = 1;
      let indDirY = 0;
      const shootTo = params.shootTo;
      if (shootTo && typeof shootTo === 'object') {
        const stx = Number((shootTo as Record<string, unknown>).x);
        const sty = Number((shootTo as Record<string, unknown>).y);
        if (Number.isFinite(stx) && Number.isFinite(sty)) {
          const mag = Math.hypot(stx, sty);
          if (mag > 0) {
            indDirX = stx / mag;
            indDirY = sty / mag;
          }
        }
      }
      if (!shootTo || (typeof shootTo === 'object' && Math.hypot(
        Number((shootTo as Record<string, unknown>).x) || 0,
        Number((shootTo as Record<string, unknown>).y) || 0,
      ) === 0)) {
        // No shootTo or zero-length shootTo — use aimDirection
        const aimDir = params.aimDirection && typeof params.aimDirection === 'object'
          ? params.aimDirection as { x?: number; y?: number }
          : { x: 1, y: 0 };
        const rawX = Number(aimDir.x);
        const rawY = Number(aimDir.y);
        const dirX = Number.isFinite(rawX) ? rawX : 1;
        const dirY = Number.isFinite(rawY) ? rawY : 0;
        const len = Math.hypot(dirX, dirY) || 1;
        indDirX = dirX / len;
        indDirY = dirY / len;
      }
      const cx = x + HALF_SIZE;
      const cy = y + HALF_SIZE;
      ctx.strokeStyle = pal.indicator ?? '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + indDirX * TURRET_INDICATOR_LENGTH, cy + indDirY * TURRET_INDICATOR_LENGTH);
      ctx.stroke();
    } else if (enemy.archetype === 'charger') {
      drawCharger(ctx, enemy.state, {
        ...DEFAULT_CHARGER_PALETTE,
        body: pal.charger ?? DEFAULT_CHARGER_PALETTE.body,
      });
    } else if (enemy.archetype === 'spider') {
      try {
        // Read or lazily-initialise spider state
        let spiderState = enemy.state.data.spider as SpiderState | undefined;
        if (!spiderState) {
          // Derive jitterSeed from initial x (same formula as spiderBehavior)
          const jitterSeed = (Math.abs(Math.floor(enemy.state.x)) * 2654435761) >>> 0;
          const bodyCX = enemy.state.x + HALF_SIZE;
          const bodyCY = enemy.state.y + HALF_SIZE;
          const cfg = buildSpiderVisualConfigFromParams(enemy.params);
          spiderState = createSpiderState(cfg, jitterSeed, bodyCX, bodyCY, enemy.state.facing);
        }

        const cfg = buildSpiderVisualConfigFromParams(enemy.params);
        const { visual } = splitSpiderConfig(cfg);
        const bodyCX = enemy.state.x + HALF_SIZE;
        const bodyCY = enemy.state.y + HALF_SIZE;
        const spiderTick = typeof enemy.state.data.tick === 'number' ? enemy.state.data.tick : tick;

        const pose = evaluateSpiderPose(
          spiderState,
          bodyCX,
          bodyCY,
          enemy.state.facing,
          enemy.state.vx,
          enemy.state.vy,
          spiderTick,
          visual,
        );
        drawSpider(ctx, pose, visual);
      } catch {
        // Fallback to outlined rect on any degenerate state
        outlineRect(ctx, x, y, w, h, fill, DEFAULT_OUTLINE_COLOR);
      }
    } else {
      // Unknown archetype — static outlined rect.
      outlineRect(ctx, x, y, w, h, fill, DEFAULT_OUTLINE_COLOR);
    }
  }
}

/**
 * Draw projectiles as small outlined rects.
 *
 * Dead projectiles (`alive === false`) are silently skipped. Touches only
 * the passed `ctx`. Never throws.
 *
 * @param ctx - the canvas 2D context (caller owns transform/state)
 * @param projectiles - the projectiles to draw
 * @param palette - optional color overrides (uses `projectile` field)
 */
export function drawProjectiles(
  ctx: CanvasRenderingContext2D,
  projectiles: readonly ProjectileState[],
  palette?: EnemyPalette,
): void {
  const pal: EnemyPalette = { ...DEFAULT_ENEMY_PALETTE, ...(palette ?? {}) };
  const fill = pal.projectile ?? '#ffaa00';

  for (const p of projectiles) {
    if (!p || !p.alive) continue;
    outlineRect(ctx, p.x, p.y, p.width, p.height, fill, DEFAULT_OUTLINE_COLOR);
  }
}

/**
 * Build a SpiderConfig from enemy params, merging palette overrides onto defaults.
 */
function buildSpiderVisualConfigFromParams(params: Record<string, unknown>): SpiderConfig {
  const paletteOverride = params.palette && typeof params.palette === 'object'
    ? { ...DEFAULT_SPIDER_PALETTE, ...(params.palette as Partial<SpiderPalette>) }
    : DEFAULT_SPIDER_PALETTE;
  return {
    ...DEFAULT_SPIDER,
    palette: paletteOverride,
  };
}
