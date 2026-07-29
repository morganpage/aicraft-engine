# Plan: Post-0.4 Character and Enemy Variety Validation

> Date: 2026-07-27
> Revised: 2026-07-28
> Status: ready for implementation
> Baseline: `aicraft-engine@0.4.0` — **published on npm**
> Development base: `6d4906624dac359f186fcbc583af96e8e9ffd66e`
> Candidate release: `aicraft-engine@0.5.0`
> Initial validation scope: humanoid player body plan + charger enemy archetype

> Follow-up: the candidate passed architecture, package, and external-consumer
> gates but requires humanoid visual revision. The remaining work is owned by
> `docs/design/humanoid-visual-revision-plan.md`; completed phases in this
> umbrella plan remain historical evidence.

## Purpose

Validate a reusable procedural-character abstraction and one behaviorally distinct
enemy before committing to the complete character and enemy catalog.

The initial implementation will test:

1. Whether a humanoid body plan can reuse the existing locomotion, IK, jump,
   palette, and seeded-generation systems.
2. Whether a charger enemy can extend the existing enemy registry without adding
   a combat kernel or breaking current archetypes.
3. Whether the proposed registry APIs compile cleanly under strict TypeScript.
4. Whether the resulting characters are visually legible and meaningfully
   different from the existing slime-knight, spinny, turret, and spider.
5. Whether the additions are suitable for a separate `0.5.0` release.

## Background

Research and API proposals already exist:

- `docs/research/character-body-plans.md`
- `docs/research/enemy-archetype-catalog.md`
- `docs/design/character-body-plans-proposal.md`
- `docs/design/enemy-archetype-catalog-proposal.md`
- `docs/design/character-enemy-variety-roadmap.md`

Research ranked the following highest:

- Player body plan: humanoid biped
- Enemy archetype: charger

The user selected a narrow validation strategy:

- Prototype the top-ranked body plan and enemy.
- Benchmark both.
- Review the visual and API results.
- Expand only if validation succeeds.

## Current Baseline

`aicraft-engine@0.4.0` is **published on npm**.

- npm registry: `aicraft-engine@0.4.0`
- tarball: `https://registry.npmjs.org/aicraft-engine/-/aicraft-engine-0.4.0.tgz`
- tarball integrity:
  `sha512-6KQdIcW0mPoAVu1QjQbqP5OJGTm1EVYas34S/RBdPNioCZoIw8eL8MsY2TWt8Rfa1adlzUzX1hBBS8tZxGepeg==`
- published modified time: `2026-07-27T14:33:46.189Z`
- published prompt-alignment baseline commit (`main` HEAD when the original plan
  was created):
  `72ef6c62d14f8eef1be94c20c2093a5b5cba97af`
  ("Switch game prompt pins to aicraft-engine@0.4.0 (registry verified)")
