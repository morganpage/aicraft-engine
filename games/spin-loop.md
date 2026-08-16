# Spin Loop — A Seven-Beat Momentum-Sonic Act on `aicraft-engine@0.15.0`

> Paste this entire document to a coding agent (Claude / Cursor / etc.). It is a complete, self-contained build brief: concept, architecture, exact data contracts, ASCII act map, implementation stages, acceptance gates, and anti-shortcut checks. The agent should produce a single runnable Vite + TypeScript browser game that imports everything from `aicraft-engine` (the npm package) and writes **no** re-implementations of what the engine already provides.

---

## 0. What You Are Building

**Spin Loop** — one hand-authored horizontal-scrolling act in the *Sonic the Hedgehog* mold: a small rolling hero ramps 0 → max speed, launches off a ramp, runs a **loop-de-loop**, bounces up a spring stack, weaves through a mace corridor, and hits a **speed slope** into a signpost finish. The feel target is **Genesis-Sonic-meets-Sokpop**: chunky vector outlines, a hero that tucks into a spin as speed climbs, screen-shake scaled by velocity, multi-layer parallax, and the signature **lost-rings burst** when hurt.

The engine's **0.4.0 signed-gravity platformer kernel** is the *headline* of this brief. The loop-de-loop is implemented by switching between two prebuilt controllers (positive + negative gravity) per tick — exactly as the design doc specifies. Learn that pattern here; do not reinvent it.

**This is NOT a tech demo.** It is a designed act with seven distinct beats, each with a unique visual identity, escalating Sonic-feel moments, and a hand-authored tile layout. The previous implementation risked a flat obstacle course with a Sonic skin — a sequence of unconnected platforms with no momentum curve, a "loop" sign that wasn't a loop, mace placement that stopped the run, no speed-scaled payoff, and a signpost with no momentum lead-in. This brief fixes every one of those failure modes by specifying seven beats with per-beat geometry, silhouette, speed expectation, hazard placement, camera behavior, and parallax emphasis.

**Non-negotiable: build the entire game on top of `aicraft-engine@0.15.0`.** Do not hand-roll the controller, fixed-step loops, AABB collision, cameras, ring pickups, particle bursts, jump arcs, palettes, or audio. If you find yourself writing a circular-collision routine for the loop, a second vertical-velocity integrator, a `Math.random()` in the simulation, or a `CLASSIC_PLATFORMER` import, STOP and use the engine instead. Spin Loop's headline is **momentum + signed gravity**, not dash-precision — Celerock owns that lane.

---

## 1. Tech Stack & Install

```bash
npm create vite@latest spin-loop -- --template vanilla-ts
cd spin-loop
npm install aicraft-engine@0.15.0
```

> This brief targets the published `0.15.0` API exactly. It was originally written against `0.4.0` and repinned; **every API it names still exists and compiles at `0.15.0`** — the export surface has been additive, and the signed-gravity two-controller loop-de-loop pattern that headlines this brief is unchanged. (References below to "the 0.4.0 signed-gravity kernel" and "the 0.4.0 `volumeScale` sign" are historical provenance — those landed in `0.4.0` and still hold; they are not stale pins.) **The kernel changed underneath you, though, and this prompt uses `PRECISION_PLATFORMER`:** `0.14.0` made the wall-jump direction-aware (jumping while sliding INTO a wall now launches straight up; the classic away leap fires from the new `wallJumpGraceTime` window after you release or turn away), `0.9.2` fixed super-jump grace so it seeds once and decays instead of refreshing every grounded tick (previously "dash, land, stand still, then jump" flung you across the screen), and `0.9.0` added the ledge mantle plus a direction-aware climb-jump. If Spin Loop's feel targets were tuned against the old behavior, retune rather than fighting the kernel. **Compatibility breaks:** the replay physics version is **13**, so the §14 share-code stretch cannot verify against any hash recorded before this repin (v10–v12 replays are rejected outright); a manually-constructed `PlatformerState` needs `moments: []`. Also new and useful here: `state.moments` (`0.8.0`+) reports landing impact ratio and one-shot dash bonks, which is a cleaner source for the speed-scaled shake than reading `vx` yourself.

- **TypeScript**, strict. Target ES2021, `moduleResolution: bundler` (matches the engine; Vite resolves its ESM fine).
- **Vite** dev server + build. Single `<canvas>` in `index.html`.
- **`aicraft-engine`** is your only runtime dependency. Import from the **root barrel only** (the published package only exposes the root `"."` entry — never deep-import subpaths like `aicraft-engine/platformer`):
  ```ts
  import {
    // game-loop + game-state FSM
    createGameLoop, DEFAULT_FIXED_DT,
    createGameState, reduceGameState, isLegalTransition, DEFAULT_GAME_STATE_ADJACENCY,

    // input
    createKeyboardAdapter, createTouchButtonSet, createGamepadAdapter, orEdges,
    createEdgeAccumulator, pressEdge, releaseEdge, resetEdge, pollEdge,

    // ★ platformer kernel — THE 0.4.0 HEADLINE (signed gravity + precision pipeline)
    createPlatformerController, createPlatformerState, stepPlatformer,
    PRECISION_PLATFORMER,
    defaultPrecisionPipeline,
    jumpAbility, wallSlideAbility, dashAbility, doubleJumpAbility,
    DEFAULT_PLATFORMER_CONFIG, DEFAULT_PLAYER_WIDTH, DEFAULT_PLAYER_HEIGHT,
    compileLevel, advanceMovingPlatform, movingPlatformToSolid,
    createMovingPlatformDisplacementProvider,
    drawActor, drawTileGrid, drawLevelEntity, DEFAULT_ENTITY_PALETTE,
    createEnemyBehaviorRegistry, spinnyBehavior, compileEnemies, stepEnemies,
    drawEnemies, stepProjectile, drawProjectiles,

    // level schema (hand-authored LevelData — NOT procedural)
    migrateLevel, validateLevel, canonicalize, fnv1a,
    type LevelData, type LevelEntity, type TileGrid, type EntityKind,
    type CollectibleKind,

    // collision (hazard AABB only — the player uses the kernel)
    aabbOverlap, worldToTile, tileToWorld, tileRect,
    type TileSolidityQuery, type TileType, type Rect,

    // camera
    createCamera, updateCamera, DEFAULT_CAMERA,

    // rings! (collectibles pillar)
    collect, hasCollected, derivePickups,
    DEFAULT_COLLECTIBLE_RECT, DEFAULT_COLLECTIBLE_VALUE, type CollectibleSave,

    // save (ring total persists)
    createLocalStorageSaveStorage, createMemorySaveStorage,
    loadSave, writeSave, DEFAULT_SAVE_KEY,

    // replay (stretch — "share your fastest loop")
    createReplayRecorder, playReplay, replayHash,

    // hit-stop (the spring-launch freeze is the Sonic feel moment)
    createHitStop, triggerHitStop, stepHitStop, isHitStopActive,

    // animation — NOTE the 0.4.0 volumeScale sign (see §4 footnote)
    volumeScale, breathe, DEFAULT_BREATH,
    advanceLocomotion, evaluateLocomotion, advanceLocomotionByDisplacement,
    blendAirborneTuck, DEFAULT_GAIT, DEFAULT_TUCK,
    drawSimpleFeet, DEFAULT_SIMPLE_FEET,
    createFootPlantState, advanceFootPlant,
    createSpringRod, advanceSpringRod, DEFAULT_SPRING_ROD,
    sineShake, shakeEnvelope,

    // particles — the lost-rings burst is the showcase use
    spawn, advance as advanceParticles, cull, step as stepParticles,
    sampleConeVelocity, sampleRegion,
    createEmitter, stepEmitters, advanceEmission,
    DEFAULT_GRAVITY_SCALE, DEFAULT_DRAG_SCALE,

    // parallax + glow + outline + crisp canvas
    drawTiledParallax, parallaxOffset,
    PARALLAX_FAR, PARALLAX_MID, PARALLAX_NEAR,
    outlineRect, drawGlow, DEFAULT_GLOW_INTENSITY,
    getDevicePixelRatio, resizeCanvasToBackingStore, prefersReducedMotion,

    // bitmap text (ring HUD, "ACT CLEAR", speed gauge)
    createFont, addGlyph, measureText, drawText, drawTextOutlined,
    DEFAULT_FONT, DEFAULT_TEXT_COLOR, DEFAULT_TEXT_SCALE,

    // easing + tween
    easeOutCubic, easeOutBack, powOut, createTweenState, advanceTween,

    // audio + rng + palette
    createAudioAdapter, DEFAULT_AUDIO_VOLUME,
    mulberry32, nextInt, nextFloat, pick,
    generatePalette, resolvePalette, repairContrast, lerp, shade, mixHex, type Palette,

    // cosmetics + iap (stretch)
    generateSkinVariants, grantSkin, equipSkin, unequipSkin,
    createMemoryIAPAdapter, createLocalStorageIAPAdapter, flushIAPEvents,
  } from 'aicraft-engine';
  ```
  Tree-shaking works because every export has `sideEffects: false`.

## 2. Determinism & Discipline Rules (enforced by the engine — follow them)

- **Fixed-step sim, variable render** via `createGameLoop({ fixedDt: 1/60, step, render })`. Poll input **exactly once per `step`**.
- **No `Math.random()` in the simulation.** Use `mulberry32(seed)` → `nextInt` / `nextFloat` / `pick` for any decorative seeding (particle jitter, ring-burst angles). `Math.random` is only OK for purely decorative side-effects that never feed back into game state.
- **The level is hand-authored, NOT generated.** Every ramp, loop tile, spring, and ring is a literal `LevelData` constant in `src/level/act-1.ts`. Procedural endless-scrolling is `doodle-knight.md`'s territory — Spin Loop is a designed act.
- **No `Date.now()` in the sim.** Time comes from `tick` or the loop's `dt`.
- **Defensive host access.** Anything touching `window`/`AudioContext`/`matchMedia` goes through the engine's adapters (`createAudioAdapter`, `prefersReducedMotion`, `resizeCanvasToBackingStore`, `createLocalStorageSaveStorage`) — lazy, error-swallowing, no-op in Node.
- **Reduced motion.** Gate the loop: if `prefersReducedMotion()`, render one static frame of the spawn and never call `loop.start()`.
- **Pure progression ops.** The kernel returns a fresh `PlatformerState` per tick; `collect`/`hasCollected`/`derivePickups` return new objects. Never mutate `PlatformerState`, the ring save, or a `CollectibleSave` in place.

