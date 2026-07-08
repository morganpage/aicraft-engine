/**
 * Section 1 — Hero.
 *
 * Wires the 🎲 button, the ⏫ Jump button, the 👁 Eyes toggle, the 🦶 Legs
 * toggle, the speed slider, and the mood slider to the store / local state,
 * derives a fresh `HeroConfig` whenever the seed changes, and runs a fixed-
 * timestep rAF loop that advances the hero's locomotion + antenna and redraws
 * each frame. Arrow keys drive directional walking (← walks left, → walks
 * right, release = idle; the hero faces the direction it walks and keeps that
 * facing while idle). `A` / `D` are aliases for `←` / `→` (mirroring the
 * playground's `KeyA` / `KeyD` mapping) so WASD players can drive the walk
 * too. Jump (Space / ⏫) works in all three walk states (idle / walking left /
 * walking right) and keeps horizontal momentum. The eye toggles between
 * cyclops (1) and two-eyed (2) via the 👁 button or the `E` key, and the pupil
 * tracks the travel direction (walk dir horizontally, jump phase vertically).
 * The legs toggle between the default 2-bone IK limbs and the platformer-style
 * "simple feet" (two body-colored foot rects driven by the same locomotion
 * pose) via the 🦶 button or the `L` key; the default IK legs are the benchmark
 * path so first paint stays byte-identical. The mood slider drives the
 * parametric mouth continuously (😊 happy ↔ 😰 nervous, default 0.3 = a gentle
 * resting smile) via `drawSlimeKnight`'s render-time `options.emotion` —
 * nudgable with `[` / `]`. Footstep audio: a soft low-passed noise "tap" fires
 * on each walk-cycle foot-plant edge via the shared `advanceFootPlant` engine
 * primitive (same primitive the playground uses), re-evaluated from
 * `frame.locomotion` each tick. No explicit speed gate is needed — the hero's
 * locomotion is displacement-driven (walkDx=0 → phase frozen → no edges), so
 * plants only occur while actually walking. Defensive `createAudioAdapter`
 * (no-op pre-unlock / in Node), unlocked on first user gesture (autoplay
 * policy). Footsteps only — no jump/landing sound (follow-up). Motion-gated: if
 * the user prefers reduced motion, a single static frame is rendered and the
 * loop is never started.
 *
 * Onscreen input isolation: this section AND the playground both attach
 * `window` keyboard listeners for ←/→/A/D/Space. To keep one from driving the
 * other when both are mounted, an IntersectionObserver (threshold 0.01) tracks
 * `onscreen` and the step callback zeroes walkDx/jumpPressed/jumpHeld while
 * offscreen (so the hero idles — no movement, no footstep audio). Held state is
 * still tracked by the always-on window listeners, so scrolling back mid-hold
 * resumes the walk correctly. `preventDefault` on arrows/Space is likewise
 * gated so the page scrolls normally when this section is offscreen. Mirrors
 * the playground's pattern exactly.
 */

import {
  createHeroFrameState,
  drawSlimeKnight,
  deriveHeroConfig,
  stepHero,
  HERO_CANVAS_SIZE,
  HERO_GROUND_Y,
  type HeroLegStyle,
} from '../helpers/slime-knight';
import { shouldAnimate } from '../helpers/motion-gate';
import { resizeCanvasToBackingStore } from '../../src/primitives';
import {
  createFootPlantState,
  advanceFootPlant,
  evaluateLocomotion,
} from '../../src/animation';
import { createAudioAdapter, type AudioAdapter } from '../../src/audio';
import { createGameLoop, type GameLoop } from '../../src/game-loop';
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

// --- Footstep audio recipe ---
// Verbatim copies of the playground's footstep constants
// (FOOTSTEP_SOUND_DUR / _FREQ / _PEAK) so the two sections share a single
// sonic identity: a soft low-passed noise "tap" per step.
/** Footstep sound: short low-freq noise burst — a soft "tap" (matches the
 *  playground's footstep so the two sections share a sonic identity). */
const FOOTSTEP_SOUND_DUR = 40;      // ms
/** Footstep sound: lowpass cutoff (Hz) — muffles the burst into a thud. */
const FOOTSTEP_SOUND_FREQ = 200;    // Hz
/** Footstep sound: peak gain — quiet (it fires every step). */
const FOOTSTEP_SOUND_PEAK = 0.12;

/**
 * Initialize the hero section.
 *
 * @param container - the `<section id="hero">` element
 * @param store - the global observable store
 */
