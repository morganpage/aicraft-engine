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
| `outlineRect(ctx, x, y, w, h, fill, outline?, coverage?)` | function | Flat-fill rect with 1px dark outline; `coverage` controls pixel-grid snapping: `'floor'` (default, snaps down) or `'ceil'` (snaps up) | `src/primitives/outline-rect.ts` |
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
| `FALLBACK_DPR` | const | `1` — fallback DPR when window is unavailable (Node, SSR, test) | `src/primitives/dpr.ts` |
| `getDevicePixelRatio()` | function | Cached defensive probe for `window.devicePixelRatio`; returns `FALLBACK_DPR` in Node/SSR. Intended for one-shot startup reads | `src/primitives/dpr.ts` |
| `resetDprCacheForTests()` | function | Reset cached DPR; tests only | `src/primitives/dpr.ts` |
| `resizeCanvasToBackingStore(canvas, cssWidth, cssHeight)` | function | Resize canvas backing store to `round(cssWidth × dpr)` × `round(cssHeight × dpr)`; returns the fresh DPR for caller to `ctx.scale(dpr, dpr)`. Reads DPR fresh each call (NOT via the cache — DPR changes at runtime on monitor swap / browser zoom). Does NOT touch `canvas.style` | `src/primitives/dpr.ts` |

- _research note: See `docs/research/procedural-locomotion.md` for planned trigonometric locomotion, squash/stretch, and Verlet-based spring chains._

#### `src/primitives/wave-line.ts`

Surface ripple / wave-on-polyline. Three pure evaluators for liquid-surface rendering: sum-of-sines displacement, 1D Gerstner displacement, and a high-level polyline generator with outward normals. Deterministic — same `(x, t, config)` → same output, forever.

> Decision: `docs/design/surface-ripple-decision.md`.
> Benchmark: `benchmarks/surface-ripple/sine-vs-gerstner.png`.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `WaveOctave` | type | Single-octave params: `amplitude`, `wavelength`, `speed`, `phase?` | `src/primitives/wave-line.ts` |
| `GerstnerOctave` | type | Single Gerstner octave: adds `steepness` (0–1) for trochoidal pinch | `src/primitives/wave-line.ts` |
| `WaveDisplacementConfig` | type | Config for `waveDisplacement`: `octaves`, `baseY` | `src/primitives/wave-line.ts` |
| `GerstnerDisplacementConfig` | type | Config for `gerstnerDisplacement`: `octaves`, `baseY` | `src/primitives/wave-line.ts` |
| `WaveMode` | type | `'sine' \| 'gerstner'` — algorithm selector (open for v2 `'spring-mass'`) | `src/primitives/wave-line.ts` |
| `WaveLineConfig` | type | High-level generator config: `mode?`, `octaves?`, `steepness?`, `snapToPixel?` | `src/primitives/wave-line.ts` |
| `WavePoint` | type | `{x, y, normalX, normalY}` — flat displaced point with outward normal | `src/primitives/wave-line.ts` |
| `waveDisplacement(x, t, config)` | function | Pure sum-of-sines: returns absolute Y at `(x, t)` anchored to `baseY` | `src/primitives/wave-line.ts` |
| `gerstnerDisplacement(x0, t, config)` | function | Pure 1D Gerstner: returns `{x, y, dx, dy}` with per-octave steepness | `src/primitives/wave-line.ts` |
| `generateWaveLine(startX, startY, endX, endY, sampleSpacing, t, config?)` | function | High-level polyline generator → `WavePoint[]` with outward normals from curve tangent | `src/primitives/wave-line.ts` |
| `DEFAULT_WAVE_LINE` | const | 2-octave sine config: `snapToPixel: true`, benchmark-confirmed amplitudes | `src/primitives/wave-line.ts` |
| `DEFAULT_GERSTNER` | const | 2-octave Gerstner config: `steepness: 0.7`, `snapToPixel: false` | `src/primitives/wave-line.ts` |

#### `src/primitives/hit-stop.ts`

Hit-stop (freeze-frame) game-feel helper. Pure and deterministic: no `Math.random`, no `Date.now()`, no global state. The simulation clock freezes for a configurable number of ticks while visual effects (particles, screen shake, flash) keep advancing.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `HitStopState` | type | `{ remaining: number }` — remaining freeze ticks; 0 = inactive | `src/primitives/hit-stop.ts` |
| `DEFAULT_HIT_STOP_DURATION` | const | `6` — default freeze in ticks (~100ms at 60fps) | `src/primitives/hit-stop.ts` |
| `createHitStop()` | function | Factory: fresh inactive state (`remaining: 0`) | `src/primitives/hit-stop.ts` |
| `triggerHitStop(state, duration?)` | function | Pure: start or extend a freeze; `remaining = max(current, duration)`. Duration defaults to `DEFAULT_HIT_STOP_DURATION` | `src/primitives/hit-stop.ts` |
| `stepHitStop(state, dt)` | function | Pure: decrement `remaining` by `dt`, clamped at 0 | `src/primitives/hit-stop.ts` |
| `isHitStopActive(state)` | function | Pure reader: `true` if `remaining > 0` | `src/primitives/hit-stop.ts` |

#### `src/primitives/glow.ts`

