# Celerock — A Celeste-like Precision Platformer that Plays a Supplied LDtk Level on `aicraft-engine@0.6.0`

> Paste this entire document to a coding agent (Claude / Cursor / etc.). It is a complete, self-contained build brief. **Presume the user supplies an LDtk project file (`.ldtk`) and the tileset PNG(s) it references.** The agent produces a single runnable Vite + TypeScript browser game that loads those assets and plays them like *Celeste* — importing everything movement, camera, level, and presentation-related from `aicraft-engine` (the npm package) and writing **no** re-implementations of what the engine already provides. The agent does **not** author level geometry: rooms, tiles, hazards, and collectibles all come from the supplied LDtk file.

---

## 0. What You Are Building

**Celerock** — a precision-platformer runtime in the *Celeste* aesthetic. A young mountaineer traverses the rooms of a supplied LDtk level with the authentic Celeste kit: a variable-height jump, a single 8-directional dash that refills on landing, a wall-grab bound to a stamina meter (cling, climb up/down, climb-hop off), wall-slide, wall-jump, and the dash-tech follow-ups (super jump, hyper/wavedash, duck super jump). The feel target is **Celeste-tight**: dash startup freeze, hit-stop on dash-into-wall, screen shake on hard landings and bonks, spring launches, fast-fall, corner correction, instant respawn, and a strawberry counter that persists across reloads. Rooms are not authored by the game — they are walked through, and the player flows from one LDtk room to the next across the level's `__neighbours` seams with momentum preserved, exactly as Celeste's rooms connect.

**This is NOT a tech demo and NOT a hand-authored level set.** The previous version of this brief failed because it (a) hand-wrote six ASCII room grids and a bespoke "connected-terrain" renderer instead of using a real tileset, (b) drove the view through the legacy single follow-camera instead of the camera brain, (c) enabled a `doubleJump` which is not a Celeste mechanic, and (d) gated progression behind a per-room "win → Cleared card → next" loop instead of Celeste-style seamless room transitions. This brief fixes every one of those: **geometry and tile art come from the supplied LDtk + tileset**, the **camera brain** with per-room virtual cameras owns the view, the **Phase 0–9 movement kernel** owns the authentic Celeste kit, and **LDtk `__neighbours`** own room flow.

**Non-negotiable: build the entire game on top of `aicraft-engine@0.6.0`.** Do not hand-roll the controller, fixed-step loops, collision, the camera, tile rendering, particles, jump arcs, locomotion, palettes, or audio — those are all in the engine. If you find yourself writing a horizontal-velocity clamp, a wall-slide timer, a dash-frame counter, a stamina drain, a camera lerp, a tile-blit loop, or `Math.random()` in the simulation, STOP and use the engine instead.

---

## 1. Tech Stack & Install

```bash
npm create vite@latest celerock -- --template vanilla-ts
cd celerock
npm install aicraft-engine@0.6.0
```

