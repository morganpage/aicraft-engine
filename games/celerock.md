# Celerock — A Six-Room Celeste-Homage Precision Platformer on `aicraft-engine@0.4.0`

> Paste this entire document to a coding agent (Claude / Cursor / etc.). It is a complete, self-contained build brief: concept, architecture, exact data contracts, ASCII room layouts, implementation stages, acceptance gates, and anti-shortcut checks. The agent should produce a single runnable Vite + TypeScript browser game that imports everything from `aicraft-engine` (the npm package) and writes **no** re-implementations of what the engine already provides.

---

## 0. What You Are Building

**Celerock** — a single-character precision platformer in the *Forsaken City* aesthetic: a young mountaineer climbs a snowy peak through six hand-designed rooms, each teaching one new technique (jump / variable-jump / wall-slide / wall-jump / dash / combined mastery). The feel target is **Celeste-tight**: variable-height jump (tap = short hop, hold = full), a short configured horizontal dash, wall-slide that slows the fall, wall-jump that fires the player up-and-opposite, hit-stop on dash-into-wall, screen shake on hard landings, instant respawn, and a strawberry counter that persists across reloads. Nothing procedural — every room is hand-built and deterministic.

**This is NOT a tech demo.** It is a designed game with six distinct rooms, each with a unique visual identity, an escalating mechanic, and a hand-authored ASCII tile layout. The previous implementation failed because it shipped five rooms in a 1-line-per-room table that all rendered as the same grey box, the wall-slide room had no walls tall enough to slide on, the dash room's dash did not gate progression, the strawberry could be reached by walking, and the dash-into-wall moment was missing its hit-stop. This brief fixes every one of those failures.

**Non-negotiable: build the entire game on top of `aicraft-engine@0.4.0`.** Do not hand-roll the controller, fixed-step loops, AABB collision, cameras, footstep detection, particles, jump arcs, locomotion, palettes, or audio — those are all in the engine. If you find yourself writing a horizontal-velocity clamp, a wall-slope check, a jump-apex formula, a dash-frame counter, or `Math.random()` in the simulation, STOP and use the engine instead. The whole point of Celerock is to show off the **platformer kernel** (`defaultPrecisionPipeline`) plus the **`collectibles`** + **`save`** pillars that Embertomb doesn't touch.

---

## 1. Tech Stack & Install

```bash
npm create vite@latest celerock -- --template vanilla-ts
cd celerock
npm install aicraft-engine@0.4.0
```

> This brief targets the published `0.4.0` API exactly.

- **TypeScript**, strict. Target ES2021, `moduleResolution: bundler` (matches the engine; Vite resolves its ESM fine).
- **Vite** dev server + build. Single `<canvas>` in `index.html`.
- **`aicraft-engine`** is your only runtime dependency. Import from the **root barrel only**:
  ```ts
  import {
    // game-loop + game-state
    createGameLoop, DEFAULT_FIXED_DT,
    createGameState, reduceGameState, isLegalTransition, DEFAULT_GAME_STATE_ADJACENCY,

    // input
    createKeyboardAdapter, createTouchButtonSet, createGamepadAdapter, orEdges,

    // platformer kernel — THE big showcase for Celerock
    createPlatformerController, createPlatformerState, stepPlatformer,
    defaultPrecisionPipeline, DEFAULT_PLATFORMER_CONFIG,
    DEFAULT_PLAYER_WIDTH, DEFAULT_PLAYER_HEIGHT,
    jumpAbility, wallSlideAbility, dashAbility, doubleJumpAbility,
    compileLevel, advanceMovingPlatform, movingPlatformToSolid,
    createMovingPlatformDisplacementProvider, type SolidDisplacementProvider,
    drawActor, drawTileGrid, drawLevelEntity, DEFAULT_ENTITY_PALETTE,
    type PlatformerConfig, type PlatformerState, type PlatformerInput,
    type CompiledLevel, type CompiledMovingPlatform,

    // level schema (used to author the 6 hand-designed rooms)
    type LevelData, type LevelEntity, type EntityKind, type CollectibleKind,
    LEVEL_VERSION, migrateLevel, validateLevel, canonicalize, fnv1a,

    // collision (only for hazards — the player uses the kernel)
    aabbOverlap, tileToWorld, worldToTile, type Rect,

    // camera
    createCamera, updateCamera,

    // collectibles (pillar that Embertomb doesn't show)
    collect, hasCollected, derivePickups,
    type CollectibleSave, type CollectibleEntity,

    // save
    createLocalStorageSaveStorage, createMemorySaveStorage,
    loadSave, writeSave, DEFAULT_SAVE_KEY,

    // hit-stop + shake (the "Celeste-tight" feel)
    createHitStop, triggerHitStop, stepHitStop, isHitStopActive,

    // animation
    volumeScale, breathe, DEFAULT_BREATH,
    advanceLocomotionByDisplacement, evaluateLocomotion, DEFAULT_GAIT,
    blendAirborneTuck, DEFAULT_TUCK,
    drawSimpleFeet, DEFAULT_SIMPLE_FEET,
    createFootPlantState, advanceFootPlant,
    advanceSpringRod, createSpringRod, DEFAULT_SPRING_ROD,
    sineShake, shakeEnvelope,

    // particles (dash trail, landing dust, respawn flash, etc.)
    spawn, advance as advanceParticles, cull,
    sampleConeVelocity, createEmitter, stepEmitters,

    // parallax + glow + outline (vector look)
    drawTiledParallax, parallaxOffset, PARALLAX_FAR, PARALLAX_MID, PARALLAX_NEAR,
    outlineRect, drawGlow, getDevicePixelRatio, resizeCanvasToBackingStore,
    prefersReducedMotion,
    shade, mixHex,

    // bitmap text (death counter, room title cards, "Press X to respawn")
    drawText, drawTextOutlined, measureText, DEFAULT_FONT, DEFAULT_TEXT_COLOR,

    // easing + tween (death-and-respawn flash, room transitions)
    easeOutCubic, easeOutBack, createTweenState, advanceTween,

    // audio + rng + palette
    createAudioAdapter,
    mulberry32, nextInt, nextFloat, pick,
    generatePalette, resolvePalette, repairContrast, lerp, type Palette,
  } from 'aicraft-engine';
  ```
  Tree-shaking works because every export has `sideEffects: false`. Never deep-import subpaths like `aicraft-engine/platformer` — use the root barrel.

---

## 2. Determinism & Discipline Rules (enforced by the engine — follow them)

- **Fixed-step sim, variable render** via `createGameLoop({ fixedDt: 1/60, step, render })`. Poll input **exactly once per `step`**.
- **No `Math.random()` in the simulation.** Use `mulberry32(seed)` → `nextInt` / `nextFloat` / `pick` for any decorative seeding. `Math.random` is only OK for purely decorative audio/visual side-effects that never feed back into game state (e.g. UI blink timing).
- **No `Date.now()` in the sim.** Time comes from `tick` or the loop's `dt`.
- **Defensive host access.** Anything touching `window`/`AudioContext`/`matchMedia` goes through the engine's adapters (`createAudioAdapter`, `prefersReducedMotion`, `resizeCanvasToBackingStore`, `createLocalStorageSaveStorage`) — they're lazy, error-swallowing, and no-op in Node.
- **Reduced motion.** Gate the loop: if `prefersReducedMotion()`, render one static frame of room 1 and never call `loop.start()`.
- **Pure progression ops.** The kernel and `collect`/`hasCollected` already return new objects — follow their lead. Never mutate `PlatformerState` or `CollectibleSave` in place. (The platformer kernel is the canonical example — it returns a brand-new state per tick.)
- **Platformer pillar's abilities return new states immutably.** `stepPlatformer(state, input, solids, dt)` returns a fresh state. If you find yourself writing manual AABB or velocity code in the player section, STOP and call the kernel instead.

---

## 3. Architecture — Engine Module → Game System Map