- engine release commit (the actual 0.4.0 code + version bump):
  `8517bb8d1637898b6289cdbecdf855b3718607c7`
  ("Release 0.4.0: signed gravity, fixed-step music, NoteFirePlayer,
  unified compileLevel")

The 0.4.0 implementation includes:

- Signed platformer gravity.
- Gravity-relative support contact.
- Correct fixed-step music advancement.
- `createNoteFirePlayer`.
- Tile-aware level compilation (`compileLevel` with tile classifier).
- Game prompt alignment with the root npm API (`games/*.md` pinned to
  `aicraft-engine@0.4.0`).

Because the baseline is committed and published, no further release work may
rewrite the `0.4.0` artifact. Character/enemy work must land on the
`codex/character-enemy-validation` branch created from a clean, recorded
development-base commit (see Phase 0.5), not as direct feature commits on
`main`.

## Release Boundary

Character and enemy variety work is not part of `0.4.0`.

The new work is a separate candidate release:

```text
0.4.0
└── signed gravity, music, level compilation, prompt alignment

0.5.0 candidate
└── validated humanoid body plan and charger archetype
```

Publication is not part of this plan. Publishing requires explicit user
approval after all gates pass.

### Reproducibility contract

`aicraft-engine@0.4.0` is committed and published on npm. Two SHAs are tracked:

- **Published baseline SHA** — the source commit corresponding to the immutable
  `0.4.0` release (`72ef6c62d14f8eef1be94c20c2093a5b5cba97af`).
- **Development-base SHA** — the clean `main` commit from which the 0.5.0 worktree
  is actually created. It must descend from the published baseline and include
  any later committed work that is intended to ship in `0.5.0`.

The 0.5.0 candidate must retain the published baseline in its ancestry, record
the development-base SHA, and end with synchronized package metadata.

1. Phase 0 verification (already COMPLETE) confirmed the published 0.4.0
   baseline is green.
2. Phase 0.5 records both the published baseline SHA and the development-base
   SHA. Decision documents do not exist until Phase 11; both SHAs are copied
   into them at that point.
3. Create a separate clean worktree for
   `codex/character-enemy-validation` from the recorded development-base SHA.
   Uncommitted files from the original worktree must not be carried into it.
   All prototype and production work lands on that branch. Do not make direct
   0.5.0 feature commits on `main`.
4. Keep `package.json` and `package-lock.json` at `0.4.0` for the entire
   prototype phase. The tarball packed during prototype iteration must report
   `0.4.0`.
5. Only after Phase 10 returns `APPROVED` and Phase 11 records `Promote`, run:
   ```bash
   npm version 0.5.0 --no-git-tag-version
   ```
   This updates both `package.json` and `package-lock.json` root metadata.
6. The production + pack gates (Phase 16) must assert the packed tarball
   reports `0.5.0`.
7. After Phase 17 passes, Phase 17.5 records the exact release-candidate commit
   and packed-artifact metadata. The candidate must be integrated into `main`
   before publication; if integration changes the candidate tree, all Phase 16
   and Phase 17 gates repeat.
8. Do not merge, `git tag`, or `npm publish` without the explicit approval
   required by Phase 17.5.

## Decisions Already Made

1. Start with one body plan and one enemy archetype.
2. Use procedural Canvas2D rendering; do not introduce raster sprite sheets.
3. Preserve deterministic simulation.
4. Reuse existing animation and collision primitives.
5. Keep combat, health, damage, knockback, and i-frames out of scope.
6. Benchmark visual output before adopting the public API.
7. Expose npm APIs through the root barrel only.
8. Do not expand to the full roster until the two prototypes pass review.
9. **`tsx@4.23.1` is approved as a pinned exact devDependency** for running
   benchmark render scripts. Recorded by user direction on 2026-07-27. This is
   an exception to `.opencode/instructions/tech-stack.md` ("Nothing else
   without explicit approval"). It is a devDependency only; no runtime
   dependency is added. Installation and scripts are specified in Phase 8.

## Proposal Corrections Required

Before implementation, revise the existing proposal documents.

### Root-only npm imports

The package exports only `"."`. Public npm examples must use:

```ts
import {
  chargerBehavior,
  CHARGER_HEIGHT,
  CHARGER_WIDTH,
  checkLineOfSight,
  createBodyPlanRegistry,
} from 'aicraft-engine';
```

Do not use:

```ts
import { chargerBehavior } from 'aicraft-engine/src/platformer/enemy/archetypes/charger';
```

Relative source imports remain valid only for git-submodule consumers and
internal repository code.

### Invalid module augmentation

Remove the claim that consumers can augment the `EnemyArchetype` type alias.

Type aliases cannot be extended through interface module augmentation.
Runtime extensibility already exists through:

```ts
interface EnemyProps {
  readonly archetype: string;
}
```

Custom handlers therefore remain supported without an augmentable union.

### Body-plan registry typing

The generic registry design must be proven with compiling strict-TypeScript
code before adoption.

The spike must test:

- Concrete `HumanoidConfig` and `HumanoidVisualState`.
- Assignability of a specialized handler to registry storage.
- Typed retrieval of built-in handlers.
- Custom handler registration.
- No unsafe consumer-facing casts.
- No requirement for configuration interfaces to expose arbitrary index
  signatures.

If the registry cannot preserve useful type safety without awkward erasure,
Phase 1 will ship direct humanoid exports and defer the generic registry until a
second production body plan exists.

### Renderer extensibility

The enemy proposal currently claims that consumers can extend an internal
`DRAW_REGISTRY`, but does not expose registration.

The validation must choose one honest contract:

1. Keep rendering internal and only claim built-in rendering.
2. Add an explicit custom renderer input or renderer-registry factory.
3. Preserve the existing unknown-archetype fallback and defer custom drawing
   registration.

For the charger-only release, option 1 or 3 is preferred unless a real consumer
need materializes.

### LOS placement

Place general tile line-of-sight logic in:

`src/collision/los.ts`

It may be re-exported from the platformer enemy barrel for discoverability, but
collision owns the primitive.

### API-surface scope

`docs/api-surface.md` currently pre-describes the full roster.

During validation it must distinguish:

- Humanoid and charger: active validation candidates.
- Floater, serpentine, chaser, burster, flyer, crawler: deferred research
  candidates.
- Slime migration: deferred unless needed to validate registry compatibility.

## Scope

### In Scope

- Strict-TypeScript body-plan API spike.
- Deterministic humanoid config, stepping, and rendering.
- Deterministic LOS helper.
- Charger behavior and rendering.
- Prototype tests.
- Visual benchmark sheets.
- Architecture and visual review.
- Decision documents.
- Production implementation only after approval.
- Root-barrel and package smoke tests.
- Documentation for APIs that actually ship.

### Out of Scope

- Floater body plan.
- Serpentine body plan.
- Quadruped or biomechanical body plans.
- Slime-knight migration unless required by validation.
- Chaser, burster, flyer, crawler, shielder, swarmer, or caster.
- General telegraph framework.
- Projectile lifetime.
- Plural projectile results.
- Health and damage systems.
- Knockback and i-frames.
- Enemy-on-enemy collision.
- Runtime dependencies.
- Npm subpath exports.
- Publication.

## Canonical Verification Matrix

Several phases run the same gate set. To avoid drift, the canonical command
list lives here and is referenced by later phases.

```bash
npm test                  # library unit tests (vitest run)
npm run build             # library typecheck gate (tsc --noEmit)
npm run build:dist        # produce dist/ for the npm tarball
npm run showcase:typecheck
npm run showcase:test
npm run showcase:build
npm pack --dry-run        # inspect tarball contents without writing it
```

The prospective tarball name reported by the dry-run and the root package
version must equal the candidate release version recorded in `package.json`
(0.4.0 during prototype; 0.5.0 after the version bump in Phase 11). Phase 16
then creates the exact artifact with `npm pack --json`.

## Canonical Root-Import Contract

All npm examples and external smoke tests import only from the package root:

```ts
import {
  chargerBehavior,
  CHARGER_HEIGHT,
  CHARGER_WIDTH,
  checkLineOfSight,
  createEnemyBehaviorRegistry,
  deriveHumanoidConfig,
  createHumanoidVisualState,
  advanceHumanoidVisual,
  drawHumanoid,
  // and, only if the registry spike passes:
  createBodyPlanRegistry,
} from 'aicraft-engine';
```

Subpath imports (`aicraft-engine/src/...`) are forbidden in npm examples. They
remain valid only for git-submodule consumers and internal repository code.
Later phases reference this contract instead of repeating the import block.

## Phase 0: Verify the 0.4 Baseline

> Status: **COMPLETE** (user-confirmed, 2026-07-27).
>
> Evidence:
> - 2,280 engine tests pass.
> - 168 showcase tests pass.
> - Library `tsc --noEmit` typecheck passes.
> - Showcase typecheck passes.
> - Distribution build (`npm run build:dist`) passes.
> - Package inspection (`npm pack --dry-run`) passes.
> - External Vite TypeScript smoke project builds against the packed tarball.
> - **`aicraft-engine@0.4.0` is published on npm** (registry-verified).
>
> Baseline is committed on `main` at
> `72ef6c62d14f8eef1be94c20c2093a5b5cba97af`.

Run the [Canonical Verification Matrix](#canonical-verification-matrix) through
`npm run showcase:build` (skip `npm pack --dry-run` here — there is no new code
to inspect yet).

Record any failures before beginning new work.

Do not attribute pre-existing failures to the character/enemy work. Do not
revert unrelated changes.

Success criteria:

- Existing tests pass.
- Library typecheck passes.
- Distribution build passes.
- Showcase typecheck and tests pass.
- Existing platformer and enemy behavior remains unchanged.

## Phase 0.5: Record Release and Development Bases; Create a Clean Worktree

> Status: **COMPLETE** (2026-07-29).
>
> Recorded evidence:
> - Published integrity:
>   `sha512-6KQdIcW0mPoAVu1QjQbqP5OJGTm1EVYas34S/RBdPNioCZoIw8eL8MsY2TWt8Rfa1adlzUzX1hBBS8tZxGepeg==`
> - Downloaded registry artifact: `aicraft-engine-0.4.0.tgz`, 423,620 bytes,
>   SHA-1 `ce9541fb8d619473e65226920fcca3afe87db2a1`, 343 entries.
> - Published baseline SHA:
>   `72ef6c62d14f8eef1be94c20c2093a5b5cba97af`
> - Development-base SHA:
>   `6d4906624dac359f186fcbc583af96e8e9ffd66e`
> - The ancestry check from the published baseline to the development base
>   passed.
> - Clean development worktree:
>   `/Users/morganpage/Documents/VSCODE/OPENCODE/aicraft-engine-character-enemy-validation`
> - Development-base verification: 2,777 engine tests and 199 showcase tests
>   passed; library typecheck, distribution build, showcase typecheck, showcase
>   build, and `npm pack --dry-run` all passed with package metadata at `0.4.0`.

The 0.4.0 baseline is already committed and published — no user approval is
needed to "commit the baseline" (that step from earlier revisions is obsolete).
This phase authenticates the published artifact, records the clean integration
base for 0.5.0, and creates an isolated worktree.

1. Authenticate the published package itself:

   ```bash
   npm view aicraft-engine@0.4.0 dist.integrity
   npm pack aicraft-engine@0.4.0 --json --pack-destination <temporary-directory>
   ```

   The `integrity` reported by `npm pack --json` for the downloaded registry
   artifact must equal:

   > `sha512-6KQdIcW0mPoAVu1QjQbqP5OJGTm1EVYas34S/RBdPNioCZoIw8eL8MsY2TWt8Rfa1adlzUzX1hBBS8tZxGepeg==`

   `npm pack --dry-run` is not an integrity comparison. It is used later to
   inspect a local candidate's prospective contents. Registry integrity
   authenticates the downloaded published tarball; a separate manifest and
   declaration comparison establishes whether local source reproduces its
   contents.

2. Record the immutable release source:

   > **Published baseline SHA:**
   > `72ef6c62d14f8eef1be94c20c2093a5b5cba97af`
   >
   > Commit: "Switch game prompt pins to aicraft-engine@0.4.0 (registry
   > verified)"
   >
   > Engine release commit (immediate parent in the 0.4.0 release pair):
   > `8517bb8d1637898b6289cdbecdf855b3718607c7`

3. Prepare the development base:

   - This plan and any documentation required to execute it must already be
     committed, or must be applied later as an explicit, reviewable commit.
   - Do not infer a development base from a dirty working tree.
   - Decide which later committed `main` work belongs in `0.5.0`. The default is
     to include all committed `main` work rather than silently releasing an
     older tree under a newer version.
   - Record:

     ```bash
     git status --short
     git rev-parse main
     git merge-base --is-ancestor 72ef6c62d14f8eef1be94c20c2093a5b5cba97af <development-base-sha>
     ```

   The ancestry check must exit zero. Record the resulting value:

   > **Development-base SHA:** `<record at execution time>`

4. Create an isolated worktree from that exact commit:

   ```bash
   git worktree add \
     -b codex/character-enemy-validation \
     ../aicraft-engine-character-enemy-validation \
     <development-base-sha>
   ```

   The new worktree must report a clean `git status --short` before prototype
   files are created. Existing modified or untracked files in the original
   worktree remain there and cannot leak into the candidate.

5. Before adding prototype files, run the full
   [Canonical Verification Matrix](#canonical-verification-matrix) in the new
   worktree and record the development-base results separately from the
   historical 0.4.0 evidence. Its package metadata must still report `0.4.0`.
   Any failure at this point is a development-base failure, not a
   character/enemy regression.

6. All prototype and production work lands on
   `codex/character-enemy-validation`. Do not make direct feature commits on
   `main`. If `main` advances during development, Phase 17.5 determines whether
   synchronization is required and repeats the release gates after any changed
   integration tree.

7. Neither SHA is recorded in a decision document yet. Decision documents do
   not exist until Phase 11; both SHAs are copied into them when created.

If published integrity, the downloaded manifest, or the published declarations
disagree with the recorded 0.4.0 evidence, stop and investigate before creating
the candidate worktree. The downloaded registry tarball is the source of truth
for what `aicraft-engine@0.4.0` contains.

## Phase 1: Reconcile Documentation

Update:

- `docs/design/character-body-plans-proposal.md`
- `docs/design/enemy-archetype-catalog-proposal.md`
- `docs/design/character-enemy-variety-roadmap.md`
- `docs/api-surface.md`

Required corrections:

1. Add an explicit humanoid-plus-charger validation gate.
2. Note that prior proposal critiques are **historical inputs only**. The
   humanoid/charger prototype and production direction remain **unapproved**
   until Phase 10 returns `APPROVED`. Do not record an approved verdict here.
3. Replace invalid npm subpath examples.
4. Remove module-augmentation claims.
5. Describe the registry typing risk.
6. Stop claiming unimplemented renderer extensibility.
7. Narrow active API-surface entries.
8. Update the roadmap's stale discriminated-union API hypothesis.
9. Preserve deferred candidates as research, not committed exports.
10. Use palette fields or named palette constants instead of raw inline colors.
11. Remove `advanceJump` / `JumpState` from any humanoid requirements; the
    platformer kernel remains the sole authority for vertical physics.
12. Replace any `advanceLocomotion` reference in humanoid requirements with
    `advanceLocomotionByDisplacement` (displacement-driven gait to prevent
    foot-slide).
13. Rename old humanoid API names to the authoritative visual-only set:
    - `HumanoidFrameState` → `HumanoidVisualState`
    - `createHumanoidFrameState` → `createHumanoidVisualState`
    - `stepHumanoid` → `advanceHumanoidVisual`
    - `HumanoidInputs` → `HumanoidMotionSample` (consumer-built from
      `PlatformerState.core` + `events`; includes `supported`,
      `gravityDirection`, `verticalVelocity`)
    - `advanceHumanoidVisual` signature: now
      `(config, state, motion, dt)`.
    - `drawHumanoid` signature: now
      `(ctx, body: CharacterBodyFrame, config, state, tick, options?)`.
14. Update `BodyPlanHandler.advanceVisual` and `BodyPlanHandler.draw` to receive
    the immutable plan config explicitly. `draw` also takes
    `CharacterBodyFrame` plus optional `CharacterDrawOptions` (the old
    `look?: Vec2` argument becomes `options?.lookTarget`). Static seed-derived
    proportions, palette, and gait configuration must not be copied into the
    mutable visual-state topology merely to make them reachable.
15. Define `CharacterBodyFrame` and `CharacterDrawOptions` in
    `src/character/types.ts`. The character module never imports from
    `src/platformer/`; `ActorCore` is structurally assignable to
    `CharacterBodyFrame` so consumers pass it directly.
16. Define `HumanoidMotionSample` in `src/character/humanoid/types.ts`.

## Phase 2: Prototype Location

Prototypes must not enter the npm distribution.

Use:

```text
showcase/_prototype/character-enemy-validation/
├── body-plan-types.ts
├── body-plan-registry.ts
├── humanoid-config.ts
├── humanoid-state.ts
├── humanoid-draw.ts
├── charger-behavior.ts
├── charger-draw.ts
├── los.ts                       # prototype copy; src/collision/los.ts is created only after Promote
├── scene.ts
└── constants.ts
```

Why:

- `tsconfig.build.json` compiles all files under `src`.
- Putting temporary prototypes under `src/_prototype/` would emit them into
  `dist`.
- `showcase/_prototype/` is excluded from the npm package.
- Showcase strict TypeScript still validates the prototype.
- The LOS primitive lives here during prototype. **Only after Phase 11 records
  Promote is `src/collision/los.ts` created.** No prototype LOS file ever
  enters `src/`.

Prototype tests will live under `showcase/tests/`.

## Phase 3: Body-Plan API Spike

Test the recommended registry abstraction before building detailed visuals.

### Required concepts

```ts
// src/character/types.ts (production) — reproduced in prototype during spike.
export interface CharacterBodyFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly facing: 1 | -1;
}

export interface CharacterDrawOptions {
  /** Optional eye/arm-IK look target in world space. */
  readonly lookTarget?: Readonly<Vec2>;
}

export interface BodyPlanHandler<
  TConfig,
  TState,
  TMotion,
> {
  deriveConfig(seed: number): TConfig;
  createVisualState(config: TConfig): TState;
  advanceVisual(
    config: TConfig,
    state: TState,
    motion: TMotion,
    dt: number,
  ): TState;
  draw(
    ctx: CanvasRenderingContext2D,
    body: CharacterBodyFrame,
    config: TConfig,
    state: TState,
    tick: number,
    options?: CharacterDrawOptions,
  ): void;
}
```

`ActorCore` from `src/platformer/types.ts` is structurally assignable to
`CharacterBodyFrame` (`x`, `y`, `width`, `height`, `facing`), so consumers
pass `platformerState.core` directly. **The character module never imports
from `src/platformer/`** — this prevents a layer inversion while keeping
consumer ergonomics.

The old `draw(ctx, state, tick, look?: Vec2)` signature migrates to
`draw(ctx, body, config, state, tick, options?: CharacterDrawOptions)`. The old
`look` argument becomes `options?.lookTarget`. Arm targeting remains part of
the motion sample (`TMotion`) because it drives pose state, not just rendering.

`TConfig` is intentionally explicit in both `advanceVisual` and `draw`.
`HumanoidConfig` contains static seed-derived proportions, palette, solver
bounds, and gait configuration. `HumanoidVisualState` contains only evolving
visual state. Neither layer silently duplicates the other.

The exact registry representation remains undecided until the spike compiles.

### Approaches to validate

1. Generic keyed handler map preserving handler types.
2. Internal type erasure with safe public typed access.
3. Direct per-plan exports without a registry.

### Selection criteria

- Strict TypeScript passes.
- Built-in retrieval preserves concrete config and state types.
- Custom registration is possible.
- No unsafe casts leak to consumers.
- No common fake `CharacterState` is required.
- The API remains understandable for consumers using only one plan.
- Adding another body plan does not require breaking existing types.

### Registry fallback

If the registry does not satisfy these criteria, ship:

```ts
deriveHumanoidConfig
createHumanoidVisualState
advanceHumanoidVisual
drawHumanoid
```

with the following authoritative signatures:

```ts
advanceHumanoidVisual(config, state, motion, dt): HumanoidVisualState
drawHumanoid(ctx, body, config, state, tick, options?): void
```

and defer `createBodyPlanRegistry`.

## Phase 4: Humanoid Prototype

### Movement ownership contract (locked)

The platformer kernel remains the sole authority for:

- world position (`x`, `y`)
- velocity (`vx`, `vy`)
- collision resolution
- grounding (`onGround`)
- jump state (`JumpState`, `JumpAbilityState`)
- vertical integration (`vy += gravity * dt`)

The humanoid module **must not**:

- import or call `advanceJump`
- hold a `JumpState`
- store an authoritative `x`, `y`, or vertical offset
- apply gravity, launch velocity, or knockback

The humanoid module **only** owns visual state:

- locomotion phase
- idle blend
- arm-swing phase
- optional arm IK target / spring state
- renderer-cached pose output

The consumer wires the humanoid to the platformer kernel as follows:

```ts
// Kernel owns physics + jump. Humanoid only consumes the result.
const previous = platformerState;
const result = stepPlatformer(previous, input, solids, dt, config);
platformerState = result.state;

const gravityDirection: 1 | -1 = config.gravity < 0 ? -1 : 1;

const motion: HumanoidMotionSample = {
  dx: platformerState.core.x - previous.core.x,
  facing: platformerState.core.facing,
  supported: platformerState.core.onGround,
  gravityDirection,
  verticalVelocity: platformerState.core.vy,
  justLaunched: platformerState.events.justLaunched,
  justLanded: platformerState.events.justLanded,
  hitCeiling: platformerState.events.hitCeiling,
  // armTarget is optional and consumer-supplied (e.g. mouse aim).
};

humanoidVisual = advanceHumanoidVisual(
  humanoidConfig,
  humanoidVisual,
  motion,
  dt,
);

// At render time, the world position comes from ActorCore, not from
// humanoidVisual. ActorCore is structurally assignable to CharacterBodyFrame.
drawHumanoid(
  ctx,
  platformerState.core,
  humanoidConfig,
  humanoidVisual,
  tick,
);
```

The locked `HumanoidMotionSample` shape:

```ts
export interface HumanoidMotionSample {
  /** Horizontal displacement this tick, world space (signed). */
  readonly dx: number;
  /** Body facing direction. */
  readonly facing: 1 | -1;
  /** `true` when the actor is supported opposite the current gravity direction. */
  readonly supported: boolean;
  /** Current gravity sign — drives ascent/descent pose orientation. */
  readonly gravityDirection: 1 | -1;
  /** Raw vertical velocity from `core.vy` (px/s, +Y is down). */
  readonly verticalVelocity: number;
  /** Single-tick launch pulse from `events.justLaunched`. */
  readonly justLaunched: boolean;
  /** Single-tick landing pulse from `events.justLanded`. */
  readonly justLanded: boolean;
  /** Single-tick ceiling-contact pulse from `events.hitCeiling`. */
  readonly hitCeiling: boolean;
  /** Optional world-space arm IK target (e.g. mouse aim). */
  readonly armTarget?: Readonly<Vec2>;
}
```

### Ascent / descent orientation under signed gravity

To keep animation correct under both positive and negative gravity, the
humanoid derives a **support-relative** vertical velocity:

```ts
const relativeVertical = motion.verticalVelocity * motion.gravityDirection;
```

- `relativeVertical < 0` → moving away from support → **ascent** pose.
- `relativeVertical > 0` → moving toward support → **descent** pose.
- `relativeVertical === 0` → apex / rest pose.

This keeps the animation consistent whether the actor is supported on a floor
(positive gravity) or supported on a ceiling (negative gravity), without
duplicating physics in the humanoid module.

Locomotion advances only through displacement, never time:

```ts
// Supported: advance phase by local-space displacement.
// Unsupported (airborne): freeze phase (dx-driven gait plants the feet).
const dxLocal = motion.supported ? motion.dx * motion.facing : 0;
state.locomotion = advanceLocomotionByDisplacement(
  state.locomotion,
  dxLocal,
  config.gait,
);
```

`advanceLocomotion` (time-driven) is **not** used anywhere in the humanoid
module. `advanceJump` is **not** imported.

### Silhouette

The humanoid must have:

- Head.
- Torso.
- Two arms.
- Two legs.
- Clear facing direction.
- Distinct silhouette from the slime-knight.
- Readable proportions at platformer scale.

### Existing primitives to reuse

- `mulberry32`
- `generatePalette`
- `evaluateLocomotion`
- `advanceLocomotionByDisplacement` (never `advanceLocomotion`)
- `solveLimb`
- `breathe`
- Existing rig and transform helpers where appropriate

Note: `advanceJump` is intentionally absent. Vertical motion is sampled from
`PlatformerState.core.vy` and `PlatformerState.events` via the
`HumanoidMotionSample`. The humanoid never advances its own jump trajectory.

### Seeded configuration

A numeric seed may affect:

- Head-to-body ratio.
- Shoulder width.
- Torso width and height.
- Limb lengths within safe solver bounds.
- Helmet or head silhouette.
- Eye placement.
- Palette.
- Accent placement.

A seed must not affect:

- Number of limbs.
- Required state fields.
- Collision size unpredictably.
- RNG consumption order after release.

### Animation states

Prototype:

- Idle.
- Walk left.
- Walk right.
- Jump ascent.
- Jump apex.
- Jump descent.
- Optional arm target.

### Arm behavior

Default walking uses passive counter-swing:

- Left arm opposes left leg.
- Right arm opposes right leg.
- Arm phase derives from locomotion phase.
- No separate random phase.

An optional target override may use arm IK for aiming or pointing.

### Humanoid acceptance criteria

- No moonwalking.
- Feet remain planted at locomotion stop.
- Limbs do not snap between adjacent frames.
- Arms do not intersect the torso excessively.
- Three seeds remain recognizably humanoid but visibly distinct.
- Same seed and state produce identical output.
- Rendering does not mutate state.
- State stepping does not mutate input.

## Phase 5: LOS Primitive Prototype

Implement a pure supercover grid traversal. **During prototype**, the file
lives at `showcase/_prototype/character-enemy-validation/los.ts`. **Only after
Phase 11 records Promote** is `src/collision/los.ts` created. No prototype LOS
file ever enters `src/`.

Proposed signature:

```ts
export function checkLineOfSight(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  tileQuery: TileSolidityQuery,
  tileSize: number,
): boolean;
```

### Locked semantics

- The algorithm is supercover (visits every tile the segment passes through).
- Only `'solid'` tiles block visibility.
- `'empty'` and `'passthrough'` are transparent.
- Start and end tiles are queried.
- When start and end fall in the same tile, that tile is queried exactly once.
- Every visited coordinate is queried at most once per call (enforced by a
  local visited set).
- At exact grid-corner crossings, the traversal visits **both** orthogonal
  neighbors **and** the diagonal before continuing. If any of those is solid,
  diagonal peeking is blocked.
- Traversal is endpoint-reversible: swapping `(start, end)` returns the same
  boolean for the same query.
- No `Math.random`, no `Date.now`, no DOM reads, no allocation-heavy closures.

### Corner-tie epsilon

Exact corner ties use a relative epsilon to avoid IEEE 754 brittleness:

```ts
const LOS_CORNER_EPSILON = 1e-12;

const tied =
  Math.abs(tMaxX - tMaxY) <=
  LOS_CORNER_EPSILON *
    Math.max(1, Math.abs(tMaxX), Math.abs(tMaxY));
```

`tMaxX` and `tMaxY` are the parametric distances to the next X and Y grid
boundaries. A tied value visits both neighbors and the diagonal in the same
iteration.

### Iteration caps (huge inputs / tiny tile sizes)

To bound runtime when given enormous finite worlds or very small tile sizes,
the primitive enforces both a predicted-visit cap and a runtime hard cap:

```ts
export const LOS_MAX_VISITED_TILES = 65_536;
```

Before traversal:

1. All four coordinates must be finite (`Number.isFinite`).
2. `tileSize` must be finite and strictly positive.
3. The deltas `endX - startX` and `endY - startY` must remain finite after
   subtraction.
4. The predicted start/end tile indices must be safe integers
   (`Number.isSafeInteger`).

Compute the predicted visit count and reject if it exceeds the cap:

```ts
const predictedVisits =
  1 +
  Math.abs(endTileX - startTileX) +
  Math.abs(endTileY - startTileY) +
  Math.min(
    Math.abs(endTileX - startTileX),
    Math.abs(endTileY - startTileY),
  );

if (predictedVisits > LOS_MAX_VISITED_TILES) return false;
```

A runtime counter independently enforces the same cap during traversal. If the
counter exceeds `LOS_MAX_VISITED_TILES` for any reason, return `false`
immediately without further queries.

The production module uses an internal test seam:

```ts
// Exported from the source module for repository-relative tests, but not
// re-exported from src/collision/index.ts or the package root.
checkLineOfSightWithLimits(
  /* normal arguments */,
  predictedVisitLimit,
  runtimeVisitLimit,
): boolean
```

`checkLineOfSight` delegates to this helper with
`LOS_MAX_VISITED_TILES` for both limits. Repository tests keep the predicted
limit high enough to enter traversal while injecting a small runtime limit, so
the runtime-counter branch can be exercised without fabricating behavior that
`TileSolidityQuery` cannot express. The helper is not part of the npm API.

These guards prevent pathological inputs (huge coordinates with small tile
sizes) from running effectively unbounded loops while remaining deterministic.

### Defensive behavior

- Non-finite `startX/startY/endX/endY` → return `false`.
- Non-finite or non-positive `tileSize` → return `false`.
- Any tile index outside `Number.isSafeInteger` → return `false`.
- Predicted or runtime visit count exceeds `LOS_MAX_VISITED_TILES` → return
  `false`.
- If `tileQuery` throws, swallow and return `false`.
- If `tileQuery` returns anything outside `'empty' | 'solid' | 'passthrough'`,
  treat as blocking and return `false`.
- Out-of-bounds behavior is owned by the supplied query; the LOS primitive
  does not second-guess it.
- Public function never throws.

### Required tests

- Empty path (all-air) → visible.
- Single solid tile between endpoints → blocked.
- Endpoint-occupying solid → blocked.
- Endpoint reversal produces identical result for every test case.
- Horizontal, vertical, and 45° diagonal rays behave correctly.
- Near-corner ray (within epsilon) visits both orthogonal neighbors.
- Exact-corner ray visits both orthogonals and the diagonal; any of them solid
  blocks.
- Diagonal-peek test: two orthogonally-adjacent solids at a corner block the
  diagonal ray.
- `'passthrough'` cells never block.
- Non-finite coordinates return `false`.
- `tileSize <= 0` or non-finite returns `false`.
- Tile indices outside safe-integer range return `false`.
- Predicted visits exceeding `LOS_MAX_VISITED_TILES` return `false` without
  invoking the query (verify with a counting probe).
- The internal `checkLineOfSightWithLimits` helper, given a permissive predicted
  limit and a smaller runtime limit, returns `false` immediately after exceeding
  that runtime limit and performs no later queries. Do not claim that a
  `TileSolidityQuery` can report or alter visit counts; it only returns a tile
  classification.
- Throwing `tileQuery` returns `false` and never propagates.
- Malformed `tileQuery` return value (not a `TileType`) returns `false`.
- Repeated calls with identical inputs return identical booleans.
- Each visited coordinate is queried at most once per call (use a counting
  query to verify).

## Phase 6: Charger Prototype

### Fixed dimensions (v1)

```ts
export const CHARGER_WIDTH = 16;
export const CHARGER_HEIGHT = 16;
```

- The canonical dimensions and numeric parameter-range table live in the
  dependency-neutral `src/level/enemy-schema.ts`. The charger module re-exports
  the dimensions through the enemy/root barrels. Level validation, compilation,
  editor catalog, behavior, and rendering therefore share one definition
  without making `src/level/` import the higher-level platformer module.
- Catalog rect is exactly `16 × 16`.
- Behavior and renderer read these constants.
- `validateLevel` rejects a built-in charger entity whose `rect.width` or
  `rect.height` differs from these constants. Defensive direct calls to
  `compileEnemies` skip such charger entries, preventing runtime from accepting
  a collision/rendering size that the behavior cannot represent.
- Custom charger entity dimensions are **unsupported in v1**; document this in
  JSDoc, schema errors, and the catalog entry. A dimension API is deferred.

### State phases

```text
patrol → windup → dash → recovery → patrol
```

### Parameter ranges and defaults

| Parameter | Valid range | Default |
|---|---:|---:|
| `speed` | `[0, 1024]` px/s | `40` |
| `dashSpeed` | `(0, 4096]` px/s | `300` |
| `windupDuration` | `[0, 60]` s | `0.5` |
| `recoveryDuration` | `[0, 60]` s | `0.8` |
| `dashMaxDistance` | `[0, 65536]` px | `128` |
| `detectionRadius` | `[0, 65536]` px | `160` |
| `verticalTolerance` | `[0, 4096]` px | `12` |
| `ledgeTurnAround` | `boolean` | `true` |

Non-finite or out-of-range values use the named default rather than clamping.
This matches the existing pattern in `spinnyBehavior` and `turretBehavior`.

### Locked tick semantics

1. **Invalid dt or movement product.** If `dt` is non-finite or `<= 0`, return a
   fresh state-equivalent result. Do not query the player, query tiles, move, or
   decrement any timer. Before patrol or dash movement, compute the requested
   distance immediately after resolving params/phase and before any external
   player, tile, or solid query for that phase; require it to remain finite
   after multiplication. A non-finite product also returns a fresh
   state-equivalent result without queries or partial movement. Movement is a
   bounded `O(ctx.solids.length)` horizontal sweep, never a loop whose iteration
   count scales with `dt`, world distance, or `tileSize`.
2. **Malformed data.** If `state.data.phase` is not one of
   `patrol | windup | dash | recovery`, initialize to `patrol` (other fields
   default-zeroed). For a recognized phase, non-finite or negative
   `windupTimer`, `recoveryTimer`, and `distanceTraveled` values normalize to
   `0`; a `dashDir` other than `1 | -1` normalizes to the current `facing`.
   Malformed serialized data therefore cannot strand a timer or create a
   zero-direction dash.
3. **Patrol detects before movement.** Detection runs against the pre-move
   position. If detection succeeds, transition to `windup` without moving this
   tick.
4. **Detection geometry.** Absolute player-center minus enemy-center horizontal
   distance `<= detectionRadius` **and** absolute center-Y delta
   `<= verticalTolerance`.
5. **LOS rules.**
   - If `ctx.tileQuery` is null/undefined or `ctx.tileSize` is non-positive or
     non-finite, assume LOS is clear (mirror the existing spinny/turret
     convention).
   - If a query is present, call `checkLineOfSight`. A throwing or malformed
     query returns `false` from LOS, which blocks detection.
6. **Windup entry.** On detection, set `phase = 'windup'`, `windupTimer =
   windupDuration` (full value), lock `dashDir` from the player's relative X,
   and set `facing` toward the player. Do not move this tick and do not
   decrement the timer this tick. If the centers have identical X coordinates,
   preserve the current `facing` and use it as `dashDir`; `dashDir` is always
   `1 | -1`, never `0`.
7. **Windup → dash transition.** At the start of each windup tick, if
   `windupTimer <= dt`, transition to `phase = 'dash'` without executing any
   windup body (no decrement, no movement). Otherwise decrement
   `windupTimer` by `dt` and return windup. This makes the transition tick
   observe `dash` for one tick before any dash movement runs (zero-duration
   windups still expose `windup` for one tick because the entry tick does not
   run this branch).
8. **Dash movement.** Move only in the locked `dashDir`. Do not retarget.
   Movement uses a deterministic horizontal swept-AABB helper:
   - Compute the requested delta as the lesser of `dashSpeed * dt` and the
     remaining `dashMaxDistance`.
   - Scan `ctx.solids` once, ignore passthrough solids horizontally, restrict
     candidates to solids whose vertical span overlaps the charger, and select
     the nearest blocking face between the current and intended leading edge.
   - Clamp the result flush to that face or to the exact max-distance endpoint.
     The charger never overlaps or tunnels through a blocking solid, including
     arbitrarily thin solids.
   - The helper returns `{ x, traveled, hitWall }` and never iterates according
     to movement distance or tile size.
   - If `dashMaxDistance === 0`, the first dash-body tick enters recovery without
     movement. `dashSpeed` cannot be zero because zero is outside its valid
     range and resolves to the named default.
9. **Dash → recovery transition.** When the dash movement for this tick
   reaches a wall or `dashMaxDistance`, set `phase = 'recovery'` and
   `recoveryTimer = recoveryDuration` (full value) at the end of the same
   call. The charger **does** move up to the contact point or max-distance
   endpoint during that tick. Recovery timer decrement and recovery-phase
   behavior do **not** run during that same call — they begin on the next
   tick. (Previous wording that said "do not move this tick" is superseded.)
10. **Recovery → patrol transition.** At the start of each recovery tick, if
    `recoveryTimer <= dt`, transition to `phase = 'patrol'` without executing
    any recovery body. Otherwise decrement `recoveryTimer` by `dt` and return
    recovery. The transition tick observes `patrol` for one tick before any
    patrol movement runs.
11. **Patrol movement.** When undetected:
    - Move horizontally in `facing` using the same deterministic swept-AABB
      helper as the dash, with `speed` in place of `dashSpeed`.
    - Y remains fixed (charger has no gravity).
    - On wall contact, advance exactly to the blocking face and reverse
      `facing`.
    - If `ledgeTurnAround === true`, evaluate support beneath the leading foot
      at `leadingFootX` and `y + CHARGER_HEIGHT + 1` against both collision
      representations:
      - First check non-malformed `ctx.solids`; a full or passthrough solid
        intersecting a one-pixel downward support probe counts as support.
      - If a valid `ctx.tileQuery` and `ctx.tileSize` are present, query the
        corresponding tile; `'solid'` or `'passthrough'` also count as support.
      - Support from either source wins. An `'empty'` tile does not erase
        support supplied by an entity-authored solid.
      - If a tile query throws or returns a malformed value and no solid
        support was found, fail closed: reverse `facing` and restore the
        pre-tick `x`.
      - If neither a valid tile query nor any finite solid geometry is
        available, support sensing is unavailable and ledge detection is
        skipped.
      - When sensing is available and neither source reports support, reverse
        `facing` and restore the pre-tick `x`.
    - Charger patrol does **not** support waypoints in v1.

### Visual telegraphy (windup)

Telegraph through shape and pose, not color alone:

- Body compresses backward (away from `dashDir`).
- Feet brace.
- Head or horns tilt toward the target.
- Dust or scrape particles remain renderer-only.
- Optional palette flash supplements, but does not replace, silhouette change.

### Visual stun (recovery)

- Remain stationary.
- Use a visually readable exhausted or stunned pose (slump, droop, spark).
- Return to patrol pose after the timer expires.

### Charger scope guard

The charger remains a contact hazard. It does not:

- Apply damage.
- Own player health.
- Apply knockback.
- Create i-frames.
- Spawn attack hitboxes.
- Require a combat kernel.

### Charger acceptance criteria

- Windup begins before rapid movement.
- Dash direction remains locked across the entire dash.
- Swept wall collision stops the dash exactly at the nearest blocking face
  without distance-scaled loops or tunneling.
- Maximum distance stops the dash exactly at `dashMaxDistance` traveled.
- Zero `dashMaxDistance` enters recovery on the first dash-body tick; invalid
  zero `dashSpeed` resolves to the named default and cannot create a permanent
  dash.
- Equal player/enemy center X preserves facing and never produces
  `dashDir === 0`.
- Recovery is visually distinct from windup and patrol.
- Phase timing is deterministic across runs.
- Existing enemy states and handlers remain unchanged.
- Handler input (`state`, `ctx`, `params`) is not mutated.
- Invalid or out-of-range params use named defaults, not clamping.
- Invalid `dt` returns a fresh state-equivalent result without side effects.
- Public behavior never throws.
- Passthrough solids are ignored horizontally during dash and patrol.
- Patrol reverses at walls without overlapping them.
- Patrol ledge detection composes entity solids with tile support, reverses when
  neither source supports the leading foot, and skips only when neither support
  representation is available.

## Phase 7: Prototype Tests

Add focused tests under `showcase/tests/`.

### Registry tests

- Specialized humanoid handler compiles.
- Built-in lookup preserves useful types.
- Custom handler registration works.
- Unknown plan returns `undefined`.
- Registry creation does not mutate inputs.

### Humanoid tests

- Same seed yields equal configuration.
- Different seeds produce controlled variation.
- Initial state is deterministic.
- `advanceHumanoidVisual` returns a new state; input state is unchanged.
- `HumanoidConfig` is passed explicitly to advance/draw and is never mutated or
  copied into `HumanoidVisualState`.
- `HumanoidMotionSample` input is not mutated.
- Walking left (`dx < 0`, `facing = -1`) leaves the locomotion phase advancing
  in local space — no moonwalk.
- Zero displacement (`dx = 0`) freezes locomotion phase (feet stay planted).
- Unsupported samples (`supported = false`) freeze locomotion phase regardless
  of `dx`.
- `justLaunched` and `justLanded` pulses drive anticipation/landing pose only
  — they do not integrate vertical motion.
- `gravityDirection = -1` (ceiling support) produces ascent pose when
  `verticalVelocity` is positive (falling toward floor), and descent pose when
  it is negative. The reverse holds for `gravityDirection = +1`.
- Optional `armTarget` does not affect locomotion phase or `dx`-driven gait.
- The humanoid module never imports `advanceJump` or references `JumpState`
  (enforced by a grep assertion in the test).

### LOS tests

See Phase 5 for the full locked contract. The test file must cover, at minimum:

- Empty path is visible.
- Single solid tile blocks.
- Endpoint-occupying solid blocks.
- Endpoint reversal produces identical booleans across the full test matrix.
- Horizontal, vertical, and 45° diagonal rays.
- Near-corner ray (within epsilon) visits both orthogonal neighbors.
- Exact-corner ray visits both orthogonals and the diagonal; any solid one
  blocks (diagonal-peek test).
- `'passthrough'` cells never block.
- Non-finite coordinates return `false`.
- `tileSize <= 0` or non-finite returns `false`.
- Predicted cap rejects before querying, and the internal injected-limit seam
  exercises runtime-cap termination.
- Throwing `tileQuery` returns `false` and never propagates.
- Malformed `tileQuery` return value returns `false`.
- Each visited coordinate is queried at most once per call (counting probe).

### Charger tests

- Non-finite or non-positive `dt` returns a fresh state-equivalent result and
  performs no queries, movement, or timer changes.
- A finite `dt` whose multiplication produces a non-finite movement distance
  also returns state-equivalent without queries or partial movement.
- Out-of-range or non-finite params fall back to named defaults (not clamped).
- `dashSpeed = 0` is invalid and resolves to the named default.
- Malformed phase timers/distance normalize to zero, and malformed `dashDir`
  normalizes to current facing.
- `ledgeTurnAround` defaults to `true` when absent.
- Patrol detects before movement; a detection-transition tick does not move.
- Detection requires both horizontal radius and vertical tolerance.
- Blocked LOS prevents windup.
- Missing/invalid tile query → LOS assumed clear (windup can fire).
- Throwing or malformed tile query → LOS returns false (windup blocked).
- Windup entry sets the full timer and locks `dashDir`; no same-tick decrement.
- At windup start, `windupTimer <= dt` transitions to dash without decrement
  or movement that tick.
- Zero `windupDuration` still exposes windup for exactly one tick (the entry
  tick).
- Equal player/enemy center X preserves the prior facing and locks a non-zero
  `dashDir`.
- Dash does not retarget even if the player moves.
- Swept dash movement scans solids once, ignores `passthrough` solids
  horizontally, and does not loop according to requested distance or tile size.
- A thin wall anywhere along the swept interval stops the charger exactly flush
  with the nearest blocking face and enters recovery that tick.
- Maximum distance enters recovery exactly when traveled distance reaches
  `dashMaxDistance`, with that final movement applied this tick.
- `dashMaxDistance = 0` enters recovery on the first dash-body tick without
  movement.
- Recovery entry sets the full timer; recovery decrement does not run on the
  transition tick.
- At recovery start, `recoveryTimer <= dt` transitions to patrol without
  decrement or movement that tick.
- Zero `recoveryDuration` still exposes recovery for exactly one tick.
- Patrol movement uses the same swept helper as dash.
- Patrol reverses at non-passthrough walls without overlapping them.
- Entity-authored solid and passthrough platforms support the leading-foot probe
  even when the corresponding tile is `'empty'`.
- Tile-authored solid and passthrough cells support the probe when no entity
  solid is present.
- When support sensing is available and neither source supports the leading
  foot, patrol reverses and restores pre-tick `x`.
- A throwing or malformed leading-foot query reverses only when no entity-solid
  support exists.
- Patrol skips ledge detection only when neither a valid tile query nor finite
  solid geometry is available.
- Same inputs produce byte-identical state sequences across runs.
- `state`, `ctx`, and `params` are not mutated.
- Existing spinny, turret, and spider tests remain unchanged.

## Phase 8: Visual Benchmarks

### Pinned benchmark runner

Install the approved devDependency on the `codex/character-enemy-validation`
branch (not on `main`):

```bash
npm install --save-dev --save-exact tsx@4.23.1
```

This is a pinned exact devDependency (recorded under `devDependencies` as
`"tsx": "4.23.1"` — no caret). Per `Decisions Already Made` item 9, this is
explicitly approved by the user as an exception to `.opencode/instructions/
tech-stack.md`.

Add `package.json` scripts that invoke the locally-installed `tsx` binary via
`npm run` (no `npx`, no network download at runtime):

```json
{
  "benchmark:humanoid": "tsx benchmarks/_scripts/humanoid-validation-render.ts",
  "benchmark:charger": "tsx benchmarks/_scripts/charger-validation-render.ts",
  "benchmark:validation": "npm run benchmark:humanoid && npm run benchmark:charger"
}
```

No new runtime dependency is added. The 0.5.0 tarball continues to ship no
runtime dependencies.

### Output layout

Create reproducible scripts under `benchmarks/_scripts/`:

```text
benchmarks/_scripts/
├── humanoid-validation-render.ts
└── charger-validation-render.ts
```

Create outputs under:

```text
benchmarks/character-body-plans/
├── README.md
├── humanoid-prototype.png         # during prototype phase
└── humanoid-production.png        # after Phase 15.5 production rerender

benchmarks/enemy-archetype-catalog/
├── README.md
├── charger-prototype.png          # during prototype phase
└── charger-production.png         # after Phase 15.5 production rerender
```

Use the existing `canvas` devDependency; do not introduce any other dependency.

### Humanoid benchmark sheet

Include:

- Three deterministic seeds.
- Idle pose.
- Mid-stride pose.
- Opposite stride pose.
- Jump ascent.
- Jump apex.
- Jump descent.
- Left-facing and right-facing examples.
- Optional arm-target example.
- Small-scale silhouette row.
- Grayscale readability row.
- Comparison beside the slime-knight.

### Charger benchmark sheet

Include:

- Patrol.
- Early windup.
- Late windup.
- First dash frame.
- Mid-dash.
- Wall impact.
- Recovery.
- Return to patrol.
- Left-facing and right-facing sequences.
- Grayscale telegraph comparison.
- Player scale reference.

### Determinism benchmark

Run each script twice with identical inputs.

The generated PNG bytes must match.

## Phase 9: Visual Review

`@benchmarker` reviews all PNGs.

Review criteria:

### Humanoid

- Silhouette distinction.
- Limb alignment.
- Foot planting.
- Arm swing.
- Facing readability.
- Seed variation quality.
- Palette contrast.
- Small-scale readability.
- Similarity or confusion with existing characters.

### Charger

- Telegraph readability.
- Dash direction.
- Phase distinction.
- Collision-stop readability.
- Recovery vulnerability.
- Contrast at gameplay scale.
- Reliance on color.
- Similarity or confusion with spinny, turret, or spider.

The review must reference exact PNG paths and concrete visual observations.

## Phase 10: Architecture Review

> Status: **APPROVED** (2026-07-29). The typed registry preserves concrete
> built-in/custom handlers with safe unknown lookup; humanoid ownership,
> capped supercover LOS, bounded charger sweep/tick ordering, strict TypeScript,
> determinism, root-only API direction, and prototype package exclusion passed.

`@architect` reviews the actual prototype, not only the proposal.

This is the sole phase that may record the original prototype architecture
approval verdict. Phase 1's documentation reconciliation must not mark anything
approved — prior proposal critiques are historical inputs only. The later
humanoid visual rejection and its replacement visual gate are recorded in
`docs/design/humanoid-visual-revision-plan.md`.

Required checks:

- Determinism.
- Layer separation, including `src/character/` not importing `src/platformer/`
  (`CharacterBodyFrame` is structurally satisfied by `ActorCore` rather than
  imported).
- Strict TypeScript.
- Registry type safety.
- Humanoid ownership discipline (no `advanceJump` / `JumpState` import; no
  authoritative `x`/`y`/`vy` in `HumanoidVisualState`; locomotion advances only
  through `advanceLocomotionByDisplacement`; immutable `HumanoidConfig` is an
  explicit advance/draw argument rather than hidden inside visual state;
  `HumanoidMotionSample` includes `gravityDirection` and uses `supported` not
  `grounded`).
- LOS supercover correctness, endpoint reversibility, corner-tie handling,
  iteration caps (predicted + runtime), and defensive behavior under
  non-finite / throwing / malformed queries.
- Charger tick ordering (start-of-phase transition test, not end-of-tick),
  parameter validation (defaults not clamping), `CHARGER_WIDTH`/`CHARGER_HEIGHT`
  constants, bounded swept-AABB movement, non-finite movement guards,
  passthrough handling, non-zero direction lock, and patrol support probing
  across entity solids plus tile geometry.
- No source prototype leakage into `dist` (including `showcase/_prototype/`
  LOS file).
- No magic colors or numbers.
- JSDoc coverage for proposed exports.
- Root-only npm API.
- No enemy API regressions.
- No combat scope creep.
- No mutation.
- Correct LOS ownership (`src/collision/los.ts` after Promote, not before).
- Documentation consistency.
- Package metadata still reports `0.4.0` (no premature version bump).

Possible verdicts:

- `APPROVED` — only this verdict unlocks Phase 11 `Promote` and the `0.5.0`
  version bump.
- `NEEDS REVISION` — return to the prototype phase with named blockers.

Maximum two critique loops before escalating unresolved design choices to the
user.

## Phase 11: Decision Gate

> Outcome: **Promote** (2026-07-29). Both decision documents were filed and
> package metadata was advanced to `0.5.0` with
> `npm version 0.5.0 --no-git-tag-version`. No tag or publication occurred.

Write:

- `docs/design/character-body-plans-decision.md`
- `docs/design/enemy-archetype-catalog-decision.md`

Each decision records:

- Published baseline SHA and development-base SHA.
- Research input.
- API alternatives.
- Architect verdict.
- Benchmark paths.
- Visual findings.
- Selected API.
- Rejected alternatives.
- Deferred scope.
- Migration impact.
- Production implementation requirements.

Possible outcomes:

### Promote

Prototype is visually and architecturally successful. Pre-conditions for
production work:

1. Phase 10 returned `APPROVED`.
2. Both decision documents are filed (research input, API alternatives,
   architect verdict, benchmark paths, visual findings, selected API, rejected
   alternatives, deferred scope, migration impact, production implementation
   requirements).
3. Run the version bump:
   ```bash
   npm version 0.5.0 --no-git-tag-version
   ```
4. Verify both `package.json` and `package-lock.json` root metadata report
   `0.5.0`.
5. Do not `git tag` and do not `npm publish` — those require explicit user
   approval, deferred to Phase 16/17.

### Revise

Fix named weaknesses and rerun tests and benchmarks. Stay on `0.4.0` package
metadata.

### Reject

Keep research and benchmark records, but do not add the public API. Stay on
`0.4.0` package metadata; the feature branch is abandoned or shelved.

## Phase 12: Production Humanoid Implementation

Only after approval.

Expected structure:

```text
src/character/
├── index.ts
├── types.ts or registry.ts       # only if registry approved
└── humanoid/
    ├── index.ts
    ├── types.ts
    ├── constants.ts
    ├── config.ts
    ├── state.ts
    └── draw.ts
```

Expected exports:

```ts
// From src/character/types.ts:
CharacterBodyFrame          // { x, y, width, height, facing } — no platformer import
CharacterDrawOptions        // { lookTarget?: Vec2 }

// From src/character/humanoid/types.ts:
HumanoidConfig              // seed-derived static config
HumanoidVisualState         // visual-only: locomotion phase, idle blend, arm state
HumanoidMotionSample        // consumer-built sample from PlatformerState + events

// From src/character/humanoid/constants.ts:
DEFAULT_HUMANOID

// From src/character/humanoid/config.ts:
deriveHumanoidConfig

// From src/character/humanoid/state.ts:
createHumanoidVisualState
advanceHumanoidVisual       // (config, state, motion: HumanoidMotionSample, dt) => state

// From src/character/humanoid/draw.ts:
drawHumanoid                // (ctx, body: CharacterBodyFrame, config, state, tick, options?) => void
```

Note the ownership discipline:

- `HumanoidVisualState` carries **no** `x`, `y`, `vx`, `vy`, or `JumpState`.
- `HumanoidVisualState` does not duplicate `HumanoidConfig`; the immutable
  config is passed explicitly to advancement and drawing.
- `HumanoidMotionSample` is built by the consumer from `PlatformerState.core`
  and `PlatformerState.events`.
- `drawHumanoid` accepts a `CharacterBodyFrame` (which `ActorCore` satisfies
  structurally) for world position; it does not read position from
  `HumanoidVisualState`.
- `src/character/` never imports from `src/platformer/`.
- The legacy `stepHumanoid` name is replaced by `advanceHumanoidVisual` to make
  the visual-only role unambiguous.

Registry exports are added only if the registry spike passes.

Do not migrate the slime-knight during this phase unless the decision document
explicitly requires it.

## Phase 13: Production Charger Implementation

Expected additions:

```text
src/collision/
└── los.ts

src/level/
└── enemy-schema.ts

src/platformer/enemy/
└── archetypes/
    └── charger.ts
```

Expected changes:

- Export `checkLineOfSight` from collision.
- Add and export `ChargerParams`.
- Add and export `chargerBehavior`.
- Register charger as a built-in behavior.
- Add charger rendering.
- Add charger palette field through the existing enemy palette.
- Add charger editor catalog entry.
- Add charger-specific `validateLevel` checks for parameter types/ranges and the
  fixed `16 × 16` rect contract.
- Make `compileEnemies` fail closed for a built-in charger whose rect is not
  exactly `CHARGER_WIDTH × CHARGER_HEIGHT`; custom archetype dimensions remain
  unaffected.
- Add charger to `EnemyArchetype` documentation.
- Preserve `EnemyProps.archetype: string`.
- Preserve `createEnemyBehaviorRegistry(customHandlers?)`.
- Preserve all existing behavior handlers.

`validateLevel` rejects malformed or out-of-range charger values at the level
schema boundary. The behavior's named-default fallback remains necessary for
direct handler callers and legacy/unvalidated data; validation and runtime
defense are complementary.

The charger does not require:

- `ProjectileState.lifetime`.
- `EnemyStepResult.projectiles`.
- `EnemyUpdateContext.playerVelocity`.
- `EnemyUpdateContext.tick`.
- `stepCrawler`.
- A general telegraph type.

### Constants to ship

```ts
// Defined in src/level/enemy-schema.ts and re-exported from
// src/platformer/enemy/archetypes/charger.ts plus the enemy/root barrels.
export const CHARGER_WIDTH = 16;
export const CHARGER_HEIGHT = 16;
```

These are exported so catalog entries and consumers reference the canonical
fixed dimensions. `validateLevel` rejects other dimensions for the built-in
charger and `compileEnemies` skips them when called directly; custom dimensions
are unsupported in v1. The same lower-layer schema module owns the numeric
parameter limits used by validation and by the behavior's defensive resolver,
so the two contracts cannot drift.

## Phase 14: Production Tests

Add library tests under `src/tests/`.

Expected files:

```text
src/tests/character-humanoid.test.ts
src/tests/character-registry.test.ts       # only if registry ships
src/tests/collision-los.test.ts
src/tests/enemy-charger.test.ts
src/tests/character-determinism.test.ts
src/tests/enemy-charger-determinism.test.ts
```

Update:

- `src/tests/barrel-contract.test.ts`
- `src/tests/level-validate.test.ts` with valid/invalid charger parameters and
  fixed-dimension cases.
- `src/tests/enemy-compile.test.ts` with valid charger compilation and
  mismatched-dimension fail-closed cases.
- Existing enemy tests only where additive registration changes expected
  built-in counts.

## Phase 15: Documentation

Update only after implementation passes.

Required documentation:

- `README.md`
- `docs/architecture.md`
- `docs/api-surface.md`
- `docs/integration.md` if consumer wiring changes
- Character and enemy decision documents
- Benchmark READMEs
- Relevant source JSDoc

Documentation rules:

- Root npm imports in npm examples.
- Relative source imports only in explicitly labeled submodule examples.
- No unshipped body plans listed as available.
- Deferred candidates remain marked proposed.
- Every exported symbol has JSDoc.
- No showcase-local constants appear as public library exports.

## Phase 15.5: Post-Production Conformance Gate

> Verdict: **CONFIRM** (2026-07-29). The production humanoid and charger sheets
> are byte-identical to the approved prototype sheets. The production
> architecture audit confirmed the decision contracts survived promotion.

The prototype approval recorded in Phase 10 covers only the prototype. This
gate re-runs visual and architecture review against the **production** code in
`src/` to ensure the implementation did not silently diverge from the approved
prototype.

### Steps

1. Run the production benchmark scripts against `src/` code:

   ```bash
   npm run benchmark:humanoid
   npm run benchmark:charger
   ```

2. Save production outputs as separate files alongside the approved prototype
   outputs:

   ```text
   benchmarks/character-body-plans/
   ├── humanoid-prototype.png      # approved in Phase 9
   └── humanoid-production.png     # this phase

   benchmarks/enemy-archetype-catalog/
   ├── charger-prototype.png       # approved in Phase 9
   └── charger-production.png      # this phase
   ```

3. `@benchmarker` compares `*-production.png` against the approved
   `*-prototype.png` and reports any visual divergence with concrete
   PNG-anchored observations.

4. `@architect` reviews the production implementation against the two decision
   documents (Phase 11) — not just against the proposal — checking that the
   locked contracts (humanoid ownership + explicit config, LOS supercover +
   testable caps, charger tick ordering + fixed validated dimensions + bounded
   sweep + composed support sensing) survived implementation.

5. Both reviews must return approval. Any divergence returns to Phase 12/13
   (production implementation) and this gate repeats.

### Verdict outcomes

- **CONFIRM** — both reviews approve; proceed to Phase 16.
- **DIVERGE** — return to production implementation with named blockers.

This gate is mandatory. Phase 16 packaging must not run until Phase 15.5
returns `CONFIRM`.

## Phase 16: Verification

> Status: **PASS** (2026-07-29). The canonical matrix passed at `0.5.0`;
> the exact tarball contains 463 entries and excludes prototypes, showcase,
> benchmarks, and tests.

Run the [Canonical Verification Matrix](#canonical-verification-matrix).

This is the first phase that runs `npm pack --dry-run` for the new code.
Inspect the prospective tarball contents and version. After the dry-run passes,
create the exact smoke-test artifact with:

```bash
npm pack --json
```

Record the generated filename, SHA-1, SHA-512 integrity, entry count, and
unpacked size from the JSON output. Phase 17 installs this exact file; it must
not silently repack between verification and smoke testing.

Confirm:

- Packed tarball reports version `0.5.0` (the Phase 11 bump took effect).
- `package.json` and `package-lock.json` root metadata both report `0.5.0`.
- New production modules appear in `dist`.
- Prototype files do not appear.
- Benchmark files do not appear.
- Showcase files do not appear.
- Tests do not appear.
- No runtime dependencies were introduced.
- Existing `0.4.0` exports remain present.

## Phase 17: External Package Smoke Test

> Status: **PASS** (2026-07-29). A fresh strict Vite project installed the
> exact tarball, built the root-only API wiring, executed bundled Node ESM
> runtime assertions, and confirmed a collision-only graph excludes humanoid
> and charger modules.

Create a temporary strict Vite TypeScript project outside the repository.

Install the packed tarball.

Import only from the package root, following the
[Canonical Root-Import Contract](#canonical-root-import-contract).

In addition, the smoke project must exercise the ownership contract end-to-end
with all values and types imported and initialized against real signatures:

```ts
import {
  type PlatformerInput,
  type Solid,
  type HumanoidVisualState,
  CHARGER_HEIGHT,
  CHARGER_WIDTH,
  createPlatformerState,
  createEnemyBehaviorRegistry,
  stepPlatformer,
  DEFAULT_PLATFORMER_CONFIG,
  chargerBehavior,
  checkLineOfSight,
  deriveHumanoidConfig,
  createHumanoidVisualState,
  advanceHumanoidVisual,
  drawHumanoid,
} from 'aicraft-engine';

const enemyRegistry = createEnemyBehaviorRegistry();
if (enemyRegistry.get('charger') !== chargerBehavior) {
  throw new Error('charger root export/registration mismatch');
}
if (CHARGER_WIDTH !== 16 || CHARGER_HEIGHT !== 16) {
  throw new Error('charger dimensions mismatch');
}

const losVisible = checkLineOfSight(
  0,
  0,
  32,
  0,
  () => 'empty',
  16,
);
if (!losVisible) throw new Error('empty LOS should be visible');

const platformerConfig = {
  ...DEFAULT_PLATFORMER_CONFIG,
};

const humanoidConfig = deriveHumanoidConfig(42);

let platformerState = createPlatformerState(
  32,
  32,
  platformerConfig,
  16,
  24,
);

let humanoidVisual: HumanoidVisualState =
  createHumanoidVisualState(humanoidConfig);

function step(
  dt: number,
  input: PlatformerInput,
  solids: readonly Solid[],
): void {
  const previous = platformerState;

  platformerState = stepPlatformer(
    previous,
    input,
    solids,
    dt,
    platformerConfig,
  ).state;

  humanoidVisual = advanceHumanoidVisual(
    humanoidConfig,
    humanoidVisual,
    {
      dx: platformerState.core.x - previous.core.x,
      facing: platformerState.core.facing,
      supported: platformerState.core.onGround,
      gravityDirection: platformerConfig.gravity < 0 ? -1 : 1,
      verticalVelocity: platformerState.core.vy,
      justLaunched: platformerState.events.justLaunched,
      justLanded: platformerState.events.justLanded,
      hitCeiling: platformerState.events.hitCeiling,
    },
    dt,
  );
}

function render(
  ctx: CanvasRenderingContext2D,
  tick: number,
): void {
  drawHumanoid(
    ctx,
    platformerState.core,
    humanoidConfig,
    humanoidVisual,
    tick,
  );
}
```

Verify:

- Production build succeeds (`tsc --noEmit` clean against installed types).
- Declarations resolve.
- No subpath imports are required.
- No runtime dependency is missing.
- A separate Node ESM runtime-smoke script imports the installed package root
  and executes the charger registration, constants, and LOS assertions above;
  do not count unused imports in a successful Vite build as runtime coverage.
  The TypeScript/Vite entry separately checks the DOM-typed humanoid draw
  signature.
- Build a second minimal Rollup/Vite entry that imports only one pure collision
  helper. Inspect the Rollup module graph or emitted chunk metadata and assert
  that charger and humanoid implementation modules are absent. A successful
  bundle alone is not accepted as proof of tree shaking.
- The smoke project never imports `JumpState` or `advanceJump` into humanoid
  code (grep assertion).

Remove the temporary project and tarball after verification.

## Phase 17.5: Release-Candidate Handoff

> Status: **SUPERSEDED — NEEDS HUMANOID VISUAL REVISION** (2026-07-29). The
> exact source/tree and artifact passed technical gates, but subsequent visual
> review withheld release approval. Recovery is specified in
> `docs/design/humanoid-visual-revision-plan.md`. No merge, tag, or publication
> has occurred.

Publication remains outside this plan, but the plan must end with a candidate
that can be mapped to one exact source tree and one verified artifact.

Write:

`docs/design/character-enemy-validation-release-candidate.md`

Record:

- Published baseline SHA.
- Development-base SHA.
- Current `main` SHA at handoff time.
- Release-candidate commit SHA and tree SHA.
- Clean-worktree confirmation.
- `package.json` and `package-lock.json` version.
- The Phase 16 `npm pack --json` filename, SHA-1, SHA-512 integrity, entry count,
  and unpacked size.
- Phase 15.5, Phase 16, and Phase 17 results.
- Explicit status: `READY FOR USER APPROVAL`, `NEEDS MAIN SYNC`, or `BLOCKED`.

If `main` advanced after the development-base SHA:

1. Determine whether those commits belong in `0.5.0`.
2. If they do, integrate them into the candidate branch without discarding
   either side.
3. If they do not, mark the handoff `BLOCKED` and request an explicit release
   branch or versioning decision; do not silently publish a candidate that
   cannot be reconciled with `main`.
4. Repeat Phase 15.5 when visual/architecture behavior could change, and always
   repeat Phase 16 and Phase 17 against the integrated tree.
5. Update the release-candidate record to the new exact commit and artifact.

No merge, tag, or publication occurs merely because the handoff says
`READY FOR USER APPROVAL`. After explicit user approval, integrate the verified
candidate into `main` before publishing. Prefer a fast-forward when possible.
If integration produces a different tree, it is a new candidate and must repeat
the gates. Tagging and `npm publish` must refer to the final verified `main`
commit, not an earlier prototype or pre-integration branch commit.

## Phase 18: Expansion Decision

Only after humanoid and charger ship successfully should the team consider:

### Body plans

1. Floater/drone.
2. Serpentine.
3. Biomechanical humanoid variants.
4. Quadruped only if a consumer needs it.

### Enemy archetypes

1. Chaser.
2. Burster.
3. Flyer.
4. Crawler.
5. Shielder, swarmer, or caster after combat requirements are understood.

### Supporting systems

1. General telegraphed attacks.
2. Seeded silhouette diversity.
3. Combat kernel, only if validated enemies require it.

Each addition receives its own benchmark and decision gate.

## Expected Production Files

Potential new files:

```text
src/character/index.ts
src/character/types.ts
src/character/registry.ts
src/character/humanoid/index.ts
src/character/humanoid/types.ts
src/character/humanoid/constants.ts
src/character/humanoid/config.ts
src/character/humanoid/state.ts
src/character/humanoid/draw.ts
src/collision/los.ts
src/level/enemy-schema.ts
src/platformer/enemy/archetypes/charger.ts
src/tests/character-humanoid.test.ts
src/tests/character-registry.test.ts
src/tests/collision-los.test.ts
src/tests/enemy-charger.test.ts
docs/design/character-enemy-validation-release-candidate.md
```

Potential modified files:

```text
src/index.ts
src/collision/index.ts
src/platformer/enemy/types.ts
src/platformer/enemy/registry.ts
src/platformer/enemy/renderer.ts
src/platformer/enemy/index.ts
src/platformer/enemy/compile.ts
src/level/validate.ts
src/editor/catalog.ts
src/tests/barrel-contract.test.ts
src/tests/enemy-compile.test.ts
src/tests/level-validate.test.ts
README.md
docs/architecture.md
docs/api-surface.md
docs/design/character-body-plans-proposal.md
docs/design/enemy-archetype-catalog-proposal.md
docs/design/character-enemy-variety-roadmap.md
```

## Risks and Mitigations

### Baseline drift during 0.5.0 development

Risk: `main` receives unrelated changes (new game prompts, doc tweaks) while
`codex/character-enemy-validation` is in flight. Late rebases shift the
baseline and make the 0.5.0 candidate harder to reason about.

Mitigation: Phase 0.5 records both the published 0.4.0 baseline SHA
(`72ef6c62d14f8eef1be94c20c2093a5b5cba97af`) and the clean development-base
SHA, verifies ancestry, and creates a separate worktree from the latter.
Phase 17.5 compares current `main` with that development base and requires
integration plus repeated gates when later commits belong in the release. The
registry tarball integrity
(`sha512-6KQdIcW0mPoAVu1QjQbqP5OJGTm1EVYas34S/RBdPNioCZoIw8eL8MsY2TWt8Rfa1adlzUzX1hBBS8tZxGepeg==`)
remains the source of truth for what `aicraft-engine@0.4.0` actually shipped.

### Static config hidden inside visual state

Risk: seed-derived proportions, palette, and gait configuration are copied into
`HumanoidVisualState` because advancement and drawing otherwise cannot access
them, making save state larger and blurring static/evolving ownership.

Mitigation: `advanceHumanoidVisual` and `drawHumanoid` both receive the immutable
`HumanoidConfig` explicitly. `HumanoidVisualState` contains only evolving visual
state, and tests exercise multiple configs against independent states.

### Dual vertical state authority

Risk: the humanoid module calls `advanceJump` or stores its own `JumpState`,
creating two independent vertical-motion paths that drift out of sync.

Mitigation: Phase 4 locks the ownership contract — humanoid imports neither
`advanceJump` nor `JumpState`. Locomotion advances only via
`advanceLocomotionByDisplacement`. Phase 10 enforces this with a grep
assertion and Phase 17's external smoke test repeats it.

### LOS corner ambiguity

Risk: floating-point corner ties let rays slip diagonally between two solid
tiles (the "diagonal peek" bug), or let endpoint reversal produce different
results.

Mitigation: Phase 5 locks supercover traversal with a relative-epsilon corner
tie and a "visit both orthogonals and the diagonal" rule. Reversibility is
asserted by the Phase 7 LOS test matrix.

### Charger tick-boundary ambiguity

Risk: windup or recovery transitions on the same tick as their destination
phase's body, hiding the telegraph window or skipping the stun pose.

Mitigation: Phase 6 locks the tick ordering — destination phase bodies do not
run on transition ticks, and zero-duration phases remain observable for one
tick.

### Charger non-termination or distance-scaled work

Risk: zero dash speed can strand the state in `dash`, or a huge finite `dt` can
cause unbounded substep loops.

Mitigation: zero `dashSpeed` is invalid and resolves to the named default;
zero `dashMaxDistance` transitions immediately on the first dash-body tick.
Movement rejects non-finite products and uses one swept-AABB scan over
`ctx.solids`, never distance-scaled substeps.

### Split ledge-support representations

Risk: tile-only ledge sensing reverses on top of entity-authored platforms or
walks off them when no tile query is present.

Mitigation: the leading-foot support probe composes entity solids with tile
classification. Support from either source wins, and mixed-representation tests
lock the behavior.

### Registry type erasure

Risk: the generic registry compiles only through unsafe casts.

Mitigation: make the registry optional; direct per-plan exports are acceptable
for the first production body plan.

### Over-generalizing from one body plan

Risk: a registry designed around humanoid state fails for floater or serpentine.

Mitigation: avoid a shared state shape and defer the registry if heterogeneity
cannot be proven honestly.

### Visual similarity

Risk: humanoid resembles the slime-knight or charger resembles spinny.

Mitigation: benchmark silhouettes side by side at gameplay scale.

### Foot sliding and IK popping

Risk: procedural limbs appear unstable.

Mitigation: displacement-driven locomotion, safe limb bounds, frame-sequence
benchmarks, and fixed-seed tests.

### Weak charger telegraph

Risk: dash begins before the player can read the attack.

Mitigation: silhouette anticipation, direction lock, grayscale review, and
explicit windup frames.

### Scope creep

Risk: charger implementation expands into combat or a general telegraph
framework.

Mitigation: retain contact-hazard semantics and flat phase data only.

### Distribution contamination

Risk: prototypes appear in npm output.

Mitigation: keep prototypes outside `src` and inspect `npm pack --dry-run`.

### Root import drift

Risk: examples use unavailable subpaths.

Mitigation: external smoke-test every new public import against the packed root
export, using the Canonical Root-Import Contract.

## Definition of Done

The plan is complete when:

1. The `0.4.0` baseline is published on npm and authenticated at
   `72ef6c62d14f8eef1be94c20c2093a5b5cba97af`.
2. A clean development-base SHA descending from that baseline is recorded, and
   `codex/character-enemy-validation` was created from it in a separate clean
   worktree without carrying modified or untracked files; the development-base
   verification matrix is green before prototype work begins.
3. Proposal inconsistencies are corrected, with prior critiques labeled
   historical only and humanoid API names reconciled to the visual-only set.
4. Humanoid and charger prototypes exist only under
   `showcase/_prototype/character-enemy-validation/` (including the LOS
   prototype); no prototype file is under `src/`.
5. Strict-TypeScript and determinism tests pass for prototypes.
6. `tsx@4.23.1` is installed as a pinned exact devDependency and benchmark
   scripts run via `npm run benchmark:*`.
7. Both prototype benchmark PNGs are reproducible byte-for-byte.
8. `@benchmarker` completes visual review with concrete PNG-anchored findings.
9. Phase 10 `@architect` review returns `APPROVED` (this is the sole approval
   gate for the prototype).
10. Separate decision documents are filed.
11. The Phase 11 `Promote` step ran `npm version 0.5.0 --no-git-tag-version`
    and both `package.json` and `package-lock.json` report `0.5.0`.
12. Only approved APIs are implemented in `src/` (humanoid visual-only with
    explicit immutable config, charger behavior, LOS primitive).
13. Phase 15.5 post-production conformance gate returns `CONFIRM` for both
    `@benchmarker` and `@architect` reviews against production code.
14. Library, showcase, package, and external smoke tests pass on `0.5.0`.
15. Prototype files are absent from the tarball.
16. Documentation matches the root API and the locked ownership contracts
    (humanoid visual-only, `CharacterBodyFrame`, `HumanoidMotionSample`
    gravity direction, LOS supercover + testable caps, charger tick ordering +
    fixed validated dimensions + bounded sweep + composed patrol support).
17. Deferred body plans and enemies remain explicitly unshipped.
18. Phase 17.5 records the exact candidate commit/tree and the exact
    `npm pack --json` artifact metadata, with main-sync status.
19. No merge, `git tag`, or `npm publish` occurred without explicit user
    approval; any later integration tree change requires repeated gates.

## Cross-References

- Roadmap: `docs/design/character-enemy-variety-roadmap.md`
- Body-plan research: `docs/research/character-body-plans.md`
- Body-plan proposal: `docs/design/character-body-plans-proposal.md`
- Enemy catalog research: `docs/research/enemy-archetype-catalog.md`
- Enemy catalog proposal: `docs/design/enemy-archetype-catalog-proposal.md`
- Prior enemy decision: `docs/design/platformer-enemy-archetypes-decision.md`
- 0.4.0 plan: `docs/design/game-prompts-engine-0.4.0-plan.md`
- Sokpop teardown: `../ai-craft-strategy/knowledge/sokpop-minimalist-rendering-teardown.md`
