# Flipside — A Six-Room Gravity-Flip Showcase on `aicraft-engine@0.4.0`

> Paste this entire document to a coding agent (Claude / Cursor / etc.). It is a complete, self-contained build brief: concept, architecture, exact data contracts, ASCII room layouts, implementation stages, acceptance gates, and anti-shortcut checks. The agent should produce a single runnable Vite + TypeScript browser game that imports everything from `aicraft-engine` (the npm package) and writes **no** re-implementations of what the engine already provides.

---

## 0. What You Are Building

**Flipside** — a minimalist gravity-flip explorer in the *VVVVVV* aesthetic: a small crewmate navigates six interconnected single-screen rooms, rescues a stranded crewmate, and optionally collects one gold trinket, all while a procedural chiptune plays. The player has **no jump**. The only vertical move is a single button that **flips gravity up or down** — the player walks on ceilings the same way they walk on floors, and spike traps that are safe from below become lethal from above.

**This is NOT a tech demo.** It is a designed game with six distinct rooms, each with a unique visual identity, escalating mechanics, and a hand-authored ASCII tile layout. The previous implementation failed because it used one shared box template for all rooms, produced a 1D corridor with no visual variety, had no enemies, no checkpoints, and a 1.85-second one-bar music loop. This brief fixes every one of those failures.

**Non-negotiable: build the entire game on top of `aicraft-engine@0.4.0`.** Do not hand-roll fixed-step loops, AABB collision, cameras, tile rendering, joypad input, particle bursts, the music sequencer, audio synthesis, or chiptune OSC graphs. If you find yourself writing a `requestAnimationFrame` accumulator, a gravity-flip velocity integrator, an `OscillatorNode` graph, a hand-drawn tile renderer, or a `Math.random()` in the simulation, stop and use the engine instead.

---

## 1. Tech Stack & Install

```bash
npm create vite@latest flipside -- --template vanilla-ts
cd flipside
npm install aicraft-engine@0.4.0
```

- **TypeScript**, strict. Target ES2021, `moduleResolution: bundler` (matches the engine; Vite resolves its ESM).
- **Vite** dev server + build. Single `<canvas>` in `index.html`.
- **`aicraft-engine@0.4.0`** is your only runtime dependency. Import **only** from the root barrel:
  ```ts
  import {
    // primitives
    outlineRect, lerp, clamp, floor, approach, parseHex, toHex,
    shade, mixHex,
    prefersReducedMotion, getDevicePixelRatio, resizeCanvasToBackingStore,
    createHitStop, triggerHitStop, stepHitStop, isHitStopActive,
    drawGlow, DEFAULT_GLOW_INTENSITY,
    drawTiledParallax, PARALLAX_FAR, PARALLAX_MID, PARALLAX_NEAR,
    drawText, drawTextOutlined, measureText, DEFAULT_FONT, DEFAULT_TEXT_COLOR,

    // rng + animation + particles + collision + input + easing
    mulberry32, nextInt, nextFloat, pick,
    volumeScale, sineShake, shakeEnvelope,
    createSpringRod, advanceSpringRod, DEFAULT_SPRING_ROD,
    spawn, step as stepParticles, sampleConeVelocity,
    aabbOverlap, worldToTile, tileToWorld,
    type Rect,
    easeOutCubic, createTweenState, advanceTween,

    // camera + game-loop + game-state
    createCamera, updateCamera, DEFAULT_CAMERA,
    createGameLoop, DEFAULT_FIXED_DT,
    createGameState, reduceGameState, isLegalTransition, DEFAULT_GAME_STATE_ADJACENCY,

    // audio
    createAudioAdapter, DEFAULT_AUDIO_VOLUME,

    // music — the showcase
    advanceSequencer, createNoteFirePlayer,
    buildScale, SCALES, scaleDegree, secondsPerStep,
    type Pattern, type Track, type NoteEvent, type NoteFire,
    type SequencerConfig, type SequencerState,

    // palette
    generatePalette, resolvePalette, repairContrast,

    // platformer kernel + level-runtime
    createPlatformerController, createPlatformerState,
    PUZZLE_PLATFORMER, DEFAULT_PLATFORMER_CONFIG,
    DEFAULT_PLAYER_WIDTH, DEFAULT_PLAYER_HEIGHT,
    compileLevel, drawTileGrid, drawActor, drawLevelEntity, DEFAULT_ENTITY_PALETTE,
    LEVEL_VERSION, migrateLevel, validateLevel, canonicalize, fnv1a,
    type LevelData, type LevelEntity, type TileGrid, type EntityKind,
    type PlatformerConfig, type PlatformerInput,

    // animation — displacement-driven walking (locomotion + simple feet)
    advanceLocomotionByDisplacement, evaluateLocomotion,
    blendLocomotionToStance, drawSimpleFeet,
    DEFAULT_GAIT, DEFAULT_SIMPLE_FEET, IK_PARITY_FEET,
    type LocomotionState, type GaitConfig, type LocomotionPose,
    type SimpleFeetConfig,

    // enemy archetypes
    createEnemyBehaviorRegistry, compileEnemies, stepEnemies,
    drawEnemies,
    type EnemyBehaviorHandler, type EnemyUpdateContext, type EnemyState, type EnemyStepResult,
    type CompiledEnemy,

    // collectibles + save
    collect, hasCollected, derivePickups, DEFAULT_COLLECTIBLE_RECT,
    createLocalStorageSaveStorage, createMemorySaveStorage,
    loadSave, writeSave, DEFAULT_SAVE_KEY,
  } from 'aicraft-engine';
  ```

  The published package exposes only the root `"."` entry. Never deep-import subpaths like `aicraft-engine/music`. Tree-shaking works because each module has its own barrel.

---

## 2. Determinism & Discipline Rules

These are enforced by the engine — follow them:

- **Fixed-step sim, variable render** via `createGameLoop({ fixedDt: 1/60, step, render })`. Poll input **exactly once per `step`**.
- **No `Math.random()` in the simulation.** Use `mulberry32(zoneSeed)` → `nextInt` / `nextFloat` / `pick` for crewmate names, trinket sparkle counters, particle jitter. `Math.random` is OK only for purely decorative audio/visual side-effects that never feed back into game state.
- **No `Date.now()` in the sim.** Time comes from `tick` or the loop's `dt`.
- **Music is deterministic.** Call `advanceSequencer` exactly once per fixed tick, assign its returned state, and pass only its returned events to `createNoteFirePlayer.play`.
- **Defensive host access.** Anything touching `window`/`AudioContext`/`matchMedia`/`localStorage` goes through the engine's adapters (`createAudioAdapter`, `prefersReducedMotion`, `resizeCanvasToBackingStore`, `createLocalStorageSaveStorage`) — they're lazy, error-swallowing, no-op in Node.
- **Reduced-motion gate.** If `prefersReducedMotion()` is true, render one static frame and create no audio adapter, note player, or game loop.
- **Pure progression ops.** `collect` / `loadSave` return brand-new state objects; never mutate the player, room, or save in place.

