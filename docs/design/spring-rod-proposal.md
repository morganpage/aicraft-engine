# API Proposal: Stable Springy-Rod Primitive

> Target pillar: 1 (Primitives / secondary dynamics). Module: `src/animation/spring-rod.ts`.
> Builds on research: `docs/research/springy-rod.md`.
> Status: DRAFT.

## Consumer Need

the reference implementation's slime-knight antenna, any future tail/mane/cape secondary element, and every consumer sibling that needs springy secondary dynamics all face the same problem: `advanceSpringChain` enforces only adjacent-node distances, so the chain buckles, kinks, and — critically — **numerically blows out** under extreme conditions (teleport, lag spike, violent anchor motion). The showcase's good antenna exists only because `showcase/helpers/slime-knight.ts` layers three local corrections (`applyAntennaBendConstraints`, `applyAntennaRestPose`, `applyAntennaTipWeight`) on top. Those corrections are production-quality but showcase-local: they allocate 4 arrays per frame (GC churn), they're error-prone to compose in the right order, and no other consumer gets them.

When this ships, a consumer writes:

```ts
let rod = createSpringRod(5, ax, ay, 4, { x: 0, y: 1 });
rod = advanceSpringRod(rod, ax, ay, 1, DEFAULT_SPRING_ROD);
```

...and gets a bend-resistant, direction-aware, blowout-proof rod with zero extra code. The stability guarantees are structural: epsilon-guarded division, velocity clamping, NaN/Infinity reset, and strain limiting run every call and cannot be disabled.

---

## Open Questions (Answered)

### Q1: Stiffness Parameterization

**Chosen: Single high-level `stiffness: number` in [0, 1].**

The consumer thinks in "how stiff is this rod?" not "what are my PBD constraint iteration counts and bend spring ratios?" A single `stiffness` maps to:

- `constraintIterations`: `Math.round(1 + stiffness * 7)` — 1 at stiffness 0 (floppy rope), 8 at stiffness 1 (near-rigid rod). Matches the JSDoc in `SpringConfig.constraintIterations` ("1–3 is typical for organic secondary motion; raise toward 8+ for near-rigid rods").
- Bend stiffness: implicitly derived inside the solver as `0.75 + 0.25 * stiffness` — 0.75 at stiffness 0 (minimal bend resistance), 1.0 at stiffness 1 (full Provot enforcement). The base/tip taper is applied internally; the consumer never sees it.

**Why not separate `distanceStiffness` + `bendingStiffness`?** In practice, distance and bend stiffness are correlated — a stiffer rod needs both. Exposing two knobs doubles the config surface for minimal practical benefit. The showcase's two separate constants (`ANTENNA_BASE_STIFFNESS` / `ANTENNA_BEND_STIFFNESS_BASE`) arose from incremental debugging, not from a genuine need for independent tuning. If a future consumer needs independent control, they can use `advanceSpringChain` + manual corrections (the old pattern).

### Q2: Rest Pose Configuration

**Chosen: A `restDirection: Vec2` field on the config — a single unit-ish vector pointing from root to tip.**

The rest pose for all target use cases (antenna, tail, mane, swimmer) is a straight line tilted in some direction. `restDirection` is normalized internally and scaled by `segmentLength`. Examples:

| Element | `restDirection` | Meaning |
|---|---|---|
| Upward antenna (leaning forward) | `{ x: 0.32, y: -1 }` | Leans forward (in facing direction) and up |
| Downward tail | `{ x: 0, y: 1 }` | Hangs straight down |
| Backward-flowing mane | `{ x: -1, y: 0 }` | Flows behind the character |
| Horizontal swimmer | `{ x: 1, y: 0 }` | Extends forward |

**Why not per-node rest angles?** Curved rest poses (e.g. a C-curved tail) would need per-node angle arrays. This adds significant API complexity for a feature no current consumer needs. The straight-rod-with-tilt covers every use case in the reference implementation and the planned siblings. A curved-rest extension can be added later as a config overload without breaking the base API.

**Why not a `restAngle: number` (radians)?** A Vec2 is more expressive (supports asymmetric rest poses in the future), avoids trig at the call site, and matches the `Vec2` type already used throughout the animation pillar. The consumer can trivially derive it: `{ x: Math.cos(angle), y: Math.sin(angle) }`.

### Q3: Sub-stepping Exposure

**Chosen: Internal sub-stepping via a `subSteps` config field (default 1).**

