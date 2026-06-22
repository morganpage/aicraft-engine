# API Proposal: Moving Gap Platform (Traveling Absence of Floor)

> Target pillar: 1. Module: `src/collision/`.
> Builds on research: `docs/research/moving-gap-platform.md`.
> Status: UNDER CRITIQUE — revise 2 of 2 (architect: NEEDS REVISION → revised).

## Consumer Need

Spitekeep's `movingVoid` trap is a traveling absence of floor: a gap sweeps/chases/expands along a platform span, and the player falls through when the gap reaches them. Without this primitive, consumers must hand-roll the span-splitting geometry, remember the span clamp, and wire the fragments into the resolver themselves — exactly the pattern that produced the visual-solid desync bug (player standing on rendered void).

When this ships, consumers get a deterministic, self-clamping geometry helper that makes the "void never standable" invariant impossible to violate, plus an optional deterministic motion state machine for the common sweep/chase/expand patterns.

---

## The Three Approaches

### Approach A: Composable Pure Helpers (Geometry + Motion Separated)

**Source pattern:** Pattern 1 (Spitekeep `movingVoid` `getSolids`) + Pattern 3 (procedural solidity query), split into two independent layers. The research note's central insight — clamp inside geometry, not motion — is the structural anchor.

**Signature sketch:**

```ts
// src/collision/moving-gap.ts

/** Config for the span that owns the gap. Immutable after creation. */
export interface GapSpanConfig {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Inherited by fragments. Default: false (fully solid). */
  readonly passthrough?: boolean;
}

/** Geometry input: where the gap is right now. Named GapGeometry
 *  (not GapState) to avoid confusion with GapMotionState. */
export interface GapGeometry {
  readonly centerX: number;
  readonly width: number;
}

/**
 * Pure geometry: split a span into 0-2 Solid fragments around a gap.
 *
 * Internally clamps the gap so it cannot escape the span — this is the
 * "void never standable" invariant anchor. No matter what centerX value
 * is passed (even wildly out-of-bounds), the output fragments never
 * overlap the span's own solid region.
 *
 * - Gap fully covers span → 0 fragments (entire span is void)
 * - Gap flush against left edge → 1 fragment (right side only)
 * - Gap flush against right edge → 1 fragment (left side only)
 * - Gap fully inside span → 2 fragments (left and right)
 * - Gap width ≤ 0 → 1 fragment (entire span, no gap)
 * - Gap width ≥ span.width → 0 fragments (fully voided span)
 *
 * @throws If `gap.centerX` or `gap.width` is `NaN` (programmer error).
 */
export function gapSolids(
  span: GapSpanConfig,
  gap: GapGeometry,
): readonly Solid[];

// --- Motion state machine (optional; consumers can hand-drive gapSolids) ---

export type GapTravelMode = 'sweep' | 'chase' | 'expand';
export type GapLoopMode = 'loop' | 'pingpong';

export interface GapMotionConfig {
  readonly travelMode: GapTravelMode;
  /** Polyline of gap-center x-positions. Required for 'sweep'; ignored
   *  (defaults to []) for 'chase' and 'expand'. */
  readonly path?: readonly { readonly x: number; readonly y: number }[];
  /** px/tick along the path (sweep) or toward target (chase). */
  readonly speed: number;
  /** sweep only: wrap vs reflect at endpoints. Defaults to 'loop'. */
  readonly loopMode?: GapLoopMode;
  /** Full width of the lethal gap. */
  readonly gapWidth: number;
  /** chase only: stop chasing once target is past this radius. */
  readonly giveUpRadius?: number;
  /** expand only: gapWidth starts here each cycle. */
  readonly minWidth?: number;
  /** expand only: gapWidth grows toward here. */
  readonly maxWidth?: number;
  /** expand only: ticks for one grow cycle. */
  readonly expandTicks?: number;
}

export interface GapMotionState {
  readonly centerX: number;
  readonly width: number;
  /** Cumulative signed distance along the path (sweep). */
  readonly dist: number;
  /** +1 forward / -1 backward (sweep pingpong). */
  readonly dir: number;
  /** expand only: elapsed ticks in current grow cycle. */
  readonly expandElapsed: number;
}

/**
 * Pure: advance the gap motion state by one tick.
 *
 * Returns a brand-new GapMotionState. Does NOT clamp — the clamp is
 * inside gapSolids(). The motion machine may produce a centerX outside
 * the span; gapSolids will clamp it before generating fragments.
 *
 * `path` and `loopMode` are optional on GapMotionConfig — they default
 * to `[]` and `'loop'` respectively, and are only consumed by
 * `travelMode: 'sweep'`. Chase/expand consumers need not supply them.
 *
 * **Determinism contract:** same `(state, dt, config, targetX?)` →
 * byte-identical returned state, forever. No Math.random, no Date.now,
 * no DOM reads, no global mutable state. The caller MUST use a fixed dt.
 */
export function advanceGapMotion(
  state: GapMotionState,
  dt: number,
  config: GapMotionConfig,
  targetX?: number,
): GapMotionState;
```