## 3. Architecture — Engine Module → Game System Map

| Game system | Engine API |
|---|---|
| Game loop (60 Hz fixed) | `createGameLoop`, `DEFAULT_FIXED_DT` |
| FSM (`menu → playing → levelComplete`, `playing → gameover`) | `createGameState`, `reduceGameState`, `isLegalTransition`, `DEFAULT_GAME_STATE_ADJACENCY` |
| Keyboard / touch / gamepad input, edge merging | `createKeyboardAdapter`, `createTouchButtonSet`, `createGamepadAdapter`, `orEdges`, `createEdgeAccumulator`, `pollEdge` |
| **Hero controller — momentum feel (jump + wall-slide)** | `createPlatformerController(defaultPrecisionPipeline(), { ...PRECISION_PLATFORMER, … })` — do NOT import `CLASSIC_PLATFORMER` (Mario-feel ≠ Sonic-feel) |
| **★ Loop-de-loop via two signed-gravity controllers** | Two `createPlatformerController` calls: one `gravity: +MAG`, one `gravity: -MAG`. Select per tick by loop-region membership. See §5.6. |
| Ability composition (drop dash for purity if you like) | `defaultPrecisionPipeline` composes `jumpAbility` + `wallSlideAbility` + `dashAbility` + `doubleJumpAbility`; build a custom pipeline to drop one |
| Hand-authored level compile | `compileLevel(level, { tileTypeMap })`; consume `compiled.tileQuery` + `compiled.staticSolids` |
| Tile + entity rendering | `drawTileGrid`, `drawLevelEntity`, `drawActor`, `DEFAULT_ENTITY_PALETTE` (do NOT hand-draw tiles) |
| Hazard AABB (spikes, mace ball) | `aabbOverlap` against the player rect read from kernel state |
| Spring pad launch (hit-stop + shake + stretch) | `createHitStop`, `triggerHitStop`, `stepHitStop`, `isHitStopActive`; `sineShake`, `shakeEnvelope` |
| **Rings — collect + persist** | `derivePickups`, `collect`, `hasCollected` + `save` (`createLocalStorageSaveStorage`, `loadSave`, `writeSave`) |
| **Lost-rings burst on damage** | `sampleConeVelocity` in a full 360° cone → `advanceParticles` + `cull` |
| Camera — speed-scaled lookahead + snap | `createCamera`, `updateCamera`, `DEFAULT_CAMERA` |
| 3-layer parallax (mountains / trees / grass) | `drawTiledParallax`, `PARALLAX_FAR/MID/NEAR`, `parallaxOffset` |
| Hero squash/stretch + breathing | `volumeScale`, `breathe`, `DEFAULT_BREATH` |
| Walk cycle at low speed, airborne tuck at high speed | `advanceLocomotionByDisplacement`, `evaluateLocomotion`, `DEFAULT_GAIT`, `blendAirborneTuck`, `DEFAULT_TUCK` |
| Hero legs | `drawSimpleFeet`, `DEFAULT_SIMPLE_FEET` |
| Foot-tap audio at low speed | `createFootPlantState`, `advanceFootPlant` |
| Hero hair-tuft (whips harder at speed) | `createSpringRod`, `advanceSpringRod`, `DEFAULT_SPRING_ROD` — **never** raw `advanceSpringChain` |
| Screen shake scaled by speed | `sineShake`, `shakeEnvelope` |
| Vector look + glow | `outlineRect`, `drawGlow` |
| Crisp Retina canvas | `resizeCanvasToBackingStore`, `getDevicePixelRatio` |
| Ring HUD + "ACT CLEAR" card + speed gauge | `drawText`, `drawTextOutlined`, `DEFAULT_FONT` |
| Tween (act-clear card, signpost drop) | `createTweenState`, `advanceTween`, `easeOutCubic`, `easeOutBack` |
| Synthesized SFX (one-shot only — no chiptune) | `createAudioAdapter` (`playTone`, `playNoise`) |
| Spinny mace enemy | `createEnemyBehaviorRegistry`, `spinnyBehavior`, `compileEnemies`, `stepEnemies` |
| Per-act palette | `generatePalette`, `resolvePalette`, `repairContrast` |
| Replay + share-code (stretch) | `createReplayRecorder`, `playReplay`, `replayHash` |
| Cosmetic "Super"/"Hyper" variants (stretch) | `generateSkinVariants`, `grantSkin`, `equipSkin`, `createMemoryIAPAdapter` |

## 4. The Hero

The hero is built in **two layers**: the **physics** is the platformer kernel, the **art** is overlay rendering on top. The signature read is **speed**: Sonic-feel is a hero whose pose, shake, and FX all scale with `|vx|`.

- **Physics layer.** Build the controller once at boot with the momentum-friendly preset, then call it every tick:
  ```ts
  const controller = createPlatformerController(defaultPrecisionPipeline(), {
    ...PRECISION_PLATFORMER,
    gravity: 1800,        // Sonic gravity is HEAVY — momentum needs weight
    maxFallSpeed: 720,
    moveSpeed: 360,       // faster than Celerock's default — this is a runner
  });
  let state = createPlatformerState(spawnX, spawnY, config);
  // each fixed tick:
  const { state: next } = controller.step(state, input, solids, dt);
  state = next;
  ```
  The kernel owns the single authoritative velocity path. Do not write a second integrator, a custom friction curve, or manual slope math — `PRECISION_PLATFORMER` already tunes ground acceleration/deceleration for snappy-but-momentum feel.
- **Speed read.** Every tick compute `const speed = Math.abs(state.core.vx);` and `const atTopSpeed = speed > TOP_SPEED_THRESHOLD;`. Drive pose, shake amplitude, and the hair-tuft rest angle from `speed`.
- **Body.** `outlineRect` rounded chunk in `palette.base` / `palette.outline`. Positive `volumeScale` offsets stretch vertically; negative offsets squash vertically. **Footnote — the 0.4.0 sign:** `volumeScale(0.08)` is stretch-UP (taller), `volumeScale(-0.08)` is squash-DOWN (shorter). The OLD convention was inverted; if you find a stale doc or comment saying launch = negative, ignore it — 0.4.0 is positive-stretch-on-launch, negative-squash-on-land.¹
- **Roll vs run.** When `speed > ROLL_THRESHOLD`, the hero tucks into a ball: draw a single `outlineRect` disc (no legs), apply `volumeScale(-0.06 * (speed / TOP_SPEED))` so the disc squashes flatter as it spins faster. Below the threshold, render walk-up legs via `drawSimpleFeet` driven by `evaluateLocomotion(loco, DEFAULT_GAIT)` advanced with `advanceLocomotionByDisplacement(loco, state.core.vx * dt * state.core.facing, DEFAULT_GAIT)`.
- **Airborne tuck.** Off the ground, `blendAirborneTuck(footOffset, airborneBlend, DEFAULT_TUCK)` blends the legs into the spin pose — `airborneBlend` ramps 0→1 on launch and releases on contact.
- **⚠ Facing mirror (MANDATORY — or you get a moonwalk):** the locomotion foot offsets are LOCAL-space and assume the draw is mirrored for facing. You MUST wrap the body+feet+face draw in `ctx.scale(facing, 1)` around the body's vertical axis. Canonical:
  ```ts
  ctx.save();
  ctx.translate(bodyCx, bodyBottomY);
  ctx.scale(facing, 1);           // ← do NOT omit, or it moonwalks
  if (rolling) {
    outlineRect(ctx, -w/2, -h, w, h, palette.base, palette.outline);  // disc
  } else {
    drawSimpleFeet(ctx, pose, { ...DEFAULT_SIMPLE_FEET, color: palette.base, outline: palette.outline });
    outlineRect(ctx, -w/2, -h, w, h, palette.base, palette.outline);  // body
  }
  // ...eyes/face...
  ctx.restore();
  ```
- **Hair-tuft (spring-rod).** A short `createSpringRod` strand anchored at the top of the head. `restDirection` points up-and-back; **whip it harder as speed climbs** by rotating `restDirection` further backward proportional to `speed / TOP_SPEED`. Advance with the seconds-based signature: `tuft = advanceSpringRod(tuft, anchor.x, anchor.y, dt, { ...DEFAULT_SPRING_ROD, restDirection })`. Draw it OUTSIDE the facing mirror — its physics already own a screen-space direction. NEVER use the raw `advanceSpringChain` (it lacks bend resistance and can blow a node across the screen — the rod is blowout-proof).
- **Footstep audio.** Only at low speed (walk tier). Assign `plantState = plantResult.state` and read `plantResult.events`; gate the `playNoise` tap behind `!rolling`.

¹ The sign flip landed in 0.4.0 alongside the signed-gravity kernel. `volumeScale`'s JSDoc now reads "`+0.1` = taller, `-0.1` = shorter". Any older brief claiming `volumeScale(-0.08)` for launch is describing pre-0.4.0 behavior.

## 5. World — The Seven-Beat Sonic Act

Spin Loop is **hand-designed**, not procedural. One act, ~5× screen widths long, authored as a literal `LevelData` constant. The act is divided into **seven beats**, in order, each with a unique Sonic-feel moment and visual identity:

1. **Spawn Plateau** — flat runway for momentum build (Green Hill Act 1 opening)
2. **Ramp Launch** — wedge sends hero airborne
3. **Loop-de-Loop** — ★ the signed-gravity set-piece
4. **Spring Stack** — vertical bounce shaft
5. **Mace Corridor** — `spinnyBehavior` mace + spike pressure
6. **Speed Slope** — long downward slope for momentum climax (visual reward)
7. **Signpost** — goal trigger

The beats read as the canonical Sonic-act curve: **momentum-build → airborne-launch → signature-loop → vertical-bounce → hazard-pressure → speed-catharsis → finish.** A flat obstacle course with a Sonic skin is a failure mode (§16); each beat below is specified tightly enough that the agent cannot ship one without all seven.

### 5.1 Logical Resolution & Canvas Spec

| Parameter | Value |
|---|---|
| Logical resolution | **320 × 224** (Genesis Sonic native — Sonic 1/2/3 ran at 320×224) |
| Tile size | 16 px |
| Grid | level is ~114 tiles wide × 14 tiles tall (Beat 4 shaft extends +4 tiles vertically for 18 rows locally) |
| Level total | ~1824 × 224 px (≈5.7 screen widths) |
| CSS upscale | `image-rendering: pixelated` on the canvas; backing store at 320×224; CSS scales to viewport |
| Player body | ~12 × 18 px (sub-tile width, ~1.1 tiles tall) |

Canvas setup:
```ts
const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
canvas.style.imageRendering = 'pixelated';
const dpr = resizeCanvasToBackingStore(canvas, 320, 224);
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
```

### 5.2 Hand-Authored Level Compile

Compile once at boot:

```ts
const validation = validateLevel(ACT_1);
if (!validation.valid) throw new Error(validation.errors.map(e => e.message).join('\n'));
const compiled = compileLevel(ACT_1, {
  tileTypeMap: (tileValue: number): TileType => tileValue === 1 ? 'solid' : 'empty',
});
const tileQuery = compiled.tileQuery;   // pass into EnemyUpdateContext.tileQuery
```

The `LevelData` constant is hand-laid out in `src/level/act-1.ts`. Every tile, ramp, spring, ring, mace, and spike is placed by a human — never generated. Procedural endless-scrolling is `doodle-knight.md`'s territory; Spin Loop is a designed act.

### 5.3 ASCII Act Map

The act is a left-to-right sequence of seven beats. Total width is 114 tiles (1824 px). The side-view silhouette:

```
Y=0  ┌─────────────────────────┐ ▲▲▲  ┌─────────────────────────────────┐
     │                         │ ████ │   ceiling spikes (row B)         │
     │       /\  ramp apex     │ ▲▲▲  │                                  │
     │      /  \    O          │ ████ │           ▼ mace ball            │
     │     /    \  / \         │ ▲▲▲  │              \│/  pendulum       │
     │ ___/      \_/   \_______│ ████ │               ◯                  │
     │                          \    /                                  │
     │                           \  /         ____________              │
     │              loop          \/  springs  ╲                          │
     │              ___              ▲▲▲        ╲ speed slope            │
     │                                                 ╲                   │  ┃S┃
Y=22 └───────────────────────────────────────────────────╲──────────────┐┃ ┃
     ├────30────┤├─12─┤├──14──┤├─8─┤├──16──┤├─────24──────┤├──10──┤
       Beat 1    Beat 2 Beat 3   Beat 4 Beat 5    Beat 6      Beat 7
       Spawn     Ramp   Loop-    Spring Mace      Speed        Sign-
       Plateau   Launch de-Loop  Stack  Corridor  Slope        post
                        (★0.4.0)
```

Beat column widths and totals:

| Beat | Width (tiles) | Cumulative X | Vertical extent | Cumulative Y |
|---|---|---|---|---|
| 1. Spawn Plateau | 30 | 0–30 | flat floor (14-tall column) | Y=8–22 |
| 2. Ramp Launch | 12 | 30–42 | apex reaches Y=4 (8-tile rise) | Y=4–22 |
| 3. Loop-de-Loop | 14 | 42–56 | loop circle (full 14-tall column) | Y=0–14 |
| 4. Spring Stack | 8 | 56–64 | shaft extends to Y=22 (+8 below loop exit) | Y=4–22 |
| 5. Mace Corridor | 16 | 64–80 | low ceiling (8-tall column) | Y=14–22 |
| 6. Speed Slope | 24 | 80–104 | descending (Y=14 → Y=22) | Y=14–22 |
| 7. Signpost | 10 | 104–114 | flat floor | Y=14–22 |
| **Total** | **114 tiles** | | **1824 × 224 px** | |

### 5.4 Connected Terrain Renderer (Beat Visual Identity System)

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
| Fill | Connected mass color (beat-specific palette via `shade`/`mixHex`) |
| Highlight | Only exposed north and west edges (lighter shade) |
| Shadow | Only exposed south and east edges (darker shade) |
| Outline | ONLY external edges — **NEVER outline internal borders between connected tiles** |

**Seven beat motifs.** Each beat's `drawTile` callback closes over the grid and applies a motif-specific interior detail. The motif is determined by the tile's X position relative to the beat column ranges in §5.3:

| Beat | Motif | Visual |
|---|---|---|
| 1. Spawn Plateau | **Grassy checker** | Alternating two shades per tile — grassy top stripe + earth-tone below (classic Green Hill grass-on-dirt) |
| 2. Ramp Launch | **Directional speed-lines** | Diagonal lines pointing right-up, parallel to the ramp slope; convey forward motion |
| 3. Loop-de-Loop | **Radial spinner ridges** | Curved lines following the loop arc; the ridges curve along the circle's tangent |
| 4. Spring Stack | **Vertical striping** | Yellow/red mechanical stripes (the spring shaft's industrial look) |
| 5. Mace Corridor | **Riveted warning chevrons** | Chevrons pointing inward toward the mace's pivot + small rivet dots in each corner |
| 6. Speed Slope | **Smooth gradient slope-shading** | Diagonal gradient bands following the descent; the smoothest motif (no harsh edges) |
| 7. Signpost | **Checkered finish-line** | 2×2 checker pattern (the classic Sonic finish-line flag) |

**Color derivation.** The act has one base palette derived via `generatePalette(actSeed)`. Each beat's terrain derives fill/highlight/shadow/outline from a beat-tinted version of the act base, never pure black:

```ts
const beatBase = shade(beatColor, 0.6);       // base fill
const beatHighlight = shade(beatColor, 0.8);
const beatShadow = shade(beatColor, 0.35);
const beatOutline = shade(beatColor, 0.15);   // never pure '#000000'
```

**Gate:** A seven-motif sample sheet (one 320×224 screenshot per motif, with a hero tile proving ground for each) must be produced and reviewed before integration. No beat is accepted based on unit tests alone.

### 5.5 Beat Definitions — Detailed Specifications

Each beat below specifies its full geometry, Sonic-feel moment, and rendering contract. The actual `LevelData` is hand-authored during implementation against these specs.

#### Beat 1 — "Spawn Plateau" (momentum-build, Green Hill Act 1 opening)

- **Length:** 30 tiles wide × 14 tiles tall ceiling clearance.
- **Sonic moment:** The opening runway. The hero spawns at |vx|=0 and must hit `TOP_SPEED` before exiting. This is the "let the player hold right and feel the acceleration" moment — the very first thing a Sonic act delivers.
- **Layout concept:** Flat solid floor across all 30 tiles at Y=floor (row 12 of 14). No obstacles. The last 3 tiles step up 1 tile each into Beat 2's ramp base. The spawn entity sits at X=2, Y=floor-2 (hero standing on the floor with one tile of headroom).
- **Unique silhouette:** Wide open expanse with the hero at the left edge; the only vertical feature is the small 3-tile lip leading into the ramp. The eye reads "runway".
- **Speed expectation:** |vx| ramps 0 → TOP_SPEED across the 30 tiles. The hero MUST be at TOP_SPEED by tile 28. Tune `moveSpeed` and acceleration so a held-right input reaches TOP_SPEED in ~1.5 seconds.
- **Hazard / ring placement:** 0 hazards. 8 rings in a horizontal row at chest height (Y=floor-3), tiles 8–15 — a cluster of 8 ring entities rewarding the held-right input.
- **Camera behavior:** Speed-scaled lookahead ramps from BASE_LOOKAHEAD to BASE_LOOKAHEAD + SPEED_LOOKAHEAD across the beat. Lerp factor climbs 0.15 → 0.25.
- **Palette / parallax emphasis:** NEAR grass-tuft layer dominates the streak effect at top speed. Mountains and trees are static-feeling backdrops at low scroll differential.

#### Beat 2 — "Ramp Launch" (airborne-launch, the GHZ ramp into the sky)

- **Length:** 12 tiles wide × 14 tiles tall (apex reaches near-ceiling).
- **Sonic moment:** The first airborne beat. The hero carries TOP_SPEED momentum up a wedge and launches off the lip — no jump press needed. This is "the kernel's momentum carries the hero off the lip" (§4 momentum-build → airborne transition).
- **Layout concept:** A 6-tile ascending slope at ~30° from X=30 to X=36 (rising 4 tiles). Followed by a 2-tile vertical wedge reaching the apex at Y=4 (8 tiles above floor). Landing pad is a 4-tile flat at Y=8, then connects down to Beat 3's loop entry lip at floor level.
- **Unique silhouette:** A distinct upward triangle breaking the flat floor. The apex is the highest point of the act until the loop arc.
- **Speed expectation:** Hero hits the lip at |vx| ≈ TOP_SPEED (≈360 px/s), briefly airborne at full speed. Airborne time ~0.4 seconds.
- **Hazard / ring placement:** 0 hazards. 5 rings in an arc above the apex — visually a smile-shape rewarding the launch trajectory. The center ring sits at the arc peak.
- **Camera behavior:** Lookahead tightens slightly. snapThreshold drops to 0.3 to keep the hero centered through the airborne moment (prevent the camera from racing ahead while the hero is parabolic).
- **Palette / parallax emphasis:** FAR mountains layer dominates — the hero is in the sky, so the mountain horizon fills the frame.
- **Game feel:** `volumeScale(+0.08)` launch-stretch on the `prevOnGround && !state.core.onGround` transition. Audio: `playTone('square', 300, 700, 70, 0.15)` ramp-launch SFX.

#### Beat 3 — "Loop-de-Loop" (★ signature-loop, the 0.4.0 set-piece)

- **Length:** 14 tiles wide × 14 tiles tall (full loop height).
- **Sonic moment:** THE showcase. The hero enters at TOP_SPEED and rides a complete 360° loop. The two-controller signed-gravity pattern (§5.6) makes the hero stick to the inside of the loop's ceiling arc — the kernel's support-contact logic is gravity-sign-relative.
- **Layout concept:** 12-tile wide × 14-tile tall loop bounding box centered at floor level. Hand-authored as a fan of 1-tile solids forming a circle of inner radius 4 tiles, outer radius 8 tiles. Entry lip at X=42, exit lip at X=54, both at floor level. The `inLoopRegion` AABB is exactly 14×14 tiles covering X=42–56, Y=0–14.
- **Unique silhouette:** A clear circular/oval hole in the terrain — visually unmistakable as a loop. Nothing else in the act has this silhouette.
- **Speed expectation:** Hero enters at |vx| ≈ TOP_SPEED (≈360 px/s). Speed floor: 280 px/s — if the hero drops below this inside the loop, the loop "fails" and the hero falls out the bottom (gravity flips back to +MAG, classic Sonic loop-fail). The agent should test this and accept the failure mode as designed.
- **Hazard / ring placement:** 0 hazards inside the loop. 8 rings arranged in a circle along the loop's inside arc — collect them all on a successful loop run. This is the reward for nailing the speed entry.
- **Camera behavior:** snapThreshold tightens to 0.25 for the loop (the hero rotates around a fixed point, so the camera should not lead). Camera briefly holds the loop's center in frame.
- **Palette / parallax emphasis:** All three layers streak past as the hero rotates. MID trees streak most visibly because the hero is at ground level.
- **Game feel:** `playNoise(60, 'bandpass', 1200, 0.18)` whoosh on entering `inLoopRegion`. Roll-up tuck is mandatory here — the hero is a spinning disc through the loop, not walking.
- **Sharp edge:** See §5.6 for the exact two-controller pattern. Author the loop tiles as a fan of short radial wedges (each a 1-tile solid), gate `inLoopRegion` with the AABB, flip to `upController` on entry above the speed floor, flip back on exit. **The loop is an illusion — gravity-flip frames + carefully-shaped tile solids.**

#### Beat 4 — "Spring Stack" (vertical-bounce, the GHZ spring chain)

- **Length:** 8 tiles wide × 18 tiles tall (vertical shaft, taller than viewport — camera must scroll up).
- **Sonic moment:** The vertical break. The hero lands on the first spring pad and bounces up a shaft, chaining 2 more spring pads to the top. Each bounce fires the canonical spring-launch feel (hit-stop + shake + stretch).
- **Layout concept:** 8-tile wide vertical shaft from X=56 to X=64. Floor at the bottom (Y=22). 3 spring pad entities stacked vertically: at Y=18, Y=12, Y=6 — each 6 tiles apart. The hero enters from Beat 3's exit at floor level, hits spring 1, bounces to spring 2 (which must be touched during the descent), bounces to spring 3, exits the ceiling at Y=4 into Beat 5's flat corridor.
- **Unique silhouette:** A distinct tall vertical column breaking the horizontal flow. The springs are clearly visible as yellow/red mechanical tiles against the vertical-stripe motif.
- **Speed expectation:** Hero's |vx| briefly drops to ~0 between springs (each spring sets |vx| = 0 and |vy| = spring velocity). |vy| peaks at each bounce — the screen-shake amplitude tracks |vy|.
- **Hazard / ring placement:** 0 hazards. 6 rings in a vertical line between springs (2 between each pair) — rewards the chained bounce.
- **Camera behavior:** Lookahead reduces to BASE_LOOKAHEAD only (no speed-lookahead since |vx| is low). Camera follows vertical motion tightly — `lerp` jumps to 0.30 for the duration of the stack so the hero stays in frame during rapid vertical motion.
- **Palette / parallax emphasis:** NEAR grass-tuft layer dominates vertically (grass tufts streak down past the camera). The springs themselves are the visual anchor.
- **Game feel:** Each spring: `triggerHitStop(hitStop, 4)` + `sineShake(tick, MAX_SHAKE * 0.6)` + `volumeScale(+0.08)` stretch. Audio: `playTone('sine', 200, 900, 90, 0.22)` "BOING".

#### Beat 5 — "Mace Corridor" (hazard-pressure, the GHZ motobug/spike section)

- **Length:** 16 tiles wide × 8 tiles tall (low ceiling — first tight space in the act).
- **Sonic moment:** The pressure beat. The hero recovers from the spring stack exit into a corridor with spike rows and a spinning mace (`spinnyBehavior`). The hero must keep moving right while dodging — pressure, not precision-platforming.
- **Layout concept:** 16-tile flat corridor from X=64 to X=80 at Y=14 (the spring-stack exit height). Ceiling at Y=6 (8 tiles of clearance). 2 spike rows: row A = 3 spikes on the floor at X=68, 69, 70. Row B = 3 spikes on the ceiling at X=74, 75, 76. 1 spinning mace centered at X=72, Y=10, sweeping a pendulum arc of 120° around its pivot — the ball reaches the floor at the bottom of the swing and the ceiling at the apex.
- **Unique silhouette:** Tight mechanical corridor with riveted-chevron terrain. The mace's spiked ball silhouette is clearly visible against the floor — its `drawGlow` accent makes it pop.
- **Speed expectation:** Hero's |vx| must recover from the spring stack — target 280–400 px/s through here. The hazards pressure but should not stop a skilled player.
- **Hazard / ring placement:** 6 spikes (2 rows of 3). 1 mace (`spinnyBehavior` registered). 8 rings in clusters: 4 between the floor spikes and the mace, 4 between the mace and the ceiling spikes — rewards the dodge between mace sweeps.
- **Camera behavior:** Lookahead returns to BASE_LOOKAHEAD (no speed-lookahead yet — |vx| is recovering).
- **Palette / parallax emphasis:** MID trees backdrop. The mace ball gets a `drawGlow` accent in `palette.feature` so it reads as the threat.
- **Game feel:** On mace contact → `hurt()` (§7). On spike contact → `hurt()`. The mace's pendulum period is ~2.5 seconds — long enough that the player reads its arc and times the cross.

#### Beat 6 — "Speed Slope" (★ NEW — speed-catharsis, the visual climax)

- **Length:** 24 tiles wide × descending 8 tiles.
- **Sonic moment:** The momentum climax. After surviving the mace corridor, the hero gets a long, smooth descending slope with **zero hazards** — pure speed catharsis. The hero accelerates above TOP_SPEED briefly (gravity boost on the descent), the speed-scaled shake peaks, all three parallax layers streak at maximum. This is the visual reward.
- **Layout concept:** 24-tile descending slope at ~20° from X=80 to X=104, dropping 8 tiles over 24 horizontal tiles. Floor smooths out at the bottom into a flat 4-tile transition into Beat 7. Polished slope-shading terrain (Beat 6 motif). No obstacles, no jumps required — held-right input carries the hero down the slope and into Beat 7.
- **Unique silhouette:** A clean diagonal slash across the act's silhouette — the longest unbroken diagonal in the level. Visually the most dynamic shape in the act.
- **Speed expectation:** Hero enters at ~400 px/s, accelerates to ~500 px/s (TOP_SPEED + 40%) by the bottom of the slope due to the gravity assist. The speed-scaled `sineShake` amplitude peaks at MAX_SHAKE.
- **Hazard / ring placement:** 0 hazards. 8 rings in a diagonal line along the slope — a "thank you" reward for surviving the mace. The rings are placed at slope-mid-height so a held-right input collects all of them.
- **Camera behavior:** Lookahead MAXIMIZED at `BASE_LOOKAHEAD + SPEED_LOOKAHEAD`. Lerp climbs to 0.25 (tight follow at top speed). The camera leads the hero significantly — the player sees more of what they're sprinting into.
- **Palette / parallax emphasis:** All 3 layers streak at maximum. NEAR grass-tuft streaks sell the speed (the closest layer scrolls fastest). FAR mountains drift visibly. This is the beat the parallax was designed to serve.
- **Game feel:** Roll-up tuck is mandatory (hero is above ROLL_THRESHOLD). Hair-tuft whips fully backward. Audio: gated `playNoise(40, 'lowpass', 180, 0.04)` roll rumble scaled by `speedFraction` (1.0 here — peak amplitude).
- **Why this beat exists:** A Sonic act without a pure-speed payoff is just an obstacle course. The Speed Slope is the "this is why you came" moment — it converts the mace corridor's tension into catharsis. Without it, the act ends on a hazard instead of a high. It is the visual climax of the act and the moment the speed-scaled `sineShake` was built for.

#### Beat 7 — "Signpost" (finish, the classic Sonic signpost drop)

- **Length:** 10 tiles wide × 8 tiles tall.
- **Sonic moment:** The finish. The hero decelerates from speed-slope momentum through friction onto a flat finish plateau. The signpost trigger fires, the FSM transitions `playing → levelComplete`, and the signpost drops + spins (the classic Sonic animation).
- **Layout concept:** 10-tile flat floor at Y=22 (the bottom of the speed slope) from X=104 to X=114. Signpost entity (kind: `'trigger'`, props: `{ action: 'win' }`) centered at X=110, Y=floor. The wall behind the signpost is solid (level bounds).
- **Unique silhouette:** Clear finish-line plateau with a vertical signpost silhouette. The checkered finish-line motif (Beat 7's terrain) wraps the plateau — a hard color shift from Beat 6's gradient is the visual punctuation that says "done".
- **Speed expectation:** Hero decelerates from ~500 px/s through PRECISION_PLATFORMER's ground friction. Should coast to a near-stop at the signpost in ~1 second.
- **Hazard / ring placement:** 0 hazards. Signpost trigger entity. (Optional: a final ring right above the signpost for the "perfect run" reward.)
- **Camera behavior:** Camera holds center as the signpost drop tween plays. `lerp` drops to 0.10 (slow drift) so the signpost animation reads.
- **Palette / parallax emphasis:** Parallax slows to a stop as |vx| drops. The checkered finish-line terrain is the visual punctuation.
- **Game feel:** On AABB overlap with signpost trigger → `{ type: 'win' }` → `reduceGameState(gs, { type: 'win' }, dt)` → FSM transitions. Signpost drop: `createTweenState()` advanced with `{ duration: 0.6, ease: easeOutBack }` — the signpost falls from above the screen, lands, spins 3 times. Audio: `playTone('triangle', 480, 960, 600, 0.20)` sustained rising warp.

### 5.6 ★ The Two-Controller Signed-Gravity Pattern (THE 0.4.0 HEADLINE)

This is the showcase. Include this pattern verbatim — it is what the acceptance-criteria grep in §14 verifies:

```ts
// Two prebuilt controllers, one per gravity sign. Select between them per tick.
// The platformer state is shared (immutable in, fresh out) so swapping controllers
// does NOT recreate logical state.
const GRAVITY_MAGNITUDE = 1800;
const downController = createPlatformerController(defaultPrecisionPipeline(), {
  ...PRECISION_PLATFORMER,
  gravity: GRAVITY_MAGNITUDE,         // positive: floor support
});
const upController = createPlatformerController(defaultPrecisionPipeline(), {
  ...PRECISION_PLATFORMER,
  gravity: -GRAVITY_MAGNITUDE,        // negative: ceiling support
});

// In the fixed step:
const controller = player.inLoopRegion ? upController : downController;
const result = controller.step(state, input, solids, dt);
state = result.state;
```

**Sharp edge — read this before you write the loop.** The kernel does NOT compute circular collision. A loop is a sequence of (a) hand-authored stair-stepped tile solids shaped around an axis PLUS (b) inverted-gravity frames while the player is in the `inLoopRegion` AABB. Do NOT claim the engine does curved-path physics. **The loop is an illusion: gravity-flip frames + carefully-shaped tile solids.** Author the loop tiles as a fan of short radial wedges (each a 1-tile solid), and gate `inLoopRegion` with a single AABB covering the loop's bounding box. When the hero enters that box moving right above a speed floor, flip to `upController`; when it exits the box (or its speed drops below the floor — a failed loop), flip back to `downController`. The hero rides the ceiling because the kernel's support-contact logic (`groundId`/`ceilingId`) is gravity-sign-relative — negative gravity makes "up" the support direction.

The loop region AABB + the flip thresholds are consumer-owned tuning constants in `src/level/loop-region.ts`. Do not encode them in tile values.

---

## 6. Hazards

The engine ships no first-class hazard module — hazards are level entities the consumer checks via `aabbOverlap` against the player rect read from kernel state.

- **Spikes.** Place `'trap'` entities at boot; fold their rects into a `hazardRects: Rect[]` array. Each tick: `if (aabbOverlap(playerRect, hazardRect)) hurt()`. The `hurt()` path is §7's lost-rings burst (rings > 0) or death (rings === 0). Spikes do NOT get `spinnyBehavior` — they're static.
- **Spinning mace.** A heavy spiked ball on a pivot sweeping a pendulum arc — use `createEnemyBehaviorRegistry` with the shipped **`spinnyBehavior`** handler. Compile with `compileEnemies(level)`, step with `stepEnemies(enemies, registry, context)` each fixed tick, render with `drawEnemies`. The mace's damage AABB tracks the BALL (not the pivot); `aabbOverlap(playerRect, maceBallRect)` → `hurt()`. Always dangerous, non-stompable — Sonic maces are not bouncy.
- **Pit fall.** If the hero's center Y drops below the level floor, send `{ type: 'die' }` to the FSM regardless of ring count (classic Sonic pit-death).

Death effect (rings === 0 OR pit): `triggerHitStop(hitStop, 6)`, advance by `hitStop = stepHitStop(hitStop, 1)` per fixed tick, and transition the FSM with `reduceGameState(gs, { type: 'die' }, dt)`.

## 7. Rings (the `collectibles` pillar — and the lost-rings burst)

**Use the engine's `collectibles` module. Do NOT hand-roll ring counts or pickup math.**

- **Spawn rings as entities.** In `ACT_1`, include `LevelEntity` records with `kind: 'collectible'`, `props.kind: CollectibleKind` (engine-level `'coin' | 'gem' | 'key'`), unique numeric `id`s. For Sonic rings, **use `'coin'` as the visual stand-in** — same AABB, same persistence semantics, render as a glowing `outlineRect` ring with `drawGlow`. Do NOT invent a `'ring'` literal in `CollectibleKind`; the union is closed.
- **Composite persisted save.** The library ships a flat `CollectibleSave`; Spin Loop composes it with a ring total into one persisted record:
  ```ts
  interface SpinLoopSave {
    readonly collectibles: CollectibleSave;   // collected ring ids this act
    readonly rings: number;                    // current held ring count (reset on hurt)
    readonly bestTime: number;                 // for the replay/share stretch
  }
  const DEFAULT_SAVE: SpinLoopSave = { collectibles: { collected: [] }, rings: 0, bestTime: 0 };
  const storage = createLocalStorageSaveStorage('spin-loop-save');
  let save = loadSave(storage, DEFAULT_SAVE);
  ```
- **Pickup each tick** via `derivePickups` (pure; returns collected + remaining):
  ```ts
  const playerRect: Rect = { x: state.core.x, y: state.core.y, width: state.core.width, height: state.core.height };
  const { collected, remaining } = derivePickups(playerRect, ringEntities, save.collectibles);
  for (const id of collected) {
    save = { ...save, rings: save.rings + 1, collectibles: collect(save.collectibles, String(id)) };
    audio.playTone('triangle', 600, 1200, 60, 0.12);   // the ring "ding"
  }
  writeSave(storage, save);
  ```
- **★ Lost-rings burst on hurt (the signature Sonic moment).** When the hero takes damage and `save.rings > 0`, scatter rings as physics particles using `sampleConeVelocity` in a **full 360° cone** — not a directed cone. Drop the held count to 0 and let the scattered ring-particles bounce and fade (the player can re-collect a few before they despawn, classic Sonic mercy). The API contract: `sampleConeVelocity(config, rng)` returns **one** `{vx, vy}` and consumes a seeded `rng` — call it once per ring (never `Math.random`):
  ```ts
  function hurt() {
    if (save.rings === 0) { gameState = reduceGameState(gameState, { type: 'die' }, dt); return; }
    const burstCount = Math.min(save.rings, 32);             // cap visual cost
    const ringRng = mulberry32(tick);                         // seeded — determinism rule §2
    // Full 360° cone: baseAngle 0, full-circle spread → a ring-scatter, not a spray.
    const cone = { baseAngle: 0, spread: Math.PI * 2, speedMin: 120, speedMax: 240 };
    const cx = state.core.x + state.core.width / 2;
    const cy = state.core.y + state.core.height / 2;
    for (let i = 0; i < burstCount; i++) {
      const v = sampleConeVelocity(cone, ringRng);           // ★ one velocity per ring
      ringBurstParticles = [...ringBurstParticles, {
        x: cx, y: cy, vx: v.vx, vy: v.vy,
        life: 90, maxLife: 90, size: 6, color: palette.feature,
      }];
    }
    save = { ...save, rings: 0 };                             // rings gone
    audio.playNoise(120, 'lowpass', 400, 0.25);               // the "ow" hiss
    triggerHitStop(hitStop, 4);
  }
  ```
  `spread: Math.PI * 2` is what makes it a ring-scatter and not a directed spray — the reviewer greps for exactly that. Do NOT try to inject velocities through `spawn` (its signature doesn't accept them — it computes its own radial angles); build each `Particle` literal directly as above. Per-tick advance the burst with `ringBurstParticles = cull(advanceParticles(ringBurstParticles, 1, { gravity: 0.3, drag: 0.96 }))` (tick units; positive gravity makes them fall and bounce out). Re-collect a burst ring by `aabbOverlap(playerRect, particleRect)` → `save.rings += 1` + splice that particle.

## 8. Camera

Horizontal follow with **speed-scaled lookahead**: as `|vx|` climbs, the camera target shifts further ahead in the facing direction so the player sees more of what they're sprinting into. Use **`createCamera`** + **`updateCamera`** with the built-in snap-to-target — the engine owns the snap; do NOT hand-roll a `Math.abs(diff) < 0.1` early-exit.

```ts
let camera = createCamera();
// each render:
const speedFraction = Math.min(Math.abs(state.core.vx) / TOP_SPEED, 1);
const lookahead = BASE_LOOKAHEAD + speedFraction * SPEED_LOOKAHEAD;   // grows with speed
const targetX = state.core.x + state.core.facing * lookahead;
camera = updateCamera(
  camera,
  { x: targetX, y: state.core.y, width: state.core.width, height: state.core.height },
  { width: levelWidthPx, height: levelHeightPx },
  { width: CANVAS_W, height: CANVAS_H },
  { ...DEFAULT_CAMERA, lerp: 0.15 + speedFraction * 0.10, snapThreshold: 0.5 },  // tighter follow at speed
);
```

`updateCamera` clamps to the level bounds; you do not need a second clamp pass. Per-beat camera overrides (snapThreshold 0.3 for the ramp launch, 0.25 for the loop, lerp 0.30 for the spring stack, lerp 0.10 for the signpost drop) are layered on top of this baseline.

## 9. Parallax Background

Three layers at the engine's exported depth constants. **Speed of parallax = depth factor × camera scroll speed** — the engine does this automatically inside `drawTiledParallax`, so a faster hero makes the near layer streak past faster than the far layer. Pre-render each tile once at boot with `outlineRect`/`drawGlow` and a per-layer palette, then tile horizontally forever:

- **Far — mountains** (`PARALLAX_FAR`): jagged horizon. Palette: dusty rose → deep violet → near-black at the peaks.
- **Mid — trees** (`PARALLAX_MID`): soft triangular silhouettes on the horizon row. Palette: teal → forest green.
- **Near — grass tufts** (`PARALLAX_NEAR`): small `outlineRect` clumps along the floor row. Palette: lime → yellow-green. Closest layer, scrolls fastest — sells the speed. This is the layer Beat 1 and Beat 6 lean on most heavily.

```ts
// boot — offscreen canvas per layer
const farTile  = makeMountainTile(160, 80, farPalette);
const midTile  = makeTreeTile(96, 48, midPalette);
const nearTile = makeGrassTile(48, 24, nearPalette);

// each render — engine handles offset math
drawTiledParallax(ctx, (c, x) => c.drawImage(farTile,  x, horizonYFar),  camera.x, PARALLAX_FAR,  160, CANVAS_W);
drawTiledParallax(ctx, (c, x) => c.drawImage(midTile,  x, horizonYMid),  camera.x, PARALLAX_MID,  96,  CANVAS_W);
drawTiledParallax(ctx, (c, x) => c.drawImage(nearTile, x, floorYNear),   camera.x, PARALLAX_NEAR, 48,  CANVAS_W);
```

Row `yTop`s are tuning choices — commit as constants in `src/parallax.ts`. Beat 6's speed climax is the moment all three layers peak — the FAR mountains drift visibly, MID trees streak past, and NEAR grass-tufts blur into horizontal lines. If the parallax doesn't visibly accelerate on Beat 6, the speed payoff has failed.

## 10. Game Feel Checklist (the juice — every item uses the engine)

- [ ] Launch-stretch (`volumeScale(+0.08)`) on ramp-launch + spring-bounce; landing-squash (`volumeScale(-0.08)`) on contact
- [ ] **Speed-scaled `sineShake`** — faster hero = more shake (capped). `const amp = Math.min(speedFraction * MAX_SHAKE, MAX_SHAKE); const s = sineShake(tick, amp, …);`
- [ ] **Hit-stop on spring-launch** — the signature Sonic freeze. `triggerHitStop(hitStop, 4)` the frame the spring fires.
- [ ] Lost-rings burst (`sampleConeVelocity` full 360° cone) on damage — §7
- [ ] Spring-rod hair-tuft whips harder as `speed` climbs (rotate `restDirection` with speed)
- [ ] Roll-up tuck above `ROLL_THRESHOLD` (disc pose, no legs); walk legs below it (`drawSimpleFeet`)
- [ ] Airborne tuck blends legs into spin via `blendAirborneTuck`
- [ ] Phase-synced footstep taps **only when walking** (gate behind `!rolling`) — `advanceFootPlant`
- [ ] Ring "ding" on every pickup; ring scatter "hiss" on hurt
- [ ] Coyote time + jump buffer from the shipped `jumpAbility` — do not duplicate them
- [ ] Speed-scaled camera lookahead (§8) — faster = further ahead
- [ ] Reduced-motion gate (`prefersReducedMotion`) renders one static frame

## 11. Audio (all synthesized via `createAudioAdapter` — one-shot SFX only)

Unlock on first user gesture (one-shot `keydown`/`pointerdown` calling `audio.unlock()`). Spin Loop's audio is **one-shot SFX only** — no procedural chiptune. (Procedural chiptune as a first-class citizen is `flipside.md`'s territory; do not import `advanceSequencer` or `createNoteFirePlayer`.) Then:

- **Ring pickup (the "ding"):** `playTone('triangle', 600, 1200, 60, 0.12)` — short upward glide, triangle timbre.
- **Ring scatter (on hurt):** `playNoise(120, 'lowpass', 400, 0.25)` + a descending `playTone('sine', 500, 120, 120, 0.18)`.
- **Spring launch:** `playTone('sine', 200, 900, 90, 0.22)` — wide upward "BOING". Pairs with the hit-stop freeze.
- **Ramp launch:** `playTone('square', 300, 700, 70, 0.15)` — lighter than the spring.
- **Roll (loop, sustained):** gated `playNoise(40, 'lowpass', 180, 0.04)` while `rolling` — a soft rumble that swells with speed (scale amplitude by `speedFraction`).
- **Loop-de-loop whoosh:** `playNoise(60, 'bandpass', 1200, 0.18)` on entering `inLoopRegion`.
- **Footstep (walk tier only):** `playNoise(40, 'lowpass', 200, 0.10)` per `advanceFootPlant` event.
- **Signpost / "ACT CLEAR":** `playTone('triangle', 480, 960, 600, 0.20)` — sustained rising warp.
- **Death (pit or rings===0):** descending `playTone('square', 600, 120, 200, 0.22)`.

No imported audio files; all above is `createAudioAdapter` + `playTone`/`playNoise`.

## 12. Preserved Constraints

- **Reduced-motion early gate** — `prefersReducedMotion()` checked before audio setup; renders one static frame of the spawn plateau and starts no loop.
- **Touch + keyboard + gamepad input** — `createKeyboardAdapter` + `createTouchButtonSet` + `createGamepadAdapter` + `orEdges`.
- **DPR / pixel scaling** — `resizeCanvasToBackingStore` + `ctx.setTransform(dpr, ...)` at 320×224.
- **Fixed-step sim** — `createGameLoop({ fixedDt: 1/60 })`.
- **Signed gravity controllers** — two `createPlatformerController` calls (§5.6), per-tick select, shared immutable state. Verbatim from §5.6 — the grep target in §14.4 verifies exactly this code block.
- **No `CLASSIC_PLATFORMER` import** — Spin Loop uses `PRECISION_PLATFORMER` (Mario-feel ≠ Sonic-feel; World 1-1 owns `CLASSIC_PLATFORMER`).
- **No `stepPlatformer` outside the kernel** — use `createPlatformerController` + `.step()`.
- **No `advanceSpringChain`** — every Verlet strand uses `advanceSpringRod` (the rod is blowout-proof).
- **Zero runtime deps** — `aicraft-engine` is the only dependency.

## 13. Visual & Play Gates

### 13.1 Screenshot Requirements

Before any beat is accepted as complete:

1. **Contact sheet of all seven beats** — full 320×224 screenshots of each beat's rendered state (7 screenshots). Each beat must be visually identifiable at a glance from its motif alone.
2. **Full-act contact sheet** — one image showing the act end-to-end (a horizontally-stitched 1824×224 screenshot of the entire level at rest).
3. **Loop-de-loop moment capture** — a screenshot (or GIF-equivalent description) of the hero mid-loop, captured at the moment the hero is at the loop's 12-o'clock position (riding the ceiling under negative gravity). The reviewer must be able to read "yes, the hero is upside-down inside the loop".
4. **Speed Slope climax capture** — a screenshot at the moment the hero is at full speed on the speed slope. The reviewer must be able to read "yes, the screen-shake amplitude is at MAX_SHAKE, the parallax layers are streaking, the hero is in the roll-tuck pose".
5. **Signpost drop capture** — a screenshot at the moment the signpost is mid-drop tween (in the air, before landing). Verifies the `easeOutBack` tween reads.
6. **No beat accepted based only on unit tests.** Structural tests prove data correctness, not visual quality or feel.

### 13.2 Playthrough Requirements

- **Complete Spawn → Signpost playthrough** — a held-right input (with one jump at the spring stack) must clear the full act in **60–90 seconds at speed**. Less than 60s means the act is too short (a flat corridor); more than 90s means the act is too long or has friction sources that stop momentum.
- **What the player should feel at each beat:**
  - Beat 1 (Spawn Plateau): "I'm accelerating. The screen-shake is ramping up. The grass-tuft layer is starting to streak."
  - Beat 2 (Ramp Launch): "I'm airborne. The launch-stretch fired. The mountain layer fills the frame."
  - Beat 3 (Loop-de-Loop): "I'm upside-down. The whoosh fired. I collected the 8 inside-arc rings."
  - Beat 4 (Spring Stack): "Vertical. The hit-stop froze on each bounce. The grass-tuft layer is streaking downward."
  - Beat 5 (Mace Corridor): "Tension. I dodged the mace. My |vx| is recovering."
  - Beat 6 (Speed Slope): "CATHARSIS. Top speed. Max shake. All three parallax layers streaking."
  - Beat 7 (Signpost): "Done. The signpost dropped. The checkered finish-line terrain is the punctuation."
- **Failed-loop test:** If the hero enters the loop below the 280 px/s speed floor, the loop must visibly fail — the hero falls out the bottom of the loop. The reviewer playtests by entering the loop at a walk to verify the failure mode is designed, not a bug.

### 13.3 Rejection Criteria

The following are grounds for rejecting the build:

- **Flat act with no momentum build** — Beat 1 doesn't reach TOP_SPEED before Beat 2, or the act plays as a precision-platformer instead of a runner.
- **Loop that doesn't visually read as a loop** — the loop's circular silhouette isn't visible; the hero runs through what looks like a corridor with a "loop" sign on it.
- **Mace corridor that stops momentum** — the mace or spike placement forces the hero to stop and wait. Sonic hazards pressure; they don't gate.
- **No Speed Slope** (the new Beat 6) — the act ends on the mace corridor with no momentum payoff. The visual climax is missing.
- **No speed-scaled `sineShake`** — the shake amplitude is constant or absent. The reviewer playtests at walk speed and at top speed and verifies the shake amplitude scales.
- **No speed-scaled parallax** — the parallax layers don't visibly accelerate on Beat 6.
- **Signpost that doesn't drop** — the signpost is a flat trigger with no drop/spin animation.
- **A screenshot only of Beat 1** — all seven beats must be screenshot-reviewed for distinct visual identity.
- **One shared tile motif** — every beat looks the same. The 7-motif table (§5.4) must each be visibly distinct.
- **Lost-rings burst that's a directed spray, not a 360° scatter** — `spread: Math.PI * 2` is the grep target (§14.5).

## 14. Tests & Static Contracts

### 14.1 Level Schema

- `ACT_1` passes `validateLevel`.
- `ACT_1` is exactly 114 tiles wide.
- `ACT_1` has exactly one spawn entity (`@`) in Beat 1.
- `ACT_1` has exactly one signpost trigger (Beat 7).

### 14.2 Act Hash Determinism

- Compute `fnv1a(canonicalize(ACT_1.tiles.data))` — record as a snapshot constant.
- Re-running the canonicalize + hash on the same `ACT_1` constant must produce the byte-identical hash on every run (proves the level data is stable, not regenerated).

### 14.3 Beat Content Counts

| Beat | Width (tiles) | Rings | Spikes | Maces | Springs |
|---|---|---|---|---|---|
| 1. Spawn Plateau | 30 | 8 | 0 | 0 | 0 |
| 2. Ramp Launch | 12 | 5 | 0 | 0 | 0 |
| 3. Loop-de-Loop | 14 | 8 | 0 | 0 | 0 |
| 4. Spring Stack | 8 | 6 | 0 | 0 | 3 |
| 5. Mace Corridor | 16 | 8 | 6 | 1 | 0 |
| 6. Speed Slope | 24 | 8 | 0 | 0 | 0 |
| 7. Signpost | 10 | 0 | 0 | 0 | 0 |
| **Total** | **114** | **43** | **6** | **1** | **3** |

### 14.4 ★ Loop-de-Loop Pattern Presence (THE 0.4.0 acceptance target)

Static analysis (grep / AST) must find in `src/`:

- **`gravity: -GRAVITY_MAGNITUDE`** (or equivalent negative-gravity literal) — proves the second controller exists.
- **`controller.step(state, input, solids, dt)`** (the kernel call) — proves the two-controller swap is wired into the fixed step.
- Both literals must appear within the same file (e.g. `src/level/loop-region.ts` or `src/game/step.ts`).

The exact code block from §5.6 must appear in `src/` — two `createPlatformerController` calls (one positive gravity, one negative gravity) + a per-tick select between them based on `player.inLoopRegion`. The reviewer greps for the negative-gravity literal and the `controller.step` call; both must appear, and they must be wired to the same `state` variable.

### 14.5 Lost-Rings Burst Presence

Static analysis must find in `src/`:

- **`sampleConeVelocity`** called once per ring with a seeded `rng` argument (the second positional arg is the `mulberry32`-derived rng, never `Math.random`).
- **`spread: Math.PI * 2`** in the cone config — proves the cone is the full 360°, not a directed spray.

### 14.6 Simulation Determinism

- Run the full act (`Spawn → Signpost`) for the equivalent of 60 seconds at 60 Hz (3600 ticks) with scripted fixed inputs (`moveX: 1` throughout, one jump at the spring stack tick). Record the final `PlatformerState` (position, velocity, onGround, facing).
- Re-run. Final state must be byte-identical.
- Run again with a different OS-level `Date.now()` baseline. Final state must still be byte-identical (proves no `Date.now()` leaked into the sim).

### 14.7 Enemy Determinism (Mace)

- Step the Beat 5 mace (`spinnyBehavior`) for 600 ticks with `dt = 1/60`. Record positions.
- Re-run with same params. Positions must be byte-identical.
- The mace's pendulum arc must be deterministic — its phase at tick N is a pure function of N.

### 14.8 Forbidden Patterns

Static analysis (grep / AST) must find:

- **No `requestAnimationFrame`** in game code (only in the engine's `createGameLoop`).
- **No `Math.random`** in game code.
- **No `Date.now`** in game code.
- **No manual gravity integration** (no `vy += gravity * dt` outside the engine).
- **No `stepPlatformer`** outside the engine (must use `createPlatformerController` + `.step()`).
- **No `advanceSpringChain`** in appendage code (must use `advanceSpringRod`).
- **No `CLASSIC_PLATFORMER`** import (Mario-feel ≠ Sonic-feel).
- **No deep imports** (no `aicraft-engine/src/...` — only root barrel).
- **No chiptune imports** — `advanceSequencer` / `createNoteFirePlayer` / `createSequencer` must not appear (those are `flipside.md` / `doodle-knight.md` territory).

### 14.9 End-to-End Route Tests (Where Practical)

Scripted input sequences that drive the player from Beat 1 spawn to Beat 7 signpost. These are NOT proof of fun — they prove the route is mechanically possible. Use replay recording if available, or hardcode a sequence of `InputEdges` per tick. The test must:

- Complete the full act within the 60–90 second target window.
- Collect at least 30 of the 43 rings (proves the ring placement is on the critical path, not gated behind optional detours).
- Trigger the signpost win condition.
- Re-run byte-identical.

### 14.10 Sign Convention Test

- Grep for `volumeScale(` in launch/spring code paths — every launch-stretch MUST use a positive offset (`volumeScale(+0.08)` or similar).
- Grep for `volumeScale(-0.0` followed by a digit OTHER than the `volumeScale(-0.08)` landing-squash — i.e. no stale pre-0.4.0 negative-stretch-on-launch convention survives.

## 15. Implementation Workflow

Build in this order. Each stage must pass its gate before the next begins.

### Stage 1: Terrain Prototype + 7-Motif Sample Sheet

1. Set up Vite + TypeScript + `aicraft-engine@0.15.0`.
2. Implement the connected terrain renderer (`tile-style.ts`) with all seven motifs (§5.4).
3. Produce a 7-motif sample sheet (one 320×224 screenshot per motif, on a hero-tile proving ground for each).
4. **Gate:** Visual review confirms seven distinct motifs. No two beats look the same.

### Stage 2: Beat Design Review

1. Hand-author `ACT_1` as a single `LevelData` constant with all 7 beats in sequence.
2. Place the loop tiles as a fan of radial wedges (Beat 3).
3. Place the spring stack entities (Beat 4) and the mace entity (Beat 5).
4. Place the 43 ring entities per the §14.3 table.
5. Validate with `validateLevel`.
6. Compute the act hash (§14.2) — record it.
7. **Gate:** ASCII act map (§5.3) reviewed for unique silhouettes per beat, correct cumulative widths, readable hazards. Beat 3's loop silhouette is unmistakably circular. Beat 6's speed slope is the longest unbroken diagonal.

### Stage 3: Graybox Mechanics (Per Beat, Loop-de-Loop Early)

1. Wire the game loop, input, the two signed-gravity controllers (§5.6).
2. **Get the loop-de-loop right FIRST** — it is the 0.4.0 showcase and the hardest mechanic. Build the loop region AABB, the radial wedge tiles, the speed-floor flip logic, and playtest that the hero enters at TOP_SPEED and rides the loop. Get this working before any other beat.
3. Implement the spawn plateau (Beat 1) momentum build.
4. Implement the ramp launch (Beat 2) with launch-stretch.
5. Implement the spring stack (Beat 4) with hit-stop + shake + stretch.
6. Implement the mace corridor (Beat 5) with `spinnyBehavior` + spike AABB checks.
7. Implement the speed slope (Beat 6) — verify the gravity assist accelerates the hero above TOP_SPEED.
8. Implement the signpost (Beat 7) with FSM transition + drop tween.
9. **Gate:** Playable Spawn → Signpost in 60–90 seconds. Loop-de-loop reads as a loop (hero rides the ceiling). Failed-loop mode works (hero falls out below the speed floor).

### Stage 4: Playtest the Full Act

1. Playtest all seven beats in sequence. Tune spring pad impulse, mace pendulum period, ring placement, speed-scaled camera lookahead.
2. Verify the speed climax on Beat 6 — the reviewer must feel "this is why I came".
3. Verify the failed-loop mode is recoverable (hero can walk back, re-accelerate, re-enter the loop).
4. **Gate:** 60–90 second completion time. Speed-scaled shake peaks on Beat 6. Signpost drop tween reads.

### Stage 5: Rings + Lost-Rings Burst

1. Wire the 43 ring entities via `derivePickups` + `collect` + `writeSave`.
2. Implement the lost-rings burst (`sampleConeVelocity` 360° cone, §7).
3. Implement the ring re-collect (aabbOverlap against burst particles).
4. **Gate:** Reviewer greps for `spread: Math.PI * 2` (§14.5) and confirms the burst is a 360° scatter, not a directed spray. Hurting on the mace visibly scatters rings in a circle.

### Stage 6: Polish

1. Add speed-scaled `sineShake`.
2. Add parallax background (3 layers).
3. Add hit-stop on every spring bounce + on hurt + on death.
4. Add the hero's hair-tuft spring-rod (whip harder at speed).
5. Add the roll-up tuck above `ROLL_THRESHOLD` + walk-legs below it.
6. Add the airborne tuck blend on launch.
7. Add HUD (ring count, "ACT CLEAR" card with signpost-drop tween, optional speed gauge).
8. **Gate:** Game feel matches Genesis-Sonic-meets-Sokpop. Speed-scaled shake + parallax + hair-tuft whip all peak simultaneously on Beat 6.

### Stage 7: All-Beat Screenshots + Vision Review

1. Capture full 320×224 screenshots of all seven beats (one per beat).
2. Capture the full-act contact sheet (1824×224 horizontal stitch).
3. Capture the loop-de-loop moment (hero at 12-o'clock inside the loop).
4. Capture the speed-slope climax (hero at full speed, max shake).
5. Capture the signpost-drop moment (mid-tween).
6. **Gate:** Vision review confirms distinct visual identities per beat (7-motif table), readable hazards, and the speed climax reads as cathartic.

### Stage 8: Verification

1. Run all static contracts (§14).
2. Run the end-to-end route test (§14.9).
3. Grep for forbidden patterns (§14.8).
4. Grep for the loop-de-loop pattern presence (§14.4) and the lost-rings burst presence (§14.5).
5. Verify simulation determinism (§14.6) — byte-identical final state across two runs.
6. **Gate:** All tests pass. No forbidden patterns found. Loop-de-loop + lost-rings grep targets both present.

## 16. Anti-Failure Wording

**This build is NOT complete merely because one valid `LevelData` constant exists.** The previous implementation risked producing a flat obstacle course with a Sonic skin because:

- **Six beats in a 1-line table is a failure.** Calling a beat "the mace corridor" does not make it pressure the player without stopping momentum. Each beat's full spec (§5.5: length, Sonic moment, layout, silhouette, speed expectation, hazards/rings, camera, palette/parallax) is what makes the beat actually deliver its Sonic-feel moment.
- **A loop that's a flat corridor with a "loop" sign is a failure.** The loop-de-loop MUST visibly read as a loop — a circular hole in the terrain, a hero that rides the ceiling under negative gravity. If the reviewer can't tell at a glance "yes, the hero is upside-down inside the loop", the loop has failed. The two-controller signed-gravity pattern (§5.6) is the grep target — it must appear in `src/` verbatim.
- **A mace corridor that stops the run is a failure.** Sonic hazards pressure; they don't gate. If the player must stop and wait for the mace, the mace corridor has failed. The pendulum period (~2.5s) and the spike row spacing (§5.5 Beat 5) are tuned so a skilled player keeps moving right.
- **No speed-scaled `sineShake` is a failure.** If the shake amplitude is constant or absent, the speed read is gone. The reviewer playtests at walk speed and at top speed and verifies the shake amplitude visibly scales.
- **No speed-scaled parallax is a failure.** If the parallax layers don't visibly accelerate on Beat 6's speed climax, the speed payoff has failed. Beat 6 is the moment the parallax was designed to serve.
- **A signpost with no momentum lead-in is a failure.** The Speed Slope (Beat 6) before the signpost is mandatory — without it, the act ends on a hazard instead of a high. The visual climax is missing.
- **A signpost that doesn't drop is a failure.** The signpost drop + spin (`easeOutBack` tween, 0.6s duration) is the classic Sonic finish. A flat trigger with no animation has failed.
- **Springs that don't chain is a failure.** The spring stack (Beat 4) is a chained bounce sequence, not a single spring. Each bounce must fire hit-stop + shake + stretch.
- **One shared tile motif is a failure.** Every beat must have a visibly distinct motif (§5.4 7-motif table). If two beats look the same, the visual identity system has failed.
- **A directed lost-rings spray is a failure.** The lost-rings burst MUST be a 360° scatter (`spread: Math.PI * 2`), not a directed cone. The reviewer greps for exactly that literal.
- **A screenshot only of Beat 1 is a failure.** All seven beats must be screenshot-reviewed for distinct visual identity, plus the loop-de-loop moment, the speed-slope climax, and the signpost-drop moment.

**Reference to the Flipside failure by analogy:** Flipside's previous implementation failed because it used one shared template for all six rooms. Spin Loop's analogous failure is one shared tile motif across all seven beats, or one beat (Beat 3 the loop) carrying all the design weight while Beats 1, 2, 4, 5, 6, 7 are flat corridors with signs. The 7-beat spec (§5.5) and the 7-motif table (§5.4) exist to prevent exactly this.

## 17. File Layout (Suggested)

```
src/
  main.ts              # boot: canvas, save load, level compile, loop.start()
  game/
    state.ts           # SpinLoopSave (collectibles + rings + bestTime), World, PlayerArt state
    step.ts            # fixed-step: input → controller swap → pickups → hazards → audio → camera
    render.ts          # pure draw: parallax, tiles (connected terrain), entities, rings, hero art, HUD
    player.ts          # player render: roll-disc vs walk-legs, hair-tuft, facing mirror
    hurt.ts            # hurt() + lost-rings burst (sampleConeVelocity 360°)
  level/
    act-1.ts           # THE hand-authored LevelData constant — 7 beats, 114 tiles wide
    loop-region.ts     # the inLoopRegion AABB + flip thresholds + two-controller swap (§5.6)
    compile.ts         # validateLevel → migrateLevel → compileLevel; expose compiled.tileQuery
  tile-style.ts        # connected terrain renderer (neighbor bitmask, 7 beat motifs, shade/mixHex)
  hazards.ts           # spike rects + mace wiring (spinnyBehavior) + pit-death check
  rings.ts             # derivePickups → collect → writeSave; the ring-burst particle set
  springs.ts           # spring pad logic: AABB overlap → triggerHitStop + impulse + stretch
  camera.ts            # speed-scaled lookahead + per-beat camera overrides (§5.5)
  parallax.ts          # 3 pre-rendered tile factories (mountain / tree / grass)
  sfx.ts               # one fn per sound
  input.ts             # createKeyboardAdapter + createTouchButtonSet + orEdges
  audio.ts             # createAudioAdapter + SFX recipe helpers
  save.ts              # createLocalStorageSaveStorage + loadSave/writeSave wrapper
```

## 18. Stretch Goals (only after §15 stages 1–8 pass)

- **Replay + share-code** — `createReplayRecorder` captures the per-tick input stream; on signpost-cross, `replayHash(replay)` produces a 32-bit FNV-1a hex string. Show it on the "ACT CLEAR" card as an 8-char "share your fastest loop" code. `playReplay(replay, step, dt)` re-runs your pure `step` for verifiable ghost playback.
- **Cosmetic "Super" / "Hyper" hero variants** — `generateSkinVariants(actSeed, …)` × `grantSkin` × `equipSkin` × `createMemoryIAPAdapter` (or `createLocalStorageIAPAdapter`). "Hyper" variant tints the hero gold and doubles `drawGlow` intensity when `speed === TOP_SPEED`.
- **A second act with a different palette** — `generatePalette(act2Seed)` reskins mountains/trees/hero; reuses the same kernel + loop-region logic with a different tile layout.
- **Sibling deconfliction (do NOT pull these in):** no boss (that's `bosscard.md`), no vertical-endless procedural spawning (that's `doodle-knight.md`), no procedural chiptune first-class (that's `flipside.md`), no dash+wall-jump as the headline (that's `celerock.md`). Spin Loop's headline is **momentum + signed gravity** — stay in your lane.

## 19. Summary of Key Changes from Previous Brief

| Aspect | Previous (440-line) | This brief (~860-line) |
|---|---|---|
| Beat count | 6 beats in a 1-line table | **7 beats** with full per-beat specs (length, Sonic moment, layout, silhouette, speed, hazards/rings, camera, palette/parallax) |
| Beat 6 (Speed Slope) | did not exist | **NEW** — 24-tile descending slope, momentum climax, the visual reward after the mace corridor |
| Beat specs | 1-line sketches | Full §5.5 specs (~10 lines per beat) matching Flipside §5.5 depth |
| Logical resolution | unspecified | **320 × 224 Genesis-native** (§5.1), 16px tiles, ~1824px level total |
| Tile rendering | "use `drawTileGrid`" | **Connected terrain renderer (§5.4)** with neighbor bitmask + **7 beat motifs** (grassy checker / speed-lines / radial ridges / vertical stripes / riveted chevrons / slope gradient / checkered finish) |
| ASCII act map | none | §5.3 side-view ASCII + cumulative-width table |
| Loop-de-loop pattern | preserved verbatim in §5 | preserved verbatim in §5.6 (THE 0.4.0 acceptance target) |
| Visual review | "playtest" | **§13 Visual & Play Gates** — 7 beat screenshots + full-act contact sheet + loop-de-loop moment + speed-slope climax + signpost-drop, all required |
| Anti-failure wording | implicit | **§16 Anti-Failure Wording** — explicit list of failure modes (flat act, fake loop, mace that stops momentum, no speed climax, no speed-scaled shake, directed spray, etc.) with Flipside-failure analogy |
| Implementation workflow | 1 paragraph build-order suggestion | **§15 8-stage workflow** with per-stage gates, loop-de-loop FIRST in Stage 3 |
| Tests | 15 acceptance criteria | **§14 Tests & Static Contracts** — beat content counts table (§14.3), act hash determinism (§14.2), simulation determinism (§14.6), loop-pattern grep test (§14.4), lost-rings-burst grep test (§14.5), E2E route test (§14.9), forbidden patterns (§14.8) |
| Summary | none | §19 before/after table (this row) |

---

**Build order:** terrain prototype + 7-motif sample sheet → beat design review → graybox mechanics (loop-de-loop FIRST) → playtest the full act → rings + lost-rings burst → polish → all-beat screenshots + vision review → verification.

**The game is not done when the code compiles. It is done when seven visually distinct beats are playable in 60–90 seconds, the loop-de-loop reads as a loop (the §5.6 two-controller signed-gravity pattern is grep-verifiable in `src/`), the lost-rings burst is a 360° scatter (`spread: Math.PI * 2` is grep-verifiable), the speed-slope climax peaks all three juice systems (shake + parallax + hair-tuft) simultaneously, and the signpost drop tween reads on first viewing.**
