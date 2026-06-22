# API Proposal: DPR Canvas Scaling

> Target pillar: 1. Module: `src/primitives/`.
> Builds on research: mobile-friendliness audit (zero `devicePixelRatio` handling in `src/` or `showcase/`).
> Status: DRAFT.

## Consumer Need

All three showcase sections (hero, lava-pool, playground) create canvases with fixed intrinsic resolution (320×320, 480×280, 600×400) and no `devicePixelRatio` handling. On 2×/3× Retina displays, the browser upscales these canvases → blurry rendering. Spitekeep already handles DPR inline in `main.ts:374` and `devil-studio.ts:1117` with a hand-rolled `window.devicePixelRatio || 1` pattern. The library should provide a defensive, reusable helper so consumers get crisp rendering without repeating the same boilerplate.

**What becomes possible:** Crisp canvas rendering on all DPR displays. Consumers call one function at canvas setup, pass the returned DPR into their render code, and their pixel-art / procedural art renders sharp.

## Approach A: Two Functions — Reader + Applier

**Source pattern:** Mirrors `src/primitives/motion.ts` (cached defensive host reader) + Spitekeep's `main.ts:373-387` (canvas sizing boilerplate extracted into a reusable call).

**Signature sketch:**

```ts
// In src/primitives/dpr.ts

/** Fallback DPR when window is unavailable (Node, SSR, test). */
export const FALLBACK_DPR = 1;

let cachedDpr: number | null = null;

/**
 * Read the host's `window.devicePixelRatio`. Result is cached for the
 * lifetime of the module. Returns `FALLBACK_DPR` in any of these cases:
 *   - `window` is undefined (Node unit tests, SSR, workers)
 *   - `window.devicePixelRatio` is missing (very old browsers)
 *   - Reading throws (rare; treated as 1×)
 *
 * Defensive by design: a missing or broken DPR never crashes a game.
 */
export function getDevicePixelRatio(): number {
  if (cachedDpr !== null) return cachedDpr;
  try {
    if (typeof window === 'undefined' || typeof window.devicePixelRatio !== 'number') {
      cachedDpr = FALLBACK_DPR;
    } else {
      cachedDpr = window.devicePixelRatio;
    }
  } catch {
    cachedDpr = FALLBACK_DPR;
  }
  return cachedDpr;
}

/**
 * Reset the cached DPR. Exposed for tests that need to simulate
 * different DPR values in the same process. Not intended for game code.
 */
export function resetDprCacheForTests(): void {
  cachedDpr = null;
}

/**
 * Resize a canvas's backing store to match its CSS dimensions × DPR,
 * producing a crisp rendering surface on high-DPI displays.
 *
 * Sets `canvas.width` and `canvas.height` to `cssW * dpr` and
 * `cssH * dpr` (the backing-store pixel dimensions). Does NOT set
 * `canvas.style.width` / `canvas.style.height` — the consumer owns CSS
 * sizing (CSS may be driven by layout, a parent container, or explicit
 * rules — the library must not override it).
 *
 * Does NOT call `ctx.scale(dpr, dpr)` — the consumer composes the DPR
 * scale with their own transforms (camera, zoom, letterbox). Returns
 * the DPR so the caller can apply it where needed.
 *
 * @returns The device pixel ratio used for sizing.
 */
export function resizeCanvasToBackingStore(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
): number {
  const dpr = getDevicePixelRatio();
  canvas.width = Math.max(1, Math.round(cssWidth * dpr));
  canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  return dpr;
}
```

**Usage example — simple canvas setup:**

```ts
import { getDevicePixelRatio, resizeCanvasToBackingStore } from 'aicraft-engine/src/primitives';

const canvas = document.querySelector<HTMLCanvasElement>('.game-canvas')!;
const ctx = canvas.getContext('2d')!;

// Option 1: Use resizeCanvasToBackingStore (common path)
const dpr = resizeCanvasToBackingStore(canvas, 600, 400);
ctx.scale(dpr, dpr);

// All subsequent drawing uses CSS-pixel coordinates — crisp on any DPR.
ctx.fillRect(10, 10, 32, 32);

// Option 2: Use getDevicePixelRatio directly (custom sizing)
const dpr = getDevicePixelRatio();
canvas.width = Math.max(1, Math.round(600 * dpr));
canvas.height = Math.max(1, Math.round(400 * dpr));
// Consumer applies their own transform composition:
ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * offsetX, dpr * offsetY);
```