**Usage example (rect-list collision):**

```ts
import { gapSolids, advanceGapMotion } from 'aicraft-engine/src/collision';
import { resolveAxisY } from 'aicraft-engine/src/collision';

const span = { x: 136, y: 200, width: 688, height: 16, passthrough: false };
let motionState: GapMotionState = { centerX: 136 + 64, width: 64, dist: 0, dir: 1, expandElapsed: 0 };

// Each tick:
motionState = advanceGapMotion(motionState, 1, config, player.x + player.width / 2);
const gapGeom: GapGeometry = { centerX: motionState.centerX, width: motionState.width };
const fragments = gapSolids(span, gapGeom);
const allSolids = [...staticPlatforms, ...fragments];
const r = resolveAxisY(player, player.vy, allSolids, prevBottom);
player.y = r.y;
```

**Usage example (tile-grid collision):**

```ts
import { gapTileQuery, advanceGapMotion } from 'aicraft-engine/src/collision';
import { resolveTileY } from 'aicraft-engine/src/collision';

const baseQuery: TileSolidityQuery = (tx, ty) => /* grid lookup */;
const span = { tileX: 8, tileY: 12, tileWidth: 43, tileSize: 16 };

motionState = advanceGapMotion(motionState, 1, config);
const gapGeom: GapGeometry = { centerX: motionState.centerX, width: motionState.width };
const wrappedQuery = gapTileQuery(baseQuery, span, gapGeom);
const r = resolveTileY(player, player.vy, wrappedQuery, 16, prevBottom);
```

**Trade-offs:**

- **Ergonomics:** Excellent. Two focused functions. The caller composes freely: `advanceGapMotion` for the common case, hand-driven `centerX` for scripted gaps. The call site reads naturally.
- **Determinism:** Perfect. Both functions are pure. `advanceGapMotion` takes tick/dt in, returns new state out. No hidden state.
- **Runtime cost:** Minimal. `gapSolids` does one clamp + two push operations per tick. `advanceGapMotion` does one switch + arithmetic. No allocations beyond the returned fragments (which the resolver needs anyway).
- **Consumer complexity:** Low. The caller wires two function calls per tick. Slightly more boilerplate than a bundled object, but the wiring is trivial and the composition is obvious.
- **Invariant enforcement:** **Structural.** The clamp lives inside `gapSolids`. No caller — whether using `advanceGapMotion`, hand-driving centerX, or writing a custom motion mode — can produce fragments that escape the span. The invariant is enforced by construction.
- **Convention fit:** Matches the library's existing patterns. `resolveAxisX/Y` are composable pure functions; `gapSolids` follows the same shape. `advanceGapMotion` mirrors `advanceJump` / `advanceLocomotion` (state machine as pure progression op).

**What this makes easy:**
- Custom motion modes (hand-drive `centerX`, scripted paths, multi-gap choreography)
- The "void never standable" invariant is impossible to violate
- Testing: both functions are pure, trivially unit-testable
- Composability with the existing resolver (fragments are `Solid[]`)

