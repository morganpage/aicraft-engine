# Celerock — A Celeste-like Precision Platformer that Plays a Supplied LDtk Level on `aicraft-engine@0.16.0`

> Paste this entire document to a coding agent (Claude / Cursor / etc.). It is a complete, self-contained build brief. **The level, the tileset, and the player sprite ship with this brief — download them from the links in §1.1 (all CC0).** The agent produces a single runnable Vite + TypeScript browser game that loads those assets and plays them like *Celeste* — importing everything movement, camera, level, and presentation-related from `aicraft-engine` (the npm package) and writing **no** re-implementations of what the engine already provides. The agent does **not** author level geometry: rooms, tiles, hazards, and collectibles all come from the LDtk file. (A user may substitute their own `.ldtk` + tileset; everything below is written against the LDtk *format*, not against these specific rooms, so the build works either way. Where the bundled pack's exact contents matter, §1.1 and §5.6 say so.)

---

## 0. What You Are Building

**Celerock** — a precision-platformer runtime in the *Celeste* aesthetic. A young mountaineer traverses the rooms of a supplied LDtk level with the authentic Celeste kit: a variable-height jump, a single 8-directional dash that refills on landing, a wall-grab bound to a stamina meter (cling, climb up/down, climb-hop off), wall-slide, wall-jump, and the dash-tech follow-ups (super jump, hyper/wavedash, duck super jump). The feel target is **Celeste-tight**: dash startup freeze, hit-stop on dash-into-wall, screen shake on hard landings and bonks, spring launches, fast-fall, corner correction, instant respawn, and a strawberry counter that persists across reloads. Rooms are not authored by the game — they are walked through, and the player flows from one LDtk room to the next across the level's `__neighbours` seams with momentum preserved, exactly as Celeste's rooms connect. And the level-design loop is live: **saving the `.ldtk` while playing hot-swaps the edited world into the running game with the player's state preserved** (§5.7) — dev-time LDtk hot reload is standard scope here, not a stretch goal.

**This is NOT a tech demo and NOT a hand-authored level set.** The previous version of this brief failed because it (a) hand-wrote six ASCII room grids and a bespoke "connected-terrain" renderer instead of using a real tileset, (b) drove the view through the legacy single follow-camera instead of the camera brain, (c) enabled a `doubleJump` which is not a Celeste mechanic, and (d) gated progression behind a per-room "win → Cleared card → next" loop instead of Celeste-style seamless room transitions. This brief fixes every one of those: **geometry and tile art come from the supplied LDtk + tileset**, the **camera brain** with per-room virtual cameras owns the view, the **Phase 0–9 movement kernel** owns the authentic Celeste kit, and **LDtk `__neighbours`** own room flow.

**Non-negotiable: build the entire game on top of `aicraft-engine@0.16.0`.** Do not hand-roll the controller, fixed-step loops, collision, the camera, tile rendering, particles, jump arcs, locomotion, palettes, audio, feel thresholds, or room transitions — those are all in the engine. If you find yourself writing a horizontal-velocity clamp, a wall-slide timer, a dash-frame counter, a stamina drain, an unscaled landing-impact threshold, a camera lerp, a tile-blit loop, a room-transition slide, or `Math.random()` in the simulation, STOP and use the engine instead.

---

## 1. Tech Stack & Install

```bash
npm create vite@latest celerock -- --template vanilla-ts
cd celerock
npm install aicraft-engine@0.16.0
```

> This brief targets the published `0.16.0` API exactly. `0.16.0` is `0.15.0` plus the **entity-art pair (§7.1)**: `LdtkEntityDef.tileRenderMode` — the def's authored render mode, parsed (all seven LDtk schema values; defs omitting the key parse as `'FitInside'`) — and **`drawLdtkEntityTile(ctx, tile, dest, tilesets, mode?)`**, the engine-owned blit for an entity's authored display tile (`Repeat` tiles across resized instances, `Stretch`/`FitInside`/`Cover` scale; never throws). `0.15.0` is `0.14.1` plus the **room-transition session orchestrator** (`createRoomTransitionSession` / `pollRoomTransition` / `beginSessionRoomSlide` / `advanceSessionRoomSlide` / `endRoomTransitionSession` — one immutable `{ detector, slide }` state machine that makes the seam-transition invariants structural, §5.5), the **per-axis containment latch** on `detectLdtkRoomExit` (an exit additionally requires the body to have been fully contained once on that exit's crossing axis; straddle suppression is intrinsic and reset-immune — a discarded or fresh detector state cannot tick-tock), and the **preflight `multiRoom` flag** (`capabilities.multiRoom` — the multi-room signal `capabilities.exits` never was, since `exits` counts Exit ENTITIES, not `__neighbours` seam traversal). `0.14.1` is `0.14.0` plus the **flush-landing fix** (an exact-flush arrival — e.g. a full-height held jump's symmetric arc — fires its `landing` moment + `justLanded` one tick after contact, engine-side, so no game-layer landing compensation is needed). `0.14.0` ships the **direction-aware wall-jump** (into-wall slide+jumps launch straight up — a single wall is chimney-climbable; release the direction and jump within `wallJumpGraceTime` for the classic away leap; replay physics version 13). `0.13.0` ships the **sustained audio layer** — `startNoiseLoop(filterType, freq, peak)` returns a `NoiseLoopHandle` (`stop()` fades out over ~0.1 s, `setPeak()` live-adjusts loudness) for sounds that last as long as a state (the §10 wall-slide scrape), and `playNoise` bursts now start at a random offset in the shared noise buffer so overlapping/retriggered bursts de-correlate instead of phase-locking into a buzz. `0.12.0` ships the **seam-free LDtk surface cache** (`createLdtkLevelSurfaceCache` — bake each room once at native resolution, one blit per frame at any fractional zoom). `0.11.0` ships the follow-compatible destination view (`roomEntrySlideView`). `0.9.0` ships the **feel + traversal layer** (the structured feel channel `state.moments` — landing impact ratio/hard, one-shot dash bonks with normal + surface id, dashEnded context, grab/stamina pulses, spring/refill moments; the pure room-transition helpers `findLdtkRoomExit` / `mapLdtkRoomEntry` / `transitionPlatformerToRoom` / `rebasePointBetweenLdtkRooms`; the slide orchestrator `beginRoomSlide` + the camera-space rebases; the explicit camera fit `fitCameraZoom`) **and the mantle wave** (direction-aware grab+jump + ledge mantle). The `0.7.0` golden path (high-level LDtk loader, preflight, per-room compiler + cache, config scaler, input maps, solid-id helpers, spawn fix, loop `onError`) and the earlier camera-brain/LDtk/movement drops (`0.5.0`/`0.6.0`) all remain. Note the **compatibility breaks**: the replay physics version is 13 (v12 replays rejected — into-wall wall-jump trajectories changed on purpose) and a manually-constructed `PlatformerState` needs `moments: []`. Do not pin below `0.16.0`.

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
    type KeyboardConfig,                          // §4.3: Celeste's actual PC keyboard defaults

    // LDtk — THE level source for Celerock (geometry + entities + tile art)
    loadLdtkProjectAssets,                           // PREFERRED golden-path loader (fetch + decode + bundle)
    inspectLdtkPlatformerProject,                    // asset preflight: report spawn/caps/neighbours (G3)
    parseLdtkProject, ldtkLevelToLevelData,          // manual alternative (parse only; returns { ok, project, errors })
    drawLdtkLevel, drawLdtkLayer, buildLdtkTilesetBundle,  // render + (SYNC) tileset bundler
    drawLdtkEntityTile,                             // 0.16.0 §7.1: the entity display-tile blit (mode-authoritative)
    createLdtkLevelSurfaceCache,                     // 0.12.0: seam-free native-res room surfaces (§5.4)
    LDTK_DEFAULT_ENTITY_MAP,
    type LdtkProject, type LdtkLevel, type LdtkNeighbour, type LdtkTilesetBundle,
    type LdtkParseResult, type LdtkPlatformerProjectReport, type LdtkTranslateOptions,  // §5.2 entityMap override
    type LdtkEntityInstance, type LdtkTileRenderMode, type LdtkLevelSurfaceCache,  // §7.1 entity display tiles; §5.4 cache handle

    // platformer kernel — the Phase 0–9 Celeste kit
    PRECISION_PLATFORMER, defaultPrecisionPipeline, DEFAULT_PLATFORMER_CONFIG,
    createPlatformerState, stepPlatformer,
    compileGeneratedLevel,                       // use this for LDtk-translated levels (carries tileSemantics)
    compileLdtkRoom, createLdtkRoomCache,        // PREFERRED per-room compiler + lazy iid cache (no hand-rolling)
    scalePlatformerConfig, createPrecisionPlatformerConfig,  // unit-aware tile-scaling (no hand-rolled * tileSize/16)
    solidIdForEntity, entityIdFromSolidId,       // entity solids use 'entity-<id>' (NOT 'solid-'); tile solids are 'tile-…'
    settlePlatformerState,                       // recovery helper for embedded/legacy spawns (not needed for LDtk)
    IDLE_EDGE, STANDARD_KEYBOARD_PLATFORMER_MAP, STANDARD_GAMEPAD_PLATFORMER_MAP,  // exported; gamepad uses W3C index strings
    advanceSquash, DEFAULT_SQUASH_CONFIG, IDENTITY_SCALE, EMPTY_CONTACTS,
    advanceMovingPlatform, movingPlatformToSolid, createMovingPlatformDisplacementProvider,
    type SolidDisplacementProvider,
    drawActor, drawLevelEntity, DEFAULT_ENTITY_PALETTE,   // §7.1: entity art, LDtk tile first
    type DrawLevelEntityOverrideMap, type EntityPalette,  // §7.1: the per-kind draw override
    jumpAbility, wallSlideAbility, dashAbility,
    type PlatformerConfig, type PlatformerState, type PlatformerInput,
    type CompiledLevel, type CompiledMovingPlatform, type LevelEntity,
    type CompiledLdtkRoom, type LdtkRoomCache,

    // room transitions — the seam-traversal session + composition layer (§5.5)
    createRoomTransitionSession, pollRoomTransition,
    beginSessionRoomSlide, advanceSessionRoomSlide, endRoomTransitionSession,
    roomEntrySlideView, presentationForRoomSlide, ROOM_SLIDE_VCAM_ID,
    mapLdtkRoomEntry, transitionPlatformerToRoom, rebasePointBetweenLdtkRooms,
    findLdtkRoomExit, detectLdtkRoomExit, createRoomExitDetectorState,
    type LdtkRoomExit, type LdtkRoomEntry,

    // camera brain — Cinemachine-style vcams, blends, deadzone follow
    createCameraBrain, updateCameraBrain, fitCameraZoom,                 // cover-fit per-room zoom (§5.4)
    DEFAULT_CAMERA_MOTION, DEFAULT_LENS_MOTION, DEFAULT_BRAIN_BLEND_DURATION,
    type CameraBrain, type CameraBrainOptions, type VirtualCamera,
    type CameraTarget, type CameraBounds,

    // collision (only for hazards — the player uses the kernel)
    aabbOverlap, tileToWorld, worldToTile, type Rect,

    // collectibles (the strawberry pillar)
    collect, hasCollected, derivePickups,
    type CollectibleSave, type CollectibleEntity, type CollectibleKind,  // §7: the union is closed

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

    // sprite pipeline (the supplied Player.png renderer — §4.4)
    parseSpriteSheet, compileSpriteSheet,
    deriveSpriteAnimKind,
    createSpriteAnimState, advanceSpriteAnim, currentFrameIndex, animTotalDuration,
    drawSprite,
    type SpriteSheetJSON, type CompiledSpriteSheet, type CompiledAnim,
    type SpriteAnimState, type SpriteAnimKind, type SpriteAnimInputs,
    type DrawSpriteOptions,

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

    // easing + tween (death-and-respawn flash, room-transition slide/cards)
    easeOutCubic, easeOutBack, easeInOut,                 // NOTE: easeInOutCubic is NOT exported — compose easeInOut(easeOutCubic)
    createTweenState, advanceTween,

    // audio + rng + palette
    createAudioAdapter,
    mulberry32, nextInt, nextFloat, pick,
    generatePalette, resolvePalette, repairContrast, lerp, type Palette,
  } from 'aicraft-engine';
  ```
  Tree-shaking works because every export has `sideEffects: false`. Never deep-import subpaths like `aicraft-engine/platformer` or `aicraft-engine/src/...` — use the root barrel.

> **Do not import** the legacy single follow-camera (`createCamera` / `updateCamera`) — it is superseded by the camera brain. **Do not import** `doubleJumpAbility` / `doubleJumpEnabled` — Celeste has no double jump. **Do not import** `compileLevel`, `canonicalize`, `fnv1a`, or `LEVEL_VERSION` — those serve hand-authored `LevelData`; geometry here comes from LDtk via `ldtkLevelToLevelData` + `compileGeneratedLevel`.

### 1.1 The bundled assets — download these first

Three files. Fetch them **at scaffold time** into `public/`, all three flat in the same directory — the LDtk project references its tileset as the bare sibling name `celerock.png`, so nesting the PNG anywhere else breaks the load. Do **not** fetch these from GitHub at runtime (CORS + offline); they are project assets, served by Vite from `public/`.

```bash
BASE=https://raw.githubusercontent.com/morganpage/aicraft-engine/main/games
mkdir -p public   # --output-dir does not create missing directories (curl ≥ 7.73)
curl -fsSLO --output-dir public "$BASE/celerock.ldtk"
curl -fsSLO --output-dir public "$BASE/celerock.png"
curl -fsSLO --output-dir public "$BASE/Player.png"
```

| File | What it is |
|---|---|
| `celerock.ldtk` | The level — 5 rooms, single file (`externalLevels: false`), LDtk `jsonVersion` 1.5.3 |
| `celerock.png` | The tileset — 1024×1024, 8px tiles, referenced by the `.ldtk` as `celerock.png` |
| `Player.png` | The player sheet — 160×128, the 10×8 grid of 16×16 frames §4.4 specifies |

**Verify the download before building anything.** These values are what the shipped pack actually contains — a mismatch means a truncated or substituted file, not a bug to code around:

- `project.levels.length === 5`, every level 320×184 px on an 8px grid (40×23 tiles).
- Exactly one tileset def, `relPath === 'celerock.png'`.
- `inspectLdtkPlatformerProject(project).totalSpawns === 1` — the single authored `Player` spawn lives in `Level_0`.
- The five rooms form one **west→east chain** (`Level_0 … Level_4`) with **vertical offsets between them** (`worldY` 0, 0, −72, −40, −56). Seams are partial, not flush — the room-transition path (§5.5) has to rebase, and a build that only handles aligned seams will visibly break here.
- `getStartRoom()` → `{ ok: true }`, `room.spawn.source === 'authored'`, and the compile emits **zero diagnostics**.

**What the pack contains, and what it does not.** The preflight capability matrix for this file is fixed and known:

| Capability | Present | Notes |
|---|---|---|
| `hazards` | ✅ | 6 `Spike` entities — 1 in `Level_0`, 5 in `Level_4` |
| `collectibles` | ✅ | 1 `Gem` strawberry, in `Level_0` |
| `multiRoom` | ✅ | 5 rooms, all `connected` |
| `springs` | ❌ | entity def exists, no instances placed |
| `dashRefills` | ❌ | entity def exists, no instances placed |
| `exits` | ❌ | no `Goal`/`Exit` ENTITIES — `capabilities.exits` counts Exit entities, NOT `__neighbours` seam traversal; the world is still a 5-room chain (see the world contract below) |
| `ladders` | ❌ | the IntGrid has a single value, `1: walls` — no `passthrough` one-ways either |
| `movingPlatforms` | ❌ | §5.3 is dead code for this pack |

Wire the capability-gated systems anyway (they cost nothing when the buckets are empty, and they light up if a user swaps in a richer `.ldtk`), but **do not treat their absence as a defect to fix, and do not author entities into the `.ldtk` to make them fire.** The §9 juice items for springs and dash-refills are unverifiable against this pack; say so in the report rather than faking them.

**World contract (CORE SCOPE, not emergent).** The supplied LDtk is a **five-room chained mountain** — `Level_0` … `Level_4`, each linked to its cardinal neighbours via `__neighbours` (the verify block above: one west→east chain with vertical offsets). Traversal from the start room to the **final room's summit** is the win condition and is **core scope**: a build that renders one room is a failure regardless of what `capabilities.exits` reports (`exits` counts Exit ENTITIES, not `__neighbours` seam traversal — it is `false` for this pack even though the full chain exists). The §12.1 load smoke test and §12.3 transition smoke test exist to prove traversal; §14 Stage 3 is not skippable, and a single-room build cannot pass its gate. **Completion is structural, not authored:** the **terminal room** is the level with NO `e` neighbour in `__neighbours` — derived from the project at boot (`Level_4` in the shipped pack; never hardcode the identifier). On seam-entry into the terminal room, fire the chapter-complete card via the existing tween path (`createTweenState` + `easeOutBack`) and transition the FSM however the game already handles completion. No `Goal` entity is created, the `.ldtk` is never edited, and the FSM `win` event stays unused (§8, §12.7 criterion 15).

> **Licensing.** All three files are **CC0 1.0 Universal** (public domain dedication — no attribution required, commercial use fine). `celerock.png` is from [Tranquil Tunnels](https://octoshrimpy.itch.io/tranquil-tunnels) by octoshrimpy; `Player.png` is from [Deep Night](https://v3x3d.itch.io/deep-night) by VEXED. Credit them anyway if you ship this — CC0 does not require it, but it is the decent thing to do.

---

## 2. Determinism & Discipline Rules (enforced by the engine — follow them)

- **Fixed-step sim, variable render** via `createGameLoop({ fixedDt: 1/60, step, render })`. Poll input **exactly once per `step`**. Pass an `onError: (error, { phase }) => { ... }` handler (and optionally `errorPolicy`) so a throw inside your `step`/`render` can never silently freeze the loop on its last frame — that exact bug froze a prior build at tick 5314 with the last frame stuck on screen and no way for the host to detect it. The default policy is `'stop'` (which at least makes the failure observable via `loop.stoppedDueToError`); prefer wiring `onError` to your own error surface.
- **No `Math.random()` and no `Date.now()` ANYWHERE in game code** — not in the simulation AND not in decorative audio/visual/particle code. Use seeded `mulberry32(seed)` → `nextInt` / `nextFloat` / `pick` for both authoritative AND decorative randomness; pass an explicit `rng` to anything that needs jitter. (A textual `Math.random` anywhere trips the §12.8 static-analysis grep — keep the rule simple and absolute.) Time comes from `tick` or the loop's `dt`.
- **Defensive host access.** Anything touching `window`/`AudioContext`/`matchMedia`/`fetch`/`Image` goes through the engine's adapters (`createAudioAdapter`, `prefersReducedMotion`, `resizeCanvasToBackingStore`, `createLocalStorageSaveStorage`) or a lazy, error-swallowing loader of your own — never bare at import time.
- **Reduced motion.** Gate the loop: if `prefersReducedMotion()`, render one static frame of the first room and never call `loop.start()`.
- **Pure progression ops.** The kernel and `collect`/`hasCollected` already return new objects — follow their lead. Never mutate `PlatformerState` or `CollectibleSave` in place.
- **Draw the supplied tileset verbatim.** Render tiles only through the **surface cache** (`createLdtkLevelSurfaceCache`, which bakes each room verbatim via `drawLdtkLevel`). Do **not** recolor, tint, palette-swap, or procedurally overpaint the tile art — the supplied tileset *is* the visual identity of the game. Cosmetic `shade`/`mixHex` is for the player body, hair, parallax, and UI only, never for level tiles.

---

## 3. Architecture — Engine Module → Game System Map

| Game system | Engine API |
|---|---|
| Game loop (60 Hz fixed) | `createGameLoop`, `DEFAULT_FIXED_DT` |
| Keyboard / touch / gamepad input, edge merging | `createKeyboardAdapter`, `createTouchButtonSet`, `createGamepadAdapter`, `orEdges` |
| **Asset preflight (G3)** | `inspectLdtkPlatformerProject(project)` — pure; reports levelCount, per-room spawn/tileSize/entityCounts/neighbours/connected, aggregated `capabilities` (hazards/collectibles/springs/dashRefills/exits/ladders/movingPlatforms/multiRoom), spawn-less/disconnected rooms, unknown trigger ids. **Missing optional content is informational, NOT a failure.** |
| **Load the supplied LDtk project** | **PREFERRED** `loadLdtkProjectAssets({ projectUrl, assetBaseUrl?, imageTimeoutMs?, fetch?, decodeImage? })` → `{ ok, project, tilesets, diagnostics }` (handles URL-encoding of spaces/brackets, bounded decode, skip-LdtkIcons, defensive host access). **Manual alternative:** `parseLdtkProject(text)` → `{ ok, project?, errors }` (destructure + check `ok && project`) then SYNC `buildLdtkTilesetBundle(tilesets, loadImage)` whose `loadImage` returns `CanvasImageSource \| undefined` (NOT a Promise). |
| **Translate an LDtk level → engine geometry** | `ldtkLevelToLevelData` (IntGrid → solidity by value *name*; entities → engine entities via `LDTK_DEFAULT_ENTITY_MAP`) |
| **Compile a room for play (PREFERRED)** | `compileLdtkRoom(ldtkLevel, project, options?)` → `CompiledLdtkRoom` with bucketed `solids`/`hazards`/`collectibles`/`springs`/`dashRefills`/`exits`/`enemies`/`ladders` + resolved `spawn`. Wrap a whole project in `createLdtkRoomCache(project, options?)` for lazy per-`iid` compile + `getStartRoom()`. (Low-level: `compileGeneratedLevel({ level, tileSemantics }, { config, playerWidth, playerHeight })` — note `CompiledLevel` has **no `.entities` field**; read entities from the translated `level.entities` or from the room buckets.) |
| **Render the supplied tileset** | `createLdtkLevelSurfaceCache` (bakes via `drawLdtkLevel` / `drawLdtkLayer`) + `buildLdtkTilesetBundle` |
| **Tile-unit config scaling** | **PREFERRED** `scalePlatformerConfig(config, scale)` / `createPrecisionPlatformerConfig({ tileSize, referenceTileSize?, jumpApexTiles?, timeToApex?, coyoteTime?, wallGrabEnabled?, climbEnabled? })` — unit-aware (distances/velocities/accelerations scale; times/ratios/counts/booleans don't) and re-pegs jump-relative impulses. `PlatformerConfig` is FLAT (`dashEnabled`/`dashSpeed`/`wallSlideEnabled`/`wallJumpVx`/… top-level; only `jump:` and optional `squash:` are nested). |
| **Solid-id helpers** | `solidIdForEntity(id)` / `entityIdFromSolidId(solidId)` — entity solids are `entity-<id>` (NOT `solid-`); tile-derived solids are a separate `tile-…` namespace (not reversible). |
| **Spawn resolution** | `compileGeneratedLevel`/`compileLdtkRoom` resolve the LDtk FEET-CENTER spawn to the AABB top-left via `spawnResolution:'rest-on-surface'` (the LDtk default) — the player rests on the surface, **no floor embed, no hand-rolled settle**. `settlePlatformerState(state, solids, config?, maxSteps?)` is a recovery tool for legacy/embedded spawns only. |
| **Player controller (jump + wall-slide + wall-jump + dash + wall-grab/stamina/climb-jump/mantle + dash-tech)** | `PRECISION_PLATFORMER` + `stepPlatformer(state, input, solids, dt, config?, getSolidDisplacement?)` → `{ state }` — boolean event pulses (`justLanded`/`justLaunched`/`hitCeiling`/`hitWall`/`startedWallSlide`/`wallJumpLaunched`/`dashStarting`/`dashStarted`/`doubleJumped`/`climbJumpLaunched`/`mantled`) are on **`state.events`**; spring/dashRefill `interactions` (each carrying an `entityId` solid id) are on **`state.interactions`**; structured FEEL moments (landing impact ratio/hard flag, dash bonks with normal + surface id, dashEnded context, grabLatch/staminaExhausted, springLaunch/dashRefill) are on **`state.moments`**. **Do NOT hand-roll velocity, stamina, collision, or feel thresholds.** |
| Moving-platform rooms | `advanceMovingPlatform`, `movingPlatformToSolid`, `createMovingPlatformDisplacementProvider(current, previous)` — pass the provider as the **6th positional arg** to `stepPlatformer` so platforms carry the player. |
| **Camera brain (per-room vcams, deadzone follow, blends)** | `createCameraBrain`, `updateCameraBrain`, `VirtualCamera` — **do NOT use the legacy `createCamera`/`updateCamera`** |
| **Room-to-room transitions** | LDtk `__neighbours` — engine-owned **session orchestrator** `createRoomTransitionSession` → `pollRoomTransition` → `mapLdtkRoomEntry` → `transitionPlatformerToRoom` → `beginSessionRoomSlide` → `advanceSessionRoomSlide` → `endRoomTransitionSession` (see §5.5); momentum preserved, `'seam-entry'` provenance |
| Hazard AABB (spikes) | `aabbOverlap` against the player's rect (read from the kernel state) |
| **Entity art (spikes, strawberry, springs…)** | `drawLevelEntity(ctx, entity, { drawOverride })` — the override resolves the instance's authored `__tile` + the def's parsed `tileRenderMode` and blits via `drawLdtkEntityTile` (0.16.0); returning `false` falls back to `DEFAULT_ENTITY_PALETTE`. **The LDtk tile wins; the engine shape is the fallback** (§7.1) |
| Strawberry collection | `derivePickups`, `collect`, `hasCollected` |
| Persistent strawberries + death counter | `save` storage (`createLocalStorageSaveStorage`, `loadSave`, `writeSave`) |
| Hit-stop on dash-into-wall + death | `createHitStop`, `triggerHitStop`, `stepHitStop`, `isHitStopActive` |
| Screen shake on hard landings / dash-bonk | trigger off `state.moments` (`landing.hard`, `dashBonk`) → `sineShake`, `shakeEnvelope` |
| Squash/stretch + breathing | `volumeScale`, `breathe`, `DEFAULT_BREATH`, `advanceSquash`, `DEFAULT_SQUASH_CONFIG` |
| Walk cycle (anti-foot-slide on ground) | `advanceLocomotionByDisplacement`, `evaluateLocomotion`, `DEFAULT_GAIT` |
| Landing / airborne tuck | `blendAirborneTuck`, `DEFAULT_TUCK` |
| Legs | `drawSimpleFeet`, `DEFAULT_SIMPLE_FEET` |
| Foot-tap audio | `createFootPlantState`, `advanceFootPlant` |
| Hair (1 damped spring strand) | `createSpringRod`, `advanceSpringRod`, `DEFAULT_SPRING_ROD` — **never** raw `advanceSpringChain` |
| **Player sprite (supplied `Player.png`)** | `parseSpriteSheet`, `compileSpriteSheet` (`meta.grid` synthesizes the 10×8 grid of 16×16 cells), `deriveSpriteAnimKind` → `advanceSpriteAnim`/`currentFrameIndex`, `drawSprite` (stable 1:1, facing mirror, feet anchor — §4.4) |
| Dash trail, landing dust, respawn flash | `spawn`, `advanceParticles`, `cull`, `sampleConeVelocity` |
| Parallax background (far/mid/near) | `drawTiledParallax`, `parallaxOffset`, `PARALLAX_FAR/MID/NEAR` |
| Vector look + glow (player, pickups, UI) | `outlineRect`, `drawGlow` |
| Crisp Retina canvas | `resizeCanvasToBackingStore`, `getDevicePixelRatio` |
| Death counter, room title cards, start menu (NEW GAME / RESUME GAME selection) | `drawText`, `drawTextOutlined` |
| Tween (death-and-respawn flash, transition cards) | `createTweenState`, `advanceTween`, `easeOutCubic`, `easeOutBack` |
| Synthesized SFX | `createAudioAdapter` |
| Frame FSM (menu / playing / gameover) | `createGameState`, `reduceGameState`, `isLegalTransition`, `DEFAULT_GAME_STATE_ADJACENCY` |

---

## 4. The Player

The player is built in **two layers**: the **physics** is the Phase 0–9 kernel tuned to the Celeste kit, the **art** is the **supplied `Player.png` sprite sheet** drawn over the LDtk tiles via the engine's sprite pipeline (§4.4). The procedural renderer is a **load-failure fallback only** — if `Player.png` (or its sheet) fails to load/compile at boot, the game still runs by drawing the procedural body. The collision body stays the narrow **0.5 × 1.5 tile box** (the sprite is pure visual overhang — it is drawn 1:1 in world units, intentionally larger than the collision body; see §4.4).

### 4.1 Config — the Celeste kit

Author the feel in **tile units** so it is identical whether the supplied LDtk uses 8 px, 16 px, or 32 px tiles. **Do NOT hand-roll `* tileSize / 16` across the config** — `PlatformerConfig` is a FLAT record of ~60 fields spanning many physical units (distances, velocities, accelerations, times, ratios, counts, booleans), and a blind pixel-scale corrupts feel (a velocity becomes a distance, a time is stretched, a ratio is inflated, and the jump hierarchy inverts). Use the engine's unit-aware scaler, which classifies every field and scales only the distance/velocity/acceleration ones:

```ts
const PLAYER_WIDTH_TILES = 0.5;   // half a tile — fits 1-wide ladder shafts
const PLAYER_HEIGHT_TILES = 1.5;  // ~1.5 tiles tall
const playerWidthFor  = (tileSize: number) => PLAYER_WIDTH_TILES * tileSize;
const playerHeightFor = (tileSize: number) => PLAYER_HEIGHT_TILES * tileSize;

