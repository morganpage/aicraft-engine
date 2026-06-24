/**
 * Section 2 — Lava pool.
 *
 * The headline composite: a pool of lava at the bottom of a level whose
 * surface ripples and throws off fire and smoke particles. Wires three
 * shipped APIs together:
 *   - `generateWaveLine` produces the lava surface polyline each tick
 *     (Gerstner mode for the viscous sharp-crested look by default;
 *     sine mode available via the 🌊 toggle for the retro-digital look).
 *   - `createEmitter` + `stepEmitters` run two heterogeneous continuous
 *     emitters over the surface: FIRE rises then falls back (positive
 *     gravityScale 0.6 — embers), SMOKE rises against gravity (negative
 *     gravityScale -0.4 — buoyant). Both share world gravity; they differ
 *     only in their per-particle gravityScale/dragScale.
 *   - `sampleConeVelocity` (the composable Approach-A primitive the
 *     emitters use internally) drives the click splash burst standalone —
 *     a one-shot DIRECTIONAL cone throw upward, demonstrated alongside
 *     the continuous emitters.
 *
 * Determinism / units: rate / life / gravity / drag are in TICK units
 * (one rAF frame = exactly DT = 1 tick of simulation). This matches the
 * particle-emitters decision's example pattern (`rate: 2`, `life: 30`,
 * `stepEmitters(emitters, 1, { gravity: 0.5 })`) so the spec's "rate
 * ~2/tick" and "life ~30" values are literal, and the steady-state count
 * works out to `rate × life` (fire ~60, smoke ~48 in flight). The wave's
 * `t` parameter is the integer tick counter. Same tick count → same
 * render, forever. rAF provides only wall-clock cadence; per-tick the
 * sim is deterministic.
 *
 * Motion-gated: if the user prefers reduced motion, a single static frame
 * is rendered (the initial paint at tick 0) and the rAF loop is never
 * started. Matches the hero section's gate exactly.
 *
 * Local state: this section does NOT extend `GlobalState` — particle
 * systems don't have a shared seed concept the way character generation
 * does. The `store` parameter is accepted to match the `init(container,
 * store)` section signature but is intentionally unused (prefixed `_`).
 */

import { createEmitter, stepEmitters, particleAlphaCurve, particleSizeCurve, sampleConeVelocity, step, type ConeConfig, type Emitter, type Particle } from "../../src/particles";
import { generateWaveLine, DEFAULT_GERSTNER, DEFAULT_WAVE_LINE, resizeCanvasToBackingStore, type WaveLineConfig, type WavePoint } from "../../src/primitives";
import { mulberry32 } from "../../src/rng";
import { shouldAnimate } from "../helpers/motion-gate";
import type { Store } from "../store";
import type { GlobalState } from "../main";

/** Fixed timestep — one tick per rAF frame. Rate / life / gravity / drag
 *  are in tick units (see module doc). rAF provides only wall-clock
 *  cadence; the sim steps by exactly DT each frame so it is deterministic
 *  per-tick regardless of the host's refresh rate (cadence varies, sim
 *  does not). Mirrors the hero section's `DT` constant in shape. */
const DT = 1;

/** Canvas dimensions. Wider than tall (480×280) so the pool reads as a
 *  horizontal hazard strip at the bottom of a level, not a vat. */
const CANVAS_W = 480;
const CANVAS_H = 280;

/** Surface rest Y. The pool occupies the bottom ~40% of the canvas
 *  (SURFACE_Y = floor(280 × 0.6) = 168). Waves displace around this. */
const SURFACE_Y = Math.floor(CANVAS_H * 0.6);

/** Pixel spacing between wave samples. 4 px → 121 vertices across the
 *  480 px canvas, enough to resolve the ratified wavelength-28 base
 *  octave (≈17 samples per cycle — comfortable). */
const SAMPLE_SPACING = 4;

/** World gravity (px/tick²), downward. Same value applied to BOTH
 *  emitters via `stepEmitters` opts — fire and smoke share world gravity;
 *  they differ only in their per-particle `gravityScale` on the
 *  EmitterConfig (0.6 fire vs -0.4 smoke). This split is the whole point
 *  of the heterogeneous-physics extension (see advance.ts JSDoc). */
const GRAVITY = 0.5;

/** World drag multiplier per tick. 1.0 = no world drag. Each emitter
 *  applies its own per-particle dragScale (0.98 fire, 0.99 smoke) — set
 *  on the EmitterConfig, multiplied into the world drag at advance time. */
