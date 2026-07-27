# Prompt: "World 1-1" — a horizontal-scrolling platformer slice built on `aicraft-engine`

> Paste this whole document to a coding agent (Claude / Cursor / etc.). It is a complete build brief: concept, tech stack, architecture mapped to the engine's real API, per-system specs, and acceptance criteria. The agent should produce a single runnable Vite + TypeScript browser game that imports everything from `aicraft-engine` (the npm package) and writes **no** re-implementations of what the engine already provides.

---

## 0. You are building

**World 1-1** — a single horizontal-scrolling platformer slice: one hand-authored level, ~3–4× screen widths long, where a small chunky Sokpop-style hero runs right, jumps over goombas and pipes, hits a `?`-block for a coin, defeats a koopa, climbs a flagpole at the end, and watches a 3-layer parallax background drift past. The feel target is **NES-Mario-meets-Sokpop**: variable-height jump, hit-stop on stomps, squash-and-stretch on launch/landing, screen shake, the 2-tone "ding-ding" coin ping. Everything procedural — no imported art.

**Non-negotiable: build the entire game on top of `aicraft-engine`.** Do not hand-roll fixed-step loops, AABB collision, cameras, jump arcs, level compilation, tile rendering, parallax, particle bursts, or audio synthesis. If you find yourself writing a `requestAnimationFrame` accumulator, a tile renderer, a `Math.random()` in the simulation, or a pixel-art Mario, stop and use the engine instead.

## 1. Tech stack & install

```bash
npm create vite@latest world-1-1 -- --template vanilla-ts
cd world-1-1
npm install aicraft-engine
npm install -D vite
```

