# Character Body-Plan Validation Decision

> Date: 2026-07-29  
> Status: **APPROVED — Promote humanoid prototype**  
> Published baseline: `72ef6c62d14f8eef1be94c20c2093a5b5cba97af`  
> Development base: `6d4906624dac359f186fcbc583af96e8e9ffd66e`

## Decision

Promote the visual-only humanoid API and the typed body-plan registry validated
under `showcase/_prototype/character-enemy-validation/`.

The production surface is:

- `CharacterBodyFrame` and `CharacterDrawOptions`
- `BodyPlanHandler<TConfig, TState, TMotion>`
- `createBodyPlanRegistry`, with a typed `'humanoid'` built-in and typed custom
  registration
- `HumanoidConfig`, `HumanoidVisualState`, and `HumanoidMotionSample`
- `DEFAULT_HUMANOID`
- `deriveHumanoidConfig`
- `createHumanoidVisualState`
- `advanceHumanoidVisual`
- `drawHumanoid`

`HumanoidConfig` remains immutable and is passed explicitly to advancement and
drawing. `HumanoidVisualState` owns only presentation state. World position,
velocity, collision, support, gravity, and jump remain consumer/platformer
authority; `src/character/` does not import from `src/platformer/`.

## Evidence and review

Research inputs:

- `docs/research/character-body-plans.md`
- `docs/design/character-body-plans-proposal.md`

Benchmark:

- `benchmarks/character-body-plans/humanoid-prototype.png`

Visual review found:

- The narrow articulated silhouette is clearly distinct from the rounded
  slime-knight reference.
- Three seeds preserve the same body topology while varying proportions,
  head treatment, gait, and palette.
- Left-facing displacement advances in local space without moonwalking.
- Idle frames plant rather than time-advance the feet.
- Ascent, apex, descent, arm-target, grayscale, and small-scale examples remain
  recognizable.

Architecture verdict: **APPROVED**.

- Strict TypeScript preserves concrete built-in and custom handler types.
- Unknown string lookup returns a safely erased handler that cannot be invoked
  with arbitrary config/state values without consumer narrowing.
- The only type assertion is inside registry construction; no consumer cast is
  required.
- Visual state contains no `x`, `y`, `vx`, `vy`, `JumpState`, or config copy.
- Advancement uses `advanceLocomotionByDisplacement`; it does not import
  `advanceJump` or time-driven `advanceLocomotion`.
- Config, state, and motion inputs are not mutated.
- Benchmark renders are byte-deterministic.

## Alternatives

- A closed discriminated-union dispatcher was rejected because each future body
  plan has different config, state, and motion topology.
- Direct humanoid exports without a registry remain viable but were not chosen:
  the registry spike preserved useful type information without weakening direct
  use.
- A common index-signature config/state base was rejected because it forces
  unrelated plan types into fake structural shapes.

## Deferred scope

Slime migration, floater, serpentine, quadruped, and biomechanical variants are
not part of `0.5.0`. Adding a second body plan must revalidate the heterogeneous
registry assumptions.

## Migration and production requirements

This is additive. Existing consumers do not change. Production must preserve
the validated signatures, root exports, explicit-config ownership, deterministic
seed order, benchmark appearance, and the platformer layer boundary.