Sub-stepping divides `dt` into `subSteps` slices and runs the full solver (Verlet + distance + bend + rest-pose + tip-weight + stability guards) on each slice. This distributes forces over smaller increments, dramatically increasing stability for high stiffness or large timesteps.

**Why internal?** The whole point of this primitive is that stability is structural. If sub-stepping were caller-owned, a consumer could forget to sub-step and get the blowout this primitive exists to prevent. Since our chains are 3–6 nodes, 4 sub-steps cost ~24 constraint evaluations per frame — negligible. The `subSteps` field is exposed on the config (not hidden) because it IS a meaningful tuning knob: a 5-node chain at stiffness 0.3 needs fewer sub-steps than a 8-node chain at stiffness 0.9. Default 1 works for the common case.

---

## Approach A: Unified Single-Function Solver (Recommended)

**Source pattern:** The research's "Unified `advanceSpringRod` Solver (Single-Pass PBD)" combined with the showcase's layered corrections, merged into one function with structural stability guards.

**Signature sketch:**

```ts
// In src/animation/spring-rod.ts

import type { VerletNode } from './spring';

/**
 * Spring rod configuration. Controls rest-pose direction, stiffness,
 * tip sag, and solver sub-stepping. Stability guards (epsilon, velocity
 * clamp, NaN reset, strain limit) are baked in and non-optional.
 */
export interface SpringRodConfig {
  /** Rest distance between adjacent nodes in px. */
  segmentLength: number;
  /** Direction from root to tip (normalized internally). Default: {x:0, y:1} (downward tail). */
  restDirection: Vec2;
  /**
   * High-level stiffness in [0, 1].
   * 0 = floppy rope, 1 = near-rigid rod.
   * Maps to constraintIterations and bend stiffness internally.
   */
  stiffness: number;
  /** Downward positional nudge at the tip (px). 0 = no sag. Models tip mass. */
  tipWeight: number;
  /** Solver sub-steps per call (distributes forces for stability). Default: 1. */
  subSteps: number;
  /** Gravity X in px/tick². Default: 0. */
  gravityX: number;
  /** Gravity Y in px/tick². Default: 0. */
  gravityY: number;
  /** Velocity damping per tick [0, 1]. Default: 0.95. */
  drag: number;
}

/**
 * Default config: downward-hanging rod with moderate stiffness, no tip sag.
 * Matches DEFAULT_SPRING's physics but adds bend resistance + stability guards.
 */
export const DEFAULT_SPRING_ROD: Readonly<SpringRodConfig>;

/**
 * Create an initial straight chain of VerletNodes along a direction from
 * an anchor, with zero implicit velocity.
 *
 * @param count - node count (including root at index 0)
 * @param anchorX - root X
 * @param anchorY - root Y
 * @param segmentLength - distance between adjacent nodes
 * @param restDirection - direction vector from root to tip (normalized internally)
 * @returns array of VerletNode[] in a straight line along restDirection
 */
export function createSpringRod(
  count: number,
  anchorX: number,
  anchorY: number,
  segmentLength: number,
  restDirection: Vec2,
): VerletNode[];

/**
 * Advance a springy rod by one fixed timestep. Pure, deterministic, never throws.
 *
 * Combines Verlet integration + PBD distance constraints + Provot bend
 * constraints + directional rest-pose spring + tip-weight nudge in a
 * single unified solver. Stability guards run every call and cannot be
 * disabled:
 *   - Epsilon-guarded division (safe minimum distance 1e-4)
 *   - Implicit velocity clamping (maxVel = segmentLength * 5)
 *   - NaN/Infinity reset (entire chain reset to rest pose)
 *   - Strain limiting (maxStretch = segmentLength * 1.5)
 *
 * Physics order per sub-step:
 *   1. Pin root to anchor (immovable).
 *   2. Verlet integration for nodes 1..n-1.
 *   3. Distance constraints (PBD).
 *   4. Bend constraints (Provot next-nearest-neighbor).
 *   5. Rest-pose directional spring.
 *   6. Tip-weight nudge.
 *   7. Stability guards (epsilon, velocity clamp, NaN reset, strain limit).
 *
 * Pure: returns a NEW array of NEW VerletNode objects; input not mutated.
 *
 * @param nodes - current chain state (read-only)
 * @param anchorX - world X of the pinned root
 * @param anchorY - world Y of the pinned root
 * @param dt - fixed timestep (caller MUST keep constant for determinism)
 * @param config - rod physics parameters
 * @returns new VerletNode[] (input not mutated)
 *
 * @example
 * ```ts
 * // Upward antenna (leaning forward with facing)
 * let antenna = createSpringRod(5, ax, ay, 4, { x: 0.32, y: -1 });
 * antenna = advanceSpringRod(antenna, ax, ay, 1, {
 *   ...DEFAULT_SPRING_ROD,
 *   segmentLength: 4,
 *   restDirection: { x: 0.32 * facing, y: -1 },
 *   stiffness: 0.7,
 *   tipWeight: 0.12,
 * });
 *
 * // Downward tail
 * let tail = createSpringRod(6, hx, hy, 4, { x: 0, y: 1 });
 * tail = advanceSpringRod(tail, hx, hy, 1, {
 *   ...DEFAULT_SPRING_ROD,
 *   stiffness: 0.3,
 *   tipWeight: 0,
 * });
 * ```
 */
export function advanceSpringRod(
  nodes: readonly VerletNode[],
  anchorX: number,
  anchorY: number,
  dt: number,
  config: SpringRodConfig,
): VerletNode[];
```