**What this makes hard:**
- Consumers must wire the two calls themselves (minor boilerplate)
- No single object to "hold" — if a consumer wants a handle, they must store `GapMotionState` separately

---

### Approach B: Single Stateful `MovingGap` Entity

**Source pattern:** Pattern 1 (Spitekeep `movingVoid` as a `TrapHandler` with bundled state + geometry + motion), but with the clamp moved into `getSolids` to fix the invariant.

**Signature sketch:**

```ts
// src/collision/moving-gap.ts

export interface MovingGapConfig extends GapSpanConfig {
  readonly motion: GapMotionConfig;
}

export interface MovingGap {
  readonly config: MovingGapConfig;
  readonly state: GapMotionState;
}

/**
 * Create a moving gap with initial state centered on the span.
 */
export function createMovingGap(config: MovingGapConfig): MovingGap;

/**
 * Pure: advance the gap by one tick. Returns a new MovingGap.
 * Internally calls advanceGapMotion + gapSolids (clamp is inside getSolids).
 */
export function stepMovingGap(
  gap: MovingGap,
  dt: number,
  targetX?: number,
): MovingGap;

/**
 * Pure reader: return the current Solid fragments.
 * Internally clamps — invariant enforced.
 */
export function getSolids(gap: MovingGap): readonly Solid[];

/**
 * Pure reader: wrap a TileSolidityQuery to report 'empty' inside the gap.
 */
export function gapTileQuery(
  baseQuery: TileSolidityQuery,
  gap: MovingGap,
): TileSolidityQuery;
```

**Usage example:**

```ts
import { createMovingGap, stepMovingGap, getSolids } from 'aicraft-engine/src/collision';

const gap = createMovingGap({
  x: 136, y: 200, width: 688, height: 16,
  motion: { travelMode: 'chase', path: [], speed: 2, gapWidth: 64 },
});

// Each tick:
const nextGap = stepMovingGap(gap, 1, player.x + player.width / 2);
const fragments = getSolids(nextGap);
const allSolids = [...staticPlatforms, ...fragments];
const r = resolveAxisY(player, player.vy, allSolids, prevBottom);
```

**Trade-offs:**

- **Ergonomics:** Very good — fewer moving parts. One create, one step, one read. The consumer holds a single `MovingGap` object.
- **Determinism:** Same guarantees as Approach A — `stepMovingGap` returns a new object, no hidden state.
- **Runtime cost:** Identical to Approach A (same operations, just bundled).
- **Consumer complexity:** Lower wiring cost. But: the consumer cannot easily hand-drive the geometry without creating a fake `MovingGap` object.
- **Invariant enforcement:** **Structural, but coupled.** The clamp lives inside `getSolids`, which is correct. However, the geometry helper is NOT independently reusable — you must have a `MovingGap` to get fragments. This is a regression from Approach A for consumers who want scripted/manual gaps.
- **Convention fit:** Slightly breaks the library's existing pattern. The collision module exports pure functions over plain data, not stateful entities. `resolveAxisX/Y` don't own state; they take it. A `MovingGap` object is closer to Spitekeep's `TrapHandler` (which bundles state + behavior) than to the library's existing composable-function pattern.

**What this makes easy:**
- The common case (create → step → read) is a clean three-call pattern
- Consumers don't need to store state separately

**What this makes hard:**
- Custom/manual gap positioning requires creating a fake `MovingGap` or bypassing the API
- The geometry helper isn't independently composable (breaks the "geometry is reusable" principle from the research note)
- Couples two concerns that the research note explicitly says should be separated

---

### Approach C: Tile-Grid Mutation Layer (Procedural `TileSolidityQuery` Wrapper)

**Source pattern:** Pattern 3 (procedural solidity query from JS13k) + Pattern 2 (tilemap mutation, but procedural instead of imperative). This is the tile-grid-native approach.

**Signature sketch:**