// PREFERRED: derive a tile-appropriate Celeste config from the 16px reference.
// Scales distances/velocities/accelerations (incl. jump.apexHeight), copies
// times/ratios/counts/booleans verbatim, and RE-PEGS the jump-relative impulses
// (wall/super/climb/spring) when you override apex/time so the feel hierarchy
// (ground jump < wall jump < spring < super spring) survives the override.
function playConfigFor(tileSize: number): Readonly<PlatformerConfig> {
  return {
    ...createPrecisionPlatformerConfig({
      tileSize,
      referenceTileSize: 16,        // PRECISION_PLATFORMER is a 16px config
      jumpApexTiles: 81 / 16,       // ~5-tile jump apex (mirrors the engine's LDtk play mode)
      timeToApex: 0.3,
      wallGrabEnabled: true,        // grab key (Z) clings to walls, drains stamina, climb-jumps/mantles off
      climbEnabled: true,           // harmless default — the shipped pack has no ladders (IntGrid: 1: walls)
    }),
    groundDuckEnabled: false,       // baked in — keeps Down responsive for fast-fall/dash-aim (§4.1)
  };
}

// The Celeste kit opt-ins live as TOP-LEVEL fields on the returned flat config
// (dashEnabled / dashSpeed / wallSlideEnabled / wallJumpVx / climbSpeed /
// stepHeight / groundDuckEnabled …). Only `jump:` (and optional `squash:`) is
// nested. `groundDuckEnabled: false` is baked into `playConfigFor` itself — it
// keeps Down responsive for fast-fall/dash-aim while preserving ability-owned
// duck tech (hyper slide + duck super jump). To tweak any OTHER field, spread
// the result: `{ ...playConfigFor(ts), dashSpeed: 240 }`.
// Dash (8-directional, startup freeze, refills on land) + dash-tech
// (super/hyper/wavedash/duck) are inherited as enabled from PRECISION_PLATFORMER.
```

`PRECISION_PLATFORMER` already carries the full kit with tuned defaults: decaying wall-slide (`wallSlideStartMax` easing up to `maxFallSpeed`), wall-jump launch (`wallJumpVx/Vy` + `wallJumpLockTime`), 8-directional dash (`dashSpeed`/`dashDuration`/`dashStartupTime`/`maxDashes`/`endDashSpeedFactor`), dash-tech (`superJumpVx`, `dodgeSlideSpeedMult`, `duckSuperJump*`), springs (`springBounceVy`/`springSuperBounceVy`), corner correction, fast-fall, and wall-speed retention. **Do not duplicate any of these by hand.**

**Wall-grab extras (engine-owned, since physics v12):** with `wallGrabEnabled: true` you also get, for free —

- **Direction-aware grab+jump.** Jump while grabbing branches on the latched wall side and the SIGN of `moveX` (magnitude ignored, so analog sticks work): holding **Away** keeps the classic up-and-away climb-hop (`climbHopForceTime` push, reported through the `wallJumpLaunched` pulse — this pulse now ALSO fires for away climb-hops, a deliberate widening); **Neutral or Toward** launches a straight-up **climb-jump** (`vx = 0`, faces the wall, `climbJumpRegrabLockTime` re-grab lock so the actor actually rises — no 4 px re-cling jitter) reported through `climbJumpLaunched`. Dash beats the jump; the jump beats the mantle.
- **Ledge mantle.** Hold grab + **Up** near the top of a clear wall and the actor performs a continuous assisted hop onto the ledge — it rises beside the wall over several ticks, crosses the lip once its feet clear, and lands through the normal collision resolver (there is NEVER a position snap; tuning lives in `mantleEnabled`/`mantleHopVx`/`mantleHopVy`/`mantleApexClearance`/`mantleLandingInset`/`mantleAssistTime`). Set `mantleEnabled: false` to opt out. A conservative preflight declines the mantle under ceilings/overhangs or onto occupied footholds; passthrough/ladder/spring/dash-refill volumes never block it.

**Direction-aware wall-jump (engine-owned, physics v13):** the wall-slide's jump now branches on the SIGN of `moveX` at the press (magnitude ignored, so analog sticks work) —

- **Into-wall hop.** Jump while sliding (the slide only stays engaged while holding INTO the wall, so every active-slide press is into-wall) → straight up (`vx = 0`, faces the wall). The kernel resolves `forceMoveX = sign(0) = 0`, so the standard `wallJumpLockTime` lockout holds vx at ~0 and commits the hop vertically, then normal air control resumes — a single wall becomes chimney-climbable (slide, hop, land back on the wall, repeat).
- **Away leap (grace window).** Release the slide direction and press jump within `wallJumpGraceTime` (default 0.1 s, coyote-style: armed on every sliding tick, decaying after) with neutral or away input, while still beside the wall → the classic away push (`vx = ±wallJumpVx`, faces the leap, standard lockout). Grounded presses are NOT hijacked (the plain ground jump owns them), grab held defers to wall-grab, fast-fall and a vanished wall suppress the leap. Both variants report through the same `wallJumpLaunched` pulse and keep variable jump height.

### 4.2 Step loop

```ts
const config = playConfigFor(level.tileSize);
let state = compiled.initialState;        // rest-on-surface spawn from the LDtk 'Player'/'Spawn' entity
// each fixed tick:
const stepped = stepPlatformer(state, input, solids, dt, config, displacement /* §5.3, or omit */);
state = stepped.state;
// read pulses: state.events.justLanded / .dashStarted / .hitWall / .climbJumpLaunched / .mantled / …
// read surface interactions: state.interactions → [{ kind: 'spring'|'dashRefill', entityId }]
// read FEEL moments: state.moments → [{ kind: 'landing', impactSpeed, normalizedImpact, hard, solidId },
//                                     { kind: 'dashBonk', normalX, normalY, solidId },
//                                     { kind: 'dashEnded', reason, terminalContact },
//                                     { kind: 'grabLatch' | 'staminaExhausted', … },
//                                     { kind: 'springLaunch', super, solidId } | { kind: 'dashRefill', solidId }]
```

**Feel cues come from `state.moments`** (single-tick, presentation-only): a hard landing is `landing.hard` — the RATIO test (`normalizedImpact ≥ 0.72` of max fall speed), identical at every tile size; do **not** write an unscaled `prevVy > 520` px/s threshold (a real build's threshold that never fired at 8 px tiles). A dash-into-wall (horizontal OR upward-into-ceiling) is one `dashBonk` moment with the conventional outward normal + the surface id; the gasp/latch SFX are `staminaExhausted`/`grabLatch`. The boolean `state.events` pulses remain the canonical "did this happen" channel.

The LDtk spawn is a FEET-CENTER anchor; `compileGeneratedLevel`/`compileLdtkRoom` already resolve it to the AABB top-left via `spawnResolution:'rest-on-surface'` (the LDtk default), so the player rests on the surface — **no floor embed, no hand-rolled `settleState`**. (`settlePlatformerState(state, solids, config?, maxSteps?)` exists only as a recovery tool for legacy/embedded spawns; you should not need it for LDtk levels.) `stepPlatformer` returns `{ state }` — events and interactions live ON that `state` (not as a sibling key).

Combine `compiled.staticSolids` each tick with current moving-platform solids and a `createMovingPlatformDisplacementProvider(current, previous)` so platforms carry the player (see §5.3).

### 4.3 Input

Build `PlatformerInput` from polled edges. `IDLE_EDGE` is now an **exported** frozen singleton (`{ held:false, pressed:false, released:false }`) — import it; do **not** redefine it locally. `moveY` drives **both** ladder climb (up = `-1`) and fast-fall (down = `+1`); `grab` is the wall-grab edge (default `IDLE_EDGE` = mapped-but-not-pressed; `null` would *disable* the ability):

```ts
const input: PlatformerInput = {
  moveX,
  moveY,
  jump: edges['jump'] ?? IDLE_EDGE,   // C
  dash:  edges['dash']  ?? IDLE_EDGE, // X
  grab:  edges['grab']  ?? IDLE_EDGE, // Z
};
```

The engine ships a standard device map, but its standard KEYBOARD map uses `Space`/`Shift`/`KeyK` (a non-conflicting layout chosen clear of the WASD cluster) — **not** Celeste's defaults. This brief uses **Celeste's actual PC defaults**, so do NOT pass `STANDARD_KEYBOARD_PLATFORMER_MAP` to the keyboard adapter; author a Celeste-faithful map instead (the gamepad standard map is fine as-is — buttons, not keys):

```ts
// Celeste's actual PC keyboard defaults (NOT the engine's standard map).
// Build this standalone — do NOT spread STANDARD_KEYBOARD_PLATFORMER_MAP,
// or Space/Shift/KeyK stay mapped and conflict with C/X/Z.
const CELESTE_KEYBOARD_MAP: Readonly<KeyboardConfig> = {
  codeToAction: {
    // Movement on the arrow cluster (Celeste ships arrows, not WASD).
    ArrowLeft: 'left',  ArrowRight: 'right',  ArrowUp: 'up',  ArrowDown: 'down',
    // Celeste's three action keys.
    KeyC: 'jump',   // confirm / jump
    KeyX: 'dash',   // dash
    KeyZ: 'grab',   // grab / clamber
    // Engine convenience (NOT a Celeste default — Celeste restarts via the
    // pause menu): instant respawn-to-spawn for speedrun/QoL. Drop it if you
    // want pause-menu-only restart.
    KeyR: 'reset',
    // OPTIONAL: add WASD aliases for players who expect them. Celeste does
    // NOT ship these by default, so they are commented out to stay faithful.
    // KeyW: 'up', KeyA: 'left', KeyS: 'down', KeyD: 'right',
  },
};
const keyboard = createKeyboardAdapter(CELESTE_KEYBOARD_MAP);
const gamepad  = createGamepadAdapter(STANDARD_GAMEPAD_PLATFORMER_MAP);     // W3C button INDEX strings '0'/'1'/'2'/'12'… (NOT 'b0'/'dpleft')
```

**Bindings (authoritative for this brief):** Arrow keys move (←→ horizontal, ↑↓ for ladder climb / fast-fall / dash-aim), `C` jump, `X` dash, `Z` grab/clamber, `R` instant respawn (engine convenience). This matches Celeste's PC defaults verbatim; the engine's `STANDARD_KEYBOARD_PLATFORMER_MAP` (`Space`/`Shift`/`KeyK`) is deliberately **not** used so players get the real Celeste layout.

### 4.4 Sprite render (the supplied `Player.png` — primary renderer, from the FIRST play tick)

The player is rendered with the **supplied `Player.png` sprite sheet from the very first playable tick** — there is NO "procedural player first, swap the sprite in later" phase. Load + compile the sheet at boot (Stage 2, alongside the movement config) and draw the sprite every tick the player is on screen. The procedural renderer is the **boot-time load-failure fallback ONLY** — used in the single case where `Player.png` fails to decode/compile, so a missing asset never blocks play. Do not build the procedural body as the primary and migrate later; that migration is a known source of shimmer/anchor/pivot regressions, and it is avoided entirely by rendering the sprite from the start.

**The asset + frame mapping (authoritative).** `Player.png` is **160×128 px = a 10-column × 8-row grid of 16×16 frames** (row-major). Frame numbers are 1-indexed; they map to 0-indexed cells `i` with source rect `sx = (i % 10) * 16`, `sy = floor(i / 10) * 16`:

| Anim | Frames (1-indexed) | Cells (0-indexed) |
|---|---|---|
| Walk | 1–8 | **0–7** (row 0) |
| Jump | 61–65 | **60–64** (row 6) |
| Idle | (use walk frame 1) | **cell 0** (standing pose) |

Art faces right; left is produced by the facing mirror. Transparency is verified (empty/corner pixels are alpha 0).

**Boot: load + compile (defensive — mirror the tileset loader).** Load `Player.png` with the **same defensive, error-swallowing image loader you use for tileset PNGs** (bounded decode, never crash boot). A missing/failed sprite is **NOT fatal** — set the sheet to `null` and the render path falls back to the procedural body. `parseSpriteSheet` never throws, so wrap the whole thing and degrade quietly:

```ts
// decodeImageBounded is YOUR defensive loader (the same one you pass to
// buildLdtkTilesetBundle / loadLdtkProjectAssets). Returns CanvasImageSource | undefined.
const spriteImage = await decodeImageBounded('./Player.png');   // undefined on failure