**Usage example — upward antenna:**

```ts
import {
  createSpringRod,
  advanceSpringRod,
  DEFAULT_SPRING_ROD,
} from 'aicraft-engine/src/animation';

// Create initial chain along forward-tilted rest direction
const facing = 1; // +1 right, -1 left
const antenna = createSpringRod(5, bodyX, bodyTopY, 4, {
  x: 0.32 * facing,
  y: -1,
});

// In the game loop:
antenna = advanceSpringRod(antenna, bodyX, bodyTopY, 1, {
  ...DEFAULT_SPRING_ROD,
  segmentLength: 4,
  restDirection: { x: 0.32 * facing, y: -1 },
  stiffness: 0.7,
  tipWeight: 0.12,
});

// Draw as polyline
ctx.beginPath();
ctx.moveTo(antenna[0].x, antenna[0].y);
for (let i = 1; i < antenna.length; i++) {
  ctx.lineTo(antenna[i].x, antenna[i].y);
}
ctx.stroke();
```

**Usage example — downward tail:**

```ts
import {
  createSpringRod,
  advanceSpringRod,
  DEFAULT_SPRING_ROD,
} from 'aicraft-engine/src/animation';

// Create initial chain hanging downward
const tail = createSpringRod(6, hipX, hipY, 4, { x: 0, y: 1 });

// In the game loop:
const updatedTail = advanceSpringRod(tail, hipX, hipY, 1, {
  ...DEFAULT_SPRING_ROD,
  stiffness: 0.3,   // floppy tail
  tipWeight: 0,     // no tip mass
  gravityY: 0.5,    // natural gravity
});

// Draw as polyline
ctx.beginPath();
ctx.moveTo(updatedTail[0].x, updatedTail[0].y);
for (let i = 1; i < updatedTail.length; i++) {
  ctx.lineTo(updatedTail[i].x, updatedTail[i].y);
}
ctx.stroke();
```

**Trade-offs:**
- **Ergonomics:** Excellent. One function call replaces the 4-step pipeline. The consumer spreads `DEFAULT_SPRING_ROD` and overrides what they need. The `stiffness` knob is intuitive.
- **Determinism:** Perfectly deterministic. Same `(nodes, anchorX, anchorY, dt, config)` → byte-identical output. No `Math.random`, no `Date.now()`, no global state.
- **Runtime cost:** One array allocation per call (same as `advanceSpringChain`). The extra bend + rest-pose + tip-weight math is O(n) for a 3–6 node chain — negligible. Sub-stepping multiplies by `subSteps` but chains are short.
- **Consumer complexity:** Minimal. One import, one create call, one advance call per tick.
- **Tree-shake-ability:** Good. `createSpringRod`, `advanceSpringRod`, `DEFAULT_SPRING_ROD`, and `SpringRodConfig` are individually importable.
- **Convention fit:** Matches the `advance*` / `create*` / `DEFAULT_*` naming pattern exactly. Pure, never-throws, immutable-in/immutable-out.

**What this makes easy:** Any consumer gets a stable, good-looking rod with 2 lines of setup code. The showcase can delete its 3 local correction functions and ~150 lines of code.

**What this makes hard:** Advanced users who want independent control over distance vs. bend stiffness must use `advanceSpringChain` + manual corrections (the old pattern). This is acceptable — the vast majority of consumers want the safe default.

---

## Approach B: Layered Helper Functions (Showcase Pattern Promoted)

