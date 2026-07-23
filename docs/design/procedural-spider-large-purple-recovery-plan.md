# Large Purple Spider Recovery Plan

**Status:** Proposed; not implemented  
**Scope:** Repair the `1.2x`, `90px/s` coordinated showcase spider without weakening fixed-length or anatomical-sector invariants  
**Extends:** `docs/design/procedural-spider-anatomical-sector-plan.md`

## Objective

Make the large purple showcase spider retain a readable, naturally arched leg
fan while walking and reversing direction at lane boundaries.

The fix must eliminate:

- The vertical bundle of front legs.
- Nearly straight rear legs dragging backward.
- Feet or knees collapsing into the same horizontal position.
- Large hidden corrections between gait targets and rendered feet.
- Reversal states that repeatedly reproduce the same invalid pose.

The solution must preserve:

- Fixed coxa, femur, and tibia lengths.
- Front legs extending forward and rear legs extending backward.
- Upward knees and outward tibiae.
- Planted-foot world locking.
- Near/far independence and gait support locks.
- Exact left/right mirror behavior.
- Deterministic and immutable state progression.

## Live Reproduction

The failing showcase instance is configured in
`showcase/sections/spider.ts` as:

```text
scale: 1.2
speed: 90px/s
mode: coordinated
base step duration: 0.18s
base phase advance: 0.16
body clearance: 28 * 1.2 = 33.6px
```

The active scaled geometry is:

```text
hip radius: 9.6px
coxa length: 9.6px
femur length: 26.4px
tibia length: 52.8px
soft minimum extension ratio: 0.35
maximum extension ratio: 0.94
joint safety margin: 0.6px
minimum distal advance ratio: 0.1
```

The large spider currently receives these unscaled rest positions:

```text
outer distance: 61.7px
inner distance: 42.5px
angles: 27, 41.2, 138.8, 153 degrees
```

## Measured Failure

A deterministic 1,200-tick reproduction of the live lane-bounce loop found:

```text
maximum gait-foot to rendered-foot correction: 62.41px
minimum separation between the two front feet/knees: 0.9px
minimum inner femur horizontal advance: 0.01px
```

At a representative repeated failure frame:

```text
tick: 83
body X: 80.9
facing: left
front-foot separation: 0.9px
largest renderer correction: 55.81px
```

The same failure repeats every lane cycle. The opposite-facing boundary reaches
the same maximum `62.41px` correction with mirrored leg indices.

This means the issue is not a renderer-only visual preference. The
authoritative gait and derived pose disagree by more than half the spider's
body-plus-leg footprint.

## Visual Symptoms

The captured large-purple failure shows:

- Front coxae, knees, and tibiae compressed into a narrow vertical stack.
- One or more front legs extending below the body with almost no femur advance.
- Rear femur/tibia chains becoming long, shallow rods close to the floor.
- Multiple legs overlapping so their stepping phases cannot be read.
- The body appearing unsupported despite all configured bones retaining length.

The renderer's anatomical-sector projection prevents a literal folded-Z, but
it does so by moving multiple invalid gait targets toward the same nearest
sector boundary. The result is a different form of collapse: valid individual
IK chains stacked into an invalid overall leg fan.

## Root Causes

### 1. Inconsistent Showcase Scaling

`scaleShowcaseSpiderConfig` uses two scale factors:

```ts
scale = sizeScale
detailScale = sizeScale / 1.2
```

Segment lengths use `scale`, while rest distances use `detailScale`:

```text
geometry lengths at 1.2x: multiplied by 1.2
rest distances at 1.2x: multiplied by 1.0
```

This convention predates the current three-segment defaults. The default rest
positions are now documented as valid for the default `1.0x` geometry, but the
showcase scaler treats them as if they were authored for the `1.2x` reference.

The resulting normalized stance is compressed.

A read-only test using `1.2x` rest distances improved the inner leg's normalized
advances from approximately:

```text
current inner femur advance: 1.4px / 26.4px = 0.05
scaled inner femur advance:  5.8px / 26.4px = 0.22
```

The distal segment also retained positive outward advance.

### 2. Large Inner Annulus

The active `26.4 / 52.8` femur/tibia pair has a physical minimum reach near:

```text
abs(26.4 - 52.8) + 0.6 = 27.0px
```

Targets closer than this cannot be reached by a fixed-length two-bone chain.
The long tibia therefore magnifies errors from compressed rest targets,
grounding, and turns.

The segment ratio may remain visually useful, but only if every gait target is
authored and advanced outside this inner region. If target corrections remain
large after scaling and turn fixes, the ratio must be retuned.

### 3. Grounding Changes Y Without Revalidating X

`groundShowcaseSpiderState` currently replaces:

```text
footY, startY, endY, midY
```

It retains the original X coordinates. Changing only Y changes coxa-to-foot
distance and branch feasibility. A polar rest point that was valid before
grounding can become radially or sector invalid afterward.

### 4. Reversal Carries Invalid Foot and Swing Payloads

At a facing change, gait remaps front/rear foot payloads within each side. The
current transition may carry:

- An in-progress swing arc designed for the previous facing.
- Start, midpoint, and endpoint coordinates in the old sector.
- A serviced-leg ledger associated with the previous active set.
- A planted foot that is radially valid but invalid for the new outward axis.

The renderer then projects the invalid target into the new sector without
changing authoritative gait state.

### 5. Renderer Fallback Hides Gait Failure

`solveThreeSegmentLeg` projects arbitrary targets into the nearest valid radial
and anatomical workspace. This is appropriate as a bounded emergency fallback,
but the current implementation has no maximum correction contract.

Existing tests prove that the final rendered tibia points outward. They do not
prove that the rendered foot remains close to the authoritative gait foot.

A `62.41px` correction can therefore pass every fixed-length and no-fold test.

### 6. Per-Leg Validity Does Not Guarantee Fan Separation

Each leg can independently satisfy:

- Fixed segment lengths.
- Upward knee.
- Positive femur advance.
- Positive distal advance.

Multiple legs can still select almost identical knees and feet. The current
geometry has no same-side ordinal spacing constraint or diagnostic.

## Design Principles

### Authoritative Gait First

The primary fix must make gait targets valid. Renderer projection must not be
used to manufacture the normal walking pose.

### Uniform Physical Scaling

All physical distances belonging to the same spider must scale together.
Cosmetic details may use a separate scale only when they do not affect gait or
IK geometry.

### Bounded Renderer Correction

Renderer fallback is allowed for transient numerical or turn states, but its
correction must be measured and bounded.

### Explicit Turn Transition

A facing reversal is a state transition, not only a sign change. Swing arcs and
service bookkeeping must be made valid for the new facing.

### Fan-Level Validation

Tests must validate spacing between adjacent same-side legs in addition to
validating each leg independently.

## Implementation Plan

## Phase 1: Lock the Live Reproduction in Tests

Add a showcase-level deterministic test matching the large-purple instance:

```text
scale: 1.2
speed: 90px/s
mode: coordinated
canvas width: 960
floor Y: 224
body clearance: 33.6px
lane bounds: generated by createShowcaseSpiderLanes
ticks: at least 1,200
```

Record on every tick:

- Facing.
- Whether a turn occurred.
- Gait foot coordinates.
- Rendered foot coordinates.
- Hip, coxa, and knee coordinates.
- Swing state and phase.
- Active set and serviced-leg indices.
- Same-side adjacent knee and foot separation.

The initial failing assertions should reproduce:

```text
maximum correction > 50px
minimum adjacent separation < 1px
minimum normalized femur advance near 0
```

Do not weaken the test to accept the current output.

## Phase 2: Correct Physical Scaling

Separate physical and cosmetic scaling in
`scaleShowcaseSpiderConfig`.

Physical fields use `sizeScale`:

- `geometry.hipRadius`
- `geometry.coxaLength`
- `geometry.femurLength`
- `geometry.tibiaLength`
- `geometry.jointSafetyMargin`
- `legRestPositions[].distance`
- `comfortRadius`
- `stepHeight`
- Any other world-space gait threshold

Dimensionless geometry fields remain unchanged:

- `minExtensionRatio`
- `maxExtensionRatio`
- `minDistalAdvanceRatio`

Cosmetic fields may retain a separate detail scale after review:

- Stroke widths.
- Joint radii.
- Jitter amplitude.
- Eye radii.
- Fang widths.

Body radii and body offsets remain physical and use `sizeScale`.

Update the misleading `SHOWCASE_SPIDER_REFERENCE_SCALE` documentation. The
base `DEFAULT_SPIDER` is now a coherent `1.0x` physical configuration. A `1.2x`
spider must be a uniform `1.2x` physical transform of that configuration.

### Scaling Acceptance

Across `0.7`, `1.0`, and `1.2` scales, assert identical normalized values:

```text
restDistance / totalLegReach
bodyClearance / totalLegReach
comfortRadius / totalLegReach
stepHeight / totalLegReach
jointSafetyMargin / totalLegReach
```

Also assert that a grounded static pose has comparable normalized femur and
distal advances at every scale.

## Phase 3: Make Showcase Grounding Geometry-Aware

Change `groundShowcaseSpiderState` to accept the data required to calculate a
valid grounded target:

```ts
groundShowcaseSpiderState(
  state,
  bodyX,
  bodyY,
  facing,
  floorY,
  geometry,
)
```

