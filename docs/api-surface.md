# API Surface

> Living document. Must always match `src/`. Drift = integration pain for consumers.
> Maintained by `@api-designer`. The `@team` orchestrator checks this before committing any change to `src/`.

## How to read this

Each module's exports are listed with a one-line summary. For full signatures, see the JSDoc in the source file (linked).

---

## Pillar 1: Primitives

### `src/primitives/`

Color math, pixel helpers, motion probe. (The animation helpers — `bob`, `pulse`, `sineShake`, `shakeEnvelope`, and `Vec2` — have migrated to `src/animation/`; see the `src/animation/` section below.)

| Export | Kind | Summary | Source |
|---|---|---|---|
| `outlineRect(ctx, x, y, w, h, fill, outline?)` | function | Flat-fill rect with 1px dark outline; coords floored to pixel grid | `src/primitives/outline-rect.ts` |
| `DEFAULT_OUTLINE_COLOR` | const | `'#1d1128'` — Spitekeep's near-black outline | `src/primitives/outline-rect.ts` |
| `parseHex(hex)` | function | `#rrggbb` → `{r, g, b}` record; throws on invalid input | `src/primitives/color.ts` |
| `toHex({r, g, b})` | function | `{r, g, b}` → `#rrggbb`; channels rounded and clamped | `src/primitives/color.ts` |
| `shade(hex, factor)` | function | Multiply channels by factor (<1 darkens, >1 lightens, clamped) | `src/primitives/color.ts` |
| `mixHex(a, b, t)` | function | Linear interpolation between two hex colors | `src/primitives/color.ts` |
| `complement(hex)` | function | Channel-wise complement (255 - channel) | `src/primitives/color.ts` |
| `relativeLuminance(hex)` | function | WCAG 2.x relative luminance in [0, 1] | `src/primitives/color.ts` |
| `contrastRatio(a, b)` | function | WCAG contrast ratio in [1, 21]; symmetric | `src/primitives/color.ts` |
| `meetsWcagAa(a, b)` | function | True if contrast ≥ 4.5:1 (GDD §11.3 rule) | `src/primitives/color.ts` |
| `RGB` | type | `{r: number; g: number; b: number}` (0-255 each) | `src/primitives/color.ts` |
| `clamp(v, lo, hi)` | function | Clamp to closed range | `src/primitives/pixel.ts` |
| `floor(v)` | function | `Math.floor` alias with pixel-grid intent | `src/primitives/pixel.ts` |
| `lerp(a, b, t)` | function | Linear interpolation | `src/primitives/pixel.ts` |
| `approach(current, target, maxDelta)` | function | Frame-rate-independent smoothing toward target | `src/primitives/pixel.ts` |
| `prefersReducedMotion()` | function | Cached probe for `prefers-reduced-motion`; false in Node/SSR | `src/primitives/motion.ts` |
| `resetMotionCacheForTests()` | function | Reset cache; tests only | `src/primitives/motion.ts` |

- _research note: See `docs/research/procedural-locomotion.md` for planned trigonometric locomotion, squash/stretch, and Verlet-based spring chains._

### `src/rng/`

Seeded pseudo-random number generation. Required anywhere determinism matters and variation is needed.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `mulberry32(seed)` | function | Create deterministic RNG; same seed → same sequence forever | `src/rng/mulberry32.ts` |
| `nextInt(rng, min, max)` | function | Inclusive integer in [min, max] | `src/rng/mulberry32.ts` |
| `nextFloat(rng, min, max)` | function | Float in [min, max) | `src/rng/mulberry32.ts` |
| `nextSign(rng)` | function | Either -1 or +1 | `src/rng/mulberry32.ts` |
| `pick(rng, arr)` | function | Random element; throws on empty array | `src/rng/mulberry32.ts` |

### `src/particles/`

