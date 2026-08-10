# Algorithmic Skin Variation

> Research note for algorithmic cosmetics, skin manifests, seeded generation, and ownership state. Slug: `algorithmic-skin-variation`.
> Investigated: 2026-06-19.

## TL;DR

Algorithmic skin variation enables rich cosmetic monetization without the overhead of heavy art assets by treating skins as serializable parameter presets rather than static image files ("the algorithm IS the art"). This note surveys prior art for structuring cosmetic manifests, generating deterministic seed-driven variants, and managing ownership state as pure, immutable progression operations. By combining a versioned, defensively parsed JSON manifest with a deterministic generator powered by `mulberry32` and a multi-slot, pure-progression ownership model, we establish a robust, zero-dependency foundation for Pillar 2 (Cosmetics) that integrates seamlessly with the future Pillar 3 (IAP) bridge.

## Why this matters for aicraft-engine

This technique directly supports **Pillar 2 (Cosmetics)** and provides the primary monetization engine for consumer games (such as *Stacklands* or *Tuin* clones). In a zero-runtime-dependency, Canvas2D-based library, shipping PNG spritesheets or heavy textures is a major constraint violation. By shifting the cosmetic surface to procedural parameters (colors, bone scale multipliers, skeletal shape flags, gait coefficients, and particle properties), we keep the library lightweight, highly performant, and infinitely customizable. Furthermore, establishing a standard, defensively parsed manifest format and pure ownership operations ensures that player progress and purchased items are never lost due to corrupted local storage or schema updates.

---

## Prior Art Survey

### Pattern 1: Parameter-Driven Stack-of-Primitives (Sokpop Style)
- **Source**: Sokpop's Fake-3D Demo & canonical Sokpop reference (sokpop.itch.io)
- **What it does**: Sokpop constructs characters as a stack of geometric primitives (cuboids, ellipsoids, billboards) with relative offsets from a root bone. Instead of swapping texture sheets, skins are defined by modifying these parameters (e.g., horn size, body scale, color palette) at runtime. The rendering function closes over these parameters to draw the character procedurally.
- **Algorithmic shape**:
  ```ts
  interface SkinPreset {
    id: string;
    name: string;
    rarity: 'common' | 'rare' | 'epic' | 'legendary';
    palette: { primary: string; secondary: string; accent: string; outline: string; };
    scale: { body: number; head: number; limbs: number; };
    features: { hornType: 'none' | 'curved' | 'straight' | 'spiked'; hornScale: number; };
  }
  ```
- **Determinism profile**: Pure. The preset contains only primitive values and is fully serializable.
- **Runtime cost**: Low. The parameters are read once per frame during the skeletal draw pass to apply transforms and fill paths.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Maps perfectly onto our Canvas2D rendering pipeline and `BoneDrawMap` skeletal rig structure.
- **What to steal**: The concept of a skin being a JSON-serializable parameter preset that drives a procedural drawing callback, separating the serializable data model from the non-serializable drawing function.
- **What to avoid**: Hardcoding drawing logic inside the preset. The preset should only contain raw numbers, strings, and booleans; the drawing function must interpret them.

### Pattern 2: Defensive Parse & Schema-Lite Migration (Reference Save Pattern)
- **Source**: Reference save implementation (`src/platform/save.ts` and `src/platform/types.ts`)
- **What it does**: The reference implementation enforces strict defensiveness when loading save data. It gates on a schema version, rebuilds a fresh default save, and overlays only the fields that survive strict validation and type-checking. It never throws on malformed, corrupted, or unknown fields, and gracefully migrates older versions.
- **Algorithmic shape**:
  ```ts
  export function migrateSave(raw: unknown): SaveData {
    if (typeof raw !== 'object' || raw === null) return createDefaultSave();
    const r = raw as Record<string, unknown>;
    if (r.version !== (SAVE_VERSION as SaveVersion)) return createDefaultSave();
    // ... validate and overlay fields defensively ...
  }
  ```
