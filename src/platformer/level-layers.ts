/** Ordered composition helper for a prepared themed level scene. @module */

import { applySnappedTranslate } from '../primitives/snap';
import type {
  LevelLayerRenderer,
  LevelRenderFrame,
  PreparedLevelScene,
} from './level-theme';

export interface DrawPreparedLevelFrameOptions {
  /** Additional world-space presentation offset, such as camera shake. */
  readonly worldOffset?: { readonly x: number; readonly y: number };
  /** Consumer-owned actors, runtime enemies, projectiles, or effects. */
  readonly drawWorld?: LevelLayerRenderer;
  /** Consumer-owned HUD, drawn in screen space after tint. */
  readonly drawHud?: LevelLayerRenderer;
}

export function drawPreparedLevelFrame(
  ctx: CanvasRenderingContext2D,
  scene: Readonly<PreparedLevelScene>,
  frame: Readonly<LevelRenderFrame>,
  options: Readonly<DrawPreparedLevelFrameOptions> = {},
): void {
  if (frame.level !== scene.level) {
    // Route through a prepared pass so its once-per-reference diagnostic fires.
    scene.drawBackground(ctx, frame);
    return;
  }
  scene.drawBackground(ctx, frame);
  ctx.save();
  try {
    const offset = options.worldOffset ?? { x: 0, y: 0 };
    applySnappedTranslate(
      ctx,
      -frame.view.x + offset.x,
      -frame.view.y + offset.y,
      frame.devicePixelRatio,
    );
    scene.drawTerrainTiles(ctx, frame);
    scene.drawTerrainRects(ctx, frame);
    scene.drawBackDecorations(ctx, frame);
    options.drawWorld?.(ctx, frame);
    scene.drawEntities(ctx, frame);
    scene.drawFrontDecorations(ctx, frame);
  } finally {
    ctx.restore();
  }
  scene.drawForeground(ctx, frame);
  scene.drawScreenTint(ctx, frame);
  options.drawHud?.(ctx, frame);
}
