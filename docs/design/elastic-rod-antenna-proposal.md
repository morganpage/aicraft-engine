# API Proposal: Elastic Rod Antenna Bending Resistance

> Target pillar: 1 (Primitives/secondary dynamics). Module: `src/animation/`.
> Builds on research: `docs/research/elastic-rod-antenna.md`.
> Status: DRAFT.

## Consumer Need

**Primary consumer:** Spitekeep's slime-knight antenna. Currently, `advanceSpringChain` (pure distance-constraint PBD) produces a rope/chain with free-hinge joints. The showcase-local `applyAntennaRestPose` compensates by pulling each node toward a world-space absolute rest position with tapered stiffness — but this 1-body directional spring gets overwhelmed by inertia during jumps and landings, causing the antenna to buckle and whip instead of bending as a smooth elastic rod. Additionally, `drawAntenna` strokes the chain as a polyline (C0 continuity), compounding the kink read.

**What becomes possible:** Bending-resistant secondary dynamics for antennae, tails, hair strands, vines, and capes. Any short Verlet chain that should read as a "bendy solid rod" rather than a "floppy rope."

**Current workaround:** The four named constants (`ANTENNA_BASE_STIFFNESS`, `ANTENNA_TIP_STIFFNESS`, `ANTENNA_FORWARD_LEAN_X`, `ANTENNA_TIP_WEIGHT`) composed in two showcase-local passes after the library solver. This partially works for idle/walk but buckles under violent anchor motion.

---

## Approach A: Provot Bend Springs + Midpoint Bézier (Library Composable)

> **Physics:** P1 (Provot next-nearest-neighbor bend springs).
> **Placement:** L2 (new library composable function).
> **Rendering:** R1 (midpoint bézier, folded into showcase draw).

### Source Pattern

Provot 1995 — next-nearest-neighbor distance constraints. Research §Pattern 2. The simplest possible physics fix: add a distance constraint between nodes `i` and `i+2` with a rest length computed from the curved (forward-leaning) rest geometry. Reuses existing PBD distance machinery exactly. Risk: 180° pop on extreme bending (irrelevant for moderate antenna deflection).

### New Library Export

```ts
// In src/animation/spring.ts (additive — no existing exports modified)

/**
 * Configuration for bending resistance on a Verlet-PBD chain.
 *
 * Bending constraints are next-nearest-neighbor distance constraints
 * (Provot 1995): a distance constraint between nodes `i` and `i+2`
 * whose rest length encodes the curved rest geometry. This prevents
 * the chain from buckling or kinking under violent anchor motion.
 *
 * The rest length per pair is NOT `2 × segmentLength` (that assumes
 * a straight rod). For a forward-leaning antenna, it is the geodesic
 * distance between nodes `i` and `i+2` along the curved rest pose.
 * Pre-compute this from the segment length and forward lean angle.
 */
export interface BendConfig {
  /**
   * Per-segment stiffness in [0, 1]. 0 = no bending resistance (rope),
   * 1 = maximum bending resistance (rigid rod). Applied uniformly to
   * all joint triplets.
   *
   * For tapered stiffness (base-stiffer-than-tip), pass a per-joint
   * array via `jointStiffness` instead.
   */
  stiffness: number;

  /**
   * Optional per-joint stiffness override. Length must equal
   * `nodeCount - 2` (one entry per triplet: nodes i, i+1, i+2).
   * If provided, overrides the uniform `stiffness` field.
   *
   * For the antenna: index 0 (base triplet) gets the highest value,
   * the last index (tip triplet) gets the lowest, linearly tapered.
   */
  jointStiffness?: readonly number[];

  /**
   * Pre-computed rest lengths for each next-nearest-neighbor pair.
   * Length must equal `nodeCount - 2`.
   *
   * For a straight rod: each entry = `2 * segmentLength`.
   * For a forward-leaning antenna: compute from the rest geometry,
   * e.g. `sqrt((2*rx)² + (2*ry)²)` where rx/ry are the per-segment
   * rest vector components.
   *
   * If omitted, defaults to straight-rod rest lengths
   * (`2 * segmentLength` from the SpringConfig).
   */
  restLengths?: readonly number[];
}

/**
 * Default bend config for a straight rod (no lean). Each pair rest
 * length = 2× segment length.
 */
export function defaultBendConfig(
  segmentLength: number,
  nodeCount: number,
  stiffness: number,
): BendConfig;
```