- **Determinism profile**: Pure. The parsing function is a deterministic mapper from `unknown` to a well-typed, validated state object.
- **Runtime cost**: Negligible. Runs once at startup or when loading a new manifest/save.
- **Dependencies**: None (hand-rolled validation avoids heavy schema validation libraries like Zod or Ajv).
- **Fit for our constraints**: Non-negotiable. Zero-dependency constraint means we must hand-roll defensive parsers.
- **What to steal**: Rebuilding a default template and defensively overlaying/clamping validated fields.
- **What to avoid**: Throwing errors or crashing the game when encountering unknown or malformed fields.

### Pattern 3: Seed-Driven Parameter Jittering (JS13k/Demoscene)
- **Source**: JS13k procedural character/ship generators (e.g., *Space Hug*, *Lost in Cyberspace*)
- **What it does**: Generates visually distinct assets by using a seeded PRNG (like `mulberry32`) to jitter base parameters (e.g., scale, color hue, feature counts) within safe bounds. To ensure no duplicates within a batch, it generates a unique string signature for each generated item and discards duplicates.
- **Algorithmic shape**:
  ```ts
  function generateSkinVariants(seed: number, baseSkin: SkinPreset, count: number): SkinPreset[];
  ```
- **Determinism profile**: Pure. Since it relies on `mulberry32(seed)` and pure math, the same seed and base skin will produce the exact same array of variants forever.
- **Runtime cost**: One-time cost during generation.
- **Dependencies**: None (uses our `src/rng/mulberry32.ts`).
- **Fit for our constraints**: Strong. Fits our strict determinism rules and utilizes existing RNG primitives.
- **What to steal**: Using a seed-stable PRNG to jitter parameters and using signature hashing to guarantee uniqueness within a batch.
- **What to avoid**: Using `Math.random()` or unseeded color generators, which break replayability and multiplayer synchronization.

---

## Skin Data Model & Manifest Format

To support extensible procedural rendering, we separate the **serializable parameter preset** (the data model) from the **runtime drawing function** (the algorithm).

### Recommended v1 Skin Shape (TypeScript)

The skin shape is designed to be highly extensible while remaining lightweight. It includes color palettes, scale multipliers, feature flags, gait multipliers, and secondary particle properties.

```ts
/** Rarity tiers for cosmetics. */
export type CosmeticRarity = 'common' | 'rare' | 'epic' | 'legendary';

/** Serializable parameter preset defining a procedural character skin. */
export interface SkinPreset {
  /** Unique identifier for the skin (e.g., 'devil-neon'). */
  id: string;
  /** User-facing display name. */
  name: string;
  /** Rarity tier for UI styling and drop rates. */
  rarity: CosmeticRarity;
  /** Color palette overrides. */
  palette: {
    primary: string;   // Hex color, e.g., '#ff00ff'
    secondary: string; // Hex color, e.g., '#00ffff'
    accent: string;    // Hex color, e.g., '#ffff00'
    outline: string;   // Hex color, e.g., '#1d1128'
  };
  /** Geometric scale multipliers for skeletal bones. */
  scale: {
    body: number;      // Multiplier for torso/root bone
    head: number;      // Multiplier for head bone
    limbs: number;     // Multiplier for arms/legs
  };
  /** Procedural feature switches and dimensions. */
  features: {
    hornType: 'none' | 'curved' | 'straight' | 'spiked';
    hornScale: number;
    tailType: 'none' | 'pointed' | 'stubby' | 'springy';
    tailLength: number;
  };
  /** Locomotion/gait multipliers. */
  gait: {
    strideLengthMultiplier: number;
    strideHeightMultiplier: number;
  };
  /** Secondary particle effect properties. */
  particles: {
    color: string;
    spawnRate: number; // Particles spawned per second
  };
}

/** Versioned cosmetic manifest containing all shipped skins. */
export interface CosmeticManifest {
  /** Schema version for forward migrations. */
  version: number;
  /** Array of validated skin presets. */
  skins: SkinPreset[];
}
```