Additive radial-gradient glow stamp. Draws a brightest-at-center, fade-to-transparent glow using `globalCompositeOperation = 'lighter'` so overlapping glows accumulate (correct physical light behavior). Restores composite + fillStyle after drawing (no state leak). Closes the palette's reserved `feature` role: weapon glow, magical highlights, eye glow, lava brightness.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `drawGlow(ctx, x, y, radius, color, intensity?)` | function | Additive radial-gradient glow; `intensity` is peak alpha [0,1], defaults to `DEFAULT_GLOW_INTENSITY` | `src/primitives/glow.ts` |
| `DEFAULT_GLOW_INTENSITY` | const | `1` — default peak alpha at glow center | `src/primitives/glow.ts` |

#### `src/primitives/parallax.ts`

Parallax background scroll helpers. Pure: returns the scroll offset (or tiled-geometry) for a layer given the camera position and depth factor. Consumer translates the canvas by the returned offset/draws tiles at the returned coordinates.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `parallaxOffset(cameraX, cameraY, factor)` | function | Compute scroll offset: `{x: -cameraX * factor, y: -cameraY * factor}`; normalises `-0` to `+0` | `src/primitives/parallax.ts` |
| `PARALLAX_FAR` | const | `0.25` — typical factor for far background layers (distant mountains, stars) | `src/primitives/parallax.ts` |
| `PARALLAX_MID` | const | `0.5` — typical factor for mid-depth layers (hills, trees) | `src/primitives/parallax.ts` |
| `PARALLAX_NEAR` | const | `1.0` — gameplay-layer factor (same scroll as the world) | `src/primitives/parallax.ts` |
| `TiledParallaxRange` | type | `{ startX, copies }` — draw geometry for a seamless-tiled layer along one axis | `src/primitives/parallax.ts` |
| `tiledParallaxRange(camera, factor, tileWidth, viewportWidth)` | function | Pure 1D geometry: computes leftmost draw coordinate + copy count via Optimal Branching Remainder. Returns `TiledParallaxRange`. JSDoc documents overscan/seam-mitigation pattern and sub-pixel tileWidth performance. Guard: zero/negative `tileWidth` → `{ startX: 0, copies: 0 }` | `src/primitives/parallax.ts` |
| `drawTiledParallax(ctx, drawTile, camera, factor, tileWidth, viewportWidth)` | function | Convenience wrapper: computes geometry via `tiledParallaxRange`, calls `drawTile(ctx, screenX)` for each copy using `tileWidth` as spacing. Asset-agnostic callback. Guard: zero/negative `tileWidth` → callback never called | `src/primitives/parallax.ts` |

> Decision: `docs/design/seamless-tiled-parallax-decision.md`.
> Proposal: `docs/design/seamless-tiled-parallax-proposal.md`.
> Benchmark: `benchmarks/seamless-tiled-parallax/` (5 sample sheets — scroll-right, scroll-left, perfect-alignment, sub-pixel, comparison).

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

Deterministic particle system. Pure spawn/advance/cull, extended with heterogeneous physics (per-particle gravity/drag scales), region/cone sampling, continuous emitters, and renderer-adjacent lifetime helpers.