**Composable function (the core addition):**

```ts
/**
 * Apply bending resistance to a Verlet chain as a post-pass after
 * `advanceSpringChain`. Enforces next-nearest-neighbor distance
 * constraints (Provot 1995) that prevent buckling and kinking.
 *
 * Operates in place on the fresh chain from `advanceSpringChain`
 * (already a deep copy — the caller's state is never mutated).
 * Moves curr AND prev by the same delta to preserve implicit
 * Verlet velocity (same discipline as the rest-pose correction).
 *
 * Physics order: call AFTER `advanceSpringChain` and BEFORE any
 * showcase-local passes (rest pose, tip weight). The bend springs
 * enforce inter-segment smoothness; the absolute-direction spring
 * (if present) enforces the forward lean.
 *
 * Pure: returns the same array (mutated in place) for chaining.
 * Deterministic: no hidden state, no Math.random, no Date.now.
 *
 * @param nodes - fresh chain from `advanceSpringChain` (mutated + returned)
 * @param config - bending resistance parameters
 * @returns the same array (mutated in place) for chaining
 */
export function satisfyBendConstraints(
  nodes: VerletNode[],
  config: BendConfig,
): VerletNode[];
```

### Rest Length Computation (Showcase Helper)

The curved rest geometry is showcase-specific (the forward lean angle is a showcase constant). A helper computes the rest lengths:

```ts
// In showcase/helpers/slime-knight.ts (showcase-local, not exported)

/**
 * Pre-compute bend-spring rest lengths for a forward-leaning antenna.
 *
 * Each segment's rest vector is { x: seg * lean, y: -sqrt(seg² - (seg*lean)²) }.
 * The rest length for the i→i+2 pair is the distance between positions
 * i and i+2 along the rest curve: |v[i] + v[i+1]| where v[k] is the
 * per-segment rest vector (all segments identical here).
 *
 * @param segmentLength - rest distance between adjacent nodes
 * @param leanX - forward lean fraction (ANTENNA_FORWARD_LEAN_X)
 * @param nodeCount - total nodes in chain
 * @returns rest lengths for each i→i+2 pair
 */
function computeBendRestLengths(
  segmentLength: number,
  leanX: number,
  nodeCount: number,
): number[] {
  const rx = segmentLength * leanX;
  const ry = -Math.sqrt(segmentLength * segmentLength - rx * rx);
  // Two-segment geodesic: displacement = (2*rx, 2*ry)
  const restLen = Math.sqrt((2 * rx) * (2 * rx) + (2 * ry) * (2 * ry));
  return Array.from({ length: nodeCount - 2 }, () => restLen);
}
```

### Usage Example (Showcase `stepHero`)

```ts
// In stepHero, AFTER advanceSpringChain, BEFORE rest-pose/tip-weight:

let antenna = advanceSpringChain(
  state.antenna, anchor.x, anchor.y, dt, config.springConfig,
);

// 1. Bending resistance (library composable) — enforces inter-segment smoothness.
antenna = satisfyBendConstraints(antenna, config.bendConfig);

// 2. Forward-tilted rest pose (showcase-local absolute spring) — enforces lean.
//    COEXISTS with bend springs: bend = smoothness, rest-pose = orientation.
antenna = applyAntennaRestPose(antenna, config.antennaSegmentLength);

// 3. Tip weight (showcase-local) — sags the ball.
antenna = applyAntennaTipWeight(antenna);
```