Deterministic particle system. Pure spawn/advance/cull.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Particle` | type | `{x, y, vx, vy, life, maxLife, size, color?}` | `src/particles/types.ts` |
| `spawn(x, y, opts)` | function | Evenly-distributed particles around a circle; deterministic by default | `src/particles/spawn.ts` |
| `SpawnOptions` | type | Options for `spawn` (count, speed, jitter, life, size, color, angleOffset, rng) | `src/particles/spawn.ts` |
| `advance(particles, dt, opts?)` | function | Pure: returns new array, applies gravity + drag, decrements life | `src/particles/advance.ts` |
| `AdvanceOptions` | type | Options for `advance` (gravity, drag) | `src/particles/advance.ts` |
| `cull(particles)` | function | Pure: returns new array filtering dead particles | `src/particles/cull.ts` |
| `step(particles, dt, opts?)` | function | Convenience: `cull(advance(...))` | `src/particles/step.ts` |

### `src/animation/types.ts`

Shared foundation types for skeletal rigging, IK, and locomotion.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Vec2` | type | `{x: number; y: number}` — canonical definition (migrated from `src/primitives/animation.ts`) | `src/animation/types.ts` |
| `AffineTransform` | type | 2×3 column-major matrix `[a, b, c, d, tx, ty]` — maps directly to `ctx.transform()` | `src/animation/types.ts` |
| `BonePose` | type | Local TRS for one bone (translation, rotation in radians, scale; all optional, default identity) | `src/animation/types.ts` |
| `BoneNode` | type | Bone in hierarchy: id, parentIndex, restPose, optional attachmentSlot | `src/animation/types.ts` |
| `SkeletonTemplate` | type | Reusable skeleton definition: bones array, `restWorldTransforms`, bone lengths, slot map | `src/animation/types.ts` |
| `Rig` | type | Per-instance state: template ref, mutable localPoses, mutable worldTransforms/Positions/Rotations | `src/animation/types.ts` |
| `EffectorTarget` | type | IK/locomotion attachment: slot name + world-space target Vec2 | `src/animation/types.ts` |
| `BoneDrawMap` | type | Array of `{boneIndex, draw}` entries for skin rendering | `src/animation/types.ts` |

### `src/animation/rig.ts`

Skeletal rig operations: skeleton creation, rig instantiation, world-space propagation.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `createSkeleton(bones)` | function | Create reusable SkeletonTemplate from BoneNode array (validates topological order, computes rest transforms + bone lengths + slot map) | `src/animation/rig.ts` |
| `createRig(template)` | function | Create a live Rig instance initialized to rest pose | `src/animation/rig.ts` |
| `computeWorldTransforms(rig)` | function | Single O(N) forward pass: reads localPoses, writes worldTransforms/Positions/Rotations in-place | `src/animation/rig.ts` |

### `src/animation/transform.ts`

Coordinate-space conversion helpers.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `localToWorld(point, rig, boneIndex)` | function | Transform a Vec2 from bone-local to world space | `src/animation/transform.ts` |
| `worldToLocal(point, rig, boneIndex)` | function | Transform a Vec2 from world space to bone-local (matrix inverse; returns `{x:0,y:0}` for singular) | `src/animation/transform.ts` |

### `src/animation/skin.ts`

Skin rendering: per-bone draw callback dispatch.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `drawRig(ctx, rig, skin)` | function | Apply each bone's world transform and call its draw callback; null entries are skipped | `src/animation/skin.ts` |

- _research note: `docs/research/skeletal-rigging.md`_
- _research note: `docs/research/inverse-kinematics.md`_
- _research note: `docs/research/procedural-locomotion.md`_
- _proposed in: `docs/design/skeletal-rigging-proposal.md`_

### `src/animation/ik/`

Inverse kinematics solvers. Decision: `docs/design/inverse-kinematics-decision.md`.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `IkBone` | type | Solver-local angle-limit params (`minAngle?`/`maxAngle?`); bone lengths read from `SkeletonTemplate.boneLengths`, not duplicated here | `src/animation/ik/types.ts` |
| `IkEffector` | type | Slot name + world-space target position (skin-agnostic) | `src/animation/ik/types.ts` |
| `IkResult` | type | Solved positions + local rotations + solved flag (returned by `solveCCD`/`solveFABRIK`) | `src/animation/ik/types.ts` |
| `LimbResult` | type | Result of `solveLimb`: `{jointPos, endPos, solved}` — dedicated type for the 2-bone analytical solver | `src/animation/ik/limb.ts` |
| `LimbSolveOptions` | type | Options for `solveLimb` (`bendDir?`) | `src/animation/ik/types.ts` |
| `IterativeSolveOptions` | type | Options for `solveCCD`/`solveFABRIK` (`iterations?`, `angleLimits?`) | `src/animation/ik/types.ts` |
| `calculateBendDir(root, target, pole)` | function | 2D cross product → bend direction (`-1` or `+1`) | `src/animation/ik/limb.ts` |
| `solveLimb(root, target, lengthA, lengthB, opts?)` | function | Analytical 2-bone IK solver (O(1), closed-form); returns `LimbResult` with `{jointPos, endPos, solved}` | `src/animation/ik/limb.ts` |
| `solveCCD(positions, boneLengths, target, opts?)` | function | Cyclic Coordinate Descent for N-joint chains; returns `IkResult` | `src/animation/ik/ccd.ts` |
| `solveFABRIK(positions, boneLengths, target, opts?)` | function | FABRIK position solver + rotation reconstruction; returns `IkResult` | `src/animation/ik/fabrik.ts` |
| `reconstructRotations(positions)` | function | Reconstruct local rotations from solved positions via `atan2`; signature `(positions: readonly Vec2[]) → number[]` (no `boneLengths` param) | `src/animation/ik/fabrik.ts` |
| `IK_CCD_DEFAULT_ITERATIONS` | const | `8` — default fixed iteration count for CCD | `src/animation/ik/constants.ts` |
| `IK_FABRIK_DEFAULT_ITERATIONS` | const | `4` — default fixed iteration count for FABRIK | `src/animation/ik/constants.ts` |
| `IK_POSITION_TOLERANCE_SQ` | const | `0.0001` — sub-pixel solved-flag diagnostic threshold | `src/animation/ik/constants.ts` |
| `IK_LIMB_DEAD_ZONE` | const | `0.001` — jitter prevention at full extension in `solveLimb` | `src/animation/ik/constants.ts` |
| `IK_COLLINEAR_THRESHOLD_SQ` | const | `1e-12` — squared length below which a bone is treated as collinear-degenerate by `reconstructRotations` | `src/animation/ik/constants.ts` |

