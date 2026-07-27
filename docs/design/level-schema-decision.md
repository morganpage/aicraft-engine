# Decision: Level Schema

## 0.4.0 clarification: unified runtime compilation

`compileLevel(level, { tileTypeMap })` captures each numeric tile
classification once, exposes the captured `tileQuery`, and appends
deterministically coalesced tile solids after entity-derived solids.
Full-solid cells use a row-major greedy rectangle merge; passthrough cells
merge horizontally within a row only. Omitting the classifier preserves the
previous entity-only collision output.

> Status: APPROVED for implementation.
> Proposal: `docs/design/level-schema-proposal.md`.
> Research: `docs/research/level-schema.md`.
> Architect: self-review (architect agent session returned empty; orchestrator decision per workflow §Step 6).

## Chosen approach

**Approach B: Opinionated Platformer Schema.** The library ships a discriminated-union entity taxonomy (`spawn | exit | platform | passthrough | trap | hazard | decoration | trigger | movingPlatform`), a forward-ladder migration scaffold, defensive validation, an `allocateEntityId` pure counter, a `createTileQuery` bridge to `TileSolidityQuery`, and canonical serialization + FNV-1a hashing for share codes.

## Why

1. **Maps onto Spitekeep's existing `LevelData` shape near 1:1** — sibling migration is a field rename, not a redesign. This is the only consumer that exists today; optimizing for it is correct.
2. **Discriminated union gives exhaustive kind checking** — when a new kind is added, TypeScript flags every switch statement that needs updating. The `params: Record<string, unknown>` bag on `trap`/`trigger` mirrors Spitekeep's existing trap-dispatch pattern (each trap type has its own params shape resolved at runtime).
3. **Validates the v1 thesis cleanly** — the schema must unblock both the platformer kernel (Phase 2) and the editor core (Phase 3). Approach B's shipped taxonomy is enough for both: the kernel reads `tiles` via `createTileQuery`, the editor edits `entities` via kind-dispatched inspector panels.
4. **Future escape hatches preserved** — if a second consumer needs radically different entity types, Approach C's registry pattern can be added later as an optional `validateLevelWithRegistry(level, registry)` overload. Approach B does not preclude it.

## Resolutions to open questions (from proposal §Open Questions)

1. **Props typing**: keep `params: Record<string, unknown>` for `trap` and `trigger`. Matches Spitekeep. Compile-time type safety on these bags is a non-goal for v1; runtime validation via the `validateLevel` structural check is sufficient. Specific props interfaces (`PlatformProps`, `MovingPlatformProps`, `DecorationProps`, `TriggerProps`, `ExitProps`) ship for the kinds where the shape is known.

2. **`createTileQuery` home**: `src/level/tiles.ts`. The level module owns the bridge to collision, not the reverse. Keeps `src/collision/` pure (no upstream dependency on `src/level/`). Consumers discover the bridge via the level module's barrel.

3. **Spawn/exit bounds checking**: validator CHECKS bounds and returns errors, never silently clamps. Silent clamping hides editor bugs and can corrupt level geometry. The editor surfaces validation errors as clickable diagnostics; the consumer decides whether to reject or fix.

4. **`bottomLava` and `hints` placement**: ship as optional top-level fields on `LevelData`. Both are common enough across platformer siblings (bottomless pits, contextual hints) to escape the untyped `metadata` bag. Spitekeep uses both. If they turn out to be game-specific, a v2 migration can move them to `metadata` without breaking the schema version.

## Additional constraints discovered during review

1. **`migrateLevel` must wrap each migration step in try/catch.** A migration that throws returns the input unchanged with a `ValidationResult` error recording the failure. The forward-ladder pattern's purity contract (never throw on untrusted input) must hold end-to-end.

2. **`level.id` is consumer-assigned.** The library never auto-generates it. Auto-generation would require either `Math.random` (banned in deterministic code) or a monotonic counter (would collide across consumers editing in parallel). Document this explicitly in JSDoc.

3. **`canonicalize` and `fnv1a` are in scope but standalone.** They live in `src/level/serialize.ts` and are independently importable. They are not required for editor/runtime/replay flows in v1 — they exist for future share-code generation and clear-check replay verification. Keep them small (<100 lines combined) and tested.

4. **Strict TypeScript compliance.** Use `export type` for type-only re-exports per `isolatedModules`. The `EntityKind` union is a type, not a const enum. File names are lowercase-kebab.

## Out of scope for v1 (deferred)

- Clear-check replay storage and verification — requires the simulation kernel.
- Thumbnail rendering helper — requires the renderer pillar.
- RLE / sparse tile encoding — flat array is 2 KB for typical levels.
- Entity-type registry (Approach C pattern) — deferred until a second consumer needs it.
- CRDT op model — deferred until collaborative editing is a real requirement.

## Files to implement

```
src/level/
├── types.ts          # LevelData, LevelEntity (discriminated union), EntityKind, props interfaces
├── constants.ts      # LEVEL_VERSION, DEFAULT_TILE_SIZE, DEFAULT_LEVEL_WIDTH/HEIGHT, DEFAULT_ENTITY_ID_START
├── migrate.ts        # migrateLevel (forward-ladder, never throws)
├── validate.ts       # validateLevel (returns ValidationResult, never throws)
├── tiles.ts          # createTileQuery (bridge to TileSolidityQuery)
├── entity-id.ts      # allocateEntityId (pure counter)
├── serialize.ts      # canonicalize (RFC 8785 key-sort) + fnv1a (32-bit hash)
└── index.ts          # Barrel export
```

Tests in `src/tests/`:
- `level-validate.test.ts`
- `level-migrate.test.ts`
- `level-tiles.test.ts`
- `level-entity-id.test.ts`
- `level-serialize.test.ts`
- `level-barrel.test.ts` (contract test asserting all exports reachable from `src/level/index.ts`)
