# Integration

## How to consume aicraft-engine

### Option A: Git submodule (recommended)

Preserves the consumer's zero-runtime-deps invariant and keeps source greppable for AI agents.

```bash
# From your game repo root
git submodule add <aicraft-engine-git-url> src/lib/aicraft-engine
git commit -m "Add aicraft-engine submodule"
```

Then import from a relative path:

```ts
// From src/main.ts in the consumer
import { outlineRect } from './lib/aicraft-engine/src/primitives';
import { mulberry32 } from './lib/aicraft-engine/src/rng';
```

**TypeScript config:** `moduleResolution: "bundler"` + `include: ["src"]` already covers the submodule path. No consumer `tsconfig.json` change needed.

**Vite config:** no change needed. Vite resolves relative paths transparently.

**Test config:** if you don't want the submodule's own tests to run as part of your suite, scope your `vitest.config.ts` `include` (e.g. `['src/**/*.test.ts', '!**/lib/aicraft-engine/**']`).

### Option B: Vendored copy

If submodule overhead is unwanted, copy the library into `src/lib/aicraft-engine/` directly. Add a `README.md` at the copy root noting the canonical upstream so re-syncs are easy.

```bash
cp -r /path/to/aicraft-engine/src /path/to/game/src/lib/aicraft-engine/
```

### Option C: npm package (NOT recommended for Spitekeep-family games)

The library is structured to be publishable, but doing so adds a `dependencies` entry to the consumer's `package.json`. Spitekeep deliberately has zero `dependencies` as a minimalist invariant; publishing would break that.

This option is fine for **external consumers** (Premium AI Craft customers building their own games outside the Spitekeep family), but not for sibling games in the Clone-to-Jest pipeline.

## Consumer-side integration patterns

### Palette as a consumer of the engine

The consumer's `palette.ts` should switch from a flat `as const` object to a factory that consumes the engine's palette-resolution layer (Phase 2). The real engine APIs are `resolvePalette` (merge a base palette with overrides) and `generatePalette` (deterministic harmonic palette from a seed):

```ts
// Before (Spitekeep-style)
export const PALETTE = { devilBody: '#FE5701', ... } as const;

// After (engine-integrated)
import {
  resolvePalette,
  generatePalette,
  type Palette,
} from './lib/aicraft-engine/src/palette';

// The engine's Palette is the canonical 5-slot contract:
// { outline, base, accent, feature, background }. Consumers stop using
// bespoke slot names (devilBody, ...) and map draw callbacks onto these slots.
const BASE_PALETTE: Palette = {
  outline: '#1d1128',
  base: '#FE5701',
  accent: '#8B0000',
  feature: '#FFD700',
  background: '#2a0a0a',
};

// Per-skin overrides: partial — missing slots inherit from BASE_PALETTE.
const SKIN_OVERRIDES: Record<string, Partial<Palette>> = {
  'ember-mage': { base: '#ff6a00', feature: '#ffeb3b' },
  'frost-mage': { base: '#2a7ad4', accent: '#a0d8ff' },
};

export function getPalette(activeSkinId: string | null): Palette {
  if (!activeSkinId || !(activeSkinId in SKIN_OVERRIDES)) return BASE_PALETTE;
  return resolvePalette(BASE_PALETTE, SKIN_OVERRIDES[activeSkinId]);
}

// Procedural variant: same seed → same palette, forever. Contrast-repaired.
export function getPaletteForSeed(seed: number): Palette {
  return generatePalette(seed);
}
```

The simulation never reads color values — `Palette` lives in the deterministic core and is only resolved into hex strings for the renderer at draw time.

### Save schema extension

The consumer's `SaveData` (Spitekeep's `platform/types.ts`) migrates to a new version that carries cosmetic-ownership fields:

```ts
// Spitekeep v1
interface SaveData {
  version: 1;
  // ... existing fields
}

// Spitekeep v2 (after Phase 2 integration)
interface SaveData {
  version: 2;
  // ... existing fields
  equippedSkin: string | null;
  ownedSkins: string[];
}
```

The migration logic in `platform/save.ts` upgrades v1 → v2 by adding defaults.

### IAP bridge instance

