/**
 * Section 3 — Playable platformer playground.
 *
 * The "proof that the stack works" composite. A fully playable mini-platformer
 * on a 480×320 canvas that wires six library modules together:
 *   - `createGameLoop` drives a fixed-step (1/60 s) loop with the library's
 *     own defensive rAF adapter — the first showcase section to use the
 *     game-loop module rather than a hand-rolled rAF loop.
 *   - `createKeyboardAdapter` polls input EXACTLY once per fixed tick and
 *     drains pressed/released edges (no stuck keys, no auto-repeat).
 *   - `resolveAxisX` / `resolveAxisY` run per-axis move-and-resolve over the
 *     `Solid[]` level, including a one-way passthrough platform.
 *   - `createCamera` / `updateCamera` lerp + clamp the camera across the
 *     960×320 world (2× the viewport width — the camera follows).
 *   - `createHitStop` / `triggerHitStop` / `stepHitStop` / `isHitStopActive`
 *     freeze the simulation for a few ticks on a hard landing — the
 *     temporal-juice counterpart to squash & stretch.
 *   - `volumeScale` from `animation/squash-stretch` produces a volume-
 *     preserving (scaleX × scaleY === 1) squash on landing and decays back
 *     to neutral each tick.
 *
 * Plus three rendering primitives from `primitives/`:
 *   - `outlineRect` draws platforms + the character (flat fill + 1px outline).
 *   - `parallaxOffset` scrolls a starfield at 0.3× camera speed (demonstrates
 *     parallax).
 *   - `drawGlow` stamps a subtle additive glow under the character
 *     (demonstrates additive blending).
 *
 * Motion-gated: if the user prefers reduced motion, a single static frame is
 * rendered (character standing at spawn, camera at origin) and the loop is
 * never started. Matches the hero / lava-pool gate exactly.
 *
 * Local state: this section does NOT extend `GlobalState` — the playground
 * runs entirely on local game state (the player, camera, hit-stop). The
 * `store` parameter is accepted to match the section-init signature but is
 * intentionally unused (prefixed `_`).
 *
 * Page-scroll safety: arrow keys + Space scroll the page by default. A
 * `keydown` listener on `window` calls `preventDefault()` on those keys
 * ONLY when the playground section is in the viewport (tracked via an
 * IntersectionObserver). Scrolled out → page scrolls normally.
 */

import { createGameLoop, type GameLoop } from '../../src/game-loop';
import { createKeyboardAdapter, type KeyboardAdapter } from '../../src/input';
import {
  resolveAxisX,
  resolveAxisY,
  type Solid,
} from '../../src/collision';
import { createCamera, updateCamera, type Camera } from '../../src/camera';
import {
  createHitStop,
  triggerHitStop,
  stepHitStop,
  isHitStopActive,
  outlineRect,
  parallaxOffset,
  drawGlow,
} from '../../src/primitives';
import { volumeScale } from '../../src/animation/squash-stretch';
import { mulberry32 } from '../../src/rng';
import { shouldAnimate } from '../helpers/motion-gate';
import type { Store } from '../store';
import type { GlobalState } from '../main';

// --- World / viewport dimensions -------------------------------------------

/** Full world width. 2× viewport — the camera follows the player horizontally. */
const WORLD_W = 960;
/** Full world height. Same as the viewport — no vertical camera scroll. */
const WORLD_H = 320;
/** Viewport width. The canvas's intrinsic horizontal resolution. */
const VIEW_W = 480;
/** Viewport height. The canvas's intrinsic vertical resolution. */
const VIEW_H = 320;

// --- Level layout (world-space Solids) --------------------------------------

/**
 * Static collision surfaces. Defines the level geometry the player collides
 * against. Walls bound the world; the ground floor spans the full width;
 * floating platforms give jump targets; one passthrough platform exercises
 * the one-way-platform logic in `resolveAxisY`.
 */