- _research note: docs/research/inverse-kinematics.md_

### `src/animation/foot-lock.ts`

Effector locking for foot-pin / hand-hold. Bridges IK solvers with locomotion.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `FootLockState` | type | Lock state: isLocked, lockPos, blendWeight | `src/animation/foot-lock.ts` |
| `advanceFootLock(state, isGrounded, footPos, dt, blendSpeed?)` | function | Pure state progression: ramp blend weight toward lock | `src/animation/foot-lock.ts` |
| `getFootLockTarget(state, animatedFootPos)` | function | Lerp between animated and locked position | `src/animation/foot-lock.ts` |

### `src/animation/locomotion.ts`

Trigonometric locomotion: phase-accumulator walk/run cycles with smooth speed transitions.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `LocomotionState` | type | Phase accumulator: `{phase: number}` in [0, 2π) | `src/animation/locomotion.ts` |
| `GaitConfig` | type | Per-character gait params: baseFrequency, strideLength, strideHeight, hipBobHeight, hipSwayWidth | `src/animation/locomotion.ts` |
| `DEFAULT_GAIT` | const | Default GaitConfig matching Spitekeep's devil character scale | `src/animation/locomotion.ts` |
| `LocomotionPose` | type | Hip/foot offsets: hipOffset, leftFootOffset, rightFootOffset (all Vec2) | `src/animation/locomotion.ts` |
| `advanceLocomotion(state, speed, dt, config)` | function | Pure: integrate phase accumulator; returns new LocomotionState | `src/animation/locomotion.ts` |
| `evaluateLocomotion(state, config)` | function | Pure: compute hip/foot offsets from phase; returns LocomotionPose. Foot-lift half-cycle was corrected from `max(0, sin(phi))` to `max(0, -sin(phi))` — see `docs/design/walk-cycle-correction-decision.md` | `src/animation/locomotion.ts` |
| `scaledGait(config, scale)` | function | Pure: multiply all amplitude fields by scale factor (reduced-motion helper) | `src/animation/locomotion.ts` |

#### Locomotion extensions (additive, shipped)

Advances the locomotion pillar with displacement-driven phase (kills foot-sliding for translating characters) and airborne tuck blending for jumps.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `TuckConfig` | type | Airborne tuck pose params: `tuckOffset` (Vec2), `hipRaise` (px, negative = up) | `src/animation/locomotion.ts` |
| `DEFAULT_TUCK` | const | Default `TuckConfig`: `tuckOffset {x:0,y:-2}`, `hipRaise -3` | `src/animation/locomotion.ts` |
| `advanceLocomotionByDisplacement(state, dx, config)` | function | Pure: advance phase by actual horizontal displacement `dx` (anti-foot-slide). `dx` is world-space signed displacement; consumers using geometry mirrors (`ctx.scale(facing, 1)`) must pass local-space displacement (`dx * facing`) — see `docs/design/walk-cycle-correction-decision.md`. Do NOT call alongside time-driven `advanceLocomotion` in the same tick. | `src/animation/locomotion.ts` |
| `blendAirborneTuck(footOffset, airborneBlend, config)` | function | Pure: lerp a walk-cycle foot offset toward the tuck pose by `airborneBlend ∈ [0,1]` | `src/animation/locomotion.ts` |

- _decision: `docs/design/jump-walk-proposal.md` (Approach A: Composable Separate Functions)_
- _adds to existing `src/animation/locomotion.ts` without modifying any previously-shipped exports_

- _see also `src/animation/oscillators.ts` for the migrated `bob` / `pulse` / `sineShake` / `shakeEnvelope` helpers_
- _research note: `docs/research/procedural-locomotion.md` §Pattern 1_
- _research note: `docs/research/jump-walk-locomotion.md` for deterministic jumping, walking, and state-machine coupling_
- _proposed in: `docs/design/procedural-motion-proposal.md`_

