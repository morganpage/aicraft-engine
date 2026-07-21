# Decision: Deterministic Platformer Enemy Archetypes

> Status: **APPROVED — Approach A**

## Decision

Approve **Approach A: Extend EntityKind + Flat Enemy Runtime with Behavior Registry** from `platformer-enemy-archetypes-proposal.md`.

## Rationale

Approach A balances all constraints:
- The `EnemyBehaviorHandler` registry gives consumers extensibility without the complexity of the ability-pipeline pattern (Approach B).
- The `compileEnemies`/`stepEnemies` API mirrors the existing `compileLevel`/`stepPlatformer` pattern — consistent with established conventions.
- The `EnemyProps.archetype` discriminated union matches existing `TrapProps.type` and `TriggerProps.action` patterns — proven, serializable, editor-friendly.
- Approach C (minimal switch) blocks extensibility — every new enemy type would be a library release, unacceptable for a multi-game library.

## Answers to Open Questions

1. **Archetype type**: Use a **free string** for `archetype` with `'spinny' | 'turret'` as documented built-in values. The registry pattern requires free strings for extensibility. Type narrowing comes from the registry lookup, not the discriminated union.

2. **Projectile pool**: Use a **global flat array** returned from `stepEnemies`. Projectiles survive enemy death (standard for minimalist platformers). Simpler for rendering and collision.

3. **Module location**: `src/platformer/enemy/` (sub-module of platformer). Enemies share `Solid`, `Rect`, `ActorCore`, collision helpers with the platformer kernel. Top-level `src/enemy/` would break the composition grouping.

4. **CompiledEnemy back-ref**: Carry the **full `LevelEntity`** for rendering convenience. The entity is small and read-only. A separate lookup would add consumer complexity for no meaningful gain.

5. **Health field**: **No `health` field on `EnemyState`.** The MVP has no HP system. Adding it preemptively designs for an unmaterialized use case. Consumers can add health via `data?: Record<string, unknown>` if needed.

## Scope Guard

- No health/damage system
- No AI state machines
- No enemy-on-enemy collision
- No gravity for enemies
- No damage numbers, knockback, or i-frames

## Implementation Notes

- New files: `src/platformer/enemy/` with `types.ts`, `step.ts`, `projectile.ts`, `compile.ts`, `registry.ts`, `renderer.ts`, `index.ts`
- Modified: `src/level/types.ts`, `src/editor/catalog.ts`, `src/platformer/index.ts`, `src/index.ts`
- Level migration: non-breaking union expansion, no version bump
- Tests: one per behavior (spinny, turret) + projectile stepping + compile
- Ledge detection: use `worldToTile` from `src/collision/tiles.ts`
- Projectile tunneling: cap speed to `tileSize / dt`
- Player hit detection: consumer-owned; library provides overlap data

## Inputs

- Research: `docs/research/platformer-enemy-archetypes.md`
- Proposal: `docs/design/platformer-enemy-archetypes-proposal.md`
- Current architecture: `docs/architecture.md`, `docs/conventions.md`
- Existing patterns: `src/level/types.ts`, `src/platformer/level-runtime.ts`, `src/platformer/kernel.ts`, `src/editor/catalog.ts`
