# API Proposal: Seamless-Tiled Parallax Wrap Helper

> Target pillar: 1 (Primitives). Module: `src/primitives/`.
> Builds on research: `docs/research/seamless-tiled-parallax.md`.
> Status: DRAFT.

## Consumer Need

Games like the consumer game and future consumer titles need infinite-scroll parallax backgrounds — layered textures or procedural shapes that tile seamlessly and scroll at varying depths. Today, the consumer game draws a static `ctx.createLinearGradient` for its background (`renderer.ts:122-146`). There is no parallax scrolling, no tiling, no depth illusion.

Without this module:
- Every consumer hand-rolls the modulo-wrap + copy-count math, duplicating 15-20 lines of identical geometry per layer.
- Edge cases (negative camera, perfect grid alignment, sub-pixel seams, zero tile width) are each consumer's bug surface.
- The Optimal Branching Remainder formula from the research note (which avoids drawing an extra off-screen tile at perfect alignment) must be re-discovered by every game.

With this module shipped:
- A single `tiledParallaxRange(cameraX, factor, tileWidth, viewportWidth)` call returns `{ startX, copies }` — the exact geometry for the draw loop.
- Edge cases are handled once, at the library level, with a defensive guard against zero/negative tile widths.
- Consumers compose this with their existing rendering pipeline — no coupling to `CanvasRenderingContext2D`, no asset assumptions.

---

## Approach A: Pure 1D Geometry Helper

**Source pattern:** Research note §Pattern 1 (Optimal Branching Remainder) + §Pattern 2 (Viewport-Relative Screen-Space Anchor). The core insight: compute the leftmost draw coordinate and copy count using pure arithmetic, leaving the draw loop to the consumer.

**Idea:** Ship a single pure function that returns geometry only. The consumer writes the `for` loop and calls `ctx.drawImage` (or draws procedural shapes). Mirrors the existing `parallaxOffset` philosophy: "library gives you numbers, you do the drawing."

**Signature sketch:**

```ts
// In src/primitives/parallax.ts

/** Result geometry for a seamless-tiled parallax layer along one axis. */
export interface TiledParallaxRange {
  /** Leftmost (or topmost) screen-space coordinate to begin drawing. Always ≤ 0. */
  readonly startX: number;
  /** Number of tile copies needed to cover the viewport. Always ≥ 1 (or 0 if tileWidth ≤ 0). */
  readonly copies: number;
}

/**
 * Compute the draw geometry for a seamlessly tiled parallax background layer
 * along a single axis.
 *
 * Given a camera coordinate, a parallax depth factor, a seamless tile size,
 * and a viewport size, returns the leftmost screen-space coordinate to start
 * drawing at and how many tile copies are needed to fully cover the viewport.
 *
 * Uses the Optimal Branching Remainder formula: when the camera aligns
 * perfectly with the tile grid, `startX` is exactly `0` — avoiding a
 * wasted off-screen `drawImage` call on the left edge.
 *
 * The consumer writes the draw loop:
 * ```ts
 * const r = tiledParallaxRange(cam.x, PARALLAX_FAR, 256, viewport.width);
 * for (let i = 0; i < r.copies; i++) {
 *   drawMyTile(ctx, r.startX + i * 256, y);
 * }
 * ```
 *
 * **Defensive guard:** If `tileWidth` is zero or negative, returns
 * `{ startX: 0, copies: 0 }` — preventing infinite loops
 * and division-by-zero. Documented; consumer checks `copies > 0`.
 *
 * **Sub-pixel seam mitigation:** To prevent 1px gaps between tiles at
 * sub-pixel camera positions, the consumer can draw each tile 1px wider
 * than its logical width: `drawImage(img, x, y, tileWidth + 1, tileHeight)`.
 * This "overscan" overlaps adjacent tiles by 1px, eliminating seams while
 * preserving smooth sub-pixel scrolling. For pixel-art games, integer-snapping
 * `startX` via `Math.round` is an alternative.
 *
 * **Performance note:** `tileWidth < 1` produces many copies to cover the
 * viewport — typically undesirable, but the helper does not enforce a minimum.
 *
 * Pure: no side effects, no DOM access, no mutation, no `Math.random`.
 * Output is deterministic for identical inputs across calls.
 *
 * @param camera - camera world coordinate along this axis
 * @param factor - parallax depth factor (0 = static, 1 = gameplay speed)
 * @param tileWidth - pixel width of one seamless tile (must be > 0 for valid geometry)
 * @param viewportWidth - pixel width of the viewport along this axis
 * @returns `{ startX, copies }` — geometry for the draw loop; tile spacing is the original `tileWidth`
 *
 * @example
 * ```ts
 * // Side-scroller: far mountain layer, 256px tile, 800px viewport
 * const r = tiledParallaxRange(1200, PARALLAX_FAR, 256, 800);
 * // r.startX ≈ -100 (shifted left to cover viewport edge)
 * // r.copies = 4 (enough 256px tiles to cover 800px)
 * for (let i = 0; i < r.copies; i++) {
 *   drawMountainTile(ctx, r.startX + i * 256, 0);
 * }
 * ```
 */
export function tiledParallaxRange(
  camera: number,
  factor: number,
  tileWidth: number,
  viewportWidth: number,
): TiledParallaxRange;
```

