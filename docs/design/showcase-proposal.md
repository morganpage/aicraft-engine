# Architecture Proposal: Showcase Page

> Target: Consumer-facing interactive landing page. Module: `showcase/`.
> Builds on research: `docs/research/showcase-page.md`.
> Status: DRAFT.
> Decision: Vanilla TS + Vite, full 9-section showcase, design-first then prototype.

---

## 1. Directory Layout

```
showcase/
├── index.html                    # Entry point — all 9 sections, semantic HTML
├── style.css                     # Global styles — Sokpop aesthetic via CSS (outlines, palette vars)
├── vite.config.ts                # Vite config for the showcase (extends root devDeps)
├── tsconfig.json                 # Standalone config — typechecks showcase + imported library source in one pass
├── main.ts                       # Bootstrap: wires state store, starts render loops, reads URL params
├── store.ts                      # Observable state store (createStore<T> factory)
├── helpers/
│   ├── code-snippet.ts           # Live-mutating code snippet renderer (template strings + token swap)
│   ├── section-wire.ts           # Reusable: slider → store → canvas wiring per section
│   └── slime-knight.ts           # Shared drawSlimeKnight() — the canonical hero character
├── sections/
│   ├── hero.ts                   # Section 1: animated slime-knight + seed roll
│   ├── pitch-cards.ts            # Section 2: 3 cards (zero-dep, determinism, algorithmic art)
│   ├── primitives.ts             # Section 3: outlineRect + color math playground
│   ├── determinism-prover.ts     # Section 4: dual-canvas determinism proof (centerpiece)
│   ├── particles.ts              # Section 5: particle burst playground
│   ├── animation.ts              # Section 6: 5 sub-demos (IK, spring, locomotion, squash, rig)
│   ├── palette.ts                # Section 7: palette generation + contrast visualization
│   ├── cosmetics.ts              # Section 8: skin variant generation + ownership demo
│   └── install.ts                # Section 9: install + code copy + links
├── assets/
│   ├── og-image.png              # Open Graph image (hero screenshot or in-game-shapes.png)
│   └── favicon.svg               # 32×32 SVG favicon (tiny outlineRect-based icon)
└── dist/                         # Vite build output (git-ignored)
```

### Why this shape

- **One `main.ts`** boots everything — no framework router, no lazy chunks needed for a 9-section page.
- **Each section is a function** `initSection(container: HTMLElement, store: Store<GlobalState>): void` that owns its own canvas, sliders, and code snippet. Sections don't talk to each other directly — only through the store.
- **`helpers/`** isolates reusable logic from section-specific logic. `slime-knight.ts` is the most important shared file — it defines the canonical character that hero, determinism prover, and cosmetics all draw.
- **`store.ts`** is ~50 lines. It lives at the showcase level, not in the library.

---

## 2. The Zero-Dep Boundary (CRITICAL)

### How the showcase imports the library

```ts
// showcase/sections/primitives.ts
import { outlineRect, shade, DEFAULT_OUTLINE_COLOR, parseHex, toHex, contrastRatio } from '../../src/primitives';
```

Relative paths from `showcase/` into `src/`. Vite resolves these natively — no alias, no symlink, no package.json dependency. The library is source, not a built artifact.

**Barrel-first rule:** All showcase imports MUST go through the module barrel (`../../src/primitives`, `../../src/animation`, `../../src/palette`, `../../src/cosmetics`). Never deep-import internal files (`../../src/animation/ik/limb`, `../../src/primitives/color`, etc.) — this violates `docs/conventions.md` §Module structure and creates breakage risk if internal files are reorganized. The barrel API is the stable contract; internal paths are not.

### tsconfig isolation strategy

**The library's `npm run build` (`tsc --noEmit`) must continue to pass WITHOUT the showcase compiling.** This is non-negotiable — the showcase has DOM deps, Vite client types, etc. that the library must never see.

**Root `tsconfig.json`** stays exactly as-is:

```jsonc
{
  "compilerOptions": { /* strict, ES2021, etc. */ },
  "include": ["src"],                    // ← only library source
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

**New `showcase/tsconfig.json`** — a standalone config, NOT a project reference of the root:

```jsonc
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2021", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["."],
  "exclude": ["dist"]
}
```

Key points:
- `include: ["."]` — only showcase files.
- With `moduleResolution: "bundler"`, TypeScript resolves relative imports like `../../src/primitives` directly against the source `.ts` files and type-checks them inline. No `references` field is needed — the showcase `tsc --noEmit` pass type-checks both showcase code and any library code it imports, as a single pass over `showcase/**`. The library's own `tsc --noEmit` (root `include: ["src"]`) remains untouched and never sees `showcase/`.
- `types: ["vite/client"]` — provides `import.meta.env`, `/// <reference types="vite/client" />`, etc.
- The root `tsconfig.json` does NOT have `composite: true` and its `include: ["src"]` excludes the showcase. These two configs are completely independent.

### package.json strategy

**Keep a single root `package.json`.** Rationale:

1. `vite` is already a root devDep — the showcase just adds `vite.config.ts` inside `showcase/`.
2. A separate `showcase/package.json` would need its own `npm install` step, creating a two-install friction for contributors. The library is a single repo with a single `npm install`.
3. If the showcase ever needs extra devDeps (e.g., a syntax highlighter), they go in the root `devDependencies` with a `// showcase-only` comment in the rationale docs. They never become runtime deps.

**No new devDeps needed for the initial showcase.** Vite handles CSS, TypeScript, and the dev server. Code snippets use template strings — no highlighter library.

### New npm scripts

Add to root `package.json`:

```jsonc
{
  "scripts": {
    // existing
    "dev": "vite",
    "build": "tsc --noEmit",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    // new — showcase
    "showcase:dev": "vite --config showcase/vite.config.ts",
    "showcase:build": "vite build --config showcase/vite.config.ts",
    "showcase:typecheck": "tsc --noEmit --project showcase/tsconfig.json"
  }
}
```

- `showcase:dev` — Vite dev server serving `showcase/index.html` with HMR.
- `showcase:build` — static output to `showcase/dist/`.
- `showcase:typecheck` — typechecks showcase code AND the library source it imports (via bundler-resolution relative imports against `src/`). Standalone pass — does not affect the root `tsc --noEmit` which only covers `src/`.

### Zero-dep invariant

The showcase adds **zero runtime dependencies** to the library. Evidence:
- The showcase imports library source via relative paths — it's a consumer, like any game.
- No new `dependencies` block in `package.json`.
- No new `devDependencies` that affect the library build. `vite` is already a devDep.
- Library consumers who never touch `showcase/` are completely unaffected. The `include: ["src"]` gate in `tsconfig.json` ensures this.

---

## 3. State Store Pattern (Slider ↔ Code ↔ Canvas Sync)

The highest-boilerplate problem in vanilla TS is syncing UI controls to rendering. Here's the minimal solution.

### The `createStore<T>` factory (~45 lines)

```ts
// showcase/store.ts

type Listener<T> = (state: T, prev: T) => void;

export interface Store<T> {
  get(): T;
  set(partial: Partial<T>): void;
  subscribe(listener: Listener<T>): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = { ...initial };
  const listeners = new Set<Listener<T>>();

  return {
    get: () => state,
    set(partial) {
      const prev = state;
      state = { ...state, ...partial };
      for (const fn of listeners) fn(state, prev);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}
```

### Global state shape

```ts
// showcase/main.ts
import { createStore } from './store';
import type { Palette } from '../src/palette/types';

interface GlobalState {
  // Hero
  heroSeed: number;
  heroPalette: Palette;
  heroSpeed: number;

  // Determinism prover
  proverSeedA: number;
  proverSeedB: number;
  proverDesynced: boolean;
  seedHistory: number[];

  // Primitives playground
  rectW: number;
  rectH: number;
  rectFill: string;

  // Particles
  particleCount: number;
  particleSpeed: number;
  particleGravity: number;

  // Animation (shared across 5 sub-demos)
  animDemo: 'ik' | 'spring' | 'locomotion' | 'squash' | 'rig';
  ikBoneLength: number;
  springGravity: number;
  walkSpeed: number;
  breathAmplitude: number;

  // Palette
  paletteSeed: number;
  palettePalette: Palette;

  // Cosmetics
  cosmeticSeed: number;
  cosmeticOwned: string[];
  cosmeticEquipped: string;
}

const store = createStore<GlobalState>({ /* defaults */ });
```

### How a section wires slider → store → code snippet → canvas

The pattern is ~15 lines per section. Here's the primitives section as a concrete example:

```ts
// showcase/sections/primitives.ts
import { outlineRect, DEFAULT_OUTLINE_COLOR } from '../../src/primitives';
import { renderSnippet } from '../helpers/code-snippet';
import type { Store } from '../store';
import type { GlobalState } from '../main';

export function initPrimitives(container: HTMLElement, store: Store<GlobalState>): void {
  const canvas = container.querySelector<HTMLCanvasElement>('.demo-canvas')!;
  const ctx = canvas.getContext('2d')!;
  const snippet = container.querySelector<HTMLElement>('.code-snippet')!;
  const slider = container.querySelector<HTMLInputElement>('.width-slider')!;

  // Wire slider → store
  slider.addEventListener('input', () => {
    store.set({ rectW: Number(slider.value) });
  });

  // Wire store → code snippet + canvas
  store.subscribe((state) => {
    // Mutate code text
    snippet.textContent = renderSnippet('outlineRect', {
      w: state.rectW,
      h: state.rectH,
      fill: state.rectFill,
    });

    // Re-render canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    outlineRect(ctx, 10, 10, state.rectW, state.rectH, state.rectFill, DEFAULT_OUTLINE_COLOR);
  });
}
```

**That's it.** No framework, no virtual DOM, no reactivity system. Just a `subscribe` callback that touches two DOM nodes. The store fires synchronously — no batching needed at this scale.

### Motion gating (reduced-motion)

Five+ sections run `requestAnimationFrame` loops (hero, determinism prover, particles, animation 6b/6c, cosmetics equipped character). The library exports `prefersReducedMotion()` from `src/primitives/motion.ts` — a cached-at-module-load probe. The showcase wraps this in a single helper.

**New file: `showcase/helpers/motion-gate.ts`**

```ts
// showcase/helpers/motion-gate.ts
import { prefersReducedMotion } from '../../src/primitives';

