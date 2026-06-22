# Decision: Moving Gap on Platform

> **Decision record** for the moving-gap-on-platform primitive. Locks the API shape chosen for implementation and records the orchestrator rulings on open questions. Supersedes the *proposed (pending decision)* markers in `docs/api-surface.md`.
>
> Slug: `moving-gap`. Date: 2026-06-22.

## The technique

A gap (hole) that moves along an arbitrarily long platform. A player standing on the platform falls through when the gap reaches them. The kill is by **consequence** (pit-fall: the floor is no longer there) not by overlap hitbox.

## The bug this exists to prevent

Spitekeep's `movingVoid` trap (GDD §6.13) already ships this feature, but it coupled **gap motion** (where the center wants to be) and **gap geometry** (what solid fragments exist) inside one handler, producing fragments from a raw, unclamped `gapCenterX`. In `chase` mode the center followed `player.x` past the span edge, so the rendered void extended over a still-colliding static platform — **the player appeared to stand on the void.** The user's fix added a span clamp *after every travel mode*. That fix is correct but fragile: it makes the clamp a per-motion-mode responsibility, easy to forget when adding a new mode.

## The chosen abstraction

**Ship Approach A + C (reject B).** Source: `docs/design/moving-gap-proposal.md`.

- **Approach A — Composable pure helpers.** A pure geometry function `gapSolids(span, gap)` that emits 0/1/2 `Solid` fragments and **clamps internally**, plus a separate pure motion state machine `advanceGapMotion(state, dt, config, targetX?)` (sweep/chase/expand). The clamp lives in the geometry half, so no motion mode — and no caller hand-driving the center — can ever reproduce the bug. The geometry helper is independently reusable (scripted gaps need no state machine).
- **Approach C — Tile-grid wrapper.** `gapTileQuery(base, span, gap, tileSize)` returns a `TileSolidityQuery` that reports `'empty'` inside the clamped gap, composing with the existing `resolveTileX/Y`. Shipped alongside A because it's a ~15-line closure over the same clamping logic and closes the tile-grid consumer path symmetrically.
- **Approach B — Bundled stateful entity — REJECTED.** Couples motion and geometry (regressing the separation that is the entire point), and the pure-function motion machine fits the library's conventions better than an object with `step()`/`getSolids()` methods.

## What drove the decision

| Input | What it contributed |
|---|---|
| `docs/research/moving-gap-platform.md` (@researcher) | Codified Spitekeep's `movingVoid` as the in-house anchor and surfaced the **motion/geometry separation** as the design driver. Confirmed the every-tick solid-list rebuild + gravity-before-move-Y means no tunneling for a resting player. |
| `docs/design/moving-gap-proposal.md` (@api-designer, 2 loops) | Three approaches with trade-offs. After the architect's hard-block on the underspecified clamp, the designer added the explicit **four-guard clamp algorithm** that makes "void never standable" true by construction. |
| Architect critique | Caught that the inherited Spitekeep clamp formula inverts (`minCenter > maxCenter`) when `gapWidth ≥ span.width`, and that `NaN` propagates into fragment rects. Both are now guard-claused. Also resolved: `Solid[]` return (matches `querySolidTiles`), `gapTileQuery` lives in `moving-gap.ts`, `GapState` → renamed `GapGeometry`. |
| Prototype `src/_prototype/moving-gap.ts` (@coder) | Confirmed the four-guard clamp is bulletproof across every pathological input; `Solid[]` composes trivially with `[...statics, ...gapSolids]`. Flagged one correctness item for production (`gapTileQuery` membership test) and one ergonomics nicety (`initialCenterX`). |
| Benchmark `benchmarks/moving-gap/sample-sheet.png` (@benchmarker) | Visually confirmed all six scenes, especially the three load-bearing edge cases: `gapWidth = span.width` → **0 fragments** (no stray sliver); `gapWidth ≤ 0` → **1 full-span fragment**; `centerX = ±9999` → gap clamped **flush to span edge, never past it**. The sweep frame shows a player standing safely on a fragment while another falls through the gap in the same frame. |

## Locked API (for `src/collision/moving-gap.ts`)

**Types:** `GapSpanConfig`, `GapGeometry`, `GapTravelMode` (`'sweep'|'chase'|'expand'`), `GapLoopMode` (`'loop'|'pingpong'`), `GapMotionConfig` (mode-specific fields optional with documented defaults), `GapMotionState`.

**Functions:** `gapSolids(span, gap): Solid[]`, `createGapMotion(config): GapMotionState`, `advanceGapMotion(state, dt, config, targetX?): GapMotionState`, `gapTileQuery(base, span, gap, tileSize): TileSolidityQuery`.

