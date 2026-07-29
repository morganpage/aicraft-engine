# Plan: Humanoid Three-Quarter Visual Revision

> Date: 2026-07-29
> Status: **READY FOR IMPLEMENTATION**
> Branch: `codex/character-enemy-validation`
> Candidate release: `aicraft-engine@0.5.0`
> Trigger: the 0.5.0 candidate passed its technical gates but did not pass
> humanoid visual review

## Outcome

Replace the current self-referential humanoid poses with a measured,
source-backed procedural character that reads as a believable human in a 2D
side-scrolling platformer.

The target is a **cheated three-quarter profile**:

- travel, pelvis, feet, and gait read side-on;
- the head and chest turn toward the viewer enough to reveal identity;
- near and far limbs are deliberately unequal in position, value, width, and
  draw order;
- idle, locomotion, ascent, apex, descent, and landing are recognisably
  different poses;
- the result remains procedural Canvas2D geometry, deterministic, seed-varied,
  and readable inside a `32 × 48` body frame.

Completion of this plan changes the release-candidate visual verdict from
`NEEDS VISUAL REVISION` to either `APPROVED` or a recorded new revision request.
It does not publish, tag, or merge the candidate.

## Why a focused plan

`docs/design/post-0.4-character-enemy-validation-plan.md` remains the historical
umbrella for the humanoid and charger candidate. Its architecture, package, and
external-consumer gates have already passed. Reopening and renumbering those
completed phases would obscure the audit trail.

This document owns the remaining humanoid recovery work. The umbrella plan and
release-candidate handoff link here.

## Evidence baseline

The detailed findings and source links live in:

- `docs/research/humanoid-platformer-visual-reference.md`

The production grammar uses the following references for different questions:

| Reference | Role | What it may validate | Repository use |
|---|---|---|---|
| Godot 2D Platformer robot | Primary pose and projection reference | Named run, idle, jump, and fall frames; three-quarter profile | MIT source may be inspected and measured with attribution |
| GandalfHardcore Free Warrior | Human-scale temporal comparison | Human proportions; idle, walk, run, jump, fall, slide, weapon variants | External measurement only until a precise reuse licence is confirmed |
| Shantae / Freedom Planet 2 analysis | Perspective-construction evidence | Near/far eye, shoulder, hand, and joint offsets; pseudo two-point perspective | Cite the CC BY-SA analysis; do not copy its sprites |
| Dead Cells | Articulation and key-pose strategy | Pose-first animation, near/far limb depth, approximately 50-pixel production scale | Supporting observation only; do not copy game assets |
| Phaser `32 × 48` character | Minimum-readability control | Amount of anatomy that survives at the nominal frame size | Inspect only; do not copy the example asset |
| Kenney and selected OpenGameArt sequences | Open controls | Standing support, jump/fall separation, very-small-scale silhouette | Use only under their recorded licences |

No external raster sprite becomes a runtime, benchmark, test, or documentation
asset. Repository artifacts may contain citations, numeric observations, and
original analytical diagrams.

## Locked decisions

1. Keep procedural Canvas2D rendering. Do not replace `drawHumanoid` with a
   sprite-sheet renderer.
2. Keep the public `0.5.0` humanoid API stable:
   - `HumanoidConfig`
   - `HumanoidVisualState`
   - `HumanoidMotionSample`
   - `deriveHumanoidConfig`
   - `createHumanoidVisualState`
   - `advanceHumanoidVisual`
   - `drawHumanoid`
3. Do not add a runtime dependency.
4. Do not move world position, velocity, collision, support, or jump simulation
   into `src/character/`.
5. Continue using displacement-driven locomotion. Do not return to a
   time-driven walk cycle.
6. Preserve one canonical right-facing pose and mirror it for left-facing
   rendering.
7. Treat near/far as depth roles, not as interchangeable screen-left and
   screen-right labels.
8. Preserve the seed RNG draw order unless a separately reviewed API decision
   explicitly changes it.
9. Do not preserve byte equality with the rejected prototype image. The
   historical prototype remains evidence of what was rejected.
10. Do not expand into weapons, attacks, combat, health, knockback, or a second
    body plan during this revision.

## Public compatibility contract

This is a visual correction, not a public redesign.

- Existing calls to `drawHumanoid` must compile unchanged.
- Existing serialized or in-memory `HumanoidVisualState` shapes must remain
  accepted.
- Existing `HumanoidConfig` values must remain accepted.
- Root exports remain unchanged unless a new export is separately justified.
- Internal geometry types and test seams may change freely because they are not
  re-exported from `src/character/humanoid/index.ts`.