/**
 * Cached at module load. Returns true if the user prefers reduced motion.
 * Every section's initSection() checks this once — no per-frame cost.
 */
export const shouldAnimate = prefersReducedMotion;
```

**Rule every section follows:** Each `initSection()` function checks `shouldAnimate()` once at init time. If `true`, render a SINGLE static frame (character at phase 0, particles in their initial spawn state, spring chain at rest) and DO NOT start a `requestAnimationFrame` loop. If `false`, start the loop normally.

For locomotion/squash demos specifically, even in the static frame `scaledGait(config, 0)` / `scaledBreath(config, 0)` can zero out amplitudes — but a single static frame is simpler and sufficient. The key contract: **reduced-motion users see a meaningful still image, never a blank canvas, and never an animation loop.**

This is a step-1 scaffold concern, not polish — every section's render path must branch on this from the start.

---

## 4. Section-by-Section Design

### Section 1: Hero (Animated Slime-Knight)

**Library exports used:**
- `mulberry32`, `nextInt`, `nextFloat` (from `src/rng`)
- `generatePalette` (from `src/palette`)
- `outlineRect`, `shade` (from `src/primitives`)
- `createSkeleton`, `createRig`, `computeWorldTransforms` (from `src/animation`)
- `advanceLocomotion`, `evaluateLocomotion`, `DEFAULT_GAIT`, `scaledGait` (from `src/animation`)
- `solveLimb`, `calculateBendDir` (from `src/animation`)
- `createSpringChain`, `advanceSpringChain`, `DEFAULT_SPRING` (from `src/animation`)
- `breathe`, `DEFAULT_BREATH`, `volumeScale` (from `src/animation`)
- `bob` (from `src/animation`)

**Interaction:** User clicks 🎲 to re-roll seed. Seed displayed as `#98724`. Optional speed slider to slow down/walk faster.

**Live code snippet shows:**
```ts
const rng = mulberry32(${seed});
const palette = generatePalette(${seed});
// Body: outlineRect(ctx, cx - 25, cy - 25, 50, 50, palette.base, palette.outline)
// Legs: solveLimb(hip, foot, ${boneA}, ${boneB}, { bendDir })
// Antenna: advanceSpringChain(nodes, ax, ay, 1, springConfig)
```

**Rendering:** `requestAnimationFrame` loop. The character walks in place (locomotion cycle), antenna sways via spring chain, body breathes via `breathe()`.

**Showcase-local helpers needed:**
- `drawSlimeKnight(ctx, palette, rigState, tick)` — the canonical character renderer shared between hero, determinism prover, and cosmetics. Defined in `helpers/slime-knight.ts`.

### Section 2: Pitch Cards

**Library exports used:** None directly — these are static HTML cards with CSS styling.

**Interaction:** Hover to see subtle CSS scale transform. Click "Learn more" anchors to jump to the relevant section.

**Live code snippet:** None (pure marketing content).

**Rendering:** No `requestAnimationFrame`. Pure CSS. Cards use the Sokpop aesthetic: 2px `#1d1128` outlines via CSS `border`, flat palette fills via CSS custom properties.

### Section 3: Primitives Playground

**Library exports used:**
- `outlineRect`, `DEFAULT_OUTLINE_COLOR`, `shade`, `mixHex`, `parseHex`, `toHex`, `contrastRatio`, `meetsWcagAa`, `clamp`, `lerp`, `approach` (from `src/primitives`)

**Interaction:** Sliders for rect width, height, fill color (5-slot palette picker), outline toggle. Each slider move re-renders.

**Live code snippet shows:**
```ts
outlineRect(ctx, 10, 10, ${w}, ${h}, '${fill}', ${outline ? "DEFAULT_OUTLINE_COLOR" : "undefined"});
// shade('${fill}', ${factor}) → '${shade(fill, factor)}'
```

**Rendering:** Re-renders on input only (no `requestAnimationFrame`). Canvas is 256×256.

### Section 4: Determinism Prover (Centerpiece)

**Library exports used:** Same as hero — `mulberry32`, `generatePalette`, `outlineRect`, full rig/IK/spring/locomotion stack. This section reuses `drawSlimeKnight()`.

**Interaction:**
1. Two canvases side by side, both showing the same slime-knight from the same seed.
2. Seed text input (editable). Enter a number or click 🎲.
3. "Desynchronize" button — rolls a new seed for Canvas B only, showing them diverge.
4. "Copy link" button — writes `?seed=12345` to URL.
5. Seed history: list of previously rolled seeds. Click to snap both canvases back.

**Live code snippet shows:**
```ts
// Canvas A
const rngA = mulberry32(${seedA});
const paletteA = generatePalette(${seedA});
drawSlimeKnight(ctxA, paletteA, rngA, tick);

// Canvas B
const rngB = mulberry32(${seedB});
const paletteB = generatePalette(${seedB});
drawSlimeKnight(ctxB, paletteB, rngB, tick);
```

