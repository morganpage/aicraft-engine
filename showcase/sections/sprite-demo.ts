/**
 * Sprite animation showcase — a playable 1-bit platformer whose player and
 * enemies are all drawn from a single Kenney sprite sheet.
 *
 * Proves the `src/sprites/` pipeline end-to-end: one `.json` + one `.png`
 * defines the whole cast (player + two enemy types), the deterministic
 * frame-player drives every animation, and the same `deriveSpriteAnimKind`
 * primitive selects clips for both the player (from `PlatformerState.core`)
 * and the patrolling enemies. Render is pure `drawSprite` blits — the
 * procedural character pipeline (`drawHumanoid`) is untouched, so this scene
 * and a procgen scene could coexist in one game.
 *
 * Loop/sim pattern mirrors `sections/hero.ts`; image load mirrors
 * `sections/parallax.ts`; input edges mirror `sections/playground.ts`.
 */

import {
  stepPlatformer,
  createPlatformerState,
  DEFAULT_PLATFORMER_CONFIG,
  type PlatformerInput,
} from '../../src/platformer';
import {
  createEdgeAccumulator,
  pressEdge,
  releaseEdge,
  pollEdge,
} from '../../src/input';
import type { Solid } from '../../src/collision';
import { createGameLoop, type GameLoop } from '../../src/game-loop';
import {
  parseSpriteSheet,
  compileSpriteSheet,
  resolveAnim,
  createSpriteAnimState,
  advanceSpriteAnim,
  currentFrameIndex,
  drawSprite,
  deriveSpriteAnimKind,
  createSpriteTintCache,
  type CompiledSpriteSheet,
  type SpriteAnimState,
} from '../../src/sprites';
import { shouldAnimate } from '../helpers/motion-gate';
import { resizeCanvasToBackingStore } from '../../src/primitives';
import type { Store } from '../store';
import type { GlobalState } from '../main';

// Vite imports JSON as a parsed object and PNG as a URL string. The sprite
// parser takes a JSON string, so we re-stringify the imported object. Both
// assets live in the canonical `assets/` tree (single source of truth); Vite
// resolves the relative path outside the showcase root, same as `../../src/*`.
import sheetJsonObject from '../../assets/sprites/samples/kenney-1bit.json';
import sheetPngUrl from '../../assets/vendor/kenney-1-bit-platformer/Tilemap/monochrome_tilemap_transparent_packed.png';

// --- Constants ------------------------------------------------------------

/** Logical canvas resolution (CSS pixels). */
const VIEW_W = 480;
const VIEW_H = 270;
const SCALE = 3; // 16px source sprite → 48px on screen
const GRAVITY_DIR = 1 as const;
const PLAYER_W = 16;
const PLAYER_H = 24;

// Distinct tints so player and the two enemy types read apart against the
// 1-bit white ink. (The sheet's art is shared; only the tint differs.)
const TINT_PLAYER = '#9ad0ff';
const TINT_SLIME = '#7dffa6';
const TINT_WALKER = '#ff9ad0';

// --- Types ----------------------------------------------------------------

/** A patrolling enemy with its own animation clock. */
interface Enemy {
  x: number;
  y: number;
  vx: number;
  facing: 1 | -1;
  minX: number;
  maxX: number;
  character: 'slime' | 'walker';
  animState: SpriteAnimState;
}

// --- Section entry point --------------------------------------------------

