# Integration

End-to-end wiring guide for building a platformer with an editor using `aicraft-engine`.

---

## 1. Install

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

---

## 2. The mental model

```
[Level Data]  ←──authored state──→  [Editor Core]  ←──ops──→  [Your UI]
     │
     └──compileLevel──→  [Platformer Kernel]  ←──tick──→  [Renderer]
```

**`LevelData` is the source of truth.** It's a plain JSON object — versioned, typed, migration-ready. You author it in the editor or load it from a file. Everything downstream reads from it; nothing writes back to it except editor ops.

**The editor core owns `EditorState`** (level + undo/redo history + selection + validation cache). It applies serializable operations (`addEntity`, `moveEntities`, `paintTiles`, etc.) via `applyOp` and returns a fresh state each time. The editor never mutates directly — pure reducer pattern, like Redux for your level.

**The platformer kernel runs against a runtime view of the level.** `compileLevel(level)` extracts static solids and initial actor state from the authored `LevelData`. The kernel never sees the editor; it only sees `Solid[]` and `PlatformerState`. This clean boundary means runtime mutations (player position, moving platforms) never pollute your authored state.

**The renderer is your job.** The library provides per-entity draw helpers (`drawLevelEntity`, `drawActor`, `drawTileGrid`) and a palette of primitives (`outlineRect`, `shade`, etc.), but no full-screen renderer. You own the canvas, the camera, the draw loop.

**Playtest mode clones the level** so runtime mutations never pollute authored state. `enterPlaytest` deep-clones twice (one for the snapshot, one for the runtime copy); `exitPlaytest` restores from the snapshot. The editor's undo history survives the round-trip.

---

## 3. Minimum viable platformer

A complete, playable platformer in ~60 lines. Paste this into a fresh Vite project and see a controllable character on screen.

```ts
import { type LevelData } from './lib/aicraft-engine/src/level';
import {
  compileLevel,
  stepPlatformer,
  drawLevelEntity,
  drawActor,
  drawTileGrid,
} from './lib/aicraft-engine/src/platformer';
import { createKeyboardAdapter } from './lib/aicraft-engine/src/input';
import { createGameLoop } from './lib/aicraft-engine/src/game-loop';
import { resizeCanvasToBackingStore } from './lib/aicraft-engine/src/primitives';

// --- Level data (or load from JSON) ---
const level: LevelData = {
  version: 1,
  id: 'demo',
  name: 'Demo Level',
  width: 960,
  height: 540,
  tileSize: 16,
  spawn: { x: 32, y: 400 },
  tiles: {
    data: [
      ...Array(60).fill(1), // top row: solid
      ...Array(59).fill(0), 1, // bottom row: floor
    ],
    cols: 60,
    rows: 2,
    tileSize: 16,
  },
  entities: [
    { id: 1, kind: 'spawn', rect: { x: 32, y: 400, width: 16, height: 24 }, props: {} },
    { id: 2, kind: 'platform', rect: { x: 128, y: 350, width: 64, height: 16 }, props: {} },
    { id: 3, kind: 'platform', rect: { x: 256, y: 300, width: 64, height: 16 }, props: {} },
  ],
  nextEntityId: 4,
};

// --- Compile level into runtime solids + initial player state ---
const { staticSolids, initialState } = compileLevel(level);

// --- Input ---
const keyboard = createKeyboardAdapter({
  codeToAction: {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    Space: 'jump',
  },
});

// --- Canvas setup ---
const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
const ctx = canvas.getContext('2d')!;
const dpr = resizeCanvasToBackingStore(canvas, 600, 400);
ctx.scale(dpr, dpr);

// --- Game state (compileLevel already positioned initialState at level.spawn) ---
let platformerState = initialState;

// --- Game loop ---
const loop = createGameLoop({
  step: (_dt) => {
    const edges = keyboard.poll();
    const left = edges['left']  ?? { held: false, pressed: false, released: false };
    const right = edges['right'] ?? { held: false, pressed: false, released: false };
    const jump = edges['jump']  ?? { held: false, pressed: false, released: false };

    const moveX: -1 | 0 | 1 = left.held ? -1 : right.held ? 1 : 0;

    platformerState = stepPlatformer(
      platformerState,
      { moveX, jump, dash: null },
      staticSolids,
      1 / 60,
    ).state;
  },
  render: (_alpha) => {
    ctx.fillStyle = '#1a0d0a';
    ctx.fillRect(0, 0, 600, 400);

    // Draw tile grid
    drawTileGrid(ctx, level.tiles, (c, x, y, tileValue, size) => {
      if (tileValue !== 0) {
        c.fillStyle = '#3a2a1a';
        c.fillRect(x, y, size, size);
      }
    });

    // Draw level entities
    for (const entity of level.entities) {
      drawLevelEntity(ctx, entity);
    }

    // Draw player (default palette uses Spitekeep orange #fe5701; spread a custom palette to override)
    drawActor(ctx, platformerState.core);
  },
});

loop.start();
```

