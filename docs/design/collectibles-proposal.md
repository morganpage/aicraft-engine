# API Proposal: Collectibles / Pickups

> Target pillar: 4 (Level Schema) + 2 (Cosmetic Save). Module: `src/collectibles/` + `src/level/types.ts`.
> Builds on research: `docs/research/collectibles.md`.
> Status: DRAFT.

## Consumer Need

Every Clone-to-Jest title needs coins (score), keys (gating), and gems (meta-progression). Today, consumers abuse `trigger` with `action: 'pickup'` — a workaround that leaks through every layer: the editor has no catalog entry, the validator has no typed props, the renderer has no per-kind branch, and the runtime has no first-class collision surface. The fix is a schema change (additive union expansion) plus a new pure owned-state module that mirrors `cosmetics/ownership.ts`.

A level with 3 coins + 1 key should be declaratively specifiable, renderable with a distinct palette, validatable with typed props, and persistable with a clean `CollectibleSave` that survives JSON round-trip. Replays re-derive the same pickups from the same inputs — the kernel stays unaware.

---

## Approach A: Closed Kind Taxonomy (Single EntityKind, Typed Sub-kind)

**Source pattern:** Pattern 1 (Celeste Strawberries — first-class entities with persistent EntityIDs) + Pattern 4 (pure-progression-ops save). The sub-kind dispatch mirrors `EnemyProps.archetype` (lines 119-124 of `src/level/types.ts`).

**Signature sketch:**

```ts
// In src/level/types.ts — add to EntityKind union:
export type EntityKind =
  | 'spawn' | 'exit' | 'platform' | 'passthrough'
  | 'trap' | 'hazard' | 'decoration' | 'trigger'
  | 'movingPlatform' | 'enemy'
  | 'collectible';  // NEW

// In src/level/types.ts — new props interface:
export type CollectibleKind = 'coin' | 'gem' | 'key';

export interface CollectibleProps {
  /** Collectible sub-type. Dispatches to renderer palette and catalog prefabs. */
  readonly kind: CollectibleKind;
  /** Opaque numeric value (score, currency, etc.). Consumer owns semantics. */
  readonly value?: number;
  /** If true, collected state persists across runs (Celeste berry). Default false (Mario coin). */
  readonly persists?: boolean;
}

// Add variant to LevelEntity:
  | { readonly id: EntityId; readonly kind: 'collectible'; readonly rect: LevelRect; readonly props: CollectibleProps }
```

```ts
// In src/collectibles/types.ts:
export interface CollectibleSave {
  /** Collected entity IDs, sorted alphabetically. Never Set/Map. */
  collected: string[];
}
```

```ts
// In src/collectibles/collectibles.ts:
// entityId is string: entity IDs are number (EntityId) in the level schema,
// but the save stores them as string for canonical sorted-string[] serialization
// (mirrors CosmeticSave.owned). Consumer bridges with String(id).
export function collect(save: CollectibleSave, entityId: string): CollectibleSave;
export function hasCollected(save: CollectibleSave, entityId: string): boolean;
```

> **Per-level scoping is consumer-owned.** The library ships a flat `CollectibleSave` (`{ collected: string[] }`) — the consumer maintains a `Record<string, CollectibleSave>` keyed by level ID. "Reset for level" = the consumer drops or replaces that level's entry. This matches the library's "ship primitives, consumer owns orchestration" principle.

```ts
// In src/collectibles/derive-pickups.ts:
// Returns EntityId[] (number). Consumer bridges to CollectibleSave via String(id).
export function derivePickups(
  playerRect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  collectibles: readonly LevelEntity[],
  save: CollectibleSave,
): { collected: readonly EntityId[]; remaining: readonly LevelEntity[] };
```

**Usage example:**