> This brief targets the published `0.6.0` API exactly — the release that ships the **camera brain**, the **LDtk loader**, and the **Phase 0–9 movement overhaul** (LDtk landed in `0.5.0`; the camera brain + Celeste physics + `groundDuckEnabled` shipped in `0.6.0`). Do not pin below `0.6.0`.

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

    // LDtk — THE level source for Celerock (geometry + entities + tile art)
    parseLdtkProject, ldtkLevelToLevelData,
    drawLdtkLevel, drawLdtkLayer, buildLdtkTilesetBundle,
    LDTK_DEFAULT_ENTITY_MAP,
    type LdtkProject, type LdtkLevel, type LdtkNeighbour, type LdtkTilesetBundle,

    // platformer kernel — the Phase 0–9 Celeste kit
    PRECISION_PLATFORMER, defaultPrecisionPipeline, DEFAULT_PLATFORMER_CONFIG,
    createPlatformerState, stepPlatformer,
    compileGeneratedLevel,                       // use this for LDtk-translated levels (carries tileSemantics)
    advanceSquash, DEFAULT_SQUASH_CONFIG, IDENTITY_SCALE, EMPTY_CONTACTS,
    advanceMovingPlatform, movingPlatformToSolid, createMovingPlatformDisplacementProvider,
    type SolidDisplacementProvider,
    drawActor, drawLevelEntity, DEFAULT_ENTITY_PALETTE,
    jumpAbility, wallSlideAbility, dashAbility,
    type PlatformerConfig, type PlatformerState, type PlatformerInput,
    type CompiledLevel, type CompiledMovingPlatform,

    // camera brain — Cinemachine-style vcams, blends, deadzone follow
    createCameraBrain, updateCameraBrain, converge,
    DEFAULT_CAMERA_MOTION, DEFAULT_LENS_MOTION, DEFAULT_BRAIN_BLEND_DURATION,
    type CameraBrain, type CameraBrainOptions, type VirtualCamera,
    type CameraTarget, type CameraBounds,

    // collision (only for hazards — the player uses the kernel)
    aabbOverlap, tileToWorld, worldToTile, type Rect,

    // collectibles (the strawberry pillar)
    collect, hasCollected, derivePickups,
    type CollectibleSave, type CollectibleEntity,

    // save
    createLocalStorageSaveStorage, createMemorySaveStorage,
    loadSave, writeSave, DEFAULT_SAVE_KEY,

    // hit-stop + shake (the "Celeste-tight" feel)
    createHitStop, triggerHitStop, stepHitStop, isHitStopActive,
    sineShake, shakeEnvelope,

    // animation
    volumeScale, breathe, DEFAULT_BREATH,
    advanceLocomotionByDisplacement, evaluateLocomotion, DEFAULT_GAIT,
    blendAirborneTuck, DEFAULT_TUCK,
    drawSimpleFeet, DEFAULT_SIMPLE_FEET,
    createFootPlantState, advanceFootPlant,
    advanceSpringRod, createSpringRod, DEFAULT_SPRING_ROD,

    // particles (dash trail, landing dust, respawn flash, spring sparkle)
    spawn, advance as advanceParticles, cull,
    sampleConeVelocity, createEmitter, stepEmitters,

    // parallax + glow + outline (the look around the tileset)
    drawTiledParallax, parallaxOffset, PARALLAX_FAR, PARALLAX_MID, PARALLAX_NEAR,
    outlineRect, drawGlow, getDevicePixelRatio, resizeCanvasToBackingStore,
    prefersReducedMotion,
    shade, mixHex,

    // bitmap text (death counter, room title cards, "Press X to respawn")
    drawText, drawTextOutlined, measureText, DEFAULT_FONT, DEFAULT_TEXT_COLOR,

    // easing + tween (death-and-respawn flash, room-transition cards)
    easeOutCubic, easeOutBack, createTweenState, advanceTween,

    // audio + rng + palette
    createAudioAdapter,
    mulberry32, nextInt, nextFloat, pick,
    generatePalette, resolvePalette, repairContrast, lerp, type Palette,
  } from 'aicraft-engine';
  ```
  Tree-shaking works because every export has `sideEffects: false`. Never deep-import subpaths like `aicraft-engine/platformer` or `aicraft-engine/src/...` — use the root barrel.

> **Do not import** the legacy single follow-camera (`createCamera` / `updateCamera`) — it is superseded by the camera brain. **Do not import** `doubleJumpAbility` / `doubleJumpEnabled` — Celeste has no double jump. **Do not import** `compileLevel`, `canonicalize`, `fnv1a`, or `LEVEL_VERSION` — those serve hand-authored `LevelData`; geometry here comes from LDtk via `ldtkLevelToLevelData` + `compileGeneratedLevel`.

---

## 2. Determinism & Discipline Rules (enforced by the engine — follow them)

- **Fixed-step sim, variable render** via `createGameLoop({ fixedDt: 1/60, step, render })`. Poll input **exactly once per `step`**.
- **No `Math.random()` in the simulation.** Use `mulberry32(seed)` → `nextInt` / `nextFloat` / `pick` for any decorative seeding. `Math.random` is only OK for purely decorative audio/visual side-effects that never feed back into game state.
- **No `Date.now()` in the sim.** Time comes from `tick` or the loop's `dt`.
- **Defensive host access.** Anything touching `window`/`AudioContext`/`matchMedia`/`fetch`/`Image` goes through the engine's adapters (`createAudioAdapter`, `prefersReducedMotion`, `resizeCanvasToBackingStore`, `createLocalStorageSaveStorage`) or a lazy, error-swallowing loader of your own — never bare at import time.
- **Reduced motion.** Gate the loop: if `prefersReducedMotion()`, render one static frame of the first room and never call `loop.start()`.
- **Pure progression ops.** The kernel and `collect`/`hasCollected` already return new objects — follow their lead. Never mutate `PlatformerState` or `CollectibleSave` in place.
- **Draw the supplied tileset verbatim.** Render tiles only through `drawLdtkLevel`. Do **not** recolor, tint, palette-swap, or procedurally overpaint the tile art — the supplied tileset *is* the visual identity of the game. Cosmetic `shade`/`mixHex` is for the player body, hair, parallax, and UI only, never for level tiles.

---

## 3. Architecture — Engine Module → Game System Map

| Game system | Engine API |
|---|---|
| Game loop (60 Hz fixed) | `createGameLoop`, `DEFAULT_FIXED_DT` |
| Keyboard / touch / gamepad input, edge merging | `createKeyboardAdapter`, `createTouchButtonSet`, `createGamepadAdapter`, `orEdges` |
| **Load the supplied LDtk project** | `parseLdtkProject` |
| **Translate an LDtk level → engine geometry** | `ldtkLevelToLevelData` (IntGrid → solidity by value *name*; entities → engine entities via `LDTK_DEFAULT_ENTITY_MAP`) |
| **Compile a translated level for play** | `compileGeneratedLevel({ level, tileSemantics }, { config, playerWidth, playerHeight })` |
| **Render the supplied tileset** | `drawLdtkLevel` / `drawLdtkLayer` + `buildLdtkTilesetBundle` |
| **Player controller (jump + wall-slide + wall-jump + dash + wall-grab/stamina + dash-tech)** | `PRECISION_PLATFORMER` + `stepPlatformer(..., config)` — **do NOT hand-roll velocity, stamina, or collision** |
| Moving-platform rooms | `advanceMovingPlatform`, `movingPlatformToSolid`, `createMovingPlatformDisplacementProvider` |
| **Camera brain (per-room vcams, deadzone follow, blends)** | `createCameraBrain`, `updateCameraBrain`, `VirtualCamera` — **do NOT use the legacy `createCamera`/`updateCamera`** |
| **Room-to-room transitions** | LDtk `__neighbours` — pure `transitionFor` / `entryPoint` helpers (see §5.5); momentum preserved |
| Hazard AABB (spikes) | `aabbOverlap` against the player's rect (read from the kernel state) |
| Strawberry collection | `derivePickups`, `collect`, `hasCollected` |
| Persistent strawberries + death counter | `save` storage (`createLocalStorageSaveStorage`, `loadSave`, `writeSave`) |
| Hit-stop on dash-into-wall + death | `createHitStop`, `triggerHitStop`, `stepHitStop`, `isHitStopActive` |
| Screen shake on hard landings / dash-bonk | `sineShake`, `shakeEnvelope` |
| Squash/stretch + breathing | `volumeScale`, `breathe`, `DEFAULT_BREATH`, `advanceSquash`, `DEFAULT_SQUASH_CONFIG` |
| Walk cycle (anti-foot-slide on ground) | `advanceLocomotionByDisplacement`, `evaluateLocomotion`, `DEFAULT_GAIT` |
| Landing / airborne tuck | `blendAirborneTuck`, `DEFAULT_TUCK` |
| Legs | `drawSimpleFeet`, `DEFAULT_SIMPLE_FEET` |
| Foot-tap audio | `createFootPlantState`, `advanceFootPlant` |
| Hair (1 damped spring strand) | `createSpringRod`, `advanceSpringRod`, `DEFAULT_SPRING_ROD` — **never** raw `advanceSpringChain` |
| Dash trail, landing dust, respawn flash | `spawn`, `advanceParticles`, `cull`, `sampleConeVelocity` |
| Parallax background (far/mid/near) | `drawTiledParallax`, `parallaxOffset`, `PARALLAX_FAR/MID/NEAR` |
| Vector look + glow (player, pickups, UI) | `outlineRect`, `drawGlow` |
| Crisp Retina canvas | `resizeCanvasToBackingStore`, `getDevicePixelRatio` |
| Death counter, room title cards | `drawText`, `drawTextOutlined` |
| Tween (death-and-respawn flash, transition cards) | `createTweenState`, `advanceTween`, `easeOutCubic`, `easeOutBack` |
| Synthesized SFX | `createAudioAdapter` |
| Frame FSM (menu / playing / gameover) | `createGameState`, `reduceGameState`, `isLegalTransition`, `DEFAULT_GAME_STATE_ADJACENCY` |

---

## 4. The Player

The player is built in **two layers**: the **physics** is the Phase 0–9 kernel tuned to the Celeste kit, the **art** is the engine's procedural renderer overlaid on the LDtk tiles. (A supplied player sprite sheet is a stretch goal — §16.)

### 4.1 Config — the Celeste kit

Author the feel in **tile units** so it is identical whether the supplied LDtk uses 8 px, 16 px, or 32 px tiles. Scale every pixel value by `tileSize / 16`. This is the reference config (mirrors the engine's own LDtk play mode):

```ts
const REFERENCE_TILE = 16;
const PLAYER_WIDTH_TILES = 0.5;   // half a tile — fits 1-wide ladder shafts
const PLAYER_HEIGHT_TILES = 1.5;  // ~1.5 tiles tall
const CLIMB_SPEED_TILES = 7.5;    // tiles per second on a ladder / wall-grab