**Order rationale:** Bend constraints run first (inside the PBD loop's natural slot) to enforce smoothness before the absolute-direction spring sets orientation. This mirrors the research recommendation: "angular/bend constraints should be solved *before* or *interleaved with* distance constraints." The absolute spring then nudges the overall lean without fighting the bend smoothness.

### Tapered Stiffness

The `jointStiffness` array encodes the base→tip taper. For the antenna with 5 nodes (4 segments, 3 triplets):

```ts
// In deriveHeroConfig or as a named constant:
const BEND_STIFFNESS_BASE = 0.6;
const BEND_STIFFNESS_TIP = 0.35;

// Pre-compute tapered array:
const jointStiffness = triplets.map((_, i) => {
  const t = i / Math.max(1, triplets - 1);
  return BEND_STIFFNESS_BASE + (BEND_STIFFNESS_TIP - BEND_STIFFNESS_BASE) * t;
});
```

### Rendering: Midpoint Bézier (R1 — Always-Do)

Replace `strokeVerlet` in `drawAntenna` with a midpoint-bézier pass:

```ts
// In showcase/helpers/slime-knight.ts — replace strokeVerlet calls in drawAntenna

function drawAntenna(
  ctx: CanvasRenderingContext2D,
  nodes: readonly VerletNode[],
  palette: Palette,
): void {
  if (nodes.length < 2) return;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Outline pass (thicker).
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 5;
  strokeBézier(ctx, nodes);

  // Core pass (narrower).
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 2;
  strokeBézier(ctx, nodes);

  // Tip ball (unchanged).
  const tip = nodes[nodes.length - 1];
  const ballR = 5;
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, ballR, 0, Math.PI * 2);
  ctx.fillStyle = palette.accent;
  ctx.fill();
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/**
 * Stroke a smooth C1 curve through Verlet nodes using midpoint bézier
 * (quadratic CurveTo). The control point is the physics node; the on-curve
 * point is the midpoint between adjacent nodes. First and last nodes are
 * on-curve endpoints.
 *
 * Native Canvas2D — zero allocations, deterministic, pure rendering.
 */
function strokeBézier(
  ctx: CanvasRenderingContext2D,
  nodes: readonly VerletNode[],
): void {
  if (nodes.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(nodes[0].x, nodes[0].y);
  for (let i = 1; i < nodes.length - 1; i++) {
    const xc = (nodes[i].x + nodes[i + 1].x) / 2;
    const yc = (nodes[i].y + nodes[i + 1].y) / 2;
    ctx.quadraticCurveTo(nodes[i].x, nodes[i].y, xc, yc);
  }
  ctx.lineTo(nodes[nodes.length - 1].x, nodes[nodes.length - 1].y);
  ctx.stroke();
}
```

### Relationship to `applyAntennaRestPose`

**COEXIST.** The bend springs enforce inter-segment smoothness (no kinks, no buckling). The absolute-direction spring (`applyAntennaRestPose`) enforces the overall forward lean. They solve orthogonal problems:
- Bend springs: "segments should smoothly connect to each other" (relative).
- Rest-pose spring: "the whole chain should lean forward" (absolute).

Removing `applyAntennaRestPose` would lose the forward-lean intent. The bend springs alone would produce a straight (or gravity-curved) rod, not a forward-leaning one.

### Trade-offs

- **Ergonomics:** Good. `satisfyBendConstraints` is a single composable call. The rest-length pre-computation is a one-liner helper. Consumers tune `stiffness` (single number) or `jointStiffness` (per-triplet array) + `restLengths`.
- **Determinism:** Pure. No hidden state, no Math.random, no Date.now. Fixed-point deterministic under constant dt.
- **Runtime cost:** Negligible. One `sqrt` per triplet per call (for the distance computation). For a 5-node chain at 60Hz, that's 3 triplets × 1 call × 1 sqrt = trivial.
- **Consumer complexity:** Low. Call one function after `advanceSpringChain`. Rest lengths need pre-computation (one helper, called once at config time).
- **Tree-shake-ability:** Good. `satisfyBendConstraints` and `BendConfig` are individually importable. `defaultBendConfig` is a convenience.
- **Convention fit:** Follows the composable-pass pattern established by `advanceLocomotionByDisplacement` + `blendAirborneTuck`. Pure function, velocity-preservation discipline, no magic numbers.
- **Reusability:** High. Any Verlet chain (hair, tails, vines, capes) can use `satisfyBendConstraints` with appropriate `restLengths`.
- **Risk:** 180° pop on extreme bending. For an antenna with moderate deflection (~30° max), this is irrelevant. For extreme cases, a guard could clamp the correction — but that adds complexity and isn't needed for v1.

### What this makes easy
- Tuning: one `stiffness` knob, or per-joint taper.
- Composability: library function composes with any showcase-local passes.
- Reuse: any chain can add bending resistance with one call.

### What this makes hard
- Rest-length pre-computation for non-straight rest poses (requires a helper or manual calculation).
- The absolute-direction spring and bend springs are separate passes — two things to tune instead of one.
- The 180° pop failure mode exists (though irrelevant for moderate bending).

---

## Approach B: Angular PBD Constraints + Midpoint Bézier (Library Composable, Subsumes Rest Pose)

> **Physics:** P2 (2D angular PBD constraints).
> **Placement:** L2 (new library composable function).
> **Rendering:** R1 (midpoint bézier, folded into showcase draw).

### Source Pattern

2D Angular PBD Constraints (Box2D/Matter.js joint limits style). Research §Pattern 3. Restores the relative angle between adjacent segments to a target rest angle θ₀ using direct rotation around the shared joint. Most robust for curved rest poses — prevents folding/flipping entirely. Handles the forward lean natively via per-joint rest angles.

### Key Design Insight

The per-joint rest angles **encode the forward lean**. If each joint's rest angle θ₀ is the angle between consecutive forward-leaning segments, the angular constraint both (a) enforces inter-segment smoothness AND (b) enforces the forward lean — **subsuming `applyAntennaRestPose` entirely**. This collapses two passes (bend + rest-pose) into one.

### New Library Export

```ts
// In src/animation/spring.ts (additive — no existing exports modified)

/**
 * Configuration for angular bending resistance on a Verlet-PBD chain.
 *
 * Angular constraints restore the relative angle between adjacent
 * segments to a target rest angle θ₀. This prevents buckling, folding,
 * and flipping — and for curved rest poses (e.g., a forward-leaning
 * antenna), the rest angles encode the lean directly.
 *
 * The rest angle at joint i is the signed angle (radians) from segment
 * (i-1 → i) to segment (i → i+1) in the rest pose. For a straight rod,
 * all rest angles = π (180°). For a forward-leaning antenna, each rest
 * angle is slightly less than π (the segments bend forward).
 */
export interface AngularBendConfig {
  /**
   * Per-joint rest angle in radians. Length must equal `nodeCount - 2`
   * (one entry per internal joint: nodes 1 through n-2).
   *
   * For a straight rod: all entries = Math.PI.
   * For a forward-leaning antenna: compute from the rest geometry.
   */
  restAngles: readonly number[];

  /**
   * Per-joint stiffness in [0, 1]. 0 = no angular resistance (free hinge),
   * 1 = rigid joint. Length must equal `nodeCount - 2`.
   *
   * For tapered stiffness (base-stiffer-than-tip): index 0 gets the
   * highest value, the last index gets the lowest.
   */
  stiffness: readonly number[];
}

/**
 * Compute rest angles for a uniformly-curved rod.
 *
 * Each segment's rest vector is rotated forward by `leanAngle` radians
 * from straight-up. The relative angle at each joint is
 * π - leanAngle (the segments bend forward by `leanAngle`).
 *
 * @param nodeCount - total nodes in chain
 * @param leanAngle - forward lean in radians (e.g. atan(ANTENNA_FORWARD_LEAN_X))
 * @returns rest angles array (length = nodeCount - 2)
 */
export function computeRestAngles(
  nodeCount: number,
  leanAngle: number,
): number[];

/**
 * Default angular bend config for a straight rod. All rest angles = π,
 * all stiffness uniform.
 */
export function defaultAngularBendConfig(
  nodeCount: number,
  stiffness: number,
): AngularBendConfig;
```

**Composable function (the core addition):**

```ts
/**
 * Apply angular bending resistance to a Verlet chain as a post-pass
 * after `advanceSpringChain`. For each internal joint (nodes i-1, i, i+1),
 * computes the current relative angle and rotates the outer nodes to
 * restore the angle toward the per-joint rest angle θ₀.
 *
 * Operates in place on the fresh chain from `advanceSpringChain`
 * (already a deep copy — the caller's state is never mutated).
 * Moves curr AND prev by the same delta to preserve implicit
 * Verlet velocity.
 *
 * Physics order: call AFTER `advanceSpringChain`. This pass
 * REPLACES `applyAntennaRestPose` when the rest angles encode the
 * forward lean — the angular constraint enforces both smoothness
 * AND orientation. Call `applyAntennaTipWeight` AFTER this pass.
 *
 * Pure: returns the same array (mutated in place) for chaining.
 * Deterministic: no hidden state, no Math.random, no Date.now.
 *
 * @param nodes - fresh chain from `advanceSpringChain` (mutated + returned)
 * @param config - angular bending parameters
 * @returns the same array (mutated in place) for chaining
 */
export function satisfyAngularBendConstraints(
  nodes: VerletNode[],
  config: AngularBendConfig,
): VerletNode[];
```

### Rest Angle Computation (Showcase + Library Helper)

```ts
// Library helper (exported):
export function computeRestAngles(
  nodeCount: number,
  leanAngle: number,
): number[] {
  // Each joint's rest angle = π - leanAngle (segments lean forward).
  // All joints identical for uniform curvature.
  const restAngle = Math.PI - leanAngle;
  return Array.from({ length: nodeCount - 2 }, () => restAngle);
}

// In showcase/helpers/slime-knight.ts (showcase-local):
const ANTENNA_LEAN_ANGLE = Math.atan(ANTENNA_FORWARD_LEAN_X); // ~0.216 rad ≈ 12.4°

// Pre-computed once at config time:
const antennaRestAngles = computeRestAngles(ANTENNA_NODE_COUNT, ANTENNA_LEAN_ANGLE);
```

### Tapered Stiffness

```ts
// In deriveHeroConfig or as named constants:
const ANGULAR_STIFFNESS_BASE = 0.7;
const ANGULAR_STIFFNESS_TIP = 0.4;

// Pre-computed tapered array (length = nodeCount - 2):
const angularStiffness = triplets.map((_, i) => {
  const t = i / Math.max(1, triplets - 1);
  return ANGULAR_STIFFNESS_BASE + (ANGULAR_STIFFNESS_TIP - ANGULAR_STIFFNESS_BASE) * t;
});
```

### Usage Example (Showcase `stepHero`)

```ts
// In stepHero, AFTER advanceSpringChain:

let antenna = advanceSpringChain(
  state.antenna, anchor.x, anchor.y, dt, config.springConfig,
);

// 1. Angular bending resistance (library composable) — enforces BOTH
//    smoothness AND forward lean (rest angles encode the lean).
//    REPLACES applyAntennaRestPose.
antenna = satisfyAngularBendConstraints(antenna, config.angularBendConfig);

// 2. Tip weight (showcase-local) — sags the ball.
//    Still needed: the angular constraint doesn't model ball mass.
antenna = applyAntennaTipWeight(antenna);
```

### What Happens to `applyAntennaRestPose`?

**REPLACED.** The angular constraint's rest angles encode the forward lean. The per-joint stiffness encodes the base→tip taper. This single pass does what `applyAntennaRestPose` did (orientation) PLUS what the bend springs would do (smoothness). The two showcase-local passes (`applyAntennaRestPose` + `applyAntennaTipWeight`) collapse to one (`applyAntennaTipWeight` only).

The `ANTENNA_FORWARD_LEAN_X` constant is still used — but now it feeds into `computeRestAngles` (converting to radians) rather than into the absolute-direction spring's rest-vector computation.

**However:** if the benchmarker finds that the angular constraint alone doesn't produce enough "springy forward lean" feel (because angular constraints resist *changes* to the angle but don't actively *pull* toward the rest angle with positional authority the way the absolute spring does), we could add `applyAntennaRestPose` back as a weak complement. The architecture supports this — it's just one more composable call. This fallback path is the safety net.