The consumer creates a single IAP bridge instance at startup and passes it to whoever needs to query or transact:

```ts
// platform/iap.ts in the consumer
import { createLocalStorageIAPAdapter } from './lib/aicraft-engine/src/iap/adapters/local-storage';
export const iap = createLocalStorageIAPAdapter({ catalog: [...], storageKey: 'aicraft-iap' });
```

### Parallax background layers

#### The layer-stack pattern

A multi-layer seamless-scroll background assigns each layer a parallax factor (far = slow, near = fast) and a seamless tile width. Layers closer to the camera scroll faster and use smaller tiles for more visual detail.

Example: a hellscape side-scroller with 5 layers.

| Layer | Content | Factor | Tile width | Module |
|---|---|---|---|---|
| 1 | dark purple/red fog gradient | 0.05 | wide (800) | `src/primitives/parallax.ts` |
| 2 | distant fortress silhouettes | 0.12 | 600 | `src/primitives/parallax.ts` |
| 3 | lavafalls, demon statues, towers | 0.25 | 400 | `src/primitives/parallax.ts` |
| 4 | chains, stalactites, ruins | 0.45 | 300 | `src/primitives/parallax.ts` |
| 5 | embers / smoke particles | n/a | n/a | `src/particles/` |

Layer 5 is **not** a parallax layer — it uses the deterministic particle system from `src/particles/`. Don't try to force particles through `tiledParallaxRange`.

#### The render loop

Two approaches: the `drawTiledParallax` convenience wrapper (most cases), or `tiledParallaxRange` directly (when you need the geometry for WebGL, custom transforms, or composing with other effects).

```ts
import {
  drawTiledParallax,
  parallaxOffset,
} from './lib/aicraft-engine/src/primitives';
// import { stepEmitters } from './lib/aicraft-engine/src/particles';

function renderBackground(
  ctx: CanvasRenderingContext2D,
  cameraX: number,
  cameraY: number,
  vw: number,
  vh: number,
) {
  // Layer 1: opaque sky gradient (does not tile — just a fill translated by parallaxOffset)
  const sky = parallaxOffset(cameraX, cameraY, 0.05);
  ctx.save();
  ctx.translate(sky.x, sky.y);
  drawSkyGradient(ctx, vw, vh);
  ctx.restore();

  // Layers 2-4: seamless tiling via convenience wrapper
  drawTiledParallax(ctx, (c, x) => drawFarFortress(c, x, vh), cameraX, 0.12, 600, vw);
  drawTiledParallax(ctx, (c, x) => drawMidStatues(c, x, vh), cameraX, 0.25, 400, vw);
  drawTiledParallax(ctx, (c, x) => drawNearChains(c, x, vh), cameraX, 0.45, 300, vw);

  // Layer 5: particles (uses src/particles — not parallax)
  // emitters = stepEmitters(emitters, dt);
  // drawEmbers(ctx, emitters);
}
```

When you need the raw geometry (e.g. for WebGL draw calls or composing with other transforms), use `tiledParallaxRange` directly:

```ts
import {
  tiledParallaxRange,
  PARALLAX_FAR,
} from './lib/aicraft-engine/src/primitives';

function renderFortressLayer(
  ctx: CanvasRenderingContext2D,
  cameraX: number,
  vw: number,
  vh: number,
) {
  const range = tiledParallaxRange(cameraX, PARALLAX_FAR, 600, vw);
  for (let i = 0; i < range.copies; i++) {
    drawFarFortress(ctx, range.startX + i * 600, vh);
  }
}
```

#### The seamless-tile requirement (critical)

The helper computes correct geometry, but **visual seamlessness is the asset's responsibility.** The left edge of each tile must visually match its right edge.

Rules of thumb:
- Avoid unique landmarks (a giant statue, a hell gate) at the tile edge unless they continue cleanly across the seam.
- Big landmarks go in the middle of the tile; edges use repeatable shapes (cliffs, haze, chains, silhouettes).
- Use sine-wave hills or repeating gradients where possible — they wrap by construction.
- Test by setting `camera = tileWidth / factor` and inspecting: the seam should be invisible.

#### Sub-pixel mitigation

Two documented patterns for handling sub-pixel camera positions:

- **Smooth scroll (default):** Pass `tileWidth` as-is. Tiles slide continuously. May show 1px anti-aliasing blur on hard edges at sub-pixel camera positions. Best for painted / organic art styles.
- **Pixel-art sharp:** In the `drawTile` callback, draw with integer-snapped coordinates: `Math.round(screenX)`. Tiles jump by 1px at integer camera boundaries. Best for crisp pixel art.

A third pattern for eliminating sub-pixel seam gaps in float mode: **overscan** — draw each tile 1px wider (`tileWidth + 1` in the `drawTile` body) so adjacent tiles overlap by 1px. Trade-off: 1px of overdraw per seam, but zero sub-pixel gaps. See the JSDoc in `src/primitives/parallax.ts` for the canonical overscan discussion.

#### Hybrid set-piece pattern (advanced)

A few infinite-loop layers (`tiledParallaxRange` / `drawTiledParallax`) handle the ambient background. Occasionally-spawned unique set pieces (giant demon statue, skull arch) are projected at the same parallax depth using `parallaxOffset` — not `tiledParallaxRange`. This gives infinite scroll plus variety without bloating tile assets. The set piece is drawn at `camera * factor` offset, same as any parallax layer; the only difference is that it's a one-off draw call, not a repeating tile. See `docs/design/seamless-tiled-parallax-proposal.md` for the full pattern.

#### Vertical tiling

The helper is 1D (single axis). For vertical or 2D scroll, call `tiledParallaxRange` twice — once per axis. Side-scrollers typically fix Y and only need the X call. Top-down games with vertical parallax (e.g. clouds above, terrain below) call both and combine the offsets.

## Shipping to mobile

Mobile web play adds constraints that desktop avoids: browser zoom hijacking touch, iOS rubber-band scrolling, audio autoplay policies, Retina scaling, and the need for on-screen touch controls. This section is a checklist of every mobile deployment pattern the engine supports, with the engine helpers that implement each piece and the showcase as the worked example.

### 1. Viewport meta — lock zoom

iOS Safari allows pinch-to-zoom and double-tap-to-zoom on any page. Both break gameplay: pinch zooms the canvas out of its container; double-tap fires a 300ms click delay and zooms. Lock the viewport in your `<head>`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
```

`maximum-scale=1.0` disables pinch zoom; `user-scalable=no` disables double-tap zoom. `width=device-width` keeps the layout width correct across devices.

> **Reference:** `showcase/index.html` line 5.

### 2. `overscroll-behavior: none` — prevent rubber-band / pull-to-refresh

iOS Safari rubber-bands the entire page when you scroll past the top or bottom edge. On a game canvas, this pulls the viewport away from the game — the player sees a white bounce and loses control. `overscroll-behavior: none` on `body` disables it:

```css
html, body {
  margin: 0;
  padding: 0;
  overscroll-behavior: none;
}
```

> **Reference:** `showcase/style.css` line 43 (`overscroll-behavior: none` on `body`).

### 3. `touch-action: none` — prevent browser gesture interception

Mobile browsers intercept touches as scroll, pinch-zoom, or back-navigation gestures unless you opt out. Without `touch-action: none`, your first touch on the canvas may scroll the page instead of registering as gameplay input.

Apply `touch-action: none` to the canvas in CSS:

```css
.game-canvas {
  touch-action: none;
}
```

The engine's touch adapters (`createTouchButtonSet`, `createTouchButton`) set `element.style.touchAction = 'none'` on each button element automatically — so on-screen buttons work without a CSS rule. But the canvas itself needs it in your stylesheet.

> **Reference:** `showcase/style.css` lines 517-518 (`.playground-canvas`).
> **Engine exports:** `createTouchButtonSet` (`src/input/touch-button-set.ts`), `createTouchButton` (`src/input/touch-button.ts`).

### 4. DPR / Retina scaling — crisp rendering on high-DPI displays

Canvas CSS pixels ≠ backing-store pixels on Retina/HiDPI devices. A 600×400 CSS canvas on a 2× display has 1200×800 physical pixels. Without scaling, the browser stretches the 600×400 backing store across 1200×800 pixels — the result is blurry.

The engine's `resizeCanvasToBackingStore(canvas, cssWidth, cssHeight)` reads `window.devicePixelRatio` fresh, sets `canvas.width` and `canvas.height` to `round(cssWidth × dpr)` × `round(cssHeight × dpr)`, and returns the DPR for you to compose into the context transform:

```ts
import { resizeCanvasToBackingStore } from './lib/aicraft-engine/src/primitives';