**Rendering:** `requestAnimationFrame` loop. Both canvases run identical animation ticks. When desynced, Canvas B's seed changes mid-animation — the visual divergence is immediate and dramatic.

### Section 5: Particles

**Library exports used:**
- `spawn`, `step`, `cull` (from `src/particles`)

**Interaction:** Sliders for particle count (1–32), speed (1–8), gravity (0–5). "Burst" button triggers `spawn()`. Particles animate and die.

**Live code snippet shows:**
```ts
let particles = spawn(x, y, {
  count: ${count},
  speed: ${speed},
  life: 24,
  size: 4,
  rng: mulberry32(${seed}),
});
particles = step(particles, 1);
```

**Rendering:** `requestAnimationFrame` loop while particles are alive. Stops when all culled.

### Section 6: Animation (5 Sub-Demos)

**Sub-demo 6a: IK Limb Reach**
- **Exports:** `solveLimb`, `calculateBendDir`
- **Interaction:** Drag target point; 2-bone limb follows. Slider for bone length (20–80).
- **Snippet:** `solveLimb(root, target, ${lenA}, ${lenB}, { bendDir })`
- **Rendering:** Re-renders on input.

**Sub-demo 6b: Spring Chain**
- **Exports:** `createSpringChain`, `advanceSpringChain`, `DEFAULT_SPRING`
- **Interaction:** Drag anchor point; spring chain follows with Verlet physics.
- **Snippet:** `advanceSpringChain(nodes, ${ax}, ${ay}, 1, { segmentLength: ${segLen} })`
- **Rendering:** `requestAnimationFrame` (continuous physics).

**Sub-demo 6c: Locomotion Cycle**
- **Exports:** `advanceLocomotion`, `evaluateLocomotion`, `DEFAULT_GAIT`, `scaledGait`
- **Interaction:** Speed slider (0–2x). Walk in place.
- **Snippet:** `evaluateLocomotion(state, { baseFrequency: ${freq}, strideLength: ${stride} })`
- **Rendering:** `requestAnimationFrame`.

**Sub-demo 6d: Squash & Stretch**
- **Exports:** `volumeScale`, `breathe`, `projectTurnedPart`, `DEFAULT_BREATH`
- **Interaction:** Drag angle slider to see turning projection. Toggle breathing.
- **Snippet:** `projectTurnedPart(14, 0, ${angle}) // scaleX=${sx}`
- **Rendering:** Re-renders on input.

**Sub-demo 6e: Rig Hierarchy**
- **Exports:** `createSkeleton`, `createRig`, `computeWorldTransforms`
- **Interaction:** Drag bone rotation sliders (hip, spine). Watch world transforms propagate.
- **Snippet:** `rig.localPoses[0].rotation = ${rotation} // radians`
- **Rendering:** Re-renders on input.

**Tab switching:** Sub-demos are tabbed within the section. Only the active tab runs its render loop. Implemented as 5 `<div>` panels toggled by `display: none/block`.

### Section 7: Palette

**Library exports used:**
- `generatePalette`, `resolvePalette`, `repairContrast` (from `src/palette`)
- `contrastRatio`, `meetsWcagAa` (from `src/primitives`)

**Interaction:** Seed input + 🎲 button. Shows 5-slot palette swatches. Contrast ratio badges for each checked pair. Strategy selector (triadic/complementary/analogous).

**Live code snippet shows:**
```ts
const palette = generatePalette(${seed}, { strategy: '${strategy}' });
// outline: ${palette.outline}  contrast vs base: ${ratio1}:1
// feature: ${palette.feature}  contrast vs base: ${ratio2}:1
```

**Rendering:** Re-renders on input only. No `requestAnimationFrame`.

### Section 8: Cosmetics

**Library exports used:**
- `generateSkinVariants`, `grantSkin`, `equipSkin`, `unequipSkin`, `DEFAULT_COSMETIC_SAVE`, `MANIFEST_VERSION` (from `src/cosmetics`)

**Interaction:** Seed + count sliders to generate N skin variants. Grid of generated variants. Click to "grant" and "equip" — shows ownership state updating. Renders equipped variant using `drawSlimeKnight()` with the variant's palette.

**Live code snippet shows:**
```ts
const variants = generateSkinVariants(${seed}, baseSkin, ${count});
// variant[0]: palette=${JSON.stringify(variants[0].palette)}
save = grantSkin(save, '${variants[0].id}');
save = equipSkin(save, 'body', '${variants[0].id}');
```

**Rendering:** Re-renders on input (palette swap) + `requestAnimationFrame` for the equipped character's walk animation.

### Section 9: Install

**Library exports used:** None — pure HTML/CSS content.

**Interaction:** Copy button for install commands (`git submodule add ...`). Links to source, docs, Skool community.

**Live code snippet:** Static, not live-mutating. Shows the canonical import pattern from README.

**Rendering:** No canvas. Pure HTML.

---

## 5. The Hero's Seed Contract

One seed produces an entire character. The derivation is deterministic and documented:

```ts
// showcase/helpers/slime-knight.ts

export interface HeroConfig {
  seed: number;
  speed: number;        // 0 = idle, 1 = walk, 2 = run
}

export interface HeroState {
  palette: Palette;
  gaitConfig: GaitConfig;
  springConfig: SpringConfig;
  breathConfig: BreathConfig;
  boneLengths: { thigh: number; shin: number };
  antennaSegments: number;
  antennaSegmentLength: number;
  eyeRadius: number;
  bodyWidth: number;
  bodyHeight: number;
}

/**
 * Tunable ranges for hero generation. Every magic number lives here —
 * consumers can override individual fields by spreading their own config.
 */
export const HERO_RANGES = {
  bodyWidth:    { base: 40, jitter: 20 },  // 40–59
  bodyHeight:   { base: 35, jitter: 15 },  // 35–49
  eyeRadius:    { base: 8,  jitter: 5 },   // 8–12
  thigh:        { base: 30, jitter: 15 },  // 30–44
  shin:         { base: 28, jitter: 15 },  // 28–42
  antennaSegments: { base: 3, jitter: 3 }, // 3–5
  antennaSegmentLength: { base: 6, jitter: 4 }, // 6–10
  gaitFrequencyMul:  { min: 0.8, max: 1.2 },  // × DEFAULT_GAIT.baseFrequency
  gaitStrideLenMul:  { min: 0.7, max: 1.3 },  // × DEFAULT_GAIT.strideLength
  gaitStrideHtMul:   { min: 0.6, max: 1.4 },  // × DEFAULT_GAIT.strideHeight
  gaitHipBobMul:     { min: 0.5, max: 1.5 },  // × DEFAULT_GAIT.hipBobHeight
  gaitHipSwayMul:    { min: 0.5, max: 1.5 },  // × DEFAULT_GAIT.hipSwayWidth
  springGravityMul:  { min: 0.8, max: 1.2 },  // × DEFAULT_SPRING.gravityY
  springDrag:        { min: 0.92, max: 0.98 },
  breathFreqMul:     { min: 0.8, max: 1.2 },  // × DEFAULT_BREATH.frequency
  breathAmpMul:      { min: 0.7, max: 1.3 },  // × DEFAULT_BREATH.amplitude
} as const;

/**
 * Derive a complete hero config from a single seed.
 * Same seed → same config → same hero, forever.
 */
export function deriveHeroConfig(seed: number): HeroConfig {
  const rng = mulberry32(seed);
  const R = HERO_RANGES;

  // Palette: generatePalette creates its own mulberry32(seed) internally.
  // Our rng below starts fresh from the same seed for body proportions —
  // two independent streams from the same seed.
  const palette = generatePalette(seed);

  // Body proportions: jittered from defaults
  const bodyWidth = R.bodyWidth.base + nextInt(rng, 0, R.bodyWidth.jitter);
  const bodyHeight = R.bodyHeight.base + nextInt(rng, 0, R.bodyHeight.jitter);
  const eyeRadius = R.eyeRadius.base + nextInt(rng, 0, R.eyeRadius.jitter);

  // Bone lengths
  const thigh = R.thigh.base + nextInt(rng, 0, R.thigh.jitter);
  const shin = R.shin.base + nextInt(rng, 0, R.shin.jitter);

  // Gait: jittered from DEFAULT_GAIT
  const gaitConfig: GaitConfig = {
    baseFrequency: DEFAULT_GAIT.baseFrequency * lerp(R.gaitFrequencyMul.min, R.gaitFrequencyMul.max, nextFloat(rng, 0, 1)),
    strideLength: DEFAULT_GAIT.strideLength * lerp(R.gaitStrideLenMul.min, R.gaitStrideLenMul.max, nextFloat(rng, 0, 1)),
    strideHeight: DEFAULT_GAIT.strideHeight * lerp(R.gaitStrideHtMul.min, R.gaitStrideHtMul.max, nextFloat(rng, 0, 1)),
    hipBobHeight: DEFAULT_GAIT.hipBobHeight * lerp(R.gaitHipBobMul.min, R.gaitHipBobMul.max, nextFloat(rng, 0, 1)),
    hipSwayWidth: DEFAULT_GAIT.hipSwayWidth * lerp(R.gaitHipSwayMul.min, R.gaitHipSwayMul.max, nextFloat(rng, 0, 1)),
  };

  // Spring: antenna segments + physics
  const antennaSegments = R.antennaSegments.base + nextInt(rng, 0, R.antennaSegments.jitter);
  const antennaSegmentLength = R.antennaSegmentLength.base + nextFloat(rng, 0, R.antennaSegmentLength.jitter);
  const springConfig: SpringConfig = {
    ...DEFAULT_SPRING,
    segmentLength: antennaSegmentLength,
    gravityY: DEFAULT_SPRING.gravityY * lerp(R.springGravityMul.min, R.springGravityMul.max, nextFloat(rng, 0, 1)),
    drag: lerp(R.springDrag.min, R.springDrag.max, nextFloat(rng, 0, 1)),
  };

  // Breathing
  const breathConfig: BreathConfig = {
    frequency: DEFAULT_BREATH.frequency * lerp(R.breathFreqMul.min, R.breathFreqMul.max, nextFloat(rng, 0, 1)),
    amplitude: DEFAULT_BREATH.amplitude * lerp(R.breathAmpMul.min, R.breathAmpMul.max, nextFloat(rng, 0, 1)),
  };

  return {
    seed,
    palette,
    gaitConfig,
    springConfig,
    breathConfig,
    boneLengths: { thigh, shin },
    antennaSegments,
    antennaSegmentLength,
    eyeRadius,
    bodyWidth,
    bodyHeight,
  };
}
```