This gives you:
- A character that spawns at `(32, 400)` and falls onto a floor
- Left/right movement with arrow keys
- Jump with spacebar (with coyote time and variable-height jump)
- Wall-slide and wall-jump (enabled by default)
- Dash (enabled by default — press dash key or remove from input)
- Collision against tile grid and entity platforms

> **Source files:** `compileLevel` is in `src/platformer/level-runtime.ts`. `drawLevelEntity`, `drawActor`, `drawTileGrid` are in `src/platformer/renderer.ts`. `stepPlatformer` is in `src/platformer/kernel.ts`.

---

## 4. Minimum viable editor

Click-to-place platforms with undo. Same canvas, editor UI layered on top.

```ts
import { createEditorState, applyOp, undo, canUndo } from './lib/aicraft-engine/src/editor';
import { type LevelData } from './lib/aicraft-engine/src/level';
import { drawLevelEntity, drawTileGrid } from './lib/aicraft-engine/src/platformer';

// --- Same level data as above ---
const level: LevelData = { /* ... same as section 3 ... */ };

// --- Editor state ---
let editorState = createEditorState(level);

// --- Click handler: add a platform ---
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.round((e.clientX - rect.left) / 16) * 16; // snap to grid
  const y = Math.round((e.clientY - rect.top) / 16) * 16;

  editorState = applyOp(editorState, {
    type: 'addEntity',
    kind: 'platform',
    rect: { x, y, width: 48, height: 16 },
    props: {},
  });

  render(); // re-render after state change
});

// --- Undo button ---
document.getElementById('undo-btn')!.addEventListener('click', () => {
  if (canUndo(editorState)) {
    editorState = undo(editorState);
    render();
  }
});

// --- Render ---
function render() {
  ctx.fillStyle = '#1a0d0a';
  ctx.fillRect(0, 0, 600, 400);

  // No need to compile solids in the editor — just draw what's there
  drawTileGrid(ctx, editorState.level.tiles, (c, x, y, tileValue, size) => {
    if (tileValue !== 0) {
      c.fillStyle = '#3a2a1a';
      c.fillRect(x, y, size, size);
    }
  });

  for (const entity of editorState.level.entities) {
    drawLevelEntity(ctx, entity);
  }

  // Show validation errors in a panel
  const errorPanel = document.getElementById('errors')!;
  const errors = editorState.validation.errors.filter(e => e.severity === 'error');
  errorPanel.textContent = errors.length === 0
    ? 'Level is valid'
    : errors.map(e => e.message).join('\n');
}

render();
```

Key patterns:
- **`createEditorState(level)`** deep-clones the level, runs initial validation, and returns a fresh `EditorState`.
- **`applyOp(state, op)`** is a pure reducer — returns a new state, never mutates. The op is a plain serializable object (no closures).
- **`undo(state)`** pops the last snapshot and restores. `canUndo(state)` checks if there's anything to pop.
- **`state.validation.errors`** is recomputed on every `applyOp` call. Read it to show errors in your UI.

---

## 5. Playtest mode

Playtest creates a sandbox boundary: the editor's authoritative level is never touched by runtime mutations.

```ts
import { enterPlaytest, exitPlaytest } from './lib/aicraft-engine/src/editor';
import { compileLevel, type PlatformerState } from './lib/aicraft-engine/src/platformer';
import type { LevelData } from './lib/aicraft-engine/src/level';

let runtimeState: PlatformerState | null = null;
let playtestSnapshot: LevelData | null = null;

function startPlaytest() {
  const result = enterPlaytest(editorState);
  playtestSnapshot = result.snapshot;

  // Compile the runtime copy — fresh solids, fresh initial state.
  // `initialState` is a full PlatformerState positioned at level.spawn with default dimensions.
  const compiled = compileLevel(result.runtimeLevel);
  runtimeState = compiled.initialState;
  // Store compiled.staticSolids for use in the game loop.
}

function stopPlaytest() {
  if (playtestSnapshot === null) return;
  editorState = exitPlaytest(editorState, playtestSnapshot);
  runtimeState = null;
  playtestSnapshot = null;
  render(); // re-render the editor
}
```

