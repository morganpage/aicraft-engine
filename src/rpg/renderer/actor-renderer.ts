/**
 * Top-down actor rendering: the four-direction player and standing NPCs.
 * Walk poses are displacement-driven bob/steps keyed to the presentation
 * tick; under reduced motion the actor renders static.
 */

import { prefersReducedMotion } from '../../primitives/motion';
import type { RpgVisualTheme } from './theme';
import { DEFAULT_RPG_THEME } from './theme';

export type RpgActorFacing = 'up' | 'down' | 'left' | 'right';

export interface RpgActorDrawOptions {
  readonly x: number;
  readonly y: number;
  /** Body width in pixels; height derives from it. */
  readonly size: number;
  readonly facing: RpgActorFacing;
  readonly moving: boolean;
  readonly tick: number;
  readonly body: string;
  readonly outline: string;
  readonly theme?: RpgVisualTheme;
}

/** Draw one top-down actor with a direction indicator and walk bob. */
export function drawRpgActor(
  ctx: CanvasRenderingContext2D,
  options: RpgActorDrawOptions,
): void {
  const theme = options.theme ?? DEFAULT_RPG_THEME;
  const reduced = prefersReducedMotion();
  const bob = !reduced && options.moving && Math.floor(options.tick / 4) % 2 === 0 ? 1 : 0;
  const bodyW = options.size;
  const bodyH = Math.round(options.size * 1.15);
  const x = Math.round(options.x);
  const y = Math.round(options.y - bob);

  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(options.x, options.y + bodyH * 0.62, bodyW * 0.42, bodyW * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body.
  ctx.fillStyle = options.outline;
  ctx.fillRect(x - bodyW / 2 - 1, y - bodyH / 2 - 1, bodyW + 2, bodyH + 2);
  ctx.fillStyle = options.body;
  ctx.fillRect(x - bodyW / 2, y - bodyH / 2, bodyW, bodyH);

  // Direction visor.
  ctx.fillStyle = theme.panels.background;
  const visor = Math.max(2, Math.round(bodyW * 0.16));
  switch (options.facing) {
    case 'up':
      ctx.fillRect(x - bodyW / 2 + 2, y - bodyH / 2 + 2, bodyW - 4, visor);
      break;
    case 'down':
      ctx.fillRect(x - bodyW / 2 + 2, y + bodyH / 2 - 2 - visor, bodyW - 4, visor);
      break;
    case 'left':
      ctx.fillRect(x - bodyW / 2 + 2, y - visor / 2, visor, visor * 2);
      break;
    case 'right':
      ctx.fillRect(x + bodyW / 2 - 2 - visor, y - visor / 2, visor, visor * 2);
      break;
  }

  // Walk feet.
  if (options.moving && !reduced) {
    const step = Math.floor(options.tick / 4) % 2 === 0 ? 1 : -1;
    ctx.fillStyle = options.outline;
    ctx.fillRect(x - bodyW / 2 + 1, y + bodyH / 2 - 3 + step, 3, 3);
    ctx.fillRect(x + bodyW / 2 - 4, y + bodyH / 2 - 3 - step, 3, 3);
  }
}

export interface RpgNpcDrawOptions {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly facing: RpgActorFacing;
  readonly tick: number;
  readonly theme?: RpgVisualTheme;
}

/** Draw a standing NPC using theme colors; NPCs do not walk in v1. */
export function drawRpgNpc(
  ctx: CanvasRenderingContext2D,
  options: RpgNpcDrawOptions,
): void {
  const theme = options.theme ?? DEFAULT_RPG_THEME;
  drawRpgActor(ctx, {
    x: options.x,
    y: options.y,
    size: options.size,
    facing: options.facing,
    moving: false,
    tick: options.tick,
    body: theme.actors.npcBody,
    outline: theme.actors.npcOutline,
    theme,
  });
}