### Defensive Manifest Parser (Hand-Rolled, Zero-Dep)

Following the reference `save.ts` pattern, the manifest parser must be completely defensive. It never throws, clamps numeric values to safe ranges, and falls back gracefully to default values.

```ts
const DEFAULT_PRESET: SkinPreset = {
  id: 'default',
  name: 'Default',
  rarity: 'common',
  palette: {
    primary: '#ff4a4a',
    secondary: '#1d1128',
    accent: '#ffb300',
    outline: '#1d1128',
  },
  scale: { body: 1.0, head: 1.0, limbs: 1.0 },
  features: { hornType: 'none', hornScale: 0, tailType: 'none', tailLength: 0 },
  gait: { strideLengthMultiplier: 1.0, strideHeightMultiplier: 1.0 },
  particles: { color: '#ff4a4a', spawnRate: 0 },
};

/**
 * Defensively parses a raw skin preset, ensuring all fields are present,
 * typed correctly, and clamped to safe ranges.
 */
export function migrateSkinPreset(raw: unknown): SkinPreset {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PRESET };
  const r = raw as Record<string, unknown>;

  const id = typeof r.id === 'string' ? r.id : DEFAULT_PRESET.id;
  const name = typeof r.name === 'string' ? r.name : DEFAULT_PRESET.name;
  
  const rarity = (typeof r.rarity === 'string' && ['common', 'rare', 'epic', 'legendary'].includes(r.rarity))
    ? r.rarity as CosmeticRarity
    : DEFAULT_PRESET.rarity;

  // Palette validation
  const palette = { ...DEFAULT_PRESET.palette };
  if (typeof r.palette === 'object' && r.palette !== null) {
    const p = r.palette as Record<string, unknown>;
    if (typeof p.primary === 'string' && p.primary.startsWith('#')) palette.primary = p.primary;
    if (typeof p.secondary === 'string' && p.secondary.startsWith('#')) palette.secondary = p.secondary;
    if (typeof p.accent === 'string' && p.accent.startsWith('#')) palette.accent = p.accent;
    if (typeof p.outline === 'string' && p.outline.startsWith('#')) palette.outline = p.outline;
  }

  // Scale validation (clamp to prevent invisible or giant assets)
  const scale = { ...DEFAULT_PRESET.scale };
  if (typeof r.scale === 'object' && r.scale !== null) {
    const s = r.scale as Record<string, unknown>;
    if (typeof s.body === 'number' && Number.isFinite(s.body)) scale.body = Math.max(0.1, Math.min(5.0, s.body));
    if (typeof s.head === 'number' && Number.isFinite(s.head)) scale.head = Math.max(0.1, Math.min(5.0, s.head));
    if (typeof s.limbs === 'number' && Number.isFinite(s.limbs)) scale.limbs = Math.max(0.1, Math.min(5.0, s.limbs));
  }

  // Features validation
  const features = { ...DEFAULT_PRESET.features };
  if (typeof r.features === 'object' && r.features !== null) {
    const f = r.features as Record<string, unknown>;
    if (typeof f.hornType === 'string' && ['none', 'curved', 'straight', 'spiked'].includes(f.hornType)) {
      features.hornType = f.hornType as 'none' | 'curved' | 'straight' | 'spiked';
    }
    if (typeof f.hornScale === 'number' && Number.isFinite(f.hornScale)) {
      features.hornScale = Math.max(0, Math.min(3.0, f.hornScale));
    }
    if (typeof f.tailType === 'string' && ['none', 'pointed', 'stubby', 'springy'].includes(f.tailType)) {
      features.tailType = f.tailType as 'none' | 'pointed' | 'stubby' | 'springy';
    }
    if (typeof f.tailLength === 'number' && Number.isFinite(f.tailLength)) {
      features.tailLength = Math.max(0, Math.min(5.0, f.tailLength));
    }
  }

  // Gait validation
  const gait = { ...DEFAULT_PRESET.gait };
  if (typeof r.gait === 'object' && r.gait !== null) {
    const g = r.gait as Record<string, unknown>;
    if (typeof g.strideLengthMultiplier === 'number' && Number.isFinite(g.strideLengthMultiplier)) {
      gait.strideLengthMultiplier = Math.max(0, Math.min(3.0, g.strideLengthMultiplier));
    }
    if (typeof g.strideHeightMultiplier === 'number' && Number.isFinite(g.strideHeightMultiplier)) {
      gait.strideHeightMultiplier = Math.max(0, Math.min(3.0, g.strideHeightMultiplier));
    }
  }

  // Particles validation
  const particles = { ...DEFAULT_PRESET.particles };
  if (typeof r.particles === 'object' && r.particles !== null) {
    const p = r.particles as Record<string, unknown>;
    if (typeof p.color === 'string' && p.color.startsWith('#')) particles.color = p.color;
    if (typeof p.spawnRate === 'number' && Number.isFinite(p.spawnRate)) {
      particles.spawnRate = Math.max(0, Math.min(100, p.spawnRate));
    }
  }

  return { id, name, rarity, palette, scale, features, gait, particles };
}

/**
 * Defensively parses a raw manifest. If the manifest is malformed or has an
 * incompatible version, it falls back to a default manifest.
 */
export function migrateManifest(raw: unknown): CosmeticManifest {
  const defaultManifest: CosmeticManifest = { version: 1, skins: [{ ...DEFAULT_PRESET }] };
  if (typeof raw !== 'object' || raw === null) return defaultManifest;
  const r = raw as Record<string, unknown>;

  if (r.version !== 1) return defaultManifest;

  const skins: SkinPreset[] = [];
  if (Array.isArray(r.skins)) {
    for (const s of r.skins) {
      skins.push(migrateSkinPreset(s));
    }
  }

  return { version: 1, skins: skins.length > 0 ? skins : defaultManifest.skins };
}
```

