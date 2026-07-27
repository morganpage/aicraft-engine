# Decision: Collectibles / Pickups

> Date: 2026-07-26. Stage 6 (Decide) for the `collectibles` technique.

## Decision

**Adopt Approach A from `docs/design/collectibles-proposal.md`: a first-class
`'collectible'` `EntityKind` with a closed `CollectibleKind` sub-union
(`'coin' | 'gem' | 'key'`) dispatched via `CollectibleProps` (mirrors
`EnemyProps.archetype`), plus a new pure `src/collectibles/` module
(`CollectibleSave` + `collect`/`hasCollected` ops + `derivePickups`).** The
platformer KERNEL stays unaware of collectibles — pickups are consumer-derived
from deterministic AABB collision, so they re-sim for free with zero replay
impact.

## Rationale

The research note (`docs/research/collectibles.md`) confirms the level entity
taxonomy has no collectible kind and consumers currently abuse `trigger` for
coins — costing the editor a catalog entry, the renderer a branch, the
validator a typed props shape, and the runtime a first-class collision surface.
A first-class `'collectible'` kind is a documented "non-breaking union
expansion" (the forward-ladder migration is a no-op for levels without
collectibles). The closed `CollectibleKind` sub-union mirrors the established
`EnemyProps.archetype` dispatch pattern and gives defensive parsing + compile-
time safety for free. The owned-state ops mirror `cosmetics/ownership.ts`
exactly (JSON-clone / never mutate / never throw / sorted `string[]`). The
`@architect` returned **APPROVED** after one revision loop: loop 1 raised one
blocker (`resetForLevel(save, levelId)` was incoherent against a flat
`CollectibleSave` — resolved by REMOVING it; per-level scoping is consumer-owned
via `Record<levelId, CollectibleSave>`) + 2 mediums (test path `__tests__/`→
`src/tests/`; renderer palette magic hex → named `DEFAULT_ENTITY_PALETTE` keys
with WCAG AA rationale) + 2 lows; loop 2 confirmed all resolved, no regressions.
No benchmark runs: the renderer change is a simple solid-rect-per-kind palette
addition whose WCAG ratios the architect pre-verified (gold/blue/silver all
≥ 4.5:1 AA against `#1d1128`); the deterministic logic is unit-tested via a fake
`ctx` + pure-op tests.

Approach B (open-string `type`) was rejected — loses compile-time safety and
defensive parsing. Approach C (three flat `EntityKind` variants) was rejected —
largest blast radius, breaks the established taxonomy.

## Resolved questions (binding for implementation)

1. **`CollectibleKind` is a closed union** (`'coin' | 'gem' | 'key'`). Custom
   kinds are out of scope for v1 (consumers use `value` for custom semantics);
   adding a fourth is a non-breaking union expansion later. No `custom?` escape
   hatch.
2. **`persists?` defaults to `false`** (per-run respawn, Mario-style). Persistent
   collectibles opt in explicitly.
3. **Per-level scoping is CONSUMER-OWNED.** The library ships a flat
   `CollectibleSave` (`{ collected: string[] }`). The consumer maintains
   `Record<levelId, CollectibleSave>`; "reset for level" = drop/replace that
   level's entry. **No `resetForLevel` op is shipped.**
4. **Pickups are consumer-derived** via the pure `derivePickups(playerRect,
   collectibles, save)`. The kernel emits NO `justCollected` event; it stays
   pure and unaware.
5. **Renderer: solid-feeling** with named `DEFAULT_ENTITY_PALETTE` keys
   (`collectibleCoin` ≈ `#ffd700`, `collectibleGem` ≈ `#4a9eff`,
   `collectibleKey` ≈ `#c0c0c0`), each with inline WCAG AA contrast ratio
   against `DEFAULT_OUTLINE_COLOR` `#1d1128`.
6. **Catalog: one prefab per kind** (`coin`, `gem`, `key`), matching the
   `spinny`/`turret`/`spider` enemy pattern.
7. **`EntityId` (number) vs save-id (string) asymmetry is documented** — entity
   IDs are `number` in the schema; the save stores them as `string` for canonical
   sorted-`string[]` serialization (mirrors `CosmeticSave.owned`). The consumer
   bridges with `String(id)`.

## Scope (v1) — blast radius

### Schema change (additive)
- `src/level/types.ts` — add `'collectible'` to `EntityKind`; add `CollectibleKind`, `CollectibleProps` (`{ kind: CollectibleKind; value?: number; persists?: boolean }`); add the `LevelEntity` variant.
- `src/level/validate.ts` — add `case 'collectible':` validation (typed props).
- `src/level/migrate.ts` — no-op forward step (additive; levels without collectibles pass through unchanged).

### Editor + renderer
- `src/editor/catalog.ts` — add `collectible` to the `DEFAULT_*` maps; add `coin`, `gem`, `key` prefab entries to `DEFAULT_CATALOG`.
- `src/editor/operations.ts` — add `case 'collectible':` to `makeEntity`.
- `src/platformer/renderer.ts` — add `collectibleCoin`/`collectibleGem`/`collectibleKey` named keys to `DEFAULT_ENTITY_PALETTE` (each with inline WCAG AA JSDoc); add `collectible` to `SOLID_FEELING_KINDS`; add sub-kind palette dispatch in `drawLevelEntity`.

### New module `src/collectibles/`
- `src/collectibles/types.ts` — `CollectibleSave` (`{ collected: string[] }`), `CollectibleEntity` (a `LevelEntity` narrow). `@module` header.
- `src/collectibles/collectibles.ts` — `collect(save, entityId)`, `hasCollected(save, entityId)`. Pure-progression-ops (mirror `cosmetics/ownership.ts`).
- `src/collectibles/derive-pickups.ts` — `derivePickups(playerRect, collectibles, save) → { collected: readonly EntityId[]; remaining: readonly CollectibleEntity[] }`. Pure; consumes `aabbOverlap`.
- `src/collectibles/constants.ts` — `DEFAULT_COLLECTIBLE_RECT`, `DEFAULT_COLLECTIBLE_VALUE`.
- `src/collectibles/index.ts` — barrel.
- `src/index.ts` — add `export * from './collectibles';`.

### Tests
- `src/tests/collectibles.test.ts` — `collect`/`hasCollected` mirror cosmetics-ownership tests (clone / never mutate / never throw / sorted / idempotent / JSON-roundtrip-safe).
- `src/tests/derive-pickups.test.ts` — purity; overlap → collected; no-overlap → unchanged; already-collected skipped; `remaining` excludes collected; determinism.
- Extend `src/tests/level-validate.test.ts` (collectible props validation), `src/tests/editor-catalog.test.ts` (3 new prefabs), `src/tests/editor-operations.test.ts` (`makeEntity('collectible')`), `src/tests/platformer-renderer.test.ts` (collectible draw branch via fake ctx).
- `src/tests/barrel-contract.test.ts` — collectibles assertions.

### Docs
- `docs/api-surface.md` — flip collectibles from PROPOSED to shipped.
- `README.md` — add a `2. Collectibles` row (Pillar 2) and note the `collectible` level kind.

## Inputs that drove this decision

- `docs/research/collectibles.md` (Celeste/Mario/Sokpop prior art; pure-progression-ops ownership; derived-collision determinism).
- `docs/design/collectibles-proposal.md` (Approach A, revised).
- `@architect` critique loop 1 (NEEDS REVISION — blocker + 2 mediums + 2 lows) + loop 2 (APPROVED).