**The contract:** `deriveHeroConfig(N)` always returns the same `HeroConfig` for the same `N`. The `mulberry32` sequence is consumed in a fixed order: palette → body proportions → bones → gait → spring → breath. No `Math.random`, no `Date.now()`. Same seed = same hero, forever.

**Visual richness:** The hero has a rounded body (`outlineRect` with radius), a cyclops eye (filled circle with pupil + highlight), two IK-driven legs (`solveLimb`), a spring-driven antenna (`advanceSpringChain`), and a breathing body (`breathe`). Each seed produces a distinct character: different proportions, different palette, different antenna sway, different gait rhythm. But the same seed always produces the same character.

---

## 6. The Determinism Prover (Centerpiece)

### Exact mechanic

```
┌─────────────────────────────┬─────────────────────────────┐
│     Canvas A (Seed: 98724)  │     Canvas B (Seed: 98724)  │
│                             │                             │
│   ┌───────────────────┐     │   ┌───────────────────┐     │
│   │  [slime-knight]   │     │   │  [slime-knight]   │     │
│   │  identical to B   │     │   │  identical to A   │     │
│   └───────────────────┘     │   └───────────────────┘     │
│                             │                             │
│   walking animation ↻       │   walking animation ↻       │
└─────────────────────────────┴─────────────────────────────┘

  Seed: [ 98724 ] [🎲] [📋 Copy Link]

  [ Desynchronize B ]  ← button rolls new seed for Canvas B only

  Seed History:
  • #98724  ← click to restore
  • #41203
  • #77102
```

### Scene rendered

Both canvases render a **simplified hero scene**: the slime-knight character (from `drawSlimeKnight`) standing on a small ground tile. The character walks in place with the full animation stack (locomotion + IK legs + spring antenna + breathing). This is visually rich enough that:
- **Identity is obvious** — same palette, same proportions, same antenna sway pattern.
- **Divergence is dramatic** — when desynced, the character's colors, proportions, and animation all change simultaneously.

### `?seed=` URL handling

```ts
// showcase/main.ts
function readSeedFromURL(): number | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('seed');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 2_147_483_647 ? n : null;
}

function writeSeedToURL(seed: number): void {
  const url = new URL(window.location.href);
  url.searchParams.set('seed', String(seed));
  window.history.replaceState(null, '', url);
}
```

**Is this a determinism violation?** No. URL reading is a host-side input, like a slider value. The library's deterministic core never reads the URL. The showcase (a consumer) reads the URL and passes the seed value into `mulberry32(seed)`. This is identical to how a game reads a save file and uses it as seed input.

### Seed history

Stored as `number[]` in the global store. Capped at 20 entries. Rendered as a clickable list below the canvases. Clicking a history entry sets both canvases to that seed.

---

## 7. Code-Snippet Rendering

### Approach: Template strings with token substitution

No syntax highlighter. No library. Just template strings with `{{token}}` placeholders, rendered as `<code>` with CSS monospace styling. The minimal approach that still looks good:

```ts
// showcase/helpers/code-snippet.ts

const SNIPPETS: Record<string, string> = {
  outlineRect: `outlineRect(ctx, {{x}}, {{y}}, {{w}}, {{h}},
  '{{fill}}', {{outline}})`,
  
  solveLimb: `const limb = solveLimb(root, target,
  {{lenA}}, {{lenB}}, { bendDir: {{bendDir}} });
// limb.jointPos → { x: {{jx}}, y: {{jy}} }`,
  
  generatePalette: `const palette = generatePalette({{seed}},
  { strategy: '{{strategy}}' });
// ${'{palette.base}'} → '${{baseColor}}'`,
  
  // ... more templates per section
};

export function renderSnippet(
  key: string,
  tokens: Record<string, string | number>,
): string {
  let text = SNIPPETS[key];
  for (const [k, v] of Object.entries(tokens)) {
    text = text.replaceAll(`{{${k}}}`, String(v));
  }
  return text;
}
```

**CSS for snippets:**

```css
.code-snippet {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 13px;
  line-height: 1.5;
  background: #1a1a2e;
  color: #e2e8f0;
  border: 2px solid #1d1128;
  border-radius: 6px;
  padding: 12px 16px;
  white-space: pre;
  overflow-x: auto;
}
```

**Why no highlighter?** The snippets are short (2–6 lines), show library API calls (not arbitrary code), and mutate on slider input. A highlighter adds ~15KB and complexity for tokens that are already self-documenting. The Sokpop aesthetic favors chunky, readable monospace over syntax-colored editor chrome.

**⚠ Drift risk:** The `SNIPPETS` templates hardcode API signatures as strings. If the library changes a function signature (e.g. adding a parameter to `solveLimb`), the snippet text silently drifts from reality. Mitigations:
1. `showcase:typecheck` catches drift for *imported* symbols but not for string-embedded signatures — this is a known second API surface.
2. The `SNIPPETS` record should be treated as a **documentation artifact** that must be manually updated when the library's public API changes.
3. If this becomes a maintenance burden, a future improvement could parse JSDoc or type info at build time to validate snippet templates against actual signatures.

**Mutation example:** When the bone-length slider moves from 40 to 60:

```ts
// Before (snippet text)
const limb = solveLimb(root, target, 40, 40, { bendDir: 1 });