function playConfigFor(tileSize: number): Readonly<PlatformerConfig> {
  const s = tileSize / REFERENCE_TILE;
  return {
    ...PRECISION_PLATFORMER,
    gravity: 1800 * s,
    maxFallSpeed: 720 * s,
    moveSpeed: 180 * s,
    airAccelMultiplier: 0.5,
    jump: { ...DEFAULT_JUMP, apexHeight: 81 * s, timeToApex: 0.3 },  // apex in tile units
    // Celeste kit, opted in:
    wallGrabEnabled: true,          // grab key (K) clings to walls, drains stamina, climb-hops off
    climbEnabled: true,             // ladder IntGrid cells named 'ladder' drive vertical climb
    climbSpeed: CLIMB_SPEED_TILES * tileSize,
    // Dash (8-directional, startup freeze, refills on land) is inherited as enabled
    // from PRECISION_PLATFORMER. Dash-tech (super/hyper/wavedash/duck) likewise.
    groundDuckEnabled: false,       // keep Down responsive for ladders/fast-fall/dash-aim;
                                    // ability-owned duck (hyper slide) + duck super jump still work
    stepHeight: 0.5 * tileSize,     // walk up small lips/stairs/flush ladder-top exits
  };
}
```

`PRECISION_PLATFORMER` already carries the full kit with tuned defaults: decaying wall-slide (`wallSlideStartMax` easing up to `maxFallSpeed`), wall-jump launch (`wallJumpVx/Vy` + `wallJumpLockTime`), 8-directional dash (`dashSpeed`/`dashDuration`/`dashStartupTime`/`maxDashes`/`endDashSpeedFactor`), dash-tech (`superJumpVx`, `dodgeSlideSpeedMult`, `duckSuperJump*`), springs (`springBounceVy`/`springSuperBounceVy`), corner correction, fast-fall, and wall-speed retention. **Do not duplicate any of these by hand.**

### 4.2 Step loop

```ts
const config = playConfigFor(level.tileSize);
let state = compiled.initialState;        // spawn from the LDtk 'Player'/'Spawn' entity
// each fixed tick:
state = stepPlatformer(state, input, solids, dt, config).state;
```

Combine `compiled.staticSolids` each tick with current moving-platform solids and a `createMovingPlatformDisplacementProvider(current, previous)` so platforms carry the player (see §5.3).

### 4.3 Input

Build `PlatformerInput` from polled edges. `moveY` drives **both** ladder climb (up = `-1`) and fast-fall (down = `+1`); `grab` is the wall-grab edge (default `IDLE_EDGE` = mapped-but-not-pressed; `null` would *disable* the ability):

```ts
const input: PlatformerInput = {
  moveX,
  moveY,
  jump: edges['jump'] ?? IDLE_EDGE,
  dash:  edges['dash']  ?? IDLE_EDGE,   // ShiftLeft
  grab:  edges['grab']  ?? IDLE_EDGE,   // KeyK
};
```

Suggested bindings: Arrows/WASD move, `Space` jump, `ShiftLeft` dash, `KeyK` grab, `R` reset. (Celeste uses `C`/`Z` for grab; `KeyK` is the common non-conflicting alternative clear of the WASD cluster.)

### 4.4 Body render (procedural art, independent of the level tileset)

The player's own sprite is the engine's vector renderer, drawn over the LDtk tiles:

- **⚠ Facing mirror (MANDATORY — or you get a moonwalk):** wrap the body+feet draw in `ctx.scale(facing, 1)` around the body's vertical axis. Running left must face left. Draw spring-rod hair **outside** the mirror (its physics own a screen-space direction).
- **Hair:** `advanceSpringRod(hair, anchor.x, anchor.y, dt, { ...DEFAULT_SPRING_ROD, restDirection })` — never raw `advanceSpringChain`.
- **Walk cycle:** `advanceLocomotionByDisplacement(loco, state.core.vx * dt * state.core.facing, DEFAULT_GAIT)`.
- **Squash & stretch:** advance the render-only scale from the kernel's emitted events (`advanceSquash` with `DEFAULT_SQUASH_CONFIG`), held in your closure — **never** on `PlatformerState` (it is pure presentation, no `physicsVersion` impact). Pivot at the feet.
- **Airborne tuck + foot-tap audio** as in any precision platformer.

---

## 5. World — The Supplied LDtk Level

Celerock does **not** author rooms. It loads the supplied `.ldtk`, translates each level into engine geometry, renders the supplied tileset through `drawLdtkLevel`, and flows the player between rooms across LDtk `__neighbours` seams.

### 5.1 Boot: parse + load tilesets

```ts
// 1. Fetch + parse the supplied LDtk project.
const text = await (await fetch('./levels/level.ldtk')).text();
const project: LdtkProject = parseLdtkProject(text);