**Usage example — input coordinate mapping (lava-pool pattern):**

```ts
// After DPR-aware canvas sizing, pointer coords need inverse mapping.
// The consumer already does this — see lava-pool.ts:484-491.
canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  // rect.width/height are CSS px; canvas.width/height are device px.
  // Divide by (dpr * zoom) or by (rect.width / intrinsicWidth) depending
  // on the transform stack. The key point: dpr is available because
  // resizeCanvasToBackingStore returned it, or getDevicePixelRatio() was called.
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;
});
```

**Trade-offs:**
- **Ergonomics:** Two separate calls for the simple path (`resizeCanvasToBackingStore` + `ctx.scale`). Slightly more verbose than a single "do everything" function, but the extra call is trivial. The naming reads like English: "resize the canvas to the backing store size."
- **Determinism:** `getDevicePixelRatio()` reads the host once and caches. The returned value flows into consumer code as a parameter — the deterministic contract is preserved. The consumer passes `dpr` into their render function, exactly as the architecture prescribes for DOM reads.
- **Runtime cost:** One `Math.round` + two property writes per resize. Negligible.
- **Consumer complexity:** Low. The consumer calls `resizeCanvasToBackingStore` at setup and on resize, then `ctx.scale(dpr, dpr)` once. Input mapping uses standard `getBoundingClientRect` math (already in lava-pool.ts).
- **Tree-shake-ability:** Each export is individually useful. A consumer who only needs the DPR reader imports `getDevicePixelRatio`; a consumer who needs the full setup imports `resizeCanvasToBackingStore`. The two functions share the same cached state but are independent entry points.
- **Convention fit:** Matches `motion.ts` exactly (cached reader + test reset). The naming convention (`getDevicePixelRatio`, `resetDprCacheForTests`, `resizeCanvasToBackingStore`) follows the library's verb-noun pattern. JSDoc on every export. `FALLBACK_DPR` constant avoids magic number `1`.

**What this makes easy:**
- Adding DPR support to any canvas with 2 lines of code.
- Composing DPR with camera/zoom/letterbox transforms (the consumer controls the full transform stack).
- Testing — `resetDprCacheForTests()` lets tests simulate 1× and 3× in the same process.
- Tree-shaking — a consumer who only needs the reader doesn't pull in canvas DOM code.

**What this makes hard:**
- Nothing. The two-function split is the minimal viable API. If a consumer wants CSS sizing too, they write one more line (`canvas.style.width = '600px'`). The library must not own CSS because it varies by layout context.

## Approach B: Single "Do Everything" Function

**Source pattern:** Hypothetical convenience wrapper. No direct precedent in the codebase — this is the "batteries-included" alternative.

**Signature sketch:**

```ts
// In src/primitives/dpr.ts

export const FALLBACK_DPR = 1;

let cachedDpr: number | null = null;

export function getDevicePixelRatio(): number {
  // Same defensive reader as Approach A
}

export function resetDprCacheForTests(): void {
  cachedDpr = null;
}

/**
 * Configure a canvas for crisp DPR-aware rendering. Sets backing store
 * dimensions, applies CSS sizing, scales the context, and returns the
 * DPR for the consumer's reference.
 *
 * @returns The device pixel ratio applied.
 */
export function setupCrispCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  ctx?: CanvasRenderingContext2D,
): number {
  const dpr = getDevicePixelRatio();
  canvas.width = Math.max(1, Math.round(cssWidth * dpr));
  canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  return dpr;
}
```

**Usage example:**

```ts
import { setupCrispCanvas } from 'aicraft-engine/src/primitives';

const canvas = document.querySelector<HTMLCanvasElement>('.game-canvas')!;
const ctx = canvas.getContext('2d')!;
const dpr = setupCrispCanvas(canvas, 600, 400, ctx);

// Canvas is now fully configured. Draw in CSS-pixel coordinates.
ctx.fillRect(10, 10, 32, 32);
```