const DRAG = 1;

/** Per-tick drag applied to splash particles (advance opts). Slightly
 *  under 1 so the splash arcs naturally decelerate. */
const SPLASH_DRAG = 0.99;

// --- Fire emitter config ----------------------------------------------------

/** Isolated RNG seed for the fire emitter. Picked so the demo is
 *  reproducible: re-running the showcase always shows the same opening
 *  burst pattern. */
const FIRE_SEED = 42;
/** Particles per tick. Steady-state in flight ≈ rate × life = 60. */
const FIRE_RATE = 2;
/** Lifetime in ticks. */
const FIRE_LIFE = 30;
/** Per-particle base size (the renderer interpolates this via
 *  particleSizeCurve; see FIRE_SIZE_START/END). */
const FIRE_SIZE = 3;
/** Bright orange — overrides the lava body color so fire reads as
 *  distinct from the surface crust. */
const COLOR_FIRE = "#FFAA00";
/** Cone: straight up (−π/2 in canvas coords where +y is down), spread π/3
 *  (60° — narrow column of sparks). Speed 3–5 px/tick — 2× the prior
 *  1.5–3 so sparks have enough initial velocity to clearly arc up-then-
 *  down rather than barely clearing the surface. With world gravity 0.5
 *  and the reduced gravityScale below, the arc apex sits ~30–40 px above
 *  the surface — unmistakable up-then-down trajectory. */
const FIRE_CONE = {
  baseAngle: -Math.PI / 2,
  spread: Math.PI / 3,
  speedMin: 3.0,
  speedMax: 5.0,
};
/** gravityScale 0.4 (was 0.6): effective gravity 0.5 × 0.4 = 0.2/tick² —
 *  weaker pull-back than before so particles climb higher before falling
 *  as cooling embers. Combined with the 2× cone speed this lifts the arc
 *  apex from ~10 px (too subtle) to ~30–40 px (visibly arcing). */
const FIRE_GRAVITY_SCALE = 0.4;
/** dragScale 0.99 (was 0.98): ~1% energy lost per tick (was 2%) — slightly
 *  more energy retention for a smoother arc trajectory before the sparks
 *  fade. */
const FIRE_DRAG_SCALE = 0.99;

// --- Smoke emitter config ---------------------------------------------------

const SMOKE_SEED = 99;
const SMOKE_RATE = 0.8;
const SMOKE_LIFE = 60;
const SMOKE_SIZE = 6;
const COLOR_SMOKE = "#888888";
/** Wider cone (spread π/2 = 90°) — smoke billows outward, fire columns. */
const SMOKE_CONE = {
  baseAngle: -Math.PI / 2,
  spread: Math.PI / 2,
  speedMin: 0.5,
  speedMax: 1.5,
};
/** gravityScale -0.4: inverts world gravity. Smoke is buoyant — rises. */
const SMOKE_GRAVITY_SCALE = -0.4;
/** dragScale 0.99: ~1% energy lost per tick — smoke drifts (slow drag). */
const SMOKE_DRAG_SCALE = 0.99;

// --- Renderer-side lifetime curves -----------------------------------------
// (Particle.size on the emitter is the BASE; the renderer interpolates a
// separate start→end curve via particleSizeCurve. NOT stored on the
// particle — evaluated at draw time, per the lifetime.ts contract.)

/** Fire shrinks (4 → 1 px) as it cools. */
const FIRE_SIZE_START = 4;
const FIRE_SIZE_END = 1;
/** Fire fades from full bright to transparent over its life. */
const FIRE_ALPHA_START = 1;
const FIRE_ALPHA_END = 0;

/** Smoke expands (4 → 10 px) as it disperses. */
const SMOKE_SIZE_START = 4;
const SMOKE_SIZE_END = 10;
/** Smoke starts translucent and fades out — never fully opaque. */
const SMOKE_ALPHA_START = 0.6;
const SMOKE_ALPHA_END = 0;

// --- Splash burst config ----------------------------------------------------

/** Splash count — doubled from 12 so the burst reads as a chunky splash,
 *  not scattered sparks. 24 particles at 5–6px each has visible mass. */
const SPLASH_COUNT = 24;
/** Splash lifetime in ticks. Longer than the old 25 so the full up-then-down
 *  arc (≈24 ticks at speed 6, gravity 0.5) is visible before fade. */
