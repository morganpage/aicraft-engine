# World 1-1 — A Ten-Beat Horizontal Platformer Slice on `aicraft-engine@0.17.4`

> Paste this entire document to a coding agent (Claude / Cursor / etc.). It is a complete, self-contained build brief: concept, architecture, exact data contracts, beat-by-beat level design, implementation stages, acceptance gates, and anti-shortcut checks. The agent should produce a single runnable Vite + TypeScript browser game that imports everything from `aicraft-engine` (the npm package) and writes **no** re-implementations of what the engine already provides.

---

## 0. What You Are Building

**World 1-1** — a single horizontal-scrolling platformer slice that recreates the iconic feel of *Super Mario Bros.* World 1-1 as a Sokpop-outlineRect homage: a small chunky hero runs right, jumps over goombas and pipes, hits a `?`-block for a coin, defeats a koopa, climbs a flagpole at the end, and watches a 3-layer parallax background drift past. The feel target is **NES-Mario-meets-Sokpop**: variable-height jump, hit-stop on stomps, squash-and-stretch on launch/landing, screen shake, the 2-tone "ding-ding" coin ping. Rendering is procedural with no imported art; the level layout itself is deliberately hand-authored.

**This is NOT a tech demo.** It is a designed level broken into **ten distinct beats**, each capturing a specific moment from SMB 1-1's iconic progression: the first goomba, the first `?`-block cluster, the first pipe, the pipe-cluster patrol, the brick-and-coin sky row, the first pit gaps, the brick corridor, the pre-staircase koopa, the end staircase, and the flagpole. The previous version of this brief listed entity counts in a flat table — a level with the right counts can still feel flat if the beats don't capture SMB 1-1's rhythm of teach → challenge → reward. This brief fixes that by specifying every beat's column range, what it teaches, its unique silhouette, and its parallax emphasis.

**Non-negotiable: build the entire game on top of `aicraft-engine@0.17.4`.** Do not hand-roll fixed-step loops, AABB collision, cameras, jump arcs, level compilation, tile rendering, parallax, particle bursts, or audio synthesis. If you find yourself writing a `requestAnimationFrame` accumulator, a tile renderer, a `Math.random()` in the simulation, a gravity integrator, or a pixel-art Mario, stop and use the engine instead.

---

## 1. Tech Stack & Install

```bash
npm create vite@latest world-1-1 -- --template vanilla-ts
cd world-1-1
npm install aicraft-engine@0.17.4
```