**Usage example — 4-layer side-scroller:**

```ts
import {
  tiledParallaxRange,
  parallaxOffset,
  PARALLAX_FAR,
  PARALLAX_MID,
  PARALLAX_NEAR,
} from 'aicraft-engine/src/primitives';

// Layer definitions: [factor, tileWidth, drawFn]
const layers = [
  { factor: 0.15, tileWidth: 512, draw: drawSkyFog },       // far sky fog
  { factor: 0.30, tileWidth: 256, draw: drawFortress },     // far fortress
  { factor: 0.55, tileWidth: 128, draw: drawStatues },      // mid statues
  { factor: 0.85, tileWidth: 64,  draw: drawChains },       // near chains
];

function renderBackground(
  ctx: CanvasRenderingContext2D,
  cameraX: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  for (const layer of layers) {
    const range = tiledParallaxRange(cameraX, layer.factor, layer.tileWidth, viewportWidth);
    for (let i = 0; i < range.copies; i++) {
      layer.draw(ctx, range.startX + i * layer.tileWidth, 0, layer.tileWidth, viewportHeight);
    }
  }
}
```

**Trade-offs:**

| Dimension | Assessment |
|---|---|
| **Ergonomics** | Medium. Consumer writes a 3-line `for` loop per layer. For a 4-layer setup, that's ~12 lines of loop code + 4 `tiledParallaxRange` calls. |
| **Determinism purity** | Maximum. Pure arithmetic — no DOM, no canvas, fully testable in Node/Vitest without mocks. |
| **Runtime cost** | Lowest. One `%` operation, one branch, one `Math.ceil` per call. Negligible. |
| **Consumer complexity** | Medium. Consumer must write the draw loop, but the geometry is handed to them. |
| **Tree-shake-ability** | Excellent. Single function, single type. |
| **Convention fit** | Matches `parallaxOffset` exactly — "library gives numbers, consumer draws." Also matches `pixel.ts` helpers (`clamp`, `lerp`). |
| **Extensibility** | Maximum. Consumer adds overscan by drawing `tileWidth + 1`, integer-snaps by rounding `startX`, adds vertical tiling by calling the function again for Y axis. No forking needed. |

**What this makes easy:** Composing with any rendering approach (Canvas2D `drawImage`, procedural `fillRect`, WebGL texture binds). Adding overscan or integer snapping. Testing without canvas mocks.
**What this makes hard:** Every consumer duplicates the 3-line draw loop. For consumers who always draw tiles the same way, this is repetitive boilerplate.

**Prior-art pattern:** Research §Pattern 1 (Optimal Branching Remainder) + §Pattern 2 (Viewport-Relative Screen-Space Anchor).

**Hard-case handling:**

