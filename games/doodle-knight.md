# Prompt: "Doodle Knight" — a procedural endless climber with music-driven difficulty on `aicraft-engine@0.17.1`

> Paste this whole document to a coding agent (Claude / Cursor / etc.). It is a complete build brief: concept, tech stack, architecture mapped to the engine's real API, the **five-band climb structure** that is the heart of the game, per-system specs, ASCII climb map, implementation stages, acceptance gates, and anti-shortcut checks. The agent should produce a single runnable Vite + TypeScript browser game that imports everything from `aicraft-engine` (the npm package) and writes **no** re-implementations of what the engine already provides.

---

## 0. You are building

**Doodle Knight** — a *Doodle Jump* homage: a mobile endless vertical climber. A chunky Sokpop-outlineRect knight auto-bounces whenever it lands on a platform — the player never presses jump. The only control is **horizontal movement** (left/right via keyboard, on-screen touch buttons, or device tilt through the gamepad left-stick X). The camera follows **upward only**; falling off the bottom of the viewport is death. Platforms are **procedurally spawned** above the camera via `mulberry32(runSeed)` — same seed = same climb forever (replay-perfect). Springs and jetpacks spawn as power-ups; monsters drift up from below and must be out-climbed. Three cosmetic characters: the default Knight (free), the Wizard (IAP), and the Golden Knight (earned at altitude 1000). One-thumb on mobile.

**The climb is structured as five altitude bands** — Meadow → Caverns → Skies → Storm → Stratosphere — each with its own palette, platform mix, monster density, power-up rolls, and music emphasis. The bands are what make the climb feel like distinct chapters instead of a monotonic difficulty ramp; Doodle Jump's variety comes from rotating environmental zones, and Doodle Knight captures that in a vertical slice. Bands are altitude-driven (pure function of altitude); within a band, the seeded RNG and the music-drives-difficulty coupling drive the specifics.

The feel target is **floaty Sokpop-meets-Doodle-Jump**: loose physics, a whip-physics helmet plume, a procedural chiptune whose lead track's note density **is** the difficulty curve (composing with the band tables, not fighting them — §5.3.3), and the cleanest demo of the `cosmetics` + `iap` pillars.

**Non-negotiable: build the entire game on top of `aicraft-engine@0.17.1`.** Do not hand-roll fixed-step loops, AABB collision, the camera, platform spawning randomness, particle stepping, jump arcs, the music sequencer, audio synthesis, or a cosmetic/IAP store. If you find yourself writing a `requestAnimationFrame` accumulator, an AABB resolver, a hand-rolled platform spawner that is not seeded by `mulberry32`, a raw `OscillatorNode`, or `Math.random()` in the simulation, STOP and use the engine instead.

This prompt has **THREE headlines**, the only one in the catalog with three:

1. **Procedural level generation via `mulberry32`** (§5.5) — the *only* prompt in the catalog where the level is procedurally generated, the explicit **counter-example to World 1-1's hand-authored `LevelData`**. Doodle Knight does NOT use `LevelData`, `compileLevel`, or a tile grid — platforms are runtime-spawned `Solid` entities. The spawner is **band-aware** (§5.3): altitude selects the band, the band's probability table gates the seeded rolls, and same `runSeed` still produces byte-identical climbs.
2. **Procedural music via `createNoteFirePlayer`** (§9) — the `music` pillar's **new 0.4.0 path**. The fixed-step loop owns `SequencerState`, calls `advanceSequencer` once per tick, and feeds `NoteFire[]` events to `createNoteFirePlayer(audio)`. Doodle Knight is the **second prompt** (after Flipside) to make music first-class, and additionally **couples the lead track's note events to spawn density** — the music IS the difficulty curve (composed with the band tables, not against them).
3. **Cosmetics + IAP** (§10) — three characters (free / IAP / earned), the cleanest demo of those pillars.

**This is NOT a tech demo.** It is a designed game with five distinct altitude bands, each with a unique visual identity, escalating mechanics, and a hand-tuned probability table. The previous design failed because it had **one monotonic difficulty curve** — a linear `minGap = 40 + altitude * 0.02` that felt the same at altitude 100 as at altitude 900, with one shared green palette throughout. This brief fixes that failure by giving the climb five chapters. The lesson is the same one Flipside learned: a procedural generator with no authored identity produces mush.

---

## 1. Tech stack & install

```bash
npm create vite@latest doodle-knight -- --template vanilla-ts
cd doodle-knight
npm install aicraft-engine@0.17.1
```

> This brief targets the published `0.17.1` API exactly. It was originally
> written against `0.4.0` and repinned; **every API it names still exists and
> compiles at `0.17.0`** — the export surface has been additive. The features
> it leans on landed in `0.4.0` and still hold: the
> `PlatformerConfig.jumpEnabled` switch, signed platformer gravity, the
> fixed-step `advanceSequencer` step-boundary fix, `createNoteFirePlayer`, and
> the `volumeScale` sign (positive for stretch-up, negative for squash).
> Do not pin below `0.17.1`.
>
> Since `jumpEnabled: false` means the knight never fires the jump ability,
> the kernel's jump-adjacent changes (the `0.14.0` direction-aware wall-jump,
> the `0.9.2` super-jump grace fix, the `0.9.0` mantle) cannot reach this
> game. **Compatibility breaks that do apply:** the replay physics version is
> now **13**, so the §19 high-score share codes cannot verify against any hash
> recorded before this repin (v10–v12 replays are rejected); a manually-
> constructed `PlatformerState` needs `moments: []`. Worth adopting: `0.14.1`
> fixed landings that arrive **exactly flush** with a platform — previously
> such an arrival reported no landing at all, which for an auto-bounce climber
> is the difference between a bounce that reads and one that silently drops
> its squash and its audio. Since the whole game is landing on platforms, take
> this fix rather than compensating for it in game code, and prefer
> `state.moments`' landing impact ratio over a hand-rolled `vy` threshold.

- **TypeScript**, strict. Target ES2021, `moduleResolution: bundler` (matches the engine; Vite resolves its ESM fine).
- **Vite** dev server + build. Single `<canvas>` in `index.html`.
- **`aicraft-engine`** is your only runtime dependency. Import **only** from the root barrel:
  ```ts
  import {
    // primitives — vector look, canvas, hit-stop, glow, parallax, bitmap text
    outlineRect, lerp, clamp, floor, approach, mixHex,
    prefersReducedMotion, getDevicePixelRatio, resizeCanvasToBackingStore,
    createHitStop, triggerHitStop, stepHitStop, isHitStopActive, DEFAULT_HIT_STOP_DURATION,
    drawGlow, DEFAULT_GLOW_INTENSITY,
    parallaxOffset, PARALLAX_FAR, PARALLAX_MID, PARALLAX_NEAR, drawTiledParallax,
    drawText, drawTextOutlined, measureText, DEFAULT_FONT, DEFAULT_TEXT_COLOR, DEFAULT_TEXT_SCALE,

    // ★ HEADLINE 1 — rng drives procedural spawning
    mulberry32, nextInt, nextFloat, pick,

    // particles — jetpack flame + monster smoke + landing dust
    spawn, advance, cull, step, sampleConeVelocity,
    createEmitter, stepEmitters,
    DEFAULT_GRAVITY_SCALE, DEFAULT_DRAG_SCALE,

    // animation — squash/stretch, breathing, shake, spring-rod plume
    volumeScale, breathe, DEFAULT_BREATH,
    sineShake, shakeEnvelope,
    createSpringRod, advanceSpringRod, DEFAULT_SPRING_ROD,

    // collision — player↔platform, player↔monster, player↔powerup
    aabbOverlap, type Rect, type Solid,

    // camera — vertical-clamp (follows UP only)
    createCamera, updateCamera, DEFAULT_CAMERA,

    // input — keyboard + touch + gamepad (tilt as axis)
    createKeyboardAdapter, createTouchButton, createTouchButtonSet, createGamepadAdapter,
    createEdgeAccumulator, pressEdge, releaseEdge, pollEdge, orEdges,

    // game-loop + game-state FSM
    createGameLoop, DEFAULT_FIXED_DT,
    createGameState, reduceGameState, isLegalTransition, DEFAULT_GAME_STATE_ADJACENCY,

    // audio — the SHARED AudioAdapter createNoteFirePlayer reuses
    createAudioAdapter, DEFAULT_AUDIO_VOLUME,

    // palette + easing
    generatePalette, resolvePalette, repairContrast,
    easeOutCubic, easeOutBack, easeOutBounce, createTweenState, advanceTween,

    // platformer kernel — jumpEnabled:false; auto-bounce is consumer-side
    createPlatformerState, stepPlatformer, PUZZLE_PLATFORMER,
    type PlatformerConfig, type PlatformerInput,

    // collectibles — altitude milestone coins
    collect, hasCollected, derivePickups, DEFAULT_COLLECTIBLE_RECT,

    // save — high score + character unlocks persist
    createLocalStorageSaveStorage, createMemorySaveStorage,
    loadSave, writeSave, DEFAULT_SAVE_KEY,

    // ★ HEADLINE 2 — procedural music via createNoteFirePlayer
    buildScale, SCALES, secondsPerBeat, secondsPerStep,
    generatePattern, advanceSequencer, createNoteFirePlayer,
    DEFAULT_BPM, DEFAULT_ROOT_MIDI, DEFAULT_SCALE_OCTAVES,
    DEFAULT_STEPS_PER_BEAT, DEFAULT_STEPS_PER_PATTERN, DEFAULT_SWING,
    LOOKAHEAD_MS, SCHEDULE_AHEAD_S,
    type Pattern, type NoteFire, type PatternGenConfig, type SequencerState,

    // ★ HEADLINE 3 — cosmetics + IAP (three characters)
    generateSkinVariants, grantSkin, equipSkin, unequipSkin, migrateManifest,
    DEFAULT_SKIN_PRESET, DEFAULT_COSMETIC_SAVE, DEFAULT_MANIFEST, EQUIP_SLOTS,
    createMemoryIAPAdapter, createLocalStorageIAPAdapter, flushIAPEvents, drainQueue, pushTransaction,
    DEFAULT_IAP_CATALOG, DEFAULT_ENTITLEMENT_SAVE,

    // replay — stretch (share-codes)
    createReplayRecorder, playReplay, replayHash,
  } from 'aicraft-engine';
  ```
  The published package only exposes the root `"."` entry — never deep-import subpaths like `aicraft-engine/music` or `aicraft-engine/platformer`; use the root barrel. Tree-shaking works because every export has `sideEffects: false`.

## 2. Determinism & discipline rules (enforced by the engine — follow them)