- `src/character/` must continue to have no import from `src/platformer/`.

If implementation reveals that a public type must change, stop and record that
as a new API decision before editing the public contract.

## Measurement protocol

### Coordinate system

All reference landmarks use a common normalized coordinate system:

- canonical facing: right;
- origin: midpoint between the planted foot contacts for grounded poses, or the
  pelvis root for unsupported poses;
- `+x`: direction of travel;
- `+y`: downward;
- `H = 1`: visible top-to-ground body height for the reference frame;
- coordinates are recorded to three decimal places;
- near and far landmarks are identified by depth role, not source-layer name.

### Required landmarks

Record these when visibly supported by the source:

- crown and head centre;
- visible eye or face-direction marker;
- near/far shoulder;
- near/far elbow;
- near/far hand;
- pelvis centre;
- near/far hip;
- near/far knee;
- near/far ankle;
- near/far foot contact or toe.

An obscured landmark is recorded as `null`. It must not be guessed merely to
complete a skeleton.

### Required phases

Grounded sequence:

1. neutral idle;
2. contact;
3. recoil/down;
4. passing;
5. high point;
6. opposite contact.

Airborne sequence:

1. launch/ascent;
2. apex;
3. descent;
4. landing contact;
5. landing compression;
6. recovery to idle or gait.

If a source does not expose a phase, mark it absent and obtain that phase from
another source. Do not relabel an arbitrary frame to fill a gap.

### Measurement output

Extend `docs/research/humanoid-platformer-visual-reference.md` with:

- source asset dimensions and exact frame indices;
- a normalized landmark table for Godot;
- a normalized landmark table for the Warrior;
- a phase-to-phase range table containing only measurements supported by at
  least one source;
- a short note for every inferred production target that is not a direct
  measurement.

The measured tables become the authority for implementation and tests. The
existing hypothesis diagrams cease to be approval targets.

## Target pose grammar

### Three-quarter construction

The canonical pose must satisfy all of the following:

- pelvis and foot progression remain aligned to horizontal travel;
- the near shoulder is more exposed than the far shoulder;
- the far shoulder is partly occluded by the torso mass;
- the visible facial feature is displaced toward the travel-facing side;
- far limbs draw first with lower contrast and slightly lower apparent weight;
- near limbs draw later with stronger contrast and slightly greater apparent
  weight;
- near/far joints use small vertical and horizontal offsets; they are not
  perfectly paired;
- mirroring swaps screen direction without swapping the semantic near/far
  depth hierarchy inside the canonical drawing.

### Neutral idle

Idle is quiet and readable:

- both feet contact the ground;
- each knee stays on its own anatomical side;
- legs do not cross;
- pelvis remains above and between the support contacts;
- knees are nearly extended but not locked;
- hands sit below the pelvis and above the knees;
- elbows and hands do not cross the torso centreline;
- arms hang with a shallow bend rather than resting on the hips;
- breathing changes torso volume subtly without moving planted feet;
- face, chest, pelvis, and feet agree on the same three-quarter projection.

The current numeric neutral ranges in the research note remain provisional
until checked against the two measured sources.

### Grounded locomotion

- Contact frames show the largest longitudinal foot separation.
- The leading foot reaches down toward contact rather than floating.
- Recoil lowers the pelvis and absorbs weight.
- Passing brings the recovering foot beneath or just past the pelvis with a
  visibly bent knee.
- High point raises the pelvis and prepares the next reach.
- Opposite contact is the depth-consistent counterpart of contact, not a
  mechanically mirrored drawing of every limb.
- Passive arms oppose the legs.
- Hands remain outside the torso mass except during an explicitly targeted arm
  pose.
- Root travel and stride phase remain displacement-driven so planted contacts
  do not slide when `dx === 0`.

### Airborne and landing

- Ascent gathers the legs and preserves launch direction.
- Apex is more compact than ascent or descent.
- Descent lowers and separates the feet in preparation for support.
- Landing contact places both support candidates at the floor without a
  walking-in-air silhouette.
- Landing compression visibly bends both knees, lowers the pelvis, and then
  decays back toward idle or gait.
- Ceiling-gravity variants retain the same support-relative semantics.
- `launchBlend`, `landingBlend`, and `ceilingBlend` must affect limb geometry,
  not merely translate the complete drawing.

### Arm targeting