// The sheet: a 10×8 grid → 80 frames (cells 0–79); walk 0–7, jump 60–64.
// meta.grid makes the compiler synthesize frames row-major; meta.frameTags
// `from`/`to` are TILE INDICES (cells) under meta.grid.
const spriteText = JSON.stringify({
  meta: {
    image: 'Player.png',
    size: { w: 160, h: 128 },
    grid: { tileWidth: 16, tileHeight: 16, columns: 10 },
    frameTags: [
      { name: 'walk', from: 0, to: 7,  direction: 'forward' },   // cells 0–7, loops
      { name: 'jump', from: 60, to: 64, direction: 'forward' },  // cells 60–64, one-shot
    ],
  },
});
const parsed = parseSpriteSheet(spriteText);          // { ok, sheet?, errors } — never throws (errors, not diagnostics)
const compiled: CompiledSpriteSheet | null =
  parsed.ok && parsed.sheet && spriteImage ? compileSpriteSheet(parsed.sheet).sheet : null;

// Walk clip: loops naturally (compiler tags are loop:true — correct for walk).
const walkAnim = compiled?.anims.get('walk') ?? null;

// Jump clip — HAND-BUILT (see the loop:false gap below).
const jumpAnim: CompiledAnim | null = compiled && {
  name: 'jump',
  frameIndices: [60, 61, 62, 63, 64],
  durations:    [70, 70, 70, 70, 70],
  direction: 'forward',
  loop: false,                                        // one-shot → CLAMP on the fall frame
};
```

> **KNOWN ENGINE GAP (one-shot anims).** The compiler hardcodes `loop = true` for every `meta.frameTags` entry (`compile.ts`), which is correct for `walk` but wrong for the jump feel. The verified feel is **"play 60→64 once, then CLAMP at the last (fall) frame until landing."** To get the clamp, hand-build the jump `CompiledAnim` with `loop: false` (above) — once the anim clock passes the clip total, `currentFrameIndex`/`currentFrameIndexAt` clamp to `n-1` (the fall frame) instead of looping. This is a one-shot-anim limitation to revisit in a future engine improvement; for now the consumer owns the `loop:false` override.

> **slot ≠ cell.** `currentFrameIndex` returns the index into `anim.frameIndices` (0..n−1) — a SLOT, not a sheet cell. `drawSprite` expects a sheet cell (`sheet.frames[frameIndex]`), so always map through `anim.frameIndices[currentFrameIndex(...) ?? 0]` before drawing — both branches above do exactly that. (The walk clip works only by coincidence: its `frameIndices` `[0..7]` are the identity; the jump clip would otherwise render walk cells 0–4 while animating at the correct rate.)

**Per fixed tick: derive kind → advance clock → draw.** Drive the anim clock from the **same `dt` as the sim**, and reset the clock whenever the kind changes (so walk↔jump swaps don't carry phase). Reset to idle on respawn to avoid a one-frame flash of the clamped fall pose after a mid-air death.

```ts
// Map the kernel's physics surface onto a semantic anim kind.
const kind: SpriteAnimKind = deriveSpriteAnimKind({
  supported: state.core.onGround,   // grounded?
  speedX:    state.core.vx,         // |speedX| > 12 px/s (default) ⇒ 'walk', else 'idle'
  velocityY: state.core.vy,         // airborne: <0 'ascent', >0 'descent', ~0 'apex'
});

// Reset the clock on a kind change; reset to idle on respawn.
if (kind !== lastKind) { walkClock = createSpriteAnimState(); jumpClock = createSpriteAnimState(); }
lastKind = kind;

let frameIndex: number;
if (kind === 'walk') {
  walkClock = advanceSpriteAnim(walkClock, dt * 1000);
  frameIndex = walkAnim!.frameIndices[currentFrameIndex(walkClock, walkAnim!) ?? 0];   // slot → sheet cell (loops naturally)
} else if (kind === 'idle') {
  frameIndex = 0;                                                   // hold cell 0
} else {
  // 'ascent' | 'apex' | 'descent' → jump clip (one-shot, clamps at cell 64)
  jumpClock = advanceSpriteAnim(jumpClock, dt * 1000);
  frameIndex = jumpAnim!.frameIndices[currentFrameIndex(jumpClock, jumpAnim!) ?? 0];  // 60..64, not 0..4
}

// Draw 1:1, bottom-centered on the FEET, facing mirror inside drawSprite.
// destX/destY are the destination TOP-LEFT (no bottom-center anchor in the
// engine): for a 16×16 frame on feet (feetX, feetY) → destX=feetX-8, destY=feetY-16.
const feetX = state.core.x + state.core.width / 2;
const feetY = state.core.y + state.core.height;       // bottom of the 0.5×1.5-tile box
drawSprite(ctx, spriteImage!, compiled!, frameIndex, feetX - 8, feetY - 16, {
  facing: state.core.facing,                          // 1 | -1; drawSprite mirrors about the frame's horizontal center
});
```

**⚠ Stable 1:1 pixel-sprite policy (MANDATORY — or the art shimmers).** Applying a continuous breathe/squash scale to a 16×16 pixel sprite causes sub-pixel SHIMMER (nearest-neighbor flips edge columns each frame) — a real build reversed exactly this (BUILD_NOTES §6a). So:

- **The sprite draws at a stable 1:1 scale — NO breathe, NO squash/stretch scaling on the sprite.** Pivot at the feet. The facing mirror (`drawSprite`'s internal `ctx.scale(facing, 1)`) still applies. **Do not ALSO wrap the sprite draw in your own `ctx.scale(facing, 1)` — that double-mirrors.** (Hair, if you draw it, goes OUTSIDE any mirror.)
- **Drop event-driven landing/launch squash on the sprite** (squash distorts pixel art). Squash/stretch (`advanceSquash`) is for the **procedural fallback body only**.
- **KEEP the dash aura glow + dash after-image trail** — they carry dash juice without distorting the sprite (they are particles/glow drawn alongside, not a scale on the sprite).
- The sprite is drawn **1:1 in world units** (16×16 = 2 tiles tall on the 8px-tile fixture — intentionally larger than the 0.5×1.5-tile collision box; the collision body stays the narrow box). A single `PLAYER_SPRITE_SCALE` multiplier (or scaling by `tileSize / 8`) is a one-line tunable if the LDtk uses a different tile size.
- **`image-rendering: pixelated` + `imageSmoothingEnabled = false`** for crisp nearest-neighbor (`drawSprite` forces the latter itself). **No shimmer while idle.**
- **Contact shadow:** do NOT draw one — omit the contact shadow entirely (it reads as a muddy drop shadow under the crisp pixel sprite).

**Fallback.** If `compiled` (or `spriteImage`) is `null` after boot, draw the procedural body instead: face + `advanceSpringRod` hair + `drawSimpleFeet` + the `advanceLocomotionByDisplacement` walk cycle + `advanceSquash` squash (pivot at the feet), wrapped in `ctx.scale(facing, 1)`. The procedural path is the **only** place breathe/squash scaling is applied.

> **Simpler alternative (still policy-compliant).** For ONE character with TWO fixed cell ranges, a direct `ctx.drawImage(playerImage, sx, sy, 16, 16, destX, destY, 16, 16)` keyed off `kind` is an acceptable simpler alternative to the full engine pipeline — but the engine pipeline (`compileSpriteSheet` grid + `deriveSpriteAnimKind` + `drawSprite`) is **preferred** (it owns the facing mirror, the frame-player, and the grid math for you). Either way the **stable-1:1 + facing-mirror + feet-anchor + no-squash** policy above holds.

---

## 5. World — The Supplied LDtk Level

Celerock does **not** author rooms. It loads the supplied `.ldtk`, translates each level into engine geometry, renders the supplied tileset through the **surface cache** (`createLdtkLevelSurfaceCache`, which bakes each room verbatim via `drawLdtkLevel`), and flows the player between rooms across LDtk `__neighbours` seams.

### 5.1 Boot: load + asset preflight (G3)

**PREFERRED — one call** (`loadLdtkProjectAssets`) fetches the project, parses it, decodes every tileset PNG (bounded), and builds the bundle. It handles the URL-encoding of spaces/brackets in tileset `relPath`s (the raw-concat URL with spaces/`[`/`]` is what hung boot in real builds), skips the `LdtkIcons` atlas, and degrades a missing OPTIONAL tileset to a warning rather than crashing. **Never throws** — failures become diagnostics:

```ts
// 1. Load the LDtk project + all its tileset PNGs in one bounded call.
//    `celerock.png` resolves as a sibling of the .ldtk — keep them together in public/ (§1.1).
//    Base-URL-aware path (not route-relative): works at `/` and under a base path.
const result = await loadLdtkProjectAssets({ projectUrl: `${import.meta.env.BASE_URL}celerock.ldtk` });
if (!result.ok) { console.error('LDtk load failed', result.diagnostics); return; }
const { project, tilesets, diagnostics } = result;   // log warnings from `diagnostics` as you like
```

**2. Asset preflight (G3 — run before any gameplay work).** Inspect the parsed project and report what was actually authored, so the build does not assume mechanics the LDtk lacks:

```ts
const report: LdtkPlatformerProjectReport = inspectLdtkPlatformerProject(project);
console.log(`levels=${report.levelCount} spawns=${report.totalSpawns}`, report.capabilities);
console.log('neighbours:', report.levels.map((l) => ({ iid: l.iid, neighbours: l.neighbourIids, connected: l.connected })));
// report.capabilities = { hazards, collectibles, springs, dashRefills, exits, ladders, movingPlatforms, multiRoom }
// capabilities.multiRoom === true → Stage 3 (seam traversal) is in scope. capabilities.exits counts
// Exit ENTITIES, NOT __neighbours seam traversal — it is false for this pack despite the full chain.
// report.spawnLessRoomIids / report.disconnectedRoomIids / report.unknownTriggerIdentifiers are WARNINGS.
```

**Missing optional content is INFORMATIONAL, not a failure.** A project with no springs, no dash-refills, or no moving platforms is perfectly playable — the build simply must not *require* those mechanics (see the capability-aware acceptance in §9 / §12.7). Treat only a total lack of spawns (no `Player`/`Spawn` anywhere) as a hard block.

---

**Manual alternative (only if you cannot use the high-level loader).** `parseLdtkProject` returns a RESULT `{ ok, project?, errors }`, **not** a bare `LdtkProject` — destructure and check `ok && project`. `buildLdtkTilesetBundle` is **SYNCHRONOUS** and its `loadImage` returns `CanvasImageSource | undefined` (NOT a Promise):

```ts
const text = await (await fetch('./celerock.ldtk')).text();
const { ok, project, errors } = parseLdtkProject(text);   // never throws
if (!ok || !project) { console.error(errors); return; }

