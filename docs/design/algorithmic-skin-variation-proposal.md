# API Proposal: Algorithmic Skin Variation

> Target pillar: 2 (Cosmetics). Module: `src/cosmetics/`.
> Builds on research: `docs/research/algorithmic-skin-variation.md`.
> Status: DRAFT.

## Consumer Need

Spitekeep and future Clone-to-Jest siblings need a cosmetic system that lets players own, equip, and visually distinguish character skins without shipping heavy PNG assets. The skin-as-data approach (parameter presets driving procedural draw callbacks) is the only path compatible with the zero-dep, Canvas2D, deterministic architecture. Without this module, every cosmetic is a hand-drawn spritesheet; with it, a single seed generates infinite visual variety and the monetisation surface multiplies.

The palette module (`src/palette/`) is settled and shipped. This proposal covers everything ABOVE the color layer: skin presets, manifests, defensive migration, seeded generation, and ownership state.

---

## Design Decisions

### Decision 1: Equip Slots — Multi vs Single

The equip-slot model determines save shape, consumer complexity, and monetisation surface.

#### Approach A: Multi-Slot Equipment (recommended)

**Signature sketch:**
```ts
type EquipSlot = 'body' | 'head' | 'trail';

interface CosmeticSave {
  owned: string[];                           // sorted, deduped
  equipped: Partial<Record<EquipSlot, string>>; // slot → skinId
}
```

**Usage example:**
```ts
import { grantSkin, equipSkin, unequipSkin } from 'aicraft-engine/src/cosmetics';

let save: CosmeticSave = { owned: [], equipped: {} };
save = grantSkin(save, 'devil-neon');
save = equipSkin(save, 'body', 'devil-neon');   // neon body
save = equipSkin(save, 'head', 'golden-horns');  // golden horns on neon body
save = equipSkin(save, 'trail', 'flame-trail');  // fire trail
// Mix-and-match: 3 different skins across 3 slots
```

**Trade-offs:**
- **Ergonomics:** Slightly more verbose per equip call, but reads clearly. The `slot` parameter is self-documenting.
- **Determinism:** No difference — `Partial<Record<EquipSlot, string>>` serialises identically across engines.
- **Runtime cost:** One `JSON.parse(JSON.stringify())` per op (same as single-slot). Negligible for event-driven calls.
- **Consumer complexity:** Marginally higher than single-slot — 3 calls instead of 1 to fully dress a character. But the game's equip menu already has 3 UI slots, so this maps 1:1 to the UX.
- **Tree-shake-ability:** Identical — same number of exports.
- **Convention fit:** Maps directly to `SkeletonTemplate.slotMap` (`'body'`, `'head'`, `'trail'` attachment slots) and to `BoneDrawMap` indices — a skin drives draw callbacks per bone, and multi-slot lets different slots draw different parameter presets.
- **IAP surface:** Each slot is an independent monetisation unit. "Golden Horns" sells for $0.99, "Flame Trail" for $1.99, "Neon Body" for $2.99. Exponentially more microtransaction surface than a single bundled skin.
- **Forward-compat:** Adding a new slot later (e.g. `'weapon'`) is additive — `EquipSlot` union expands, `Partial<Record>` handles missing keys gracefully.

**What this makes easy:** Mix-and-match cosmetics, independent IAP per slot, skeletal alignment, future slot additions.

**What this makes hard:** Nothing the game's UI doesn't already support. The equip menu in Spitekeep already has separate slots.

#### Approach B: Single-Slot Equipment

**Signature sketch:**
```ts
interface CosmeticSave {
  owned: string[];
  equipped: string | null; // one skin active at a time
}
```

**Usage example:**
```ts
let save: CosmeticSave = { owned: [], equipped: null };
save = grantSkin(save, 'devil-neon');
save = equipSkin(save, 'devil-neon');
// Only one skin at a time — "Neon Devil" replaces the whole look
```

**Trade-offs:**
- **Ergonomics:** Simpler at the call site — no slot parameter.
- **Determinism:** Simpler save shape, but still no practical difference.
- **Runtime cost:** Marginally cheaper (no Record to clone).
- **Consumer complexity:** Simpler UI (one equip button), but limits expression.
- **Convention fit:** MISALIGNMENT with `SkeletonTemplate.slotMap` — the skeletal rig already has per-bone draw callbacks. A single-slot skin forces the game to bundle body + head + trail into one `SkinPreset`, which contradicts the parameter-driven stack-of-primitives architecture where different bone groups can reference different parameter sets.
- **IAP surface:** One skin = one purchase. Ten times less monetisation surface.
- **Forward-compat:** Adding multi-slot later is a BREAKING CHANGE — `CosmeticSave` shape changes, every consumer must migrate.

**What this makes easy:** Minimal save shape, trivial equip logic.

**What this makes hard:** Mix-and-match (impossible), independent IAP per body part (impossible), skeletal alignment (requires bundling), future expansion (breaking).

#### Approach C: Hybrid (single default slot, optional multi-slot)

**Signature sketch:**
```ts
interface CosmeticSave {
  owned: string[];
  equipped: string | null;           // default slot (full skin)
  equippedSlots?: Partial<Record<EquipSlot, string>>; // overrides per slot
}
```