```ts
// src/collision/moving-gap.ts

/**
 * Wrap a base TileSolidityQuery to report 'empty' for tiles inside the
 * current gap. The clamp is internal — the gap never escapes the span.
 *
 * Coordinate conversion: the tile-space span is converted to world
 * coordinates (tileX * tileSize .. (tileX + tileWidth) * tileSize),
 * the gap's centerX (world-space) is clamped using the same algorithm
 * as gapSolids, and each queried tile is checked against the clamped
 * world-space gap interval.
 *
 * Composes with the existing resolveTileX/Y.
 */
export function gapTileQuery(
  baseQuery: TileSolidityQuery,
  span: { tileX: number; tileY: number; tileWidth: number; tileSize: number },
  gap: GapGeometry,
): TileSolidityQuery;
```

**Usage example:**

```ts
import { gapTileQuery, advanceGapMotion } from 'aicraft-engine/src/collision';
import { resolveTileY } from 'aicraft-engine/src/collision';

const baseQuery: TileSolidityQuery = (tx, ty) => grid[ty]?.[tx] ?? 'empty';
const span = { tileX: 8, tileY: 12, tileWidth: 43, tileSize: 16 };

motionState = advanceGapMotion(motionState, 1, config);
const gapGeom: GapGeometry = { centerX: motionState.centerX, width: motionState.width };
const wrappedQuery = gapTileQuery(baseQuery, span, gapGeom);
const r = resolveTileY(player, player.vy, wrappedQuery, 16, prevBottom);
```

**Trade-offs:**

- **Ergonomics:** Excellent for tile-based games. The consumer wraps their query once and feeds it to the existing `resolveTileX/Y` — zero new resolver concepts.
- **Determinism:** Perfect. The wrapper is a pure closure over the base query + gap state.
- **Runtime cost:** Very low. The wrapper is called per-tile in the overlapping range. Each call does one range check (tileX within gap span) — O(1) per tile, no allocations.
- **Consumer complexity:** Lowest for tile-based consumers. But: completely useless for rect-list consumers. This approach is complementary to A, not a replacement.
- **Invariant enforcement:** **Structural.** The wrapper clamps the gap to the span before checking tile membership. A tile inside the clamped gap always reports 'empty'. A tile outside always reports the base query's result. The invariant holds by construction.
- **Convention fit:** Strong. Fits naturally alongside `resolveTileX/Y` in `src/collision/tiles.ts` or as a peer. The wrapper pattern is idiomatic for `TileSolidityQuery`.

**What this makes easy:**
- Tile-grid consumers get moving gaps with zero new resolver code
- The wrapped query composes directly with `resolveTileX/Y`
- No allocation of `Solid[]` arrays — the query runs per-tile inline

**What this makes hard:**
- Not useful for rect-list consumers (who need `Solid[]`)
- The wrapper is a closure — slightly harder to inspect/debug than a plain function
- Doesn't replace Approach A; it's an additional tool

---

## Comparison Table

| Criterion | A: Composable Helpers | B: Bundled Entity | C: Tile-Grid Wrapper |
|---|---|---|---|
| Ergonomics | ★★★★★ (two focused fns) | ★★★★ (fewer calls, less flexible) | ★★★★★ (trivial tile wiring) |
| Determinism | ★★★★★ (pure, stateless) | ★★★★★ (pure, immutable) | ★★★★★ (pure closure) |
| Runtime cost | ★★★★★ (2 pushes + clamp) | ★★★★★ (same, bundled) | ★★★★★ (O(1) per tile) |
| Invariant enforcement | ★★★★★ (structural, impossible to violate) | ★★★★ (structural, but coupled) | ★★★★★ (structural, per-tile) |
| Composability with resolver | ★★★★★ (Solid[] for rect, extensible) | ★★★★ (Solid[] only; tile requires extra wrapper) | ★★★★★ (TileSolidityQuery, direct) |
| Convention fit | ★★★★★ (matches pure-function pattern) | ★★★ (stateful entity, not library style) | ★★★★★ (matches tile-query pattern) |
| Flexibility for custom modes | ★★★★★ (hand-drive centerX freely) | ★★★ (must create fake MovingGap) | ★★★★★ (hand-drive GapGeometry freely) |
| Consumer boilerplate | ★★★★ (two calls per tick) | ★★★★★ (one create, one step, one read) | ★★★★★ (wrap query once) |