### `src/animation/squash-stretch.ts`

Volume-preserving scale transforms for breathing, jumping, landing, and turning.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Scale2D` | type | `{scaleX: number; scaleY: number}` — volume-preserving scale pair | `src/animation/squash-stretch.ts` |
| `BreathConfig` | type | Breathing params: `frequency`, `amplitude` | `src/animation/squash-stretch.ts` |
| `DEFAULT_BREATH` | const | Default `BreathConfig` for idle animation | `src/animation/squash-stretch.ts` |
| `TurnedProjection` | type | Orthographic turning result: `{x, y, sx, sy}` — projected position plus horizontal/vertical scale | `src/animation/squash-stretch.ts` |
| `volumeScale(deltaY)` | function | Pure: volume-preserving scale from vertical delta (`scaleX × scaleY = 1`) | `src/animation/squash-stretch.ts` |
| `breathe(tick, config)` | function | Pure: sinusoidal breathing oscillation returning `Scale2D` | `src/animation/squash-stretch.ts` |
| `projectTurnedPart(localX, localY, facingAngle)` | function | Pure: Sokpop-style orthographic turning projection; returns `TurnedProjection` | `src/animation/squash-stretch.ts` |
| `scaledBreath(config, scale)` | function | Pure: multiply breathing amplitude by scale factor (reduced-motion helper) | `src/animation/squash-stretch.ts` |

- _research note: `docs/research/procedural-locomotion.md` §Pattern 2_
- _proposed in: `docs/design/procedural-motion-proposal.md`_

### `src/animation/spring.ts`

Verlet-PBD spring chains for secondary dynamics (hair, tails, cloaks).

| Export | Kind | Summary | Source |
|---|---|---|---|
| `VerletNode` | type | Chain node: `{x, y, prevX, prevY}` | `src/animation/spring.ts` |
| `SpringConfig` | type | Physics params: segmentLength, gravityX/Y, drag, constraintIterations | `src/animation/spring.ts` |
| `DEFAULT_SPRING` | const | Default SpringConfig for a hanging tail/hair chain | `src/animation/spring.ts` |
| `advanceSpringChain(nodes, anchorX, anchorY, dt, config)` | function | Pure: Verlet-PBD step; returns new VerletNode[] (input not mutated) | `src/animation/spring.ts` |
| `createSpringChain(count, anchorX, anchorY, segmentLength)` | function | Factory: create initial straight chain hanging downward | `src/animation/spring.ts` |

- _determinism contract: caller MUST use fixed `dt` (see proposal §Fixed-Timestep)_
- _research note: `docs/research/procedural-locomotion.md` §Pattern 3_
- _proposed in: `docs/design/procedural-motion-proposal.md`_

### `src/animation/jump.ts`

Apex-parameterized jump trajectory, state machine (coyote time, jump buffering, variable height), and landing squash with internal 1D spring recovery. Pure and deterministic: same `(state, inputs, dt, config)` → byte-identical returned state. The library is a trajectory solver only — `isGrounded` is a consumer-provided input flag (the library never does collision).

| Export | Kind | Summary | Source |
|---|---|---|---|
| `JumpConfig` | type | Jump tuning: `apexHeight`, `timeToApex`, `jumpCutoffFactor`, `fallMultiplier`, `coyoteTime`, `jumpBufferTime`, `landingSquashMin`, `landingSquashStiffness`, `landingSquashDamping`, `anticipationDuration`, `anticipationSquash`, `launchStretch`, `airborneBlendRampUp`, `airborneBlendRampDown` | `src/animation/jump.ts` |
| `DEFAULT_JUMP` | const | Default `JumpConfig` matching Sokpop-style platformer feel (apex 48px, timeToApex 0.28s) | `src/animation/jump.ts` |
| `JumpPhysics` | type | Pre-computed gravity + launch velocity from apex parameterization (`gravity = 2H/T²`, `launchVelocity = 2H/T`) | `src/animation/jump.ts` |
| `JumpPhase` | type | Discrete state: `'grounded' \| 'anticipating' \| 'rising' \| 'falling' \| 'landing'` | `src/animation/jump.ts` |
| `JumpState` | type | Persistent jump state: `phase`, `vy`, `y`, `coyoteTimer`, `jumpBufferTimer`, `anticipationTimer`, `jumpHeld`, `squashOffset`, `squashVelocity`, `landingTimer`, `impactVelocity`, `justLaunched`, `airborneBlend`, `scale` (Scale2D), `physics` | `src/animation/jump.ts` |
| `JumpInputs` | type | Per-tick abstract inputs: `jumpHeld`, `jumpPressed`, `isGrounded`, `hitCeiling?` | `src/animation/jump.ts` |
| `JumpPose` | type | Read-only pose: `yOffset`, `scale` (Scale2D), `airborne`, `airborneBlend`, `impactVelocity` | `src/animation/jump.ts` |
| `createJumpState(config)` | function | Factory: create initial grounded `JumpState` (pre-computes `physics`) | `src/animation/jump.ts` |
| `advanceJump(state, inputs, dt, config)` | function | Pure: advance the jump state machine by one fixed timestep; returns a new `JumpState` | `src/animation/jump.ts` |
| `evaluateJump(state)` | function | Pure reader: compute `JumpPose` (yOffset, scale, airborne, airborneBlend, impactVelocity) from state — no config needed | `src/animation/jump.ts` |

- _decision: `docs/design/jump-walk-proposal.md` (Approach A: Composable Separate Functions)_
- _determinism contract: same (state, inputs, dt, config) → byte-identical returned state; golden trajectory locked in `src/tests/__snapshots__/jump.test.ts.snap`_
- _research note: `docs/research/jump-walk-locomotion.md` §Patterns 1, 2, 4_
- _`deriveJumpPhysics` is an internal helper (not exported); derived physics are readable via `state.physics`_
- _landing squash uses an internal 1D spring-damper (`landingSquashStiffness`, `landingSquashDamping`); not exported_
- _the library does NOT clamp `y` on landing — the consumer snaps the rendered position to the ground via its own collision resolution_

### `src/animation/oscillators.ts` (migrated from `src/primitives/animation.ts`)

General-purpose deterministic oscillators. Migrated cleanly out of `src/primitives/animation.ts` (that file is deleted; `src/primitives/index.ts` drops these exports). **No back-compat re-export shim** — the library has no consumers yet.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `bob(tick, speed, amplitude)` | function | Deterministic sine-based bobbing; signed displacement in [-amp, +amp]; 0 at tick 0 | `src/animation/oscillators.ts` |
| `pulse(tick, speed, amplitude)` | function | Deterministic pulse in [0, amplitude] for breathing / glow | `src/animation/oscillators.ts` |
| `sineShake(tick, magnitude, freqX?, freqY?)` | function | Deterministic 2-axis screen-shake offset (decorrelated sines) | `src/animation/oscillators.ts` |
| `shakeEnvelope(tick, duration, initialMagnitude)` | function | Linear-decay magnitude envelope for shake | `src/animation/oscillators.ts` |

- _determinism: pure functions of `tick`; no `Math.random` / `Date.now()`_
- _reduced-motion: consumer-gated, e.g. `reduceMotion ? 0 : sineShake(...)`_

### `src/animation/constants.ts`

Named constants shared across the animation pillar (no magic numbers). IK-solver-specific iteration constants live in `src/animation/ik/constants.ts`.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `SINGULAR_MATRIX_DET_THRESHOLD` | const | `1e-8` — determinant below this marks a 2×3 matrix singular in `worldToLocal` | `src/animation/constants.ts` |
| `FOOT_LOCK_DEFAULT_BLEND_SPEED` | const | `10` — default blend-weight change per second for `advanceFootLock` | `src/animation/constants.ts` |

---

## Pillar 2: Cosmetics (shipped, Phase 2)

### `src/palette/`

Per-skin OKLCH palette substitution, deterministic harmonic generation, and WCAG AA contrast repair. 330+ tests, build clean.

> Decision: `docs/design/algorithmic-palette-decision.md`.

#### `src/palette/types.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Palette` | type | Canonical 5-slot interface: `outline`, `base`, `accent`, `feature`, `background` (all `#rrggbb` hex) | `src/palette/types.ts` |
| `PaletteOverrides` | type | `Partial<Palette>` — partial overrides for skin variation | `src/palette/types.ts` |
| `Oklch` | type | `{l, c, h}` — OKLCH color record (lightness [0,1], chroma [0,~0.4], hue [0,360)) | `src/palette/types.ts` |
| `ContrastPair` | type | `{fg, bg}` — checked slot pair for contrast repair | `src/palette/types.ts` |
| `GenerationStrategy` | type | `'complementary' \| 'analogous' \| 'triadic'` — seed-driven palette generation strategy (default `'triadic'`) | `src/palette/types.ts` |
| `GenerationConfig` | type | Tunable generation params: strategy, baseLightness, baseChroma, lightnessJitter, chromaJitter | `src/palette/types.ts` |
| `ContrastRepairOptions` | type | Options for `repairContrast` (`targetRatio?`) | `src/palette/types.ts` |