Why this matters:
- `enterPlaytest` deep-clones twice: `snapshot` (for restore) and `runtimeLevel` (for your sim to mutate).
- The kernel writes to `runtimeLevel` (moving platforms change position, etc.), but the editor's `state.level` is untouched.
- `exitPlaytest` restores the editor from the snapshot. Undo history is preserved.
- The two clones are independent — mutating `runtimeLevel` never affects `snapshot`.

---

## 6. Wiring a custom entity type

The library's `EntityKind` is a closed union: `spawn | exit | platform | passthrough | trap | hazard | decoration | trigger | movingPlatform`. Adding a new kind requires either a library update or a fork.

**Simplest path: use `trap` or `trigger` with a `type` discriminator.** This matches Spitekeep's existing pattern — a "spring" entity is a `trap` with `props: { type: 'spring', params: { bounceVelocity: -400 } }`.

```ts
// Authoring in the editor
editorState = applyOp(editorState, {
  type: 'addEntity',
  kind: 'trap',
  rect: { x: 128, y: 384, width: 16, height: 8 },
  props: { type: 'spring', params: { bounceVelocity: -400 } },
});
```

**Drawing your custom entity** — the renderer's `drawLevelEntity` handles built-in kinds. For custom kinds, use the `drawOverride` callback:

```ts
drawLevelEntity(ctx, entity, {
  drawOverride: (ctx, entity) => {
    if (entity.kind === 'trap' && entity.props.type === 'spring') {
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(entity.rect.x, entity.rect.y, entity.rect.width, entity.rect.height);
      // Draw a spring coil shape...
    }
  },
});
```

**Handling the interaction in the kernel** — the kernel emits `contacts` events each tick. After `stepPlatformer`, check for overlaps with your spring entity:

```ts
const { state: nextState, events } = stepPlatformer(state, input, solids, dt);

// Check if player is on the ground near a spring
if (events.justLanded && nextState.core.contacts.groundId) {
  const spring = level.entities.find(
    e => e.kind === 'trap'
      && e.props.type === 'spring'
      && e.id === Number(nextState.core.contacts.groundId),
  );
  if (spring) {
    // Apply bounce: override vy for next tick
    state = { ...nextState, core: { ...nextState.core, vy: spring.props.params.bounceVelocity } };
    continue;
  }
}
state = nextState;
```

> **Note:** `compileLevel` assigns each compiled solid an id of the form `'entity-<entityId>'`. To match a contact back to its source entity, parse the prefix off `contacts.groundId` (e.g. `'entity-7'` → entity id `7`).

---

## 7. Tuning game feel

The library ships four config presets — each is a `PlatformerConfig` spread over `DEFAULT_PLATFORMER_CONFIG`:

```ts
import {
  PRECISION_PLATFORMER,
  CLASSIC_PLATFORMER,
  EXPLORATION_PLATFORMER,
  PUZZLE_PLATFORMER,
} from './lib/aicraft-engine/src/platformer';
```

| Preset | Feel |
|---|---|
| `PRECISION_PLATFORMER` | Snappy, tight control. Low air control, fast dash, wall-slide. The default. |
| `CLASSIC_PLATFORMER` | Mario-like. Higher air control, no wall-slide, double-jump enabled. |
| `EXPLORATION_PLATFORMER` | Floaty, relaxed. Slow fall, generous jump, no dash. |
| `PUZZLE_PLATFORMER` | Minimal movement. Slow speed, no dash/wall-slide. Focus on puzzle elements. |

**Swapping presets mid-game is allowed** — the kernel is stateless across ticks for config. Just pass a different config:

```ts
// Switch to puzzle mode when entering a puzzle room
const config = inPuzzleRoom ? PUZZLE_PLATFORMER : PRECISION_PLATFORMER;
platformerState = stepPlatformer(platformerState, input, solids, 1 / 60, config).state;
```