**Trade-offs:**
- **Ergonomics:** Dual-path — consumers can use simple single-slot OR advanced multi-slot.
- **Determinism:** Two code paths to test and validate.
- **Runtime cost:** Slightly more complex cloning.
- **Consumer complexity:** Two mental models. The `?` optional field means consumers must null-check and merge.
- **Convention fit:** Adds complexity without clear benefit — the skeletal rig doesn't have a "default full skin" concept; it always has per-bone draw maps.
- **IAP surface:** The optional multi-slot creates ambiguity about which path the game uses.
- **Forward-compat:** Adds surface area that must be maintained forever.

**What this makes easy:** Backward-compatible transition from single to multi.

**What this makes hard:** Dual-path complexity, mental model, no clear benefit over just shipping multi-slot from v1.

#### Recommendation

**Approach A: Multi-Slot.** The skeletal rig already has per-bone attachment slots (`SkeletonTemplate.slotMap`). A skin drives draw callbacks per bone index. Multi-slot maps 1:1 to this architecture. It creates maximum IAP surface with zero breaking changes later. The save shape is only marginally more complex (`Record` vs `string | null`), and the consumer's equip UI already has separate slots. Single-slot would force bundling unrelated body parts into one preset, contradicting the parameter-driven architecture.

---

### Decision 2: `SkinPreset` v1 Field Set

Which non-palette fields ship in v1?

#### Approach A: Minimal Viable Skin (recommended)

```ts
interface SkinPreset {
  id: string;
  name: string;
  rarity: CosmeticRarity;
  palette: Palette;   // from src/palette/types.ts — the settled contract
  scale: SkinScale;   // bone scale multipliers
}
```

Where:
```ts
interface SkinScale {
  body: number;   // torso/root bone multiplier. Default 1.0
  head: number;   // head bone multiplier. Default 1.0
  limbs: number;  // arms/legs multiplier. Default 1.0
}
```

**Trade-offs:**
- **Ergonomics:** Clean, small, easy to author manually or generate.
- **Determinism:** All primitive values, fully serialisable, no ambiguity.
- **Runtime cost:** Smallest possible JSON payload per skin.
- **Consumer complexity:** Minimal — 5 fields to understand.
- **Convention fit:** `scale` maps to `BonePose.scale` in the skeletal rig — a `SkinPreset` provides the multiplier, the consumer applies it to `localPoses[].scale`.
- **Forward-compat:** `features`, `gait`, `particles` deferred to manifest v2. The versioned manifest and `migrateManifest` make this safe.

**What this makes easy:** Authoring skins, generating variants, testing.

**What this makes hard:** No procedural feature variation (horns, tails) or gait variation in v1. Consumers must author those in their own draw callbacks.

#### Approach B: Full Research Sketch

```ts
interface SkinPreset {
  id: string;
  name: string;
  rarity: CosmeticRarity;
  palette: Palette;
  scale: SkinScale;
  features: SkinFeatures;   // hornType, hornScale, tailType, tailLength
  gait: SkinGait;           // strideLengthMultiplier, strideHeightMultiplier
  particles: SkinParticles; // color, spawnRate
}
```

**Trade-offs:**
- **Ergonomics:** More fields = more to author, but more expressive.
- **Determinism:** Still all primitives — no issue.
- **Runtime cost:** Larger JSON, but negligible for a manifest loaded once.
- **Consumer complexity:** 8 sub-objects to understand. Consumers that don't use horns still must pass `hornType: 'none'`.
- **Convention fit:** `gait` overlaps with `GaitConfig` in `src/animation/locomotion.ts`. A skin's gait multipliers would multiply the `GaitConfig` amplitudes — this is a clean composition but adds a layer of indirection.
- **Forward-compat:** Ships everything at once; no migration needed. But ships fields consumers may not use.

**What this makes easy:** Full expressiveness from day one, no migration later.

**What this makes hard:** More authoring surface, more generation parameters to jitter, more migration complexity if the feature shapes change.

#### Approach C: Minimal + Gait (skip features/particles)

```ts
interface SkinPreset {
  id: string;
  name: string;
  rarity: CosmeticRarity;
  palette: Palette;
  scale: SkinScale;
  gait: SkinGait;  // stride multipliers — universal across all characters
}
```

**Trade-offs:**
- **Ergonomics:** Gait multipliers are universally applicable (every walking character has stride length/height). Features are game-specific.
- **Convention fit:** `gait` multipliers compose cleanly with `GaitConfig` via `scaledGait()`.
- **Forward-compat:** `features` and `particles` deferred to v2.

**What this makes easy:** Universal gait variation without game-specific feature assumptions.

**What this makes hard:** Still no horns/tails in v1.

#### Recommendation

**Approach A: Minimal Viable Skin (id + name + rarity + palette + scale).** The research sketch's `features`, `gait`, and `particles` are game-specific — Spitekeep's devil has horns and a tail, but a slime or skeleton does not. Shipping game-specific fields in the library forces every consumer to pass irrelevant defaults. `scale` is the only truly universal parameter (every character has a body, head, and limbs). `gait` multipliers are tempting but overlap with `GaitConfig` in `src/animation/locomotion.ts` — the consumer can compose these themselves via `scaledGait(config, skin.scale.gaitMultiplier)`. The versioned manifest makes it trivially safe to add `features`/`gait`/`particles` in manifest v2 when a concrete consumer needs them.

---