> This brief targets the published `0.17.4` API exactly. It was originally written against `0.4.0` and repinned; **every API it names still exists and compiles at `0.17.0`** — the export surface has been additive across the intervening releases, so the hand-authored `LevelData` + `validateLevel` + `compileLevel` + `tileTypeMap` path this brief teaches is fully supported and is still the right choice for a fixed, designed level like 1-1. Two compatibility breaks to know: the replay physics version is now **14** (0.17.0 collision-snap semantics; older recorded replays are rejected), and a manually-constructed `PlatformerState` needs a `moments: []` field. Two things worth adopting while you build: the **feel channel** `state.moments` (`0.8.0`+) reports landing impact/hardness, so the landing squash and the stomp cue read a real impact ratio instead of a hand-rolled velocity threshold; and `0.14.1` fixed landings that arrive **exactly flush** with the ground (a full-height held jump's symmetric arc previously reported no landing at all — if you ever saw a missing landing puff, that was the bug, and it is gone engine-side). The camera brain (`0.5.0`+) now supersedes the `createCamera`/`updateCamera` pair this brief uses; both remain supported, and the legacy follow camera is the correct, simpler fit for a single-screen-tall horizontal scroller.

- **TypeScript**, strict. Target ES2021, `moduleResolution: bundler` (matches the engine; Vite resolves its ESM).
- **Vite** dev server + build. Single `<canvas>` in `index.html`.
- **`aicraft-engine@0.17.4`** is your only runtime dependency. Import **only** from the root barrel:
    ```ts
    import {
      // primitives — color, math, canvas, hit-stop, glow, parallax, bitmap text
      outlineRect, lerp, clamp, floor, mixHex, parseHex, toHex,
      resizeCanvasToBackingStore, prefersReducedMotion, getDevicePixelRatio,
      createHitStop, triggerHitStop, stepHitStop, isHitStopActive, DEFAULT_HIT_STOP_DURATION,
      drawGlow, DEFAULT_GLOW_INTENSITY,
      drawTiledParallax, PARALLAX_FAR, PARALLAX_MID, PARALLAX_NEAR,
      createFont, addGlyph, measureText, drawText, drawTextOutlined, DEFAULT_FONT,
      // rng
      mulberry32, nextInt, nextFloat, pick,
      // particles — bursts + continuous emitters
      spawn, advance, cull, step, sampleConeVelocity, sampleRegion,
      createEmitter, stepEmitters, advanceEmission,
      DEFAULT_GRAVITY_SCALE, DEFAULT_DRAG_SCALE, DEFAULT_RATE_SCALE,
      // animation — squash/stretch, locomotion, foot-plant, springs, IK
      volumeScale, breathe, DEFAULT_BREATH,
      advanceLocomotion, evaluateLocomotion, advanceLocomotionByDisplacement,
      blendAirborneTuck, DEFAULT_GAIT, DEFAULT_TUCK,
      drawSimpleFeet, DEFAULT_SIMPLE_FEET,
      createFootPlantState, advanceFootPlant,
      solveLimb, sineShake, shakeEnvelope,
      createSpringRod, advanceSpringRod, DEFAULT_SPRING_ROD,
      // collision — enemy/hero AABB only (tile work handled by platformer kernel)
      aabbOverlap, worldToTile, tileToWorld, tileRect, type TileSolidityQuery,
      // camera
      createCamera, updateCamera, DEFAULT_CAMERA,
      // input
      createKeyboardAdapter, createTouchButton, createTouchButtonSet, createGamepadAdapter,
      createEdgeAccumulator, pressEdge, releaseEdge, pollEdge, orEdges,
      // game-loop + state FSM
      createGameLoop, DEFAULT_FIXED_DT,
      createGameState, reduceGameState, isLegalTransition, DEFAULT_GAME_STATE_ADJACENCY,
      // audio
      createAudioAdapter, DEFAULT_AUDIO_VOLUME,
      // palette (stretch)
      generatePalette, resolvePalette, repairContrast,
      // easing
      easeOutCubic, easeOutBack, easeOutBounce, powOut, createTweenState, advanceTween,
      // ★ THE BIG ONE — platformer kernel + level runtime + renderers + enemies
      createPlatformerController, createPlatformerState, stepPlatformer, CLASSIC_PLATFORMER,
      jumpAbility, doubleJumpAbility,
      compileLevel, advanceMovingPlatform, movingPlatformToSolid,
      createMovingPlatformDisplacementProvider,
      drawActor, drawTileGrid, drawLevelEntity, DEFAULT_ENTITY_PALETTE,
      createEnemyBehaviorRegistry, spinnyBehavior,
      compileEnemies, stepEnemies,
      type EnemyBehaviorHandler, type EnemyStepResult,
      type CompiledEnemy, type EnemyUpdateContext, type EnemyState,
      // level schema
      migrateLevel, validateLevel, canonicalize, fnv1a,
      type LevelData, type LevelEntity, type TileGrid, type EntityKind,
      // coins/pickups — pure progression ops
      collect, hasCollected, derivePickups, DEFAULT_COLLECTIBLE_RECT, DEFAULT_COLLECTIBLE_VALUE,
      type CollectibleSave,
      // save
      createLocalStorageSaveStorage, createMemorySaveStorage, loadSave, writeSave, DEFAULT_SAVE_KEY,
      // cosmetics + iap (stretch)
      generateSkinVariants, grantSkin, equipSkin, unequipSkin,
      DEFAULT_SKIN_PRESET, DEFAULT_COSMETIC_SAVE, DEFAULT_MANIFEST,
      createMemoryIAPAdapter, createLocalStorageIAPAdapter, flushIAPEvents, DEFAULT_IAP_CATALOG,
    } from 'aicraft-engine';
    ```

  The published package exposes only the root `"."` entry. Never deep-import subpaths like `aicraft-engine/platformer`. Tree-shaking works because each module has its own barrel.

---

## 2. Determinism & Discipline Rules

These are enforced by the engine — follow them:

- **Fixed-step sim, variable render.** `createGameLoop({ fixedDt: 1/60, step, render })`; poll input **exactly once per `step`**.
- **No `Math.random()` in the simulation.** Use `mulberry32(seed)` → `nextInt` / `nextFloat` / `pick` for particle jitter, score-popup variance, foot-plant phase. `Math.random` is OK only for purely decorative audio/visual side-effects that never feed back into game state.
- **The level is hand-authored, NOT generated.** Every `?`-block, every brick, every goomba was placed by a human designer at a specific column. Using `mulberry32` to generate the level is a failure mode — it's a literal `LevelData` constant you type in `src/levels/world-1-1.ts`. The beats below give exact column ranges.
- **No `Date.now()` in the sim.** Time comes from `tick` or the loop's `dt`.
- **Defensive host access.** Anything touching `window` / `AudioContext` / `matchMedia` / `localStorage` goes through the engine's adapters (`createAudioAdapter`, `prefersReducedMotion`, `resizeCanvasToBackingStore`, `createLocalStorageSaveStorage`) — they're lazy, error-swallowing, no-op in Node.
- **Reduced-motion gate.** If `prefersReducedMotion()` is true, render one static frame and create no audio adapter or game loop.
- **Pure progression ops.** `collect` / `loadSave` return brand-new state objects; never mutate the player, level, or save in place.

---

## 3. Architecture — Engine Module → Game System Map

| Game system | Engine API | Notes |
|---|---|---|
| Game loop (60 Hz fixed) | `createGameLoop`, `DEFAULT_FIXED_DT` | |
| FSM (`menu → playing → gameover` / `levelComplete`) | `createGameState`, `reduceGameState`, `isLegalTransition` | |
| Input (keyboard + touch + gamepad) | `createKeyboardAdapter`, `createTouchButtonSet`, `createGamepadAdapter`, `orEdges` | |
| Hero controller (Mario feel) | `createPlatformerController`, `createPlatformerState`, `stepPlatformer(state, input, solids, dt, CLASSIC_PLATFORMER)`. `CLASSIC_PLATFORMER` is the **config** (5th arg — gravity/moveSpeed/abilities); the engine always runs its built-in `defaultPrecisionPipeline()` internally, so the two are NOT swap-out alternatives. | |
| Hero jump (no double-jump in `CLASSIC_PLATFORMER`) | `stepPlatformer`, `CLASSIC_PLATFORMER` | |
| Level compile (`LevelData` → `CompiledLevel`) | `compileLevel`; consume `compiled.tileQuery` | |
| Moving platforms (optional cloud lifts) | `advanceMovingPlatform`, `movingPlatformToSolid` | |
| Hero squash/stretch + breathing + walk cycle + footstep audio | `volumeScale`, `breathe`, `DEFAULT_BREATH`; `evaluateLocomotion`, `DEFAULT_GAIT`; `createFootPlantState`, `advanceFootPlant` | |
| Hero legs | `drawSimpleFeet`, `DEFAULT_SIMPLE_FEET` | |
| Hero cap/hair (stretch) | `createSpringRod`, `advanceSpringRod`, `DEFAULT_SPRING_ROD` (NEVER raw `advanceSpringChain`) | |
| Camera (horizontal follow + snap-to-target) | `createCamera`, `updateCamera`, `DEFAULT_CAMERA` | |
| Tile + entity rendering | `drawTileGrid`, `drawLevelEntity`, `drawActor`, `DEFAULT_ENTITY_PALETTE` (do NOT hand-draw tiles) | |
| Coin pickup + persistence | `derivePickups`, `collect`, `hasCollected` + `createLocalStorageSaveStorage`, `loadSave`, `writeSave` | |
| Goomba + koopa enemies | `compileEnemies(level)` → `stepEnemies(enemies, registry, context)` with custom `EnemyBehaviorHandler` objects; `spinnyBehavior` is NOT suited for grounded enemies | |
| Particles (coin burst, stomp dust, brick shatter, flag confetti) | `spawn`, `advance`, `step`, `sampleConeVelocity` | |
| Continuous emitters | `createEmitter`, `stepEmitters`, `advanceEmission` | |
| Parallax 3-layer sky | `drawTiledParallax`, `PARALLAX_FAR`, `PARALLAX_MID`, `PARALLAX_NEAR` | Three mono layers |
| Glow (coins / `?`-block flash / flagpole top) | `drawGlow`, `DEFAULT_GLOW_INTENSITY` | |
| Hit-stop on stomp | `createHitStop`, `triggerHitStop`, `stepHitStop`, `isHitStopActive` | |
| Screen shake | `sineShake`, `shakeEnvelope` | |
| Chunky vector rendering | `outlineRect` | |
| HUD bitmap text + Retina canvas + reduced-motion gate | `createFont`, `drawText`; `resizeCanvasToBackingStore`, `prefersReducedMotion` | |
| Synthesized SFX | `createAudioAdapter` (`playTone`, `playNoise`) | |
| Level validation + share-code serialisation + per-zone palette + colour-variant skins (mostly stretch) | `validateLevel`, `migrateLevel`, `canonicalize`, `fnv1a`; `generatePalette`, `resolvePalette`; `generateSkinVariants`, `grantSkin`, `equipSkin`, `DEFAULT_SKIN_PRESET` | |

---

## 4. The Hero

The hero is a **small round Sokpop-outlineRect chunk** — NOT pixel-art Mario. The visual genre-cue is "what if Mario was Sokpop". An homage, not a brand-exact copy.

- **Body:** positive `volumeScale` offsets stretch vertically; negative offsets squash vertically. Use positive on jump launch and negative on landing.
- **Face:** two `outlineRect` eyes + a `drawText` mouth dot, looking in facing direction.
- **Legs:** advance locomotion with `state.core.vx * dt * state.core.facing`, then evaluate and draw the pose.
- **⚠ Facing mirror (MANDATORY — or you moonwalk):** locomotion foot offsets are LOCAL-space assuming horizontal mirror. Wrap body+feet+face in `ctx.scale(facing, 1)`:
    ```ts
    ctx.save(); ctx.translate(bodyCx, bodyBottomY); ctx.scale(facing, 1);
    drawSimpleFeet(ctx, pose, { ...DEFAULT_SIMPLE_FEET, color: palette.base, outline: palette.outline });
    outlineRect(ctx, -w/2, -h, w, h, palette.base, palette.outline);
    // ...eyes/face...  ctx.restore();
    ```
- **Controller:** assign the immutable return: `state = stepPlatformer(state, input, solids, dt, CLASSIC_PLATFORMER).state`, then drive feedback from `state.events`.
- **Variable-height jump:** accumulate key edges with `createEdgeAccumulator`, then pass the result of `pollEdge` in `PlatformerInput.jump`.
- **Footstep audio:** assign `plantState = plantResult.state` and read `plantResult.events` after `advanceFootPlant`.
- **Cap/hair (stretch):** optional `createSpringRod` strand anchored at body top, `restDirection` up-and-back. Use `advanceSpringRod` (NOT raw chain). Draw OUTSIDE the facing mirror.
- **Death:** enemy contact or pit fall sends the shipped FSM a `die` event; use consumer-owned animation state during `gameover`, then `retry` or `quit`.

---

## 5. The World — A Hand-Authored 200×14 Tile Slice

### 5.1 Logical Resolution & Canvas Spec

| Parameter | Value |
|---|---|
| Logical resolution | 320 × 224 |
| Grid | 200 × 14 tiles |
| Tile size | 16 px |
| Level world size | 3200 × 224 px (200 × 14 tiles) |
| CSS upscale | `image-rendering: pixelated` on the canvas, backing store at 320×224, CSS scales to viewport |
| Player body | ~12 × 16 px (¾ tile wide, 1 tile tall) |
| Visible columns at once | 20 (one screen width = 320 px / 16 px) |
| Level length in screen-widths | ~10 (3200 / 320) |

Canvas setup:
```ts
const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
canvas.style.imageRendering = 'pixelated';
const dpr = resizeCanvasToBackingStore(canvas, 320, 224);
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
```

**Camera scroll strategy.** The camera follows the hero horizontally only (vertical is locked — the level is 14 tiles tall = 224 px = exactly one screen height, so there is no vertical scroll). The camera clamps at both level edges: it never shows past column 0 on the left or past column 200 on the right. See §8 for the follow implementation.

### 5.2 Beat Topology — The Ten-Beat Map

The level is a single linear progression from left (spawn) to right (flagpole). Unlike Flipside's 2×3 room map, World 1-1 is 1D — but it is divided into **ten distinct beats**, each capturing a specific SMB 1-1 moment. No two beats share the same silhouette or teach the same lesson.

**Compact beat sequence:**

```
[1]──[2]──[3]──[4]──[5]──[6]──[7]──[8]──[9]──[10]
Open  ?-Blk Pipe  Pipe  Sky   Pit   Brick Koopa Stair Flag
Plain Clstr Clstr Clstr Row   Gaps  Hall        case  pole
1-22  22-32 32-44 44-58 58-78 78-95 95-130 130-160 160-180 180-200
```

**Side-view schematic (compressed; not to exact tile scale):**

```
         ┌────────┬────────┬────────┬────────┬────────┬────────┬────────┬────────┬────────┬────────┐
y=4      │        │ ? ? ? ?│        │        │        │        │      ? │        │        │    ║    │
y=5      │        │      []│        │        │[][][][]│        │        │    [][] │        │    ║    │
y=6      │        │        │        │        │ oooooo │        │  [][][]│    [][] │        │    ║    │
y=7      │   ●    │        │  ┃┃    │  ┃┃ ┃┃ │ oooooo │        │ ●    ● │    ▲   │        │    ║    │
y=8      │        │        │  ┃┃    │  ┃┃ ┃┃ │ oooooo │  ░░    │  [][][]│    [][] │  ▓▓    │    ║    │
y=9      │        │        │  ┃┃    │  ┃┃ ┃┃ │        │  ░░    │      ? │    [][] │  ▓▓▓   │    ║    │
y=10     │        │        │        │        │        │        │        │        │  ▓▓▓▓  │    ║    │
y=11     │        │        │        │        │        │        │        │        │        │    ║    │
y=12-13  │████████│████████│████████│██ ████ │████████│██  ████ │████████│████████│████████│████████│
         └────────┴────────┴────────┴────────┴────────┴────────┴────────┴────────┴────────┴────────┘
cols:      1-22     22-32    32-44    44-58    58-78    78-95    95-130   130-160  160-180  180-200
           Beat 1   Beat 2   Beat 3   Beat 4   Beat 5   Beat 6   Beat 7   Beat 8   Beat 9   Beat 10

Legend: █ ground  ┃┃ pipe  [] brick  ? ?-block  ● goomba  ▲ koopa  o coin  ░░ pit  ▓ staircase  ║ flagpole
```

### 5.3 Connected-Terrain Renderer (Consumer-Local)

This is the visual identity system. It lives in the game as `tile-style.ts` — NOT in the engine. The engine provides `drawTileGrid(ctx, tiles, drawTile)`, `drawLevelEntity(ctx, ent, { palette, drawOverride })`, and the `shade`/`mixHex` color helpers.

Two rendering tiers work together:

#### 5.3.1 Ground Tile Renderer (the TileGrid)

The `TileGrid` holds only ground tiles (value 1 = solid ground). The `drawTile` callback closes over the grid and applies the SMB-classic grass-top + dirt-body treatment via a neighbor bitmask.

**Neighbor bitmask.** For each ground tile, read N/E/S/W neighbors (safe reads — out-of-bounds = not solid):

```ts
function groundNeighborMask(grid: number[], cols: number, rows: number, tx: number, ty: number): number {
  let mask = 0;
  if (ty > 0 && grid[(ty - 1) * cols + tx] === 1) mask |= 1;  // N
  if (tx < cols - 1 && grid[ty * cols + tx + 1] === 1) mask |= 2;  // E
  if (ty < rows - 1 && grid[(ty + 1) * cols + tx] === 1) mask |= 4;  // S
  if (tx > 0 && grid[ty * cols + tx - 1] === 1) mask |= 8;  // W
  return mask;
}
```

**Render rules per ground tile:**

| Rule | What |
|---|---|
| Grass band | If N neighbor is empty (top exposed): draw a 4px bright-green grass-highlight band on the top edge |
| Dirt body | Fill the rest of the tile with warm-brown dirt |
| Pit-edge bevel | If N is empty AND (E or W is empty): draw a 2px darker bevel on the pit-facing side — the "broken edge" where the ground meets a pit |
| Outline | ONLY external edges — never outline internal borders between connected ground tiles |
| Highlight | Only exposed north edges (lighter dirt shade under the grass) |
| Shadow | Only exposed south and east edges (darker dirt shade) |

**Color derivation** (SMB overworld palette, Sokpop-tuned):

```ts
const groundGrass  = '#5fb84a';   // bright green grass top
const groundBody   = shade('#c87b3c', 0.7);  // warm brown dirt body
const groundShadow = shade('#c87b3c', 0.35); // darker brown for S/E edges
const groundEdge   = shade('#c87b3c', 0.15); // near-black brown outline (never '#000000')
```

#### 5.3.2 Entity Cluster Renderer (bricks, pipes, ?-blocks)

Bricks, pipes, and ?-blocks are `LevelEntity` objects with `kind: 'platform'`, rendered via `drawLevelEntity` with a `drawOverride` callback. Each entity type has a per-type style; adjacent same-type entities stitch visually into a continuous mass.

| Entity type | Visual treatment | Cluster stitching |
|---|---|---|
| **Brick** | 16×16 block with a 2px mortar cross pattern dividing it into 4 sub-bricks; warm orange-brown fill, darker mortar lines | Adjacent bricks in a horizontal row share mortar lines → reads as one continuous brick wall |
| **Pipe** | 2-tile-wide column: top row is the "helmet" (wider lip, 4px rim highlight), body rows are vertical ribbing (2px alternating shade bands); deep green fill | A 2-wide × N-tall pipe cluster renders as one continuous pipe with a single helmet top |
| **?`-block** | 16×16 block with rivet corners + centered `?` glyph (via `drawText`); golden-yellow fill, white rim. When bumped: flash yellow→white for 8 ticks | Standalone — each ?-block is its own visual unit; no stitching needed |

**Gate:** A four-style sample sheet (ground + brick + pipe + ?-block, each in a 64×64px swatch) must be produced and reviewed before level integration. No tile style is accepted based on unit tests alone.

### 5.4 Visual Identity per Beat — Parallax Emphasis

World 1-1's visual identity shifts subtly across the level. Early beats are open sky (the establishing shot). Mid beats introduce bush clusters and pipe silhouettes that crowd the mid-ground. Late beats crowd the upper screen with brick rows and the staircase silhouette. The parallax layers are not static — each beat has a dominant layer that reinforces its mood.

The three parallax layers (from §9): **FAR** = mountains (depth 0.25), **MID** = bushes (depth 0.5), **NEAR** = clouds (depth 1.0).

| Beat | Far (mountains) | Mid (bushes) | Near (clouds) | Dominant layer | Rationale |
|---|---|---|---|---|---|
| 1 — Open Plain | Dense, low horizon | Sparse | Sparse | **FAR** | Establishing shot; open-world feel; the horizon carries the composition |
| 2 — First ?-Block Cluster | Dense, low horizon | Sparse | 1–2 drift | **FAR** | Still open; focus is on the blocks in the foreground |
| 3 — First Pipe | Medium | First bush cluster emerges | Sparse | **FAR → MID** | Bushes appear alongside the first pipe; the world is getting populated |
| 4 — Pipe Cluster + Patrol | Medium | Dense (between pipes) | Sparse | **MID** | Bush density mirrors pipe density; the ground-level is busy |
| 5 — Brick & Coin Sky Row | Medium | Dense | Clouds at coin-row height | **MID + NEAR** | Clouds drift alongside the sky-row coins; the pickup is framed by sky |
| 6 — First Pit Gaps | Sparse (tense) | Sparse | Sparse | **FAR** | Minimal backdrop; the eye focuses on the pits and the jump arcs |
| 7 — Brick Corridor | Sparse | Medium | Dense (upper screen) | **NEAR** | Clouds crowd the upper screen near the elevated brick row; vertical density |
| 8 — Pre-Staircase Koopa | Sparse | Medium | Medium | **NEAR** | Maintain upper-screen density; the koopa is the focus |
| 9 — End Staircase | Sparse | Sparse | Medium | **NEAR** | The staircase silhouette dominates the foreground; clouds frame it |
| 10 — Flagpole | Open horizon | Sparse | Celebratory drift | **FAR + NEAR** | Open sky for the flag; clouds drift as a visual reward for completion |

### 5.5 Beat Breakdown — Detailed Specifications

Each beat is a vertical slice of SMB 1-1's iconic progression. The level is a single hand-authored `LevelData` constant in `src/levels/world-1-1.ts`: 200 columns × 14 rows at 16px, so `width: 3200`, `height: 224`, `tileSize: 16`. `TileGrid` indices are tile coordinates, but every `LevelEntity.rect` uses world-space pixels. Convert an authored column with `column * tileSize`.

Compile once at boot:

```ts
const validation = validateLevel(WORLD_1_1);
if (!validation.valid) throw new Error(validation.errors.map(e => e.message).join('\n'));
const compiled = compileLevel(WORLD_1_1, { tileTypeMap });
const tileQuery = compiled.tileQuery;
```

Pass this same captured `tileQuery` through `EnemyUpdateContext.tileQuery` when calling `stepEnemies`; do not classify the grid a second time.

Map the generated `Palette` into an `EntityPalette` by spreading `DEFAULT_ENTITY_PALETTE` and overriding semantic slots. Render terrain with `drawTileGrid(ctx, WORLD_1_1.tiles, drawTile)` and entities with `drawLevelEntity(ctx, ent, { palette: entityPalette, drawOverride })`.

---

#### Beat 1 — Open Plain / First Goomba (columns 1–22, x=16–352px)

- **What it captures:** The spawn. The first screen of SMB 1-1 — open sky, flat ground, and the very first goomba walking left toward the player. This is the "you are here" establishing shot.
- **Layout concept:** Flat ground runs the full width. No obstacles, no pits, no elevated platforms. The hero spawns at column 2 (x=32px) on the ground. A single goomba spawns at column 16 (x=256px), walking left toward the hero at ~40 px/s. The player's first instinct — run right — is immediately met with the first enemy. The beat teaches: run, then deal with a threat.
- **Entity placement:** 1 goomba (col 16). 0 ?-blocks, 0 bricks, 0 pipes, 0 coins.
- **Unique silhouette:** Wide-open flat ground under open sky. The only vertical element is the goomba's dome. The horizon line (parallax mountains) is unobstructed.
- **Camera/parallax emphasis:** **FAR-dominant.** Mountains on the horizon carry the composition. Bushes are sparse; clouds are sparse. This is the establishing shot — the world feels big and open.

#### Beat 2 — First ?-Block Cluster (columns 22–32, x=352–512px)

- **What it captures:** The iconic 4-block `?`-block row. In SMB 1-1 this introduces bumpable blocks: the first block has a coin, the fourth has the mushroom power-up. This beat is the first reward moment.
- **Layout concept:** Four `?`-blocks in a horizontal row at jump-height (y-row 4, so the block bottoms sit at y=64px — reachable by a running jump). A single brick sits at the row's right end (col 30). The blocks span columns 24–28 (x=384–448px). In canonical SMB 1-1, the fourth block hides the super-mushroom power-up — this slice **omits the power-up mechanic** (see §5.6 Scope Cuts); all four blocks yield coins instead. The beat teaches: jump and bump from below.
- **Entity placement:** 4 ?-blocks (cols 24, 25, 26, 27 — each yielding 1 coin on bump). 1 brick (col 30). 4 coins (from the ?-blocks). 0 goombas, 0 koopas, 0 pipes.
- **Unique silhouette:** A clean horizontal row of 4 golden ?-blocks floating at jump height against open sky. The first man-made structure in the level.
- **Camera/parallax emphasis:** **FAR-dominant** (continuing from Beat 1). The ?-blocks are the focus; the backdrop stays open and calm. 1–2 clouds drift in the NEAR layer as gentle motion.

#### Beat 3 — First Pipe (columns 32–44, x=512–704px)

- **What it captures:** The first pipe — a tall green obstacle that forces the player to jump over it. In SMB 1-1 this is the moment the player learns that not everything is flat; some terrain must be cleared vertically.
- **Layout concept:** A single 2-wide × 3-tall pipe at columns 36–37 (x=576–592px). The pipe top (helmet) sits at y-row 9 (y=144px); the body extends down to the ground. The pipe is too tall to walk around — the player must jump. Flat ground throughout.
- **Entity placement:** 1 pipe (cols 36–37, 3 tiles tall). 0 goombas, 0 koopas, 0 ?-blocks, 0 bricks, 0 coins.
- **Unique silhouette:** A single vertical green column breaking the flat horizon — the first true vertical silhouette in the level. The pipe helmet (wider lip) reads as a distinct shape against the sky.
- **Camera/parallax emphasis:** **FAR → MID transition.** This is where the first bush clusters emerge in the MID layer, appearing alongside the pipe. The world is getting populated; the backdrop gains depth.

#### Beat 4 — Pipe Cluster + Patrol (columns 44–58, x=704–928px)

- **What it captures:** Two pipes close together with a goomba patrol between them. In SMB 1-1 this escalates the pipe mechanic: now there are multiple pipes AND an enemy between them, forcing the player to time their jumps.
- **Layout concept:** Two 2-wide pipes: one at columns 47–48 (2 tiles tall) and one at columns 54–55 (3 tiles tall, taller than the first). Between them, a flat-ground corridor at columns 49–53. Two goombas spawn in this corridor at columns 50–51 (x=800–816px), patrolling. The player must jump the first pipe, deal with the goombas in the corridor, then jump the taller second pipe. The height difference between the two pipes (2 vs 3 tiles) subtly teaches that pipes vary.
- **Entity placement:** 2 pipes (cols 47–48 at 2-tall, cols 54–55 at 3-tall). 2 goombas (cols 50–51, patrolling). 0 ?-blocks, 0 bricks, 0 koopas, 0 coins.
- **Unique silhouette:** A "M" or "UU" shape — two green vertical columns with a ground-level gap between them. The taller second pipe creates an ascending rhythm.
- **Camera/parallax emphasis:** **MID-dominant.** Bush density increases between and around the pipes; the ground-level backdrop is busy. The bush clusters visually echo the pipe clusters.

#### Beat 5 — Brick & Coin Sky Row (columns 58–78, x=928–1248px)

- **What it captures:** The first reward cluster in the air — a row of bricks at jump height with a coin row floating above them. In SMB 1-1 this is the first multi-coin run, rewarding exploration of the vertical space.
- **Layout concept:** An elevated brick row at columns 62–65 (y-row 5, x=992–1040px) — 4 bricks in a horizontal line at jump height. Above them, a coin row at columns 62–67 (y-row 3, x=992–1072px) — 6 coins floating in the sky. The player must jump onto the brick row, then jump again to collect the sky coins. This is the first beat where the player is rewarded for jumping high — not just for avoiding hazards. Flat ground throughout.
- **Entity placement:** 4 bricks (cols 62–65, elevated at y-row 5). 6 coins (cols 62–67, floating at y-row 3). 0 goombas, 0 koopas, 0 ?-blocks, 0 pipes.
- **Unique silhouette:** A horizontal brick platform floating mid-screen with coins stacked above it — a reward "shelf" in the sky. The first beat where the upper half of the screen is populated.
- **Camera/parallax emphasis:** **MID + NEAR.** Clouds drift at coin-row height (NEAR layer), framing the sky-row pickup. The bushes (MID) remain dense from Beat 4. The composition is vertically layered — ground, brick shelf, coin row, clouds.

#### Beat 6 — First Pit Gaps (columns 78–95, x=1248–1520px)

- **What it captures:** The first true platforming challenge — two 2-tile pit gaps in the ground. In SMB 1-1 this is where falling means death. This beat raises the stakes: the ground is no longer safe everywhere.
- **Layout concept:** Two 2-tile-wide pit gaps in the ground row: one at columns 82–83 (x=1312–1328px) and one at columns 90–91 (x=1440–1456px). Between them, a 6-tile ground bridge at columns 84–89. Before the first pit (cols 78–81) and after the second pit (cols 92–95), the ground is solid — giving the player run-up room. The pits are 2 tiles wide, which is exactly jumpable at `CLASSIC_PLATFORMER` move speed with a running jump. This is the first beat where a mistimed jump = death = respawn (at the level start, since this slice has no mid-level checkpoint — see §5.6).
- **Entity placement:** 2 pit gaps (cols 82–83 and 90–91, each 2 tiles wide). 0 enemies, 0 blocks, 0 coins — the beat is pure platforming.
- **Unique silhouette:** The ground line breaks twice — two clean rectangular gaps in the floor. The broken-edge bevels (from §5.3.1) make the pit edges read as intentional cuts, not missing data.
- **Camera/parallax emphasis:** **FAR-dominant.** The backdrop pulls back to sparse — minimal mountains, sparse bushes, sparse clouds. The eye focuses on the pits and the jump arcs. Tension is reinforced by visual emptiness.

#### Beat 7 — Brick Corridor (columns 95–130, x=1520–2080px)

- **What it captures:** The longest beat — an elevated brick corridor with goombas walking on top and more ?-blocks below. In SMB 1-1 this is the densest section before the finale: the player navigates under, over, and through a complex structure with enemies on multiple levels.
- **Layout concept:** Two elevated brick rows: one at columns 100–103 (y-row 5, x=1600–1648px) and one at columns 110–113 (y-row 5, x=1760–1808px). Two goombas patrol on top of these brick rows (col 101 on the first, col 111 on the second). Below, at ground level, two ?-blocks at columns 106–107 (y-row 4, x=1696–1712px) — these are the second ?-block cluster, yielding coins. The player must jump onto the brick rows to stomp the goombas, then drop down to bump the ?-blocks. Flat ground throughout (no pits). This is the longest beat (35 columns) because it's the level's density peak.
- **Entity placement:** 4 bricks (cols 100–103 and 110–113, elevated). 2 goombas (cols 101 and 111, on top of the brick rows). 2 ?-blocks (cols 106–107, at ground-level jump height). 2 coins (from the ?-blocks). 0 koopas, 0 pipes.
- **Unique silhouette:** A multi-level structure — elevated brick platforms with enemies on top, ?-blocks floating below. The upper screen is crowded; the player's eye moves between levels.
- **Camera/parallax emphasis:** **NEAR-dominant.** Clouds crowd the upper screen (NEAR layer), reinforcing the vertical density. The brick rows + clouds fill the top half; the ground + ?-blocks fill the bottom half. The composition is the busiest in the level.

#### Beat 8 — Pre-Staircase Koopa (columns 130–160, x=2080–2560px)

- **What it captures:** The green Koopa Troopa on a brick platform — the first and only koopa in the level, and the first shell-kick opportunity. In SMB 1-1 this is the enemy escalation before the finale: goombas walk off ledges, but a koopa's shell slides and can kill other enemies.
- **Layout concept:** A brick platform at columns 135–136 (y-row 6, x=2160–2176px) — 2 bricks elevated at mid-height. A single green koopa spawns at column 140 (x=2240px), patrolling on the ground just past the platform. The player encounters the brick platform first (a minor jump), then meets the koopa on flat ground. Stomping the koopa puts it in shell mode; kicking the shell sends it sliding right toward the staircase. The beat teaches: koopas have a two-phase defeat (stomp → shell → kick).
- **Entity placement:** 2 bricks (cols 135–136, elevated at y-row 6). 1 koopa (col 140, green, patrolling). 0 goombas, 0 ?-blocks, 0 pipes, 0 coins.
- **Unique silhouette:** A small brick step followed by a flat run with a distinct green enemy shape (the koopa's shell + head silhouette is visually unique vs the goomba's dome).
- **Camera/parallax emphasis:** **NEAR-dominant** (continuing from Beat 7). Clouds maintain upper-screen density. The koopa's green shell is the focal point against the backdrop.

#### Beat 9 — End Staircase (columns 160–180, x=2560–2880px)

- **What it captures:** The iconic 4-step pyramid staircase. In SMB 1-1 this is the final climb before the flag — a purely geometric ascent that signals "the end is near."
- **Layout concept:** A 4-step pyramid built from bricks/ground blocks: step 1 at column 162 (1 tile tall), step 2 at column 163 (2 tiles tall), step 3 at column 164 (3 tiles tall), step 4 at column 165 (4 tiles tall). The player runs right and up the staircase in a single fluid motion. After the staircase (cols 166–180), flat ground runs to the flagpole. No enemies, no pits — the staircase is a victory lap silhouette.
- **Entity placement:** 4 staircase steps (cols 162–165, heights 1/2/3/4 tiles, rendered as solid ground or brick blocks). 0 enemies, 0 ?-blocks, 0 pipes, 0 coins.
- **Unique silhouette:** A clean ascending staircase — four rectangular steps rising from left to right. The most geometric silhouette in the level; instantly recognizable as "the end is near."
- **Camera/parallax emphasis:** **NEAR-dominant.** Clouds frame the staircase silhouette. The FAR layer pulls back (sparse mountains) so the staircase reads against open sky.

#### Beat 10 — Flagpole (columns 180–200, x=2880–3200px)

- **What it captures:** The flagpole — the finish line. In SMB 1-1 this is the descent: grab the pole, slide down, walk to the castle. The level is complete.
- **Layout concept:** A flagpole entity (`kind: 'exit'`) at column 192 (x=3072px), extending from near the top of the screen (y-row 1) down to the ground (y-row 12). Flat ground from the staircase base (col 166) through the flagpole (col 192) to the level end (col 200). When the hero's rect overlaps the flagpole, the FSM transitions to `'levelComplete'`. A small ground area past the flagpole (cols 193–200) gives the hero room to "walk into the castle" during the level-complete animation. No enemies, no pits.
- **Entity placement:** 1 flagpole (col 192, `kind: 'exit'`). 0 enemies, 0 blocks, 0 pipes, 0 coins.
- **Unique silhouette:** A single tall vertical pole against open sky — the opposite of Beat 1's open plain. The level ends as it began: one vertical element in a horizontal field, but now it's a flag, not a goomba.
- **Camera/parallax emphasis:** **FAR + NEAR.** Open horizon (FAR returns to full density) for the flag against the sky; celebratory cloud drift (NEAR) as a visual reward. The composition mirrors Beat 1's establishing shot, but resolved — the world is no longer empty.

### 5.6 Scope Cuts — The Underground Omission

**Canonical SMB 1-1 contains an underground transition** — a warp pipe (around column 60 in the original) takes the player to a coin-rich bonus room (World 1-2's underground tileset), then a second pipe returns them to the surface past the pipe cluster. This slice **deliberately omits the underground transition** for three reasons:

1. **Scope.** The underground room is effectively a second `LevelData` — a separate tile grid, a separate palette (dark blue + green), and a transition system (pipe-enter → room-load → pipe-exit). Including it roughly doubles the level-design surface area.
2. **Horizontal-flow integrity.** The underground transition breaks the single-screen horizontal scroll that defines this slice's feel. The camera would need to teleport, the parallax would need to reset, and the "run right" verb would be interrupted.
3. **Beat redundancy.** Beat 6 (First Pit Gaps) already occupies the canonical underground-pipe's column range and delivers the same difficulty escalation (first death-risk platforming). Adding the underground room on top of Beat 6 would crowd the mid-level pacing.

**What this means for the build:** Beat 6 has pit gaps but NO warp pipe. The player never leaves the overworld tileset. The pipe cluster in Beat 4 (3 pipes total in the level) is the complete pipe content. Do not add a warp pipe, do not build an underground room, do not implement a tileset swap. If a future expansion adds World 1-2 (underground) as a separate level, it will be a new `LevelData` constant, not a transition within this one.

---

## 6. Enemies

Two archetypes. Both drawn with `outlineRect` and stepped via the platformer module's enemy pipeline.

### Goomba

- **Body:** `outlineRect` dome (two calls — body + head-bump). Warm-brown fill, two white eyes with dark pupils. Mushroom-shaped.
- **Behaviour:** patrol left at about `40 px/s` (2.5 tiles/s at a 16px tile size). Store velocity in px/s; convert any designer-authored tiles/s value by multiplying by `tileSize`. Reverse on wall/ledge probes. A non-stomp collision sends `{ type: 'die' }` to the FSM.
- **Stomp hit:** `triggerHitStop(hitStop, 4 ticks)`; `spawn` particle burst puffs; `audio.playNoise(60, 'lowpass', 250, 0.18)`; floating "+100" via `drawText`.
- **Placement:** 5 total — Beat 1 (1), Beat 4 (2), Beat 7 (2). See §5.5.

### Koopa

- **Body:** `outlineRect` shell (~18×22). Distinctive palette (green shell + cream underbelly + orange head peek). **Use `solveLimb`** for two 2-segment IK legs underneath — this is what `solveLimb` is for; don't fake stride with a single draw.
- **Behaviour:** same wall/ledge patrol. Shell contact sends `{ type: 'die' }` to the FSM; shell mode remains consumer-owned enemy state.
- **Stomp:** same hit-stop, louder `playNoise(80, 'lowpass', 300, 0.25)`. Score +200 first-stomp, +400 shell-kick. Shell slides in the last-stomp direction and can kill goombas.
- **Placement:** 1 total — Beat 8 (1). See §5.5.

### Wiring

`createEnemyBehaviorRegistry()` registers `EnemyBehaviorHandler` objects, not bare functions. Define one object per archetype with a `step(state, context, params): EnemyStepResult` method, then pass those objects in the registry's custom-handler map. `spinnyBehavior` is **NOT applicable** — these are grounded, finite-state enemies. Drive patrol with `advanceLocomotionByDisplacement` (feet lock when stopping); wall/ledge probes via `tileRect`/`worldToTile`. Compile level enemies with `compileEnemies(level)` and pass the resulting state through `stepEnemies` each fixed tick.

---

## 7. Coins & Collectibles

Use the engine's first-class `'collectible'` entity kind + the pure-progression `collect` / `hasCollected` ops. Per-level scoping is consumer-owned: a `Record<levelId, CollectibleSave>` keyed on the level's `fnv1a` hash.

```ts
interface WorldSave {
  readonly collectiblesByLevel: Record<string, CollectibleSave>;
  readonly score: number;
}

const DEFAULT_WORLD_SAVE: WorldSave = { collectiblesByLevel: {}, score: 0 };
const storage = createLocalStorageSaveStorage('world-1-1-save');
let save = loadSave(storage, DEFAULT_WORLD_SAVE);
const levelId = String(fnv1a(canonicalize(WORLD_1_1)));

// each fixed step — kernel unaware of collectibles; derive from AABB
const levelSave = save.collectiblesByLevel[levelId] ?? { collected: [] };
const pickups = derivePickups(playerRect, collectibleEntities, levelSave);
for (const id of pickups.collected) {
  const nextCollectibles = collect(
    save.collectiblesByLevel[levelId] ?? levelSave,
    String(id),
  );
  save = {
    ...save,
    score: save.score + 200,
    collectiblesByLevel: {
      ...save.collectiblesByLevel,
      [levelId]: nextCollectibles,
    },
  };
  audio.playTone('triangle', 600, 1200, 90, 0.18);          // 2-tone ding-ding
  scoreTexts = [
    ...scoreTexts,
    { text: '+200', entityId: id, tween: createTweenState() },
  ];
}
writeSave(storage, save);
```

Floating "+200" via `drawText`/`drawTextOutlined`, animated by `createTweenState` driving `easeOutCubic` upward float + `easeOutBack` scale-in.

Coins come from two sources: floating coin entities (Beat 5's sky row — 6 coins) and ?-block bumps (Beat 2's 4 blocks + Beat 7's 2 blocks = 6 coin-yielding bumps). The ?-block coins are spawned as ephemeral collectibles on bump, not pre-placed in the level data.

---

## 8. Camera

Horizontal-only follow with a soft right-leader (Mario runs right → camera centers slightly *left* of hero so the leading edge has more screen space). Use **`createCamera`** + **`updateCamera`** with built-in snap-to-target — the engine does the snap; do NOT hand-roll a `Math.abs(diff) < 0.1` early-exit.

```ts
let camera = createCamera();
// each render — shake amplitude decays via shakeEnvelope over ~10 ticks
const targetX = hero.x + (hero.facing === 1 ? lookaheadX : -lookaheadX * 0.5);
camera = updateCamera(
  camera,
  { x: targetX, y: hero.y, width: hero.width, height: hero.height },
  { width: levelWidthPx, height: levelHeightPx },
  { width: CANVAS_W, height: CANVAS_H },
  { ...DEFAULT_CAMERA, lerp: 0.18, snapThreshold: 0.5 },
);
ctx.save();
const shake = sineShake(tick, 4, 30 / 60, 23 / 60); // cycles per fixed tick
ctx.translate(-camera.x + shake.x, -camera.y + shake.y);
// ... draw scene ...
ctx.restore();
```

The camera clamps at both level edges (`updateCamera` handles this via the level-bounds parameter). The vertical is locked — the level is exactly one screen tall (224px), so `camera.y` stays at 0.

---

## 9. Parallax Background

Three layers at the engine's exported depth constants `PARALLAX_FAR` / `PARALLAX_MID` / `PARALLAX_NEAR` (0.25 / 0.5 / 1.0). All three via **`drawTiledParallax`**. Pre-render each tile once at boot with `outlineRect`/`drawGlow` and a per-layer palette, then tile horizontally forever:

- **Far (mountains):** jagged horizon. Palette: lavender → deep purple → near-black.
- **Mid (bushes):** soft humps on ground row. Palette: green → forest green. Repeats ~96 px.
- **Near (clouds):** puffy white `outlineRect` blobs + subtle `drawGlow`. Palette: white → soft cyan. Floats at ~30% sky height.

```ts
// boot — offscreen canvas per layer
const farTile  = makeMountainTile(128, 64, farPalette);
const midTile  = makeBushTile(96, 32, midPalette);
const nearTile = makeCloudTile(80, 40, nearPalette);

// each render — engine handles offset math
drawTiledParallax(ctx, (c, x) => c.drawImage(farTile, x, 0), camera.x, PARALLAX_FAR, 128, CANVAS_W);
drawTiledParallax(ctx, (c, x) => c.drawImage(midTile, x, 0), camera.x, PARALLAX_MID, 96, CANVAS_W);
drawTiledParallax(ctx, (c, x) => c.drawImage(nearTile, x, skyYCloud), camera.x, PARALLAX_NEAR, 80, CANVAS_W);
```

Row `yTop`s are tuning choices — commit as constants in `src/parallax.ts`. The per-beat parallax emphasis table in §5.4 guides which layer's density to tune per beat region; the actual density modulation is consumer-owned (you may vary the tile-repeat frequency or sprite count based on `camera.x` falling within a beat's column range).

---

## 10. Game Feel Checklist (the juice — every item uses the engine)

- [ ] Launch stretch + landing squash via `volumeScale` (events from `stepPlatformer`)
- [ ] Hit-stop on stomp: `triggerHitStop` 4–6 ticks; `isHitStopActive` gates audio
- [ ] Screen shake (`sineShake` + `shakeEnvelope`, decaying) on stomp / flag-catch
- [ ] Phase-synced footstep taps (`advanceFootPlant` → `playNoise` per planted event)
- [ ] Coin ding-ding on every `?`-bump and float pickup (`playTone('triangle', 600, 1200, …)`)
- [ ] Bumpable block flash (`?`-block yellow→white for 8 ticks when hit)
- [ ] Brick-shatter particle burst (`spawn` + `step` + `cull`)
- [ ] Coyote time + jump-buffer built into `CLASSIC_PLATFORMER` (don't hand-roll)
- [ ] Optional hero cap/hair strand via `advanceSpringRod`
- [ ] Reduced-motion gate (`prefersReducedMotion`) renders one static frame

---

## 11. Audio (all synthesized via `createAudioAdapter`)

Unlock on first user gesture (one-shot `keydown`/`pointerdown` calling `audio.unlock()`). Then:

- **Coin (the classic 2-tone ding-ding):** `playTone('triangle', 600, 1200, 90, 0.18)` — single oscillator, frequency-glide 600 → 1200 Hz. The triangle + upward glide IS the SMB coin signature.
- **Jump (small):** `playTone('square', 320, 640, 60, 0.12)` — quick blip.
- **Jump (big):** `playTone('square', 200, 800, 80, 0.18)` — wider sweep.
- **Stomp (goomba):** `playNoise(60, 'lowpass', 250, 0.18)`.
- **Stomp (koopa, harder):** `playNoise(80, 'lowpass', 300, 0.25)`.
- **Brick shatter:** `playNoise(100, 'lowpass', 400, 0.30)` — harsh "krsh".
- **Power-up / 1-up:** `playTone('square', 400, 800, 200, 0.20)` — rising fanfare. (Stretch.)
- **Death (the falling-down-stairs):** three descending tones — `'square' 600→120`, then `480→96`, then `360→72`, 200ms / 0.20 each. Unmistakable SMB death jingle.
- **Flag-catch end-of-level:** `playTone('triangle', 480, 960, 800, 0.18)` — sustained rising warp.
- **Footsteps:** `playNoise(40, 'lowpass', 200, 0.10)` per `advanceFootPlant` event.

No imported audio files; all above is `createAudioAdapter` + `playTone`/`playNoise`.

---

## 12. File Layout (Suggested)

```
src/
  main.ts                       # boot: canvas, save load, level compile, loop.start()
  game/
    state.ts                    # World, HeroEntity, EnemyEntity, Particle[] types
    step.ts                     # fixed-step: input → platformer.step → enemies → pickups → audio → camera
    render.ts                   # pure draw: parallax, tiles, entities, FX, HUD
    parallax.ts                 # 3 pre-rendered tile factories (mountain / bush / cloud)
    tile-style.ts               # connected-terrain renderer (ground neighbor bitmask, entity cluster styles)
    sfx.ts                      # one fn per sound
    skin.ts                     # hero palette resolution (DEFAULT_SKIN_PRESET → fill/outline/accent)
  level/
    world-1-1.ts                # THE hand-authored LevelData constant — every block placed by a human
    compile.ts                  # validateLevel → migrateLevel → compileLevel; expose compiled.tileQuery
  input.ts                      # createKeyboardAdapter + createTouchButtonSet + orEdges
  audio.ts                      # createAudioAdapter + SFX preset helpers
  save.ts                       # createLocalStorageSaveStorage + loadSave/writeSave wrapper
  particles.ts                  # spark/debris particle sets keyed by event type
```

---

## 13. Visual & Play Gates

### 13.1 Screenshot Requirements

Before the level is accepted as complete:

1. **One screenshot per beat (10 total)** — each captured at the beat's canonical camera position, showing the beat's defining feature (the goomba in Beat 1, the ?-block row in Beat 2, the pipe in Beat 3, etc.).
2. **Full-level contact sheet** — a single image showing all 10 beats side by side (or a 2×5 grid), proving visual variety across the level.
3. **Full-level scroll-through** — a continuous screen-recording (or animated GIF) of the camera scrolling from spawn (col 2) to flagpole (col 192), showing the parallax drift and beat transitions.
4. **Four-style tile sample sheet** — one 64×64px swatch each of ground, brick, pipe, and ?-block rendering (from §5.3). Must be reviewed before level integration.
5. **No beat accepted based only on unit tests.** Structural tests prove data correctness, not visual quality or feel.

### 13.2 Playthrough Requirements

- **Complete spawn-to-flagpole playthrough** — the level must be completable from column 2 to column 192 in a single continuous run.
- **Target clear time:** 60–90 seconds for a first-time player who knows platformers but not this level. SMB 1-1's world-record speedrun is ~19 seconds; a first-time blind clear is typically 60–120 seconds. This slice should land in that range.
- **What the player should feel at each beat:**
  - Beat 1: "I can move. Oh — something is walking toward me."
  - Beat 2: "I can jump and hit blocks. Coins!"
  - Beat 3: "I have to jump OVER this pipe."
  - Beat 4: "Two pipes and enemies between them — I need to time this."
  - Beat 5: "There are coins in the sky. I want them."
  - Beat 6: "The ground has holes. I can die here."
  - Beat 7: "This section is busy — enemies on top, blocks below."
  - Beat 8: "This enemy is different — it has a shell."
  - Beat 9: "Stairs. The end must be close."
  - Beat 10: "The flag! I did it."
- **Expected deaths:** 2–6 on a first blind playthrough (the pit gaps in Beat 6 and the goomba patrols in Beat 4/7 are the likely culprits).
- **Fast retry:** death respawns at the level start (column 2) in <1 second.

### 13.3 Rejection Criteria

The following are grounds for rejecting the build:

- **Flat featureless level** — no visual or mechanical variety across the 200 columns. If every screen looks like Beat 1, the build is rejected.
- **No clear progression** — the beats don't escalate (no pits after Beat 6, no staircase before the flag, no koopa before the end).
- **?`-blocks not bumpable** — hitting a ?-block from below must yield a coin + the ding-ding sound + the flash. Inert ?-blocks are a failure.
- **Brick row that doesn't shatter** — bumping a breakable brick from below must produce a shatter particle burst + the "krsh" noise + score. Solid-on-bump bricks are a failure.
- **Koopa that doesn't enter shell mode** — stomping the koopa must produce a shell that can be kicked. A koopa that dies in one stomp like a goomba is a failure.
- **Flagpole that doesn't trigger** — touching the flagpole must transition the FSM to `'levelComplete'`. An inert flagpole is a failure.
- **Screenshot only of Beat 1** — must show all 10 beats. The open plain is the least visually interesting beat; it cannot stand in for the level.
- **No parallax depth** — all three layers must scroll at distinct speeds. A static background or a single-layer background is a failure.

---

## 14. Tests & Static Contracts

### 14.1 Level Schema

- `WORLD_1_1` passes `validateLevel(level).valid === true` (diagnostics surfaced from `.errors`).
- The grid is exactly 200 × 14.
- The level has exactly one player spawn (column 2).
- The level has exactly one flagpole (`kind: 'exit'`) at column ~192.
- `fnv1a(canonicalize(WORLD_1_1))` is stable across runs (deterministic hash).

### 14.2 Beat Content Counts

Every beat must contain its specified entities. Test by partitioning the level's entity list and tile inspection by column range:

| Beat | Columns | Goombas | Koopas | ?-blocks | Bricks | Pipes | Coins | Pits |
|---|---|---|---|---|---|---|---|---|
| 1 — Open Plain | 1–22 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2 — First ?-Block Cluster | 22–32 | 0 | 0 | 4 | 1 | 0 | 4 | 0 |
| 3 — First Pipe | 32–44 | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| 4 — Pipe Cluster + Patrol | 44–58 | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| 5 — Brick & Coin Sky Row | 58–78 | 0 | 0 | 0 | 4 | 0 | 6 | 0 |
| 6 — First Pit Gaps | 78–95 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| 7 — Brick Corridor | 95–130 | 2 | 0 | 2 | 4 | 0 | 2 | 0 |
| 8 — Pre-Staircase Koopa | 130–160 | 0 | 1 | 0 | 2 | 0 | 0 | 0 |
| 9 — End Staircase | 160–180 | 0 | 0 | 0 | 4 | 0 | 0 | 0 |
| 10 — Flagpole | 180–200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **TOTAL** | **1–200** | **5** | **1** | **6** | **15** | **3** | **12** | **2** |

**Minimum content gates (must all pass):**
- `?`-blocks ≥ 4 (canonical SMB 1-1 has ~7; 6 is the floor for this slice)
- Bricks ≥ 8 (canonical SMB 1-1 has ~30; 15 is the floor for this slice)
- Pipes ≥ 2 (3 in this design — 1 lone + 2 clustered)
- Goombas ≥ 3 (5 in this design — distributed across Beats 1, 4, 7)
- Koopas = 1 (exactly one, in Beat 8)
- Coins ≥ 10 (12 in this design — 6 sky-row + 6 from ?-blocks)
- Flagpole = 1 (at column ~192)
- Pit gaps = 2 (exactly two 2-tile pits, both in Beat 6)

### 14.3 Level Hash Determinism

- Compute `fnv1a(canonicalize(WORLD_1_1.tiles.data))`.
- The hash must be stable across runs (same constant → same hash forever).
- The hash is used as the `levelId` key for collectible persistence (§7).

### 14.4 Simulation Determinism

- Run 3600 ticks (60 seconds at 60 Hz) of `stepGame` with fixed scripted inputs (hold-right + periodic jump). Record the hero's final `{x, y, vx, vy}`.
- Re-run with the same inputs. Final state must be byte-identical.
- Record the hero's x-position every 60 ticks (once per simulated second). The position sequence must be byte-identical across runs.

### 14.5 Enemy Determinism

- Step each goomba and the koopa for 600 ticks with `dt = 1/60`. Record positions.
- Re-run with same params. Positions must be byte-identical.
- Goombas must reverse exactly at wall/ledge probes.
- The koopa must enter shell mode on stomp and slide at a fixed velocity in the stomp direction.

### 14.6 Collectible Persistence

- Collect a coin → `hasCollected(save, coinId)` returns true.
- Reload the page → the coin stays collected (verified via `createLocalStorageSaveStorage` round-trip in a test harness, or `createMemorySaveStorage` for headless).
- Total score persists in the same save blob.
- Uncollected coins remain pick-up-able.

### 14.7 Forbidden Patterns

Static analysis (grep / AST) must find:

- **No `requestAnimationFrame`** in game code (only in the engine's `createGameLoop`).
- **No `Math.random`** in game code.
- **No `Date.now`** in game code.
- **No manual gravity integration** (no `vy += gravity * dt` outside the engine).
- **No `stepPlatformer` called without `CLASSIC_PLATFORMER`** as the 5th arg.
- **No deep imports** (no `aicraft-engine/src/...` — only root barrel).
- **No hand-drawn tiles** (tile rendering must go through `drawTileGrid` with a `drawTile` callback, not per-tile `outlineRect` calls in the render loop).
- **No pixel-art Mario** — the hero is `outlineRect` shapes, not a sprite.

### 14.8 No Moonwalk

- Walking left faces left on hero and every locomotion-driven enemy.
- Verified by: run the hero left for 60 ticks; capture a frame; the hero's eyes/face must face left.
- Enforced by `ctx.scale(facing, 1)` wrapping the body+feet+face draw.

### 14.9 No Appendage Blow-Out

- Hero cap/hair stretch (if implemented) must drive from `advanceSpringRod`, never raw `advanceSpringChain`.
- Grep for `advanceSpringChain` in game code → must find zero occurrences.

### 14.10 End-to-End Route Test (Where Practical)

Scripted input sequences that drive the hero from spawn (col 2) to flagpole (col 192). This is NOT proof of fun — it proves the level is mechanically completable. Use replay recording if available, or hardcode a sequence of `InputEdges` per tick:

1. Hold right for ~480 ticks (8 seconds) → hero reaches the pipe cluster (Beat 4).
2. Jump inputs timed to clear pipes and pits.
3. Hold right + stomp inputs through the brick corridor (Beat 7).
4. Stomp the koopa (Beat 8) → verify shell mode activates.
5. Ascend the staircase (Beat 9) → verify the hero reaches the top.
6. Touch the flagpole (Beat 10) → verify FSM transitions to `'levelComplete'`.

The test must complete without the hero dying or getting stuck. If the hero gets stuck on a pipe, a pit, or the staircase, the level geometry is broken.

---

## 15. Anti-Failure Wording

**This build is NOT complete merely because a valid `LevelData` constant exists with the right entity counts.** The previous version of this brief listed entity counts in a flat table — and a level with the right counts can still fail if the beats don't capture SMB 1-1's rhythm. The build fails if:

- **The level doesn't FEEL like SMB 1-1.** If a player who has played SMB 1-1 doesn't recognize the moments — the first goomba, the ?-block cluster, the pipe, the pits, the staircase, the flag — the level is a failure even if every entity count is correct. The beats are the design, not the counts.
- **Goombas are missing.** The first goomba in Beat 1 is the single most iconic enemy introduction in gaming history. A level with no goombas, or with goombas only in one beat, is a failure. This design places 5 goombas across 3 beats (1, 4, 7).
- **?`-blocks are inert.** A ?-block that doesn't bump, doesn't flash, doesn't yield a coin, and doesn't play the ding-ding is a decorative rectangle, not a ?-block. Every ?-block must be interactive.
- **The koopa shell is not physics-driven.** A koopa that disappears on stomp (like a goomba) is a failure. The shell must emerge, sit on the ground, and slide when kicked — with velocity, with collision, and with the ability to kill other goombas.
- **The flagpole is missing or inert.** The flagpole is the level's resolution. A level that ends by running off the right edge of the screen, or by touching a generic "exit" zone with no visual pole, is a failure. The flagpole must be a visible vertical element that triggers `'levelComplete'` on contact.
- **There is no parallax depth.** A static background or a single scrolling layer is a failure. All three layers (`PARALLAX_FAR` mountains, `PARALLAX_MID` bushes, `PARALLAX_NEAR` clouds) must scroll at distinct speeds. The per-beat parallax emphasis table (§5.4) is a design guide, not a suggestion.
- **The hero is a hand-drawn pixel-art Mario.** This is a Sokpop-outlineRect homage, not a sprite rip. The hero is chunky vector shapes drawn with `outlineRect` + `drawSimpleFeet` + `solveLimb`. If the hero is a pixel-art sprite sheet, the build is rejected for aesthetic reasons — it violates the engine's procedural-rendering ethos.
- **A screenshot only of Beat 1 is insufficient.** Beat 1 is the open plain — the least visually interesting beat. All 10 beats must be screenshot-reviewed for distinct silhouettes and correct entity placement.
- **The underground pipe is included.** The underground transition is a deliberate scope cut (§5.6). If the build includes a warp pipe, an underground room, or a tileset swap, it has over-built the slice and missed the point: this is a single-screen-scroll overworld vertical slice, not a full SMB 1-1 recreation.

**The Flipside analogy.** Flipside's previous brief failed not because it had wrong entity counts but because one shared box template produced six visually identical rooms. World 1-1's previous brief risked the same failure mode: a 200-column flat level with the right entity counts but no beat structure, no visual variety, and no sense of progression. This brief prevents that failure by specifying every beat's column range, unique silhouette, and parallax emphasis — so that even a build that mechanically satisfies every test contract can still be rejected at the visual-review gate if the beats don't feel distinct.

---

## 16. Implementation Workflow

Build in this order. Each stage must pass its gate before the next begins.

### Stage 1: Terrain Prototype + Tile-Style Sample Sheet

1. Set up Vite + TypeScript + `aicraft-engine@0.17.4`.
2. Implement the connected-terrain renderer (`tile-style.ts`) with all four tile styles: ground (grass-top + dirt-body + neighbor bitmask), brick (mortar cross), pipe (helmet + ribbing), ?-block (rivet + glyph + bump-flash).
3. Produce a four-style sample sheet (one 64×64px swatch per tile type).
4. **Gate:** Visual review confirms four distinct tile styles. Ground has grass-top + dirt-body. Bricks have mortar lines. Pipes have helmet + ribbing. ?-blocks have the `?` glyph.

### Stage 2: Beat Design Review

1. Write the hand-authored `WORLD_1_1` `LevelData` constant in `src/levels/world-1-1.ts`, placing every entity at the column specified in §5.5.
2. Validate with `validateLevel`.
3. Compute the level hash — `fnv1a(canonicalize(WORLD_1_1))` — and confirm it's stable.
4. Verify the beat content counts table (§14.2) by partitioning entities by column range.
5. **Gate:** The 10 beats reviewed for unique silhouettes, correct entity placement per §5.5, and the scope-cut compliance (no underground pipe, no warp transition).

### Stage 3: Graybox Mechanics Per Beat

1. Wire the game loop, input, `CLASSIC_PLATFORMER` controller.
2. Implement `compileLevel` + `compiled.tileQuery` + `drawTileGrid`.
3. Implement the horizontal follow camera (§8).
4. Add ?-block bump logic (coin yield + flash + ding-ding).
5. Add brick-shatter logic (particle burst + noise + score).
6. Add goomba + koopa enemy behaviors via `createEnemyBehaviorRegistry`.
7. Add the pit-gap death logic (fall into pit → FSM `die` event).
8. Add the flagpole trigger (overlap → FSM `'levelComplete'`).
9. **Gate:** Playable spawn-to-flagpole. Every beat is mechanically functional. No inert entities.

### Stage 4: Playtest the Full Level

1. Playtest all 10 beats in sequence. Adjust goomba patrol speed, pipe heights, pit widths, koopa position.
2. Verify the first-pit-gap (Beat 6) is jumpable with a running jump at `CLASSIC_PLATFORMER` move speed.
3. Verify the staircase (Beat 9) is ascendable in a single fluid run.
4. Verify the koopa shell (Beat 8) can be kicked and kills goombas.
5. **Gate:** 60–90 second first-time clear. 2–6 expected deaths. Every beat feels distinct.

### Stage 5: Parallax + Visual Polish

1. Implement the 3-layer parallax (mountains / bushes / clouds) per §9.
2. Tune per-beat parallax density per the §5.4 emphasis table.
3. Add the connected-terrain ground renderer (grass-top + dirt-body + pit-edge bevel).
4. Add entity cluster rendering (brick mortar stitching, pipe helmet + ribbing, ?-block glyph).
5. **Gate:** Visual review confirms the parallax scrolls at 3 distinct speeds, the ground has grass + dirt, and each tile type is visually distinct.

### Stage 6: Game Feel + Juice

1. Add launch stretch + landing squash (`volumeScale`).
2. Add hit-stop on stomp (`triggerHitStop` 4–6 ticks).
3. Add screen shake on stomp / flag-catch (`sineShake` + `shakeEnvelope`).
4. Add phase-synced footstep audio (`advanceFootPlant` → `playNoise`).
5. Add brick-shatter particle burst.
6. Add the coin ding-ding on every pickup and ?-block bump.
7. Add the death jingle (three descending square tones).
8. Add the flag-catch sustained rising warp.
9. **Gate:** Game feel matches SMB-on-Sokpop: chunky, juicy, satisfying stomps and jumps.

### Stage 7: All-Beat Screenshots + Vision Review

1. Capture 10 beat screenshots (one per beat, at each beat's canonical camera position).
2. Capture a full-level contact sheet (all 10 beats in one image).
3. Capture a full-level scroll-through (spawn to flagpole).
4. **Gate:** Vision review confirms 10 distinct beat silhouettes, correct entity placement per §5.5, readable hazards (pits visible, goombas distinct from terrain), and parallax depth. No two beats look the same.

### Stage 8: Verification

1. Run all static contracts (§14).
2. Run the end-to-end route test (§14.10).
3. Grep for forbidden patterns (§14.7).
4. Verify collectible persistence across reload.
5. Verify `prefersReducedMotion` renders one static frame.
6. **Gate:** All tests pass. No forbidden patterns found. The level hash is stable. The build is complete.

---

## 17. Preserved Constraints

- **Reduced-motion early gate** — `prefersReducedMotion()` checked before audio setup; renders one static frame; creates no audio adapter or loop.
- **Touch + keyboard + gamepad input** — `createKeyboardAdapter` + `createTouchButtonSet` + `createGamepadAdapter` + `orEdges`. On-screen touch buttons (← → + JUMP) on coarse-pointer devices.
- **DPR / pixel scaling** — `resizeCanvasToBackingStore` + `ctx.setTransform(dpr, ...)`.
- **Fixed-step sim** — `createGameLoop({ fixedDt: 1/60 })`.
- **`CLASSIC_PLATFORMER` config** — passed as the 5th arg to `stepPlatformer`. Variable-height jump with coyote time + jump-buffer built in. No double-jump (that's `doubleJumpAbility` in the ability pipeline, not in `CLASSIC_PLATFORMER`).
- **Hand-authored level** — `WORLD_1_1` is a literal `LevelData` constant, NOT generated by `mulberry32`. Every entity is placed at a specific column per §5.5.
- **Zero runtime deps** — `aicraft-engine` is the only dependency.

---

## 18. Stretch Goals (only after stages 1–8 and criteria §14 pass)

1. **Per-zone palettes via `generatePalette`** — add World 1-2 (underground, the omitted transition as a standalone level) and World 1-3 (castle). Three modes: overworld (current), underground (dark blue + greens), castle (purple-grey + red).
2. **Cosmetic palette skins** — `generateSkinVariants(levelSeed, DEFAULT_SKIN_PRESET, 3)` × `grantSkin` × `createMemoryIAPAdapter`. Bitmap-font pause-menu picker cycles owned skins.
3. **Power-up equivalent** — "super mushroom" that, on pickup, swaps hero to a bigger `outlineRect` via `cosmetics` + `iap` unlock. Restores the omitted Beat-2 mushroom power-up as a post-slice expansion. Drives the power-up `playTone` from §11.
4. **Three HUD cosmetic themes** — "Classic" / "Sokpop" / "NES Limited" — pulled from `DEFAULT_SKIN_PRESET` at HUD draw time.
5. **Mid-level checkpoint** — a consumer-owned checkpoint at the start of Beat 7 (column 95) so deaths in the brick corridor or later don't reset to column 2. Stores `{x, y, facing}`; on death, respawn at checkpoint instead of spawn.

---

## 19. Summary of Key Changes from Previous Brief

| Aspect | Previous (389 lines) | This brief (~870 lines) |
|---|---|---|
| Level design | Flat entity-counts table in §6 (≥3 ?-blocks, ≥6 bricks, 2 pipes, 2 goombas, 1 koopa) | **10-beat breakdown** (§5.5) with per-beat column ranges, silhouettes, parallax emphasis, and entity placement — the headline expansion |
| Entity counts | Minimums only (≥3, ≥6, ≥2, ≥2, ≥1) | Raised minimums grounded in canonical SMB 1-1 (6 ?-blocks, 15 bricks, 3 pipes, 5 goombas, 1 koopa, 12 coins) + per-beat distribution table (§14.2) |
| Resolution spec | Mentioned in passing (3200×224, tileSize 16) | Dedicated §5.1 Logical Resolution & Canvas Spec with parameter table + camera scroll strategy |
| Tile rendering | "Use `drawTileGrid`, don't hand-draw" | Connected-terrain renderer spec (§5.3): ground neighbor bitmask (grass-top + dirt-body + pit-edge bevel), entity cluster styles (brick mortar, pipe helmet + ribbing, ?-block glyph) |
| Parallax | 3-layer spec (mountains / bushes / clouds) | Preserved + **per-beat parallax emphasis table** (§5.4) mapping which layer dominates each beat and why |
| Scope | Implicit (no mention of underground) | Explicit **§5.6 Scope Cuts** — the underground pipe transition is deliberately omitted with three stated reasons |
| Visual review | "Acceptance criteria" checklist (§13, 13 items) | Dedicated **§13 Visual & Play Gates**: 10 beat screenshots + contact sheet + scroll-through + per-beat feel descriptions + rejection criteria |
| Tests | Acceptance criteria (§13) — functional checks | Expanded **§14 Tests & Static Contracts**: beat content counts table, level hash determinism, simulation determinism (3600-tick scripted run), enemy determinism, collectible persistence, forbidden patterns, no-moonwalk, no-appendage-blow-out, E2E route test |
| Anti-failure | Implicit in acceptance criteria | Dedicated **§15 Anti-Failure Wording** — explicit list of what makes World 1-1 fail, with the Flipside analogy (right counts + flat feel = failure) |
| Build workflow | One-line "build order suggestion" at the end | **§16 Implementation Workflow** with 8 stages, each with a gate (terrain prototype → beat design review → graybox mechanics → playtest → parallax + visual polish → game feel → all-beat screenshots → verification) |
| Preserved constraints | Spread across §2 and §13 | Consolidated **§17 Preserved Constraints** for quick reference |
| Pit placement | Cols 120–124 and 180–184 (ad hoc) | Two 2-tile pits in Beat 6 (cols 82–83 and 90–91), matching canonical SMB 1-1's first-pit-gaps position before the brick corridor |
| Goomba placement | Cols 80 and 130 (ad hoc) | 5 goombas across 3 beats: Beat 1 (col 16, the iconic first goomba), Beat 4 (cols 50–51, pipe patrol), Beat 7 (cols 101 and 111, brick-corridor guards) |

---

**Build order:** terrain prototype + tile-style sheet → beat design review → graybox mechanics per beat → playtest the full level → parallax + visual polish → game feel + juice → all-beat screenshots + vision review → verification.

**The game is not done when the code compiles. It is done when 10 visually distinct beats are playable, the level feels like SMB 1-1's iconic progression from first goomba to flagpole, and a human player can clear it in 60–90 seconds on their first try while recognizing every moment.**