#### `src/palette/oklch.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `rgbToOklch(rgb)` | function | sRGB (0-255) → OKLCH. Pure, ~54 lines matrix math, zero deps | `src/palette/oklch.ts` |
| `oklchToRgb(oklch)` | function | OKLCH → sRGB. Out-of-gamut channels clamped; may hue-shift near-gamut-boundary colors. Pure | `src/palette/oklch.ts` |
| `hexToOklch(hex)` | function | `#rrggbb` → OKLCH. Composes `parseHex` + `rgbToOklch` | `src/palette/oklch.ts` |
| `oklchToHex(oklch)` | function | OKLCH → `#rrggbb`. Composes `oklchToRgb` + `toHex` (8-bit rounding at boundary) | `src/palette/oklch.ts` |

#### `src/palette/resolve.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `resolvePalette(base, overrides?)` | function | Merge base palette with optional overrides; missing slots fall back silently to base. Pure, never throws | `src/palette/resolve.ts` |

#### `src/palette/generate.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `generatePalette(seed, config?)` | function | Deterministic palette from 32-bit seed + optional config. Uses `mulberry32`, always contrast-repaired. Same seed → same palette forever | `src/palette/generate.ts` |

#### `src/palette/contrast-repair.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `repairContrast(palette, opts?)` | function | Fixed 8-iter binary search on OKLCH lightness to enforce WCAG AA (4.5:1) on 3 slot pairs. Pre-computed at load time, NOT per-frame. Pure, never throws (throws on malformed hex — programmer error inheriting `parseHex`) | `src/palette/contrast-repair.ts` |

