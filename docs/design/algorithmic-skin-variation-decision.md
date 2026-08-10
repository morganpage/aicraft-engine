# Decision: Algorithmic Cosmetics (`src/cosmetics/`)

**Status:** APPROVED with prescribed corrections (architect NEEDS REVISION resolved without a re-design loop — all 5 objections were prescribed fixes with exact wording, no genuine design ambiguity).
**Inputs:** `docs/research/algorithmic-skin-variation.md` · `docs/design/algorithmic-skin-variation-proposal.md` (reference — has known stale points corrected below) · architect critique (NEEDS REVISION, 5 objections + 5 open-Q adjudications) · settled `Palette` contract (`src/palette/`) · the reference implementation `platform/progress.ts` + `save.ts` (sibling mirror).

## Decision

Adopt a **versioned, defensively-parsed `CosmeticManifest`** of **`SkinPreset`** records, where a skin is a serializable parameter preset (`{ id, name, rarity, palette: Palette, scale }`) — "the algorithm IS the art," no art files. **`SkinPreset.palette` is exactly the shipped 5-slot `Palette` type**; all color logic delegates to `src/palette/` (`generatePalette` already repairs contrast internally). Provide deterministic **`generateSkinVariants(seed, baseSkin, count)`** (mulberry32 + signature-hash batch uniqueness) and **pure-progression ownership ops** (`grantSkin`/`equipSkin`/`unequipSkin`) mirroring the reference `progress.ts` discipline.

**Equip model: multi-slot** (`EquipSlot = 'body' | 'head' | 'trail'`). **Minimal v1 `SkinPreset`** (features/gait/particles deferred to manifest v2 via the versioned migration safety net). **Typed rarity** union. IAP seam: `grantSkin` operates on `CosmeticSave` only — the consumer composes it into their `SaveData` and maps SKUs→skin IDs at the boundary (no IAP coupling now, shaped for Pillar 3 flow-in later).

## The 5 prescribed corrections (ratified — these OVERRIDE stale points in the proposal doc)
1. **`EquipSlot` is a SEPARATE namespace from `SkeletonTemplate.slotMap`.** Rig `slotMap` keys are consumer-defined *attachment* slots for IK/locomotion targeting (`'root'`, `'left_foot'`...); equip slots are *cosmetic regions* the consumer maps to draw callbacks. Only coincidentally may a name like `'head'` appear in both. JSDoc on `EquipSlot` must state this explicitly (the proposal's "maps directly to slotMap" claim was wrong).
2. **`CosmeticSave` fields are NOT `readonly`** — match the reference `SaveData` (zero `readonly`); ownership ops clone then mutate the clone in place, so `readonly`+`as`-cast is misleading ceremony. (By contrast, `CosmeticManifest.skins: readonly SkinPreset[]` IS readonly — manifests are content, loaded once and read many, never mutated after parse. This justified divergence is documented in a comment.)
3. **No unused `repairContrast` import in `generate.ts`** — `generatePalette` repairs contrast internally; importing `repairContrast` separately violates `noUnusedLocals`. (The `repairContrast` export still exists standalone in `src/palette/` for hand-authored palettes.)
4. **Generated variant IDs include a content hash** — `${baseSkin.id}-var-${i}-${seed}-${hash}` where `hash` is a deterministic djb2/FNV-1a of the base skin's stable content (palette hex + scale). Eliminates cross-base-skin collisions when two base skins share a seed.
5. **`migrateManifest` JSDoc is accurate** — it does "parse input → validate/dedupe each skin → fall back to default manifest if result is empty," NOT the reference implementation's "rebuild default then overlay" (which suits player saves, not content manifests). The algorithm is correct; only the comment was mislabeled.

## Open-question adjudications (locked)
- **`owned` ordering:** canonical **alphabetical sort** after every `grantSkin` (deterministic serialization regardless of grant order).
- **Clone method:** **JSON round-trip** (`JSON.parse(JSON.stringify())`) — matches the reference implementation `progress.ts` exactly; `structuredClone` is unnecessary for `CosmeticSave`'s plain data.
- **Manifest `skins` mutability:** `readonly` (justified divergence from the reference implementation's mutable `SaveData` — documented).
- **`equipSkin` verification:** checks **ownership** (skin is in `owned`), NOT manifest existence (so generated/promotionally-granted skins can be equipped). Does not throw on unowned — returns input unchanged (consistent with `grantSkin`'s invalid-id behavior).
- **Variant ID:** content-hash format above.

## Determinism discipline
- `generateSkinVariants` uses `mulberry32` (never `Math.random`); batch uniqueness via deterministic signature hashing.
- `CosmeticSave.owned` is a plain **sorted `string[]`**, never `Set`/`Map` (serialization-order determinism). `seenSignatures` in generation is a plain array, not a `Set`.
- No timestamp fields anywhere in `CosmeticSave` (would break determinism).
- Ownership ops are **pure-progression-ops**: immutable in → JSON-clone out → never mutate input → never throw; called only on user actions (equip/purchase), never per-frame (JSDoc warns).
- `migrateManifest` is a **defensive adapter**: never throws on any malformed/unknown/older/missing input; always returns a valid `CosmeticManifest`.

## What was rejected
- **Single-slot equip** (less expression/IAP surface; multi-slot avoids a later breaking change).
- **Full research-sketch `SkinPreset` for v1** (features/gait/particles are game-specific; YAGNI — defer to v2 via versioned manifest).
- **Free-string rarity** (typed union is type-safe and industry-standard).
- **`equipSkin` manifest-existence check** (would block generated/promotional skins).
- **Custom color logic in cosmetics** (must delegate to `src/palette/`).
- **`readonly` on `CosmeticSave`** (defeated by `as`-casts; diverges from the reference implementation `SaveData` canon).