- **Negative camera (panning left):** `offset = -(camera * factor)` becomes positive. `startX = offset % tileWidth` yields a positive remainder, which the branching formula normalizes to `(-tileWidth, 0]`. Covered.
- **Perfect grid alignment:** When `offset % tileWidth === 0`, `startX = 0` exactly — no wasted off-screen tile. This is the key optimization from the research note.
- **Sub-pixel camera:** `startX` is a true float. The helper does NOT bake in overscan or integer snapping — the consumer chooses their seam mitigation strategy (see "Sub-pixel seam mitigation" section below).
- **Zero/negative tile width:** Guard clause returns `{ startX: 0, copies: 0 }`. Consumer's `for` loop executes zero iterations. Documented in JSDoc.

---

## Approach B: Canvas-Coupled Draw Helper with Callback

**Source pattern:** Research note §Pattern 2 (Viewport-Relative) combined with the precedent of `src/primitives/outline-rect.ts` and `src/primitives/glow.ts`, which both take a `ctx` and draw directly.

**Idea:** Ship a function that takes a `CanvasRenderingContext2D`, a `drawTile` callback, and all the geometry parameters. It internally computes the range and runs the loop. The callback is asset-agnostic — the consumer provides the drawing logic, so there's no `CanvasImageSource` coupling.

**Signature sketch:**

```ts
// In src/primitives/parallax.ts

/**
 * Draw a seamlessly tiled parallax background layer along one axis.
 *
 * Computes the Optimal Branching Remainder geometry internally and calls
 * `drawTile` for each copy needed to cover the viewport. The callback
 * receives the canvas context and the screen-space x coordinate where
 * the tile should be drawn — the consumer decides what to draw at
 * that position.
 *
 * **Defensive guard:** If `tileWidth` is zero or negative, `drawTile`
 * is never called (zero copies). Documented; no infinite loops.
 *
 * Pure of side effects beyond the caller-provided `drawTile` callback.
 * No DOM reads, no `Math.random`, no global state mutation.
 *
 * @param ctx - canvas rendering context
 * @param drawTile - callback invoked once per tile copy; receives (ctx, screenX)
 * @param camera - camera world coordinate along this axis
 * @param factor - parallax depth factor (0 = static, 1 = gameplay speed)
 * @param tileWidth - pixel width of one seamless tile (must be > 0 for valid geometry)
 * @param viewportWidth - pixel width of the viewport along this axis
 *
 * @example
 * ```ts
 * // Draw a far fortress layer across the viewport
 * drawTiledParallax(
 *   ctx,
 *   (c, x) => { c.drawImage(fortressImg, x, 0, 256, 480); },
 *   cam.x,
 *   PARALLAX_FAR,
 *   256,
 *   viewport.width,
 * );
 * ```
 */
export function drawTiledParallax(
  ctx: CanvasRenderingContext2D,
  drawTile: (ctx: CanvasRenderingContext2D, screenX: number) => void,
  camera: number,
  factor: number,
  tileWidth: number,
  viewportWidth: number,
): void;
```

**Usage example — 4-layer side-scroller:**

```ts
import {
  drawTiledParallax,
  PARALLAX_FAR,
  PARALLAX_MID,
  PARALLAX_NEAR,
} from 'aicraft-engine/src/primitives';

function renderBackground(
  ctx: CanvasRenderingContext2D,
  cameraX: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  // Sky fog — procedural fill
  drawTiledParallax(ctx, (c, x) => {
    c.fillStyle = '#1a1028';
    c.fillRect(x, 0, 512, viewportHeight);
  }, cameraX, 0.15, 512, viewportWidth);

  // Fortress — preloaded image
  drawTiledParallax(ctx, (c, x) => {
    c.drawImage(fortressImg, x, 0, 256, 480);
  }, cameraX, 0.30, 256, viewportWidth);

  // Statues — procedural shapes
  drawTiledParallax(ctx, (c, x) => {
    drawStatueSilhouette(c, x + 64, 200, 128);
  }, cameraX, 0.55, 128, viewportWidth);

  // Chains — procedural shapes
  drawTiledParallax(ctx, (c, x) => {
    drawHangingChains(c, x + 32, 0, 64, viewportHeight);
  }, cameraX, 0.85, 64, viewportWidth);
}
```