```ts
import { mulberry32 } from './lib/aicraft-engine/src/rng';
import { compileLevel } from './lib/aicraft-engine/src/platformer/level-runtime';
import { derivePickups, collect, hasCollected } from './lib/aicraft-engine/src/collectibles';

// Level with 3 coins + 1 key:
const level = {
  version: 1, id: 'demo', name: 'Demo', width: 256, height: 256, tileSize: 16,
  spawn: { x: 16, y: 16 },
  tiles: { data: new Array(256).fill(0), cols: 16, rows: 16, tileSize: 16 },
  entities: [
    { id: 1, kind: 'spawn', rect: { x: 16, y: 16, width: 16, height: 16 }, props: {} },
    { id: 2, kind: 'collectible', rect: { x: 48, y: 48, width: 16, height: 16 }, props: { kind: 'coin', value: 10 } },
    { id: 3, kind: 'collectible', rect: { x: 80, y: 48, width: 16, height: 16 }, props: { kind: 'coin', value: 10 } },
    { id: 4, kind: 'collectible', rect: { x: 112, y: 48, width: 16, height: 16 }, props: { kind: 'coin', value: 10 } },
    { id: 5, kind: 'collectible', rect: { x: 144, y: 48, width: 16, height: 16 }, props: { kind: 'key', persists: true } },
    { id: 6, kind: 'exit', rect: { x: 200, y: 48, width: 16, height: 16 }, props: { isTrap: false, locked: false } },
  ],
  nextEntityId: 7,
};

// After each tick, derive pickups:
let save: CollectibleSave = { collected: [] };
const collectibles = level.entities.filter(e => e.kind === 'collectible');
const { collected } = derivePickups(playerRect, collectibles, save);
for (const id of collected) {
  save = collect(save, String(id));
}

// Check if the key has been collected:
hasCollected(save, '5'); // true after collecting the key
```

**Trade-offs:**
- **Ergonomics:** Excellent. `props.kind: 'coin'|'gem'|'key'` reads naturally; the consumer gets autocomplete and type checking for free. Catalog entries `coin`, `gem`, `key` map directly to the sub-kind.
- **Determinism:** Identical to Approach B and C. `derivePickups` is a pure function of `(playerRect, collectibles, save)`. The save layer is event-driven, never per-frame.
- **Runtime cost:** One AABB overlap per collectible per tick (via `aabbOverlap` from `src/collision/aabb.ts`). Negligible for ≤100 collectibles.
- **Consumer complexity:** Low. The consumer calls `derivePickups` after each tick and `collect` when IDs appear in the result. No kernel changes needed.
- **Schema stability:** Strong. The closed `CollectibleKind` union is extendable later (add `'heart' | 'star'`) via non-breaking union expansion. The `CollectibleProps` fields are all optional-defaulted — adding a new field is non-breaking.
- **Convention fit:** Matches `EnemyProps.archetype` pattern exactly. One `EntityKind`, multiple prefab entries in the catalog (`coin`, `gem`, `key` all pointing to `kind: 'collectible'`).

**What this makes easy:**
- Editor gets real prefab entries (`Add Coin`, `Add Gem`, `Add Key`) with zero consumer boilerplate
- Validator gets typed props (`CollectibleProps.kind` is a typed union, not a free string)
- Renderer gets per-kind palette entries (gold for coins, blue for gems, silver for keys)
- Save is a near-clone of `CosmeticSave` with the same discipline
- Replay stays free (pickups derived from deterministic collision)

**What this makes hard:**
- If a consumer needs a custom collectible kind beyond `coin|gem|key`, they must wait for a library union expansion (or use `value` to encode semantics and pick an existing kind)
- The `CollectibleKind` type is a second namespace — `CollectibleProps.kind` shadows `LevelEntity.kind`, which could confuse readers

---

## Approach B: Open String Kind (Single EntityKind, Free-String Sub-kind)

**Source pattern:** Pattern 3 (Sokpop Fake-3D — `isPickup` boolean discriminator) + `TrapProps.type` pattern (lines 78-83 of `src/level/types.ts`). The sub-kind is an open `string`, like `TrapProps.type`.

**Signature sketch:**

```ts
// In src/level/types.ts — add to EntityKind union:
  | 'collectible';

export interface CollectibleProps {
  /** Collectible type identifier (open string — consumer defines valid values). */
  readonly type: string;
  /** Opaque numeric value (score, currency, etc.). */
  readonly value?: number;
  /** If true, collected state persists across runs. Default false. */
  readonly persists?: boolean;
}
```

**Usage example:**

```ts
// Consumer defines their own types:
const coin = {
  id: 2, kind: 'collectible',
  rect: { x: 48, y: 48, width: 16, height: 16 },
  props: { type: 'coin', value: 10 },
};
const customGem = {
  id: 7, kind: 'collectible',
  rect: { x: 96, y: 48, width: 16, height: 16 },
  props: { type: 'crystal_heart', value: 100 },
};

// Catalog entry is generic:
// { kind: 'collectible', label: 'Collectible', defaultProps: { type: 'coin', params: {} } }
```