| Game system | Engine API |
|---|---|
| Game loop (60 Hz fixed) | `createGameLoop`, `DEFAULT_FIXED_DT` |
| Keyboard / touch / gamepad input, edge merging | `createKeyboardAdapter`, `createTouchButtonSet`, `createGamepadAdapter`, `orEdges` |
| **Player controller (jump + wall-slide + dash + double-jump)** | `createPlatformerController`, `stepPlatformer`, `defaultPrecisionPipeline`, `DEFAULT_PLATFORMER_CONFIG` — **do NOT hand-roll velocity or collision resolution** |
| Ability composition (read-mostly; precision pipeline covers all 4) | `jumpAbility`, `wallSlideAbility`, `dashAbility`, `doubleJumpAbility` |
| Tile rendering for hand-designed rooms | `compileLevel`, `drawTileGrid`, `drawActor`, `drawLevelEntity` |
| Moving-platform rooms | `compileLevel`, `advanceMovingPlatform`, `movingPlatformToSolid`, `createMovingPlatformDisplacementProvider` |
| Hazard AABB (spikes) | `aabbOverlap` against the player's rect (read from the kernel state) |
| Follow camera with clamp + look-ahead | `createCamera`, `updateCamera` |
| Strawberry collection (Pillar 2) | `derivePickups`, `collect`, `hasCollected` |
| Persistent strawberries + death counter | `save` storage (`createLocalStorageSaveStorage`, `loadSave`, `writeSave`) |
| Hit-stop on dash-into-wall | `createHitStop`, `triggerHitStop`, `stepHitStop`, `isHitStopActive` |
| Screen shake on hard landings / dash-bonk | `sineShake`, `shakeEnvelope` |
| Squash/stretch + breathing | `volumeScale`, `breathe`, `DEFAULT_BREATH` |
| Walk cycle (anti-foot-slide on ground) | `advanceLocomotionByDisplacement`, `evaluateLocomotion`, `DEFAULT_GAIT` |
| Landing / airborne tuck | `blendAirborneTuck`, `DEFAULT_TUCK` |
| Legs | `drawSimpleFeet`, `DEFAULT_SIMPLE_FEET` |
| Foot-tap audio | `createFootPlantState`, `advanceFootPlant` |
| Hair (1 damped spring strand) | `createSpringRod`, `advanceSpringRod`, `DEFAULT_SPRING_ROD` — **never** raw `advanceSpringChain` |
| Dash trail, landing dust, respawn flash | `spawn`, `advanceParticles`, `cull`, `sampleConeVelocity` |
| Parallax background (far mountains / mid trees / near particles) | `drawTiledParallax`, `parallaxOffset`, `PARALLAX_FAR/MID/NEAR` |
| Vector look + glow | `outlineRect`, `drawGlow` |
| Crisp Retina canvas | `resizeCanvasToBackingStore`, `getDevicePixelRatio` |
| Death counter, room title cards, "Press X to respawn" | `drawText`, `drawTextOutlined`, `drawText(..., { font: DEFAULT_FONT })` |
| Tween (death-and-respawn flash, room transitions) | `createTweenState`, `advanceTween`, `easeOutCubic`, `easeOutBack` |
| Synthesized SFX | `createAudioAdapter` |
| Per-room palette (snow / dusk / dusk-2 / etc.) | `generatePalette`, `lerp` |
| Connected-terrain tile rendering | `drawTileGrid(ctx, tiles, drawTile)` + consumer-local neighbor bitmask (§5.4) |
| Level schema validation / hashing | `validateLevel`, `canonicalize`, `fnv1a` |
| Frame FSM (menu / playing / gameover / levelComplete) | `createGameState`, `reduceGameState`, `isLegalTransition`, `DEFAULT_GAME_STATE_ADJACENCY` |
| Cosmetic hair colour unlocks (stretch) | `cosmetics` pillar (`generateSkinVariants`), `iap` (`createMemoryIAPAdapter`) |

---

## 4. The Player

The player is built in **two layers**: the **physics** is the platformer kernel, the **art** is overlay rendering on top.

- **Physics layer.** Build the controller once at boot, then call it every tick with the current state + input snapshot:
  ```ts
  const config: PlatformerConfig = {
    ...DEFAULT_PLATFORMER_CONFIG,
    doubleJumpEnabled: true,
    maxDoubleJumps: 1,
  };
  const controller = createPlatformerController(defaultPrecisionPipeline(), config);
  let state = createPlatformerState(spawnX, spawnY, config);
  // each fixed tick:
  const { state: next } = controller.step(state, input, solids, dt);
  state = next;
  ```
  The kernel handles variable-height jump, wall-slide/wall-jump, configured
  dash speed and duration, and Celerock's explicitly enabled one-air-jump
  double-jump budget in the locked
  pipeline order. Do not claim an exact dash distance unless Celerock's own
  `dashSpeed * dashDuration` is tuned to that distance.
- **Spawn.** Use `compileLevel(levelData, { tileTypeMap })`. Each tick combine
  `compiled.staticSolids` with current moving-platform solids and build
  `createMovingPlatformDisplacementProvider(current, previous)`. Wire it into
  the controller once through a delegating closure:
  ```ts
  let displacement: SolidDisplacementProvider = () => null;
  const controller = createPlatformerController(defaultPrecisionPipeline(), config, {
    getSolidDisplacement: id => displacement(id),
  });
  // Before controller.step each tick:
  const previous = movingPlatforms;
  movingPlatforms = movingPlatforms.map(p => advanceMovingPlatform(p, dt));
  displacement = createMovingPlatformDisplacementProvider(movingPlatforms, previous);
  const solids = [...compiled.staticSolids, ...movingPlatforms.map(movingPlatformToSolid)];
  state = controller.step(state, input, solids, dt).state;
  ```
- **Body render.** `volumeScale` uses positive offsets for vertical stretch
  and negative offsets for vertical squash. Use positive on launch and negative
  on landing.
- **⚠ Facing mirror (MANDATORY — or you get a moonwalk):** the locomotion foot offsets are LOCAL-space and assume the draw is mirrored for facing. You MUST wrap the body+feet draw in `ctx.scale(facing, 1)` around the body's vertical axis, or running left shows the character facing right. Canonical:
  ```ts
  ctx.save();
  ctx.translate(bodyCx, bodyBottomY);
  ctx.scale(facing, 1);               // ← do NOT omit — Celerock gets this wrong the most
  drawSimpleFeet(ctx, pose, { ...DEFAULT_SIMPLE_FEET, color: palette.base, outline: palette.outline });
  outlineRect(ctx, -w/2, -h, w, h, palette.base, palette.outline);
  // ...eyes/face — drawn mirrored if you want symmetry, but the EYES must point the way you're facing
  ctx.restore();
  ```
  Draw any **spring-rod hair OUTSIDE the mirror** — its physics already owns a screen-space direction (mounted at the head, wagging back/up).
- **Hair.** Advance with the complete seconds-based signature:
  `hair = advanceSpringRod(hair, anchor.x, anchor.y, dt, {
  ...DEFAULT_SPRING_ROD, restDirection,
  })`.
- **Walk cycle.** Advance by actual per-step displacement:
  `advanceLocomotionByDisplacement(loco, state.core.vx * dt * state.core.facing, DEFAULT_GAIT)`.
- **Foot-tap audio.** Assign the result of `advanceFootPlant`, thread
  `plantResult.state`, and read `plantResult.events`.
- **Airborne tuck.** `blendAirborneTuck(footOffset, airborneBlend, DEFAULT_TUCK)` — `airborneBlend` ramps 0→1 once the player leaves the ground; releases on contact.

---

## 5. World — Six Hand-Designed Rooms (1–6)

Celerock is **hand-designed**, not procedural. Use the level schema (`compileLevel` accepts `LevelData` with `entities: LevelEntity[]` discriminated by `EntityKind`). Each room is a unique hand-authored ASCII grid + entity list. **There is no shared `buildRoomTiles` box template.** Every room has a distinct silhouette, palette, and connected-terrain motif so it is identifiable from a single screenshot.

### 5.1 Logical Resolution & Grid