**Trade-offs:**

| Dimension | Assessment |
|---|---|
| **Ergonomics** | High for simple cases. One function call per layer — no explicit `for` loop. |
| **Determinism purity** | Good. The geometry math is pure. The function takes a `ctx` (renderer-adjacent), but that matches `outlineRect` and `drawGlow` precedent. |
| **Runtime cost** | Low. Same math internally + one function-call overhead per tile copy (~3-5 calls per layer). |
| **Consumer complexity** | Lowest for the common case. Consumer provides a callback, the library handles the loop. |
| **Tree-shake-ability** | Good. Single function. But it couples the geometry to canvas rendering — consumers who don't use Canvas2D can't use it. |
| **Convention fit** | Matches `outlineRect` and `drawGlow` (ctx-taking rendering helpers). But deviates from `parallaxOffset` (pure geometry). Two conventions in one file. |
| **Extensibility** | Medium. Consumer can add overscan by drawing wider in the callback. Integer snapping requires the consumer to round inside the callback or — less naturally — the library would need an extra parameter. Vertical tiling requires calling the function multiple times with different Y offsets. |

**What this makes easy:** Quick prototyping. Adding a tiled background layer is a single call. No loop boilerplate.
**What this makes hard:** Consumer can't inspect the geometry independently (e.g., for hit-testing, overlay placement, or debug visualization). The function returns `void` — the geometry is consumed internally. Also: consumers who don't use Canvas2D (WebGL, server-side rendering) cannot use this API.

**Prior-art pattern:** Research §Pattern 2 (Viewport-Relative) + `src/primitives/outline-rect.ts` (ctx-taking helper precedent).

**Hard-case handling:**

- **Negative camera:** Internally calls `tiledParallaxRange` logic — same formula.
- **Perfect grid alignment:** Same branching optimization — no wasted callback.
- **Sub-pixel camera:** `screenX` is a true float passed to the callback. Overscan/snapping is the consumer's choice inside the callback.
- **Zero/negative tile width:** Guard clause prevents the loop — `drawTile` never called.

---

## Approach C: Both, Layered (RECOMMENDED)

**Source pattern:** The surface-ripple proposal's hybrid pattern (Approach C in `docs/design/surface-ripple-proposal.md`): ship the pure primitive AND a thin convenience wrapper. Consumer picks the abstraction level.

**Idea:** Ship `tiledParallaxRange` (Approach A) as the pure geometry primitive, AND `drawTiledParallax` (Approach B) as a thin convenience wrapper that calls A and runs the loop internally. The consumer picks based on whether they want the geometry or just want it drawn.

**Signature sketch:**

