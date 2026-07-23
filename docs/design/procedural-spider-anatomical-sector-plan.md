# Procedural Spider Anatomical Sector Plan

**Status:** Implemented (2026-07-23)  
**Scope:** Correct forward/rearward leg articulation without reintroducing bone shrinking  
**Related decision:** `docs/design/procedural-spider-locomotion-decision.md`  
**Related proposal:** `docs/design/procedural-spider-locomotion-proposal.md`

## Implementation notes (accepted defaults + results)

- **Config:** added `minDistalAdvanceRatio` (default `0.1`) to `SpiderLegGeometryConfig`.
- **Geometry:** `femurLength 19 → 22`, `tibiaLength 21 → 44` (≈1:2 for the real-spider
  up-and-out arch), `minExtensionRatio 0.45 → 0.35`.
- **Rest topology:** derived from sector-valid foot X offsets (±55 front, ±32 inner) at
  the 28px body clearance → `[{27, 61.7}, {41.2, 42.5}, {138.8, 42.5}, {153, 61.7}]`, so
  every default grounded foot is anatomically valid without renderer correction.
- **Odd leg counts:** `computeRestPositions` nudges interpolated legs out of a ±12° band
  around vertical so no leg has a zero fore/aft offset (which otherwise over-reaches).
- **Sector solver:** `solveThreeSegmentLeg` projects targets into the sector and selects
  the knee branch lexicographically (sector → upward → pole); `projectGroundedTarget-
  IntoWorkspace` uses a fixed-count (12) bisection to find the nearest valid outward X;
  `computeLegStepRequest` exposes `sectorError` and flags folded feet for replant.
- **Result:** 0 folded planted legs across 211,701 sampled ticks (leg counts 1–4,
  coordinated/frantic, speeds 15/50/90, flat/uneven ground, repeated turns); facing-left
  is an exact mirror of facing-right; full test suite, typechecks, and builds pass.

## Objective

Prevent spider legs from bending back over themselves while preserving fixed
coxa, femur, and tibia lengths, grounded feet, deterministic gait progression,
and mirrored behavior in both facing directions.

The intended anatomical fan is:

- Front legs extend forward.
- Rear legs extend backward.
- Each segment continues generally outward along its leg's anatomical axis.
- Knees remain above the coxa-to-foot chord.
- Feet remain planted on the sampled ground during stance.
- Facing left is an exact horizontal mirror of facing right.

This plan does not make every leg sweep toward the direction of travel. It
preserves the natural front-forward/rear-backward spider fan selected during
review.

## Observed Defect

The current solver enforces a radial femur/tibia workspace and an upward pole,
but it does not constrain fore/aft articulation inside that workspace. A target
can therefore be physically reachable while producing an anatomically invalid
folded-Z silhouette.

The default grounded pose reproduces the issue in the second right-facing
front leg:

```text
hip -> coxa:    +7.7px forward
coxa -> knee:  +18.9px forward
knee -> foot:  -13.0px backward
```

The femur reaches strongly forward, but the tibia reverses to reach a foot
target that is too close to the body. The current target passes the radial
workspace test because its coxa-to-foot distance lies inside the annulus.

The same geometry is mathematically mirrored when facing left. Layering and
overlap make the folded shape less obvious in that direction, so visual
appearance alone can incorrectly suggest that only right-facing spiders are
affected.

## Root Cause

`projectGroundedTargetIntoWorkspace` currently returns an unchanged target as
soon as its distance from the coxa lies inside the soft annulus. That check does
not consider:

- Whether the target is on the leg's anatomical outward side.
- Whether the selected knee lies between the coxa and foot.
- Whether the tibia advances outward or reverses toward the body.
- Whether both analytical branches violate the desired leg sector.

The current upward pole controls which side of the coxa-to-foot chord receives
the knee. It cannot guarantee a monotonic fore/aft chain when the foot target is
too close horizontally.

Retuning the pole alone cannot solve this defect. The gait must generate foot
targets in an anatomical sector that has a valid fixed-length solution.

