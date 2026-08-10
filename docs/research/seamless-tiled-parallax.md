# Seamless-Tiled Infinite-Scroll Parallax Backgrounds

> Research note for seamless-tiled infinite-scroll parallax backgrounds. Slug: `seamless-tiled-parallax`.
> Investigated: 2026-06-22.

## TL;DR

Infinite-scroll parallax backgrounds create the illusion of depth in 2D games by scrolling layered textures at varying speeds relative to the camera and wrapping them seamlessly. For the zero-dependency, strict TypeScript, and determinism-disciplined `aicraft-engine` library, we must provide a pure mathematical helper that translates a camera coordinate into (a) the leftmost screen coordinate to start drawing, and (b) the exact number of tiles needed to cover the viewport. We evaluate the standard wrapping formulas and demonstrate that the **Optimal Branching Remainder** formulation is superior to the **Branchless Mathematical Modulo** because it avoids drawing a completely off-screen tile when the camera aligns perfectly with the tile grid, saving a costly `drawImage` call. We recommend a **1D Viewport-Relative Screen-Space Anchor** API that handles sub-pixel seams via **Overscan (1px bleed)** or **Integer Snapping**, and supports a hybrid **"Set Piece" Overlay Pattern** for non-looping background landmarks.

## Why this matters for aicraft-engine

This research directly impacts **Pillar 1 (Primitives & secondary dynamics)** and **Pillar 4 (Fake-3D & advanced rendering)**.
- **Visual Depth with Zero Assets:** Sibling games like *the reference implementation* and future consumer titles (such as card-based village builders in the vein of *Stacklands*) require rich, atmospheric backgrounds. By providing a robust, seamless tiling utility, developers can generate infinite scrolling backgrounds (e.g., starfields, clouds, distant mountains) procedurally using simple code-drawn shapes or minimal seamless textures.
- **Determinism and Performance:** Infinite loops must be 100% deterministic and safe from memory leaks or infinite loop hangs. A pure mathematical helper allows the rendering layer to remain decoupled from the simulation while guaranteeing that identical camera inputs yield identical draw coordinates across frames.
- **Eliminating Visual Bugs:** Hand-rolled parallax math in HTML5 Canvas games is notoriously prone to edge cases: off-by-one gaps when panning left, micro-stutters, and 1px semi-transparent seams at sub-pixel camera positions. Solving these at the library level ensures professional-grade visual polish.

---

## Prior Art Survey

### Pattern 1: Optimal Branching Remainder (The Canonical Wrap Formula)
- **Source**: Common HTML5 Canvas game loops, Phaser 3 `TileSprite` Canvas fallback.
- **What it does**: Computes the starting draw coordinate (`startX`) relative to the viewport's left edge by applying the remainder operator (`%`) to the scroll offset and normalizing positive remainders to ensure the drawing starts off-screen on the left.
- **Algorithmic shape**:
  ```typescript
  /**
   * Computes the starting drawing coordinate for a tiling background.
   * Pure mathematical function: 100% deterministic, no side effects.
   */
  export function getTileStartBranching(offset: number, tileWidth: number): number {
    if (tileWidth <= 0) return 0; // Defensive guard against division by zero/NaN
    let startX = offset % tileWidth;
    if (startX > 0) {
      startX -= tileWidth;
    }
    return startX === 0 ? 0 : startX; // Normalize -0 to 0
  }
  ```
- **Determinism profile**: Pure mathematical operations. 100% deterministic.
- **Runtime cost**: Negligible. One remainder operation and one conditional branch.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is a lightweight, zero-dependency helper that perfectly handles both positive and negative offsets.
- **What to steal**: **The branching optimization**. By keeping `startX` at `0` when `offset % tileWidth === 0`, we avoid drawing an extra off-screen tile on the left, saving a costly `drawImage` call.
- **What to avoid**: Avoid using this formula without a defensive guard for `tileWidth <= 0`. If `tileWidth` is `0` or negative, `% tileWidth` returns `NaN`, and a drawing loop incrementing by `tileWidth` will hang the browser in an infinite loop.

