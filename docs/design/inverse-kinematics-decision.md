# Decision: Inverse Kinematics (`src/animation/ik/` + `src/animation/foot-lock.ts`)

**Status:** APPROVED — proceeds to TDD implementation.
**Inputs:** `docs/research/inverse-kinematics.md` · `docs/design/inverse-kinematics-proposal.md` · architect critique (NEEDS REVISION → APPROVED, loop 2/2) · benchmarks `benchmarks/animation/ik-limb-reach.png` + `ik-fabrik-chain.png` · prototype `src/_prototype/anim-ik.ts`.

## Decision

Ship **three named pure functions** — `solveLimb`, `solveCCD`, `solveFABRIK` — mirroring the `particles/` advance/cull/step pattern. This is the only shape that tree-shakes, matches library conventions, and avoids a god-dispatcher or stateful solver objects. Ship order: **analytical 2-bone limb first** (covers ~90% of arm/leg needs, O(1)), then **FABRIK** (multi-joint chains, spines, tentacles), then **CCD** (organic dragging chains). Foot-locking lives at `src/animation/foot-lock.ts` (one level up — it bridges IK with locomotion, it is not itself a solver).

**Determinism is hard-locked:** fixed iteration counts only (`IK_CCD_DEFAULT_ITERATIONS = 8`, `IK_FABRIK_DEFAULT_ITERATIONS = 4`), NEVER convergence-epsilon loop termination. Float-error branching across JS engines/CPUs is a desync hazard. Solvers are pure-public with a single internal mutable local clone during iteration (limits GC to one allocation per solve). FABRIK returns positions AND rotations via a shared `reconstructRotations` post-pass using `atan2(dy, dx)` (the pillar's +X-axis convention).

**Verified visually:** the 2-bone joint bends to the same side as the pole vector and flips correctly when the pole flips; unreachable targets clamp to a clean straight line with zero jitter (dead-zone at full extension). FABRIK converges exactly onto the target in ≤4 iterations with natural curvature, preserved bone lengths, and zero overshoot.

## Ratified from prototype (small API adjustments)
1. **`reconstructRotations` drops its `boneLengths` parameter** → signature is `(positions: readonly Vec2[]) → number[]`. The prototype proved `boneLengths` is unused (the loop bound is `positions.length - 1`). Less surface, less to validate.
2. **`solveLimb` under-extension `solved` semantics** — `solved` is diagnostic-only (per architect fix #8: never branch game logic on it). For the under-extended case the effector folds gracefully toward the target; the TDD spec will pin the exact `solved` values. Low-stakes because the flag is non-authoritative.
3. **`IK_COLLINEAR_THRESHOLD_SQ = 1e-12`** is a named constant in `src/animation/ik/constants.ts` (the architect flagged the inline `1e-12` magic number in the proposal sketch).
4. **`IkBone` carries only angle limits** (`minAngle?`/`maxAngle?`); bone lengths are read from `SkeletonTemplate.boneLengths`, not duplicated.

## Open implementation-time questions (deferred to TDD, non-blocking)
- CCD angle-limit enforcement: during-iteration vs. post-pass (start with during-iteration).
- FABRIK angle limits: ship position-only first (the 2-bone limb already covers the constrained case).
- Foot-lock `dt`: fixed `dt` recommended for determinism; document it.

## What was rejected
- Generic `solve(chain, target, {solver})` dispatcher (kills tree-shaking, god-function).
- Stateful solver objects (mutation footguns, conflicts with pure-function convention).
- Convergence-epsilon loop termination (determinism hazard).