// Synchronous bundle: loadImage resolves a relPath to a decoded image, returning
// undefined on failure (buildLdtkTilesetBundle skips undef + the LdtkIcons atlas).
const tilesets: LdtkTilesetBundle = buildLdtkTilesetBundle(
  project.defs.tilesets,
  (def) => alreadyDecodedImages.get(def.relPath ?? ''),   // CanvasImageSource | undefined (NOT a Promise)
);
```

When you take the manual path you must URL-encode each `relPath` yourself (percent-encode spaces, `[`, `]`, Unicode) and decode defensively — `loadLdtkProjectAssets` already does both, which is why it is the preferred path.

### 5.2 Per level: compile + cache (PREFERRED)

Each LDtk level becomes engine geometry. **Do NOT hand-roll the translate→compile→bucket→cache pipeline** — `compileLdtkRoom` does it in one call and `createLdtkRoomCache` wraps a whole project in a lazy, identity-stable cache (`get(iid)` compiles on first access and returns the SAME immutable instance thereafter):

```ts
const config = playConfigFor(report.tileSizes[0] ?? 16);   // from the preflight; see note below on mixed tile sizes
const rooms: LdtkRoomCache = createLdtkRoomCache(project, {
  config,
  playerWidthForTileSize:  (ts) => 0.5 * ts,   // half-tile body fits 1-wide ladder shafts
  playerHeightForTileSize: (ts) => 1.5 * ts,
  // spawnResolution defaults to 'rest-on-surface' — the LDtk feet-center anchor is
  // resolved to the AABB top-left, so the player rests on the surface (no settle needed).
});

const start = rooms.getStartRoom();            // resolves the first level with an authored spawn
if (!start.ok) { console.error(start.diagnostics); return; }   // never fabricates a (0,0) room
const active: CompiledLdtkRoom = start.room;
let state = active.compiled.initialState;      // rest-on-surface spawn (active.spawn.source === 'authored')
```

> Keep the cache options in **one `const ROOM_CACHE_OPTIONS`** rather than inlining them at the call — §5.7's hot reload rebuilds the *entire* cache on every saved `.ldtk` edit, and the rebuild must pass the identical options.

Each `CompiledLdtkRoom` already buckets entities by kind — read them off the room directly (there is **no `compiled.entities` field** on `CompiledLevel`):

| `CompiledLdtkRoom` field | contents |
|---|---|
| `solids` | `compiled.staticSolids` — tile geometry + `platform`/`passthrough` entity solids + the NON-BLOCKING `spring`/`dashRefill` trigger volumes. Moving platforms are NOT here (they stay in `compiled.movingPlatforms`). |
| `hazards` `collectibles` `springs` `dashRefills` `exits` `enemies` | the entity arrays, bucketed by resolved kind (`collectibles` is typed `CollectibleEntity[]` — it feeds `derivePickups` directly, no cast) |
| `ladders` | always empty today (reserved); ladder CLIMB is driven by `tileSemantics.ladder` — overlay per-cell `ladder: true` solids each tick so the kernel's climb ability reads them |
| `spawn` | the resolved spawn (`source` is forced to `'fallback'` when the level has no `Player`/`Spawn` entity) |
| `compiled` `levelData` `tileSemantics` `ldtkLevel` `diagnostics` | the underlying compile artifacts + merged translate/compile diagnostics |

> **Mixed tile sizes:** if the preflight reports more than one tile size (`report.tileSizes.length > 1`), prefer a single canonical tile size for the config/player body (Celeste rooms are uniformly sized); `createLdtkRoomCache` already derives each room's player dimensions from that room's own tile size, so only the `config` needs a representative scale.

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

Each tick, advance platforms and feed the displacement provider so the player rides them. **Pass the provider as the 6th positional arg** to `stepPlatformer` — without it the kernel's riding tracker never sees platform motion and the player slides off:

```ts
const previous = movingPlatforms;                                   // active.compiled.movingPlatforms
movingPlatforms = movingPlatforms.map(p => advanceMovingPlatform(p, dt));
const displacement = createMovingPlatformDisplacementProvider(movingPlatforms, previous);
const solids = [...active.solids, ...movingPlatforms.map(movingPlatformToSolid)];
state = stepPlatformer(state, input, solids, dt, config, displacement).state;   // 6th arg carries the player
```

### 5.4 Render the tileset + camera brain

Set the canvas once (`image-rendering: pixelated`, DPR-aware backing store). Each frame, the **camera brain** owns the view: one follow `VirtualCamera` per room, Celeste-style deadzone bands, fitted zoom. Render the tileset through the **surface cache** (`createLdtkLevelSurfaceCache` — which bakes verbatim via `drawLdtkLevel`) with `imageSmoothingEnabled = false`:

```ts
// One surface cache for the whole run — the CANONICAL tile draw (§5.4).
// The first draw of each room bakes it once at native resolution; every frame
// after is a single blit of the baked surface (fractional-zoom safe).
const surfaceCache = createLdtkLevelSurfaceCache();

// One cached vcam per room (rooms differ in size → fitCameraZoom differs).
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
  lens: { zoom: fitCameraZoom(room, viewport) },          // ENGINE cover-fit (accepts the CompiledLdtkRoom directly)
};

// Boot once at the start room's fitted zoom:
let brain = createCameraBrain({ zoom: fitCameraZoom(active, viewport) });

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
surfaceCache.draw(ctx, active.ldtkLevel, {
  tilesets,
  worldOffset: { x: -Math.round(brain.camera.x), y: -Math.round(brain.camera.y) },
  view: { x: brain.camera.x, y: brain.camera.y, width: worldView.width, height: worldView.height },
});
// ...player art, entities, particles, UI...
ctx.restore();
```

`fitCameraZoom(level, viewport, options?)` is the **engine-owned** fit helper (a `{ width, height }` or a `CompiledLdtkRoom` + a viewport → zoom). Its policy is explicit and tested: **`mode: 'cover'` (the default)** fills the viewport on BOTH axes so the level owns the screen, with the deadzone follow scrolling the overflow axis — no empty side/bottom gaps on compact rooms. `mode: 'contain'` (`Math.min`) letterboxes; `mode: 'native'` is `1`. Optional `integerScale: true` quantises best-effort (up for cover, down min 1 for contain, sub-unit stays fractional), and `minZoom`/`maxZoom` clamp last. For compact Celeste-like rooms a `contain` fit (`Math.min(...)`) leaves exactly the side/bottom gap a prior build fixed with a one-line `Math.min → Math.max` flip — that policy is now engine-owned, so do **not** hand-roll a `fitZoom`: call `fitCameraZoom(room, viewport)` and keep `imageSmoothingEnabled = false`. (Nudge the result down a hair — `* 0.98` — only if a room that *just* fits round-overflows its border by a pixel.)

```ts
const zoom = fitCameraZoom(room, viewport);                          // cover (default) — no side gaps
const zoom = fitCameraZoom(room, viewport, { mode: 'contain' });     // letterbox (NOT the Celerock policy)
const zoom = fitCameraZoom(room, viewport, { integerScale: true });  // best-effort crisp-pixel quantise
```

**Seamless fractional zoom — the canonical tile draw.** `drawLdtkLevel` blits every tile separately, so under a fractional `brain.zoom` (a cover-fit 4.75×, or the lens easing between rooms mid-§5.5-slide) some browser/GPU combinations expose a duplicated or empty scanline between adjacent tile rows — a hairline seam. The mid-slide lens ease is *guaranteed* fractional zoom, which is exactly the case the **surface cache** exists for: `createLdtkLevelSurfaceCache()` (shipped in `0.12.0`) returns a cache whose `draw(ctx, level, opts)` bakes the room's tiles verbatim through `drawLdtkLevel` into one `pxWid × pxHei` offscreen canvas on first use, then blits that single surface per frame — no internal draw boundaries for the compositor to split, at any zoom. `drop(iid)`/`clear()` rebake (after tile edits — §5.7's hot reload calls `clear()` on every applied swap, since ANY room may have changed, not just the active one); in hosts with no canvas factory it silently falls back to the direct draw. **Use `cache.draw(...)` everywhere** (the §5.5 slide draws both rooms through it; §5.4's per-frame draw above is the cache); `drawLdtkLevel` remains the underlying baker, not the call-site renderer.

### 5.5 Room transitions — seamless, momentum-preserving

Celerock renders one room at a time in **room-local coordinates**, so a room change must NOT blend a position captured in one room's local space into another's. The engine owns the whole path now — the simulation transition (pure helpers) and the presentation transition (the slide orchestrator) are composed into **ONE session state machine**. **Use the session orchestrator by name — `createRoomTransitionSession` / `pollRoomTransition` / `beginSessionRoomSlide` / `advanceSessionRoomSlide` / `endRoomTransitionSession`. Do not hand-roll per-tick exit polling, detector adoption, `if (!slide)` guards, or the enter/finish/cancel camera-space rebases — the session owns all of them:**

**Golden path — the session.** One session per traversing actor, created once at boot. The session holds `{ detector, slide }` as one immutable state machine, so the seam-transition invariants are structural: a second transition cannot begin while a slide is active (the poll returns `'suppressed-slide-active'`), the finish-rebase applies exactly once on completion, and every abnormal exit goes through one cancel-with-rebase path. **Store the RETURNED session from every call** — the session auto-adopts the detector, so you never hand-adopt it:

```ts
// One session per traversing actor — create once at boot:
let session = createRoomTransitionSession();

// per simulation tick — the ONLY transition poll:
const poll = pollRoomTransition(session, state.core, active.ldtkLevel, project);
session = poll.session;                       // auto-adopted detector state — never hand-adopt
if (poll.result.type === 'exit') {
  const exit = poll.result.exit;
  const target = rooms.get(exit.neighbourLevelIid);      // cached CompiledLdtkRoom (createLdtkRoomCache)
  const prevCore = state.core;   // source-local body — captured BEFORE the transition;
                                 // state.core is destination-local once transitionPlatformerToRoom runs below
  const entry = mapLdtkRoomEntry(state.core, active.ldtkLevel, target.ldtkLevel, exit);
  ({ state } = transitionPlatformerToRoom(state, entry, { destinationSolids: target.solids, config }));
  // 0.11.0: roomEntrySlideView computes the follow-compatible destination
  // framing (room-local room-px) — do NOT hardcode { x: 0, y: 0 }. Pass the
  // same follow bands/padding as the destination follow vcam.
  const destinationZoom = fitCameraZoom(target, viewport);
  const destinationView = roomEntrySlideView(target, state.core, viewport, destinationZoom,
    { followX: FOLLOW_X, followY: FOLLOW_Y, padding: 0 });
  // Particle continuity: add slide.particleRebaseDelta ONCE to source-local particles.
  const begun = beginSessionRoomSlide(session, {
    source: active,
    destination: target,
    viewport,
    brain,
    destinationView,
    actor: { sourceLocal: { x: prevCore.x, y: prevCore.y }, destinationLocal: { x: entry.x, y: entry.y } },
  }, { reducedMotion: prefersReducedMotion() });
  if (begun.ok) {
    session = begun.session;                  // slide now active — session owns detector + slide together
    brain = begun.brain;                      // ALREADY rebased INTO slide space (the enter-rebase is applied here)
    active = target;
  }
  // A refused begin (ok: false — slide already active, missing rooms, or a
  // non-finite viewport) returns session + brain unchanged: drop the poll
  // result and stay in the source room.
}
// While a slide is active the poll returns 'suppressed-slide-active' — no
// `if (!slide)` guard needed (a second transition mid-slide is impossible).

// per presentation tick — the session advances ONLY the clock; you still drive
// the slide camera (read session.slide → presentationForRoomSlide → your own
// updateCameraBrain with the viewport/targets):
const advanced = advanceSessionRoomSlide(session, dt, brain);
session = advanced.session;
brain = advanced.brain;
if (session.slide !== null) {
  const p = presentationForRoomSlide(session.slide);
  brain = updateCameraBrain(brain, { vcams: [p.vcam!], targets: { player: state.core }, bounds: p.bounds,
                                    viewport, activeId: ROOM_SLIDE_VCAM_ID, dt });
  // draw BOTH rooms through the surface cache — worldOffset is each room's offset in slide space:
  //   cache.draw(ctx, src.ldtkLevel,  { tilesets, worldOffset: p.sourceOffset });
  //   cache.draw(ctx, dest.ldtkLevel, { tilesets, worldOffset: p.destinationOffset });
  // draw EACH room's entities (§7.1) under that SAME offset — drawLevelEntity has no
  // worldOffset param, so ctx.translate(p.sourceOffset) / (p.destinationOffset) around
  // each room's entity loop, or the entities detach from their tiles mid-slide.
  // draw the player at (destinationLocal + p.playerOffset) in slide space
}
// advanced.done === (session.slide === null): the FINISH rebase
// (finishRoomSlideCameraSpace) was applied exactly once on the completing
// advance — the destination room vcam takes over from the exact final view.

// on death / retry / teleport / reset — mid-slide or not:
const ended = endRoomTransitionSession(session, brain, 'destination');
session = ended.session;                      // FRESH idle session — the "reset the detector on respawn" discipline is owned here
brain = ended.brain;                          // cancel-with-rebase applied first if a slide was active (no slide-space leak)
```

**Per-axis containment (0.15.0 `detectLdtkRoomExit` behavior — intrinsic to the session):** an exit additionally requires the body to have been fully contained ONCE on that exit's **crossing axis** in the current room (`e`/`w` → X, `n`/`s` → Y). The orthogonal axis is NOT gated — a diagonal exit taken straight off an arrival still fires, so the actor never has to settle inside a room before it can leave. Straddle suppression is intrinsic and reset-immune: the latch re-derives from body geometry on every poll, so even a discarded or freshly created detector state cannot tick-tock (the Celerock-1 death loop is structurally impossible). A body that never becomes contained on an axis (larger than the room on that axis) has that axis's exits suppressed only until it fully departs the room; a body that no longer overlaps the room at all skips the axis gate, so genuine reverse crossings and void departures stay reportable.

**Composition layer (low-level helpers — for callers that need full control):** the session composes these; a caller using them directly owns the invariants themselves (adopt the detector state transactionally, never reset it mid-run, never begin a slide while one is active, always cancel-with-rebase on abnormal exit, always finish-with-rebase on normal completion):

```ts
/** Which linked shared seam (if any) the body's AABB crossed out of `level` (cardinal `__neighbours` only,
 *  gated by the shared world-space seam span — a crossing outside it is void, not a transition). */
findLdtkRoomExit(body: Rect, level: LdtkLevel, project: LdtkProject): LdtkRoomExit | undefined;

/** Where the actor enters the destination room, in destination-local coords (momentum-preserving, un-clamped). */
mapLdtkRoomEntry(body: Rect, from: LdtkLevel, to: LdtkLevel, exit: LdtkRoomExit): LdtkRoomEntry;