> Decision: `docs/design/particle-emitters-decision.md`.
> Benchmark: `benchmarks/particle-emitters/lava-pool.png`.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Particle` | type | `{x, y, vx, vy, life, maxLife, size, color?, gravityScale?, dragScale?}` — optional `gravityScale`/`dragScale` default to 1.0 via `??` in `advance` | `src/particles/types.ts` |
| `spawn(x, y, opts)` | function | Evenly-distributed particles around a circle; deterministic by default | `src/particles/spawn.ts` |
| `SpawnOptions` | type | Options for `spawn` (count, speed, jitter, life, size, color, angleOffset, rng) | `src/particles/spawn.ts` |
| `advance(particles, dt, opts?)` | function | Pure: returns new array, applies gravity×`gravityScale` + drag×`dragScale`, decrements life. Byte-identical for particles without scale fields | `src/particles/advance.ts` |
| `AdvanceOptions` | type | Options for `advance` (gravity, drag) | `src/particles/advance.ts` |
| `cull(particles)` | function | Pure: returns new array filtering dead particles | `src/particles/cull.ts` |
| `step(particles, dt, opts?)` | function | Convenience: `cull(advance(...))` | `src/particles/step.ts` |
| `DEFAULT_GRAVITY_SCALE` | const | `1.0` — neutral per-particle gravity multiplier | `src/particles/constants.ts` |
| `DEFAULT_DRAG_SCALE` | const | `1.0` — neutral per-particle drag multiplier | `src/particles/constants.ts` |
| `DEFAULT_RATE_SCALE` | const | `1.0` — neutral per-call emission-rate multiplier | `src/particles/constants.ts` |
| `DEFAULT_INNER_RADIUS` | const | `0` — default inner radius for circle region (filled disk) | `src/particles/constants.ts` |
| `SpawnRegion` | type | Discriminated union: `'point' \| 'line' \| 'rect' \| 'circle'` with shape-specific fields | `src/particles/regions.ts` |
| `sampleRegion(region, rng)` | function | Deterministic coordinate sample from a `SpawnRegion`; fixed RNG draws per shape (0/1/2/2) | `src/particles/regions.ts` |
| `ConeConfig` | type | Directional cone: `baseAngle`, `spread`, `speedMin`, `speedMax` | `src/particles/cone.ts` |
| `sampleConeVelocity(config, rng)` | function | Deterministic velocity sample inside an angular cone; exactly 2 RNG draws | `src/particles/cone.ts` |
| `EmissionState` | type | Rate accumulator: `{accumulator}` in [0, 1) | `src/particles/emitter.ts` |
| `EmissionRateConfig` | type | Rate config: `rate`, `rateScale?` | `src/particles/emitter.ts` |
| `advanceEmission(state, dt, config)` | function | Pure rate-accumulator progression; returns `{next, spawnCount}` (input never mutated) | `src/particles/emitter.ts` |
| `EmitterConfig` | type | Declarative emitter: `rate`, `region`, `cone`, `gravityScale?`, `dragScale?`, `life`, `size`, `color?`, `rng` | `src/particles/emitter.ts` |
| `Emitter` | type | Bundled state: `config` (readonly ref), `accumulator`, `particles[]` | `src/particles/emitter.ts` |
| `StepEmittersOptions` | type | Per-call world options: `gravity?`, `drag?`, `rateScale?` | `src/particles/emitter.ts` |
| `createEmitter(config)` | function | Factory: zero accumulator, empty particles array | `src/particles/emitter.ts` |
| `stepEmitters(emitters, dt, opts?)` | function | Advance all emitters: integrate rates, spawn via region+cone, advance with heterogeneous physics, cull dead. Pure: returns new `Emitter[]` | `src/particles/emitter.ts` |
| `particleAge(p)` | function | Normalized age `[0, 1]` from `life`/`maxLife`; 0 at spawn, 1 at death | `src/particles/lifetime.ts` |
| `particleSizeCurve(p, startSize, endSize)` | function | Linear size interpolation over lifetime; pure reader | `src/particles/lifetime.ts` |
| `particleAlphaCurve(p, startAlpha, endAlpha)` | function | Linear alpha interpolation over lifetime; clamped to `[0, 1]` | `src/particles/lifetime.ts` |

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
- _elastic rod bending resistance investigated (Provot bend springs vs angular PBD): showcase-local for v1, L2 library export deferred until a second consumer arrives. See `docs/design/elastic-rod-antenna-decision.md`._

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

### `src/collision/`

AABB overlap test, per-axis move-and-resolve against static solids, and tile-grid collision. The foundational platformer collision layer. All exports are pure functions over plain data: no host access, no `Math.random`, no global state.

#### `src/collision/types.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Rect` | type | `{x, y, width, height}` — axis-aligned bounding box (world-space, top-left origin) | `src/collision/types.ts` |
| `Solid` | type | Extends `Rect` with optional `passthrough?: boolean` — one-way platform flag (default `false` = fully solid) | `src/collision/types.ts` |
| `ResolveXResult` | type | `{x, vx, hitWall}` — resolved horizontal position + adjusted velocity + wall-hit flag | `src/collision/types.ts` |
| `ResolveYResult` | type | `{y, vy, landed, hitCeiling}` — resolved vertical position + adjusted velocity + ground/ceiling flags | `src/collision/types.ts` |
| `TileType` | type | `'empty' \| 'solid' \| 'passthrough'` — tile solidity classification | `src/collision/types.ts` |
| `TileSolidityQuery` | type | `(tileX, tileY) => TileType` — consumer-provided tile-grid classifier | `src/collision/types.ts` |

#### `src/collision/aabb.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `aabbOverlap(a, b)` | function | Strict AABB overlap test — edges that merely touch are NOT overlapping (prevents re-collision jitter) | `src/collision/aabb.ts` |

#### `src/collision/resolve.ts`

Per-axis move-and-resolve against static solids. Passthrough solids are skipped on X (one-way platforms only block downward Y). Pure: inputs never mutated.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `resolveAxisX(body, vx, solids)` | function | Move body by `vx`, resolve against fully-solid surfaces. Snaps flush + zeros `vx` on wall hit. Zero velocity short-circuits | `src/collision/resolve.ts` |
| `resolveAxisY(body, vy, solids, prevBottom)` | function | Move body by `vy`, resolve against solids. Passthrough platforms only block when `prevBottom <= solid.y`. Returns `landed`/`hitCeiling` flags | `src/collision/resolve.ts` |

#### `src/collision/tiles.ts`

Tile-grid collision layer. Queries the tile grid for overlapping tiles, converts to `Solid` rects, delegates to `resolveAxisX`/`resolveAxisY`. No resolution logic duplicated. Tunneling limitation: `|v| > tileSize` can skip thin tiles.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `worldToTile(worldX, worldY, tileSize)` | function | World-space coords → `{tileX, tileY}` grid indices (floor-based, handles negatives) | `src/collision/tiles.ts` |
| `tileToWorld(tileX, tileY, tileSize)` | function | Grid indices → `{x, y}` world-space top-left corner | `src/collision/tiles.ts` |
| `tileRect(tileX, tileY, tileSize)` | function | Grid indices → world-space `Rect` covering that tile | `src/collision/tiles.ts` |
| `resolveTileX(body, vx, query, tileSize)` | function | Horizontal tile-grid resolve: queries overlapping tiles, delegates to `resolveAxisX` | `src/collision/tiles.ts` |
| `resolveTileY(body, vy, query, tileSize, prevBottom)` | function | Vertical tile-grid resolve: queries overlapping tiles, delegates to `resolveAxisY` with passthrough support | `src/collision/tiles.ts` |

#### `src/collision/moving-gap.ts`