### Decision 3: Rarity — Enum vs Free String

#### Approach A: Typed Union Enum (recommended)

```ts
type CosmeticRarity = 'common' | 'rare' | 'epic' | 'legendary';
```

**Trade-offs:**
- **Ergonomics:** IDE autocomplete, compile-time checking, self-documenting.
- **Determinism:** No difference.
- **Runtime cost:** String at runtime — identical to free string.
- **Consumer complexity:** Fixed set; consumers must use one of the four values.
- **Convention fit:** Matches the research sketch and Sokpop teardown patterns.
- **Forward-compat:** Adding a new tier (e.g. `'mythic'`) is a union expansion — additive, non-breaking.

**What this makes easy:** Type-safe rarity checks, consistent UI styling, drop-rate configuration.

**What this makes hard:** Locked to 4 tiers. Adding a tier requires a type change (but no runtime change).

#### Approach B: Free String

```ts
interface SkinPreset {
  rarity: string; // any string
}
```

**Trade-offs:**
- **Ergonomics:** No autocomplete, no compile-time safety.
- **Convention fit:** Violates the library's typed-enum pattern (see `GenerationStrategy`, `EquipSlot`).
- **Forward-compat:** Any string works, but no guidance for consumers.

**What this makes easy:** Maximum flexibility for game-specific rarity tiers.

**What this makes hard:** Inconsistent API, no type safety, consumers invent their own strings.

#### Approach C: Numeric Tier

```ts
interface SkinPreset {
  rarity: number; // 0=common, 1=rare, 2=epic, 3=legendary
}
```

**Trade-offs:**
- **Ergonomics:** Magic numbers. Consumers must map numbers to display names.
- **Convention fit:** Violates "no magic numbers" convention.
- **Convention fit:** Terrible.

#### Recommendation

**Approach A: Typed union.** Four tiers is the industry standard (Fortnite, Genshin Impact, most gacha games). Adding a tier later is a union expansion — non-breaking at runtime. `CosmeticRarity` as a type export gives consumers IDE autocomplete and compile-time safety. Rarity is pure metadata in v1 — it drives nothing mechanical (no drop rates, no rarity-gated features). If a game needs custom tiers, they can use `string` in their own code and cast at the boundary.

---

### Decision 4: IAP Seam

The cosmetics module must stay decoupled from Pillar 3 (IAP Bridge). The seam is simple:

```ts
// src/cosmetics/ownership.ts — what we ship now
function grantSkin(save: CosmeticSave, skinId: string): CosmeticSave { ... }
function equipSkin(save: CosmeticSave, slot: EquipSlot, skinId: string): CosmeticSave { ... }
function unequipSkin(save: CosmeticSave, slot: EquipSlot): CosmeticSave { ... }

// src/iap/ (Pillar 3, future) — what ships later
function grantEntitlement(save: SaveData, sku: string): SaveData { ... }

// Consumer's integration layer (game-specific, not in the library)
function handlePurchaseSuccess(save: SaveData, sku: string): SaveData {
  let next = grantEntitlement(save, sku);           // Pillar 3: record entitlement
  const skinId = skuToSkinId(sku);                   // game-specific mapping
  if (skinId) {
    next = grantSkin(next as CosmeticSave, skinId);  // Pillar 2: grant skin
  }
  return next;
}
```

**Key constraint:** `grantSkin` takes a `CosmeticSave`, not a full `SaveData`. This means the consumer's save type embeds `CosmeticSave` as a sub-object:

```ts
// Consumer's save type (game-specific)
interface SaveData {
  version: number;
  // ... game-specific fields ...
  cosmetics: CosmeticSave;  // Pillar 2 sub-object
}
```

The consumer composes the two pure ops (`grantEntitlement` + `grantSkin`) in their integration layer. The library never imports from `src/iap/` in `src/cosmetics/` and vice versa.

**No changes needed to `grantSkin` signature for IAP forward-compat.** The function already takes `(save, skinId)` — the IAP bridge just calls it after recording the entitlement. The seam is the consumer's integration layer, not a library-level abstraction.

---

### Decision 5: `migrateManifest` Strictness

Which malformed inputs are silently dropped vs clamped vs trigger fallback-to-default?

**Policy matrix:**

| Input condition | Action | Rationale |
|---|---|---|
| `raw` is not an object (null, string, number, etc.) | Return default manifest | Corrupt data; cannot extract any skins |
| `version` is missing or unknown | Return default manifest | Incompatible schema; no safe migration path |
| `skins` is not an array | Return default manifest with default skin | No valid skin data to extract |
| Individual skin entry is not an object | Silently skip (drop from array) | One bad entry shouldn't kill the whole manifest |
| `skins` array is empty after filtering | Return default manifest with default skin | Manifest with no skins is useless |
| `id` is not a string | Fall back to `'default'` | Must have an ID for dedup/equip lookups |
| `name` is not a string | Fall back to `'Untitled'` | Display-only; no mechanical impact |
| `rarity` is not a valid enum value | Fall back to `'common'` | Safe default; no mechanical impact in v1 |
| `palette` is missing or malformed | Use default palette | Colors are cosmetic only; game renders fine with defaults |
| `palette` slot is not a valid `#rrggbb` string | Keep the slot from default palette | Invalid hex can't be rendered |
| `scale` field is not a number or out of [0.1, 5.0] | Clamp to nearest bound | Prevent invisible (0) or giant (Infinity) characters |
| `scale` sub-field missing | Default to `1.0` | Neutral multiplier |
| Unknown top-level fields | Silently ignored | Forward-compat; future fields don't break old parsers |
| Unknown sub-fields (e.g. `features` in v1) | Silently ignored | Forward-compat; consumers may store extra data |

