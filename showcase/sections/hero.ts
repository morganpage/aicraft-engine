/**
 * Section 1 — Hero.
 *
 * Wires the 🎲 button, the ⏫ Jump button, and the speed slider to the store,
 * derives a fresh `HeroConfig` whenever the seed changes, and runs a fixed-
 * timestep rAF loop that advances the hero's locomotion + antenna and redraws
 * each frame. Arrow keys drive directional walking (← walks left, → walks
 * right, release = idle; the hero faces the direction it walks and keeps that
 * facing while idle). Jump (Space / ⏫) works in all three walk states
 * (idle / walking left / walking right) and keeps horizontal momentum.
 * Motion-gated: if the user prefers reduced motion, a single static frame is
 * rendered and the loop is never started.
 */

import {
  createHeroFrameState,
  drawSlimeKnight,
  deriveHeroConfig,
  stepHero,
  HERO_CANVAS_SIZE,
  HERO_GROUND_Y,
} from '../helpers/slime-knight';
import { shouldAnimate } from '../helpers/motion-gate';
import type { Store } from '../store';
import type { GlobalState } from '../main';

/** Fixed timestep (seconds per tick) — proposal §Q4. Keeps the animation
 *  deterministic across devices regardless of the host's frame rate. */
const DT = 1 / 60;

/**
 * Walk speed in canvas px per second at `config.speed = 1`. The hero crosses
 * the 320px canvas in ~3.5s at this rate. With a default gait `strideLength`
 * of ~4px, the cycle distance is `2π² · strideLength ≈ 79px`, giving a
 * cadence of ~1.14 cycles/sec (~2.3 steps/sec) — a natural walking rhythm.
 * Scales linearly with the Speed slider (`config.speed`).
 */
const WALK_SPEED_PX_PER_SEC = 90;

/**
 * Initialize the hero section.
 *
 * @param container - the `<section id="hero">` element
 * @param store - the global observable store
 */