**Constants:** `DEFAULT_GAP_WIDTH = 64`, `DEFAULT_GAP_SPEED = 2`, `DEFAULT_CHASE_GIVE_UP_RADIUS = 200` (~3× default gap width; mirrors Spitekeep chase-disengage feel).

**Location:** `src/collision/moving-gap.ts`, re-exported from `src/collision/index.ts`.

## Orchestrator rulings on open questions

1. **NaN policy: throw.** A geometry helper receiving `NaN` is programmer error (it cannot arise from valid simulation state). Matches `parseHex` discipline. Guards 2–4 (≤0, ≥span.width, normal) handle all valid inputs; Guard 1 throws on `NaN`.
2. **Gap-speed tunneling: documentation only.** The library does not own `dt` and is not a physics enforcer. A JSDoc note (matching the precedent in `tiles.ts` and `jump.ts`) states the consumer should keep per-tick gap movement below body width so the gap cannot jump past the player in a single tick. Not enforced in code.
3. **`gapTileQuery` multi-row: v1 single-row only.** The span declares a single `y`/`height`; multi-row gaps are a v2 extension. Keeps v1 scope tight and the clamp obviously correct.
4. **`gapTileQuery` membership test: use AABB overlap, not the proposal's left-edge test.** The prototype found the proposal's `tileWorldLeft >= gapLeft && tileWorldLeft < gapRight` misses tiles straddling `gapLeft` (a tile whose left edge is left of the gap but whose body overlaps it). Production uses strict overlap: `tileWorldLeft < gapRight && tileWorldLeft + tileSize > gapLeft` — the same semantics as `aabbOverlap`.
5. **`initialCenterX` on `GapMotionConfig`: add as optional.** Removes the `{ ...createGapMotion(cfg), centerX: X }` override dance for `chase`/`expand` consumers (who want the center at span center). Optional, defaults derive sensibly per mode.
6. **`path` typed as Vec2 polyline: keep for v1.** Arc-length parametrization uses both components; only `.x` feeds `centerX` today. Future-proofing for 2D gap motion is cheap and avoids a v2 breaking change. Document that v1 consumers pass horizontal paths.
7. **Multi-gap (`GapGeometry[]` → N+1 fragments): deferred to v2.** v1 ships single-gap. The v2 path is a separate `gapSolidsMulti` export (not an overload) so v1 signatures never break.

## Invariants the test suite (Step 7) must lock

- `gapSolids` four-guard clamp: `NaN` throws; `gapWidth ≤ 0` → exactly 1 full-span fragment; `gapWidth ≥ span.width` → exactly 0 fragments; otherwise 1 or 2 fragments, both inside `[span.x, span.x + span.width]`, never producing negative-width rects.
- `advanceGapMotion` determinism: same `(state, dt, config, targetX?)` → byte-identical returned state.
- `advanceGapMotion` sweep: `loop` wraps, `pingpong` reverses at endpoints.
- `advanceGapMotion` chase: never exceeds `speed * dt` per tick; disengages outside `giveUpRadius`.
- `advanceGapMotion` expand: width grows linearly `minWidth → maxWidth` over `expandTicks`, resets.
- `gapTileQuery`: tiles straddling `gapLeft` are correctly reported `'empty'` (AABB-overlap test, not left-edge).

## Determinism contract

Same `(state, dt, config, targetX?)` → byte-identical returned `GapMotionState`, forever. Mirrors `src/animation/jump.ts`. Consumer owns the fixed timestep; the library never reads `Date.now()` or `Math.random`.

## Out of scope for this work

- **Spitekeep migration.** Spitekeep's in-repo `movingVoid` is not refactored to consume this primitive. It works, it's tested, and Spitekeep doesn't yet consume `src/collision/` at all. The primitive is designed so a future migration is *possible*, but that's a separate decision.
- **Player carrying.** The primitive is "absence of floor," full stop. Carrying (moving-platform semantics) is a separate concern.
- **Post-mortem reveal / disguise / chase-speed lint.** Those are game-design rules in Spitekeep's GDD, not engine concerns.

## Cross-references

- Proposal: `docs/design/moving-gap-proposal.md`
- Research: `docs/research/moving-gap-platform.md`
- Benchmark: `benchmarks/moving-gap/sample-sheet.png` (+ `README.md`, script `benchmarks/_scripts/moving-gap-render.ts`)
- Spitekeep reference: `ai-craft-game-dev-devil/src/core/traps/moving-void.ts`, GDD §6.13
- Composes with: `src/collision/resolve.ts` (`resolveAxisX/Y`), `src/collision/tiles.ts` (`resolveTileX/Y`, `TileSolidityQuery`)