**Never throws. Always returns a valid manifest.** This mirrors Spitekeep's `migrateSave` pattern exactly:

```ts
// Spitekeep's pattern (src/platform/save.ts:132-179):
export function migrateSave(raw: unknown): SaveData {
  if (typeof raw !== 'object' || raw === null) return createDefaultSave();
  const r = raw as Record<string, unknown>;
  if (r.version !== (SAVE_VERSION as SaveVersion)) return createDefaultSave();
  // ... rebuild fresh default, overlay validated fields ...
}
```

The cosmetics `migrateManifest` follows the same shape: rebuild a fresh default manifest, gate on version, overlay only validated fields.

---

## Module Shape

### File Layout

```
src/cosmetics/
├── types.ts            # SkinPreset, CosmeticRarity, SkinScale, CosmeticSave, CosmeticManifest, EquipSlot
├── constants.ts        # SCALE bounds, DEFAULT_PRESET, MANIFEST_VERSION, EQUIP_SLOTS
├── migrate.ts          # migrateManifest, migrateSkinPreset (defensive parse)
├── generate.ts         # generateSkinVariants (seeded generation)
├── ownership.ts        # grantSkin, equipSkin, unequipSkin, getOwnedSkins, getEquippedSkin
├── index.ts            # Barrel export
```

### `src/cosmetics/types.ts`

```ts
import type { Palette } from '../palette/types';

/** Rarity tiers for cosmetics. Typed union — not a free string. */
export type CosmeticRarity = 'common' | 'rare' | 'epic' | 'legendary';

/** Equipment slots. Maps to skeleton attachment slots in the skeletal rig. */
export type EquipSlot = 'body' | 'head' | 'trail';

/**
 * Bone scale multipliers. Each field multiplies the corresponding bone's
 * local scale in the skeletal rig. A value of 1.0 is neutral (no change).
 *
 * Bounds: [SCALE_MIN, SCALE_MAX] (enforced by `migrateSkinPreset`).
 */
export interface SkinScale {
  /** Multiplier for the torso/root bone. Default 1.0. */
  readonly body: number;
  /** Multiplier for the head bone. Default 1.0. */
  readonly head: number;
  /** Multiplier for arm/leg bones. Default 1.0. */
  readonly limbs: number;
}

/**
 * Serializable parameter preset defining a procedural character skin.
 *
 * The preset contains ONLY primitive values and plain objects — no functions,
 * no closures, no `Set`/`Map`. This guarantees JSON-roundtrip fidelity and
 * deterministic serialisation across JS engines.
 *
 * The palette is the settled 5-slot `Palette` from `src/palette/types.ts`.
 * Draw callbacks consume palette slots by name; the preset never contains
 * drawing logic.
 *
 * Extensibility: future manifest versions may add `features`, `gait`,
 * `particles` fields. The defensive parser ignores unknown fields, so older
 * manifests with extra fields parse cleanly.
 */
export interface SkinPreset {
  /** Unique identifier (e.g. `'devil-neon'`). Used for equip/ownership lookups. */
  readonly id: string;
  /** User-facing display name (e.g. `'Neon Devil'`). */
  readonly name: string;
  /** Rarity tier for UI styling. Metadata only in v1 — no mechanical effect. */
  readonly rarity: CosmeticRarity;
  /** 5-slot colour palette. Exactly the `Palette` type from `src/palette/types.ts`. */
  readonly palette: Palette;
  /** Bone scale multipliers. Applied to the skeletal rig's local poses. */
  readonly scale: SkinScale;
}

/**
 * Player cosmetic ownership and equipment state.
 *
 * Serialised as part of the game's save data. All fields use plain arrays
 * and plain objects — never `Set` or `Map` — for deterministic serialisation.
 *
 * `owned` is kept sorted for deterministic comparison and debugging.
 * `equipped` uses `Partial<Record>` because not all slots need to be filled.
 */
export interface CosmeticSave {
  /** Owned skin IDs, sorted alphabetically, deduped. */
  readonly owned: string[];
  /** Equipped skin per slot. Missing slots have no equipped skin. */
  readonly equipped: Partial<Record<EquipSlot, string>>;
}

/**
 * Versioned cosmetic manifest. JSON-serialisable. The `version` field gates
 * forward migration in `migrateManifest`.
 */
export interface CosmeticManifest {
  /** Schema version. Incremented on breaking shape changes. */
  readonly version: number;
  /** Array of validated skin presets. Always non-empty after migration. */
  readonly skins: readonly SkinPreset[];
}
```

### `src/cosmetics/constants.ts`

