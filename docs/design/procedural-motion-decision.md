# Decision: Procedural Motion (`src/animation/locomotion.ts`, `squash-stretch.ts`, `spring.ts`, `oscillators.ts`)

**Status:** APPROVED — proceeds to TDD implementation.
**Inputs:** `docs/research/procedural-locomotion.md` · `docs/design/procedural-motion-proposal.md` · architect critique (NEEDS REVISION → APPROVED, loop 2/2) · benchmark `benchmarks/animation/spring-chain.png` · prototype `src/_prototype/anim-spring.ts`.

## Decision

Adopt **split pure functions** mirroring `particles/` advance/cull/step — the only shape that composes, tree-shakes, and holds the determinism line:

- **Locomotion** (`locomotion.ts`): `advanceLocomotion(state, speed, dt, config) → LocomotionState` + `evaluateLocomotion(state, config) → LocomotionPose`. A phase accumulator integrated by speed gives smooth idle/walk/run transitions with no phase-jump glitches. Pure-clone.
- **Squash & stretch** (`squash-stretch.ts`): stateless `volumeScale`, `breathe`, `projectTurnedPart` — volume-preserving (`scaleX × scaleY = 1`).
- **Springs** (`spring.ts`): **Verlet-PBD** `advanceSpringChain(nodes, anchorX, anchorY, dt, config) → VerletNode[]`, pure-clone (input never mutated), exactly the `particles/advance.ts` discipline. **Caller owns the fixed timestep** and calls with `dt=1` — matches the particles convention; no second dt-handling pattern in the library, and no hidden internal sub-stepping.
- **Reduced motion:** consumer reads `prefersReducedMotion()` and scales amplitudes via `scaledGait(config, scale)` / `scaledBreath(config, scale)` helpers. Shake is consumer-gated (`reduceMotion ? 0 : sineShake(...)`).

**Verified visually (springs):** stable over 30+ ticks, organic tail/hair-like sway with natural lag, no explosion or NaN. The finite-iteration PBD softness (~7% stretch under load at 2 constraint iterations, ~1% at 8) reads as desirably elastic for secondary elements — NOT a bug. **Regime precision:** the "~7% at 2 iterations" figure is measured on a short chain from rest in a single step; longer chains under sustained gravity accumulate more stretch per segment — this is the expected, desirable PBD soft-constraint property that gives organic tails and hair their elastic feel.

Locomotion and squash/stretch were **not** prototyped — they are low-risk pure trigonometry and go straight to TDD.

## Ratified from prototype
- **`spring.ts` JSDoc must note the PBD softness property:** higher `constraintIterations` → less stretch. Consumers expecting rigid rods should raise `constraintIterations`; defaults (1–3) are tuned for organic secondary motion. (The research predicted "1–3 is plenty"; the prototype confirmed *why*.)
- **Migration (locked by user):** `bob`, `pulse`, `sineShake`, `shakeEnvelope` move from `src/primitives/animation.ts` to **`src/animation/oscillators.ts`** (general-purpose oscillators, not locomotion-specific). `src/primitives/animation.ts` is deleted; `src/primitives/index.ts` drops those exports. `Vec2` → `src/animation/types.ts`. **No back-compat shim** — library has no consumers yet.
- `VerletNode` stays module-local in `spring.ts` (not hoisted to `types.ts`) — no premature generalization; hoist later only if a future cloth sim needs it.

## What was rejected
- A mega-`animate(tick, ...)` umbrella (couples unrelated systems).
- Stateful locomotion/spring controller classes (conflict with functional pure-clone convention).
- Library-internal spring sub-stepping (hidden CPU cost, second dt pattern).
- Auto-applying `prefersReducedMotion()` inside the deterministic core (layer violation — the host probe belongs to the consumer's renderer).