```ts
// In src/primitives/parallax.ts

// --- Pure geometry primitive (Approach A) ---

/** Result geometry for a seamless-tiled parallax layer along one axis. */
export interface TiledParallaxRange {
  readonly startX: number;
  readonly copies: number;
}

/**
 * Compute the draw geometry for a seamlessly tiled parallax background layer
 * along a single axis.
 *
 * Uses the Optimal Branching Remainder formula: when the camera aligns
 * perfectly with the tile grid, `startX` is exactly `0` — avoiding a
 * wasted off-screen draw call on the left edge.
 *
 * **Defensive guard:** If `tileWidth` is zero or negative, returns
 * `{ startX: 0, copies: 0 }` — preventing infinite loops.
 *
 * **Sub-pixel seam mitigation:** To prevent 1px gaps between tiles at
 * sub-pixel camera positions, the consumer can draw each tile 1px wider
 * than its logical width: `drawImage(img, x, y, tileWidth + 1, tileHeight)`.
 * This "overscan" overlaps adjacent tiles by 1px, eliminating seams while
 * preserving smooth sub-pixel scrolling. For pixel-art games, integer-snapping
 * `startX` via `Math.round` is an alternative.
 *
 * **Performance note:** `tileWidth < 1` produces many copies to cover the
 * viewport — typically undesirable, but the helper does not enforce a minimum.
 *
 * Pure: no side effects, no DOM access, no mutation, no `Math.random`.
 * Output is deterministic for identical inputs across calls.
 *
 * @param camera - camera world coordinate along this axis
 * @param factor - parallax depth factor (0 = static, 1 = gameplay speed)
 * @param tileWidth - pixel width of one seamless tile (must be > 0 for valid geometry)
 * @param viewportWidth - pixel width of the viewport along this axis
 * @returns `{ startX, copies }` — geometry for the draw loop; tile spacing is the original `tileWidth`
 *
 * @example
 * ```ts
 * const r = tiledParallaxRange(1200, PARALLAX_FAR, 256, 800);
 * for (let i = 0; i < r.copies; i++) {
 *   drawMountainTile(ctx, r.startX + i * 256, 0);
 * }
 * ```
 */
export function tiledParallaxRange(
  camera: number,
  factor: number,
  tileWidth: number,
  viewportWidth: number,
): TiledParallaxRange;

// --- Convenience draw wrapper (Approach B) ---

/**
 * Draw a seamlessly tiled parallax background layer along one axis.
 *
 * Convenience wrapper: computes geometry via `tiledParallaxRange` and
 * calls `drawTile` for each copy. The callback is asset-agnostic — the
 * consumer provides the drawing logic.
 *
 * **Defensive guard:** If `tileWidth` is zero or negative, `drawTile`
 * is never called.
 *
 * @param ctx - canvas rendering context
 * @param drawTile - callback invoked once per tile copy; receives (ctx, screenX)
 * @param camera - camera world coordinate along this axis
 * @param factor - parallax depth factor (0 = static, 1 = gameplay speed)
 * @param tileWidth - pixel width of one seamless tile
 * @param viewportWidth - pixel width of the viewport along this axis
 *
 * @example
 * ```ts
 * drawTiledParallax(ctx, (c, x) => {
 *   c.drawImage(fortressImg, x, 0, 256, 480);
 * }, cam.x, PARALLAX_FAR, 256, viewport.width);
 * ```
 */
export function drawTiledParallax(
  ctx: CanvasRenderingContext2D,
  drawTile: (ctx: CanvasRenderingContext2D, screenX: number) => void,
  camera: number,
  factor: number,
  tileWidth: number,
  viewportWidth: number,
): void;
```

**Usage example — 4-layer side-scroller (consumer picks per-layer):**

```ts
import {
  tiledParallaxRange,
  drawTiledParallax,
  PARALLAX_FAR,
  PARALLAX_MID,
  PARALLAX_NEAR,
} from 'aicraft-engine/src/primitives';

function renderBackground(
  ctx: CanvasRenderingContext2D,
  cameraX: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  // --- Far sky fog: pure geometry (consumer needs to clip + fill full height) ---
  const fog = tiledParallaxRange(cameraX, 0.15, 512, viewportWidth);
  ctx.fillStyle = '#1a1028';
  for (let i = 0; i < fog.copies; i++) {
    ctx.fillRect(fog.startX + i * 512, 0, 512, viewportHeight);
  }

  // --- Far fortress: convenience wrapper ---
  drawTiledParallax(ctx, (c, x) => {
    c.drawImage(fortressImg, x, 0, 256, 480);
  }, cameraX, 0.30, 256, viewportWidth);

  // --- Mid statues: pure geometry (need custom Y per copy) ---
  const statues = tiledParallaxRange(cameraX, 0.55, 128, viewportWidth);
  for (let i = 0; i < statues.copies; i++) {
    const x = statues.startX + i * 128;
    drawStatueSilhouette(ctx, x + 64, 200, 128);
  }

  // --- Near chains: convenience wrapper ---
  drawTiledParallax(ctx, (c, x) => {
    drawHangingChains(c, x + 32, 0, 64, viewportHeight);
  }, cameraX, 0.85, 64, viewportWidth);
}
```

**Trade-offs:**

