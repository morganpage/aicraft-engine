# API Proposal: Algorithmic Palette Substitution

> Target pillar: Pillar 2 (Cosmetics). Module: `src/palette/`.
> Builds on research: `docs/research/algorithmic-palette-substitution.md`, `docs/research/algorithmic-skin-variation.md`.
> Status: DRAFT.

## Consumer Need

Spitekeep and future Clone-to-Jest siblings need infinite procedural cosmetic variety without shipping PNG assets. Today, Spitekeep's `src/config/palette.ts` is a flat `as const` object with ~30 hardcoded hex strings — every new skin theme requires hand-authoring a new palette object and manually verifying contrast. Without a palette module:

- **No procedural skins.** Every cosmetic variant is a manually authored hex map. Generating 100 skins means authoring 100 objects.
- **No contrast guarantees.** The GDD §11.3 WCAG AA rule is checked manually (or not at all). A bad combination produces unreadable text or invisible silhouettes.
- **No perceptual uniformity.** Rotating hue in RGB or HSL produces jarring brightness shifts (yellow is perceived much brighter than blue at the same HSL lightness), breaking visual balance.
- **No skin-slot contract.** `BoneDrawMap` callbacks in `src/animation/types.ts` reference colors by closure; there is no standard way to swap palettes on a character without rewriting draw functions.

With this module shipped:

- **Zero-asset cosmetics.** A 32-bit seed produces a full, contrast-safe palette. Skins are data, not art.
- **Guaranteed accessibility.** Automated contrast repair ensures every generated palette meets WCAG AA (4.5:1) for all slot pairs.
- **Clean rendering contract.** Draw callbacks consume semantic slot names from a `Palette` object; swapping skins is a reference swap, not a code change.
- **Perceptually uniform variation.** OKLCH space ensures hue rotation preserves perceived brightness, producing harmonious palettes.

---

## Module Shape

```
src/palette/
├── types.ts           # Palette, PaletteOverrides, Oklch, GenerationStrategy types
├── oklch.ts           # OKLCH ↔ sRGB conversion (hand-rolled, ~54 lines)
├── resolve.ts         # resolvePalette(base, overrides?) — merge with fallback
├── generate.ts        # generatePalette(seed, base, strategy?) — seed-driven variant
├── contrast-repair.ts # repairContrast(palette, opts?) — 8-iter binary search
├── constants.ts       # Named constants (target ratios, iteration counts, gamut bounds)
└── index.ts           # Barrel export
```

**Justification for the split:**

| File | Responsibility | Why separate |
|---|---|---|
| `types.ts` | All type definitions | Types are imported by cosmetics (`SkinPreset.palette`) without pulling in conversion math |
| `oklch.ts` | Color-space conversion | Pure math, independently testable, reusable by contrast-repair and generate |
| `resolve.ts` | Palette merging | Simple pure op; separates data resolution from generation logic |
| `generate.ts` | Seed-driven palette creation | Depends on `oklch.ts` + `mulberry32`; consumer-facing entry point |
| `contrast-repair.ts` | WCAG AA enforcement | Depends on `oklch.ts` + `contrastRatio`; called by generate, also standalone |
| `constants.ts` | Named magic-number-free constants | Shared by generate + repair; no magic numbers per conventions |

---

## Decision 1: Semantic-Slot Model (CANONICAL)

This is the contract cosmetics embeds. The slot names defined here become the keys in `SkinPreset.palette` and the properties read by `BoneDrawMap` draw callbacks.

### Approach A: Fixed 5-Slot Interface (RECOMMENDED)

**Source pattern:** Research §Pattern 1 (Semantic-Slot Palette Model) — LDtk/Aseprite conventions, Sokpop *Llama Villa* skin swaps.

**Signature sketch:**

```ts
// src/palette/types.ts

/**
 * Canonical semantic-slot palette. Every property is a `#rrggbb` hex string.
 *
 * These five slots are the minimal set that supports:
 * - Character body rendering (base, accent, feature)
 * - Readability guarantees (outline vs base, feature vs base)
 * - Scene composition (background)
 *
 * **Cosmetics contract:** `SkinPreset.palette` uses exactly these slot names.
 * Draw callbacks in `BoneDrawMap` read from this object by slot name.
 * Games map slots to character parts via their draw callbacks:
 *   - `base` → body fill, card face, panel background
 *   - `accent` → clothing, armor, secondary body, markings
 *   - `feature` → eyes, weapon glow, magical highlights (highest saturation)
 *   - `outline` → 1px borders, text, deep shadows
 *   - `background` → ground tiles, card backs, neutral UI panels
 */