const SPLASH_LIFE = 35;
/** Base particle size (the renderer interpolates via SPLASH_SIZE_START/END). */
const SPLASH_SIZE = 5;
/** Bright yellow — reads as fresh molten lava thrown upward, distinct from
 *  the ambient fire orange (#FFAA00). */
const COLOR_SPLASH = "#FFCC33";

/** Directional cone — all particles thrown UPWARD in a 120° arc. This is
 *  what makes the splash read as a splash (not the old full-circle radial
 *  burst where half went into the lava). `baseAngle: -π/2` = straight up
 *  (canvas convention: +y is down). `spread: 2π/3` = 120° wide arc. Speed
 *  range 4–8 px/tick gives arc heights of ~16–64px (v²/2g) — the faster
 *  particles clearly clear the surface and arc back down. */
const SPLASH_CONE: ConeConfig = {
  baseAngle: -Math.PI / 2,
  spread: (Math.PI * 2) / 3,
  speedMin: 4,
  speedMax: 8,
};

/** Splash render-size curve: starts chunky (6px), shrinks to 2px as it
 *  falls back. Was 3→1 (tiny sparks); now 6→2 (bold droplets). */
const SPLASH_SIZE_START = 6;
const SPLASH_SIZE_END = 2;
const SPLASH_ALPHA_START = 1;
const SPLASH_ALPHA_END = 0;

// --- Scene palette (section-local, all colors inline) ----------------------

/** Near-black warm background — a cave, not a void. Warm hue so the lava
 *  doesn't clash with a cool backdrop. */
const COLOR_BG = "#1a0d0a";
/** Deep red lava body fill. Saturated enough to read as molten, dark
 *  enough to contrast with the bright surface crust stroke. */
const COLOR_LAVA_BODY = "#7a0a0a";
/** Bright orange surface crust stroke — mirrors the fire color family so
 *  the surface reads as the top of the molten body. */
const COLOR_LAVA_SURFACE = "#ff6a00";
/** Lava surface crust stroke weight (px). */
const SURFACE_LINE_WIDTH = 2;

/**
 * Initialize the lava-pool section.
 *
 * @param container - the `<section id="lava-pool">` element
 * @param _store - the global observable store. Intentionally unused — the
 *   particle system has no shared-seed concept. Accepted only to match
 *   the section-init signature.
 */