## Recommendation

**Ship all three as complementary layers:** `gapSolids` (geometry helper from A), `advanceGapMotion` (motion machine from A), and `gapTileQuery` (tile-wrapper from C). Do NOT ship the bundled entity from B.

**Why:** The research note's central insight — separate motion from geometry, put the clamp inside geometry — demands that the geometry helper is independently reusable. Approach A's `gapSolids` is that helper: it takes a span + a gap state, returns `Solid[]`, and clamps internally. It works for rect-list consumers, it works for hand-driven scripted gaps, and it composes with the existing resolver. Approach C's `gapTileQuery` adds tile-grid support by wrapping the same clamping logic into a `TileSolidityQuery` closure. Together, A + C cover both collision paths (rect-list and tile-grid) without any duplication of the clamp invariant.

Approach B adds no value that A doesn't already provide. The only advantage is "fewer variables to hold," but that advantage is offset by the coupling of motion + geometry (exactly what the bug analysis says to avoid) and the break from the library's pure-function convention. The `MovingGap` entity pattern belongs in Spitekeep's game layer (where the `TrapHandler` already bundles state), not in the library's collision primitives.

The clamp lives in one place: `gapSolids`. Both `advanceGapMotion` (which may produce unclamped centerX values) and `gapTileQuery` (which clamps per-tile) delegate to or mirror the same clamping logic. The invariant is structural and impossible to violate by construction.

---

## Clamp Algorithm (Invariant Anchor)

The "void never standable" invariant holds **by construction** through the following guard-ordered clamp algorithm. This is the single source of truth for fragment generation — both `gapSolids` and `gapTileQuery` implement it (the tile variant operates in world-space coordinates after converting the tile span).

### Input contract

- `span.x`, `span.width`, `gap.centerX`, `gap.width` are all finite numbers.
- `gap.centerX` is the world-space center of the gap (pixels).
- `gap.width` is the full width of the gap in world units.
- `span.width` is the width of the parent platform span.

### Guard order

```
function gapSolids(span, gap):
  // GUARD 1: NaN rejection (programmer error — consistent with parseHex).
  // NaN coordinates would propagate into fragment rects, producing
  // nonsensical geometry that silently corrupts the resolver. Throwing
  // immediately is safer than producing wrong geometry.
  if (isNaN(gap.centerX) || isNaN(gap.width)):
    throw new Error('gapSolids: centerX and width must be finite numbers')

  // GUARD 2: Non-positive gap width → no gap → entire span is solid.
  if (gap.width <= 0):
    return [{ x: span.x, y: span.y, width: span.width, height: span.height, passthrough: span.passthrough }]

  // GUARD 3: Gap wider than or equal to span → fully voided → 0 fragments.
  if (gap.width >= span.width):
    return []

  // GUARD 4: Normal case — gap fits within span.
  half = gap.width / 2
  minCenter = span.x + half
  maxCenter = span.x + span.width - half
  clampedCenter = clamp(gap.centerX, minCenter, maxCenter)
  gapLeft  = clampedCenter - half
  gapRight = clampedCenter + half

  fragments = []
  if (gapLeft > span.x):
    fragments.push({ x: span.x, y: span.y, width: gapLeft - span.x, height: span.height, passthrough: span.passthrough })
  if (span.x + span.width > gapRight):
    fragments.push({ x: gapRight, y: span.y, width: (span.x + span.width) - gapRight, height: span.height, passthrough: span.passthrough })
  return fragments
```

### Why this guard order makes the invariant true by construction

1. **Guard 1** ensures no NaN enters the fragment pipeline. This is the library's established pattern: `parseHex` throws on NaN because invalid numeric input is a programmer error, not a runtime condition. Producing wrong geometry silently is worse than failing fast.

2. **Guard 2** handles `gapWidth <= 0` by returning the full span as a single solid. This is a degenerate case that should never occur in normal gameplay, but the clamp math would fail if we tried to compute `half` with a non-positive width.