export interface Palette {
  /** Outlines, text, and deep shadows. Must contrast with `base` and `background`. */
  readonly outline: string;
  /** Primary body or fill color of the character/sprite/entity. */
  readonly base: string;
  /** Secondary body color: clothing, armor, markings, or secondary fill. */
  readonly accent: string;
  /** Active highlights: eyes, weapon glows, magical effects. Highest saturation. */
  readonly feature: string;
  /** Ground tiles, card faces, or neutral UI panels. Scene-level background. */
  readonly background: string;
}

/** Partial palette for skin overrides. Missing slots fall back to base palette. */
export type PaletteOverrides = Partial<Palette>;
```

**Usage example:**

```ts
import { resolvePalette } from 'aicraft-engine/src/palette';
import type { Palette } from 'aicraft-engine/src/palette';

const basePalette: Palette = {
  outline: '#1d1128',
  base: '#e63946',
  accent: '#f4a261',
  feature: '#ffffff',
  background: '#1a1025',
};

// BoneDrawMap callback reads slots by name:
const drawBody = (ctx: CanvasRenderingContext2D, rig: Rig, palette: Palette) => {
  ctx.fillStyle = palette.base;
  ctx.fillRect(-12, -16, 24, 32);
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 1;
  ctx.strokeRect(-11.5, -15.5, 23, 31);
};

// Skin swap is a palette reference swap:
const neonPalette = resolvePalette(basePalette, {
  base: '#00ff88',
  accent: '#ff00ff',
  feature: '#ffff00',
});
```

**Trade-offs:**
- **Ergonomics:** Excellent. `palette.base` reads like English. Every slot has a clear semantic role.
- **Determinism:** Pure object. No computation, no side effects.
- **Runtime cost:** Zero. It's a plain object with 5 string properties.
- **Consumer complexity:** Low. Draw callbacks destructure `{ base, outline, accent, feature, background }` — no lookup tables, no string keys.
- **Tree-shake-ability:** Types-only import costs nothing.
- **Convention fit:** Matches the `as const` palette pattern Spitekeep already uses (`palette.devilBody`, `palette.devilOutline`), but generalized to semantic roles.

**What this makes easy:**
- Compile-time type safety: `palette.typo` is a TS error.
- Automated contrast-repair rules: the engine knows exactly which slots must contrast (outline vs base, feature vs base).
- Cosmetics manifest integration: `SkinPreset.palette: Palette` is a direct type reference.
- Draw callbacks: `const { base, outline } = palette;` — clean destructuring.

**What this makes hard:**
- Games that need 6+ semantic slots (e.g., "horns", "tail", "wings") must either: (a) map multiple character parts to the same slot (horns + tail both use `accent`), or (b) extend the palette type. Option (a) is the recommended path — the palette is the *color theme*, not the *part catalog*. Part-specific coloring is the draw callback's job (it can derive shades from the slot colors using `shade()`).
- Adding a new slot later is a breaking change to the `Palette` interface. This is acceptable because: (a) the 5-slot set is minimal and well-motivated, (b) the library has no consumers yet, (c) future extension uses `PaletteOverrides` which is already `Partial<Palette>`.

### Approach B: Open-Ended Record<string, hex>

**Source pattern:** Generic key-value palette maps (e.g., CSS custom properties, Aseprite palette export).

**Signature sketch:**

```ts
export type Palette = Record<string, string>;

export function resolvePalette(base: Palette, overrides?: Palette): Palette {
  return { ...base, ...overrides };
}
```

**Usage example:**

```ts
const palette: Palette = {
  outline: '#1d1128',
  base: '#e63946',
  'horns': '#f4a261',
  'eyes': '#ffffff',
};