| Parameter | Value |
|---|---|
| Logical resolution | 320 × 240 (letterboxed per room — rooms are smaller; the camera clamps to the room bounds) |
| Tile size | 16 px (`DEFAULT_TILE_SIZE`) |
| Room grid | per-room (see §5.5) — each ≤ 20 tiles wide × ≤ 15 tiles tall |
| CSS upscale | `image-rendering: pixelated` on the canvas; backing store at logical res, CSS scales to viewport |
| Player body | `DEFAULT_PLAYER_WIDTH × DEFAULT_PLAYER_HEIGHT` (~half a tile wide, ~1.5 tiles tall) |

Canvas setup:
```ts
const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
canvas.style.imageRendering = 'pixelated';
const dpr = resizeCanvasToBackingStore(canvas, 320, 240);
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
```

The camera is clamped to each room's pixel bounds (`roomWidthTiles * 16`, `roomHeightTiles * 16`) so rooms smaller than 320×240 render centred with the parallax background visible around them. On room transition, the camera lerps to the new room's centre over 0.25 s (`easeOutCubic`).

### 5.2 Linear Ascent Room Map

```
[6] Reflection          ← mastery: wall-jump → dash → wall-slide + moving platform
   ↑
[5] The Summit          ← dash + dash-into-wall hit-stop
   ↑
[4] Through the Mirror  ← wall-jump chaining
   ↑
[3] Resolution          ← wall-slide
   ↑
[2] Old Site            ← variable-height jump over gaps
   ↑
[1] Forsaken City       ← flat ground + first jump (start)
```

- **Start:** Room 1 (bottom). **Goal:** Clear Room 6 ("Reflection") — the mastery graduation room.
- **Progression:** strictly linear 1 → 2 → 3 → 4 → 5 → 6, then **loop back to room 1** (preserving the shipped `levelComplete → playing` FSM edge — see §8). The climb is the Celeste metaphor: each room is one tier of the mountain.
- **Transitions:** on reaching the room's `trigger` goal entity (AABB hit against a `goalRect` registered at boot), emit `{ type: 'win' }` to take `playing → levelComplete`. After the "Cleared" card, emit `{ type: 'next' }` to return to `playing`, bump `roomIndex` (mod 6), then recompile the next room with the same classifier.
- **Room transitions:** camera lerps to the new room's centre over 0.25 s. Player physics freeze during the pan.

### 5.3 ASCII Room Definition Format

Each room is a literal ASCII grid in its own file under `src/rooms/`. A shared ASCII parser converts the grid to `LevelData` tile values. Rooms may have different grid dimensions (see §5.5).

**Legend:**

| Char | Meaning | Tile value |
|---|---|---|
| `.` | Empty (air) | 0 |
| `#` | Solid | 1 |
| `^` | Spike (pointing up, floor hazard) | 2 |
| `v` | Spike (pointing down, ceiling hazard) | 3 |
| `<` | Spike (pointing left, right-wall hazard) | 4 |
| `>` | Spike (pointing right, left-wall hazard) | 5 |
| `@` | Player spawn | 0 (parsed as entity) |
| `S` | Strawberry spawn (gem stand-in) | 0 (parsed as entity) |
| `X` | Checkpoint zone | 0 (parsed as entity) |
| `G` | Goal trigger (room exit) | 0 (parsed as entity) |
| `M` | Moving-platform anchor | 0 (parsed as entity) |

**Tile type map:**
```ts
const TILE_TYPE_MAP = (v: number): 'solid' | 'empty' | 'passthrough' => {
  if (v === 1) return 'solid';
  if (v === 2 || v === 3 || v === 4 || v === 5) return 'empty';  // spikes are NOT solid — hazard rects
  return 'empty';
};
```

### 5.4 Connected Terrain Renderer (Per-Room Visual Identity System)

This is the visual identity system. It lives in the game as `tile-style.ts` — NOT in the engine. The engine provides `drawTileGrid(ctx, tiles, drawTile)` and the `shade`/`mixHex` color helpers. The current Celerock brief shipped with `drawTile` owning only tile appearance and no per-room differentiation — that produced six grey boxes. This section fixes it.

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
| Snow cap | If the N neighbor is empty AND this is a "snow-capped" motif, draw a 2px white line on the top edge |

An edge is "exposed" when the neighbor in that direction is **not** solid (bit not set in the mask). Outline strokes are drawn only along exposed edges — drawing a full `outlineRect` around every tile produces the "grid of boxes" failure mode and is rejected (see §13).

**Six room motifs.** Each room's `drawTile` callback closes over the grid and applies a motif-specific interior detail:

| Room | Motif | Visual |
|---|---|---|
| 1 — Forsaken City | Snow-dusted stone | Grey stone fill with 1–2px white speckles seeded per tile (`mulberry32(tileIndex)`) |
| 2 — Old Site | Horizontal sediment bands | 2px alternating light/dark horizontal stripes inside each solid tile |
| 3 — Resolution | Vertical icicle striations | 1px vertical lines every 3px; longer drip on bottom-exposed edges |
| 4 — Through the Mirror | Mirror-shard faceted diagonals | Diagonal facet lines (NE→SW) with a brighter highlight on one facet |
| 5 — The Summit | Exposed brick + snow caps | Brick pattern (offset rows) with a 2px white snow cap on every top-exposed edge |
| 6 — Reflection | Iridescent gradient shift | Vertical fill gradient from `shade(base, 0.4)` at the bottom of the tile to `shade(base, 0.85)` at the top — cooler at room-bottom, warmer at room-top |

**Color derivation.** Each room has a base palette via `generatePalette(roomSeed)`. Derive fill/highlight/shadow/outline from the darkest shade, not pure black:

```ts
const palette = generatePalette(roomSeed);
const roomBase = shade(palette.base, 0.6);       // base fill
const roomHighlight = shade(palette.base, 0.85);
const roomShadow = shade(palette.base, 0.35);
const roomOutline = shade(palette.base, 0.15);   // never pure '#000000'
const snowCap = '#f4f6fa';                         // shared across snow motifs
```

**Gate:** A six-style sample sheet (one screenshot per motif on a flat 16×4 test grid) must be produced and reviewed before room integration. No room is accepted based on unit tests alone.

### 5.5 Room Definitions — Detailed Specifications

Each room is a `LevelData` built from an ASCII literal. Here are the specifications. The actual ASCII grids are written during implementation.

#### Room 1 — "Forsaken City" (flat ground + first jump)

- **Teaches:** the kernel itself. Walk, variable-height jump (tap = hop, hold = full). No new ability beyond the baseline.
- **Layout concept:** A wide snowy ground floor spanning the full width at y=10. One single 1-tile-high bump at x=6 (a small platform the player must hop over). Spikes (`^`) line the floor on both sides of the bump — walking into the bump forces the player to jump. The strawberry floats 2 tiles above the bump, reachable only by a held full-height jump. The goal (`G`) sits on the far right edge.
- **Tile dimensions:** 16 wide × 12 tall at tileSize 16 = **256 × 192 px**.
- **Unique silhouette:** Wide flat floor dominates the lower third; one small bump in the middle; nothing else breaks the horizontal line. Reads as "the tutorial room" at a glance.
- **Strawberry placement:** Floats at (x=6, y=7) — directly above the bump. A tap-hop undershoots it; a held jump reaches it. Rewards judging jump height.
- **Hazard placement:** Floor spikes (`^`) on both sides of the bump at x=4–5 and x=7–8. They gate the bump — you cannot walk around it.
- **Motif:** Snow-dusted stone.
- **Palette:** Warm dusk (`generatePalette(0xA1C1)`).

#### Room 2 — "Old Site" (variable-height jump over gaps)

- **Teaches:** judging the jump arc to clear horizontal gaps. Same jump ability, new application.
- **Layout concept:** Three horizontal platforms at y=10, y=9, and y=8, separated by two 2-tile-wide gaps. The gaps are 1 tile deep with spike floors (`^`). The platforms step up to the right, so the player must clear each gap AND gain height. The strawberry sits on the final (highest) platform — reachable only by a clean full-height jump across the second gap.
- **Tile dimensions:** 18 wide × 12 tall at tileSize 16 = **288 × 192 px**.
- **Unique silhouette:** Three descending horizontal stripes from upper-right to lower-left, two dark gaps between them. Reads as "the staircase room."
- **Strawberry placement:** On the far-right elevated platform (x=16, y=7). Rewards clearing both gaps with height — a tap-hop falls short.
- **Hazard placement:** Spike floor (`^`) at the bottom of each gap (x=6–7 and x=12–13, y=11). Falling in = death.
- **Motif:** Horizontal sediment bands.
- **Palette:** Cool blue (`generatePalette(0xB2D2)`).

