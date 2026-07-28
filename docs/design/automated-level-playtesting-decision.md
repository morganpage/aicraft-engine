# Decision: Automated Level Playtesting

**Status:** APPROVED DIRECTION — amended by the canonical implementation plan.
**Date:** 2026-07-28
**Loop:** 2 of max 2 architect critique loops.

> **Implementation authority:** `docs/design/level-generation-quality-implementation-plan.md`.
> The amendment preserves hybrid static + simulation analysis while correcting
> TypeScript assignability, collision compilation, and result semantics.

## Chosen approach

**Hybrid Static + Simulation Portfolio** (evolved from Approach C in
`docs/design/automated-level-playtesting-proposal.md`).

Static analysis supplies fast diagnostics and proofs only where its abstraction is
sound. A deterministic portfolio of simulation policies supplies winning replays.
Unsupported or exhausted analyses return `inconclusive`.

Generic deterministic orchestration lives in `src/simtest/`; `src/leveltest/` is
the standard platformer adapter. Consumer games own actions and state outside
`PlatformerInput`, such as gravity flips, room transitions, and checkpoints.

## Orchestrator decision on the type-system violation

The architect's loop-2 critique flagged a hard type-system violation:
`WinCondition = (state, entities) => boolean` is incompatible with predicates that
require collectible state.

**Amended decision:** require the save parameter:

```ts
type WinCondition = (
  state: PlatformerState,
  entities: readonly LevelEntity[],
  save: Readonly<CollectibleSave>,
) => boolean;
```

The bot owns a save from tick zero. Two-argument predicates remain assignable because
they may ignore extra arguments; predicates requiring `save` are now type-safe.

## Secondary objections (follow-ups, not blocking v1)

1. **`BotContext.movingPlatforms` semantic ambiguity** — the type is the unadvanced descriptor. Rename to `compiledMovingPlatforms` in v1 and document that the bot calls `advanceMovingPlatform` itself. A future `AdvancedMovingPlatform` wrapper type is deferred to v2.
2. **`Surface.id` ↔ `Solid.id` fragility** — `Solid.id` is optional. v1 documents the invariant that `compileLevel` always assigns ids to `staticSolids` entries. If a future Solid source omits id, `buildReachGraph` skips it (documented behavior).

## Rationale for the chosen approach

The architect approved the revised proposal with 19 of 20 objections fully addressed. The remaining objection (WinCondition type) is resolved by the orchestrator decision above. Approach C was the api-designer's recommendation:

1. **Combines complementary evidence without overclaiming** — a winning simulation
   proves beatability; sound static analysis may prove unreachable; bounded failures
   and unsupported mechanics remain inconclusive.
2. **Fast CI diagnostics** — static analysis flags obvious issues in sub-ms and may
   skip simulation only when its abstraction soundly proves failure.
3. **Reuses existing infrastructure** — `stepPlatformer` (deterministic kernel), `compileLevel` (solids + initial state), `replayHash` (32-bit fingerprint for golden fixtures), `derivePickups` (collectible reach). No new physics, no new collision.
4. **Convention fit** — pure, deterministic, never-throw, no-mutate, JSDoc-complete, zero-dep, barrel-exported. All 20 architect objections addressed or resolved.

## Implementation plan

Follow phases 0–7 in
`docs/design/level-generation-quality-implementation-plan.md`. Explicit tile
semantics and one authoritative physics configuration are prerequisites. The module
is not marked shipped until tri-state verification and the plan's acceptance criteria
pass.

## Follow-ups (not blocking v1)

- `AdvancedMovingPlatform` wrapper type for v2.
- MCTS bot policy as an alternative to greedy seek (v2).
- Time-varying surface BFS (v2).
- Softlock detection (v2, opt-in).
