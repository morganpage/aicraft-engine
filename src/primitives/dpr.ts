/**
 * DPR (device-pixel-ratio) canvas-scaling helper.
 *
 * Mirrors `src/primitives/motion.ts`'s defensive-adapter shape (lazy `window`
 * resolution, cached reader, try/catch, in-Node fallback, test-reset hook)
 * with ONE architect-mandated divergence documented on
 * `resizeCanvasToBackingStore` below.
 *
 * Layer / determinism contract — HOST-TOUCHING, NOT deterministic.
 *
 * This module reads `window.devicePixelRatio`, a host property. It MUST NOT
 * be called from inside the fixed-step simulation. The consumer calls
 * `resizeCanvasToBackingStore` (or `getDevicePixelRatio`) at canvas setup /
 * on a `resize` event, receives the DPR as a return value, and passes it
 * into their render code as a parameter — exactly the discipline prescribed
 * in `docs/architecture.md` rule 4 ("No DOM reads in deterministic code.
 * Pass viewport / DPR / motion preference in as parameters"). Mirrors the
 * contract language on `motion.ts`.
 */

/** Fallback DPR returned in Node / SSR / test envs (no `window`) and on any
 *  read throw. The value `1` means "1 backing-store pixel per CSS pixel" —
 *  i.e. the canvas is sized exactly to its CSS dimensions. */
export const FALLBACK_DPR = 1;

/** Cache for `getDevicePixelRatio`. `null` = not yet probed. */
let cachedDpr: number | null = null;

/**
 * Read the host's `window.devicePixelRatio` ONCE and cache the result for
 * the lifetime of the module.
 *
 * Returns `FALLBACK_DPR` in any of these cases:
 *   - `window` is undefined (Node unit tests, SSR, workers)
 *   - `window.devicePixelRatio` is missing or not a number (very old browsers)
 *   - Reading throws (rare; treated as 1×)
 *
 * Intended for one-shot startup consumers that read DPR once at boot. For
 * the canvas-resize path (which fires on `resize` events and must observe
 * DPR changes at runtime), use {@link resizeCanvasToBackingStore} — it reads
 * DPR fresh each call (see its JSDoc for rationale).
 *
 * Defensive by design: a missing or broken DPR never crashes a game.
 *
 * @returns The cached device pixel ratio (1 in Node/SSR).
 */
export function getDevicePixelRatio(): number {
  if (cachedDpr !== null) return cachedDpr;
  try {
    if (typeof window === 'undefined') {
      cachedDpr = FALLBACK_DPR;
    } else {
      // Read once into a local so a getter-backed `devicePixelRatio` (rare,
      // but possible on a proxied host) fires exactly one access per probe.
      const dpr = window.devicePixelRatio;
      cachedDpr = typeof dpr === 'number' ? dpr : FALLBACK_DPR;
    }
  } catch {
    cachedDpr = FALLBACK_DPR;
  }
  return cachedDpr;
}

/**
 * Reset the cached DPR. Exposed for tests that need to simulate different
 * DPR values in the same process. Not intended for game code. Mirrors
 * `resetMotionCacheForTests` exactly.
 */
export function resetDprCacheForTests(): void {
  cachedDpr = null;
}

/**
 * Read `window.devicePixelRatio` FRESH — no cache.
 *
 * Architect's fix: `devicePixelRatio` changes at runtime (window dragged
 * between monitors of different DPI, browser zoom). The cached reader
 * `getDevicePixelRatio` is correct for `prefers-reduced-motion`-style
 * preferences that effectively never change mid-session, but NOT for DPR —
 * a consumer calling `resizeCanvasToBackingStore` on a `resize` event
 * expects fresh DPR, not a stale value cached from the original monitor.
 * So the resize path bypasses the cache entirely.
 */
function readFreshDevicePixelRatio(): number {
  try {
    if (typeof window === 'undefined') return FALLBACK_DPR;
    const dpr = window.devicePixelRatio;
    return typeof dpr === 'number' ? dpr : FALLBACK_DPR;
  } catch {
    return FALLBACK_DPR;
  }
}

/**
 * Resize a canvas's backing store to match its CSS dimensions × DPR,
 * producing a crisp rendering surface on high-DPI displays.
 *
 * Sets `canvas.width` and `canvas.height` to `round(cssWidth × dpr)` and
 * `round(cssHeight × dpr)` (the backing-store pixel dimensions). Returns
 * the fresh DPR so the caller can compose it into their transform —
 * typically `ctx.scale(dpr, dpr)` so subsequent drawing in CSS-pixel
 * coordinates lands on the correct backing-store pixels.
 *
 * Reads DPR **fresh each call** (own defensive try/catch), NOT via the
 * cached `getDevicePixelRatio` — see {@link readFreshDevicePixelRatio}'s
 * rationale. The whole body is wrapped in a try/catch that swallows any
 * error (e.g. a canvas whose `width` setter throws in a host quirk) and
 * returns `FALLBACK_DPR`; the public API never throws, per the defensive
 * adapter contract (`docs/architecture.md` §Adapter pattern).
 *
 * **Rulings applied (architect):**
 *   1. **CSS sizing is consumer-owned.** This function does NOT touch
 *      `canvas.style.width` / `canvas.style.height`. CSS sizing is driven
 *      by layout (flex containers, responsive widths, parent rules) and
 *      the library must not fight it.
 *   2. **No `image-rendering: pixelated`.** Aesthetic choice, not the
 *      library's job.
 *   3. **Fractional DPR rounds via `Math.round`** (e.g. 1.5 → 2). Rounding
 *      DOWN would make the backing store SMALLER than the physical pixels
 *      and blur the result; rounding UP is harmless (a few extra rendered
 *      pixels).
 *
 * **Layer / determinism contract — HOST-TOUCHING, NOT deterministic.**
 * Call at canvas setup / on `resize`; never inside the fixed-step sim. The
 * returned DPR flows into render code as a parameter, mirroring the
 * discipline on `motion.ts`.
 *
 * @example
 * ```ts
 * const canvas = document.querySelector<HTMLCanvasElement>('.game-canvas')!;
 * const ctx = canvas.getContext('2d')!;
 * const dpr = resizeCanvasToBackingStore(canvas, 600, 400);
 * ctx.scale(dpr, dpr); // subsequent drawing uses CSS-pixel coordinates
 * ```
 *
 * @param canvas - The canvas whose backing store to resize.
 * @param cssWidth - CSS-pixel width (matches the layout size).
 * @param cssHeight - CSS-pixel height (matches the layout size).
 * @returns The fresh device pixel ratio used (caller composes it into the
 *   context transform). Returns `FALLBACK_DPR` if any error is swallowed.
 */
export function resizeCanvasToBackingStore(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
): number {
  try {
    const dpr = readFreshDevicePixelRatio();
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    return dpr;
  } catch {
    return FALLBACK_DPR;
  }
}
