# Celerock — A Celeste-like Precision Platformer that Plays a Supplied LDtk Level on `aicraft-engine@0.9.0`

> Paste this entire document to a coding agent (Claude / Cursor / etc.). It is a complete, self-contained build brief. **Presume the user supplies an LDtk project file (`.ldtk`) and the tileset PNG(s) it references.** The agent produces a single runnable Vite + TypeScript browser game that loads those assets and plays them like *Celeste* — importing everything movement, camera, level, and presentation-related from `aicraft-engine` (the npm package) and writing **no** re-implementations of what the engine already provides. The agent does **not** author level geometry: rooms, tiles, hazards, and collectibles all come from the supplied LDtk file.

---

## 0. What You Are Building

**Celerock** — a precision-platformer runtime in the *Celeste* aesthetic. A young mountaineer traverses the rooms of a supplied LDtk level with the authentic Celeste kit: a variable-height jump, a single 8-directional dash that refills on landing, a wall-grab bound to a stamina meter (cling, climb up/down, climb-hop off), wall-slide, wall-jump, and the dash-tech follow-ups (super jump, hyper/wavedash, duck super jump). The feel target is **Celeste-tight**: dash startup freeze, hit-stop on dash-into-wall, screen shake on hard landings and bonks, spring launches, fast-fall, corner correction, instant respawn, and a strawberry counter that persists across reloads. Rooms are not authored by the game — they are walked through, and the player flows from one LDtk room to the next across the level's `__neighbours` seams with momentum preserved, exactly as Celeste's rooms connect.

**This is NOT a tech demo and NOT a hand-authored level set.** The previous version of this brief failed because it (a) hand-wrote six ASCII room grids and a bespoke "connected-terrain" renderer instead of using a real tileset, (b) drove the view through the legacy single follow-camera instead of the camera brain, (c) enabled a `doubleJump` which is not a Celeste mechanic, and (d) gated progression behind a per-room "win → Cleared card → next" loop instead of Celeste-style seamless room transitions. This brief fixes every one of those: **geometry and tile art come from the supplied LDtk + tileset**, the **camera brain** with per-room virtual cameras owns the view, the **Phase 0–9 movement kernel** owns the authentic Celeste kit, and **LDtk `__neighbours`** own room flow.

**Non-negotiable: build the entire game on top of `aicraft-engine@0.9.0`.** Do not hand-roll the controller, fixed-step loops, collision, the camera, tile rendering, particles, jump arcs, locomotion, palettes, audio, feel thresholds, or room transitions — those are all in the engine. If you find yourself writing a horizontal-velocity clamp, a wall-slide timer, a dash-frame counter, a stamina drain, an unscaled landing-impact threshold, a camera lerp, a tile-blit loop, a room-transition slide, or `Math.random()` in the simulation, STOP and use the engine instead.

---

## 1. Tech Stack & Install

```bash
npm create vite@latest celerock -- --template vanilla-ts
cd celerock
npm install aicraft-engine@0.9.0
```

> This brief targets the published `0.9.0` API exactly. `0.9.0` ships the **feel + traversal layer** (the structured feel channel `state.moments` — landing impact ratio/hard, one-shot dash bonks with normal + surface id, dashEnded context, grab/stamina pulses, spring/refill moments; the pure room-transition helpers `findLdtkRoomExit` / `mapLdtkRoomEntry` / `transitionPlatformerToRoom` / `rebasePointBetweenLdtkRooms`; the slide orchestrator `beginRoomSlide` + the camera-space rebases; the explicit camera fit `fitCameraZoom`) **and the mantle wave** (direction-aware grab+jump + ledge mantle). The `0.7.0` golden path (high-level LDtk loader, preflight, per-room compiler + cache, config scaler, input maps, solid-id helpers, spawn fix, loop `onError`) and the earlier camera-brain/LDtk/movement drops (`0.5.0`/`0.6.0`) all remain. Note the **`0.9.0` compatibility breaks**: the replay physics version is 12 (v11 replays rejected) and a manually-constructed `PlatformerState` needs `moments: []`. Do not pin below `0.9.0`.

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
    loadLdtkProjectAssets,                           // PREFERRED golden-path loader (fetch + decode + bundle)
    inspectLdtkPlatformerProject,                    // asset preflight: report spawn/caps/neighbours (G3)
    parseLdtkProject, ldtkLevelToLevelData,          // manual alternative (parse only; returns { ok, project, errors })
    drawLdtkLevel, drawLdtkLayer, buildLdtkTilesetBundle,  // render + (SYNC) tileset bundler
    LDTK_DEFAULT_ENTITY_MAP,
    type LdtkProject, type LdtkLevel, type LdtkNeighbour, type LdtkTilesetBundle,
    type LdtkParseResult, type LdtkPlatformerProjectReport,

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
    drawActor, drawLevelEntity, DEFAULT_ENTITY_PALETTE,
    jumpAbility, wallSlideAbility, dashAbility,
    type PlatformerConfig, type PlatformerState, type PlatformerInput,
    type CompiledLevel, type CompiledMovingPlatform,
    type CompiledLdtkRoom, type LdtkRoomCache,

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

---

## 2. Determinism & Discipline Rules (enforced by the engine — follow them)