3. **Guard 3** is the critical fix for the Spitekeep reference implementation's failure mode. When `gapWidth >= span.width`, the naive clamp formula `minCenter = x + half; maxCenter = x + width - half` produces `minCenter > maxCenter` (or `minCenter === maxCenter` at equality), and a standard `Math.max(min, Math.min(max, v))` would return `min` — which is the leftmost edge of the gap, producing a spurious right fragment that covers part of the span. By returning 0 fragments *before* attempting the clamp, we avoid this entirely.

4. **Guard 4** handles the normal case. Because `gapWidth < span.width` (guaranteed by Guard 3), `half < span.width / 2`, so `minCenter < maxCenter`. The clamp is well-defined and produces a `clampedCenter` that keeps the gap strictly within the span. The fragment emission checks (`gapLeft > span.x`, `span.x + span.width > gapRight`) correctly produce 0, 1, or 2 fragments.

**Every possible input** — including pathological ones like `gapWidth = Infinity`, `centerX = -999999`, `gapWidth = span.width` exactly — maps to a correct fragment set. The invariant is not something the caller must verify; it is a property of the algorithm itself.

### Golden test cases

The deterministic test suite (Step 7 of the implementation plan) must lock these cases:

| Input | Expected output |
|---|---|
| `gapWidth = 0` | 1 fragment (full span) |
| `gapWidth = -10` | 1 fragment (full span) |
| `gapWidth = span.width - 1` | 2 fragments (gap flush left/right edge) |
| `gapWidth = span.width` | 0 fragments (fully voided) |
| `gapWidth = span.width + 100` | 0 fragments (fully voided) |
| `centerX = -Infinity` | Gap clamped to left edge → 1 fragment (right side) |
| `centerX = +Infinity` | Gap clamped to right edge → 1 fragment (left side) |
| `centerX = NaN` | Throws |
| `gapWidth = NaN` | Throws |
| `gapWidth = 64, centerX = span.x + 64` | Gap flush left → 1 fragment (right side) |
| `gapWidth = 64, centerX = span.x + span.width - 64` | Gap flush right → 1 fragment (left side) |

---

## Tile-Grid Coordinate Conversion (gapTileQuery)

`gapTileQuery` takes a **tile-space** span (`{ tileX, tileY, tileWidth, tileSize }`) but a **world-space** `GapGeometry` (`centerX` in pixels). The wrapper performs the following conversion:

### Step 1: Convert tile span to world coordinates

```
spanWorldLeft  = tileX * tileSize
spanWorldRight = (tileX + tileWidth) * tileSize
spanWorldWidth = tileWidth * tileSize
spanWorldY     = tileY * tileSize
spanWorldHeight = tileSize
```

### Step 2: Clamp gap in world space

Using the same guard-ordered algorithm as `gapSolids` (Guards 1–4), but operating on world-space values:

```
if (isNaN(gap.centerX) || isNaN(gap.width)): throw
if (gap.width <= 0): no tiles in range → return baseQuery as-is
if (gap.width >= spanWorldWidth): all tiles in range → report 'empty'
otherwise: standard clamp → [gapLeftWorld, gapRightWorld]
```

### Step 3: Per-tile membership check

The returned `TileSolidityQuery` closure does:

```
function wrappedQuery(tileX, tileY):
  // Only override tiles in the gap's row
  if (tileY !== span.tileY): return baseQuery(tileX, tileY)

  // Convert this tile's world position
  tileWorldLeft = tileX * tileSize

  // Check if the tile falls within the clamped gap interval
  if (tileWorldLeft >= gapLeftWorld && tileWorldLeft < gapRightWorld):
    return 'empty'

  return baseQuery(tileX, tileY)
```

### Why this works

The tile grid is discrete: each tile occupies exactly `tileSize` pixels. The world-space gap interval `[gapLeftWorld, gapRightWorld)` is computed using the same clamping algorithm as `gapSolids`. A tile is reported as `'empty'` if its left edge falls within this interval. Because the gap is clamped to the span, tiles outside the span are never affected.