### Rendering: Midpoint Bézier (R1)

Same as Approach A. The `strokeBézier` helper replaces `strokeVerlet` in `drawAntenna`.

### Trade-offs

- **Ergonomics:** Excellent — if the rest angles are pre-computed. The consumer calls one function (`satisfyAngularBendConstraints`) that replaces both the bend pass AND the rest-pose pass. Fewer passes = simpler mental model.
- **Determinism:** Pure. atan2/cos/sin are deterministic under fixed floating-point. No hidden state.
- **Runtime cost:** Moderate. Requires `atan2` (2 calls per joint), `cos`/`sin` (2 calls per joint for rotation). For a 5-node chain (3 joints), that's 6 trig calls per step. At 60Hz this is negligible — but it IS more expensive than Approach A's pure-arithmetic distance constraints.
- **Consumer complexity:** Low. One function call. The rest-angle computation is a one-liner helper. But the config requires two arrays (`restAngles` + `stiffness`) instead of Approach A's simpler `stiffness` + optional `restLengths`.
- **Tree-shake-ability:** Good. `satisfyAngularBendConstraints`, `AngularBendConfig`, `computeRestAngles` are individually importable.
- **Convention fit:** Follows the composable-pass pattern. Pure function, velocity-preservation, no magic numbers. Fits the library's "composable building blocks" philosophy.
- **Reusability:** High. Any curved or straight rod can use angular constraints. Hair with a natural curl? Encode the curl in rest angles. A droopy tail? Rest angles encode the droop.
- **Risk:** None of the 180° pop failure mode. Angular constraints are sign-aware and prevent folding/flipping entirely. The only risk is "over-constraining" if stiffness is too high — the chain becomes rigid. But this is a tuning issue, not a failure mode.

