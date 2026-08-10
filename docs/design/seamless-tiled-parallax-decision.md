# Decision: Seamless-Tiled Parallax Helper

**Status:** APPROVED for implementation — 2026-06-22
**Technique:** Seamless-tiled infinite-scroll parallax backgrounds (horizontal-wrap + multi-copy draw)

## Decision

Ship **Approach C (both, layered)** to `src/primitives/parallax.ts`:

```ts
export interface TiledParallaxRange {
  readonly startX: number;  // leftmost draw coordinate, always ≤ 0
  readonly copies: number;  // tile count, always ≥ 1 (or 0 if tileWidth ≤ 0)
}

export function tiledParallaxRange(
  camera: number,
  factor: number,
  tileWidth: number,
  viewportWidth: number,
): TiledParallaxRange;

export function drawTiledParallax(
  ctx: CanvasRenderingContext2D,
  drawTile: (ctx: CanvasRenderingContext2D, screenX: number) => void,
  cameraX: number,
  factor: number,
  tileWidth: number,
  viewportWidth: number,
): void;
```

**1D only.** Consumer calls twice for 2D (X and Y independently), matching the existing `parallaxOffset` precedent.

**Wrap formula:** "Optimal Branching Remainder"
```ts
const offset = -(camera * factor);
let startX = offset % tileWidth;
if (startX > 0) startX -= tileWidth;
if (startX === 0) startX = 0;  // normalize -0 → +0
const copies = Math.max(1, Math.ceil((viewportWidth - startX) / tileWidth));
```

Defensive guard: `tileWidth <= 0` returns `{ startX: 0, copies: 0 }` — the wrapper's draw loop then runs zero iterations. This is non-negotiable to prevent infinite-loop hangs.

## Rationale

The technique closes a real gap: the existing `parallaxOffset` helper returns the raw `-camera * factor` offset but does not handle the modulo wrap or copy-count logic required for infinite seamless scroll. Today every consumer must write that boilerplate themselves, and the obvious naive formula (`offset % W - W`) wastes one fully-off-screen `drawImage` call per layer per frame on perfect grid alignment — exactly the case the benchmark visually confirms (2 vs 3 copies, a 25-50% saving).

**Why Approach C over A-only or B-only:**
- The pure primitive (`tiledParallaxRange`) keeps the geometry testable in Node without canvas mocks, works for any rendering backend (Canvas2D now, WebGL/OffscreenCanvas later), and mirrors the proven `waveDisplacement` + `generateWaveLine` pattern already in the library.
- The thin canvas-coupled wrapper (`drawTiledParallax`) eliminates 3 lines of boilerplate per layer for the 90% Canvas2D case, is independently tree-shakeable, and matches the `outlineRect` / `drawGlow` precedent.
- Shipping both costs almost nothing (wrapper is ~6 lines delegating to the primitive) and avoids forcing a future consumer to choose between purity and convenience.

**Why 1D-only:** side-scrollers (the dominant use case) wrap horizontally only. A 2D variant would force Y computation on every call, explode the parameter list, and violate the per-axis-composition precedent of `parallaxOffset`. A consumer who wants 2D wrap composes two 1D calls in 4 lines.

**Why `step` was removed from `TiledParallaxRange`:** the architect flagged it as pure gold-plating — always identical to `tileWidth`, unlike `WavePoint`'s `normalX`/`normalY` which encode non-trivial derived data. The consumer writes `startX + i * tileWidth` instead of `startX + i * step` (one extra character, zero cognitive load). Smaller surface, same ergonomics.

**Sub-pixel mitigation stays consumer-side:** the helper returns true floats. Overscan (`tileWidth + 1` draw width) and integer snapping (`Math.round(startX + i * step)`) are documented as JSDoc patterns, not library exports — matching the library's "consumer composes" convention (cf. `pixel.ts` exports `floor()`/`clamp()` but doesn't export `floorToGrid()`). Snapping is a rendering concern, not a geometry concern.

## Inputs that drove the decision

1. **Research note** (`docs/research/seamless-tiled-parallax.md`) — confirmed "Optimal Branching Remainder" as the canonical robust form, surveyed Phaser/PixiJS/raylib/p5.js/Sokpop precedents, flagged the perfect-alignment gotcha and the zero-width hang risk. Notable finding: the reference implementation has **zero** parallax code today, so this is greenfield with no parity constraint.
2. **API proposal** (`docs/design/seamless-tiled-parallax-proposal.md`) — three approaches proposed with full JSDoc, 4-layer side-scroller usage examples, trade-off tables, and hard-case analysis. Approach C recommended over A/B.
3. **Architect critique** (2 loops) — Loop 1 returned NEEDS REVISION on two incorrect test expectations (`-0` normalization, tile-wider-than-viewport copy count); loop 2 APPROVED after the api-designer applied fixes plus orchestrator-caught arithmetic slips in test cases #3 and #15. All 15 test cases now Node-verified correct.
4. **Benchmark** (`benchmarks/seamless-tiled-parallax/*.png`, 5 sheets) — visual confirmation of: (a) no seam gaps in either scroll direction across 8 camera positions each, (b) no flicker at perfect grid alignment, (c) proposed formula draws 25-50% fewer copies than naive at alignment (2 vs 3), (d) sub-pixel smoothness is acceptable in both float and snapped modes (with documented trade-offs), (e) pure helper and canvas wrapper are pixel-for-pixel identical.

## Caveats

- The orchestrator could not visually verify the benchmark PNGs directly (model lacks image input). Visual verification rests on the benchmarker's detailed report, which is credible — it correctly identifies the proposed-vs-naive copy-count difference (the main correctness claim) and the contrast ratios of the test assets. The end-user is encouraged to spot-check `perfect-alignment.png` and `scroll-left.png` before downstream consumers depend on this.
- The benchmark used procedurally-generated seamless tiles (sine hills, repeating columns, chains) rather than real game art. Real art that violates the "left edge matches right edge" requirement will still seam — that's an asset-pipeline concern, documented in `docs/integration.md` (Step 8), not a library bug.

## Out of scope for v1

- 2D helper (consumer composes two 1D calls).
- Micro-width tile guard (`tileWidth >= 1.0`). Documented as JSDoc performance note instead; library convention is "consumer composes."
- Vertical tile composition helpers.
- Set-piece / non-looping overlay layering. Mentioned in research note; recipe will live in `docs/integration.md` if demanded by consumers.