---

## Seeded Generation

Deterministic seeded generation allows us to create infinite visual variety from a single base preset without storing unique records for every variant. By utilizing `src/rng/mulberry32.ts`, we guarantee that a given seed and base skin will produce the exact same array of variants across all clients and sessions.

### Uniqueness & Contrast Safety

1. **Uniqueness (Signature Hashing)**: To ensure that generated skins in a single batch are visually distinct, we compute a string signature of the generated parameters (e.g., `"${hornType}-${hornScale.toFixed(1)}-${primaryColor}"`). If a generated variant's signature matches an existing one in the batch, we discard it and draw a new set of parameters, up to a fixed retry limit to prevent infinite loops.
2. **Contrast Safety**: We delegate contrast validation to the palette module by checking generated colors against the default dark outline or background color using `meetsWcagAa` from `src/primitives/color.ts`. If a generated color fails the contrast check, we adjust its lightness or discard the color candidate and draw another.

### Implementation Sketch

```ts
import { mulberry32, nextFloat, pick } from '../rng/mulberry32';
import { meetsWcagAa } from '../primitives/color';

/**
 * Deterministically generates a batch of visually distinct, contrast-safe skin variants.
 * Same seed + baseSkin + count -> same array of skins forever.
 *
 * @param seed - Seed for the mulberry32 PRNG
 * @param baseSkin - Base skin preset to jitter
 * @param count - Number of unique variants to generate
 */
export function generateSkinVariants(
  seed: number,
  baseSkin: SkinPreset,
  count: number,
): SkinPreset[] {
  const rng = mulberry32(seed);
  const variants: SkinPreset[] = [];
  const seenSignatures = new Set<string>();

  const maxRetries = 100;
  let retries = 0;

  while (variants.length < count && retries < maxRetries) {
    // 1. Jitter scale parameters within safe bounds
    const bodyScale = nextFloat(rng, 0.8, 1.2);
    const headScale = nextFloat(rng, 0.8, 1.2);
    const limbsScale = nextFloat(rng, 0.8, 1.2);

    // 2. Jitter features
    const hornTypes: Array<'none' | 'curved' | 'straight' | 'spiked'> = ['none', 'curved', 'straight', 'spiked'];
    const hornType = pick(rng, hornTypes);
    const hornScale = hornType === 'none' ? 0 : nextFloat(rng, 0.6, 1.4);

    const tailTypes: Array<'none' | 'pointed' | 'stubby' | 'springy'> = ['none', 'pointed', 'stubby', 'springy'];
    const tailType = pick(rng, tailTypes);
    const tailLength = tailType === 'none' ? 0 : nextFloat(rng, 0.6, 1.4);

    // 3. Jitter colors and enforce contrast
    // Note: In practice, we would use a deterministic hue-rotation or palette mixer.
    // For this sketch, we represent the contrast validation rule:
    let primary = baseSkin.palette.primary;
    // If primary color fails contrast against outline, fallback or adjust
    if (!meetsWcagAa(primary, baseSkin.palette.outline)) {
      primary = '#ff4a4a'; // Safe fallback
    }

    // 4. Generate signature to guarantee visual distinctness
    const signature = `${hornType}-${hornScale.toFixed(1)}-${tailType}-${tailLength.toFixed(1)}-${primary}`;

    if (seenSignatures.has(signature)) {
      retries++;
      continue;
    }

    seenSignatures.add(signature);
    
    const id = `${baseSkin.id}-var-${variants.length}-${seed}`;
    const name = `${baseSkin.name} Variant ${variants.length + 1}`;

    variants.push({
      id,
      name,
      rarity: 'rare',
      palette: {
        primary,
        secondary: baseSkin.palette.secondary,
        accent: baseSkin.palette.accent,
        outline: baseSkin.palette.outline,
      },
      scale: { body: bodyScale, head: headScale, limbs: limbsScale },
      features: { hornType, hornScale, tailType, tailLength },
      gait: { ...baseSkin.gait },
      particles: { ...baseSkin.particles },
    });
  }

  return variants;
}
```