#### Room 3 — "Resolution" (wall-slide)

- **Teaches:** wall-slide slows the fall. The player discovers that pressing toward a wall while airborne caps `vy`.
- **Layout concept:** A tall narrow shaft. The player enters at the top (y=0) and falls into a 3-wide vertical corridor with solid walls on both sides, 12 tiles tall. Halfway down, a 2-tile-wide alcove opens on the right wall holding the strawberry. The bottom of the shaft widens into a 5-wide chamber with the goal on the right. The walls are tall enough that an uncontrolled fall would be lethal on the floor spikes — the only safe descent is to wall-slide down one wall, releasing into the alcove for the strawberry, then continuing the slide to the chamber.
- **Tile dimensions:** 8 wide × 15 tall at tileSize 16 = **128 × 240 px**.
- **Unique silhouette:** A tall thin I-beam — narrow top, narrow bottom, taller than wide. Reads as "the shaft room" at a glance.
- **Strawberry placement:** In the right-wall alcove at (x=5, y=7). Rewards releasing the wall-slide at the right moment to drift into the alcove; grabbing the wall again below it requires re-pressing toward the wall.
- **Hazard placement:** Floor spikes (`^`) across the bottom of the shaft (x=1–6, y=14) — only survivable by arriving slow (wall-slide end-state). A spike patch (`>`) on the left wall opposite the alcove gates the side-passage.
- **Motif:** Vertical icicle striations.
- **Palette:** Cold blue-white (`generatePalette(0xC3E3)`).

#### Room 4 — "Through the Mirror" (wall-jump chaining)

- **Teaches:** chaining wall-jumps to ascend. The player must alternate walls to climb.
- **Layout concept:** Two facing walls — a solid left wall and a solid right wall — with a 4-tile-wide vertical gap between them. Horizontal ledges jut out every 3 tiles, alternating left-then-right, breaking the climb into discrete wall-jumps. The player wall-jumps off the left wall, briefly touches a right ledge, wall-jumps off the right wall, touches a left ledge, and so on, zig-zagging upward. The strawberry sits at the very top of the shaft. The floor at the bottom is spikes — falling means death and respawn at the room checkpoint.
- **Tile dimensions:** 10 wide × 14 tall at tileSize 16 = **160 × 224 px**.
- **Unique silhouette:** Zigzag interior pattern of alternating ledges between two long walls. Reads as "the chimney room."
- **Strawberry placement:** At the top of the shaft (x=5, y=1). Reachable only by completing the full wall-jump chain — no shortcut.
- **Hazard placement:** Spike floor (`^`) across the bottom (x=1–8, y=13). A failed chain = fall = death. This is the first room where death is the expected learning path.
- **Motif:** Mirror-shard faceted diagonals.
- **Palette:** Stark indigo (`generatePalette(0xD4F4)`).

#### Room 5 — "The Summit" (dash + dash-into-wall hit-stop)

- **Teaches:** horizontal dash, and the **dash-into-wall** moment — the signature Celeste feel beat. The player dashes horizontally into a wall, the dash terminates on contact (the kernel never phases through solids), and the game fires `triggerHitStop` + `sineShake`.
- **Layout concept:** A wide horizontal chamber. On the left, a small staircase of ledges the player climbs to build a dash approach. In the centre, a tall solid wall (4 wide × 6 tall) is the dash target. The player dashes rightward into it — the bonk is the room's headline moment. Above the wall on a ledge sits the strawberry, reached by chaining a wall-jump off the bonk wall into a dash up onto the ledge. To the right of the wall, a moving platform (`M`) ferries the player across a spike gully to the goal on the far right.
- **Tile dimensions:** 20 wide × 12 tall at tileSize 16 = **320 × 192 px**.
- **Unique silhouette:** Wide horizontal corridor with one tall mid-room wall obstacle and a small moving-platform gully on the right. Reads as "the dash room."
- **Strawberry placement:** On a ledge above the dash-target wall (x=9, y=3). Reached by chaining wall-jump-off-bonk → dash up. Rewards combining the two abilities the room introduces.
- **Hazard placement:** Spike pit (`^`) under the moving-platform gully (x=14–18, y=11). Missing the platform = death. No spikes on the dash-target wall itself (the wall is solid, not lethal — the dash-into-wall is the *feel* moment, not a death).
- **Motif:** Exposed brick + snow caps.
- **Palette:** Warm gold accent — summit dawn (`generatePalette(0xE5A5)`).

#### Room 6 — "Reflection" (combined mastery — the graduation room)

- **Teaches:** chaining every prior technique in sequence — **wall-jump → dash → wall-slide**, with one moving-platform gully as the keystone. This is the "you have graduated" room; no new mechanic, only synthesis.
- **Layout concept:** A tall vertical gauntlet. The player enters at the bottom-left. They wall-jump up a 4-tile-wide shaft (recalling Room 4) for the first third. At the first landing, a horizontal spike gap forces a mid-air dash (recalling Room 5) across to a far wall. They land on that wall and wall-slide down it (recalling Room 3) for two tiles to a small ledge. From the ledge, a moving platform (`M`) ferries them horizontally across a spike pit to a final wall-jump shaft whose top holds the goal. The strawberry hides in a side-pocket off the wall-slide section — reachable only by a frame-perfect release from the slide, then a re-grab on the wall below.
- **Tile dimensions:** 16 wide × 15 tall at tileSize 16 = **256 × 240 px**.
- **Unique silhouette:** Tall vertical chamber with a horizontal notch partway up where the moving platform crosses, and a spike pit at the bottom. Reads as "the final exam room" — visibly denser than every prior room.
- **Strawberry placement:** In a 1-tile side-pocket at (x=11, y=8), off the wall-slide section. The player must release the slide at exactly the right tick to drift into the pocket, then immediately re-grab the wall below to avoid the spike floor. Rewards mastery of the slide's release timing.
- **Hazard placement:** Spike pit (`^`) at the bottom of the moving-platform gully (x=6–10, y=14). Floor spikes (`^`) in the entry chamber (x=1–3, y=14). Spikes on the ceiling of the wall-slide section (`v` at y=6, x=10–12) to punish over-jumps.
- **Motif:** Iridescent gradient shift — cooler at the bottom of each tile, warmer at the top. The whole room reads as a vertical gradient from cold blue at the entry to warm gold at the goal, mirroring the climb from Room 3's cold palette to Room 5's warm one.
- **Palette:** Cool-to-warm — `generatePalette(0xF6B6)` blended with a vertical tint via `mixHex(roomBase, '#e8c46a', roomY / roomHeight)`.

---

## 6. Hazards

The engine does **not** ship a first-class hazard module (hazards are level entities of `kind === 'trap'` in the level schema). Celerock needs spikes — wrap a player-state AABB check in a `tryStep` so the player respawns in place:

- **Static spikes.** Where the level designer places `'trap'` entities of subtype `"spikes"` (your convention), fold them into a `hazardRects: Rect[]` array at boot. Each tick, check `aabbOverlap(playerRect, hazardRect)` — if true AND the player is moving downward (`state.core.vy > 0`) or freshly landed on a hazard tile (`events.justLanded` while their AABB overlapped a hazard), trigger death.
- **Moving spike row (room 5 + room 6 stretch).** One `'movingPlatform'` entity carrying a `'trap'`/`'hazard'` child entity whose rect is the spike row on top of the platform. **Hazards are NOT collision surfaces** — `compileLevel` ignores them, so the kernel never sees them and the "the kernel kills the player for free" claim is false. You must derive the spike rect from the platform's *current advanced* position each tick and run the same `aabbOverlap(playerRect, currentSpikeRect)` check as for static spikes:
  ```ts
  // after movingPlatforms = movingPlatforms.map(p => advanceMovingPlatform(p, dt)):
  for (const spike of movingSpikes) {
    const plat = movingPlatforms.find(p => p.id === spike.platformId);
    if (!plat) continue;
    const spikeRect: Rect = {
      x: plat.x + spike.offsetX,
      y: plat.y + spike.offsetY,      // platform top edge + spike offset
      width: spike.width,
      height: spike.height,
    };
    if (aabbOverlap(playerRect, spikeRect)) { triggerDeath(); break; }
  }
  ```
  Register the `(platformId, offsetX, offsetY, width, height)` tuples once at boot from the level's `'trap'` entities. Do NOT recompile or hand-resolve the platform's motion — `advanceMovingPlatform` already owns it; just read `plat.x`/`plat.y`.