**Custom configs** — spread any preset and override:

```ts
const myConfig = {
  ...CLASSIC_PLATFORMER,
  gravity: 1200, // heavier gravity for a "weighty" feel
  jump: { ...CLASSIC_PLATFORMER.jump, maxHoldTime: 0.15 },
};
```

---

## 8. Shipping to mobile

Mobile web play adds constraints that desktop avoids: browser zoom hijacking touch, iOS rubber-band scrolling, audio autoplay policies, Retina scaling, and the need for on-screen touch controls. This section is a checklist of every mobile deployment pattern the engine supports.

### 1. Viewport meta — lock zoom

iOS Safari allows pinch-to-zoom and double-tap-to-zoom on any page. Both break gameplay: pinch zooms the canvas out of its container; double-tap fires a 300ms click delay and zooms. Lock the viewport in your `<head>`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
```

`maximum-scale=1.0` disables pinch zoom; `user-scalable=no` disables double-tap zoom. `width=device-width` keeps the layout width correct across devices.

### 2. `overscroll-behavior: none` — prevent rubber-band / pull-to-refresh

iOS Safari rubber-bands the entire page when you scroll past the top or bottom edge. On a game canvas, this pulls the viewport away from the game — the player sees a white bounce and loses control. `overscroll-behavior: none` on `body` disables it:

```css
html, body {
  margin: 0;
  padding: 0;
  overscroll-behavior: none;
}
```

### 3. `touch-action: none` — prevent browser gesture interception

Mobile browsers intercept touches as scroll, pinch-zoom, or back-navigation gestures unless you opt out. Without `touch-action: none`, your first touch on the canvas may scroll the page instead of registering as gameplay input.

Apply `touch-action: none` to the canvas in CSS:

```css
.game-canvas {
  touch-action: none;
}
```

The engine's touch adapters (`createTouchButtonSet`, `createTouchButton`) set `element.style.touchAction = 'none'` on each button element automatically — so on-screen buttons work without a CSS rule. But the canvas itself needs it in your stylesheet.

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

**Determinism boundary:** DPR is host-touching (`window.devicePixelRatio`). Call `resizeCanvasToBackingStore` at canvas setup and on `resize` events — never inside the fixed-step simulation. The returned DPR flows into your render code as a parameter.

**Fresh read on resize:** `resizeCanvasToBackingStore` reads DPR fresh every call (not via the cached `getDevicePixelRatio`). This is intentional — `devicePixelRatio` changes when a browser window is dragged between monitors of different DPI, or when browser zoom is adjusted.

> **Engine exports:** `resizeCanvasToBackingStore`, `getDevicePixelRatio`, `FALLBACK_DPR` (`src/primitives/dpr.ts`).

### 5. Audio unlock on first user gesture

Mobile browsers block `AudioContext` from producing sound until a user gesture (tap, keypress) has occurred. The engine's `createAudioAdapter()` creates a defensive WebAudio adapter; calling `unlock()` on the first gesture resumes the context and arms playback:

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

#### CSS gating: reveal on touch devices only

On-screen buttons are invisible on desktop (keyboard-only) and revealed only on touch devices:

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

> **Engine exports:** `createTouchButtonSet`, `createTouchButton`, `orEdges` (`src/input/`).

### 7. `prefers-reduced-motion` — gate non-essential motion

Some users enable the OS-level "reduce motion" setting to avoid motion sickness or distraction. The engine's `prefersReducedMotion()` returns a cached boolean: `true` when the user has requested reduced motion, `false` in Node/SSR (safe default — render the animation).

**Hard-binary gate:** render a single static frame and skip the game loop entirely:

```ts
import { prefersReducedMotion } from './lib/aicraft-engine/src/primitives';