- **Fixed-step sim, variable render** via `createGameLoop({ fixedDt: 1/60, step, render })`. Poll input **exactly once per `step`**. Pass an `onError: (error, { phase }) => { ... }` handler (and optionally `errorPolicy`) so a throw inside your `step`/`render` can never silently freeze the loop on its last frame — that exact bug froze a prior build at tick 5314 with the last frame stuck on screen and no way for the host to detect it. The default policy is `'stop'` (which at least makes the failure observable via `loop.stoppedDueToError`); prefer wiring `onError` to your own error surface.
- **No `Math.random()` and no `Date.now()` ANYWHERE in game code** — not in the simulation AND not in decorative audio/visual/particle code. Use seeded `mulberry32(seed)` → `nextInt` / `nextFloat` / `pick` for both authoritative AND decorative randomness; pass an explicit `rng` to anything that needs jitter. (A textual `Math.random` anywhere trips the §12.8 static-analysis grep — keep the rule simple and absolute.) Time comes from `tick` or the loop's `dt`.
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
| **Asset preflight (G3)** | `inspectLdtkPlatformerProject(project)` — pure; reports levelCount, per-room spawn/tileSize/entityCounts/neighbours/connected, aggregated `capabilities` (hazards/collectibles/springs/dashRefills/exits/ladders/movingPlatforms), spawn-less/disconnected rooms, unknown trigger ids. **Missing optional content is informational, NOT a failure.** |
| **Load the supplied LDtk project** | **PREFERRED** `loadLdtkProjectAssets({ projectUrl, assetBaseUrl?, imageTimeoutMs?, fetch?, decodeImage? })` → `{ ok, project, tilesets, diagnostics }` (handles URL-encoding of spaces/brackets, bounded decode, skip-LdtkIcons, defensive host access). **Manual alternative:** `parseLdtkProject(text)` → `{ ok, project?, errors }` (destructure + check `ok && project`) then SYNC `buildLdtkTilesetBundle(tilesets, loadImage)` whose `loadImage` returns `CanvasImageSource \| undefined` (NOT a Promise). |
| **Translate an LDtk level → engine geometry** | `ldtkLevelToLevelData` (IntGrid → solidity by value *name*; entities → engine entities via `LDTK_DEFAULT_ENTITY_MAP`) |
| **Compile a room for play (PREFERRED)** | `compileLdtkRoom(ldtkLevel, project, options?)` → `CompiledLdtkRoom` with bucketed `solids`/`hazards`/`collectibles`/`springs`/`dashRefills`/`exits`/`enemies`/`ladders` + resolved `spawn`. Wrap a whole project in `createLdtkRoomCache(project, options?)` for lazy per-`iid` compile + `getStartRoom()`. (Low-level: `compileGeneratedLevel({ level, tileSemantics }, { config, playerWidth, playerHeight })` — note `CompiledLevel` has **no `.entities` field**; read entities from the translated `level.entities` or from the room buckets.) |
| **Render the supplied tileset** | `drawLdtkLevel` / `drawLdtkLayer` + `buildLdtkTilesetBundle` |
| **Tile-unit config scaling** | **PREFERRED** `scalePlatformerConfig(config, scale)` / `createPrecisionPlatformerConfig({ tileSize, referenceTileSize?, jumpApexTiles?, timeToApex?, coyoteTime?, wallGrabEnabled?, climbEnabled? })` — unit-aware (distances/velocities/accelerations scale; times/ratios/counts/booleans don't) and re-pegs jump-relative impulses. `PlatformerConfig` is FLAT (`dashEnabled`/`dashSpeed`/`wallSlideEnabled`/`wallJumpVx`/… top-level; only `jump:` and optional `squash:` are nested). |
| **Solid-id helpers** | `solidIdForEntity(id)` / `entityIdFromSolidId(solidId)` — entity solids are `entity-<id>` (NOT `solid-`); tile-derived solids are a separate `tile-…` namespace (not reversible). |
| **Spawn resolution** | `compileGeneratedLevel`/`compileLdtkRoom` resolve the LDtk FEET-CENTER spawn to the AABB top-left via `spawnResolution:'rest-on-surface'` (the LDtk default) — the player rests on the surface, **no floor embed, no hand-rolled settle**. `settlePlatformerState(state, solids, config?, maxSteps?)` is a recovery tool for legacy/embedded spawns only. |
| **Player controller (jump + wall-slide + wall-jump + dash + wall-grab/stamina/climb-jump/mantle + dash-tech)** | `PRECISION_PLATFORMER` + `stepPlatformer(state, input, solids, dt, config?, getSolidDisplacement?)` → `{ state }` — boolean event pulses (`justLanded`/`justLaunched`/`hitCeiling`/`hitWall`/`startedWallSlide`/`wallJumpLaunched`/`dashStarting`/`dashStarted`/`doubleJumped`/`climbJumpLaunched`/`mantled`) are on **`state.events`**; spring/dashRefill `interactions` (each carrying an `entityId` solid id) are on **`state.interactions`**; structured FEEL moments (landing impact ratio/hard flag, dash bonks with normal + surface id, dashEnded context, grabLatch/staminaExhausted, springLaunch/dashRefill) are on **`state.moments`**. **Do NOT hand-roll velocity, stamina, collision, or feel thresholds.** |
| Moving-platform rooms | `advanceMovingPlatform`, `movingPlatformToSolid`, `createMovingPlatformDisplacementProvider(current, previous)` — pass the provider as the **6th positional arg** to `stepPlatformer` so platforms carry the player. |
| **Camera brain (per-room vcams, deadzone follow, blends)** | `createCameraBrain`, `updateCameraBrain`, `VirtualCamera` — **do NOT use the legacy `createCamera`/`updateCamera`** |
| **Room-to-room transitions** | LDtk `__neighbours` — engine-owned `findLdtkRoomExit` → `mapLdtkRoomEntry` → `transitionPlatformerToRoom` + the `beginRoomSlide` slide orchestrator (see §5.5); momentum preserved, `'seam-entry'` provenance |
| Hazard AABB (spikes) | `aabbOverlap` against the player's rect (read from the kernel state) |
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
| Death counter, room title cards | `drawText`, `drawTextOutlined` |
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
  return createPrecisionPlatformerConfig({
    tileSize,
    referenceTileSize: 16,        // PRECISION_PLATFORMER is a 16px config
    jumpApexTiles: 81 / 16,       // ~5-tile jump apex (mirrors the engine's LDtk play mode)
    timeToApex: 0.3,
    wallGrabEnabled: true,        // grab key (Z) clings to walls, drains stamina, climb-jumps/mantles off
    climbEnabled: true,           // ladder IntGrid cells named 'ladder' drive vertical climb
  });
}