Death effect: assign `hitStop = triggerHitStop(hitStop, 6)`, advance it by
`hitStop = stepHitStop(hitStop, 1)` per fixed tick, and transition the FSM with
the returned state from `reduceGameState`.

---

## 7. Collectibles — Strawberries (the engine's `collectibles` pillar)

**Use the engine's `collectibles` module. Do NOT hand-roll "is this strawberry already collected" or pickup math.**

- **Spawn strawberries as entities.** In each room's `LevelData`, include `LevelEntity` records with `kind: 'collectible'`, `props.kind: CollectibleKind` (engine-level `'coin' | 'gem' | 'key'`), and unique numeric `id`s per room. For Celeste, **use `'gem'` as the visual stand-in for a strawberry** — same AABB, same persistence semantics, render with `drawGlow` + `outlineRect` in `palette.feature`. Do NOT invent a `'strawberry'` literal in `CollectibleKind`; the union is closed and the renderer dispatches only on its three members.
- **Composite persisted save.** The library ships a *flat* `CollectibleSave` (`{ collected: string[] }`) and explicitly leaves per-level scoping to the consumer. Celerock composes it with its death counter into one persisted record:
  ```ts
  interface CelerockSave {
    /** Per-room collectible state, keyed by room id (e.g. `'room-0'`). */
    readonly collectibles: Record<string, CollectibleSave>;
    /** Total deaths across the run. */
    readonly deaths: number;
  }
  const DEFAULT_SAVE: CelerockSave = { collectibles: {}, deaths: 0 };

  const storage = createLocalStorageSaveStorage('celerock-save');
  let save = loadSave(storage, DEFAULT_SAVE);
  ```
  Because every field is a primitive or plain array, this shape survives a JSON round-trip and reproduces identically across reloads — matching the engine's `CollectibleSave` determinism contract.
- **Scope collectible ids by room.** Strawberry entity ids are `number` and may
  repeat across rooms. The outer `Record<roomId, CollectibleSave>` provides the
  namespace; each room-local `CollectibleSave` stores plain `String(entity.id)`
  values so it remains compatible with `derivePickups`:
  ```ts
  const roomId = `room-${roomIndex}`;
  const roomSave: CollectibleSave = save.collectibles[roomId] ?? { collected: [] };

  const playerRect: Rect = {
    x: state.core.x, y: state.core.y,
    width: state.core.width, height: state.core.height,
  };
  const { collected, remaining } = derivePickups(playerRect, collectibleEntities, roomSave);
  for (const id of collected) {
    const strawberry = collectibleEntities.find(entity => entity.id === id);
    if (!strawberry) continue;
    save = {
      ...save,
      collectibles: {
        ...save.collectibles,
        [roomId]: collect(save.collectibles[roomId] ?? roomSave, String(id)),
      },
    };
    audio.playTone('triangle', 600, 1200, 60, 0.15);  // ping
    particles = [
      ...particles,
      ...spawn(strawberry.x, strawberry.y, { count: 8, speed: 3, life: 24, size: 4 }),
    ];
  }
  writeSave(storage, save);   // after the immutable update, persist
  // Once per fixed tick: both helpers are pure, so retain their returned array.
  particles = cull(advanceParticles(particles, 1, { gravity: 0.08, drag: 0.98 }));
  ```
  `remaining` is the render list for this tick (already-collected strawberries are excluded by `derivePickups`), so you don't need a separate filter pass.
- **Death counter integration.** On every `gameover → playing` respawn, assign
  `save = { ...save, deaths: save.deaths + 1 }`, then
  `writeSave(storage, save)`. The counter persists through the same storage
  adapter as the strawberries: one key, one load, one write path.
- **Render strawberries** from `remaining`, or skip an entity when
  `hasCollected(save.collectibles[roomId] ?? { collected: [] }, String(entity.id))`
  is true. Draw uncollected entities as pulsing diamond outlines with
  `drawGlow`.

---

## 8. Game State FSM

Use the engine's `game-state` reducer, not a hand-rolled enum switch:

```ts
// boot:
let gameState = createGameState();

// each tick:
if (gameEvent && !isLegalTransition(gameState.current, gameEvent)) {
  // optional: log a debug warning; never throw
}
gameState = reduceGameState(gameState, gameEvent, dt);
```

Adjacency in your game (matches the shipped `DEFAULT_GAME_STATE_ADJACENCY`):

- `menu → playing` via `{ type: 'start', level: roomIndex }` on first input (any keypress).
- `playing → playing` for everything normal — send no event; `reduceGameState(gs, null, dt)` just advances `timeInState`. Self-transitions are illegal in the table; do not invent a `'tick'` event.
- `playing → gameover` via `{ type: 'die' }` on a hazard.
- `gameover → playing` via `{ type: 'retry' }` after a consumer-owned
  12-tick respawn flash.
- `playing → levelComplete` via `{ type: 'win' }` on reaching the goal tile (pick a `trigger` entity).
- `levelComplete → playing` via `{ type: 'next' }` to advance `roomIndex` (loop back to room 0 after room 5 — six rooms, indices 0–5). The reducer itself does not bump `roomIndex` — your game bumps its own `roomIndex` when it observes a legal `levelComplete → playing` transition, then recompiles the next room.
- A brief `levelComplete` stay should still call `reduceGameState` 1× (with `dt` and no event) to render the "Cleared" text card (via `drawTextOutlined`), then emit `{ type: 'next' }`.

Use the shipped events: `start`, `die`, `retry`, `win`, `next`, `pause`,
`resume`, and `quit`. Do not invent destination-mode events.

---

## 9. Game Feel Checklist (the juice — every item uses the engine)

- [ ] Launch stretch + landing squash (`volumeScale` over `breathe`)
- [ ] Hit-stop on **dash-into-wall** — narrow the union first:
  `const dash = state.abilities.dash; const dashing = dash?.kind === 'dash' && dash.timer > 0`.