## Required Invariants

### Fixed Segment Lengths

For every evaluated pose, within floating-point tolerance:

```text
distance(hip, coxa) = coxaLength
distance(coxa, knee) = femurLength
distance(knee, foot) = tibiaLength
```

No renderer-side bone scaling, shortening, stretching, or target-dependent
segment length is permitted.

### Anatomical Outward Axis

Each leg receives a facing-relative outward sign:

```ts
outwardSign = sign(restLocalX * facing)
```

Degenerate `restLocalX === 0` values use a deterministic fallback based on the
leg's anatomical ordinal rather than velocity or mutable render state.

For an ordinary four-leg-per-side configuration:

- Positive outward sign means an anterior leg extends toward increasing world X.
- Negative outward sign means a posterior leg extends toward decreasing world X.
- Flipping `facing` mirrors the sign and all resulting joint coordinates.

### Monotonic Fore/Aft Chain

Convert each segment's horizontal displacement into anatomical outward space:

```ts
coxaAdvance = (coxa.x - hip.x) * outwardSign
femurAdvance = (knee.x - coxa.x) * outwardSign
distalAdvance = (foot.x - knee.x) * outwardSign
```

The hard no-fold constraints are:

```text
coxaAdvance > 0
femurAdvance >= 0
distalAdvance >= 0
```

The default configuration should use a small positive distal margin so the
tibia reads as extending outward rather than becoming visually vertical at the
boundary:

```text
distalAdvance >= tibiaLength * minDistalAdvanceRatio
```

The proposed default for visual tuning is `minDistalAdvanceRatio: 0.1`. The
exact default must be validated by the live right/left comparison benchmark
before it is accepted.

### Upward Knee

The selected knee must remain above the coxa-to-foot chord and should normally
remain above the coxa in canvas coordinates:

```text
knee.y <= max(coxa.y, foot.y)
```

The existing upward/outward pole remains useful as a preference after invalid
branches have been rejected. It is not the primary no-fold constraint.

### Ground Contact

Grounded target correction must preserve the sampled ground Y whenever a valid
fixed-length solution exists at that height.

The solver may move the target horizontally outward. It must not move a valid
ground contact vertically merely to satisfy the sector constraint.

### Mirror Symmetry

Given mirrored body, target, and facing inputs, the complete pose must mirror
exactly within tolerance:

```text
right.hipX - centerX = -(left.hipX - centerX)
right.coxaX - centerX = -(left.coxaX - centerX)
right.kneeX - centerX = -(left.kneeX - centerX)
right.footX - centerX = -(left.footX - centerX)
right.*Y = left.*Y
```

## Configuration Changes

Extend `SpiderLegGeometryConfig` with one scale-independent articulation field:

```ts
export interface SpiderLegGeometryConfig {
  readonly hipRadius: number;
  readonly coxaLength: number;
  readonly femurLength: number;
  readonly tibiaLength: number;
  readonly minExtensionRatio: number;
  readonly maxExtensionRatio: number;
  readonly jointSafetyMargin: number;
  readonly minDistalAdvanceRatio: number;
}
```

`minDistalAdvanceRatio` is dimensionless and must remain unchanged when a
showcase spider is scaled. It belongs in shared geometry because both gait
target generation and renderer fallback must enforce the same value.

No two-segment compatibility mode or deprecated field alias will be added.

The existing hard-coded `COXA_VERTICAL_BIAS` is outside the immediate no-fold
fix. It should only be promoted into public configuration if visual tuning
shows that coxa inclination must vary by creature. Avoid expanding the public
surface preemptively.

## Geometry API Changes

### Shared Anatomical Helpers

Add or keep internal pure helpers for:

```ts
getLegOutwardSign(restLocalX, facing, fallbackOrdinal)
solveFemurTibiaBranches(coxa, target, femurLength, tibiaLength)
evaluateLegBranch(branch, coxa, target, outwardSign, geometry)
```

`solveFemurTibiaBranches` returns both analytical circle-intersection knees.
It does not choose a branch.