**TypeScript**, strict. Target ES2021, `moduleResolution: bundler`. **Vite** dev server + build. Single `<canvas>` in `index.html`. **`aicraft-engine`** is your only runtime dependency. Import from the **root barrel only** (the published package only exposes the root `"."` entry — never deep-import subpaths):
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
      // level schema
      migrateLevel, validateLevel, createTileQuery, canonicalize, fnv1a,
      type LevelData, type LevelEntity, type TileGrid, type EntityKind,
      // coins/pickups — pure progression ops
      collect, hasCollected, derivePickups, DEFAULT_COLLECTIBLE_RECT, DEFAULT_COLLECTIBLE_VALUE,
      // save
      createLocalStorageSaveStorage, createMemorySaveStorage, loadSave, writeSave, DEFAULT_SAVE_KEY,
      // cosmetics + iap (stretch)
      generateSkinVariants, grantSkin, equipSkin, unequipSkin,
      DEFAULT_SKIN_PRESET, DEFAULT_COSMETIC_SAVE, DEFAULT_MANIFEST,
      createMemoryIAPAdapter, createLocalStorageIAPAdapter, flushIAPEvents, DEFAULT_IAP_CATALOG,
    } from 'aicraft-engine';
    ```

## 2. Determinism & discipline rules

- **Fixed-step sim, variable render.** `createGameLoop({ fixedDt: 1/60, step, render })`; poll input **exactly once per `step`**.
- **No `Math.random()` in the simulation.** Use `mulberry32(seed)` → `nextInt` / `nextFloat` / `pick`. `Math.random` only for decorative side-effects that never feed back.
- **The level is hand-authored, NOT generated.** Every `?`-block, every brick, every goomba was placed by a human designer. Using `mulberry32` to generate the level is a failure mode — it's a literal `LevelData` constant you type in `src/levels/world-1-1.ts`.
- **No `Date.now()` in the sim.** Time comes from `tick` / `dt`.
- **Defensive host access.** `window` / `AudioContext` / `matchMedia` go through engine adapters (`createAudioAdapter`, `prefersReducedMotion`, `resizeCanvasToBackingStore`) — lazy, error-swallowing, no-op in Node.
- **Reduced motion.** Gate the loop: if `prefersReducedMotion()`, render one static frame and never call `loop.start()`.
- **Pure progression ops.** State updates return new objects (the engine's collision/camera/locomotion functions already do this).

## 3. Architecture — engine module → game system map

| Game system | Engine API |
|---|---|
| Game loop (60 Hz fixed) | `createGameLoop` |
| FSM (`attract → playing → dying → levelComplete`) | `createGameState`, `reduceGameState`, `isLegalTransition` |
| Input (keyboard + touch + gamepad) | `createKeyboardAdapter`, `createTouchButtonSet`, `createGamepadAdapter`, `orEdges` |
| Hero controller (Mario feel) | `createPlatformerController`, `createPlatformerState`, `stepPlatformer`, **`CLASSIC_PLATFORMER`** (NOT `defaultPrecisionPipeline`) |
| Hero jump + double-jump | `jumpAbility`, `doubleJumpAbility` |
| Level compile (`LevelData` → `CompiledLevel`) | `compileLevel`, `createTileQuery` |
| Moving platforms (optional cloud lifts) | `advanceMovingPlatform`, `movingPlatformToSolid` |
| Hero squash/stretch + breathing + walk cycle + footstep audio | `volumeScale`, `breathe`, `DEFAULT_BREATH`; `evaluateLocomotion`, `DEFAULT_GAIT`; `createFootPlantState`, `advanceFootPlant` |
| Hero legs | `drawSimpleFeet`, `DEFAULT_SIMPLE_FEET` |
| Hero cap/hair (stretch) | `createSpringRod`, `advanceSpringRod`, `DEFAULT_SPRING_ROD` (NEVER raw `advanceSpringChain`) |
| Camera (horizontal follow + snap-to-target) | `createCamera`, `updateCamera`, `DEFAULT_CAMERA` |
| Tile + entity rendering | `drawTileGrid`, `drawLevelEntity`, `drawActor`, `DEFAULT_ENTITY_PALETTE` (do NOT hand-draw tiles) |
| Coin pickup + persistence | `derivePickups`, `collect`, `hasCollected` + `createLocalStorageSaveStorage`, `loadSave`, `writeSave` |
| Goomba + koopa enemies | `createEnemyBehaviorRegistry` (custom behaviours; `spinnyBehavior` is NOT suited for grounded enemies) |
| Particles (coin burst, stomp dust, brick shatter, flag confetti) | `spawn`, `advance`, `step`, `sampleConeVelocity` |
| Continuous emitters | `createEmitter`, `stepEmitters`, `advanceEmission` |
| Parallax 3-layer sky | `drawTiledParallax`, `PARALLAX_FAR`, `PARALLAX_MID`, `PARALLAX_NEAR` |
| Glow (coins / `?`-block flash / flagpole top) | `drawGlow`, `DEFAULT_GLOW_INTENSITY` |
| Hit-stop on stomp | `createHitStop`, `triggerHitStop`, `stepHitStop`, `isHitStopActive` |
| Screen shake | `sineShake`, `shakeEnvelope` |
| Chunky vector rendering | `outlineRect` |
| HUD bitmap text + Retina canvas + reduced-motion gate | `createFont`, `defaultTextStyle`; `resizeCanvasToBackingStore`, `prefersReducedMotion` |
| Synthesized SFX | `createAudioAdapter` (`playTone`, `playNoise`) |
| Level validation + share-code serialisation + per-zone palette + colour-variant skins (mostly stretch) | `validateLevel`, `migrateLevel`, `canonicalize`, `fnv1a`; `generatePalette`, `resolvePalette`; `generateSkinVariants`, `grantSkin`, `equipSkin`, `DEFAULT_SKIN_PRESET` |

## 4. The hero

The hero is a **small round Sokpop-outlineRect chunk** — NOT pixel-art Mario. The visual genre-cue is "what if Mario was Sokpop". An homage, not a brand-exact copy.

- **Body:** rounded `outlineRect` (fill = `palette.base`, outline dark). ~16×20 px. Volume-preserving squash/stretch via `volumeScale(squashOffset)` composed with idle `breathe(tick, DEFAULT_BREATH)`. `squashOffset` spikes negative on jump (stretch up), positive on land (squash down), decaying exponentially.
- **Face:** two `outlineRect` eyes + a `drawText` mouth dot, looking in facing direction.
- **Legs:** `drawSimpleFeet` driven by `evaluateLocomotion(loco, DEFAULT_GAIT)`. Phase advances with displacement: `loco = advanceLocomotionByDisplacement(loco, vx * facing, DEFAULT_GAIT)` so feet plant when idle.
- **⚠ Facing mirror (MANDATORY — or you moonwalk):** locomotion foot offsets are LOCAL-space assuming horizontal mirror. Wrap body+feet+face in `ctx.scale(facing, 1)`:
    ```ts
    ctx.save(); ctx.translate(bodyCx, bodyBottomY); ctx.scale(facing, 1);
    drawSimpleFeet(ctx, pose, { ...DEFAULT_SIMPLE_FEET, color: palette.base, outline: palette.outline });
    outlineRect(ctx, -w/2, -h, w, h, palette.base, palette.outline);
    // ...eyes/face...  ctx.restore();
    ```
- **Controller:** `CLASSIC_PLATFORMER` (NOT `defaultPrecisionPipeline` — Mario needs generous coyote + snappy accel; precision feels too tight). `stepPlatformer(state, input, tileQuery, TILE_SIZE)`, drive squash + audio from `events.landed` / `events.jumped`.
- **Variable-height jump:** built into `jumpAbility` (tap = short hop, hold = full). Pass the hold flag via `pressEdge(state, 'jump')`.
- **Footstep audio:** `plantState = createFootPlantState()`; `advanceFootPlant(plantState, pose.leftFootOffset.y, pose.rightFootOffset.y)` per tick; fire `audio.playNoise(40, 'lowpass', 200, 0.10)` on `leftPlanted`/`rightPlanted`.
- **Cap/hair (stretch):** optional `createSpringRod` strand anchored at body top, `restDirection` up-and-back. Use `advanceSpringRod` (NOT raw chain). Draw OUTSIDE the facing mirror.
- **Death:** enemy contact (not stomped) or pit fall → game-state → `'dying'` → brief fallback animation → `playNoise(120, 'lowpass', 400, 0.4)` → back to `'attract'` with score reset.

## 5. Enemies

Two archetypes. Both drawn with `outlineRect` and stepped via the platformer module's enemy pipeline.

### Goomba

- **Body:** `outlineRect` dome (two calls — body + head-bump). Warm-brown fill, two white eyes with dark pupils. Mushroom-shaped.
- **Behaviour:** patrol left at `vx = -0.5 tiles/s`. Reverse on wall probe (`worldToTile` / `tileRect` ahead) and ledge detection. Hero collision: if falling (vy > 0) from above → goomba dies → squash flat `outlineRect` (12×16) for 0.4s → remove. Else → hero takes a hit → game-state → `'dying'`.
- **Stomp hit:** `triggerHitStop(hitStop, 4 ticks)`; `spawn` particle burst puffs; `audio.playNoise(60, 'lowpass', 250, 0.18)`; floating "+100" via `drawText`.

### Koopa

- **Body:** `outlineRect` shell (~18×22). Distinctive palette (green shell + cream underbelly + orange head peek). **Use `solveLimb`** for two 2-segment IK legs underneath — this is what `solveLimb` is for; don't fake stride with a single draw.
- **Behaviour:** same wall/ledge patrol. On stomp, enters `'shell'` mode (shell only, no legs/head), stationary ~1s, then **slides** in the last-stomp direction. Slide deals double damage → game-state → `'dying'`. Shell can stomp other goombas.
- **Stomp:** same hit-stop, louder `playNoise(80, 'lowpass', 300, 0.25)`. Score+200 first-stomp, +400 shell-kick.

### Wiring

`createEnemyBehaviorRegistry()` to register one custom behaviour per archetype. `spinnyBehavior` is **NOT applicable** — these are grounded, finite-state enemies. Custom fns take `EnemyState`, return `EnemyStepResult`. Drive patrol with `advanceLocomotionByDisplacement` (feet lock when stopping); wall/ledge probes via `tileRect`/`worldToTile`.

## 6. Level entities

The level is a hand-authored **`LevelData`** constant in `src/levels/world-1-1.ts` (~200×14 tiles @ 16px). Y-major `TileGrid` for solid floor + platforms; the rest is an array of **`LevelEntity`** (discriminated union on `EntityKind`).

| Entity | Count | What it does |
|---|---|---|
| Ground (tile row + deliberate pit gaps) | full width, 14 deep | `TileGrid` row; pits at x=120–124 and x=180–184 |
| `?`-block (`kind: 'platform'` + `props.contains: 'coin'`) | **≥3** | Bumpable from below → coin + 2-tone ping + score+200 |
| Brick blocks (`kind: 'platform'`, breakable) | **≥6** | Bumpable → shatter burst + `playNoise(60, 'lowpass', 300, 0.2)` + score+50 |
| Pipes (2–3-tall `kind: 'platform'`) | **2** | Force lateral routing; green helmet palette |
| Goomba spawns | **≥2** | At x≈80 and x≈140, walking left |
| Koopa spawn | **1** | At x≈220, walking left |
| Coins (`kind: 'collectible'`, `props.collectible.kind: 'coin'`) | **≥8** | Floating + in `?`-blocks; +200 each |
| Flagpole (`kind: 'exit'`) | **1** at x≈190+ | Climbed → game-state → `'levelComplete'` |

Compile once at boot:

```ts
const migrated = migrateLevel(WORLD_1_1);
assert(validateLevel(migrated).ok, 'world-1-1 is invalid'); // MUST pass
const compiled = compileLevel(migrated, { tileSize: 16 });
const tileQuery = createTileQuery(compiled);
```

Render via `drawTileGrid(ctx, compiled.tileGrid, camera, tileSize, palette)` for the terrain and `drawLevelEntity(ctx, ent, camera, palette, DEFAULT_ENTITY_PALETTE)` per entity. Do **NOT** hand-write a tile loop and do **NOT** special-case rendering per `entity.kind`.

## 7. Coins & collectibles

Use the engine's first-class `'collectible'` entity kind + the pure-progression `collect` / `hasCollected` ops. Per-level scoping is consumer-owned: a `Record<levelId, CollectibleSave>` keyed on the level's `fnv1a` hash.

```ts
const save = loadSave(storage, DEFAULT_SAVE_KEY);
let collected: CollectibleSave =
  (save?.collectibles?.[levelHash] as CollectibleSave) ?? { collected: [] };