- **Fixed-step sim, variable render** via `createGameLoop({ fixedDt: 1/60, step, render })`. Poll input **exactly once per `step`**.
- **No `Math.random()` in the simulation.** Every platform spawn, every powerup roll, every monster jitter, every band-table roll comes from `mulberry32(runSeed)` → `nextInt` / `nextFloat` / `pick`. Same `runSeed` → byte-identical climb forever (including which band each spawn lands in — bands are a pure function of altitude, and altitude is a pure function of the spawn sequence). `Math.random` is only OK for purely decorative audio/visual side-effects that never feed back into game state.
- **No `Date.now()` in the sim.** Time comes from `tick` or the loop's `dt`. (Exception: the daily-seed stretch goal uses `Date.now()` to *select* a seed once at boot — that's selecting, not driving the sim.)
- **Music is deterministic.** Call `advanceSequencer` exactly once per fixed tick, assign its returned state, and pass only its returned events to `createNoteFirePlayer.play`. Same `(runSeed, patternConfig)` → same `NoteFire[]` stream forever.
- **Defensive host access.** Anything touching `window`/`AudioContext`/`matchMedia`/`localStorage` goes through the engine's adapters (`createAudioAdapter`, `prefersReducedMotion`, `resizeCanvasToBackingStore`, `createLocalStorageSaveStorage`, `createLocalStorageIAPAdapter`) — they're lazy, error-swallowing, no-op in Node.
- **Reduced-motion carve-out (audio).** Keep `advanceSequencer` running (so the deterministic music assertion still passes — same seed = same first 16 notes) but **mute `createNoteFirePlayer`** so no audio output. This is the 0.4.0 carve-out for decorative audio.
- **Pure progression ops.** `collect` / `grantSkin` / `equipSkin` / `loadSave` return brand-new state objects; mirror their discipline (never mutate the player, the save, or the cosmetic manifest in place).

## 3. Architecture — engine module → game system map

| Game system | Engine API |
|---|---|
| Game loop (60 Hz fixed) | `createGameLoop`, `DEFAULT_FIXED_DT` |
| FSM (`menu → playing → gameover → retry`) | `createGameState`, `reduceGameState`, `isLegalTransition`, `DEFAULT_GAME_STATE_ADJACENCY` |
| Keyboard + touch + tilt input, edge merging | `createKeyboardAdapter`, `createTouchButtonSet`, `createGamepadAdapter`, `orEdges` |
| **Auto-bounce player controller (no jump input)** | `createPlatformerState`, `stepPlatformer(state, input, solids, dt, PUZZLE_PLATFORMER)` + `PlatformerConfig.jumpEnabled: false` + consumer-side `vy` flip on `events.justLanded` (see §4) |
| **Procedural platform spawning (HEADLINE 1)** | `mulberry32`, `nextInt`, `nextFloat`, `pick` — runtime `Solid[]`, NOT a tile grid, NOT `compileLevel`. Band-aware (§5.5). |
| **Five-band climb structure** | Consumer-local `BAND_TABLES` (§5.3) + `bandForAltitude` (§5.5) — band selection is pure, band tables gate the seeded rolls |
| Platform/player/powerup/monster AABB | `aabbOverlap` |
| **Camera — vertical-clamp (follows UP only)** | `createCamera`, `updateCamera`, `DEFAULT_CAMERA` (target.y clamped, see §8) |
| Helmet plume (whip physics) | `createSpringRod`, `advanceSpringRod`, `DEFAULT_SPRING_ROD` (NEVER raw `advanceSpringChain`) |
| Squash/stretch + breathing + shake | `volumeScale`, `breathe`, `DEFAULT_BREATH`, `sineShake`, `shakeEnvelope` |
| Band-transition palette-shift flash | `createTweenState`, `advanceTween`, `easeOutCubic` |
| Jetpack flame + monster smoke + landing dust | `spawn`, `advance`, `cull`, `step`, `sampleConeVelocity`, `createEmitter`, `stepEmitters` |
| Hit-stop on monster contact | `createHitStop`, `triggerHitStop`, `stepHitStop`, `isHitStopActive` |
| Coin altitude milestones | `collect`, `hasCollected`, `derivePickups`, `DEFAULT_COLLECTIBLE_RECT` |
| High score + character unlock persistence | `createLocalStorageSaveStorage`, `loadSave`, `writeSave`, `DEFAULT_SAVE_KEY` |
| ★ **Procedural music (HEADLINE 2 — THE 0.4.0 path)** | `generatePattern`; fixed-step `advanceSequencer`; `createNoteFirePlayer(audio)` — **not** `createSequencer` |
| Synthesized SFX (bounce, spring, jetpack, death, band-crossing chime) | `createAudioAdapter` — `playTone` / `playNoise` (shares the same context as the note-fire player) |
| Per-band parallax background (drifting clouds, color-shifts per band) | `drawTiledParallax`, `PARALLAX_FAR`, `PARALLAX_MID`, `PARALLAX_NEAR` |
| Chunky vector look + glow + HUD text | `outlineRect`, `drawGlow`, `drawText`, `drawTextOutlined`, `DEFAULT_FONT` |
| Retina canvas + reduced-motion gate | `resizeCanvasToBackingStore`, `getDevicePixelRatio`, `prefersReducedMotion` |
| Per-band palette derivation | `generatePalette`, `resolvePalette`, `mixHex` (never pure black) |
| ★ **Cosmetics + IAP (HEADLINE 3 — three characters)** | `generateSkinVariants`, `grantSkin`, `equipSkin`, `DEFAULT_SKIN_PRESET`; `createLocalStorageIAPAdapter`, `flushIAPEvents`, `pushTransaction`, `DEFAULT_IAP_CATALOG` |
| Stretch — high-score share codes | `createReplayRecorder`, `playReplay`, `replayHash` |

> ⚠ **Doodle Knight does NOT use `LevelData` or `compileLevel`.** Platforms are runtime-spawned `Solid` entities, not a tile grid. Do not go looking for a level file. The `platformer` kernel still resolves collision against the dynamic `Solid[]` you pass to `stepPlatformer` each tick.

## 4. The player — **auto-bounce, the player never presses jump**

The knight is a chunky `outlineRect` body with a spring-rod helmet plume and two eye dots. It bounces the instant it lands — the player has no jump input at all. This is the cleanest demo of the 0.4.0 `jumpEnabled` switch.

- **Physics layer.** Use `stepPlatformer` with `PUZZLE_PLATFORMER` (the loosest config — floaty mobile feel) and `jumpEnabled: false`. The auto-bounce is a **consumer-side velocity flip on `events.justLanded`**, NOT the engine's `jumpAbility`:
  ```ts
  // NO JUMP INPUT — Doodle Knight auto-bounces on every landing.
  // The player never presses jump; the bounce is a consumer-side vy flip.
  const KNIGHT_CONFIG: PlatformerConfig = {
    ...PUZZLE_PLATFORMER,                  // loosest physics — floaty mobile feel
    jumpEnabled: false,                    // <- 0.4.0 switch: the kernel never fires jump
    gravity: 1500,                         // positive gravity only (Doodle Knight never flips)
    maxFallSpeed: 700,
    moveSpeed: 240,
    airControl: 1.0,                       // full air control — one-thumb steering
  };
  let state = createPlatformerState(spawnX, spawnY, KNIGHT_CONFIG);
  // each fixed tick:
  const idleJump = { held: false, pressed: false, released: false };
  const input: PlatformerInput = {
    moveX: edges.left.held ? -1 : edges.right.held ? 1 : 0,
    jump: idleJump,                        // jump NEVER bound — auto-bounce owns verticality
    dash: null,
  };
  const result = stepPlatformer(state, input, solids, dt, KNIGHT_CONFIG);
  state = result.state;
  // Consumer-side auto-bounce: on landing, flip vy upward (negative = up).
  if (result.events.justLanded) {
    state = { ...state, core: { ...state.core, vy: -BOUNCE_VELOCITY } };
    launchStretchTimer = 6;                // positive volumeScale = stretch up
    audio.playTone('sine', 200, 360, 70, 0.14);  // soft boing
  }
  ```
  Stay **positive-gravity** throughout (Doodle Knight never flips — that's Flipside's territory). Do NOT enable `doubleJumpAbility` / `dashAbility` / `wallSlideAbility`; `PUZZLE_PLATFORMER` already disables them.
- **Body render + facing mirror.** Positive `volumeScale` offsets **stretch vertically** (use on launch: `volumeScale(+0.12)`); negative offsets **squash vertically** (use on landing: `volumeScale(-0.10)`). Wrap body+eyes in the mandatory `ctx.scale(facing, 1)` mirror (no moonwalk):
  ```ts
  ctx.save();
  ctx.translate(bodyCx, bodyBottomY);
  ctx.scale(facing, 1);           // <- do NOT omit, or it moonwalks
  outlineRect(ctx, -w/2, -h, w, h, palette.base, palette.outline);
  outlineRect(ctx, -3, -h + 6, 2, 2, palette.accent);   // left eye
  outlineRect(ctx, +1, -h + 6, 2, 2, palette.accent);   // right eye
  ctx.restore();
  ```
- **Helmet plume.** A `createSpringRod` anchored at the head, `restDirection` pointing up. It **whips on jump** (the upward velocity impulse swings it). Advance with `advanceSpringRod` — NEVER raw `advanceSpringChain` (the rod is blowout-proof; the raw chain is not). Draw OUTSIDE the facing mirror — its physics own a screen-space direction.
- **Horizontal wrap.** If `state.core.x` leaves the arena, port to the opposite edge (Doodle-Jump-style screen wrap). This is consumer-side; the kernel does not know about wrap.

## 5. World — Five Altitude Bands (the procedural vertical climb)

Doodle Knight's world is a single vertical climb structured as **five altitude bands**. The bands are the heart of the game: they give the procedural spawner authored identity, the same way Flipside's six rooms give its tile grid authored identity. Without bands the spawner produces monotonic mush — that was the previous design's failure mode.

This section has five parts:
- **§5.1 Logical Resolution & Canvas Spec** — the portrait canvas, platform dimensions, pixelated upscale.
- **§5.2 ASCII Climb Map** — the five bands stacked vertically, an at-a-glance overview.
- **§5.3 Climb Phases — Five Altitude Bands** — the per-band spec table + per-band detail. **This is the headline expansion.**
- **§5.4 Connected Terrain Renderer (Band Visual Identity System)** — per-band platform motifs + per-band parallax palette + band-transition palette-shift flash.
- **§5.5 Procedural Spawner — Band-Aware** — the `mulberry32(runSeed)` spawner (HEADLINE 1), updated to consult the band tables. Same seed = same climb; bands gate which tables the spawner consults.

### 5.1 Logical Resolution & Canvas Spec

Doodle Knight is portrait — the *only* portrait game in the catalog. The logical canvas is sized for a chunky retro-mobile feel that fits Doodle Jump's frame composition: ~5 platforms visible at once, enough to plan the next jump but not so many that the climb trivializes.