// The Celeste kit opt-ins live as TOP-LEVEL fields on the returned flat config
// (dashEnabled / dashSpeed / wallSlideEnabled / wallJumpVx / climbSpeed /
// stepHeight / groundDuckEnabled …). Only `jump:` (and optional `squash:`) is
// nested. To tweak one, spread the result: `{ ...playConfigFor(ts), groundDuckEnabled: false }`.
// `groundDuckEnabled: false` keeps Down responsive for ladders/fast-fall/dash-aim
// while preserving ability-owned duck tech (hyper slide + duck super jump).
// Dash (8-directional, startup freeze, refills on land) + dash-tech
// (super/hyper/wavedash/duck) are inherited as enabled from PRECISION_PLATFORMER.
```

`PRECISION_PLATFORMER` already carries the full kit with tuned defaults: decaying wall-slide (`wallSlideStartMax` easing up to `maxFallSpeed`), wall-jump launch (`wallJumpVx/Vy` + `wallJumpLockTime`), 8-directional dash (`dashSpeed`/`dashDuration`/`dashStartupTime`/`maxDashes`/`endDashSpeedFactor`), dash-tech (`superJumpVx`, `dodgeSlideSpeedMult`, `duckSuperJump*`), springs (`springBounceVy`/`springSuperBounceVy`), corner correction, fast-fall, and wall-speed retention. **Do not duplicate any of these by hand.**

**Wall-grab extras (engine-owned, physics v12):** with `wallGrabEnabled: true` you also get, for free —

- **Direction-aware grab+jump.** Jump while grabbing branches on the latched wall side and the SIGN of `moveX` (magnitude ignored, so analog sticks work): holding **Away** keeps the classic up-and-away climb-hop (`climbHopForceTime` push, reported through the `wallJumpLaunched` pulse — this pulse now ALSO fires for away climb-hops, a deliberate widening); **Neutral or Toward** launches a straight-up **climb-jump** (`vx = 0`, faces the wall, `climbJumpRegrabLockTime` re-grab lock so the actor actually rises — no 4 px re-cling jitter) reported through `climbJumpLaunched`. Dash beats the jump; the jump beats the mantle.
- **Ledge mantle.** Hold grab + **Up** near the top of a clear wall and the actor performs a continuous assisted hop onto the ledge — it rises beside the wall over several ticks, crosses the lip once its feet clear, and lands through the normal collision resolver (there is NEVER a position snap; tuning lives in `mantleEnabled`/`mantleHopVx`/`mantleHopVy`/`mantleApexClearance`/`mantleLandingInset`/`mantleAssistTime`). Set `mantleEnabled: false` to opt out. A conservative preflight declines the mantle under ceilings/overhangs or onto occupied footholds; passthrough/ladder/spring/dash-refill volumes never block it.

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
  frameIndex = currentFrameIndex(walkClock, walkAnim!) ?? 0;       // loops naturally
} else if (kind === 'idle') {
  frameIndex = 0;                                                   // hold cell 0
} else {
  // 'ascent' | 'apex' | 'descent' → jump clip (one-shot, clamps at cell 64)
  jumpClock = advanceSpriteAnim(jumpClock, dt * 1000);
  frameIndex = currentFrameIndex(jumpClock, jumpAnim!) ?? 60;
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
- **Contact shadow:** derive it from the **sprite bounds** (or omit it) — do NOT size it off the procedural body.

**Fallback.** If `compiled` (or `spriteImage`) is `null` after boot, draw the procedural body instead: face + `advanceSpringRod` hair + `drawSimpleFeet` + the `advanceLocomotionByDisplacement` walk cycle + `advanceSquash` squash (pivot at the feet), wrapped in `ctx.scale(facing, 1)`. The procedural path is the **only** place breathe/squash scaling is applied.

> **Simpler alternative (still policy-compliant).** For ONE character with TWO fixed cell ranges, a direct `ctx.drawImage(playerImage, sx, sy, 16, 16, destX, destY, 16, 16)` keyed off `kind` is an acceptable simpler alternative to the full engine pipeline — but the engine pipeline (`compileSpriteSheet` grid + `deriveSpriteAnimKind` + `drawSprite`) is **preferred** (it owns the facing mirror, the frame-player, and the grid math for you). Either way the **stable-1:1 + facing-mirror + feet-anchor + no-squash** policy above holds.

---

## 5. World — The Supplied LDtk Level

Celerock does **not** author rooms. It loads the supplied `.ldtk`, translates each level into engine geometry, renders the supplied tileset through `drawLdtkLevel`, and flows the player between rooms across LDtk `__neighbours` seams.

### 5.1 Boot: load + asset preflight (G3)

**PREFERRED — one call** (`loadLdtkProjectAssets`) fetches the project, parses it, decodes every tileset PNG (bounded), and builds the bundle. It handles the URL-encoding of spaces/brackets in tileset `relPath`s (the raw-concat URL with spaces/`[`/`]` is what hung boot in real builds), skips the `LdtkIcons` atlas, and degrades a missing OPTIONAL tileset to a warning rather than crashing. **Never throws** — failures become diagnostics:

```ts
// 1. Load the supplied LDtk project + all its tileset PNGs in one bounded call.
const result = await loadLdtkProjectAssets({ projectUrl: './levels/level.ldtk' });
if (!result.ok) { console.error('LDtk load failed', result.diagnostics); return; }
const { project, tilesets, diagnostics } = result;   // log warnings from `diagnostics` as you like
```

**2. Asset preflight (G3 — run before any gameplay work).** Inspect the parsed project and report what was actually authored, so the build does not assume mechanics the LDtk lacks:

```ts
const report: LdtkPlatformerProjectReport = inspectLdtkPlatformerProject(project);
console.log(`levels=${report.levelCount} spawns=${report.totalSpawns}`, report.capabilities);
// report.capabilities = { hazards, collectibles, springs, dashRefills, exits, ladders, movingPlatforms }
// report.spawnLessRoomIids / report.disconnectedRoomIids / report.unknownTriggerIdentifiers are WARNINGS.
```

**Missing optional content is INFORMATIONAL, not a failure.** A project with no springs, no dash-refills, or no moving platforms is perfectly playable — the build simply must not *require* those mechanics (see the capability-aware acceptance in §9 / §12.7). Treat only a total lack of spawns (no `Player`/`Spawn` anywhere) as a hard block.

---

**Manual alternative (only if you cannot use the high-level loader).** `parseLdtkProject` returns a RESULT `{ ok, project?, errors }`, **not** a bare `LdtkProject` — destructure and check `ok && project`. `buildLdtkTilesetBundle` is **SYNCHRONOUS** and its `loadImage` returns `CanvasImageSource | undefined` (NOT a Promise):

```ts
const text = await (await fetch('./levels/level.ldtk')).text();
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