### What this makes easy
- One pass replaces two (bend + rest-pose).
- No 180° pop failure mode.
- Curved rest poses are native (rest angles encode curvature).
- Forward lean + smoothness in a single knob-set.

### What this makes hard
- Two config arrays (`restAngles` + `stiffness`) instead of one stiffness value.
- Slightly higher runtime cost (trig calls).
- If the benchmarker wants the "springy forward lean" feel of the absolute-direction spring, this approach may need augmentation (fallback path exists).
- The rest-angle computation is a new concept consumers must understand.

---

## Approach C: Angular PBD Constraints (Showcase-Local, Subsumes Rest Pose)

> **Physics:** P2 (2D angular PBD constraints).
> **Placement:** L3 (showcase-local, library untouched).
> **Rendering:** R1 (midpoint bézier, folded into showcase draw).

### Source Pattern

Same as Approach B (angular PBD), but placed as a showcase-local function alongside `applyAntennaRestPose` and `applyAntennaTipWeight`. The library remains untouched.

### Why This Exists

The orchestrator asked for at least one L3 (showcase-local) proposal. This approach matches the existing pattern: the showcase already has `applyAntennaRestPose` and `applyAntennaTipWeight` as local corrections on top of the library solver. Adding `applyAntennaBendConstraint` as a third local pass keeps the library solver pristine and allows the showcase to tune the antenna physics independently.