const canvas = document.querySelector<HTMLCanvasElement>('.game-canvas')!;
const ctx = canvas.getContext('2d')!;

// Resize backing store to physical pixels. Returns fresh DPR.
const dpr = resizeCanvasToBackingStore(canvas, 600, 400);
// Scale the context so drawing in CSS-pixel coordinates lands on the
// correct physical pixels. Compose this ONCE at setup — all subsequent
// draw calls keep using CSS-pixel units.
ctx.scale(dpr, dpr);
```

After this setup, your game code draws in CSS-pixel coordinates (`ctx.fillRect(0, 0, 600, 400)`) and the engine handles the DPR scaling. No `Math.round(x * dpr)` at every draw call.

**Determinism boundary:** DPR is host-touching (`window.devicePixelRatio`). Call `resizeCanvasToBackingStore` at canvas setup and on `resize` events — never inside the fixed-step simulation. The returned DPR flows into your render code as a parameter, matching the discipline prescribed in `docs/architecture.md` rule 4.

**Fresh read on resize:** `resizeCanvasToBackingStore` reads DPR fresh every call (not via the cached `getDevicePixelRatio`). This is intentional — `devicePixelRatio` changes when a browser window is dragged between monitors of different DPI, or when browser zoom is adjusted. The cached `getDevicePixelRatio()` is intended for one-shot startup reads where the cached value is fine.

> **Reference:** `showcase/sections/playground.ts` lines 471-472.
> **Engine exports:** `resizeCanvasToBackingStore`, `getDevicePixelRatio`, `FALLBACK_DPR` (`src/primitives/dpr.ts`).

### 5. Audio unlock on first user gesture

Mobile browsers block `AudioContext` from producing sound until a user gesture (tap, keypress) has occurred. The engine's `createAudioAdapter()` creates a defensive WebAudio adapter; calling `unlock()` on the first gesture resumes the context and arms playback. The pattern: register one-shot `keydown` and `pointerdown` listeners on `window`, call `audio.unlock()` inside them, then remove the listeners:

```ts
import { createAudioAdapter } from './lib/aicraft-engine/src/audio';

const audio = createAudioAdapter();

const unlockAudio = (): void => {
  audio.unlock();                              // idempotent — safe to call repeatedly
  window.removeEventListener('keydown', unlockAudio);
  window.removeEventListener('pointerdown', unlockAudio);
};
window.addEventListener('keydown', unlockAudio);
window.addEventListener('pointerdown', unlockAudio);
```

After `unlock()`, `audio.playTone(...)` and `audio.playNoise(...)` produce sound. Before unlock (or in Node/SSR), they are silent no-ops — a game never crashes because audio failed.

> **Reference:** `showcase/sections/playground.ts` lines 595-601.
> **Engine exports:** `createAudioAdapter`, `AudioAdapter` (`src/audio/factory.ts`).

### 6. Touch controls — the composition recipe

For on-screen buttons (left/right/jump on mobile), the engine provides two adapters:

- **`createTouchButtonSet({ elements })`** — multi-touch-safe button group. Takes an array of DOM elements (or `null` for missing slots), returns one `PolledEdge` per element, array-aligned. Handles pointer-ID isolation (two fingers on the same button don't double-fire) and a global `document` safety net (`pointerup`/`pointercancel`/`pointerleave`) that prevents stuck buttons when a finger leaves the viewport. Sets `touch-action: none` on each element automatically.

- **`createTouchButton(element)`** — single-button adapter. Simpler; good for a lone jump button. No pointer-ID tracking (two fingers on the same element can cross-talk) — use `createTouchButtonSet` for multi-button layouts.

#### Recommended path: `createTouchButtonSet` + `orEdges`

Wire the touch set alongside the keyboard adapter, and OR-merge them per action each tick so either input device drives the player:

```ts
import {
  createKeyboardAdapter,
  createTouchButtonSet,
  orEdges,
} from './lib/aicraft-engine/src/input';