Set the canvas once (`image-rendering: pixelated`, DPR-aware backing store). Each frame, the **camera brain** owns the view: one follow `VirtualCamera` per room, Celeste-style deadzone bands, fitted zoom. Render the tileset through `drawLdtkLevel` with `imageSmoothingEnabled = false`:

```ts
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
drawLdtkLevel(ctx, active.ldtkLevel, {
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

### 5.5 Room transitions — seamless, momentum-preserving

Celerock renders one room at a time in **room-local coordinates**, so a room change must NOT blend a position captured in one room's local space into another's. The engine owns the whole path now — the simulation transition (pure helpers) and the presentation transition (the slide orchestrator). **Do not hand-roll `transitionFor`/`entryPoint` or a slide:**

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

**Presentation (G5 — the default is a SLIDE, not a hard cut): `beginRoomSlide` / `advanceRoomSlide` / `presentationForRoomSlide` + the camera-space rebases.** The orchestrator composes the existing camera brain (no new solver): it drives a transient high-priority `fixed` vcam in a normalized two-room space with `blend: 0` and exact-snap body/lens, so the named exported curve (`roomSlideEase`, ~0.30 s) is the SOLE path authority — no stacked brain blend or damping. **BOTH rooms render** during the slide (draw each with `worldOffset: presentation.sourceOffset` / `destinationOffset`); the player's SCREEN position is continuous at the seam (`presentation.playerOffset` eases the render correction to zero); particles rebase ONCE at slide start (`slide.particleRebaseDelta`); input/sim continue unless `freezeSimulation`. **Reduced-motion** is explicit — pass `reducedMotion: prefersReducedMotion()`; `true` yields `active: false, t: 1` and you run the enter + finish camera-space rebases in the SAME presentation frame for an immediate seam-aligned cut. Handoff is explicit, not auto-blended: `enterRoomSlideCameraSpace` (once, at slide start) rebases the brain into slide space and clears selection/blend; `finishRoomSlideCameraSpace` (once, at slide end) rebases into destination-local — the next destination vcam activation is a first activation seeded from the exact final rendered view. Death/retry/teleport mid-slide: `cancelRoomSlideCameraSpace(slide, brain, returnTo)` rebases to the room the simulation resumes in; rapid reversal cancels to the current room FIRST, then begins the reverse slide from that local state.

On transition: resolve the exit, map the entry, transition the state, then begin the slide:

```ts
const exit = findLdtkRoomExit(state.core, active.ldtkLevel, project);
if (exit) {
  const target = rooms.get(exit.neighbourLevelIid);      // cached CompiledLdtkRoom (createLdtkRoomCache)
  const entry = mapLdtkRoomEntry(state.core, active.ldtkLevel, target.ldtkLevel, exit);
  ({ state } = transitionPlatformerToRoom(state, entry, { destinationSolids: target.solids, config }));
  // Particle continuity: add slide.particleRebaseDelta ONCE to source-local particles.
  slide = beginRoomSlide(
    active, target, viewport,
    { source: { camera: brain.camera, zoom: brain.zoom },          // current rendered view
      destination: { camera: { x: 0, y: 0 }, zoom: fitCameraZoom(target, viewport) } },
    { sourceLocal: { x: prevCore.x, y: prevCore.y }, destinationLocal: { x: entry.x, y: entry.y } },
    { reducedMotion: prefersReducedMotion() },
  );
  brain = enterRoomSlideCameraSpace(slide, brain);      // rebase into slide space (clears selection/blend)
  active = target;
}
// each presentation tick while slide.active:
slide = advanceRoomSlide(slide, dt);
const p = presentationForRoomSlide(slide);
if (p.vcam) {
  brain = updateCameraBrain(brain, { vcams: [p.vcam], targets: { player: state.core }, bounds: p.bounds,
                                    viewport, activeId: ROOM_SLIDE_VCAM_ID, dt });
  // draw BOTH rooms: drawLdtkLevel(ctx, src.ldtkLevel,  { ..., worldOffset: p.sourceOffset });
  //                  drawLdtkLevel(ctx, dest.ldtkLevel, { ..., worldOffset: p.destinationOffset });
  // draw the player at (destinationLocal + p.playerOffset) in slide space
} else {
  brain = finishRoomSlideCameraSpace(slide, brain);     // rebase into destination-local; the room vcam takes over
}
```

Falling out of the level with no cardinal neighbour (the void) is a respawn, not a transition — and a crossing that leaves through a NON-shared span (a partial seam's void edge) is also void: `findLdtkRoomExit` returns `undefined` and you respawn.

> The public golden-path APIs replace the old "read the showcase" reference: `loadLdtkProjectAssets` (§5.1), `inspectLdtkPlatformerProject` (preflight), `compileLdtkRoom` / `createLdtkRoomCache` (§5.2), `findLdtkRoomExit` → `transitionPlatformerToRoom` → `beginRoomSlide` (§5.5), and the cover-fit `fitCameraZoom` + per-room vcam above. (No `showcase/` or `src/…` path is published in the npm package — the `files` whitelist ships only `dist/` — so do not reference any as a consumer resource.)

### 5.6 What the supplied LDtk must contain (light contract)

Because Celerock trusts the LDtk, the file is the design. At minimum it should provide:

- **≥1 level** (more rooms = a longer climb). Multi-level projects are navigated via `__neighbours`.
- An **IntGrid collision layer** with named values for `'solid'` (and optionally `'passthrough'`, `'ladder'`).
- **Tile / AutoLayer layers** referencing the supplied tileset for the visual.
- **Entity layers**: at least one `Player`/`Spawn`; `Coin`/`Gem`/`Diamond` strawberries; `Spike`/`Hazard` hazards; optionally `MovingPlatform`, `Spring`, `DashRefill`, `Enemy`.
- **`__neighbours`** links between levels you intend to flow between.
- **Supplied `Player.png`** — the 160×128 (10×8 grid of 16×16) player sprite sheet the runtime loads at boot (§4.4). Optional in the sense that a missing/failed load degrades gracefully to the procedural body, but the canonical build supplies it.

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
- [ ] **Spring** boing + `springBounceVy`; **dash-refill** sparkle when `maxDashes` refills on a refill entity — **only when the LDtk actually provides springs / dash-refills** (check `report.capabilities.springs` / `.dashRefills` from the preflight; absent content is not a failure).
- [ ] Coyote time + jump buffer from the shipped `jumpAbility`; do not duplicate them.
- [ ] **Player sprite (supplied `Player.png`)** — stable **1:1** (no breathe/squash scaling on the sprite), facing mirror flips walk/jump with travel (no moonwalk), walk cycles cells 0–7, jump plays 60→64 then clamps on the fall frame, idle = cell 0; no shimmer while idle; dash aura glow + after-image trail are kept (they carry dash juice without distorting the sprite).
- [ ] **Spring-rod hair (`advanceSpringRod`)** — **OPTIONAL when using the supplied sprite**: the sprite art owns the silhouette, so hair is a cosmetic extra, **never an acceptance requirement** (per G5). Only add it for the wag-when-moving / lift-during-dash flourish; draw it OUTSIDE the sprite's facing mirror.
- [ ] Reduced-motion gate (`prefersReducedMotion`) renders room 1 and starts no loop.
- [ ] Room title cards fade in over 0.6 s (`createTweenState` + `easeOutCubic`); transition/"Cleared" cards use `easeOutBack`.

---

## 10. Audio (all synthesized via `createAudioAdapter`)

Unlock on first user gesture (one-shot `keydown`/`pointerdown` calling `audio.unlock()`). Then:

- **Walk tap:** `playNoise(40, 'lowpass', 200, 0.12)` per `advanceFootPlant` event.
- **Jump:** `playTone('sine', 200, 400, 80, 0.2)`.
- **Wall-jump:** `playTone('triangle', 300, 500, 60, 0.18)`. **Away grab+jump** (climb-hop) reports through the SAME `wallJumpLaunched` pulse (deliberate widening in physics v12) — one mapping covers both.
- **Straight-up climb-jump** (on `state.events.climbJumpLaunched`): `playTone('sine', 260, 520, 70, 0.16)` — a lighter, upward version of the wall-jump.
- **Mantle** (on `state.events.mantled`): a soft two-part "scramble up" — `playNoise(60, 'lowpass', 350, 0.2)` then `playTone('triangle', 220, 300, 50, 0.1)`; the landing afterwards fires the normal `landing` moment cues.
- **Wall-grab latch** (on the `grabLatch` moment): `playTone('triangle', 180, 160, 40, 0.12)`; **stamina-out gasp** (on the `staminaExhausted` moment): `playNoise(80, 'lowpass', 300, 0.25)`.
- **Wall-slide:** while `wall?.kind === 'wallSlide' && wall.sliding`, gate `playNoise(20, 'highpass', 800, 0.05)`.
- **Dash:** `playNoise(60, 'bandpass', 1500, 0.18)`; **dash-into-wall thump** (on the `dashBonk` moment): `playTone('square', 120, 90, 70, 0.25)`.
- **Spring** (on the `springLaunch` moment): `playTone('sine', 300, 700, 90, 0.2)`; **dash-refill** (on the `dashRefill` moment): `playTone('triangle', 700, 1300, 50, 0.12)`.
- **Land (hard)** (`landing.hard`): `playNoise(80, 'lowpass', 300, 0.3)`; (soft): `playNoise(50, 'lowpass', 250, 0.18)`.
- **Strawberry:** two-note arpeggio — `playTone('triangle', 600, 1200, 60, 0.15)` twice ascending.
- **Death:** `playNoise(120, 'lowpass', 400, 0.3)` + descending `playTone('sine', 400, 80, 200, 0.25)`.
- **Respawn:** rising `playTone('sine', 200, 600, 100, 0.18)`.

---

## 11. File Layout (Suggested)

```
src/
  main.ts              # boot: load LDtk + tilesets, canvas, store, audio.unlock, loop.start()
  ldtk.ts              # loadLdtkProjectAssets (or parseLdtkProject+buildLdtkTilesetBundle), inspectLdtkPlatformerProject, createLdtkRoomCache
  camera.ts            # per-room VirtualCamera config, cover-fit fitCameraZoom, createCameraBrain/updateCameraBrain, room slide
  transition.ts        # findLdtkRoomExit → mapLdtkRoomEntry → transitionPlatformerToRoom + beginRoomSlide wiring
  game/
    state.ts           # CelerockSave (collectibles: Record<levelIid, CollectibleSave>, deaths), World/Room runtime
    step.ts            # fixed-step: input → stepPlatformer → pickups → audio → brain
    render.ts          # drawLdtkLevel (the tileset) + player art + entities + particles + UI
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