- [ ] Hit-stop on death
- [ ] Screen shake on dash-bonk and hard landings (`sineShake` + `shakeEnvelope` decaying)
- [ ] Air control during jump (the kernel's horizontal movement uses `config.airControl`; verify by feel)
- [ ] Dash trail particles (`spawn` 4 small white particles on each dash tick, culled by `cull`)
- [ ] Phase-synced landing dust (`spawn` upward cone on landing)
- [ ] Reduced-motion gate (`prefersReducedMotion`) renders room 1 and starts no loop
- [ ] Coyote time + jump buffer from the shipped `jumpAbility`; do not duplicate them.
- [ ] Spring-rod hair (`advanceSpringRod`) wags backward when moving, lifts during dash
- [ ] Room title cards fade in over 0.6s (`createTweenState` + `easeOutCubic`); "Cleared" card uses `easeOutBack` for Celeste's bouncy entry

---

## 10. Audio (all synthesized via `createAudioAdapter`)

Unlock on first user gesture (one-shot `keydown`/`pointerdown` calling `audio.unlock()`). Then:

- **Walk tap:** `playNoise(40, 'lowpass', 200, 0.12)` per `advanceFootPlant` event.
- **Jump:** `playTone('sine', 200, 400, 80, 0.2)` (upward boing).
- **Wall-jump:** `playTone('triangle', 300, 500, 60, 0.18)` (slightly different timbre).
- **Wall-slide:** narrow the ability-state union before reading its fields:
  `const wall = state.abilities.wallSlide; const sliding = wall?.kind === 'wallSlide' && wall.sliding`.
  While `sliding`, gate `playNoise(20, 'highpass', 800, 0.05)`; start a
  smooth ramp on `events.startedWallSlide` and fade when it becomes false.
- **Dash:** `playNoise(60, 'bandpass', 1500, 0.18)` (short whoosh).
- **Dash-into-wall hit-stop:** `playTone('square', 120, 90, 70, 0.25)` (low thump).
- **Land (hard):** `playNoise(80, 'lowpass', 300, 0.3)`; (soft): `playNoise(50, 'lowpass', 250, 0.18)`.
- **Strawberry:** `playTone('triangle', 600, 1200, 60, 0.15)` (a two-note arpeggio: same recipe played twice ascending).
- **Death:** `playNoise(120, 'lowpass', 400, 0.3)` + descending `playTone('sine', 400, 80, 200, 0.25)`.
- **Respawn:** quick rising `playTone('sine', 200, 600, 100, 0.18)`.

---

## 11. File Layout (Suggested)

```
src/
  main.ts              # boot: canvas, store, audio.unlock, loop.start()
  game/
    state.ts           # CelerockSave (collectibles: Record<roomId, CollectibleSave>, deaths), World, RoomData
    step.ts            # the fixed-step: input → controller.step → pickups → audio
    render.ts          # pure draw: parallax, tiles (connected terrain), hazards, player art, UI
    rooms.ts           # 6 hand-designed room defs (LevelData[] with entities)
    player.ts          # player render: face/hair/feet (kernel does physics)
    tile-style.ts      # connected terrain renderer (neighbor bitmask, 6 motifs, shade/mixHex)
    hazards.ts         # spike geoms + the hazard AABB check + respawn flash
    collectibles.ts    # strawberry wiring: derivePickups → collect → writeSave
    checkpoints.ts     # checkpoint activation + respawn logic
  input.ts             # createKeyboardAdapter + createTouchButtonSet + orEdges
  audio.ts             # createAudioAdapter + the SFX recipe helpers
  save.ts              # createLocalStorageSaveStorage + loadSave / writeSave helpers
  rooms/
    room-1.ts          # Forsaken City ASCII literal
    room-2.ts          # Old Site ASCII literal
    room-3.ts          # Resolution ASCII literal
    room-4.ts          # Through the Mirror ASCII literal
    room-5.ts          # The Summit ASCII literal
    room-6.ts          # Reflection ASCII literal
```

---

## 12. Tests & Static Contracts

### 12.1 Room Schema

- Each room's `LevelData` passes `validateLevel`.
- Each room's grid matches the dimensions in §5.5 (16×12, 18×12, 8×15, 10×14, 20×12, 16×15).
- Each room has exactly one `@` (spawn) entity.
- Each room has at least one `S` (strawberry) entity.
- Each room has exactly one `G` (goal) entity.
- Rooms 3, 4, 5, 6 have at least one `X` (checkpoint) entity (the rooms where death is expected).

### 12.2 Reciprocal Room-Transition Graph

- The progression is the `levelComplete → playing` loop (§8). Verify: clearing room N (0-indexed 0–4) advances to N+1; clearing room 5 loops back to room 0.
- For each room, the `goalRect` AABB is reachable from the spawn AABB by the room's intended mechanic (verified by the E2E tests in §12.10).

### 12.3 Unique Room Hashes

- Compute `fnv1a(canonicalize(room.tiles.data))` for each of the six rooms.
- All six hashes must be distinct (proves no shared `buildRoomTiles` template).
- Log the six hashes in the test output for diff-review.

### 12.4 Expected Content Counts

| Room | Spikes | Strawberries | Moving Platforms | Dash Gates | Wall-Slide Surfaces | Checkpoints |
|---|---|---|---|---|---|---|
| 1 — Forsaken City | ≥2 | 1 | 0 | 0 | 0 | 0 |
| 2 — Old Site | ≥2 | 1 | 0 | 0 | 0 | 0 |
| 3 — Resolution | ≥2 | 1 | 0 | 0 | ≥1 (tall wall) | 1 |
| 4 — Through the Mirror | ≥1 | 1 | 0 | 0 | ≥2 (both walls) | 1 |
| 5 — The Summit | ≥2 | 1 | 1 | 1 (dash gap) | 0 | 1 |
| 6 — Reflection | ≥3 | 1 | 1 | 1 (dash gap) | ≥1 | 1 |

- **Dash gate** = a horizontal gap wide enough that the player cannot clear it with a jump alone (forces a dash).
- **Wall-slide surface** = a solid wall at least 3 tiles tall in a position the player reaches while airborne.

### 12.5 Dash-into-Wall Hit-Stop Timing

- Script: place the player 2 tiles left of a solid wall, trigger a rightward dash.
- Assert: on the tick the dash contacts the wall, `state.abilities.dash` becomes inactive AND `isHitStopActive(hitStop)` returns true for ≥4 ticks AND `shakeEnvelope` is non-zero.
- Assert: the player's `state.core.x` never exceeds the wall's left edge by more than the kernel's penetration tolerance (the dash never phases through).

### 12.6 Checkpoint / Die-Respawn Determinism

- Test: die in room 3 while wall-sliding. Respawn must place the player at the room-3 checkpoint, not the room spawn.
- Test: die in room 4 (wall-jump chain). Respawn must preserve the checkpoint.
- Test: die in room 6 (combined mastery). Respawn must place the player at the last checkpoint reached.

### 12.7 Strawberry Persistence

- Collect the strawberry in room 1, advance to room 2, reload the page (re-run `loadSave`).
- Assert: `hasCollected(save.collectibles['room-0'], String(strawberryId))` is true; the room-1 strawberry is skipped in `derivePickups`'s `remaining`.

### 12.8 Death-Counter Persistence

- Die 3 times across rooms 3 and 4. Reload.
- Assert: `save.deaths === 3`.

### 12.9 Simulation Determinism

- Run 600 ticks of `stepGame` with fixed inputs from the room-1 spawn. Record final `state.core.x`, `state.core.y`, `state.core.vx`, `state.core.vy`.
- Re-run. Final state must be byte-identical.
- Run the same 600-tick script in room 5 with a dash input at tick 120. Re-run. Byte-identical.

### 12.10 End-to-End Room-Progression Tests

Scripted input sequences (`PlatformerInput[]` per tick) that drive the player from each room's spawn to its goal:

- Room 1: walk right, jump the bump, reach goal.
- Room 2: jump gap 1, jump gap 2, reach goal.
- Room 3: fall into shaft, wall-slide, reach chamber, reach goal.
- Room 4: wall-jump chain ×4, reach top goal.
- Room 5: climb ledges, dash into wall, wall-jump to strawberry ledge (optional), ride moving platform, reach goal.
- Room 6: wall-jump shaft, dash across gap, wall-slide to ledge, ride moving platform, wall-jump to goal.

These prove each room is mechanically completable. They are NOT proof of fun — that's the play gates in §13.

### 12.11 Acceptance Criteria (carried forward)

1. Playable in the browser via `npm run dev` with keyboard (`←→`/`A D`, `Space` jump, `Shift` / `X` dash) **and** on-screen touch buttons on coarse-pointer devices (via `createTouchButtonSet`).
2. All **6 rooms reachable**; each teaches one new technique from the room progression in §5. Same input sequence → same-room-geometry on every reload (no `Math.random` in level defs).
3. At least **one room uses wall-slide** (room 3), **one uses wall-jump** (room 4), **one uses dash** (room 5) **and** room 6 uses **all three** (wall-jump + dash + wall-slide).
4. The **"dash-into-wall"** moment narrows the dash ability state before reading `timer`, then applies hit-stop and shake (see §12.5).
5. Strawberries persist across page reload via the engine's `save` module (`createLocalStorageSaveStorage` + `writeSave`).
6. Death counter increments every respawn and persists through the same save adapter.
7. `prefersReducedMotion` renders room 1 statically and never calls `loop.start()`.
8. **Zero duplicate engine systems**: no direct animation-frame loop, random authoritative simulation, manual collision resolver, or duplicate tile-grid traversal. Required tile/entity appearance callbacks are allowed.
9. **No moonwalk.** Walking left faces left in the player. Enforced by the `ctx.scale(facing, 1)` mirror around the body draw (see §4). The reviewer will playtest.
10. **No appendage blow-out.** The hair uses `advanceSpringRod`, never the raw `advanceSpringChain`. Grep for `advanceSpringChain` outside `node_modules` — must not appear.

### 12.12 Forbidden Patterns

Static analysis (grep / AST) must find:

- **No `requestAnimationFrame`** in game code (only in the engine's `createGameLoop`).
- **No `Math.random`** in game code.
- **No `Date.now`** in game code.
- **No manual gravity integration** (no `vy += gravity * dt` outside the engine).
- **No `stepPlatformer`** (must use `createPlatformerController` + `.step()`).
- **No deep imports** (no `aicraft-engine/src/...` — only root barrel).
- **No shared `buildRoomTiles` template** across rooms (each room's ASCII literal is hand-authored).
- **No full-tile `outlineRect`** in the connected terrain renderer (outlines only on exposed edges — see §5.4).

---

## 13. Visual & Play Gates

### 13.1 Screenshot Requirements

Before any room is accepted as complete:

1. **One screenshot per room** — full 320×240 (or room-sized) screenshots of each room's rendered state, six total.
2. **Contact sheet of all six rooms** — all six screenshots in one image, labelled with room number + name.
3. **Six-motif sample sheet** — a separate 16×4 flat test grid rendered once per motif (§5.4 gate), confirming the six motifs are visually distinct before any room is built on them.
4. **Benchmarker / vision review** — the screenshots must show distinct visual identities (motifs, palettes, silhouettes). No room accepted based only on unit tests.

### 13.2 Playthrough Requirements

- **Complete 1 → 2 → 3 → 4 → 5 → 6 playthrough** — the full ascent must be completable, then loop back to room 1.
- **Manual playtest targets:**
  - First full ascent: 6–10 minutes (includes learning wall-slide and wall-jump).
  - Expected deaths: 4–12 (heavier in rooms 4 and 6 — wall-jump chains and combined mastery).
  - Per-room expected deaths: rooms 1–2 ≈ 0; room 3 ≈ 1; room 4 ≈ 2–3; room 5 ≈ 1; room 6 ≈ 2–4.
  - Wall-jump success rate (room 4): a player who has cleared room 3 should chain ≥3 wall-jumps before falling, ≥70% of attempts.
  - Dash-into-wall success rate (room 5): the dash contacts the wall and fires hit-stop on ≥90% of attempts (it is a deterministic mechanic, not a precision one).
  - Fast checkpoint retry: <2 seconds from death to controllable respawn.

### 13.3 Rejection Criteria

The following are grounds for rejecting the build:

- **Rooms feeling samey.** Two or more rooms whose screenshots are indistinguishable at a glance (same silhouette, same palette, same motif).
- **Silhouettes repeated.** Two rooms with the same shape — e.g., two flat-floor rooms.
- **Wall-slide room with no walls tall enough to slide on.** Room 3 must have a wall ≥3 tiles tall that the player contacts while airborne.
- **Wall-jump room where you can skip the chain.** Room 4 must not have a jump-shortcut to the top — the only route is the zig-zag chain.
- **Dash room where dash doesn't gate progression.** Room 5 must have a gap that cannot be cleared by jumping alone.
- **Dash-into-wall moment missing the hit-stop.** The signature feel beat must fire `triggerHitStop` + `sineShake` on contact. Silent bonk = reject.
- **Strawberry you can just walk to.** Every strawberry must reward the room's mechanic (jump height in 1, jump arc in 2, slide-release in 3, chain completion in 4, wall-jump-into-dash in 5, frame-perfect slide-release in 6).
- **Screenshot only of room 1.** Must show all six rooms + the contact sheet + the motif sample sheet.
- **One shared template for all rooms.** Every room must have a unique hand-authored ASCII grid (verified by §12.3 unique hashes).
- **Room 6 that doesn't combine prior mechanics.** Room 6 must use wall-jump AND dash AND wall-slide in sequence — not just one of them.

---

## 14. Anti-Failure Wording

**This build is NOT complete merely because six valid `LevelData` objects exist.** The previous implementation had valid rooms and was still a failure because:

- **Room names cannot substitute for visual identity.** Calling a room "Resolution" does not make it visually distinct from "Through the Mirror." The ASCII grid and connected-terrain motif must do that work — one room snow-dusted stone, the next sediment bands, the next icicle striations, etc.
- **One shared template is a failure.** If `buildRoomTiles` produces the same box for every room, the game has no visual variety. Every room must have a unique hand-authored ASCII grid. (By analogy to the Flipside failure mode: six grey boxes is not a Celeste homage, it's a wireframe.)
- **A wall-slide room with no walls is a failure.** Room 3 must have walls tall enough that the player actually slides. A 2-tile stub is not a wall-slide surface.
- **A wall-jump room you can jump through is a failure.** Room 4 must force the chain — no jump shortcut to the top.
- **A dash room where dash is optional is a failure.** Room 5 must gate progression behind a gap only a dash can clear.
- **A strawberry you can walk to is a failure.** Every strawberry must reward the room's mechanic. If the player can collect it by holding right, the strawberry is mis-placed.
- **A silent dash-into-wall is a failure.** The dash-into-wall bonk is the signature Celeste feel beat. Missing `triggerHitStop` + `sineShake` on contact = the room does not teach dash feel.
- **A screenshot only of room 1 is insufficient.** All six rooms must be screenshot-reviewed for distinct visual identity, plus the motif sample sheet.
- **A wall-slide / wall-jump / dash room that doesn't actually use the kernel's ability is a failure.** If you find yourself hand-rolling a slide timer, a wall-jump velocity impulse, or a dash-frame counter, STOP — those are `wallSlideAbility`, the wall-jump branch of the kernel, and `dashAbility` respectively.

---

## 15. Implementation Workflow

Build in this order. Each stage must pass its gate before the next begins.

### Stage 1: Terrain Prototype + Visual Decision

1. Set up Vite + TypeScript + `aicraft-engine@0.4.0`.
2. Implement the connected terrain renderer (`tile-style.ts`) with all six motifs (snow-dusted stone, sediment bands, icicle striations, mirror shards, brick + snow caps, iridescent gradient).
3. Produce a six-motif sample sheet (one 16×4 test grid screenshot per motif).
4. **Gate:** Visual review confirms six distinct motifs. No two motifs look the same. No full-tile `outlineRect` (only exposed-edge outlines).

### Stage 2: ASCII Room Design Review

1. Write all six ASCII grids (rooms 1–6) per §5.5 dimensions.
2. Parse them into `LevelData` objects.
3. Validate with `validateLevel`.
4. Compute room hashes via `fnv1a(canonicalize(...))` — all six must be distinct.
5. **Gate:** ASCII grids reviewed for unique silhouettes, readable hazards, correct spawn/strawberry/goal placement, and the content-count table in §12.4 satisfied.

### Stage 3: Graybox Mechanics

1. Wire the game loop, input, the kernel controller (`defaultPrecisionPipeline` + `DEFAULT_PLATFORMER_CONFIG` + `doubleJumpEnabled: true`).
2. Implement room transitions (`goalRect` AABB → `win` → `next` → recompile).
3. Add spike AABB checks (static + moving-platform-child spikes).
4. Add checkpoints (respawn at last checkpoint, not room spawn).
5. Add the moving-platform displacement provider (rooms 5 and 6).
6. **Gate:** Playable 1 → 2 → 3 → 4 → 5 → 6 route. Checkpoints work. Death respawns at the last checkpoint. The moving-platform carry works (player rides the platform in rooms 5 and 6).

### Stage 4: Playtest Each Room

1. Playtest all six rooms individually. Adjust spike placement, wall height, dash-gap width, moving-platform speed, checkpoint positions.
2. Verify the dash-into-wall moment fires hit-stop + shake in room 5.
3. Verify room 6 chains wall-jump → dash → wall-slide in the intended order.
4. **Gate:** Per-room expected deaths match §13.2. Wall-jump success rate ≥70% in room 4. Dash-into-wall success rate ≥90% in room 5. Full ascent in 6–10 minutes.

### Stage 5: Juice + Polish

1. Add particles (dash trail, landing dust, respawn flash, strawberry sparkle).
2. Add screen shake on dash-bonk and hard landings.
3. Add hit-stop on dash-into-wall and on death.
4. Add launch stretch + landing squash.
5. Add spring-rod hair.
6. Add parallax background (far mountains / mid trees / near snowfall).
7. Add HUD (death counter, room title cards, "Cleared" card with `easeOutBack`, reduced-motion hint).
8. **Gate:** Game feel matches Celeste-tight. The dash-into-wall bonk is satisfying. The wall-jump chain in room 4 flows. Room 6 feels like a graduation.

### Stage 6: All-Room Screenshots + Vision Review

1. Capture full screenshots of all six rooms (room-sized, not viewport-cropped).
2. Capture a contact sheet (all six rooms in one image, labelled).
3. Capture the six-motif sample sheet (if not already from Stage 1).
4. **Gate:** Vision review confirms distinct visual identities, readable hazards, no repeated silhouettes, and the room-6 iridescent gradient reads as a vertical cool-to-warm shift.

### Stage 7: Strawberries + Persistence

1. Wire `derivePickups` → `collect` → `writeSave` per room.
2. Wire the death counter increment on every `gameover → playing`.
3. Verify persistence across page reload (strawberries stay collected, death counter persists).
4. **Gate:** Reload test passes. All six strawberries behave correctly (skipped when already collected).

### Stage 8: Verification

1. Run all static contracts (§12).
2. Run end-to-end room-progression tests (§12.10) — all six rooms completable.
3. Run the dash-into-wall hit-stop timing test (§12.5).
4. Run the simulation determinism test (§12.9) — 600-tick fixed-input runs are byte-identical.
5. Grep for forbidden patterns (§12.12).
6. **Gate:** All tests pass. No forbidden patterns found. All six room hashes distinct.

---

## 16. Stretch Goals (only after criteria 1–10)

- **Optional 8-way dash.** Replace the kernel's shipped `dashAbility` with a custom variant that takes an aim direction. Build a pipeline that filters out the existing `kind === 'dash'` ability and inserts `customDashAbility` at that same position; do not append a second dash processor.
- **Badeline chase ghost (visual only):** render a colored "ghost" character whose input snapshot is the player's from N frames ago. Buffer the last `N` `PlatformerInput` snapshots in a ring; on each tick, replay the buffered input through a *second* `createPlatformerController` instance with a tinted `palette.feature` and render its `state.core.x/y`. No new physics code — the kernel does the work twice.
- **Cosmetic hair colour unlocks** via `generateSkinVariants` + `createMemoryIAPAdapter` from the `cosmetics` + `iap` pillars. Skin variants change the hair's `palette.feature`; one unlockable per room-clear (a lavender, a cyan, an auburn, a magenta, a gold, a pearl — six total for six rooms). This is the **easiest possible cosmetics demo** and the cleanest bridge from Celerock to Embertomb's IAP surface.
- **Per-room seeded palette** — `const palette = generatePalette(room.seed | 0)`. (Already implied by §5.4; make it the explicit single source of truth.)

---

## 17. Preserved Constraints

- **Reduced-motion early gate** — `prefersReducedMotion()` checked before audio setup; renders one static frame of room 1; creates no audio adapter, no loop.
- **Touch + keyboard + gamepad input** — `createKeyboardAdapter` + `createTouchButtonSet` + `createGamepadAdapter` + `orEdges`.
- **DPR / pixel scaling** — `resizeCanvasToBackingStore` + `ctx.setTransform(dpr, ...)`.
- **Fixed-step sim** — `createGameLoop({ fixedDt: 1/60 })`.
- **Kernel-only player physics** — `defaultPrecisionPipeline()` + `DEFAULT_PLATFORMER_CONFIG` + `doubleJumpEnabled: true`. No manual AABB, no manual velocity integration, no hand-rolled wall-slide timer.
- **`collectibles` + `save` only** — never hand-roll "is this strawberry collected"; always `derivePickups` → `collect` → `writeSave`.
- **Spring rod, never spring chain** — `advanceSpringRod` for hair; grep confirms no `advanceSpringChain` outside `node_modules`.
- **Zero runtime deps** — `aicraft-engine` is the only dependency.

---

## 18. Install & Version

```bash
npm install aicraft-engine@0.4.0
```

`aicraft-engine@0.4.0` is published and stable. Do not pin to `0.3.0`. The brief targets the published `0.4.0` API exactly — `defaultPrecisionPipeline`, `compileLevel` with `tileTypeMap`, `advanceMovingPlatform` + `movingPlatformToSolid` + `createMovingPlatformDisplacementProvider`, `derivePickups` + `collect` + `hasCollected`, and the level-schema helpers `validateLevel` + `canonicalize` + `fnv1a` used by the static contracts in §12.

---

## 19. Summary of Key Changes from Previous Brief

| Aspect | Previous (failed) | This brief |
|---|---|---|
| Room count | 5 rooms | 6 rooms (added Room 6 "Reflection" — combined mastery graduation) |
| Room specs | 1-line-per-row table | Full §5.5 spec per room: teaches, layout, dimensions, silhouette, strawberry, hazard, motif, palette |
| Room grids | ≤20×15 unspecified per room | Specific dimensions per room (16×12, 18×12, 8×15, 10×14, 20×12, 16×15) |
| Tile rendering | Flat `drawTileGrid(ctx, room.tiles, drawTile)` with no per-room differentiation | Connected terrain renderer: neighbor bitmask, 6 motifs, shade/mixHex, exposed-edge-only outlines |
| Room identity | "Forsaken City / Old Site / ..." names only | Unique motifs (snow-dusted stone, sediment bands, icicle striations, mirror shards, brick+snow, iridescent gradient), palettes, silhouettes per room |
| Wall-slide room | Unspecified wall height | Room 3 mandates a ≥3-tile wall-slide surface |
| Wall-jump room | Unspecified chain length | Room 4 mandates a zig-zag chain with no jump shortcut |
| Dash room | "dash + dash-into-wall hit-stop" one-liner | Room 5 mandates a dash-gated gap + the dash-into-wall bonk fires `triggerHitStop` + `sineShake` |
| Strawberry placement | "above the bump" / "at the far end" | Per-room: each strawberry rewards the room's specific mechanic (slide-release in 3, chain completion in 4, wall-jump-into-dash in 5, frame-perfect slide-release in 6) |
| Logical resolution | Unspecified | §5.1: 320×240 logical, tileSize 16, `image-rendering: pixelated` |
| Room map | Implicit linear chain | §5.2: explicit vertical-ascent ASCII diagram with loop-back |
| Tests | 10 acceptance criteria only | §12: room schema, reciprocal graph, unique hashes, content-counts table, dash-into-wall timing test, checkpoint determinism, strawberry/death persistence, simulation determinism, E2E room-progression tests, forbidden patterns |
| Visual review | "the reviewer will playtest" (criterion 9) | §13: one screenshot per room + contact sheet + 6-motif sample sheet + vision review gate |
| Anti-failure wording | Implicit in criteria | §14: explicit failure list — samey rooms, no-slide-walls, optional dash, walk-to-strawberry, silent bonk |
| Implementation workflow | Build-order suggestion paragraph | §15: 8 stages each with a gate (terrain prototype → room design → graybox → playtest → juice → screenshots → persistence → verification) |
| Room 6 | Did not exist | New "Reflection" room combining wall-jump → dash → wall-slide + one moving-platform gully; the graduation room |

---

**Build order:** terrain prototype + 6-motif sample sheet → ASCII room design → graybox mechanics → per-room playtest → juice + polish → all-room screenshots + vision review → strawberries + persistence → verification.

**The game is not done when the code compiles. It is done when six visually distinct rooms are playable, the dash-into-wall bonk fires hit-stop and shake, a human player can complete the 1→6 ascent in 6–10 minutes on their first try, and all six room hashes are distinct.**