### New Showcase-Local Export

```ts
// In showcase/helpers/slime-knight.ts (showcase-local, not a library export)

/** Angular bend stiffness — base joint (closest to anchor). */
const ANGULAR_BEND_STIFFNESS_BASE = 0.7;

/** Angular bend stiffness — tip joint (furthest from anchor). */
const ANGULAR_BEND_STIFFNESS_TIP = 0.4;

/**
 * Antenna angular bend constraint: restores the relative angle between
 * adjacent segments to a rest angle that encodes the forward lean.
 * Operates in place on the fresh chain from `advanceSpringChain`.
 *
 * REPLACES `applyAntennaRestPose`: the rest angles encode the forward
 * lean, so the angular constraint enforces both smoothness AND orientation.
 * Tapered stiffness (base→tip) ensures the base resists bending more
 * than the tip, modeling a rod that bends most near the load.
 *
 * Moves curr AND prev by the same delta to preserve implicit Verlet
 * velocity (same discipline as the other showcase-local passes).
 *
 * @param nodes - fresh chain from `advanceSpringChain` (mutated + returned)
 * @param segmentLength - rest distance between adjacent nodes
 * @returns the same array (mutated in place) for chaining
 */
function applyAntennaBendConstraint(
  nodes: VerletNode[],
  segmentLength: number,
): VerletNode[] {
  const leanAngle = Math.atan(ANTENNA_FORWARD_LEAN_X);
  const restAngle = Math.PI - leanAngle;
  const last = nodes.length - 1;
  const triplets = nodes.length - 2;

  for (let i = 1; i <= triplets; i++) {
    const p1 = nodes[i - 1];
    const p2 = nodes[i];
    const p3 = nodes[i + 1];

    // Segment vectors from the shared joint (p2).
    const u1x = p1.x - p2.x;
    const u1y = p1.y - p2.y;
    const u2x = p3.x - p2.x;
    const u2y = p3.y - p2.y;

    const len1 = Math.sqrt(u1x * u1x + u1y * u1y);
    const len2 = Math.sqrt(u2x * u2x + u2y * u2y);
    if (len1 === 0 || len2 === 0) continue;

    const alpha1 = Math.atan2(u1y, u1x);
    const alpha2 = Math.atan2(u2y, u2x);

    // Relative angle, wrapped to [-π, π].
    let theta = alpha2 - alpha1;
    while (theta < -Math.PI) theta += 2 * Math.PI;
    while (theta > Math.PI) theta -= 2 * Math.PI;

    // Angular error relative to rest angle.
    let err = theta - restAngle;
    while (err < -Math.PI) err += 2 * Math.PI;
    while (err > Math.PI) err -= 2 * Math.PI;

    // Tapered stiffness: base (i=1) → ANGULAR_BEND_STIFFNESS_BASE,
    // tip (i=triplets) → ANGULAR_BEND_STIFFNESS_TIP, linear between.
    const t = triplets > 1 ? (i - 1) / (triplets - 1) : 0;
    const kBend =
      ANGULAR_BEND_STIFFNESS_BASE +
      (ANGULAR_BEND_STIFFNESS_TIP - ANGULAR_BEND_STIFFNESS_BASE) * t;

    const corr = err * kBend;

    // Rotate outer nodes around the shared joint by ±corr/2.
    const cos1 = Math.cos(-corr * 0.5);
    const sin1 = Math.sin(-corr * 0.5);
    const cos2 = Math.cos(corr * 0.5);
    const sin2 = Math.sin(corr * 0.5);

    const newP1x = p2.x + (u1x * cos1 - u1y * sin1);
    const newP1y = p2.y + (u1x * sin1 + u1y * cos1);
    const newP3x = p2.x + (u2x * cos2 - u2y * sin2);
    const newP3y = p2.y + (u2x * sin2 + u2y * cos2);

    // Apply corrections. Move curr AND prev by the same delta.
    const d1x = newP1x - p1.x;
    const d1y = newP1y - p1.y;
    const d3x = newP3x - p3.x;
    const d3y = newP3y - p3.y;

    p1.x += d1x; p1.y += d1y;
    p1.prevX += d1x; p1.prevY += d1y;
    p3.x += d3x; p3.y += d3y;
    p3.prevX += d3x; p3.prevY += d3y;
  }
  return nodes;
}
```

