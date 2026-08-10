# API Proposal: Inverse Kinematics

> Target pillar: Pillar 1 (Animation sub-module). Module: `src/animation/ik/`.
> Builds on research: `docs/research/inverse-kinematics.md`, `docs/research/skeletal-rigging.md`, `docs/research/procedural-locomotion.md`.
> Status: DRAFT.

## Consumer Need

The consumer game and future consumer titles need characters that dynamically plant feet on uneven terrain, reach for weapons/doors, and swing tails without pre-baked sprite assets. Without IK, every limb pose must be hand-authored as keyframes or computed ad-hoc with trigonometry — brittle, non-adaptive, and non-deterministic across platforms.

With IK shipped:
- **The consumer game** gets no-slide foot placement during walk cycles (feet lock to ground as body moves).
- Any game gets dynamic arm reaching (procedural combat, item pickup).
- Procedural creatures (multi-legged insects, tentacled aliens) can have their limbs react to terrain.

## Module Shape

```
src/animation/ik/
├── limb.ts      # analytical 2-bone solver + pole-vector/bend-direction
├── ccd.ts       # Cyclic Coordinate Descent (tails, tentacles)
├── fabrik.ts    # FABRIK position solver + rotation reconstruction
├── constants.ts # iteration defaults, epsilon guards
├── types.ts     # shared IK types (IkChain, IkResult, etc.)
└── index.ts     # barrel
```