For each leg:

1. Compute its hip and coxa at the supplied body pose.
2. Set desired foot Y to `floorY`.
3. Project desired foot X through
   `projectGroundedTargetIntoWorkspace`.
4. Set `foot`, `start`, `end`, and `mid` to the same valid grounded point.
5. Preserve immutable returns.

Grounding must not use renderer output or mutate the original state.

### Grounding Acceptance

Immediately after initialization:

- Every gait foot equals its rendered foot within floating tolerance.
- Every grounded foot remains exactly on the floor.
- No leg requires immediate workspace or sector recovery.
- Adjacent same-side legs retain their authored ordinal ordering.

## Phase 4: Add Gait-Render Agreement Diagnostics

Add a pure diagnostic helper for tests or keep the calculation local to test
utilities:

```ts
footCorrection = distance(gaitFoot, renderedFoot)
```

Acceptance bounds:

- Planted, non-turning leg: `footCorrection <= 0.5px`.
- Swinging, non-turning leg: `footCorrection <= 5%` of total leg reach.
- Turn transition: `footCorrection <= 10%` of total leg reach for a bounded
  number of ticks.
- No state may exceed the turn bound.

The exact percentages may be tightened after implementation, but they must not
be relaxed enough to accept the measured `62.41px` correction.

When a planted foot requires renderer correction beyond the planted tolerance,
the gait must report `needsStep` and eventually replace the target.

## Phase 5: Repair Facing Reversal State

Treat a facing change as an explicit transition inside `advanceGait`.

### Rebase Current Foot Position

Before remapping a swinging leg, sample its current Bezier position. Never copy
an old arc wholesale into the new facing.

### Remap Anatomical Ordinals

Keep the existing front-to-rear partner intent, but validate every mapped foot
against:

- The new coxa position.
- The new radial annulus.
- The new outward sector.
- The same-side ordinal ordering.

### Cancel or Rebase Swings

For an in-progress swing at the instant of reversal:

1. Use the sampled current foot as the new start.
2. Generate a new grounded, sector-valid endpoint for the new facing.
3. Generate a new midpoint from that start/end pair.
4. Reset phase consistently or mark the leg planted and enqueue recovery.

Do not retain a previous-facing `start`, `mid`, or `end` coordinate.

### Reset Service Bookkeeping

On facing change:

- Remove serviced indices that no longer belong to the valid active cycle.
- Select the active set from the highest-priority invalid leg while preserving
  opposite-set support.
- Keep corresponding-pair and same-side neighbor locks.

### Turn Movement Policy

If more than the allowed number of legs are invalid immediately after remap,
hold body movement at the lane boundary while deterministic recovery begins.
Resume movement when enough support legs have valid targets.

This pause should be state/config driven and deterministic, not a showcase-only
animation delay.

## Phase 6: Validate Swing Samples, Not Only Endpoints

The current sector-aware projection validates grounded endpoints. A quadratic
Bezier can still pass through an invalid sector while the body moves.

For each swing sample:

- Evaluate radial validity relative to the current coxa.
- Evaluate femur and distal advance.
- Measure renderer correction.

If ordinary arcs violate the sector, make the midpoint outward-aware:

```text
midX = outward-most valid interpolation of start/end sector bounds
midY = existing lifted midpoint Y
```

Keep the vertical lift behavior unless visual testing identifies a separate
problem.

Avoid projecting every rendered frame as the primary solution. Arc generation
should produce valid samples directly.

## Phase 7: Add Same-Side Fan Separation

Define adjacent ordinals per side from rear to front. At grounded/rest states,
their feet and knees must remain ordered along the facing-relative axis.

Suggested diagnostics:

```ts
kneeSeparation = abs(kneeA.x - kneeB.x)
footSeparation = abs(footA.x - footB.x)
```

Initial large-purple acceptance targets:

- Adjacent grounded feet separated by at least `0.1 * totalLegReach`.
- Adjacent grounded knees separated by at least `0.05 * totalLegReach`.
- No ordering inversion outside the bounded turn transition.

These are validation constraints, not necessarily new runtime collision
constraints. First correct rest targets and turn mapping. Add runtime spacing
only if valid authored targets still converge.

## Phase 8: Reassess Segment Proportions

After scaling, grounding, turn, and gait-render agreement are fixed, rerun the
large-purple reproduction without changing `22 / 44` base femur/tibia lengths.

Retain the ratio only if:

- Maximum correction remains within bounds.
- Inner legs retain readable femur advance.
- Rear legs do not become shallow rods.
- Adjacent legs retain separation.

If it still fails, compare a small deterministic matrix such as:

```text
24 / 40
26 / 38
28 / 36
```