export function initHero(container: HTMLElement, store: Store<GlobalState>): void {
  const canvas = container.querySelector<HTMLCanvasElement>('.hero-canvas')!;
  const ctx = canvas.getContext('2d')!;
  const seedDisplay = container.querySelector<HTMLElement>('.hero-seed')!;
  const rerollBtn = container.querySelector<HTMLButtonElement>('.hero-reroll')!;
  const jumpBtn = container.querySelector<HTMLButtonElement>('.hero-jump')!;
  const speedSlider = container.querySelector<HTMLInputElement>('.hero-speed')!;
  const speedValue = container.querySelector<HTMLElement>('.hero-speed-value')!;

  let config = deriveHeroConfig(store.get().heroSeed);
  let frame = createHeroFrameState(config);
  let tick = 0;
  let rafId = 0;

  // Jump input edges. `jumpPressed` is a ONE-SHOT consumed by the loop each
  // tick (set on press, reset after stepHero). `jumpHeld` tracks the held
  // state for variable-height jumps (hold → full height, tap → short hop).
  let jumpPressed = false;
  let jumpHeld = false;

  // Walk state — arrow-key driven. `walkDir` is the active direction this tick
  // (-1 = left, 0 = idle, +1 = right); `facing` persists the last nonzero
  // direction so the hero keeps facing that way while idle (no snap-back to a
  // default). `leftHeld` / `rightHeld` disambiguate releases so releasing one
  // arrow while the other is still held falls back to the held direction.
  let walkDir = 0;
  let facing: 1 | -1 = 1;
  let leftHeld = false;
  let rightHeld = false;

  /** Render one frame at the current `frame` / `tick`. Does not advance state. */
  const render = (): void => {
    drawBackground(ctx, config.palette, frame.x);
    drawSlimeKnight(ctx, frame, tick);
  };

  /** Re-derive the hero from a new seed and reset the animation clock. */
  const applySeed = (seed: number): void => {
    config = deriveHeroConfig(seed);
    frame = createHeroFrameState(config);
    tick = 0;
    speedSlider.value = String(config.speed);
    speedValue.textContent = `${config.speed.toFixed(1)}×`;
    seedDisplay.textContent = `#${seed}`;
    render();
  };

  /** Sync the speed slider's label and the runtime config. */
  const applySpeed = (speed: number): void => {
    config.speed = speed;
    speedValue.textContent = `${speed.toFixed(1)}×`;
  };

  // Initial paint.
  applySeed(store.get().heroSeed);

  // 🎲 button → new random seed → store. The seed pick itself uses
  // Math.random because this is a USER input (host-side entropy), not
  // simulation state. The deterministic contract is what happens AFTER the
  // seed is chosen (deriveHeroConfig is fully seeded).
  rerollBtn.addEventListener('click', () => {
    const newSeed = Math.floor(Math.random() * 99_999) + 1;
    store.set({ heroSeed: newSeed });
  });

  // Speed slider → runtime config + store.
  speedSlider.addEventListener('input', () => {
    const speed = Number(speedSlider.value);
    applySpeed(speed);
    store.set({ heroSpeed: speed });
  });

  // ⏫ Jump button → press edge for one tick, hold while pressed (mouse/touch).
  // pointerdown (not click) fires immediately on press for snappy response;
  // pointerup/pointerleave release the hold. Blur afterwards so the spacebar
  // path (window listener below) stays the canonical keyboard route and the
  // button's own keyup activation doesn't double-fire.
  jumpBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    jumpPressed = true;
    jumpHeld = true;
    jumpBtn.blur();
  });
  const releaseJump = (): void => {
    jumpHeld = false;
  };
  jumpBtn.addEventListener('pointerup', releaseJump);
  jumpBtn.addEventListener('pointerleave', releaseJump);
  jumpBtn.addEventListener('pointercancel', releaseJump);

  // Keyboard: ← → walk (release = idle), Space jumps. Arrow keys drive the
  // walk directly (the standard platformer convention) and preventDefault
  // stops the page from scrolling. Auto-repeat keydowns are ignored for the
  // press edge but the held flag stays true, so a held arrow keeps walking
  // without re-triggering. When both arrows are held, the most recently
  // pressed one wins (last-pressed wins); releasing the dominant arrow falls
  // back to the other if it is still held, else idle.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft') {
      e.preventDefault();
      leftHeld = true;
      if (!e.repeat) {
        walkDir = -1;
        facing = -1;
      }
      return;
    }
    if (e.code === 'ArrowRight') {
      e.preventDefault();
      rightHeld = true;
      if (!e.repeat) {
        walkDir = 1;
        facing = 1;
      }
      return;
    }
    if (e.code !== 'Space') return;
    e.preventDefault();
    if (e.repeat) {
      jumpHeld = true;
      return;
    }
    jumpPressed = true;
    jumpHeld = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft') {
      leftHeld = false;
      walkDir = rightHeld ? 1 : 0;
      return;
    }
    if (e.code === 'ArrowRight') {
      rightHeld = false;
      walkDir = leftHeld ? -1 : 0;
      return;
    }
    if (e.code !== 'Space') return;
    jumpHeld = false;
  });

  // Subscribe to seed changes coming from anywhere (🎲 button, URL, other
  // sections in the future). Ignore speed changes from the store here — the
  // slider already drives the local config directly.
  store.subscribe((state, prev) => {
    if (state.heroSeed !== prev.heroSeed) applySeed(state.heroSeed);
  });

  // Motion gate: if reduced motion is preferred, render a single static
  // frame (already done above) and DO NOT start the rAF loop.
  if (shouldAnimate()) {
    return;
  }

  // Fixed-dt animation loop. `requestAnimationFrame` provides the wall-clock
  // cadence; the simulation always steps by exactly DT seconds so the
  // animation is deterministic and frame-rate-independent.
  const loop = (): void => {
    // Walk displacement this tick: `walkDir · speed · WALK_SPEED_PX_PER_SEC ·
    // DT`. walkDir is -1 / 0 / +1 (left / idle / right); 0 freezes the cycle
    // (feet planted). `facing` was already updated by the keydown/keyup
    // handlers (last-pressed wins, persisted while idle) and is passed through
    // so drawSlimeKnight mirrors the character when facing left. Jump is
    // independent of walkDx, so jumping while walking keeps horizontal
    // momentum and works in all three walk states.
    const walkDx = walkDir * config.speed * WALK_SPEED_PX_PER_SEC * DT;
    frame = stepHero(frame, DT, { jumpPressed, jumpHeld, walkDx, facing });
    jumpPressed = false;
    tick += 1;
    render();
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);

  // Pause when the tab is hidden — saves CPU and avoids huge catch-up bursts.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
    } else if (!shouldAnimate()) {
      rafId = requestAnimationFrame(loop);
    }
  });
}

// ---------------------------------------------------------------------------
// Background — section-local scene dressing (not part of drawSlimeKnight)
// ---------------------------------------------------------------------------

/**
 * Paint the hero stage background: palette.background fill + a thin ground
 * line + a subtle drop shadow under the character. The shadow follows the
 * hero's `heroX` offset so it tracks the body during a walk-across. The
 * ground line spans the full canvas (it does NOT move with `heroX`).
 */
function drawBackground(
  ctx: CanvasRenderingContext2D,
  palette: { background: string; outline: string },
  heroX: number,
): void {
  ctx.clearRect(0, 0, HERO_CANVAS_SIZE, HERO_CANVAS_SIZE);

  // Palette background fill.
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, HERO_CANVAS_SIZE, HERO_CANVAS_SIZE);

  // Ground line — a single 1px outline-color stroke where the feet plant.
  // HERO_GROUND_Y is the same constant drawSlimeKnight anchors feet to, so
  // the visual ground and the foot-plant line can never drift.
  const groundY = HERO_GROUND_Y;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, groundY + 0.5);
  ctx.lineTo(HERO_CANVAS_SIZE, groundY + 0.5);
  ctx.stroke();

  // Soft shadow under the character — a flat ellipse in a translucent outline.
  // Tracks `heroX` so the shadow moves with the body across the walk-across.
  const shadowCx = HERO_CANVAS_SIZE / 2 + heroX;
  const shadowCy = groundY + 2;
  ctx.save();
  ctx.fillStyle = palette.outline;
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.ellipse(shadowCx, shadowCy, 56, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