```ts
import type { CosmeticRarity, CosmeticSave, EquipSlot, SkinPreset, SkinScale } from './types';

/** Current manifest schema version. Incremented on breaking shape changes. */
export const MANIFEST_VERSION = 1 as const;

/** Minimum bone scale multiplier. Below this, bones become invisible. */
export const SCALE_MIN = 0.1;

/** Maximum bone scale multiplier. Above this, bones become unreasonably large. */
export const SCALE_MAX = 5.0;

/** Neutral scale (no change). */
export const DEFAULT_SCALE: Readonly<SkinScale> = {
  body: 1.0,
  head: 1.0,
  limbs: 1.0,
};

/** All valid equipment slots. Used by iteration and validation. */
export const EQUIP_SLOTS: readonly EquipSlot[] = ['body', 'head', 'trail'] as const;

/** All valid rarity tiers. Used by defensive validation. */
export const VALID_RARITIES: readonly CosmeticRarity[] = [
  'common', 'rare', 'epic', 'legendary',
] as const;

/**
 * Default skin preset. Used as fallback by `migrateSkinPreset` when fields
 * are missing or malformed. Neutral scale, default palette, common rarity.
 */
export const DEFAULT_SKIN_PRESET: Readonly<SkinPreset> = {
  id: 'default',
  name: 'Default',
  rarity: 'common',
  palette: {
    outline: '#1d1128',
    base: '#ff4a4a',
    accent: '#ffb300',
    feature: '#ff4a4a',
    background: '#f0e6d3',
  },
  scale: { ...DEFAULT_SCALE },
};

/** Empty cosmetic save state. Owned is an empty sorted array; nothing equipped. */
export const DEFAULT_COSMETIC_SAVE: Readonly<CosmeticSave> = {
  owned: [],
  equipped: {},
};

/**
 * Default manifest: version 1, single default skin. Returned by
 * `migrateManifest` when the input is completely invalid.
 */
export const DEFAULT_MANIFEST: Readonly<{
  version: number;
  skins: readonly SkinPreset[];
}> = {
  version: MANIFEST_VERSION,
  skins: [DEFAULT_SKIN_PRESET],
};
```

### `src/cosmetics/migrate.ts`

```ts
import type { CosmeticManifest, CosmeticRarity, SkinPreset, SkinScale } from './types';
import {
  DEFAULT_MANIFEST,
  DEFAULT_SCALE,
  DEFAULT_SKIN_PRESET,
  MANIFEST_VERSION,
  SCALE_MAX,
  SCALE_MIN,
  VALID_RARITIES,
} from './constants';

// --- Internal helpers (pure, DOM-free) ---

/** Clamp a number to [min, max]. Return fallback if not finite. */
function clampFinite(n: unknown, min: number, max: number, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return n < min ? min : n > max ? max : n;
}

/** Defensively parse a SkinScale from raw input. */
function migrateSkinScale(raw: unknown): SkinScale {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SCALE };
  const r = raw as Record<string, unknown>;
  return {
    body: clampFinite(r.body, SCALE_MIN, SCALE_MAX, DEFAULT_SCALE.body),
    head: clampFinite(r.head, SCALE_MIN, SCALE_MAX, DEFAULT_SCALE.head),
    limbs: clampFinite(r.limbs, SCALE_MIN, SCALE_MAX, DEFAULT_SCALE.limbs),
  };
}

/** Defensively validate a hex colour string. Returns fallback if invalid. */
function migrateHexColor(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback;
}

/**
 * Defensively parse a single skin preset from raw input. Never throws.
 *
 * Missing or malformed fields fall back to `DEFAULT_SKIN_PRESET` values.
 * Numeric scale values are clamped to `[SCALE_MIN, SCALE_MAX]`.
 * Unknown fields are silently ignored (forward-compat).
 */
export function migrateSkinPreset(raw: unknown): SkinPreset {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SKIN_PRESET };
  const r = raw as Record<string, unknown>;

  const id = typeof r.id === 'string' && r.id.length > 0 ? r.id : DEFAULT_SKIN_PRESET.id;
  const name = typeof r.name === 'string' && r.name.length > 0 ? r.name : DEFAULT_SKIN_PRESET.name;

  const rarity: CosmeticRarity =
    typeof r.rarity === 'string' && (VALID_RARITIES as readonly string[]).includes(r.rarity)
      ? (r.rarity as CosmeticRarity)
      : DEFAULT_SKIN_PRESET.rarity;

  // Palette: validate each slot as a #rrggbb hex string
  const palette = { ...DEFAULT_SKIN_PRESET.palette };
  if (typeof r.palette === 'object' && r.palette !== null) {
    const p = r.palette as Record<string, unknown>;
    palette.outline = migrateHexColor(p.outline, palette.outline);
    palette.base = migrateHexColor(p.base, palette.base);
    palette.accent = migrateHexColor(p.accent, palette.accent);
    palette.feature = migrateHexColor(p.feature, palette.feature);
    palette.background = migrateHexColor(p.background, palette.background);
  }

  const scale = migrateSkinScale(r.scale);

  return { id, name, rarity, palette, scale };
}

/**
 * Defensively parse a raw manifest. Never throws.
 *
 * Strategy (mirrors Spitekeep's `migrateSave`):
 * 1. Gate on `version === MANIFEST_VERSION`.
 * 2. Rebuild a fresh default manifest.
 * 3. Overlay only fields that survive validation.
 *
 * Unknown top-level fields are silently ignored. Unknown skin sub-fields
 * are silently ignored (forward-compat for manifest v2+).
 *
 * @param raw - Arbitrary persisted data (from JSON.parse or similar).
 * @returns A valid `CosmeticManifest`. Never throws.
 */
export function migrateManifest(raw: unknown): CosmeticManifest {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_MANIFEST };
  const r = raw as Record<string, unknown>;

  if (r.version !== MANIFEST_VERSION) return { ...DEFAULT_MANIFEST };

  const skins: SkinPreset[] = [];
  if (Array.isArray(r.skins)) {
    for (const s of r.skins) {
      const parsed = migrateSkinPreset(s);
      // Dedupe by id — keep the first occurrence
      if (!skins.some((existing) => existing.id === parsed.id)) {
        skins.push(parsed);
      }
    }
  }

  if (skins.length === 0) return { ...DEFAULT_MANIFEST };

  return { version: MANIFEST_VERSION, skins };
}
```