### Pattern 2: Viewport-Relative Screen-Space Anchor
- **Source**: PixiJS `TilingSprite` layout, standard 2D camera architectures.
- **What it does**: Anchors the tiling background coordinate space directly to the viewport's left edge (`0`) rather than the world origin. The scroll offset is computed as `-(cameraX * factor)`. Tiles are drawn from `startX` (which is always in `(-tileWidth, 0]`) and incremented by `tileWidth` until the viewport width `V` is fully covered.
- **Algorithmic shape**:
  - **Viewport-Relative (Recommended)**:
    - Offset: `offset = -(cameraX * factor)`
    - Start Draw Coordinate: `startX = getTileStart(offset, W)` (always in `(-W, 0]`)
    - Draw Loop: `for (let x = startX; x < V; x += W) { drawTile(x); }`
  - **World-Space Anchor (Alternative)**:
    - Offset: `offset = -cameraX * factor`
    - Start Draw Coordinate: `startX = Math.floor(cameraX / W) * W + offset`
    - Draw Loop: `for (let x = startX; x < cameraX + V; x += W) { drawTile(x - cameraX); }`
- **Trade-offs**:
  - **Viewport-Relative**:
    - *Pros*: Coordinates are always small and bounded (within `[-W, V]`), completely avoiding floating-point precision loss even if the camera travels millions of pixels from the world origin. The drawing loop is simple and screen-space aligned.
    - *Cons*: Requires the background rendering to be performed in screen space (before or outside the main camera world translation).
  - **World-Space**:
    - *Pros*: Integrates naturally if the background is drawn inside the world-space coordinate system.
    - *Cons*: Susceptible to floating-point precision issues at extreme world coordinates, leading to jitter or gaps.
- **Fit for our constraints**: Strong. Viewport-relative screen-space anchoring is the industry standard for infinite parallax layers in 2D web engines.

### Pattern 3: Sub-Pixel Seam Mitigation
- **Source**: PixiJS `ROUND_PIXELS` setting, Phaser 3 WebGL texture wrap modes, retro game devlogs.
- **What it does**: Prevents the 1px semi-transparent "seams" or "gaps" that appear between adjacent tiles when drawn at fractional (sub-pixel) coordinates due to bilinear filtering (image smoothing).
- **Mitigation Options & Trade-offs**:
  1. **Integer Snapping (`Math.round` / `Math.floor`)**:
     - *How*: Round the starting coordinate and camera offset to the nearest integer pixel before drawing: `startX = Math.round(startX)`.
     - *Pros*: 100% eliminates seams. Keeps pixel art perfectly sharp and crisp.
     - *Cons*: Can introduce minor "jitter" or "micro-stutter" when scrolling at very slow speeds, as the background snaps to integer boundaries while the foreground moves smoothly at sub-pixel speeds.
  2. **Overscan / Overlap (1px Bleed)**:
     - *How*: Draw each tile slightly wider than its logical width, overlapping the adjacent tile by 1px: `ctx.drawImage(img, drawX, drawY, tileWidth + 1, tileHeight)`.
     - *Pros*: Eliminates seams completely while preserving smooth, sub-pixel camera scrolling.
     - *Cons*: Introduces a 1px double-drawing overlap at the boundary. For most seamless textures (clouds, starfields, organic dirt), this is completely invisible. For high-contrast geometric patterns, it can cause a minor 1px visual distortion.
  3. **Disable Image Smoothing (`imageSmoothingEnabled = false`)**:
     - *How*: Set `ctx.imageSmoothingEnabled = false` on the canvas context.
     - *Pros*: Fits the pixel-art aesthetic.
     - *Cons*: Does not fully solve the seam if coordinates are still floats, as the browser's rasterizer must still round coordinates, which can still leave a 1px gap depending on the browser's rounding direction.
- **Fit for our constraints**: Strong. The library should support both **Integer Snapping** (for crisp pixel-art games like *the reference implementation*) and **Overscan** (for smooth high-res scrolling) as configurable options or recommended patterns.