| Dimension | Assessment |
|---|---|
| **Ergonomics** | Highest. Consumer picks pure geometry for custom rendering, or convenience wrapper for quick layers. Best of both worlds. |
| **Determinism purity** | Maximum. The core is pure arithmetic. The wrapper is a thin loop over the pure core. |
| **Runtime cost** | Same as A for the pure path. One extra function-call overhead for the wrapper path (~negligible). |
| **Consumer complexity** | Lowest. Consumer picks the right abstraction level per layer. |
| **Tree-shake-ability** | Excellent. Each function is independently importable. Consumer who only needs geometry doesn't pull in the canvas wrapper. |
| **Convention fit** | Matches both `parallaxOffset` (pure geometry) AND `outlineRect`/`drawGlow` (ctx-taking helpers). Two patterns in one file, but clearly separated. |
| **Extensibility** | Maximum. Pure geometry path allows overscan, integer snapping, vertical tiling, debug visualization. Convenience path handles the 90% case. |

**What this makes easy:** Everything from A and B. Quick prototyping via `drawTiledParallax`, custom rendering via `tiledParallaxRange`. The two functions compose naturally.
**What this makes hard:** API surface is larger (2 functions + 1 type vs 1 function + 1 type). But the added value justifies the surface.

**Prior-art pattern:** Research §Pattern 1 (Optimal Branching Remainder) + §Pattern 2 (Viewport-Relative) + surface-ripple hybrid pattern.

**Hard-case handling:**

- **Negative camera:** Both functions delegate to the same Optimal Branching Remainder formula.
- **Perfect grid alignment:** `startX = 0` exactly — no wasted off-screen tile or callback.
- **Sub-pixel camera:** Geometry is true float. Consumer chooses mitigation in their draw code (overscan, snapping, or neither).
- **Zero/negative tile width:** Guard clause in `tiledParallaxRange` returns `{ startX: 0, copies: 0 }`. `drawTiledParallax` checks `copies > 0` before entering the loop.

---

## Comparison Table

| Criterion | A: Pure Geometry | B: Canvas-Coupled | C: Both, Layered |
|---|---|---|---|
| **Ergonomics** | Medium (3-line loop) | High (1 call) | Highest (pick per layer) |
| **Determinism purity** | Maximum | Good (ctx param) | Maximum |
| **Runtime cost** | Lowest | Low (+ callback overhead) | Same as A/B |
| **Consumer complexity** | Medium | Lowest | Lowest |
| **Tree-shake-ability** | Excellent | Good | Excellent |
| **Convention fit** | Matches parallaxOffset | Matches outlineRect | Matches both |
| **Extensibility** | Maximum | Medium | Maximum |
| **API surface size** | 1 fn + 1 type | 1 fn | 2 fn + 1 type |
| **WebGL/non-Canvas consumers** | Yes | No | Yes (via A path) |
| **Testability (Node)** | Pure, no mocks | Needs ctx mock | Core pure, wrapper needs mock |

---

## Recommendation

**Approach C: Both, Layered.**

The pure geometry primitive (`tiledParallaxRange`) is the right foundational abstraction — it matches `parallaxOffset`'s philosophy, is fully testable in Node, and works with any rendering backend. But for the common case (Canvas2D draw loop), the convenience wrapper (`drawTiledParallax`) eliminates 3 lines of boilerplate per layer — meaningful when a game has 4-6 parallax layers.

The surface-ripple proposal proved this pattern works: `waveDisplacement` (low-level) + `generateWaveLine` (high-level) shipped together, each independently tree-shakeable, each clearly named. The same split applies here: `tiledParallaxRange` (geometry) + `drawTiledParallax` (draw).

If the orchestrator prefers a smaller API surface for v1, **Approach A alone** is the second-best choice. The convenience wrapper can be added non-breakingly in v1.1.

---

## Design Questions — Resolved

### Sub-pixel seam mitigation: companion helpers

**Recommendation: Do NOT export a companion `overscanWidth` helper.** The "fix" is `tileWidth + 1` — a one-character change that any consumer can write inline. Exporting it as a library function would be over-abstraction for a single arithmetic expression. The JSDoc on `tiledParallaxRange` should document the overscan pattern as a usage note:

```
 * **Sub-pixel seam mitigation:**
 * To prevent 1px gaps between tiles at sub-pixel camera positions, the
 * consumer can draw each tile 1px wider than its logical width:
 *   `drawImage(img, x, y, tileWidth + 1, tileHeight)`
 * This "overscan" overlaps adjacent tiles by 1px, eliminating seams
 * while preserving smooth sub-pixel scrolling. For pixel-art games,
 * integer-snapping `startX` via `Math.round` is an alternative.
```

For integer snapping: also do NOT export a `snapTiledRange` function. The consumer rounds `startX` at the call site: `Math.round(r.startX + i * tileWidth)`. This is a rendering concern, not a geometry concern. Documenting the pattern in JSDoc is sufficient.

**Why not export them?** The library's convention is "export primitives, document patterns." `pixel.ts` exports `floor()` and `clamp()` but doesn't export `floorToGrid()` — the consumer composes. Same principle applies here.

### Integer snap as a parameter on the geometry helper

**Recommendation: Do NOT add `snapToPixel` to `tiledParallaxRange`.** The helper returns true floating-point geometry. Snapping is a rendering concern — the consumer applies `Math.round` (or `Math.floor`, or no snapping) at the call site, based on their aesthetic needs. Adding a boolean parameter couples the geometry to a rendering decision.

This matches the surface-ripple precedent: `waveDisplacement` returns floats; `generateWaveLine` has `snapToPixel` because it's a higher-level generator that directly produces coordinates. `tiledParallaxRange` is the low-level evaluator — same tier as `waveDisplacement`.

If a future `drawTiledParallax` convenience wrapper gains a `snapToPixel` option, that would be appropriate — it's a rendering concern at the rendering layer. But the geometry primitive stays pure.

### 1D vs 2D

**Recommendation: 1D only.** The helper takes one axis at a time. The consumer calls it twice for 2D (once for X, once for Y) if needed.