export function initLavaPool(
  container: HTMLElement,
  // Underscore-prefixed: TypeScript's `noUnusedParameters` exempts these.
  // The store is accepted to keep the section signature uniform with
  // initHero; the lava pool runs entirely on local state.
  _store: Store<GlobalState>,
): void {
  const canvas = container.querySelector<HTMLCanvasElement>(".lava-canvas")!;
  const ctx = canvas.getContext("2d")!;
  // DPR-aware backing store: canvas.width/height = CSS size × devicePixelRatio
  // so the canvas renders crisp on Retina / high-DPI mobile. CSS sizing is
  // owned by style.css — we only set the backing store + scale the context,
  // so all subsequent drawing continues to use CSS-pixel coordinates.
  const dpr = resizeCanvasToBackingStore(canvas, CANVAS_W, CANVAS_H);
  ctx.scale(dpr, dpr);
  const surfaceBtn = container.querySelector<HTMLButtonElement>(".lava-surface")!;
  const intensitySlider = container.querySelector<HTMLInputElement>(".lava-intensity")!;
  const intensityValue = container.querySelector<HTMLElement>(".lava-intensity-value")!;
  const splashBtn = container.querySelector<HTMLButtonElement>(".lava-splash")!;

  // Surface line region — shared by BOTH emitters. Particles spawn from
  // the rest position (flat line), not from the wave-displaced curve.
  // Matches the decision example and keeps the spawn distribution uniform
  // across the canvas (a wavy spawn line would cluster particles in troughs).
  const surfaceRegion = {
    type: "line" as const,
    x1: 0,
    y1: SURFACE_Y,
    x2: CANVAS_W,
    y2: SURFACE_Y,
  };

  // Emitters — created ONCE. The `rng` function reference is threaded
  // through every stepEmitters call; recreating it would reset the seed
  // and re-emit the same sequence (see EmitterConfig.rng JSDoc).
  let fireEmitter: Emitter = createEmitter({
    rate: FIRE_RATE,
    region: surfaceRegion,
    cone: FIRE_CONE,
    gravityScale: FIRE_GRAVITY_SCALE,
    dragScale: FIRE_DRAG_SCALE,
    life: FIRE_LIFE,
    size: FIRE_SIZE,
    color: COLOR_FIRE,
    rng: mulberry32(FIRE_SEED),
  });

  let smokeEmitter: Emitter = createEmitter({
    rate: SMOKE_RATE,
    region: surfaceRegion,
    cone: SMOKE_CONE,
    gravityScale: SMOKE_GRAVITY_SCALE,
    dragScale: SMOKE_DRAG_SCALE,
    life: SMOKE_LIFE,
    size: SMOKE_SIZE,
    color: COLOR_SMOKE,
    rng: mulberry32(SMOKE_SEED),
  });

  // Splash particles — one-shot bursts from clicks/💧 button. Maintained
  // as a flat Particle[] and stepped each tick via `step()` (advance +
  // cull). Each burst is built by sampling SPLASH_CONE via
  // `sampleConeVelocity` (the same primitive the emitters use internally)
  // so every particle is thrown UPWARD in an arc — not the old full-circle
  // radial where half went into the lava.
  let splashParticles: Particle[] = [];

  // Wave mode state. Starts in Gerstner mode (the ratified lava look —
  // sharp-crested, flat-troughed, viscous).
  let waveConfig: WaveLineConfig = DEFAULT_GERSTNER;

  let tick = 0;
  let rafId = 0;

  // Intensity state — slider value (0–2) flows into stepEmitters via
  // `rateScale` each tick. At 0 the emitters go dormant; at 2 they emit
  // double (visually denser fire + smoke). Updates only the local label
  // here; the slider's current value is read fresh inside the loop.
  let intensity = 1;
  const applyIntensity = (value: number): void => {
    intensity = value;
    intensityValue.textContent = `${value.toFixed(2)}×`;
  };
  applyIntensity(Number(intensitySlider.value));

  // Wave tuning state — live slider values. Defaults address the user's
  // feedback that the library defaults (DEFAULT_GERSTNER / DEFAULT_WAVE_LINE)
  // moved the surface too fast and read as too narrow at canvas scale:
  //   - wavelengthScale 2  → 2× wider than the library defaults.
  //   - speedScale 0.4     → 2.5× slower.
  // These scale ONLY the showcase's runtime config; the library defaults
  // are untouched (see src/primitives/wave-line.ts). Applied per-octave in
  // deriveWaveConfig() so the user can scrub live without rebuilding the
  // emitters or the section.
  const wavelengthSlider = container.querySelector<HTMLInputElement>(".lava-wavelength")!;
  const wavelengthValue = container.querySelector<HTMLElement>(".lava-wavelength-value")!;
  const speedSlider = container.querySelector<HTMLInputElement>(".lava-speed")!;
  const speedValue = container.querySelector<HTMLElement>(".lava-speed-value")!;

  let wavelengthScale = Number(wavelengthSlider.value);
  let speedScale = Number(speedSlider.value);
  const applyWavelength = (value: number): void => {
    wavelengthScale = value;
    wavelengthValue.textContent = `${value.toFixed(1)}×`;
  };
  const applySpeed = (value: number): void => {
    speedScale = value;
    speedValue.textContent = `${value.toFixed(2)}×`;
  };
  applyWavelength(Number(wavelengthSlider.value));
  applySpeed(Number(speedSlider.value));

  /** Derive the runtime wave config from the active base (DEFAULT_GERSTNER
   *  or DEFAULT_WAVE_LINE) × the live slider scales. Called each render so
   *  slider changes are immediately visible (no emitter/section rebuild
   *  needed — only the surface polyline is regenerated per frame). */
  const deriveWaveConfig = (): WaveLineConfig => {
    const base = waveConfig;
    return {
      ...base,
      octaves: base.octaves!.map((o) => ({
        ...o,
        wavelength: o.wavelength * wavelengthScale,
        speed: o.speed * speedScale,
      })),
    };
  };

  /** Swap wave mode + update the 🌊 button's label/aria to match. */
  const applySurfaceMode = (useGerstner: boolean): void => {
    waveConfig = useGerstner ? DEFAULT_GERSTNER : DEFAULT_WAVE_LINE;
    const label = surfaceBtn.querySelector("span");
    if (label) label.textContent = useGerstner ? "Gerstner" : "Sine";
    surfaceBtn.setAttribute("aria-pressed", useGerstner ? "true" : "false");
  };
  applySurfaceMode(true);

  /** Render one frame at the current `tick`. Does not advance state. */
  const render = (): void => {
    // Surface polyline. `t = tick` advances phase each frame so the
    // Gerstner pinch travels rightward at octave.speed px/tick. The
    // runtime config is derived from the active base × the live slider
    // scales (wavelength + speed) so user tuning is immediately visible.
    const surface = generateWaveLine(0, SURFACE_Y, CANVAS_W, SURFACE_Y, SAMPLE_SPACING, tick, deriveWaveConfig());

    // Draw order is intentional: smoke first (behind, billowing up), fire
    // second (in front, bright), splash last (on top, foreground action).
    drawBackground(ctx);
    drawLava(ctx, surface);
    drawParticles(ctx, smokeEmitter.particles, COLOR_SMOKE, SMOKE_SIZE_START, SMOKE_SIZE_END, SMOKE_ALPHA_START, SMOKE_ALPHA_END);
    drawParticles(ctx, fireEmitter.particles, COLOR_FIRE, FIRE_SIZE_START, FIRE_SIZE_END, FIRE_ALPHA_START, FIRE_ALPHA_END);
    drawParticles(ctx, splashParticles, COLOR_SPLASH, SPLASH_SIZE_START, SPLASH_SIZE_END, SPLASH_ALPHA_START, SPLASH_ALPHA_END);
  };

  // Initial paint — also serves as the single static frame for the
  // reduced-motion branch (tick 0, emitters empty).
  render();

  // --- Controls -----------------------------------------------------------

  // 🌊 Surface toggle — Gerstner ↔ Sine. Re-renders immediately so the
  // mode change is visible even with animation paused (or reduced-motion).
  surfaceBtn.addEventListener("click", () => {
    applySurfaceMode(waveConfig.mode === "sine");
    surfaceBtn.blur();
    render();
  });

  // 🔥 Intensity slider — updates local state; the loop reads it next tick.
  intensitySlider.addEventListener("input", () => {
    applyIntensity(Number(intensitySlider.value));
  });

  // Wave-width & wave-speed sliders — update local scale state and
  // immediately re-render so the change is visible even with the rAF loop
  // paused (or in reduced-motion mode). The loop picks up the new scales
  // on its next tick automatically via deriveWaveConfig().
  wavelengthSlider.addEventListener("input", () => {
    applyWavelength(Number(wavelengthSlider.value));
    render();
  });
  speedSlider.addEventListener("input", () => {
    applySpeed(Number(speedSlider.value));
    render();
  });

  // 💧 Splash button — one-shot burst at the canvas center. The seed is
  // host-side entropy (Math.random, like the hero's 🎲 seed roll): user
  // input is allowed to use Math.random; only the SIMULATION must be
  // seeded. Once spawned, the particles advance deterministically.
  //
  // Demonstrates the composable primitives (Approach A substrate):
  // `sampleConeVelocity` is the same primitive the emitters use internally
  // (see FIRE_CONE / SMOKE_CONE wired through createEmitter), here used
  // standalone for a one-shot DIRECTIONAL burst. Unlike the old `spawn`
  // (full 360° radial — half went downward into the lava), the cone throws
  // every particle UPWARD in a 120° arc so the burst reads as a splash.
  const spawnBurstAt = (x: number, y: number): void => {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const rng = mulberry32(seed);
    const burst: Particle[] = [];
    for (let i = 0; i < SPLASH_COUNT; i++) {
      const vel = sampleConeVelocity(SPLASH_CONE, rng);
      burst.push({
        x,
        y,
        vx: vel.vx,
        vy: vel.vy,
        life: SPLASH_LIFE,
        maxLife: SPLASH_LIFE,
        size: SPLASH_SIZE,
        color: COLOR_SPLASH,
      });
    }
    splashParticles = [...splashParticles, ...burst];
  };

  splashBtn.addEventListener("click", () => {
    spawnBurstAt(CANVAS_W / 2, SURFACE_Y);
    splashBtn.blur();
  });

  // Canvas click — splash at the click point. Pointer events (not click)
  // for unified mouse/touch/pen. The canvas may be CSS-scaled relative to
  // its intrinsic resolution; scale click coords back to canvas space.
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    spawnBurstAt(x, y);
  });

  // --- Motion gate --------------------------------------------------------

  // If reduced motion is preferred, the render() above is the single
  // static frame; DO NOT start the rAF loop. Mirrors hero.ts §motion-gate.
  if (shouldAnimate()) {
    return;
  }

  // --- Fixed-dt animation loop -------------------------------------------

  // One rAF = exactly DT ticks of sim. Per-tick determinism is preserved;
  // wall-clock cadence varies with the host's refresh rate.
  const loop = (): void => {
    // 1. Advance the wave time parameter (tick-based; the wave's `t` is
    //    the integer tick counter).
    tick += 1;

    // 2. Step emitters. `rateScale: intensity` (0–2) is the live slider
    //    value — applied uniformly to both emitters (you don't intensify
    //    fire without smoke). stepEmitters integrates emission rates,
    //    spawns via region + cone sampling, advances with heterogeneous
    //    physics, and culls dead particles in one pure pass.
    [fireEmitter, smokeEmitter] = stepEmitters([fireEmitter, smokeEmitter], DT, { gravity: GRAVITY, drag: DRAG, rateScale: intensity });

    // 3. Step splash particles (advance + cull) with their own drag.
    splashParticles = step(splashParticles, DT, {
      gravity: GRAVITY,
      drag: SPLASH_DRAG,
    });

    // 4. Render.
    render();

    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);

  // Pause when the tab is hidden — saves CPU and avoids huge catch-up
  // bursts when the tab is re-shown. Mirrors hero.ts §visibility.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
    } else if (!shouldAnimate()) {
      rafId = requestAnimationFrame(loop);
    }
  });
}