// After (snippet text — same render call, different tokens)
const limb = solveLimb(root, target, 60, 40, { bendDir: 1 });
```

The `renderSnippet` function is called inside the store subscriber, so the code text updates synchronously with the canvas re-render.

---

## 8. Routing, Accessibility, SEO

### Routing: Single long-scroll with anchor nav

```html
<nav class="sticky-nav">
  <a href="#hero">Home</a>
  <a href="#primitives">Primitives</a>
  <a href="#determinism">Determinism</a>
  <a href="#particles">Particles</a>
  <a href="#animation">Animation</a>
  <a href="#palette">Palette</a>
  <a href="#cosmetics">Cosmetics</a>
  <a href="#install">Install</a>
</nav>

<section id="hero">...</section>
<section id="primitives">...</section>
<!-- etc. -->
```

CSS `scroll-behavior: smooth` + `scroll-margin-top` for offset under the sticky nav. No JS router.

### Light dogfooding confirmation

**Page chrome is real HTML/CSS.** Navigation, headings, paragraphs, code blocks, buttons — all semantic HTML. Only the demo canvases use the library.

**Justification vs full-canvas UI (tldraw-style):**
- **Accessibility:** Screen readers can navigate HTML. Canvas is invisible to assistive tech.
- **SEO:** `<h1>`, `<p>`, `<code>` are indexable. Canvas content is not.
- **Text selection:** Users can copy install commands, code snippets, and API names from HTML. Canvas text cannot be selected.
- **Performance:** HTML/CSS is hardware-accelerated and cheap. Canvas for page chrome would burn GPU for no benefit.
- **The research flagged this trade-off explicitly** (showcase-page.md §9): tldraw's full-canvas approach costs a11y/SEO/text-selection. Our library is a developer tool — text accessibility matters.

### Visual design via CSS

The Sokpop aesthetic is achieved in CSS, not canvas. The palette is documented with named slots and rationale:

```css
:root {
  /* Outline: mirrors DEFAULT_OUTLINE_COLOR from src/primitives/outline-rect.ts.
   * Injected from JS at boot to prevent CSS↔library drift — see main.ts. */
  --outline: #1d1128;
  /* Base: warm orange — the primary character fill and section background. */
  --palette-base: #FE5701;
  /* Accent: muted gold — secondary elements, hover states, subtle highlights. */
  --palette-accent: #caa42a;
  /* Feature: purple — interactive elements, code blocks, emphasis. */
  --palette-feature: #7c3aed;
  /* Background: near-black — page backdrop, high contrast against palette fills. */
  --palette-bg: #121214;
  /* Outline width: 2px — the Sokpop chunky-outline look. */
  --outline-width: 2px;
}
```

**Drift prevention:** At boot, `main.ts` imports `DEFAULT_OUTLINE_COLOR` from the library and sets `document.documentElement.style.setProperty('--outline', DEFAULT_OUTLINE_COLOR)`. This ensures the CSS variable and the library constant can never diverge — the library is the single source of truth for the outline color.

**Flat fills, chunky 2px outlines, 5-slot palette via CSS custom properties.** The canvas demos draw characters; the page itself is styled HTML.

### `<meta>` tags

```html
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>aicraft-engine — Zero-Dependency Procedural Rendering for Games</title>
  <meta name="description" content="Ultra-minimalist Canvas2D rendering library. Zero runtime dependencies. Seeded determinism. Algorithmic cosmetics. Built for indie and procedural games." />

  <!-- Open Graph -->
  <meta property="og:title" content="aicraft-engine" />
  <meta property="og:description" content="Zero-dependency procedural rendering + algorithmic cosmetics for games." />
  <meta property="og:image" content="./assets/og-image.png" />
  <meta property="og:type" content="website" />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="aicraft-engine" />
  <meta name="twitter:description" content="Zero-dependency procedural rendering + algorithmic cosmetics for games." />
  <meta name="twitter:image" content="./assets/og-image.png" />

  <link rel="icon" type="image/svg+xml" href="./assets/favicon.svg" />
