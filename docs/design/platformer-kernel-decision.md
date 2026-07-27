# Decision: Platformer Kernel

## 0.4.0 clarification: signed gravity

`gravity` is signed and `maxFallSpeed` is its terminal-speed magnitude.
Negative gravity uses physical ceiling contact as support, including
`onGround`, `justLanded`, and moving-platform carry. Contact IDs remain
physical: floors populate `groundId`, ceilings populate `ceilingId`.
`jumpEnabled?: boolean` disables only the jump processor when explicitly
false; gravity-relative jump and other oriented abilities remain deferred.
Before abilities run, the kernel re-evaluates support in the active gravity
direction from contact identity and current solid geometry. This covers
anonymous solids and prevents stale `onGround` after a sign change.
`hitCeiling` remains a physical per-tick collision flag, so inverted actors
pressed against a ceiling observe it every supported tick; `justLanded` is the
one-tick entry event.

> Status: APPROVED for implementation.
> Proposal: `docs/design/platformer-kernel-proposal.md`.
> Research: `docs/research/platformer-kernel.md`.
> Architect: self-review (architect agent session returned empty; orchestrator decision per workflow §Step 6).

## Chosen approach

**Approach B: Composable Ability Processors.** A thin `PlatformerState` core (position, velocity, contacts, events) plus separate ability modules (`JumpAbility`, `WallSlideAbility`, `DashAbility`, `DoubleJumpAbility`), each with its own state slice and an `advance(core, input, state, dt, config) → { core, state }` function. The controller runs the pipeline in a fixed, deterministic order per tick.

## Why

1. **Avoids the god-function anti-pattern** — adding a new ability (grapple, swim, climb) means writing one new module and adding it to the pipeline. Zero changes to existing ability code or the kernel.
2. **Composes cleanly with `advanceJump`** — `JumpAbility` wraps `advanceJump(state.jump, inputs, dt, config.jump)` directly. No trajectory logic is duplicated.
3. **Supports multiple platformer families via presets** — precision uses `[jump, wallSlide, dash]`; momentum uses `[jump, dash]` with different config; combat adds `hitbox`. The kernel itself never changes.
4. **Each ability is independently unit-testable** with a mock `ActorCore`. Determinism is verifiable per-ability, not just for the whole pipeline.
5. **Replay-friendly** — the per-tick state is a plain record (`{ core, abilities }`) that serializes trivially. Determinism is verifiable by re-running the same input sequence and comparing state checksums.

## Resolutions to open questions (from proposal §Open Questions)

1. **Shared mutable `ActorCore` — REJECT the mutation pattern.** Each ability MUST receive an immutable `ActorCore` and return a new (shallow-copied) `ActorCore`. This honors `docs/architecture.md:43-58` (pure progression ops: never mutate input). Performance: 4–6 abilities × 1 shallow copy each = 24 shallow property copies per tick at 60 Hz = 1,440 copies/sec. Negligible. Purity > microoptimization.

2. **Solid identity — add `id?: string` to `Solid`.** Modify `src/collision/types.ts` to add an optional `id` field. Existing tests do not read it; the addition is non-breaking. The kernel populates `contacts.groundId`/`leftWallId`/`rightWallId`/`ceilingId` from the solid that caused each contact. Consumers assign stable string IDs to their moving platforms (static geometry may leave `id` undefined; the kernel uses `null` for "no id assigned" and the string for "identified solid").

3. **Carry tracking — include minimal `RidingTracker` in v1.** Moving-platform carry is in v1 scope (it is a precision-platformer staple), so deferring it leaves the kernel half-usable. Ship `src/platformer/riding-tracker.ts` with a small utility that:
   - Records `contacts.groundId` each tick.
   - When the consumer provides a `getSolidDisplacement(id) → { dx, dy } | null` callback, the kernel applies the displacement before abilities run (step 2 of the update order).
   - The consumer owns the displacement source (their `advanceGapMotion` call, their own platform animator, etc.).

4. **Pipeline serialization — fixed pipeline + config hash.** The pipeline is fixed per-controller-instance and not serialized directly. For replay, the consumer includes a config hash (computed via `canonicalize(config) + fnv1a`) and the pipeline's ability-kind ordering (a string array like `['jump', 'wallSlide', 'dash']`). At replay load, the consumer rebuilds the pipeline from the kind array. The library provides a `defaultPrecisionPipeline()` factory that returns the canonical pipeline; consumers extend by composing.

5. **Wall-jump cohesion — keep inside `WallSlideAbility`.** Wall-jump is a transition OUT of wall-slide; it makes semantic sense as part of the same module. The `WallSlideAbility` exposes a `wallJumpLaunched` event when it fires.