---

## Ownership State & Pure Progression Ops

To manage which cosmetics a player has unlocked and equipped, we define a dedicated state structure that integrates cleanly into the main game save. Following the **pure progression ops** discipline, every state modifier is a pure function: it takes the current state, returns a brand-new state object (via deep JSON-cloning), never mutates its inputs, and never throws.

### Save State Integration

We extend a reference `SaveData` structure with optional or default-initialized cosmetics fields:

```ts
/** Extension of SaveData to support cosmetic ownership and equipment. */
export interface SaveDataWithCosmetics {
  // Existing SaveData fields
  version: number;
  highestUnlockedLevel: number;
  levelStates: any[];
  totalDeaths: number;
  keysCollected: string[];
  settings: any;

  // Pillar 2 Cosmetics fields
  /** Array of owned skin IDs, deduped and order-preserving. */
  ownedSkins?: string[];
  /** Map of slotId -> skinId. Supports multi-slot equipping. */
  equippedSkins?: Record<string, string>;
}
```

### Multi-Slot Equipment Recommendation

We strongly recommend a **multi-slot equipment system** (e.g., `'body'`, `'head'`, `'trail'`) over a single-slot system.
- **Why**: Multi-slot allows players to mix and match different procedural parts (e.g., Neon horns on a Golden body with a Fire particle trail), which exponentially increases player expression and cosmetic combinations.
- **Moat**: It creates a significantly larger monetization surface. Instead of selling a single "Devil" skin, the game can sell "Golden Horns," "Neon Body," and "Flame Trail" separately, encouraging multiple smaller microtransactions.
- **Skeletal Alignment**: It aligns perfectly with the skeletal rig structure, where different bones can be drawn using different procedural callbacks.