- `loadLdtkProjectAssets({ projectUrl })` resolves `{ ok: true, project, tilesets }`; `project.levels.length >= 1` (or, on the manual path, `const { ok, project, errors } = parseLdtkProject(text)` has `ok && project`).
- The preflight reports at least one spawn: `inspectLdtkPlatformerProject(project).totalSpawns >= 1`. A total lack of spawns is the only hard block; missing springs/dash-refills/etc. are informational (`report.capabilities.*`).
- The start room compiles via `createLdtkRoomCache(project, {...}).getStartRoom()` → `{ ok: true, room }` with `room.spawn.source === 'authored'`. (Low-level: `ldtkLevelToLevelData(startLevel, project).level` is defined and passes through `compileGeneratedLevel` with the player config.)
- At least one level has a collectible or hazard (otherwise the runtime has nothing to do — acceptable, but log it from `report.capabilities`).

### 12.2 Dash-into-Wall Hit-Stop Timing

- Script: place the player 2 tiles left of a solid wall, trigger a rightward dash.
- Assert: on the contact tick, `state.moments` carries exactly one `{ kind: 'dashBonk', normalX: -1, solidId }` (horizontal dash into a right wall — the surface normal points back against the dash) AND `isHitStopActive(hitStop)` is true for ≥4 ticks AND `shakeEnvelope` is non-zero. The dash itself does NOT end on contact in this engine version (it ends on timeout; `dashEnded.reason === 'timeout'` with the ending-tick `terminalContact`) — the bonk cue keys off the `dashBonk` moment, never off the dash phase going idle.
- Assert: a dash PINNED against the wall for multiple ticks emits exactly ONE `dashBonk` per blocked axis per dash (a second dash re-arms it).
- Assert: the player's `state.core.x` never exceeds the wall's left edge by more than the kernel's penetration tolerance (the dash never phases through).