### Pattern 4: "Set Piece" / Non-Looping Overlay Hybrid
- **Source**: Celeste background layering, Hollow Knight parallax design.
- **What it does**: Combines infinite looping layers (such as a repeating starfield or mountain range) with unique, non-looping landmark sprites (set pieces, e.g., a giant demon statue, a ruined arch) placed at specific world coordinates.
- **How it works**:
  - The infinite looping layer wraps using the modulo formula.
  - The unique set piece has a fixed world coordinate `(worldX, worldY)`.
  - Its screen-space draw coordinate is calculated using the same parallax factor as the looping layer it belongs to:
    `drawX = (worldX - cameraX) * factor`
  - Because it uses the exact same `factor`, it scrolls in perfect synchronization with the looping background, appearing as if it is embedded within that depth layer.
- **Fit for our constraints**: Strong. This is a highly expressive, asset-light pattern. It allows developers to build rich, non-repetitive backgrounds by combining a small, repeating tile with a few strategically placed procedural set pieces.

---

## Edge Cases Analysis

The following table evaluates how the **Optimal Branching Remainder** formula handles critical edge cases:

| Edge Case | Input (`offset`, `W`) | Formula Execution | Result | Visual Behavior |
|---|---|---|---|---|
| **Zero Camera (Origin)** | `offset = 0`, `W = 100` | `startX = 0 % 100 = 0` | `startX = 0` | Perfectly aligned at left edge. No off-screen tile drawn. |
| **Positive Camera (Panning Right)** | `offset = -150`, `W = 100` | `startX = -150 % 100 = -50` | `startX = -50` | Tile is shifted left by 50px. Covers left edge. |
| **Negative Camera (Panning Left)** | `offset = 150`, `W = 100` | `startX = 150 % 100 = 50; 50 > 0` → `50 - 100` | `startX = -50` | Tile is shifted left by 50px. Covers left edge. |
| **Perfect Multiple** | `offset = -200`, `W = 100` | `startX = -200 % 100 = -0` | `startX = 0` | Perfectly aligned. Draws exactly `V / W` tiles. |
| **Sub-pixel Camera** | `offset = -150.25`, `W = 100` | `startX = -150.25 % 100 = -50.25` | `startX = -50.25` | Preserves sub-pixel precision for smooth scrolling. |
| **Tile Wider than Viewport** | `V = 800`, `W = 1000` | `startX = getTileStart(offset, 1000)` | `startX` in `(-1000, 0]` | Draws 1 copy when `startX = 0` (fully covering the viewport). The 2-copy scenario only arises when `startX < 0` (the camera has advanced enough that the first tile is partially off-screen left). |
| **Degenerate: Zero Width** | `offset = 100`, `W = 0` | Guard clause triggers | `startX = 0` | Prevents division by zero and infinite loops. |
| **Degenerate: Negative Width** | `offset = 100`, `W = -50` | Guard clause triggers | `startX = 0` | Prevents infinite loops and invalid coordinates. |
| **Degenerate: Micro-Width** | `offset = 100`, `W = 0.5` | Enforce minimum width (e.g., `W >= 1.0`) | `startX = 0` | Prevents browser hang from drawing millions of 0.5px tiles. |

---

## Reference Implementations & Citations