// each fixed step — kernel unaware of collectibles; derive from AABB
const pickups = derivePickups(playerRect, compiled.entities, 'coin');
for (const p of pickups) {
  if (hasCollected(collected, p.entityId)) continue;
  collected = collect(collected, p.entityId);
  audio.playTone('triangle', 600, 1200, 90, 0.18);          // 2-tone ding-ding
  particles = [...advance(spawn(p.point.x, p.point.y, { count: 6, speed: 1.5, life: 18, size: 2 }), dt), ...particles];
  scoreTexts.push({ text: '+200', origin: p.point, tween: createTweenState(...) });
}
writeSave(storage, DEFAULT_SAVE_KEY, { ...save, collectibles: { ...save?.collectibles, [levelHash]: collected } });
```

Floating "+200" via `drawText`/`drawTextOutlined`, animated by `createTweenState` driving `easeOutCubic` upward float + `easeOutBack` scale-in.

## 8. Camera

Horizontal-only follow with a soft right-leader (Mario runs right → camera centers slightly *left* of hero so the leading edge has more screen space). Use **`createCamera`** + **`updateCamera`** with built-in snap-to-target — the engine does the snap; do NOT hand-roll a `Math.abs(diff) < 0.1` early-exit.

```ts
const camera = createCamera({
  ...DEFAULT_CAMERA,
  viewportW: CANVAS_W, viewportH: CANVAS_H,
  clampX: [0, levelWidthPx - CANVAS_W], clampY: [0, levelHeightPx - CANVAS_H],
  lookaheadX: 80,        // target 80px right of hero
  smoothing: 0.18,       // tune in playtest
  snapThresholdX: 0.5,   // snap within 0.5px — avoid decay stall
});
// each render — shake amplitude decays via shakeEnvelope over ~10 ticks
const targetX = hero.x + (hero.facing === 1 ? lookaheadX : -lookaheadX * 0.5);
const next = updateCamera(camera, targetX, hero.y);
ctx.save();
const shake = sineShake(tick, /*amp*/ 4, /*freq*/ 30);
ctx.translate(-next.x + shake.x, -next.y + shake.y);
// ... draw scene ...
ctx.restore();
```

## 9. Parallax background

Three layers at the engine's tuned depth constants `PARALLAX_FAR` / `PARALLAX_MID` / `PARALLAX_NEAR` (0.15 / 0.5 / 0.85 — gives the right SMB-overworld feel directly). All three via **`drawTiledParallax`**. Pre-render each tile once at boot with `outlineRect`/`drawGlow` and a per-layer palette, then tile horizontally forever:

- **Far (mountains):** jagged horizon. Palette: lavender → deep purple → near-black.
- **Mid (bushes):** soft humps on ground row. Palette: green → forest green. Repeats ~96 px.
- **Near (clouds):** puffy white `outlineRect` blobs + subtle `drawGlow`. Palette: white → soft cyan. Floats at ~30% sky height.

```ts
// boot — offscreen canvas per layer
const farTile  = makeMountainTile(128, 64, farPalette);
const midTile  = makeBushTile(96, 32, midPalette);
const nearTile = makeCloudTile(80, 40, nearPalette);