| Parameter | Value |
|---|---|
| Logical resolution | **200 × 320** (5:8 portrait) |
| Arena width | 200 px (horizontal wrap at left/right edges) |
| Platform size | 36 × 8 px |
| Player body | ~10 × 14 px |
| CSS upscale | `image-rendering: pixelated` on the canvas; backing store at 200×320, CSS scales to viewport |
| Visible platforms at once | ~5 (gap range 40-120 px ÷ viewport 320) |

Canvas setup:
```ts
const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
canvas.style.imageRendering = 'pixelated';
const dpr = resizeCanvasToBackingStore(canvas, 200, 320);
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
```

**Camera vertical-clamp rationale** (cross-ref §8): the engine's `updateCamera` accepts target + bounds + viewport + config. Doodle Knight clamps the target's Y so the camera can only move **upward** — following down would reveal the falling-off-bottom death trigger early and break the tension. The portrait aspect ratio is what makes this work: in a 320-tall viewport, the player has roughly 200 px of "safe space" above the death line, which is exactly the right amount of forgiveness for an auto-bounce climber.

### 5.2 ASCII Climb Map

```
   altitude  +-----------------------------------------------+  band
   1200+     |  <> <>    <>        <> <>     <>    <> <> <>   |  <-- Stratosphere
             |    (crystal facets, indigo void parallax,     |       all mechanics maxed,
             |     jetpacks common, Golden Knight unlocked)  |       difficulty plateaus
   1000 ===  +-----------------------------------------------+  <-- unlock threshold
             |  ## ##     ###   ##    ## ##   ###  ###       |  <-- Storm
   600-1000  |    (dark metal rivets, lightning parallax,    |       jetpacks introduced,
             |     moving platforms dominant, peak music)    |       max monster density
   600  ===  +-----------------------------------------------+
             |  ()()  ()()()   ()()   ()()()  ()()  ()()()   |  <-- Skies
   300-600   |    (cloud puffs, bright cumulus parallax,     |       moving platforms intro,
             |     springs common, full band plays)          |       1 monster / 3 platforms
   300  ===  +-----------------------------------------------+
             |  ..  ...    ..   ....  ..  ... ..             |  <-- Caverns
   100-300   |    (rocky cracks, stalactite parallax,        |       breaking platforms intro,
             |     first monsters, bass enters)              |       1 monster / 5 platforms
   100  ===  +-----------------------------------------------+
             |  ~~   ~~~     ~~    ~~~   ~~  ~~~             |  <-- Meadow
   0-100     |    (rounded leaves, dawn-cloud parallax,      |       onboarding, 0 threats,
             |     sparse lead only, learn the bounce)       |       100% normal platforms
   0    ===  +-----------------------------------------------+  <-- START
                        O  <- Knight spawns here
```

- **Climb direction:** upward (altitude increases as `START_Y - state.core.y` grows).
- **Vertical slice completion target:** altitude 1000 (the top of Storm, entering Stratosphere). Expected playtime 4-7 minutes (§12.2).
- **Band boundaries:** altitude 100 / 300 / 600 / 1000. Each crossing fires the band-transition palette-shift flash + chime (§5.4.3).
- **Endless mode:** altitude 1000+ (Stratosphere). Difficulty plateaus; the climb is theoretically endless.

### 5.3 Climb Phases — Five Altitude Bands

This is the headline expansion. Replace the previous monotonic difficulty ramp with **five distinct altitude bands**, each with its own identity. The spawner selects the band from altitude (pure function); within a band, the seeded RNG and the music-drives-difficulty coupling drive specifics (§5.5).

#### 5.3.1 Band Summary Table

| # | Band | Altitude | Platform mix (N / B / M) | Gap range (px) | Monster density | Power-ups | Music emphasis |
|---|---|---|---|---|---|---|---|
| 1 | **Meadow** | 0-100 | 100 / 0 / 0 | 40-60 | none | none | sparse lead only |
| 2 | **Caverns** | 100-300 | 75 / 25 / 0 | 50-75 | ~1 per 5 platforms (20%) | spring 8% | lead picks up + bass |
| 3 | **Skies** | 300-600 | 55 / 20 / 25 | 60-90 | ~1 per 3 platforms (33%) | spring 12% | busy lead + drums |
| 4 | **Storm** | 600-1000 | 35 / 20 / 45 | 70-110 | ~1 per 2 platforms (50%) | spring 10% + jetpack 4% | peak intensity |
| 5 | **Stratosphere** | 1000+ | 30 / 25 / 45 | 80-120 | ~1 per 2 platforms (50%) | spring 10% + jetpack 5% | peak + cycling variations |

Platform mix rows sum to 100%. **N** = normal, **B** = breaking (despawns after 1 bounce), **M** = moving (horizontal). Each mechanic has a teaching band — no mechanic appears before its introduction:

- Normal platforms: all bands.
- Breaking platforms: introduced in **Caverns** (band 2). Never spawn in Meadow.
- Moving platforms: introduced in **Skies** (band 3). Never spawn in Meadow or Caverns.
- Monsters: introduced in **Caverns** (band 2). Never spawn in Meadow.
- Springs: introduced in **Caverns** (band 2). Never spawn in Meadow.
- Jetpacks: introduced in **Storm** (band 4). Never spawn in Meadow, Caverns, or Skies.

#### 5.3.2 Per-Band Detail

Each band has the same ten-field spec. Palette derivation uses `generatePalette` + `resolvePalette` + `mixHex` — **never pure `'#000000'`**; every band's outline is `mixHex(bandBase, '#000000', 0.4)` at darkest.

---

**1. Meadow (altitude 0-100) — onboarding**

- **Arc / role:** Safe onboarding. The player learns the auto-bounce (§4) with no threats and no choices — just feel the verb. No deaths should occur here.
- **Palette:** `resolvePalette(generatePalette({ seed: runSeed + 0, hue: 'green' }))` → bright green base, soft white highlight, deep green outline.
- **Platform mix:** 100% normal / 0% breaking / 0% moving.
- **Gap-width range:** 40-60 px. Generous — the auto-bounce clears any gap comfortably.
- **Monster density:** 0. The Meadow has no monsters.
- **Power-up mix:** none. Springs and jetpacks are introduced later.
- **Unique silhouette:** Rounded green platforms with leaf detailing drift over pale-dawn parallax clouds. The friendliest frame in the game.
- **Music emphasis:** Sparse lead only — 1-2 notes per second. Bass and percussion silent. This is the quietest the music ever gets.
- **Difficulty target:** 0 deaths expected on first attempt. ~30-45 seconds to clear.

---

**2. Caverns (altitude 100-300) — monster + breaking-platform introduction**

- **Arc / role:** First stress. The player learns to out-climb monsters and that some platforms crumble after one bounce. Two mechanics introduced together so the player associates "deeper = harder."
- **Palette:** `resolvePalette(generatePalette({ seed: runSeed + 1, hue: 'blue-grey' }))` → cool blue/grey base, frosty highlight, slate outline.
- **Platform mix:** 75% normal / 25% breaking / 0% moving.
- **Gap-width range:** 50-75 px. Slightly wider than Meadow but still forgiving.
- **Monster density:** ~1 monster per 5 platforms (20% spawn chance).
- **Power-up mix:** spring 8% / jetpack 0%. The first recovery tool.
- **Unique silhouette:** Rocky grey platforms with crack lines over stalactite-grey parallax. Visibly cooler and harder than Meadow.
- **Music emphasis:** Lead picks up (2-3 notes/sec); bass enters. No percussion yet.
- **Difficulty target:** 0-1 deaths on first attempt. ~45-75 seconds to clear.

---

**3. Skies (altitude 300-600) — variety band**

- **Arc / role:** Full platform vocabulary. Moving platforms introduced; the player learns to time landings on drifting platforms and to dodge monsters in flight. This is the variety peak — every platform type appears, monster density crosses the "engage actively" threshold.
- **Palette:** `resolvePalette(generatePalette({ seed: runSeed + 2, hue: 'cyan' }))` → cyan/white base, bright cumulus highlight, sky-blue outline.
- **Platform mix:** 55% normal / 20% breaking / 25% moving.
- **Gap-width range:** 60-90 px.
- **Monster density:** ~1 monster per 3 platforms (33% spawn chance).
- **Power-up mix:** spring 12% / jetpack 0%. Springs more common — the recovery rhythm establishes.
- **Unique silhouette:** Cloud-puff white platforms with soft highlights over bright cumulus parallax. The brightest, busiest frame.
- **Music emphasis:** Busy lead (3-4 notes/sec); drums kick in. The full band plays.
- **Difficulty target:** 1-2 deaths on first attempt. ~75-120 seconds to clear.

---

**4. Storm (altitude 600-1000) — challenge band**

- **Arc / role:** Peak challenge. Moving platforms become dominant, monster density hits max, and jetpacks appear for the first time — the recovery tool that turns doomed runs back into climbs. The player learns sustained precision and jetpack timing.
- **Palette:** `resolvePalette(generatePalette({ seed: runSeed + 3, hue: 'violet' }))` → purple/dark base, lightning-lit highlight, deep violet outline.
- **Platform mix:** 35% normal / 20% breaking / 45% moving. Moving platforms dominant.
- **Gap-width range:** 70-110 px. Highest variance.
- **Monster density:** ~1 monster per 2 platforms (50% spawn chance). Max density.
- **Power-up mix:** spring 10% / jetpack 4%. Jetpacks introduced.
- **Unique silhouette:** Dark metal platforms with corner rivets over lightning-lit purple parallax. The darkest, most intense frame.
- **Music emphasis:** Peak intensity — lead at max density, full drums, bass driving. The loudest the music gets.
- **Difficulty target:** 1-3 deaths on first attempt. ~90-150 seconds to clear.

---

**5. Stratosphere (altitude 1000+) — endless mode**