> Decision: `docs/design/moving-gap-decision.md`.
> Research: `docs/research/moving-gap-platform.md`.
> Benchmark: `benchmarks/moving-gap/sample-sheet.png`.

Moving-gap platform: a traveling absence of floor. Splits a span into 0–2 `Solid` fragments around a clamped gap. The geometry helper (`gapSolids`) enforces the "void never standable" invariant by clamping internally — no caller can produce fragments that escape the span. Optional deterministic motion state machine for sweep/chase/expand patterns. `GapGeometry` (not `GapState`) avoids confusion with `GapMotionState`. `path`/`loopMode` are optional on `GapMotionConfig` (only meaningful for sweep). NaN inputs throw (programmer error, consistent with `parseHex`).

**Non-barrel export:** `sampleMovingGapScene` and its helper types (`MovingGapSampleRect`, `MovingGapSampleFrame`, `MovingGapSampleScene`, `MovingGapSampleSheet`) are exported from this file but deliberately NOT re-exported from `src/collision/index.ts`. They are benchmark-only data consumed by `benchmarks/_scripts/moving-gap-render.ts` via direct import — not part of the public API.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `GapSpanConfig` | type | Span definition: `{x, y, width, height, passthrough?}`. Immutable after creation | `src/collision/moving-gap.ts` |
| `GapGeometry` | type | Geometry snapshot: `{centerX, width}` — where the gap is right now (world-space pixels) | `src/collision/moving-gap.ts` |
| `GapTravelMode` | type | `'sweep' \| 'chase' \| 'expand'` — motion mode selector | `src/collision/moving-gap.ts` |
| `GapLoopMode` | type | `'loop' \| 'pingpong'` — sweep endpoint behavior | `src/collision/moving-gap.ts` |
| `GapMotionConfig` | type | Motion params: `travelMode`, `speed`, `gapWidth`, `path?`, `loopMode?`, `giveUpRadius?`, `minWidth?`, `maxWidth?`, `expandTicks?`, `initialCenterX?`. Mode-specific fields optional with documented defaults; `path` defaults to `[]`, `loopMode` defaults to `'loop'` | `src/collision/moving-gap.ts` |
| `GapMotionState` | type | Motion state: `centerX`, `width`, `dist`, `dir`, `expandElapsed` | `src/collision/moving-gap.ts` |
| `gapSolids(span, gap)` | function | **Invariant anchor.** Pure geometry: split span into 0–2 `Solid` fragments around a clamped gap. Four-guard clamp algorithm (NaN→throw, ≤0→full span, ≥span→void, else→clamp). Throws on NaN inputs | `src/collision/moving-gap.ts` |
| `advanceGapMotion(state, dt, config, targetX?)` | function | Pure motion: advance gap state by one tick. Returns new `GapMotionState`. May produce unclamped `centerX`; `gapSolids` clamps before fragment generation | `src/collision/moving-gap.ts` |
| `gapTileQuery(base, span, gap, tileSize)` | function | Pure: wrap a `TileSolidityQuery` to report `'empty'` for tiles inside the clamped gap. Single-row v1: only tiles overlapping the span's Y range are affected. Uses strict AABB overlap (not left-edge test) for tile membership. Clamped gap bounds computed once at wrap time, O(1) per tile | `src/collision/moving-gap.ts` |
| `DEFAULT_GAP_WIDTH` | const | `64` — default gap width in pixels (GDD §6.13) | `src/collision/moving-gap.ts` |
| `DEFAULT_GAP_SPEED` | const | `2` — default movement speed in px/tick (GDD §6.13) | `src/collision/moving-gap.ts` |
| `DEFAULT_CHASE_GIVE_UP_RADIUS` | const | `200` — default chase give-up radius (~3× gap width; mirrors Spitekeep chase-disengage feel) | `src/collision/moving-gap.ts` |

### `src/camera/`

Follow-camera: pure world-space position that lerps toward a target, clamped to level bounds. The renderer reads `Camera.x/y` and rounds to integer pixels only when applying the world transform.

#### `src/camera/types.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Camera` | type | `{x, y}` — viewport top-left in world-space (floats between updates for smooth lerp) | `src/camera/types.ts` |
| `CameraTarget` | type | `{x, y, width, height}` — axis-aligned rect the camera follows (typically the player) | `src/camera/types.ts` |
| `CameraBounds` | type | `{width, height}` — level / world dimensions for clamping | `src/camera/types.ts` |
| `CameraConfig` | type | `{lerp?, snapThreshold?}` — tuning; all fields optional, fall back to `DEFAULT_CAMERA` | `src/camera/types.ts` |

#### `src/camera/constants.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `DEFAULT_CAMERA` | const | `{lerp: 0.1, snapThreshold: 0.5}` — smooth follow with sub-pixel convergence | `src/camera/constants.ts` |

#### `src/camera/follow.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `createCamera()` | function | Factory: fresh camera at world origin `{x: 0, y: 0}` | `src/camera/follow.ts` |
| `updateCamera(camera, target, bounds, viewport, config?)` | function | Pure: advance camera one frame toward target. Centres on target, clamps to bounds (centres level when smaller than viewport), lerps with snap-to-target convergence. Returns new `Camera` | `src/camera/follow.ts` |

### `src/input/`

Deterministic edge accumulator + defensive device adapters. Two layers: pure core (`edges.ts`, `merge.ts`) for DOM-free unit testing, and defensive adapters (`keyboard.ts`, `touch-button.ts`, `touch-button-set.ts`) with lazy host resolution, error swallowing, and never-throw public APIs.