- Passive gait arms remain opposing and relaxed.
- Only the requested arm reaches toward `armTarget`/`lookTarget`.
- The untargeted arm retains the current gait or idle role.
- Targeting does not change locomotion phase or lower-body support.
- An unreachable target clamps through the existing IK solver without
  non-finite coordinates or limb-length changes.

## Implementation shape

### Pure pose layer

Create an internal pose module:

```text
src/character/humanoid/pose.ts
```

It should:

- evaluate a complete canonical humanoid pose without touching a canvas;
- expose internal near/far head, torso, arm, and leg geometry for tests;
- derive named gait phase information from the existing continuous locomotion
  phase;
- blend idle, gait, airborne, targeted-arm, and landing contributions in a
  fixed documented order;
- keep all output finite for defensive inputs;
- preserve exact configured limb lengths through the IK solver;
- contain no world simulation or host access.

`draw.ts` becomes a renderer of the evaluated pose instead of independently
inventing lower-body, upper-body, and whole-body offsets.

### State layer

Retain the current public state fields. Revise `advanceHumanoidVisual` only
where necessary to produce reliable blend values:

- `locomotion.phase` remains displacement-driven and frozen while unsupported;
- `idleBlend` continues to enter and leave neutral stance smoothly;
- support-relative `airPose` remains derived from
  `verticalVelocity × gravityDirection`;
- launch, landing, and ceiling pulses continue to decay deterministically;
- no new physics integration is introduced.

### Renderer layer

Revise `drawHumanoid` to use explicit depth passes:

1. far leg;
2. far arm;
3. torso and pelvis mass;
4. near leg;
5. near arm;
6. head, face, and head treatment;
7. small foreground accents.

The exact order may be adjusted after visual review, but it must be explicit
and tested through pose semantics rather than accidental source order.

The torso should no longer read as a front-facing symmetric rectangle if the
limbs and face imply a three-quarter profile. Use original procedural geometry
such as an offset polygon, overlapping masses, or asymmetric contour—not a
traced sprite silhouette.

### Prototype handling

The old showcase prototype is historical and has already been promoted. Do not
maintain a second hand-copied implementation during this recovery.

- Production source becomes the only revised implementation.
- `humanoid-prototype.png` remains the rejected historical image.
- `humanoid-production.png` becomes the current candidate.
- Remove the benchmark assertion that production bytes must equal prototype
  bytes.
- Retain the production render-twice determinism assertion.
- Update benchmark documentation so the two images are not described as
  equivalent.

If a temporary experiment is useful, keep it in a short-lived local branch or
an excluded benchmark script; do not recreate a permanent duplicate renderer.

## Work phases

### Phase H0 — Freeze and record the rejected baseline

Deliverables:

- Record the current production PNG SHA-256 and candidate commit in this plan
  or the release-candidate handoff.
- Confirm the current worktree contains only the intended research/plan edits.
- Label the existing prototype/production visual equality as historical
  evidence, not a future gate.

Exit criteria:

- Anyone can identify exactly which visual was rejected.
- No unrelated source change is folded into the revision.

### Phase H1 — Build the measured pose table

Deliverables:

- Godot frame mapping and normalized landmarks.
- Warrior frame mapping and normalized landmarks.
- Explicit missing/occluded entries.
- Derived target ranges with direct measurements separated from inference.
- Updated source/licence notes.

Exit criteria:

- Contact, passing, opposite-contact, ascent, apex, descent, and landing have a
  defensible source or are explicitly marked as a remaining gap.
- No approval target depends only on the old analytical hypotheses.

### Phase H2 — Implement and review neutral projection first

Deliverables:

- Internal `pose.ts` seam.
- Canonical near/far semantics.
- Revised torso/head construction.
- Revised idle arms and legs.
- Geometry tests for neutral pose.
- A focused idle sheet showing:
  - right-facing and left-facing;
  - three representative seeds;
  - colour and grayscale;
  - `32 × 48`, `16 × 24`, and `8 × 12`;
  - skeleton/landmark overlay at enlarged scale.

Review gate:

Do not implement the full run cycle until the idle sheet is visually reviewed.
The idle must no longer show crossed legs, a front-facing torso with side-facing
feet, drooping shoulders, hands-on-hips, or unexplained arm gestures.

### Phase H3 — Implement measured grounded locomotion

Deliverables:

- Named phase evaluator for contact, recoil, passing, high point, and opposite
  contact.
- Counter-swinging passive arms.
- Near/far depth preserved throughout the cycle.
- Displacement-driven interpolation between key poses.
- Geometry tests for every named phase and for a dense phase sweep.
- Updated benchmark rows using named phases rather than arbitrary step counts.