`evaluateLegBranch` returns diagnostics used by both tests and selection:

```ts
interface LegBranchEvaluation {
  readonly knee: Vec2;
  readonly femurAdvance: number;
  readonly distalAdvance: number;
  readonly kneeIsUpward: boolean;
  readonly satisfiesSector: boolean;
  readonly poleDistance: number;
}
```

These helpers should remain private unless a demonstrated consumer need exists.
The public contract can continue to be `solveThreeSegmentLeg` and the target
projection functions.

### Branch Selection

Branch selection is lexicographic, not a weighted score:

1. Reject branches that violate fixed-length or finite-coordinate invariants.
2. Prefer branches satisfying the anatomical sector.
3. Prefer branches with an upward knee.
4. Among valid branches, choose the branch nearest the anatomical pole.
5. Resolve exact ties using the outward sign and stable branch order.

Using explicit priorities avoids arbitrary score weights and makes tests state
the actual contract.

## Grounded Target Projection

### Feasible Horizontal Interval

For a fixed coxa `(cx, cy)`, sampled ground height `groundY`, and radial bound
`r`, the horizontal displacement magnitude is:

```text
absDx = sqrt(max(0, r^2 - (groundY - cy)^2))
```

The existing soft/hard annulus produces one or two radial X intervals. Convert
those intervals into the leg's outward coordinate system and intersect them
with the anatomical sector.

### Sector Search

For each grounded target request:

1. Compute the predicted landing-time hip and coxa using `stepDuration`.
2. Preserve sampled ground Y.
3. Compute the soft-annulus outward X interval.
4. Clamp the desired target to the anatomical outward side.
5. Solve both knee branches at the candidate X.
6. If neither branch satisfies the sector, move X outward.
7. Find the nearest valid X using a fixed-count bisection search.
8. Fall back to the hard-annulus interval if no soft solution exists.
9. If no grounded hard solution exists, keep the current planted foot and
   leave the request pending rather than creating a collapsed pose.

The search must use a fixed iteration count, for example 12 iterations. It must
not terminate on a floating-point epsilon because iteration-count divergence
would weaken determinism across runtimes.

The nearest valid X is chosen, not the farthest, so gait travel remains small
and planted-foot motion is minimized.

### Important Ordering Change

The current early return for targets inside the soft annulus must be removed or
moved after sector validation. A target is valid only when it satisfies both:

```text
radial workspace AND anatomical sector
```

Radial validity alone is insufficient.

## Renderer Fallback

`solveThreeSegmentLeg` must use the same sector rules as gait target generation.

For arbitrary transient targets, including swing interpolation and a body turn:

1. Sanitize the target.
2. Project it into the hard radial workspace.
3. Project it into the anatomical sector.
4. Evaluate both branches.
5. Select a valid upward branch.

Renderer projection remains an emergency visual fallback and must never feed
positions back into authoritative gait state. Proactive gait requests should
make visible fallback displacement rare.

If a target is corrected by the renderer, all segment lengths still remain
fixed. The corrected `LegPose.footX/footY` may temporarily differ from the gait
target, but tests must bound this error and require the gait to request a
replant on the next tick.

## Gait Changes

### Step Requests

Extend `computeLegStepRequest` so `needsStep` is also true when the current or
predicted planted target violates the anatomical sector.

The structured request should expose sector information:

```ts
export interface LegStepRequest {
  readonly needsStep: boolean;
  readonly urgency: number;
  readonly restError: number;
  readonly workspaceError: number;
  readonly sectorError: number;
  readonly hardViolation: boolean;
}
```

Priority order:

1. Hard radial violation.
2. Anatomical fold violation.
3. Soft radial violation.
4. Rest-position error.
5. Stable leg index.

No speed gate applies to recovery. A folded leg must be able to replant while
the body is idle.

### Step Endpoints

After `sampleGround` returns a surface point, pass that point through the
combined radial-and-sector grounded projector before assigning `endX/endY`.