The clamped world-space gap is **computed once per call** (in the closure's setup), not per-tile. Each per-tile invocation is O(1): one comparison against the pre-computed interval bounds.

---

## Player Resting on Fragment Edge — Why This Is Not a Bug

The research note flagged "player resting exactly on a fragment edge as the gap approaches" as an open question. This is **not** a bug, and here is the precise tick-level analysis of why.

### The strict AABB overlap test

`src/collision/aabb.ts` implements a strict AABB overlap test: edges that merely touch are **NOT** overlapping. From the source:

> Two rects overlap only when they share interior area on both axes. Edges that merely touch — `a`'s right at `b`'s left, or `a`'s bottom at `b`'s top — are NOT an overlap.

This strictness is load-bearing for the resolver: a body resting exactly on a platform top reads as "not overlapping", so it does not re-collide every tick (which would cause visible jitter / sinking).

### Tick-level trace

Consider a player standing on the left fragment of a gap-split span. The gap is approaching from the right. At tick N:

1. **Gravity applied** (before move-Y, per Spitekeep's `player.ts` discipline): `player.vy += GRAVITY * dt`.
2. **Move Y**: `player.y += player.vy`.
3. **Resolve Y** (`resolveAxisY`): the player's moved body is checked against each solid. The left fragment is a `Solid` at a specific Y position. The player's bottom edge was previously resting on this surface — after gravity + move-Y, the player has moved down by `vy * dt` pixels (typically 1–2 px at 60fps). `aabbOverlap` detects the overlap and snaps the player back to the surface. `landed = true`. Net effect: player stays on the fragment.

At tick N+K, the gap has swept rightward and the player's right edge now meets the left fragment's right edge exactly:

1. **Gravity applied**: `player.vy += GRAVITY * dt`.
2. **Move Y**: `player.y += player.vy`. The player moves down slightly.
3. **Resolve Y**: `aabbOverlap` between the player's moved body and the left fragment returns `true` (the player's bottom is now strictly below the fragment's top due to the gravity step). The player is snapped back and `landed = true`.

At tick N+K+1, the gap has moved past the player's position. The left fragment no longer exists (or its right edge is now to the left of the player):

1. **Gravity applied**: `player.vy += GRAVITY * dt`.
2. **Move Y**: `player.y += player.vy`. Player moves down.
3. **Resolve Y**: No fragment exists at the player's position. `aabbOverlap` returns `false` for all solids. No snap. `landed = false`. `player.vy` retains its gravity-driven value.
4. **Next tick**: player continues falling. The resolver finds no supporting solid → they fall into the gap.

The critical insight is that **gravity is applied every tick before move-Y**, so a resting player always re-evaluates support. When the fragment disappears, the player's `vy` accumulates downward, and the resolver's strict AABB test correctly finds no overlap. There is no snap-to-edge bug.

### Tunneling guard

Per-tick gap movement should stay below the player's body width to prevent the gap from jumping past the player in a single tick. The research note's context: Spitekeep's `speed ≤ 3.0` (px/tick) vs player width of ~16px ensures this. The gap moves at most 3px per tick; the player is 16px wide. The gap cannot traverse the player's entire width in one tick, so the player always has at least one tick where the fragment still exists beneath them.

This is a **consumer-side constraint**, not enforced by the library. The library's `advanceGapMotion` produces the gap center; it does not validate speed against player dimensions. Documenting this constraint in the JSDoc of `GapMotionConfig.speed` is sufficient.

---

## Design Decisions

### Does the gap carry the player?

**No.** The moving gap primitive is "absence of floor," full stop. Carrying is a separate concern. Spitekeep's `movingPlatform` carries via `carryX`/`carryY` modifiers; `movingVoid` explicitly does NOT carry. This matches the physics: a gap removes floor, it doesn't move the player. If a consumer needs a "moving platform that kills by falling," they compose the gap with their own carry logic. The primitive stays focused.

### Do fragments inherit `passthrough`?

**Yes.** The span declares its solidity via `passthrough` on `GapSpanConfig`. All fragments produced by `gapSolids` inherit this flag. This makes the primitive versatile: a one-way platform with a moving gap, or a fully-solid platform with a moving gap, both work identically.

### Multi-gap support?

**v1 ships single-gap.** The geometry helper accepts a single `GapGeometry` (one centerX, one width). The clamp is trivially correct for one gap: `clamp(centerX, spanLeft + half, spanRight - half)`. Multi-gap (N gaps on one span → N+1 fragments) is a documented future extension. The API is designed so `gapSolids` could accept `GapGeometry[]` in v2 without breaking the v1 signature — the single-gap case is the degenerate `length === 1`. Multi-gap introduces ordering questions (do gaps overlap? what happens?) that should be resolved by a second consumer, not guessed at in v1.

### Where it lives

**`src/collision/moving-gap.ts`** — a new file in the collision module. Barrel re-export from `src/collision/index.ts`. The collision module already has `types.ts`, `aabb.ts`, `resolve.ts`, `tiles.ts`, and `index.ts`. The new file follows the same pattern. The clamp logic is internal to `gapSolids` (not exported), keeping the public surface minimal.

### Constants

Named at the top of `moving-gap.ts` (or in a `constants.ts` if the collision module grows):

```ts
/** Default gap width in pixels. Matches Spitekeep GDD §6.13. */
export const DEFAULT_GAP_WIDTH = 64;

/** Default movement speed in px/tick. Matches Spitekeep GDD §6.13. */
export const DEFAULT_GAP_SPEED = 2;

/**
 * Default give-up radius for chase mode in pixels. Approximately 3× the
 * default gap width (64 × 3 ≈ 200), so chase disengages cleanly when the
 * player escapes beyond the gap's reach. Mirrors Spitekeep's chase-disengage
 * feel where the gap stops pursuing once the player is far enough ahead.
 */
export const DEFAULT_CHASE_GIVE_UP_RADIUS = 200;
```

### Determinism contract statement

Mirroring `src/animation/jump.ts`:

> **Determinism contract:** same `(state, dt, config, targetX?)` → byte-identical
> returned state, forever. No `Math.random`, no `Date.now`, no DOM reads, no
> global mutable state. The motion machine is a pure switch on `travelMode`
> plus arithmetic + a path-length projection. The geometry helper (`gapSolids`)
> is a pure clamp + arithmetic. The caller MUST use a fixed `dt` for trajectory
> determinism (variable `dt` causes integration drift — caller's responsibility).

---

## What the Implementation Must Respect

1. **The clamp lives in `gapSolids`, not in `advanceGapMotion`.** The motion machine may produce any `centerX`; the geometry helper enforces the span boundary.
2. **The clamp algorithm implements the four-guard sequence** documented above. Guard order is load-bearing: NaN rejection → non-positive width → gap≥span → normal clamp. This is what makes "void never standable" true by construction.
3. **`gapTileQuery` uses the same clamping logic** — it converts the tile span to world coords, clamps `gap.centerX` in world space using the same guard sequence, then checks each queried tile against the clamped interval.
4. **`path` and `loopMode` are optional** on `GapMotionConfig`. `advanceGapMotion` defaults `path` to `[]` and `loopMode` to `'loop'` when not provided. Chase/expand consumers need not supply them.
5. **NaN inputs throw**, consistent with `parseHex`. This is the library's established pattern for programmer errors in numeric APIs.
6. **Fragments inherit `passthrough`** from `GapSpanConfig.passthrough`.
7. **Zero allocations beyond the returned `Solid[]`** (or the closure for `gapTileQuery`).
8. **All public exports have JSDoc** matching the signatures above.
9. **All magic numbers are named constants** (no bare `64`, `2`, `200` in code).
10. **Test file: `src/tests/moving-gap.test.ts`** covering: gap fully inside span (2 fragments), gap flush left (1 fragment), gap flush right (1 fragment), gap covers span (0 fragments), gap width ≤ 0 (1 fragment = full span), gap width ≥ span.width (0 fragments), gap centerX out-of-bounds (clamped correctly), passthrough inheritance, NaN inputs (throws), tile-query wrapper, and the golden test cases from the clamp algorithm table above.