### Usage Example (Showcase `stepHero`)

```ts
// In stepHero, AFTER advanceSpringChain:

let antenna = advanceSpringChain(
  state.antenna, anchor.x, anchor.y, dt, config.springConfig,
);

// 1. Angular bend constraint (showcase-local) — enforces BOTH smoothness
//    AND forward lean. REPLACES applyAntennaRestPose.
antenna = applyAntennaBendConstraint(antenna, config.antennaSegmentLength);

// 2. Tip weight (showcase-local) — sags the ball.
antenna = applyAntennaTipWeight(antenna);
```

### Relationship to `applyAntennaRestPose`

**REPLACED.** Same as Approach B. The angular constraint's rest angles encode the forward lean. `applyAntennaRestPose` is removed from the call chain (but kept as a commented-out fallback in case the benchmarker wants to augment).

### Trade-offs

- **Ergonomics:** Good for the showcase (all constants are local, easy to tweak). But the physics logic lives in the showcase, not the library — other consumers can't reuse it.
- **Determinism:** Pure. Same as Approach B.
- **Runtime cost:** Same as Approach B (trig calls per joint). No difference.
- **Consumer complexity:** Zero for other consumers (they don't see it). For the showcase, it's one function call.
- **Tree-shake-ability:** N/A — not a library export.
- **Convention fit:** Matches the existing showcase-local pattern (`applyAntennaRestPose`, `applyAntennaTipWeight`). The library stays pristine.
- **Reusability:** None. This is antenna-specific. Other consumers wanting bending resistance would need to copy the code.
- **Risk:** Same as Approach B (no 180° pop). The additional risk is "library stasis" — if this pattern proves valuable, we'd eventually need to extract it into the library anyway, causing a migration.

### What this makes easy
- Fastest path to prototyping (no library change).
- All tuning constants are local to the showcase file.
- Matches the existing pattern perfectly.

### What this makes hard
- No reusability — other consumers can't use it.
- If it works well, we'd eventually extract it to the library (migration cost).
- The library's animation pillar doesn't grow.

---

## Comparison Table

| Criterion | A: Provot Bend Springs (L2) | B: Angular PBD (L2) | C: Angular PBD (L3) |
|---|---|---|---|
| **Ergonomics** | Good (1 stiffness + rest lengths) | Excellent (rest angles encode lean) | Good (local constants) |
| **Determinism** | Pure | Pure | Pure |
| **Runtime cost** | Lowest (arithmetic only) | Moderate (trig per joint) | Moderate (trig per joint) |
| **Convention fit** | Strong (composable pattern) | Strong (composable pattern) | Strong (existing local pattern) |
| **Reusability** | High (any chain) | High (any chain) | None (antenna-specific) |
| **Curved rest pose** | Via pre-computed rest lengths | Native (rest angles) | Native (rest angles) |
| **180° pop risk** | Yes (irrelevant for antenna) | No | No |
| **Pass count** | 3 (bend + rest-pose + tip-weight) | 2 (angular + tip-weight) | 2 (angular + tip-weight) |
| **Library invasiveness** | New exports (additive) | New exports (additive) | None |
| **Migration risk** | Low (already in library) | Low (already in library) | Medium (may need extraction later) |

---

## Recommendation

**Approach B: Angular PBD Constraints + Midpoint Bézier (Library Composable).**

The angular PBD approach is the right physics choice because it handles the curved (forward-leaning) rest pose natively — rest angles encode the lean directly, eliminating the need for pre-computed rest lengths and the separate `applyAntennaRestPose` pass. This collapses three showcase-local passes (distance constraints → rest-pose spring → tip weight) into two composable calls (angular constraints → tip weight), with the angular constraint doing double duty (smoothness + orientation). The 180° pop failure mode of Provot bend springs (Approach A) is irrelevant for the antenna's moderate deflection, but the angular approach's sign-awareness is a strictly better guarantee — and it generalizes to any curved rod (hair with a natural curl, a droopy tail) without rest-length pre-computation.

The library composable placement (L2) is preferred over showcase-local (L3) because: (a) bending resistance is a general need for secondary dynamics (hair, tails, capes, vines); (b) the composable pattern (`satisfyAngularBendConstraints` called after `advanceSpringChain`) matches the library's established architecture; (c) if we later discover the angular constraint alone doesn't produce enough "springy forward lean" feel, the fallback path (adding `applyAntennaRestPose` back as a weak complement) is trivially available at the showcase level.

The midpoint bézier rendering (R1) is an always-do complement folded into every proposal. It eliminates the polyline kink read and composes with any physics choice.

---

## Open Questions for @architect

1. **Subsumption confidence:** The angular constraint's rest angles encode the forward lean, so `applyAntennaRestPose` can be dropped. But the absolute-direction spring provides positional authority that angular constraints don't (angular constraints resist angle changes; the absolute spring actively pulls toward a rest position). Is the angular constraint sufficient on its own, or should we plan for the augmentation path (absolute spring as a weak complement) from day one?

2. **Stiffness calibration:** The angular stiffness values (0.7 base, 0.4 tip) are educated guesses. The benchmarker will need to tune these. Should we ship default constants in the library (`DEFAULT_ANGULAR_BEND`) or keep them showcase-local for now and promote to library defaults after benchmarking?

3. **Rest-angle computation:** `computeRestAngles` is exported from the library as a convenience. But for a uniformly-curved rod, the rest angles are all identical (`π - leanAngle`). Is this helper worth exporting, or is it trivial enough that consumers can compute it inline?

4. **Iteration count:** The angular constraints should run alongside (or interleaved with) the distance constraints for best convergence. Should `satisfyAngularBendConstraints` be called once per step (after the distance solver), or should it be integrated into the `constraintIterations` loop inside `advanceSpringChain`? The composable approach (external call) is cleaner architecturally but may converge more slowly than interleaving. For a 5-node chain at 2 iterations, the difference is likely negligible — but worth noting.

5. **Prototype scope:** Given the "bendy rod" feel is hard to judge from signatures alone, should we prototype both A and B (Approach A for the "does it even work" test, Approach B for the "curved rest pose" test), or is the angular approach obviously superior and worth prototyping alone?

---

## Cross-References

- `docs/research/elastic-rod-antenna.md` — prior-art survey (Müller 2007, Provot 1995, angular PBD, DER, midpoint bézier).
- `src/animation/spring.ts` — current Verlet/PBD distance solver (to be extended additively).
- `showcase/helpers/slime-knight.ts` — current antenna composition (rest-pose spring, tip weight, polyline draw).
- `docs/api-surface.md` — canonical export map (updated in this task).