// Keyboard — maps key codes to action names.
const keyboard = createKeyboardAdapter({
  codeToAction: {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    Space: 'jump',
  },
});

// Touch — positional array: [left, right, jump].
// Null elements produce idle slots (element not in DOM).
const leftBtn  = document.getElementById('btn-left');
const rightBtn = document.getElementById('btn-right');
const jumpBtn  = document.getElementById('btn-jump');
const touch = createTouchButtonSet({
  elements: [leftBtn, rightBtn, jumpBtn],
});

// Per-tick: poll once, OR-merge per action.
const kb = keyboard.poll();
const t  = touch.poll();
const leftEdge  = orEdges(kb['left']  ?? IDLE_EDGE, t[0] ?? IDLE_EDGE);
const rightEdge = orEdges(kb['right'] ?? IDLE_EDGE, t[1] ?? IDLE_EDGE);
const jumpEdge  = orEdges(kb['jump']  ?? IDLE_EDGE, t[2] ?? IDLE_EDGE);
// Use leftEdge.held, jumpEdge.pressed, etc.
```

Array order in the touch set is load-bearing — the consumer maps indices to semantics via destructuring. The `?? IDLE_EDGE` fallback guards against a missing slot (`orEdges` is not null-safe).

#### Single-button path

For a standalone action (e.g. a single jump button):

```ts
import { createTouchButton } from './lib/aicraft-engine/src/input';

const jumpBtn = createTouchButton(document.getElementById('jump-btn'));
// Per-tick:
const edge = jumpBtn.poll();
if (edge.pressed) bufferJump();
```

#### CSS gating: reveal on touch devices only

On-screen buttons are invisible on desktop (keyboard-only) and revealed only on touch devices. The showcase uses `@media (pointer: coarse), (hover: none)`:

```css
.touch-btn {
  display: none;           /* hidden by default on desktop */
  touch-action: none;      /* block browser gestures on the button itself */
  /* ... sizing, positioning ... */
}

@media (pointer: coarse), (hover: none) {
  .touch-btn {
    display: flex;         /* revealed on touch devices */
  }
}
```

The adapter still attaches listeners when buttons are `display: none` — they simply never receive events (idle edges forever, harmless).

> **Reference:** `showcase/style.css` lines 533-595, `showcase/index.html` lines 257-259.
> **Engine exports:** `createTouchButtonSet`, `createTouchButton`, `orEdges` (`src/input/`).

#### Multi-touch safety (handled by the adapter)

`createTouchButtonSet` tracks a `Set<pointerId>` per element with `0→≥1` press / `1→0` release transitions. Two fingers on the same button produce one `held=true`; lifting one finger keeps `held=true`; lifting both produces a single `released` edge. A global `document` listener catches `pointerup`/`pointercancel`/`pointerleave` so a pointer that exits the viewport without a clean per-element `pointerup` (e.g. swipe to the notification bar) cannot leave a button stuck.

The consumer does not need to implement any of this — the adapter handles it.

#### Named directional shape (thin wrapper)

If you want a `{left, right, up, down}` named object instead of positional indices, destructure the poll result:

```ts
const [left, right, up, down] = dpad.poll();
```

A convenience wrapper (`createVirtualDpad`) is documented as out-of-scope for now — ~15 lines on top of `createTouchButtonSet`, to be added when a second consumer wants it.

> **Decision:** `docs/design/mobile-directional-input-decision.md`.

### 7. `prefers-reduced-motion` — gate non-essential motion

Some users enable the OS-level "reduce motion" setting to avoid motion sickness or distraction. The engine's `prefersReducedMotion()` returns a cached boolean: `true` when the user has requested reduced motion, `false` in Node/SSR (safe default — render the animation).

**Hard-binary gate** (what the showcase does): render a single static frame and skip the game loop entirely:

```ts
import { prefersReducedMotion } from './lib/aicraft-engine/src/primitives';