### 12.3 Room-Transition Smoke Test

- Drive scripted input from the start room's spawn across a `__neighbours` edge into a linked room (the engine path: `findLdtkRoomExit` → `transitionPlatformerToRoom` → `beginRoomSlide`).
- Assert: `findLdtkRoomExit` returns `undefined` for a body still inside the room AND for a crossing outside the shared seam span (the void); inside the span it returns the cardinal exit.
- Assert: after the transition, `active.ldtkLevel.iid` is the neighbour's; the player's `vx`/`vy`/`facing` are preserved across the seam; the transition's `spawn.source === 'seam-entry'`; the brain's active vcam is the new room's (no exception, no NaN position).
- Assert: the player's SCREEN position is continuous at the seam (`presentationForRoomSlide(slide).playerOffset` is the full correction at `t=0` and eases to zero; the slide renders both rooms; no teleport pop), and the slide respects `prefersReducedMotion()` (immediate seam-aligned cut when reduced-motion is on).

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
2. **Loads the supplied LDtk + tileset** and renders the tileset through `drawLdtkLevel` (pixel-crisp, untinted).
3. The Celeste kit is present and works on the supplied geometry: **dash (8-dir, startup freeze, refills on land) + wall-grab/stamina + wall-slide + wall-jump + dash-tech.** **No `doubleJump`.** Springs, dash-refills, moving platforms, and ladders are **capability-aware** — exercise each one the preflight reports present (`report.capabilities.springs` / `.dashRefills` / `.movingPlatforms` / `.ladders`); absent ones are not a failure (G4).
4. The **camera brain** drives the view (deadzone follow + per-room vcam + **cover-fit** `fitCameraZoom` + slide on transition). No legacy `createCamera`/`updateCamera`.
5. Room-to-room travel is **seamless via `__neighbours`** using the engine path (`findLdtkRoomExit` → `transitionPlatformerToRoom` → `beginRoomSlide`): a ~0.25–0.35 s **slide** (both rooms render, continuous screen position at the seam), momentum (`vx`/`vy`/`facing`) preserved, particles rebased into the destination room; reduced-motion uses an immediate seam-aligned cut. The camera does not pop between rooms.
6. The **dash-into-wall** moment (horizontal AND vertical — read the `dashBonk` feel moment on `state.moments`, never a hand-rolled velocity threshold) applies hit-stop and shake (§12.2).
7. Strawberries persist across page reload via `createLocalStorageSaveStorage` + `writeSave` (keyed by `level.iid`).
8. Death counter increments every respawn and persists through the same save adapter.
9. `prefersReducedMotion` renders the start room statically and never calls `loop.start()`.
10. **Zero duplicate engine systems**: no direct animation-frame loop, no random authoritative simulation, no manual collision resolver, no manual tile-blit loop, no legacy camera.
11. **No moonwalk.** Running left faces left — with the supplied sprite via `drawSprite(..., { facing })` (its internal `ctx.scale(facing,1)` mirror about the frame's horizontal center); with the procedural fallback via `ctx.scale(facing, 1)` around the body draw.
12. **No appendage blow-out.** Hair uses `advanceSpringRod`, never raw `advanceSpringChain`.
13. **Supplied `Player.png` sprite renders pixel-crisp** — no shimmer while idle (`imageSmoothingEnabled = false`, stable 1:1, no per-frame squash/breathe scaling on the sprite). Walk cycles cells 0–7 and flips with `facing`; jump plays cells 60→64 once then **clamps on the fall frame** until landing; idle = cell 0. If `Player.png` fails to load/compile at boot, the procedural body renders instead and the game is still playable.

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
2. **Screenshot of a room-to-room transition** — verify a smooth slide (both rooms visible mid-slide), continuous player screen position at the seam, and that momentum carries across.
3. **Stamina/grab in action** — a shot of the player wall-grabbing (stamina draining) and climb-hopping off.
4. **Manual playthrough** across every room the LDtk contains; verify dash, wall-slide, wall-jump, and (when the LDtk provides them) springs/dash-refills/moving platforms all feel Celeste-tight.
5. **Dash-into-wall** fires hit-stop + shake on ≥90% of attempts (it is a deterministic mechanic, not a precision one).
6. **Fast checkpoint retry:** <2 seconds from death to controllable respawn.
7. **Player sprite** — the supplied `Player.png` renders pixel-crisp (no edge shimmer while idle), walk flips with `facing` (no moonwalk), jump plays 60→64 once then holds the fall frame, idle = cell 0. (Or, if `Player.png` is absent, confirm the procedural fallback renders and the game is still playable.)

### Rejection Criteria

- **Tileset recolored or overpainted.** Tiles drawn with custom `fillRect`/tints instead of `drawLdtkLevel`.
- **Legacy camera.** The view driven by `createCamera`/`updateCamera` instead of the brain.
- **Double-jump present.** `doubleJumpEnabled` on, or a second air-jump observable in play.
- **Camera pops between rooms.** No slide policy (G5) — the view snaps jarringly on every `__neighbours` crossing instead of sliding with both rooms visible.
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
- **A jarring camera pop between rooms is a failure.** Room transitions must use the engine slide path (G5): `beginRoomSlide`/`advanceRoomSlide`/`presentationForRoomSlide` with both rooms rendered and the player's screen position continuous at the seam (immediate seam-aligned cut only under reduced-motion); the lens eases from the old zoom to the new `fitCameraZoom`.
- **Losing momentum at a `__neighbours` seam is a failure.** The player must carry `vx`/`vy`/`facing` across the seam — Celeste's rooms are continuous, not teleporting.
- **Hand-authoring fallback ASCII rooms is a failure.** Geometry comes from LDtk. A committed `rooms/*.ts` of ASCII grids defeats the entire point of this revision.
- **Hand-rolling a wall-grab stamina timer or a dash-frame counter is a failure.** Those are the kernel's `wallGrabAbility` and `dashAbility`. If you find yourself writing them, STOP.
- **A silent dash-into-wall is a failure.** The bonk is the signature Celeste feel beat. Missing `triggerHitStop` + `sineShake` on contact = the runtime does not teach dash feel.

---

## 15. Implementation Workflow

Build in this order. Each stage must pass its gate before the next begins.

### Stage 1: LDtk Load + Preflight + Tileset + Camera Brain Graybox
1. Vite + TypeScript + `aicraft-engine@0.9.0`. Wire `createGameLoop` with an `onError` handler (§2) so a throw can't silently freeze the loop.
2. `loadLdtkProjectAssets({ projectUrl })` the supplied `.ldtk` + PNG(s) in one call.
3. **Asset preflight (G3):** `inspectLdtkPlatformerProject(project)` — log level/spawn/capability counts. Missing springs/dash-refills/etc. are informational; a total lack of spawns is the only hard block.
4. `createLdtkRoomCache(project, {...}).getStartRoom()` the start room; `drawLdtkLevel` it.
5. Wire `createCameraBrain` + a per-room follow `VirtualCamera` (deadzone bands, **cover-fit** `fitCameraZoom`).
6. Drive the kernel with `PRECISION_PLATFORMER` (no Celeste opt-ins yet) so a box walks and jumps across the tileset. **This box is a temporary graybox only** — it is replaced by the `Player.png` sprite at the very start of Stage 2 (there is intentionally no "procedural player then swap to sprite" phase).
7. **Gate:** the supplied tileset renders pixel-crisp and untinted; the camera brain deadzone-follows with no side gaps; the player does not moonwalk.

### Stage 2: Celeste Movement Feel + Sprite Player
1. Apply the full `playConfigFor` kit: `wallGrabEnabled`, `climbEnabled` (if ladders), `groundDuckEnabled: false`, `stepHeight`, and the Celeste-default key bindings (§4.3: Arrows + `C` jump / `X` dash / `Z` grab / `R` respawn — do NOT use the engine's `STANDARD_KEYBOARD_PLATFORMER_MAP`).
2. **Render the sprite player from the first play tick.** Load + compile `Player.png` at boot and draw it via the §4.4 sprite pipeline (stable 1:1, feet-anchored, facing mirror inside `drawSprite`, NO squash on the sprite). The graybox box from Stage 1 is removed here. The procedural body is wired ONLY as the boot-time load-failure fallback (`compiled === null`).
3. Verify dash (startup freeze, 8-dir, refill on land), wall-slide (decaying), wall-jump, wall-grab (stamina, climb, direction-aware climb-jump, ledge mantle), springs, dash-tech.
4. **Gate:** all five core abilities demonstrably work in the supplied rooms AND the player renders as the `Player.png` sprite (not a box, not the procedural body). Stamina drains and refills. Dash refills on land.

### Stage 3: Seamless Room Transitions
1. Wire the engine transition path: `findLdtkRoomExit(state.core, level, project)` → `mapLdtkRoomEntry` → `transitionPlatformerToRoom` (pass `destinationSolids` from the cached `CompiledLdtkRoom`); pull neighbour rooms from `createLdtkRoomCache` (lazy compile + cache by `iid`).
2. Preserve `vx`/`vy`/`facing` across the seam; revalidate support via `destinationSolids`; carry particles with `rebasePointBetweenLdtkRooms` / `slide.particleRebaseDelta`.
3. Play the **room slide** (G5) with `beginRoomSlide`/`advanceRoomSlide`/`presentationForRoomSlide` + the `enterRoomSlideCameraSpace`/`finishRoomSlideCameraSpace` brain rebases — both rooms render, continuous screen position, ease the lens to the new `fitCameraZoom`; immediate seam-aligned cut only under reduced-motion.
4. **Gate:** walking/falling/jumping off a room edge flows into the next room with momentum and a smooth slide; the camera does not pop.

### Stage 4: Hazards + Strawberries + Save
1. Hazard AABB checks (static + moving-platform-child); death → hit-stop → respawn at last checkpoint.
2. `derivePickups` → `collect` → `writeSave` per room, keyed by `level.iid`.
3. Death counter increment + persistence.
4. **Gate:** hazards kill and respawn correctly; strawberries persist across reload; death counter persists.

### Stage 5: Juice + Polish
1. Dash-into-wall hit-stop + shake; hard-landing shake; landing dust; dash trail.
2. Squash & stretch (`advanceSquash`) — **procedural-fallback body only**; the supplied `Player.png` sprite stays stable 1:1 (squash distorts pixel art — §4.4). Spring-rod hair (optional under the sprite); parallax background.
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

## 16. Stretch Goals (only after criteria 1–13)

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
npm install aicraft-engine@0.9.0
```

`0.9.0` is the pin for this brief — the feel + traversal + mantle release. It builds on the `0.7.0` golden path and three earlier system drops:

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

The **`0.9.0` feel + traversal + mantle additions** this brief now prefers — these are the reason for the pin:

- **`state.moments`** — the structured feel channel (single-tick, presentation-only): `landing { impactSpeed, normalizedImpact, hard, solidId }` (the hard test is a RATIO, identical at 8/16/32 px), one-shot `dashBonk { normalX, normalY, solidId }` per blocked axis per dash (horizontal AND vertical), observation-only `dashEnded { reason, terminalContact }`, `grabLatch`/`staminaExhausted` pulses, `springLaunch { super, solidId }`/`dashRefill`. Replaces reverse-engineering feel from boolean pulses + velocity peeks (the unscaled `prevVy > 520` failure).
- **`findLdtkRoomExit` / `mapLdtkRoomEntry` / `transitionPlatformerToRoom` / `rebasePointBetweenLdtkRooms`** — the pure room-transition helpers over LDtk `__neighbours` (seam-span gated, momentum-preserving, `'seam-entry'` provenance, never settles).
- **`beginRoomSlide` / `advanceRoomSlide` / `presentationForRoomSlide` + `enterRoomSlideCameraSpace` / `finishRoomSlideCameraSpace` / `cancelRoomSlideCameraSpace`** — the engine-owned slide orchestrator composing the camera brain (§5.5).
- **`fitCameraZoom`** — the explicit cover/contain/native fit policy (§5.4).
- **Mantle wave (direction-aware grab+jump + ledge mantle)** — the §4.1/Stage 2 mechanics: neutral/toward grab+jumps launch straight up (`climbJump`), away keeps the climb-hop, and grab+Up near a clear lip mantles. New launch sources `'climbJump'`/`'mantle'`; new event pulses `climbJumpLaunched`/`mantled`; `wallJumpLaunched` deliberately widened to also fire for away climb-hops.
- **Compatibility note (physics v11 → v12):** the feel channel + mantle change wall-grab trajectories ON PURPOSE (neutral/toward grab+jumps now rise straight up; grab+Up near a clear lip mantles), and the `moments` state field is replay data. `PlatformerEvents` gained `climbJumpLaunched` + `mantled`, and `wallJumpLaunched` was DELIBERATELY WIDENED to also fire for away climb-hops — consumers reading that pulse will start seeing climb-hops. v11 replays are rejected under v12. A consumer that manually constructs a complete `PlatformerState` must pass `moments: []`.

The camera/LDtk/movement floor is `0.6.0`; the golden-path helpers + spawn fix + loop `onError` need `0.7.0`; **the feel moments + transition/slide/fit helpers + the mantle wave need `0.9.0`**. Do not pin below `0.9.0`.

---

## 19. Summary of Key Changes from the Previous Brief

| Aspect | Previous (0.4.0) | This brief (0.9.0) |
|---|---|---|
| Level geometry | 6 hand-authored ASCII room grids | **Supplied LDtk file** (`loadLdtkProjectAssets` → `parseLdtkProject` + `ldtkLevelToLevelData`) |
| Asset preflight | (none) | **`inspectLdtkPlatformerProject`** — capability-aware (G3/G4); missing springs/dash-refills are informational |
| Tile art | Bespoke "connected-terrain" renderer (6 motifs, neighbor bitmasks) | **Supplied tileset** via `drawLdtkLevel` — drawn verbatim, no recoloring |
| Level compile | `compileLevel(levelData, { tileTypeMap })` | **`compileLdtkRoom` / `createLdtkRoomCache`** (bucketed rooms, lazy iid cache); low-level `compileGeneratedLevel({ level, tileSemantics }, …)` |
| Config scaling | hand-rolled `* tileSize/16` | **`scalePlatformerConfig` / `createPrecisionPlatformerConfig`** — unit-aware, re-pegs jump impulses |
| Camera | Legacy single follow-camera (`createCamera`/`updateCamera`) | **Camera brain** — per-room `VirtualCamera`s, deadzone follow, **cover-fit** + blends/slides |
| Room flow | `goalRect → win → "Cleared" card → next → roomIndex` FSM loop | **Seamless LDtk `__neighbours`** — momentum-preserving **slide** (G5), both rooms render |
| Movement kit | `defaultPrecisionPipeline` + **`doubleJumpEnabled: true`** | **Celeste-faithful**: `PRECISION_PLATFORMER` + `wallGrabEnabled`/stamina + 8-dir dash + dash-tech + springs — **no double-jump** |
| Room design | Fixed 6-room technique ladder with per-room specs + content-counts table | **Generic — trusts the supplied LDtk** (light contract in §5.6) |
| Collectible scoping | `collectibles['room-N']` by hand index | `collectibles[level.iid]` keyed by LDtk level id |
| Tests | Unique `fnv1a` room hashes, ASCII dimension checks, 6-room content-counts, 6 E2E scripts | LDtk load smoke, dash-into-wall timing, **room-transition smoke**, persistence, determinism |
| Forbidden patterns | `stepPlatformer`, manual gravity, ASCII shared template, full-tile outlines | + **legacy camera**, **`doubleJump*`**, **hand-built `LevelData`**, **tile-art recoloring** |
| Version | `aicraft-engine@0.4.0` | `aicraft-engine@0.9.0` (feel + traversal + mantle release) |

---

**Build order:** LDtk load + tileset + camera brain graybox → Celeste movement feel → seamless `__neighbours` transitions → hazards + strawberries + save → juice + polish → audio → verification.

**The game is not done when the LDtk renders. It is done when the supplied tileset is drawn faithfully, the camera brain deadzone-follows with a cover-fit and slides cleanly between rooms (momentum + screen position continuous at the seam), the Celeste kit (dash + grab/stamina + wall-slide + wall-jump + dash-tech) all feel tight, the dash-into-wall bonk fires hit-stop and shake, and a human player can traverse the supplied LDtk end-to-end.**