The projected endpoint must be evaluated against the predicted landing-time
coxa, not the current coxa and not the longer compression lookahead.

### Swing Arc

Valid start and end targets do not guarantee that every quadratic Bezier sample
remains valid relative to a moving body. Long-run tests must evaluate the full
rendered chain throughout swing.

If swing samples still cross the sector boundary, replace the current direct
X midpoint with an outward-biased midpoint derived from the valid start/end
sector. Do not alter the vertical parabolic lift unless visual tests show a
need.

### Turn Handling

Keep the existing within-side front-to-rear payload remap. Add sector checks
immediately after a facing change so every remapped foot either:

- Remains valid under the new anatomical axis, or
- Enters the deterministic recovery service queue.

Corresponding near/far pair locks and alternating gait-set constraints remain
unchanged.

## Default Rest Topology

The current defaults are:

```ts
[
  { angle: 30, distance: 38 },
  { angle: 60, distance: 35 },
  { angle: 120, distance: 35 },
  { angle: 150, distance: 38 },
]
```

The `60` and `120` degree feet have insufficient horizontal separation from
their coxae after grounding. This produces the large distal reversal seen in
the coordinate trace.

Retune defaults only after sector projection exists. The target outcome is:

- The two anterior feet sit progressively forward of the cephalothorax.
- The two posterior feet sit progressively behind the abdomen/cephalothorax.
- Inner legs do not land almost directly beneath their coxae.
- All default grounded targets fall inside the soft annulus and sector without
  requiring renderer fallback.

Candidate values should be selected through tests and benchmark rendering,
not committed as unverified constants. Likely changes include shallower inner
angles and greater rest distances.

## Showcase Grounding

`groundShowcaseSpiderState` currently replaces foot Y while retaining the old
X. That can turn an originally valid polar rest target into a folded grounded
target.

Update the helper to:

1. Compute each leg's hip and coxa at the supplied body position and facing.
2. Set the desired Y to the floor.
3. Project the desired X through the combined grounded workspace/sector helper.
4. Apply the projected point consistently to `foot`, `start`, `end`, and `mid`.

The helper will need body position, facing, and geometry rather than only state
and floor Y. Its tests must continue to prove immutable returns.

## Test-Driven Implementation Order

### Phase 1: Reproduce the Defect

Add a focused test using the current default grounded right-facing pose. It
must assert that the known second foreleg currently has negative distal advance
and therefore fails the new invariant.

The test should use public geometry/pose APIs rather than hard-coding internal
solver values.

### Phase 2: Branch Diagnostics

Add tests for branch evaluation:

- One branch upward and monotonic.
- One branch upward but distal-reversing.
- Both branches sector-invalid for a target too close horizontally.
- Exact tie uses stable deterministic selection.
- Segment lengths remain exact for both raw branches.

### Phase 3: Grounded Sector Projection

Test:

- Ground Y is preserved.
- Front-leg projection moves an inward target forward.
- Rear-leg projection moves an inward target backward.
- Right/left results mirror exactly.
- The nearest valid X is selected.
- Soft annulus is preferred over hard annulus.
- Impossible ground heights do not produce NaN or bone-length changes.

### Phase 4: Pose Evaluation

For all four default anatomical ordinals and both facings, assert:

- Fixed coxa/femur/tibia lengths.
- Positive coxa advance.
- Non-negative femur advance.
- Distal advance meets the configured margin.
- Knee is upward.
- Coordinates are finite.
- Facing results mirror.

Include close, coincident, far, and non-finite requested targets.

### Phase 5: Gait Progression

Test:

- Sector-invalid planted feet request recovery at zero speed.
- Proactive prediction requests a step before distal reversal occurs.
- Grounded step endpoints satisfy radial and sector constraints.
- Corresponding near/far legs never swing together.
- Coordinated sets never overlap.
- Frantic neighbor and support locks remain intact.
- Turns replant invalid feet without crossing the body.

### Phase 6: Long-Run Matrix

Run seeded simulations across:

- `2`, `4`, `6`, and `8` total visible legs.
- Coordinated and frantic modes.
- Facing right and facing left.
- Forward movement, reverse movement, repeated turns, stop/start, and speed
  spikes.
- Flat and uneven ground.
- At least 1,000 ticks per representative scenario.

At every sampled tick assert:

- Finite state and pose values.
- Fixed segment lengths.
- No folded-Z chain in anatomical outward space.
- Grounded planted feet remain world-locked.
- Support and pair locks hold.
- Duplicate simulations are deeply identical.
- Input state is not mutated.

## Visual Verification

The existing four-panel benchmark is not sufficient because ghosted frames and
leg overlap can hide facing-specific folds.

Add or update benchmark coverage with:

1. Full-size green spider walking right.
2. The same spider/config/seed walking left.
3. Side-by-side static joint diagnostics for each of the four ordinals.
4. A reversal sequence with clear non-ghosted final frames.
5. A close-up of the inner foreleg that currently reverses by 13px.
6. `2/4/6/8` leg-count silhouettes.

Render colored joint markers or segment labels in a diagnostic panel:

- Hip: white.
- Coxa: yellow.
- Knee: cyan.
- Foot: magenta.

Visual acceptance checks:

- Front feet extend beyond their knees in facing-relative space.
- Rear feet extend beyond their knees in the opposite direction.
- No distal segment points back toward the body.
- Knees remain above the leg chord.
- Feet stay on the floor during stance.
- Right and left poses read as exact mirrors.
- Near/far layering does not conceal a fold.

Capture the running showcase with Playwright in addition to the static Node
canvas benchmark. The reported defect was visible in the live showcase despite
the static benchmark previously passing visual review.

## Files Expected to Change

Core implementation:

- `src/animation/spider/geometry.ts`
- `src/animation/spider/gait.ts`
- `src/animation/spider/constants.ts`
- `src/animation/spider/index.ts`

Core tests:

- `src/tests/spider-geometry.test.ts`
- `src/tests/spider-gait.test.ts`
- `src/tests/spider-state.test.ts`
- `src/tests/spider-draw.test.ts` only if the public pose contract changes

Showcase and benchmark:

- `showcase/sections/spider-config.ts`
- `showcase/sections/spider.ts`
- `showcase/tests/spider-config.test.ts`
- `benchmarks/_scripts/spider-render.ts`
- `benchmarks/spider/sample-sheet.png`

Documentation:

- `docs/api-surface.md`
- This plan, updated with final accepted defaults and benchmark results

## Verification Commands

Run every gate after implementation:

```bash
npm test
npm run build
npm run showcase:typecheck
npm run showcase:test
npm run showcase:build
npx tsx benchmarks/_scripts/spider-render.ts
```

Then capture the live spider canvas through Playwright and request visual review
of both the benchmark sheet and live right/left frames.

## Acceptance Criteria

The change is complete only when all of the following are true:

1. The reproduced right-facing inner foreleg no longer has negative distal
   advance.
2. Every default front leg progresses forward and every default rear leg
   progresses backward in facing-relative coordinates.
3. Every coxa, femur, and tibia retains its configured length.
4. Knees remain upward without branch flipping under small target changes.
5. Grounded projection preserves floor Y whenever geometrically possible.
6. Idle, moving, and turning spiders recover sector-invalid feet without a
   speed gate.
7. Near/far pair, gait-set, neighbor, and support locks continue to pass.
8. Right-facing and left-facing poses are exact mirrors in tests.
9. All unit tests, typechecks, and builds pass.
10. Static benchmark and live Playwright visual review both show no folded-Z
    legs, no feet behind their knees, no body crossing, and no floor clipping.

## Non-Goals

- Simulating all seven biological spider leg segments.
- Adding physics or dynamic body-height control.
- Supporting wall or ceiling locomotion.
- Reintroducing variable bone lengths or renderer-side shrinking.
- Making all rear legs sweep forward with the direction of travel.
- Persisting renderer joint positions in authoritative gait state.