**Source pattern:** The showcase's `applyAntennaBendConstraints` / `applyAntennaRestPose` / `applyAntennaTipWeight` promoted into the library as separate exported functions.

**Signature sketch:**

```ts
// In src/animation/spring-rod.ts

export interface BendConstraintConfig {
  baseStiffness: number;
  tipStiffness: number;
}

export interface RestPoseConfig {
  direction: Vec2;
  baseStiffness: number;
  tipStiffness: number;
}

export function applyBendConstraints(
  nodes: VerletNode[],
  segmentLength: number,
  config: BendConstraintConfig,
): VerletNode[];

export function applyRestPose(
  nodes: VerletNode[],
  segmentLength: number,
  facing: 1 | -1,
  config: RestPoseConfig,
): VerletNode[];

export function applyTipWeight(
  nodes: VerletNode[],
  tipWeight: number,
): VerletNode[];
```

**Usage example:**

```ts
import {
  applyBendConstraints,
  applyRestPose,
  applyTipWeight,
  advanceSpringChain,
} from 'aicraft-engine/src/animation';

// Consumer must compose the pipeline manually:
let rod = advanceSpringChain(nodes, ax, ay, dt, springConfig);
rod = applyBendConstraints(rod, segLen, { baseStiffness: 0.95, tipStiffness: 0.75 });
rod = applyRestPose(rod, segLen, facing, {
  direction: { x: 0.32, y: -1 },
  baseStiffness: 0.35,
  tipStiffness: 0.22,
});
rod = applyTipWeight(rod, 0.12);
```

**Trade-offs:**
- **Ergonomics:** Poor. The consumer must remember the correct call order (bend → rest → tip), pass the right config to each, and allocate intermediate arrays. This is exactly the pattern that caused the bug — a consumer forgot one step or got the order wrong.
- **Determinism:** Deterministic, but the consumer can break determinism by calling in wrong order or reusing a mutated array.
- **Runtime cost:** 4 array allocations per frame (the GC churn the research flagged). Each helper allocates a new array even though the intermediate arrays are immediately discarded.
- **Consumer complexity:** High. Four imports, four calls, four config objects, correct ordering.
- **Tree-shake-ability:** Excellent — each helper is independently useful.
- **Convention fit:** Breaks the `advance*` naming convention. These are correction passes, not progression ops.

**What this makes easy:** Maximum flexibility. An advanced user could skip bend constraints or customize the pipeline order.

**What this makes hard:** Everything. The consumer must know the pipeline order, manage intermediate arrays, and pass per-function configs. This is the pattern that caused the blowout bug in the first place.

---

## Approach C: Composition via `advanceSpringChain` + Stability Wrapper

**Source pattern:** A thin wrapper that runs `advanceSpringChain` and then applies all corrections + stability guards as a post-pass.

**Signature sketch:**

```ts
// In src/animation/spring-rod.ts

export interface SpringRodConfig {
  segmentLength: number;
  restDirection: Vec2;
  stiffness: number;
  tipWeight: number;
  subSteps: number;
  gravityX: number;
  gravityY: number;
  drag: number;
}

export function advanceSpringRod(
  nodes: readonly VerletNode[],
  anchorX: number,
  anchorY: number,
  dt: number,
  config: SpringRodConfig,
): VerletNode[] {
  // Delegate to advanceSpringChain, then layer corrections
  let result = advanceSpringChain(nodes, anchorX, anchorY, dt, {
    segmentLength: config.segmentLength,
    gravityX: config.gravityX,
    gravityY: config.gravityY,
    drag: config.drag,
    constraintIterations: Math.round(1 + config.stiffness * 7),
  });
  result = applyBendConstraints(result, config.segmentLength, ...);
  result = applyRestPose(result, config.segmentLength, ...);
  result = applyTipWeight(result, config.tipWeight);
  result = applyStabilityGuards(result, config.segmentLength);
  return result;
}
```

**Trade-offs:**
- **Ergonomics:** Same as Approach A (single function call), but the implementation delegates to `advanceSpringChain`.
- **Determinism:** Deterministic, but the internal delegation means the solver runs distance constraints twice (once in `advanceSpringChain`, once implied by the post-pass corrections). This can cause subtle over-stiffening.
- **Runtime cost:** Higher than Approach A. `advanceSpringChain` allocates one array, then each correction allocates another. Total: 4+ allocations per call. The redundant distance constraint pass wastes CPU.
- **Consumer complexity:** Same as A (good).
- **Tree-shake-ability:** Depends on `advanceSpringChain` — the wrapper can't be tree-shaken independently if it imports the full spring module.
- **Convention fit:** Matches naming, but the internal architecture is layered rather than unified.