const PLATFORMS: Solid[] = [
  // Ground floor (full width).
  { x: 0, y: 288, width: 960, height: 32 },
  // Left wall.
  { x: 0, y: 0, width: 16, height: 288 },
  // Right wall.
  { x: 944, y: 0, width: 16, height: 288 },
  // Floating platforms.
  { x: 160, y: 224, width: 96, height: 16 },
  { x: 320, y: 176, width: 80, height: 16 },
  { x: 640, y: 160, width: 96, height: 16 },
  { x: 800, y: 224, width: 80, height: 16 },
  // Passthrough platform (one-way — jump up through, land on top).
  { x: 480, y: 224, width: 96, height: 16, passthrough: true },
];

// --- Player -----------------------------------------------------------------

/** Player collision-box width (px). */
const PLAYER_W = 24;
/** Player collision-box height (px). */
const PLAYER_H = 32;
/** Spawn X (px from world origin). Inside the left wall, on the ground. */
const SPAWN_X = 48;
/** Spawn Y (px from world origin). Standing on the ground floor (288 − 32). */
const SPAWN_Y = 256;

/**
 * Player state. Mutable in place inside the fixed step; the player IS the
 * authoritative game state for this playground (no save/progression).
 *
 * `scaleX`/`scaleY` carry the squash/stretch deformation and decay back to
 * neutral (1, 1) each tick — same usage pattern as the hero's spring chain.
 */
interface Player {
  x: number;
  y: number;
  width: number;
  height: number;
  vx: number;
  vy: number;
  onGround: boolean;
  facing: 1 | -1;
  /** Horizontal scale factor (1 = neutral; >1 = stretched wide). */
  scaleX: number;
  /** Vertical scale factor (1 = neutral; >1 = stretched tall). */
  scaleY: number;
}

// --- Physics constants ------------------------------------------------------

/** Gravity acceleration (px/tick²). Downward. */
const GRAVITY = 0.5;
/** Ground horizontal speed (px/tick). */
const MOVE_SPEED = 3;
/** Air-control multiplier — air movement = AIR_CONTROL × MOVE_SPEED. */
const AIR_CONTROL = 0.5;
/** Jump launch velocity (px/tick). Negative = up (canvas y-down convention). */
const JUMP_VELOCITY = -9;
/** Terminal fall velocity (px/tick). Prevents unbounded acceleration. */
const MAX_FALL = 12;
/** Hit-stop freeze duration on a hard landing (ticks). */
const HIT_STOP_DURATION = 4;
/**
 * Minimum impact velocity (the |vy| captured BEFORE landing) that triggers a
 * hit-stop freeze. Soft landings (stepping off a low platform) don't freeze;
 * big falls do.
 */
const HIT_STOP_THRESHOLD = 6;
/** Per-tick decay factor for squash/stretch back toward (1, 1). */
const SQUASH_DECAY = 0.2;

// --- Palette ----------------------------------------------------------------

/** Background fill — cave-warm near-black (matches lava-pool for cohesion). */
const COLOR_BG = '#1a0d0a';
/** Solid-platform fill — dark earthy brown. */
const COLOR_PLATFORM = '#3a2418';
/** Passthrough-platform fill — slightly lighter brown for visual distinction. */
const COLOR_PLATFORM_PASSTHROUGH = '#4a3020';
/** Player fill — Spitekeep's bright devil orange. */
const COLOR_PLAYER = '#FE5701';
/** Parallax starfield dot fill. */
const COLOR_STAR = '#5a4a3a';

// --- Starfield --------------------------------------------------------------

/** Deterministic seed for the parallax starfield. Same value → same stars. */
const STAR_SEED = 1337;
/** Number of parallax dots. Enough to read as a starfield, not so many they
 *  distract from the gameplay silhouettes. */
const STAR_COUNT = 40;

/**
 * Pre-computed starfield positions in world space. Generated once at module
 * load with a seeded RNG so the starfield is identical across page loads
 * (deterministic dressing, not random clutter). Rendered at
 * `parallaxOffset(camera.x, camera.y, 0.3)` each frame.
 */