// 2. Async-load every tileset PNG the project references, keyed by uid.
const tilesets: LdtkTilesetBundle = await buildLdtkTilesetBundle(
  project.defs.tilesets,
  async (def) => loadImage('./assets/' + def.relPath),  // resolve each relPath to a decoded image
);
// Skip the LDtk built-in icon atlas: ignore defs with embedAtlas === 'LdtkIcons'.
```

`loadImage` should resolve `LdtkTilesetDef.relPath` to a decoded `HTMLImageElement` / `ImageBitmap`. Be defensive (lazy, error-swallowing) — a missing tileset must not crash boot.

### 5.2 Per level: translate + compile

Each LDtk level becomes engine geometry. **Compile lazily and cache per `level.iid`** (revisits are instant):

```ts
function compileRoom(ldtkLevel: LdtkLevel): LevelRuntime {
  const { level, tileSemantics } = ldtkLevelToLevelData(ldtkLevel, project);
  const compiled = compileGeneratedLevel(
    { level: level!, tileSemantics },
    { config, playerWidth: playerWidthFor(level!.tileSize), playerHeight: playerHeightFor(level!.tileSize) },
  );
  // ...ladder mask (if the project declares an IntGrid value named 'ladder'), solids, entities
  return { ldtkLevel, levelData: level!, compiled, solids, hazards, collectibles };
}
```

`ldtkLevelToLevelData` derives solidity from the IntGrid value **names**: non-zero = solid unless the name contains `'passthrough'` (one-way) or equals `'ladder'` (climb space). Entities are translated through `LDTK_DEFAULT_ENTITY_MAP` — recognized identifiers (case-insensitive):

| LDtk entity identifier | Engine entity |
|---|---|
| `Player` / `Spawn` / `Start` | `spawn` |
| `Exit` / `Door` / `Goal` / `End` | `exit` (optional chapter goal — §8) |
| `Coin` / `Gem` / `Diamond` / `Jewel` / `Key` | `collectible` (your strawberry — §7) |
| `Spike` / `Spikes` / `Hazard` / `Lava` / `Saw` | `hazard` |
| `Trap` | `trap` |
| `Enemy` / `Enemy_*` | `enemy` |
| `MovingPlatform` / `moving_platform` | `movingPlatform` |
| `Passthrough` / `Oneway` | `passthrough` |

Override the whole map via `LdtkTranslateOptions.entityMap` if your LDtk uses non-standard names.

### 5.3 Moving platforms (when the LDtk defines them)

Each tick, advance platforms and feed the displacement provider so the player rides them:

```ts
const previous = movingPlatforms;
movingPlatforms = movingPlatforms.map(p => advanceMovingPlatform(p, dt));
const displacement = createMovingPlatformDisplacementProvider(movingPlatforms, previous);
const solids = [...compiled.staticSolids, ...movingPlatforms.map(movingPlatformToSolid)];
state = stepPlatformer(state, input, solids, dt, config).state;
```

### 5.4 Render the tileset + camera brain

Set the canvas once (`image-rendering: pixelated`, DPR-aware backing store). Each frame, the **camera brain** owns the view: one follow `VirtualCamera` per room, Celeste-style deadzone bands, fitted zoom. Render the tileset through `drawLdtkLevel` with `imageSmoothingEnabled = false`:

```ts
// One cached vcam per room (rooms differ in size → fitZoom differs).
const vcam: VirtualCamera = {
  id: room.ldtkLevel.iid,
  priority: 0,
  blend: 0,                                   // room-local coords → cut position, keep zoom (§5.5)
  body: {
    mode: 'follow', targetKey: 'player',
    followX: { trail: 0.25, lead: 0.5 },      // Celeste deadzone bands
    followY: { trail: 0.35, lead: 0.65 },
    padding: 0,
  },
  lens: { zoom: fitZoom(room.levelData, viewport) },
};

// Boot once at the start room's fitted zoom:
let brain = createCameraBrain({ zoom: fitZoom(start.levelData, viewport) });

// Each tick:
brain = updateCameraBrain(brain, {
  vcams: [roomVcamFor(active)],
  targets: { player: state.core },            // the player's collision rect
  bounds: { width: active.levelData.width, height: active.levelData.height },
  viewport,                                    // physical canvas pixels (NOT divided by zoom)
  activeId: active.ldtkLevel.iid,
  dt,
});

// Each render:
ctx.imageSmoothingEnabled = false;
ctx.save();
ctx.scale(brain.zoom, brain.zoom);
const worldView = { width: viewport.width / brain.zoom, height: viewport.height / brain.zoom };
drawLdtkLevel(ctx, active.ldtkLevel, {
  tilesets,
  worldOffset: { x: -Math.round(brain.camera.x), y: -Math.round(brain.camera.y) },
  view: { x: brain.camera.x, y: brain.camera.y, width: worldView.width, height: worldView.height },
});
// ...player art, entities, particles, UI...
ctx.restore();
```

`fitZoom(level, viewport)` scales a room **up** to fill the canvas when it is smaller than the viewport (so a cozy room isn't a thumbnail), and stays at `1×` when larger (the deadzone follow scrolls). Pixel art scaled by an integer factor stays crisp.

### 5.5 Room transitions — seamless, momentum-preserving

Celerock renders one room at a time in **room-local coordinates**, so a room change must NOT blend a position captured in one room's local space into another's. The canonical pattern (pure, unit-testable without a canvas):

```ts
/** Which linked edge (if any) the player left the room through. */
function transitionFor(body: Rect, level: LdtkLevel): LevelTransition | undefined;