**Trade-offs:**
- **Ergonomics:** One call does everything. The simplest possible consumer code. But the simplicity is deceptive — it only works for the simple case.
- **Determinism:** Same as A — the DPR is read once and cached. But `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` replaces the entire transform matrix, which clobbers any consumer transforms already on the context. Consumers with camera/zoom/letterbox must call this BEFORE setting up their own transforms, or skip the `ctx` parameter and scale manually.
- **Runtime cost:** Same as A, plus a `style.width`/`style.height` write and a `setTransform` call. Negligible.
- **Consumer complexity:** Low for simple cases. High for complex cases — the consumer must understand the transform ordering constraint, or avoid passing `ctx` and handle scaling themselves (which defeats the purpose). The optional `ctx` parameter is a code smell: it means the function does different things depending on whether you pass it.
- **Tree-shake-ability:** Worse than A. The `setupCrispCanvas` function pulls in both canvas DOM manipulation and context transform logic — a consumer who only wants the DPR reader still gets the canvas code in the bundle if they import `setupCrispCanvas`. (Tree-shaking can help if the consumer only imports `getDevicePixelRatio`, but the "convenience" function encourages importing the whole thing.)
- **Convention fit:** The function name `setupCrispCanvas` doesn't match the library's naming patterns (verb-noun for pure ops, `createX` for factories). Setting `canvas.style` violates the principle that the library should not own CSS — CSS sizing is layout-dependent (flex containers, responsive widths, parent-controlled sizing). A library that sets `style.width` fights the consumer's layout. The optional `ctx` parameter is uncharacteristic — the library's other primitives either take `ctx` as required or don't touch it.

**What this makes easy:**
- One-call setup for the simplest case (fixed-size canvas, no letterbox, no zoom).

**What this makes hard:**
- Composing with camera/zoom/letterbox transforms (the consumer must skip the `ctx` param or reorder their setup).
- CSS layouts where the canvas width/height is controlled by a parent container (the function's `style.width`/`style.height` override would fight CSS).
- Testing different DPR values — the `ctx.setTransform` call has side effects that are hard to verify without a real canvas context.
- Tree-shaking — the convenience function bundles canvas DOM, CSS, and context logic together.

## Comparison Table

| Criterion | A: Two Functions | B: Single Function |
|---|---|---|
| Ergonomics | Good — 2 lines for the common path | Excellent — 1 line for the simple case |
| Determinism correctness | Excellent — explicit parameter flow | Good — but `setTransform` clobbers transform state |
| Runtime cost | Negligible | Negligible |
| Consumer complexity | Low — composable | Low for simple, high for complex (transform ordering) |
| Tree-shake-ability | Excellent — each export independent | Moderate — convenience bundles DOM + CSS + ctx |
| Convention fit | Excellent — matches `motion.ts` pattern | Poor — `style.width` ownership, optional `ctx` param |
| Composability | Excellent — consumer controls full transform stack | Poor — `setTransform` replaces existing transforms |
| Testability | Excellent — pure reader + pure applier | Moderate — `setTransform` side effect needs real ctx |
| Public API stability | Stable — additive-only | Risky — changing `style.width` behavior is a breaking change if consumers depend on it |

## Recommendation

**Approach A: Two Functions.** The `getDevicePixelRatio()` reader + `resizeCanvasToBackingStore()` applier split is the right API. It matches the `motion.ts` defensive-adapter pattern exactly, keeps CSS ownership with the consumer (the library must not fight layouts), gives consumers full control over the transform stack (critical for camera/zoom/letterbox compositions like Spitekeep's `main.ts:768`), and each export is independently tree-shakeable. The 1-line convenience of Approach B is not worth the composability cost — consumers with real games (camera, zoom, viewport clamping) would immediately outgrow it and fall back to calling `getDevicePixelRatio()` directly anyway.

## Open Questions for @architect

1. **CSS sizing in `resizeCanvasToBackingStore`:** Should the function optionally accept a `styleWidth`/`styleHeight` to set `canvas.style`, or should CSS always be consumer-owned? I recommend consumer-owned (Approach A as written), but if the architect thinks the convenience is worth the coupling, an optional `cssWidth`/`cssHeight` on `resizeCanvasToBackingStore` could work.

2. **`roundRect` compatibility:** Should `resizeCanvasToBackingStore` also set `image-rendering: pixelated` on the canvas for pixel-art consumers? I recommend against it — that's a CSS concern, and pixel-art consumers can set it themselves. But flagging it for awareness.

3. **Should `resizeCanvasToBackingStore` clamp to `devicePixelRatio` rounded to an integer?** Some browsers report fractional DPR (e.g. 1.5, 2.5). The `Math.round` in the current sketch handles this, but should we document that the backing store may be slightly larger/smaller than the exact device pixels?