// each render — engine handles offset math
drawTiledParallax(ctx, farTile,  camera.x * PARALLAX_FAR,  canvasH - 64);
drawTiledParallax(ctx, midTile,  camera.x * PARALLAX_MID,  canvasH - 32);
drawTiledParallax(ctx, nearTile, camera.x * PARALLAX_NEAR, skyYCloud);
```

Row `yTop`s are tuning choices — commit as constants in `src/parallax.ts`.

## 10. Game feel checklist (the juice — every item uses the engine)

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

## 12. File layout (suggested)

```
src/
  main.ts                       # boot: canvas, save load, level compile, loop.start()
  game/
    state.ts                    # World, HeroEntity, EnemyEntity, Particle[] types
    step.ts                     # fixed-step: input → platformer.step → enemies → pickups → audio → camera
    render.ts                   # pure draw: parallax, tiles, entities, FX, HUD
    parallax.ts                 # 3 pre-rendered tile factories (mountain / bush / cloud)
    sfx.ts                      # one fn per sound
    skin.ts                     # hero palette resolution (DEFAULT_SKIN_PRESET → fill/outline/accent)
  level/
    world-1-1.ts                # THE hand-authored LevelData constant — every block placed by a human
    compile.ts                  # validateLevel → migrateLevel → compileLevel → createTileQuery
  input.ts                      # createKeyboardAdapter + createTouchButtonSet + orEdges
  audio.ts                      # createAudioAdapter + SFX preset helpers
  save.ts                       # createLocalStorageSaveStorage + loadSave/writeSave wrapper
  particles.ts                  # spark/debris particle sets keyed by event type