- _research note: See `docs/research/mobile-directional-input.md` for multi-touch pointer-ID tracking, virtual D-pads, and analog thumbsticks._

#### `src/input/types.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `EdgeAccumulator` | type | Mutable event buffer: `{held, pressedSincePoll, releasedSincePoll}`. **Intentionally mutable** — device events latch here between ticks; drained deterministically via `pollEdge` | `src/input/types.ts` |
| `PolledEdge` | type | `{held, pressed, released}` — per-tick snapshot (single-tick edges cleared after poll) | `src/input/types.ts` |
| `KeyboardAdapter` | type | `{poll(), dispose()}` — maps `KeyboardEvent.code` to actions, manages one `EdgeAccumulator` per action | `src/input/types.ts` |
| `KeyboardConfig` | type | `{codeToAction: Record<string, string>}` — maps key codes to action names | `src/input/types.ts` |
| `TouchButtonAdapter` | type | `{poll(), dispose()}` — tracks pointer events on a single DOM element | `src/input/types.ts` |
| `TouchButtonSetConfig` | type | `{ elements: readonly (HTMLElement \| null)[] }` — DOM elements for each button; nulls produce idle slots but keep alignment | `src/input/types.ts` |
| `TouchButtonSetAdapter` | type | `{poll(): PolledEdge[], dispose(): void}` — multi-touch-safe button group; array-aligned with input | `src/input/types.ts` |

#### `src/input/edges.ts`

Pure edge accumulator core. DOM-free, deterministic, fully unit-testable under Node. Edges are latched as booleans on event arrival (not derived from held-state diff), so a full press+release between polls surfaces as `pressed=true AND released=true`.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `createEdgeAccumulator()` | function | Factory: fresh idle accumulator (`held: false`, no pending edges) | `src/input/edges.ts` |
| `pressEdge(acc)` | function | Record a press: sets `held` true, latches `pressedSincePoll`. Mutates in place | `src/input/edges.ts` |
| `releaseEdge(acc)` | function | Record a release: clears `held`, latches `releasedSincePoll`. Mutates in place | `src/input/edges.ts` |
| `resetEdge(acc)` | function | Reset to fully idle (blur/dispose). Mutates in place | `src/input/edges.ts` |
| `pollEdge(acc)` | function | Drain accumulated edges for this tick: returns `PolledEdge` snapshot, clears edge latches. Mutates in place | `src/input/edges.ts` |

#### `src/input/merge.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `orEdges(a, b)` | function | Pure OR-merge of two `PolledEdge` snapshots (e.g. keyboard + touch for same action). Returns fresh object | `src/input/merge.ts` |

#### `src/input/keyboard.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `createKeyboardAdapter(config)` | function | Defensive keyboard adapter. Lazily resolves `window`, swallows errors. Returns no-op adapter in Node/SSR. Ignores `e.repeat`; resets all accumulators on blur | `src/input/keyboard.ts` |

#### `src/input/touch-button.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `createTouchButton(element)` | function | Defensive touch-button adapter. Tracks `pointerdown`/`pointerup`/`pointercancel`/`pointerleave` on a single DOM element. Returns no-op when element is null. Sets `touchAction: 'none'`. **Limitation:** no pointer-ID tracking (two fingers on same element cause cross-talk) and no global safety net — use `createTouchButtonSet` for multi-touch-safe button groups | `src/input/touch-button.ts` |

#### `src/input/touch-button-set.ts`

> Decision: `docs/design/mobile-directional-input-decision.md`.
> Proposal: `docs/design/mobile-directional-input-proposal.md` (Approach B).

Generic multi-touch-safe button group adapter. Takes an array of DOM elements (or nulls for missing slots), returns N `PolledEdge` outputs. Tracks pointer IDs per element with 0→≥1 / 1→0 transitions, preventing cross-talk when two fingers touch the same button. Global `document` `pointerup`/`pointercancel`/`pointerleave` safety net catches viewport-exit events (the stuck-button fix). Sets `touchAction: 'none'` on each non-null element. Short-circuits to a no-op adapter (still returning an idle array of the right length) when `window` is undefined (SSR safety). Direction-agnostic — the consumer maps array indices to semantics (directions, action buttons, etc.).

| Export | Kind | Summary | Source |
|---|---|---|---|
| `TouchButtonSetConfig` | type | `{ elements: readonly (HTMLElement \| null)[] }` — DOM elements for each button, in positional order. Null entries produce idle slots but keep array alignment | `src/input/types.ts` |
| `TouchButtonSetAdapter` | type | `{ poll(): PolledEdge[], dispose(): void }` — drains N accumulators per tick; array-aligned with input | `src/input/types.ts` |
| `createTouchButtonSet(config)` | function | Defensive multi-touch button set. Tracks pointer IDs per element with 0→≥1 / 1→0 transitions; global `document` safety net (`pointerup`/`pointercancel`/`pointerleave`). Sets `touchAction: 'none'` on each non-null element. Returns no-op adapter (still array-length-aligned) when `window` undefined | `src/input/touch-button-set.ts` |