if (prefersReducedMotion()) {
  renderStaticFrame();  // draw once, don't start the loop
  return;
}
loop.start();
```

**Partial reduction:** the helper just returns a boolean, so you can scale down rather than eliminate — e.g. halve screen-shake amplitude, zero out breathing oscillation, or reduce particle counts:

```ts
const reduced = prefersReducedMotion();
const shakeAmp = reduced ? maxShake * 0.3 : maxShake;
const breath = reduced ? 0 : breathe(tick, DEFAULT_BREATH);
```

> **Engine export:** `prefersReducedMotion()` (`src/primitives/motion.ts`).

### 8. Fixed-timestep + background tab safety

When a mobile user switches tabs or the OS suspends the browser, the tab goes hidden. Without protection, `requestAnimationFrame` stops firing; when the user returns, the accumulated wall-clock delta is huge — the simulation tries to catch up with hundreds of fixed steps and locks the device.

The engine's `createGameLoop` handles both problems:

- **Frame delta cap** (`DEFAULT_MAX_FRAME_DELTA = 1/6`): the per-frame delta is clamped to ~167ms before accumulating. If the tab was hidden for 5 seconds, the loop runs ~10 catch-up steps (not ~300).
- **`visibilitychange` reset**: when the tab becomes hidden, the loop cancels its RAF and resets the accumulator to 0. When the tab becomes visible again, it reschedules RAF and resets the clock so the first post-resume delta is tiny.

The consumer does not need to implement either — `createGameLoop` manages it internally.

> **Engine exports:** `createGameLoop`, `DEFAULT_FIXED_DT`, `DEFAULT_MAX_FRAME_DELTA` (`src/game-loop/fixed-step.ts`).

### Minimal mobile shell

A copy-pasteable starting point. Combines the viewport meta, overscroll lock, DPR-scaled canvas, touch-action, and the audio-unlock pattern.

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

---

## 9. Level visuals

Themes are consumer-owned presentation state. They do not belong in
`LevelData`, do not affect collision, and do not enter editor undo history.

### Render tile-authored and rectangle-authored levels

The same prepared scene handles both paths. Tile terrain comes from
`level.tiles`; rectangle terrain comes from resolved platform, passthrough,
moving-platform, and hazard entities.

```ts
import {
  CAVERN_LEVEL_THEME,
  createLevelThemeRenderer,
  drawPreparedLevelFrame,
  resolveLevelEntities,
} from './lib/aicraft-engine/src/platformer';
import type { LevelData } from './lib/aicraft-engine/src/level';

const renderer = createLevelThemeRenderer(CAVERN_LEVEL_THEME);
let prepared = renderer.prepare(level);

function renderLevel(
  ctx: CanvasRenderingContext2D,
  level: LevelData,
  runtimeRects: ReadonlyMap<number, { x: number; y: number; width: number; height: number }>,
): void {
  drawPreparedLevelFrame(ctx, prepared, {
    level,
    devicePixelRatio: dpr,
    view: { x: camera.x, y: camera.y, width: 600, height: 400 },
    entities: resolveLevelEntities(level.entities, runtimeRects),
    tick,
    mode: 'play',
  }, {
    drawWorld(worldCtx) {
      drawPlayer(worldCtx, player);
    },
    drawHud(hudCtx) {
      drawHud(hudCtx, score);
    },
  });
}

// Structural edit: prepare the new LevelData reference once.
prepared = renderer.prepare(editedLevel);
// Theme/collision preview toggles are presentation-only; do not edit LevelData.
```

### Define a custom material and deterministic surface detail

Normalize loose authoring data once. Direct rectangle users pass the normalized
material and opt into exactly the detail callback they need.

```ts
import {
  drawTerrainRect,
  normalizeTerrainMaterial,
} from './lib/aicraft-engine/src/terrain';
import type { TerrainDetailRenderer } from './lib/aicraft-engine/src/terrain';

const ice = normalizeTerrainMaterial({
  id: 'blue-ice',
  palette: {
    fill: '#4d84a8',
    top: '#bcecff',
    side: '#31536d',
    outline: '#132532',
    detail: '#e7faff',
  },
  topThickness: 3,
  cornerSize: 2,
});

const drawIceBubbles: TerrainDetailRenderer = (ctx, detail) => {
  // `detail.seed` is derived from the theme seed + entity/tile address.
  const offset = detail.seed % Math.max(1, Math.floor(detail.width - 4));
  ctx.fillStyle = detail.material.palette.detail;
  ctx.fillRect(detail.x + 2 + offset, detail.y + 5, 2, 2);
};

drawTerrainRect(ctx, platformRect, {
  visualSeed: 0x1ce5eed,
  devicePixelRatio: dpr,
  entityKey: platformId,
  role: 'solid',
  material: ice,
  drawDetail: drawIceBubbles,
});
```

### Use raster art in an asset-backed layer

Layer callbacks are Canvas2D callbacks, so procedural paths and loaded images
share the same contract. Asset loading remains consumer-owned.

```ts
import type { LevelRenderTheme } from './lib/aicraft-engine/src/platformer';