#### `src/palette/constants.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `WCAG_AA_TARGET_RATIO` | const | `4.5` — WCAG AA minimum contrast ratio (GDD §11.3) | `src/palette/constants.ts` |
| `CONTRAST_REPAIR_ITERATIONS` | const | `8` — fixed binary-search iterations (1/256 lightness precision) | `src/palette/constants.ts` |
| `MAX_CHROMA` | const | `0.35` — maximum OKLCH chroma for generation (avoids sRGB gamut violations) | `src/palette/constants.ts` |
| `MIN_LIGHTNESS` | const | `0.05` — minimum lightness for dark slots (outline) | `src/palette/constants.ts` |
| `MAX_LIGHTNESS` | const | `0.97` — maximum lightness for light slots (background) | `src/palette/constants.ts` |
| `CONTRAST_PAIRS` | const | `[{fg:'outline',bg:'base'}, {fg:'feature',bg:'base'}, {fg:'outline',bg:'background'}]` — slot pairs checked for contrast (accent vs base intentionally NOT checked) | `src/palette/constants.ts` |
| `DEFAULT_STRATEGY` | const | `'triadic'` — default generation strategy | `src/palette/constants.ts` |
| `DEFAULT_BASE_LIGHTNESS` | const | `0.70` — default base lightness for the `base` slot | `src/palette/constants.ts` |
| `DEFAULT_BASE_CHROMA` | const | `0.15` — default base chroma for colored slots | `src/palette/constants.ts` |
| `DEFAULT_LIGHTNESS_JITTER` | const | `0.05` — default per-slot lightness jitter amplitude | `src/palette/constants.ts` |
| `DEFAULT_CHROMA_JITTER` | const | `0.04` — default per-slot chroma jitter amplitude | `src/palette/constants.ts` |
| `STRATEGY_HUE_OFFSETS` | const | Per-strategy hue offsets (degrees) for accent and feature slots: `complementary` → {180°, 150°}, `analogous` → {30°, −30°}, `triadic` → {120°, 240°} | `src/palette/constants.ts` |
| `ACCENT_LIGHTNESS_FACTOR` | const | `0.9` — lightness multiplier shaping accent from base lightness | `src/palette/constants.ts` |
| `ACCENT_CHROMA_FACTOR` | const | `0.8` — chroma multiplier shaping accent from base chroma | `src/palette/constants.ts` |
| `FEATURE_LIGHTNESS_FACTOR` | const | `1.15` — lightness multiplier shaping feature from base lightness (clamped to MAX_LIGHTNESS) | `src/palette/constants.ts` |
| `FEATURE_CHROMA` | const | `0.15` — chroma cap for the feature slot (the highlight/accent color). Bounded so contrast repair can always push feature to extreme WCAG luminances for lightness-only repair to reach WCAG AA | `src/palette/constants.ts` |
| `OUTLINE_CHROMA` | const | `0.02` — near-achromatic chroma for the outline slot | `src/palette/constants.ts` |
| `BACKGROUND_CHROMA` | const | `0.01` — near-achromatic chroma for the background slot | `src/palette/constants.ts` |