- _decision: `docs/design/mobile-directional-input-decision.md`_
- _research note: `docs/research/mobile-directional-input.md` §Pattern 1, §Multi-Touch_
- _existence proof: Spitekeep `src/input/touch.ts` (`TouchControls` class with identical pointer-ID tracking; ~120 lines of reusable core in a 414-line class that also includes CSS injection, capability detection, and DOM creation)_

### `src/game-loop/`

Fixed-step game loop — the connective tissue that ties input → simulation → render into a running game. Two layers: pure accumulator math (`advanceAccumulator`, DOM-free, unit-testable under Node) and a defensive host-touching adapter (`createGameLoop`) that lazily resolves `requestAnimationFrame` / `performance.now()` / `document`, swallows all errors, never throws. Includes spiral-of-death guard (`maxFrameDelta` clamp) and `visibilitychange` pause/resume so a backgrounded tab doesn't produce a catch-up burst on regain.

#### `src/game-loop/fixed-step.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `DEFAULT_FIXED_DT` | const | `1/60` — default fixed simulation timestep (60 Hz) | `src/game-loop/fixed-step.ts` |
| `DEFAULT_MAX_FRAME_DELTA` | const | `1/6` — default max frame delta before clamping (~10 catch-up steps at 60 Hz; spiral-of-death guard) | `src/game-loop/fixed-step.ts` |
| `AccumulatorStep` | type | `{accumulator, alpha}` — leftover time + interpolation alpha returned by `advanceAccumulator` | `src/game-loop/fixed-step.ts` |
| `advanceAccumulator(accumulator, frameDelta, fixedDt, maxFrameDelta, step)` | function | Pure fixed-timestep math: clamps delta, calls `step(fixedDt)` once per whole step, returns leftover accumulator + alpha. No DOM, no globals, no `Date.now()` | `src/game-loop/fixed-step.ts` |
| `createGameLoop(config)` | function | Defensive fixed-step loop adapter. Lazily resolves RAF / `performance.now()` / `document` at factory-call time. Handles `visibilitychange` pause/resume. `start()` is a silent no-op in Node/SSR. Never throws | `src/game-loop/fixed-step.ts` |

#### `src/game-loop/types.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `GameLoopConfig` | type | `{fixedDt?, maxFrameDelta?, step, render}` — loop config; `step` receives `fixedDt` each call, `render` receives interpolation alpha | `src/game-loop/types.ts` |
| `GameLoop` | interface | `{start(), stop(), isRunning(), dispose()}` — running loop handle; all methods idempotent and never-throw | `src/game-loop/types.ts` |

### `src/save/`

Defensive save-data storage backends and JSON load/write helpers. Follows the canonical defensive adapter pattern (`src/primitives/motion.ts`): lazy `window.localStorage` resolution, swallow all errors, never-throw public API. Zero cross-module imports.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `SaveStorage` | interface | Storage backend contract: `load()`, `save(json)`, `clear()` — all must never throw | `src/save/types.ts` |
| `DEFAULT_SAVE_KEY` | const | `'aicraft-save'` — default localStorage key | `src/save/constants.ts` |
| `createLocalStorageSaveStorage(key?)` | function | Defensive localStorage backend. Lazily resolves `window.localStorage` inside methods. Falls back to no-op in Node/SSR | `src/save/storage.ts` |
| `createMemorySaveStorage()` | function | In-memory closure backend for tests/SSR. No persistence across reloads | `src/save/storage.ts` |
| `loadSave<T>(storage, defaultValue)` | function | Parse JSON from storage; returns `defaultValue` on any error (missing, corrupt, unavailable). Never throws | `src/save/storage.ts` |
| `writeSave<T>(storage, value)` | function | Serialize and persist via `JSON.stringify`; silently fails on quota/stringify errors. Never throws | `src/save/storage.ts` |

### `src/audio/`

WebAudio synthesized SFX defensive adapter. Zero audio assets — every sound is generated on the fly from oscillators + a reused white-noise buffer. Follows the canonical defensive adapter pattern: lazy `AudioContext` resolution on first `unlock()` (never at module load), swallow all errors, never-throw public API, no-op fallback in Node/SSR. Per-instance factory pattern (each `createAudioAdapter` call creates an independent adapter with its own closure state). The library ships generic primitives (`playTone` / `playNoise`); consumers compose game-specific sounds from these two building blocks.

> Note: `Math.random()` is used to fill the noise buffer. This is explicitly allowed — decorative audio side-effect, NOT deterministic simulation logic. Audio output never leaks back into game state.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `AudioAdapter` | interface | `{unlock(), isUnlocked(), playTone(...), playNoise(...), setMuted(...), isMuted(), setVolume(...), getVolume(), dispose()}` — WebAudio SFX adapter contract. All playback methods are no-op when muted, pre-unlock, or without WebAudio | `src/audio/types.ts` |
| `DEFAULT_AUDIO_VOLUME` | const | `0.7` — default SFX volume | `src/audio/constants.ts` |
| `createAudioAdapter()` | function | Defensive factory: independent adapter with private `AudioContext`, master gain, and noise buffer. Lazily resolves `AudioContext`/`webkitAudioContext` on first `unlock()`. Never throws | `src/audio/factory.ts` |

### `src/blend/`