const skyline = new Image();
skyline.src = '/art/skyline.png';

const theme: LevelRenderTheme = {
  ...CAVERN_LEVEL_THEME,
  id: 'city-cavern',
  farBackground(ctx, frame) {
    if (!skyline.complete) return;
    const x = -((frame.view.x * 0.12) % skyline.width);
    ctx.drawImage(skyline, x, 0);
    ctx.drawImage(skyline, x + skyline.width, 0);
  },
};
```

For editor previews, expose consumer-owned `LevelThemeOption[]` and resolve IDs
with `resolveLevelThemeOption`. For deterministic sharing thumbnails, call
`drawLevelThumbnail`; it uses tick `0`, reduced-motion mode, and never mutates
the level.

---

## 10. Humanoid visuals and charger enemies

The humanoid consumes platformer results without becoming a second physics
authority. With the npm package, all symbols come from the package root:

```ts
import {
  DEFAULT_PLATFORMER_CONFIG,
  advanceHumanoidVisual,
  createHumanoidVisualState,
  deriveHumanoidConfig,
  drawHumanoid,
  stepPlatformer,
  type HumanoidVisualState,
  type PlatformerInput,
  type Solid,
} from 'aicraft-engine';

const humanoidConfig = deriveHumanoidConfig(42);
let humanoidVisual: HumanoidVisualState =
  createHumanoidVisualState(humanoidConfig);

function stepCharacter(
  dt: number,
  input: PlatformerInput,
  solids: readonly Solid[],
): void {
  const previous = platformerState;
  const result = stepPlatformer(
    previous,
    input,
    solids,
    dt,
    DEFAULT_PLATFORMER_CONFIG,
  );
  platformerState = result.state;
  humanoidVisual = advanceHumanoidVisual(
    humanoidConfig,
    humanoidVisual,
    {
      dx: platformerState.core.x - previous.core.x,
      facing: platformerState.core.facing,
      supported: platformerState.core.onGround,
      gravityDirection: DEFAULT_PLATFORMER_CONFIG.gravity < 0 ? -1 : 1,
      verticalVelocity: platformerState.core.vy,
      justLaunched: platformerState.events.justLaunched,
      justLanded: platformerState.events.justLanded,
      hitCeiling: platformerState.events.hitCeiling,
    },
    dt,
  );
}

function drawCharacter(ctx: CanvasRenderingContext2D, tick: number): void {
  drawHumanoid(
    ctx,
    platformerState.core,
    humanoidConfig,
    humanoidVisual,
    tick,
  );
}
```

Author a charger as an enemy with a fixed `16 × 16` rect. `validateLevel`
rejects other dimensions and invalid built-in parameter ranges. At runtime,
`createEnemyBehaviorRegistry()` includes `chargerBehavior`; its windup and
recovery are observable states, while damage/contact consequences remain
consumer-owned.

## 11. Save / load

Level JSON persists to `localStorage` via the defensive save helpers.

```ts
import {
  createLocalStorageSaveStorage,
  loadSave,
  writeSave,
} from './lib/aicraft-engine/src/save';
import { validateLevel, migrateLevel, LEVEL_VERSION } from './lib/aicraft-engine/src/level';
import type { LevelData } from './lib/aicraft-engine/src/level';

const storage = createLocalStorageSaveStorage('my-game-levels');

// Save
function saveLevel(level: LevelData): void {
  writeSave(storage, level);
}