Review gate:

- A static contact/passing/contact sheet reads correctly.
- A generated run-cycle strip contains no frame in which the legs accidentally
  form a neutral X, both knees collapse to one side, or both arms swing with the
  same leg.

### Phase H4 — Implement airborne and landing poses

Deliverables:

- Distinct ascent, apex, descent, landing-contact, and landing-compression
  geometry.
- Support-relative ceiling-gravity equivalents.
- Landing blend affects knees, pelvis, and feet.
- Geometry tests for airborne distinction and landing support.
- Updated benchmark row for the complete airborne sequence.

Review gate:

- Unsupported poses do not look like walking frames lifted off the ground.
- Descent visibly prepares for landing.
- Landing shows compression and recovery without foot penetration or sliding.

### Phase H5 — Revalidate targeting, variation, and small-scale readability

Deliverables:

- Targeted-arm row with passive opposite arm.
- Seed sweep proving controlled proportion variation.
- Mirrored-facing row.
- Grayscale and silhouette rows.
- `32 × 48`, `16 × 24`, and `8 × 12` checks.

Exit criteria:

- All head styles retain the same projection grammar.
- Near/far limbs remain distinguishable at `32 × 48`.
- At `16 × 24`, head/torso/feet and action direction remain recognisable.
- At `8 × 12`, the silhouette remains stable even if joint detail disappears.

### Phase H6 — Automated sanity and property tests

Add or revise tests under:

```text
src/tests/character-humanoid.test.ts
```

Required deterministic geometry tests:

- every emitted landmark is finite;
- upper/lower arm and thigh/shin lengths match config within solver tolerance;
- idle feet are grounded, ordered, and non-crossing;
- idle knees remain on their respective sides;
- centre of mass lies between idle support contacts;
- idle hands are below pelvis, above knees, and outside the torso centreline;
- contact frames have greater foot separation than passing;
- passing has one recovering knee visibly flexed;
- passive arm displacement opposes the corresponding leg displacement;
- opposite contact reverses longitudinal roles while preserving near/far depth;
- grounded cycle is periodic at one full phase;
- left-facing output is the horizontal mirror of right-facing screen geometry;
- ascent, apex, descent, and landing landmark sets are not identical;
- landing has both feet at support and more knee flexion than idle;
- targeting changes only the intended upper-limb role;
- unsupported motion freezes displacement gait phase;
- invalid `dt`, non-finite motion samples, and unreachable targets never create
  non-finite geometry.

Required sweeps:

- at least 100 deterministic seeds across idle;
- representative seeds across at least 64 samples of one gait cycle;
- both facings;
- both gravity directions;
- all three head styles;
- target points in all four quadrants and beyond maximum reach.

Tests should assert structural invariants and measured ranges. Pixel hashes are
reserved for deterministic artifacts, not used as a substitute for anatomical
tests.

### Phase H7 — Rebuild visual evidence

Revise:

```text
benchmarks/_scripts/humanoid-validation-render.ts
benchmarks/_scripts/humanoid-reference-study-render.ts
benchmarks/character-body-plans/README.md
```

The production validation sheet must include:

- three seeds;
- enlarged neutral skeleton overlay;
- idle;
- contact;
- recoil;
- passing;
- high point;
- opposite contact;
- ascent;
- apex;
- descent;
- landing contact;
- landing compression;
- both facings;
- arm target;
- grayscale;
- silhouette-only;
- all required scales;
- slime-knight scale comparison.

The reference-study image must be regenerated from the measured tables and
labelled **measured**, **inferred**, or **candidate** per panel. It must not
embed unlicensed source pixels.

Determinism gate:

```bash
npm run benchmark:humanoid
shasum -a 256 benchmarks/character-body-plans/humanoid-production.png
```

The script renders production twice and requires byte-identical output.

### Phase H8 — Visual approval gate

Review the generated sheets against this binary checklist:

- [ ] The character reads as side-scrolling travel with a visible
      three-quarter face/chest.
- [ ] Idle legs are natural and uncrossed.
- [ ] Idle arms are relaxed and intentional.
- [ ] Near and far limbs are immediately distinguishable.
- [ ] Contact, passing, and opposite contact are recognisable without labels.
- [ ] Arms oppose legs during gait.
- [ ] Ascent, apex, descent, and landing are recognisably different.
- [ ] Landing compresses through the knees and pelvis.
- [ ] No pose looks like a walking frame floating in the air.
- [ ] Both facings are equally coherent.
- [ ] Three seeds vary identity without varying anatomical correctness.
- [ ] Grayscale preserves depth ordering.
- [ ] `32 × 48` is production-readable.
- [ ] Smaller scales degrade gracefully.
- [ ] The result is original procedural geometry, not a traced reference.