---

## 3. Architecture — Engine Module → Game System Map

| Game system | Engine API | Notes |
|---|---|---|
| Game loop (60 Hz fixed) | `createGameLoop`, `DEFAULT_FIXED_DT` | |
| Keyboard + touch input | `createKeyboardAdapter`, `createTouchButtonSet`, `orEdges` | |
| Gravity-flip player (no jump) | `createPlatformerController`, `createPlatformerState`, `PUZZLE_PLATFORMER` config + signed gravity | Two controllers: `down` (+gravity) and `up` (−gravity), empty ability pipeline, `jumpEnabled: false`. Note: `PUZZLE_PLATFORMER` inherits `jumpEnabled: true` from `DEFAULT_PLATFORMER_CONFIG` — Flipside MUST explicitly override `jumpEnabled: false`; the empty pipeline is a second safeguard, not the primary disable. |
| Tile collision/render | `compileLevel(room, { tileTypeMap: TILE_TYPE_MAP, config: FLIPPER_CONFIG, playerWidth: 8, playerHeight: 12 })` + `drawTileGrid(ctx, tiles, drawTile)` | `staticSolids` includes both tile-derived geometry and solid entities; `tileQuery` is a separate classification lookup. `drawTile` is the connected-terrain callback (§5) |
| Spike hazard AABB | `aabbOverlap` against player rect from kernel state | Direction-blind symmetric strict-AABB |
| Shuttle enemy | `createEnemyBehaviorRegistry({ shuttle })`, `compileEnemies`, `stepEnemies`, `drawEnemies` | Custom behavior handler (§6) |
| Checkpoints | Consumer-owned `CheckpointState` {roomId, x, y, gravitySign, facing} | Gravity-aware respawn (§7) |
| Camera (locked per room) | `createCamera` + `updateCamera` + `createTweenState` / `easeOutCubic` | Brief pan on room entry |
| Gold trinket | `collect`, `hasCollected`, `derivePickups` | Persistence via `createLocalStorageSaveStorage` (§8) |
| Hit-stop on death | `createHitStop`, `triggerHitStop` | |
| Screen shake on death | `sineShake`, `shakeEnvelope` | |
| Particles (flip dust, trinket sparkle, death burst) | `spawn`, `stepParticles`, `sampleConeVelocity` | |
| Parallax background | `drawTiledParallax`, `PARALLAX_FAR`, `PARALLAX_MID`, `PARALLAX_NEAR` | Three mono layers |
| Vector look + glow + text | `outlineRect`, `drawGlow`, `drawText`, `drawTextOutlined` | |
| Frame FSM | `createGameState`, `reduceGameState`, `isLegalTransition` | |
| Displacement-driven walking animation | `advanceLocomotionByDisplacement`, `evaluateLocomotion`, `drawSimpleFeet`, `blendLocomotionToStance`, `DEFAULT_GAIT`, `FLIPSIDE_GAIT` | Phase integrates from actual horizontal displacement (not time), so the walk cycle freezes when the player stops — no foot sliding. `drawSimpleFeet` replaces the static 3×3 foot rects with sin/cos-driven foot oscillation. |
| Mono palette | `generatePalette`, `repairContrast` | |
| Procedural chiptune | `advanceSequencer`; `createNoteFirePlayer(audio)` | Fixed-step determinism seam (§9) |
| Synthesized SFX | `createAudioAdapter` → `playTone('square', ...)` | Same waveform as lead track |

---

## 4. The Player — No Jump, Gravity Is the Verb

The player is a chunky crewmate drawn with `outlineRect`: a body, two square eye dots that face the move direction, two distinct feet, and a short spring-rod antenna attached to the head. The complete body + face + feet sprite flips vertically with gravity so the feet always contact the active walking surface. There are no ability processors; the only Y-axis input toggles the `1 | -1` gravity direction.

### 4.1 Physics

Use the signed-gravity kernel exclusively. Build both controllers once with an empty ability pipeline:

```ts
const FLIPPER_CONFIG: PlatformerConfig = {
  ...PUZZLE_PLATFORMER,
  gravity: 1100,
  maxFallSpeed: 520,
  moveSpeed: 160,
  airControl: 0.6,
  wallJumpVx: 0, wallJumpVy: 0,
  jumpEnabled: false,            // CRITICAL: Flipside's gravity flip IS the verb
};

const downController = createPlatformerController([], FLIPPER_CONFIG);
const upController = createPlatformerController([], {
  ...FLIPPER_CONFIG,
  gravity: -FLIPPER_CONFIG.gravity,
});
```

**Space / W / Up / touch binds only to the polled gravity-flip edge.** Do not add a consumer gravity integrator or collision path. Each fixed tick:

```ts
const controller = gravitySign === 1 ? downController : upController;
const input: PlatformerInput = {
  moveX: edges.left.held ? -1 : edges.right.held ? 1 : 0,
  jump: { held: false, pressed: false, released: false },  // frozen idle
  dash: null,
};
const { state: next } = controller.step(state, input, compiled.staticSolids, dt);
state = next;

// Displacement-driven locomotion advance (only while on ground).
// See §4.3 for the gait config, named thresholds, and full render pipeline.
const player = state;  // controller.step returned the updated PlatformerState
const worldDx = player.core.vx * dt;
const isMoving = Math.abs(worldDx) > MOVING_SPEED_THRESHOLD;
if (player.core.onGround && isMoving) {
  const localDx = worldDx * player.core.facing;
  loco = advanceLocomotionByDisplacement(loco, localDx, FLIPSIDE_GAIT);
}
// When onGround+idle or airborne, phase freezes.

// on flip press AND |state.core.vy| < 80:
if (flipEdge && Math.abs(state.core.vy) < 80) {
  gravitySign = gravitySign === 1 ? -1 : 1;
}
```

### 4.2 Body Render

Positive `volumeScale` offsets stretch vertically and negative offsets squash vertically. On flip, create state with `createTweenState()` and advance it using `{ duration: 0.15, ease: easeOutCubic }`; map the normalized result from a negative squash offset back to zero.