/** Post-transition state + `spawn.source === 'seam-entry'` provenance. Preserves vx/vy/facing + ability/
 *  locomotion slices, clears events/interactions/moments, and revalidates support when you pass
 *  `destinationSolids` (never settles — settling would destroy mid-air momentum). */
transitionPlatformerToRoom(state, entry, { destinationSolids?, config? }): { state, spawn };

/** Rebase a source-local point into destination-local (particles/dust continuity). */
rebasePointBetweenLdtkRooms(point, from: LdtkLevel, to: LdtkLevel): { x, y };
```

**Presentation (G5 — the default is a SLIDE, not a hard cut):** the session wraps `beginRoomSlideFromBrain` / `advanceRoomSlide` / `presentationForRoomSlide` + the camera-space rebases. The slide composes the existing camera brain (no new solver): it drives a transient high-priority `fixed` vcam in a normalized two-room space with `blend: 0` and exact-snap body/lens, so the named exported curve (`roomSlideEase`, ~0.30 s) is the SOLE path authority — no stacked brain blend or damping. **BOTH rooms render** during the slide (draw each with `worldOffset: presentation.sourceOffset` / `destinationOffset`); the player's SCREEN position is continuous at the seam (`presentation.playerOffset` eases the render correction to zero); particles rebase ONCE at slide start (`slide.particleRebaseDelta`); input/sim continue unless `freezeSimulation`. **Reduced-motion** is explicit — pass `reducedMotion: prefersReducedMotion()`; `true` yields `active: false, t: 1` and the session runs the enter (at begin) + finish (on the first advance) rebases in the SAME presentation frame for an immediate seam-aligned cut. Handoff is explicit, not auto-blended: `enterRoomSlideCameraSpace` (once, at slide start) rebases the brain into slide space and clears selection/blend; `finishRoomSlideCameraSpace` (once, at slide end) rebases into destination-local — the next destination vcam activation is a first activation seeded from the exact final rendered view. Death/retry/teleport mid-slide: `cancelRoomSlideCameraSpace(slide, brain, returnTo)` rebases to the room the simulation resumes in; rapid reversal cancels to the current room FIRST, then begins the reverse slide from that local state.

Falling out of the level with no cardinal neighbour (the void) is a respawn, not a transition — and a crossing that leaves through a NON-shared span (a partial seam's void edge) is also void: the poll returns `'idle'` (no exit) and you respawn.

> The public golden-path APIs replace the old "read the showcase" reference: `loadLdtkProjectAssets` (§5.1), `inspectLdtkPlatformerProject` (preflight), `compileLdtkRoom` / `createLdtkRoomCache` (§5.2), the **room-transition session** (`createRoomTransitionSession` → `pollRoomTransition` → `mapLdtkRoomEntry` → `transitionPlatformerToRoom` → `beginSessionRoomSlide` → `advanceSessionRoomSlide` → `endRoomTransitionSession`; §5.5), and the cover-fit `fitCameraZoom` + per-room vcam above. (No `showcase/` or `src/…` path is published in the npm package — the `files` whitelist ships only `dist/` — so do not reference any as a consumer resource.)

### 5.6 What the LDtk contains (the shipped pack, and the general contract)

Because Celerock trusts the LDtk, the file is the design. **`celerock.ldtk` (§1.1) satisfies all of the below** — the structure is stated here so the code reads the file rather than assuming it, and so a user-substituted `.ldtk` has a target to hit:

- **≥1 level** (more rooms = a longer climb). Multi-level projects are navigated via `__neighbours`. *Shipped: 5, in one west→east chain.*
- An **IntGrid collision layer** with named values for `'solid'` (and optionally `'passthrough'`, `'ladder'`). *Shipped: `IntGrid_Layer`, one value — `1: walls` — so everything solid is full collision; no one-ways, no ladders.*
- **Tile / AutoLayer layers** referencing the tileset for the visual. *Shipped: the walls are `autoLayerTiles` baked onto the IntGrid layer, plus a `Tiles_Decoration` layer — the surface cache bakes both (via `drawLdtkLevel`); do not assume art lives only on the Tiles layer.*
- **Entity layers**: at least one `Player`/`Spawn`; `Coin`/`Gem`/`Diamond` strawberries; `Spike`/`Hazard` hazards; optionally `MovingPlatform`, `Spring`, `DashRefill`, `Enemy`. *Shipped: 1 `Player`, 1 `Gem`, 6 `Spike`. Defs exist for `Spring`/`DashRefill` with no instances.*
- **`__neighbours`** links between levels you intend to flow between. *Shipped: every room links to its cardinal neighbours; no room is orphaned.*
- **`Player.png`** — the 160×128 (10×8 grid of 16×16) player sprite sheet the runtime loads at boot (§4.4). A missing/failed load degrades gracefully to the procedural body, but the canonical build ships it.

**Only `Level_0` has an authored spawn** — the other four are entered across a seam, and the preflight warns about them (`spawnLessRoomIids`, 4 entries). That warning is expected and correct here, not a fault to repair: a spawn-less room is reachable by traversal and its death-respawn anchor is its seam-entry point (§8). Treat only a project with *zero* spawns as a hard block.

A level with no hazards cannot kill; a project with no goal has no win state. Those are design choices in the LDtk, not failures of the runtime.

### 5.7 LDtk hot reload (dev-time — STANDARD scope, not a stretch goal)

Editing the level while playing it is the primary level-design loop for this brief, so it ships in every build — not as a post-build patch. Under `npm run dev`, saving `public/celerock.ldtk` (any `public/*.ldtk`) swaps the edited world into the LIVE game within ~1 s: the active room is recompiled **by LDtk `iid`**, its surface-cache bake invalidated, hazards/collectibles/entity-tile index rebuilt — while the live player state (position, velocity, facing, abilities, stamina, dashes), the save, the death counter, and the FSM are preserved verbatim. No page reload, no respawn, no menu bounce. An invalid edit, a truncated file, or a deleted active room leaves the currently playable world **100% untouched** with a surfaced error — a designer mid-playtest is never dumped into a blank or broken world by a half-saved file. Every symbol this section uses is already in the §1 import block.

**1. `vite.config.ts` — the watcher plugin.** Vite does not put `public/` assets through HMR (they sit outside the module graph), so notify the game yourself over the dev-server websocket. Extend the template's `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [{
    name: 'ldtk-hot-reload',
    apply: 'serve',                                  // dev server only — never in `vite build` / `preview`
    configureServer(server) {
      server.watcher.add(resolve('public'));         // public/ is not watched by default — add it
      server.watcher.on('change', (file) => {
        if (file.endsWith('.ldtk')) {
          server.ws.send('ldtk:update', { file });   // custom HMR event (colon namespaced)
        }
      });
    },
  }],
});
```

**2. The client handler — a TRANSACTIONAL swap.** Listen with `import.meta.hot` (guarded — it is `undefined` in a production build, and the plugin above never runs there), re-load through the same §5.1 golden path with a cache-busted fetch, and commit the new world only when every step succeeds:

```ts
// One generation counter per notification — NOT Date.now() (forbidden, §2).
let ldtkGeneration = 0;
let pendingHotReload = false;

if (import.meta.hot) {                              // dev only; dead code in `vite build`
  import.meta.hot.on('ldtk:update', () => { pendingHotReload = true; });
}

// Poll the flag inside the FIXED STEP (never in the ws callback): a save that
// lands mid-§5.5-slide defers to the first `slide === null` tick instead of
// fighting the session.
if (pendingHotReload && session.slide === null) {
  pendingHotReload = false;
  ldtkGeneration += 1;
  void hotReloadLdtk(ldtkGeneration);
}

async function hotReloadLdtk(generation: number): Promise<void> {
  // (a) Re-load through the SAME §5.1 path, cache-busted via the loader's own
  //     injectable `fetch` (never a hand-built `?t=` URL — the loader owns
  //     URL-encoding and tileset base resolution). Bust .ldtk requests only.
  const bustingFetch: typeof fetch = (input, init) => {
    const url = String(input);
    return fetch(url.endsWith('.ldtk') ? `${url}?g=${generation}` : url, init);
  };
  const result = await loadLdtkProjectAssets({ projectUrl: PROJECT_URL, fetch: bustingFetch });
  if (generation !== ldtkGeneration) return;        // a newer save superseded this one — discard

  // (b) Transaction: build the ENTIRE replacement world, commit NOTHING until
  //     every step succeeds. Any failure → surface the error and return; the
  //     live world stays exactly as it was (still playable).
  const reject = (reason: string) => {
    console.error(`[ldtk] hot reload rejected: ${reason}`);
    showDevErrorToast(reason);                      // consumer-owned: drawTextOutlined, dismisses after N fixed ticks (never Date.now)
  };
  if (!result.ok) return reject('load/parse failed — see diagnostics');
  const nextProject = result.project;
  const nextRooms = createLdtkRoomCache(nextProject, ROOM_CACHE_OPTIONS);   // §5.2's one-const options
  if (!nextRooms.has(active.ldtkLevel.iid)) {                                 // has(), not get() — get() throws
    return reject(`active room '${active.ldtkLevel.identifier}' no longer exists (iid ${active.ldtkLevel.iid})`);
  }
  const nextActive = nextRooms.get(active.ldtkLevel.iid);

  // (c) Commit — every live reference reassigned in ONE synchronous block, so
  //     no step or render can observe a half-swapped world:
  project = nextProject; rooms = nextRooms; active = nextActive;
  surfaceCache.clear();                              // ANY room may have changed — rebake lazily per room
  terminalRoomIid = deriveTerminalRoomIid(project);  // §1.1/§8 — re-derive, never hardcode
  rebuildRoomVcam(active);                           // new fitCameraZoom + bounds (a resized room; a zoom snap is fine in dev)
  entityTileIndex = buildEntityTileIndex(active.ldtkLevel, project);   // §7.1 index is per-room
  hazardRects = active.hazards.map(h => h.rect);     // §6
  console.log('[ldtk] hot reload applied', inspectLdtkPlatformerProject(nextProject).capabilities);
  // The player `state`, `save`, `gameState`, menu, audio, particles: UNTOUCHED.
  // Newly-added springs/dash-refills light up with zero extra wiring — the
  // buckets come off the room (§5.2). Save is keyed by iid (§7), so collected
  // strawberries whose entity ids survive the edit stay collected; deleted ids
  // dangle harmlessly.

  // (d) Embedded-body recovery: if the edit drew geometry through the player,
  //     settle through the engine's documented recovery tool (neutral ticks —
  //     §5.2); if the body cannot ground (fully enclosed), fall back to the
  //     §8 respawn anchor for the active room.
  if (playerOverlapsAnySolid(state.core, active.solids)) {         // a §6-style aabbOverlap loop
    const settled = settlePlatformerState(state, active.solids, config);
    state = settled.settled ? settled.state : respawnAtRoomAnchor();
  }
}
```

**Rules the swap MUST hold** (they are what make hot reload safe to standardize):

- **Swap-atomic commit.** All live references are reassigned in one synchronous block (above); step/render see either the whole old world or the whole new one. The pending flag is polled in the fixed step, so a mid-slide save defers ~0.3 s to the slide's completion rather than canceling it.
- **Fully transactional.** Rejection at ANY stage (load failed, parse failed, active room's iid gone) commits **nothing** — same `project`, same `rooms`, same `active`, same surface-cache bakes (reference identity). The playable world is the error boundary; surface the reason; never `location.reload()` (§12.8).
- **Fresh cache per reload.** `createLdtkRoomCache` is identity-stable over ONE project — never splice a room compiled from a new project into an old cache, and never reuse the old cache with a new project. Rebuild it with the identical `ROOM_CACHE_OPTIONS` (§5.2).
- **Player state preserved verbatim.** That preservation is the entire point of the loop: the player keeps `x`/`y`/`vx`/`vy`/`facing`/stamina/dashes mid-jump; a swap never writes the save, never increments deaths, never touches the FSM or menu. LDtk level iids are stable across edits of the same room — that is what makes "recompile the active room by iid" possible at all.
- **Cache-bust through the loader's `fetch`.** `loadLdtkProjectAssets({ fetch })` exists for exactly this; the generation counter (never `Date.now()`) keys it, and a superseded in-flight reload is discarded on resolve.
- **Scope: `.ldtk` only.** Swapping `celerock.png` or `Player.png` is NOT hot-swapped (their decoded images live outside this path) — those still take a manual refresh. Say so in the report rather than half-supporting it.

---

## 6. Hazards

Hazards are LDtk entities (`Spike`/`Hazard`→`hazard`, `Trap`→`trap`); the engine does not ship a first-class hazard module. Wrap a player-state AABB check:

- **Static spikes.** At boot, collect hazard entity rects into `hazardRects: Rect[]`. Each tick, check `aabbOverlap(playerRect, hazardRect)` — if true (and the player is moving into the hazard, e.g. `state.core.vy > 0` for floor spikes, or freshly landed over a hazard), trigger death.
- **Moving spike rows** (a `MovingPlatform` carrying a hazard child). Derive the spike rect from the platform's *current advanced* position each tick and run the same `aabbOverlap` check. Do NOT re-resolve the platform's motion — `advanceMovingPlatform` already owns it; just read `plat.x`/`plat.y`.

Death effect: `hitStop = triggerHitStop(hitStop, 6)`; advance `hitStop = stepHitStop(hitStop, 1)` per fixed tick; transition the FSM to `gameover`.

**§6 covers COLLISION only — spikes RENDER through the §7.1 entity-art rule** (the authored `Spike` tile from `celerock.png`, repeat-tiled across each resized instance). The shipped spikes are resized strips (`40×8`, `24×8`, `8×16`) over an `8×8` tile, so a stretched blit is visibly wrong; do not draw a flat red box and do not draw a procedural polygon.

**The signature Celeste beat — dash-into-wall.** The dash terminates on contact with a solid (the kernel never phases through). On the tick a dash contacts a wall, fire `triggerHitStop` + `sineShake`. Narrow the ability-state union before reading its timer:

```ts
const dash = state.abilities.dash;
const dashing = dash?.kind === 'dash' && dash.timer > 0;
```

---

## 7. Collectibles — Strawberries (the engine's `collectibles` pillar)

**Use the engine's `collectibles` module. Do NOT hand-roll "is this strawberry already collected."**

- **Source.** Strawberries are LDtk `Coin`/`Gem`/`Diamond` entities, translated to `collectible`. Use the engine `'gem'` visual stand-in for a strawberry — same AABB, same persistence semantics. Do NOT invent a `'strawberry'` literal in `CollectibleKind`; the union is closed. **Its ART is the authored LDtk tile — see §7.1**, not a procedural diamond.
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
- **Render** uncollected strawberries from `remaining` through `drawLevelEntity` + the §7.1 tile override — the authored `Gem` tile from `celerock.png`. `drawGlow` is an additive halo *behind* the tile, never the body. Do **not** draw a procedural diamond outline: the LDtk dressed this entity, and §7.1 says the art wins.

### 7.1 Entity art — the LDtk tile IS the sprite (general rule)

An LDtk entity def may assign a display tile (`tileRect` on the def, resolved to `__tile` on every instance). **When it does, that tile IS the entity's sprite — blit it.** When it does not, let the engine draw its built-in shape. **Never invent procedural art for an entity the LDtk already dressed** — that is the same failure as recoloring the tileset (§12.8), one scope down.

In the shipped pack: **`Gem` and `Spike` have tiles** (both from `celerock.png`, tileset uid 43); `Player` (drawn from `Player.png`, §4.4), `Spring`, and `DashRefill` do not.

| Entity def | `tileRect` | LDtk `tileRenderMode` | Renders as |
|---|---|---|---|
| `Gem` | `{ x:888, y:672, w:8, h:8 }` | `FitInside` | the authored tile, one blit |
| `Spike` | `{ x:992, y:688, w:8, h:8 }` | `Repeat` | the authored tile, **tiled** across each resized instance |
| `Player` / `Spring` / `DashRefill` | `null` | — | the engine's `DEFAULT_ENTITY_PALETTE` shape |

**The join key is the rect.** `ldtkLevelToLevelData` does not carry `__tile` onto `LevelEntity`, but the translated `rect` is exactly the instance's `px`/`width`/`height` — lossless. Index it **once per room** (memoize alongside the `CompiledLdtkRoom`; never rebuild per frame). **Do NOT join by `LevelEntity.id`** — ids are assigned over *recognized* entities only, so one unrecognized entity in the layer silently shifts the whole mapping.

**The render mode is authoritative (0.16.0).** The parser preserves the def's `tileRenderMode` (`Gem` = `FitInside`, `Spike` = `Repeat`), and the engine's `drawLdtkEntityTile` implements it. **Never derive fit-vs-repeat from rect geometry** — a `Stretch` or `Cover` def exists in the wild, and geometry-derived tiling renders the author's intent wrong.

```ts
type EntityTile = NonNullable<LdtkEntityInstance['__tile']>;
interface EntityArt { readonly tile: EntityTile; readonly mode: LdtkTileRenderMode }

const rectKey = (r: { x: number; y: number; width: number; height: number }) =>
  `${r.x}|${r.y}|${r.width}|${r.height}`;

/** Rect → authored art, for every instance in the room that has a display tile. */
function buildEntityTileIndex(level: LdtkLevel, project: LdtkProject): ReadonlyMap<string, EntityArt> {
  const index = new Map<string, EntityArt>();
  for (const layer of level.layerInstances ?? []) {
    for (const e of layer.entityInstances ?? []) {
      if (!e.__tile) continue;                 // no art assigned → engine fallback
      const def = project.defs.entities.find((d) => d.uid === e.defUid);
      if (!def) continue;                      // def not in the project → engine fallback
      index.set(`${e.px[0]}|${e.px[1]}|${e.width}|${e.height}`,
                { tile: e.__tile, mode: def.tileRenderMode });
    }
  }
  return index;
}