// Load (with migration + validation)
function loadLevel(id: string): LevelData | null {
  const raw = loadSave(storage, null) as LevelData | null;
  if (raw === null) return null;

  // Migrate if version mismatch
  let level = raw;
  if (level.version !== LEVEL_VERSION) {
    level = migrateLevel(level, []).level; // pass your migration steps
  }

  // Validate before using
  const result = validateLevel(level);
  if (!result.valid) {
    console.error('Loaded level has errors:', result.errors);
    return null;
  }

  return level;
}
```

**Rules:**
- Never `JSON.parse` untrusted shared levels without `validateLevel` first.
- `writeSave` is defensive — silently fails on quota exceeded, private mode, etc.
- `loadSave` returns `defaultValue` on any error (missing save, corrupt JSON, backend unavailable).
- Migration steps are consumer-provided — the library ships the ladder runner, not the steps themselves.

> **Engine exports:** `createLocalStorageSaveStorage`, `createMemorySaveStorage`, `loadSave`, `writeSave` (`src/save/`).

---

## 11. Synchronization strategy

When `aicraft-engine` evolves, consumers update via:

- **Submodule:** `git submodule update --remote src/lib/aicraft-engine && git commit`
- **Vendored:** re-run the copy command and review the diff

The library's version follows semver. Breaking changes to public APIs bump the major version. The `CHANGELOG.md` (to be added at v1.0) lists migrations required.
## Embedded dual-grid terrain authoring

Keep editable terrain art beside `LevelData`; collision continues to come only
from the logical tile values. A development tool or a UGC-enabled game can mount
the optional reference panel without adding it to runtime-only bundles:

```ts
import { createTerrainArtProject, compileTerrainArtRuntime } from 'aicraft-engine';
import { mountTerrainArtReferenceEditor } from 'aicraft-engine/terrain-art/editor';

const editor = mountTerrainArtReferenceEditor(document.querySelector('#terrain-editor')!, {
  project: createTerrainArtProject({ id: 'forest' }),
  onSave(source, project) {
    localStorage.setItem(`terrain:${project.id}`, source);
  },
});

// Development-only cleanup or when leaving the authoring screen.
editor.destroy();

// Build step: ship only the deterministic runtime artifact.
const baked = compileTerrainArtRuntime(editor.getProject(), 1);
```

For a development-only editor, omit the editor entrypoint from the production
application graph and bake `manifest` plus atlas images during the asset build.
For player-created content, retain the editor, save canonical source through a
`TerrainArtStorageAdapter`, validate it on load, and compile locally. Stale local
occurrence overrides are preserved and warned about but excluded from rendering
until explicitly rebound.

## LDtk pipeline (recommended for tile-authored levels)

Author levels in the free [LDtk editor](https://ldtk.io) (MIT-licensed, by
Sébastien Bénard) and have the engine parse its `.ldtk` output — or paint into
that same project **from your own game**, because the engine re-runs LDtk's
auto-layer rules itself.

That second capability is the load-bearing one. LDtk bakes auto-tiling at save
time, which is enough to play a level but not to build one: change a cell and
the baked tiles are stale. `runLdtkAutoLayer` re-derives them from the
project's own rules and tilesets, reproducing LDtk's output exactly — verified
tile-for-tile against LDtk's own bake across the bundled sample projects
(20,046 tiles, 360 rules, including which rule placed each tile).

This is **additive** to the procedural `src/terrain/` and `src/terrain-art/`
renderers, not a replacement. Those exist for games that ship no tile art at
all; LDtk by definition cannot serve that case.

### Parse, translate, and render a `.ldtk` file

```ts
import {
  parseLdtkProject,
  ldtkLevelToLevelData,
  drawLdtkLevel,
  buildLdtkTilesetBundle,
} from 'aicraft-engine';
import { validateLevel } from 'aicraft-engine';

// 1. Parse the .ldtk JSON.
const { ok, project, errors } = parseLdtkProject(ldtkJsonString);
if (!ok || !project) throw new Error(errors.map((e) => e.message).join('; '));

// 2. Translate the first level into the engine's LevelData + tile semantics.
const { level, tileSemantics } = ldtkLevelToLevelData(project.levels[0]);
if (level) {
  const result = validateLevel(level);
  if (!result.valid) console.warn(result.errors);
}

// 3. Load the tileset PNGs referenced by defs.tilesets[] (by uid).
const tilesets = buildLdtkTilesetBundle(
  project.defs.tilesets,
  (def) => loadImageByPath(def.relPath), // your asset loader
);