export function initSpriteDemo(root: HTMLElement, _store: Store<GlobalState>): void {
  const canvas = root.querySelector<HTMLCanvasElement>('canvas.sprite-demo');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  void (async (): Promise<void> => {
    // 1. Load + parse the sprite-sheet definition; decode the PNG.
    const jsonText = JSON.stringify(sheetJsonObject);
    const parsed = parseSpriteSheet(jsonText);
    if (!parsed.ok || !parsed.sheet) {
      console.error('[sprite-demo] sheet parse failed', parsed.errors);
      return;
    }
    const compiled = compileSpriteSheet(parsed.sheet).sheet;
    const image = await decodeImage(sheetPngUrl);
    const tintCache = createSpriteTintCache();

    // 2. Hand-authored stage: ground + three platforms.
    const solids: Solid[] = [
      { x: 0, y: VIEW_H - 24, width: VIEW_W, height: 24 },
      { x: 70, y: VIEW_H - 88, width: 110, height: 14 },
      { x: 260, y: VIEW_H - 128, width: 130, height: 14 },
      { x: 120, y: VIEW_H - 180, width: 90, height: 14 },
    ];

    // 3. Player + enemies.
    let player = createPlatformerState(30, VIEW_H - 24 - PLAYER_H, DEFAULT_PLATFORMER_CONFIG, PLAYER_W, PLAYER_H);
    let playerAnim = createSpriteAnimState();

    const enemies: Enemy[] = [
      {
        x: 90,
        y: VIEW_H - 24 - 16,
        vx: -22,
        facing: -1,
        minX: 16,
        maxX: 170,
        character: 'slime',
        animState: createSpriteAnimState(),
      },
      {
        x: 280,
        y: VIEW_H - 24 - 16,
        vx: -38,
        facing: -1,
        minX: 200,
        maxX: VIEW_W - 24,
        character: 'walker',
        animState: createSpriteAnimState(),
      },
    ];

    // 4. Input edges (keyboard). `createEdgeAccumulator` is the DOM-free core;
    //    we feed press/release events from window keydown/keyup.
    const left = createEdgeAccumulator();
    const right = createEdgeAccumulator();
    const jump = createEdgeAccumulator();
    const onKey = (e: KeyboardEvent, isDown: boolean): void => {
      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
          isDown ? pressEdge(left) : releaseEdge(left);
          e.preventDefault();
          break;
        case 'ArrowRight':
        case 'KeyD':
          isDown ? pressEdge(right) : releaseEdge(right);
          e.preventDefault();
          break;
        case 'Space':
        case 'ArrowUp':
        case 'KeyW':
        case 'KeyZ':
          if (!e.repeat) {
            isDown ? pressEdge(jump) : releaseEdge(jump);
          }
          e.preventDefault();
          break;
      }
    };
    const keydown = (e: KeyboardEvent): void => onKey(e, true);
    const keyup = (e: KeyboardEvent): void => onKey(e, false);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);

    // 5. Render — a named function so it can be called both by the loop and
    //    for the initial paint (the GameLoop contract has no public render()).
    const render = (): void => {
      // Assigning the backing-store size RESETS the context transform, so the
      // DPR scale has to be re-applied every frame — without it the whole
      // scene draws into the top-left 1/dpr of the canvas on a HiDPI display.
      const dpr = resizeCanvasToBackingStore(canvas, VIEW_W, VIEW_H);
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#0b0d12';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);

      // Stage platforms.
      ctx.fillStyle = '#1b2030';
      ctx.strokeStyle = '#3a4258';
      ctx.lineWidth = 1;
      for (const s of solids) {
        ctx.fillRect(s.x, s.y, s.width, s.height);
        ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.width - 1, s.height - 1);
      }

      // Enemies (always use their walk clip while patrolling).
      for (const e of enemies) {
        const tint = e.character === 'slime' ? TINT_SLIME : TINT_WALKER;
        drawCharacter(ctx, image, compiled, tintCache, e.character, 'walk', e.animState, e.x, e.y, e.facing, tint, 16);
      }

      // Player: pick the clip from physics, then draw.
      const kind = deriveSpriteAnimKind({
        supported: player.core.onGround,
        speedX: player.core.vx,
        velocityY: player.core.vy,
        gravityDir: GRAVITY_DIR,
      });
      drawCharacter(
        ctx,
        image,
        compiled,
        tintCache,
        'player',
        kind,
        playerAnim,
        player.core.x,
        player.core.y,
        player.core.facing,
        TINT_PLAYER,
        PLAYER_H,
      );
    };

    // 6. Fixed-step loop: step sim, then render.
    const loop: GameLoop = createGameLoop({
      fixedDt: 1 / 60,
      maxFrameDelta: 1 / 6,
      step: (dt) => {
        const moveX: -1 | 0 | 1 = right.held ? 1 : left.held ? -1 : 0;
        const input: PlatformerInput = {
          moveX,
          jump: pollEdge(jump),
          dash: null,
        };
        player = stepPlatformer(player, input, solids, dt, DEFAULT_PLATFORMER_CONFIG).state;
        playerAnim = advanceSpriteAnim(playerAnim, dt * 1000);

        for (const e of enemies) {
          e.x += e.vx * dt;
          if (e.x <= e.minX) {
            e.x = e.minX;
            e.vx = Math.abs(e.vx);
            e.facing = 1;
          } else if (e.x >= e.maxX) {
            e.x = e.maxX;
            e.vx = -Math.abs(e.vx);
            e.facing = -1;
          }
          e.animState = advanceSpriteAnim(e.animState, dt * 1000);
        }
      },
      render,
    });

    // Initial paint, then start the loop. `shouldAnimate()` returns true when
    // the user prefers reduced motion — in that case the single render() above
    // is the static frame and the loop is NOT started (mirrors hero/parallax).
    render();
    if (shouldAnimate()) return;
    loop.start();
  })().catch((e) => console.error('[sprite-demo] init failed', e));
}

// --- Drawing --------------------------------------------------------------

/**
 * Blit one sprite frame for a character/anim. The sprite source is square
 * (16px); `bodyHeight` is the sim body's height so we anchor the sprite's
 * bottom to the body's bottom (correct grounded contact for tall bodies).
 */
function drawCharacter(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sheet: CompiledSpriteSheet,
  tintCache: ReturnType<typeof createSpriteTintCache>,
  character: string,
  animKey: string,
  animState: SpriteAnimState,
  x: number,
  y: number,
  facing: 1 | -1,
  tint: string,
  bodyHeight: number,
): void {
  const anim = resolveAnim(sheet, character, animKey);
  if (!anim) return;
  const slot = currentFrameIndex(animState, anim);
  if (slot === undefined) return;
  const frameIndex = anim.frameIndices[slot];
  if (frameIndex === undefined) return;
  const srcRect = sheet.frames[frameIndex];
  if (!srcRect) return;
  const destW = srcRect.width * SCALE;
  const destH = srcRect.height * SCALE;
  // Anchor sprite bottom to body bottom.
  drawSprite(ctx, image, sheet, frameIndex, x, y + bodyHeight - destH, {
    facing,
    tint,
    tintCache,
    destWidth: destW,
    destHeight: destH,
  });
}

// --- Image decode (mirrors sections/parallax.ts:316) ---------------------

function decodeImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img);
}