function entityTileOverride(
  index: ReadonlyMap<string, EntityArt>,
  tilesets: LdtkTilesetBundle,
): DrawLevelEntityOverrideMap {
  const draw = (ctx: CanvasRenderingContext2D, entity: LevelEntity): boolean => {
    const art = index.get(rectKey(entity.rect));
    if (!art) return false;                   // ← engine's DEFAULT_ENTITY_PALETTE draws it
    // The engine helper owns the blit: `Repeat` tiles a resized strip (a 40×8
    // Spike is five 8×8 tiles, never a smear), `FitInside` letterboxes — the
    // def's authored mode decides. `false` (unknown tileset, throwing draw)
    // hands the draw back to the engine shape.
    return drawLdtkEntityTile(ctx, art.tile, entity.rect, tilesets, art.mode);
  };
  // Every drawn kind routes through the same rule.
  return { hazard: draw, collectible: draw, spring: draw, dashRefill: draw,
           enemy: draw, trap: draw, exit: draw, platform: draw, movingPlatform: draw };
}
```

Per frame — hazards from `active.hazards`, strawberries from `derivePickups`'s `remaining` (already excludes collected ones):

```ts
for (const e of [...active.hazards, ...remaining]) {
  drawLevelEntity(ctx, e, { drawOverride: overrides });
}
```

**Fallback is engine-owned and total.** Returning `false` hands the draw back to `DEFAULT_ENTITY_PALETTE`. `drawLevelEntity` also catches a throwing override and falls through, so a corrupt tile rect degrades to the engine shape instead of killing the frame — do not add your own try/catch around it.

**Coordinate space.** `drawLevelEntity` draws at absolute `entity.rect` and takes **NO `worldOffset`** (unlike `cache.draw` / `drawLdtkLevel`). Translate the context yourself before the loop — and during a §5.5 slide apply the same `presentation.sourceOffset` / `destinationOffset` you pass to each room's tile draw, or the entities will detach from the tiles mid-slide.

**Accent colours come from the file too.** The instance's `__smartColor` is not preserved by the parser, but the *def's* `color` is — read `project.defs.entities.find(d => d.identifier === …)?.color` if you want the `drawGlow` halo tinted from the LDtk rather than hardcoded.

---

## 8. Game State FSM

Use the engine's `game-state` reducer. With seamless neighbour transitions there is **no per-room win/next loop** — progression is simply traversal (and, optionally, reaching a final goal):

- `menu → playing` via `{ type: 'start' }` on menu confirm. **The menu is a start menu with two entries — NEW GAME and RESUME GAME:**
  - **NEW GAME** wipes the persisted save (`storage.clear()` + `save = DEFAULT_SAVE`) then starts; **RESUME GAME** starts with the boot-loaded save untouched (§7's `loadSave(storage, DEFAULT_SAVE)`).
  - **RESUME GAME is shown only while the save carries progress** — any death or collected strawberry (a consumer `hasPersistedProgress(save)` predicate: `deaths > 0` or any `collected.length > 0`). While hidden, the selection is pinned to NEW GAME; hidden means omitted entirely (not greyed).
  - **Up/down toggles the selection** — a consumer-owned `menuSelection` on the world (`0` New, `1` Resume; the menu step owns it, render reads it). **A jump/dash/grab edge confirms** (Enter/Space are mapped to `jump`, so they confirm too; gamepad A and the touch jump button work as well).
  - **Run the menu step BEFORE the sim** each tick, so the kernel runs on the very tick the player starts; on confirm fire the FSM `start` and trigger the start room's title card. The HUD stays hidden while in `menu` — the menu owns the screen, and the save numbers would spoil RESUME.
  - **Render:** title + the entries in a left-aligned column (the `>` marker never shifts the label); the selected entry bright with a `>` marker, the rest dimmed (`drawTextOutlined`).
- `playing → gameover` via `{ type: 'die' }` on a hazard.
- `gameover → playing` via `{ type: 'retry' }` after a consumer-owned 12-tick respawn flash. **Respawn anchor, in priority order: (1) the last checkpoint, (2) the current room's authored spawn, (3) the point at which the player entered the current room across its seam.** Rule (3) is not a fallback curiosity — it is the normal case for 4 of the 5 shipped rooms (§5.6), and it is Celeste's own model: you restart at the edge you came in through, not back at the start of the chapter. Store the arrival position when `transitionPlatformerToRoom` resolves (`spawn.source === 'seam-entry'`) and keep it as the room's respawn anchor for as long as that room is active; respawn with zeroed velocity and the entry `facing`. A room with none of the three (never entered, no spawn) is unreachable and cannot be respawned into — that is a hard block, not a runtime state. **The respawn anchor is the only part of this the game owns:** the transition layer's own reset goes through `endRoomTransitionSession(session, brain, 'destination')` (§5.5), which returns a fresh detector and rebases the camera out of slide space if the death landed mid-slide. Call it on every `playing → gameover`, then respawn at the anchor — do not hand-reset the detector or the brain.
- **Chapter complete — terminal-room rule (§5.5 world contract, §12.7 #15), CORE.** The **terminal room** is the level with no `e` neighbour in `__neighbours`, derived from the project at boot (`Level_4` in the shipped pack — never hardcode the identifier). On seam-entry into the terminal room, fire the chapter-complete card (`drawTextOutlined`, `easeOutBack` via `createTweenState`) and transition the FSM however the game already handles completion. No `Goal` entity is created, the `.ldtk` is never edited, and the FSM `win` event stays unused. (For a substituted `.ldtk` that DOES define a `Goal`/`Exit` entity in a final room, the optional `playing → levelComplete` via `{ type: 'win' }` fires instead — a chapter-complete card on the authored goal.)

```ts
let gameState = createGameState();
gameState = reduceGameState(gameState, gameEvent, dt);
```

Use the shipped events (`start`, `die`, `retry`, `win`, `next`, `pause`, `resume`, `quit`); do not invent destination-mode events.

---

## 9. Game Feel Checklist (the juice — every item uses the engine)

- [ ] Launch stretch + landing squash (`advanceSquash` + `volumeScale` over `breathe`) — **procedural-fallback body only**; the supplied `Player.png` sprite stays stable 1:1 (squash distorts pixel art — §4.4).
- [ ] **Hit-stop on dash-into-wall** — trigger off the one-shot `dashBonk` moment on `state.moments` (horizontal AND vertical bonks; no ability-slice diffing, no velocity peeking).
- [ ] Hit-stop on death.
- [ ] Screen shake on dash-bonk and hard landings — gate on `landing.hard` / `dashBonk` from `state.moments` (`sineShake` + `shakeEnvelope`); the hard test is the tile-invariant `normalizedImpact` ratio, never a raw px/s threshold.
- [ ] **Camera brain deadzone follow** (Celeste bands) — smooth, no jitter; the player stays inside the band until it crosses the lead edge. **Cover-fit** `fitCameraZoom` (no empty side gaps on compact rooms).
- [ ] **Room transition is a SLIDE** (G5) — ~0.25–0.35 s, both rooms render, continuous screen position at the seam, momentum + particles carried across; reduced-motion uses an immediate seam-aligned cut.
- [ ] Air control during jump (the kernel's `airAccelMultiplier`).
- [ ] Dash trail particles (`spawn` 4 small white particles on each dash tick, culled by `cull`). (Seeded `mulberry32` rng — no `Math.random`.)
- [ ] Landing dust (`spawn` upward cone on landing); respawn flash.
- [ ] **Wall-grab feel**: latch snap, stamina drain (optionally a stamina bar UI), climb, away climb-hop launch (one `wallJumpLaunched` cue covers wall-jumps AND away climb-hops), straight-up climb-jump (`climbJumpLaunched`) + mantle scramble (`mantled`): grab + Up visibly rises beside the wall, arcs across the lip, and lands — there is NO single-frame snap to the ledge; overhangs fail safely without embedding.
- [ ] **Spring** boing + `springBounceVy`; **dash-refill** sparkle when `maxDashes` refills on a refill entity — **only when the LDtk actually provides springs / dash-refills** (check `report.capabilities.springs` / `.dashRefills` from the preflight; absent content is not a failure). **The shipped pack has neither** (§1.1), so wire the paths and mark this item *not exercised* — do not claim it verified, and do not edit the `.ldtk` to make it fire.
- [ ] Coyote time + jump buffer from the shipped `jumpAbility`; do not duplicate them.
- [ ] **Player sprite (supplied `Player.png`)** — stable **1:1** (no breathe/squash scaling on the sprite), facing mirror flips walk/jump with travel (no moonwalk), walk cycles cells 0–7, jump plays 60→64 then clamps on the fall frame, idle = cell 0; no shimmer while idle; dash aura glow + after-image trail are kept (they carry dash juice without distorting the sprite).
- [ ] **Entity art from the LDtk (§7.1)** — the strawberry is the authored `Gem` tile (glow behind it, never instead of it) and spikes are the authored `Spike` tile repeat-tiled across each resized strip; entities the `.ldtk` left undressed keep the engine's `DEFAULT_ENTITY_PALETTE` shape.
- [ ] **Spring-rod hair (`advanceSpringRod`)** — **OPTIONAL when using the supplied sprite**: the sprite art owns the silhouette, so hair is a cosmetic extra, **never an acceptance requirement** (per G5). Only add it for the wag-when-moving / lift-during-dash flourish; draw it OUTSIDE the sprite's facing mirror.
- [ ] Reduced-motion gate (`prefersReducedMotion`) renders room 1 and starts no loop.
- [ ] Room title cards fade in over 0.6 s (`createTweenState` + `easeOutCubic`); transition/"Cleared" cards use `easeOutBack`.

---

## 10. Audio (all synthesized via `createAudioAdapter`)

Unlock on first user gesture (one-shot `keydown`/`pointerdown` calling `audio.unlock()`). Then:

> **Sustained-sound rule:** one-shot cues (`playTone`/`playNoise`) fire on EVENT EDGES only — event pulses, foot-plant events, feel moments — never once per tick. A sound that lasts exactly as long as a state (the wall-slide scrape) is a sustained loop: start ONE `startNoiseLoop(...)` on the state's onset edge, keep the handle, and call `handle.stop()` on the first tick the state ends. NEVER re-fire a one-shot per tick to fake sustain — every burst restarts the same noise buffer, and 60 identical restarts/s phase-lock into a 60 Hz buzz.

- **Walk tap:** `playNoise(40, 'lowpass', 200, 0.12)` per `advanceFootPlant` event.
- **Jump:** `playTone('sine', 200, 400, 80, 0.2)`.
- **Wall-jump:** `playTone('triangle', 300, 500, 60, 0.18)`. **Away grab+jump** (climb-hop) reports through the SAME `wallJumpLaunched` pulse (a deliberate widening since physics v12) — one mapping covers both.
- **Straight-up climb-jump** (on `state.events.climbJumpLaunched`): `playTone('sine', 260, 520, 70, 0.16)` — a lighter, upward version of the wall-jump.
- **Mantle** (on `state.events.mantled`): a soft two-part "scramble up" — `playNoise(60, 'lowpass', 350, 0.2)` then `playTone('triangle', 220, 300, 50, 0.1)`; the landing afterwards fires the normal `landing` moment cues.
- **Wall-grab latch** (on the `grabLatch` moment): `playTone('triangle', 180, 160, 40, 0.12)`; **stamina-out gasp** (on the `staminaExhausted` moment): `playNoise(80, 'lowpass', 300, 0.25)`.
- **Wall-slide:** on the `startedWallSlide` event pulse, start ONE sustained scrape — `audio.startNoiseLoop('lowpass', 600, 0.06)` — and store the handle on the audio state; on the first tick `wall?.kind === 'wallSlide' && wall.sliding` is false, call `handle.stop()` (it fades out over ~0.1 s — a natural tail, no special handling). NEVER a `playNoise` per tick for this (see the sustained-sound rule above).
- **Dash:** `playNoise(60, 'bandpass', 1500, 0.18)`; **dash-into-wall thump** (on the `dashBonk` moment): `playTone('square', 120, 90, 70, 0.25)`.
- **Spring** (on the `springLaunch` moment): `playTone('sine', 300, 700, 90, 0.2)`; **dash-refill** (on the `dashRefill` moment): `playTone('triangle', 700, 1300, 50, 0.12)`.
- **Land (hard)** (`landing.hard`): `playNoise(80, 'lowpass', 300, 0.3)`; (soft): `playNoise(50, 'lowpass', 250, 0.18)`.
- **Strawberry:** two-note arpeggio — `playTone('triangle', 600, 1200, 60, 0.15)` twice ascending.
- **Death:** `playNoise(120, 'lowpass', 400, 0.3)` + descending `playTone('sine', 400, 80, 200, 0.25)`.
- **Respawn:** rising `playTone('sine', 200, 600, 100, 0.18)`.

---

## 11. File Layout (Suggested)

```
vite.config.ts         # §5.7: dev-only ldtk-hot-reload plugin (public/*.ldtk change → 'ldtk:update'; apply: 'serve')
public/                # the §1.1 assets, FLAT — the .ldtk names its tileset as a bare sibling
  celerock.ldtk        #   fetched via base-URL-aware projectUrl (§5.1)
  celerock.png         #   resolved from the project's relPath, NOT fetched directly
  Player.png           #   fetched as './Player.png' (§4.4)
src/
  main.ts              # boot: load LDtk + tilesets, canvas, store, audio.unlock, loop.start()
  ldtk.ts              # loadLdtkProjectAssets (or parseLdtkProject+buildLdtkTilesetBundle), inspectLdtkPlatformerProject, createLdtkRoomCache
  camera.ts            # per-room VirtualCamera config, cover-fit fitCameraZoom, createCameraBrain/updateCameraBrain, room slide
  transition.ts        # room-transition session wiring: pollRoomTransition → mapLdtkRoomEntry → transitionPlatformerToRoom → beginSessionRoomSlide / advanceSessionRoomSlide / endRoomTransitionSession
  game/
    state.ts           # CelerockSave (collectibles: Record<levelIid, CollectibleSave>, deaths), World/Room runtime
    step.ts            # fixed-step: input → stepPlatformer → pickups → audio → brain
    render.ts          # surface-cache draw (createLdtkLevelSurfaceCache) + player art + entities + particles + UI
    entity-art.ts      # §7.1: per-room rect→{__tile, mode} index + the drawLevelEntity drawOverride (drawLdtkEntityTile — LDtk tile first, engine shape otherwise)
    player.ts          # sprite renderer (drawSprite) primary — load+compile Player.png, deriveSpriteAnimKind per tick; procedural face/hair/feet fallback (kernel does physics)
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

Assert against the shipped pack's known shape (§1.1) — these are exact, not lower bounds, so a substituted or truncated asset fails loudly instead of degrading into a half-empty world:

- `loadLdtkProjectAssets({ projectUrl: `${import.meta.env.BASE_URL}celerock.ldtk` })` resolves `{ ok: true, project, tilesets }` with `project.levels.length === 5` and one tileset whose `relPath === 'celerock.png'` (or, on the manual path, `const { ok, project, errors } = parseLdtkProject(text)` has `ok && project`).
- `inspectLdtkPlatformerProject(project)` reports `totalSpawns === 1`, `tileSizes` `[8]`, `disconnectedRoomIids` empty, and `spawnLessRoomIids.length === 4` — the last is an **expected warning**, so assert it rather than asserting it away.
- The start room compiles via `createLdtkRoomCache(project, {...}).getStartRoom()` → `{ ok: true, room }` with `room.ldtkLevel.identifier === 'Level_0'`, `room.spawn.source === 'authored'`, and `room.diagnostics` empty; its buckets carry ≥1 hazard and exactly 1 collectible. (Low-level: `ldtkLevelToLevelData(startLevel, project).level` is defined and passes through `compileGeneratedLevel` with the player config.)
- Capability assertions match the §1.1 matrix exactly: `hazards` / `collectibles` / `multiRoom` true; `springs` / `dashRefills` / `exits` / `ladders` / `movingPlatforms` false. If a future asset update lights one of these up, this test is where you find out.
- `Player.png` decodes at 160×128; a forced load failure leaves `compiled === null` and the game still steps (procedural fallback, §4.4).
- **Entity art contract (§7.1).** The `Gem` and `Spike` entity defs each carry a non-null `tileRect` whose `tilesetUid` matches the `celerock.png` tileset def; `Player` / `Spring` / `DashRefill` have `tileRect === null`. The parsed `tileRenderMode` values are asserted too — `Gem` → `'FitInside'`, `Spike` → `'Repeat'` (0.16.0) — so the render mode is authoritative from the file, not derived from rect geometry. The §7.1 index resolves art for **all 6 hazards and the 1 collectible** across `Level_0` + `Level_4` — 7/7, zero misses. At least one `Spike` instance is larger than its 8×8 tile (`40×8` in `Level_4`), so the helper's `Repeat` path is exercised rather than dead code.