**Trade-offs:**
- **Ergonomics:** Good for power users, poor for beginners. The consumer must know valid `type` strings — no autocomplete, no compile-time checking. The generic catalog entry doesn't distinguish coins from keys in the UI.
- **Determinism:** Identical.
- **Runtime cost:** Identical.
- **Consumer complexity:** Higher. The consumer must maintain their own type registry and validate `type` strings. The renderer must dispatch on a free string, not a typed union.
- **Schema stability:** Weakest. Any `type` string is valid, so the validator can only check `typeof props.type === 'string'`. Custom types can be added without the library, but the renderer and catalog have no opinion about them.
- **Convention fit:** Matches `TrapProps.type` (free string). But `TrapProps` uses a free string because trap behavior is entirely consumer-owned — collectibles have a finite, known set of visual variants. The open string is over-generalized for this use case.

**What this makes easy:**
- Consumer can add custom collectible types (`'crystal_heart'`, `'star'`) without a library update
- No union expansion needed for custom kinds

**What this makes hard:**
- Editor catalog gets one generic "Collectible" entry instead of "Coin" / "Gem" / "Key" — worse UX
- Renderer cannot provide sensible per-kind defaults — the consumer must always supply a palette override
- Validator cannot catch typos in `type` strings at compile time
- Breaks the pattern established by `EnemyProps.archetype` which, despite being a free string, has a finite set of built-in archetypes with typed validation

---

## Approach C: Flat EntityKind Expansion (Multiple EntityKinds)

**Source pattern:** No direct prior art in the codebase. This is the "add three new kinds to `EntityKind`" approach — `'coin'`, `'gem'`, `'key'` as separate entity kinds, each with its own props interface.

**Signature sketch:**

```ts
// In src/level/types.ts — add three new kinds:
export type EntityKind =
  | 'spawn' | 'exit' | 'platform' | 'passthrough'
  | 'trap' | 'hazard' | 'decoration' | 'trigger'
  | 'movingPlatform' | 'enemy'
  | 'coin' | 'gem' | 'key';  // THREE new variants

export interface CoinProps {
  readonly value?: number;
}
export interface GemProps {
  readonly value?: number;
}
export interface KeyProps {
  readonly persists?: boolean;
}

// Three new LevelEntity variants:
  | { readonly id: EntityId; readonly kind: 'coin'; readonly rect: LevelRect; readonly props: CoinProps }
  | { readonly id: EntityId; readonly kind: 'gem'; readonly rect: LevelRect; readonly props: GemProps }
  | { readonly id: EntityId; readonly kind: 'key'; readonly rect: LevelRect; readonly props: KeyProps }
```

**Usage example:**

```ts
const coin = {
  id: 2, kind: 'coin',
  rect: { x: 48, y: 48, width: 16, height: 16 },
  props: { value: 10 },
};

// Save is keyed by EntityKind:
// derivedPickups still works the same way
const { collected } = derivePickups(playerRect, level.entities, save);
```

**Trade-offs:**
- **Ergonomics:** Mixed. Exhaustive switches on `EntityKind` now require three more branches. The consumer gets perfect type narrowing per kind (`entity.kind === 'coin'` narrows to `CoinProps`), but the sheer number of variants bloats every switch.
- **Determinism:** Identical.
- **Runtime cost:** Identical (maybe marginally worse — three more branches in every `switch` on `EntityKind`).
- **Consumer complexity:** Higher. Every file that dispatches on `EntityKind` needs three new cases. The editor catalog needs three new entries. The renderer needs three new palette entries and three new override hooks. The validator needs three new prop-shape checks. The `makeEntity` switch needs three new cases.
- **Schema stability:** Weakest of all. Adding a new collectible type (e.g. `'heart'`) requires a new `EntityKind` variant, a new props interface, a new `LevelEntity` variant, and updates to every dispatch site. The blast radius for each new collectible type is the full `EntityKind` expansion.
- **Convention fit:** Breaks the established pattern. Enemies use one `EntityKind` (`'enemy'`) with an `archetype` sub-kind dispatch. Traps use one `EntityKind` (`'trap'`) with a `type` sub-kind dispatch. Adding three separate kinds for what is conceptually one category (collectible) is inconsistent with the existing taxonomy.