```

## 13. Acceptance criteria

1. `npm run dev` boots a playable level with keyboard (**←→/A/D** move, **Space/Z** jump) **and** on-screen touch buttons on coarse-pointer (**← → + JUMP** pad).
2. Camera scrolls horizontally as hero runs right, leading ahead slightly.
3. Hand-authored level contains **≥3 `?`-blocks, ≥6 brick blocks, 2 pipes, 2 goombas, 1 koopa, 1 flagpole**, plus sufficient coins to demo the pick-up loop.
4. **Coin collectibles persist across reload via `save` + `collect`/`hasCollected`** — collected coins stay collected; un-collected coins still pick-up-able. Total score persists in same `save` blob.
5. Stomp a goomba → hit-stop + squish anim + "+100" floating popup (`drawText` + `easeOutCubic`).
6. Stomp a koopa → shell emerges, then slides in the last-stomp direction + "+200" / "+400" popups on shell-kick. Shell can kill goombas.
7. Hit a `?`-block → coin emerges + "coin" ping + score+200.
8. **Parallax** has ≥3 distinct scroll-speed layers (`PARALLAX_FAR` mountain, `PARALLAX_MID` bushes, `PARALLAX_NEAR` clouds).
9. **`prefers-reduced-motion`** renders one static frame and starts no loop.
10. **Zero hand-rolled reimplementations** — grep returns no matches for: `requestAnimationFrame`, `Math.random` in `step/`, manual AABB collision, manual frame-based easing, hand-drawn tile renderers.
11. **No moonwalk.** Walking left faces left on hero and every locomotion-driven enemy. Enforced by `ctx.scale(facing, 1)`.
12. **No appendage blow-out.** Hero cap/hair stretch drives from `advanceSpringRod`, never raw `advanceSpringChain`.
13. **Level data is valid** (`validateLevel` returns `{ ok: true }`); **FSM transitions are legal** (`reduceGameState` passes `isLegalTransition(from, to)`).

## 14. Stretch goals (only after criteria 1–14)

1. **Per-zone palettes via `generatePalette`** — add `World 1-2` (underground) and `World 1-3` (castle). Three modes: overworld, underground (dark blue + greens), castle (purple-grey + red).
2. **Cosmetic palette skins** — `generateSkinVariants({ base: '#E04020', accent: '#2080E0' }, count: 3)` × `grantSkin` × `createMemoryIAPAdapter`. Bitmap-font pause-menu picker cycles owned skins.
3. **Power-up equivalent** — "super mushroom" that, on pickup, swaps hero to a bigger `outlineRect` via `cosmetics` + `iap` unlock. Drives the power-up `playTone` from §11.
4. **Three HUD cosmetic themes** — "Classic" / "Sokpop" / "NES Limited" — pulled from `DEFAULT_SKIN_PRESET` at HUD draw time.

---

**Build order suggestion:** loop + input + static hero on a flat floor (✓1) → tile collision + `compileLevel` of a 30-tile strip (✓1, 13) → gravity + jump + horizontal camera (✓1, 2) → `?`-blocks + coins via `collectibles` (✓4, 7) → goombas + stomp hit-stop (✓5) → koopas + shell + flagpole (✓6, 14) → parallax 3-layer (✓8) → juice (squash/shake/footsteps) (✓10–12) → coin persistence + reduced-motion gate (✓4, 9) → cosmetic stretch. Get the SMB-on-Sokpop feel right in step 1 and every later step slots into that vibe.