// ---------------------------------------------------------------------------
// Section-local render helpers (not part of the library)
// ---------------------------------------------------------------------------

/** Paint the cave background — solid warm near-black fill. */
function drawBackground(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

/**
 * Draw the lava body + surface crust.
 *
 * The body is the wave polyline closed down to the canvas bottom, filled
 * deep red. The surface crust is the same polyline stroked bright orange
 * on top. Drawn in two passes (fill then stroke) so the stroke sits on
 * top of the fill seam without bleeding.
 */
function drawLava(ctx: CanvasRenderingContext2D, surface: readonly WavePoint[]): void {
  if (surface.length === 0) return;

  // Body fill — polyline → down to bottom-right → down to bottom-left → close.
  ctx.beginPath();
  ctx.moveTo(surface[0].x, surface[0].y);
  for (let i = 1; i < surface.length; i++) {
    ctx.lineTo(surface[i].x, surface[i].y);
  }
  ctx.lineTo(surface[surface.length - 1].x, CANVAS_H);
  ctx.lineTo(surface[0].x, CANVAS_H);
  ctx.closePath();
  ctx.fillStyle = COLOR_LAVA_BODY;
  ctx.fill();

  // Surface crust stroke (drawn after the fill so it isn't covered).
  ctx.beginPath();
  ctx.moveTo(surface[0].x, surface[0].y);
  for (let i = 1; i < surface.length; i++) {
    ctx.lineTo(surface[i].x, surface[i].y);
  }
  ctx.strokeStyle = COLOR_LAVA_SURFACE;
  ctx.lineWidth = SURFACE_LINE_WIDTH;
  ctx.stroke();
}

/**
 * Draw a batch of particles as filled circles with per-particle alpha and
 * size interpolated over lifetime.
 *
 * `fallbackColor` is used only if a particle has no `color` field (none
 * of the lava-pool particles hit that branch — both emitters and the
 * splash burst set `color` explicitly — but the parameter is here for
 * defensive parity with the Particle contract).
 *
 * The radius is floored at 0.5 so a fully-shrunk particle still renders
 * as a single pixel (matches the pixel-art aesthetic).
 */
function drawParticles(ctx: CanvasRenderingContext2D, particles: readonly Particle[], fallbackColor: string, sizeStart: number, sizeEnd: number, alphaStart: number, alphaEnd: number): void {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const alpha = particleAlphaCurve(p, alphaStart, alphaEnd);
    const radius = particleSizeCurve(p, sizeStart, sizeEnd);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color ?? fallbackColor;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, radius), 0, Math.PI * 2);
    ctx.fill();
  }
  // Reset alpha so subsequent draws (next frame's background fill) aren't
  // accidentally translucent.
  ctx.globalAlpha = 1;
}