**What this makes easy:**
- Perfect TypeScript narrowing per kind
- No nested `props.kind` dispatch — the entity kind IS the collectible type

**What this makes hard:**
- Every `EntityKind` dispatch site needs three new branches (validate, migrate, catalog, renderer, operations)
- Adding a new collectible type (e.g. `'heart'`) in v2 requires ANOTHER `EntityKind` expansion — full blast radius again
- Breaks the "one kind, sub-kind dispatch" pattern established by `enemy` and `trap`
- The `derivePickups` function must filter by three separate kinds instead of one

---

## Comparison Table

| Criterion | A: Closed Kind Union | B: Open String Kind | C: Flat Expansion |
|---|---|---|---|
| **Ergonomics** | Excellent — autocomplete, typed dispatch | Good for power users, poor for beginners | Mixed — perfect narrowing but bloated switches |
| **Determinism** | Identical | Identical | Identical |
| **Runtime cost** | O(n) AABB per tick | O(n) AABB per tick | O(n) AABB per tick |
| **Consumer complexity** | Low — one `derivePickups` call | Higher — must maintain type registry | Higher — three kind branches everywhere |
| **Schema stability** | Strong — union expansion is additive | Weakest — no compile-time safety | Weakest — adding a type requires full EntityKind expansion |
| **Convention fit** | Matches `enemy`/`trap` pattern exactly | Matches `trap` pattern (over-generalized) | Breaks established taxonomy |
| **Blast radius** | Smallest — one new kind, one new variant | Smallest — one new kind, one new variant | Largest — three new kinds, three new variants |
| **Extensibility** | Add `'heart'` to `CollectibleKind` union — one-line change | Add any string — no library change | Add new `EntityKind` + props + variant — full blast radius |
| **Renderer defaults** | Per-kind palette (gold/blue/silver) | Generic — consumer must override | Per-kind palette (same as A) |

---

## Recommendation

**Approach A: Closed Kind Taxonomy.** It matches the established `EnemyProps.archetype` pattern exactly (one `EntityKind`, multiple prefab entries via sub-kind dispatch), gives defensive parsing for free via the typed `CollectibleKind` union, has the smallest blast radius (one new `EntityKind` variant, not three), and is extensible via non-breaking union expansion. The research note recommends this approach for v1, and Spitekeep's existing enemy catalog (`spinny`/`turret`/`spider` all pointing to `kind: 'enemy'`) is the proven precedent.

The closed `CollectibleKind` union (`'coin' | 'gem' | 'key'`) is the right trade-off: it covers the three archetypal use cases (score, gating, meta-progression) with compile-time safety, and adding a fourth kind later is a one-line union expansion — no blast radius. Consumers who need truly custom collectible types can use the `value` field to encode semantics and pick the closest built-in kind, or wait for the v2 union expansion.

---

## Open Questions for @architect