**What this makes easy:** Simple implementation for `@coder` — just compose existing functions.

**What this makes hard:** Performance (4 allocations vs 1), redundant constraint passes (subtle over-stiffening), and the layered internals make the stability guarantees harder to verify (the guards run AFTER corrections, not integrated into the solver loop).

---

## Comparison Table

| Criterion | A: Unified Solver | B: Layered Helpers | C: Composition Wrapper |
|---|---|---|---|
| Ergonomics | ★★★★★ | ★★ | ★★★★★ |
| Determinism | ★★★★★ | ★★★ (order-dependent) | ★★★★ (redundant passes) |
| Runtime cost | ★★★★★ (1 alloc) | ★★ (4 allocs) | ★★★ (4+ allocs) |
| Convention fit | ★★★★★ | ★★★ | ★★★★ |
| Stability guarantee | Structural (baked in) | Consumer-owned (fragile) | Post-pass (verifiable but layered) |
| Consumer complexity | Minimal | High | Minimal |
| Tree-shake-ability | ★★★★ | ★★★★★ | ★★★ |

---

## Recommendation

**Approach A: Unified Single-Function Solver.**

The whole reason this primitive exists is that the layered pattern (Approach B) caused a blowout bug. A composition wrapper (Approach C) preserves the layered architecture internally, which means the stability guarantees are post-hoc rather than structural. Only Approach A integrates everything into a single solver loop where the stability guards are woven into the constraint math, making blowouts structurally impossible.

The performance win is real: 1 array allocation per call vs 4. On mobile devices with GC pressure, this matters. The ergonomic win is real: one function call vs four. The convention fit is perfect: `advanceSpringRod` follows the `advance*` naming pattern, `createSpringRod` follows `create*`, `DEFAULT_SPRING_ROD` follows `DEFAULT_*`.

The `advanceSpringChain` export is **kept, not deprecated**. It serves advanced users who want the raw unguarded substrate. Adding a JSDoc note recommending `advanceSpringRod` for most use cases is sufficient for now. Deprecation can come in v2 if the showcase migration proves that no consumer needs the raw version.

---

## Backward Compatibility: `advanceSpringChain`

**Decision: Keep as-is, add advisory JSDoc.**

`advanceSpringChain` is a shipped public API (npm `0.1.0`). Removing it is a semver-major breaking change. More importantly, it IS useful: advanced users who want custom constraint pipelines (e.g. cloth simulation, rope bridges, non-standard bend models) need the raw substrate.

The resolution:
- `advanceSpringChain` stays exported with its current signature and behavior.
- Its JSDoc gains a note: `@remark For most secondary-dynamics use cases (antennae, tails, hair), prefer advanceSpringRod which adds bend resistance, rest-pose springs, and structural stability guards.` 
- `DEFAULT_SPRING` stays exported for consumers who use `advanceSpringChain` directly.
- No removal, no deprecation, no signature change. Purely additive.

---

## Behavior Contract: Stability Guarantees

These guarantees are NON-OPTIONAL and baked into `advanceSpringRod`'s implementation. They cannot be disabled via config.

### 1. Epsilon-Guarded Division
**Guarantee:** No division by a distance smaller than `1e-4`. When two nodes become nearly coincident (`d < 1e-4`), the constraint solver assigns a fallback direction vector (along the rest direction) and clamps `d` to `1e-4`. This prevents the division-by-near-zero explosion that caused the original blowout.

**Why non-optional:** This is the primary defense against the "line covering half the screen" glitch. Making it optional defeats the entire purpose.

### 2. Implicit Velocity Clamping
**Guarantee:** Each node's implicit velocity `(x - prevX, y - prevY)` is clamped to `maxVelocity = segmentLength * 5` before integration. This caps the maximum single-frame displacement to `5 * segmentLength`, preventing whip/lash from violent anchor motion (teleport, lag spike).

**Why non-optional:** High-speed anchor motion is the second most common blowout trigger. The velocity clamp prevents it regardless of stiffness or sub-step count.

### 3. NaN/Infinity Reset
**Guarantee:** After all constraint solving, if any node coordinate is `NaN` or `!isFinite`, the ENTIRE chain is reset to its rest pose relative to the current anchor. The blowout lasts at most one frame.