**Note on the `feature` slot:** The `feature` slot is the highest-saturation color, but its chroma is capped at `FEATURE_CHROMA` (0.15). This bound is mathematically necessary: higher chroma traps the feature in a mid-luminance band, making `feature`/`base` unrepairable for some seeds. The 0.15 cap was ratified by the benchmark sample sheet (visually confirmed the feature still pops vividly; see decision doc).

- _research note: See `docs/research/algorithmic-palette-substitution.md`_
- _research note: See `docs/research/algorithmic-skin-variation.md`_
- _decision: `docs/design/algorithmic-palette-decision.md`_

### `src/cosmetics/`

Skin presets, versioned manifests, defensive migration, deterministic seeded generation, and pure ownership operations. Builds on the settled palette module (`src/palette/`).

> Decision: `docs/design/algorithmic-skin-variation-decision.md`.

#### `src/cosmetics/types.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Rarity` | type | `'common' \| 'rare' \| 'epic' \| 'legendary'` — typed rarity union (not free string). Adding a tier later is a non-breaking union expansion | `src/cosmetics/types.ts` |
| `EquipSlot` | type | `'body' \| 'head' \| 'trail'` — cosmetic equipment regions. **Separate namespace from `SkeletonTemplate.slotMap`:** rig `slotMap` keys are consumer-defined *attachment* slots for IK/locomotion targeting; `EquipSlot` values are *cosmetic regions* the consumer maps to draw callbacks | `src/cosmetics/types.ts` |
| `SkinPreset` | type | `{ id, name, rarity, palette, scale }` — serializable parameter preset. `palette` is the settled `Palette` from `src/palette/types.ts`; `scale` is a single `number` (uniform render-scale multiplier) | `src/cosmetics/types.ts` |
| `CosmeticManifest` | type | `{ version: number, skins: readonly SkinPreset[] }` — versioned, JSON-serializable manifest. `skins` is `readonly` (manifests are load-once, read-many content — never mutated after parse) | `src/cosmetics/types.ts` |
| `CosmeticSave` | type | `{ owned: string[], equipped: Partial<Record<EquipSlot, string>> }` — player ownership + equipment state. Fields intentionally **NOT `readonly`** (ownership ops clone-then-mutate the clone; `readonly` + `as`-cast would be misleading ceremony). `owned` is a plain sorted `string[]`, never Set/Map | `src/cosmetics/types.ts` |

#### `src/cosmetics/constants.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `MANIFEST_VERSION` | const | `1` — current manifest schema version | `src/cosmetics/constants.ts` |
| `DEFAULT_RARITY` | const | `'common'` — fallback rarity for invalid or missing rarity fields | `src/cosmetics/constants.ts` |
| `SCALE_MIN` | const | `0.1` — minimum bone scale multiplier | `src/cosmetics/constants.ts` |
| `SCALE_MAX` | const | `5.0` — maximum bone scale multiplier | `src/cosmetics/constants.ts` |
| `JITTER_SCALE_MIN` | const | `0.8` — lower bound (inclusive) of generated scale jitter | `src/cosmetics/constants.ts` |
| `JITTER_SCALE_MAX` | const | `1.2` — upper bound (exclusive) of generated scale jitter | `src/cosmetics/constants.ts` |
| `MAX_SIGNATURE_RETRIES` | const | `100` — cap on signature-collision retries per variant before giving up that slot | `src/cosmetics/constants.ts` |
| `EQUIP_SLOTS` | const | `['body', 'head', 'trail']` — all valid equipment slots | `src/cosmetics/constants.ts` |
| `RARITY_TIERS` | const | `['common', 'rare', 'epic', 'legendary']` — all valid rarity tiers (used by defensive parsing and UI consumers) | `src/cosmetics/constants.ts` |
| `DEFAULT_SCALE` | const | `1.0` — neutral render scale (no change) | `src/cosmetics/constants.ts` |
| `DEFAULT_PALETTE` | const | Default 5-slot palette used as per-field fallback in defensive parsing. Valid `#rrggbb` hex per `Palette` contract | `src/cosmetics/constants.ts` |
| `DEFAULT_SKIN_PRESET` | const | Fallback preset: id `'default'`, common rarity, scale `1.0`, default palette | `src/cosmetics/constants.ts` |
| `DEFAULT_COSMETIC_SAVE` | const | Empty save: no owned skins, nothing equipped | `src/cosmetics/constants.ts` |
| `DEFAULT_MANIFEST` | const | Fallback manifest: version 1, single default skin | `src/cosmetics/constants.ts` |

#### `src/cosmetics/migrate.ts`

Defensive manifest parser. Mirrors Spitekeep's `platform/save.ts` `migrateSave` pattern: never throws, rebuilds a fresh default, overlays validated fields.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `migrateManifest(raw)` | function | Defensively parse a versioned manifest. Gates on `version === MANIFEST_VERSION`, parses/dedupes skins by id (last entry wins), falls back to `DEFAULT_MANIFEST` if empty. Never throws | `src/cosmetics/migrate.ts` |