### 1. Phaser 3 `TileSprite`
- **Source**: `Phaser.GameObjects.TileSprite` ([Phaser 3 Docs](https://docs.phaser.io/api-documentation/class/gameobjects-tilesprite))
- **What it teaches**: Phaser's `TileSprite` uses HTML5 Canvas patterns (`ctx.createPattern`) for its Canvas renderer and custom shaders for WebGL. While `createPattern` is powerful, it couples the tiling logic directly to the DOM/Canvas and can suffer from performance degradation on older mobile browsers. A direct `drawImage` loop using a pure mathematical helper is faster, more predictable, and fully decoupled from the DOM.

### 2. PixiJS `TilingSprite`
- **Source**: `PIXI.TilingSprite` ([PixiJS Guide](https://pixijs.com/8.x/guides/components/scene-objects/tiling-sprite))
- **What it teaches**: PixiJS provides a `ROUND_PIXELS` setting which applies `Math.floor()` to coordinates during rendering to eliminate sub-pixel seams. It also highlights the importance of the `uvRespectAnchor` flag, which determines whether the tiling pattern originates from the sprite's anchor or the top-left corner.

### 3. raylib `DrawTextureTiled`
- **Source**: `textures_tiled_drawing.c` ([raylib Examples](https://www.raylib.com/examples/textures/loader.html?name=textures_tiled_drawing))
- **What it teaches**: raylib implements tiling by running a nested loop over both the X and Y axes, drawing the texture repeatedly using source and destination rectangles. This confirms that for 2D rendering, a simple, explicit drawing loop is highly performant and easy to understand.

### 4. Consumer Game Parity Check
- **Finding**: **No existing implementation**. The consumer game currently draws a static, screen-space linear gradient for its background (`drawBackground` in `renderer.ts:122-146`). It does not support parallax scrolling or tiling sprites. Introducing a seamless-tiled parallax module in `aicraft-engine` will be a major upgrade, allowing the consumer game to transition from a flat static background to rich, multi-layered scrolling environments.

### 5. Sokpop Collective Relevance
- **Finding**: Sokpop titles (such as *Mistward*, *Uniseas*, and *Pyramida*) rely heavily on layered, atmospheric backgrounds to convey scale and mood without using high-resolution art assets. They combine subtle background color gradients with simple, code-drawn parallax layers (e.g., repeating wave lines, distant mountain silhouettes, and drifting fog particles). This confirms that a lightweight, pure parallax wrapping utility is a foundational requirement for the "algorithmic cosmetics" thesis.

---

## Open Questions

1. **1D vs. 2D Helper API**: Should the library expose a 1D helper that the consumer calls independently for each axis, or a unified 2D helper?
   - *Recommendation*: A **1D helper** is far more modular and flexible. Side-scrollers often only scroll horizontally and fix the vertical axis, while vertical climbers only scroll vertically. A 1D helper allows the consumer to choose exactly which axes wrap, what their independent speeds are, and avoids forcing unnecessary calculations on static axes.
2. **Canvas Pattern (`createPattern`) vs. `drawImage` Loop**: Should the library recommend drawing tiles in a loop using `drawImage`, or using Canvas's native `createPattern`?
   - *Analysis*: `createPattern` is convenient but makes sub-pixel seam mitigation (like overscan) difficult, and has inconsistent performance across browsers. A direct `drawImage` loop is highly performant for typical viewport sizes (requiring only 3-5 tiles to cover the screen) and allows easy integration of overscan, custom scaling, and integer snapping.

---

## Top 3 Patterns Worth Prototyping

1. **1D Viewport-Relative Wrap Helper (Pure Math)**
   - *Why*: A pure, zero-dependency function that takes `cameraCoord`, `speed`, `tileLength`, and `viewportLength`, and returns `{ startCoord, copyCount }` using the **Optimal Branching Remainder** formula. This is 100% deterministic, testable in Node/Vitest, and perfectly decoupled from the rendering context.
2. **Overscan (1px Bleed) Canvas Loop**
   - *Why*: A rendering pattern that draws tiles with a 1px width/height overlap (`tileWidth + 1`) to eliminate sub-pixel seams during smooth, fractional camera scrolling. This must be benchmarked against **Integer Snapping** to compare visual smoothness and sharpness.
3. **Hybrid "Set Piece" Parallax Layering**
   - *Why*: A pattern combining an infinite repeating background layer (using the wrap helper) with unique, non-looping landmarks projected at the same parallax depth. This is the ultimate asset-light, highly expressive background pattern for procedural games.

---

## Cross-References

- `docs/research/platformer-juice.md` — Explores game-feel, camera lookahead, and screen shake.
- `docs/research/spritesheet-pipelines.md` — Evaluates and rejects asset-heavy spritesheet pipelines in favor of procedural rendering.
- `src/primitives/parallax.ts` — Contains the existing `parallaxOffset` helper which this new wrapping logic will extend.