Verdict is one of:

- `APPROVED`;
- `NEEDS TARGETED REVISION`, with failed checklist items named;
- `REJECTED`, with a replacement strategy recorded.

Do not infer approval from passing tests.

### Phase H9 — Documentation and decision reconciliation

After visual review:

- Update `docs/research/humanoid-platformer-visual-reference.md` from
  “measured pose baseline pending” to the actual result.
- Update `docs/design/character-body-plans-decision.md` with the superseding
  visual verdict while preserving its architecture decision.
- Update `docs/design/character-enemy-validation-release-candidate.md` with the
  new production PNG SHA-256, tests, benchmark evidence, and verdict.
- Update `benchmarks/character-body-plans/README.md`.
- Update public docs only if observable behavior or examples changed.

Do not claim that the GandalfHardcore sheet is bundled, licensed for
redistribution, or the visual style being copied.

### Phase H10 — Full candidate verification

After and only after visual approval, run:

```bash
npm test
npm run build
npm run build:dist
npm run showcase:typecheck
npm run showcase:test
npm run showcase:build
npm run benchmark:validation
npm pack --dry-run
```

Then recreate the exact `0.5.0` tarball and repeat the existing external
strict-TypeScript/Vite smoke test described in the umbrella plan.

Record:

- source commit and tree;
- production PNG SHA-256;
- tarball filename, size, integrity, and entry count;
- test counts;
- package/root-import smoke result;
- confirmation that no external reference bitmap entered the tarball.

Merge, tag, and npm publication still require explicit user approval.

## Expected file changes

Primary:

```text
src/character/humanoid/pose.ts                       # new internal pose evaluator
src/character/humanoid/draw.ts                       # explicit depth rendering
src/character/humanoid/state.ts                      # blend semantics if needed
src/character/humanoid/constants.ts                  # measured internal targets
src/tests/character-humanoid.test.ts                 # structural and sweep tests
benchmarks/_scripts/humanoid-validation-render.ts    # named-pose evidence
benchmarks/_scripts/humanoid-reference-study-render.ts
benchmarks/character-body-plans/humanoid-production.png
benchmarks/character-body-plans/humanoid-reference-study.png
benchmarks/character-body-plans/README.md
docs/research/humanoid-platformer-visual-reference.md
```

Administrative:

```text
docs/design/character-body-plans-decision.md
docs/design/character-enemy-validation-release-candidate.md
docs/design/post-0.4-character-enemy-validation-plan.md
```

Files outside this list require an explicit reason in the implementation
handoff.

## Risks and controls

| Risk | Control |
|---|---|
| Copying a reference instead of learning from it | Store measurements and original diagrams, not external raster frames |
| “Free” mistaken for a redistribution licence | Keep the Warrior external until exact terms are confirmed |
| Passing tests while still looking wrong | Separate automated geometry gates from an explicit human visual gate |
| Fixing idle but breaking motion | Review idle before locomotion, then test every named phase and dense phase sweeps |
| Near/far roles flip during mirroring | Keep depth roles semantic and mirror only the final canonical screen transform |
| Seed variation creates malformed anatomy | Sweep at least 100 seeds and all head styles |
| Landing remains a whole-body translation | Require knee, pelvis, and foot geometry differences |
| Duplicate prototype and production drift | Revise production only; keep the rejected prototype as historical evidence |
| Visual work changes the public API | Lock the public contract and stop for a separate decision if it must change |
| Regressing the already-passing charger/package work | Repeat the full candidate and external smoke gates after approval |

## Definition of done

This work is complete only when:

1. Godot and Warrior frames have recorded normalized measurements.
2. The implementation uses an internal complete-pose evaluator with explicit
   near/far roles.
3. Idle, named gait phases, airborne phases, and landing pass geometry tests.
4. Seed, phase, facing, gravity, scale, and target sweeps pass.
5. The new production and reference-study sheets are byte-deterministic.
6. The visual checklist receives an explicit `APPROVED` verdict.
7. Research, decision, benchmark, and release-candidate documents agree.
8. Full library, showcase, distribution, pack, and external-consumer gates
   pass against the revised tree.
9. The package contains no external reference sprite or new runtime dependency.
10. Merge, tag, and publication remain unperformed until separately approved.