const STARS: ReadonlyArray<{ x: number; y: number; size: number }> = (() => {
  const rng = mulberry32(STAR_SEED);
  const out: { x: number; y: number; size: number }[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    out.push({
      x: rng() * WORLD_W,
      y: rng() * WORLD_H,
      size: rng() < 0.25 ? 2 : 1,
    });
  }
  return out;
})();

// --- Codes whose default action is suppressed while the playground is onscreen

/** Keyboard codes whose default page action (scroll / space-press button) we
 *  suppress so the player can play without scrolling the page. */
const SUPPRESSED_CODES: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'KeyR',
]);

/**
 * Initialize the playground section.
 *
 * Wires the keyboard adapter, game loop, and rendering pipeline. Returns
 * without starting the loop when reduced motion is preferred (a single
 * static frame is rendered instead). The section cleans up its listeners +
 * the loop on `dispose()` — currently never called by the showcase (the
 * page is single-mount) but defensive for future single-page-app use.
 *
 * @param container - the `<section id="playground">` element
 * @param _store - the global observable store. Intentionally unused — the
 *   playground has no shared-seed concept (the player is local game state,
 *   not generated cosmetics). Accepted only to match the section-init
 *   signature.
 */
export function initPlayground(
  container: HTMLElement,
  // Underscore-prefixed: TypeScript's `noUnusedParameters` exempts these.
  _store: Store<GlobalState>,
): void {
  const canvas = container.querySelector<HTMLCanvasElement>('.playground-canvas')!;
  const ctx = canvas.getContext('2d')!;

  // --- Local game state ----------------------------------------------------

  const player: Player = {
    x: SPAWN_X,
    y: SPAWN_Y,
    width: PLAYER_W,
    height: PLAYER_H,
    vx: 0,
    vy: 0,
    onGround: true,
    facing: 1,
    scaleX: 1,
    scaleY: 1,
  };

  let camera: Camera = createCamera();
  let hitStop = createHitStop();

  // --- Input adapter -------------------------------------------------------
  //
  // Poll EXACTLY once per fixed tick — input edges (pressed / released) are
  // drained per poll, so polling at the fixed-step rate keeps the edge window
  // at exactly one tick (no double-fire, no missed presses).
  const keyboard: KeyboardAdapter = createKeyboardAdapter({
    codeToAction: {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      Space: 'jump',
      KeyR: 'reset',
    },
  });

  // --- Render --------------------------------------------------------------

  /** Render the current state at the current camera position. Pure draw —
   *  no state mutation. Called once per render frame by the game loop. */
  const render = (): void => {
    // Clear with the background fill.
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // Camera transform — the world is drawn in world space and shifted so the
    // camera's top-left lands at the viewport's origin. Math.round keeps
    // outlines on the pixel grid (no fractional-pixel seams).
    ctx.save();
    ctx.translate(-Math.round(camera.x), -Math.round(camera.y));

    // Parallax starfield — scrolls at 0.3× the camera, so the stars lag the
    // gameplay layer. parallaxOffset returns the OPPOSITE-of-camera delta
    // (stars scroll left as the camera moves right); we add it on top of the
    // camera translate so the net factor is 0.3× the world scroll.
    const parallax = parallaxOffset(camera.x, camera.y, 0.3);
    ctx.translate(parallax.x, parallax.y);
    ctx.fillStyle = COLOR_STAR;
    for (const star of STARS) {
      ctx.fillRect(Math.floor(star.x), Math.floor(star.y), star.size, star.size);
    }
    // Undo the parallax translate before drawing the world-space gameplay
    // layer (the camera translate is still in effect — that one we keep).
    ctx.translate(-parallax.x, -parallax.y);

    // Platforms — solid vs passthrough get visually distinct fills so the
    // player can read which they'll land on from below.
    for (const plat of PLATFORMS) {
      outlineRect(
        ctx,
        plat.x,
        plat.y,
        plat.width,
        plat.height,
        plat.passthrough ? COLOR_PLATFORM_PASSTHROUGH : COLOR_PLATFORM,
      );
    }

    // Player — apply squash/stretch scale to width/height, center the squash
    // horizontally, and bottom-align vertically so the feet stay planted on
    // the ground (a squash reads as "compress down," not "shrink and float").
    const dw = player.width * player.scaleX;
    const dh = player.height * player.scaleY;
    const dx = player.x + (player.width - dw) / 2;
    const dy = player.y + (player.height - dh);

    // Subtle additive glow under the character — demonstrates drawGlow.
    // Very low intensity so it reads as ambient warmth, not a light source.
    drawGlow(
      ctx,
      player.x + player.width / 2,
      player.y + player.height / 2,
      20,
      COLOR_PLAYER,
      0.15,
    );

    outlineRect(ctx, dx, dy, dw, dh, COLOR_PLAYER);

    ctx.restore();

    // Screen-space UI — drawn without the camera transform so it stays
    // anchored to the viewport, not the world.
    drawHUD(ctx);
  };

  /** Draw the heads-up display — a small status line at the top-left. */
  const drawHUD = (ctx: CanvasRenderingContext2D): void => {
    ctx.font = '11px ui-monospace, "SF Mono", "Fira Code", monospace';
    ctx.fillStyle = '#7a6a5a';
    const frozen = isHitStopActive(hitStop) ? '  [FROZEN]' : '';
    ctx.fillText(
      `x:${Math.round(player.x)}  y:${Math.round(player.y)}  ${player.onGround ? 'grounded' : 'airborne'}${frozen}`,
      8,
      16,
    );
  };

  // --- Fixed-step game loop (createGameLoop) --------------------------------
  //
  // This is the first showcase section to use the library's own createGameLoop
  // (the hero + lava-pool use hand-rolled rAF loops). The loop drives the
  // fixed-step sim at exactly 60 Hz regardless of the host's refresh rate;
  // visibilitychange is handled internally (pause-on-hidden, reset accumulator
  // on regain).

  const loop: GameLoop = createGameLoop({
    fixedDt: 1 / 60,
    step: () => {
      // 1. Poll input — drain edge latches once per fixed tick.
      const input = keyboard.poll();

      // 2. Advance hit-stop timer regardless of the freeze so the freeze
      //    actually ends. When active, skip the physics step (the temporal-
      //    juice contract: sim freezes, FX continue — though this minimal
      //    playground has no FX layer to keep advancing).
      hitStop = stepHitStop(hitStop, 1);
      if (isHitStopActive(hitStop)) return;

      // 3. Apply input to velocity. Ground moves at MOVE_SPEED; air moves at
      //    AIR_CONTROL × MOVE_SPEED so jumps still steer but can't reverse on
      //    a dime. When idle on the ground, vx zeroes (snappy stop).
      const left = input['left']?.held ?? false;
      const right = input['right']?.held ?? false;
      const jumpPressed = input['jump']?.pressed ?? false;
      const speed = player.onGround ? MOVE_SPEED : MOVE_SPEED * AIR_CONTROL;
      if (left && !right) {
        player.vx = -speed;
        player.facing = -1;
      } else if (right && !left) {
        player.vx = speed;
        player.facing = 1;
      } else if (player.onGround) {
        player.vx = 0;
      }
      // Jump — only from the ground (no double-jump in this minimal demo).
      if (jumpPressed && player.onGround) {
        player.vy = JUMP_VELOCITY;
        player.onGround = false;
      }

      // Reset — instant teleport back to spawn. Edge-triggered (pressed, not
      // held) so holding R doesn't keep re-teleporting.
      if (input['reset']?.pressed) {
        player.x = SPAWN_X;
        player.y = SPAWN_Y;
        player.vx = 0;
        player.vy = 0;
        player.onGround = true;
        player.scaleX = 1;
        player.scaleY = 1;
      }

      // 4. Gravity — accumulate downward, clamped to terminal velocity.
      player.vy = Math.min(player.vy + GRAVITY, MAX_FALL);

      // 5. Per-axis collision resolution (X then Y). prevBottom is captured
      //    BEFORE the vertical move so resolveAxisY's passthrough rule
      //    (land-on-top only) has the pre-move reference frame.
      const prevBottom = player.y + player.height;
      const xRes = resolveAxisX(player, player.vx, PLATFORMS);
      player.x = xRes.x;
      player.vx = xRes.vx;

      // Capture vy BEFORE resolveAxisY zeroes it on landing — needed for the
      // impact-velocity check below (squash + hit-stop).
      const vyBeforeResolve = player.vy;
      const yRes = resolveAxisY(
        { x: player.x, y: player.y, width: player.width, height: player.height },
        player.vy,
        PLATFORMS,
        prevBottom,
      );
      player.y = yRes.y;
      player.vy = yRes.vy;

      // 6. Landing detection — squash + hit-stop based on impact velocity.
      //    Triggered only on the transition airborne → grounded, so walking
      //    along flat ground doesn't continuously re-squash.
      if (yRes.landed && !player.onGround) {
        const impact = Math.abs(vyBeforeResolve);
        if (impact > 2) {
          // Negative offset → vertical squash (shorter), horizontal stretch
          // (wider). volumeScale keeps scaleX × scaleY === 1 (area-preserving)
          // so it reads as weight rather than a shrink.
          const scale = volumeScale(-impact * 0.3);
          player.scaleX = scale.scaleX;
          player.scaleY = scale.scaleY;
        }
        if (impact > HIT_STOP_THRESHOLD) {
          hitStop = triggerHitStop(hitStop, HIT_STOP_DURATION);
        }
      }
      player.onGround = yRes.landed;

      // 7. Decay squash back to neutral — exponential approach to (1, 1).
      //    Same pattern as the hero's spring chain return-to-rest.
      player.scaleX += (1 - player.scaleX) * SQUASH_DECAY;
      player.scaleY += (1 - player.scaleY) * SQUASH_DECAY;

      // 8. Camera — lerp + clamp toward the player. updateCamera returns a
      //    fresh Camera (pure-progression-ops discipline; never mutates).
      camera = updateCamera(
        camera,
        { x: player.x, y: player.y, width: player.width, height: player.height },
        { width: WORLD_W, height: WORLD_H },
        { width: VIEW_W, height: VIEW_H },
      );
    },
    render: () => {
      render();
    },
  });

  // --- Initial paint (also serves as the static reduced-motion frame) ------

  render();

  // --- Page-scroll guard ---------------------------------------------------
  //
  // ArrowLeft / ArrowRight / Space scroll the page by default and would
  // interrupt the player. We suppress them ONLY while the playground section
  // is onscreen, so scrolling past it works normally.
  //
  // An IntersectionObserver tracks onscreen-ness; the keydown handler reads
  // a local boolean so the per-keystroke check is O(1) (no getBoundingClientRect
  // in the hot path).
  let onscreen = false;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        onscreen = entry.isIntersecting;
      }
    },
    { threshold: 0.01 },
  );
  observer.observe(container);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!onscreen) return;
    if (SUPPRESSED_CODES.has(e.code)) e.preventDefault();
  };
  // Capture-phase listener: preventDefault before the browser acts on the
  // scroll gesture.
  window.addEventListener('keydown', onKeyDown, { capture: true });

  // --- Motion gate ---------------------------------------------------------

  // Reduced-motion branch: the render() above is the single static frame
  // (character at spawn, camera at origin). Do NOT start the loop.
  if (shouldAnimate()) {
    return;
  }

  loop.start();

  // The loop's own visibilitychange handler pauses-on-hidden; we don't need
  // a second one here (unlike the hand-rolled hero / lava-pool loops).
}

// ---------------------------------------------------------------------------
// Section-local helpers (not part of the library)
// ---------------------------------------------------------------------------
//
// (All section-local helpers are inlined into initPlayground above for
// locality with the canvas/context they close over. No module-scope helpers
// needed.)