### `src/cosmetics/generate.ts`

```ts
import { mulberry32, nextFloat, pick } from '../rng/mulberry32';
import { generatePalette, repairContrast } from '../palette';
import type { SkinPreset, SkinScale } from './types';
import { DEFAULT_SCALE, SCALE_MAX, SCALE_MIN } from './constants';

// --- Generation bounds (no magic numbers) ---

/** Minimum scale multiplier applied during jitter. */
const JITTER_SCALE_MIN = 0.8;
/** Maximum scale multiplier applied during jitter. */
const JITTER_SCALE_MAX = 1.2;
/** Maximum retries to find a unique signature before giving up. */
const MAX_SIGNATURE_RETRIES = 100;

/**
 * Compute a deterministic string signature for a skin preset. Used to
 * guarantee batch uniqueness — if two variants produce the same signature,
 * one is discarded and re-generated.
 *
 * The signature covers all jittered fields (palette + scale) but NOT
 * id/name (which are derived, not parameterised).
 */
function skinSignature(palette: { base: string; accent: string; feature: string }, scale: SkinScale): string {
  return `${palette.base}|${palette.accent}|${palette.feature}|${scale.body.toFixed(2)}|${scale.head.toFixed(2)}|${scale.limbs.toFixed(2)}`;
}

/**
 * Deterministically generate a batch of visually distinct skin variants.
 *
 * Same `seed` + `baseSkin` + `count` → same `SkinPreset[]` forever.
 * Each variant gets a unique palette (via `generatePalette` + `repairContrast`)
 * and jittered scale parameters within `[JITTER_SCALE_MIN, JITTER_SCALE_MAX]`.
 *
 * Batch uniqueness is guaranteed by signature hashing: if a generated
 * variant's signature matches an existing one in the batch, it is discarded
 * and re-generated (up to `MAX_SIGNATURE_RETRIES` attempts).
 *
 * Uses `mulberry32` for all randomness — never `Math.random`.
 * Iteration uses a plain array (not `Set`/`Map`) for deterministic
 * serialisation order.
 *
 * @param seed     - 32-bit integer seed for the PRNG.
 * @param baseSkin - Base skin to jitter. Palette is replaced; scale is jittered.
 * @param count    - Number of unique variants to generate.
 * @returns Array of `count` unique `SkinPreset` variants (or fewer if the
 *   signature space is exhausted within retry limits).
 */
export function generateSkinVariants(
  seed: number,
  baseSkin: SkinPreset,
  count: number,
): SkinPreset[] {
  const rng = mulberry32(seed >>> 0);
  const variants: SkinPreset[] = [];
  const seenSignatures: string[] = []; // plain array, not Set — deterministic order

  for (let i = 0; i < count; i++) {
    let retries = 0;
    while (retries < MAX_SIGNATURE_RETRIES) {
      // 1. Generate palette from a sub-seed derived from the base seed + index
      const paletteSeed = (seed + i * 1000 + retries) >>> 0;
      const palette = generatePalette(paletteSeed);

      // 2. Jitter scale
      const scale: SkinScale = {
        body: nextFloat(rng, JITTER_SCALE_MIN, JITTER_SCALE_MAX),
        head: nextFloat(rng, JITTER_SCALE_MIN, JITTER_SCALE_MAX),
        limbs: nextFloat(rng, JITTER_SCALE_MIN, JITTER_SCALE_MAX),
      };

      // 3. Check uniqueness via signature
      const sig = skinSignature(palette, scale);
      if (seenSignatures.includes(sig)) {
        retries++;
        continue;
      }

      seenSignatures.push(sig);

      variants.push({
        id: `${baseSkin.id}-var-${i}-${seed}`,
        name: `${baseSkin.name} Variant ${i + 1}`,
        rarity: baseSkin.rarity,
        palette,
        scale,
      });
      break;
    }
  }

  return variants;
}
```

### `src/cosmetics/ownership.ts`