1. **`CollectibleKind` extensibility boundary.** The closed union `'coin' | 'gem' | 'key'` covers v1. Should we document that custom collectible types are out of scope for v1, or should we add a `custom?: string` escape hatch to `CollectibleProps`? (I recommend documenting it as out-of-scope — the escape hatch adds complexity for a case that hasn't been needed yet.)

2. **`derivePickups` placement.** Should it live in `src/collectibles/derive-pickups.ts` (a dedicated file), or in `src/collectibles/collectibles.ts` alongside the save ops? I lean toward a dedicated file because it has a different dependency profile (`aabbOverlap` from `src/collision/aabb.ts` + `LevelEntity` from `src/level/types.ts`) than the save ops (which have zero dependencies beyond `CollectibleSave`).

3. **`CollectibleSave` scope (SETTLED).** Per-level scoping is consumer-owned. The library ships a flat `CollectibleSave` (`{ collected: string[] }`) — the consumer maintains a `Record<string, CollectibleSave>` keyed by level ID. "Reset for level" = the consumer drops or replaces that level's entry. This matches the library's "ship primitives, consumer owns orchestration" principle. No `resetForLevel` op is shipped.

4. **Renderer palette entries.** The three default palette keys are `collectibleCoin` (gold), `collectibleGem` (blue), `collectibleKey` (silver). All three meet WCAG AA contrast against the near-black `DEFAULT_OUTLINE_COLOR` (`#1d1128`): gold ≈ 12.5:1, blue ≈ 5.2:1, silver ≈ 9.8:1 — all ≥ 4.5:1. Each key's JSDoc comment documents the ratio.

5. **`level-runtime.ts` and `compileLevel`.** The existing `compileLevel` already ignores non-solid kinds via the comment on line 207-208 ("Other kinds ... are not collision surfaces and are intentionally ignored here"). Collectibles fall through correctly — no change needed to `compileLevel`. Should we add an explicit `else if (entity.kind === 'collectible')` comment to make the intent clearer, or is the existing fallthrough sufficient?

---

## Blast Radius — Every File That Must Change

### Schema / Types (Pillar 4)

| File | Change | Why |
|---|---|---|
| `src/level/types.ts` | Add `'collectible'` to `EntityKind`. Add `CollectibleKind` type. Add `CollectibleProps` interface. Add variant to `LevelEntity`. | The schema change — additive union expansion. |
| `src/level/validate.ts` | Add `case 'collectible':` to `validatePropsByKind` (lines 265-362). Validate `kind` is a valid `CollectibleKind`, `value` is `number \| undefined`, `persists` is `boolean \| undefined`. | Typed validation for the new props shape. |
| `src/level/migrate.ts` | No code change needed. The forward-ladder pattern is version-number-driven; the consumer supplies the migration step. The library's `migrateLevel` runner is generic. | The additive union expansion is non-breaking — old levels (v1) with zero `collectible` entities are still valid. |

### Editor (Pillar 4)

| File | Change | Why |
|---|---|---|
| `src/editor/catalog.ts` | Add `collectible` to `DEFAULT_RECT_BY_KIND`, `DEFAULT_PROPS_BY_KIND`, `DEFAULT_LABEL_BY_KIND`. Add `coin`, `gem`, `key` prefab entries to `DEFAULT_CATALOG` (each pointing to `kind: 'collectible'` with the appropriate `CollectibleProps`). | Editor needs catalog entries for the new kind. One entry per sub-kind matches the `spinny`/`turret`/`spider` pattern. |
| `src/editor/operations.ts` | Add `case 'collectible':` to `makeEntity` switch (lines 94-172). Cast props to `CollectibleProps`. | The `makeEntity` function constructs `LevelEntity` variants by kind; it needs a new case. |

### Renderer (Pillar 1)

| File | Change | Why |
|---|---|---|
| `src/platformer/renderer.ts` | Add `collectibleCoin`, `collectibleGem`, `collectibleKey` named palette keys to the existing `DEFAULT_ENTITY_PALETTE` (each with inline JSDoc comment documenting WCAG AA contrast ratio against `DEFAULT_OUTLINE_COLOR` `#1d1128`: gold ≈ 12.5:1, blue ≈ 5.2:1, silver ≈ 9.8:1 — all ≥ 4.5:1 AA). Add `collectible?: (ctx, entity) => boolean` to `DrawLevelEntityOverrideMap`. Add `'collectible'` to `SOLID_FEELING_KINDS`. Add sub-kind dispatch in `drawLevelEntity` (read `entity.props.kind` to pick the named palette key). | Renderer needs to draw collectibles with a distinct, solid-feeling palette. Per-sub-kind palette dispatch mirrors the `enemy` color convention. No bare hex strings — all palette entries are named constants. |

### New Module: `src/collectibles/`

| File | Change | Why |
|---|---|---|
| `src/collectibles/types.ts` | `CollectibleSave` interface (`{ collected: string[] }`). | Save type definition — mirrors `CosmeticSave`. |
| `src/collectibles/collectibles.ts` | `collect`, `hasCollected` functions. Pure ops mirroring `cosmetics/ownership.ts`. | The save ops layer. |
| `src/collectibles/derive-pickups.ts` | `derivePickups(playerRect, collectibles, save)` function. Uses `aabbOverlap` from `src/collision/aabb.ts`. | The deterministic pickup derivation. Consumer calls after each tick. |
| `src/collectibles/index.ts` | Barrel export. | Module barrel — convention. |
| `src/tests/collectibles.test.ts` | Tests for `collect`, `hasCollected`. | Unit tests — convention: `src/tests/*.test.ts`. |
| `src/tests/derive-pickups.test.ts` | Tests for `derivePickups`. | Unit tests — convention: `src/tests/*.test.ts`. |

### Top-Level Barrel

| File | Change | Why |
|---|---|---|
| `src/index.ts` | Add `export * from './collectibles';`. | Re-export from top-level barrel for convenience. |

### Documentation

| File | Change | Why |
|---|---|---|
| `docs/api-surface.md` | Add `src/collectibles/` section with export table (types, ops, derive-pickups, constants). Update `src/level/types.ts` section to reflect new `CollectibleKind` + `CollectibleProps` + `LevelEntity` variant. | Canonical export map must match `src/`. |

### Tests for Changed Files

| File | Change | Why |
|---|---|---|
| `src/tests/validate.test.ts` (or equivalent) | Add test cases for `collectible` entity validation. | Validate the new props shape. |
| `src/tests/catalog.test.ts` (or equivalent) | Verify `DEFAULT_CATALOG` includes `coin`, `gem`, `key` entries. | Catalog integrity. |
| `src/tests/renderer.test.ts` (or equivalent) | Verify `drawLevelEntity` handles `collectible` kind. | Renderer dispatch. |

### Files That Do NOT Change (Confirmed)

| File | Why no change |
|---|---|
| `src/level/migrate.ts` | Generic ladder runner; the consumer supplies steps. |
| `src/platformer/level-runtime.ts` | `compileLevel` already ignores non-solid kinds via fallthrough (line 207-208). Collectibles are not collision surfaces. |
| `src/platformer/kernel.ts` | Kernel is unaware of collectibles. Pickups are consumer-derived. |
| `src/level/serialize.ts` | Generic `canonicalize`/`fnv1a` — handles any JSON-safe shape. |
| `src/collision/aabb.ts` | Already exports `aabbOverlap` — no changes needed. |

---

## Implementation Notes for @coder

1. **Mirror `cosmetics/ownership.ts` exactly.** The `collect` function should be a near-clone of `grantSkin` (lines 61-69 of `src/cosmetics/ownership.ts`): `cloneSave` → check `includes` → `push` + `sort` → return. The `cloneSave` helper should be a private function inside `collectibles.ts` (same pattern as `ownership.ts:36-42`).

2. **Sorted `string[]` invariant.** After every `collect` call, `save.collected` must be alphabetically sorted. Never use `Set`/`Map`. This guarantees canonical serialization regardless of grant order.

3. **Never-throw contract.** Invalid entity IDs (empty string, non-string), already-collected IDs, and malformed saves all degrade to a no-op. The `cloneSave` helper must normalize missing/wrong-typed fields (same as `ownership.ts:39-41`).

4. **`derivePickups` uses `aabbOverlap`.** Import from `src/collision/aabb.ts`. The strict overlap test (edges touching = NOT overlapping) is correct for collectibles — a player standing exactly on a coin's edge should not collect it.

5. **Renderer sub-kind dispatch.** The `drawLevelEntity` function currently dispatches on `entity.kind` for the solid/dashed treatment. For `'collectible'`, it should additionally read `entity.props.kind` to pick the palette entry. This is a two-level dispatch — the outer switch is on `EntityKind`, the inner read is on `CollectibleProps.kind`. The existing `color = palette[entity.kind]` pattern won't work for the three sub-kinds; you'll need something like:

```ts
case 'collectible': {
  const subKind = (entity.props as CollectibleProps).kind;
  const subColor = palette[`collectible${subKind.charAt(0).toUpperCase()}${subKind.slice(1)}` as keyof EntityPalette];
  outlineRect(ctx, r.x, r.y, r.width, r.height, subColor, DEFAULT_OUTLINE_COLOR);
  return;
}
```

Or, more cleanly, add a `collectibleCoin`, `collectibleGem`, `collectibleKey` palette entry and dispatch on `props.kind`.

6. **Catalog prefab entries.** Add `coin`, `gem`, `key` entries to `DEFAULT_CATALOG` that all have `kind: 'collectible'` and the appropriate `CollectibleProps`. This matches the `spinny`/`turret`/`spider` pattern (lines 141-158 of `src/editor/catalog.ts`).

7. **`CollectibleSave` is NOT `readonly`.** Fields are intentionally mutable (same as `CosmeticSave`). The clone-then-return discipline in the ops functions enforces purity at the call-site level, not via field modifiers.
