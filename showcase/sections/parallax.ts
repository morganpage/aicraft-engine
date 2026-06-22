/**
 * Section 4 — Parallax background.
 *
 * The first showcase section to consume RASTER ART: four PNG layers painted
 * by gpt-image-2, greenscreen-keyed, mirror-padded for seamless tiling, and
 * scrolled across the viewport by the library's `drawTiledParallax`. This
 * proves the library's `drawTile` callback is asset-agnostic — it was
 * validated with procedurally-drawn tiles (see parallax.ts JSDoc examples)
 * and now composes real image assets with zero API changes.
 *
 * Architecture: each layer is a single seamless tile drawn back-to-front via
 * `drawTiledParallax`, which computes the Optimal Branching Remainder
 * geometry internally (startX + copies) and invokes the callback once per
 * copy. The callback draws the full source image scaled to the on-screen
 * tile size; the camera advances at a fixed dt so the scroll is
 * frame-rate-independent. Transparent PNGs composite over the opaque sky.
 *
 * Motion-gated: if the user prefers reduced motion, a single static frame at
 * cameraX = 0 is rendered after the images decode and the rAF loop is never
 * started. Mirrors hero.ts §motion-gate.
 *
 * Local state: this section does NOT extend `GlobalState` — the pause state
 * and scroll-speed multiplier are presentation controls, not simulation
 * state. The `store` parameter is accepted to match the section-init
 * signature but is intentionally unused (prefixed `_`).
 */

import { drawTiledParallax, resizeCanvasToBackingStore } from '../../src/primitives';
import { shouldAnimate } from '../helpers/motion-gate';
import type { Store } from '../store';
import type { GlobalState } from '../main';

// Vite asset imports — resolved to URL strings at build time. Typed via the
// `vite/client` ambient module declarations (declare module '*.png'), pulled
// in by both showcase/tsconfig.json (`types: ["vite/client"]`) and the
// triple-slash reference in showcase/vite-env.d.ts.
import skyUrl from '../assets/parallax/sky.png';
import farFortressUrl from '../assets/parallax/far-fortress.png';
import midRuinsUrl from '../assets/parallax/mid-ruins.png';
import foregroundUrl from '../assets/parallax/foreground.png';

/** Fixed timestep (seconds per tick) — mirrors hero.ts. The camera advances
 *  by exactly DT × SCROLL_SPEED × speedMultiplier each frame so the scroll
 *  speed is frame-rate-independent (deterministic per-tick; rAF provides only
 *  wall-clock cadence). */
const DT = 1 / 60;

/** Canvas dimensions. 640×320 (2:1) matches the tiles' 2:1 source aspect
 *  ratio (2048×1024) so `drawImage` to canvas dims scales uniformly — zero
 *  horizontal/vertical distortion. */
const CANVAS_W = 640;
const CANVAS_H = 320;

/** On-screen tile width = canvas width. Each layer's source PNG is drawn
 *  into a CANVAS_W-wide tile, so exactly one full tile (+ a partial when the
 *  camera is mid-tile) covers the viewport — tiledParallaxRange computes the
 *  exact copy count via the Optimal Branching Remainder formula. */
const TILE_W = CANVAS_W;

/** Base scroll speed (px/sec) at speedMultiplier = 1. 60 px/sec = 1 px/tick
 *  at 60fps — a gentle pan. The near layer (factor 0.85) scrolls at ~0.85
 *  px/tick; the sky (0.10) at ~0.10 px/tick. */
const SCROLL_SPEED = 60;

/** Placeholder fill shown before the PNGs decode — a dark underworld sky so
 *  the stage isn't a blank rectangle during the (brief) async load window. */
const COLOR_PLACEHOLDER = '#0a0612';

/**
 * Sub-pixel seam overscan: draw each tile 1px wider than its logical width
 * so adjacent copies overlap by 1px, eliminating hairline seams during
 * sub-pixel (fractional-cameraX) scrolling. Per the `drawTiledParallax` JSDoc
 * overscan guidance. Invisible for painted (non-pixel) art — the 1px
 * horizontal stretch over a 640px tile is sub-perceptible.
 */
const OVERSCAN_PX = 1;

/**
 * One parallax layer: a scene-tuned depth factor and the decoded image to
 * tile. Drawn back-to-front; transparent PNGs composite over the opaque sky.
 */