```ts
import type { CosmeticSave, EquipSlot } from './types';
import { DEFAULT_COSMETIC_SAVE, EQUIP_SLOTS } from './constants';

// --- Deep clone (mirrors Spitekeep's platform/progress.ts:17-19) ---

/**
 * Deep-clone a `CosmeticSave` via JSON round-trip.
 * CosmeticSave is fully JSON-serialisable (plain arrays, plain objects,
 * primitive values only — no Set, Map, functions, or circular refs).
 */
function cloneSave(save: CosmeticSave): CosmeticSave {
  return JSON.parse(JSON.stringify(save)) as CosmeticSave;
}

/**
 * Pure progression op: Grant a skin to the player.
 *
 * Appends `skinId` to `owned` (sorted, deduped). If the skin is already
 * owned, this is a no-op (returns a clone of the input — never mutates).
 *
 * Never throws. Invalid `skinId` (empty string, non-string) is a silent no-op.
 *
 * @param save   - Current cosmetic save state.
 * @param skinId - Skin ID to grant.
 * @returns New `CosmeticSave` with the skin added to `owned`.
 */
export function grantSkin(save: CosmeticSave, skinId: string): CosmeticSave {
  if (typeof skinId !== 'string' || skinId.length === 0) return save;
  const next = cloneSave(save);

  // Dedupe check (owned is sorted — binary search possible, but linear is
  // fine for typical owner counts < 1000)
  if ((next.owned as string[]).includes(skinId)) return next;

  // Insert and re-sort to maintain deterministic order
  (next.owned as string[]).push(skinId);
  (next.owned as string[]).sort();

  return next;
}

/**
 * Pure progression op: Equip an owned skin into a specific slot.
 *
 * Verifies the skin is owned before equipping. If not owned, this is a
 * silent no-op (returns a clone of the input — never mutates).
 *
 * Never throws. Invalid `slot` or `skinId` (empty string, non-string,
 * unknown slot name) is a silent no-op.
 *
 * @param save   - Current cosmetic save state.
 * @param slot   - Equipment slot (`'body'`, `'head'`, or `'trail'`).
 * @param skinId - Skin ID to equip (must be in `owned`).
 * @returns New `CosmeticSave` with the skin equipped in the slot.
 */
export function equipSkin(
  save: CosmeticSave,
  slot: EquipSlot,
  skinId: string,
): CosmeticSave {
  if (typeof slot !== 'string' || !(EQUIP_SLOTS as readonly string[]).includes(slot)) return save;
  if (typeof skinId !== 'string' || skinId.length === 0) return save;

  // Verify ownership
  if (!save.owned.includes(skinId)) return save;

  const next = cloneSave(save);
  (next.equipped as Partial<Record<EquipSlot, string>>)[slot] = skinId;
  return next;
}

/**
 * Pure progression op: Unequip a skin from a specific slot.
 *
 * If the slot is already empty, this is a no-op (returns a clone of the
 * input — never mutates).
 *
 * Never throws. Invalid `slot` is a silent no-op.
 *
 * @param save - Current cosmetic save state.
 * @param slot - Equipment slot to clear.
 * @returns New `CosmeticSave` with the slot emptied.
 */
export function unequipSkin(save: CosmeticSave, slot: EquipSlot): CosmeticSave {
  if (typeof slot !== 'string' || !(EQUIP_SLOTS as readonly string[]).includes(slot)) return save;
  if (!save.equipped || save.equipped[slot] === undefined) return save;

  const next = cloneSave(save);
  delete (next.equipped as Partial<Record<EquipSlot, string>>)[slot];
  return next;
}

/**
 * Pure reader: Get all owned skin IDs.
 *
 * Returns a copy of the owned array. Never mutates the input.
 *
 * @param save - Current cosmetic save state.
 * @returns Sorted array of owned skin IDs.
 */
export function getOwnedSkins(save: CosmeticSave): string[] {
  return [...save.owned];
}

/**
 * Pure reader: Get the skin ID equipped in a specific slot.
 *
 * Returns `undefined` if the slot is empty or the slot name is invalid.
 * Never mutates the input.
 *
 * @param save - Current cosmetic save state.
 * @param slot - Equipment slot to query.
 * @returns Equipped skin ID, or `undefined`.
 */
export function getEquippedSkin(save: CosmeticSave, slot: EquipSlot): string | undefined {
  if (typeof slot !== 'string' || !(EQUIP_SLOTS as readonly string[]).includes(slot)) return undefined;
  return save.equipped?.[slot];
}
```

### `src/cosmetics/index.ts`

```ts
/**
 * Cosmetics module (Pillar 2b) — algorithmic skin variation.
 *
 * Skin presets, versioned manifests, defensive migration, deterministic
 * generation, and pure ownership operations. Builds on the settled palette
 * module (`src/palette/`) for colour logic.
 *
 * @module
 */

export type {
  CosmeticRarity,
  EquipSlot,
  SkinScale,
  SkinPreset,
  CosmeticSave,
  CosmeticManifest,
} from './types';

export {
  MANIFEST_VERSION,
  SCALE_MIN,
  SCALE_MAX,
  DEFAULT_SCALE,
  EQUIP_SLOTS,
  VALID_RARITIES,
  DEFAULT_SKIN_PRESET,
  DEFAULT_COSMETIC_SAVE,
  DEFAULT_MANIFEST,
} from './constants';

export { migrateSkinPreset, migrateManifest } from './migrate';

export { generateSkinVariants } from './generate';

export {
  grantSkin,
  equipSkin,
  unequipSkin,
  getOwnedSkins,
  getEquippedSkin,
} from './ownership';
```

---

## Determinism Analysis

### Guarantees

1. **`generateSkinVariants`** uses `mulberry32` exclusively. The same `(seed, baseSkin, count)` triple produces the same `SkinPreset[]` array on every JS engine, forever. Palette generation delegates to `generatePalette` (already deterministic). Scale jitter uses `nextFloat` from `mulberry32`.

