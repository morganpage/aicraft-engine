# Collectibles / Pickups

> Research note for the collectibles / pickups subsystem. Slug: `collectibles`.
> Investigated: 2026-07-27.

## TL;DR

The `EntityKind` discriminated union in `src/level/types.ts` currently has no `collectible` kind, and consumers are forced to abuse `trigger` (with `action: 'pickup'`) to represent coins/gems/keys — a misuse that costs the editor a catalog entry, the renderer a per-kind branch, the validator a typed props shape, and the runtime a first-class collision surface. The gap is a **schema change** (additive union expansion), not a refactor: every file that dispatches on `EntityKind` must learn the new kind, but the change is non-breaking for existing levels (forward-ladder migration v1→v2 is a no-op for levels that contain zero `collectible` entities). The top recommendation is to ship a **first-class `collectible` kind** with a `CollectibleProps` shape `{ kind: 'coin'|'gem'|'key'; value?: number; persists?: boolean }` (mirroring `TrapProps.type` / `EnemyProps.archetype`), a **derived collision model** where pickups are re-derived from deterministic player-rect overlap inside the platformer tick (no replay impact — the replay just re-derives the same pickups from the same inputs), and a **pure-progression-ops `CollectibleSave`** mirroring `cosmetics/ownership.ts` (sorted `string[]` of collected entity ids, never `Set`/`Map`, JSON-clone in / fresh out / never throws). The `persists?: boolean` flag distinguishes per-run (respawn on retry, default) from persistent (saved across runs, like Celeste strawberries or Mario Maker pink coins) without splitting the kind into two variants.

## Why this matters for aicraft-engine

- **Pillars Touched**: Extends **Pillar 4 (Fake-3D / Level Loading)** with a new entity kind; integrates with **Pillar 2 (Cosmetics)** via the pure-progression-ops save discipline; supports **Pillar 1 (Primitives)** via the renderer dispatch.
- **Consumer Games**: Spitekeep (now IMP - Not a Troll) and every future Clone-to-Jest title needs coins/gems/keys for score, gating, and meta-progression. The current "abuse `trigger`" workaround leaks through every layer (editor catalog, validator, renderer, runtime) and forces every consumer to write the same boilerplate.
- **Unlocks**:
  - **Editor catalog gets real prefab entries** (`Add Coin`, `Add Gem`, `Add Key`) instead of a generic `Add Trigger` with a magic `action` string.
  - **Validator gets typed props** (`CollectibleProps.kind` is a typed union, not a free string) — defensive parsing becomes trivial.
  - **Renderer gets a per-kind branch** (collectibles draw with a distinct palette entry, e.g. gold for coins, blue for gems, silver for keys).
  - **Runtime gets first-class collision** (player rect overlaps collectible rect → collected event) — derived deterministically from the same inputs the kernel already processes.
  - **Save gets a pure-progression-ops surface** mirroring `cosmetics/ownership.ts` — JSON-clone in / fresh out / never throws / sorted string arrays.
  - **Replay stays free** — pickups are derived from deterministic collision, so a replay just re-derives the same pickups from the same inputs. The persistent save is the only non-deterministic surface, and it's a pure op.

---

## Prior Art Survey

### Pattern 1: Celeste Strawberries — First-Class Entities with Persistent EntityIDs

