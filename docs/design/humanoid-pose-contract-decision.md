# Decision: Internal `pose.ts` Contract (Phase H1.5)

> Date: 2026-07-29
> Status: **APPROVED — ready for implementation**
> Supersedes: none (new internal seam)
> Author: Engine Lead (orchestrator), on proposal + two architect passes
> Blocks: Phase H2 (`src/character/humanoid/pose.ts` implementation)

## Decision

Adopt **Alternative B — Layered Limb Composition** from
`docs/design/humanoid-pose-contract-proposal.md`.

The internal pose evaluator lives at `src/character/humanoid/pose.ts` and exposes:

```ts
composePose(
  state: HumanoidVisualState,
  config: HumanoidConfig,
  localArmTarget?: Readonly<Vec2>,
): PoseComposition
```

`PoseComposition` is a layered struct whose field order **is** the renderer's
depth-pass order:

```text
farLeg → farArm → torso → nearLeg → nearArm → head
```

Each limb is a `LimbChain { root, joint, end }`; `torso` is a near/far
quadrilateral; `head` carries face-direction geometry. A `gaitPhase` descriptor
(`'idle' | 'contact' | 'recoil' | 'passing' | 'highPoint' | 'oppositeContact'`)
is derived inside the evaluator.

## Decisive reason

In Approach B the struct's declaration order is the render pass order, so
`draw.ts` consumes the composition directly with no landmark-to-pass mapping
step. For the renderer — the structure's primary consumer — this is materially
cleaner than picking individual landmarks out of a flat record (Approach A), and
it makes a depth-order regression structurally loud rather than accidental.

## Inputs that drove the decision

1. **Measured baseline** — `docs/research/humanoid-platformer-visual-reference.md`
   (Phase H1). Godot MIT robot (`godotengine/godot-demo-projects`,
   `2d/platformer/player/robot.webp`, 8×8 grid of 64×64 frames) measured into
   normalized landmark + phase-to-phase range tables. Both approaches fit all 11
   required landmark classes and the three measured gaps (apex absent,
   landing-contact absent, landing-compression shallow), so fit-to-data did not
   discriminate between A and B.
2. **Proposal** — `docs/design/humanoid-pose-contract-proposal.md`. The two
   alternatives were evaluated across ergonomics, determinism clarity, runtime
   cost, consumer complexity, and fit to measured data; B won on ergonomics for
   the renderer consumer without trading away any other dimension.
3. **Architect loop 1** — `NEEDS REVISION`, 11 line-anchored objections plus
   binding rulings OQ1–OQ4 (below). Loop 1 did not contest Alternative B's core
   merit; every objection targeted proposal-doc conventions and documentation.
4. **Architect loop 2 (confirm)** — `CONFIRMED`. All 11 objections fixed, the
   determinism contradiction resolved, no new core-dimension issues.

## Binding implementation constraints (OQ1–OQ4 + conventions)

These are final; `@coder` implements to them without re-debate.

- **OQ1 — Non-nullable output.** The evaluator's output is non-nullable
  `Readonly<Vec2>` for every landmark in both the idle and motion paths.
  Nullability is confined to the research/measurement representation only.
- **OQ2 — Breathing stays in `draw.ts`.** `pose.ts` takes **no `tick`**
  parameter. Breathing is a render-time torso scale applied in `draw.ts` via
  `breathe(tick, config.breath)`. The pose blend order does not reference
  breathing.
- **OQ3 — Pre-converted local arm target.** `composePose` takes
  `localArmTarget?: Readonly<Vec2>` in canonical right-facing local space,
  origin at body root. The world→local conversion stays in `draw.ts` (already
  present at `draw.ts:242-248`). `pose.ts` must not import or couple to
  `CharacterBodyFrame` or any world-space type.
- **OQ4 — `gaitPhase` from continuous phase.** `gaitPhase` is always derived
  from `state.locomotion.phase` regardless of `idleBlend`. It is `'idle'` when
  `idleBlend > HUMANOID_IDLE_PHASE_THRESHOLD`, otherwise one of the five named
  gait phases.
- **Constants, not magic numbers.** `TWO_PI`, `HUMANOID_IDLE_PHASE_THRESHOLD`,
  and the four phase-end constants (`HUMANOID_CONTACT_PHASE_END`,
  `HUMANOID_RECOIL_PHASE_END`, `HUMANOID_PASSING_PHASE_END`,
  `HUMANOID_HIGH_POINT_PHASE_END`) live in `constants.ts`, each cited to the
  Godot phase-to-phase range table (marked `inferred` where Godot lacks a
  direct frame).
- **Naming.** `TorsoPose` uses near/far semantics
  (`topNear`/`topFar`/`bottomNear`/`bottomFar`), not left/right. `BlendWeights`
  includes `ceiling`. `HeadPose` carries no `radius` (renderer reads
  `config.headRadius`). The upper-arm root coincides with the shoulder; there is
  no separate `*UpperArm` landmark.
- **Internal only.** `pose.ts` is not re-exported from
  `src/character/humanoid/index.ts`. The frozen public API (plan decision #2)
  is unchanged.
- **Test migration.** `evaluateHumanoidLowerBodyPose` and
  `evaluateHumanoidUpperBodyPose` are removed from `draw.ts`. The imports at
  `src/tests/character-humanoid.test.ts:12-14` migrate to `composePose`
  immediately (to keep `npm test` green throughout H2–H5); the comprehensive
  H6 geometry + sweep suite is added in Phase H6.

## Scope guard for Phase H2

H2 implements **neutral idle only**. The gait, airborne, and landing blend
contributions are wired into the blend order but return idle-equivalent
geometry for now, clearly marked with `// H3` / `// H4` TODO comments. This
keeps the evaluator's shape complete and idle-correct without silently
producing wrong motion poses. **Locomotion (H3) and airborne/landing (H4) do
not begin until the H2 idle sheet passes its human visual review gate.**

## Determinism / layer invariants (carried from the anchor docs)

- Pure: no `Math.random`, no `Date.now()`, no canvas/DOM, no module-level
  mutable state, no `src/platformer/` import.
- Finite output for all defensive inputs (non-finite motion, unreachable arm
  targets, invalid `dt`).
- Configured limb lengths preserved exactly through the IK solver within a
  documented, named tolerance.
- Blend order fixed: idle → gait → airborne → targeted-arm → landing.
- Mirroring applies only to the final screen transform; near/far depth roles
  are semantic and never flip.

## Cross-references

- Plan: `docs/design/humanoid-visual-revision-plan.md` (§Implementation shape,
  §Phase H1.5, §Phase H2)
- Proposal: `docs/design/humanoid-pose-contract-proposal.md`
- Measured baseline: `docs/research/humanoid-platformer-visual-reference.md`
- Anchor: `docs/architecture.md`, `docs/conventions.md`
