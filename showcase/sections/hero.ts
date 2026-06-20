/**
 * Section 1 — Hero.
 *
 * Wires the 🎲 button, the ⏫ Jump button, the 👁 Eyes toggle, the speed slider,
 * and the mood slider to the store / local state, derives a fresh `HeroConfig`
 * whenever the seed changes, and runs a fixed-timestep rAF loop that advances
 * the hero's locomotion + antenna and redraws each frame. Arrow keys drive
 * directional walking (← walks left, → walks right, release = idle; the hero
 * faces the direction it walks and keeps that facing while idle). Jump (Space /
 * ⏫) works in all three walk states (idle / walking left / walking right) and
 * keeps horizontal momentum. The eye toggles between cyclops (1) and two-eyed
 * (2) via the 👁 button or the `E` key, and the pupil tracks the travel
 * direction (walk dir horizontally, jump phase vertically). The mood slider
 * drives the parametric mouth continuously (😊 happy ↔ 😰 nervous, default 0.3
 * = a gentle resting smile) via `drawSlimeKnight`'s render-time `options.emotion`
 * — nudgable with `[` / `]`. Motion-gated: if the user prefers reduced motion,
 * a single static frame is rendered and the loop is never started.
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
  const eyesBtn = container.querySelector<HTMLButtonElement>('.hero-eyes')!;
  const speedSlider = container.querySelector<HTMLInputElement>('.hero-speed')!;
  const speedValue = container.querySelector<HTMLElement>('.hero-speed-value')!;
  const moodSlider = container.querySelector<HTMLInputElement>('.hero-mood')!;
  const moodValue = container.querySelector<HTMLElement>('.hero-mood-value')!;

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

  // Eye count — showcase toggle (👁 button / `E` key). `1` = cyclops (the
  // seed-canonical default), `2` = two-eyed. Persisted into `frame.eyeCount`
  // via `HeroInputs.eyeCount` each tick (mirrors the `facing` carry-forward
  // pattern). NOT seed-derived; defaults to `1` so the benchmark path and the
  // initial paint render the original cyclops.
  let eyeCount: 1 | 2 = 1;

  /** Apply a new eye count: update local state + the button's label/aria. */
  const applyEyeCount = (next: 1 | 2): void => {
    eyeCount = next;
    const label = eyesBtn.querySelector('span');
    if (label) label.textContent = next === 1 ? '1 eye' : '2 eyes';
    eyesBtn.setAttribute('aria-pressed', next === 2 ? 'true' : 'false');
  };
  applyEyeCount(1);

  // Mood — showcase-only continuous emotion control (😊 happy ↔ 😰 nervous).
  // Local to this section; NOT in GlobalState (the slider's presence IS the
  // control — no store round-trip needed). Flows into `drawSlimeKnight`'s
  // `options.emotion` at draw time. Default 0.3 = a gentle resting smile so the
  // character reads as friendly on first paint and the mouth is visible by
  // default (no separate show/hide toggle).
  let emotion = 0.3;

  /** Clamp + round an emotion value to a valid 1-decimal step in [-1, 1]
   *  (rounds to dodge float drift like 0.3 - 0.1 = 0.19999…). */
  const clampEmotion = (e: number): number =>
    Math.max(-1, Math.min(1, Math.round(e * 10) / 10));

  /** Apply a new emotion: clamp, update local state, sync the slider + label.
   *  Shared by the slider's `input` event and the `[` / `]` keyboard nudge. */
  const applyEmotion = (next: number): void => {
    emotion = clampEmotion(next);
    moodSlider.value = String(emotion);
    // Sign-prefixed single decimal ("+0.3" / "0.0" / "-0.5") so the bipolar
    // direction reads at a glance, mirroring how the speed slider shows "1.0×".
    moodValue.textContent = emotion > 0 ? `+${emotion.toFixed(1)}` : emotion.toFixed(1);
  };
  applyEmotion(emotion);

  /** Render one frame at the current `frame` / `tick`. Does not advance state. */
  const render = (): void => {
    // Gaze vector for pupil tracking (user feedback #1: "eye should look in
    // direction it's going"). Horizontal: the active walk direction, or the
    // persisted facing when idle (so the hero keeps looking the way it faces).
    // Vertical: jump phase — rising looks up (negative Y, since +Y is down),
    // falling looks down, else level. Each component is in [-1, 1]; `drawEye`
    // offsets the pupil by `look · pupilReach` (mirror-sign corrected).
    const lookX = walkDir !== 0 ? walkDir : facing;
    const lookY =
      frame.jump.phase === 'rising' ? -1 :
      frame.jump.phase === 'falling' ? 1 : 0;
    drawBackground(ctx, config.palette, frame.x);
    drawSlimeKnight(ctx, frame, tick, { x: lookX, y: lookY }, { blink: true, emotion });
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

  // Mood slider → local emotion (no store round-trip; the slider IS the control).
  moodSlider.addEventListener('input', () => {
    applyEmotion(Number(moodSlider.value));
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

  // 👁 Eyes button → toggle 1↔2. The label + aria-pressed update via
  // `applyEyeCount`; `eyeCount` flows into `frame.eyeCount` via `HeroInputs`
  // in the loop below. Blur afterwards so the `E` key path (window listener)
  // stays the canonical keyboard route and the button's own keyup activation
  // doesn't double-fire (same pattern as the Jump button).
  eyesBtn.addEventListener('click', () => {
    applyEyeCount(eyeCount === 1 ? 2 : 1);
    eyesBtn.blur();
  });

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
    // `E` toggles the eye count (1↔2). No preventDefault — `E` has no browser
    // default we need to suppress. Ignore auto-repeat so a held `E` toggles
    // once, same as the click.
    if (e.code === 'KeyE') {
      if (!e.repeat) applyEyeCount(eyeCount === 1 ? 2 : 1);
      return;
    }
    // `[` / `]` nudge the mood slider (↔ emotion). Auto-repeat ALLOWED so
    // holding sweeps through the range — nudging is naturally repeat-friendly,
    // unlike the `E` toggle above (which gates on !e.repeat). No preventDefault:
    // brackets have no browser default we need to suppress (same as `E`). Step
    // 0.1 matches the slider's `step`; `applyEmotion` clamps + rounds + syncs
    // the slider DOM so keyboard + mouse stay in lockstep.
    if (e.code === 'BracketLeft') {
      applyEmotion(emotion - 0.1);
      return;
    }
    if (e.code === 'BracketRight') {
      applyEmotion(emotion + 0.1);
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
    frame = stepHero(frame, DT, { jumpPressed, jumpHeld, walkDx, facing, eyeCount });
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