Keep total femur+tibia reach comparable while reducing the inner unreachable
radius `abs(femur - tibia)`.

Choose the smallest change that passes geometry, gait, and visual acceptance.
Do not tune proportions before fixing invalid authoritative targets, because
that would hide the actual state bug.

## Test Matrix

### Static Scale Tests

For scales `0.7`, `1.0`, and `1.2`:

- Normalized rest and geometry ratios match.
- Every leg is sector valid immediately after grounding.
- Gait and rendered feet agree.
- Same-side feet/knees retain separation.
- Facing left is an exact mirror of facing right.

### Large Purple Live Test

Run at least 1,200 ticks with:

```text
scale 1.2
90px/s
coordinated mode
generated showcase lane
repeated boundary reversals
```

Assert:

- At least ten left/right reversals occur.
- Fixed lengths hold every sampled tick.
- Support locks hold.
- No adjacent leg bundle falls below separation bounds outside a bounded turn.
- Renderer correction stays within planted/swing/turn limits.
- Every invalid target is eventually serviced.
- No serviced cycle repeats indefinitely with the same invalid planted foot.

### Modes and Speeds

Repeat representative runs for:

- Coordinated and frantic modes.
- Speed multipliers `0`, `0.5`, `1.0`, and maximum showcase speed.
- `2`, `4`, `6`, and `8` visible legs.
- Both starting facings.

### Determinism and Purity

- Duplicate runs are deeply identical.
- Input state is not mutated.
- No random or wall-clock source is introduced.
- Any geometric search uses a fixed iteration count.

## Visual Benchmark Plan

Add a large-purple-specific benchmark sheet or panel containing:

1. Initial grounded pose at `1.2x`.
2. Mid-stride facing right.
3. Right boundary immediately before reversal.
4. First turn-transition frame.
5. Mid-recovery frame.
6. Stable facing-left stride.
7. Mirrored sequence at the opposite boundary.

Use non-ghosted close-ups for the primary frames. Ghosting may be included in a
separate trail panel but must not obscure individual legs.

Diagnostic overlays should include:

- Gait foot marker.
- Rendered foot marker.
- A line between them when correction is nonzero.
- Leg ordinal label.
- Active set and swing state.
- Current facing and turn-transition state.

Capture the live showcase canvas with Playwright after the static benchmark.
The previous static benchmark did not expose the large-purple reversal failure.

## Expected Files to Change

Core behavior:

- `src/animation/spider/gait.ts`
- `src/animation/spider/geometry.ts` only if swing/turn projection requires a
  shared helper
- `src/animation/spider/types.ts` if turn state/config becomes public

Core tests:

- `src/tests/spider-gait.test.ts`
- `src/tests/spider-state.test.ts`
- `src/tests/spider-geometry.test.ts`

Showcase:

- `showcase/sections/spider-config.ts`
- `showcase/sections/spider.ts`
- `showcase/tests/spider-config.test.ts`

Benchmark and documentation:

- `benchmarks/_scripts/spider-render.ts`
- `benchmarks/spider/sample-sheet.png`
- `docs/api-surface.md` if public state/config changes
- This plan with final measurements and accepted proportions

## Verification Commands

```bash
npm test
npm run build
npm run showcase:typecheck
npm run showcase:test
npm run showcase:build
npx tsx benchmarks/_scripts/spider-render.ts
```

Then run the Playwright live-canvas capture and visual review.

## Acceptance Criteria

The large-purple recovery is complete only when:

1. The `1.2x` physical configuration scales uniformly.
2. Initialization produces sector-valid grounded gait targets without renderer
   correction.
3. Planted gait and rendered feet agree within `0.5px` outside a turn.
4. Swing and turn correction remain within their documented percentage bounds.
5. No correction approaches the measured `55-62px` failure.
6. Front and rear leg ordinals retain readable same-side separation.
7. No inner femur collapses to near-zero horizontal advance during ordinary
   stance.
8. Rear legs do not become long, shallow rods dragging along the floor.
9. Reversals rebase or cancel old-facing swing arcs.
10. Invalid post-turn targets are serviced and do not repeat indefinitely.
11. Left and right behavior mirror exactly in deterministic tests.
12. All library/showcase tests, typechecks, and builds pass.
13. Static benchmark and live Playwright review both approve the large-purple
    pose and repeated reversal cycle.

## Non-Goals

- Removing the large purple spider from the showcase.
- Reducing its scale or speed solely to conceal the failure.
- Allowing variable bone lengths.
- Feeding renderer-corrected feet back into authoritative state.
- Replacing deterministic gait with physics.
- Weakening support, pair, neighbor, or alternating-set constraints.
- Adding arbitrary per-frame leg repulsion before authored targets and turn
  state have been corrected.