**Internal (not public):** `migrateSkinPreset` is an internal helper within `migrate.ts` — not part of the public surface.

#### `src/cosmetics/generate.ts`

Deterministic seeded generation. Delegates palette entirely to `src/palette/generatePalette` (which repairs contrast internally).

| Export | Kind | Summary | Source |
|---|---|---|---|
| `generateSkinVariants(seed, baseSkin, count)` | function | Deterministic batch: same `(seed, baseSkin, count)` → same variants forever. Uses `mulberry32`, generates palette via `generatePalette`, jitters scale within `[JITTER_SCALE_MIN, JITTER_SCALE_MAX]`, guarantees batch uniqueness via signature hashing. Variant ID format: `${baseSkin.id}-var-${i}-${seed}-${hash}` where `hash` is FNV-1a base36 of the base skin's palette+scale content (ensures cross-base-skin collision avoidance) | `src/cosmetics/generate.ts` |

#### `src/cosmetics/ownership.ts`

Pure progression ops. Mirrors Spitekeep's `platform/progress.ts`: immutable in → JSON-clone out → never mutate → never throw. Call only on user actions (equip/purchase), never per-frame.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `grantSkin(save, skinId)` | function | Pure op: add skin to `owned` (sorted alphabetically, deduped). Invalid skinId = silent no-op (returned save value-equal to input) | `src/cosmetics/ownership.ts` |
| `equipSkin(save, slot, skinId)` | function | Pure op: equip owned skin into slot. Verifies **ownership** (skin in `owned`), NOT manifest existence. Invalid slot/skinId/unowned = silent no-op | `src/cosmetics/ownership.ts` |
| `unequipSkin(save, slot)` | function | Pure op: clear a slot. Invalid slot or empty slot = silent no-op | `src/cosmetics/ownership.ts` |

- _research note: `docs/research/algorithmic-skin-variation.md`_
- _decision: `docs/design/algorithmic-skin-variation-decision.md`_

---

## Pillar 3: IAP Bridge (planned, Phase 3)

### `src/iap/` (planned)

Adapter interface for in-app purchases. Mirrors Spitekeep's `SaveStorage` pattern.

- `IAPBridge` — adapter interface: `getCatalog()`, `getEntitlements()`, `purchase(sku)`, `restore()`, `onTransaction(cb)`
- `SKU`, `Entitlement`, `Receipt` — type set parallel to `SaveData`
- `grantEntitlement(save, sku)` — pure op extending `SaveData`
- Adapters: `createMemoryIAPAdapter()` (tests), `createLocalStorageIAPAdapter()` (dev), Jest/Poki deferred

---

## Pillar 4: Fake-3D (planned, Phase 4)

### `src/fake3d/` (planned)

Sokpop-inspired fake-3D rendering on Canvas2D. Reference: `docs/research/fake-3d-cube-face-sorting.md` (to be written).

- `project(x, y, z, camera) → Vec2` — orthographic projection
- `drawCube(ctx, x, y, z, size, palette)` — orthographic cube with face-sorting and derived shading
- `billboard(ctx, draw, x, y, z, camera)` — billboard a 2D shape at a 3D position
- `isometricTile(ctx, gridX, gridY, gridSize, palette)` — single isometric tile

---

## Pillar 5: Platform Adapters (on-demand)

### `src/iap/adapters/jest.ts` (deferred)

Jest SDK adapter. Triggered when Spitekeep (or a sibling) submits to Jest.

### `src/iap/adapters/poki.ts` (deferred)

Poki SDK adapter (ads variant). Triggered for dual-publish.

---

## Top-level barrel: `src/index.ts`

Re-exports everything from `./primitives`, `./rng`, `./particles`, `./animation`, `./palette`, and `./cosmetics` (all shipped). As pillars ship, they are added here.

```ts
export * from './primitives';
export * from './rng';
export * from './particles';
export * from './animation';
export * from './palette';
export * from './cosmetics';
// Phase 3: export * from './iap';
// Phase 4: export * from './fake3d';
```

---

## Change protocol

When adding, changing, or removing an export:

1. The proposal lives at `docs/design/<technique>-proposal.md`.
2. The decision lives at `docs/design/<technique>-decision.md`.
3. **This file must be updated in the same task** as the source change. Drift is an integration bug.
4. The `@team` orchestrator inspects this file against `src/` before committing.
5. The `@architect` critiques any new export or signature change before it ships.

Breaking changes to existing exports require:

- Major version bump in `package.json`.
- Migration notes in `docs/design/<technique>-decision.md`.
- Update to Spitekeep (the first consumer) in the same coordinated change.