**Orientation is mandatory.** Mirror horizontally for `facing` and vertically for `gravitySign`. Viridian turns upside down in *VVVVVV*: when gravity points up, the feet touch the ceiling, the head points away from it, and the face rotates with the body. An upright sprite touching the ceiling head-first is a visual bug. Apply both transforms around the body's center so the rendered sprite stays inside the kernel-owned player AABB:

```ts
const gravityY = gravitySign === 1 ? 1 : -1;

ctx.save();
ctx.translate(bodyCx, bodyCy);
ctx.scale(facing * squash.scaleX, gravityY * squash.scaleY);

// Local-space head is at -h/2; local-space feet end at +h/2.
// NOTE: Feet are drawn via drawSimpleFeet in §4.3 — NOT as static rects here.
outlineRect(ctx, -w / 2, -h / 2, w, h - 3, palette.base, palette.outline);
outlineRect(ctx, -2, -h / 2 + 4, 1, 1, palette.accent);
outlineRect(ctx, +1, -h / 2 + 4, 1, 1, palette.accent);
ctx.restore();
```

**Antenna.** Keep the spring rod in screen space, outside the body transform, but attach its first node to the gravity-aware head side: `anchorY = gravitySign === 1 ? player.y : player.y + player.height`. Advance it with `advanceSpringRod(antenna, anchor.x, anchorY, dt, { ...DEFAULT_SPRING_ROD, restDirection: { x: 0, y: -gravitySign } })`. The rod must be short, its first segment must visibly meet the head, and its stroke must contrast with the background. Do not use a background-matching outline color that leaves only the tip visible as a detached floating square.

### 4.3 Displacement-Driven Walking Animation

Replace the static 3×3 foot rectangles with the engine's `drawSimpleFeet` renderer driven by `advanceLocomotionByDisplacement`. The walk phase is coupled to actual horizontal movement (`player.core.vx × dt`), not time, so the feet freeze perfectly when the player stops — no foot sliding. Phase advances only while `player.core.onGround` is true; it freezes during idle or airborne state.

**Gait config (tuned for the 8×12 player body):**

```ts
const FLIPSIDE_GAIT: GaitConfig = {
  baseFrequency: 0.05,  // unused by displacement-driven advance; kept for consistency
  strideLength: 2,      // px — short stride for small body (key input for displacement advance)
  strideHeight: 2,      // px — gentle lift
  hipBobHeight: 1,      // px — subtle body bob
  hipSwayWidth: 0,      // zero — no lateral sway for crewmate chassis
};
```

**SimpleFeet config (matches existing 3×3 foot positions in local body space):**

```ts
// Spread this at render time and override color/outline from the palette:
const FLIPSIDE_FEET_TEMPLATE: Omit<SimpleFeetConfig, 'color' | 'outline'> = {
  footW: 3,
  footH: 3,
  idleSpread: 2.5,       // each foot center ±2.5 px from midline
  baseY: 3,              // foot top at y=3 from body center (PLAYER_H/2 - footH)
};
```

**Tunable threshold (kept beside the gait config):**

```ts
/** Minimum |worldDx| below which the player is considered stationary. */
const MOVING_SPEED_THRESHOLD = 0.5;  // px/tick
/** Desired gap between foot centers when standing idle (footW + gap). */
const STANCE_FOOT_SPREAD = 4;  // 3px footW + 1px gap
```

**Step logic (per tick, after the controller step, only while on ground):**

```ts
// Displacement-driven phase advance (local-space: dx * facing).
const worldDx = player.core.vx * dt;
const isMoving = Math.abs(worldDx) > MOVING_SPEED_THRESHOLD;
const localDx = worldDx * player.core.facing;  // local-space for ctx.scale(facing,1) render

if (player.core.onGround) {
  if (isMoving) {
    loco = advanceLocomotionByDisplacement(loco, localDx, FLIPSIDE_GAIT);
  }
  // When not moving, phase freezes — feet stay planted.
} // Airborne (onGround === false): phase freezes.

```

**State fields.** The game state carries two fields for the renderer to derive the pose:

```ts
readonly locoState: LocomotionState;  // displacement-driven phase, advanced in step
readonly isMoving: boolean;           // computed in step from |worldDx| > MOVING_SPEED_THRESHOLD
```