export function initHero(container: HTMLElement, store: Store<GlobalState>): void {
  const canvas = container.querySelector<HTMLCanvasElement>('.hero-canvas')!;
  const ctx = canvas.getContext('2d')!;
  // DPR-aware backing store: canvas.width/height = CSS size × devicePixelRatio
  // so the canvas renders crisp on Retina / high-DPI mobile. CSS sizing is
  // owned by style.css — we only set the backing store + scale the context,
  // so all subsequent drawing continues to use CSS-pixel coordinates.
  const dpr = resizeCanvasToBackingStore(canvas, HERO_CANVAS_SIZE, HERO_CANVAS_SIZE);
  ctx.scale(dpr, dpr);
  const seedDisplay = container.querySelector<HTMLElement>('.hero-seed')!;
  const rerollBtn = container.querySelector<HTMLButtonElement>('.hero-reroll')!;
  const jumpBtn = container.querySelector<HTMLButtonElement>('.hero-jump')!;
  const eyesBtn = container.querySelector<HTMLButtonElement>('.hero-eyes')!;
  const legsBtn = container.querySelector<HTMLButtonElement>('.hero-legs')!;
  const speedSlider = container.querySelector<HTMLInputElement>('.hero-speed')!;
  const speedValue = container.querySelector<HTMLElement>('.hero-speed-value')!;
  const moodSlider = container.querySelector<HTMLInputElement>('.hero-mood')!;
  const moodValue = container.querySelector<HTMLElement>('.hero-mood-value')!;

  let config = deriveHeroConfig(store.get().heroSeed);
  let frame = createHeroFrameState(config);
  let tick = 0;

  // Onscreen gate — only this section responds to walk/jump input while it is
  // actually visible. Both the hero and the playground listen on `window`, so
  // without this gate pressing ←/→/A/D/Space would drive both simultaneously
  // (the offscreen section's footsteps/audio layering on the visible one).
  // Mirrors the playground's IntersectionObserver pattern. Held state
  // (leftHeld/rightHeld/walkDir) is still tracked by the always-on window
  // listeners regardless of `onscreen`, so resuming view mid-hold walks
  // correctly.
  let onscreen = false;

  // Audio adapter — defensive (lazy AudioContext, never-throw, no-op in Node).
  // Unlocked on first user gesture (see unlock listener below); playback is a
  // silent no-op until then (browser autoplay policy). Footsteps only — no
  // jump/landing sound (follow-up).
  const audio: AudioAdapter = createAudioAdapter();

  // Foot-plant detector state — threaded through the shared `advanceFootPlant`
  // engine primitive each tick to observe the >0 → 0 descent edge of each
  // foot's lift height (a foot "plants" when it lands). Pure progression op
  // (returns a new state). Reset on reroll so a new hero doesn't inherit stale
  // plant history.
  let plantState = createFootPlantState();

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

  // Leg style — showcase toggle (🦶 button / `L` key). `'ik'` (the default) =
  // the 2-bone IK limbs (the benchmark path → first paint stays byte-identical);
  // `'simpleFeet'` = the platformer-style two-rect feet (matches the
  // playground's abstract silhouette). NOT seed-derived; flows into
  // `drawSlimeKnight`'s render-time `options.legStyle`. Persisted locally
  // across frames (the same carry pattern as `eyeCount` / `facing`).
  let legStyle: HeroLegStyle = 'ik';

  /** Apply a new leg style: update local state + the button's label/aria. */
  const applyLegStyle = (next: HeroLegStyle): void => {
    legStyle = next;
    const label = legsBtn.querySelector('span');
    if (label) label.textContent = next === 'ik' ? 'IK legs' : 'Simple feet';
    legsBtn.setAttribute('aria-pressed', next === 'simpleFeet' ? 'true' : 'false');
  };
  applyLegStyle('ik');

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
    drawSlimeKnight(ctx, frame, tick, { x: lookX, y: lookY }, { blink: true, emotion, legStyle });
  };

  /** Re-derive the hero from a new seed and reset the animation clock. */
  const applySeed = (seed: number): void => {
    config = deriveHeroConfig(seed);
    frame = createHeroFrameState(config);
    // Reset the foot-plant detector alongside the fresh frame so a new hero
    // doesn't inherit stale plant history (avoids a spurious tap on reroll).
    plantState = createFootPlantState();
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

  // 🦶 Legs button → toggle IK ↔ simpleFeet. The label + aria-pressed update
  // via `applyLegStyle`; `legStyle` flows into `drawSlimeKnight`'s
  // `options.legStyle` at render time. Blur afterwards so the `L` key path
  // (window listener) stays the canonical keyboard route and the button's own
  // keyup activation doesn't double-fire (same pattern as the Eyes button).
  legsBtn.addEventListener('click', () => {
    applyLegStyle(legStyle === 'ik' ? 'simpleFeet' : 'ik');
    legsBtn.blur();
  });

  // Keyboard: ← → walk (release = idle), Space jumps. `A` / `D` are aliases
  // for `←` / `→` (mirroring the playground's WASD mapping) so the same hand
  // that drives the playground can drive the hero walk. Arrow keys (and their
  // A/D aliases) drive the walk directly (the standard platformer convention)
  // and preventDefault stops the page from scrolling. Auto-repeat keydowns are
  // ignored for the press edge but the held flag stays true, so a held arrow
  // keeps walking without re-triggering. When both directions are held, the
  // most recently pressed one wins (last-pressed wins); releasing the dominant
  // direction falls back to the other if it is still held, else idle.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      // Onscreen gate: only swallow the arrow's default (page scroll) while
      // this section is visible. Offscreen, the page scrolls normally. Held
      // state is ALWAYS recorded so the walk resumes correctly on scroll-back.
      if (onscreen) e.preventDefault();
      leftHeld = true;
      if (!e.repeat) {
        walkDir = -1;
        facing = -1;
      }
      return;
    }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      if (onscreen) e.preventDefault();
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
    // `L` toggles the leg style (IK ↔ simpleFeet). Same shape as `E`: no
    // preventDefault (`L` has no browser default to suppress), ignore
    // auto-repeat so a held `L` toggles once. Mirrors the 🦶 button.
    if (e.code === 'KeyL') {
      if (!e.repeat) applyLegStyle(legStyle === 'ik' ? 'simpleFeet' : 'ik');
      return;
    }
    // `[` / `]` nudge the mood slider (↔ emotion). Auto-repeat ALLOWED so
    // holding sweeps through the range — nudging is naturally repeat-friendly,
    // unlike the `E` / `L` toggles above (which gate on !e.repeat). No
    // preventDefault: brackets have no browser default we need to suppress
    // (same as `E` / `L`). Step 0.1 matches the slider's `step`; `applyEmotion`
    // clamps + rounds + syncs the slider DOM so keyboard + mouse stay in
    // lockstep.
    if (e.code === 'BracketLeft') {
      applyEmotion(emotion - 0.1);
      return;
    }
    if (e.code === 'BracketRight') {
      applyEmotion(emotion + 0.1);
      return;
    }
    if (e.code !== 'Space') return;
    if (onscreen) e.preventDefault();
    if (e.repeat) {
      jumpHeld = true;
      return;
    }
    jumpPressed = true;
    jumpHeld = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      leftHeld = false;
      walkDir = rightHeld ? 1 : 0;
      return;
    }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      rightHeld = false;
      walkDir = leftHeld ? -1 : 0;
      return;
    }
    if (e.code !== 'Space') return;
    jumpHeld = false;
  });

  // --- Audio unlock --------------------------------------------------------
  //
  // Browser autoplay policy requires a user gesture before AudioContext can
  // make sound. One-shot listener on the first keydown OR pointerdown anywhere
  // on the page arms playback; self-removes after firing. This is SEPARATE
  // from the walk keydown handler above (that one drives the walk; this one
  // only unlocks audio and runs once). Idempotent with `audio.unlock()` (which
  // itself is idempotent), so spurious triggers are harmless.
  const unlockAudio = (): void => {
    audio.unlock();
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('pointerdown', unlockAudio);
  };
  window.addEventListener('keydown', unlockAudio);
  window.addEventListener('pointerdown', unlockAudio);

  // Onscreen visibility observer — mirrors the playground's pattern exactly.
  // Tracks `container` with threshold 0.01 so the gate flips the moment any
  // sliver of the section enters/leaves the viewport. Drives the `onscreen`
  // boolean read by the keydown handler (preventDefault gate) and the step
  // callback (walk/jump gate) above.
  const visibilityObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        onscreen = entry.isIntersecting;
      }
    },
    { threshold: 0.01 },
  );
  visibilityObserver.observe(container);

  // Subscribe to seed changes coming from anywhere (🎲 button, URL, other
  // sections in the future). Ignore speed changes from the store here — the
  // slider already drives the local config directly.
  store.subscribe((state, prev) => {
    if (state.heroSeed !== prev.heroSeed) applySeed(state.heroSeed);
  });

  // --- Fixed-step game loop (createGameLoop) --------------------------------
  //
  // Fixed 60 Hz via the library's createGameLoop, display-refresh-independent:
  // the accumulator runs zero-or-more `step(fixedDt)` calls per rAF frame so
  // the simulation advances at exactly 60 Hz whether the host runs at 60, 120,
  // or 144 Hz. (The previous hand-rolled one-step-per-rAF loop ran 2–2.4× too
  // fast on high-refresh displays: DT was hardcoded 1/60 but the CALL rate was
  // the display refresh, not 60 Hz.) createGameLoop also handles
  // visibilitychange internally — pause-on-hidden, accumulator reset on regain
  // — so the hand-rolled visibility handler is gone. The hero does NOT
  // interpolate (matches the playground, which also ignores alpha): `render`
  // accepts `alpha` but does not use it.
  const loop: GameLoop = createGameLoop({
    fixedDt: DT,
    step: (dt) => {
      // Onscreen gate: zero walk + jump when this section is offscreen so the
      // hero doesn't move (or make footstep sounds) while the user is scrolled
      // away. Held state (leftHeld/rightHeld/walkDir) is still tracked by the
      // always-on window listeners, so resuming view mid-hold walks correctly.
      // Footstep audio is automatically gated too: offscreen → walkDx=0 →
      // phase frozen → no plant edges → advanceFootPlant returns no events →
      // no playNoise.
      const effectiveWalkDir = onscreen ? walkDir : 0;
      const walkDx = effectiveWalkDir * config.speed * WALK_SPEED_PX_PER_SEC * dt;
      frame = stepHero(frame, dt, {
        jumpPressed: onscreen && jumpPressed,
        jumpHeld: onscreen && jumpHeld,
        walkDx,
        facing,
        eyeCount,
      });
      jumpPressed = false;   // always drain the one-shot edge
      tick += 1;

      // Footstep audio — detect foot-plant edges from the locomotion pose and
      // fire a soft tap on each plant, synced to the actual walk cycle (not a
      // timer). The hero's locomotion is displacement-driven: phase only advances
      // when walkDx !== 0, so plants only occur while actually walking — NO
      // separate speed gate is needed (idle → walkDx=0 → phase frozen → lifts
      // don't change → advanceFootPlant produces no edges). This is cleaner than
      // the playground's explicit FOOTSTEP_MIN_SPEED gate (the playground keeps
      // its gate belt-and-suspenders because it also gates the dust-spawn x). The
      // pose is re-derived here from `frame.locomotion` + `config.gaitConfig`
      // (stepHero advanced the phase inside itself; the pose was derived in
      // drawSlimeKnight until now). Uses the shared `advanceFootPlant` primitive
      // (same as the playground). Fires ONE playNoise per plant event — if both
      // feet plant on the same tick (rare, certain phases) two calls stack and
      // read as a slightly louder step; acceptable and matches the alternating
      // left-right footstep rhythm.
      const pose = evaluateLocomotion(frame.locomotion, config.gaitConfig);
      const plant = advanceFootPlant(
        plantState,
        pose.leftFootOffset.y,
        pose.rightFootOffset.y,
      );
      plantState = plant.state;
      if (plant.events.leftPlanted) {
        audio.playNoise(FOOTSTEP_SOUND_DUR, 'lowpass', FOOTSTEP_SOUND_FREQ, FOOTSTEP_SOUND_PEAK);
      }
      if (plant.events.rightPlanted) {
        audio.playNoise(FOOTSTEP_SOUND_DUR, 'lowpass', FOOTSTEP_SOUND_FREQ, FOOTSTEP_SOUND_PEAK);
      }
    },
    render: () => {
      // Draw the current frame. The hero does NOT interpolate (matches the
      // playground, which also ignores alpha). `alpha` is accepted but unused.
      render();
    },
  });

  // Motion gate: if reduced motion is preferred, the single static frame
  // rendered above (applySeed → render) is the final paint — do NOT start the
  // loop. (createGameLoop attached its own visibilitychange listener at
  // creation, but with the loop never started it is inert — the resume branch
  // is gated on `running`, which stays false.)
  if (shouldAnimate()) {
    return;
  }

  loop.start();
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