### 12.1b Seam-Entry Respawn

- Cross from `Level_0` into `Level_1` (no authored spawn), then die on a hazard.
- Assert: the respawn places the player at the stored seam-entry position for `Level_1` — **not** at `Level_0`'s authored spawn and **not** at the origin — with zeroed velocity and the entry `facing`, and the active room is still `Level_1` (§8, rule 3).

### 12.1c LDtk Hot Reload (dev-only, §5.7)

- With `npm run dev` serving and the game `playing`, save a trivial edit to `public/celerock.ldtk` (move one `Spike` entity). Assert: the active room recompiles from the saved file within ~1 s — `active.hazards` reflects the moved spike, the surface cache rebaked (no stale art), the §7.1 entity-tile index rebuilt, the terminal room re-derived — and the reload used a cache-busted fetch keyed by the generation counter (`?g=`, never `Date.now()`).
- Assert state preservation across the swap tick: `state.core.{x,y,vx,vy,facing}` identical before/after, `save` (collectibles + deaths) unchanged, `gameState` still `playing`, and no page reload occurred (the loop kept stepping; no `location.reload` anywhere in game code).
- Save a syntactically invalid `.ldtk` (truncated JSON). Assert: the swap is rejected — `project`, `rooms`, `active`, and the surface-cache bakes are the SAME objects (reference identity), and the error is surfaced (console + dev toast). The game remains fully playable.
- Delete the active room from the `.ldtk` and save. Assert: same rejection path (the active room's iid is gone — `rooms.has(active.ldtkLevel.iid)` is `false`, probed with `has` so `get` never throws), playable world untouched.
- Save while a §5.5 slide is active. Assert: the swap defers until `session.slide === null`, then applies exactly once (not mid-slide, not twice).
- Save while the player stands where a new wall is drawn. Assert: the embedded body recovers through `settlePlatformerState` (or, when fully enclosed, respawns at the §8 anchor) — the kernel never phases into geometry.

### 12.2 Dash-into-Wall Hit-Stop Timing

- Script: place the player 2 tiles left of a solid wall, trigger a rightward dash.
- Assert: on the contact tick, `state.moments` carries exactly one `{ kind: 'dashBonk', normalX: -1, solidId }` (horizontal dash into a right wall — the surface normal points back against the dash) AND `isHitStopActive(hitStop)` is true for ≥4 ticks AND `shakeEnvelope` is non-zero. The dash itself does NOT end on contact in this engine version (it ends on timeout; `dashEnded.reason === 'timeout'` with the ending-tick `terminalContact`) — the bonk cue keys off the `dashBonk` moment, never off the dash phase going idle.
- Assert: a dash PINNED against the wall for multiple ticks emits exactly ONE `dashBonk` per blocked axis per dash (a second dash re-arms it).
- Assert: the player's `state.core.x` never exceeds the wall's left edge by more than the kernel's penetration tolerance (the dash never phases through).

### 12.3 Room-Transition Smoke Test

**This file is `tests/transition-smoke.test.ts` — it must exist and pass before Stage 4 begins (§14).**

- Drive scripted input from the start room's spawn across a `__neighbours` edge into a linked room (the engine path: `pollRoomTransition` → `mapLdtkRoomEntry` → `transitionPlatformerToRoom` → `beginSessionRoomSlide`).
- Assert: `pollRoomTransition` returns `{ type: 'idle' }` for a body still inside the room AND for a crossing outside the shared seam span (the void); inside the span it returns `{ type: 'exit' }` with the cardinal exit. (The low-level primitive `findLdtkRoomExit` returns `undefined` in the first two cases and the cardinal exit in the third — the session poll wraps it.)
- Assert: after the transition, `active.ldtkLevel.iid` is the neighbour's; the player's `vx`/`vy`/`facing` are preserved across the seam; the transition's `spawn.source === 'seam-entry'`; the brain's active vcam is the new room's (no exception, no NaN position).
- Assert: a second `pollRoomTransition` while the slide is active returns `'suppressed-slide-active'` and no second transition begins; a mid-slide `beginSessionRoomSlide` returns `ok: false` with session + brain unchanged.
- Assert: the player's SCREEN position is continuous at the seam (`presentationForRoomSlide(slide).playerOffset` is the full correction at `t=0` and eases to zero; the slide renders both rooms; no teleport pop), and the slide respects `prefersReducedMotion()` (immediate seam-aligned cut when reduced-motion is on).
- Assert: `advanceSessionRoomSlide` completes the slide with `done === true` and `session.slide === null` (the finish-rebase applied exactly once); `endRoomTransitionSession(session, brain, 'destination')` mid-slide returns a fresh idle session and a destination-local brain (no slide-space leak).

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

1. Playable in the browser via `npm run dev` with **Celeste's PC-default keyboard bindings** (`←→↑↓` move, `C` jump, `X` dash, `Z` grab, `R` respawn — see §4.3; NOT the engine's Space/Shift/KeyK standard map) **and** on-screen touch buttons on coarse-pointer devices (via `createTouchButtonSet`).
2. **Start menu (§8).** The game boots to a `menu` state offering **NEW GAME** and **RESUME GAME** (up/down select, jump/dash/grab edge confirms — Enter/Space confirm via the jump map). RESUME GAME is hidden while the save carries no progress; NEW GAME wipes the persisted save and starts fresh; RESUME starts with the boot-loaded save. The HUD is hidden while in `menu`.
3. **Loads the supplied LDtk + tileset** and renders the tileset through the **surface cache** (`createLdtkLevelSurfaceCache` — pixel-crisp, untinted; `drawLdtkLevel` remains the underlying baker).
4. The Celeste kit is present and works on the supplied geometry: **dash (8-dir, startup freeze, refills on land) + wall-grab/stamina + wall-slide + wall-jump + dash-tech.** **No `doubleJump`.** Springs, dash-refills, moving platforms, and ladders are **capability-aware** — exercise each one the preflight reports present (`report.capabilities.springs` / `.dashRefills` / `.movingPlatforms` / `.ladders`); absent ones are not a failure (G4).
5. The **camera brain** drives the view (deadzone follow + per-room vcam + **cover-fit** `fitCameraZoom` + slide on transition). No legacy `createCamera`/`updateCamera`.
6. Room-to-room travel is **seamless via `__neighbours`** using the session path (`pollRoomTransition` → `transitionPlatformerToRoom` → `beginSessionRoomSlide` → `advanceSessionRoomSlide`; §5.5): a ~0.25–0.35 s **slide** (both rooms render, continuous screen position at the seam), momentum (`vx`/`vy`/`facing`) preserved, particles rebased into the destination room; reduced-motion uses an immediate seam-aligned cut. The camera does not pop between rooms.
7. The **dash-into-wall** moment (horizontal AND vertical — read the `dashBonk` feel moment on `state.moments`, never a hand-rolled velocity threshold) applies hit-stop and shake (§12.2).
8. Strawberries persist across page reload via `createLocalStorageSaveStorage` + `writeSave` (keyed by `level.iid`).
9. Death counter increments every respawn and persists through the same save adapter.
10. `prefersReducedMotion` renders the start room statically and never calls `loop.start()`.
11. **Zero duplicate engine systems**: no direct animation-frame loop, no random authoritative simulation, no manual collision resolver, no manual tile-blit loop (entity display tiles go through `drawLdtkEntityTile`, §7.1), no legacy camera.
12. **No moonwalk.** Running left faces left — with the supplied sprite via `drawSprite(..., { facing })` (its internal `ctx.scale(facing,1)` mirror about the frame's horizontal center); with the procedural fallback via `ctx.scale(facing, 1)` around the body draw.
13. **No appendage blow-out.** Hair uses `advanceSpringRod`, never raw `advanceSpringChain`.
14. **Supplied `Player.png` sprite renders pixel-crisp** — no shimmer while idle (`imageSmoothingEnabled = false`, stable 1:1, no per-frame squash/breathe scaling on the sprite). Walk cycles cells 0–7 and flips with `facing`; jump plays cells 60→64 once then **clamps on the fall frame** until landing; idle = cell 0. If `Player.png` fails to load/compile at boot, the procedural body renders instead and the game is still playable.
15. **Terminal-room completion.** Reaching the **terminal room** (the level with no `e` neighbour in `__neighbours` — derived at boot, never hardcoded) triggers the chapter-complete card (`createTweenState` + `easeOutBack`); the game acknowledges the summit. No `Goal` entity is created and the `.ldtk` is never edited.
16. **Entities render their authored LDtk tile (§7.1).** The strawberry draws as the `Gem` tile from `celerock.png` — not a procedural diamond — and spikes draw as the `Spike` tile **repeat-tiled** across each resized instance (not stretched, not a flat red box). Entities whose LDtk def assigns no tile fall back to `drawLevelEntity`'s `DEFAULT_ENTITY_PALETTE` shape.
17. **Dev-time LDtk hot reload (§5.7) — standard scope.** Under `npm run dev`, saving `public/celerock.ldtk` swaps the edited world into the live game within ~1 s — active room recompiled **by iid**, surface cache cleared + rebaked, §7.1 entity-tile index and hazard rects rebuilt, terminal room re-derived — while the live player state (`x`/`y`/`vx`/`vy`/`facing`/abilities/stamina), the save, the death counter, and the FSM are preserved verbatim (no `location.reload()`, no respawn, no menu bounce). An invalid edit or a deleted active room leaves the playable world untouched (transactional reject) with a surfaced error; a save landing mid-slide defers to the slide's completion; an edit that embeds the player recovers via `settlePlatformerState` (or the §8 anchor). The `vite build` output contains none of this wiring (`apply: 'serve'` + the `import.meta.hot` guard).

### 12.8 Forbidden Patterns

**This build is NOT complete merely because it renders the LDtk tiles.** Static analysis (grep / AST) must find **none** of these in game code — any hit is a failure, not a TODO:

- **No `createCamera` / `updateCamera`** (the legacy follow camera) — use the camera brain. **Using the legacy camera is a failure**: it is superseded; vcams, deadzone follow, and blends are the only acceptable view driver.
- **No `doubleJumpEnabled` / `doubleJumpAbility`** — Celeste has no double jump. **Enabling double-jump is a failure**: the kit is dash + grab/stamina + wall-slide + wall-jump + dash-tech. If `doubleJumpEnabled` is on, it is not Celeste.
- **No `compileLevel` with hand-built `LevelData` tiles** — use `ldtkLevelToLevelData` + `compileGeneratedLevel`.
- **No hand-authored ASCII level grids** / no `buildRoomTiles` — geometry comes from LDtk. **Hand-authoring fallback ASCII rooms is a failure**: a committed `rooms/*.ts` of ASCII grids defeats the entire point of this revision.
- **No `requestAnimationFrame`** in game code (only in the engine's `createGameLoop`).
- **No `Math.random` / `Date.now`** in game code.
- **No manual gravity/stamina/dash-counter integration** (`vy += gravity * dt`, slide timers, dash-frame counters) — all movement goes through `stepPlatformer(..., config)` or `createPlatformerController(pipeline, config).step(...)`. **Hand-rolling a wall-grab stamina timer or a dash-frame counter is a failure** — those are the kernel's `wallGrabAbility` and `dashAbility`; if you find yourself writing them, STOP and use the engine.
- **No tile-art recoloring** — tiles are drawn solely through `createLdtkLevelSurfaceCache` (which bakes verbatim via `drawLdtkLevel`); no per-tile `fillRect`/`fillStyle` overrides on level tiles. **Recoloring or overpainting the tileset is a failure** — the supplied tileset is the visual identity; replacing it with `fillRect` boxes or per-room tints is the same failure mode as the old "six grey boxes."
- **No procedural art for a dressed entity** — if an entity's LDtk def assigns a `tileRect`, its authored tile is the sprite (§7.1). A `fillRect` gem, a polygon spike, or a "pulsing diamond outline" standing in for art the `.ldtk` already supplies is a failure — same class as recoloring the tileset, one scope down. Entities with no assigned tile fall back to `drawLevelEntity`'s `DEFAULT_ENTITY_PALETTE` shape, which is correct and expected.
- **No stretched entity tiles** — a resized instance over a smaller tile (LDtk `tileRenderMode: 'Repeat'`; the shipped `40×8` / `24×8` / `8×16` spikes over an `8×8` tile) must be **repeat-tiled**, never scaled to fit. A smeared 40px spike passes a code review and fails a screenshot.
- **No `advanceSpringChain`** outside `node_modules` (hair uses `advanceSpringRod`).
- **No deep imports** (no `aicraft-engine/src/...` — only the root barrel).
- **No death/respawn trigger on a `__neighbours` seam edge** (e.g. `player.x < -40 || player.x > width + 40` → kill). Walking/falling off a linked edge must transition (§5.5); void-death checks are only valid for edges with no cardinal neighbour / crossings outside the shared seam span.
- **No camera pop between rooms** — every `__neighbours` crossing must use the engine slide path (G5): `beginSessionRoomSlide` / `advanceSessionRoomSlide`, driving the slide camera via `presentationForRoomSlide` + `updateCameraBrain`, with both rooms rendered, the player's screen position continuous at the seam, and the lens easing from the old zoom to the new `fitCameraZoom` (immediate seam-aligned cut only under reduced-motion). **A jarring camera pop between rooms is a failure** — the view must not snap on a seam crossing.
- **No momentum loss at a `__neighbours` seam** — the player must carry `vx` / `vy` / `facing` across the seam; Celeste's rooms are continuous, not teleporting. **Losing momentum at a seam is a failure.**
- **No silent dash-into-wall** — the bonk is the signature Celeste feel beat; on contact it must fire `triggerHitStop` + `sineShake`. **A silent dash-into-wall is a failure** — missing those cues means the runtime does not teach dash feel.
- **No refresh-based "hot reload"** — `location.reload()` (or any full-page teardown) as the `.ldtk` edit loop discards exactly the live state §5.7 exists to preserve, and it is the cheap implementation this section forbids. **A page refresh on `.ldtk` save is a failure**: the swap must be live, swap-atomic, and transactional (§5.7).

---

## 13. Visual & Play Gates

Before the build is accepted:

1. **Screenshot of the game playing the supplied LDtk** — the tileset renders pixel-crisp and untinted; the camera brain deadzone-follows the player smoothly.
2. **Screenshot of a room-to-room transition** — verify a smooth slide (both rooms visible mid-slide), continuous player screen position at the seam, and that momentum carries across.
3. **Stamina/grab in action** — a shot of the player wall-grabbing (stamina draining) and climb-hopping off.
4. **Manual playthrough** across every room the LDtk contains; verify dash, wall-slide, wall-jump, and (when the LDtk provides them) springs/dash-refills/moving platforms all feel Celeste-tight.
5. **Dash-into-wall** fires hit-stop + shake on ≥90% of attempts (it is a deterministic mechanic, not a precision one).
6. **Fast checkpoint retry:** <2 seconds from death to controllable respawn.
7. **Player sprite** — the supplied `Player.png` renders pixel-crisp (no edge shimmer while idle), walk flips with `facing` (no moonwalk), jump plays 60→64 once then holds the fall frame, idle = cell 0. (Or, if `Player.png` is absent, confirm the procedural fallback renders and the game is still playable.)
8. **Entity art (§7.1)** — a screenshot of `Level_0` showing the strawberry as the authored `Gem` tile (not a diamond outline), **and** a screenshot of `Level_4` showing the five spike rows as repeated tileset spikes at their correct 8px pitch. The stretch-vs-tile error is invisible in code review and obvious here; this gate exists for exactly that.
9. **LDtk hot reload (§5.7)** — a before/after screenshot pair of one live edit: move a spike (or draw a wall) in LDtk while the game is `playing`, save, and capture the same room ~1 s later — the edit landed, the surface cache rebaked, and the player is still mid-run at the same position with the same momentum.

---

## 14. Implementation Workflow

Build in this order. Each stage must pass its gate before the next begins.

### Stage 1: LDtk Load + Preflight + Tileset + Camera Brain Graybox
1. Vite + TypeScript + `aicraft-engine@0.16.0`. Wire `createGameLoop` with an `onError` handler (§2) so a throw can't silently freeze the loop.
2. `loadLdtkProjectAssets({ projectUrl })` the supplied `.ldtk` + PNG(s) in one call.
3. **Asset preflight (G3):** `inspectLdtkPlatformerProject(project)` — log the FULL report: `levelCount`, per-level `neighbourIids` and `connected`, and `capabilities` (including `multiRoom`). Treat `capabilities.multiRoom === true` as the signal that Stage 3 is in scope. Note explicitly that `capabilities.exits` counts Exit ENTITIES, not `__neighbours` seam traversal — it is `false` for this pack even though all five rooms are chained. Missing springs/dash-refills/etc. are informational; a total lack of spawns is the only hard block.
4. `createLdtkRoomCache(project, {...}).getStartRoom()` the start room; render it through the surface cache (`createLdtkLevelSurfaceCache`, which bakes via `drawLdtkLevel`).
5. Wire `createCameraBrain` + a per-room follow `VirtualCamera` (deadzone bands, **cover-fit** `fitCameraZoom`).
6. Drive the kernel with `PRECISION_PLATFORMER` (no Celeste opt-ins yet) so a box walks and jumps across the tileset. **This box is a temporary graybox only** — it is replaced by the `Player.png` sprite at the very start of Stage 2 (there is intentionally no "procedural player then swap to sprite" phase).
7. **Wire §5.7 LDtk hot reload (dev-time, standard).** Author the `vite.config.ts` watcher plugin (`apply: 'serve'`) and the `import.meta.hot.on('ldtk:update')` handler: cache-busted re-load via `loadLdtkProjectAssets({ fetch })`, a fresh `createLdtkRoomCache` from the same `ROOM_CACHE_OPTIONS` (§5.2), active room resolved by iid, `surfaceCache.clear()`, transactional reject on any failure. From this stage on, the design loop for every later stage is "edit `public/celerock.ldtk`, save, watch it land live."
8. **Gate:** the supplied tileset renders pixel-crisp and untinted; the camera brain deadzone-follows with no side gaps; the player does not moonwalk; **saving a trivial `.ldtk` edit while the graybox walks lands live within ~1 s with the box's state preserved.**

### Stage 2: Celeste Movement Feel + Sprite Player
1. Apply the full `playConfigFor` kit (`groundDuckEnabled: false` is baked into `playConfigFor` — §4.1; `climbEnabled` is a harmless default, since the shipped pack has no ladders), plus the Celeste-default key bindings (§4.3: Arrows + `C` jump / `X` dash / `Z` grab / `R` respawn — do NOT use the engine's `STANDARD_KEYBOARD_PLATFORMER_MAP`).
2. **Render the sprite player from the first play tick.** Load + compile `Player.png` at boot and draw it via the §4.4 sprite pipeline (stable 1:1, feet-anchored, facing mirror inside `drawSprite`, NO squash on the sprite). The graybox box from Stage 1 is removed here. The procedural body is wired ONLY as the boot-time load-failure fallback (`compiled === null`).
3. Verify dash (startup freeze, 8-dir, refill on land), wall-slide (decaying), wall-jump, wall-grab (stamina, climb, direction-aware climb-jump, ledge mantle), springs, dash-tech.
4. **Gate:** all five core abilities demonstrably work in the supplied rooms AND the player renders as the `Player.png` sprite (not a box, not the procedural body). Stamina drains and refills. Dash refills on land.

### Stage 3: Seamless Room Transitions
1. Wire the session orchestrator (§5.5): `createRoomTransitionSession()` once at boot; per tick `pollRoomTransition(session, state.core, active.ldtkLevel, project)`; on `'exit'` resolve the neighbour from `createLdtkRoomCache` (lazy compile + cache by `iid`), `mapLdtkRoomEntry` → `transitionPlatformerToRoom` (pass `destinationSolids` from the cached `CompiledLdtkRoom`) → `beginSessionRoomSlide` (adopt `session`/`brain` only when `begun.ok`).
2. Preserve `vx`/`vy`/`facing` across the seam; revalidate support via `destinationSolids`; carry particles with `rebasePointBetweenLdtkRooms` / `slide.particleRebaseDelta`.
3. Advance per presentation tick with `advanceSessionRoomSlide(session, dt, brain)`; drive the slide camera yourself from `session.slide` via `presentationForRoomSlide` + `updateCameraBrain` (both rooms render, continuous screen position, ease the lens to the new `fitCameraZoom`; immediate seam-aligned cut only under reduced-motion). On death/retry/teleport/reset call `endRoomTransitionSession(session, brain, 'destination')` — never a bare slide cancel.
4. **Gate:** the §12.3 transition smoke test exists as a passing test file — `tests/transition-smoke.test.ts` — before Stage 4 begins. Walking/falling/jumping off a room edge flows into the next room with momentum and a smooth slide; the camera does not pop; a second transition cannot begin mid-slide.

### Stage 4: Hazards + Strawberries + Save
1. Hazard AABB checks (static + moving-platform-child); death → hit-stop → respawn at last checkpoint.
2. **Entity art (§7.1):** build the per-room rect→`{__tile, mode}` index (mode = the def's parsed `tileRenderMode`, resolved via `defUid`) and wire `drawLevelEntity` + the `drawOverride` calling `drawLdtkEntityTile`. Spikes and the strawberry must draw as their authored `celerock.png` tiles from the first tick they appear — resized spike strips **repeat-tiled**, never stretched. Entities with no assigned tile keep the engine's `DEFAULT_ENTITY_PALETTE` shape.
3. `derivePickups` → `collect` → `writeSave` per room, keyed by `level.iid`.
4. Death counter increment + persistence.
5. Start menu (§8): NEW GAME / RESUME GAME selection — NEW GAME wipes the persisted save; RESUME GAME appears once the save carries progress (`hasPersistedProgress`).
6. **Gate:** hazards kill and respawn correctly; **spikes and the strawberry render as their LDtk tiles (§12.7 #16)**; strawberries persist across reload; death counter persists; NEW GAME starts from a wiped save, RESUME from the boot-loaded one.

### Stage 5: Juice + Polish
1. Dash-into-wall hit-stop + shake; hard-landing shake; landing dust; dash trail.
2. Squash & stretch (`advanceSquash`) — **procedural-fallback body only**; the supplied `Player.png` sprite stays stable 1:1 (squash distorts pixel art — §4.4). Spring-rod hair (optional under the sprite); parallax background.
3. Stamina bar UI; room title cards; HUD (death counter).
4. **Gate:** the game feel matches Celeste-tight. The dash-into-wall bonk is satisfying. Grab/stamina reads clearly.

### Stage 6: Audio
1. `createAudioAdapter` + all §10 cues; unlock on first gesture.
2. **Gate:** every ability has a distinct cue; the wall-slide is ONE sustained `startNoiseLoop` scrape started on `startedWallSlide` and stopped when sliding ends (no per-tick one-shots — hold into a wall and listen: a soft continuous scrape, not a buzz); reduced-motion path creates no audio adapter.

### Stage 7: Verification
1. Run all static contracts (§12): load smoke, dash-into-wall timing, transition smoke, persistence, determinism, LDtk hot reload (§12.1c).
2. Grep for forbidden patterns (§12.8).
3. Capture the §13 screenshots.
4. **Gate:** all tests pass; no forbidden patterns; screenshots confirm faithful tileset + Celeste feel.

---

## 15. Stretch Goals (only after criteria 1–16)

- **"Focus" virtual camera.** A second vcam with higher `priority` that takes over for vistas, reveals, or boss moments (a `fixed` body or tighter follow), blended in/out via the brain's priority selection.
- **Badeline chase ghost (visual only):** render a tinted "ghost" whose input snapshot is the player's from N frames ago — buffer the last N `PlatformerInput`s in a ring, replay them through a second kernel instance each tick. No new physics code.
- **Cosmetic hair colour unlocks** via `generateSkinVariants` + `createMemoryIAPAdapter` from the `cosmetics` + `iap` pillars.
- **Per-room seeded palette** for parallax/UI accents via `generatePalette`, kept strictly off the level tiles.

---

## 16. Install & Version

```bash
npm install aicraft-engine@0.16.0
```

`0.16.0` is the pin for this brief — the **authoritative entity `tileRenderMode` parse + the `drawLdtkEntityTile` entity-art helper** (§7.1), on top of the room-transition session orchestrator + per-axis detector latch + preflight-`multiRoom` release line. It builds on the `0.7.0` golden path and three earlier system drops:

- **Camera brain** (`0.6.0`) — `createCameraBrain`, `updateCameraBrain`, `VirtualCamera`, deadzone follow, blends, bounds + letterbox. The blend fixes (continuity when a vcam source is removed, `dt=0` no-op, blend-clamp crossfade) are directly relevant to the §5.5 room-transition slide.
- **LDtk loader** (`0.5.0` parser/translator/renderer, hardened through `0.6.0`) — `parseLdtkProject`, `ldtkLevelToLevelData`, `drawLdtkLevel`, `buildLdtkTilesetBundle`, `LDTK_DEFAULT_ENTITY_MAP`.
- **Phase 0–9 movement overhaul** (`0.6.0`) — single `core.vy` authority, `LaunchIntent` arbitration, shared `LocomotionState`, decaying wall-slide, 8-dir dash + startup freeze, dash-tech (super/hyper/wavedash/duck), wall-grab + stamina + climb-hop, corner correction, springs/dash-refills, analog `moveX`, `groundDuckEnabled` opt-out.

The **`0.7.0` golden-path additions** (still the load-path backbone of this brief):

- **`loadLdtkProjectAssets`** — high-level fetch + decode + bundle (URL-encoding, bounded decode, skip-icons, defensive host access). Replaces the hand-rolled parse + `async` tileset loop that drifted.
- **`inspectLdtkPlatformerProject`** — the G3 asset preflight (capability-aware acceptance, G4).
- **`compileLdtkRoom` / `createLdtkRoomCache`** — per-room translate+compile+bucket+cache; replaces hand-rolling and the false `compiled.entities` assumption.
- **`scalePlatformerConfig` / `createPrecisionPlatformerConfig`** — unit-aware tile scaling; replaces hand-rolled `* tileSize/16`.
- **`IDLE_EDGE` + `STANDARD_KEYBOARD_PLATFORMER_MAP` + `STANDARD_GAMEPAD_PLATFORMER_MAP`** — exported (gamepad uses W3C index strings, not `'b0'`/`'dpleft'`).
- **`solidIdForEntity` / `entityIdFromSolidId`** — entity solids are `entity-<id>` (not `solid-`); tile solids are a separate `tile-…` namespace.
- **Spawn fix** — `'rest-on-surface'` resolution (no floor embed, no hand-rolled settle) + `settlePlatformerState` recovery.
- **Game loop** — `onError` / `errorPolicy` so a consumer throw can't silently freeze the loop on its last frame.

The **`0.9.0` feel + traversal + mantle additions** this brief now prefers — still required, inherited:

- **`state.moments`** — the structured feel channel (single-tick, presentation-only): `landing { impactSpeed, normalizedImpact, hard, solidId }` (the hard test is a RATIO, identical at 8/16/32 px), one-shot `dashBonk { normalX, normalY, solidId }` per blocked axis per dash (horizontal AND vertical), observation-only `dashEnded { reason, terminalContact }`, `grabLatch`/`staminaExhausted` pulses, `springLaunch { super, solidId }`/`dashRefill`. Replaces reverse-engineering feel from boolean pulses + velocity peeks (the unscaled `prevVy > 520` failure).
- **`findLdtkRoomExit` / `mapLdtkRoomEntry` / `transitionPlatformerToRoom` / `rebasePointBetweenLdtkRooms`** — the pure room-transition helpers over LDtk `__neighbours` (seam-span gated, momentum-preserving, `'seam-entry'` provenance, never settles).
- **`beginRoomSlide` / `advanceRoomSlide` / `presentationForRoomSlide` + `enterRoomSlideCameraSpace` / `finishRoomSlideCameraSpace` / `cancelRoomSlideCameraSpace`** — the engine-owned slide orchestrator composing the camera brain (§5.5).
- **`fitCameraZoom`** — the explicit cover/contain/native fit policy (§5.4).
- **Mantle wave (direction-aware grab+jump + ledge mantle)** — the §4.1/Stage 2 mechanics: neutral/toward grab+jumps launch straight up (`climbJump`), away keeps the climb-hop, and grab+Up near a clear lip mantles. New launch sources `'climbJump'`/`'mantle'`; new event pulses `climbJumpLaunched`/`mantled`; `wallJumpLaunched` deliberately widened to also fire for away climb-hops.
- **Compatibility note (physics v11 → v12):** the feel channel + mantle change wall-grab trajectories ON PURPOSE (neutral/toward grab+jumps now rise straight up; grab+Up near a clear lip mantles), and the `moments` state field is replay data. `PlatformerEvents` gained `climbJumpLaunched` + `mantled`, and `wallJumpLaunched` was DELIBERATELY WIDENED to also fire for away climb-hops — consumers reading that pulse will start seeing climb-hops. v11 replays are rejected under v12. A consumer that manually constructs a complete `PlatformerState` must pass `moments: []`.

The **`0.15.0` transition-session additions** — still required, inherited:

- **Room-transition session orchestrator** — `createRoomTransitionSession` / `pollRoomTransition` / `beginSessionRoomSlide` / `advanceSessionRoomSlide` / `endRoomTransitionSession` (§5.5): one immutable `{ detector, slide }` state machine. The consumer stores the returned session; the session auto-adopts the detector, suppresses polls while a slide is active, applies the finish-rebase exactly once on completion, and cancels-with-rebase on death/retry/teleport/reset. The Celerock-1 failure modes (detector state discarded after transition, second transition during an active slide, death mid-slide leaving the camera in slide space) become structurally impossible.
- **Per-axis containment latch on `detectLdtkRoomExit`** — an exit additionally requires the body to have been fully contained once on that exit's crossing axis; the orthogonal axis is not gated (a diagonal exit straight off an arrival still fires). Straddle suppression is intrinsic and reset-immune — even a discarded or fresh detector state cannot tick-tock.
- **Preflight `capabilities.multiRoom`** — the top-level "this is a multi-room chained world" signal. `capabilities.exits` counts Exit ENTITIES, not `__neighbours` seam traversal, so it stays `false` for this pack; `multiRoom` is the Stage-3-in-scope signal (§14 Stage 1 step 3).

The **`0.16.0` entity-art additions** — these are the reason for the pin:

- **`LdtkEntityDef.tileRenderMode`** — the def's authored render mode, preserved by the parser (all seven LDtk schema values: `Cover` / `FitInside` / `Repeat` / `Stretch` / `FullSizeCropped` / `FullSizeUncropped` / `NineSlice`; a def omitting the key parses as `'FitInside'`). Before 0.16.0 the field was dropped, and §7.1's fit-vs-repeat rule had to be *derived* from rect geometry — a heuristic that renders exactly two of the seven modes correctly.
- **`drawLdtkEntityTile(context, tile, dest, tilesets, mode?)`** — the engine-owned blit for an entity's authored display tile (§7.1): `Repeat` tiles across resized instances (clipping the last partial column/row from the source rect), `Stretch` fills, `FitInside` letterboxes, `Cover` covers-and-clips; never throws, returns `false` to hand the draw back. This is what replaces the consumer's hand-rolled tile-blit loop — the brief's §12.8 keeps its blanket "no manual tile-blit loop" rule with no carve-out.

The camera/LDtk/movement floor is `0.6.0`; the golden-path helpers + spawn fix + loop `onError` need `0.7.0`; **the feel moments + transition/slide/fit helpers + the mantle wave need `0.9.0`; the re-arm detector + follow-compatible destination view need `0.11.0`; the seam-free LDtk surface cache needs `0.12.0`; the sustained-noise loop (`startNoiseLoop`/`NoiseLoopHandle`) + de-correlated noise bursts need `0.13.0`; the direction-aware wall-jump (straight-up into-wall hop + `wallJumpGraceTime` away leap) needs `0.14.1`; the room-transition session orchestrator + per-axis detector latch + preflight `multiRoom` need `0.15.0`; the authoritative entity `tileRenderMode` + `drawLdtkEntityTile` need `0.16.0`**. Do not pin below `0.16.0`.

---

**Build order:** LDtk load + tileset + camera brain graybox → Celeste movement feel → seamless `__neighbours` transitions → hazards + strawberries + save → juice + polish → audio → verification.

**The game is not done when the LDtk renders. It is done when the supplied tileset is drawn faithfully, every entity the `.ldtk` dressed wears its own authored tile (§7.1), the camera brain deadzone-follows with a cover-fit and slides cleanly between rooms (momentum + screen position continuous at the seam), the Celeste kit (dash + grab/stamina + wall-slide + wall-jump + dash-tech) all feel tight, the dash-into-wall bonk fires hit-stop and shake, a human player can traverse the supplied LDtk end-to-end, and saving the `.ldtk` mid-run lands live without losing the run (§5.7).**