**Why non-optional:** This is the nuclear safety net. If any other guard fails, this catches it. Without it, a single NaN propagates through all future calculations, permanently corrupting the chain.

### 4. Strain Limiting
**Guarantee:** After constraints, if any adjacent-node distance exceeds `segmentLength * 1.5`, the node is clamped along the segment vector to exactly `segmentLength * 1.5`. This prevents the PBD solver from leaving segments stretched under extreme loads.

**Why non-optional:** PBD constraints are soft (finite iterations → imperfect convergence). Under high stiffness or large dt, residual stretch can accumulate. The strain limit is the final hard cap.

---

## Prior Art Drawn From

| Pattern | Source | What we take |
|---|---|---|
| Provot bend constraints | Showcase `applyAntennaBendConstraints`, derived from Jakobsen 2001 | Next-nearest-neighbor distance constraints with tapered stiffness, root-absorbs-all correction, velocity preservation |
| Directional rest-pose spring | Showcase `applyAntennaRestPose` | Per-node positional pull toward a rotated rest vector, tapered stiffness, facing-aware screen-space lean |
| Tip-weight nudge | Showcase `applyAntennaTipWeight` | Positional downward nudge proportional to chain position, applied after rest-pose |
| Epsilon-guarded distance | Research §Stability Techniques | Safe minimum distance with fallback direction |
| Velocity clamping | Research §Stability Techniques | Implicit velocity component clamping before integration |
| NaN/Infinity reset | Research §Stability Techniques | Post-solve finite-check with rest-pose fallback |
| Strain limiting | Research §Stability Techniques | Post-solve max-stretch clamp |
| Pure progression ops | `advanceFootLock`, `advanceSpringChain` | Immutable-in, new-state-out, never-throw |
| Config-as-spread | `DEFAULT_SPRING`, `DEFAULT_JUMP` | Consumer spreads defaults and overrides specific fields |

---

## Implementation Notes for @coder

1. **File:** `src/animation/spring-rod.ts`. Types and implementation in one file (small enough; matches `spring.ts` pattern).
2. **Barrel:** Add `export * from './spring-rod'` to `src/animation/index.ts`.
3. **`restDirection` normalization:** Normalize once at the top of `advanceSpringRod` (not per-sub-step). Cache `nx = rx / len`, `ny = ry / len` where `len = Math.sqrt(rx*rx + ry*ry)`. Guard `len < 1e-8` by falling back to `{x: 0, y: -1}` (upward default).
4. **Sub-stepping:** Outer loop `for (let s = 0; s < config.subSteps; s++)` wraps the full solver (Verlet + distance + bend + rest-pose + tip-weight + guards). Each sub-step uses `dt / subSteps`.
5. **Velocity preservation:** All corrections (bend, rest-pose, tip-weight) move both `x/y` AND `prevX/prevY` by the same delta. This is critical — it prevents positional jumps from appearing as velocity spikes.
6. **Stiffness mapping:**
   - `constraintIterations = Math.max(1, Math.round(1 + stiffness * 7))`
   - Bend stiffness = `0.75 + 0.25 * stiffness` (applied per-pair with base/tip taper)
   - Rest-pose stiffness = `stiffness * 0.5` (scaled from stiffness; base/tip taper applied internally)
7. **Root handling:** Node 0 (anchor) is always pinned and never integrated. For bend constraints at `i=0`, node 2 absorbs 100% of the correction (matches showcase). For rest-pose at `i=0`, node 1 absorbs 100%.
8. **`createSpringRod`:** Places node `i` at `anchor + restDirection * i * segmentLength` (after normalization). Each node's `prev = curr` (zero implicit velocity).
9. **`DEFAULT_SPRING_ROD`:** `{ segmentLength: 4, restDirection: {x: 0, y: 1}, stiffness: 0.5, tipWeight: 0, subSteps: 1, gravityX: 0, gravityY: 0, drag: 0.95 }`. Conservative defaults; consumers override for their specific element.
10. **Tests:** Test files in `src/tests/spring-rod.test.ts`. Key tests:
    - Blowout-proof: extreme dt (1000) → no NaN/Infinity in output
    - Blowout-proof: two nodes at same position → no explosion
    - Determinism: same input → byte-identical output (3 runs)
    - Antenna look: default config produces upward-bending chain from downward gravity
    - Tail look: default config produces downward-hanging chain
    - Velocity preservation: corrections don't introduce velocity spikes
    - Sub-stepping: subSteps=4 converges better than subSteps=1 for high stiffness