</head>
```

**OG image recommendation:** Use the hero canvas screenshot (a slime-knight in a fresh palette) captured at build time or as a static asset. The `in-game-shapes.png` benchmark is a good fallback but shows 8 small characters — a single large hero is more impactful for social cards.

---

## 9. Deploy Story

### Build

```bash
npm run showcase:build
# → vite build --config showcase/vite.config.ts
# → output to showcase/dist/
```

### Vite config for showcase

```ts
// showcase/vite.config.ts
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname),
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
});
```

### GitHub Pages (from `main`)

**Recommended path: GitHub Actions.** `showcase/dist/` is git-ignored (the root `.gitignore` already has `dist/` which matches at any depth). CI builds the showcase and deploys to a `gh-pages` branch — never committed to `main`.

```ts
// In showcase/vite.config.ts
export default defineConfig({
  root: resolve(__dirname),
  base: '/aicraft-engine/',  // ← GitHub Pages project path
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
});
```

**Alternative: Vercel.** Zero config — just point Vercel at the repo root with `showcase/dist/` as the output dir. Vercel auto-detects Vite. Good if the team wants preview deployments on PRs.

**Fallback: manual commit.** If CI is not set up, `dist/` can be committed to `main` temporarily. This is less ideal (bloats repo history) but works for a solo dev iterating quickly. Remove this fallback once GitHub Actions is configured.

### `dist/` is already git-ignored

The root `.gitignore` contains `dist/` — no per-directory override needed. `showcase/dist/` is automatically excluded from git at any depth.

---

## 10. Explicitly OUT of Scope

- **Pillars 3 (IAP), 4 (Fake-3D), 5 (Platform adapters):** No code exists. Do not showcase planned features. The showcase shows what ships, not what's planned.
- **Full-canvas UI (tldraw-style):** Research flagged a11y/SEO/text-selection costs. The showcase uses semantic HTML for chrome, canvas only for demos.
- **Backend / analytics / comments:** No server, no database, no third-party scripts. The showcase is a static site.
- **i18n:** English only. The audience is English-speaking game developers.
- **Code editor (CodeMirror/Monaco):** Read-only snippets with slider-driven mutation. Full editors add ~100KB and invite syntax errors that crash demos.
- **Mobile-native app preview:** The showcase is a web page. Mobile browser support is sufficient.

---

## 11. Open Questions for the Architect

### Q1: Should the showcase have its own `package.json` or share root?

**Current recommendation:** Share root. But the architect should pressure-test this:
- Risk: A future showcase devDep (e.g., a syntax highlighter) bloats the root `devDependencies` and makes `npm install` slower for library-only contributors.
- Counter: The library is small and already has `vite` + `canvas` as devDeps. One or two more won't matter.
- Alternative: A `showcase/package.json` with `install` as a workspace script. More isolation, more friction.

### Q2: Is reading `?seed=` from URL a determinism violation?

**Current recommendation:** No. The URL is a host-side input, like a slider. The library's deterministic core never reads the URL. The showcase (a consumer) reads it and passes the value to `mulberry32(seed)`. This is identical to how a game reads a save file.

But: should we document this distinction explicitly? A future contributor might think "the showcase reads the URL, so the library can too" and introduce a determinism leak.

### Q3: Should `drawSlimeKnight()` live in `showcase/helpers/` or in the library itself?

**Current recommendation:** Showcase-local. The slime-knight is a showcase-specific composition of library primitives — it's not a reusable export. The library provides the building blocks; the showcase assembles them.

**Risk:** If the slime-knight drawing code is duplicated between hero, determinism prover, and cosmetics sections, refactoring is painful. But this is already solved by putting it in `helpers/slime-knight.ts`.

**Counter-argument:** If a future game wants the same character, they'd need to re-implement it. But the whole point of the library is that consumers build their own characters from primitives. The slime-knight is a demo, not a product.

### Q4: Fixed-timestep for the animation loop — how strict?

The library's `advanceSpringChain` and `advanceLocomotion` both take `dt` as a parameter. The showcase must provide a fixed `dt` (e.g., 1/60) to maintain determinism in the animation demos. Should the showcase use a fixed-timestep accumulator, or is `requestAnimationFrame` delta time "good enough" for a demo page?

**Current recommendation:** Fixed `dt = 1/60`. The showcase's animation isn't a game — it doesn't need frame-rate independence. Using a fixed dt makes the animation deterministic across devices, which reinforces the determinism pitch.

---

## Implementation Order

1. **Scaffold:** `showcase/` directory, `index.html`, `vite.config.ts`, `tsconfig.json`, npm scripts. Add `showcase/helpers/motion-gate.ts` (`shouldAnimate` wrapper around `prefersReducedMotion()`). Verify `npm run showcase:dev` serves a blank page.
2. **Store + shell:** `store.ts`, `main.ts`, global state shape. Verify HMR works.
3. **CSS:** `style.css` with Sokpop aesthetic (palette vars, outlines, typography). Verify page looks right.
4. **Sections 1-3:** Hero (with `drawSlimeKnight`), pitch cards, primitives playground. These establish the pattern.
5. **Section 4:** Determinism prover — the centerpiece. This validates the store pattern under pressure.
6. **Sections 5-8:** Particles, animation (5 sub-demos), palette, cosmetics. Fills in the story.
7. **Section 9:** Install. Pure HTML, lowest risk.
8. **Polish:** Responsive layout, mobile touch, SEO meta, OG image.
9. **Deploy:** `showcase:build`, GitHub Pages setup, smoke test.

---

*Proposal by @api-designer. Ready for @architect critique.*