/** Where the player enters the target room, in the target's local space. */
function entryPoint(body: Rect, from: LdtkLevel, to: LdtkLevel): { x: number; y: number };
```

On transition: resolve the matching cardinal `__neighbour`, compile the target (cached), reposition the player at the seam preserving `vx`/`vy`/`facing` and resetting `contacts`, then **cut the camera** into the destination-local origin while keeping the previous rendered zoom as the new lens start (so the lens eases rather than pops):

```ts
const exit = transitionFor(state.core, active.ldtkLevel);
if (exit) {
  const target = getRoom(exit.neighbour.levelIid);
  if (target) {
    const entry = entryPoint(state.core, active.ldtkLevel, target.ldtkLevel);
    state = {
      ...createPlatformerState(entry.x, entry.y, config, playerWidth, playerHeight),
      core: { ...state.core, x: entry.x, y: entry.y, onGround: false, contacts: EMPTY_CONTACTS },
    };
    active = target;
    brain = resetRoomCameraBrain(brain);   // createCameraBrain({ x:0, y:0, zoom: brain.zoom })
  }
}
```

Falling out of the level with no cardinal neighbour (the void) is a respawn, not a transition.

> The engine's own `showcase/sections/ldtk-editor/play.ts` is the reference implementation for everything in §5 — translate, compile, ladder mask, `fitZoom`, per-room vcam, `transitionFor`/`entryPoint`/`resetRoomCameraBrain`. Read it.

### 5.6 What the supplied LDtk must contain (light contract)

Because Celerock trusts the LDtk, the file is the design. At minimum it should provide:

- **≥1 level** (more rooms = a longer climb). Multi-level projects are navigated via `__neighbours`.
- An **IntGrid collision layer** with named values for `'solid'` (and optionally `'passthrough'`, `'ladder'`).
- **Tile / AutoLayer layers** referencing the supplied tileset for the visual.
- **Entity layers**: at least one `Player`/`Spawn`; `Coin`/`Gem`/`Diamond` strawberries; `Spike`/`Hazard` hazards; optionally `MovingPlatform`, `Spring`, `DashRefill`, `Enemy`.
- **`__neighbours`** links between levels you intend to flow between.

A level with no spawn cannot be entered; a level with no hazards cannot kill. Those are design choices in the LDtk, not failures of the runtime.

---

## 6. Hazards

Hazards are LDtk entities (`Spike`/`Hazard`→`hazard`, `Trap`→`trap`); the engine does not ship a first-class hazard module. Wrap a player-state AABB check:

- **Static spikes.** At boot, collect hazard entity rects into `hazardRects: Rect[]`. Each tick, check `aabbOverlap(playerRect, hazardRect)` — if true (and the player is moving into the hazard, e.g. `state.core.vy > 0` for floor spikes, or freshly landed over a hazard), trigger death.
- **Moving spike rows** (a `MovingPlatform` carrying a hazard child). Derive the spike rect from the platform's *current advanced* position each tick and run the same `aabbOverlap` check. Do NOT re-resolve the platform's motion — `advanceMovingPlatform` already owns it; just read `plat.x`/`plat.y`.

Death effect: `hitStop = triggerHitStop(hitStop, 6)`; advance `hitStop = stepHitStop(hitStop, 1)` per fixed tick; transition the FSM to `gameover`.

**The signature Celeste beat — dash-into-wall.** The dash terminates on contact with a solid (the kernel never phases through). On the tick a dash contacts a wall, fire `triggerHitStop` + `sineShake`. Narrow the ability-state union before reading its timer:

```ts
const dash = state.abilities.dash;
const dashing = dash?.kind === 'dash' && dash.timer > 0;
```

---

## 7. Collectibles — Strawberries (the engine's `collectibles` pillar)

**Use the engine's `collectibles` module. Do NOT hand-roll "is this strawberry already collected."**

- **Source.** Strawberries are LDtk `Coin`/`Gem`/`Diamond` entities, translated to `collectible`. Use the engine `'gem'` visual stand-in for a strawberry — same AABB, same persistence semantics, render with `drawGlow` + `outlineRect` in `palette.feature`. Do NOT invent a `'strawberry'` literal in `CollectibleKind`; the union is closed.
- **Composite persisted save.** The library ships a flat `CollectibleSave` and leaves per-level scoping to the consumer. Celerock composes it with its death counter, **keyed by `level.iid`** (each LDtk room is its own namespace):

  ```ts
  interface CelerockSave {
    /** Per-room collectible state, keyed by the LDtk level iid. */
    readonly collectibles: Record<string, CollectibleSave>;
    /** Total deaths across the run. */
    readonly deaths: number;
  }
  const DEFAULT_SAVE: CelerockSave = { collectibles: {}, deaths: 0 };

  const storage = createLocalStorageSaveStorage('celerock-save');
  let save = loadSave(storage, DEFAULT_SAVE);
  ```

- **Pickup each tick.** `derivePickups` returns `{ collected, remaining }`; `remaining` is the render list (already-collected strawberries excluded):

  ```ts
  const roomId = active.ldtkLevel.iid;
  const roomSave: CollectibleSave = save.collectibles[roomId] ?? { collected: [] };
  const { collected, remaining } = derivePickups(playerRect, collectibleEntities, roomSave);
  for (const id of collected) {
    save = { ...save, collectibles: { ...save.collectibles, [roomId]: collect(roomSave, String(id)) } };
    writeSave(storage, save);
    // ping + sparkle particles
  }
  ```

- **Death counter.** On every `gameover → playing` respawn, `save = { ...save, deaths: save.deaths + 1 }`, then `writeSave`. Same storage adapter as the strawberries.
- **Render** uncollected strawberries from `remaining` as pulsing diamond outlines with `drawGlow`.

---

## 8. Game State FSM

Use the engine's `game-state` reducer. With seamless neighbour transitions there is **no per-room win/next loop** — progression is simply traversal (and, optionally, reaching a final goal):

- `menu → playing` via `{ type: 'start' }` on first input.
- `playing → gameover` via `{ type: 'die' }` on a hazard.
- `gameover → playing` via `{ type: 'retry' }` after a consumer-owned 12-tick respawn flash (respawn at the last checkpoint, or the room spawn if none).
- **Optional** `playing → levelComplete` via `{ type: 'win' }` — only if the LDtk defines a `Goal`/`Exit` entity in a final room, for a chapter-complete card (`drawTextOutlined`, `easeOutBack`). If the supplied LDtk has no goal entity, "finishing" means exploring/reaching the last room; do not invent a goal.

```ts
let gameState = createGameState();
gameState = reduceGameState(gameState, gameEvent, dt);
```

Use the shipped events (`start`, `die`, `retry`, `win`, `next`, `pause`, `resume`, `quit`); do not invent destination-mode events.

---

## 9. Game Feel Checklist (the juice — every item uses the engine)

- [ ] Launch stretch + landing squash (`advanceSquash` + `volumeScale` over `breathe`).
- [ ] **Hit-stop on dash-into-wall** — narrow the union first (`dash?.kind === 'dash' && dash.timer > 0`).
- [ ] Hit-stop on death.
- [ ] Screen shake on dash-bonk and hard landings (`sineShake` + `shakeEnvelope`).
- [ ] **Camera brain deadzone follow** (Celeste bands) — smooth, no jitter; the player stays inside the band until it crosses the lead edge.
- [ ] **Camera cut/blend on room transition** — no jarring pop; the lens eases from the old room's zoom to the new one's `fitZoom`.
- [ ] Air control during jump (the kernel's `airAccelMultiplier`).
- [ ] Dash trail particles (`spawn` 4 small white particles on each dash tick, culled by `cull`).
- [ ] Landing dust (`spawn` upward cone on landing); respawn flash.
- [ ] **Wall-grab feel**: latch snap, stamina drain (optionally a stamina bar UI), climb, climb-hop launch.
- [ ] **Spring** boing + `springBounceVy`; **dash-refill** sparkle when `maxDashes` refills on a refill entity.
- [ ] Coyote time + jump buffer from the shipped `jumpAbility`; do not duplicate them.
- [ ] Spring-rod hair (`advanceSpringRod`) wags backward when moving, lifts during dash.
- [ ] Reduced-motion gate (`prefersReducedMotion`) renders room 1 and starts no loop.
- [ ] Room title cards fade in over 0.6 s (`createTweenState` + `easeOutCubic`); transition/"Cleared" cards use `easeOutBack`.

---

## 10. Audio (all synthesized via `createAudioAdapter`)

Unlock on first user gesture (one-shot `keydown`/`pointerdown` calling `audio.unlock()`). Then:

- **Walk tap:** `playNoise(40, 'lowpass', 200, 0.12)` per `advanceFootPlant` event.
- **Jump:** `playTone('sine', 200, 400, 80, 0.2)`.
- **Wall-jump:** `playTone('triangle', 300, 500, 60, 0.18)`.
- **Wall-grab latch:** `playTone('triangle', 180, 160, 40, 0.12)`; **stamina-out gasp:** `playNoise(80, 'lowpass', 300, 0.25)`.
- **Wall-slide:** while `wall?.kind === 'wallSlide' && wall.sliding`, gate `playNoise(20, 'highpass', 800, 0.05)`.
- **Dash:** `playNoise(60, 'bandpass', 1500, 0.18)`; **dash-into-wall thump:** `playTone('square', 120, 90, 70, 0.25)`.
- **Spring:** `playTone('sine', 300, 700, 90, 0.2)`; **dash-refill:** `playTone('triangle', 700, 1300, 50, 0.12)`.
- **Land (hard):** `playNoise(80, 'lowpass', 300, 0.3)`; (soft): `playNoise(50, 'lowpass', 250, 0.18)`.
- **Strawberry:** two-note arpeggio — `playTone('triangle', 600, 1200, 60, 0.15)` twice ascending.
- **Death:** `playNoise(120, 'lowpass', 400, 0.3)` + descending `playTone('sine', 400, 80, 200, 0.25)`.
- **Respawn:** rising `playTone('sine', 200, 600, 100, 0.18)`.

---

## 11. File Layout (Suggested)

```
src/
  main.ts              # boot: load LDtk + tilesets, canvas, store, audio.unlock, loop.start()
  ldtk.ts              # parseLdtkProject, buildLdtkTilesetBundle, per-room translate+compile cache
  camera.ts            # per-room VirtualCamera config, fitZoom, createCameraBrain/updateCameraBrain, resetRoomCameraBrain
  transition.ts        # pure transitionFor / entryPoint (LDtk __neighbours)
  game/
    state.ts           # CelerockSave (collectibles: Record<levelIid, CollectibleSave>, deaths), World/Room runtime
    step.ts            # fixed-step: input → stepPlatformer → pickups → audio → brain
    render.ts          # drawLdtkLevel (the tileset) + player art + entities + particles + UI
    player.ts          # procedural player render: face/hair/feet + facing mirror (kernel does physics)
    hazards.ts         # hazard AABB check (static + moving-platform-child) + respawn flash
    collectibles.ts    # strawberry wiring: derivePickups → collect → writeSave (keyed by level.iid)
    checkpoints.ts     # checkpoint activation + respawn logic
  input.ts             # createKeyboardAdapter + createTouchButtonSet + createGamepadAdapter + orEdges
  audio.ts             # createAudioAdapter + the SFX recipe helpers
  save.ts              # createLocalStorageSaveStorage + loadSave / writeSave
