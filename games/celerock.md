# Celerock — A Celeste-like Precision Platformer that Plays a Supplied LDtk Level on `aicraft-engine@0.22.0`

> Paste this entire document to a coding agent (Claude / Cursor / etc.). It is a complete, self-contained build brief. **The level, the tileset, and the player sprite ship with this brief — download them from the links in §1.1 (all CC0).** The agent produces a single runnable Vite + TypeScript browser game that loads those assets and plays them like *Celeste* — importing everything movement, camera, level, and presentation-related from `aicraft-engine` (the npm package) and writing **no** re-implementations of what the engine already provides. The agent does **not** author level geometry: rooms, tiles, hazards, and collectibles all come from the LDtk file. (A user may substitute their own `.ldtk` + tileset; everything below is written against the LDtk *format*, not against these specific rooms, so the build works either way. Where the bundled pack's exact contents matter, §1.1 and §5.6 say so.)

---

## 0. What You Are Building

**Celerock** — a precision-platformer runtime in the *Celeste* aesthetic. A young mountaineer traverses the rooms of a supplied LDtk level with the authentic Celeste kit: a variable-height jump, a single 8-directional dash that refills on landing, a wall-grab bound to a stamina meter (cling, climb up/down, climb-hop off), wall-slide, wall-jump, and the dash-tech follow-ups (super jump, hyper/wavedash, duck super jump). The feel target is **Celeste-tight**: dash startup freeze, hit-stop on dash-into-wall, screen shake on hard landings and bonks, spring launches, fast-fall, corner correction, instant respawn, and a strawberry counter that persists across reloads. Rooms are not authored by the game — they are walked through, and the player flows from one LDtk room to the next across the level's `__neighbours` seams with momentum preserved, exactly as Celeste's rooms connect. The level-design loop is live: **saving the `.ldtk` mid-run hot-swaps the edited world with the player's state preserved** (§5.7 — standard scope).

**This is NOT a tech demo and NOT a hand-authored level set.** The previous version of this brief failed because it (a) hand-wrote six ASCII room grids and a bespoke "connected-terrain" renderer instead of using a real tileset, (b) drove the view through the legacy single follow-camera instead of the camera brain, (c) enabled a `doubleJump` which is not a Celeste mechanic, and (d) gated progression behind a per-room "win → Cleared card → next" loop instead of Celeste-style seamless room transitions. This brief fixes every one of those: **geometry and tile art come from the supplied LDtk + tileset**, the **camera brain** with per-room virtual cameras owns the view, the **Phase 0–9 movement kernel** owns the authentic Celeste kit, and **LDtk `__neighbours`** own room flow.

**Non-negotiable: build the entire game on top of `aicraft-engine@0.22.0`.** Do not hand-roll the controller, fixed-step loops, collision, the camera, tile rendering, particles, jump arcs, locomotion, palettes, audio, feel thresholds, or room transitions — those are all in the engine. If you find yourself writing a horizontal-velocity clamp, a wall-slide timer, a dash-frame counter, a stamina drain, an unscaled landing-impact threshold, a camera lerp, a tile-blit loop, a room-transition slide, or `Math.random()` in the simulation, STOP and use the engine instead.

---

## 1. Tech Stack & Install

```bash
npm create vite@latest celerock -- --template vanilla-ts
cd celerock
npm install aicraft-engine@0.22.0
```

> This brief targets the published `0.22.0` API exactly. `0.22.0` is `0.21.1` plus the **feel-hardening release** (sourced from a fresh-build audit): the **tuned one-shot effect presets** — `DASH_TRAIL_EFFECT`, `LANDING_DUST_EFFECT`/`_HARD_`, `PICKUP_SPARKLE_EFFECT`, `GEM_AMBIENT_SPARKLE_EFFECT`, `DEATH_BURST_EFFECT`, `RESPAWN_FLASH_EFFECT`, `SWEAT_DROP_EFFECT` (§9: played-in px/tick values; a builder authors no speeds), `spawn` gaining `gravityScale`/`dragScale` so a preset spreads whole, the **dev-time plausibility guards** (`spawn`/`sampleConeVelocity` warn once on px/s-sized speeds or seconds-sized lives), **`Particle.colorEnd` + `particleColorAt`** (engine-owned color-over-lifetime — §9's fade), **`createPlatformerState`'s `facing` parameter** (§8's respawn contract), and two recipes: `feel-effects` (§9's burst kit + afterimage ring + gem-twinkle scheduler) and `game-test-harness` (§12's recording context, forbidden-identifier scan, and QA shot manifest). `0.21.1` is `0.21.0` plus **docs and recipes maintenance only** — the `recipes/image-decoder.ts` bounded decoder §4.4 references, corrected `recipes/ldtk-draw-pipeline.ts` docs, and this brief's own audit corrections; **no engine API change**. `0.21.0` is `0.20.0` plus the **units-hardened particle pillar and the shipped recipes directory**: **`advanceSeconds` / `stepSeconds` / `secondsToTicks` + `DEFAULT_PARTICLE_AIR`** — the seconds→ticks conversion owned engine-side (§9's dash trail now advances with `stepSeconds(trail, dt)` directly; there is no inline conversion to get wrong), the **`dt` → `dtTicks` signature renames** across `advance`/`step`/`advanceEmission`/`stepEmitters` (positional, non-breaking — the unit is in the parameter name now), a **`triggerHitStop` that THROWS on a positive non-integer duration** (durations are whole ticks; `6` ≈ 100 ms at 60 Hz — the same units-mismatch class that made a real build's particles live 60× too long), and the **`recipes/` directory shipping in the npm tarball itself** (this brief's §1 recipes catalog can be copied from the installed package, not just the repo). `0.20.0` is `0.19.1` plus the **TAL-sourced additions** (each one deletes a system the reference build hand-rolled): the **authored sprite-clip extensions (§4.4)** — `meta.frameTags` entries may carry `loop: false` (a one-shot clip that CLAMPS on its last frame — the jump arc, no more hand-built `CompiledAnim`), `duration` (a uniform per-clip pace — a grid sheet no longer plays every clip at the 100 ms default), and `durations` (per-frame pacing, parallel to the tag's range) — and the **`climb` sprite kind** — `SpriteAnimKind`/`SpriteAnimClip` gain `'climb'` and `SpriteAnimInputs` gains `climbing`, so a wall-climb clip rides the SAME clock as idle/walk/jump instead of a parallel hand-rolled one; **`TriggerProps.fields` (§6.1)** — every translated trigger entity carries its authored LDtk field values as a clean top-level record (`props.fields.tiletype`), retiring the `props.params.fieldInstances` reach-through; the **FallingBlock recipe (§6.1)** — `collectFallingBlocks` / `advanceFallingBlocks` / `fallingBlockSolids` / `fallingBlockArmed` + `FALLING_BLOCK_TUNING` / `scaleFallingBlockTuning`, the Celeste prologue ceiling block as a pure engine-owned state machine (arm on X-only overlap, shake 0.2 s, extending 0.4 s grace, accel 500 to cap 160, flush landing, crush events); the **multi-device input merge (§4.3)** — `mergeEdges` / `mergePolledEdgeMaps` (the keyboard+gamepad+touch cascade in three lines) + `extendKeyboardMap` / `extendGamepadMap` (add a key to the frozen standard maps without hand-rolling a copy — the gamepad-Start-pauses recipe); and **menu navigation (§8)** — `createMenuNav` / `advanceMenuNav` / `openMenuNav` / `clampMenuNavIndex` + `IDLE_MENU_INPUT`: the wrapped-selection/confirm/open-grace state machine the start menu AND the pause menu both consume. `0.19.1` is `0.19.0` plus the seamless 10 s white+pink noise buffers (equal-power-crossfade loops) so sustained voices stop sounding 1 Hz-periodic — the §10 wind bed depends on it. `0.19.0` is `0.18.0` plus the **entity-art side channel (§7.1)** — `ldtkLevelToLevelData` returns `entityArt` keyed by the ENGINE entity id and `compileLdtkRoom` carries it onto `CompiledLdtkRoom.entityArt`, so `room.entityArt.get(entity.id)` replaces the consumer-side rect-key index and both of its shipped failure modes (the mid-slide red-box flash and the cross-room rect-key collision) — the **session `cameraRebaseDelta` (§5.5)**: `beginSessionRoomSlide`/`advanceSessionRoomSlide`/`endRoomTransitionSession` each report the camera-space rebase they applied, so a parallax backdrop fed the raw `brain.camera` accumulates and subtracts instead of teleporting at a seam — the **Celeste camera preset (§5.4)**: `CELESTE_CAMERA_WINDOW` + `celesteCameraZoom` (a constant window fit — never the room) + `celesteFollowVcam`/`celesteFollowMotion` (half-life 0.15 s, `devicePixelSnapThreshold`) + `CELESTE_ROOM_SLIDE_OPTIONS` (0.65 s easeOutCubic), with the fit docs corrected (`'cover'` was wrongly marketed as "the Celeste policy" — Celeste's lens never fits anything) — and **sustained-voice modulation (§10)**: `NoiseLoopHandle.setFrequency`/`setQ` (de-zippered filter retargets), `NoiseLoopOptions` (`q` at voice start, `noise: 'pink'`), and decorrelated random-start voice rotations. `0.18.0` is `0.17.5` plus the **seam apron (§5.3/§5.5)** — `compileRoomSeamApron` / `createSeamApronCache` / `seamApronSourceFromSolidId` + `DEFAULT_SEAM_APRON_DEPTH` and the now-public `seamSpanFor`: the linked neighbour's near-seam solids, rebased into the active room's local coordinates, so the floor across a seam exists in the per-tick collision set BEFORE the room switch — every crossing lands flush at any fall speed (0px embed), and the post-hoc guard `protectGroundedRoomSlide` is **removed** (a build carrying a local fallback shim of it must delete the fallback too, or the momentum cancellation survives the upgrade invisibly; §5.5). `0.17.5` is `0.17.4` plus `applyCanvasDprTransform` (§5.4 — the explicit screen-space DPR boundary, so a HUD cannot inherit a camera transform or be scaled twice). `0.17.4` is `0.17.3` plus the **render-composition pair (§5.4)** — `composeCameraTransform` (apply an already-resolved `cameraTransform` to the context: THE world-space boundary, so every layer a game draws itself moves with the camera) and `applyCameraLetterbox` / `cameraLetterbox` + `CameraLetterbox` / `CameraFrameRect` (the contain-fit mask: bars outside the room frame, clip to it). Both close defects from a real build — a dash trail pinned to the screen while the level scrolled, and an unmasked margin that read as playable level. `0.17.3` is `0.17.2` plus the **surface-cache smoothing guard** (the cache's blit owns `imageSmoothingEnabled` — under caller-default smoothing a fractional zoom bilinear-blurred the whole baked level; found in a real build with crisp sprites and blurry platforms, since `drawSprite` always guarded its own). `0.17.2` is `0.17.1` plus **`canvasCssViewport`** (§5.4 — the viewport in CSS units; passing the DPR-multiplied backing store doubles the camera's assumed view on Retina, invisibly fine at `dpr` 1). `0.17.1` is `0.17.0` plus the **`drawSprite` `snap` option** (§4.4 — pixel-grid destination rounding: raw physics floats under zoom land on fractional device pixels, the mid-jump shimmer; `cameraTransform` fixed the level's seam, `snap` fixes the sprite's). `0.17.0` is `0.16.0` plus the **FIXES.md hardening pair (§4.4/§5.4)** — `spriteAnimClipFor`/`createSpriteAnimPlayer`/`advanceSpriteAnimPlayer` (the clip-aware clock: a jump arc plays straight through) and `snapCameraBrain` + `cameraTransform`/`applyCameraTransform` (solved first-frame framing; device-pixel snapping for the render transform) — the **per-emitter `worldGravity`/`worldDrag`** particle overrides, and **`nineSliceBorders` + full `NineSlice`/`FullSize*` rendering** in `drawLdtkEntityTile`. **Compatibility break: replay physics version 14** (the collision snap is now order-independent nearest-wall/highest-floor over the original move's overlaps, and a spring launch preserves a buffered jump press — v13 replays are rejected). `0.16.0` is `0.15.0` plus the **entity-art pair (§7.1)**: `LdtkEntityDef.tileRenderMode` — the def's authored render mode, parsed (all seven LDtk schema values; defs omitting the key parse as `'FitInside'`) — and **`drawLdtkEntityTile(ctx, tile, dest, tilesets, mode?)`**, the engine-owned blit for an entity's authored display tile (`Repeat` tiles across resized instances, `Stretch`/`FitInside`/`Cover` scale; never throws). `0.15.0` is `0.14.1` plus the **room-transition session orchestrator** (`createRoomTransitionSession` / `pollRoomTransition` / `beginSessionRoomSlide` / `advanceSessionRoomSlide` / `endRoomTransitionSession` — one immutable `{ detector, slide }` state machine that makes the seam-transition invariants structural, §5.5), the **per-axis containment latch** on `detectLdtkRoomExit` (an exit additionally requires the body to have been fully contained once on that exit's crossing axis; straddle suppression is intrinsic and reset-immune — a discarded or fresh detector state cannot tick-tock), and the **preflight `multiRoom` flag** (`capabilities.multiRoom` — the multi-room signal `capabilities.exits` never was, since `exits` counts Exit ENTITIES, not `__neighbours` seam traversal). `0.14.1` is `0.14.0` plus the **flush-landing fix** (an exact-flush arrival — e.g. a full-height held jump's symmetric arc — fires its `landing` moment + `justLanded` one tick after contact, engine-side, so no game-layer landing compensation is needed). `0.14.0` ships the **direction-aware wall-jump** (into-wall slide+jumps launch straight up — a single wall is chimney-climbable; release the direction and jump within `wallJumpGraceTime` for the classic away leap; replay physics version 13). `0.13.0` ships the **sustained audio layer** — `startNoiseLoop(filterType, freq, peak)` returns a `NoiseLoopHandle` (`stop()` fades out over ~0.1 s, `setPeak()` live-adjusts loudness) for sounds that last as long as a state (the §10 wall-slide scrape), and `playNoise` bursts now start at a random offset in the shared noise buffer so overlapping/retriggered bursts de-correlate instead of phase-locking into a buzz. `0.12.0` ships the **seam-free LDtk surface cache** (`createLdtkLevelSurfaceCache` — bake each room once at native resolution, one blit per frame at any fractional zoom). `0.11.0` ships the follow-compatible destination view (`roomEntrySlideView`). `0.9.0` ships the **feel + traversal layer** (the structured feel channel `state.moments` — landing impact ratio/hard, one-shot dash bonks with normal + surface id, dashEnded context, grab/stamina pulses, spring/refill moments; the pure room-transition helpers `findLdtkRoomExit` / `mapLdtkRoomEntry` / `transitionPlatformerToRoom` / `rebasePointBetweenLdtkRooms`; the slide orchestrator `beginRoomSlide` + the camera-space rebases; the explicit camera fit `fitCameraZoom`) **and the mantle wave** (direction-aware grab+jump + ledge mantle). The `0.7.0` golden path (high-level LDtk loader, preflight, per-room compiler + cache, config scaler, input maps, solid-id helpers, spawn fix, loop `onError`) and the earlier camera-brain/LDtk/movement drops (`0.5.0`/`0.6.0`) all remain. A manually-constructed `PlatformerState` needs `moments: []`. Do not pin below `0.21.1`.

- **TypeScript**, strict. Target ES2021, `moduleResolution: bundler` (matches the engine; Vite resolves its ESM fine).
- **Vite** dev server + build. Single `<canvas>` in `index.html`.
- **`aicraft-engine`** is your only runtime dependency. Import from the **root barrel only**:
  ```ts
  import {
    // game-loop + game-state
    createGameLoop, DEFAULT_FIXED_DT,
    createGameState, reduceGameState, isLegalTransition, DEFAULT_GAME_STATE_ADJACENCY,
    createMenuNav, advanceMenuNav, openMenuNav, clampMenuNavIndex, IDLE_MENU_INPUT,   // 0.20.0 §8: menu + pause selection
    type MenuNavState, type MenuNavInput,

    // input
    createKeyboardAdapter, createTouchButtonSet, createGamepadAdapter, orEdges,
    mergeEdges, mergePolledEdgeMaps,              // 0.20.0 §4.3: the multi-device cascade in three lines
    extendKeyboardMap, extendGamepadMap,          // 0.20.0 §4.3: add a key to the frozen standard maps
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
    collectFallingBlocks, advanceFallingBlocks, fallingBlockSolids, fallingBlockArmed,   // 0.20.0 §6.1
    FALLING_BLOCK_TUNING, scaleFallingBlockTuning, FALLING_BLOCK_TRIGGER_ACTION,
    type FallingBlock, type FallingBlockEvents,
    drawActor, drawLevelEntity, DEFAULT_ENTITY_PALETTE,   // §7.1: entity art, LDtk tile first
    type DrawLevelEntityOverrideMap, type EntityPalette,  // §7.1: the per-kind draw override
    jumpAbility, wallSlideAbility, dashAbility,
    type PlatformerConfig, type PlatformerState, type PlatformerInput,
    type CompiledLevel, type CompiledMovingPlatform, type LevelEntity,
    type CompiledLdtkRoom, type LdtkRoomCache,

    // room transitions — the seam-traversal session + composition layer (§5.5)
    createRoomTransitionSession, pollRoomTransition,
    beginSessionRoomSlide, advanceSessionRoomSlide, endRoomTransitionSession,
    createSeamApronCache, seamApronSourceFromSolidId,   // 0.18.0 §5.3/§5.5: the apron line in the tick set (reverse apron: ids before entity lookups)
    roomEntrySlideView, presentationForRoomSlide, ROOM_SLIDE_VCAM_ID,
    mapLdtkRoomEntry, transitionPlatformerToRoom, rebasePointBetweenLdtkRooms,
    findLdtkRoomExit, detectLdtkRoomExit, createRoomExitDetectorState,
    type LdtkRoomExit, type LdtkRoomEntry,

    // camera brain — Cinemachine-style vcams, blends, deadzone follow
    celesteCameraZoom, celesteFollowVcam, celesteFollowMotion,          // 0.19.0 §5.4: THE Celerock policy — constant window, no-deadzone follow
    CELESTE_CAMERA_WINDOW, CELESTE_FOLLOW_AHEAD, CELESTE_FOLLOW_CENTERED,
    CELESTE_ROOM_SLIDE_OPTIONS,                                          // 0.65 s easeOutCubic — the Celeste transition
    createCameraBrain, updateCameraBrain, fitCameraZoom,                 // the general fit helper (NOT the Celerock policy — §5.4)
    snapCameraBrain,                                                     // 0.17.0 §5.4: first-frame framing (the ease's fixed point)
    cameraTransform,                                                     // 0.17.0 §5.4: device-pixel snap for the render transform
    composeCameraTransform,                                              // 0.17.4 §5.4: THE world-space boundary — scale + snapped offset onto the ctx
    applyCameraLetterbox, cameraLetterbox,                               // 0.17.4 §5.4: contain-fit mask — bars outside the room frame + clip
    DEFAULT_CAMERA_MOTION, DEFAULT_LENS_MOTION, DEFAULT_BRAIN_BLEND_DURATION,
    type CameraBrain, type CameraBrainOptions, type VirtualCamera,
    type CameraTarget, type CameraBounds,
    type CameraLetterbox, type CameraFrameRect,                          // 0.17.4 §5.4

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
    createSpriteAnimPlayer, advanceSpriteAnimPlayer, type SpriteAnimPlayer,  // 0.17.0 §4.4: clip-aware clock (jump plays straight through)
    spriteAnimClipFor,                                             // §12.1: the kind→clip mapping contract
    drawSprite,
    createSpriteTintCache,                                         // §9: the tired-flash tint pass (never a scale on pixel art)
    type SpriteSheetJSON, type CompiledSpriteSheet, type CompiledAnim,
    type SpriteAnimState, type SpriteAnimKind, type SpriteAnimInputs,
    type DrawSpriteOptions,

    // particles (dash trail, landing dust, respawn flash, spring sparkle)
    spawn, stepSeconds, DEFAULT_PARTICLE_AIR, type Particle,   // §9's units contract: the shared air medium for stepSeconds
    sampleConeVelocity, createEmitter, stepEmitters,

    // parallax + glow + outline (the look around the tileset)
    drawTiledParallax, parallaxOffset, PARALLAX_FAR, PARALLAX_MID, PARALLAX_NEAR,
    outlineRect, drawGlow, getDevicePixelRatio, resizeCanvasToBackingStore,
    canvasCssViewport,                                  // 0.17.2 §5.4: the viewport in CSS units (NOT canvas.width — the DPR-multiplied backing store)
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

> **Engine recipes (copy-in, do not re-derive).** The engine repo maintains [`recipes/`](https://github.com/morganpage/aicraft-engine/tree/v0.22.4/recipes) — compiled, unit-tested wiring modules for the glue this brief used to inline as sketches. Wherever a section below says "recipes/<name>.ts", copy that file into `src/recipes/` verbatim and import it locally; because CI typechecks recipes against the engine source, they cannot drift the way inline sketches once did (this brief's own dash-trail sketch taught a 60× units bug). **This brief uses:** `audio-unlock` (§10), `fixed-tick-game` (§2 — the reduced-motion-gated loop boot), `platformer-input` (§4.3), `sprite-sheet-boot` (§4.4), `image-decoder` (§4.4 — the shared bounded decoder, `decodeImageBounded`), `sheet-frame-index` (§4.4), `ldtk-draw-pipeline` (§5.4/§5.7 — `createLdtkRoomPainter`, the painter over the surface cache), `room-slide-aperture` (§5.4), `ldtk-hot-reload-plugin` (§5.7), `ldtk-entity-art` (§7.1), `ldtk-entity-tile-art` (§6.1 — falling-block art baked with the project's own auto-rules), `feel-effects` (§9 — the tuned burst kit over the engine's `*_EFFECT` presets: trail/dust/sparkles/afterimage/gem-twinkle), `game-test-harness` (§12 — the recording context, the forbidden-identifier scan, and the QA shot manifest, so the suite tests GAME code, not just the engine), and `particle-system` (§9 — the pre-0.21.0 back-port of the engine's `stepSeconds`, listed for older pins; at this brief's pin, call `stepSeconds` directly). Game-specific code — the Celeste config, the anim-kind derivation, the render frame, the transition-session consume, the FSM — stays in this brief; it has no second customer. (Recipes import their own engine symbols — prune those from your game's §1 import block.)

### 1.1 The bundled assets — download these first

Four files. Fetch them **at scaffold time** into `public/`, all four flat in the same directory — the LDtk project references its tileset as the bare sibling name `celerock.png`, and `Player.json` names its sheet as the bare `Player.png`, so nesting either anywhere else breaks the load. Do **not** fetch these from GitHub at runtime (CORS + offline); they are project assets, served by Vite from `public/`.

```bash
BASE=https://raw.githubusercontent.com/morganpage/aicraft-engine/v0.22.0/games
mkdir -p public   # --output-dir does not create missing directories (curl ≥ 7.73)
curl -fsSLO --output-dir public "$BASE/celerock.ldtk"
curl -fsSLO --output-dir public "$BASE/celerock.png"
curl -fsSLO --output-dir public "$BASE/Player.png"
curl -fsSLO --output-dir public "$BASE/Player.json"
```

> The pack is fetched from the RELEASE TAG — tag-frozen, not living — but the living-file doctrine below stands anyway: substituted `.ldtk` files are first-class, and every count/size/identifier in this brief is orientation, never an assertion.

| File | What it is |
|---|---|
| `celerock.ldtk` | The level — a single-file LDtk project (`externalLevels: false`), LDtk `jsonVersion` 1.5.3; the room count and shapes are the file's, not the brief's (living-file doctrine — see the verify block below) |
| `celerock.png` | The tileset — 1024×1024, 8px tiles, referenced by the `.ldtk` as `celerock.png` |
| `Player.png` | The player sheet — 160×128, the 10×8 grid of 16×16 frames §4.4 specifies |
| `Player.json` | The sheet's Aseprite-JSON companion — the §4.4 animation **source of truth** (the 10×8 `meta.grid`, the four clip tags with their `duration`/`loop` extensions, the `characters[]` mapping). Edit clips here, never in game code |

**Verify the download before building anything.** These values are what the shipped pack actually contains — a mismatch means a truncated or substituted file, not a bug to code around:

- `project.levels.length >= 1` — the count is whatever the file carries (a LIVING file: log it, never assert it). LOG each level's pixel size, and assert ONE uniform tile size via the preflight's `tileSizes` (a single entry — §5.2's config scaling depends on uniformity).
- Exactly one tileset def, `relPath === 'celerock.png'`.
- `inspectLdtkPlatformerProject(project).totalSpawns >= 1` — at least one authored `Player`/`Spawn`; the start room is whatever `getStartRoom()` resolves (LOG its identifier — never assume `Level_0`).
- The rooms form ONE connected `__neighbours` chain — assert `report.disconnectedRoomIids` is empty — with **exactly one terminal room**: the single level with NO `e` neighbour. Completion depends on that uniqueness AND on the terminal being reachable from the start (the connected chain gives you reachability) — a connected graph can still branch or carry several east-terminals, so `deriveTerminalRoomIid` must WARN on ambiguity, never silently pick. LOG the topology: the chain's direction, the vertical offsets between rooms, and that seams may be partial, not flush — the room-transition path (§5.5) has to rebase, and a build that only handles aligned seams will visibly break here.
- `getStartRoom()` → `{ ok: true }`, `room.spawn.source === 'authored'`, and the compile emits **zero diagnostics**.

**What the pack contained at this brief's last revision.** The capability matrix below is a time-of-writing snapshot for ORIENTATION only — read the LIVE matrix from `inspectLdtkPlatformerProject(project)` at boot and code against THAT, never against this table (the file is living; a substituted `.ldtk` even more so):

| Capability | Present | Notes |
|---|---|---|
| `hazards` | ✅ | `Spike` entities present at time of writing — the live count comes from the preflight |
| `collectibles` | ✅ | `Gem` strawberries present at time of writing — the live count comes from the preflight |
| `multiRoom` | ✅ | >1 level, all `connected` — ASSERT this (traversal is core scope) |
| `springs` | ❌ | entity def exists, no instances placed |
| `dashRefills` | ❌ | entity def exists, no instances placed |
| `exits` | ❌ | no `Goal`/`Exit` ENTITIES — `capabilities.exits` counts Exit entities, NOT `__neighbours` seam traversal; the world is still a connected chain (see the world contract below) |
| `ladders` | ❌ | the IntGrid has a single value, `1: walls` — no `passthrough` one-ways either |
| `movingPlatforms` | ❌ | §5.3 is dead code for this pack |
| falling blocks (`FallingBlock` triggers) | ❌ | no instances placed (defs do not exist either); §6.1's path is wired capability-gated — a substituted `.ldtk` carrying them shows up in `report.unknownTriggerIdentifiers` |

Wire the capability-gated systems anyway (they cost nothing when the buckets are empty, and they light up if a user swaps in a richer `.ldtk`), but **do not treat their absence as a defect to fix, and do not author entities into the `.ldtk` to make them fire.** The §9 juice items for springs and dash-refills are unverifiable against this pack; say so in the report rather than faking them.

**World contract (CORE SCOPE, not emergent).** The supplied LDtk is a **chained mountain** — however many rooms the file carries, one connected component linked via `__neighbours` (the verify block above: one chain, vertical offsets logged, a unique terminal room asserted). Traversal from the start room to the **final room's summit** is the win condition and is **core scope**: a build that renders one room is a failure regardless of what `capabilities.exits` reports (`exits` counts Exit ENTITIES, not `__neighbours` seam traversal — it is `false` for this pack even though the full chain exists). The §12.1 load smoke test and §12.3 transition smoke test exist to prove traversal; §14 Stage 3 is not skippable, and a single-room build cannot pass its gate. **Completion is structural, not authored:** the **terminal room** is the level with NO `e` neighbour in `__neighbours` — derived from the project at boot (never hardcode the identifier; warn loudly if more than one candidate exists — the verify block asserts uniqueness). On seam-entry into the terminal room, fire the chapter-complete card via the existing tween path (`createTweenState` + `easeOutBack`) and transition the FSM however the game already handles completion. No `Goal` entity is created and the `.ldtk` is never edited — the terminal-room rule itself fires `{ type: 'win' }` on seam-entry (§8, §12.7 criterion 15).

> **Licensing.** All three art files are **CC0 1.0 Universal** (public domain dedication — no attribution required, commercial use fine). `celerock.png` is from [Tranquil Tunnels](https://octoshrimpy.itch.io/tranquil-tunnels) by octoshrimpy; `Player.png` is from [Deep Night](https://v3x3d.itch.io/deep-night) by VEXED. Credit them anyway if you ship this — CC0 does not require it, but it is the decent thing to do. (`Player.json` is authored alongside this brief — the §4.4 sheet definition, not third-party art — and carries the same CC0 dedication so the pack stays uniform.)

---

## 2. Determinism & Discipline Rules (enforced by the engine — follow them)

- **Fixed-step sim, variable render** via `createGameLoop({ fixedDt: 1/60, step, render })` — wired through `recipes/fixed-tick-game.ts`'s `startFixedTickGame`, which is exactly this boot plus the reduced-motion gate below (copy it in; do not re-wire). Poll input **exactly once per `step`**. Pass an `onError: (error, { phase }) => { ... }` handler (and optionally `errorPolicy`) so a throw inside your `step`/`render` can never silently freeze the loop on its last frame — that exact bug froze a prior build at tick 5314 with the last frame stuck on screen and no way for the host to detect it. The default policy is `'stop'` (which at least makes the failure observable via `loop.stoppedDueToError`); prefer wiring `onError` to your own error surface.
- **No `Math.random()` and no `Date.now()` ANYWHERE in game code** — not in the simulation AND not in decorative audio/visual/particle code. Use seeded `mulberry32(seed)` → `nextInt` / `nextFloat` / `pick` for both authoritative AND decorative randomness; pass an explicit `rng` to anything that needs jitter. (A textual `Math.random` anywhere trips the §12.8 static-analysis grep — keep the rule simple and absolute.) Time comes from `tick` or the loop's `dt`.
- **Defensive host access.** Anything touching `window`/`AudioContext`/`matchMedia`/`fetch`/`Image` goes through the engine's adapters (`createAudioAdapter`, `prefersReducedMotion`, `resizeCanvasToBackingStore`, `createLocalStorageSaveStorage`) or a lazy, error-swallowing loader of your own — never bare at import time.
- **Reduced motion.** Gate the loop: if `prefersReducedMotion()`, render one static frame of the first room and never call `loop.start()` — `startFixedTickGame` (recipes/fixed-tick-game.ts) owns this gate.
- **Pure progression ops.** The kernel and `collect`/`hasCollected` already return new objects — follow their lead. Never mutate `PlatformerState` or `CollectibleSave` in place.
- **Draw the supplied tileset verbatim.** Render tiles only through the **surface cache** (`createLdtkLevelSurfaceCache`, which bakes each room verbatim via `drawLdtkLevel`). Do **not** recolor, tint, palette-swap, or procedurally overpaint the tile art — the supplied tileset *is* the visual identity of the game. Cosmetic `shade`/`mixHex` is for the player body, hair, parallax, and UI only, never for level tiles.

---

## 3. Architecture — Engine Module → Game System Map

| Game system | Engine API |
|---|---|
| Game loop (60 Hz fixed) | `createGameLoop`, `DEFAULT_FIXED_DT` |
| Keyboard / touch / gamepad input, edge merging | `createKeyboardAdapter`, `createTouchButtonSet`, `createGamepadAdapter`, `orEdges`, `mergeEdges`/`mergePolledEdgeMaps` (multi-device), `extendKeyboardMap`/`extendGamepadMap` (frozen-map extension) |
| **Asset preflight (G3)** | `inspectLdtkPlatformerProject(project)` — pure; reports levelCount, per-room spawn/tileSize/entityCounts/neighbours/connected, aggregated `capabilities` (hazards/collectibles/springs/dashRefills/exits/ladders/movingPlatforms/multiRoom), spawn-less/disconnected rooms, unknown trigger ids. **Missing optional content is informational, NOT a failure.** |
| **Load the supplied LDtk project** | **PREFERRED** `loadLdtkProjectAssets({ projectUrl, assetBaseUrl?, imageTimeoutMs?, fetch?, decodeImage? })` → `{ ok, project, tilesets, diagnostics }` (handles URL-encoding of spaces/brackets, bounded decode, skip-LdtkIcons, defensive host access). **Manual alternative:** `parseLdtkProject(text)` → `{ ok, project?, errors }` (destructure + check `ok && project`) then SYNC `buildLdtkTilesetBundle(tilesets, loadImage)` whose `loadImage` returns `CanvasImageSource \| undefined` (NOT a Promise). |
| **Translate an LDtk level → engine geometry** | `ldtkLevelToLevelData` (IntGrid → solidity by value *name*; entities → engine entities via `LDTK_DEFAULT_ENTITY_MAP`) |
| **Compile a room for play (PREFERRED)** | `compileLdtkRoom(ldtkLevel, project, options?)` → `CompiledLdtkRoom` with bucketed `solids`/`hazards`/`collectibles`/`springs`/`dashRefills`/`exits`/`enemies`/`ladders` + resolved `spawn`. Wrap a whole project in `createLdtkRoomCache(project, options?)` for lazy per-`iid` compile + `getStartRoom()`. (Low-level: `compileGeneratedLevel({ level, tileSemantics }, { config, playerWidth, playerHeight })` — note `CompiledLevel` has **no `.entities` field**; read entities from the translated `level.entities` or from the room buckets.) |
| **Render the supplied tileset** | `recipes/ldtk-draw-pipeline.ts`'s `createLdtkRoomPainter` (over `createLdtkLevelSurfaceCache`, which bakes via `drawLdtkLevel` / `drawLdtkLayer`) + `buildLdtkTilesetBundle` |
| **Tile-unit config scaling** | **PREFERRED** `scalePlatformerConfig(config, scale)` / `createPrecisionPlatformerConfig({ tileSize, referenceTileSize?, jumpApexTiles?, timeToApex?, coyoteTime?, wallGrabEnabled?, climbEnabled? })` — unit-aware (distances/velocities/accelerations scale; times/ratios/counts/booleans don't) and re-pegs jump-relative impulses. `PlatformerConfig` is FLAT (`dashEnabled`/`dashSpeed`/`wallSlideEnabled`/`wallJumpVx`/… top-level; only `jump:` and optional `squash:` are nested). |
| **Solid-id helpers** | `solidIdForEntity(id)` / `entityIdFromSolidId(solidId)` — entity solids are `entity-<id>` (NOT `solid-`); tile-derived solids are a separate `tile-…` namespace (not reversible). |
| **Spawn resolution** | `compileGeneratedLevel`/`compileLdtkRoom` resolve the LDtk FEET-CENTER spawn to the AABB top-left via `spawnResolution:'rest-on-surface'` (the LDtk default) — the player rests on the surface, **no floor embed, no hand-rolled settle**. `settlePlatformerState(state, solids, config?, maxSteps?)` is a recovery tool for legacy/embedded spawns only. |
| **Player controller (jump + wall-slide + wall-jump + dash + wall-grab/stamina/climb-jump/mantle + dash-tech)** | `PRECISION_PLATFORMER` + `stepPlatformer(state, input, solids, dt, config?, getSolidDisplacement?)` → `{ state }` — boolean event pulses (`justLanded`/`justLaunched`/`hitCeiling`/`hitWall`/`startedWallSlide`/`wallJumpLaunched`/`dashStarting`/`dashStarted`/`doubleJumped`/`climbJumpLaunched`/`mantled`) are on **`state.events`**; spring/dashRefill `interactions` (each carrying an `entityId` solid id) are on **`state.interactions`**; structured FEEL moments (landing impact ratio/hard flag, dash bonks with normal + surface id, dashEnded context, grabLatch/staminaExhausted, springLaunch/dashRefill) are on **`state.moments`**. **Do NOT hand-roll velocity, stamina, collision, or feel thresholds.** |
| Moving-platform rooms | `advanceMovingPlatform`, `movingPlatformToSolid`, `createMovingPlatformDisplacementProvider(current, previous)` — pass the provider as the **6th positional arg** to `stepPlatformer` so platforms carry the player. |
| **Seam apron (multi-room tick set, 0.18.0)** | `createSeamApronCache((iid) => rooms.get(iid))` → memoized `apronFor(iid)`; per tick add `...apronFor(active.ldtkLevel.iid)` to the solids array (§5.3/§5.5). Neighbour solids near a FLUSH linked seam only — `seamSpanFor` applies the exit poll's own void rule, so a partial seam's void band grows no phantom floor — rebased world-exactly, flags preserved, ids namespaced `apron:<levelIid>:<originalId>` (reverse with `seamApronSourceFromSolidId` before any entity-id lookup). Hazards, moving platforms, and per-cell ladders deliberately do NOT ride it (§5.5). |
| **Camera brain (per-room vcams, blends; the Celeste preset)** | `createCameraBrain`, `updateCameraBrain`, `celesteFollowVcam` + `celesteCameraZoom` (constant 320×184 window) + `CELESTE_FOLLOW_AHEAD`/`CELESTE_FOLLOW_CENTERED` — **do NOT use the legacy `createCamera`/`updateCamera`** |
| **Room-to-room transitions** | LDtk `__neighbours` — engine-owned **session orchestrator** `createRoomTransitionSession` → `pollRoomTransition` → `mapLdtkRoomEntry` → `transitionPlatformerToRoom` → `beginSessionRoomSlide` → `advanceSessionRoomSlide` → `endRoomTransitionSession` (see §5.5); momentum preserved, `'seam-entry'` provenance; **seam apron in the tick set** (`createSeamApronCache`, §5.3) so every crossing lands flush |
| Hazard AABB (spikes) | `aabbOverlap` against the player's rect (read from the kernel state) |
| **Entity art (spikes, strawberry, springs…)** | `drawLevelEntity(ctx, entity, { drawOverride })` — the override resolves the instance's authored `__tile` + the def's parsed `tileRenderMode` and blits via `drawLdtkEntityTile`; returning `false` falls back to `DEFAULT_ENTITY_PALETTE`. **The LDtk tile wins; the engine shape is the fallback** (§7.1) |
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
| **Player sprite (supplied `Player.png`)** | `parseSpriteSheet`, `compileSpriteSheet` (`meta.grid` synthesizes the 10×8 grid of 16×16 cells; tag extensions `loop`/`duration`/`durations` author one-shot clips + per-clip pacing), `deriveSpriteAnimKind` (`climbing` → `'climb'`; the `climbing` input is the ACTIVE grip flags, never the ability slices' permanent `kind` literals — §4.4) → `createSpriteAnimPlayer`/`advanceSpriteAnimPlayer` + `currentFrameIndex`, `drawSprite` (stable 1:1, facing mirror, feet anchor — §4.4) |
| Dash trail, landing dust, respawn flash | `spawn`, `stepSeconds`, `sampleConeVelocity` |
| Parallax background (far/mid/near) | `drawTiledParallax`, `parallaxOffset`, `PARALLAX_FAR/MID/NEAR` |
| Vector look + glow (player, pickups, UI) | `outlineRect`, `drawGlow` |
| Crisp Retina canvas | `resizeCanvasToBackingStore`, `getDevicePixelRatio` |
| Death counter, room title cards, start menu (NEW GAME / RESUME GAME selection) | `drawText`, `drawTextOutlined` |
| Tween (death-and-respawn flash, transition cards) | `createTweenState`, `advanceTween`, `easeOutCubic`, `easeOutBack` |
| Synthesized SFX | `createAudioAdapter` |
| Frame FSM (menu / playing / paused / gameover) + menu selection | `createGameState`, `reduceGameState`, `isLegalTransition`, `DEFAULT_GAME_STATE_ADJACENCY`; `createMenuNav`/`advanceMenuNav` (start menu AND pause menu — §8) |
| **Falling blocks (capability-gated, §6.1)** | `collectFallingBlocks`, `advanceFallingBlocks`, `fallingBlockSolids`, `fallingBlockArmed`, `FALLING_BLOCK_TUNING`/`scaleFallingBlockTuning` — the Celeste ceiling block, engine-owned |

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
    // Pause (§8.2) — this map is your own, so it lives here directly (the
    // GAMEPAD standard map is the frozen one, hence extendGamepadMap below).
    Escape: 'pause',
    // OPTIONAL: add WASD aliases for players who expect them. Celeste does
    // NOT ship these by default, so they are commented out to stay faithful.
    // KeyW: 'up', KeyA: 'left', KeyS: 'down', KeyD: 'right',
  },
};
const keyboard = createKeyboardAdapter(CELESTE_KEYBOARD_MAP);
const gamepad  = createGamepadAdapter(
  // 0.20.0: the standard map ships deeply frozen — extend it, never copy it.
  // Start (W3C index 9) opens the pause menu (§8.2).
  extendGamepadMap(STANDARD_GAMEPAD_PLATFORMER_MAP, { buttonToAction: { '9': 'pause' } }),
);
```

**Merge the devices with the engine's merge layer — do not hand-roll the cascade.** Every adapter's `poll()` returns `Record<action, PolledEdge>`; `mergePolledEdgeMaps(...)` OR-merges any number of them over the union of their actions (a disconnected gamepad contributes nothing and costs nothing), and `IDLE_EDGE` covers unmapped actions. Touch buttons (criterion 1) join the same merge — one `poll()` per adapter, once per fixed tick:

```ts
// per fixed tick — poll each device exactly once, then merge, then derive.
// touch.poll() returns a POSITIONAL PolledEdge[] (slot order = your button
// order), NOT a record — mergePolledEdgeMaps consumes records keyed by
// action name, so map the slots to names yourself (merging the raw array
// would use array indices as action names). Eight buttons: the d-pad, the
// three Celeste actions, and ⏸ (criterion 22's touch pause).
const [tLeft, tRight, tUp, tDown, tJump, tDash, tGrab, tPause] = touch.poll();
const edges = mergePolledEdgeMaps(keyboard.poll(), gamepad.poll(), {
  left: tLeft, right: tRight, up: tUp, down: tDown,
  jump: tJump, dash: tDash, grab: tGrab, pause: tPause,
});
// The PlatformerInput derivation (§4.3's shape, from the merged map) is
// recipes/platformer-input.ts — copy it in, do not re-derive by hand:
const input = derivePlatformerInput(edges);
// edges['pause'] feeds the §8.2 pause FSM (Escape on keyboard, Start on
// gamepad, ⏸ on touch) — it is an FSM action, not a kernel input, so read
// it off the map directly.
```

**Bindings (authoritative for this brief):** Arrow keys move (←→ horizontal, ↑↓ for ladder climb / fast-fall / dash-aim), `C` jump, `X` dash, `Z` grab/clamber, `R` instant respawn (engine convenience), `Escape` pause (already in `CELESTE_KEYBOARD_MAP` above — the GAMEPAD standard map is the frozen one, hence `extendGamepadMap`). This matches Celeste's PC defaults verbatim; the engine's `STANDARD_KEYBOARD_PLATFORMER_MAP` (`Space`/`Shift`/`KeyK`) is deliberately **not** used so players get the real Celeste layout.

### 4.4 Sprite render (the supplied `Player.png` — primary renderer, from the FIRST play tick)

The player is rendered with the **supplied `Player.png` sprite sheet from the very first playable tick** — there is NO "procedural player first, swap the sprite in later" phase. Load + compile the sheet at boot (Stage 2, alongside the movement config) and draw the sprite every tick the player is on screen. The procedural renderer is the **boot-time load-failure fallback ONLY** — used in the single case where `Player.png` fails to decode/compile, so a missing asset never blocks play. Do not build the procedural body as the primary and migrate later; that migration is a known source of shimmer/anchor/pivot regressions, and it is avoided entirely by rendering the sprite from the start.

**The asset + frame mapping (authoritative).** `Player.png` is **160×128 px = a 10-column × 8-row grid of 16×16 frames** (row-major). Frame numbers are 1-indexed; they map to 0-indexed cells `i` with source rect `sx = (i % 10) * 16`, `sy = floor(i / 10) * 16`:

| Anim | Frames (1-indexed) | Cells (0-indexed) | Pacing (ms/frame) |
|---|---|---|---|
| Walk | 1–8 | **0–7** (row 0) | compiler default (100) |
| Idle | 26–27 | **25–26** (row 2) — a REAL 2-frame breathing pair | **400** (slow) |
| Climb | 36–37 | **35–36** (row 3) | **160** |
| Jump | 61–65 | **60–64** (row 6) | **70**, one-shot (`loop: false`) |

Art faces right; left is produced by the facing mirror. Transparency is verified (empty/corner pixels are alpha 0). The idle pair at 25–26 and the climb pair at 35–36 are in the shipped sheet — the 0.20.0 tag extensions (`duration`, `loop`, §1) are what make their PACING and one-shot semantics authorable at compile instead of hand-patched after it.

**Boot: load + compile (defensive — mirror the tileset loader).** Load `Player.png` with the **same defensive, error-swallowing image loader you use for tileset PNGs** (bounded decode, never crash boot), and load the animation definition the same way: the sheet JSON lives in **`Player.json`, the animation SOURCE OF TRUTH** (§1.1) — do **not** fork its contents into game code. To change the clip set, edit `Player.json` (any editor that speaks this Aseprite-JSON superset — Animaitor imports and re-exports it losslessly, tag extensions included) rather than forking the JSON in game code. A missing/failed sprite is **NOT fatal** — set the sheet to `null` and the render path falls back to the procedural body. `parseSpriteSheet` never throws, so wrap the whole thing and degrade quietly:

```ts
// recipes/sprite-sheet-boot.ts (engine repo) — copy it in. The defensive
// fetch/parse/compile boot for a PNG + its Aseprite-JSON definition, degraded
// to null on ANY failure (bad fetch, hostile host, unparseable JSON, failed
// decode): a missing sprite never blocks boot — the render path falls back to
// the procedural body. decodeImageBounded is recipes/image-decoder.ts's
// URL-facing bounded decoder (copy that recipe in too) — the same
// defensive-decode discipline loadLdtkProjectAssets applies internally; the
// golden LDtk path never makes you write one, and the sprite path shouldn't
// either.
const sheet = await loadSpriteSheetAssets({
  imageUrl: `${import.meta.env.BASE_URL}Player.png`,
  jsonUrl:  `${import.meta.env.BASE_URL}Player.json`,
  decodeImage: decodeImageBounded,       // (url) => Promise<CanvasImageSource | undefined>
});

// Player.json authors: a 10×8 `meta.grid` → 80 synthesized cells (row-major;
// frameTags `from`/`to` are TILE INDICES under meta.grid) and the four clips
// of the table above with their 0.20.0 tag extensions — `duration` per-clip
// pace (idle 400, climb 160, jump 70; walk rides the 100 ms compiler default)
// and `loop: false` on jump (the one-shot that clamps on the fall frame).
// Every clip resolves the same way through the sheet's lookup — there is no
// hand-built anim and no post-compile surgery on the compiled sheet (it is
// frozen). A sheet without a clip key falls back to idle, never to walk.
const clips = sheet
  ? { idle:  sheet.clip('idle'),  walk: sheet.clip('walk'),
      climb: sheet.clip('climb'), jump: sheet.clip('jump') }
  : { idle: null, walk: null, climb: null, jump: null };

// ONE clip player for the whole runtime (created once at boot; the per-tick
// block below advances it). `createSpriteAnimPlayer()` is also the respawn
// reset — the next jump starts on frame 0, not the clamped fall frame.
let anim = createSpriteAnimPlayer();
```

> **One-shot clips are engine-owned since 0.20.0.** The compiler used to hardcode `loop = true` for every `meta.frameTags` entry, which forced consumers to hand-build the jump `CompiledAnim` (and, for per-clip pacing, to copy-on-write surgery on the frozen compiled sheet). The tag extensions close both: `loop: false` compiles verbatim and the frame player CLAMPS at `n-1` (the fall frame) once the clock passes the clip total; `duration`/`durations` author the pace. **The verified feel — play 60→64 once at 70 ms/frame, then clamp on the fall frame until landing — is now entirely in the sheet JSON above.**

> **slot ≠ cell.** `currentFrameIndex` returns the index into `anim.frameIndices` (0..n−1) — a SLOT, not a sheet cell. `drawSprite` expects a sheet cell (`sheet.frames[frameIndex]`), so always map through `anim.frameIndices[currentFrameIndex(...) ?? 0]` before drawing — **`recipes/sheet-frame-index.ts` is that mapping, named: copy it in and call `currentSheetFrameIndex(anim.state, clip)`.** (The walk clip works only by coincidence: its `frameIndices` `[0..7]` are the identity; the jump clip would otherwise render walk cells 0–4 while animating at the correct rate.)

**Per fixed tick: derive kind → advance the clip player → draw.** Drive the anim clock from the **same `dt` as the sim**. The clip player owns the reset discipline: it restarts the clock **only when the CLIP changes** — the three airborne kinds (`ascent`/`apex`/`descent`) are phases of ONE arc and share the jump clip uninterrupted (a per-kind reset replays the launch frames at every phase boundary — the "jump animation replays" defect from a real build). Reset on respawn via `anim = createSpriteAnimPlayer()` so the next jump starts on frame 0 instead of inheriting the clamped fall frame.

```ts
// Map the kernel's physics surface onto a semantic anim kind. `climbing` is
// true while EITHER grip ACTIVELY owns the body — a wall-grab
// (grabbing === true) or a ladder (climbing === true) — and reads as 'climb'
// with priority over the grounded/airborne branches.
//
// ⚠ THE ABILITY SLICES' `kind` LITERALS ARE PERMANENT. `abilities.wallGrab`
// exists from boot and its `kind` is ALWAYS 'wallGrab'; the activity is the
// `grabbing` FLAG (same shape for `climb`/`climbing`). A kind-only predicate
// (`?.kind === 'wallGrab'`) is therefore true EVERY tick — and since
// `deriveSpriteAnimKind` checks `climbing` first, a real build copied that
// predicate from an earlier revision of this very snippet and shipped a player
// stuck on the CLIMB clip for idle, walking, and jumping. Gate on the flags:
const grab = state.abilities.wallGrab;
const grabbing = grab?.kind === 'wallGrab' && grab.grabbing === true;
const ladder = state.abilities.climb;
const onLadder = ladder?.kind === 'climb' && ladder.climbing === true;
const kind: SpriteAnimKind = deriveSpriteAnimKind({
  supported: state.core.onGround,   // grounded?
  speedX:    state.core.vx,         // |speedX| > 12 px/s (default) ⇒ 'walk', else 'idle'
  velocityY: state.core.vy,         // airborne: <0 'ascent', >0 'descent', ~0 'apex'
  climbing:  grabbing || onLadder,  // ⇒ 'climb' (0.20.0)
});

// ONE clock. The player restarts it only when the CLIP changes, so the three
// airborne phases (ascent/apex/descent) share one uninterrupted jump arc, and
// the climb clip restarts entering/leaving the wall — never mid-arc.
// The parked-cling touch (Celeste: holding a cling without climbing HOLDS the
// frame — a frozen mid-reach pose reads as a cling, not a vibration): while
// kind === 'climb' and |vy| is at the cling epsilon, advance with dtMs 0.
const clingParked = (grabbing || onLadder) && Math.abs(state.core.vy) < 1;anim = advanceSpriteAnimPlayer(anim, kind, clingParked ? 0 : dt * 1000);

// ONE lookup — every clip (idle included) resolves the same way, so there is
// no special-case branch to drop in translation. (A real build collapsed the
// branches into `clip === 'walk' ? walk : jump` and rendered the JUMP
// clip — clamped on its fall frame — while standing still. A sheet without a
// climb clip simply has no 'climb' key — fall back to idle, never to walk.)
const clip = clips[anim.clip] ?? clips.idle;
const frameIndex: number = clip
  ? currentSheetFrameIndex(anim.state, clip) ?? 0   // slot → sheet cell — recipes/sheet-frame-index.ts
  : 0;

// Draw 1:1, bottom-centered on the FEET, facing mirror inside drawSprite.
// destX/destY are the destination TOP-LEFT (no bottom-center anchor in the
// engine): for a 16×16 frame on feet (feetX, feetY) → destX=feetX-8, destY=feetY-16.
const feetX = state.core.x + state.core.width / 2;
const feetY = state.core.y + state.core.height;       // bottom of the 0.5×1.5-tile box
drawSprite(ctx, sheet!.image, sheet!.compiled, frameIndex, feetX - 8, feetY - 16, {
  facing: state.core.facing,                          // 1 | -1; drawSprite mirrors about the frame's horizontal center
  snap: true,                                         // 0.17.1: round the dest — raw physics floats under zoom land on fractional device pixels (the mid-jump shimmer; cameraTransform fixed the LEVEL's seam, this fixes the sprite's)
});
```

**⚠ Stable 1:1 pixel-sprite policy (MANDATORY — or the art shimmers).** Applying a continuous breathe/squash scale to a 16×16 pixel sprite causes sub-pixel SHIMMER (nearest-neighbor flips edge columns each frame) — a real build reversed exactly this (BUILD_NOTES §6a). So:

- **The sprite draws at a stable 1:1 scale — NO breathe, NO squash/stretch scaling on the sprite — with `snap: true` destination rounding.** Pivot at the feet. The facing mirror (`drawSprite`'s internal `ctx.scale(facing, 1)`) still applies. **Do not ALSO wrap the sprite draw in your own `ctx.scale(facing, 1)` — that double-mirrors.** (Hair, if you draw it, goes OUTSIDE any mirror.)
- **Drop event-driven landing/launch squash on the sprite** (squash distorts pixel art). Squash/stretch (`advanceSquash`) is for the **procedural fallback body only**.
- **KEEP the dash aura glow + dash after-image trail** — they carry dash juice without distorting the sprite (they are particles/glow drawn alongside, not a scale on the sprite).
- The sprite is drawn **1:1 in world units** (16×16 = 2 tiles tall on the 8px-tile fixture — intentionally larger than the 0.5×1.5-tile collision box; the collision body stays the narrow box). A single `PLAYER_SPRITE_SCALE` multiplier (or scaling by `tileSize / 8`) is a one-line tunable if the LDtk uses a different tile size.
- **`image-rendering: pixelated` + `imageSmoothingEnabled = false`** for crisp nearest-neighbor (`drawSprite` forces the latter itself). **No shimmer while idle.**
- **Contact shadow:** do NOT draw one — omit the contact shadow entirely (it reads as a muddy drop shadow under the crisp pixel sprite).

**Fallback.** If `sheet` is `null` after boot, draw the procedural body instead: face + `advanceSpringRod` hair + `drawSimpleFeet` + the `advanceLocomotionByDisplacement` walk cycle + `advanceSquash` squash (pivot at the feet), wrapped in `ctx.scale(facing, 1)`. The procedural path is the **only** place breathe/squash scaling is applied.

> **Simpler alternative (still policy-compliant).** For ONE character with a couple of fixed clips, a direct `ctx.drawImage` keyed off `anim.clip` is acceptable — but the engine pipeline is **preferred** (it owns the facing mirror, the clip player, and the grid math). Either way §4.4's policy above holds.

---

## 5. World — The Supplied LDtk Level

Celerock does **not** author rooms. It loads the supplied `.ldtk`, translates each level into engine geometry, renders the supplied tileset through the **painter** (`recipes/ldtk-draw-pipeline.ts`'s `createLdtkRoomPainter` over `createLdtkLevelSurfaceCache`, which bakes each room verbatim via `drawLdtkLevel`), and flows the player between rooms across LDtk `__neighbours` seams.

### 5.1 Boot: load + asset preflight (G3)

**PREFERRED — one call** (`loadLdtkProjectAssets`) fetches the project, parses it, decodes every tileset PNG (bounded), and builds the bundle. It handles the URL-encoding of spaces/brackets in tileset `relPath`s (the raw-concat URL with spaces/`[`/`]` is what hung boot in real builds), skips the `LdtkIcons` atlas, and degrades a missing OPTIONAL tileset to a warning rather than crashing. **Never throws** — failures become diagnostics:

```ts
// 1. Load the LDtk project + all its tileset PNGs in one bounded call.
//    `celerock.png` resolves as a sibling of the .ldtk — keep them together in public/ (§1.1).
//    Base-URL-aware path (not route-relative): works at `/` and under a base path.
const result = await loadLdtkProjectAssets({ projectUrl: `${import.meta.env.BASE_URL}celerock.ldtk` });
if (!result.ok) { console.error('LDtk load failed', result.diagnostics); return; }
const { diagnostics } = result;                   // log warnings from `diagnostics` as you like
let { project, tilesets } = result;               // MUTABLE top-level refs — §5.7's hot reload reassigns both
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
let rooms: LdtkRoomCache = createLdtkRoomCache(project, {   // let: §5.7 rebuilds the whole cache per swap
  config,
  playerWidthForTileSize:  (ts) => 0.5 * ts,   // half-tile body fits 1-wide ladder shafts
  playerHeightForTileSize: (ts) => 1.5 * ts,
  // spawnResolution defaults to 'rest-on-surface' — the LDtk feet-center anchor is
  // resolved to the AABB top-left, so the player rests on the surface (no settle needed).
});

const start = rooms.getStartRoom();            // resolves the first level with an authored spawn
if (!start.ok) { console.error(start.diagnostics); return; }   // never fabricates a (0,0) room
let active: CompiledLdtkRoom = start.room;    // let: §5.5 transitions + §5.7 swaps reassign it
let state = active.compiled.initialState;      // rest-on-surface spawn (active.spawn.source === 'authored')
```

> Keep the cache options in **one `const ROOM_CACHE_OPTIONS`** rather than inlining them at the call — §5.7's hot reload rebuilds the *entire* cache on every saved `.ldtk` edit, and the rebuild must pass the identical options.

Each `CompiledLdtkRoom` already buckets entities by kind — read them off the room directly (there is **no `compiled.entities` field** on `CompiledLevel`):

| `CompiledLdtkRoom` field | contents |
|---|---|
| `solids` | `compiled.staticSolids` — tile geometry + `platform`/`passthrough` entity solids + the NON-BLOCKING `spring`/`dashRefill` trigger volumes. Moving platforms are NOT here (they stay in `compiled.movingPlatforms`). |
| `hazards` `collectibles` `springs` `dashRefills` `exits` `enemies` | the entity arrays, bucketed by resolved kind (`collectibles` is typed `CollectibleEntity[]` — it feeds `derivePickups` directly, no cast) |
| `entityArt` | the authored display art per entity, **keyed by the entity's engine id** — the §7.1 join, supplied by the engine (translate-time side channel). `room.entityArt.get(entity.id)` in a draw override; a missing key means the engine shape. |
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

**Custom entities ride the `trigger` fallback with their authored fields as data (0.20.0).** An identifier the map does not recognize (a `FallingBlock`, a `ShowHint`) translates to a `trigger` entity whose `props.action` is the identifier and whose **authored field values ride `props.fields`** — a clean `Record<string, unknown>` keyed by field identifier with each LDtk `__value` unwrapped (`{ tiletype: 2, label: 'crumbly' }`). Do NOT reach through `props.params.fieldInstances` (the legacy mirror of the same data) — `props.fields.<name>` is the supported read surface. The preflight lists every unrecognized identifier under `report.unknownTriggerIdentifiers` (informational, not a failure): that list is where you discover which custom entities a substituted `.ldtk` carries, and §6.1 shows the full consume pattern for one.

### 5.3 Moving platforms (when the LDtk defines them)

Each tick, advance platforms and feed the displacement provider so the player rides them. **Pass the provider as the 6th positional arg** to `stepPlatformer` — without it the kernel's riding tracker never sees platform motion and the player slides off:

```ts
const previous = movingPlatforms;                                   // active.compiled.movingPlatforms
movingPlatforms = movingPlatforms.map(p => advanceMovingPlatform(p, dt));
const displacement = createMovingPlatformDisplacementProvider(movingPlatforms, previous);
// The seam apron line (0.18.0): the linked neighbour's near-seam solids, so
// the floor across a seam exists BEFORE the room switch (§5.5). Create the
// cache once at boot over the same room cache —
//   const apronCache = createSeamApronCache((iid) => rooms.get(iid));
//   const apronFor = apronCache.apronFor;    // keep the handle — §5.7 clears it
// — it is memoized per room; no per-tick allocation.
const solids = [...active.solids, ...apronFor(active.ldtkLevel.iid), ...movingPlatforms.map(movingPlatformToSolid)];
state = stepPlatformer(state, input, solids, dt, config, displacement).state;   // 6th arg carries the player
```

### 5.4 Render the tileset + camera brain

Set the canvas once (`image-rendering: pixelated`, DPR-aware backing store). Each frame, the **camera brain** owns the view through the **Celeste camera preset**: one follow `VirtualCamera` per room (`celesteFollowVcam`), a **campaign-constant zoom** fitted to the fixed 320×184 one-screen window (`celesteCameraZoom` — the window, NEVER the room), no deadzone on Y and the 1/3-ahead framing on X, half-life 0.15 s. Render the tileset through the **surface cache** (`createLdtkLevelSurfaceCache` — which bakes verbatim via `drawLdtkLevel`) with `imageSmoothingEnabled = false`:

```ts
// One painter for the whole run — the CANONICAL tile draw (§5.4).
// recipes/ldtk-draw-pipeline.ts wraps the engine's surface cache
// (createLdtkLevelSurfaceCache — the first draw of each room bakes it once at
// native resolution; every frame after is a single blit, fractional-zoom
// safe) with the tilesets bound and invalidate/invalidateAll for §5.7. Copy
// the recipe in; game code holds no raw cache handle.
let painter = createLdtkRoomPainter(tilesets);   // let: §5.7 recreates it per applied swap

// One cached vcam per room — the Celeste preset (0.19.0) assembles the whole
// body: campaign-constant zoom (fit the 320×184 WINDOW, contain + integer
// scale), no-deadzone centered Y, 1/3-ahead X (an authored +48px cameraOffset
// in the original — the playtested framing), half-life 0.15 s, device-pixel
// snap threshold. There is nothing to hand-tune here; do NOT rebuild the body
// literal with fitCameraZoom(room, …) — fitting the ROOM makes zoom track
// room size, the opposite of Celeste's fixed lens.
const vcam: VirtualCamera = celesteFollowVcam(room.ldtkLevel.iid, {
  viewport,                                   // CSS pixels (canvasCssViewport)
  dpr,                                        // from resizeCanvasToBackingStore
  followX: CELESTE_FOLLOW_AHEAD,              // player at 1/3 from the left
  followY: CELESTE_FOLLOW_CENTERED,           // recenter every frame (the decompile has NO deadzone)
});

// Boot solved to the FIRST FRAME's framing — seeding only the zoom still
// pans the body in from the origin over the first second. Re-run this on
// campaign reset and hard respawn (snapCameraBrain is the ease's fixed
// point: what waiting would produce, produced now).
let brain = snapCameraBrain(createCameraBrain(), cameraOptionsFor(active, dt));

// Each tick:
brain = updateCameraBrain(brain, {
  vcams: [roomVcamFor(active)],
  targets: { player: state.core },            // the player's collision rect
  bounds: { width: active.levelData.width, height: active.levelData.height },
  viewport,                                    // CSS PIXELS (canvasCssViewport) — NOT the DPR-multiplied backing store (canvas.width), see the DPR rule below
  activeId: active.ldtkLevel.iid,
  dt,
});

// Each render — ONE world transform, and EVERY world-space layer inside it:
ctx.setTransform(1, 0, 0, 1, 0, 0);
ctx.imageSmoothingEnabled = false;                // FIRST line — see the state-reset rule below
ctx.clearRect(0, 0, canvas.width, canvas.height);

ctx.save();
ctx.scale(dpr, dpr);                              // CSS-pixel space from here (DPR rule below)
drawBackdrop(ctx, viewport);                      // atmosphere/parallax — SCREEN space, behind everything

// Device-pixel snap: rounding in WORLD units (the old recipe) still lands on
// a fractional device pixel under a fractional fitted zoom, which
// antialiases the level's edges into a hairline seam.
const t = cameraTransform(brain.camera, viewport, {
  zoom: brain.zoom,
  devicePixelRatio: dpr,          // from resizeCanvasToBackingStore
});

// LETTERBOX MASK (0.17.4). A contain fit always leaves slack on one axis, and
// the backdrop above just painted it. Fill bars outside the room frame and
// clip the world to that frame, or the empty margin reads as playable level.
// The aperture is ONE ROOM — never the slide's union (see the rule below).
applyCameraLetterbox(ctx, active, viewport, t, { fill: '#070b18' });

ctx.translate(shake.x, shake.y);  // shake INSIDE the clip — the mask stays welded to the viewport
composeCameraTransform(ctx, t);   // ◀── WORLD SPACE FROM HERE (scale + the snapped camera offset)

painter.draw(ctx, active.ldtkLevel, {
  view: t.view,                   // cull rect derived from the SNAPPED position
});                               // NO worldOffset — the camera lives in the context now
drawEntities(ctx, active);        // §7.1 — world coords
drawPlayer(ctx, state.core);      // §4.4 — world coords
drawParticles(ctx, particles);    // §9  — world coords, so the trail tracks the camera
ctx.restore();

// HUD, menu, death flash: AFTER the restore, in CSS-pixel screen space, and
// deliberately outside the letterbox clip.
```

**One world transform (the rule a real build got wrong next).** `composeCameraTransform(ctx, t)` is the boundary: everything before it is screen space, everything after it is world space. **Every world-space layer you draw yourself — particles, entity art, the player, debug overlays — goes after that line and takes RAW world coordinates.** The alternative the older recipe implied, leaving the camera offset out of the context and passing it as each draw's own `worldOffset`, has one standing failure mode: the layers the engine does not draw for you never receive the offset, and nothing forces the issue. A real build spawned its dash trail at correct world positions, drew it under the zoom alone, and shipped particles pinned to the screen while the level scrolled behind them — the spawn coordinates were never the bug, and "fixing" them would have been the wrong repair. Compose once. `worldOffset` is then left for its actual job: a room's own origin *within* world space — omitted entirely in the single-room case, and `p.sourceOffset` / `p.destinationOffset` during a §5.5 slide.

**Letterbox the contain fit (the rule the same build got wrong).** `mode: 'contain'` means part of the viewport is not the room, on every frame, on most aspect ratios. That area must be visually **not the level**: `applyCameraLetterbox(ctx, bounds, viewport, t, { fill })` (0.17.4) fills the bars outside the room frame and clips world rendering to it, so the backdrop cannot masquerade as playable space and the camera clamp cannot be mistaken for a bug. It returns the resolved `CameraLetterbox` (`frame`, `clip`, `bars`, `covered`) if you want to draw your own vignette or frame line; `cameraLetterbox(...)` is the pure geometry alone. Call it **before** the zoom is composed (the frame is already in screen units) and **before** the shake translate (the mask holds still while the world shakes inside it); the caller's `save`/`restore` owns the clip.

**The aperture is one room, never the slide's union (the rule this brief itself got wrong).** `presentationForRoomSlide(slide).bounds` is the camera's CLAMP SPACE while two rooms are on screen — roughly twice a room wide. Mask with it and the frame exceeds the viewport, so every bar vanishes for the length of the transition and the world spills across the entire window before snapping back; a real build shipped exactly that, on this brief's instructions. **The window the player looks through does not change during a slide: the rooms move, the window stays put.** Mask with the ROOM (interpolating source→destination if their sizes differ), clamp the brain with the union. And note the frame's POSITION cannot come from the slide camera either — that camera is sweeping through union space, so a camera-derived frame slides across the screen with it. During a slide, derive the frame from the room size and the viewport directly:

```ts
// The mask-selection rule — ONE branch covering both states, owned by
// recipes/room-slide-aperture.ts (copy it in): steady state masks with the
// ACTIVE room via applyCameraLetterbox; a slide masks with the engine's
// interpolated source→destination ONE-ROOM aperture via the recipe's
// applyRoomSlideApertureLetterbox — never the slide camera (it sweeps union
// space), never p.bounds (clamp space). The game never calls
// cameraApertureLetterbox itself; the recipe owns that math, so the symbol
// does not belong in the §1 import block either.
if (session.slide !== null) {
  applyRoomSlideApertureLetterbox(ctx, session.slide, viewport, t.zoom, { fill: '#070b18' });
} else {
  applyCameraLetterbox(ctx, active, viewport, t, { fill: '#070b18' });
}
```

Atmosphere/parallax may still animate *behind* the room — what it must not do is fill the margin with something that reads as level. (`applyCameraLetterbox` returns the resolved box when you want it: `box.covered` is true when the room fills the viewport — nothing letterboxed this frame — and `box.frame` is the room's screen rect, the anchor for a frame line or vignette.)

**DPR composition (the rule two showcase demos got wrong).** `resizeCanvasToBackingStore` multiplies the backing store by the device pixel ratio and **returns that ratio precisely so the caller composes it** — `ctx.scale(dpr, dpr)`, once, before the world transform. If the resize runs inside the render loop, re-apply the scale **every frame**: assigning `canvas.width`/`height` resets **ALL context state** — the transform *and* `imageSmoothingEnabled` (back to `true`, the canvas default). A build that sets smoothing once at boot silently re-blurs after its first window resize, and one that never sets it blurs every fractionally-scaled draw: the engine's tile/sprite/entity paths each guard their own smoothing, but anything you scale yourself (backdrops, minimaps, your own blits) inherits the caller state. **First line of every render: `ctx.imageSmoothingEnabled = false`.**

**Viewport units under DPR (the rule a real build got wrong next).** After the resize, `canvas.width`/`height` hold the **DPR-multiplied backing store** — on a Retina display, 2× the layout size. The viewport you hand `fitCameraZoom`, `updateCameraBrain`, and `cameraTransform` must be in **CSS pixels** (drawing runs under `ctx.scale(dpr, dpr)`, and `cameraTransform` does its own device-grid math via `devicePixelRatio`). Pass the backing-store size and the assumed viewport doubles — the zoom and framing come out wrong by the DPR factor, and at `dpr === 1` the two coincide, so the bug ships invisible on a standard display and detonates on the first high-DPI laptop. Use **`canvasCssViewport(canvas)`** (0.17.2) — the unit is in the name. Re-read it every render tick and on `resize`.

**The Celerock camera policy is the CELESTE LENS, and the engine ships it pre-derived (0.19.0).** `celesteCameraZoom(viewport)` fits a **constant 320×184 window** (`CELESTE_CAMERA_WINDOW`) with contain + integer scale — the zoom depends on the VIEWPORT only, never on any room, so it is campaign-constant and changes only on resize. A room larger than the window scrolls under it via the ordinary room-bounds clamp; a room exactly one screen (the shipped rooms are one-screen at time of writing) fills the window edge to edge. `fitCameraZoom(level, viewport, options?)` remains the **engine-owned** fit helper for the general case (`'contain'` / `'cover'` / `'native'` + `integerScale`), but **do NOT fit the room here**: `fitCameraZoom(room, …)` in EITHER mode sizes the lens to the room, so zoom tracks room size and every room is fully visible at its own scale — the exact framing a reference build shipped, read as "shows the whole level" where Celeste reads as "shows one screen", and then re-derived into the preset. `mode: 'cover'` (the engine default) additionally crops gameplay and is doubly wrong here. Do **not** hand-roll a `fitZoom` either way: call `celesteCameraZoom(viewport)` at every fit site (room view, reset, slide destination — see `roomEntrySlideView` below) and keep `imageSmoothingEnabled = false`. The intentional margin the constant window leaves on non-16:9 viewports is masked letterbox space (the rule above): bars over the backdrop plus a clip to the room frame; atmosphere/parallax animates behind the room, never as a stand-in for level in the margin.

> **Why whole-room containment was rejected (the reference build's evidence).** An earlier revision of this brief mandated `fitCameraZoom(room, viewport, { mode: 'contain' })` — the complete room visible at every aspect ratio. A reference build shipped exactly that, then measured it against the decompile and replaced it: the zoom VARIED WITH ROOM SIZE (a wide room zooms out, a tall one in), which Celeste never does, and the framing read as "shows the whole level" instead of "shows one screen". The preset is the correction, pre-derived: constant window (`celesteCameraZoom`), no-deadzone centered follow (`CELESTE_FOLLOW_CENTERED`) with the authored-offset 1/3-ahead X variant (`CELESTE_FOLLOW_AHEAD`), half-life 0.15 s with `devicePixelSnapThreshold` (`celesteFollowMotion`), 0.65 s easeOutCubic transitions (`CELESTE_ROOM_SLIDE_OPTIONS` → `beginSessionRoomSlide`), instant respawn snap (`snapCameraBrain`). Pass the same bands to `roomEntrySlideView` so a slide's destination framing is an equilibrium of the same body.

```ts
const zoom = celesteCameraZoom(viewport);   // CELEROCK POLICY — the constant 320×184 window, contain + integer scale
// Every fit site uses the SAME call — the zoom never varies with the room:
const resetZoom = celesteCameraZoom(canvasCssViewport(canvas));
// General helper (NOT the Celerock policy — fitting the room varies zoom with room size):
const wholeRoom = fitCameraZoom(room, viewport, { mode: 'contain' });   // rejected framing, shown for contrast
```

**Seamless fractional zoom — the canonical tile draw.** `drawLdtkLevel` blits every tile separately, so under a fractional `brain.zoom` (a contain-fit such as 4.5×, or the lens easing between rooms mid-§5.5-slide) some browser/GPU combinations expose a duplicated or empty scanline between adjacent tile rows — a hairline seam. The mid-slide lens ease is *guaranteed* fractional zoom, which is exactly the case the **surface cache** exists for: `createLdtkLevelSurfaceCache()` (shipped in `0.12.0`) returns a cache whose `draw(ctx, level, opts)` bakes the room's tiles verbatim through `drawLdtkLevel` into one `pxWid × pxHei` offscreen canvas on first use, then blits that single surface per frame — no internal draw boundaries for the compositor to split, at any zoom. `drop(iid)`/`clear()` rebake (after tile edits — §5.7's hot reload rebuilds the painter on every applied swap, since ANY room may have changed and the tileset defs live in the `.ldtk` too); in hosts with no canvas factory it silently falls back to the direct draw. **Use `painter.draw(...)` everywhere** (the §5.5 slide draws both rooms through it; §5.4's per-frame draw above is the painter); `drawLdtkLevel` remains the underlying baker, not the call-site renderer. Snapping fixes the **origin**; only an integral `zoom · dpr` maps the whole world grid onto device pixels — `cameraTransform`'s `pixelAligned` flag reports which case you are in, and `celesteCameraZoom` already fits contain + integer scale, so the Celerock lens is pixel-aligned at every viewport (the general lever remains `fitCameraZoom(..., { integerScale: true })` for custom windows).

### 5.5 Room transitions — seamless, momentum-preserving

Celerock renders one room at a time in **room-local coordinates**, so a room change must NOT blend a position captured in one room's local space into another's. The engine owns the whole path now — the simulation transition (pure helpers) and the presentation transition (the slide orchestrator) are composed into **ONE session state machine**. **Use the session orchestrator by name — `createRoomTransitionSession` / `pollRoomTransition` / `beginSessionRoomSlide` / `advanceSessionRoomSlide` / `endRoomTransitionSession`. Do not hand-roll per-tick exit polling, detector adoption, `if (!slide)` guards, or the enter/finish/cancel camera-space rebases — the session owns all of them:**

**Golden path — the session.** One session per traversing actor, created once at boot. The session holds `{ detector, slide }` as one immutable state machine, so the seam-transition invariants are structural: a second transition cannot begin while a slide is active (the poll returns `'suppressed-slide-active'`), the finish-rebase applies exactly once on completion, and every abnormal exit goes through one cancel-with-rebase path. **Store the RETURNED session from every call** — the session auto-adopts the detector, so you never hand-adopt it:

```ts
// One session per traversing actor — create once at boot:
let session = createRoomTransitionSession();
// Seam apron — once at boot, over the same room cache (§5.2). KEEP the cache
// handle: destructuring `.apronFor` alone discards drop()/clear(), and §5.7's
// hot reload MUST clear() it (memoized aprons are old-project geometry). The
// resolver reads `rooms` lazily at call time — which is why `rooms` is a `let`.
const apronCache = createSeamApronCache((iid) => rooms.get(iid));
const apronFor = apronCache.apronFor;

// per simulation tick — the ONLY transition poll:
const poll = pollRoomTransition(session, state.core, active.ldtkLevel, project);
session = poll.session;                       // auto-adopted detector state — never hand-adopt
if (poll.result.type === 'exit') {
  const exit = poll.result.exit;
  const target = rooms.get(exit.neighbourLevelIid);      // cached CompiledLdtkRoom (createLdtkRoomCache)
  const prevCore = state.core;   // source-local body — captured BEFORE the transition;
                                 // the candidate state below is destination-local
  // TRANSACTIONAL: compute every artifact first, commit NOTHING until the
  // slide begins. A refused begin (ok: false — slide already active, missing
  // rooms, or a non-finite viewport) must leave state/active/session/brain
  // exactly as they were — a state already jumped to destination-local
  // coordinates while the world is still the source room is precisely the
  // half-applied transition this pattern makes impossible.
  const entry = mapLdtkRoomEntry(state.core, active.ldtkLevel, target.ldtkLevel, exit);
  const candidateState = transitionPlatformerToRoom(state, entry, {
    destinationSolids: [...target.solids, ...apronFor(target.ldtkLevel.iid)], config,
  }).state;
  // 0.11.0: roomEntrySlideView computes the follow-compatible destination
  // framing (room-local room-px) — do NOT hardcode { x: 0, y: 0 }. Pass the
  // same follow bands/padding as the destination follow vcam (§5.4's preset).
  const destinationZoom = celesteCameraZoom(viewport);   // campaign-constant — never re-fit the room
  const destinationView = roomEntrySlideView(target, candidateState.core, viewport, destinationZoom,
    { followX: CELESTE_FOLLOW_AHEAD, followY: CELESTE_FOLLOW_CENTERED, padding: 0 });
  // Particle continuity: add slide.particleRebaseDelta ONCE to source-local particles.
  const begun = beginSessionRoomSlide(session, {
    source: active,
    destination: target,
    viewport,
    brain,
    destinationView,
    actor: { sourceLocal: { x: prevCore.x, y: prevCore.y }, destinationLocal: { x: entry.x, y: entry.y } },
  }, { ...CELESTE_ROOM_SLIDE_OPTIONS, reducedMotion: prefersReducedMotion() });   // 0.65 s easeOutCubic — the Celeste transition
  if (begun.ok) {
    // COMMIT — one synchronous block, only on success:
    state = candidateState;                   // destination-local, same tick as the room swap
    session = begun.session;                  // slide now active — session owns detector + slide together
    brain = begun.brain;                      // ALREADY rebased INTO slide space (the enter-rebase is applied here)
    camShift.x += begun.cameraRebaseDelta.x;  // the rebase the WORLD render compensates for — a raw-camera
    camShift.y += begun.cameraRebaseDelta.y;  // consumer (parallax) subtracts it instead (rule below)
    // Particle continuity: apply the slide's particleRebaseDelta ONCE, HERE,
    // to the still-source-local particles (your §9 arrays — trail, dust).
    // The render below reads them as already rebased; this line is what
    // makes that true.
    const rebase = begun.session.slide?.particleRebaseDelta ?? { x: 0, y: 0 };
    particles = particles.map((p) => ({ ...p, x: p.x + rebase.x, y: p.y + rebase.y }));
    active = target;
  }
  // A refused begin (ok: false — slide already active, missing rooms, or a
  // non-finite viewport) returns session + brain unchanged — and, because
  // nothing outside the ok-branch was assigned, state/active too: drop the
  // poll result and stay in the source room. For real.
}
// While a slide is active the poll returns 'suppressed-slide-active' — no
// `if (!slide)` guard needed (a second transition mid-slide is impossible).

// per presentation tick — the session advances ONLY the clock; you still drive
// the slide camera (read session.slide → presentationForRoomSlide → your own
// updateCameraBrain with the viewport/targets):
const advanced = advanceSessionRoomSlide(session, dt, brain);
session = advanced.session;
brain = advanced.brain;
camShift.x += advanced.cameraRebaseDelta.x;   // nonzero ONLY on the completing tick (the finish-rebase)
camShift.y += advanced.cameraRebaseDelta.y;
if (session.slide !== null) {
  const p = presentationForRoomSlide(session.slide);
  brain = updateCameraBrain(brain, { vcams: [p.vcam!], targets: { player: state.core }, bounds: p.bounds,
                                    viewport, activeId: ROOM_SLIDE_VCAM_ID, dt });
  // RENDER, all of it INSIDE the §5.4 composeCameraTransform (the slide camera
  // is in SLIDE space and the world transform is the same one call). The MASK
  // is the one-room aperture for this tick — applyRoomSlideApertureLetterbox
  // from recipes/room-slide-aperture.ts, per §5.4's mask-selection rule —
  // NEVER p.bounds (that union is clamp space). worldOffset then carries ONLY
  // each room's origin in slide space:
//   painter.draw(ctx, src.ldtkLevel,  { worldOffset: p.sourceOffset });
//   painter.draw(ctx, dest.ldtkLevel, { worldOffset: p.destinationOffset });
  // Adding the camera offset here as well is double-counting; OMITTING the camera
  // transform and drawing at p.sourceOffset alone pins the view to the union's
  // top-left for the whole slide (the rooms sit still, then snap when it ends).
  // draw EACH room's entities (§7.1) under that SAME offset — drawLevelEntity has no
  // worldOffset param, so ctx.translate(p.sourceOffset) / (p.destinationOffset) around
  // each room's entity loop, or the entities detach from their tiles mid-slide.
  // draw the player at (p.destinationOffset + destinationLocal + p.playerOffset)
  // and the (already-rebased) particles at (p.destinationOffset + particle) — same
  // slide space, same transform, one rule.
}
// advanced.done === (session.slide === null): the FINISH rebase
// (finishRoomSlideCameraSpace) was applied exactly once on the completing
// advance — the destination room vcam takes over from the exact final view.

// on death / retry / teleport / reset — mid-slide or not:
const ended = endRoomTransitionSession(session, brain, 'destination');
session = ended.session;                      // FRESH idle session — the "reset the detector on respawn" discipline is owned here
brain = ended.brain;                          // cancel-with-rebase applied first if a slide was active (no slide-space leak)
camShift.x += ended.cameraRebaseDelta.x;      // a death MID-SLIDE still changes camera space — compensate it too
camShift.y += ended.cameraRebaseDelta.y;
```

**Screen-continuous consumers subtract the accumulated rebase (the parallax rule).** Every session boundary changes the brain camera's COORDINATE SPACE by an instant offset — enter at begin, finish on the completing advance, cancel at `endRoomTransitionSession`. The world render compensates by construction (each room is drawn at its slide-space offset), so nothing in-world pops; but anything fed the RAW `brain.camera` — a parallax backdrop is the canonical one — teleports by the rebase distance at the seam while the world holds still. Those three functions each report exactly what they applied as `cameraRebaseDelta` (zero when no rebase happened — refusal, active ticks, idle calls), so the fix is one accumulator: add every delta to `camShift` (as the loop above does) and feed raw-camera consumers `brain.camera − camShift`. A real build hand-diffed the brain before and after both calls to derive the same numbers; the reported delta is that diff, owned where the rebase is. In-room camera motion passes through untouched — only the space jumps are removed, the eased slide pan included.

**Per-axis containment (0.15.0 `detectLdtkRoomExit` behavior — intrinsic to the session):** an exit additionally requires the body to have been fully contained ONCE on that exit's **crossing axis** in the current room (`e`/`w` → X, `n`/`s` → Y). The orthogonal axis is NOT gated — a diagonal exit taken straight off an arrival still fires, so the actor never has to settle inside a room before it can leave. Straddle suppression is intrinsic and reset-immune: the latch re-derives from body geometry on every poll, so even a discarded or freshly created detector state cannot tick-tock (the Celerock-1 death loop is structurally impossible). A body that never becomes contained on an axis (larger than the room on that axis) has that axis's exits suppressed only until it fully departs the room; a body that no longer overlaps the room at all skips the axis gate, so genuine reverse crossings and void departures stay reportable.

**The seam apron (0.18.0) — the floor exists, so nothing downstream has to correct.** The per-tick `solids` array (§5.3) MUST carry the apron line, and the transition above passes `destinationSolids` with the destination's own apron included — a straddling arrival sits at negative destination-local X, still standing on the source's rebased floor. With that, the walkway is continuous in the simulation exactly as it is in the authored world, and the kernel's own collision resolution lands every crossing flush at any fall speed. The corollaries are rules, not suggestions: **no diagnostic nets, no widened seam ledges, no post-hoc entry clamps** — a fix parameterised by a tuned constant tracks a symptom whose magnitude varies with fall speed, and past one floor-thickness per tick no corrector can tell "snap up" from "legitimately fell". `protectGroundedRoomSlide` is **removed** in 0.18.0: it clamped grounded actors to their support span and zeroed `vx`/`vy` to compensate for exactly the missing floor the apron now supplies — a build that carries a local fallback copy (e.g. an `engine.protectGroundedRoomSlide?.(…) ?? localFallback(…)` shim) must **delete the fallback too**, or the momentum cancellation survives the export's removal silently. `stabilizePlatformerRoomEntry` remains, small on purpose: the 1px float-noise guard at the mapping boundary, not a repair for real physics. Apron solid ids are namespaced `apron:<levelIid>:<originalId>` — run `seamApronSourceFromSolidId` before any entity-id lookup (springs, dash-refills). Hazards deliberately do not ride the apron: across the straddle window floors continue and spikes do not, because at a seam failing to kill is the safe direction — a decision pinned by engine test, revisit only with a case where it reads as a bug in play.

**Composition layer.** Below the session sit the pure primitives it composes — `findLdtkRoomExit` (seam-span-gated cardinal crossing; a crossing outside the shared span is void, not a transition), `mapLdtkRoomEntry` (momentum-preserving, un-clamped destination-local entry), `transitionPlatformerToRoom` (`'seam-entry'` provenance; preserves `vx`/`vy`/`facing` + ability/locomotion slices, clears events/interactions/moments, revalidates support, NEVER settles), and `rebasePointBetweenLdtkRooms` (particle/dust continuity). A caller driving them directly owns the session's invariants itself — transactional detector adoption, never a mid-slide begin, cancel/finish-with-rebase on every exit path. The session path above is the golden route.

Falling out of the level with no cardinal neighbour (the void) is a respawn, not a transition — and a crossing that leaves through a NON-shared span (a partial seam's void edge) is also void: the poll returns `'idle'` (no exit) and you respawn.

> The public golden-path APIs replace the old "read the showcase" reference: `loadLdtkProjectAssets` (§5.1), `inspectLdtkPlatformerProject` (preflight), `compileLdtkRoom` / `createLdtkRoomCache` (§5.2), the **room-transition session** (`createRoomTransitionSession` → `pollRoomTransition` → `mapLdtkRoomEntry` → `transitionPlatformerToRoom` → `beginSessionRoomSlide` → `advanceSessionRoomSlide` → `endRoomTransitionSession`; §5.5), and the Celeste camera preset (`celesteCameraZoom` + `celesteFollowVcam` + `CELESTE_ROOM_SLIDE_OPTIONS`) above. (No `showcase/` or `src/…` path is published in the npm package — the `files` whitelist ships only `dist/`, `recipes/`, `README.md`, and `LICENSE` — so do not reference any as a consumer resource; `recipes/` IS shipped, which is exactly what §1's copy-from-the-installed-package rule depends on.)

### 5.6 What the LDtk contains (the shipped pack, and the general contract)

Because Celerock trusts the LDtk, the file is the design. **`celerock.ldtk` (§1.1) satisfies all of the below** — the structure is stated here so the code reads the file rather than assuming it, and so a user-substituted `.ldtk` has a target to hit:

- **≥1 level** (more rooms = a longer climb). Multi-level projects are navigated via `__neighbours`. *At time of writing: one west→east chain — the count is living.*
- An **IntGrid collision layer** with named values for `'solid'` (and optionally `'passthrough'`, `'ladder'`). *Shipped: `IntGrid_Layer`, one value — `1: walls` — so everything solid is full collision; no one-ways, no ladders.*
- **Tile / AutoLayer layers** referencing the tileset for the visual. *Shipped: the walls are `autoLayerTiles` baked onto the IntGrid layer, plus a `Tiles_Decoration` layer — the surface cache bakes both (via `drawLdtkLevel`); do not assume art lives only on the Tiles layer.*
- **Entity layers**: at least one `Player`/`Spawn`; `Coin`/`Gem`/`Diamond` strawberries; `Spike`/`Hazard` hazards; optionally `MovingPlatform`, `Spring`, `DashRefill`, `Enemy`, and custom triggers such as `FallingBlock` (§6.1 — unknown identifiers ride the trigger fallback with their fields as `props.fields`). *At time of writing: 1 `Player` plus a handful of `Gem`/`Spike` instances — the live counts come from the preflight. Defs exist for `Spring`/`DashRefill` with no instances.*
- **`__neighbours`** links between levels you intend to flow between. *Shipped: every room links to its cardinal neighbours; no room is orphaned.*
- **`Player.png`** — the 160×128 (10×8 grid of 16×16) player sprite sheet the runtime loads at boot (§4.4). A missing/failed load degrades gracefully to the procedural body, but the canonical build ships it.
- **`Player.json`** — the sheet's animation definition, the §4.4 **source of truth** (grid, clip tags, pacing, one-shots, `characters[]`), fetched at boot alongside the PNG with the same graceful-degrade rule.

**Only the start room has an authored spawn** — every other room is entered across a seam, and the preflight warns about each (`spawnLessRoomIids`, one entry per spawn-less room, however many that is). The warning is expected and correct here, not a fault to repair: a spawn-less room is reachable by traversal and its death-respawn anchor is its seam-entry point (§8). Treat only a project with *zero* spawns as a hard block.

A level with no hazards cannot kill — a design choice in the LDtk, not a failure of the runtime. Completion is never a content question: the terminal room (§1.1's world contract) makes every connected chain completable.

### 5.7 LDtk hot reload (dev-time — STANDARD scope, not a stretch goal)

Editing the level while playing it is the primary level-design loop for this brief, so it ships in every build. Under `npm run dev`, saving `public/celerock.ldtk` (any `public/*.ldtk`) swaps the edited world into the LIVE game within ~1 s — active room recompiled **by LDtk `iid`**, surface-cache bake invalidated, hazards/collectibles refreshed (entity art rides the recompiled room's own `entityArt` — nothing to rebuild, §7.1) — while the live player state, the save, the death counter, and the FSM are preserved verbatim. No page reload, no respawn, no menu bounce. An invalid edit, a truncated file, or a deleted active room leaves the playable world **100% untouched** with a surfaced error. Every symbol here is already in the §1 import block.

**1. `vite.config.ts` — the watcher plugin.** Vite does not put `public/` assets through HMR (they sit outside the module graph), so notify the game yourself over the dev-server websocket. Extend the template's `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { createLdtkHotReloadPlugin } from './src/recipes/ldtk-hot-reload-plugin'; // engine repo recipes/

export default defineConfig({
  // The watcher plugin is recipes/ldtk-hot-reload-plugin.ts — copy it in, do not
  // re-type it: it adds public/ to the dev-server watcher and forwards every
  // saved .ldtk to the client as the 'ldtk:update' websocket event
  // (LDTK_HOT_RELOAD_EVENT). apply: 'serve' keeps it out of build/preview.
  plugins: [createLdtkHotReloadPlugin()],
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
  // (a) Re-load through the SAME §5.1 path, cache-busted via the loader's
  //     injectable `fetch` (never a hand-built `?t=` URL). Bust .ldtk only.
  const bustingFetch: typeof fetch = (input, init) => {
    const url = String(input);
    return fetch(url.endsWith('.ldtk') ? `${url}?g=${generation}` : url, init);
  };
  const result = await loadLdtkProjectAssets({ projectUrl: PROJECT_URL, fetch: bustingFetch });
  if (generation !== ldtkGeneration) return;        // a newer save superseded this one — discard

  // (b) Transaction: build the ENTIRE replacement world, commit NOTHING until
  //     every step succeeds — the live world stays exactly as it was.
  const reject = (reason: string) => {
    console.error(`[ldtk] hot reload rejected: ${reason}`);
    showDevErrorToast(reason);                      // consumer-owned: drawTextOutlined, dismisses after N fixed ticks (never Date.now)
  };
  if (!result.ok) return reject('load/parse failed — see diagnostics');
  const nextProject = result.project;
  const nextRooms = createLdtkRoomCache(nextProject, ROOM_CACHE_OPTIONS);   // §5.2's one-const options
  // Validate the WHOLE replacement world, severity-aware. Force-compile every
  // room (the cache is lazy — get() compiles on first touch) and reject on
  // any severity === 'error' diagnostic ('error' is reserved for future hard
  // failures, so this is future-proof); WARNINGS are surfaced, never rejected
  // — a warning-level note must not cost the designer their live edit loop.
  // Zero spawns anywhere is the same hard block boot applies.
  const nextReport = inspectLdtkPlatformerProject(nextProject);
  if (nextReport.totalSpawns < 1) return reject('project has no Player/Spawn entity anywhere');
  for (const level of nextProject.levels) {
    const room = nextRooms.get(level.iid);                    // every level of THIS project — never throws
    const errors = room.diagnostics.filter((d) => d.severity === 'error');
    if (errors.length > 0) {
      return reject(`room '${level.identifier}' has ${errors.length} error diagnostic(s): ${errors[0].message}`);
    }
    const warnings = room.diagnostics.filter((d) => d.severity !== 'error');
    if (warnings.length > 0) console.warn(`[ldtk] '${level.identifier}': ${warnings.length} warning(s)`, warnings);
  }
  if (!nextRooms.has(active.ldtkLevel.iid)) {                                 // has(), not get() — get() throws
    return reject(`active room '${active.ldtkLevel.identifier}' no longer exists (iid ${active.ldtkLevel.iid})`);
  }
  const nextActive = nextRooms.get(active.ldtkLevel.iid);

  // (c) Commit — every live reference reassigned in ONE synchronous block, so
  //     no step or render can observe a half-swapped world:
  project = nextProject; rooms = nextRooms; active = nextActive;
  tilesets = result.tilesets;                        // the fresh bundle from the reload
  painter = createLdtkRoomPainter(tilesets);         // a fresh painter IS an empty cache (any room may have changed;
                                                     // the tileset defs live in the .ldtk and may have changed too)
  apronCache.clear();                                // memoized aprons are OLD-project geometry — stale floors in
                                                     // the tick set until cleared (the resolver reads the NEW rooms lazily)
  terminalRoomIid = deriveTerminalRoomIid(project);  // §1.1/§8 — re-derive, never hardcode
  rebuildRoomVcam(active);                           // new bounds (the zoom is campaign-constant; a zoom snap is fine in dev)
  hazardRects = active.hazards.map(h => h.rect);     // §6
  // §7.1 needs NO rebuild line: entity art rides the recompiled room
  // (`nextActive.entityArt`), so the reference swap above is the whole story.
  console.log('[ldtk] hot reload applied', inspectLdtkPlatformerProject(nextProject).capabilities);
  // Player `state`/`save`/`gameState`/menu/audio/particles: UNTOUCHED. New
  // springs/dash-refills light up free (buckets come off the room, §5.2); save
  // is keyed by iid (§7) so surviving ids stay collected.

  // (d) Embedded-body recovery: settle through `settlePlatformerState` (§5.2);
  //     if the body cannot ground, fall back to the §8 respawn anchor.
  if (playerOverlapsAnySolid(state.core, active.solids)) {         // a §6-style aabbOverlap loop
    const settled = settlePlatformerState(state, active.solids, config);
    state = settled.settled ? settled.state : respawnAtRoomAnchor();
  }
}
```

**Rules the swap MUST hold** (they are what make hot reload safe to standardize):

- **Swap-atomic + fully transactional.** All live references reassign in ONE synchronous block; rejection at ANY stage commits nothing — same `project`, `rooms`, `active`, and surface-cache bakes (reference identity). The playable world is the error boundary; surface the reason; never `location.reload()` (§12.8). The pending flag polls in the fixed step, so a mid-slide save defers to the slide's completion.
- **Fresh cache per reload.** `createLdtkRoomCache` is identity-stable over ONE project — never splice rooms across projects/caches; rebuild with the identical `ROOM_CACHE_OPTIONS` (§5.2).
- **Player state preserved verbatim — that preservation is the point.** `x`/`y`/`vx`/`vy`/`facing`/stamina/dashes survive mid-jump; a swap never writes the save, increments deaths, or touches the FSM. LDtk iids are stable across edits of the same room — that is what makes recompile-by-iid possible.
- **Scope: `.ldtk` only.** `celerock.png`/`Player.png`/`Player.json` are not hot-swapped (decoded images and the compiled sheet live outside this path) — manual refresh; say so in the report rather than half-supporting it.

---

## 6. Hazards

Hazards are LDtk entities (`Spike`/`Hazard`→`hazard`, `Trap`→`trap`); the engine does not ship a first-class hazard module. Wrap a player-state AABB check:

- **Static spikes.** At boot, collect hazard entity rects into `hazardRects: Rect[]`. Each tick, check `aabbOverlap(playerRect, hazardRect)` — if true (and the player is moving into the hazard, e.g. `state.core.vy > 0` for floor spikes, or freshly landed over a hazard), trigger death.
- **Moving spike rows** (a `MovingPlatform` carrying a hazard child — and ONLY those: **a plain platform is never itself lethal**; a real build fed every platform rect into the hazard list, so standing on one killed the rider). Split at room entry — an authored hazard rect overlapping a platform's authored rect RIDES that platform, everything else is static:
  ```ts
  const split = splitRidingHazards(room.hazards, room.compiled.movingPlatforms);
  // staticRects never move; each rider is re-derived per tick from its carrier's
  // CURRENT position (do NOT re-resolve the platform's motion — advanceMovingPlatform
  // owns it; just read plat.x/plat.y):
  const hazardRects = [...split.staticRects, ...ridingHazardRects(split.riding)];
  ```

Death effect: `hitStop = triggerHitStop(hitStop, 6)`; advance `hitStop = stepHitStop(hitStop, 1)` per fixed tick; transition the FSM to `gameover`.

**§6 covers COLLISION only — spikes RENDER through the §7.1 entity-art rule** (the authored `Spike` tile from `celerock.png`, repeat-tiled across each resized instance). Any instance larger than its `8×8` tile — the pack carries strips such as `40×8` at time of writing — must repeat-tile, never stretch (a stretched blit is visibly wrong); do not draw a flat red box and do not draw a procedural polygon.

**The signature Celeste beat — dash-into-wall.** The dash terminates on contact with a solid (the kernel never phases through). On the tick a dash contacts a wall, fire `triggerHitStop` + `sineShake`. Narrow the ability-state union before reading its timer:

```ts
const dash = state.abilities.dash;
const dashing = dash?.kind === 'dash' && dash.timer > 0;
```

### 6.1 Falling blocks (capability-gated — the engine owns the machine)

The Celeste prologue-style ceiling block is **engine-owned since 0.20.0**: a pure state machine (`collectFallingBlocks` → `advanceFallingBlocks` → `fallingBlockSolids`) with the constants decompiled from Celeste — arms while the player is under ANY part of the footprint (X-only overlap, so walking the corridor beneath OR standing on the block's back arms it), shakes 0.2 s, then a grace window of up to 0.4 s that keeps extending while the player stays under (once the shake starts the fall is committed; the window only delays it), falls at accel 500 px/s² to a 160 px/s cap, and lands FLUSH on the first support below — statics AND landed blocks (they stack). The game owns the tick, the solids list, and the consequences.

**Authoring:** a `FallingBlock` entity in the `.ldtk` (any casing — the trigger fallback preserves the identifier as `props.action`), sized like a block strip (e.g. 16×16 or 32×16), with an optional integer `tiletype` field naming the IntGrid material its art paints with (default 1 = walls). **The shipped pack has none placed** (like springs/dash-refills: wire the path, mark it not exercised, never edit the `.ldtk` to make it fire) — a substituted `.ldtk` that carries them lights the path up free. Discover them at boot via `report.unknownTriggerIdentifiers` containing `'FallingBlock'`, or simply wire unconditionally — `collectFallingBlocks` on a room with no blocks returns `[]` and costs nothing.

```ts
// At room compile (boot + §5.7 hot reload + room transition IN) — the tuning
// rescales for non-8px rooms (distances/velocities/accelerations scale, times never):
const tuning = scaleFallingBlockTuning(FALLING_BLOCK_TUNING, active.levelData.tileSize);
let blocks = collectFallingBlocks(active.levelData, { tuning });   // [] when the room has none

// Per fixed tick — advance, then carry the blocks' CURRENT rects in the solids
// set (every phase but 'gone' is solid, including mid-fall):
const step = advanceFallingBlocks(blocks, state.core, active.solids, active.levelData.height, dt, tuning);
blocks = step.blocks;
for (const b of step.events.armed)    /* playTone creak + small shake — the warning */;
for (const b of step.events.released) /* playNoise woosh — committed */;
for (const b of step.events.landed)   /* hard-landing thud + dust burst at the landing y */;
for (const b of step.events.crushed)  /* the player dies — the §6 death path, not a new one */;
const solids = [...active.solids, ...apronFor(active.ldtkLevel.iid), ...fallingBlockSolids(blocks)];
// Render: terrain-like blocks get TERRAIN-LIKE art — recipes/ldtk-entity-tile-art.ts
// (bakeLdtkEntityTileArt) stamps the block's footprint into the room's REAL
// IntGrid and bakes the project's own auto-rules IN-CONTEXT (the ceiling it
// hangs from, the floor it will land on), so the falling block wears the
// level's material instead of a placeholder rectangle. Bake once per room
// entry (the `tiletype` field is the IntGrid value), drawImage the baked
// canvas at the block's CURRENT y each frame; a subtle ±1px shake offset
// during 'shaking' reads as the warning. The recipe degrades to undefined on
// any failure — THEN a readable solid-colour slab, never a throw.
```

**Reset discipline:** re-collect on every room change and every §5.7 hot-reload swap (`collectFallingBlocks` over the fresh `levelData`); blocks are room-local state, not save state. `landed` and `gone` are terminal for a given room visit — a respawn re-arms the room's blocks exactly as a re-entry does.

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
  if (collected.length > 0) {
    // ACCUMULATE first, persist ONCE. collect() clones the save you HAND it —
    // re-passing the original roomSave snapshot every iteration drops every
    // gem but the last on a same-tick double pickup, and a writeSave inside
    // the loop persists the loser.
    let nextRoomSave = roomSave;
    for (const id of collected) {
      nextRoomSave = collect(nextRoomSave, String(id));
      // ping + sparkle particles
    }
    save = { ...save, collectibles: { ...save.collectibles, [roomId]: nextRoomSave } };
    writeSave(storage, save);
  }
  ```

- **Death counter.** On every `gameover → playing` respawn, `save = { ...save, deaths: save.deaths + 1 }`, then `writeSave`. Same storage adapter as the strawberries.
- **Render — and make the TILE disappear, not just the glow.** The dressed-entity render list is exactly `[...active.hazards, ...remaining]` through `drawLevelEntity` + the §7.1 override (§7.1's per-frame loop) — `remaining` already excludes collected gems. **The gem-ghost trap:** iterating the raw `ldtkLevel.layerInstances` and drawing every `__tile` instance — the tempting shortcut, and what a real build did — draws collected gems forever, because collection lives in the save, not in the LDtk file; that build filtered only its `drawGlow` halo and left every collected gem's tile on screen. `drawGlow` is an additive halo *behind* the tile, never the body. Do **not** draw a procedural diamond outline: the LDtk dressed this entity, and §7.1 says the art wins.

### 7.1 Entity art — the LDtk tile IS the sprite (general rule)

An LDtk entity def may assign a display tile (`tileRect` on the def, resolved to `__tile` on every instance). **When it does, that tile IS the entity's sprite — blit it.** When it does not, let the engine draw its built-in shape. **Never invent procedural art for an entity the LDtk already dressed** — that is the same failure as recoloring the tileset (§12.8), one scope down.

In the shipped pack: **`Gem` and `Spike` have tiles** (both from `celerock.png`, tileset uid 43); `Player` (drawn from `Player.png`, §4.4), `Spring`, and `DashRefill` do not.

| Entity def | `tileRect` | LDtk `tileRenderMode` | Renders as |
|---|---|---|---|
| `Gem` | `{ x:888, y:672, w:8, h:8 }` | `FitInside` | the authored tile, one blit |
| `Spike` | `{ x:992, y:688, w:8, h:8 }` | `Repeat` | the authored tile, **tiled** across each resized instance |
| `Player` / `Spring` / `DashRefill` | `null` | — | the engine's `DEFAULT_ENTITY_PALETTE` shape |

**The engine supplies the join (0.19.0 — the `entityArt` side channel).** `ldtkLevelToLevelData` returns the authored art next to `tileSemantics`, and `compileLdtkRoom` carries it onto the room as **`room.entityArt: ReadonlyMap<EntityId, LdtkEntityArt>`**, keyed by the entity's ENGINE id and holding `{ tile, tileRenderMode, nineSliceBorders }` — everything `drawLdtkEntityTile` takes. The map is built INSIDE the translate loop that assigns those ids, so the association cannot mis-align: every key IS one of that room's translated entity ids, an entity without an authored `__tile` simply has no key, and the art travels WITH the room — a §5.5 slide draws two rooms and each resolves from its own map by construction. This retires the consumer-side rect-key index entirely, and with it both of its shipped failure modes: a single active-room index left the outgoing room's spikes flashing `DEFAULT_ENTITY_PALETTE` red for the length of every slide, and because rect keys are room-LOCAL, two rooms with an entity at the same local rect silently resolved each other's tiles rather than missing. (The old recipe also warned against joining by `LevelEntity.id` because a consumer re-walking the raw layer cannot reproduce the engine's id assignment — the side channel is exactly that warning, resolved by making the engine, which holds both sides at translate time, do the join.)

**The render mode is authoritative (0.16.0).** The parser preserves the def's `tileRenderMode` (`Gem` = `FitInside`, `Spike` = `Repeat`), and the engine's `drawLdtkEntityTile` implements it. **Never derive fit-vs-repeat from rect geometry** — a `Stretch` or `Cover` def exists in the wild, and geometry-derived tiling renders the author's intent wrong.

```ts
// The join is ENGINE-OWNED: room.entityArt, keyed by the entity's engine id.
// The override map that routes every drawn kind through it is
// recipes/ldtk-entity-art.ts (engine repo) — copy it in; no index to build,
// memoize, rebuild on transition, or clear on hot reload. Rebuild the map per
// active room (a recompiled room arrives with its own fresh entityArt):
const overrides: DrawLevelEntityOverrideMap = ldtkEntityTileOverride(active, tilesets);
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
  - **Selection runs through the engine's menu navigation (0.20.0) — do not hand-roll a `menuSelection` counter.** `createMenuNav()` at boot; per tick `advanceMenuNav(menu, { up: edges['up'], down: edges['down'], confirm: mergeEdges(edges['jump'], edges['dash'], edges['grab']) }, visibleEntryCount)` — the wrapped index, the open-grace window (the key that confirmed "NEW GAME" cannot instantly re-confirm), and same-frame nav+confirm (confirms the entry you moved TO) are all engine-owned. `clampMenuNavIndex` after RESUME hides/reveals. **A jump/dash/grab edge confirms** — `C`, `X`, and `Z` all confirm on the keyboard (the same merged edge), and gamepad A and the touch jump button join it via `mergeEdges`. (There is no Enter/Space mapping in the Celeste key set — do not add one.)
  - **Run the menu step BEFORE the sim** each tick, so the kernel runs on the very tick the player starts; on confirm fire the FSM `start` and trigger the start room's title card. The HUD stays hidden while in `menu` — the menu owns the screen, and the save numbers would spoil RESUME.
  - **Render:** title + the entries in a left-aligned column (the `>` marker never shifts the label); the selected entry bright with a `>` marker, the rest dimmed (`drawTextOutlined`).
- `playing → gameover` via `{ type: 'die' }` on a hazard.
- `gameover → playing` via `{ type: 'retry' }` after a consumer-owned 12-tick respawn flash. **Respawn anchor, in priority order: (1) the last checkpoint, (2) the current room's authored spawn, (3) the point at which the player entered the current room across its seam.** Rule (3) is not a fallback curiosity — it is the normal case for every room without an authored spawn (§5.6), and it is Celeste's own model: you restart at the edge you came in through, not back at the start of the chapter. Store the arrival position AND facing when `transitionPlatformerToRoom` resolves (`spawn.source === 'seam-entry'`) and keep them as the room's respawn anchor for as long as that room is active; respawn with zeroed velocity and the entry `facing` — `createPlatformerState(anchor.x, anchor.y, config, w, h, anchor.facing)` (the `facing` parameter is 0.22.0; before it, spread `{ ...state, core: { ...core, facing } }` — a real build rebuilt with the default and every leftward entry respawned facing right, into the wall it came through; §12.1b catches it). A room with none of the three (never entered, no spawn) is unreachable and cannot be respawned into — that is a hard block, not a runtime state. **The respawn anchor is the only part of this the game owns:** the transition layer's own reset goes through `endRoomTransitionSession(session, brain, 'destination')` (§5.5), which returns a fresh detector and rebases the camera out of slide space if the death landed mid-slide. Call it on every `playing → gameover`, then respawn at the anchor — do not hand-reset the detector or the brain.
- **`playing → paused` via `{ type: 'pause' }`, and the pause menu is a first-class screen (not a P-key hack).** The reference build treats pause as its own small game — frozen world, dimmed, three entries — and this brief requires the same:
  - **Open on the `pause` action edge** — `Escape` (in `CELESTE_KEYBOARD_MAP` since §4.3), gamepad **Start** (via `extendGamepadMap(STANDARD_GAMEPAD_PLATFORMER_MAP, { buttonToAction: { '9': 'pause' } })` — the standard map is frozen, extend it, never copy it), and a touch ⏸ button. Opening while a §5.5 slide is active is legal — the slide clock keeps advancing (it is presentation, not simulation) and the sim freezes under it.
  - **Freeze the SIM, not the clock.** In `paused`, feed the kernel `IDLE_EDGE`-neutral input (the §8 levelComplete pattern) or skip `stepPlatformer` entirely — either way the player cannot move, and `render` keeps drawing the SAME frozen world frame under a dim overlay (`fillRect` at ~0.6 alpha over the composed frame, before the menu text). Do NOT keep simulating with live input behind the card.
  - **Mute on open, restore on close.** `audio.setMuted(true)` when the menu opens, `false` when it closes — the pause menu is where players expect silence. (Keep the wall-slide loop handle alive; it stops naturally with the frozen sim.)
  - **Three entries — RESUME / RETRY / QUIT — driven by a SECOND `createMenuNav`** (a fresh one per open, so the grace window re-arms and the opener's Start/Esc cannot instantly confirm). Confirm edges: RESUME → `{ type: 'resume' }` (`paused → playing`); RETRY → **resume to `playing` FIRST, then run the §8 death/respawn path on the next tick** (the respawn/kill logic guards on `playing`, and a `paused → playing` transition followed immediately by a `playing → gameover` on the same tick is two reductions — legal, but the two-step reads clearer and avoids the guard entirely); QUIT → `{ type: 'quit' }` (`paused → menu` — note this transition is ONLY legal from `paused`, never from `playing`).
  - **Render:** `PAUSED` title + the entries with the `>` marker on the selected one (`drawTextOutlined`, same style as the start menu). **Behind the dim, NOTHING animates** — the sim, the wind, the particles, and the backdrop's animated layers all freeze (advance no decorative clocks while `paused`); only the pause menu's own UI (the marker's blink) may move. The freeze is the point: a world that keeps drifting behind the card reads as a soft crash, and so does a world that freezes everything except one accidental layer.
- **Chapter complete — terminal-room rule (§5.5 world contract, §12.7 #15), CORE.** The **terminal room** is the level with no `e` neighbour in `__neighbours`, derived from the project at boot — never hardcode the identifier, and warn loudly if more than one candidate exists (§1.1 asserts uniqueness). On seam-entry into the terminal room, fire `{ type: 'win' }` → **`levelComplete`** and show the chapter-complete card (`drawTextOutlined`, `easeOutBack` via `createTweenState`). No `Goal` entity is created and the `.ldtk` is never edited; the same `win` path serves a substituted `.ldtk` that DOES define a `Goal`/`Exit` entity. **`levelComplete` is the FSM state, and it is what makes the ending an ending — the run is over, so the player stops driving:**
  - **Feed the kernel a NEUTRAL input** (`moveX: 0`, `moveY: 0`, `jump`/`dash`/`grab` = `IDLE_EDGE`) rather than skipping `stepPlatformer`. Arrivals are airborne as often as not: freezing the sim strands the player mid-stride in the air, while a neutral step lets them fall, land, kick up the landing dust, and settle. **Do not gate the sim on `current === 'playing'` and call it done** — that is the frozen-mid-air ending.
  - **Nothing can undo the ending.** Hazard checks, the void/out-of-room respawn, and the room-transition poll are all part of being playable: skip them in `levelComplete`, or the player dies on a spike under the victory card, or drifts back across the seam they arrived through and un-completes the chapter.
  - **The card owns the only way out, and must say so.** Input is locked, so a card with no stated exit is a dead end that needs a page reload — the worst possible last impression. Hold the card for a grace window (~90 ticks) so the jump that finished the climb cannot skip its own reward, then show the prompt and accept a jump/dash/grab edge as `{ type: 'quit' }` → `menu`.
  - The camera brain and the sprite clock keep running. That is deliberate: it is where a **celebration animation** slots in later (a held pose or a dedicated clip driven off a summit tick counter) without any of the above changing.

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
- [ ] **Camera = the Celeste preset** (`celesteFollowVcam` + `celesteCameraZoom`) — campaign-constant zoom fitted to the 320×184 window, no-deadzone centered Y, 1/3-ahead X, half-life 0.15 s, no jitter; the room-bounds clamp scrolls any larger room under the fixed window; atmosphere/parallax fills the intentional letterbox area (masked, §5.4).
- [ ] **Room transition is a SLIDE** (G5) — **0.65 s easeOutCubic** (`CELESTE_ROOM_SLIDE_OPTIONS` spread into `beginSessionRoomSlide` — the decompiled Celeste transition), both rooms render, continuous screen position at the seam, momentum + particles carried across; reduced-motion uses an immediate seam-aligned cut.
- [ ] Air control during jump (the kernel's `airAccelMultiplier`).
- [ ] **Feel effects via `recipes/feel-effects.ts` (copy-in) over the engine's tuned presets** — the dash trail, landing dust (soft + hard), pickup sparkle, death burst, respawn flash, sweat drops, and the ambient gem twinkle are ONE kit: `createFeelEffects({ seed })` at boot, `fx.dashTrail(particles, state)` per tick, `fx.step(particles, dt)`, `fx.draw(ctx, particles)` per render. Do not author speeds yourself (the units contract below) — a real build hand-tuned `speed: 14` and shipped every effect at 60× speed under a green suite. Checklist items without recipes do not survive codegen (a real build skipped the trail entirely).

**The feel kit (the minimum viable particle path).** Wire this once and the trail, the death burst, the landing dust, the pickup sparkle, and the ambient gem twinkle are all the same consume:

```ts
// Once at boot (the kit owns its seeded rng — never Math.random, §2):
const fx = createFeelEffects({ seed: 0xce1e5 });

// Per fixed tick, after the player step:
game.particles = fx.dashTrail(game.particles, state);              // no-op unless dashing
game.particles = fx.landingDust(game.particles, feetX, feetY, moment.hard);  // on the landing moment
game.particles = fx.step(game.particles, dt);   // SECONDS in, ticks converted ENGINE-SIDE (see units contract)

// Per render — AFTER §5.4's composeCameraTransform, in the same world space
// as the tiles, in RAW world coordinates. Particles are spawned in world
// space and stay there; a draw pass that runs under the zoom alone (or after
// the ctx has been restored to screen space) renders a trail welded to the
// screen while the level scrolls behind it. That defect shipped once — the
// spawn coordinates were correct and the render was one transform short.
fx.draw(ctx, game.particles);   // 2px rects, colorEnd + alpha fading together
```

> **Units contract (the rule two real builds got wrong, in opposite directions):** the particle pillar is **tick-unit throughout** — `advance`'s `dtTicks` is TICKS, speeds are px/tick, `life` is ticks — while the fixed step hands you SECONDS. Passing `dt` straight through burns life 60× too slow (nothing ever dies; every sparkle drifts for most of a minute), and authoring spawn speeds in px/s makes every effect 60× too FAST (a `speed: 14` trail is 840 px/s — each mote crosses the room in under half a second; this shipped). **The engine owns both sides now:** `stepSeconds(particles, dt, opts?)` / `advanceSeconds(...)` convert `dt / opts.fixedDt` internally (default 1/60; one 60 Hz step ≡ one engine tick), and the tuned `*_EFFECT` presets (`DASH_TRAIL_EFFECT`, `LANDING_DUST_EFFECT`, `PICKUP_SPARKLE_EFFECT`, …, 0.22.0) carry the played-in px/tick values — the feel kit above spreads them, so a builder authors no speeds at all. `spawn` and `sampleConeVelocity` warn once at dev time when a speed exceeds `IMPLAUSIBLE_SPEED_PX_PER_TICK` (12 ≈ 720 px/s) or a life exceeds 600 ticks — the tripwire fires on px/s-authored values immediately. Custom effects: pass `DEFAULT_PARTICLE_AIR` (`{gravity: 0.1, drag: 0.9}` in tick units) as the shared air medium with per-effect feel on `gravityScale`/`dragScale` (a `dragScale` above ~1.11 MULTIPLIES velocity under that medium — 0.9 × scale > 1 — another shipped bug), and fade color with `colorEnd` + the `particleColorAt(p)` reader (engine-owned since 0.22.0). On engine versions before 0.21.0, copy **`recipes/particle-system.ts`** from the engine repo — the same conversion as a boot-time system, with a warn-once guard against a ticks-sized dt.

- [ ] **Dash afterimage** — the kit's ring buffer (`createAfterimageTrail(8)` + `recordAfterimage` per tick + `afterimagesFor(trail, tick)` per render) draws 2–8-tick-old poses as ghosts behind the body at reduced alpha; `clearAfterimages` on respawn. The dash reads flat without it.
- [ ] **Ambient gem twinkle** — `fx.gemSparkle(particles, gem.id, x, bobbedY, tick)` on the kit's 40-tick period: one weightless mote per gem, staggered by gem id (a room's gems must not twinkle in lockstep), spawned at the BOBBED visual center. Under reduced-motion, no ambient effects run (§13 gate 14).

- [ ] Landing dust (`spawn` upward cone on landing); respawn flash.
- [ ] **Wall-grab feel**: latch snap, stamina drain (optionally a stamina bar UI), climb, away climb-hop launch (one `wallJumpLaunched` cue covers wall-jumps AND away climb-hops), straight-up climb-jump (`climbJumpLaunched`) + mantle scramble (`mantled`): grab + Up visibly rises beside the wall, arcs across the lip, and lands — there is NO single-frame snap to the ledge; overhangs fail safely without embedding.
- [ ] **Spring** boing + `springBounceVy`; **dash-refill** sparkle when `maxDashes` refills on a refill entity — **only when the LDtk actually provides springs / dash-refills** (check `report.capabilities.springs` / `.dashRefills` from the preflight; absent content is not a failure). **The shipped pack has neither** (§1.1), so wire the paths and mark this item *not exercised* — do not claim it verified, and do not edit the `.ldtk` to make it fire.
- [ ] Coyote time + jump buffer from the shipped `jumpAbility`; do not duplicate them.
- [ ] **Player sprite (supplied `Player.png`)** — per §4.4's policy: stable **1:1**, facing mirror (no moonwalk), walk 0–7, jump 60→64 straight through then clamps on the fall frame, idle = the 25–26 breathing pair at 400 ms, climb = the 35–36 pair at 160 ms (parked while clinging); no idle shimmer; dash aura + after-image kept.
- [ ] **Entity art from the LDtk (§7.1)** — the strawberry is the authored `Gem` tile (glow behind it, never instead of it) and spikes are the authored `Spike` tile repeat-tiled across each resized strip; entities the `.ldtk` left undressed keep the engine's `DEFAULT_ENTITY_PALETTE` shape. **The collectible idle animation is part of the contract:** a ±2px bob on a 90-tick period with the phase staggered per gem (`entity.id % 7` — a room's berries must never bob in lockstep; a uniform shared phase reads as one mechanical object, and it shipped), the glow pulsing ±10% on a 45-tick period (also per-gem phase). Both are draw-time only — the pickup AABB (`entity.rect`) never moves — and both PIN to fixed per-gem values under reduced motion (the ambient twinkle below spawns at the BOBBED center, so it rides the same wave).
- [ ] **Spring-rod hair (`advanceSpringRod`)** — **OPTIONAL when using the supplied sprite**: the sprite art owns the silhouette, so hair is a cosmetic extra, **never an acceptance requirement** (per G5). Only add it for the wag-when-moving / lift-during-dash flourish; draw it OUTSIDE the sprite's facing mirror.
- [ ] **Summit celebration (OPTIONAL polish, never an acceptance requirement).** `levelComplete` already leaves the camera and the sprite clock running (§8), so the hook is a one-line clip override at the anim-kind derivation — hold a pose, or drive a dedicated clip off a summit tick counter. Note the supplied `Player.png` has **no authored victory row**: its 8 rows are walk/run cycles, two 3-frame lean poses, and the 5-frame jump arc (60–64). A real celebration wants new art; until then the honest options are a held frame with the procedural-fallback `advanceSquash`/`breathe` (sprite-safe only if you do NOT scale the pixel art — §4.4) or a particle burst over a settled idle.
- [ ] **Wind ambience (the reference build's signature atmosphere).** A deterministic gust envelope drives ONE sustained pink-noise wind bed + a snow-particle drift — all synthesized, zero assets: `audio.startNoiseLoop('bandpass', 400, 0.0, { q: 1.2, noise: 'pink' })` once (after audio unlock), then per tick map the gust level (0..1) to `handle.setFrequency(300 + gust * 900)` and `handle.setPeak(gust * 0.05)` — **gusts BRIGHTEN before they louden** (amplitude-only modulation reads as a volume knob). The gust curve is game-side and deterministic: a warped sine (`0.5 + 0.5 * sin(t * 0.3 + 2.7 * sin(t * 0.043))`) plus seeded `mulberry32` jitter, clamped 0..1. **Throttle the param pushes to every 8th tick** (~7.5 Hz) — a push per tick is ~360 AudioParam events/s of cancel/re-anchor churn and glitches. Reduced-motion: no wind bed at all — the reduced-motion path creates no audio adapter (Stage 6) and no ambience runs under the static frame (§13 gate 14).
- [ ] **Snow drift (wind-coupled particles).** The same gust level drives a snow layer: ~150 deterministic flakes (`mulberry32`-seeded positions, wrapped), falling at `(20 + gust * 30)` px/s with `±(4 + gust * 10)` px/s horizontal sway, drawn as 1–2px rects in the SCREEN-space backdrop pass (§5.4, before the letterbox mask — weather is atmosphere, not level). **The draw call is the item** — a real build advected 150 flakes every tick behind a render frame that never drew them, with a code comment claiming it had; gate 14 looks for the snow IN the shot, and §12.1d's static contract greps the render module for the call.
- [ ] **Diegetic stamina feedback (Celeste's read, not a bar).** While an active grip holds AND stamina is below the tired threshold (~20% of max), the player sprite flashes red at 10 Hz — a 10-tick cycle, `Math.floor(tick / 5) % 2` (a real build's `/ 6` cycle read 5 Hz) — via a tint pass with `createSpriteTintCache`, never a scale on the pixel art (§4.4), and emits sweat-drop particles (1 per 24 ticks, downward cone, short life). **The grip gate is load-bearing:** stamina alone must not flash a running body (a real build kept flashing mid-run after dropping off a wall drained the pool). Reads at a glance in the peripheral vision where a bar cannot.
- [ ] Reduced-motion gate (`prefersReducedMotion`) renders room 1 and starts no loop.
- [ ] Room title cards fade in over 0.6 s (`createTweenState` + `easeOutCubic`); transition/"Cleared" cards use `easeOutBack`.

---

## 10. Audio (all synthesized via `createAudioAdapter`)

**The minimum viable audio path — wire this before any cue.** Audio fails SILENTLY: skip the unlock and nothing errors, the game is just mute (a real build shipped exactly that — adapter never constructed, so no cue ever fired):

```ts
const audio = createAudioAdapter();
let audioReady = false;   // gates cue firing until the first real user gesture
// The unlock wiring is recipes/audio-unlock.ts (engine repo) — copy it in:
// a one-shot keydown/pointerdown listener that calls audio.unlock() once and
// removes itself; its onUnlock hook flips the gate. Silent no-op in Node.
attachAudioUnlock(audio, { onUnlock: () => { audioReady = true; } });

// Per fixed tick — cues fire on EVENT EDGES / feel moments only (the
// sustained-sound rule below). These three make the game audible:
if (audioReady) {
  if (state.events.justLaunched) audio.playTone('sine', 200, 400, 80, 0.2);
  if (state.events.dashStarted) audio.playNoise(60, 'bandpass', 1500, 0.18);
  if (state.moments.some((m) => m.kind === 'landing' && m.hard)) audio.playNoise(80, 'lowpass', 300, 0.3);
}
```

Then the full cue list:

> **Sustained-sound rule:** one-shot cues (`playTone`/`playNoise`) fire on EVENT EDGES only — event pulses, foot-plant events, feel moments — never once per tick. A sound that lasts exactly as long as a state (the wall-slide scrape) is a sustained loop: start ONE `startNoiseLoop(...)` on the state's onset edge, keep the handle, and call `handle.stop()` on the first tick the state ends. NEVER re-fire a one-shot per tick to fake sustain — every burst restarts the same noise buffer, and 60 identical restarts/s phase-lock into a 60 Hz buzz.

> **Sustained-voice modulation (0.19.0):** the handle can also move its SPECTRUM per tick — `handle.setFrequency(hz)` / `handle.setQ(q)` (de-zippered ~50 ms approaches; clamped [10, 20000] Hz / [0.1, 20]; no-ops after `stop()`), and `startNoiseLoop` takes `{ q, noise: 'pink' }` options (a resonant Q at voice start; a −3 dB/octave bed buffer that reads as weather where white reads as hiss). This is what procedural wind needs — gusts BRIGHTEN before they louden, and amplitude-only modulation reads as a volume knob — and what ambient weather (a four-voice rumble/body/whistle/hiss bank driven by one gust level) is built from. Concurrent sustained voices now start at different offsets in the shared loop (a rotation — decorrelation, not a tone change). The gust curve, thresholds, and exponents stay game-side: the engine ships the movable voice, not the weather.

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
- **Falling block (§6.1, when the LDtk provides them):** armed → a dry creak `playNoise(70, 'bandpass', 900, 0.1)`; released → a woosh `playNoise(200, 'highpass', 700, 0.14)`; landed → the hard-landing thud + a low crash `playTone('square', 90, 40, 120, 0.22)`. Three layers summing to ≤ ~0.9 peak gain — budget the layers, there is no compressor on the master.
- **Wind bed (§9's ambience item):** the sustained-voice recipe in full — one pink-noise `startNoiseLoop` whose `setFrequency`/`setPeak` follow the game-side gust curve, pushed every 8th tick. This is the cue the 0.19.1 seamless 10 s noise buffers exist for: a 1 s noise loop reads as machinery under any filter; the 10 s equal-power-crossfade buffer reads as weather.

---

## 11. File Layout (Suggested)

```
vite.config.ts         # §5.7: dev-only ldtk-hot-reload plugin (public/*.ldtk change → 'ldtk:update'; apply: 'serve')
public/                # the §1.1 assets, FLAT — the .ldtk names its tileset as a bare sibling
  celerock.ldtk        #   fetched via base-URL-aware projectUrl (§5.1)
  celerock.png         #   resolved from the project's relPath, NOT fetched directly
  Player.png           #   fetched as './Player.png' (§4.4)
  Player.json          #   fetched as './Player.json' (§4.4) — the animation source of truth
src/
  main.ts              # boot: load LDtk + tilesets, canvas, store, audio.unlock, loop.start()
  ldtk.ts              # loadLdtkProjectAssets (or parseLdtkProject+buildLdtkTilesetBundle), inspectLdtkPlatformerProject, createLdtkRoomCache
  camera.ts            # the Celeste preset per room (celesteFollowVcam + celesteCameraZoom), createCameraBrain/updateCameraBrain, room slide
  transition.ts        # room-transition session wiring: pollRoomTransition → mapLdtkRoomEntry → transitionPlatformerToRoom → beginSessionRoomSlide / advanceSessionRoomSlide / endRoomTransitionSession
  game/
    state.ts           # CelerockSave (collectibles: Record<levelIid, CollectibleSave>, deaths), World/Room runtime
    step.ts            # fixed-step: input → stepPlatformer → pickups → audio → brain
    render.ts          # painter draw (recipes/ldtk-draw-pipeline.ts) + player art + entities + particles + UI
    entity-art.ts      # §7.1: the drawLevelEntity drawOverride resolving room.entityArt by entity id (drawLdtkEntityTile — LDtk tile first, engine shape otherwise)
    player.ts          # sprite renderer (drawSprite) primary — load+compile Player.png, deriveSpriteAnimKind per tick; procedural face/hair/feet fallback (kernel does physics)
    hazards.ts         # hazard AABB check (static + moving-platform-child) + respawn flash + §6.1 falling-block glue (collect/advance/score — the MACHINE is the engine's)
    collectibles.ts    # strawberry wiring: derivePickups → collect → writeSave (keyed by level.iid)
    checkpoints.ts     # checkpoint activation + respawn logic
    pause.ts           # §8: the pause menu — a createMenuNav per open, the muted-frozen-frame render, RETRY/QUIT dispatch
  input.ts             # createKeyboardAdapter + createTouchButtonSet + createGamepadAdapter(extendGamepadMap) + mergePolledEdgeMaps
  wind.ts              # §9: the deterministic gust envelope + snow drift (game-side curve over the engine's sustained voice)
  audio.ts             # createAudioAdapter + the SFX recipe helpers
  save.ts              # createLocalStorageSaveStorage + loadSave / writeSave
```

No `rooms/` directory, no ASCII grids, no `tile-style.ts` — the LDtk file is the source of geometry and the tileset is the source of art.

---

## 12. Tests & Static Contracts

**The suite tests GAME code, not just the engine — non-negotiable.** A real build shipped green with 34 passing tests, zero of which imported a single line of game code: its "determinism" test drove `stepPlatformer` directly, its "persistence" tests did engine save round-trips — and every wiring defect it shipped (a footstep cue consumed before it was produced, a snow layer never drawn, 60× particle speeds, a respawn that dropped its facing) was invisible to that suite by construction. Copy **`recipes/game-test-harness.ts`** into `tests/` and:

- **At least one test file drives the game's own `stepGame`** against a harness-built game (the real `.ldtk`, a recording audio stub, `stubCanvas()`) — the §12.1b seam-entry respawn and the walk-tap cue below are the model. Engine-only tests are in ADDITION to this, never instead of it.
- **Static contracts run as a test** (`scanForbiddenIdentifiers('src')` from the harness recipe — Math.random/Date.now/requestAnimationFrame/fillText absent, `src/recipes/` copy-ins excluded), plus wiring contracts where a layer once shipped un-wired: the render module must CALL the snow draw it imports (a real build's comment claimed it had).
- **The §13 gate shots are a manifest test** (`missingShotManifest('.qa/shots', [ ...gate filenames ])` asserts empty) — a real build's QA script referenced a hot-reload screenshot its needle branch silently never produced, and the gap shipped unnoticed.
- **The build is incomplete while any §12 subsection lacks its test file.** The subsections below are artifacts, not suggestions: 12.1 (load smoke + clip/fields/entity-art contracts), 12.1b, 12.1c, 12.2, 12.2b, 12.3, 12.4, 12.5, 12.6, 12.7, and the static contracts — each names a `tests/<name>.test.ts` that must exist and pass.

### 12.1 LDtk Load Smoke Test

Assert STRUCTURE, not snapshots (§1.1's living-file doctrine) — the `.ldtk` is edited live (§5.7), so exact-count assertions break on the first level edit and train the builder to ignore the suite. The structural floor below still catches a truncated or substituted asset loudly — parse failure, a missing tileset, no spawn, a dirty compile — without pinning any geometry:

- `loadLdtkProjectAssets({ projectUrl: `${import.meta.env.BASE_URL}celerock.ldtk` })` resolves `{ ok: true, project, tilesets }` with `project.levels.length >= 1` (log the count) and one tileset whose `relPath === 'celerock.png'` (or, on the manual path, `const { ok, project, errors } = parseLdtkProject(text)` has `ok && project`).
- `inspectLdtkPlatformerProject(project)` reports `totalSpawns >= 1`, exactly ONE uniform tile size in `tileSizes` (log the value), `disconnectedRoomIids` empty, a unique east-terminal room (§1.1's topology asserts), and `spawnLessRoomIids` as a SET: exactly the levels whose per-room preflight report shows no spawn — **never `levels.length − 1` arithmetic** (`totalSpawns` counts spawn ENTITIES while `spawnLessRoomIids` counts ROOMS; they reconcile only when each spawned room carries exactly one spawn). The warning list is expected — assert its membership, not a magic count.
- The start room compiles via `createLdtkRoomCache(project, {...}).getStartRoom()` → `{ ok: true, room }` with `room.spawn.source === 'authored'` and `room.diagnostics` empty (log the identifier — it is whatever the file's first spawned level is); LOG the bucket sizes — hazard/collectible counts are living data, not asserts. (Low-level: `ldtkLevelToLevelData(startLevel, project).level` is defined and passes through `compileGeneratedLevel` with the player config.)
- LOG the capability matrix and diff it against §1.1's time-of-writing snapshot in the test OUTPUT — a change is information for the report, not a failure (G4); the game must boot on ANY matrix. `report.unknownTriggerIdentifiers` is logged the same way — a substituted `.ldtk` carrying a `FallingBlock` shows up HERE first (§6.1).
- `Player.png` decodes at 160×128; a forced load failure leaves `sheet === null` (the whole boot result — §4.4's recipe degrades to null on ANY failure) and the game still steps (procedural fallback, §4.4).
- **Sprite-clip contract (§4.4, 0.20.0 tag extensions).** The compiled sheet carries four clips with their authored semantics: `idle` cells 25–26 at 400 ms/frame looping; `walk` cells 0–7 at the compile default looping; `climb` cells 35–36 at 160 ms looping; `jump` cells 60–64 at 70 ms with **`loop === false`** (assert the flag — a regressed `loop: true` rewinds the jump arc mid-air). Past the jump total (350 ms), `currentFrameIndex` clamps to the LAST slot (cell 64). `deriveSpriteAnimKind({ climbing: true, … })` returns `'climb'` for grounded, airborne, and sliding inputs alike; `spriteAnimClipFor('climb') === 'climb'`. **And the game-side SELECTION is tested through the game's own anim step** (the §12 preamble harness): a grounded still player resolves `idle`, a running one `walk`, an airborne one `jump`, and `'climb'` only while a grip is ACTIVE — the ability slices' `kind` literals are permanent, and a kind-only predicate shipped a player stuck on the climb clip for every state, invisible to every engine-level test.
- **Trigger `fields` contract (§5.2/§6.1).** A fixture LDtk with a `FallingBlock` entity carrying an integer `tiletype` field translates to a `trigger` with `props.action === 'FallingBlock'` and `props.fields.tiletype === <value>`; an entity with no fields translates with `props.fields` an empty record. `collectFallingBlocks` over that fixture returns one block with `material` = the field value (1 when absent/invalid), and `advanceFallingBlocks` drives the §6.1 sequence — arm on X-only overlap, shake 0.2 s + extending grace, flush landing at Celeste accel/cap, crush overlap, room escape → `gone`, and purity (inputs never mutated).
- **Entity art contract (§7.1).** The `Gem` and `Spike` entity defs carry non-null `tileRect`s whose `tilesetUid` matches the `celerock.png` tileset def (log the values); the render-mode AUTHORITY (`Gem` → `'FitInside'`, `Spike` → `'Repeat'`, 0.16.0 — authoritative from the file, never derived from rect geometry) is fixture-tested, not pack-tested. The §7.1 join resolves art for **every hazard and collectible in every room** — count-independent: zero UNEXPECTED misses (a dressed entity must resolve; falling back is only correct for genuinely undressed ones). If the pack carries any `Spike` instance larger than its 8×8 tile, assert the `Repeat` path renders it tiled — otherwise cover `Repeat` via the fixture.

### 12.1b Seam-Entry Respawn

- Cross from the start room into a linked neighbour with no authored spawn, then die on a hazard.
- Assert: the respawn places the player at the stored seam-entry position for that neighbour — **not** at the start room's authored spawn and **not** at the origin — with zeroed velocity and the entry `facing`, and the active room is still the neighbour (§8, rule 3).

### 12.1c LDtk Hot Reload (dev-only, §5.7)

- With `npm run dev` serving and the game `playing`, save a trivial edit (move one `Spike`). Assert: the active room recompiles within ~1 s — `active.hazards` reflects the move, painter cache rebaked, terminal room re-derived (entity art needs no rebuild — it rides the recompiled room's `entityArt`) — via a cache-busted fetch keyed by the generation counter (`?g=`, never `Date.now()`).
- Assert state preservation across the swap tick: `state.core.{x,y,vx,vy,facing}` identical before/after, `save` (collectibles + deaths) unchanged, `gameState` still `playing`, and no page reload occurred (the loop kept stepping; no `location.reload` anywhere in game code).
- Save a syntactically invalid `.ldtk` (truncated JSON). Assert: the swap is rejected — `project`, `rooms`, `active`, and the surface-cache bakes are the SAME objects (reference identity), and the error is surfaced (console + dev toast). The game remains fully playable.
- Delete the active room from the `.ldtk` and save. Assert: same rejection path (the active room's iid is gone — `rooms.has(active.ldtkLevel.iid)` is `false`, probed with `has` so `get` never throws), playable world untouched.
- Save while a §5.5 slide is active. Assert: the swap defers until `session.slide === null`, then applies exactly once (not mid-slide, not twice).
- Assert the seam-apron cache is invalidated on every applied swap: after an edit that changes a neighbour's near-seam geometry, the next `apronFor(activeIid)` serves the NEW solids (a memo that survived the swap serves the old project's floors — invisible until a crossing misbehaves; §5.3/§5.5).
- Save while the player stands where a new wall is drawn. Assert: the embedded body recovers through `settlePlatformerState` (or, when fully enclosed, respawns at the §8 anchor) — the kernel never phases into geometry.

### 12.1d Static Contracts & Wiring Claims

`tests/static-contracts.test.ts`, via `recipes/game-test-harness.ts`:

- `scanForbiddenIdentifiers('src')` returns `[]` — no `Math.random`, `Date.now`, `requestAnimationFrame`, or `fillText` in game code (the bitmap font is the only text path; a real build's boot-error `fillText` survived because the scan existed only as a manual grep nobody ran). Copy-in engine recipes under `src/recipes/` are excluded — they are engine-tested.
- **A wiring claim is a call site.** For every "X is drawn/wired" claim the code's comments or README make, the test asserts the call exists: the render module contains the `drawSnow(` invocation (a real build simulated 150 flakes behind a render comment claiming them), and each effect's spawn site is reachable from `stepGame`. If a claim has no call site, delete the claim or add the call — a comment that describes behavior the code does not perform is a defect in both directions.

### 12.2 Dash-into-Wall Hit-Stop Timing

- Script: place the player 2 tiles left of a solid wall, trigger a rightward dash.
- Assert: on the contact tick, `state.moments` carries exactly one `{ kind: 'dashBonk', normalX: -1, solidId }` (horizontal dash into a right wall — the surface normal points back against the dash) AND `isHitStopActive(hitStop)` is true for ≥4 ticks AND `shakeEnvelope` is non-zero. The dash itself does NOT end on contact in this engine version (it ends on timeout; `dashEnded.reason === 'timeout'` with the ending-tick `terminalContact`) — the bonk cue keys off the `dashBonk` moment, never off the dash phase going idle.
- Assert: a dash PINNED against the wall for multiple ticks emits exactly ONE `dashBonk` per blocked axis per dash (a second dash re-arms it).
- Assert: the player's `state.core.x` never exceeds the wall's left edge by more than the kernel's penetration tolerance (the dash never phases through).

### 12.2b World-Space Composition (the render transform)

**This file is `tests/render-composition.test.ts`.** It is a pure-arithmetic test — no canvas needed beyond a stub that accumulates `scale`/`translate` — and it is the only cheap way to catch a layer that does not move with the camera, because every such bug looks like working code and fails only on screen.

- Build `t = cameraTransform({ x: 137.4, y: 62.8 }, viewport, { zoom, devicePixelRatio: 2 })` — a camera deliberately off the origin, since **every** composition bug is invisible at camera `(0, 0)`.
- Compose `composeCameraTransform(stub, t)` and map a world point through the accumulated transform. Assert it equals the same point mapped through `scale(zoom)` + the engine's own `worldOffset` translate — the two paths are the same space.
- Assert the *defect* fails the same assertion: the point mapped under `scale(zoom)` alone (no offset) differs whenever the camera is off the origin. A test that cannot fail on the bug is not a test.
- Assert the game's own render helpers take raw world coordinates: call `drawParticles(stub, [{ x: 200, y: 96, … }])` and assert the emitted rect is at `200, 96` in the *current* space — not at `200 + t.offsetX`. Any hand-added offset inside a world-space draw helper is the double-offset failure, and this catches it.
- Slide case: with `p.sourceOffset` / `p.destinationOffset` from a real `presentationForRoomSlide`, assert the destination room's origin maps `(destinationOffset.x - camera.x) · zoom` — i.e. the room offset composes ON TOP of the camera offset, and dropping either one moves the whole world.
- `cameraLetterbox(bounds, viewport, t).bars` is empty exactly when the room covers the viewport, and `bars` + `clip` tile the viewport with no overlap at 16:9, 4:3, ultrawide, and portrait. **And the aperture is invariant across a slide:** sample the frame every tick through a full transition and assert its width and height never change (they may only differ if the two rooms differ in size, in which case assert a monotonic morph). A frame that grows mid-slide is the union-bounds mistake, and it is invisible in any single-frame test.

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
3. **Loads the supplied LDtk + tileset** and renders the tileset through the **painter** (`recipes/ldtk-draw-pipeline.ts`'s `createLdtkRoomPainter` over `createLdtkLevelSurfaceCache` — pixel-crisp at any zoom, untinted; `drawLdtkLevel` remains the underlying baker). The surface blit guards its own smoothing since 0.17.4 — but the render's first line is still `ctx.imageSmoothingEnabled = false` for everything you scale yourself.
4. The Celeste kit is present and works on the supplied geometry: **dash (8-dir, startup freeze, refills on land) + wall-grab/stamina + wall-slide + wall-jump + dash-tech.** **No `doubleJump`.** Springs, dash-refills, moving platforms, ladders, and falling blocks (§6.1, via `report.unknownTriggerIdentifiers`) are **capability-aware** — exercise each one the preflight reports present (`report.capabilities.springs` / `.dashRefills` / `.movingPlatforms` / `.ladders`); absent ones are not a failure (G4).
5. The **camera brain** drives the view through the **Celeste preset** (`celesteFollowVcam` per room + the campaign-constant `celesteCameraZoom(viewport)` fitted to the 320×184 window — never the room — + slide on transition via `CELESTE_ROOM_SLIDE_OPTIONS`); the viewport passed to all of them is in **CSS units** (`canvasCssViewport` — the backing store is the engine's business), so framing is identical at `dpr` 1 and 2 and the one-screen room remains fully visible at 16:9, 16:10, 4:3, ultrawide, and portrait aspect ratios (larger substituted rooms scroll under the fixed window). No legacy `createCamera`/`updateCamera`, and no `fitCameraZoom(room, …)` — fitting the room varies zoom with room size.
6. Room-to-room travel is **seamless via `__neighbours`** using the session path (`pollRoomTransition` → `transitionPlatformerToRoom` → `beginSessionRoomSlide` → `advanceSessionRoomSlide`; §5.5): a **0.65 s easeOutCubic slide** (`CELESTE_ROOM_SLIDE_OPTIONS` — both rooms render, continuous screen position at the seam), momentum (`vx`/`vy`/`facing`) preserved, particles rebased into the destination room; reduced-motion uses an immediate seam-aligned cut. The camera does not pop between rooms. **Every seam crossing lands flush:** with the §5.3 tick set carrying the seam apron, no crossing at any fall speed embeds into the destination floor or falls through the seam (0px embed) — and no diagnostic net, widened ledge, or entry clamp exists to mask one that would (§5.5).
7. The **dash-into-wall** moment (horizontal AND vertical — read the `dashBonk` feel moment on `state.moments`, never a hand-rolled velocity threshold) applies hit-stop and shake (§12.2).
8. Strawberries persist across page reload via `createLocalStorageSaveStorage` + `writeSave` (keyed by `level.iid`) — and a collected gem's **TILE disappears from the render list on the pickup tick** (render from `remaining`, §7; a halo-only filter leaves ghost gems — a real build shipped that).
9. Death counter increments every respawn and persists through the same save adapter.
10. `prefersReducedMotion` renders the start room statically and never calls `loop.start()`.
11. **Zero duplicate engine systems**: no direct animation-frame loop, no random authoritative simulation, no manual collision resolver, no manual tile-blit loop (entity display tiles go through `drawLdtkEntityTile`, §7.1), no legacy camera.
12. **No moonwalk.** Running left faces left — with the supplied sprite via `drawSprite(..., { facing })` (its internal `ctx.scale(facing,1)` mirror about the frame's horizontal center); with the procedural fallback via `ctx.scale(facing, 1)` around the body draw.
13. **No appendage blow-out.** Hair uses `advanceSpringRod`, never raw `advanceSpringChain`.
14. **Supplied `Player.png` sprite renders pixel-crisp** — no shimmer while idle (`imageSmoothingEnabled = false`, stable 1:1, no per-frame squash/breathe scaling on the sprite). Walk cycles cells 0–7 and flips with `facing`; jump plays cells 60→64 once then **clamps on the fall frame** until landing; idle is the 25–26 breathing pair at 400 ms; wall-grab/ladder plays the 35–36 climb pair at 160 ms, PARKED (not looping) while clinging stationary. If `Player.png` fails to load/compile at boot, the procedural body renders instead and the game is still playable. A single jump plays its clip once, straight through — the launch frames never replay mid-arc (the clip player restarts only on a CLIP change, §4.4).
15. **Terminal-room completion, and the ending is not playable.** Reaching the **terminal room** (no `e` neighbour — derived at boot per §1.1) fires `{ type: 'win' }` → `levelComplete` and the chapter-complete card (`createTweenState` + `easeOutBack`). No `Goal` entity is created; the `.ldtk` is never edited. From that tick the player is a spectator (§8): holding every key at once moves nothing — no walk, no jump, no dash, no grab — while the body still finishes its arrival (falls, lands, settles) instead of freezing mid-air. Hazards cannot kill and the seam cannot be re-crossed. The card states its exit and a confirm edge returns to the menu after the grace window; a completion screen you cannot leave without reloading the page fails this criterion.
16. **Entities render their authored LDtk tile (§7.1).** The strawberry draws as the `Gem` tile from `celerock.png` — not a procedural diamond — and spikes draw as the `Spike` tile **repeat-tiled** across each resized instance (not stretched, not a flat red box). Entities whose LDtk def assigns no tile fall back to `drawLevelEntity`'s `DEFAULT_ENTITY_PALETTE` shape.
17. **Dev-time LDtk hot reload (§5.7) — standard scope.** Under `npm run dev`, saving `public/celerock.ldtk` swaps the edited world into the live game within ~1 s per §5.7's full contract — swap-atomic and transactional, active room recompiled by iid, painter rebuilt (fresh surface cache), hazard rects rebuilt (entity art needs NO rebuild line — it rides the recompiled room's own `entityArt`, §7.1), terminal room re-derived, live player state / save / death counter / FSM preserved verbatim, invalid edits rejected with the playable world untouched, mid-slide saves deferred, embedded bodies recovered via `settlePlatformerState`. The `vite build` output contains none of this wiring (`apply: 'serve'` + the `import.meta.hot` guard).
18. **Minimum audio is wired and audible (§10).** The adapter unlocks on the first `keydown`/`pointerdown` gesture, and at least the jump, dash, and hard-landing cues are audible during normal play. Audio failure is SILENT — nothing errors — so this criterion exists purely to catch the mute build (a real build never constructed the adapter).
19. **Dash trail renders (§9).** While dashing, white 2px trail particles spawn from the seeded `mulberry32` stream each dash tick, advance, cull, and fade with remaining life (§9's recipe — no `Math.random`, no per-tick re-fire of one-shots).
20. **The letterbox area is masked, not decorated (§5.4).** `applyCameraLetterbox` fills bars outside the room frame and clips world rendering to it, every frame. **The aperture is ONE ROOM, and it does not move or resize during a room slide** — mask with the room, clamp the brain with the union; a frame sized from `presentationForRoomSlide(...).bounds` is twice a room wide, swallows the bars mid-transition, and lets the world fill the window. At any aspect ratio the play area ends at a visible edge: no backdrop stretching to the canvas corners as if it were level, and nothing from the world draws outside the frame. A build whose camera bounds are correct but whose margin is unmasked still fails this — that is exactly how it shipped once.
21. **Every world layer moves with the camera (§5.4).** Tiles, entities, the player, and particles are all drawn after one `composeCameraTransform`, in raw world coordinates. Verified, not assumed: with the camera parked away from the origin, a particle at a known world position lands on the same screen pixel as the tile at that position (§12.2b), and in play the dash trail stays glued to the player through a full room's worth of scrolling — including across a seam slide, where the rooms, the player, and the rebased particles share the slide-space transform.
22. **The pause menu is a screen, not a flag (§8).** Escape/Start/touch-⏸ opens `paused`: the world frame freezes (no live-input sim behind the card), audio mutes, and RESUME/RETRY/QUIT navigate via `createMenuNav` (wrap, grace, confirm). RETRY resumes to `playing` and then runs the standard respawn path; QUIT lands on the menu (a transition only legal from `paused`). A pause opened mid-slide does not corrupt the slide — it finishes under the freeze.
23. **Wind ambience plays and the weather is deterministic (§9).** After the audio unlock, the pink-noise wind bed follows the seeded gust curve (brighten-then-louden — `setFrequency` before `setPeak`), param pushes throttled to every 8th tick, and the snow layer drifts with the same gust level in the masked backdrop. Two runs with the same seed produce identical gust/snow timelines (assert it — see §12.6's determinism run).
24. **Selection UI runs on the engine's menu navigation (§8).** Both the start menu and the pause menu drive `createMenuNav`/`advanceMenuNav` — a hand-rolled `menuIndex` counter with its own wrap/grace logic is a forbidden pattern (§12.8).

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
- **No stretched entity tiles** — a resized instance over a smaller tile (LDtk `tileRenderMode: 'Repeat'`; a resized strip such as the shipped `40×8` over an `8×8` tile) must be **repeat-tiled**, never scaled to fit. A smeared 40px spike passes a code review and fails a screenshot.
- **No `advanceSpringChain`** outside `node_modules` (hair uses `advanceSpringRod`).
- **No deep imports** (no `aicraft-engine/src/...` — only the root barrel).
- **No death/respawn trigger on a `__neighbours` seam edge** (e.g. `player.x < -40 || player.x > width + 40` → kill). Walking/falling off a linked edge must transition (§5.5); void-death checks are only valid for edges with no cardinal neighbour / crossings outside the shared seam span.
- **No camera pop between rooms** — every `__neighbours` crossing must use the engine slide path (G5): `beginSessionRoomSlide` / `advanceSessionRoomSlide`, driving the slide camera via `presentationForRoomSlide` + `updateCameraBrain`, with both rooms rendered, the player's screen position continuous at the seam, and the campaign-constant `celesteCameraZoom` lens easing the slide (`CELESTE_ROOM_SLIDE_OPTIONS` — the zoom itself never changes between rooms; immediate seam-aligned cut only under reduced-motion). **A jarring camera pop between rooms is a failure** — the view must not snap on a seam crossing.
- **No momentum loss at a `__neighbours` seam** — the player must carry `vx` / `vy` / `facing` across the seam; Celeste's rooms are continuous, not teleporting. **Losing momentum at a seam is a failure.**
- **No silent dash-into-wall** — the bonk is the signature Celeste feel beat; on contact it must fire `triggerHitStop` + `sineShake`. **A silent dash-into-wall is a failure** — missing those cues means the runtime does not teach dash feel.
- **No world-space draw outside the composed camera transform** — grep the render module for a world-coordinate draw (`particle.x`, `core.x`, `entity.rect.x`) that runs before `composeCameraTransform` or after the matching `ctx.restore()`, and for a second hand-added `+ offsetX` / `worldOffset: { x: t.offsetX … }` on a layer already inside it. One is a layer pinned to the screen, the other is a layer at double the camera offset; both look like "the camera is broken" and neither is. **A particle, entity, or player draw that does not move with the camera is a failure**, and the repair is the transform, never the spawn coordinates.
- **No playable ending** — a chapter-complete card drawn over a player who can still walk, jump, dash, and die is a failure (§8). The card is not a HUD overlay on continuing gameplay; it is the end of the run. Equally forbidden in the other direction: an ending that freezes the sim outright (the player hangs mid-air on arrival) or that offers no way back to the menu.
- **No unmasked window margin** — a backdrop/parallax `fillRect` over the full viewport with no `applyCameraLetterbox` (or an equivalent bars-plus-clip pass) after it is a failure. The symptom is reported as "the camera lets you see past the level"; the cause is that nothing ever drew the level's edge.
- **No refresh-based "hot reload"** — `location.reload()` (or any full-page teardown) as the `.ldtk` edit loop discards exactly the live state §5.7 exists to preserve, and it is the cheap implementation this section forbids. **A page refresh on `.ldtk` save is a failure**: the swap must be live, swap-atomic, and transactional (§5.7).
- **No hand-built `CompiledAnim` / no copy-on-write re-pacing of the compiled sheet** — the 0.20.0 tag extensions own one-shot clips (`loop: false`) and per-clip pacing (`duration`/`durations`) at compile time. A hand-assembled jump clip with `loop: false`, or a `new Map(sheet.anims)` spread to re-time idle, is the pre-0.20.0 workaround and a failure now.
- **No hand-rolled falling-block physics** — arm/shake/grace/fall/land/crush is `advanceFallingBlocks` (§6.1). A game-side block state machine with its own gravity integration duplicates a decompiled Celeste system the engine owns.
- **No hand-rolled menu selection** — a `menuIndex` counter with its own wrap/grace/confirm logic is what `createMenuNav`/`advanceMenuNav` own (§8); both menus ride it.
- **No manual per-device edge cascade** — `orEdges(orEdges(k['jump'], g['jump']), t['jump'])`-style ladders over three devices are `mergeEdges`/`mergePolledEdgeMaps` (§4.3). **A hand-written three-device merge is a failure**; same for shallow-copying the frozen `STANDARD_*_MAP`s instead of `extendKeyboardMap`/`extendGamepadMap`.
- **No reach-through for authored entity fields** — `props.params.fieldInstances` is the legacy mirror; `props.fields.<name>` is the read surface (§5.2/§6.1). New code reaching into `params.fieldInstances` is a failure.

---

### 12.9 Required Wiring — the greps that must come back NON-EMPTY

**§12.8 is all negative space, and negative space passes vacuously.** A real run
of this brief shipped **420 lines in a single `src/main.js` whose only import was
`./style.css`**. `aicraft-engine` sat in its `package.json` — at `^0.17.2`, five
minors below this brief's pin — and was never imported once. It hand-iterated
`gridTiles` / `autoLayerTiles` instead of the painter, so nothing autotiled. It
integrated its own gravity instead of `stepPlatformer`, so nothing felt like
Celeste. It never compiled `Player.json`, so every animation was wrong. And it
passed nearly all of §12.8 — **you cannot call `createCamera` if you never import
the engine** — while looking, in a screenshot, like a platformer.

§12.8 says what must be **absent**. §12.9 says what must be **present**. The whole
section ships as a runnable script — [`games/celerock-wiring-check.sh`](https://github.com/morganpage/aicraft-engine/blob/v0.22.4/games/celerock-wiring-check.sh)
in the engine repo. Copy it into the build root and run it at every §14 stage
boundary, not once at the end (the script also carries §12.10 behind `--final`): a stage that fails these greps is a
**failed stage**, not a TODO, however good the code looks and however well the
screenshot reads.

#### 12.9.1 The recipes must be copied in AND imported

```bash
# Present and non-empty — the §1.1 copy-in set. Prints nothing when clean.
for r in fixed-tick-game platformer-input sprite-sheet-boot image-decoder \
         sheet-frame-index ldtk-draw-pipeline room-slide-aperture \
         ldtk-entity-art feel-effects audio-unlock game-test-harness \
         ldtk-hot-reload-plugin; do
  test -s "src/recipes/$r.ts" || echo "MISSING OR EMPTY: $r"
done

# Imported, not merely carried. Match EVERY depth form AND both quote styles
# with one permissive pattern: game code lives in src/ AND src/game/, tests
# reach in as '../src/recipes/', vite.config.ts as './src/recipes/', and a
# build may quote its specifiers either way.
for r in fixed-tick-game platformer-input sprite-sheet-boot image-decoder \
         sheet-frame-index ldtk-draw-pipeline room-slide-aperture \
         ldtk-entity-art feel-effects audio-unlock game-test-harness \
         ldtk-hot-reload-plugin; do
  grep -rqE "from [\"'][^\"']*recipes/$r[\"']" src/ tests/ vite.config.ts \
    || echo "CARRIED BUT NEVER IMPORTED: $r"
done
```

**Anchoring these greps on incidental syntax has now produced two false results,
both caught only by running them against a build whose answer was already
known.** The first draft matched `'../recipes/'` and missed `'./recipes/'`,
reporting 9 imports on a build that had 18. The second hard-coded single quotes
and reported ENGINE NEVER IMPORTED on a build that imports 72 engine symbols
with double quotes — the single most serious verdict this section can return,
delivered against a build that had not committed the offence. Import specifiers
have two legal quote styles and unbounded relative depth; a pattern that admits
only one of each is testing your formatter, not your wiring.

Both loops print nothing when clean. Two of the fourteen
§1.1 recipes are conditionally imported and are **not** part of this check:
`ldtk-entity-tile-art` (only when the LDtk defines falling blocks, §6.1) and
`particle-system` (the pre-0.21.0 back-port — at this brief's pin you call
`stepSeconds` directly, so a build that imports it is behind, not ahead).

A from-scratch reimplementation of something a recipe already does is a failed
stage, not a stylistic choice. If a recipe genuinely does not fit, say so in a
comment naming what it could not do — do not silently re-sketch it.

The structural rules that follow, each independently sufficient to fail a run:

- **The build is TypeScript.** A `src/main.js` voids `tsc --noEmit` as a stage
  gate, which is how a run ships 420 unchecked lines against an API it never
  read. `npx tsc --noEmit` must be clean at every stage boundary.
- **`src/` is multi-file** (§11's layout, or a defensible variant). If the whole
  game is one file, the recipes are not in it and neither is the engine.
- **The pin is exact.** `"aicraft-engine": "0.22.0"` — no caret. A caret range
  resolved a real build to `0.17.2`, where half of §12.9.3 does not exist.

#### 12.9.2 The engine must be reachable from GAME code

```bash
grep -E '"aicraft-engine": *"0\.22\.0"' package.json
grep -rnE --exclude-dir=recipes "from [\"']aicraft-engine[\"']" src/
```

`--exclude-dir=recipes` is the whole point of the second grep. The copied recipes
import the engine themselves, so a grep over all of `src/` comes back green for a
build that carries all fourteen recipes and wires none of them. **Every grep in
§12.9.3 excludes `recipes/` for the same reason** — the question is never "is the
symbol in the tree", it is "does the game call it".

#### 12.9.3 One grep per system that fails silently

Each row is a defect a screenshot critic cannot see, paired with the symbol whose
absence causes it. The right column must hit **game code**:

| Ships as | Must appear outside `src/recipes/` |
| --- | --- |
| "the platforms aren't autotiled" | `createLdtkRoomPainter` (§5.4) |
| "it doesn't feel like Celeste" | `stepPlatformer` / `createPlatformerController` (§4.2) |
| "the animations are wrong" | `drawSprite` **and** `deriveSpriteAnimKind` (§4.4) |
| "the camera pops between rooms" | `beginSessionRoomSlide` **and** `advanceSessionRoomSlide` (§5.5) |
| "you can see past the level" | `applyCameraLetterbox` (§5.4) |
| "the trail drifts off the player" | `composeCameraTransform` (§5.4) |
| "the strawberry is a drawn diamond" | `ldtkEntityTileOverride` **and** `drawLevelEntity` (§7.1) |
| "the menus feel sticky" | `createMenuNav` (§8) |
| "dash-into-wall is silent" | `triggerHitStop` **and** `sineShake` (§9, §12.2) |
| "the build is mute" | `createAudioAdapter` (§10) |
| "the hair blows out" | `advanceSpringRod` (§4.4) |
| "progress doesn't persist" | `createLocalStorageSaveStorage` (§12.4) |
| "reduced motion still animates" | `prefersReducedMotion` (§2) |

```bash
for s in createLdtkRoomPainter stepPlatformer drawSprite deriveSpriteAnimKind \
         beginSessionRoomSlide advanceSessionRoomSlide applyCameraLetterbox \
         composeCameraTransform ldtkEntityTileOverride drawLevelEntity \
         createMenuNav triggerHitStop sineShake createAudioAdapter \
         advanceSpringRod createLocalStorageSaveStorage prefersReducedMotion; do
  grep -rq --exclude-dir=recipes "$s" src/ || echo "NOT WIRED: $s"
done
```

Every line of that loop is verified to come back clean on the build that passed
§12.7 — these are probes with a known passing state, not aspirations. A probe
that has never passed is worse than no probe.

One deliberate exception: **the exact-pin rule in §12.9.1 is the one check the
passing build does not meet.** It shipped `"^0.22.0"` and was correct only by
luck — `0.22.0` happened to be the newest release the day it installed. The
build that shipped `"^0.17.2"` ran the same caret against an older floor and
resolved five minors below the API this brief describes. The caret is a latent
version of that failure in every build that carries it, so it is a requirement
here rather than a regression check.


### 12.10 Gate Substance — the checks that a gate has CONTENT, not just a call

§12.9 asks *"is the system wired?"* A build can answer yes to all forty-one of
its checks and still ship a fifth of a game, because §12.9 never asks whether
the gates it passes have anything in them.

A real run of this brief passed §12.9 completely — TypeScript, exact pin,
multi-file, twelve recipes copied and imported, every §12.9.3 symbol wired, `tsc
--noEmit` clean, suite green — and shipped 27,830 characters of game code
against the reference build's 137,379, with an empty `.qa/`. Its §13 gate
assertion read:

```ts
expect(missingShotManifest(new URL('../.qa', import.meta.url).pathname, [])).toEqual([]);
```

That is the exact function this brief names, imported from the right recipe,
called with correct arguments — and an **empty required-shot list against an
empty directory**. It cannot fail. Every §13 gate was satisfied by asserting
nothing.

This is the recurring failure, not a one-off: it is the same shape as the suite
in §12's preamble that ran green with thirty-four tests and zero game imports.
Given a mechanical gate, a build under time pressure finds the weakest legal
reading of it. So §12.10 checks **artifacts, not call sites**.

#### 12.10.1 Check the artifact, never the syntax

The instinct is to grep the call for an empty literal. Do not — the reference
build's own line is `expect(missingShotManifest(SHOTS_DIR, GATE_SHOTS)).toEqual([])`,
and any regex loose enough to catch the vacuous second argument also catches
that trailing `.toEqual([])`. A probe that fires on the correct build is worse
than no probe (§12.9).

Count the captures instead. An empty manifest cannot produce fourteen PNGs:

```bash
# §13 has 14 visual gates. The reference build ships 43 captures.
find .qa -name '*.png' | wc -l          # must be >= 14

# §12.7 has 24 acceptance criteria. A suite below one test per criterion has
# not tested the game, whatever its files are named. Reference build: 66.
grep -rho "\bit(" tests/*.test.ts | wc -l   # must be >= 24
```

#### 12.10.2 Require topics, not filenames

§14's Stage 7 names test files, and that naming is a suggestion. The reference
build has no `tests/seam-respawn.test.ts` at all — its §12.1b assertions live
inside `tests/gameplay-wiring.test.ts`, which is a perfectly good place for
them. Requiring the filename would fail the build that passed.

Require that the SUBJECT is tested somewhere under `tests/`:

```bash
for t in triggerHitStop composeCameraTransform writeSave respawn; do
  grep -rq "$t" tests/ || echo "NOTHING TESTS: $t"
done
```

Those four map to §12.2 (dash bonk), §12.2b (world composition), §12.4/12.5
(persistence) and §12.1b (seam respawn) — the four the failing build skipped
while its four remaining tests stayed green. Do **not** add
`scanForbiddenIdentifiers` to this list: the reference build implements §12.8 as
a parametrised `it` per forbidden pattern instead of calling the helper, which
is arguably better and would fail a name-based check.

#### 12.10.3 Both halves or neither

A wired plugin whose event nothing handles is a feature that has never run once.
The failing build mounted `createLdtkHotReloadPlugin` in `vite.config.ts`
correctly, and no game code ever called `import.meta.hot.on('ldtk:update', …)` —
so §12.7 #17's live swap could not have happened, and no grep for the plugin
would tell you:

```bash
grep -q "createLdtkHotReloadPlugin" vite.config.ts \
  && ! grep -rq --exclude-dir=recipes "import.meta.hot" src/ \
  && echo "HOT RELOAD HALF-WIRED"
```

#### 12.10.4 When to run it

**§12.9 runs at every §14 stage boundary. §12.10 runs at Stage 7 only** —
`./celerock-wiring-check.sh --final`. It cannot pass early: a Stage 1 build has
no captures and no suite, and running it at every boundary would teach the run
that a red check is the normal state of the world, which is precisely how a gate
stops meaning anything.

Verified, like §12.9, against both known runs: the build that passed §12.7 is
silent on every §12.10 check; the build that passed §12.9 and shipped a fifth of
a game fails seven of them.
---

## 13. Visual & Play Gates

Before the build is accepted:

1. **Screenshot of the game playing the supplied LDtk** — the tileset renders pixel-crisp and untinted; the camera brain deadzone-follows the player smoothly.
2. **Screenshot of a room-to-room transition** — verify a smooth slide (both rooms visible mid-slide), continuous player screen position at the seam, and that momentum carries across.
3. **Stamina/grab in action** — a shot of the player wall-grabbing (stamina draining) and climb-hopping off.
4. **Manual playthrough** across every room the LDtk contains; verify dash, wall-slide, wall-jump, and (when the LDtk provides them) springs/dash-refills/moving platforms all feel Celeste-tight.
5. **Dash-into-wall** fires hit-stop + shake on ≥90% of attempts (it is a deterministic mechanic, not a precision one).
6. **Fast checkpoint retry:** <2 seconds from death to controllable respawn.
7. **Sprite gate** — screenshot evidence for §12.7 #14: pixel-crisp, no idle shimmer, no moonwalk, jump clamps on the fall frame (or the procedural fallback renders and plays).
8. **Entity-art gate** — screenshot evidence for §12.7 #16: the first room's strawberry as the `Gem` tile and the pack's widest spike strip repeat-tiled at the 8px pitch. The stretch-vs-tile error is invisible in code review and obvious here — this gate exists for exactly that.
9. **Hot-reload gate** — a before/after screenshot pair for one live edit (§5.7): the edit landed, the painter's cache rebaked, and the player is still mid-run at the same position with the same momentum.
10. **Resolution/letterbox gate** — screenshot pairs at 16:9, 16:10, 4:3, ultrawide, and portrait, including at least one `dpr: 2` capture: the full 320×184 camera window is visible (masked/letterboxed as needed) in every shot at the SAME campaign-constant zoom — rooms larger than the window scroll beneath it, smaller rooms show their edge as an edge — centred without stretching; DPR never changes gameplay framing. In every shot the room's edge is **visible as an edge** — the masked margin reads as frame, not as more level. The ultrawide and portrait shots are the ones that fail when the mask is missing, so capture them last and look at them, not at the code.
11. **Summit gate** — reach the terminal room, then hold every control at once for several seconds: the player must not move, jump, dash, grab, or die, and the card must be legible over a body that has landed and settled (not one hanging in the air). Then confirm and land back on the menu. This is a 20-second check and it is the last thing a player sees.
12. **Camera-tracking gate** — one capture mid-dash with the camera well away from the room origin (deep in a room, not at spawn): the trail particles sit on the player, and the same shot repeated a second later at a different scroll position still shows them on the player. A trail that drifts toward a fixed screen point across the pair is the missing world transform (§5.4), not a spawn-position bug. Repeat once mid-seam-slide, where the rooms, the player, and the rebased particles must all move together.
13. **Pause gate** — pause mid-run (keyboard `Escape`, gamepad Start, touch ⏸): the world freezes under the dim, audio goes silent, and RESUME/RETRY/QUIT each do exactly their §8 thing (retry respawns at the anchor; quit lands on the menu with RESUME GAME now present). Pause mid-slide and let the slide finish under the freeze — no corrupted transition.
14. **Ambience gate** — listen for 30 s of idle play: the wind bed swells and brightens with the gusts (no audible loop seam, no param churn glitches), the snow drifts with the same wind, and both are gone under reduced-motion freezes. The gust/snow timelines of two seeded runs are identical (§12.6).

---

## 14. Implementation Workflow

Build in this order. Each stage must pass its gate before the next begins.

**Every stage boundary also runs §12.9 and `npx tsc --noEmit`, in addition to the
stage's own gate.** Not once at the end — at every boundary. The failure §12.9
exists to catch (an engine installed and never imported, recipes carried and never
wired) is invisible in a screenshot and compounds silently: by the time a Stage 5
critic is judging particle colour, a build that skipped the engine at Stage 1 has
hand-rolled four more systems on top of the miss. A stage whose §12.9 greps do not
come back clean is a **failed stage** — reopen it before starting the next one.
**§12.10 is different: it runs once, at Stage 7** (`--final`). It cannot pass
early, and running it at every boundary would teach the run that a red check is
normal — which is how a gate stops meaning anything.

### Stage 1: LDtk Load + Preflight + Tileset + Camera Brain Graybox
1. Vite + TypeScript + `aicraft-engine@0.22.0`. Wire the loop via `recipes/fixed-tick-game.ts`'s `startFixedTickGame` — `createGameLoop` with the §2 `onError` handler and the reduced-motion gate in one call — so a throw can't silently freeze the loop.
2. `loadLdtkProjectAssets({ projectUrl })` the supplied `.ldtk` + PNG(s) in one call.
3. **Asset preflight (G3):** `inspectLdtkPlatformerProject(project)` — log the FULL report: `levelCount`, per-level `neighbourIids` and `connected`, and `capabilities` (including `multiRoom`). Treat `capabilities.multiRoom === true` as the signal that Stage 3 is in scope. (Recall §5.1: `capabilities.exits` counts Exit ENTITIES only — `false` here even though all six rooms are chained.) Missing springs/dash-refills/etc. are informational; a total lack of spawns is the only hard block.
4. `createLdtkRoomCache(project, {...}).getStartRoom()` the start room; render it through the painter (`recipes/ldtk-draw-pipeline.ts` over `createLdtkLevelSurfaceCache`, which bakes via `drawLdtkLevel`).
5. Wire `createCameraBrain` + the per-room **Celeste preset** vcam (`celesteFollowVcam(room.ldtkLevel.iid, { viewport, dpr, followX: CELESTE_FOLLOW_AHEAD })` — the campaign-constant `celesteCameraZoom` window, no-deadzone centered Y, half-life 0.15 s).
6. Drive the kernel with `PRECISION_PLATFORMER` (no Celeste opt-ins yet) so a box walks and jumps across the tileset. **This box is a temporary graybox only** — it is replaced by the `Player.png` sprite at the very start of Stage 2 (there is intentionally no "procedural player then swap to sprite" phase).
7. **Wire §5.7 LDtk hot reload (dev-time, standard).** Author the `vite.config.ts` watcher plugin and the `import.meta.hot` handler exactly as §5.7 specifies (cache-busted re-load, fresh cache from `ROOM_CACHE_OPTIONS`, iid-resolved active room, painter rebuilt + `apronCache.clear()`, transactional reject). From this stage on, the design loop for every later stage is "edit `public/celerock.ldtk`, save, watch it land live."
8. **Gate:** the supplied tileset renders pixel-crisp and untinted; the Celeste-preset camera follows at the campaign-constant zoom with the complete one-screen room visible and centred, **with the window margin masked** (`applyCameraLetterbox` — bars + clip, §5.4) so the room's edge is visible as an edge at every window size; the player does not moonwalk; **saving a trivial `.ldtk` edit while the graybox walks lands live within ~1 s with the box's state preserved.** Establish the §5.4 render skeleton here — one `composeCameraTransform`, every world layer after it — because every layer added in Stages 2–5 inherits it.

### Stage 2: Celeste Movement Feel + Sprite Player
1. Apply the full `playConfigFor` kit (`groundDuckEnabled: false` is baked into `playConfigFor` — §4.1; `climbEnabled` is a harmless default, since the shipped pack has no ladders), plus the Celeste-default key bindings (§4.3: Arrows + `C` jump / `X` dash / `Z` grab / `R` respawn — do NOT use the engine's `STANDARD_KEYBOARD_PLATFORMER_MAP`).
2. **Render the sprite player from the first play tick.** Load + compile `Player.png` at boot and draw via the §4.4 pipeline (its policy block is canonical). The Stage-1 graybox is removed here; the procedural body is wired ONLY as the boot-time load-failure fallback (`compiled === null`).
3. Verify dash (startup freeze, 8-dir, refill on land), wall-slide (decaying), wall-jump, wall-grab (stamina, climb, direction-aware climb-jump, ledge mantle), springs, dash-tech.
4. **Gate:** all five core abilities demonstrably work in the supplied rooms AND the player renders as the `Player.png` sprite (not a box, not the procedural body). Stamina drains and refills. Dash refills on land.

### Stage 3: Seamless Room Transitions
1. Wire the session orchestrator (§5.5): `createRoomTransitionSession()` once at boot; per tick `pollRoomTransition(session, state.core, active.ldtkLevel, project)`; on `'exit'` resolve the neighbour from `createLdtkRoomCache` (lazy compile + cache by `iid`), `mapLdtkRoomEntry` → `transitionPlatformerToRoom` (pass `destinationSolids` from the cached `CompiledLdtkRoom`) → `beginSessionRoomSlide` (adopt `session`/`brain` only when `begun.ok`).
2. Preserve `vx`/`vy`/`facing` across the seam; revalidate support via `destinationSolids`; carry particles with `rebasePointBetweenLdtkRooms` / `slide.particleRebaseDelta`.
3. Advance per presentation tick with `advanceSessionRoomSlide(session, dt, brain)`; drive the slide camera yourself from `session.slide` via `presentationForRoomSlide` + `updateCameraBrain` (both rooms render, continuous screen position, the campaign-constant `celesteCameraZoom` lens riding `CELESTE_ROOM_SLIDE_OPTIONS`; immediate seam-aligned cut only under reduced-motion). On death/retry/teleport/reset call `endRoomTransitionSession(session, brain, 'destination')` — never a bare slide cancel.
4. **Gate:** the §12.3 transition smoke test exists as a passing test file — `tests/transition-smoke.test.ts` — before Stage 4 begins. Walking/falling/jumping off a room edge flows into the next room with momentum and a smooth slide; the camera does not pop; a second transition cannot begin mid-slide.

### Stage 4: Hazards + Strawberries + Save
1. Hazard AABB checks (static + moving-platform-child); death → hit-stop → respawn at last checkpoint.
2. **Entity art (§7.1):** copy `recipes/ldtk-entity-art.ts` in and build the override map with `ldtkEntityTileOverride(active, tilesets)` — the engine-owned `room.entityArt` join, keyed by entity id; there is NO index to build, memoize, or rebuild — then wire `drawLevelEntity` + that `drawOverride` (it calls `drawLdtkEntityTile` with the def's parsed `tileRenderMode`). Spikes and the strawberry must draw as their authored `celerock.png` tiles from the first tick they appear — resized spike strips **repeat-tiled**, never stretched. Entities with no assigned tile keep the engine's `DEFAULT_ENTITY_PALETTE` shape.
3. `derivePickups` → `collect` → `writeSave` per room, keyed by `level.iid`.
4. Death counter increment + persistence.
5. Start menu (§8): NEW GAME / RESUME GAME selection via `createMenuNav` (grace, wrap, jump/dash/grab confirm) — NEW GAME wipes the persisted save; RESUME appears once the save carries progress (`hasPersistedProgress`, `clampMenuNavIndex` on reveal).
6. **Gate:** hazards kill and respawn correctly; **spikes and the strawberry render as their LDtk tiles (§12.7 #16)**; strawberries persist across reload; death counter persists; NEW GAME starts from a wiped save, RESUME from the boot-loaded one.

### Stage 5: Juice + Polish
1. Dash-into-wall hit-stop + shake; hard-landing shake; landing dust; dash trail.
2. Squash & stretch (`advanceSquash`) — **procedural-fallback body only**; the supplied `Player.png` sprite stays stable 1:1 (squash distorts pixel art — §4.4). Spring-rod hair (optional under the sprite); parallax background.
3. **Wind ambience + snow drift (§9's recipe)** — the seeded gust envelope over one pink-noise sustained voice (every-8th-tick param pushes) and the gust-coupled snow layer in the masked backdrop.
4. **Diegetic stamina feedback (§9)** — tired flash at 10 Hz via the tint cache + sweat drops; prefer it over a bar (add the bar only if playtests ask).
5. **Pause menu (§8)** — a second `createMenuNav`, the muted frozen frame, RESUME/RETRY/QUIT.
6. Stamina bar UI (optional — §9's diegetic read comes first); room title cards; HUD (death counter, dash pips).
7. **Gate:** the game feel matches Celeste-tight. The dash-into-wall bonk is satisfying. Grab/stamina reads clearly. **Every particle layer added here draws after §5.4's `composeCameraTransform` in raw world coordinates** — dash away from the room origin and confirm the trail travels with the player rather than drifting toward a fixed screen point (§13 gate 12). The wind swells (§13 gate 14) and the pause menu freezes (§13 gate 13).

### Stage 6: Audio
1. `createAudioAdapter` + all §10 cues; unlock on first gesture.
2. **Gate:** every ability has a distinct cue; the wall-slide is ONE sustained `startNoiseLoop` scrape started on `startedWallSlide` and stopped when sliding ends (no per-tick one-shots — hold into a wall and listen: a soft continuous scrape, not a buzz); reduced-motion path creates no audio adapter.

### Stage 7: Verification
1. **Enumerate §12's artifacts file by file and confirm each exists and passes** — the build is incomplete while any is missing (this is where a long build skims: a real build shipped green while §12.1b, §12.1c, and three §12.1 sub-bullets simply did not exist): `tests/ldtk-load.test.ts` (§12.1 incl. the clip/fields/entity-art contracts), `tests/seam-respawn.test.ts` (§12.1b), the §12.1c hot-reload assertions (vitest where possible, the Playwright gate for the dev-server paths), `tests/dash-bonk.test.ts` (§12.2), `tests/render-composition.test.ts` (§12.2b), `tests/transition-smoke.test.ts` (§12.3), `tests/persistence.test.ts` (§12.4/§12.5), `tests/determinism.test.ts` (§12.6), `tests/static-contracts.test.ts` (§12.1d), and **the game-harness tests that drive `stepGame` itself** (the §12 preamble — cue wiring, respawn facing, feel bounds).
2. Grep for forbidden patterns (§12.8) — as `scanForbiddenIdentifiers('src') === []`, run as a test, not as a manual grep nobody runs.
2b. **Run `./celerock-wiring-check.sh --final` (§12.9 + §12.10) and paste the output into the postmortem.** This is the only place §12.10 runs. Everything prints nothing when clean; "prints nothing" is the artifact. If this is the first time §12.9 has been run, the build did not follow §14 and the greps are now an autopsy rather than a gate — say so in the postmortem.
3. Capture the §13 screenshots; **assert the manifest** (`missingShotManifest` from `recipes/game-test-harness.ts` returns `[]`) so a gate whose capture silently skipped fails the suite instead of shipping as a dangling reference.
4. **Gate:** all tests pass; no forbidden patterns; screenshots confirm faithful tileset + Celeste feel.

---

## 15. Stretch Goals (only after criteria 1–24)

- **"Focus" virtual camera.** A second vcam with higher `priority` that takes over for vistas, reveals, or boss moments (a `fixed` body or tighter follow), blended in/out via the brain's priority selection.
- **Badeline chase ghost (visual only):** render a tinted "ghost" whose input snapshot is the player's from N frames ago — buffer the last N `PlatformerInput`s in a ring, replay them through a second kernel instance each tick. No new physics code.
- **Cosmetic hair colour unlocks** via `generateSkinVariants` + `createMemoryIAPAdapter` from the `cosmetics` + `iap` pillars.
- **Per-room seeded palette** for parallax/UI accents via `generatePalette`, kept strictly off the level tiles.

---

## 16. Install & Version

```bash
npm install aicraft-engine@0.22.0
```

`0.22.0` is the pin for this brief — the feel-hardening release on top of `0.21.1` (the tuned `*_EFFECT` presets + `spawn` gravity/drag options, the warn-once plausibility guards, `Particle.colorEnd` + `particleColorAt`, `createPlatformerState`'s `facing` parameter, and the `feel-effects`/`game-test-harness` recipes). `0.21.1` was a docs + recipes maintenance release on top of `0.21.0` (the `image-decoder` recipe, corrected recipe docs, and this brief's audit corrections; no engine API change). `0.21.0` brought the **seconds-facing particle API** (`stepSeconds`/`advanceSeconds` + `DEFAULT_PARTICLE_AIR`, §9: the engine owns the seconds→ticks conversion), the **hit-stop whole-ticks guard**, and the **recipes directory shipped in the tarball** (§1's catalog, copyable from the installed package) — on top of the `0.20.0` **TAL-sourced additions** (authored sprite-clip extensions + the `climb` kind, `TriggerProps.fields`, the FallingBlock recipe, the multi-device input merge + frozen-map extenders, menu navigation; above), the **entity-art side channel** (`room.entityArt`, §7.1: the engine-owned join keyed by entity id), the **session `cameraRebaseDelta`** (§5.5: screen-continuous parallax across slide-space rebases), the **Celeste camera preset** (`celesteCameraZoom`/`celesteFollowVcam`/`CELESTE_ROOM_SLIDE_OPTIONS` + `devicePixelSnapThreshold`, §5.4), and **sustained-voice modulation** (`setFrequency`/`setQ`, pink noise, §10) — on top of the 0.18.0 **seam apron** (`createSeamApronCache` in the tick set so every seam crossing lands flush, §5.3/§5.5), the 0.17.4 **render-composition pair** (`composeCameraTransform`, §5.4's one world transform; `applyCameraLetterbox`, §5.4's contain-fit mask), the **surface-cache smoothing guard** (crisp platforms under fractional zoom), **`canvasCssViewport`** (§5.4's viewport-units rule), the **`drawSprite` `snap` option** (§4.4's shimmer fix), the **FIXES.md hardening pair** (§4.4's clip player, §5.4's `snapCameraBrain` + `cameraTransform`), and **physics v14** (order-independent collision snap + the spring auto-jump buffer; v13 replays rejected), on top of the 0.16.0 entity-art pair and the room-transition session line:

The inherited additions are all still required (each version's full story lives in §1's install blockquote and the CHANGELOG): the **`0.6.0`** camera brain + LDtk loader + Phase 0–9 movement overhaul (`LaunchIntent` arbitration, decaying wall-slide, 8-dir dash + dash-tech, wall-grab/stamina, corner correction); the **`0.7.0`** golden path (`loadLdtkProjectAssets`, `inspectLdtkPlatformerProject`, `compileLdtkRoom`/`createLdtkRoomCache`, unit-aware config scaling, exported input maps + solid-id helpers, the `'rest-on-surface'` spawn fix, loop `onError`); the **`0.9.0`** feel channel `state.moments`, the pure transition helpers + slide orchestrator + `fitCameraZoom`, and the mantle wave (physics v12: `wallJumpLaunched` deliberately widened to also cover away climb-hops; a manually-constructed `PlatformerState` needs `moments: []`); the **`0.15.0`** room-transition session orchestrator + per-axis containment latch + preflight `multiRoom`; and the **`0.16.0`** entity-art pair — the authoritative `tileRenderMode` parse and `drawLdtkEntityTile` (§7.1 renders through it; §12.8 keeps its blanket no-manual-tile-blit rule with no carve-out).

The camera/LDtk/movement floor is `0.6.0`; the golden-path helpers need `0.7.0`; the feel moments + transition/slide/fit helpers + mantle wave need `0.9.0`; the destination view `0.11.0`; the surface cache `0.12.0`; sustained audio `0.13.0`; the direction-aware wall-jump `0.14.1`; the transition session `0.15.0`; the entity-art pair `0.16.0`; **the clip player + camera snap/transform + per-emitter gravity + NineSlice need `0.17.0`; the `drawSprite` `snap` option needs `0.17.1`; `canvasCssViewport` needs `0.17.2`; the surface-cache smoothing guard needs `0.17.3`; `composeCameraTransform` + `applyCameraLetterbox` need `0.17.4`; the seam apron needs `0.18.0`; `room.entityArt`, `cameraRebaseDelta`, the Celeste preset, and sustained-voice modulation need `0.19.0`; **the tag extensions + `climb` kind, `TriggerProps.fields`, the FallingBlock recipe, the input merge + extenders, and menu navigation need `0.20.0`**; **`stepSeconds`/`advanceSeconds`, the hit-stop whole-ticks guard, and the tarball-shipped recipes directory need `0.21.0`**; **the `*_EFFECT` presets, `colorEnd`/`particleColorAt`, the plausibility guards, and the `facing` respawn parameter need `0.22.0`** — and physics v14 (v13 replays rejected) makes `0.17.0` the hard floor. Do not pin below `0.22.0`.

---

**Build order:** LDtk load + tileset + camera brain graybox → Celeste movement feel → seamless `__neighbours` transitions → hazards + strawberries + save → juice + polish → audio → verification.

**The game is not done when the LDtk renders. It is done when the supplied tileset is drawn faithfully, every entity the `.ldtk` dressed wears its own authored tile (§7.1), the Celeste-preset camera follows at the campaign-constant window zoom with the margin masked, and slides cleanly between rooms (0.65 s easeOutCubic, momentum + screen position continuous at the seam), the Celeste kit (dash + grab/stamina + wall-slide + wall-jump + dash-tech) all feel tight, the dash-into-wall bonk fires hit-stop and shake, a human player can traverse the supplied LDtk end-to-end, and saving the `.ldtk` mid-run lands live without losing the run (§5.7).**
