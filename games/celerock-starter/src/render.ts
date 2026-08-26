/**
 * The render frame (§5.4). This shape is load-bearing for every later stage.
 *
 *   screen space  — letterbox bars + clip to the room aperture
 *   ONE composeCameraTransform
 *   world space   — tiles, entities, the player, particles, ALL of it, in raw
 *                   world coordinates with no second offset anywhere
 *   restore       — back to screen space for HUD, menus, cards
 *
 * The failure this prevents: a world layer drawn before the transform is pinned
 * to the screen; a layer given its own `+ offsetX` on top of the transform moves
 * at double the camera offset. Both are reported as "the camera is broken" and
 * neither is (§12.8, §13 gate 12).
 */
import {
  applyCameraLetterbox,
  cameraTransform,
  composeCameraTransform,
} from 'aicraft-engine';
import type { Game } from './types';

const LETTERBOX_FILL = '#05070a';

export function renderGame(game: Game): void {
  const { ctx } = game;
  ctx.imageSmoothingEnabled = false;

  // Device space: clear the whole backing store.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = LETTERBOX_FILL;
  ctx.fillRect(0, 0, game.canvas.width, game.canvas.height);

  ctx.save(); // [0] DPR scale — CSS-PIXEL SPACE FROM HERE
  ctx.scale(game.dpr, game.dpr);
  // Everything below works in CSS units, which is what `viewport` is measured
  // in (`canvasCssViewport`). Skip this scale and every world unit renders at
  // 1/dpr — invisibly correct at dpr 1, half-size on a Retina display (§5.4).

  const t = cameraTransform(game.brain.camera, game.viewport, {
    zoom: game.brain.zoom,
    devicePixelRatio: game.dpr,
  });

  ctx.save(); // [1] letterbox clip scope
  // §5.4 — the aperture is ONE ROOM. Bars outside it, clip to it, every frame.
  applyCameraLetterbox(ctx, game.active, game.viewport, t, { fill: LETTERBOX_FILL });

  ctx.save(); // [2] world scope
  composeCameraTransform(ctx, t); // ◀── WORLD SPACE FROM HERE

  game.painter.draw(ctx, game.active.ldtkLevel, {});

  // Stage 1 graybox. Stage 2 REPLACES this with the Player.png sprite — there
  // is intentionally no "procedural player, then swap to sprite" phase.
  const c = game.player.core;
  ctx.fillStyle = '#7fe3d0';
  ctx.fillRect(Math.round(c.x), Math.round(c.y), Math.round(c.width), Math.round(c.height));

  // Every world layer you add — entities, particles, the sprite — goes HERE,
  // before the restore, in raw world coordinates.

  ctx.restore(); // [2] ◀── CSS-PIXEL SCREEN SPACE AGAIN (HUD, menus, cards)
  ctx.restore(); // [1] letterbox clip scope
  ctx.restore(); // [0] DPR scale
}