interface ParallaxLayer {
  /**
   * Depth factor (0 = static, 1 = gameplay speed). SCENE-SPECIFIC TUNING —
   * these are NOT the library's `PARALLAX_FAR`/`PARALLAX_MID`/`PARALLAX_NEAR`
   * constants (0.25 / 0.5 / 1.0): this scene uses a wider, gentler spread
   * (0.10 / 0.25 / 0.50 / 0.85) tuned for painted underworld art, giving a
   * deeper apparent depth gradient than the library's generic defaults.
   */
  readonly factor: number;
  /** The decoded seamless tile (2048×1024, mirror-padded + greenscreen-keyed). */
  readonly image: HTMLImageElement;
}

/**
 * Initialize the parallax-background section.
 *
 * Sets up the DPR-aware canvas, wires the pause/play + speed controls, then
 * asynchronously loads + decodes the four PNG layers. Once decoded, renders
 * the initial frame (cameraX = 0) and — unless reduced motion is preferred —
 * starts a fixed-dt rAF loop that auto-scrolls the camera rightward forever.
 *
 * @param container - the `<section id="parallax">` element
 * @param _store - the global observable store. Intentionally unused — the
 *   pause / speed controls are presentation state local to this section.
 *   Accepted only to match the uniform section-init signature.
 */