### Pure Progression Operations

```ts
/** Deep-clone helper matching the reference platform/progress.ts. */
function cloneSave(save: SaveDataWithCosmetics): SaveDataWithCosmetics {
  return JSON.parse(JSON.stringify(save)) as SaveDataWithCosmetics;
}

/**
 * Pure progression op: Grant a skin to the player save.
 * Dedupes owned skins, never mutates input, never throws.
 */
export function grantSkin(save: SaveDataWithCosmetics, skinId: string): SaveDataWithCosmetics {
  if (typeof skinId !== 'string' || skinId === '') return save;
  const next = cloneSave(save);
  
  if (!next.ownedSkins) {
    next.ownedSkins = [];
  }

  if (!next.ownedSkins.includes(skinId)) {
    next.ownedSkins.push(skinId);
  }

  return next;
}

/**
 * Pure progression op: Equip an owned skin into a specific slot.
 * Verifies skin ownership before equipping. Never mutates input, never throws.
 */
export function equipSkin(
  save: SaveDataWithCosmetics,
  slotId: string,
  skinId: string,
): SaveDataWithCosmetics {
  if (typeof slotId !== 'string' || slotId === '') return save;
  if (typeof skinId !== 'string' || skinId === '') return save;
  
  // Verify ownership before equipping
  if (!save.ownedSkins || !save.ownedSkins.includes(skinId)) {
    return save;
  }

  const next = cloneSave(save);

  if (!next.equippedSkins) {
    next.equippedSkins = {};
  }

  next.equippedSkins[slotId] = skinId;

  return next;
}

/**
 * Pure progression op: Unequip a skin from a specific slot.
 * Never mutates input, never throws.
 */
export function unequipSkin(save: SaveDataWithCosmetics, slotId: string): SaveDataWithCosmetics {
  if (typeof slotId !== 'string' || slotId === '') return save;
  if (!save.equippedSkins || !save.equippedSkins[slotId]) {
    return save;
  }

  const next = cloneSave(save);
  delete next.equippedSkins[slotId];

  return next;
}
```

---

## IAP Seam (Forward Compatibility)

To keep the cosmetics module completely decoupled from the future **Pillar 3 (IAP Bridge)**, we establish a clean integration seam. 

- **The Seam**: The cosmetics module (`src/cosmetics/`) only deals with `SkinPreset` parameters, manifests, and pure ownership operations (`grantSkin`, `equipSkin`). It has zero knowledge of SKUs, payment platforms, or transaction receipts.
- **The Bridge**: The future IAP module will expose a `grantEntitlement(save, sku)` operation. The game's top-level integration layer bridges these two modules by mapping purchased SKUs to corresponding skin IDs:

```ts
/**
 * Example of the integration seam in the consumer's game loop.
 * Bridges Pillar 3 (IAP) and Pillar 2 (Cosmetics) without coupling them.
 */
function handlePurchaseSuccess(save: SaveDataWithCosmetics, sku: string): SaveDataWithCosmetics {
  // 1. Record the raw entitlement in the IAP store (Pillar 3)
  let next = grantEntitlement(save, sku);

  // 2. Map the SKU to a cosmetic skin ID (Game-specific logic)
  const skinId = skuToSkinId(sku);
  
  // 3. Grant the actual cosmetic skin (Pillar 2)
  if (skinId) {
    next = grantSkin(next, skinId);
  }

  return next;
}
```

---

## Determinism Analysis & Landmines

### Determinism Guarantees
1. **Seed-Stable Generation**: Since `generateSkinVariants` relies strictly on `mulberry32` and pure math, the generated variants are 100% stable. The same seed will produce the exact same array of skins across different platforms, browsers, and compilation targets.
2. **Pure Progression State**: Ownership and equipment state transitions are pure. Given the same initial save state and operation parameters, the resulting save state is identical, with no side effects or global mutations.
3. **Defensive Parsing**: The parser is deterministic and total. For any given raw input, it returns a well-defined, validated manifest or preset, collapsing malformed structures into safe defaults.