// Draw callback:
ctx.fillStyle = palette['horns'] ?? palette.accent;
```

**Trade-offs:**
- **Ergonomics:** Poor. `palette['horns']` is a string key — no autocomplete, no typo detection.
- **Determinism:** Pure.
- **Runtime cost:** Same as A.
- **Consumer complexity:** High. Consumers must define their own slot-name constants and remember which keys exist.
- **Tree-shake-ability:** Same.
- **Convention fit:** Violates "no magic strings" convention. Contradicts the research recommendation against open-ended keys.

**What this makes easy:**
- Adding new slots without breaking changes.
- Per-game slot customization (Spitekeep adds `horns`, a card game adds `border`).

**What this makes hard:**
- Automated contrast repair: the engine cannot know which keys represent foreground vs background.
- Type safety: `palette.hornz` (typo) silently returns `undefined`.
- Cosmetics contract: `SkinPreset.palette` has no compile-time shape guarantee.

### Approach C: Fixed Slots + Extension Record

**Source pattern:** Hybrid — TypeScript interface with an open `extras` bag.

**Signature sketch:**

```ts
export interface Palette {
  readonly outline: string;
  readonly base: string;
  readonly accent: string;
  readonly feature: string;
  readonly background: string;
  /** Game-specific extra slots (e.g., 'horns', 'wings'). Not repaired by contrast engine. */
  readonly extras?: Record<string, string>;
}
```

**Usage example:**

```ts
const palette: Palette = {
  outline: '#1d1128',
  base: '#e63946',
  accent: '#f4a261',
  feature: '#ffffff',
  background: '#1a1025',
  extras: { horns: '#f4a261', tail: '#ff6b6b' },
};
```

**Trade-offs:**
- **Ergonomics:** Medium. Core slots are typed; extras require string keys.
- **Determinism:** Pure.
- **Runtime cost:** Same.
- **Consumer complexity:** Medium. Two access patterns (`palette.base` vs `palette.extras?.horns`).
- **Tree-shake-ability:** Same.
- **Convention fit:** The `extras` bag is a mini open-ended map — it works but adds surface area.

**What this makes easy:**
- Games that genuinely need per-character-part colors beyond the 5 core slots.
- Forward compatibility: new core slots can be added later without breaking `extras` consumers.

**What this makes hard:**
- Contrast repair cannot cover `extras` slots (the engine doesn't know their semantics).
- Two access patterns in draw callbacks is inconsistent.
- The `extras` bag becomes a dumping ground for poorly thought-out slots.

### Comparison Table

| Criterion | A: Fixed 5-Slot | B: Open Record | C: Fixed + Extras |
|---|---|---|---|
| Ergonomics | ★★★★★ | ★★☆☆☆ | ★★★★☆ |
| Determinism | Pure | Pure | Pure |
| Type safety | ★★★★★ | ★☆☆☆☆ | ★★★★☆ |
| Contrast repair | ★★★★★ | ★☆☆☆☆ | ★★★☆☆ |
| Extensibility | ★★★☆☆ | ★★★★★ | ★★★★☆ |
| Convention fit | ★★★★★ | ★★☆☆☆ | ★★★☆☆ |
| Risk | Low | High (no type safety) | Medium (two patterns) |

### Recommendation: Approach A (Fixed 5-Slot)

**Rationale:** The 5-slot model is the canonical contract. The library has no consumers yet — this is the moment to get the shape right. The slots are motivated by concrete rendering needs:

| Slot | Spitekeep mapping | Why it's essential |
|---|---|---|
| `outline` | `devilOutline (#1d1128)` | Every interactive entity has a 1px dark outline (GDD §11.3). Must contrast with `base`. |
| `base` | `devilBody (#e63946)` | Primary body fill. The dominant color of any character/sprite. |
| `accent` | `devilHorns (#f4a261)`, `uiAccent` | Secondary color: clothing, horns, interactive highlights. Distinct from `base`. |
| `feature` | `devilEyes (#ffffff)`, `keyGold` | High-saturation active elements: eyes, glows, magical effects. Must contrast with `base`. |
| `background` | `bgDark (#1a1025)` | Scene-level background. `outline` and `base` must contrast with this. |

Games that need per-part colors (horns, tail, wings) map multiple character parts to the same palette slot via their `BoneDrawMap` callbacks. The palette is the *color theme*; the draw callback is the *part catalog*. This separation is what makes skin swapping a zero-overhead reference swap.

**Reconciliation with `SkinPreset.palette`:** The sibling research note (`algorithmic-skin-variation.md`) sketched `primary/secondary/accent/outline`. The canonical names are now `base/accent/feature/outline/background`. The cosmetics proposal must use these names. `primary` → `base`, `secondary` → `accent` (renamed for clarity), `feature` is new (replaces the gap between "secondary" and "accent"), `background` is new (was missing from the skin sketch).

---

## Decision 2: OKLCH Color Space

### Confirmed: OKLCH Adoption

OKLCH is the superior color space for procedural variation (research §Reference Color Space). The key property: **hue rotation in OKLCH preserves perceived brightness**, which HSL does not. This means a palette generated by rotating hue in OKLCH will have consistent visual weight across variants.

### Conversion API Surface

Two pairs of functions, composing with existing `parseHex`/`toHex` from `src/primitives/color.ts`:

```ts
// src/palette/oklch.ts

import type { RGB } from '../primitives/color';

/**
 * OKLCH color record. L = lightness [0, 1], C = chroma [0, ~0.4], H = hue [0, 360).
 *
 * OKLCH is a perceptually uniform color space: equal numeric steps in L produce
 * equal perceived brightness changes. This makes it ideal for procedural palette
 * generation and contrast repair.
 */
export interface Oklch {
  /** Lightness [0, 1]. 0 = black, 1 = white. Perceptually uniform. */
  readonly l: number;
  /** Chroma [0, ~0.4]. 0 = gray, higher = more saturated. */
  readonly c: number;
  /** Hue in degrees [0, 360). 0 = red, 120 = green, 240 = blue. */
  readonly h: number;
}

/**
 * Convert sRGB (0-255 per channel) to OKLCH.
 * Pure function. ~27 lines of matrix math (no dependencies).
 *
 * @param rgb - sRGB color with channels in [0, 255].
 * @returns OKLCH record with L in [0,1], C in [0, ~0.4], H in [0, 360).
 */
export function rgbToOklch(rgb: RGB): Oklch;

/**
 * Convert OKLCH back to sRGB. Out-of-gamut channels are clamped to [0, 255].
 * Pure function. ~27 lines of matrix math (no dependencies).
 *
 * **Gamut mapping:** Simple clamp (not chroma reduction). See Gamut Mapping
 * section below for rationale.
 *
 * @param oklch - OKLCH color.
 * @returns sRGB record with channels in [0, 255] (rounded, clamped).
 */
export function oklchToRgb(oklch: Oklch): RGB;

/**
 * Convenience: hex string → OKLCH. Composes `parseHex` + `rgbToOklch`.
 *
 * @param hex - `#rrggbb` hex string.
 * @returns OKLCH record.
 */
export function hexToOklch(hex: string): Oklch;

/**
 * Convenience: OKLCH → hex string. Composes `oklchToRgb` + `toHex`.
 *
 * @param oklch - OKLCH color.
 * @returns `#rrggbb` hex string (channels rounded and clamped).
 */
export function oklchToHex(oklch: Oklch): string;
```

**Usage example:**

```ts
import { hexToOklch, oklchToHex } from 'aicraft-engine/src/palette';

// Rotate hue 30° while preserving perceived brightness
const original = hexToOklch('#e63946'); // Spitekeep red
const shifted = { ...original, h: (original.h + 30) % 360 };
const newColor = oklchToHex(shifted); // A harmonious warm orange
```

### Gamut Mapping Decision: Simple Clamp

**The problem:** OKLCH can represent colors outside the sRGB gamut (e.g., highly saturated bright greens). When converting OKLCH→RGB, the resulting linear RGB values may be negative or exceed 1.0.

**Approach A: Simple Clamp (RECOMMENDED)**
- Clamp each RGB channel to [0, 255] after gamma correction.
- **Pro:** Zero additional code (~0 lines). Already implemented in `toHex()` which clamps channels.
- **Pro:** Deterministic. Same input → same output across all JS engines.
- **Pro:** For the library's low-fidelity aesthetic (flat-color pixel art at 24×32), minor hue shifts from clamping are imperceptible.
- **Con:** Highly saturated OKLCH colors near the gamut boundary may shift hue slightly (e.g., a vivid green may become slightly yellow-green).

**Approach B: Chroma Reduction**
- Iteratively reduce chroma until the color fits in sRGB, preserving hue and lightness.
- **Pro:** Produces the closest in-gamut color.
- **Con:** Adds ~15 lines of code and a `while` loop (determinism hazard if iteration count is unbounded).
- **Con:** Overkill for the library's use case — flat-color pixel art doesn't use edge-of-gamut colors.

**Recommendation: Simple Clamp.** The library's aesthetic is flat-color pixel art. The OKLCH values used in palette generation (research §Pattern 2) use chroma in [0, 0.35] and lightness in [0.1, 0.95], which are well within sRGB gamut. Gamut violations only occur at extreme chroma values that the generation algorithm doesn't produce. If a future use case needs gamut mapping, it can be added as a separate `gamutMap()` function without breaking the existing API.

### Constants

```ts
// src/palette/constants.ts

/** WCAG AA minimum contrast ratio for normal text (4.5:1). GDD §11.3. */
export const WCAG_AA_TARGET_RATIO = 4.5;

/** Number of binary-search iterations for contrast repair. Yields 1/256 lightness precision (channel-level). Fixed for determinism — never use a while/epsilon loop. */
export const CONTRAST_REPAIR_ITERATIONS = 8;

/** Maximum OKLCH chroma used by generation algorithms. Values above ~0.35 risk sRGB gamut violations. */
export const MAX_CHROMA = 0.35;

/** Minimum OKLCH lightness for "dark" slots (outline). Ensures outline is always near-black. */
export const MIN_LIGHTNESS = 0.05;

/** Maximum OKLCH lightness for "light" slots (background). Ensures background is never pure white. */
export const MAX_LIGHTNESS = 0.97;
```

---

## Decision 3: Palette Generation

`generatePalette` creates a full `Palette` from a 32-bit seed and a base palette config, producing a seed-stable, contrast-safe variant.

### Approach A: Harmonic Hue Rotation (RECOMMENDED)

**Source pattern:** Research §Pattern 2 (Seed-Driven Harmonic Palette Generation) — Inigo Quilez cosine gradients, OKLCH hue harmonics.

**Signature sketch:**

```ts
// src/palette/generate.ts

import type { Palette } from './types';
import type { PaletteOverrides } from './types';

/**
 * Strategy for deterministic palette generation. Controls how hue relationships
 * between slots are computed from the seed.
 */
export type GenerationStrategy =
  /** Hue offsets follow classic color-theory harmonies (complementary, triadic, analogous). */
  | 'harmonic'
  /** Full independent jitter on each slot's hue, chroma, and lightness. Maximum variety. */
  | 'jitter'
  /** Constrained analog: all slots share a base hue with small offsets. Monochromatic feel. */
  | 'analog';

/**
 * Configuration for palette generation. All tunable values are here — no magic
 * numbers in the generation algorithm.
 */
export interface GenerationConfig {
  /** Generation strategy. Default: 'harmonic'. */
  readonly strategy?: GenerationStrategy;
  /** Base lightness for the `base` slot [0, 1]. Default: 0.55. */
  readonly baseLightness?: number;
  /** Base chroma for colored slots [0, 0.35]. Default: 0.2. */
  readonly baseChroma?: number;
  /** Hue rotation range for jitter strategy [0, 360]. Default: 360. */
  readonly hueRange?: number;
  /** Lightness variation range [0, 0.3]. Default: 0.15. */
  readonly lightnessJitter?: number;
  /** Chroma variation range [0, 0.2]. Default: 0.08. */
  readonly chromaJitter?: number;
}

/**
 * Deterministically generates a full Palette from a 32-bit seed.
 *
 * Same `seed` + `basePalette` + `config` → same Palette forever.
 * The result is contrast-repaired (all slot pairs meet WCAG AA 4.5:1).
 *
 * Uses `mulberry32` for all randomness — never `Math.random`.
 *
 * @param seed - 32-bit integer seed for the PRNG.
 * @param basePalette - Base palette providing outline and background defaults.
 *   Only `outline` and `background` are read; other slots are generated.
 * @param config - Optional generation tuning. All fields have safe defaults.
 * @returns A complete, contrast-safe Palette. All colors are `#rrggbb` hex.
 */
export function generatePalette(
  seed: number,
  basePalette: Pick<Palette, 'outline' | 'background'>,
  config?: GenerationConfig,
): Palette;
```

**Usage example:**

```ts
import { generatePalette } from 'aicraft-engine/src/palette';

// Generate 100 unique, contrast-safe character palettes
const palettes = Array.from({ length: 100 }, (_, i) =>
  generatePalette(i + 1, {
    outline: '#1d1128',
    background: '#1a1025',
  })
);

// All 100 palettes meet WCAG AA. Same seed → same palette across all clients.
```

**Generation algorithm (per strategy):**

1. Create `mulberry32(seed)` RNG.
2. Pick base hue: `rng() * 360`.
3. Compute slot hues based on strategy:
   - `harmonic`: accent = base + 180° (complementary), feature = base + 60° (split-complementary).
   - `jitter`: each slot gets independent `baseHue + nextFloat(rng, -hueRange/2, hueRange/2)`.
   - `analog`: all slots within ±30° of base hue.
4. Compute slot lightness/chroma from config defaults with jitter.
5. Convert OKLCH → hex via `oklchToHex`.
6. Run `repairContrast` on the full palette (see Decision 4).
7. Return the repaired palette.

**Trade-offs:**
- **Ergonomics:** Simple call site. `generatePalette(seed, { outline, background })` — two required args, everything else has defaults.
- **Determinism:** `mulberry32` + pure math + fixed 8-iter repair = fully deterministic.
- **Runtime cost:** ~0.1ms per palette (a few trig calls + 8-iter repair × 2-3 slot pairs). One-time cost at load time.
- **Consumer complexity:** Low. Consumer provides seed + base outline/background; the algorithm handles the rest.
- **Tree-shake-ability:** Strategy is a string union — no runtime strategy objects pulled in.

### Approach B: Cosine Gradient Ramp

**Source pattern:** Inigo Quilez's cosine palette formula: `color(t) = a + b · cos(2π(c · t + d))`.

**Signature sketch:**

```ts
export function generatePalette(
  seed: number,
  basePalette: Pick<Palette, 'outline' | 'background'>,
  config?: GenerationConfig,
): Palette {
  const rng = mulberry32(seed);
  // Use cosine gradient for continuous hue ramp across slots
  const a = [rng(), rng(), rng()]; // amplitude
  const b = [rng(), rng(), rng()]; // bias
  const c = [rng(), rng(), rng()]; // frequency
  const d = [rng(), rng(), rng()]; // phase
  // Map slot index (0-3) to t ∈ [0, 1] and evaluate cosine
  // ...
}
```

**Trade-offs:**
- **Ergonomics:** Same call site as A.
- **Determinism:** Same.
- **Runtime cost:** Slightly cheaper (no harmonic lookup table).
- **Consumer complexity:** Same.
- **Convention fit:** The cosine formula produces smooth gradients but doesn't map cleanly to "complementary" or "analogous" relationships — the output is mathematically pretty but semantically opaque.

**What this makes easy:** Beautiful continuous color ramps for backgrounds and gradients.
**What this makes hard:** Predicting what a given seed will produce. The cosine formula's output is harder to reason about than explicit harmonic offsets.

### Approach C: Full Independent Jitter

**Source pattern:** Research §Pattern 3 (Seed-Driven Parameter Jittering) — JS13k character generators.

**Signature sketch:**

```ts
// Each slot gets fully independent hue, chroma, lightness jitter
function generateSlot(rng: Rng, config: GenerationConfig): string {
  const h = nextFloat(rng, 0, 360);
  const c = nextFloat(rng, 0, MAX_CHROMA);
  const l = nextFloat(rng, MIN_LIGHTNESS, MAX_LIGHTNESS);
  return oklchToHex({ l, c, h });
}
```

**Trade-offs:**
- **Ergonomics:** Same.
- **Determinism:** Same.
- **Runtime cost:** Same.
- **Consumer complexity:** Same.
- **Convention fit:** Maximum variety but minimum control. Generated palettes may look random rather than harmonious.

**What this makes easy:** Generating 1000 visually distinct palettes with zero duplication.
**What this makes hard:** Producing aesthetically cohesive palettes. Without harmonic relationships, the output is chaotic.

### Comparison Table

| Criterion | A: Harmonic Rotation | B: Cosine Gradient | C: Full Jitter |
|---|---|---|---|
| Aesthetic quality | ★★★★★ (harmonious) | ★★★★☆ (smooth) | ★★☆☆☆ (chaotic) |
| Variety | ★★★★☆ | ★★★☆☆ | ★★★★★ |
| Predictability | ★★★★☆ (named harmonies) | ★★☆☆☆ (opaque formula) | ★★☆☆☆ (random) |
| Runtime cost | ~0.1ms | ~0.08ms | ~0.1ms |
| Convention fit | ★★★★★ | ★★★☆☆ | ★★★☆☆ |

### Recommendation: Approach A (Harmonic Rotation)

**Rationale:** The `harmonic` strategy produces aesthetically cohesive palettes by construction — complementary, analogous, and triadic relationships are well-understood color theory that produces pleasing results. The `jitter` and `analog` strategies are available as alternatives for consumers who want more variety or a monochromatic feel. The strategy is a string union, not a class hierarchy — tree-shakeable and zero-cost.

The `jitter` strategy is the fallback for maximum variety (e.g., generating 1000 unique skins for a gacha system). The `analog` strategy is for themed sets (e.g., "all fire skins share a warm hue"). All three strategies feed through the same contrast-repair pipeline.

---

## Decision 4: Contrast Repair

### Signature

```ts
// src/palette/contrast-repair.ts

/**
 * Options for contrast repair.
 */
export interface ContrastRepairOptions {
  /**
   * Target contrast ratio. Default: `WCAG_AA_TARGET_RATIO` (4.5:1).
   * Increase to 7.0 for AAA compliance.
   */
  readonly targetRatio?: number;
}

/**
 * Slot pairs that must satisfy the target contrast ratio.
 * Each pair is `[foreground, background]` — the foreground slot's lightness
 * is adjusted to meet the ratio against the background slot.
 *
 * These pairs cover the critical readability constraints:
 * - `outline` must contrast with `base` (character outline visibility)
 * - `feature` must contrast with `base` (eyes, highlights readability)
 * - `outline` must contrast with `background` (outline visibility on scene)
 *
 * **Pre-computed, NOT per-frame.** This function runs once when a palette is
 * generated or loaded. It must never be called in the render loop.
 */
export const CONTRAST_PAIRS: readonly [foreground: keyof Palette, background: keyof Palette][] = [
  ['outline', 'base'],
  ['feature', 'base'],
  ['outline', 'background'],
];

/**
 * Repairs WCAG AA contrast violations in a palette by adjusting foreground
 * slot lightness in OKLCH space. Preserves hue and chroma.
 *
 * Uses a fixed **8-iteration binary search** on OKLCH lightness (deterministic,
 * bounded, no while/epsilon loop). 8 iterations yields 1/256 lightness
 * precision — channel-level accuracy.
 *
 * **Pre-computed at generation/load time, NOT per-frame.** The research note
 * confirms this is a one-time cost (~0.05ms per pair).
 *
 * **Never throws.** If a pair is mathematically unfixable (e.g., both slots
 * are clamped to extreme lightness values), returns the best-effort result.
 *
 * @param palette - The palette to repair. Input is not mutated.
 * @param opts - Optional target ratio override.
 * @returns A new Palette with repaired slot values. All colors are `#rrggbb` hex.
 */
export function repairContrast(
  palette: Palette,
  opts?: ContrastRepairOptions,
): Palette;
```

**Usage example:**

```ts
import { repairContrast } from 'aicraft-engine/src/palette';

const raw: Palette = {
  outline: '#1d1128',
  base: '#e63946',
  accent: '#f4a261',
  feature: '#ffcccc', // Too close to base — fails contrast
  background: '#1a1025',
};

const safe = repairContrast(raw);
// safe.feature is now lightened/darkened to meet 4.5:1 against safe.base
// safe.outline is verified against safe.base and safe.background
```

### Algorithm Detail

For each pair `[fg, bg]` in `CONTRAST_PAIRS`:

1. Convert both to OKLCH via `hexToOklch`.
2. Check if `contrastRatio(fg, bg) >= targetRatio`. If yes, skip.
3. Determine direction: if `fg.l > bg.l`, the foreground should be lighter; otherwise darker.
4. Set binary search bounds:
   - If lighter: `low = fg.l`, `high = 1.0`
   - If darker: `low = 0.0`, `high = fg.l`
5. Run exactly `CONTRAST_REPAIR_ITERATIONS` (8) iterations:
   - `mid = (low + high) / 2`
   - Create candidate: `{ ...fgOklch, l: mid }`
   - Convert candidate to hex, check `contrastRatio(candidate, bg) >= targetRatio`
   - If compliant: record `bestL = mid`, tighten bound toward original lightness
   - If not compliant: tighten bound away from original lightness
6. Return the best compliant lightness, or `bestL` if no compliant value was found (best-effort fallback).
7. Convert final OKLCH → hex via `oklchToHex`.

**Determinism guarantee:** The binary search is a fixed `for` loop — same input produces the same output on every JS engine. No `while`, no epsilon, no early termination.

**Fallback behavior:** If 8 iterations don't find a compliant lightness (mathematically possible when the background is mid-gray and the foreground is constrained), the function returns the closest-to-compliant result. It never throws, never returns `null`. The JSDoc documents this edge case.

**Which pairs are checked and why:**

| Pair | Reason |
|---|---|
| `outline` vs `base` | Character outline must be visible against the body fill. This is the most critical readability constraint — without it, the character silhouette disappears. |
| `feature` vs `base` | Eyes, weapon glows, and highlights must be visible against the body. If feature blends into base, the character reads as a solid blob. |
| `outline` vs `background` | The outline must be visible against the scene background. If outline and background are the same lightness, the character's outer boundary vanishes. |

**Pairs intentionally NOT checked:**
- `accent` vs `base`: These are both "fill" colors; they don't need to contrast with each other (clothing on body is fine if similar lightness).
- `feature` vs `background`: `feature` contrasts with `base`, and `base` contrasts with `outline` which contrasts with `background` — transitivity covers this case.
- `background` vs anything: `background` is the reference; it doesn't need to "stand out" from other slots.

---

## Decision 5: Palette Resolution

### Signature

```ts
// src/palette/resolve.ts

/**
 * Resolves a final palette by merging a base palette with optional overrides.
 * Missing override slots fall back silently to the base palette value.
 *
 * **Pure function.** Returns a new Palette; input is not mutated.
 * **Never throws.** If overrides is undefined, returns the base palette as-is.
 *
 * @param base - The base palette providing default slot values.
 * @param overrides - Optional partial overrides. Missing slots use base values.
 * @returns A complete Palette with all 5 slots populated.
 */
export function resolvePalette(
  base: Palette,
  overrides?: PaletteOverrides,
): Palette;
```

**Usage example:**

```ts
import { resolvePalette } from 'aicraft-engine/src/palette';

const base: Palette = {
  outline: '#1d1128',
  base: '#e63946',
  accent: '#f4a261',
  feature: '#ffffff',
  background: '#1a1025',
};

// Override only the body color — everything else inherits
const skin = resolvePalette(base, { base: '#00ff88' });
// skin.outline === '#1d1128' (inherited)
// skin.base === '#00ff88' (overridden)
// skin.accent === '#f4a261' (inherited)
```

### Fallback Decision: Silent Fallback

When `overrides` is `undefined` or a slot is missing from `overrides`, the base palette value is used silently. No error, no warning, no derived color.

**Why not error?** The pure-progression-ops discipline (architecture.md) requires functions to never throw. Silent fallback is consistent with `grantSkin`/`equipSkin` which silently no-op on invalid input.

**Why not warn?** Warnings in a deterministic library are non-deterministic (console output order, timing). Silent fallback is cleaner.

**Why not derive?** Deriving missing slots (e.g., "if no accent, darken base by 20%") adds complexity and non-obvious behavior. The consumer knows what colors they want — let them specify explicitly.

---

## Decision 6: Full Pipeline Integration

The complete palette pipeline is:

```
generatePalette(seed, base, config?) → raw Palette
  ↓
repairContrast(raw, opts?) → safe Palette
  ↓
resolvePalette(safe, overrides?) → final Palette
  ↓
consumed by BoneDrawMap callbacks
```

`generatePalette` internally calls `repairContrast` — the returned palette is always contrast-safe. `resolvePalette` is called by the cosmetics layer when applying per-skin overrides to a generated palette.

**Important:** `repairContrast` is also exported standalone for consumers who manually author palettes and want to validate/repair them:

```ts
import { repairContrast } from 'aicraft-engine/src/palette';

// Manually authored palette — validate and repair
const myPalette = repairContrast({
  outline: '#1d1128',
  base: '#e63946',
  accent: '#f4a261',
  feature: '#ffcccc',
  background: '#1a1025',
});
```

---

## Cross-Stream Dependencies

### Cosmetics Proposal Must Honor

1. **`SkinPreset.palette` must use the `Palette` type from `src/palette/types.ts`.** The slot names are `outline`, `base`, `accent`, `feature`, `background`. No `primary`/`secondary` — those names are rejected.

2. **`generateSkinVariants` must call `generatePalette` + `repairContrast` for the palette field.** The skin generator should not implement its own color logic — it delegates to the palette module.

3. **`BoneDrawMap` draw callbacks receive `Palette` as a parameter (or close over it).** The palette is the data; the draw callback is the algorithm. This is the clean separation the rendering contract requires.

### Animation Proposal Must Honor

4. **`BoneDrawMap` does NOT change.** The existing `draw: (ctx, rig) => void` signature is sufficient — draw callbacks close over the palette. Adding a `palette` parameter to the draw callback would be a breaking change to a shipped API. Instead, the cosmetics layer creates closures: `(ctx, rig) => drawBody(ctx, rig, palette)`.

### Fake-3D Proposal Must Honor

5. **`drawCube` and `isometricTile` accept `Palette` for face shading.** The fake-3D module should use `Palette.base` / `Palette.accent` for face fills, not raw hex strings. This ensures fake-3D entities respect the same skin system as 2D characters.

---

## Comparison Summary

| Decision | Recommended | Alternative | Why recommended |
|---|---|---|---|
| Slot model | Fixed 5-slot `Palette` interface | Open `Record<string, hex>` | Type safety, contrast repair, convention fit |
| Color space | OKLCH with simple clamp gamut mapping | HSL (rejected: non-uniform) | Perceptual uniformity, research-backed |
| Generation strategy | Harmonic hue rotation | Cosine gradient, full jitter | Aesthetic quality + predictability |
| Contrast repair | 8-iter binary search, 3 slot pairs | While/epsilon loop (rejected: non-deterministic) | Bounded, deterministic, matches IK fixed-iter pattern |
| Resolution | Silent fallback to base | Error on missing slot (rejected: throws) | Pure-progression-ops discipline |
| Gamut mapping | Simple clamp | Chroma reduction (rejected: overkill) | Zero additional code, sufficient for low-fi aesthetic |

---

## Open Questions for @architect

1. **Slot count stability:** The 5-slot model is minimal. If a future game needs a 6th slot (e.g., `shadow` for drop shadows), adding it to the `Palette` interface is a breaking change. Is the 5-slot set sufficient for the foreseeable future, or should we adopt Approach C (fixed + extras) now to avoid a breaking change later?

2. **Contrast pair completeness:** The 3 contrast pairs (`outline`/`base`, `feature`/`base`, `outline`/`background`) cover the critical readability constraints. Should `accent` vs `base` also be checked? The argument against: accent and base are both "fill" colors and don't need to contrast. The argument for: a light accent on a light base (or vice versa) can make the character look washed out.

3. **`repairContrast` standalone export:** Should consumers be able to call `repairContrast` on manually authored palettes, or should it be an internal function only called by `generatePalette`? The proposal exports it standalone — is this too much surface area?

4. **Generation config defaults:** The `GenerationConfig` defaults (`baseLightness: 0.55`, `baseChroma: 0.2`, etc.) are tuned for character skins. Should these defaults be more conservative (lower chroma, wider lightness range) to accommodate non-character use cases (UI panels, card themes)?