export function initParallax(
  container: HTMLElement,
  // Underscore-prefixed: TypeScript's `noUnusedParameters` exempts these.
  // The store is accepted to keep the section signature uniform with
  // initHero / initLavaPool; the parallax background runs entirely on local
  // state (no shared seed concept).
  _store: Store<GlobalState>,
): void {
  const canvas = container.querySelector<HTMLCanvasElement>('.parallax-canvas')!;
  const ctx = canvas.getContext('2d')!;
  // DPR-aware backing store: canvas.width/height = CSS size × devicePixelRatio
  // so the painted art renders crisp on Retina / high-DPI mobile. CSS sizing
  // is owned by style.css — we only set the backing store + scale the context,
  // so all subsequent drawing continues to use CSS-pixel coordinates.
  const dpr = resizeCanvasToBackingStore(canvas, CANVAS_W, CANVAS_H);
  ctx.scale(dpr, dpr);

  const playBtn = container.querySelector<HTMLButtonElement>('.parallax-play')!;
  const speedSlider = container.querySelector<HTMLInputElement>('.parallax-speed')!;
  const speedValue = container.querySelector<HTMLElement>('.parallax-speed-value')!;

  // Placeholder paint — shown until the PNGs decode so the stage isn't blank.
  ctx.fillStyle = COLOR_PLACEHOLDER;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // --- Local control state -------------------------------------------------

  // Pause flag. When true the loop keeps rendering (so it's alive for an
  // immediate unpause and picks up slider changes) but cameraX does NOT
  // advance — the scene freezes in place.
  let paused = false;

  /** Toggle pause + sync the button's icon/text + aria-pressed. */
  const applyPaused = (next: boolean): void => {
    paused = next;
    const span = playBtn.querySelector('span');
    if (span) span.textContent = next ? '▶ Play' : '⏸ Pause';
    playBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
  };
  applyPaused(false);

  // Speed multiplier (0–2). Scales SCROLL_SPEED. Live label mirrors the hero
  // speed slider ("1.0×"). Local to this section; not in GlobalState.
  let speedMultiplier = 1;
  const applySpeed = (value: number): void => {
    speedMultiplier = value;
    speedValue.textContent = `${value.toFixed(1)}×`;
  };
  applySpeed(Number(speedSlider.value));

  // --- Camera + render state ----------------------------------------------

  // cameraX grows UNBOUNDED as the scene scrolls rightward. This is safe by
  // design: the library's `tiledParallaxRange` wraps via `% tileWidth`
  // internally, so only the remainder determines the draw geometry — infinite
  // seamless scroll just works for mirror-padded tiles. Float64 represents
  // integers exactly up to 2^53, so precision is a non-issue for any
  // realistic session length (1 px/tick × 60 fps × 24 h ≈ 5.2M px, far below
  // the precision ceiling).
  let cameraX = 0;

  // Layers — populated once the async decode resolves. Empty until then;
  // render() is a no-op clear until the first real paint.
  let layers: readonly ParallaxLayer[] = [];

  let rafId = 0;

  /** Render one frame at the current cameraX. Clears, then draws each layer
   *  back-to-front via `drawTiledParallax` (sky → far-fortress → mid-ruins →
   *  foreground). Transparent PNGs composite over the opaque sky so depth
   *  reads correctly. */
  const render = (): void => {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      drawTiledParallax(
        ctx,
        // Asset-agnostic callback: draw the full source image into an
        // on-screen tile at screenX. Width = TILE_W + OVERSCAN_PX so adjacent
        // copies overlap by 1px (sub-pixel seam mitigation; see OVERSCAN_PX).
        (c, x) => c.drawImage(layer.image, x, 0, TILE_W + OVERSCAN_PX, CANVAS_H),
        cameraX,
        layer.factor,
        TILE_W,
        CANVAS_W,
      );
    }
  };

  // --- Controls ------------------------------------------------------------

  // ⏸/▶ Pause toggle. The loop keeps running (render() each frame) so the
  // section is alive for an immediate unpause; only cameraX advancement is
  // gated. Blur afterwards so keyboard focus doesn't linger on the button.
  playBtn.addEventListener('click', () => {
    applyPaused(!paused);
    playBtn.blur();
  });

  // Speed slider — updates local state; the loop reads speedMultiplier fresh
  // each tick so scrubbing is immediately reflected in the scroll cadence.
  speedSlider.addEventListener('input', () => {
    applySpeed(Number(speedSlider.value));
  });

  // --- Start the scroll loop ----------------------------------------------
  // Hoisted into its own closure so the visibilitychange handler (registered
  // inside) can resume it after the tab is re-shown. Called once, after the
  // images decode and the reduced-motion gate passes.
  const startLoop = (): void => {
    const loop = (): void => {
      if (!paused) {
        cameraX += SCROLL_SPEED * DT * speedMultiplier;
      }
      render();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    // Pause when the tab is hidden — saves CPU and avoids huge catch-up
    // scrolls when the tab is re-shown. Mirrors hero.ts §visibility.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        cancelAnimationFrame(rafId);
      } else if (!shouldAnimate()) {
        rafId = requestAnimationFrame(loop);
      }
    });
  };

  // --- Async image load → initial paint → motion gate → loop --------------
  //
  // Decode all four PNGs before the first real paint. `img.decode()` resolves
  // once the image is fully loaded AND decoded into a GPU-ready form, so the
  // first drawImage is immediate (no pop-in / partial-decode flicker). Vite
  // resolves the static URL strings at build time; in dev they point at the
  // served asset. The async IIFE keeps initParallax's signature `void` (the
  // caller in main.ts does not await).
  void (async (): Promise<void> => {
    try {
      const [sky, farFortress, midRuins, foreground] = await Promise.all([
        decodeImage(skyUrl),
        decodeImage(farFortressUrl),
        decodeImage(midRuinsUrl),
        decodeImage(foregroundUrl),
      ]);

      // SCENE-SPECIFIC depth factors — see ParallaxLayer.factor JSDoc. These
      // are NOT the library's PARALLAX_FAR/MID/NEAR constants; they are tuned
      // for this painted underworld scene's depth gradient.
      layers = [
        { factor: 0.1, image: sky },
        { factor: 0.25, image: farFortress },
        { factor: 0.5, image: midRuins },
        { factor: 0.85, image: foreground },
      ];

      // Initial paint at cameraX = 0 — also serves as the single static frame
      // for the reduced-motion branch.
      render();

      // Motion gate: if reduced motion is preferred, the render() above is the
      // single static frame; DO NOT start the rAF loop. Mirrors hero.ts
      // §motion-gate and lava-pool.ts §motion-gate.
      if (shouldAnimate()) {
        return;
      }

      startLoop();
    } catch {
      // Image decode failed — the placeholder fill remains on the canvas and
      // the loop never starts. No crash; the showcase's other sections
      // continue to work. (Local bundled assets shouldn't fail, but this is
      // defensive against a bad build / missing file / network error.)
    }
  })();
}

// ---------------------------------------------------------------------------
// Section-local helpers (not part of the library)
// ---------------------------------------------------------------------------

/**
 * Load + decode a single image from a URL.
 *
 * Sets `img.src` then awaits `img.decode()`, which resolves once the image is
 * fully loaded AND decoded — ready for an immediate `drawImage` with no
 * pop-in. Rejects on load or decode failure; the caller's `Promise.all`
 * propagates so the section's async IIFE catch handles it.
 *
 * @param url - the image URL (a Vite-resolved asset string)
 * @returns the decoded HTMLImageElement
 */
function decodeImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img);
}