- **Source**: [Celeste Wiki — Entities](https://celeste.ink/wiki/Entities), [EverestAPI/Resources — Settings, SaveData and Session](https://github.com/EverestAPI/Resources/wiki/Settings,-SaveData-and-Session), [Celeste Saves — savedata.md](https://github.com/frissyn/celeste-saves/blob/master/savedata.md)
- **What it does**: Strawberries are first-class entities in Celeste's level format with a `Persistent` BitTag (`Persistent`: "The entity will not be removed when transitioning to the next level"). Each strawberry has a stable `EntityID` of the form `"<checkpoint>:<order>"` (e.g., `"2:11"` = checkpoint 2, berry 11). The save file tracks collected berries as a sorted list of these EntityIDs in `AreaModeStats.Strawberries`:
  ```xml
  <Strawberries>
    <EntityID Key="2:11"/>
    <EntityID Key="3:9"/>
    <EntityID Key="3b:2"/>
  </Strawberries>
  ```
  Celeste splits persistence into two layers: `Session` (current playthrough — deaths, time, currently-following strawberries, current room — reset on Restart Chapter) and `SaveData` (all-time collected strawberries, total dashes, file stamps — only reset when the save file is deleted).

- **Algorithmic shape** (the contract we want to mirror):
  ```typescript
  // Entity shape (Celeste's Strawberry class is much richer; this is the
  // schema-relevant subset):
  interface StrawberryEntity {
    readonly id: string;        // stable EntityID, e.g. "2:11"
    readonly position: { x: number; y: number };
    readonly persistent: true;  // BitTag
  }

  // Save shape (from Celeste's AreaModeStats):
  interface AreaModeStats {
    readonly Strawberries: readonly string[];  // sorted EntityIDs
  }
  ```

- **Determinism profile**: The collision (player touches strawberry rect) is fully deterministic. The save is the only non-deterministic surface, and it's a pure data record. Replays re-derive the same collection events from the same inputs.
- **Runtime cost**: One AABB overlap test per collectible per tick. Negligible for typical level sizes (≤100 collectibles).
- **Dependencies**: None.
- **Fit for our constraints**: **Strong.** The EntityID pattern is exactly what we already have (`EntityId = number` from `src/level/types.ts:37`). The sorted `string[]` save pattern is exactly what `cosmetics/ownership.ts` already does.
- **What to steal**: The first-class entity model (collectible is a `LevelEntity`, not a `trigger` with a magic action). The stable EntityID for save tracking. The split between per-run (Session) and persistent (SaveData) state — we can mirror this with the `persists?: boolean` flag.
- **What to avoid**: Celeste's BitTag system is over-engineered for our needs. A simple boolean flag is sufficient. Celeste's "follow the player for 9 frames in the safe zone" collection rule is gameplay-specific and not relevant — we want simple rect-overlap pickup.

### Pattern 2: Super Mario Maker Pink Coins — Per-Level-Instance vs Persistent via Checkpoint

- **Source**: [Pink Coin — Kaizo Mario Maker Wiki](https://kaizomariomaker.fandom.com/wiki/Pink_Coin), [Checkpoint Flag — Super Mario Maker 2 Wiki](https://supermariomaker2.fandom.com/wiki/Checkpoint_Flag), [Celebrating Mario Maker — fasterthanli.me](https://fasterthanli.me/articles/celebrating-mario-maker)
- **What it does**: Mario Maker distinguishes two collectible persistence modes:
  - **Regular coins**: per-run only. Respawn on death. Score resets.
  - **Pink coins**: persistent across deaths within a checkpoint scope. The Checkpoint Flag is the persistence boundary — touching a checkpoint saves which pink coins were collected. Dying with the key (after collecting all pink coins) resets them ("key death").

  This is the canonical example of a `persists?: boolean` flag with a checkpoint-scoped save boundary.

- **Algorithmic shape**:
  ```typescript
  // The persistence boundary is the checkpoint, not the level:
  interface CheckpointState {
    readonly collectedPinkCoinIds: readonly string[];  // sorted, per-checkpoint
  }
  // Regular coins are NOT in the save — they're derived from the level
  // schema + the player's current run state.
  ```

- **Determinism profile**: Same as Celeste — collision is deterministic, save is the only non-deterministic surface.
- **Runtime cost**: Same as Celeste.
- **Dependencies**: None.
- **Fit for our constraints**: **Strong.** The `persists?: boolean` flag maps cleanly to our `ExitProps.locked` pattern (boolean flag on props, default false). The checkpoint-scoped save is a v2 feature; v1 can ship with level-scoped persistence.
- **What to steal**: The boolean flag pattern. The distinction between per-run (respawn on retry) and persistent (saved across runs). The insight that the persistence boundary is a separate concern from the entity kind — one kind, two modes.
- **What to avoid**: Mario Maker's "key death" mechanic is a gameplay-specific quirk. Don't model it. The checkpoint-scoped save is a v2 concern.

### Pattern 3: Sokpop Fake-3D Demo — Pickups as First-Class GameObject Types

- **Source**: [Sokpop Fake-3D Demo](https://sokpop.itch.io/sokpop-fake-3d-demo), [3D Tutorial — Step 9 — Pick-ups — Monstrous Software](https://monstroussoftware.github.io/2023/11/09/Tutorial-3D-step9.html)
- **What it does**: Sokpop's fake-3D demo treats pickups as first-class `GameObject`s with a `type` field that includes `isPickup: true`. The collision callback dispatches on type:
  ```java
  public class GameObjectType {
    public final static GameObjectType TYPE_PICKUP_COIN = new GameObjectType("coin", false, false, true);
    public final static GameObjectType TYPE_PICKUP_HEALTH = new GameObjectType("health", false, false, true);
  }

  private void handleCollision(GameObject go1, GameObject go2){
    if(go1.type.isPlayer && go2.type.canPickup){
      pickup(go1, go2);
    }
  }
  ```
  The `canPickup` boolean is the type-level discriminator. The collision callback tests both orderings (`go1,go2` and `go2,go1`) because the physics engine doesn't guarantee order.

- **Determinism profile**: Collision is deterministic. The pickup event is derived from the collision. No save state in the demo (single-run).
- **Runtime cost**: One type check per collision pair. Negligible.
- **Dependencies**: None.
- **Fit for our constraints**: **Strong.** The first-class GameObject pattern maps directly to our `LevelEntity` discriminated union. The type-level `canPickup` discriminator maps to our `kind: 'collectible'` discriminator.
- **What to steal**: The first-class entity model. The collision callback pattern (test both orderings). The insight that pickups are derived from collision, not stored as runtime state.
- **What to avoid**: Sokpop's demo doesn't have persistence — it's a single-run toy. We need the save layer for the `persists: true` case.

### Pattern 4: Pure-Progression-Ops Save (cosmetics/ownership.ts + iap/entitlements.ts)

- **Source**: Local: `src/cosmetics/ownership.ts`, `src/cosmetics/types.ts`, `src/iap/entitlements.ts`
- **What it does**: Our existing pure-progression-ops discipline is the exact pattern a `CollectibleSave` should mirror:
  - **Immutable in** → the input save is never mutated.
  - **JSON-clone out** → a fresh, deep-cloned state is returned every call.
  - **Never throws** → invalid ids, unknown slots, corrupt saves all degrade to a sensible no-op.
  - **Sorted `string[]`** → never `Set`/`Map`, so serialization order is canonical regardless of grant order.
  - **Event-driven only** → called on user actions, not per-frame (the JSON-clone cost is negligible for event-driven calls but wasteful in the hot path).

  The existing `grantSkin` / `equipSkin` / `grantEntitlement` / `revokeEntitlement` ops are the template. A `collect(save, entityId)` op would be a near-clone of `grantSkin`:
  ```typescript
  // From src/cosmetics/ownership.ts:61-69 (the template):
  export function grantSkin(save: CosmeticSave, skinId: string): CosmeticSave {
    if (typeof skinId !== 'string' || skinId.length === 0) return cloneSave(save);
    const next = cloneSave(save);
    if (!next.owned.includes(skinId)) {
      next.owned.push(skinId);
      next.owned.sort();
    }
    return next;
  }
  ```

- **Determinism profile**: Pure functions of the input save. No `Math.random`, no `Date.now`, no DOM reads. Fully deterministic.
- **Runtime cost**: One JSON-clone per call. Negligible for event-driven calls (one per pickup), wasteful if called per-frame.
- **Dependencies**: None.
- **Fit for our constraints**: **Strong.** This is our existing discipline. The `CollectibleSave` should be a near-clone of `CosmeticSave` with a different field name (`collected` instead of `owned`).
- **What to steal**: The entire discipline. The `cloneSave` helper. The sorted `string[]` invariant. The never-throw contract. The event-driven-only guidance.
- **What to avoid**: Don't introduce a `Set`/`Map` for fast lookup — the JSON-clone + linear scan is fine for typical collectible counts (≤1000 per save). Don't add a `Date.now()` timestamp — it would break determinism.

### Pattern 5: Deterministic Replay with Derived Pickups

- **Source**: [Implementing a replay system in Unity — Game Developer](https://www.gamedev.com/), [SG Physics 2D — Snopek Games](https://www.snopekgames.com/tutorial/2021/getting-started-sg-physics-2d-and-deterministic-physics-godot/), [PEAK DRL Tool — Code-SorceryLab](https://github.com/Code-SorceryLab/PEAK-DRL-Tool)
- **What it does**: Deterministic replay systems (rollback netcode, clear-check verification) save only the initial state + per-frame inputs, then re-derive all runtime state from those inputs. For pickups, this means:
  - **Per-run pickups** (coins, `persists: false`): fully derived from collision. Same inputs → same pickups. Zero replay impact.
  - **Persistent pickups** (strawberries, pink coins, `persists: true`): the save is the only non-deterministic surface. A replay that starts from the same save state will produce the same pickup events.

  The key insight: **pickups are not stored in the simulation state**. They're derived from `(player position, collectible rect, save state)` each tick. The save state is the only input that varies across runs.

- **Algorithmic shape**:
  ```typescript
  // Per-tick pickup derivation (pseudocode):
  function derivePickups(
    playerRect: Rect,
    collectibles: readonly CollectibleEntity[],
    save: CollectibleSave,
  ): { collected: readonly EntityId[]; remaining: readonly CollectibleEntity[] } {
    const collected: EntityId[] = [];
    const remaining: CollectibleEntity[] = [];
    for (const c of collectibles) {
      // Skip already-collected persistent pickups:
      if (c.props.persists && save.collected.includes(String(c.id))) continue;
      // AABB overlap test:
      if (rectsOverlap(playerRect, c.rect)) {
        collected.push(c.id);
      } else {
        remaining.push(c);
      }
    }
    return { collected, remaining };
  }
  ```

- **Determinism profile**: Pure function of `(playerRect, collectibles, save)`. Same inputs → same outputs. Fully deterministic.
- **Runtime cost**: O(n) per tick where n = number of collectibles in the level. For typical levels (≤100 collectibles), this is negligible.
- **Dependencies**: None.
- **Fit for our constraints**: **Strong.** This is the exact pattern our deterministic platformer kernel already follows (collision is derived, not stored). The pickup derivation is a natural extension.
- **What to steal**: The derivation pattern. The insight that pickups are not stored in the simulation state. The save-as-only-non-deterministic-surface principle.
- **What to avoid**: Don't store collected pickups in the `PlatformerState` — that would couple the kernel to the save layer and break the pure-progression-ops discipline. The kernel returns events; the consumer (or a thin wrapper) translates events to save ops.

### Pattern 6: Forward-Ladder Migration for Additive Union Expansion

- **Source**: Local: `src/level/migrate.ts`, `src/cosmetics/migrate.ts`, `docs/research/level-schema.md`
- **What it does**: Adding a new `EntityKind` variant is an additive union expansion — old levels (v1) that contain zero `collectible` entities are still valid v1 levels. The migration ladder v1→v2 is a no-op for the entity list (just bumps `version` to 2). Old validators that don't know `'collectible'` will report it as an unknown kind (the existing `default:` branch in `validatePropsByKind` already handles this with a warning, not an error).

- **Algorithmic shape**:
  ```typescript
  // Migration step v1 → v2 (additive, no-op for entity list):
  const LEVEL_MIGRATIONS: Record<number, LevelMigration> = {
    2: (raw) => ({ ...raw, version: 2 }),  // bump version, nothing else changes
  };
  ```

- **Determinism profile**: Pure. Fully deterministic.
- **Runtime cost**: Amortized (runs once at level load).
- **Dependencies**: None.
- **Fit for our constraints**: **Strong.** This is exactly the pattern in `src/level/migrate.ts` and `src/cosmetics/migrate.ts`.
- **What to steal**: The forward-ladder pattern. The additive no-op step. The `default:` warning (not error) for unknown kinds.
- **What to avoid**: Don't bump `LEVEL_VERSION` to 2 unless we're actually adding a breaking change. The additive union expansion is non-breaking — old validators should still accept new levels (with a warning for unknown kinds).

---

## Reference Implementations

| Source | What it teaches | URL |
|---|---|---|
| **Celeste Wiki — Entities** | Complete entity taxonomy including Strawberry, Key, Crystal Heart, Cassette. Shows the first-class entity model with `Persistent` BitTag. | https://celeste.ink/wiki/Entities |
| **Celeste Saves — savedata.md** | Save file structure showing `Strawberries` as sorted `EntityID[]` in `AreaModeStats`. The exact pattern our `CollectibleSave.collected` should mirror. | https://github.com/frissyn/celeste-saves/blob/master/savedata.md |
| **EverestAPI/Resources — Settings, SaveData and Session** | Celeste's three-layer persistence model (Session / SaveData / Settings). The conceptual basis for our `persists?: boolean` flag. | https://github.com/EverestAPI/Resources/wiki/Settings,-SaveData-and-Session |
| **Pink Coin — Kaizo Mario Maker Wiki** | The `persists` flag pattern in action. Pink coins save at checkpoints; regular coins respawn on death. | https://kaizomariomaker.fandom.com/wiki/Pink_Coin |
| **Sokpop Fake-3D Demo** | First-class GameObject with type-level `canPickup` discriminator. The collision callback pattern (test both orderings). | https://sokpop.itch.io/sokpop-fake-3d-demo |
| **3D Tutorial — Step 9 — Pick-ups** | Clean Java implementation of the pickup collision callback. Shows the type-dispatch pattern. | https://monstroussoftware.github.io/2023/11/09/Tutorial-3D-step9.html |
| **Local: `src/cosmetics/ownership.ts`** | The exact pure-progression-ops discipline our `CollectibleSave` ops should mirror. | `src/cosmetics/ownership.ts` |
| **Local: `src/iap/entitlements.ts`** | The other pure-progression-ops sibling. Shows the `grant` / `revoke` / `flush` pattern. | `src/iap/entitlements.ts` |
| **Local: `src/level/migrate.ts`** | The forward-ladder migration pattern. The additive no-op step for union expansion. | `src/level/migrate.ts` |

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Celeste strawberry collection | Player touches strawberry, follows for 9 frames in safe zone, then collected. The first-class entity + persistent save pattern. | https://celeste.ink/wiki/Red_Strawberries |
| Celeste save file structure | `<Strawberries>` element with sorted `<EntityID>` children. The exact save shape we should mirror. | https://github.com/frissyn/celeste-saves/blob/master/savedata.md |
| Mario Maker pink coin + checkpoint | Pink coins save at checkpoints; key death resets them. The `persists` flag pattern in action. | https://kaizomariomaker.fandom.com/wiki/Pink_Coin |
| Sokpop fake-3D demo pickups | Coins and health packs as first-class GameObjects with `canPickup` type flag. | https://sokpop.itch.io/sokpop-fake-3d-demo |

---

## Open Questions

1. **Collectible kind taxonomy**: Should the `CollectibleProps.kind` union be `'coin' | 'gem' | 'key'` (closed, typed) or `string` (open, like `TrapProps.type`)? The closed union gives defensive parsing for free; the open string lets consumers add custom kinds without a library update. **Draft recommendation**: closed union for v1 (matches `EquipSlot` pattern in `src/cosmetics/types.ts:36`). Consumers who need custom kinds can use the `'coin'` kind with a custom `value` or wait for a v2 union expansion.

2. **Per-level-instance vs persistent save scope**: When `persists: true`, is the save scoped to the level (Celeste's per-area pattern) or to the entire game (Celeste's per-save-file pattern)? **Draft recommendation**: per-level for v1 (simpler, matches the level-id-keyed save pattern). Per-game is a v2 concern that requires a separate `CollectibleSave` per level.

3. **Pickup event emission**: Should the platformer kernel emit a `justCollected` event (like `justLanded`), or should the consumer derive pickups from the kernel's output? **Draft recommendation**: the consumer derives pickups from `(player core, collectibles, save)` after each tick. The kernel doesn't know about collectibles — it only knows about solids. This keeps the kernel pure and the collectible layer a thin wrapper.

4. **Renderer default for collectibles**: Should collectibles render as solid-feeling (like platforms) or dashed (like triggers)? **Draft recommendation**: solid-feeling with a distinct palette entry (gold for coins, blue for gems, silver for keys). The dashed treatment is for non-tangible markers; collectibles are tangible objects the player picks up.

5. **Catalog prefab entries**: Should the default catalog ship one entry per `CollectibleProps.kind` (e.g., `coin`, `gem`, `key` prefabs all pointing to `kind: 'collectible'`), or one generic `collectible` entry? **Draft recommendation**: one entry per kind. The catalog already does this for enemies (`spinny`, `turret`, `spider` all pointing to `kind: 'enemy'`). The pattern is proven.

6. **Checkpoint-scoped persistence**: Should v1 support checkpoint-scoped saves (Mario Maker pattern) or only level-scoped? **Draft recommendation**: level-scoped only for v1. Checkpoint-scoped requires a `Checkpoint` entity kind (which we don't have) and a separate save layer. Defer to v2.

7. **Collectible value semantics**: What does `value` mean? Score? Currency? Meta-progression currency? **Draft recommendation**: `value` is an opaque number. The consumer decides what it means (score, currency, etc.). The library doesn't enforce semantics.

---

## Top 3 Patterns Worth Prototyping

1. **`CollectibleProps` shape + `EntityKind` union expansion** — Add `'collectible'` to `EntityKind`, add `CollectibleProps` interface (`{ kind: 'coin'|'gem'|'key'; value?: number; persists?: boolean }`), add the variant to `LevelEntity`. This is the schema-change foundation everything else builds on. The `kind` field on props (not on the entity kind itself) lets the catalog ship multiple prefab entries (`coin`, `gem`, `key`) all pointing to the same `kind: 'collectible'` entity kind — matching the existing `TrapProps.type` / `EnemyProps.archetype` pattern.

2. **Pure-progression-ops `CollectibleSave` + ops** — Ship `CollectibleSave` (`{ collected: string[] }`), `collect(save, entityId)`, `hasCollected(save, entityId)`, `resetForLevel(save, levelId)`. Mirror `cosmetics/ownership.ts` exactly: JSON-clone in / fresh out / never throws / sorted `string[]` / event-driven only. This is the save layer that makes `persists: true` work without leaking non-determinism into the kernel.

3. **Derived pickup collision (deterministic, replay-free)** — Ship a pure `derivePickups(playerRect, collectibles, save)` function that returns `{ collected: EntityId[]; remaining: CollectibleEntity[] }`. Called by the consumer after each platformer tick (not inside the kernel). The function is a pure data transform — same inputs → same outputs → replay-deterministic. The kernel stays unaware of collectibles; the collectible layer is a thin wrapper that translates collision into save ops.

---

## Cross-References

- `docs/architecture.md` — Layer separation (collectibles are deterministic core; renderer branch is renderer-adjacent; save ops are pure-progression-ops)
- `docs/conventions.md` — Pure progression ops, no magic numbers, JSDoc requirements, naming patterns
- `src/level/types.ts` — Current `EntityKind` union (lines 43-53), `LevelEntity` discriminated union (lines 133-143), `ExitProps.locked` pattern (lines 60-65) — the template for `CollectibleProps.persists`
- `src/level/validate.ts` — `validatePropsByKind` switch (lines 265-362) — needs a new `case 'collectible':` branch
- `src/level/migrate.ts` — Forward-ladder migration pattern — additive no-op step for v1→v2
- `src/editor/catalog.ts` — `DEFAULT_RECT_BY_KIND`, `DEFAULT_PROPS_BY_KIND`, `DEFAULT_LABEL_BY_KIND`, `DEFAULT_CATALOG` — all four need a `collectible` entry
- `src/editor/operations.ts` — `makeEntity` switch (lines 94-172) — needs a `case 'collectible':` branch
- `src/platformer/renderer.ts` — `EntityPalette`, `DrawLevelEntityOverrideMap`, `SOLID_FEELING_KINDS`, `DASHED_KINDS`, `drawLevelEntity` switch — all need a `collectible` branch
- `src/platformer/level-runtime.ts` — `compileLevel` — collectibles are NOT collision surfaces (no change needed, but worth confirming)
- `src/platformer/kernel.ts` — Kernel is unaware of collectibles (no change needed)
- `src/cosmetics/ownership.ts` — The exact pure-progression-ops template for `CollectibleSave` ops
- `src/cosmetics/types.ts` — `CosmeticSave` shape (lines 92-97) — the template for `CollectibleSave`
- `src/iap/entitlements.ts` — The other pure-progression-ops sibling — shows the `grant` / `revoke` / `flush` pattern
- `docs/research/level-schema.md` — The forward-ladder migration pattern (Pattern 5) and canonical serialization (Pattern 7) — both relevant for the `collectible` schema change
- `docs/research/easing-tween.md` — The pure-function + stateless-advance pattern — relevant for `derivePickups` (pure function, no state)
- `docs/research/platformer-kernel.md` — The deterministic platformer kernel — confirms pickups are derived from deterministic collision (no replay impact)
- `ai-craft-strategy/knowledge/sokpop-minimalist-rendering-teardown.md` — The canonical Sokpop reference — confirms the minimalist-procedural philosophy applies to collectibles (one kind, multiple prefab entries, derived collision)