**Reasoning:**
1. **Side-scrollers dominate.** the reference implementation and most consumer side-scrollers scroll horizontally with a fixed vertical offset. A 2D variant would force Y-axis computation on every call even when Y is static (factor = 0, no tiling needed).
2. **Independent axes.** X and Y often have different tile sizes, different factors, and different tiling needs (X wraps, Y doesn't). A 2D helper would need `{ tileWidth, tileHeight, factorX, factorY }` — more parameters, more confusion.
3. **Matches `parallaxOffset`.** The existing helper takes `(cameraX, cameraY, factor)` but the consumer can trivially call it per-axis. The new helper follows the same pattern.
4. **Composability.** A consumer who wants 2D tiling wraps the 1D helper in a 4-line function. A consumer who wants 1D tiling doesn't pay for Y-axis math they don't need.

The research note's §Open Question 1 reaches the same conclusion: "A 1D helper is far more modular and flexible."

---

## Implementation Notes for @coder

### API surface note

The parallax section in `docs/api-surface.md` was added during this proposal task. It covers both the already-shipped `parallaxOffset` / `PARALLAX_*` exports (previously missing from the export map — drift) and the proposed new exports (`tiledParallaxRange`, `drawTiledParallax`, `TiledParallaxRange`). The pre-existing exports were not documented there before this proposal.

### File location

Add to existing `src/primitives/parallax.ts`. This file already contains `parallaxOffset`, `PARALLAX_FAR`, `PARALLAX_MID`, `PARALLAX_NEAR`. The new exports are additive — no existing export is modified or removed.

### Barrel export

Update `src/primitives/index.ts` to re-export the new additions:

```ts
export {
  parallaxOffset,
  PARALLAX_FAR,
  PARALLAX_MID,
  PARALLAX_NEAR,
  tiledParallaxRange,
  drawTiledParallax,
  type TiledParallaxRange,
} from './parallax';
```

### Optimal Branching Remainder formula

```ts
function tiledParallaxRange(
  camera: number,
  factor: number,
  tileWidth: number,
  viewportWidth: number,
): TiledParallaxRange {
  if (tileWidth <= 0) {
    return { startX: 0, copies: 0 };
  }
  const offset = -(camera * factor);
  let startX = offset % tileWidth;
  if (startX > 0) {
    startX -= tileWidth;
  }
  // Normalize -0 to 0
  startX = startX === 0 ? 0 : startX;
  const copies = Math.max(1, Math.ceil((viewportWidth - startX) / tileWidth));
  return { startX, copies };
}
```

### `drawTiledParallax` implementation

```ts
function drawTiledParallax(
  ctx: CanvasRenderingContext2D,
  drawTile: (ctx: CanvasRenderingContext2D, screenX: number) => void,
  camera: number,
  factor: number,
  tileWidth: number,
  viewportWidth: number,
): void {
  const range = tiledParallaxRange(camera, factor, tileWidth, viewportWidth);
  for (let i = 0; i < range.copies; i++) {
    drawTile(ctx, range.startX + i * tileWidth);
  }
}
```

### JSDoc style

Match `parallaxOffset`'s style exactly: lead sentence, formula explanation, defensive-guard note, purity statement, `@param`/`@returns`/`@example` tags. See the signature sketches above for the full JSDoc content.

### Test file

`src/tests/tiled-parallax.test.ts`. Test cases:

1. **Basic geometry:** `tiledParallaxRange(0, 0.5, 100, 400)` → `startX: 0, copies: 4`
2. **Negative camera (perfect alignment):** `tiledParallaxRange(200, 1.0, 100, 400)` → `startX: 0, copies: 4`
3. **Sub-pixel:** `tiledParallaxRange(150.25, 0.5, 100, 400)` → `startX: -75.125, copies: 5`
4. **Perfect alignment:** `tiledParallaxRange(400, 0.5, 100, 400)` → `startX: 0, copies: 4` (no off-screen waste)
5. **Tile wider than viewport:** `tiledParallaxRange(0, 1.0, 500, 320)` → `startX: 0, copies: 1`
6. **Zero tile width:** `tiledParallaxRange(100, 0.5, 0, 400)` → `copies: 0`
7. **Negative tile width:** `tiledParallaxRange(100, 0.5, -50, 400)` → `copies: 0`
8. **Determinism:** Same inputs → byte-identical output across 1000 calls
9. **`drawTiledParallax` callback count:** Verify callback is called exactly `copies` times
10. **`drawTiledParallax` zero tile width:** Verify callback is never called
11. **Normalizes -0 to +0:** `Object.is(tiledParallaxRange(200, 1.0, 100, 400).startX, -0)` → `false`; `Object.is(...startX, 0)` → `true`
12. **Returns 2 copies when one tile is not enough:** `tiledParallaxRange(300, 1.0, 500, 320)` → `startX: -300, copies: 2`
13. **Static layer (factor = 0):** `tiledParallaxRange(500, 0, 256, 800)` → `startX: 0, copies: Math.max(1, Math.ceil(800 / 256)) = 4`
14. **Foreground (factor > 1):** `tiledParallaxRange(100, 2.0, 200, 600)` → `startX: 0, copies: Math.max(1, Math.ceil((600 - 0) / 200)) = 3`
15. **Viewport width = 0:** `tiledParallaxRange(100, 0.5, 100, 0)` → `startX: -50, copies: 1` (guarded by `Math.max(1, ...)`)

---

## Open Questions for @architect

1. **Two functions vs one:** Is the `drawTiledParallax` convenience wrapper worth the API surface, or should v1 ship only the pure geometry helper? The wrapper is ~6 lines of code. Its value is eliminating the `for` loop boilerplate for consumers who always draw tiles the same way.

2. **`copies` minimum of 1:** When the viewport is smaller than the tile, `copies` is `Math.max(1, ...)` — we always draw at least one tile even if the viewport is tiny. Should this be `Math.ceil` without the `Math.max(1, ...)` guard? The research note says "draws 2 copies to cover the viewport" for tile wider than viewport, implying `copies ≥ 2` when `tileWidth > viewportWidth`. My formula gives `copies = 1` when `startX = 0` and `tileWidth ≥ viewportWidth`. Which is correct?