```

No `rooms/` directory, no ASCII grids, no `tile-style.ts` — the LDtk file is the source of geometry and the tileset is the source of art.

---

## 12. Tests & Static Contracts

### 12.1 LDtk Load Smoke Test

- `parseLdtkProject` does not throw on the supplied `.ldtk`; `project.levels.length >= 1`.
- The start level translates: `ldtkLevelToLevelData(startLevel, project).level` is defined and passes through `compileGeneratedLevel` with the player config.
- At least one level has a `Player`/`Spawn` entity; at least one has a collectible or hazard (otherwise the runtime has nothing to do — acceptable, but log it).

### 12.2 Dash-into-Wall Hit-Stop Timing

- Script: place the player 2 tiles left of a solid wall, trigger a rightward dash.
- Assert: on the contact tick, `state.abilities.dash` becomes inactive AND `isHitStopActive(hitStop)` is true for ≥4 ticks AND `shakeEnvelope` is non-zero.
- Assert: the player's `state.core.x` never exceeds the wall's left edge by more than the kernel's penetration tolerance (the dash never phases through).

### 12.3 Room-Transition Smoke Test

- Drive scripted input from the start room's spawn across a `__neighbours` edge into a linked room.
- Assert: after the transition, `active.ldtkLevel.iid` is the neighbour's; the player's `vx`/`vy`/`facing` are preserved across the seam; the brain's active vcam is the new room's (no exception, no NaN position).

### 12.4 Strawberry Persistence

- Collect a strawberry in a room, cross into a neighbour, reload the page (re-run `loadSave`).
- Assert: `hasCollected(save.collectibles[levelIid], String(strawberryId))` is true; the strawberry is skipped in `derivePickups`'s `remaining`.

### 12.5 Death-Counter Persistence

- Die 3 times across rooms. Reload.
- Assert: `save.deaths === 3`.

### 12.6 Simulation Determinism

- Run 600 ticks of the fixed-step with a fixed input script from the start spawn. Record final `state.core.{x,y,vx,vy}`.
- Re-run. Final state must be byte-identical.
- Re-run the same script with a dash input at tick 120. Re-run. Byte-identical.

### 12.7 Acceptance Criteria

1. Playable in the browser via `npm run dev` with keyboard (`←→`/`A D`, `Space` jump, `Shift`/`ShiftLeft` dash, `K` grab) **and** on-screen touch buttons on coarse-pointer devices (via `createTouchButtonSet`).
2. **Loads the supplied LDtk + tileset** and renders the tileset through `drawLdtkLevel` (pixel-crisp, untinted).
3. The Celeste kit is present: **dash (8-dir, startup freeze, refills on land) + wall-grab/stamina + wall-slide + wall-jump + dash-tech + springs.** **No `doubleJump`.**
4. The **camera brain** drives the view (deadzone follow + per-room vcam + cut/blend on transition). No legacy `createCamera`/`updateCamera`.
5. Room-to-room travel is **seamless via `__neighbours`**, momentum preserved; the camera does not pop between rooms.
6. The **dash-into-wall** moment narrows the dash ability state, then applies hit-stop and shake (§12.2).
7. Strawberries persist across page reload via `createLocalStorageSaveStorage` + `writeSave` (keyed by `level.iid`).
8. Death counter increments every respawn and persists through the same save adapter.
9. `prefersReducedMotion` renders the start room statically and never calls `loop.start()`.
10. **Zero duplicate engine systems**: no direct animation-frame loop, no random authoritative simulation, no manual collision resolver, no manual tile-blit loop, no legacy camera.
11. **No moonwalk.** Walking left faces left (`ctx.scale(facing, 1)` around the body draw).
12. **No appendage blow-out.** Hair uses `advanceSpringRod`, never raw `advanceSpringChain`.

### 12.8 Forbidden Patterns

Static analysis (grep / AST) must find **none** of these in game code:

- **No `createCamera` / `updateCamera`** (the legacy follow camera) — use the camera brain.
- **No `doubleJumpEnabled` / `doubleJumpAbility`** — Celeste has no double jump.
- **No `compileLevel` with hand-built `LevelData` tiles** — use `ldtkLevelToLevelData` + `compileGeneratedLevel`.
- **No hand-authored ASCII level grids** / no `buildRoomTiles` — geometry comes from LDtk.
- **No `requestAnimationFrame`** in game code (only in the engine's `createGameLoop`).
- **No `Math.random` / `Date.now`** in game code.
- **No manual gravity/stamina/dash-counter integration** (`vy += gravity * dt`, slide timers, dash-frame counters) — all movement goes through `stepPlatformer(..., config)` or `createPlatformerController(pipeline, config).step(...)`.
- **No tile-art recoloring** — tiles are drawn solely through `drawLdtkLevel` (no per-tile `fillRect`/`fillStyle` overrides on level tiles).
- **No `advanceSpringChain`** outside `node_modules` (hair uses `advanceSpringRod`).
- **No deep imports** (no `aicraft-engine/src/...` — only the root barrel).

---

## 13. Visual & Play Gates

Before the build is accepted:

1. **Screenshot of the game playing the supplied LDtk** — the tileset renders pixel-crisp and untinted; the camera brain deadzone-follows the player smoothly.
2. **Screenshot of a room-to-room transition** — verify no jarring camera pop and that momentum carries across the seam.
3. **Stamina/grab in action** — a shot of the player wall-grabbing (stamina draining) and climb-hopping off.
4. **Manual playthrough** across every room the LDtk contains; verify dash, wall-slide, wall-jump, and springs all feel Celeste-tight.
5. **Dash-into-wall** fires hit-stop + shake on ≥90% of attempts (it is a deterministic mechanic, not a precision one).
6. **Fast checkpoint retry:** <2 seconds from death to controllable respawn.

### Rejection Criteria

- **Tileset recolored or overpainted.** Tiles drawn with custom `fillRect`/tints instead of `drawLdtkLevel`.
- **Legacy camera.** The view driven by `createCamera`/`updateCamera` instead of the brain.
- **Double-jump present.** `doubleJumpEnabled` on, or a second air-jump observable in play.
- **Camera pops between rooms.** No brain cut/blend policy — the view snaps jarringly on every `__neighbours` crossing.
- **Momentum lost at the seam.** The player's `vx`/`vy`/`facing` reset to zero on room entry instead of carrying across.
- **Hand-authored fallback rooms.** ASCII grids or a `buildRoomTiles` template committed "just in case" the LDtk is missing — defeats the LDtk sourcing.
- **Silent dash-into-wall.** The signature Celeste beat must fire `triggerHitStop` + `sineShake` on contact.
- **Hand-rolled movement.** A slide timer, a dash-frame counter, or a stamina drain written in game code instead of using `wallSlideAbility` / `dashAbility` / the wall-grab ability.

---

## 14. Anti-Failure Wording

**This build is NOT complete merely because it renders the LDtk tiles.** It is complete when those tiles are drawn faithfully *and* the game plays like Celeste through the latest engine systems.

- **Drawing the tileset with custom recoloring is a failure.** The supplied tileset is the visual identity. Replacing it with `fillRect` boxes or tinting it per room is the same failure mode as the old "six grey boxes." Render through `drawLdtkLevel`, untouched.
- **Using the legacy camera is a failure.** `createCamera`/`updateCamera` is superseded. The camera brain — vcams, deadzone follow, blends — is the only acceptable view driver.
- **Enabling double-jump is a failure.** Celeste has no double jump. The kit is dash + grab/stamina + wall-slide + wall-jump + dash-tech. If `doubleJumpEnabled` is on, it is not Celeste.
- **A jarring camera pop between rooms is a failure.** Room transitions must use the brain's cut/blend policy: cut position into the destination-local origin, ease the lens from the old zoom to the new `fitZoom`.
- **Losing momentum at a `__neighbours` seam is a failure.** The player must carry `vx`/`vy`/`facing` across the seam — Celeste's rooms are continuous, not teleporting.
- **Hand-authoring fallback ASCII rooms is a failure.** Geometry comes from LDtk. A committed `rooms/*.ts` of ASCII grids defeats the entire point of this revision.
- **Hand-rolling a wall-grab stamina timer or a dash-frame counter is a failure.** Those are the kernel's `wallGrabAbility` and `dashAbility`. If you find yourself writing them, STOP.
- **A silent dash-into-wall is a failure.** The bonk is the signature Celeste feel beat. Missing `triggerHitStop` + `sineShake` on contact = the runtime does not teach dash feel.

---

## 15. Implementation Workflow

Build in this order. Each stage must pass its gate before the next begins.

### Stage 1: LDtk Load + Tileset + Camera Brain Graybox
1. Vite + TypeScript + `aicraft-engine@0.6.0`.
2. Fetch + `parseLdtkProject` the supplied `.ldtk`; `buildLdtkTilesetBundle` the supplied PNG(s).
3. `ldtkLevelToLevelData` + `compileGeneratedLevel` the start room; `drawLdtkLevel` it.
4. Wire `createCameraBrain` + a per-room follow `VirtualCamera` (deadzone bands, `fitZoom`).
5. Drive the kernel with `PRECISION_PLATFORMER` (no Celeste opt-ins yet) so a box walks and jumps across the tileset.
6. **Gate:** the supplied tileset renders pixel-crisp and untinted; the camera brain deadzone-follows; the player does not moonwalk.

### Stage 2: Celeste Movement Feel
1. Apply the full `playConfigFor` kit: `wallGrabEnabled`, `climbEnabled` (if ladders), `groundDuckEnabled: false`, `stepHeight`, dash/grab key bindings.
2. Verify dash (startup freeze, 8-dir, refill on land), wall-slide (decaying), wall-jump, wall-grab (stamina, climb, climb-hop), springs, dash-tech.
3. **Gate:** all five core abilities demonstrably work in the supplied rooms. Stamina drains and refills. Dash refills on land.

### Stage 3: Seamless Room Transitions
1. Implement pure `transitionFor` / `entryPoint`; compile neighbour rooms lazily and cache by `iid`.
2. Preserve `vx`/`vy`/`facing` across the seam; reset contacts.
3. `resetRoomCameraBrain` on transition (cut position, ease zoom).
4. **Gate:** walking/falling/jumping off a room edge flows into the next room with momentum; the camera does not pop.

### Stage 4: Hazards + Strawberries + Save
1. Hazard AABB checks (static + moving-platform-child); death → hit-stop → respawn at last checkpoint.
2. `derivePickups` → `collect` → `writeSave` per room, keyed by `level.iid`.
3. Death counter increment + persistence.
4. **Gate:** hazards kill and respawn correctly; strawberries persist across reload; death counter persists.

### Stage 5: Juice + Polish
1. Dash-into-wall hit-stop + shake; hard-landing shake; landing dust; dash trail.
2. Squash & stretch (`advanceSquash`); spring-rod hair; parallax background.
3. Stamina bar UI; room title cards; HUD (death counter).
4. **Gate:** the game feel matches Celeste-tight. The dash-into-wall bonk is satisfying. Grab/stamina reads clearly.

### Stage 6: Audio
1. `createAudioAdapter` + all §10 cues; unlock on first gesture.
2. **Gate:** every ability has a distinct cue; reduced-motion path creates no audio adapter.

### Stage 7: Verification
1. Run all static contracts (§12): load smoke, dash-into-wall timing, transition smoke, persistence, determinism.
2. Grep for forbidden patterns (§12.8).
3. Capture the §13 screenshots.
4. **Gate:** all tests pass; no forbidden patterns; screenshots confirm faithful tileset + Celeste feel.

---

## 16. Stretch Goals (only after criteria 1–12)

- **Supplied player sprite sheet.** Swap the procedural player art for a sprite bundle and select frames from physics via `deriveSpriteAnimKind` (the `showcase/sections/ldtk-editor/play.ts` sprite-bundle + `drawPlayerSprite` path). The collision body stays the narrow `0.5 × 1.5` tile box.
- **"Focus" virtual camera.** A second vcam with higher `priority` that takes over for vistas, reveals, or boss moments (a `fixed` body or tighter follow), blended in/out via the brain's priority selection.
- **Badeline chase ghost (visual only):** render a tinted "ghost" whose input snapshot is the player's from N frames ago — buffer the last N `PlatformerInput`s in a ring, replay them through a second kernel instance each tick. No new physics code.
- **Cosmetic hair colour unlocks** via `generateSkinVariants` + `createMemoryIAPAdapter` from the `cosmetics` + `iap` pillars.
- **Per-room seeded palette** for parallax/UI accents via `generatePalette`, kept strictly off the level tiles.

---

## 17. Preserved Constraints

- **Reduced-motion early gate** — `prefersReducedMotion()` checked before audio setup; renders one static frame of the start room; creates no audio adapter, no loop.
- **Touch + keyboard + gamepad input** — `createKeyboardAdapter` + `createTouchButtonSet` + `createGamepadAdapter` + `orEdges`.
- **DPR / pixel scaling** — `resizeCanvasToBackingStore` + `image-rendering: pixelated`.
- **Fixed-step sim** — `createGameLoop({ fixedDt: 1/60 })`.
- **Camera brain, not legacy** — `createCameraBrain` + `updateCameraBrain` + per-room `VirtualCamera`. Never `createCamera`/`updateCamera`.
- **Celeste-faithful config** — `PRECISION_PLATFORMER` + `wallGrabEnabled` + dash + dash-tech + springs. **No `doubleJumpEnabled`.**
- **LDtk-only geometry** — `parseLdtkProject` + `ldtkLevelToLevelData` + `compileGeneratedLevel`. No hand-authored rooms.
- **Tileset rendered verbatim** — `drawLdtkLevel` only; no recolor/overpaint of tile art.
- **Seamless `__neighbours` room flow** — momentum preserved; no win/next FSM loop.
- **`collectibles` + `save` only** — never hand-roll "is this strawberry collected"; always `derivePickups` → `collect` → `writeSave`.
- **Spring rod, never spring chain** — `advanceSpringRod` for hair.
- **Zero runtime deps** — `aicraft-engine` is the only dependency.

---

## 18. Install & Version

```bash
npm install aicraft-engine@0.6.0
```

`aicraft-engine@0.6.0` contains the systems this revision depends on and that `0.4.0` lacks:

- **Camera brain** — `createCameraBrain`, `updateCameraBrain`, `VirtualCamera`, deadzone follow, blends, bounds + letterbox (commit `6c42d24`).
- **LDtk loader** — `parseLdtkProject`, `ldtkLevelToLevelData`, `drawLdtkLevel`, `buildLdtkTilesetBundle`, `LDTK_DEFAULT_ENTITY_MAP`.
- **Phase 0–9 movement overhaul** — single `core.vy` authority, `LaunchIntent` arbitration, shared `LocomotionState`, decaying wall-slide, 8-dir dash + startup freeze, dash-tech (super/hyper/wavedash/duck), wall-grab + stamina + climb-hop, corner correction, springs/dash-refills, analog `moveX` (commit `de3c334`).
- **`groundDuckEnabled` opt-out** (commit `340a25f`) — keeps Down responsive for ladders/fast-fall/dash-aim while preserving ability-owned duck tech.

The camera-brain blend fixes also shipped in `0.6.0` — blend continuity when a vcam source is removed, `dt=0` treated as a no-op, and blend-clamp crossfade correctness (directly relevant to the §5.5 room-transition cut/blend policy).

Do not pin below `0.6.0`.

---

## 19. Summary of Key Changes from the Previous Brief

| Aspect | Previous (0.4.0) | This brief (0.6.0) |
|---|---|---|
| Level geometry | 6 hand-authored ASCII room grids | **Supplied LDtk file** (`parseLdtkProject` + `ldtkLevelToLevelData`) |
| Tile art | Bespoke "connected-terrain" renderer (6 motifs, neighbor bitmasks) | **Supplied tileset** via `drawLdtkLevel` — drawn verbatim, no recoloring |
| Level compile | `compileLevel(levelData, { tileTypeMap })` | `compileGeneratedLevel({ level, tileSemantics }, …)` |
| Camera | Legacy single follow-camera (`createCamera`/`updateCamera`) | **Camera brain** — per-room `VirtualCamera`s, deadzone follow, blends/cuts |
| Room flow | `goalRect → win → "Cleared" card → next → roomIndex` FSM loop | **Seamless LDtk `__neighbours`** transitions, momentum preserved |
| Movement kit | `defaultPrecisionPipeline` + **`doubleJumpEnabled: true`** | **Celeste-faithful**: `PRECISION_PLATFORMER` + `wallGrabEnabled`/stamina + 8-dir dash + dash-tech + springs — **no double-jump** |
| Room design | Fixed 6-room technique ladder with per-room specs + content-counts table | **Generic — trusts the supplied LDtk** (light contract in §5.6) |
| Collectible scoping | `collectibles['room-N']` by hand index | `collectibles[level.iid]` keyed by LDtk level id |
| Tests | Unique `fnv1a` room hashes, ASCII dimension checks, 6-room content-counts, 6 E2E scripts | LDtk load smoke, dash-into-wall timing, **room-transition smoke**, persistence, determinism |
| Forbidden patterns | `stepPlatformer`, manual gravity, ASCII shared template, full-tile outlines | + **legacy camera**, **`doubleJump*`**, **hand-built `LevelData`**, **tile-art recoloring** |
| Version | `aicraft-engine@0.4.0` | `aicraft-engine@0.6.0` |

---

**Build order:** LDtk load + tileset + camera brain graybox → Celeste movement feel → seamless `__neighbours` transitions → hazards + strawberries + save → juice + polish → audio → verification.

**The game is not done when the LDtk renders. It is done when the supplied tileset is drawn faithfully, the camera brain deadzone-follows and cuts cleanly between rooms, the Celeste kit (dash + grab/stamina + wall-slide + wall-jump + dash-tech) all feel tight, the dash-into-wall bonk fires hit-stop and shake, and a human player can traverse the supplied LDtk end-to-end.**