**Render logic (inside the body's save/translate/scale block, replacing the old static 3×3 `outlineRect` calls):**

```ts
// Derive the walk pose from the stored phase + isMoving flag.
const rawPose = evaluateLocomotion(state.locoState, FLIPSIDE_GAIT);
const stanceBlend = state.isMoving ? 0 : 1;
const pose = blendLocomotionToStance(rawPose, stanceBlend, STANCE_FOOT_SPREAD);

// Body rect (unchanged)
outlineRect(ctx, -PLAYER_W / 2, -PLAYER_H / 2, PLAYER_W, PLAYER_H - 3, palette.base, palette.outline);

// Locomotion-driven feet (replaces static 3×3 rects)
drawSimpleFeet(ctx, pose, {
  ...FLIPSIDE_FEET_TEMPLATE,
  color: palette.base,
  outline: palette.outline,
});
```

**Facing-mirror discipline.** The `ctx.scale(facing, 1)` already wraps the entire body draw (see §4.2). `drawSimpleFeet` draws in BODY-LOCAL coordinates and assumes this mirror is active. Passing `localDx = worldDx * facing` to `advanceLocomotionByDisplacement` ensures the phase always advances forward in local space — the render-side mirror then produces the correct visual direction. Both the simulation-side fix and the render-side mirror are required; forgetting either produces a moonwalk.

**No footstep tap.** VVVVVV is silent during walking. The chiptune is the backdrop.

**Ground-contact detection.** `player.core.onGround` (the engine's `ActorCore` field) distinguishes ground from air. Only advance locomotion when `onGround` is true; freeze phase when airborne (gravity flipping). The field is named `onGround`, not `grounded` — a common source of TS errors.

---

## 5. World — Six Connected Single-Screen Rooms (A–F)

### 5.1 Logical Resolution & Grid

| Parameter | Value |
|---|---|
| Logical resolution | 320 × 240 |
| Grid | 40 × 30 tiles |
| Tile size | 8 px |
| CSS upscale | `image-rendering: pixelated` on the canvas, backing store at 320×240, CSS scales to viewport |
| Player body | ~8 × 12 px (half a tile wide, 1.5 tiles tall) |

Canvas setup:
```ts
const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
canvas.style.imageRendering = 'pixelated';
const dpr = resizeCanvasToBackingStore(canvas, 320, 240);
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
```

### 5.2 Nonlinear 2×3 Room Map

```
D — E — F
|   |   |
A — B — C
```

- **Start:** Room A (bottom-left). **Goal:** Rescue crewmate in Room F (top-right).
- **Main route:** A → B → C → F (bottom row right, then up to F).
- **Optional/exploration loops:** B → E → D → A (up, left, down) and E → F (right).
- **Transitions:** N/S/E/W. Every edge is reciprocal (if D has a south door to A, A has a north door to D).
- **Room transitions:** Walking off one edge teleports the player to the linked room's matching edge spawn. Camera lerps to the new room over 0.25 s (`easeOutCubic`). Player physics freeze during the pan.

### 5.3 ASCII Room Definition Format

Each room is a literal 40×30 ASCII grid in its own file (or clearly separated literal in a shared `rooms.ts`). A shared ASCII parser converts the grid to `LevelData` tile values.

**Legend:**

| Char | Meaning | Tile value |
|---|---|---|
| `.` | Empty (air) | 0 |
| `#` | Solid | 1 |
| `^` | Spike (pointing up, floor hazard) | 2 |
| `v` | Spike (pointing down, ceiling hazard) | 3 |
| `X` | Checkpoint zone (triggers save, not a tile) | 0 (parsed as entity) |
| `S` | Enemy spawn (shuttle start position) | 0 (parsed as entity) |
| `T` | Trinket spawn | 0 (parsed as entity) |
| `@` | Player spawn | 0 (parsed as entity) |
| `>` | Exit east (2-tile gap in wall) | 0 |
| `<` | Exit west (2-tile gap in wall) | 0 |
| `^` (top edge) | Exit north (2-tile gap in ceiling) | 0 |
| `v` (bottom edge) | Exit south (2-tile gap in floor) | 0 |

**Tile type map:**
```ts
const TILE_TYPE_MAP = (v: number): 'solid' | 'empty' | 'passthrough' => {
  if (v === 1) return 'solid';
  if (v === 2 || v === 3) return 'empty';  // spikes are NOT solid — they're hazard rects
  return 'empty';
};
```

**Shared border helper** (allowed; the constraint is NO shared `buildRoomTiles` box template):
```ts
function addBorder(grid: string[], opts: { north?: boolean; south?: boolean; east?: boolean; west?: boolean }): void {
  // Adds 1-tile solid borders on specified edges, with 2-tile exit gaps
}
```

### 5.4 Connected Terrain Renderer (Consumer-Local)

This is the visual identity system. It lives in the game as `tile-style.ts` — NOT in the engine. The engine provides `drawTileGrid(ctx, tiles, drawTile)` and the `shade`/`mixHex` color helpers.

**Neighbor bitmask.** For each solid tile, read N/E/S/W neighbors (safe reads — out-of-bounds = not solid):

```ts
function neighborMask(grid: number[], cols: number, rows: number, tx: number, ty: number): number {
  let mask = 0;
  if (ty > 0 && grid[(ty - 1) * cols + tx] === 1) mask |= 1;  // N
  if (tx < cols - 1 && grid[ty * cols + tx + 1] === 1) mask |= 2;  // E
  if (ty < rows - 1 && grid[(ty + 1) * cols + tx] === 1) mask |= 4;  // S
  if (tx > 0 && grid[ty * cols + tx - 1] === 1) mask |= 8;  // W
  return mask;
}
```

**Diagonal corner handling.** For interior corners (e.g., tile has N and W solid but NW is empty), draw a small corner fill to prevent visual holes.

**Render rules per solid tile:**

| Rule | What |
|---|---|
| Fill | Connected mass color (room-specific palette via `shade`/`mixHex`) |
| Highlight | Only exposed north and west edges (lighter shade) |
| Shadow | Only exposed south and east edges (darker shade) |
| Outline | ONLY external edges — **NEVER outline internal borders between connected tiles** |

**Six room motifs.** Each room's `drawTile` callback closes over the grid and applies a motif-specific interior detail:

| Room | Motif | Visual |
|---|---|---|
| A | Dots | Small centered dots in each solid tile |
| B | Bands | Horizontal stripes (2px alternating) |
| C | Ribs | Vertical ridges (1px lines every 3px) |
| D | Chevrons | V-shaped marks pointing toward the room's challenge direction |
| E | Diamonds | Diamond-shaped cutouts centered in each tile |
| F | Cross-braced panels | X-shaped internal bracing |

**Color derivation.** Each room has a base palette. Derive fill/highlight/shadow/outline from the darkest shade, not pure black:

```ts
const roomBase = shade(zoneColor, 0.6);  // base fill
const roomHighlight = shade(zoneColor, 0.8);
const roomShadow = shade(zoneColor, 0.35);
const roomOutline = shade(zoneColor, 0.15);  // never pure '#000000'
```

**Gate:** A six-style sample sheet (one screenshot per motif) must be produced and reviewed before room integration. No room is accepted based on unit tests alone.

### 5.5 Room Definitions — Detailed Specifications

Each room is a `LevelData` built from a 40×30 ASCII literal. Here are the specifications. The actual ASCII grids are written during implementation.

#### Room A — "First Inversion" (safe onboarding)

- **Arc:** Safe onboarding. Geometry naturally forces one flip. Checkpoint after the lesson.
- **Flip count:** 1–2 meaningful flips.
- **Layout concept:** Open starting area on the left. A low ceiling section in the middle forces the player to flip up to cross. A checkpoint (X) sits just past the forced-flip zone. The east exit connects to B; the north exit connects to D.
- **Unique silhouette:** Wide, open lower-left. Narrow vertical channel in the center requiring a flip. Wider space on the right.
- **Motif:** Dots.
- **Palette:** Warm neutral (the "home" feeling).

#### Room B — "Teeth Above, Teeth Below"

- **Arc:** Alternating floor/ceiling spikes. Safe-to-narrow escalation.
- **Flip count:** 3–4 flips.
- **Layout concept:** Floor spikes (`^`) and ceiling spikes (`v`) alternate in columns. The safe path requires flipping between floor and ceiling to dodge alternating hazard rows. Sections narrow from left to right, increasing tension. Checkpoint at the narrowest point.
- **Unique silhouette:** Zigzag internal void between alternating spike rows. No straight corridor.
- **Motif:** Bands.
- **Palette:** Cool blue-grey (increasingly clinical).

#### Room C — "Traffic Control"

- **Arc:** Introduce deterministic shuttle enemy. Two offset movers with static spikes. Waiting/timing.
- **Flip count:** 2–4 flips.
- **Layout concept:** A shuttle enemy (S) patrols horizontally across a gap. Two static spike patches create timing windows. The player must wait for the shuttle to pass, then flip through. Checkpoint before the shuttle zone.
- **Unique silhouette:** Wide central corridor with the shuttle path; spike clusters on both floor and ceiling.
- **Motif:** Ribs.
- **Palette:** Steel grey (industrial).

#### Room D — "The Long Way Round" (optional, hardest trinket)

- **Arc:** Optional hardest trinket route. Not on the critical path.
- **Flip count:** 5–7 flips.
- **Layout concept:** Accessed from Room A (north) or Room E (west). Alternating spikes + one shuttle enemy. The trinket (T) sits in an alcove that requires precise flip sequences. The room loops back to A (south exit) so the player can retry without losing progress.
- **Unique silhouette:** Spiral-ish internal path. The trinket alcove is visually recessed.
- **Motif:** Chevrons.
- **Palette:** Deep red-ochre (danger, optional).

#### Room E — "Inversion Engine" (three-way hub)

- **Arc:** Three-way hub with vertical silhouette. Moving hazards separating routes.
- **Flip count:** 3–6 flips depending on destination.
- **Layout concept:** Central hub connecting D (west), F (east), and B (south). Two shuttle enemies on vertical paths separate the routes. The player must time flips to cross between the shuttles. Checkpoint at the hub center.
- **Unique silhouette:** T-shaped or cross-shaped hub. Vertical channels on left and right for shuttles.
- **Motif:** Diamonds.
- **Palette:** Teal-green (transitional).

#### Room F — "Positive Force" (finale + rescue)

- **Arc:** Checkpoint then fair combined finale. No new mechanic. Rescue after gauntlet.
- **Flip count:** 4–6 flips.
- **Layout concept:** Accessed from Room C (south) or Room E (west). A checkpoint at the entry. The finale combines floor spikes, ceiling spikes, and one shuttle enemy in a fair sequence. The crewmate sits at the far end. Touching the crewmate for 60+ ticks triggers the win.
- **Unique silhouette:** Clear progression corridor from left to right, widening at the crewmate alcove.
- **Motif:** Cross-braced panels.
- **Palette:** Warm gold accent (resolution).

---

## 6. Shuttle Enemy — Deterministic Axis-Aligned Hazard

A custom `EnemyBehaviorHandler` registered via `createEnemyBehaviorRegistry({ shuttle })`. This is a pure axis-aligned back-and-forth hazard — no health, no combat, no projectiles, no chasing.

### 6.1 Behavior Interface

```ts
const shuttleBehavior: EnemyBehaviorHandler = {
  step(state: EnemyState, ctx: EnemyUpdateContext, params: Record<string, unknown>): EnemyStepResult {
    const axis = (params.axis ?? 'x') as 'x' | 'y';
    const min = (params.min ?? 0) as number;
    const max = (params.max ?? 200) as number;
    const speed = (params.speed ?? 60) as number;
    const phase = (params.phase ?? 0) as number;  // initial offset in [0, 1]

    // Deterministic ping-pong: advance position along axis, reverse at bounds.
    // phase offsets the starting position for staggered shuttles.
    let pos = axis === 'x' ? state.x : state.y;
    let dir = state.data.dir ?? 1;
    const dt = ctx.dt;

    pos += dir * speed * dt;
    if (pos >= max) { pos = max; dir = -1; }
    if (pos <= min) { pos = min; dir = 1; }

    return {
      ...state,
      x: axis === 'x' ? pos : state.x,
      y: axis === 'y' ? pos : state.y,
      vx: axis === 'x' ? dir * speed : 0,
      vy: axis === 'y' ? dir * speed : 0,
      data: { ...state.data, dir },
    };
  },
};
```

### 6.2 Registration

The handler object above has only `step(...)` — it has no `kind` field. The string `'shuttle'` is the key passed to the registry, not a property of the handler:

```ts
const registry = createEnemyBehaviorRegistry({ shuttle: shuttleBehavior });
const enemies = compileEnemies(level);  // LevelData with 'enemy' entities
const { enemies: nextEnemies, projectiles } = stepEnemies(enemies, registry, ctx);
```

### 6.3 Visual

Custom VVVVVV-like shaded square draw — a solid square with a darker bottom half (simulating a simple shadow). NOT using the engine's default `drawEnemies` renderer for shuttles; provide a custom draw override or draw manually in the render pass.

### 6.4 Contact Death

Any overlap between the shuttle's rect and the player's rect triggers death (same as spikes). Check via `aabbOverlap(playerRect, shuttleRect)`.

### 6.5 Rooms Using Shuttles

- **Room C:** One horizontal shuttle patrolling a gap.
- **Room D:** One shuttle on the trinket route.
- **Room E:** Two vertical shuttles separating hub routes.
- **Room F:** One shuttle in the finale gauntlet.

---

## 7. Gravity-Aware Checkpoints

Checkpoints store the full respawn state, not just a position:

```ts
interface CheckpointState {
  readonly roomId: string;
  readonly x: number;
  readonly y: number;
  readonly gravitySign: 1 | -1;
  readonly facing: 1 | -1;
}
```

### 7.1 Activation

On each fixed tick, test the player's rect against checkpoint entity rects (kind `'trigger'` with `props.action === 'checkpoint'`). On overlap, store the current state:

```ts
if (aabbOverlap(playerRect, checkpointRect)) {
  checkpoint = { roomId, x: player.x, y: player.y, gravitySign, facing };
}
```

### 7.2 Death Respawn

On death, instead of respawning at the room's spawn point with gravity down, respawn at the latest checkpoint preserving gravity:

```ts
// Death flash phase ends:
player = createPlatformerState(checkpoint.x, checkpoint.y, FLIPPER_CONFIG, PLAYER_W, PLAYER_H);
gravitySign = checkpoint.gravitySign;
facing = checkpoint.facing;
roomId = checkpoint.roomId;
```

### 7.3 Placement Rules

- Place before each challenge escalation (before spike rows, before shuttle zones).
- Each room that has a challenge section gets at least one checkpoint.
- Room A: one checkpoint after the forced-flip lesson.
- Room B: one checkpoint at the narrowest point.
- Room C: one checkpoint before the shuttle zone.
- Room E: one checkpoint at the hub center.
- Room F: one checkpoint at the entry.

---

## 8. Trinket — Optional Mastery Challenge in Room D

The gold trinket is a **routing challenge**, not a floor-path pickup. It sits in an alcove in Room D that requires precise flip sequences to reach.

### 8.1 Entity

```ts
{
  id: TRINKET_ENTITY_ID,
  kind: 'collectible',
  rect: { x: trinketX, y: trinketY, width: 8, height: 8 },
  props: { kind: 'gem', persists: true },
}
```

### 8.2 Persistence

```ts
const storage = createLocalStorageSaveStorage('flipside:trinkets');
let trinketSave = loadSave(storage, { collected: [] as string[] });
```

Per-tick `derivePickups` → `collect` → `writeSave` (only on change).

### 8.3 Render

Gold glow + diamond shape (same as before, but at 8px scale). Skip when `hasCollected(trinketSave, String(TRINKET_ENTITY_ID))` is true.

---

## 9. Procedural Chiptune — The Showcase

> This is the headline feature. A 256-step / 16-bar composition at ~140 BPM (~27 seconds), not a 16-step one-bar loop.

### 9.1 Architecture

| Layer | What | Determinism |
|---|---|---|
| **Pattern** | Seeded `Pattern` via `generatePattern` OR direct `Pattern` construction | Pure (`mulberry32` only) |
| **Advance** | `advanceSequencer(state, dt, pattern)` → `{ next, events }` | Pure — the determinism seam |
| **Host** | `createNoteFirePlayer(audio)` renders exact events | Host-only (decorative) |

### 9.2 Composition Requirements

| Parameter | Value |
|---|---|
| Total steps | 256 |
| Steps per beat | 4 (16th notes) |
| Beats per bar | 4 |
| Total bars | 16 |
| BPM | 138–145 |
| Duration | ~27 seconds |
| Form | A → A' → B → A'' (4-bar sections) |
| Root | C4 (MIDI 60) |
| Scale | C minor pentatonic |
| Bass roots | ≥4 distinct roots in the harmonic progression |

### 9.3 Pattern Construction

For a 256-step / 16-bar composition with distinct sections, use **direct `Pattern` construction** — build the `Pattern` object manually from `scaleDegree` calls and theory helpers (all imported from the root barrel; see §1):

```ts
const scale = buildScale(60, SCALES.minorPentatonic, 2);
// Construct 16 four-bar sections with distinct lead motifs,
// a bass harmonic progression with ≥4 roots, and percussion fills
// at section boundaries (every 64 steps).
```

This is NOT an engine change — it's consumer-local composition using the engine's theory primitives. The `Pattern` type is plain data:

```ts
type Pattern = {
  bpm: number;
  stepsPerBeat: number;
  stepsPerPattern: number;
  scale?: { rootMidi: number; intervals: number[] };
  tracks: Track[];
};
```

### 9.4 Musical Requirements

- **Recognizable lead motif** with controlled seeded ornamentation (variations on the motif across A/A'/A'').
- **Bass harmonic progression** with ≥4 distinct root notes, changing harmony across sections.
- **Percussion fills** at section boundaries (every 64 steps) — a denser drum pattern for 2–4 steps.
- **No two four-bar sections byte-identical** — each 64-step section must have distinct note data.
- **Same seed → byte-identical forever** — the composition is deterministic.

### 9.5 Advance Call

Exactly one `advanceSequencer` call per fixed tick, in the step function:

```ts
const { next, events } = advanceSequencer(seqState, dt, pattern, { swing: 0.5 });
seqState = next;
notePlayer.play(events);
```

### 9.6 Death & Rescue

- **Death:** Duck music volume (reduce to ~30% during death flash, restore on respawn).
- **Rescue:** Play a cadence (ascending arpeggio) over the music.

### 9.7 SFX

- **Gravity flip:** `playTone('square', 880, 220, 90, 0.22)` — descending square zap (same waveform as lead).
- **Trinket pickup:** `playTone('square', 1200, 1600, 90, 0.18)`.
- **Crewmate rescue:** `playTone('triangle', 523, 784, 220, 0.20)`.
- **Spike death:** `playNoise(120, 'lowpass', 400, 0.30)` + `playTone('sine', 400, 80, 200, 0.25)`.
- **Room transition:** `playTone('square', 220, 440, 60, 0.12)`.

---

## 10. Visual & Play Gates

### 10.1 Screenshot Requirements

Before any room is accepted as complete:

1. **Contact sheet of all six rooms** — full 320×240 screenshots of each room's rendered state.
2. **Benchmarker/vision review** — the screenshots must show distinct visual identities (motifs, palettes, silhouettes).
3. **No room accepted based only on unit tests.** Structural tests prove data correctness, not visual quality.

### 10.2 Playthrough Requirements

- **Complete A → B → C → F playthrough** — the main route must be completable.
- **Optional D trinket route** — A → D → (trinket) → back to A must work.
- **Manual playtest targets:**
  - First completion: 5–8 minutes (includes learning the flip mechanic).
  - Expected deaths: 3–8 (spikes are forgiving with checkpoints).
  - Fast checkpoint retry: <2 seconds from death to controllable respawn.

### 10.3 Rejection Criteria

The following are grounds for rejecting the build:

- Repeated silhouettes (two rooms with the same shape).
- Empty space that doesn't contribute to gameplay.
- Unreadable hazards (spikes blending into the terrain).
- Screenshot only of room A (must show all six rooms).
- A 16-step loop (must be 256-step / 16-bar).
- One shared template for all rooms.
- One spike room (must have spikes in multiple rooms with different patterns).

---

## 11. Tests & Static Contracts

### 11.1 Room Schema

- Each room's `LevelData` passes `validateLevel`.
- Each room's grid is exactly 40×30.
- Each room has exactly one `@` (spawn) entity.
- Each room has at least one `X` (checkpoint) entity.

### 11.2 Reciprocal Graph

- For every edge (A→B exists ⟺ B→A exists), verify both directions are defined.
- For every edge, the exit gap in the source room aligns with the entry spawn in the destination room.

### 11.3 Unique Room Hashes

- Compute `fnv1a(canonicalize(room.tiles.data))` for each room.
- All six hashes must be distinct (proves no shared template).

### 11.4 Expected Content Counts

| Room | Spikes | Shuttles | Checkpoints | Exits |
|---|---|---|---|---|
| A | ≥2 | 0 | 1 | 2 (E, N) |
| B | ≥4 | 0 | 1 | 2 (W, E) |
| C | ≥2 | 1 | 1 | 2 (W, S) |
| D | ≥4 | 1 | 0 | 2 (E, S) |
| E | ≥2 | 2 | 1 | 3 (W, E, S) |
| F | ≥4 | 1 | 1 | 2 (W, N) |

### 11.5 Checkpoint Gravity

- Test: die with `gravitySign = -1` near a checkpoint. Respawn must preserve `gravitySign = -1`.
- Test: die with `gravitySign = 1` near a checkpoint. Respawn must preserve `gravitySign = 1`.

### 11.6 Enemy Determinism

- Step a shuttle enemy for 300 ticks with `dt = 1/60`. Record positions.
- Re-run with same params. Positions must be byte-identical.
- Shuttle must reverse exactly at `min` and `max` bounds.

### 11.7 Music Duration & Variation

- Pattern `stepsPerPattern` must be 256.
- Pattern must have ≥3 tracks (bass, lead, percussion).
- No two 64-step windows in the pattern may be byte-identical (test via `canonicalize` + string comparison).
- At least 4 distinct MIDI pitches in the bass track across the full pattern.
- At least one percussion fill (denser drum pattern) at a section boundary.

### 11.8 Simulation Determinism

- Run 600 ticks of `stepGame` with fixed inputs. Record final state.
- Re-run. Final state must be byte-identical.

### 11.9 Forbidden Patterns

Static analysis (grep / AST) must find:

- **No `requestAnimationFrame`** in game code (only in the engine's `createGameLoop`).
- **No `Math.random`** in game code.
- **No `Date.now`** in game code.
- **No manual gravity integration** (no `vy += gravity * dt` outside the engine).
- **No `stepPlatformer`** (must use `createPlatformerController` + `.step()`).
- **No deep imports** (no `aicraft-engine/src/...` — only root barrel).
- **Exactly one `advanceSequencer` call** (grep confirms exactly one occurrence in the step function).

### 11.10 Player Orientation Visual Contract

- Render the same player AABB once with `gravitySign = 1` and once with `gravitySign = -1`. The vertical body transform must have opposite signs while the AABB remains unchanged.
- In the down-gravity pose, both feet visibly contact the floor-facing edge of the AABB. In the up-gravity pose, both feet visibly contact the ceiling-facing edge. The head must never be the contact point.
- The eyes rotate with the complete body rather than remaining upright in screen space.
- The antenna's first node must equal the gravity-aware head anchor in both poses. Its first segment and tip must remain visibly connected against the room background.
- Capture one floor-walking pose and one ceiling-walking pose for vision review. A reviewer must be able to identify the feet, walking surface, head, and attached antenna at a glance.

### 11.11 End-to-End Route Tests (Where Practical)

Scripted input sequences that drive the player from A → B → C → F. These are NOT proof of fun — they prove the route is mechanically possible. Use replay recording if available, or hardcode a sequence of `InputEdges` per tick.

### 11.12 Walking Animation

- The game state must include a `readonly locoState: LocomotionState` field and a `readonly isMoving: boolean` field.
- `advanceLocomotionByDisplacement` must be called exactly once per tick when `player.core.onGround` is true AND `isMoving` is true. Phase must freeze when onGround+idle or airborne.
- The render pass must call `drawSimpleFeet` inside the body's `save → translate → scale(facing, 1) → draw → restore` block, replacing the old static 3×3 foot rects. `evaluateLocomotion` and `blendLocomotionToStance` must be called in the render function (not pre-baked in step).
- Test: step the game for 60 ticks with `moveX = 1` on terrain where `onGround` is true (walking right). `state.locoState.phase` must differ from initial value.
- Test: step the game for 60 ticks with `moveX = 0` on terrain where `onGround` is true (idle). `state.locoState.phase` must stay at its initial value.
- Test: step the game for 60 ticks with `moveX = -1` on terrain where `onGround` is true (walking left). `state.locoState.phase` must differ from both the idle and right-walking phases (direction-dependent phase).
- Test: while airborne (`onGround` is false), `state.locoState.phase` must never advance regardless of `moveX`.
- Test: render one frame after 60 ticks of right-walking. The `pose` argument to `drawSimpleFeet` must have nonzero foot offsets (proves the gait is animating).
- Forbidden: no manual foot animation code (no local sin/cos in render.ts — must use engine exports).

---

## 12. Preserved Constraints

- **Reduced-motion early gate** — `prefersReducedMotion()` checked before audio setup; renders one static frame; creates no audio adapter, note player, or loop.
- **Touch + keyboard input** — `createKeyboardAdapter` + `createTouchButtonSet` + `orEdges`.
- **DPR / pixel scaling** — `resizeCanvasToBackingStore` + `ctx.setTransform(dpr, ...)`.
- **Fixed-step sim** — `createGameLoop({ fixedDt: 1/60 })`.
- **No jump** — `jumpEnabled: false` in `FLIPPER_CONFIG`, idle jump edge fed to the kernel. `PUZZLE_PLATFORMER` inherits `jumpEnabled: true` from `DEFAULT_PLATFORMER_CONFIG`, so the explicit override in `FLIPPER_CONFIG` is mandatory; the empty ability pipeline is a second safeguard.
- **Signed gravity controllers** — empty ability pipeline, `jumpEnabled: false` (explicit override required — inherited default is `true`).
- **Zero runtime deps** — `aicraft-engine` is the only dependency.

---

## 13. Install & Version

```bash
npm install aicraft-engine@0.4.0
```

`aicraft-engine@0.4.0` is published and stable. Do not pin to `0.3.0`. The brief targets the published `0.4.0` API exactly — signed platformer gravity, the fixed-step `advanceSequencer` step-boundary fix, `createNoteFirePlayer`, `compileLevel` returning `compiled.staticSolids` (tile-derived + solid entity geometry) and `compiled.tileQuery` (separate tile classification lookup), and the enemy archetypes pipeline (`compileEnemies`, `stepEnemies`, `createEnemyBehaviorRegistry`).

---

## 14. Implementation Workflow

Build in this order. Each stage must pass its gate before the next begins.

### Stage 1: Terrain Prototype + Visual Decision

1. Set up Vite + TypeScript + `aicraft-engine@0.4.0`.
2. Implement the connected terrain renderer (`tile-style.ts`) with all six motifs.
3. Produce a six-style sample sheet (one 320×240 screenshot per motif).
4. **Gate:** Visual review confirms six distinct motifs. No two rooms look the same.

### Stage 2: ASCII Room Design Review

1. Write all six 40×30 ASCII grids.
2. Parse them into `LevelData` objects.
3. Validate with `validateLevel`.
4. Compute room hashes — all six must be distinct.
5. **Gate:** ASCII grids reviewed for unique silhouettes, readable hazards, and correct exit placement.

### Stage 3: Graybox Mechanics

1. Wire the game loop, input, signed-gravity controllers.
2. Implement room transitions (exit detection, teleport, camera pan).
3. Add spike AABB checks (floor and ceiling spikes in multiple rooms).
4. Add shuttle enemy behavior + registration.
5. Add checkpoints (gravity-aware respawn).
6. **Gate:** Playable A → B → C → F route. Checkpoints work. Death preserves gravity.

### Stage 4: Playtest

1. Playtest all six rooms. Adjust spike placement, shuttle speed, checkpoint positions.
2. Verify the trinket route in Room D is challenging but fair.
3. **Gate:** 5–8 minute first completion, 3–8 expected deaths, fast checkpoint retry.

### Stage 5: Music

1. Compose the 256-step / 16-bar pattern.
2. Wire `advanceSequencer` + `createNoteFirePlayer`.
3. Implement death ducking and rescue cadence.
4. **Gate:** Music plays for ~27 seconds before looping. No two 64-step sections are identical. ≥4 bass roots. Percussion fills at section boundaries.

### Stage 6: Polish

1. Add particles (flip dust, trinket sparkle, death burst).
2. Add screen shake on death.
3. Add hit-stop on death.
4. Add flip squash tween.
5. Add the gravity-aware vertical sprite flip, distinct feet, and visibly attached antenna spring-rod.
6. Add parallax background.
7. Add HUD (level-complete banner, reduced-motion hint).
8. **Gate:** Game feel matches VVVVVV's minimal-but-satisfying aesthetic.

### Stage 7: All-Room Screenshots + Vision Review

1. Capture full 320×240 screenshots of all six rooms.
2. Capture a contact sheet (all six rooms in one image).
3. Capture paired floor-walking and ceiling-walking player poses.
4. **Gate:** Vision review confirms distinct room identities, readable hazards, no repeated silhouettes, feet contacting the active walking surface in both gravity directions, and an antenna visibly attached to the head.

### Stage 8: Verification

1. Run all static contracts (§11).
2. Run end-to-end route tests.
3. Grep for forbidden patterns.
4. **Gate:** All tests pass. No forbidden patterns found.

---

## 15. Anti-Failure Wording

**This build is NOT complete merely because six valid `LevelData` objects exist.** The previous implementation had six valid rooms and was still a failure because:

- **Room names cannot substitute for visual identity.** Calling a room "The Corridor" does not make it visually distinct from "The Vault." The ASCII grid and connected terrain motif must do that work.
- **One shared template is a failure.** If `buildRoomTiles` produces the same box for every room, the game has no visual variety. Every room must have a unique hand-authored ASCII grid.
- **One spike room is a failure.** Spikes must appear in at least 3 rooms with different patterns (alternating floor/ceiling in B, timing-based in C, complex routing in D).
- **A 16-step loop is a failure.** The music must be 256 steps / 16 bars / ~27 seconds with distinct sections. A 1.85-second loop is not a chiptune — it's a ringtone.
- **A screenshot only of room A is insufficient.** All six rooms must be screenshot-reviewed for distinct visual identity.
- **No enemies is a failure.** The shuttle enemy must appear in at least 3 rooms (C, D, E, F).
- **No checkpoints is a failure.** Death must respawn at the last checkpoint with preserved gravity, not at room spawn with gravity reset.
- **A head-first ceiling pose is a failure.** The complete body + face + feet sprite must turn upside down under negative gravity, with both feet contacting the ceiling. Keeping the sprite upright is not faithful to *VVVVVV*.
- **A detached antenna tip is a failure.** The rod must visibly connect the head to its tip in both gravity directions; a background-colored shaft that reads as a floating square does not satisfy the spring-rod requirement.
- **Static feet are a failure.** The feet must wag during walking via `drawSimpleFeet` driven by `advanceLocomotionByDisplacement`. Static 3×3 foot rectangles that never move, or a hand-rolled sin/cos oscillator in the renderer that bypasses the engine's locomotion API, do not satisfy the displacement-driven walking contract.

---

## 16. File Layout (Suggested)

```
src/
  main.ts              # boot: canvas, audio unlock, loop start
  game/
    state.ts           # FlipsideState, ControllerPair, palette, constants
    step.ts            # the fixed-step: input → controller → hazards → enemies → pickups → music
    render.ts          # parallax → tiles (connected terrain) → entities → enemies → player → particles → HUD
    rooms.ts           # ASCII literals + parser → LevelData for all six rooms
    player.ts          # input wiring (keyboard + touch → OR-merge → edges)
    tile-style.ts      # connected terrain renderer (neighbor bitmask, motifs, shade/mixHex)
    enemies.ts         # shuttle behavior handler + registry setup
    checkpoints.ts     # checkpoint activation + respawn logic
    collectibles.ts    # trinket: derivePickups → collect → writeSave
    npcs.ts            # crewmate render + rescue dialogue
  music.ts             # 256-step pattern construction + advanceSequencer + createNoteFirePlayer
  audio.ts             # createAudioAdapter + SFX recipes
  save.ts              # createLocalStorageSaveStorage + trinket key
  rooms/
    a.ts               # Room A ASCII literal
    b.ts               # Room B ASCII literal
    c.ts               # Room C ASCII literal
    d.ts               # Room D ASCII literal
    e.ts               # Room E ASCII literal
    f.ts               # Room F ASCII literal
```

---

## 17. Summary of Key Changes from Previous Brief

| Aspect | Previous (failed) | This brief |
|---|---|---|
| Room layout | 1D chain A-B-C-D-E-F | 2×3 nonlinear map with N/S/E/W transitions |
| Room grids | Shared `buildRoomTiles` box template | Unique hand-authored 40×30 ASCII literals per room |
| Tile rendering | Flat `outlineRect` per solid tile | Connected terrain with neighbor bitmask, 6 motifs, shade/mixHex |
| Enemies | None | Shuttle enemy via `createEnemyBehaviorRegistry` in 3+ rooms |
| Checkpoints | None (respawn at room spawn) | Gravity-aware checkpoints preserving gravitySign + facing |
| Trinket | Floor-path pickup in room E | Optional mastery challenge in room D |
| Music | 16-step / 1-bar / 1.85s loop | 256-step / 16-bar / ~27s with A→A'→B→A'' form |
| Visual review | Unit tests only | Screenshot contact sheet + vision review gate |
| Room identity | "Overworld", "Connector West", etc. | Unique motifs, palettes, and silhouettes per room |
| Resolution | 768×448 / tileSize 32 | 320×240 / tileSize 8 / pixelated upscale |

---

**Build order:** terrain prototype → ASCII room design → graybox mechanics → playtest → music → polish → all-room screenshots → verification.

**The game is not done when the code compiles. It is done when six visually distinct rooms are playable, the music loops for 27 seconds with recognizable form, and a human player can complete the A→B→C→F route in 5–8 minutes on their first try.**