## Additional constraints discovered during review

1. **Internal state representation: `Record<string, AbilityState>`, not array+findIndex.** The proposal's `abilities.findIndex(a => a.kind === proc.kind)` is O(n) per ability per tick. Use a `Record<AbilityKind, AbilityState>` internally so pipeline iteration is O(1) per lookup. The public `PlatformerState.abilities` field exposes this as a readonly record.

2. **Strict purity for `ActorCore`.** `ActorCore` fields are `readonly`. Abilities use spread-and-override (`{ ...core, vy: newVy }`) to produce the next core. The kernel orchestrates this without any in-place mutation.

3. **The kernel MUST call existing primitives, not reinvent them.** Concrete call sites:
   - `JumpAbility.advance` → `advanceJump(state.jump, inputs, dt, config.jump)` from `src/animation/jump.ts`.
   - Kernel step 6 → `resolveAxisX(body, vx, solids)` and `resolveAxisY(body, vy, solids, prevBottom)` from `src/collision/resolve.ts`.
   - Kernel step 2 (carry) → applies consumer-provided displacement; does not move solids itself.
   - The kernel does NOT call `advanceLocomotionByDisplacement` or `updateCamera` — those stay consumer-side. The kernel produces `dx` (horizontal displacement) in events; the consumer feeds it forward.

4. **Strict TypeScript compliance.** `export type` for type-only re-exports. No `const enum`. File names lowercase-kebab. Every public export has JSDoc.

5. **Update order locked** (from proposal §Simulation Update Order):
   1. Move solids (consumer-driven — kernel reads displacements via callback)
   2. Carry actors (apply solid displacement to riding actors)
   3. Process inputs (poll edges, read moveX)
   4. Execute abilities (pipeline in fixed order: jump → wallSlide → dash → doubleJump)
   5. Integrate forces (gravity, clamped; skip during dash)
   6. Resolve actor collision (resolveAxisX then resolveAxisY)
   7. Update contacts & events

## Out of scope for v1 (deferred)

- Slopes (raycast or heightmap).
- Swimming / water physics.
- Ladders / climbing.
- Grapple hook (trivially added later via a new ability module — the architecture permits it).
- Combat / hitbox resolution.
- Multiple actors (enemies, NPCs) — the kernel is single-actor.
- Tile-grid wrappers (`resolveTileX`/`resolveTileY` integration) — v1 uses the solid-list API; tile-grid convenience is a thin follow-up.

## Files to implement

```
src/platformer/
├── types.ts              # PlatformerState, PlatformerConfig, PlatformerInput, ActorCore, Contacts, events, AbilityProcessor
├── constants.ts          # DEFAULT_PLATFORMER_CONFIG, DEFAULT_PLAYER_DIMENSIONS
├── kernel.ts             # createPlatformerController, stepPlatformer convenience wrapper
├── riding-tracker.ts     # RidingTracker utility (carry displacement application)
├── abilities/
│   ├── jump-ability.ts         # wraps advanceJump; ground-jump, coyote, buffer
│   ├── wall-slide-ability.ts   # wall-slide + wall-jump
│   ├── dash-ability.ts         # directional dash with cooldown + limited count
│   └── double-jump-ability.ts  # second jump in air (delegates to advanceJump)
├── pipelines.ts          # defaultPrecisionPipeline factory
└── index.ts              # Barrel export
```

Tests in `src/tests/`:
- `platformer-kernel.test.ts` — full pipeline integration tests
- `platformer-jump-ability.test.ts`
- `platformer-wall-slide.test.ts`
- `platformer-dash.test.ts`
- `platformer-double-jump.test.ts`
- `platformer-riding-tracker.test.ts`
- `platformer-determinism.test.ts` — 1000-tick replay produces byte-identical state checksum

## v1 conformance suite (must pass before merge)

1. **Coyote jump**: walk off edge, jump within coyote window → launches. Walk off edge, wait > coyoteTime, jump → no launch.
2. **Jump buffer**: press jump slightly before landing → launches on land.
3. **Variable height**: hold jump → full height. Tap jump → short hop.
4. **Wall slide**: airborne + touching wall + vy > 0 → wallSlide = true, vy capped.
5. **Wall jump**: wall-sliding + jump pressed → launches away from wall with vx.
6. **Dash**: dash pressed + cooldown === 0 → dash activates, timer counts down, vx/vy overridden.
7. **Double jump**: airborne + jumpCount < maxDashes → second jump fires.
8. **Moving platform carry**: actor on platform → platform moves → actor moves with platform.
9. **Determinism**: 1000-tick replay produces byte-identical state checksum.
10. **Replay round-trip**: serialize state every tick → deserialize → next tick is byte-identical.