- **Arc / role:** The score-chase phase. Difficulty plateaus so the climb is theoretically endless. The Golden Knight unlock fires at altitude 1000 (the vertical-slice completion target).
- **Palette:** `resolvePalette(generatePalette({ seed: runSeed + 4, hue: 'indigo' }))` → deep blue/violet gradient base, faint nebula highlight, indigo void outline.
- **Platform mix:** 30% normal / 25% breaking / 45% moving. All mechanics maxed.
- **Gap-width range:** 80-120 px.
- **Monster density:** ~1 monster per 2 platforms (50% spawn chance). Sustained max.
- **Power-up mix:** spring 10% / jetpack 5%. Jetpacks slightly more common to support endless play.
- **Unique silhouette:** Crystal platforms with iridescent facets over indigo-nebula parallax. The most otherworldly frame.
- **Music emphasis:** Keeps peak; subtle cycling variations (the pattern's `loopCount` modulates a layer) so endless play doesn't go stale.
- **Difficulty target:** Death expected eventually. Time-to-clear N/A (endless); the Golden Knight unlock at 1000 marks the vertical-slice completion target.

---

#### 5.3.3 Composition Rule — Bands and Music Compose, They Do Not Fight

Bands and music-drives-difficulty (§9.3) compose **multiplicatively**. Bands own the **macro arc** (chapter breaks, mechanic introductions, base difficulty floor); music owns the **micro intensity** (moment-to-moment phrase within a band). The composition rule:

```ts
// Bands set the chapter; music sets the phrase within the chapter.
// Band table = base probability; spawnDifficulty (from §9.3) modulates within the band.
// The asymmetry is deliberate:
//   - rewards (spring, jetpack) scale WITH the music (busy lead = generosity)
//   - monsters do NOT scale with the music — that's the band's job
const effectiveSpringChance  = table.springChance  * spawnDifficulty;
const effectiveJetpackChance = table.jetpackChance * spawnDifficulty;
const effectiveMonsterChance = table.monsterChance;                  // NOT modulated
```

This is why music and bands compose rather than fight: a busy lead in Meadow still rolls **0 monsters** (band-chance 0 × any multiplier = 0). A sparse lead in Storm still rolls jetpacks at the floor (band-chance 0.04 × `spawnDifficulty` floor 0.2 = 0.008). The band sets the ceiling and the mechanic roster; the music sets the rhythm within it. The §13.5 music-drives-difficulty test asserts the correlation holds **within each band**, not across bands (where the band table dominates).

### 5.4 Connected Terrain Renderer (Band Visual Identity System)

This is the visual identity system. It lives in the game as `terrain-style.ts` — NOT in the engine. The engine provides `outlineRect` for the base shape, `mixHex` for palette derivation, `drawTiledParallax` for the background, and `createTweenState` + `advanceTween` for the band-transition flash.

Unlike Flipside's connected terrain (which is per-tile via `drawTileGrid` + a neighbor bitmask), Doodle Knight's platforms are runtime `Solid` entities drawn individually. The visual identity system is therefore **per-band platform art + per-band parallax palette + band-transition flash**, not a tile motif system.

#### 5.4.1 Per-Band Platform-Art Spec

A `drawPlatform(ctx, plat, band, palette)` callback closes over the band index and applies a motif-specific interior detail on top of the base `outlineRect`. Five motifs — each band's platforms have a distinct silhouette and interior detail:

| Band | Motif | Visual |
|---|---|---|
| **Meadow** | Leaves | Rounded green platform + 2 small triangle leaf-shapes on the top edge |
| **Caverns** | Cracks | Rocky grey platform + 1-2 thin diagonal crack lines across the interior |
| **Skies** | Cloud puffs | White cloud-puff platform + soft highlight band along the top third |
| **Storm** | Rivets | Dark metal platform + 4 small corner rivet dots |
| **Stratosphere** | Crystal facets | Crystal platform + 2-3 iridescent diagonal facets (alternating `mixHex` tints) |

```ts
function drawPlatform(ctx: CanvasRenderingContext2D, plat: Solid, band: BandIndex, bp: BandPalette): void {
  // Base outlineRect — common to all bands. Never pure '#000000' (§5.3 palette derivation).
  outlineRect(ctx, plat.x, plat.y, plat.width, plat.height, bp.fill, bp.outline);
  switch (band) {
    case 0 /* Meadow */:       drawLeaves(ctx, plat, bp);        break;
    case 1 /* Caverns */:      drawCracks(ctx, plat, bp);        break;
    case 2 /* Skies */:        drawCloudPuff(ctx, plat, bp);     break;
    case 3 /* Storm */:        drawRivets(ctx, plat, bp);        break;
    case 4 /* Stratosphere */: drawCrystalFacets(ctx, plat, bp); break;
  }
  // Breaking platforms overlay a "shatter" visual once bouncesLeft hits 0.
  if (plat.type === 'breaking' && plat.bouncesLeft === 0) drawShatter(ctx, plat, bp);
}
```

**Color derivation** (per band, never pure black):
```ts
const bandPalettes: BandPalette[] = BAND_HINTS.map((hint, i) => {
  const p = resolvePalette(generatePalette({ seed: runSeed + i, ...hint }));
  return {
    fill:      p.base,
    highlight: mixHex(p.base, '#ffffff', 0.30),
    shadow:    mixHex(p.base, '#000000', 0.25),
    outline:   mixHex(p.base, '#000000', 0.40),   // never pure '#000000'
  };
});
```

**Gate:** A five-style sample sheet (one 200×320 screenshot per motif, packed with 8-10 platforms of that band's mix) must be produced and reviewed before band integration. No band is accepted based on unit tests alone.

#### 5.4.2 Per-Band Parallax Palette Spec

The 3-layer `drawTiledParallax` background colors shift per band. Far/mid/near cloud colors transition so the player feels the band change even without looking at the platforms:

| Band | Far layer | Mid layer | Near layer |
|---|---|---|---|
| **Meadow** | Pale dawn blue | Soft white clouds | Bright green hills silhouette |
| **Caverns** | Deep teal | Stalactite grey | Dark stone close-passing |
| **Skies** | Sky blue | Bright cumulus | Wispy white streaks |
| **Storm** | Deep violet | Lightning-lit purple | Dark rain streaks |
| **Stratosphere** | Indigo void | Faint violet nebula | Crystal dust drift |

Each frame, pick the active parallax triple by `bandForAltitude(altitude)` and pass it to `drawTiledParallax`. Cross-fade between triples during the band-transition tween (§5.4.3) so the background doesn't snap.

#### 5.4.3 Band-Transition Visual Cue

When the player crosses an altitude threshold (100 / 300 / 600 / 1000), a brief `createTweenState` palette-shift flash tells the player they've entered a new band. Without this cue, the bands blur together — the previous design's failure mode.

```ts
let bandTransitionTween: TweenState | null = null;
let lastBand: BandIndex = 0;  // Meadow at spawn

// Each fixed tick:
const currentBand = bandForAltitude(altitude);
if (currentBand !== lastBand) {
  bandTransitionTween = createTweenState();
  lastBand = currentBand;
  audio.playTone('triangle', 400, 800, 120, 0.15);  // band-crossing chime
  // Crossing into Stratosphere (band 4) also fires the Golden Knight unlock (§10).
}

// Each render (advanceTween uses real-frame dt, not fixed-step dt):
if (bandTransitionTween) {
  const { value, done } = advanceTween(bandTransitionTween, frameDt, { duration: 0.4, ease: easeOutCubic });
  // value 0->1 fades a full-canvas white overlay from 0.35 alpha down to 0.
  ctx.save();
  ctx.globalAlpha = 0.35 * (1 - value);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 200, 320);
  ctx.restore();
  if (done) bandTransitionTween = null;
}
```

The flash is **not** reduced-motion-gated — it's a gameplay cue (the player needs to know the band changed), not a decorative effect. Reduced-motion only mutes the audio chime.

### 5.5 Procedural Spawner — Band-Aware (HEADLINE 1)

Doodle Knight is the **only prompt in the catalog that procedurally generates the level** — the explicit counter-example to World 1-1's hand-authored `LevelData`. There is no level file. Platforms are runtime `Solid` entities spawned above the camera by a seeded `mulberry32` stream. **The spawner is band-aware**: altitude selects the band, the band's probability table gates the seeded rolls, and the same `runSeed` still produces byte-identical climbs (bands are a pure function of altitude, and altitude is determined entirely by the spawn sequence).

```ts
// Procedural platform spawning — the ONLY prompt in the catalog that does this.
// Same runSeed = same climb forever (replay-perfect for the replay-hash stretch goal).
// NOT LevelData, NOT compileLevel, NOT a tile grid — runtime Solid[] only.
// Band tables (§5.3) gate which probability table the spawner consults at each altitude.

// --- Band selection — pure function of altitude ---
type BandIndex = 0 | 1 | 2 | 3 | 4;
function bandForAltitude(altitude: number): BandIndex {
  if (altitude < 100)  return 0;  // Meadow
  if (altitude < 300)  return 1;  // Caverns
  if (altitude < 600)  return 2;  // Skies
  if (altitude < 1000) return 3;  // Storm
  return 4;                       // Stratosphere
}

// --- Band tables (the §5.3 spec, encoded) ---
interface BandTable {
  mix: { normal: number; breaking: number; moving: number };  // sums to 1.0
  gap: [number, number];                                        // px range
  monsterChance: number;
  springChance:  number;
  jetpackChance: number;
}
const BAND_TABLES: BandTable[] = [
  // 1. Meadow      N    B    M            gap      mon  spr  jet
  { mix: { normal: 1.00, breaking: 0.00, moving: 0.00 }, gap: [40,  60],  monsterChance: 0.00, springChance: 0.00, jetpackChance: 0.00 },
  // 2. Caverns
  { mix: { normal: 0.75, breaking: 0.25, moving: 0.00 }, gap: [50,  75],  monsterChance: 0.20, springChance: 0.08, jetpackChance: 0.00 },
  // 3. Skies
  { mix: { normal: 0.55, breaking: 0.20, moving: 0.25 }, gap: [60,  90],  monsterChance: 0.33, springChance: 0.12, jetpackChance: 0.00 },
  // 4. Storm
  { mix: { normal: 0.35, breaking: 0.20, moving: 0.45 }, gap: [70, 110],  monsterChance: 0.50, springChance: 0.10, jetpackChance: 0.04 },
  // 5. Stratosphere
  { mix: { normal: 0.30, breaking: 0.25, moving: 0.45 }, gap: [80, 120],  monsterChance: 0.50, springChance: 0.10, jetpackChance: 0.05 },
];

// --- The seeded spawner (HEADLINE 1) ---
const spawnRng = mulberry32(runSeed);
const platforms: Solid[] = [];
let nextSpawnY = START_Y;

function spawnNextPlatform(): void {
  const altitude = START_Y - nextSpawnY;
  const bandIdx  = bandForAltitude(altitude);
  const table    = BAND_TABLES[bandIdx];

  // Gap from band table (still seeded — same runSeed = same climb).
  const gap = table.gap[0] + nextFloat(spawnRng) * (table.gap[1] - table.gap[0]);
  nextSpawnY -= gap;

  const x = nextFloat(spawnRng) * (ARENA_WIDTH - PLATFORM_WIDTH);

  // Platform type from band mix (rolled by the seeded stream).
  const roll = nextFloat(spawnRng);
  const type: PlatformType =
    roll < table.mix.normal                                       ? 'normal'  :
    roll < table.mix.normal + table.mix.breaking                  ? 'breaking' :
                                                                    'moving';
  const plat: Solid & { id: string; type: PlatformType; vx?: number; bouncesLeft?: number } = {
    id: `plat-${nextSpawnY}`,
    type,
    x, y: nextSpawnY,
    width: PLATFORM_WIDTH, height: PLATFORM_HEIGHT,
    ...(type === 'moving'   ? { vx: nextFloat(spawnRng) < 0.5 ? -30 : 30 } : {}),
    ...(type === 'breaking' ? { bouncesLeft: 1 } : {}),
  };
  platforms.push(plat);

  // Powerup + monster rolls — band table gates, music modulates (§5.3.3).
  // spawnDifficulty comes from §9.3 (recentNoteCount / 4 clamped to [0.2, 1.0]).
  const r = nextFloat(spawnRng);
  const effSpring  = table.springChance  * spawnDifficulty;
  const effJetpack = table.jetpackChance * spawnDifficulty;
  if      (r < effSpring)                                              spawnSpring(plat);
  else if (r < effSpring + effJetpack)                                 spawnJetpack(plat);
  else if (r < effSpring + effJetpack + table.monsterChance)           spawnMonster(plat);
}
```

- **Keep spawning above the camera top edge.** Each tick, while the highest platform is below `camera.y - SPAWN_AHEAD`, call `spawnNextPlatform()`. Cull platforms that have fallen below `camera.y + viewport.height` (off-screen bottom) — they're gone forever; the player can't fall back to them.
- **Moving platforms** advance their `x` by `vx * dt` and bounce off the arena walls. Rebuild the `Solid[]` you pass to `stepPlatformer` every tick from the current platform array (the kernel reads solids fresh each tick — it never caches them).
- **Breaking platforms** flip to a "shattering" visual on `events.justLanded` and despawn ~8 ticks later (consumer-side timer). They still bounce the player once.
- **Determinism.** Because `bandForAltitude` is pure and the spawn sequence determines altitude, the same `runSeed` produces the same band at the same spawn index, the same platform type at that index, and the same `(x, y)` for every platform — byte-identical across runs. Bands gate the tables; they do not break determinism.

## 6. Hazards — monsters + the bottomless void

Two death conditions, both consumer-side. Neither touches the engine's jump path.

- **Monsters.** Drawn as `outlineRect` blobs in `palette.accent` with two angry eyes. They **drift up over time** (the world scrolls up relative to them) and must be out-climbed. Touching one = death. Some spawn ON platforms (rolled in §5.5 — band-gated); others float in the air. Each monster is a `Rect`; each tick check `aabbOverlap(playerRect, monsterRect)`. On hit:
  ```ts
  if (aabbOverlap(playerRect, monsterRect)) {
    hitStop = triggerHitStop(hitStop, 8);
    audio.playNoise(120, 'lowpass', 400, 0.30);
    fsm = reduceGameState(fsm, { type: 'die' }, dt);
  }
  ```
  Monster smoke: a slow `createEmitter` under each on-screen monster emitting small `palette.feature` particles (negative gravity scale); `stepEmitters` owns it.
- **Falling off the bottom of the viewport.** If `state.core.y + state.core.height > camera.y + viewport.height`, the player fell off — death. This is why the camera is vertical-clamped (§8): following down would reveal the death trigger early.
- **Stomp (optional stretch).** If the player is moving downward (`state.core.vy > 0`) when it overlaps a monster, treat it as a stomp instead of a death — bounce up (`vy = -BOUNCE_VELOCITY`), kill the monster (`spawn` burst), award points. Core loop is bounce-to-survive, but stomp forgiveness keeps near-misses fair.

## 7. Power-ups — springs + jetpack (both consumer-side effects)

Power-ups are `Rect`s rolled onto platforms by the seeded spawner (§5.5). The kernel does not know about them — they're consumer-side state changes on `aabbOverlap`. Both power-ups are band-gated: **springs appear starting in Caverns (band 2), jetpacks appear starting in Storm (band 4)**. Neither ever spawns in Meadow.

- **Spring.** A coiled `outlineRect` drawn on top of a platform. On overlap, set the player's next bounce velocity to a much higher value (e.g. `-BOUNCE_VELOCITY * 2.2`) and set a one-shot flag so the **next** `events.justLanded` flips to the boosted value instead of the default. Visual: the spring squashes flat for 6 ticks (`volumeScale(-0.5)` on the spring art, NOT the player). SFX: a bright `playTone('triangle', 400, 1200, 90, 0.18)`.
- **Jetpack.** A drawn jetpack `outlineRect` on a platform. On pickup, set `jetpackTimer = 120` ticks (≈2s at 60Hz). While active, override gravity: each tick add upward thrust to `state.core.vy` (`state.core.vy -= JETPACK_THRUST * dt`) and clamp to a max ascent. While active, run a `createEmitter` at the player's back emitting flame particles (`sampleConeVelocity` cone pointing down). When `jetpackTimer` hits 0, restore normal gravity. SFX: a looped `playNoise(40, 'bandpass', 600, 0.08)` while active. The jetpack IS the recovery tool — it turns a doomed run into a climb. This is why Storm introduces it: by band 4, the player has experienced enough doomed runs to feel the recovery as a relief.

> ⚠ Both effects mutate the player's vertical velocity. Do this by immutably replacing `state.core.vy` (e.g. `state = { ...state, core: { ...state.core, vy: newValue } }`) — never call the engine's `jumpAbility`. The `jumpEnabled: false` config stays `false` for the entire run; the jetpack is thrust, not a jump.

## 8. Camera — vertical-clamp (follows UP only)

Doodle Knight's camera is the **reverse of every other camera in the catalog**. World 1-1 / Celerock / Flipside all follow the player in both directions. Doodle Knight clamps **upward only** — following down would reveal the falling-off-bottom death trigger early and break the tension. The engine's `updateCamera` already accepts target + bounds + viewport + config; you just clamp the target's Y so it can only move up:

```ts
let camera = createCamera();
// each render:
// Y decreases upward. Clamp the target so the camera NEVER moves down.
const clampedTargetY = Math.min(camera.y, state.core.y);
const target: Rect = {
  x: state.core.x, y: clampedTargetY,
  width: state.core.width, height: state.core.height,
};
camera = updateCamera(
  camera,
  target,
  { width: ARENA_WIDTH, height: Number.POSITIVE_INFINITY },   // vertical world is unbounded
  { width: CANVAS_W, height: CANVAS_H },
  { ...DEFAULT_CAMERA, lerp: 0.15 },
);
```

Built-in snap-to-target handles convergence; do NOT hand-roll a `Math.abs(diff) < 0.1` early-exit. Because `clampedTargetY` is `min(camera.y, player.y)`, the camera tracks the player upward but locks the instant the player starts falling — which is exactly when the §6 death check fires.

## 9. Procedural music via `createNoteFirePlayer` — HEADLINE 2

> Doodle Knight is the **first prompt to use the 0.4.0 `createNoteFirePlayer` path** as its headline. Flipside also uses it; Doodle Knight additionally **couples the lead track's note events to spawn density** — the music IS the difficulty curve, not just background. The coupling **composes with the band tables** (§5.3.3): bands set the chapter, music sets the phrase within the chapter.

### 9.1 Why `createNoteFirePlayer`, not `createSequencer`

The engine exports **two** music host adapters. They are NOT interchangeable:

- **`createNoteFirePlayer(audio)`** — the 0.4.0 path. A **defensive renderer** for externally-advanced `NoteFire[]` events. It owns no clock, pattern, or simulation state — the **game** owns `SequencerState`, advances it in its fixed step via `advanceSequencer`, and feeds the returned `events` in. It reuses the **same `AudioAdapter`** as the SFX (no second `AudioContext`).
- **`createSequencer`** — the alternative host-clock self-scheduling adapter. Doodle Knight does NOT use it. Use `createNoteFirePlayer` here because **the music must be sync'd to the fixed-step sim** — the lead track's note events drive platform-spawn density (§9.3).

### 9.2 The fixed-step pattern

```ts
// 0.4.0 path: the game owns the sequencer state, advances it in the fixed step,
// and feeds the returned NoteFire[] events to the defensive note-fire player.
// `createNoteFirePlayer` reuses the same AudioAdapter as the SFX — no second
// AudioContext, no private sequencer state owned by the engine.

const audio = createAudioAdapter();
const noteFirePlayer = createNoteFirePlayer(audio);

// Generate the pattern once at boot — same seed = same melody forever.
const pattern = generatePattern(runSeed, {
  rootMidi: DEFAULT_ROOT_MIDI,
  scale: SCALES.minorPentatonic,
  bpm: DEFAULT_BPM,
  stepsPerBeat: DEFAULT_STEPS_PER_BEAT,
  stepsPerPattern: DEFAULT_STEPS_PER_PATTERN,
  tracks: [
    { name: 'lead',   waveform: 'square',   volume: 0.18, rhythm: [...], degreeMin: 0, degreeMax: 7 },
    { name: 'bass',   waveform: 'triangle', volume: 0.20, rhythm: [...], degreeMin: -5, degreeMax: 0 },
  ],
});

let seqState: SequencerState = { elapsedS: 0, stepIndex: 0, loopCount: 0 };
const stepDur = secondsPerStep(pattern.bpm, pattern.stepsPerBeat);

// On first user gesture:
audio.unlock();

// In the fixed step:
const dt = 1 / 60;
const { next, events } = advanceSequencer(seqState, dt, pattern);
seqState = next;
noteFirePlayer.play(events);             // defensive — schedules each event via audio.playTone

// Reduced-motion gate: keep advanceSequencer running (deterministic), but mute output:
if (prefersReducedMotion()) noteFirePlayer.setVolume(0);
```

> ⚠ **`dt` units:** the engine's fixed-step loop gives you `dt = 1/60` per tick. Pass it straight to `advanceSequencer` — its window-crossing math expects seconds. Don't multiply first.

### 9.3 Music drives difficulty (the clever bit)

This is what makes the music pillar a **gameplay** feature, not just background. The lead track's note events drive platform-spawn density. When the lead is busy (many notes per second), spawn more springs + jetpacks (rewards correlate with intensity). When the lead is sparse, spawn more gaps (challenge correlates with sparseness). **The music IS the difficulty curve** — composed with the band tables per §5.3.3 (bands set the chapter, music sets the phrase).

```ts
// The lead track's note events drive platform-spawn density.
// When the lead is busy (many notes per second), spawn more springs + jetpacks
// (rewards correlate with intensity). When the lead is sparse, spawn more gaps
// (challenge correlates with sparseness). The music IS the difficulty curve,
// composed with the band tables per §5.3.3.

const recentNoteCount = events.filter(e => e.waveform === 'square').length;  // lead only
spawnDifficulty = clamp(recentNoteCount / 4, 0.2, 1.0);  // consumer-side tuning
// ... feed spawnDifficulty into the band-aware spawner's powerup rolls (§5.5) ...
```

Feed `spawnDifficulty` back into §5.5's spawner: the band table gates which powerups can spawn at all (jetpacks only in Storm+), and `spawnDifficulty` multiplies the spring/jetpack chance within the band (busy lead → more rewards). Monster chance is **not** modulated by music — that's the band's job. Reviewer must be able to read the spawn code and see `events.length` (or `recentNoteCount`) feeding the spawn density, AND see the band table gating the same rolls.

### 9.4 Reduced-motion keeps the seam deterministic

If `prefersReducedMotion()`, set `noteFirePlayer.setVolume(0)` so no audio plays — BUT keep calling `advanceSequencer` every fixed tick anyway. This keeps the deterministic skill-tester assertion passing (same seed = same first 16 `NoteFire` outputs across runs) even with no audio output. This is the 0.4.0 carve-out for decorative audio.

## 10. Cosmetics + IAP — HEADLINE 3 (three characters)

Three cosmetic characters — the cleanest demo of the `cosmetics` + `iap` pillars:

| Character | Unlock | How |
|---|---|---|
| **Knight** (default) | Free | Equipped at boot via `equipSkin(DEFAULT_COSMETIC_SAVE, 'knight')`. |
| **Wizard** | IAP | Purchased via `createLocalStorageIAPAdapter` + `flushIAPEvents`. Catalog entry in `DEFAULT_IAP_CATALOG`. |
| **Golden Knight** | Earned | Auto-granted via `grantSkin` when the player's altitude crosses `1000` for the first time. The unlock fires from the band-transition handler (§5.4.3) on the Storm→Stratosphere crossing. |

- **Variants.** Generate the palette-swap variants once at boot with `generateSkinVariants` from `DEFAULT_SKIN_PRESET`. Each character is a skin variant that overrides the body/plume/eye fill colors — same `outlineRect` body, different palette. Do NOT invent new geometry per character; the art is one knight, recolored.
- **IAP purchase path.** Use `createLocalStorageIAPAdapter` (so purchases persist across reloads on the same browser). On the purchase button, `pushTransaction` then `flushIAPEvents` to grant the entitlement, then `grantSkin` to add the Wizard to the cosmetic manifest:
  ```ts
  const iap = createLocalStorageIAPAdapter();
  pushTransaction(iap, { sku: 'wizard-character', price: 1.99 });
  const { granted } = flushIAPEvents(iap);          // reviewer greps flushIAPEvents — must appear
  if (granted.includes('wizard-character')) {
    cosmeticSave = grantSkin(cosmeticSave, 'wizard');
    writeSave(storage, save);
  }
  ```
- **Equip.** Switching characters calls `equipSkin(cosmeticSave, variantId)` and re-resolves the palette via `resolvePalette`. The body `outlineRect` fill swaps immediately on next render — no reload.
- **Earned unlock.** When `altitude >= 1000` for the first time and the Golden Knight isn't already owned, `grantSkin(cosmeticSave, 'golden')`, persist, and play a fanfare (`playTone('triangle', 480, 960, 600, 0.20)`). This is wired into the §5.4.3 band-transition handler so the unlock and the Stratosphere-entry flash fire together.
- **Persistence.** Both the cosmetic manifest AND the IAP entitlements persist across reload via `save` (`createLocalStorageSaveStorage`). On boot, `loadSave` restores unlocked characters; the equipped character from last session re-equips.

## 11. Game feel + audio (every item uses the engine)

- [ ] **Auto-bounce** on platform landing (consumer-side `vy` flip on `events.justLanded`)
- [ ] **Launch stretch** (`volumeScale(+0.12)` — positive = stretch-up, new 0.4.0 sign) + **landing squash** (`volumeScale(-0.10)` — negative)
- [ ] **Helmet plume whips on bounce** via `advanceSpringRod` (NEVER raw `advanceSpringChain`)
- [ ] **Subtle bounce-shake** on landing (`sineShake` + `shakeEnvelope`, low magnitude)
- [ ] **Jetpack flame emitter** (`createEmitter` + `sampleConeVelocity` cone pointing down) while thrust is active
- [ ] **Monster smoke emitter** under each on-screen monster
- [ ] **Hit-stop on monster contact** (`triggerHitStop`, 8 ticks)
- [ ] **Death burst** (`spawn` particles outward) + descending death tone
- [ ] **Coin sparkle** at altitude milestones (`spawn` + `drawGlow`)
- [ ] **Per-band parallax background** — drifting clouds via `drawTiledParallax` at `PARALLAX_FAR` / `PARALLAX_MID` / `PARALLAX_NEAR`, color-shifting per band (§5.4.2)
- [ ] **Band-transition palette-shift flash** on every threshold crossing (§5.4.3) — gameplay cue, not decorative; only the chime is reduced-motion-gated
- [ ] **Reduced-motion gate** — keep `advanceSequencer` running but mute `createNoteFirePlayer` (§9.4)

**SFX recipes** (all via `createAudioAdapter`, the same context the note-fire player holds):

- **Bounce:** `playTone('sine', 200, 360, 70, 0.14)`. **Spring:** `playTone('triangle', 400, 1200, 90, 0.18)`.
- **Jetpack loop:** `playNoise(40, 'bandpass', 600, 0.08)` while thrust active. **Monster stomp:** `playNoise(60, 'lowpass', 250, 0.18)`.
- **Player death:** `playNoise(120, 'lowpass', 400, 0.30)` + descending `playTone('sine', 400, 80, 200, 0.25)`.
- **Altitude milestone:** `playTone('triangle', 600, 1200, 60, 0.15)`. **Character unlock fanfare:** `playTone('triangle', 480, 960, 600, 0.20)`.
- **Band-transition chime:** `playTone('triangle', 400, 800, 120, 0.15)` on every threshold crossing (reduced-motion mutes this).

## 12. Visual & Play Gates

### 12.1 Screenshot Requirements

Before any band is accepted as complete:

1. **One screenshot per band (5 total)** — full 200×320 screenshots of each band's rendered state, packed with that band's platform mix. Each must show the band's distinct platform motif + parallax palette.
2. **Contact sheet of all five bands** — the five screenshots stacked into a single image, so the visual progression is legible at a glance.
3. **Band-transition flash frame** — one screenshot capturing the palette-shift flash mid-tween (white overlay at ~0.2 alpha) at the moment of crossing altitude 100.
4. **Benchmarker/vision review** — the screenshots must show five distinct visual identities (motifs, palettes, silhouettes, parallax moods). **No band accepted based only on unit tests.** Structural tests prove data correctness, not visual quality.

### 12.2 Playthrough Requirements

- **Target altitude to "complete" the vertical slice: 1000** (top of Storm, entering Stratosphere). This is the vertical-slice completion target referenced throughout §5, §10, and §13.6.
- **Expected playtime: 4-7 minutes** on a first attempt (matches the per-band difficulty targets summed across §5.3.2).
- **What the player should feel at each band:**
  - **Meadow:** safe auto-bounce learning. No threats. The verb becomes muscle memory.
  - **Caverns:** first stress. The first monster near-miss; the first breaking-platform crumble. The player learns "deeper = harder."
  - **Skies:** variety peak. Moving platforms demand timing; monsters demand attention. The player feels the full vocabulary.
  - **Storm:** peak challenge. The first jetpack pickup feels like a relief — the recovery tool that turns a doomed run back into a climb.
  - **Stratosphere:** endless score-chase plateau. The Golden Knight unlock at 1000 lands as a milestone reward. Difficulty stops escalating; the climb becomes about score.
- **Expected deaths on first attempt: 2-6** (summed from per-band difficulty targets: 0 + 0-1 + 1-2 + 1-3 + eventual).
- **Fast retry: <2 seconds** from death to controllable respawn.

### 12.3 Rejection Criteria

The following are grounds for rejecting the build:

- **Five bands that all look like green mush.** Each band must derive its palette from its own seed offset (§5.3) and have a distinct platform motif (§5.4.1) and parallax palette (§5.4.2).
- **No monster introduction pacing.** Monsters must not spawn before Caverns (band 2). A monster in Meadow is an automatic rejection.
- **No breaking-platform teaching moment.** Breaking platforms must not spawn before Caverns.
- **No moving-platform introduction.** Moving platforms must not spawn before Skies (band 3).
- **No jetpack introduction.** Jetpacks must not spawn before Storm (band 4). The "recovery tool" arc requires that no jetpack appears earlier.
- **No band-transition cue.** Crossing altitude 100/300/600/1000 without the palette-shift flash + chime (§5.4.3) means the bands blur together — the previous design's failure mode.
- **A screenshot only of Meadow.** All five bands must be screenshot-reviewed for distinct visual identity.
- **A 16-step music loop.** (Inherited from Flipside's lesson — see §9.) The procedural pattern must run long enough to feel like music, not a ringtone.
- **Missing the 3 cosmetic characters.** Knight, Wizard, and Golden Knight must all be wired (§10).
- **Missing the music-drives-difficulty coupling.** Reviewer must be able to read the spawn code and see `events.length` feeding the spawn density (§9.3, §13.5).

## 13. Tests & Static Contracts

### 13.1 Band Selection

- For each altitude in `[0, 50, 100, 200, 300, 500, 600, 800, 1000, 1500]`, assert `bandForAltitude(altitude)` returns the correct band index per §5.3.1.
- At the exact boundary altitudes (100, 300, 600, 1000), assert the band transitions to the higher band (band 1 starts at altitude 100, not 101).

### 13.2 Per-Band Content Counts

The spawner's `BAND_TABLES` must match §5.3.1 exactly. Assert each row:

| Band | Altitude | Normal % | Breaking % | Moving % | Gap range (px) | Monster chance | Spring chance | Jetpack chance |
|---|---|---|---|---|---|---|---|---|
| Meadow       | 0-100    | 100 | 0   | 0   | 40-60   | 0.00 | 0.00 | 0.00 |
| Caverns      | 100-300  | 75  | 25  | 0   | 50-75   | 0.20 | 0.08 | 0.00 |
| Skies        | 300-600  | 55  | 20  | 25  | 60-90   | 0.33 | 0.12 | 0.00 |
| Storm        | 600-1000 | 35  | 20  | 45  | 70-110  | 0.50 | 0.10 | 0.04 |
| Stratosphere | 1000+    | 30  | 25  | 45  | 80-120  | 0.50 | 0.10 | 0.05 |

Each row's platform-mix percentages must sum to 100%.

### 13.3 Simulation Determinism

- Run the spawner for 200 consecutive `spawnNextPlatform()` calls with a fixed `runSeed`. Record the resulting `platforms` array (`{id, type, x, y, ...}` for each).
- Re-run with the same `runSeed`. The `platforms` array must be **byte-identical** (deep-equal).
- Assert platform at spawn call N=10 is in Meadow (altitude < 100), N=50 is in Caverns or Skies (altitude 100-600), N=100 is in Skies or Storm (altitude 300-1000). Boundary checks confirm band selection matches altitude.
- Assert no monster ever spawns in Meadow (band 0) across the 200-call run, regardless of `runSeed`.
- Assert no jetpack ever spawns before Storm (band 4) — i.e. no jetpack in any platform whose spawn altitude is < 600.

### 13.4 Band-Transition Test

- Script a climb that crosses each altitude threshold (100, 300, 600, 1000) by feeding the spawner altitude values that step past each boundary.
- For each threshold crossing: assert (a) `bandForAltitude` returns the new band index, (b) `bandTransitionTween !== null` immediately after the crossing, (c) `lastBand === newBand`, (d) the band-crossing chime SFX was invoked (mock the audio adapter and assert `playTone` was called with the chime params from §11).
- Assert no transition fires when altitude changes within a band (e.g. altitude 150 → 250 stays in Caverns; `bandTransitionTween` stays `null`).

### 13.5 Music-Drives-Difficulty Test

- Run the spawner for 600 fixed ticks with the music pattern active. Record `(recentNoteCount, spawnOutcome)` per spawn.
- Bin spawns by `recentNoteCount` quartile. The top quartile's spring+jetpack rate must exceed the bottom quartile's spring+jetpack rate by **≥30%**.
- Assert the correlation holds **within each band separately** (run the test scoped to Skies-only spawns, then Storm-only spawns) — the music composes with the band table per §5.3.3, not overrides it.
- Assert monster spawn rate is **not** correlated with `recentNoteCount` (the band owns monster density, not the music).

### 13.6 Vertical-Slice Completion Test

- Run a scripted climb from spawn (altitude 0) to altitude 1000 — the vertical-slice completion target. Assert the climb is mechanically possible end-to-end.
- Assert the Golden Knight unlock fires exactly once when altitude first crosses 1000 (mock `grantSkin` and assert exactly one call with `'golden'`).
- Assert the band-transition flash fired exactly 4 times (at 100, 300, 600, 1000).

### 13.7 Strict Music Determinism

- Same `runSeed` produces the same first 16 `NoteFire` outputs across runs (serialize → string-compare snapshot).
- Reduced-motion path: `noteFirePlayer.setVolume(0)` is called, but `advanceSequencer` is still called every fixed tick and produces the same `events` array. The first-16-notes assertion must pass identically in both motion-preference paths.

### 13.8 End-to-End Climb Test

- Scripted input sequence (left/right held per tick) that drives the player from spawn (altitude 0) through Meadow, Caverns, Skies, Storm, and into Stratosphere (altitude 1000+).
- This is NOT proof of fun — it proves the climb is mechanically possible end-to-end and that every band is reachable via the auto-bounce.

### 13.9 Forbidden Patterns

Static analysis (grep / AST) must find:

- **No `requestAnimationFrame`** in game code (only in the engine's `createGameLoop`).
- **No `Math.random`** in game code (decorative audio/visual side-effects excepted — and only when they provably cannot feed back into game state).
- **No `Date.now`** in game code (the daily-seed stretch goal's boot-time selection excepted).
- **No manual AABB collision** outside the consumer-side `aabbOverlap` calls in §6/§7.
- **No manual jump-arc math** (no `vy += gravity * dt` outside the engine's `stepPlatformer`).
- **No `createSequencer`** (must use `createNoteFirePlayer` — the 0.4.0 path).
- **No raw `OscillatorNode`** outside `createAudioAdapter` / `createNoteFirePlayer`.
- **No `advanceSpringChain`** outside `node_modules` (must use `advanceSpringRod` for the helmet plume).
- **No `stepPlatformer` without `jumpEnabled: false`** in the config (grep confirms the override is present).
- **No `LevelData` / `compileLevel` / `drawTileGrid`** (Doodle Knight has no tiles).
- **No deep imports** (no `aicraft-engine/src/...` — only root barrel).
- **Exactly one `advanceSequencer` call** (grep confirms exactly one occurrence in the step function).

### 13.10 Reviewer Acceptance Checklist (preserved from previous brief)

1. Playable in browser via `npm run dev` with keyboard (**←/→** move) + on-screen touch buttons on coarse-pointer devices + tilt via `createGamepadAdapter` left-stick X as axis.
2. **Auto-bounce on platform landing** — the player never presses jump. `PlatformerConfig.jumpEnabled: false` is set. Reviewer greps `jumpEnabled: false` — must appear.
3. **Procedural platform spawning via `mulberry32(runSeed)`.** Same `runSeed` produces byte-identical climb. Reviewer can re-run with the same seed and get the same first 10 platform positions. NOT `LevelData`, NOT `compileLevel`.
4. **Camera follows upward only.** Falling off the bottom of the viewport = death. Reviewer reads the `updateCamera` call and sees the target Y clamped to `Math.min(camera.y, player.y)`.
5. **At least 3 platform types** (normal, breaking, moving) rolled by the seeded stream — band-gated per §5.3.
6. **At least 2 power-ups** (spring + jetpack), both consumer-side velocity effects — the `jumpEnabled: false` config never flips. Band-gated (spring from Caverns, jetpack from Storm).
7. **Procedural music via `createNoteFirePlayer`.** Game calls `advanceSequencer` in its fixed step, feeds `events` into `noteFirePlayer.play(events)`. Reviewer greps `createNoteFirePlayer` — must appear. `createSequencer` must NOT appear.
8. **Music drives difficulty.** Busier lead track → more rewards (springs/jetpacks). Sparse lead → more gaps. Reviewer can read the spawn code and see `events.length` (or equivalent lead-note count) feeding the spawn density, AND see the band table gating the same rolls.
9. **Strict music determinism.** Same `runSeed` produces the same first 16 `NoteFire` outputs across runs (serialize → string-compare snapshot).
10. **3 cosmetic characters** (1 free default, 1 IAP via `createLocalStorageIAPAdapter`, 1 earned at altitude 1000). Reviewer greps `flushIAPEvents` — must appear in the IAP purchase path.
11. **High score + unlocked characters persist across reload** via `save` (`createLocalStorageSaveStorage` + `loadSave` + `writeSave`).
12. **`prefersReducedMotion` mutes `createNoteFirePlayer`** (no audio output) but **keeps `advanceSequencer` running** (deterministic — the first-16-notes assertion still holds).
13. **Zero hand-rolled reimplementations** — §13.9 grep must return zero matches.
14. **No moonwalk.** Facing horizontal mirror via `ctx.scale(facing, 1)` around the body + eye-dot draw.
15. **No appendage blow-out.** The helmet plume uses `advanceSpringRod`, never raw `advanceSpringChain`. Reviewer greps `advanceSpringChain` outside `node_modules` — must not appear.
16. **New `volumeScale` sign.** Launch-stretch uses a **positive** argument (`volumeScale(+0.12)` = stretch-up); landing-squash uses a **negative** argument (`volumeScale(-0.10)`). Reviewer greps for `volumeScale(-` used for launch or `volumeScale(+` used for landing — neither pattern should appear misused.
17. **Five distinct altitude bands.** Reviewer reads `BAND_TABLES` and confirms five rows with distinct platform mixes, gap ranges, monster densities, and powerup chances per §5.3.1. **(New criterion.)**
18. **Mechanic gating by band.** No monster in Meadow, no breaking platform in Meadow, no moving platform before Skies, no jetpack before Storm. Reviewer reads `BAND_TABLES` and confirms the zeros in the right cells. **(New criterion.)**
19. **Band-transition cue.** Every threshold crossing (100/300/600/1000) fires the palette-shift tween + chime. Reviewer greps `bandTransitionTween` and `bandForAltitude`. **(New criterion.)**

## 14. Preserved Constraints

- **Reduced-motion early gate** — `prefersReducedMotion()` mutes `createNoteFirePlayer` but keeps `advanceSequencer` running (§9.4); the band-transition flash stays (gameplay cue, not decorative); only the chime is muted.
- **Touch + keyboard + tilt input** — `createKeyboardAdapter` + `createTouchButtonSet` + `createGamepadAdapter` + `orEdges`.
- **DPR / pixel scaling** — `resizeCanvasToBackingStore` + `ctx.setTransform(dpr, ...)` at 200×320 logical / `image-rendering: pixelated`.
- **Fixed-step sim** — `createGameLoop({ fixedDt: 1/60 })`.
- **No jump** — `jumpEnabled: false` in `KNIGHT_CONFIG`, idle jump edge fed to the kernel. `PUZZLE_PLATFORMER` inherits `jumpEnabled: true` from `DEFAULT_PLATFORMER_CONFIG`, so the explicit override in `KNIGHT_CONFIG` is mandatory. The auto-bounce is consumer-side (`vy` flip on `events.justLanded`), NOT the engine's `jumpAbility`.
- **Positive-gravity only** — Doodle Knight never flips (that's Flipside's territory). `gravity: 1500` stays positive throughout.
- **Vertical-clamp camera** — target Y clamped to `Math.min(camera.y, player.y)` so the camera follows upward only (§8).
- **Five distinct altitude bands** — no monotonic ramp. Each band has its own palette, platform mix, monster density, powerup chances, and music emphasis (§5.3). Band tables gate the spawner (§5.5).
- **Mechanic gating by band** — no mechanic appears before its introduction band: monsters + breaking platforms in Caverns, moving platforms in Skies, jetpacks in Storm (§5.3).
- **Band-transition cue on every threshold** — palette-shift flash + chime at altitude 100/300/600/1000 (§5.4.3).
- **Zero runtime deps** — `aicraft-engine` is the only dependency.

## 15. Implementation Workflow

Build in this order. Each stage must pass its gate before the next begins.

### Stage 1: Spawner Prototype + 5-Band Sample Sheet

1. Set up Vite + TypeScript + `aicraft-engine@0.17.1`.
2. Implement the band-aware spawner (§5.5): `bandForAltitude`, `BAND_TABLES`, `spawnNextPlatform`.
3. Implement the five platform-art motifs (§5.4.1) and per-band parallax triples (§5.4.2).
4. Produce a five-style sample sheet (one 200×320 screenshot per band, packed with that band's platform mix).
5. **Gate:** Visual review confirms five distinct band identities. No two bands look the same.

### Stage 2: Band Design Review

1. Verify `BAND_TABLES` matches §5.3.1 exactly (platform-mix percentages sum to 100% per row; gap ranges; monster/spring/jetpack chances).
2. Verify band boundaries (100, 300, 600, 1000).
3. Verify no mechanic appears before its introduction band (no monsters in Meadow, no breaking platforms in Meadow, no moving platforms before Skies, no jetpacks before Storm).
4. **Gate:** Band tables reviewed for variety, pacing, and mechanic-gating integrity.

### Stage 3: Graybox Mechanics

1. Wire the game loop, input, auto-bounce controller (`PUZZLE_PLATFORMER` + `jumpEnabled: false` + consumer-side `vy` flip on `events.justLanded`).
2. Implement the vertical-clamp camera (§8).
3. Implement falling-off-bottom death.
4. Implement all three platform types (normal / breaking / moving).
5. Implement springs + jetpacks (§7).
6. Implement monsters + monster-smoke emitter (§6).
7. Implement the band-transition palette-shift flash + chime (§5.4.3).
8. **Gate:** Player can climb from Meadow through Caverns into Skies. Band-transition flash fires on every crossing. Death → respawn works.

### Stage 4: Music + Difficulty Coupling

1. Compose the procedural pattern via `generatePattern` (§9.2).
2. Wire `advanceSequencer` (exactly once per fixed tick) + `createNoteFirePlayer`.
3. Wire music-drives-difficulty: `recentNoteCount → spawnDifficulty → effectiveSpring/JetpackChance` per §5.3.3.
4. Implement reduced-motion gate (§9.4): mute player, keep sequencer running.
5. **Gate:** Music plays for the full pattern length (not a 16-step loop). Spawn density correlates with lead-note count within each band. First-16-notes determinism snapshot passes.

### Stage 5: Per-Band Playtest

1. Playtest each band. Tune gap widths, monster speeds, spring/jetpack frequencies per band.
2. Verify teaching moments: Meadow teaches auto-bounce (0 deaths); Caverns teaches dodge + crumble (0-1 deaths); Skies teaches timing (1-2 deaths); Storm teaches jetpack recovery (1-3 deaths).
3. Verify the band-transition cue is readable — every crossing feels like a chapter break.
4. **Gate:** 4-7 minute first completion to altitude 1000, 2-6 expected deaths, fast retry.

### Stage 6: Connected Terrain Polish

1. Finalize all five platform motifs (leaves / cracks / cloud puff / rivets / crystal facets).
2. Finalize the five parallax palette triples.
3. Add the band-transition cross-fade between parallax triples (§5.4.2).
4. Add monster smoke, jetpack flame, landing dust, death burst.
5. Add launch-stretch + landing-squash tweens (§4).
6. Add helmet plume spring-rod.
7. **Gate:** Five distinct platform silhouettes + five distinct parallax moods. Game feel matches Sokpop-meets-Doodle-Jump.

### Stage 7: All-Band Screenshots + Vision Review

1. Capture full 200×320 screenshots of all five bands (packed with each band's mix).
2. Capture a contact sheet (all five bands stacked into one image).
3. Capture the band-transition flash frame (mid-tween at altitude 100).
4. **Gate:** Vision review confirms five distinct band identities, mechanic-gating by band, readable band-transition cue, no green-mush.

### Stage 8: Cosmetics + IAP + Verification

1. Implement three-character cosmetics + IAP (§10): Knight (free), Wizard (IAP), Golden Knight (earned at 1000, wired into the band-transition handler).
2. Implement save persistence (high score + unlocked characters).
3. Run all static contracts (§13): band selection, per-band content counts, simulation determinism, band-transition test, music-drives-difficulty test, vertical-slice completion, forbidden patterns.
4. Run end-to-end climb test (§13.8).
5. Grep for forbidden patterns (§13.9).
6. **Gate:** All tests pass, no forbidden patterns found, three characters wired, save persists across reload.

## 16. Anti-Failure Wording

**This build is NOT complete merely because the spawner produces platforms.** The previous design (monotonic difficulty ramp, one shared green palette) was a failure because:

- **Monotonic difficulty is a failure.** A linear `minGap = 40 + altitude * 0.02` produces a climb that feels the same at altitude 100 as at altitude 900. The five bands must each have a distinct identity — palette, platform mix, monster density, music emphasis.
- **All-green-mush is a failure.** If all five bands share the Meadow palette, the game has no chapter breaks. Each band must derive its palette from its own seed offset (§5.3) and never be pure black.
- **Monsters in Meadow is a failure.** The Meadow band is onboarding — no monsters, no breaking platforms, no powerups. Monsters introduced in Caverns. Breaking platforms in Caverns. Moving platforms in Skies. Jetpacks in Storm. Each mechanic has a teaching band; no mechanic appears before its introduction.
- **No band-transition cue is a failure.** Crossing altitude 100/300/600/1000 without the palette-shift flash + chime (§5.4.3) means the bands blur together. Every threshold crossing must fire the tween + SFX. This mirrors the Flipside failure mode — six valid `LevelData` objects with one shared box template produced a featureless corridor. Five valid altitude bands with one shared palette is the same failure in a different shape.
- **No jetpack recovery is a failure.** The jetpack is Doodle Knight's recovery tool — without it, doomed runs stay doomed. Storm band must roll jetpacks (~4% of platforms). The "recovery tool" arc requires that no jetpack appears earlier than Storm.
- **Missing the 3 cosmetic characters is a failure.** Knight (free), Wizard (IAP via `createLocalStorageIAPAdapter` + `flushIAPEvents`), Golden Knight (earned at altitude 1000) — all three must be wired. The Golden Knight unlock fires from the band-transition handler on the Storm→Stratosphere crossing.
- **A 16-step music loop is a failure.** (Inherited from Flipside's lesson.) The procedural pattern must run long enough to feel like music, not a ringtone — and the lead-track note density must actually feed the spawner (§9.3, §13.5).
- **A screenshot only of Meadow is insufficient.** All five bands must be screenshot-reviewed for distinct visual identity. No band is accepted based only on unit tests.

## 17. File Layout (Suggested)

```
src/
  main.ts              # boot: canvas, save load, pattern gen, audio.unlock, loop.start()
  game/
    state.ts           # Player, Platform[], Monster[], PowerUp[], SequencerState, FSM, Cosmetics, BandState
    step.ts            # fixed-step: input -> stepPlatformer -> auto-bounce -> band-aware spawn -> music advance -> band-transition check
    render.ts          # parallax -> platforms (band motif) -> powerups -> monsters -> player art -> band-transition flash -> HUD
    spawn.ts           # band-aware procedural spawner (mulberry32(runSeed) + BAND_TABLES) — §5.5
    bands.ts           # bandForAltitude + BAND_TABLES + per-band palette derivation — §5.3, §5.4.1
    terrain-style.ts   # connected terrain renderer (per-band platform motifs: leaves/cracks/cloud/rivets/crystal) — §5.4
    player.ts          # player render: body + eyes + plume (spring-rod); auto-bounce on justLanded
    monsters.ts        # monster drift + AABB + smoke emitter
    powerups.ts        # spring + jetpack effects (consumer-side vy overrides)
    camera.ts          # vertical-clamp updateCamera wrapper
  music.ts             # generatePattern + advanceSequencer + createNoteFirePlayer + difficulty coupling
  cosmetics.ts         # three characters: generateSkinVariants + grant/equip + IAP purchase path + Golden Knight unlock
  audio.ts             # createAudioAdapter + the SFX recipe helpers (incl. band-transition chime)
  save.ts              # createLocalStorageSaveStorage + loadSave/writeSave (high score + unlocks)
  input.ts             # keyboard + touch button set + gamepad tilt (left-stick X as axis)
```

## 18. Stretch goals (only after criteria 1-19 in §13.10)

- **High-score share codes** via `createReplayRecorder` + `replayHash` — an 8-char hex fingerprint of the run. Same seed + same inputs = same hash. Render the code on the game-over screen with `drawTextOutlined`.
- **Daily-seed mode** — `Date.now()` → day bucket → seed. Here `Date.now` is acceptable because it's *selecting* a seed at boot, not driving the sim.
- **Cosmetic palette-swap variants per character** via `generateSkinVariants` — unlock recolors as altitude milestones (e.g. a "Frost Knight" at altitude 500).
- **Per-band music tracks** — each band uses a different `generatePattern` config (different `scale`, different `bpm`); the music-drives-difficulty coupling swaps tracks at each band transition and the spawn density retunes with it. (Compose carefully: band swap + track swap + retune must stay deterministic.)
- **Hidden sixth band** — above altitude 2000, a "Celestial" band with unique mechanics (e.g. zero-gravity sections). The band-transition flash fires at 2000.

---

## 19. Summary of Key Changes from Previous Brief

| Aspect | Previous (465 lines, monotonic) | This brief (banded) |
|---|---|---|
| Difficulty curve | Linear `minGap = 40 + altitude * 0.02` | Five distinct altitude bands with per-band `BAND_TABLES` (§5.3) |
| Visual identity | One shared green palette throughout | Five band palettes (Meadow / Caverns / Skies / Storm / Stratosphere) with seed offsets, never pure black |
| Platform mix | Fixed 70/15/15 across the whole climb | Per-band mix (100/0/0 → 30/25/45), introduced progressively |
| Mechanic introduction | All mechanics available from altitude 0 | Staged: monsters + breaking platforms in Caverns, moving platforms in Skies, jetpacks in Storm |
| Terrain renderer | Flat `outlineRect` per platform | Connected terrain system with five motifs (leaves / cracks / cloud puff / rivets / crystal facets) — §5.4.1 |
| Parallax | Single triple for the whole climb | Per-band parallax palette triple (five distinct background moods) — §5.4.2 |
| Band-transition cue | None | Palette-shift flash + chime on every threshold crossing (§5.4.3) |
| Logical resolution | Unspecified | 200×320 portrait, `image-rendering: pixelated` upscale (§5.1) |
| Music-drives-difficulty | Coupled to monotonic ramp | Composes with band tables (band = chapter; music = phrase within chapter; §5.3.3) |
| Tests | 16 grep-target criteria | Per-band content counts table + band-selection test + simulation determinism + band-transition test + music-drives-difficulty correlation test + vertical-slice completion + E2E climb (§13) |
| Visual review | Acceptance checklist only | Per-band screenshot gate + contact sheet + band-transition flash frame + vision review (§12) |
| Implementation workflow | One-paragraph build-order suggestion | Eight stages each with a gate (§15) |
| Anti-failure wording | Implicit | Explicit list mirroring Flipside's lesson (§16) |

---

**Build order:** spawner prototype + 5-band sample sheet → band design review → graybox mechanics → music + difficulty coupling → per-band playtest → connected terrain polish → all-band screenshots + vision review → cosmetics + IAP + verification.

**The game is not done when the code compiles. It is done when five visually distinct altitude bands are climbable, the band-transition cue fires on every threshold, the music's lead-note density visibly feeds the spawn density within each band, and a human player can climb from Meadow to altitude 1000 (the vertical-slice completion target) in 4-7 minutes on their first try.**