### Critical Landmines for `@api-designer` & `@architect`

1. **JSON Deep-Clone Cost**:
   - **The Landmine**: Using `JSON.parse(JSON.stringify(save))` is incredibly safe and robust, but it has a non-trivial CPU and garbage collection cost if called multiple times per frame.
   - **Mitigation**: Ensure that ownership operations are only called during state-transition events (e.g., when a purchase completes or a player clicks "Equip" in a menu). They must **never** be called inside the main gameplay update loop (`tick`).
2. **Non-Deterministic Map/Set Iteration**:
   - **The Landmine**: While JavaScript `Map` and `Set` iteration order is guaranteed to be insertion order, converting them to arrays or serializing them can introduce subtle bugs if keys are inserted in different orders across clients (e.g., due to network latency or async loading).
   - **Mitigation**: Always represent serialized state as plain arrays (e.g., `ownedSkins: string[]`) rather than native `Set` objects, and sort keys explicitly if hashing or comparing objects.
3. **Floating-Point Jitter**:
   - **The Landmine**: Minor floating-point differences can occur across different CPU architectures (e.g., x87 vs SSE2) or JS engines (V8 vs JavaScriptCore).
   - **Mitigation**: While minor sub-pixel or sub-channel differences in cosmetic rendering are harmless, any value that affects the physics simulation (like gait multipliers or particle spawn rates) must be clamped and rounded to a fixed precision (e.g., using `.toFixed(2)` or multiplying and flooring to integers) if they ever leak back into simulation logic.

---

## Reference Implementations

- **`src/platform/save.ts` (reference)**: Canonical reference for defensive parsing, versioned migrations, and fallback-safe structures.
- **`src/platform/progress.ts` (reference)**: Canonical reference for pure progression operations, immutable state transitions, and JSON-cloning.
- **`src/rng/mulberry32.ts` (aicraft-engine)**: Seeded pseudo-random number generator used for all deterministic variant generation.

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Sokpop catalog | Details of Sokpop's parameter-driven character stacks and fake-3D projection. | [sokpop.itch.io](https://sokpop.itch.io) |

---

## Open Questions

1. **How should the palette module expose contrast repair?**
   - *Flag for `@api-designer`*: Should `enforceContrast` return a boolean flag indicating a violation, or should it actively mutate/repair the color (e.g., shifting lightness) to meet the 4.5:1 ratio?
2. **Do we need a runtime skin-caching layer?**
   - *Flag for `@coder`*: Converting a `SkinPreset` (JSON parameters) into a `BoneDrawMap` (which contains drawing functions) requires creating new function closures. Should we cache these generated `BoneDrawMap` instances to avoid garbage collection overhead, or is the recreation cost negligible at scene load?

---

## Top 3 Patterns Worth Prototyping

1. **Defensive Manifest Parser (`migrateManifest`)** — Establishes schema safety and versioning, ensuring malformed or outdated content packs never crash the game.
2. **Deterministic Seed-Driven Jitterer (`generateSkinVariants`)** — Unlocks infinite cosmetic variety from a single base preset without storing unique records, utilizing `mulberry32` and signature hashing to guarantee uniqueness.
3. **Multi-Slot Pure Progression Ops (`grantSkin`, `equipSkin`)** — Provides robust, side-effect-free state management that integrates cleanly with the main game save and maximizes player expression.

---

## Cross-References

- `docs/architecture.md` — Section on Pure Progression Ops and Adapter Pattern.
- `docs/conventions.md` — Section on TS strictness and JSDoc-everywhere.
- The canonical Sokpop reference (sokpop.itch.io) — Strategic context on Sokpop's procedural cosmetics.