if (prefersReducedMotion()) {
  renderStaticFrame();  // draw once, don't start the loop
  return;
}
loop.start();
```

**Partial reduction** (alternative): the helper just returns a boolean, so you can scale down rather than eliminate — e.g. halve screen-shake amplitude, zero out breathing oscillation, or reduce particle counts:

```ts
const reduced = prefersReducedMotion();
const shakeAmp = reduced ? maxShake * 0.3 : maxShake;
const breath = reduced ? 0 : breathe(tick, DEFAULT_BREATH);
```

> **Reference:** `showcase/sections/playground.ts` lines 1242-1244.
> **Engine export:** `prefersReducedMotion()` (`src/primitives/motion.ts`).

### 8. Fixed-timestep + background tab safety

When a mobile user switches tabs or the OS suspends the browser, the tab goes hidden. Without protection, `requestAnimationFrame` stops firing; when the user returns, the accumulated wall-clock delta is huge — the simulation tries to catch up with hundreds of fixed steps and locks the device.

The engine's `createGameLoop` handles both problems:

- **Frame delta cap** (`DEFAULT_MAX_FRAME_DELTA = 1/6`): the per-frame delta is clamped to ~167ms before accumulating. If the tab was hidden for 5 seconds, the loop runs ~10 catch-up steps (not ~300).
- **`visibilitychange` reset**: when the tab becomes hidden, the loop cancels its RAF and resets the accumulator to 0. When the tab becomes visible again, it reschedules RAF and resets the clock so the first post-resume delta is tiny.

The consumer does not need to implement either — `createGameLoop` manages it internally.

> **Engine exports:** `createGameLoop`, `DEFAULT_FIXED_DT`, `DEFAULT_MAX_FRAME_DELTA` (`src/game-loop/fixed-step.ts`).

---

### Minimal mobile shell

A copy-pasteable starting point. Combines the viewport meta, overscroll lock, DPR-scaled canvas, touch-action, and the audio-unlock pattern. Copy this into your game's entry point and build on top of it.

**HTML:**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>My Game</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <canvas class="game-canvas" width="600" height="400"
      aria-label="Game canvas"></canvas>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

**CSS:**

```css
html, body {
  margin: 0;
  padding: 0;
  overscroll-behavior: none;
}

.game-canvas {
  width: 100%;
  max-width: 600px;
  height: auto;
  aspect-ratio: 600 / 400;
  display: block;
  margin: 0 auto;
  touch-action: none;
  image-rendering: pixelated;
}
```

**TypeScript (setup):**

```ts
import { resizeCanvasToBackingStore } from './lib/aicraft-engine/src/primitives';
import { createAudioAdapter } from './lib/aicraft-engine/src/audio';
import { prefersReducedMotion } from './lib/aicraft-engine/src/primitives';
import { createGameLoop } from './lib/aicraft-engine/src/game-loop';

const canvas = document.querySelector<HTMLCanvasElement>('.game-canvas')!;
const ctx = canvas.getContext('2d')!;

// DPR scaling — crisp on Retina.
const dpr = resizeCanvasToBackingStore(canvas, 600, 400);
ctx.scale(dpr, dpr);

// Audio — unlock on first gesture.
const audio = createAudioAdapter();
const unlockAudio = (): void => {
  audio.unlock();
  window.removeEventListener('keydown', unlockAudio);
  window.removeEventListener('pointerdown', unlockAudio);
};
window.addEventListener('keydown', unlockAudio);
window.addEventListener('pointerdown', unlockAudio);

// Reduced-motion gate.
if (prefersReducedMotion()) {
  // Render a single static frame, skip the loop.
  // drawStaticFrame(ctx);
  return;
}

// Game loop — fixed-step, background-tab safe.
const loop = createGameLoop({
  fixedDt: 1 / 60,
  step: (dt) => {
    // Your fixed-step simulation here.
  },
  render: (alpha) => {
    ctx.fillStyle = '#1a0d0a';
    ctx.fillRect(0, 0, 600, 400);
    // Your render code here.
  },
});
loop.start();
```

## Synchronization strategy

When `aicraft-engine` evolves, consumers update via:

- **Submodule:** `git submodule update --remote src/lib/aicraft-engine && git commit`
- **Vendored:** re-run the copy command and review the diff

The library's version follows semver. Breaking changes to public APIs bump the major version. The `CHANGELOG.md` (to be added at v1.0) lists migrations required.