Foot-locking lives at `src/animation/foot-lock.ts` (one level up from `ik/`), because it bridges IK solvers with locomotion state — it is not a solver itself. See [Foot-Locking Adapter](#foot-locking-adapter) below.

---

## Approach A: Three Named Pure Functions

**Source pattern:** Mirrors `src/particles/advance.ts` — one function per operation, pure-in/pure-out, options object for tunables.

**Signature sketch:**

```ts
// src/animation/ik/types.ts
import type { Vec2 } from '../types';

/**
 * A segment of a kinematic chain: optional angle limits.
 *
 * **Cross-reference:** The rig's authoritative bone data is `BoneNode` (defined
 * in `src/animation/types.ts`). `IkBone` is a solver-local parameter type that
 * carries only what the IK solver needs: optional angle limits. Bone lengths
 * are read from `SkeletonTemplate.boneLengths` (indexed by bone index), NOT
 * duplicated on `IkBone`. This avoids data duplication and ensures the solver
 * always uses the canonical lengths from the skeleton definition.
 *
 * For standalone chains NOT backed by a rig, consumers can construct a minimal
 * `SkeletonTemplate` via `createSkeleton()` with custom bone lengths, or pass
 * lengths directly via the positions array (which encodes bone lengths as
 * inter-joint distances).
 */
export interface IkBone {
  /** Minimum local rotation in radians (default: -PI). */
  minAngle?: number;
  /** Maximum local rotation in radians (default: +PI). */
  maxAngle?: number;
}

/**
 * An IK effector: identifies a bone by its attachment slot name and specifies
 * a world-space target position.
 *
 * **Decision 2:** Slot names (strings) are used everywhere, resolved via
 * `template.slotMap` → bone index. Slot names are skin-agnostic and stable
 * across cosmetic variants (Pillar 2 foundation).
 */
export interface IkEffector {
  /**
   * Attachment slot name (e.g. "left_foot", "right_hand").
   * Resolved to a bone index via `template.slotMap[slot]`.
   */
  slot: string;
  /** World-space target position the end effector should reach. */
  target: Vec2;
}

/**
 * Result from any IK solver: new positions + local rotations for the chain.
 */
export interface IkResult {
  /** Solved world-space positions for each joint (same length as input bones + 1). */
  positions: Vec2[];
  /** Local rotation for each bone in radians (same length as input bones). */
  rotations: number[];
  /**
   * Diagnostic flag derived from a sub-pixel position tolerance
   * (`IK_POSITION_TOLERANCE_SQ`). NOT authoritative — float-precision may
   * cause it to differ across JS engines/CPUs. Do not branch game/simulation
   * logic on this value; it is for UI/debug feedback only.
   *
   * Loop termination is fixed-iteration-count only, never this tolerance.
   */
  solved: boolean;
}

/** Options for the analytical limb solver. */
export interface LimbSolveOptions {
  /**
   * Bend direction: -1 or +1.
   * Use `calculateBendDir()` with a pole vector to derive this dynamically.
   * Default: `1`.
   */
  bendDir?: -1 | 1;
}

/** Options for iterative solvers (CCD, FABRIK). */
export interface IterativeSolveOptions {
  /**
   * Fixed iteration count. NEVER a convergence epsilon.
   * Default from `IK_DEFAULT_ITERATIONS` in constants.ts.
   */
  iterations?: number;
  /** Per-bone angle limits. Overrides the limits on individual IkBone entries. */
  angleLimits?: Array<{ min: number; max: number }>;
}

// src/animation/ik/limb.ts
/**
 * Solve a two-bone IK chain analytically.
 *
 * @param root - World-space position of the chain root (hip/shoulder)
 * @param target - World-space position the end effector should reach
 * @param lengthA - Length of first bone (upper arm / thigh)
 * @param lengthB - Length of second bone (forearm / shin)
 * @param opts - Bend direction (-1 or +1); default 1
 */
export function solveLimb(
  root: Vec2,
  target: Vec2,
  lengthA: number,
  lengthB: number,
  opts?: LimbSolveOptions,
): IkResult;

// src/animation/ik/ccd.ts
/**
 * Solve an N-joint chain using Cyclic Coordinate Descent.
 *
 * @param positions - Current world-space joint positions [root, ..., effector]
 * @param boneLengths - Length of each bone segment (length = positions.length - 1)
 * @param target - World-space target for the end effector
 * @param opts - iterations, angleLimits
 */
export function solveCCD(
  positions: readonly Vec2[],
  boneLengths: readonly number[],
  target: Vec2,
  opts?: IterativeSolveOptions,
): IkResult;

// src/animation/ik/fabrik.ts
/**
 * Solve an N-joint chain using FABRIK (Forward And Backward Reaching IK).
 *
 * @param positions - Current world-space joint positions [root, ..., effector]
 * @param boneLengths - Length of each bone segment (length = positions.length - 1)
 * @param target - World-space target for the end effector
 * @param opts - iterations, angleLimits
 */
export function solveFABRIK(
  positions: readonly Vec2[],
  boneLengths: readonly number[],
  target: Vec2,
  opts?: IterativeSolveOptions,
): IkResult;

// src/animation/ik/types.ts — bend-direction helper
export function calculateBendDir(root: Vec2, target: Vec2, pole: Vec2): -1 | 1;
```

**Usage example:**

```ts
import { solveLimb, calculateBendDir } from 'aicraft-engine/src/animation/ik';

// Character's left leg: resolve bone indices from slot names
const leftThighIdx = template.slotMap['left_thigh'];
const leftShinIdx = template.slotMap['left_shin'];
const hip = rig.worldPositions[leftThighIdx];
const footTarget = { x: 110, y: 280 };
const kneeHint = { x: 90, y: 250 }; // pole vector — knee should bend this way

const bendDir = calculateBendDir(hip, footTarget, kneeHint);

// Bone lengths come from the template, not from IkBone
const lengthA = template.boneLengths[leftThighIdx];
const lengthB = template.boneLengths[leftShinIdx];

const result = solveLimb(hip, footTarget, lengthA, lengthB, { bendDir });

// result.positions = [hip, knee, foot]
// result.rotations = [upperLegAngle, lowerLegAngle]  (local, relative to parent)
// result.solved = true (diagnostic — do not branch on this)

// Apply to rig: set bone local rotations via slot names
rig.localPoses[leftThighIdx].rotation = result.rotations[0];
rig.localPoses[leftShinIdx].rotation = result.rotations[1];
```

**Trade-offs:**
- **Ergonomics:** ★★★★★ — Each solver has a purpose-built signature. The common case (2-bone limb) is a single function call with obvious parameters. No dispatch overhead or mental model.
- **Determinism:** ★★★★★ — Pure functions, no internal state. Fixed iteration counts baked into constants.ts. No convergence epsilon branching.
- **Runtime cost:** ★★★★★ — Zero overhead. Each function does exactly what it needs. Tree-shaking removes unused solvers entirely.
- **Consumer complexity:** ★★★★☆ — Consumer must choose the right solver for their chain. But this is a feature: choosing between CCD and FABRIK is a meaningful design decision, not boilerplate.
- **Tree-shake-ability:** ★★★★★ — Each solver is independently importable. A game using only 2-bone limbs never pays for FABRIK code.
- **Convention fit:** ★★★★★ — Mirrors the `advance()` / `spawn()` / `cull()` pattern from `src/particles/`. One verb per function. Options object for tunables.

**What this makes easy:** Importing exactly the solver you need. Reading the call site and knowing immediately which algorithm is running. Testing each solver in isolation.

**What this makes hard:** If a consumer wants to swap solvers at runtime (e.g., use FABRIK for long chains, limb for short ones), they must write the dispatch logic themselves.

---

## Approach B: Generic Dispatcher Function

**Source pattern:** Inspired by Unity's `IKConstraint` which abstracts over solver type via a config discriminant.

**Signature sketch:**

```ts
// src/animation/ik/types.ts
export type IkSolverType = 'limb' | 'ccd' | 'fabrik';

export interface SolveOptions {
  solver: IkSolverType;
  iterations?: number;
  bendDir?: -1 | 1;
  angleLimits?: Array<{ min: number; max: number }>;
}

// src/animation/ik/solve.ts
export function solve(
  positions: readonly Vec2[],
  bones: readonly IkBone[],
  target: Vec2,
  opts: SolveOptions,
): IkResult;
```

**Usage example:**

```ts
import { solve } from 'aicraft-engine/src/animation/ik';

const result = solve(
  [hip, knee, foot],     // current joint positions
  [template.boneLengths[thighIdx], template.boneLengths[shinIdx]],
  footTarget,
  { solver: 'limb', bendDir: 1 },
);
```

**Trade-offs:**
- **Ergonomics:** ★★★☆☆ — Consumer must always pass `positions` array even for 2-bone limb (which only needs root + target). The `solver` discriminant is extra typing.
- **Determinism:** ★★★★★ — Same purity guarantees.
- **Runtime cost:** ★★★★☆ — Minor dispatch overhead (switch on solver type). All solvers still bundled even if only one is used (hurts tree-shaking).
- **Consumer complexity:** ★★★☆☆ — Single entry point is conceptually simpler but the unified options bag is harder to document and type-check. `bendDir` is meaningless for FABRIK; `iterations` is meaningless for limb.
- **Tree-shake-ability:** ★★☆☆☆ — All three solvers are imported whenever `solve` is used. Dead-code elimination may or may not remove unused branches.
- **Convention fit:** ★★★☆☆ — Does not match the library's pattern of one-function-per-operation (`advance`, `spawn`, `cull`). This is a "god function" anti-pattern.

**What this makes easy:** Runtime solver swapping. Single import path.

**What this makes hard:** Tree-shaking. Type safety (options that apply to some solvers but not others). Reading the call site to know which algorithm runs.

---

## Approach C: Stateful Solver Objects

**Source pattern:** Inspired by Spine 2D's `IKConstraint` class and Pixi.js's display-object model. Deviates from the library's pure-function convention.

**Signature sketch:**

```ts
// src/animation/ik/limb.ts
export interface LimbSolver {
  solve(root: Vec2, target: Vec2): IkResult;
}

export function createLimbSolver(
  boneA: IkBone,
  boneB: IkBone,
  opts?: LimbSolveOptions,
): LimbSolver;
```

**Usage example:**

```ts
import { createLimbSolver } from 'aicraft-engine/src/animation/ik';

const solver = createLimbSolver(
  template.boneLengths[thighIdx],
  template.boneLengths[shinIdx],
  { bendDir: 1 },
);

// Every frame:
const result = solver.solve(hip, footTarget);
```

**Trade-offs:**
- **Ergonomics:** ★★★★☆ — Nice for repeated solves with the same bone lengths. But over-engineered for a library where bone lengths rarely change mid-frame.
- **Determinism:** ★★★★☆ — Mutable internal state is a footgun. The solver object could accumulate drift if the consumer holds it across ticks with varying inputs.
- **Runtime cost:** ★★★★☆ — Slightly less GC pressure (no options allocation per call), but the solver object itself is an allocation.
- **Consumer complexity:** ★★★☆☆ — Two-step lifecycle (create + solve) instead of one-step. Consumer must manage solver lifetime.
- **Tree-shake-ability:** ★★★★☆ — Fine, each factory is independently importable.
- **Convention fit:** ★★☆☆☆ — Violates the library's pure-function convention. The entire codebase is stateless functions; introducing mutable objects breaks the mental model.

**What this makes easy:** Repeated solves with same config. Extending solver state later.

**What this makes hard:** Pure testing. Mental model consistency. Determinism (mutable state).

---

## Comparison Table

| Criterion | A: Named Functions | B: Generic Dispatcher | C: Stateful Objects |
|---|---|---|---|
| Ergonomics | ★★★★★ | ★★★☆☆ | ★★★★☆ |
| Determinism | ★★★★★ | ★★★★★ | ★★★★☆ |
| Runtime cost | ★★★★★ | ★★★★☆ | ★★★★☆ |
| Convention fit | ★★★★★ | ★★★☆☆ | ★★☆☆☆ |
| Tree-shake-ability | ★★★★★ | ★★☆☆☆ | ★★★★☆ |
| Risk | Low | Medium (dead-code risk) | High (mutation footgun) |

## Recommendation

**Approach A: Three Named Pure Functions.**

This is the only approach that matches the library's existing conventions (`advance`, `spawn`, `cull` — one verb per function, pure-in/pure-out, options object for tunables). It has the best ergonomics for the common case (2-bone limb), perfect tree-shaking, and zero risk of mutation footguns. The "consumer must choose the right solver" concern is actually a feature: it forces the game developer to think about which algorithm fits their chain, rather than silently picking a suboptimal one.

---

## Solver Design: Analytical Limb (`src/animation/ik/limb.ts`)

**Source pattern:** Law of Cosines circle-circle intersection from research §Pattern 1.

### Signature

```ts
/**
 * Solve a two-bone IK chain analytically (closed-form, O(1)).
 *
 * Given a root position, a target, and two bone lengths, returns the
 * joint position (elbow/knee) and the effector position (hand/foot),
 * plus local rotations for each bone.
 *
 * Bone lengths are passed as scalar numbers, not `IkBone` objects.
 * When working with a rig, read lengths from `template.boneLengths`.
 * The `IkBone` type carries only angle limits (if needed); it does NOT
 * duplicate bone lengths.
 *
 * Handles three cases defensively:
 *   1. Target unreachable (fully extended) — stretches toward target
 *   2. Target too close (under-extended) — collapses along bend direction
 *   3. Standard intersection — Law of Cosines
 *
 * Never throws. Returns `{ solved: false }` when the target is outside
 * the reachable ring.
 *
 * @param root - World-space position of the chain root (hip/shoulder)
 * @param target - World-space position the end effector should reach
 * @param lengthA - Length of first bone (upper arm / thigh)
 * @param lengthB - Length of second bone (forearm / shin)
 * @param opts - Bend direction (-1 or +1); default 1
 */
export function solveLimb(
  root: Vec2,
  target: Vec2,
  lengthA: number,
  lengthB: number,
  opts?: LimbSolveOptions,
): IkResult;
```

### Singularity Handling

| Case | Condition | Behavior |
|---|---|---|
| **Target unreachable** | `dist >= l1 + l2` | Both bones extend straight toward target. `solved: false`. |
| **Target on root** | `dist === 0` | Default to bend direction. Joint placed at `(root.x, root.y + l1)` along the perpendicular. `solved: false`. |
| **Under-extended** | `dist <= |l1 - l2|` | Bones collapse along the perpendicular to the root-target line, scaled by bend direction. Effector placed at target. `solved: true`. |
| **Straight-line** | `h ≈ 0` (near max reach) | Dead-zone clamping: when `h < DEAD_ZONE_THRESHOLD` (from constants.ts), interpolate the joint position slightly off the root-target line to prevent jitter/pop. |

### Bend-Direction (Pole Vector)

The consumer computes `bendDir` externally via `calculateBendDir()`:

```ts
/**
 * Determine bend direction from a pole vector (bend hint).
 *
 * Uses the 2D cross product of (root→target) × (root→pole) to determine
 * which side of the root-target line the elbow/knee should bend toward.
 *
 * @param root - Chain root position
 * @param target - End effector target
 * @param pole - Pole vector (world-space position the elbow/knee should lean toward)
 * @returns +1 or -1 for use with solveLimb's bendDir option
 */
export function calculateBendDir(root: Vec2, target: Vec2, pole: Vec2): -1 | 1;
```

This is a pure function in `src/animation/ik/types.ts`. The consumer can also pass a hardcoded `-1` or `1` if they don't need dynamic pole vectors.

---

## Solver Design: CCD (`src/animation/ik/ccd.ts`)

**Source pattern:** Cyclic Coordinate Descent from research §Pattern 2.

### Signature

```ts
/**
 * Solve an N-joint chain using Cyclic Coordinate Descent.
 *
 * Traverses from effector parent to root, rotating each joint to
 * align its child chain toward the target. Best for organic chains:
 * tails, tentacles, multi-segmented limbs.
 *
 * Determinism: uses FIXED iteration count (never convergence epsilon).
 * The `iterations` option controls the fixed count; default from
 * `IK_CCD_DEFAULT_ITERATIONS` in constants.ts.
 *
 * Pure: returns a new IkResult. Input positions are not mutated.
 * Internally mutates a local clone for iteration efficiency (GC-safe).
 *
 * Bone lengths are passed as a separate array (not `IkBone` objects).
 * When working with a rig, read from `template.boneLengths`.
 *
 * @param positions - Current world-space joint positions [root, ..., effector]
 * @param boneLengths - Length of each bone segment (length = positions.length - 1)
 * @param target - World-space target for the end effector
 * @param opts - iterations, angleLimits
 */
export function solveCCD(
  positions: readonly Vec2[],
  boneLengths: readonly number[],
  target: Vec2,
  opts?: IterativeSolveOptions,
): IkResult;
```

### Internal Pattern: Pure-Public + Local-Mutable-Clone

```ts
export function solveCCD(
  positions: readonly Vec2[],
  boneLengths: readonly number[],
  target: Vec2,
  opts: IterativeSolveOptions = {},
): IkResult {
  const n = positions.length;
  if (n < 2) {
    return { positions: [...positions], rotations: [], solved: false };
  }

  const iterations = opts.iterations ?? IK_CCD_DEFAULT_ITERATIONS;

  // --- Pure-public contract: clone input once ---
  const result: Vec2[] = positions.map((p) => ({ x: p.x, y: p.y }));
  const rootAnchor: Vec2 = { x: result[0].x, y: result[0].y };

  // --- Internal mutable iteration (single clone, mutated in place) ---
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = n - 2; i >= 0; i--) {
      // ... rotate descendants around joint i toward target ...
    }
  }

  // --- Reconstruct rotations from solved positions ---
  const rotations = reconstructRotations(result, boneLengths);

  return {
    positions: result,
    rotations,
    solved: distSq(result[n - 1], target) < IK_POSITION_TOLERANCE_SQ,
  };
}
```

### Rotation Reconstruction Post-Pass

After CCD (or FABRIK) solves joint positions, we compute local rotations:

```ts
/**
 * Reconstruct local rotations from solved world-space positions.
 *
 * For each bone i, computes the angle of the vector (positions[i+1] - positions[i])
 * relative to the parent bone's angle. The root bone's rotation is absolute
 * (relative to world +X axis, per the pillar rotation convention).
 *
 * **Pillar rotation convention (Decision 1):** Angles are measured from the +X
 * axis, with positive rotation going from +X toward +Y. This matches
 * `ctx.rotate(angle)` exactly. Therefore: `atan2(dy, dx)` — the angle of the
 * bone vector in the parent frame.
 *
 * Handles collinear bones defensively: when a bone vector has zero length,
 * inherits the parent's rotation.
 */
function reconstructRotations(positions: Vec2[], boneLengths: readonly number[]): number[] {
  const rotations: number[] = [];
  let parentAngle = 0; // root faces +X (rightward in screen coords)

  for (let i = 0; i < boneLengths.length; i++) {
    const dx = positions[i + 1].x - positions[i].x;
    const dy = positions[i + 1].y - positions[i].y;
    const lenSq = dx * dx + dy * dy;

    if (lenSq < 1e-12) {
      // Collinear/degenerate: inherit parent angle
      rotations.push(0);
    } else {
      const absAngle = Math.atan2(dy, dx); // angle from +X axis (pillar convention)
      const localAngle = absAngle - parentAngle;
      rotations.push(localAngle);
      parentAngle = absAngle;
    }
  }

  return rotations;
}
```

---

## Solver Design: FABRIK (`src/animation/ik/fabrik.ts`)

**Source pattern:** Forward And Backward Reaching IK from research §Pattern 3.

### Signature

```ts
/**
 * Solve an N-joint chain using FABRIK (Forward And Backward Reaching IK).
 *
 * Position-based solver: performs backward (effector→root) and forward
 * (root→effector) sweeps per iteration. Joint rotations are reconstructed
 * in a post-pass via atan2 (per the pillar rotation convention).
 *
 * Best for multi-joint chains where positional accuracy matters more
 * than angular control: arachnid legs, complex arms, spines.
 *
 * Determinism: uses FIXED iteration count (never convergence epsilon).
 * Default from `IK_FABRIK_DEFAULT_ITERATIONS` in constants.ts.
 *
 * Pure: returns a new IkResult. Input positions are not mutated.
 * Internally mutates a local clone for iteration efficiency (GC-safe).
 *
 * Bone lengths are passed as a separate array (not `IkBone` objects).
 * When working with a rig, read from `template.boneLengths`.
 *
 * @param positions - Current world-space joint positions [root, ..., effector]
 * @param boneLengths - Length of each bone segment (length = positions.length - 1)
 * @param target - World-space target for the end effector
 * @param opts - iterations, angleLimits
 */
export function solveFABRIK(
  positions: readonly Vec2[],
  boneLengths: readonly number[],
  target: Vec2,
  opts?: IterativeSolveOptions,
): IkResult;
```

### FABRIK Returns: Positions + Rotations

FABRIK is a position-based solver. It naturally outputs joint positions, not rotations. However, the consumer needs rotations to drive the bone hierarchy. The design:

1. **FABRIK solves positions** via the forward/backward sweep loop (no trig, pure vector math).
2. **Post-pass reconstructs rotations** using the same `reconstructRotations()` function shared with CCD.
3. **The `IkResult` contains both** — positions for rendering/debugging, rotations for bone hierarchy.

This is the right split because:
- The position solver is fast and simple (no trig during iteration).
- The rotation reconstruction is a separate, testable concern.
- CCD can also use the same rotation reconstruction (shared code, less surface area).

### Angle Constraints in FABRIK

FABRIK operates in position space, so angle constraints require an extra projection step during the sweeps. The implementation:

```ts
// During each forward sweep, after positioning joint i+1:
if (opts.angleLimits && i < opts.angleLimits.length) {
  const { min, max } = opts.angleLimits[i];
  // Compute current angle of bone i relative to bone i-1
  // Clamp to [min, max]
  // Project joint i+1 back onto the clamped angle at bone length
}
```

This adds ~30% to FABRIK's runtime but is opt-in. When no angle limits are provided, the sweep runs at full speed.

---

## Constants (`src/animation/ik/constants.ts`)

All tunable defaults live here. No magic numbers in solver code.

```ts
/**
 * Default iteration count for CCD solver.
 * 8 iterations provides good convergence for chains of 3-8 joints
 * without excessive CPU cost. Higher values improve accuracy for
 * long chains but are rarely needed.
 */
export const IK_CCD_DEFAULT_ITERATIONS = 8;

/**
 * Default iteration count for FABRIK solver.
 * 4 iterations is sufficient for most chains (FABRIK converges
 * faster than CCD). The research recommends 3-5.
 */
export const IK_FABRIK_DEFAULT_ITERATIONS = 4;

/**
 * Position tolerance squared for determining if an effector has
 * reached its target. Used for the `solved` flag only — NOT for
 * loop termination (which uses fixed iteration counts).
 *
 * 0.01² = 0.0001 — sub-pixel accuracy.
 */
export const IK_POSITION_TOLERANCE_SQ = 0.0001;

/**
 * Dead-zone threshold for the 2-bone limb solver.
 * When the perpendicular height h is below this value,
 * the joint is placed slightly off the root-target line
 * to prevent jitter/pop at full extension.
 */
export const IK_LIMB_DEAD_ZONE = 0.001;
```

---

## Foot-Locking Adapter (`src/animation/foot-lock.ts`)

**Source pattern:** Effector locking from research §Pattern 4. Lives at the `animation/` root, not `ik/`, because it bridges IK solvers with locomotion state.

### Signature

```ts
/**
 * Foot-lock state: tracks whether a foot is pinned to the ground
 * and the blend weight for smooth transitions.
 */
export interface FootLockState {
  /** True when the foot is grounded and locked. */
  isLocked: boolean;
  /** World-space position the foot is locked to. */
  lockPos: Vec2;
  /** Blend weight: 0 = fully animated, 1 = fully locked. */
  blendWeight: number;
}

/**
 * Advance foot-lock state by one tick. Pure: returns a new state.
 *
 * When grounded, locks the foot and ramps blendWeight toward 1.
 * When airborne, unlocks and ramps blendWeight toward 0.
 * The blend prevents 1-frame pops when transitioning.
 *
 * @param state - Current foot-lock state
 * @param isGrounded - Whether the foot is touching the ground this tick
 * @param animatedFootPosWorld - The foot position from the animation cycle (world space)
 * @param dt - Timestep (fixed for determinism)
 * @param blendSpeed - Blend weight change per second (default: `FOOT_LOCK_DEFAULT_BLEND_SPEED` = 10, from `src/animation/constants.ts`)
 */
export function advanceFootLock(
  state: FootLockState,
  isGrounded: boolean,
  animatedFootPosWorld: Vec2,
  dt: number,
  blendSpeed?: number,
): FootLockState;

/**
 * Compute the effective IK target by blending between the animated
 * foot position and the locked position.
 *
 * Pure function: returns a new Vec2.
 *
 * @param state - Current foot-lock state
 * @param animatedFootPosWorld - Foot position from animation cycle
 * @returns Blended world-space target for the IK solver
 */
export function getFootLockTarget(
  state: FootLockState,
  animatedFootPosWorld: Vec2,
): Vec2;
```

### Usage example:

```ts
import { advanceFootLock, getFootLockTarget } from 'aicraft-engine/src/animation';
import { solveLimb, calculateBendDir } from 'aicraft-engine/src/animation/ik';

// Each tick:
const footAnimPos = evaluateLocomotion(locomotionState, gaitConfig).leftFootOffset;
const worldFootPos = { x: characterRoot.x + footAnimPos.x, y: characterRoot.y + footAnimPos.y };

footLockState = advanceFootLock(footLockState, isGrounded, worldFootPos, dt);
const ikTarget = getFootLockTarget(footLockState, worldFootPos);

const legResult = solveLimb(hip, ikTarget, { length: 40 }, { length: 45 }, { bendDir });
// Apply legResult.rotations to the rig...
```

---

## Shared Type Dependencies (Proposed Addition to Foundation)

The IK module needs these types from the skeletal-rigging foundation (to be defined in `src/animation/types.ts`):

```ts
/** Already proposed by skeletal-rigging:
 *  Vec2, Transform (affine 2x3), BonePose, Rig, RigInstance.
 *
 *  IK adds:
 *  - IkBone (bone length + angle limits) — in src/animation/ik/types.ts
 *  - IkEffector (bone id + target) — in src/animation/ik/types.ts
 *  - IkResult (positions + rotations + solved flag) — in src/animation/ik/types.ts
 *  - FootLockState — in src/animation/foot-lock.ts
 */
```

No new shared types are needed beyond what the foundation already proposes. The IK module defines its own types in `src/animation/ik/types.ts` and imports `Vec2` from `../types` (canonical home `src/animation/types.ts`, migrated from `src/primitives/animation.ts`).

---

## Determinism Summary

| Rule | How Enforced |
|---|---|
| **Fixed iteration counts** | `IK_CCD_DEFAULT_ITERATIONS` and `IK_FABRIK_DEFAULT_ITERATIONS` in constants.ts. `iterations` option replaces the count but always runs exactly N iterations. No `while (error > epsilon)` branch. |
| **Pure functions** | All solvers take state in, return new state out. Input arrays/objects are never mutated. |
| **Internal mutable clone** | Each solver clones input positions once at function entry, mutates the clone during iteration, returns the clone as part of `IkResult`. This limits GC to one allocation per solve call. |
| **No Math.random** | All solvers are pure math. Bend direction is computed from pole vectors or hardcoded. |
| **No Date.now** | Time is passed as `dt` parameter to foot-lock adapter. |
| **No global state** | All state is local to the function call. |
| **Singularity defense** | Dead-zone clamping in limb solver. Collinear-bone fallback in rotation reconstruction. Never throws. |

---

## Open Questions for @architect

1. ~~**Rotation convention:**~~ **RESOLVED (orchestrator Decision 1).** Pillar-wide convention: radians, measured from the +X axis, positive rotation +X→+Y (appears clockwise on-screen because Canvas2D's Y points down, and matches `ctx.rotate()` exactly). `reconstructRotations` uses `atan2(dy, dx)`. Documented in `src/animation/types.ts` JSDoc; applied to `BonePose.rotation` and all solver rotation outputs.

2. **Angle limits in CCD:** Should angle limits be enforced during iteration (clamp each joint's rotation as it's computed) or as a post-pass (solve all positions, then clamp and re-project)? During-iteration is more natural but can cause CCD to fail to converge on tight chains. Post-pass is simpler but can violate the target position.

3. **FABRIK + angle limits complexity:** The research notes that applying joint angle limits to FABRIK is "mathematically heavy" (projecting positions back onto angular cones). Should we defer angle limits for FABRIK to a later version, shipping the position-only solver first? The 2-bone limb solver already covers the constrained case for simple limbs.

4. **Foot-lock `dt` parameter:** The foot-lock adapter uses `dt` for blend-weight interpolation. Should we mandate that consumers pass a fixed `dt` (e.g., 1/60) for determinism, or document that variable `dt` is acceptable (since foot-lock is renderer-adjacent and its output doesn't feed back into the simulation)? The research recommends fixed `dt` for determinism.

5. ~~**`IkResult.solved` flag semantics:**~~ **RESOLVED (architect fix #8).** Tolerance-based flag retained, but documented as **diagnostic-only** via JSDoc: float-precision may cause it to differ across JS engines/CPUs, so consumers must NOT branch game/simulation logic on it. Loop termination remains fixed-iteration-count only; the `IK_POSITION_TOLERANCE_SQ` constant feeds the flag, never the loop.