General pose-blend primitives. Standalone pure-arithmetic module for interpolating between two TRS poses by a weight. Independent of the animation pillar — `Pose2D` is structurally compatible with `BonePose` from `src/animation/types.ts` (duck typing) but defined separately to keep this module dependency-free.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Pose2D` | interface | Blendable 2D bone pose: optional `translation` (`{x,y}`), `rotation` (radians), `scale` (uniform scalar). Undefined fields resolve to identity | `src/blend/types.ts` |
| `blendPose(a, b, weight)` | function | Interpolate two single-bone TRS poses; `weight` clamped to `[0,1]`. Returns fully-specified `Pose2D` (no undefined fields). Pure, never throws | `src/blend/lerp.ts` |
| `blendPoses(posesA, posesB, weight)` | function | Element-wise blend of pose arrays; pads shorter array with identity. Returns new array of new objects. Pure, never throws | `src/blend/lerp.ts` |

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

## Pillar 3: IAP Bridge (shipped)

> Decision: `docs/design/iap-bridge-decision.md`.

### `src/iap/types.ts`

All IAP type definitions. Zero cross-pillar imports. `EntitlementSave` is a pure overlay containing NO cosmetic fields — the consumer composes it with `CosmeticSave` at the tick boundary via the `GrantDescriptor[]` returned from `flushIAPEvents`.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `ProductType` | type | `'non_consumable'` — v1 only; consumables/subscriptions deferred to v2 | `src/iap/types.ts` |
| `IAPPrice` | type | `{ formatted, micros, currency }` — localized display string + raw micro-units + ISO 4217 code | `src/iap/types.ts` |
| `IAPProduct` | type | `{ id, type, name, description, price }` — store catalog product record | `src/iap/types.ts` |
| `TransactionState` | type | `'pending' \| 'approved' \| 'finished' \| 'failed'` — platform transaction lifecycle | `src/iap/types.ts` |
| `IAPTransaction` | type | `{ id, sku, state, receipt?, error? }` — platform transaction record (adapter produces, consumer feeds to `pushTransaction`) | `src/iap/types.ts` |
| `IAPEvent` | type | `{ type, sku, txId }` — normalised event for the deterministic sim core (`'purchase' \| 'restore' \| 'revoke'`) | `src/iap/types.ts` |
| `EntitlementSave` | type | `{ entitlements: string[], receipts: Record<string, string> }` — pure IAP overlay. **No cosmetic fields.** Fields intentionally NOT `readonly` (clone-then-mutate discipline) | `src/iap/types.ts` |
| `GrantDescriptor` | type | `{ target: 'skin', targetId }` — consumer-side grant descriptor; open union for future `'bundle'`/`'currency'` | `src/iap/types.ts` |
| `SkuResolver` | type | `(sku: string) => readonly GrantDescriptor[]` — consumer-provided SKU→grant mapping; library never embeds SKU metadata | `src/iap/types.ts` |
| `IAPBridge` | interface | Host-touching adapter: `initialize()`, `isInitialized()`, `getCatalog()`, `getEntitlements()`, `purchase(sku)`, `restore()`, `onTransaction(cb)` | `src/iap/types.ts` |

### `src/iap/constants.ts`

Canonical defaults and tunables. No magic strings or numbers outside this file.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `DEFAULT_IAP_STORAGE_KEY` | const | `'aicraft-iap-entitlements'` — localStorage key for mock IAP store | `src/iap/constants.ts` |
| `PRODUCT_TYPE_NON_CONSUMABLE` | const | `'non_consumable'` — canonical product type constant | `src/iap/constants.ts` |
| `TX_STATE_APPROVED` | const | `'approved'` — purchase succeeded | `src/iap/constants.ts` |
| `TX_STATE_FAILED` | const | `'failed'` — purchase declined or errored | `src/iap/constants.ts` |
| `TX_STATE_PENDING` | const | `'pending'` — platform still resolving | `src/iap/constants.ts` |
| `TX_STATE_FINISHED` | const | `'finished'` — purchase fully consumed | `src/iap/constants.ts` |
| `DEFAULT_IAP_PRICE` | const | `{ formatted: '$0.99', micros: 990000, currency: 'USD' }` — fallback price record | `src/iap/constants.ts` |
| `DEFAULT_IAP_PRODUCT` | const | `{ id: 'com.aicraft.default', type: 'non_consumable', ... }` — default product for smoke tests | `src/iap/constants.ts` |
| `DEFAULT_IAP_CATALOG` | const | `[ DEFAULT_IAP_PRODUCT ]` — single-item default catalog | `src/iap/constants.ts` |
| `DEFAULT_ENTITLEMENT_SAVE` | const | `{ entitlements: [], receipts: {} }` — empty entitlement state | `src/iap/constants.ts` |

### `src/iap/entitlements.ts`

Pure progression ops + queue primitives. Mirrors `src/cosmetics/ownership.ts`: immutable in → JSON-clone out → never mutate → never throw. Call on purchase/restore/revoke events only (not per-frame). `flushIAPEvents` returns `GrantDescriptor[]` for the consumer to compose with `grantSkin` at their own boundary — no cross-pillar import.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `grantEntitlement(save, sku, receipt?)` | function | Pure op: add SKU to sorted deduped `entitlements`, store receipt. Invalid/empty SKU = silent no-op | `src/iap/entitlements.ts` |
| `revokeEntitlement(save, sku)` | function | Pure op: remove SKU from `entitlements` and drop receipt. Does NOT auto-unequip skins | `src/iap/entitlements.ts` |
| `flushIAPEvents(save, events, resolver)` | function | Pure op: batch-process events into save; returns `{ save, grants }`. Consumer iterates `grants` and calls `grantSkin` themselves | `src/iap/entitlements.ts` |
| `drainQueue(events)` | function | Pure op: shallow-copy + empty array; returns `{ drained, next }` | `src/iap/entitlements.ts` |
| `pushTransaction(events, tx)` | function | Pure op: append `'purchase'` event for `'approved'` tx; no-op for `'pending'`/`'finished'`/`'failed'` | `src/iap/entitlements.ts` |

### `src/iap/adapters/memory.ts`

In-memory IAP adapter. No host API access. Transaction ids are monotonic per-instance for deterministic tests (no `Math.random` / `Date.now()`).

| Export | Kind | Summary | Source |
|---|---|---|---|
| `MemoryIAPAdapterConfig` | type | `{ catalog? }` — optional catalog override | `src/iap/adapters/memory.ts` |
| `createMemoryIAPAdapter(config?)` | function | Factory: in-process mock store. `purchase()` resolves approved for known SKUs, failed for unknown; never rejects | `src/iap/adapters/memory.ts` |

### `src/iap/adapters/local-storage.ts`

localStorage-backed adapter for local dev. Lazily resolves `window.localStorage` inside methods (never at module load), falls back to in-memory in Node/SSR/test. Cached probe after first resolution. Never throws, never rejects.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `LocalStorageIAPAdapterConfig` | type | `{ storageKey?, catalog? }` — optional storage key + catalog override | `src/iap/adapters/local-storage.ts` |
| `createLocalStorageIAPAdapter(config?)` | function | Factory: persists to `localStorage` (or in-memory fallback). Same contract as memory adapter | `src/iap/adapters/local-storage.ts` |

- _decision: `docs/design/iap-bridge-decision.md`_
- _research note: `docs/research/iap-bridge.md`_

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

Re-exports everything from `./primitives`, `./rng`, `./particles`, `./animation`, `./palette`, `./cosmetics`, `./iap`, `./collision`, `./camera`, `./input`, `./game-loop`, `./audio`, `./save`, and `./blend` (all shipped). As pillars ship, they are added here.

```ts
export * from './primitives';
export * from './rng';
export * from './particles';
export * from './animation';
export * from './palette';
export * from './cosmetics';
export * from './iap';
export * from './collision';
export * from './camera';
export * from './input';
export * from './game-loop';
export * from './audio';
export * from './save';
export * from './blend';
// Phase 4: export * from './fake3d';
```

---

## Showcase-local: `showcase/helpers/slime-knight.ts` (shipped)

> Decision: `docs/design/mouth-emotion-decision.md`.
> **NOT a library export.** The library provides primitives; the showcase assembles them.

### Parametric Mouth (shipped)

Additive extension to `drawSlimeKnight`'s `options` bag. Default omitted = no mouth drawn → benchmark byte-identical preserved. The mouth is a pure function of `emotion` — no `tick`, no temporal motion.

| Export | Kind | Summary | Status |
|---|---|---|---|
| `MouthEmotion` | type alias | `number` — `[-1, 1]` where -1 = nervous "o" (small filled circle), 0 = neutral flat line, +1 = happy smile | SHIPPED |
| `drawMouth(ctx, cx, cy, width, emotion, palette)` | function (showcase-local) | Parametric mouth: `emotion > 0` → cubic-Bézier smile via `drawSmoothMouth` (curvature = emotion). `emotion <= 0` → flat-line → filled-circle morph via `drawCircleMouth` (morph param `t = clamp(-emotion, 0, 1)`). Pure function of `(cx, cy, width, emotion, palette)` — no tick, no RNG | SHIPPED |
| `options.emotion` | field on `drawSlimeKnight` options | `MouthEmotion` — drives the mouth shape. Default omitted (no mouth drawn, benchmark byte-identical); `0` draws a neutral flat line | SHIPPED |

**Internal functions** (not exported, called by `drawMouth`):

| Function | Summary |
|---|---|
| `drawSmoothMouth(ctx, cx, cy, width, curvature, palette)` | Cubic-Bézier smile for `emotion > 0`. Stroke-only using `palette.outline` at `CHUNKY_OUTLINE_WIDTH` |
| `drawCircleMouth(ctx, cx, cy, width, t, palette)` | Flat-line → filled-circle morph for `emotion <= 0`. Ellipse filled AND stroked in `palette.outline` at `CHUNKY_OUTLINE_WIDTH`. At `t = 0` renders the same flat line as the smile branch at curvature 0 |

**Shipped constants** (all in `showcase/helpers/slime-knight.ts`):

| Constant | Value | Description |
|---|---|---|
| `MOUTH_Y_OFFSET_RATIO` | `0.30` | Vertical offset from body center as fraction of `bodyHeight` |
| `MOUTH_WIDTH_RATIO` | `0.35` | Mouth width as fraction of `bodyWidth` |
| `MOUTH_CURVATURE_CONTROL_RATIO` | `0.25` | Bézier control-point vertical displacement fraction of mouth width |
| `MOUTH_CIRCLE_RADIUS_RATIO` | `0.20` | Radius of the nervous "o" circle at `emotion = -1`, as fraction of mouth width |

- _research note: `docs/research/mouth-emotion.md`_
- _proposal: `docs/design/mouth-emotion-proposal.md`_
- _decision: `docs/design/mouth-emotion-decision.md`_
- _benchmark: `benchmarks/mouth-emotion.png`_

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