// 4. Render each frame.
drawLdtkLevel(ctx, project.levels[0], {
  tilesets,
  worldOffset: { x: -camera.x, y: -camera.y },
  view: { x: camera.x, y: camera.y, width, height },
});
```

### Wire LDtk rendering into the platformer runtime

A `LevelRenderTheme` accepts an optional `terrainArt` override. When present,
the frame composer calls it **instead of** the procedural terrain renderer:

```ts
const theme = {
  ...RUINS_LEVEL_THEME,
  terrainArt: (ctx, frame) => {
    drawLdtkLevel(ctx, ldtkLevel, {
      tilesets,
      view: frame.view,
    });
  },
};
```

Collision comes from the translated `LevelData` (`ldtkLevelToLevelData` writes
the IntGrid into `tiles.data`), so `compileGeneratedLevel` and the rest of the
runtime work unchanged.

### Bundled starter tilesets

The engine ships three CC0/public-domain tilesets under `assets/ldtk/`
(Cavernas by Adam Saltsman, SunnyLand by Ansimuz, Inca by Kronbits). LDtk's own
sample projects are vendored under `assets/ldtk/samples/` as **test fixtures**
— they are the auto-tiler's correctness oracle, not shipped art. See
`assets/ldtk/README.md` and `THIRD_PARTY.md` for attribution. Nuclear Blaze is
deliberately excluded (CC-BY-SA).

### Entity mapping

`LDTK_DEFAULT_ENTITY_MAP` maps common LDtk identifiers (`Player`, `Coin`,
`Gem`, `Key`, `Exit`, `Spike`, `Enemy`, …) onto the engine's closed
`EntityKind` union. Unknown identifiers fall through to `'trigger'` with the
LDtk identifier and field instances preserved in `params`, so no entity is
silently dropped. Override the map via the `entityMap` option for
project-specific identifiers.

### Painting into a project, and saving it back

Editing is a pure pipeline: paint cells, re-run the rules, keep the result.
Every operation returns a new project, so undo is just keeping the previous
value.

```ts
import {
  readLdtkDocument,
  writeLdtkDocument,
  paintLdtkIntGrid,
  runLdtkAutoLayer,
  ldtkRuleSourceFromCsv,
  ldtkOpaqueTileLookup,
  setLdtkLayerTiles,
} from 'aicraft-engine';

// Read through `readLdtkDocument`, not `parseLdtkProject`: it keeps the raw
// JSON so fields the engine does not model survive being saved again.
const { document } = readLdtkDocument(text);

// 1. Paint. `dirty` is already widened by the reach of the layer's rules.
const painted = paintLdtkIntGrid(document.project, levelIid, layerIid, [
  { cx: 12, cy: 7, value: 1 },
]);

// 2. Re-resolve the art from the IntGrid.
const source = ldtkRuleSourceFromCsv(csv, cols, rows, layerDef);
const tiles = runLdtkAutoLayer(source, layerDef, {
  seed: layer.seed ?? 0,          // LDtk's own seed reproduces LDtk's own bake
  gridSize: layer.__gridSize,
  enabledOptionalGroups: layer.optionalRules ?? [],
  tileset: {
    cWid: def.__cWid,
    tileGridSize: def.tileGridSize,
    padding: def.padding ?? 0,
    spacing: def.spacing ?? 0,
    // Required for correct output: LDtk omits tiles hidden behind an opaque
    // one, so without this the engine emits tiles no .ldtk file contains.
    isOpaque: ldtkOpaqueTileLookup(def),
  },
});
const next = setLdtkLayerTiles(painted.project, levelIid, layerIid, tiles).project;

// 3. Save. An unmodified document returns its original text byte-for-byte.
await writeFile(path, writeLdtkDocument(document, next));
```

Two things are easy to get wrong:

- **A layer's rules may read a different layer's IntGrid** (`autoSourceLayerDefUid`).
  Painting one collision grid can legitimately restyle several layers — shadows
  and background textures typically key off it. Re-resolve every layer whose
  source is the one you painted, not just the layer you painted.
- **`intGridCsv` is present as `[]` on every layer**, including Entities and
  Tiles. Test `layer.__type === 'IntGrid'` to decide what is paintable; a
  presence check marks the whole project paintable.

### Skinning a generated level with an authored ruleset

`runLdtkAutoLayer` takes an abstract grid rather than an LDtk document, so a
procedurally generated level can be given hand-authored art direction:

```ts
const { level, tileSemantics } = generateLevel(seed, { cols: 60, rows: 34 });
const source = {
  cols: level.tiles.cols,
  rows: level.tiles.rows,
  valueAt: (cx, cy) => level.tiles.data[cx + cy * level.tiles.cols] ?? 0,
  groupOf: () => 0,
};
const tiles = runLdtkAutoLayer(source, layerDefFromLdtkProject, opts);
```