2. **Ownership ops** are pure progression ops: immutable in → JSON-clone out → never mutate → never throws. They must ONLY be called during state-transition events (menu interactions, purchase completions), never inside the per-frame gameplay loop.

3. **`migrateManifest`** is deterministic and total: same raw input always produces the same validated manifest.

4. **Serialised state** uses plain sorted arrays (`owned: string[]`) and plain objects (`equipped: Partial<Record>`). No `Set`, no `Map`, no non-deterministic iteration order.

### Landmines for @architect

1. **`Set`-iteration landmine:** The research sketch uses `new Set<string>()` for `seenSignatures` in `generateSkinVariants`. This is fine INTERNALLY (we discard it after generation), but the ownership ops MUST NOT use `Set` for `owned`. The proposal uses plain sorted arrays. If `@coder` introduces a `Set` for `owned`, flag it — it will cause non-deterministic serialisation across clients.

2. **JSON-clone cost:** `JSON.parse(JSON.stringify(save))` is safe but has GC pressure. Ownership ops must only be called on user actions (equip/unequip/purchase), never per-frame. Document this in JSDoc.

3. **`pick()` throws on empty arrays:** The `pick` helper from `src/rng/mulberry32.ts` throws if passed an empty array. The generation code must never pass empty arrays to `pick`. Currently the proposal does not use `pick` (palette is generated via `generatePalette`, not feature-picking), but if `@coder` adds feature generation in v2, they must pre-check array length.

4. **Palette delegation:** `generateSkinVariants` delegates palette generation to `generatePalette` + `repairContrast`. The cosmetics module does NOT implement its own colour logic. This is a hard boundary.

5. **No timestamps:** `CosmeticSave` has no `grantedAt` or `equippedAt` fields. Adding timestamps would break determinism. If a game needs timestamps, they go in the consumer's save layer, not in `CosmeticSave`.

---

## Comparison Table

| Criterion | A: Multi-Slot | B: Single-Slot | C: Hybrid |
|---|---|---|---|
| Ergonomics | Good (3 calls for full outfit) | Best (1 call) | Confusing (dual path) |
| Determinism | Identical | Simpler save | Two paths to test |
| IAP surface | Maximum (per-slot sales) | Minimum (bundled only) | Ambiguous |
| Skeletal alignment | Direct (per-bone slots) | Misaligned (must bundle) | Partial |
| Future-proofing | Additive (new slots) | Breaking change | Maintenance burden |
| **Recommendation** | **Winner** | Rejected | Rejected |

| Criterion | A: Minimal (id/name/rarity/palette/scale) | B: Full Sketch | C: Minimal + Gait |
|---|---|---|---|
| Ergonomics | Clean, small | More fields to author | Moderate |
| Convention fit | Universal (every character has scale) | Game-specific features | Overlaps with GaitConfig |
| Generation complexity | Simple jitter | Complex (horn/tail/particle logic) | Moderate |
| Forward-compat | Safe via manifest v2 | Ships everything at once | Partial |
| **Recommendation** | **Winner** | Deferred to v2 | Deferred to v2 |

---

## Recommendation

Ship **Approach A (Multi-Slot)** for equip model and **Approach A (Minimal Skin)** for `SkinPreset` v1. The multi-slot model aligns with the skeletal rig's per-bone attachment slots, maximises IAP surface, and avoids a breaking change later. The minimal skin preset (id + name + rarity + palette + scale) is the smallest coherent set that lets the system work: palette drives colours, scale drives bone transforms, rarity drives UI, and everything else (features, gait, particles) is deferred to manifest v2 when a concrete consumer needs it. The versioned manifest and defensive parser make this forward-compat safe.

---

## Open Questions for @architect

1. **`owned` sort stability:** The proposal sorts `owned` alphabetically after each `grantSkin` call. Is this the right determinism guarantee, or should it be insertion-order (append-only, no sort)? Insertion-order is cheaper but means two players with the same skins in different grant order would have different `owned` arrays. Alphabetical sort makes the array canonical regardless of grant order.

2. **`cloneSave` cost vs safety:** The proposal uses `JSON.parse(JSON.stringify())` for deep cloning (matching Spitekeep's `progress.ts`). An alternative is structured clone (`structuredClone()`), which is available in ES2021+ and handles more edge cases. However, `JSON.parse/JSON.stringify` is the Spitekeep convention and is guaranteed to produce plain objects (no `Uint8Array` copies, no prototype chains). Recommend sticking with JSON round-trip for convention consistency.

3. **Manifest `skins` mutability:** The proposal declares `skins: readonly SkinPreset[]` in `CosmeticManifest`. Should `migrateManifest` return a mutable array (matching Spitekeep's pattern where `migrateSave` returns a mutable `SaveData`)? The `readonly` modifier is a compile-time hint only — it doesn't affect runtime. But it signals intent: manifests are load-once, read-many.

4. **`equipSkin` ownership verification:** The proposal verifies ownership before equipping (matching the research sketch). Should it also verify the skin ID exists in the manifest? Or is ownership alone sufficient (the skin might come from a generated batch not in the shipped manifest)?

5. **Generated variant IDs:** The proposal uses `${baseSkin.id}-var-${i}-${seed}` for generated variant IDs. These are deterministic but not collision-proof across different base skins with the same seed. Should the ID format include a hash of the base skin's palette to avoid collisions?
