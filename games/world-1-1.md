# Prompt: "World 1-1" — a horizontal-scrolling platformer slice built on `aicraft-engine`

> Paste this whole document to a coding agent (Claude / Cursor / etc.). It is a complete build brief: concept, tech stack, architecture mapped to the engine's real API, per-system specs, and acceptance criteria. The agent should produce a single runnable Vite + TypeScript browser game that imports everything from `aicraft-engine` (the npm package) and writes **no** re-implementations of what the engine already provides.

---

## 0. You are building

**World 1-1** — a single horizontal-scrolling platformer slice: one hand-authored level, ~3–4× screen widths long, where a small chunky Sokpop-style hero runs right, jumps over goombas and pipes, hits a `?`-block for a coin, defeats a koopa, climbs a flagpole at the end, and watches a 3-layer parallax background drift past. The feel target is **NES-Mario-meets-Sokpop**: variable-height jump, hit-stop on stomps, squash-and-stretch on launch/landing, screen shake, the 2-tone "ding-ding" coin ping. Rendering is procedural with no imported art; the level layout itself is deliberately hand-authored.

**Non-negotiable: build the entire game on top of `aicraft-engine`.** Do not hand-roll fixed-step loops, AABB collision, cameras, jump arcs, level compilation, tile rendering, parallax, particle bursts, or audio synthesis. If you find yourself writing a `requestAnimationFrame` accumulator, a tile renderer, a `Math.random()` in the simulation, or a pixel-art Mario, stop and use the engine instead.

## 1. Tech stack & install

```bash
npm create vite@latest world-1-1 -- --template vanilla-ts
cd world-1-1
npm install aicraft-engine@0.4.0
```

> This brief targets the published `0.4.0` API exactly.

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
| FSM (`menu → playing → gameover` or `levelComplete`) | `createGameState`, `reduceGameState`, `isLegalTransition` |
| Input (keyboard + touch + gamepad) | `createKeyboardAdapter`, `createTouchButtonSet`, `createGamepadAdapter`, `orEdges` |
| Hero controller (Mario feel) | `createPlatformerController`, `createPlatformerState`, `stepPlatformer(state, input, solids, dt, CLASSIC_PLATFORMER)`. `CLASSIC_PLATFORMER` is the **config** (5th arg — gravity/moveSpeed/abilities); the engine always runs its built-in `defaultPrecisionPipeline()` internally, so the two are NOT swap-out alternatives. |
| Hero jump (no double-jump in `CLASSIC_PLATFORMER`) | `stepPlatformer`, `CLASSIC_PLATFORMER` |
| Level compile (`LevelData` → `CompiledLevel`) | `compileLevel`; consume `compiled.tileQuery` |
| Moving platforms (optional cloud lifts) | `advanceMovingPlatform`, `movingPlatformToSolid` |
| Hero squash/stretch + breathing + walk cycle + footstep audio | `volumeScale`, `breathe`, `DEFAULT_BREATH`; `evaluateLocomotion`, `DEFAULT_GAIT`; `createFootPlantState`, `advanceFootPlant` |
| Hero legs | `drawSimpleFeet`, `DEFAULT_SIMPLE_FEET` |
| Hero cap/hair (stretch) | `createSpringRod`, `advanceSpringRod`, `DEFAULT_SPRING_ROD` (NEVER raw `advanceSpringChain`) |
| Camera (horizontal follow + snap-to-target) | `createCamera`, `updateCamera`, `DEFAULT_CAMERA` |
| Tile + entity rendering | `drawTileGrid`, `drawLevelEntity`, `drawActor`, `DEFAULT_ENTITY_PALETTE` (do NOT hand-draw tiles) |
| Coin pickup + persistence | `derivePickups`, `collect`, `hasCollected` + `createLocalStorageSaveStorage`, `loadSave`, `writeSave` |
| Goomba + koopa enemies | `compileEnemies(level)` → `stepEnemies(enemies, registry, context)` with custom `EnemyBehaviorHandler` objects; `spinnyBehavior` is NOT suited for grounded enemies |
| Particles (coin burst, stomp dust, brick shatter, flag confetti) | `spawn`, `advance`, `step`, `sampleConeVelocity` |
| Continuous emitters | `createEmitter`, `stepEmitters`, `advanceEmission` |
| Parallax 3-layer sky | `drawTiledParallax`, `PARALLAX_FAR`, `PARALLAX_MID`, `PARALLAX_NEAR` |
| Glow (coins / `?`-block flash / flagpole top) | `drawGlow`, `DEFAULT_GLOW_INTENSITY` |
| Hit-stop on stomp | `createHitStop`, `triggerHitStop`, `stepHitStop`, `isHitStopActive` |
| Screen shake | `sineShake`, `shakeEnvelope` |
| Chunky vector rendering | `outlineRect` |
| HUD bitmap text + Retina canvas + reduced-motion gate | `createFont`, `drawText`; `resizeCanvasToBackingStore`, `prefersReducedMotion` |
| Synthesized SFX | `createAudioAdapter` (`playTone`, `playNoise`) |
| Level validation + share-code serialisation + per-zone palette + colour-variant skins (mostly stretch) | `validateLevel`, `migrateLevel`, `canonicalize`, `fnv1a`; `generatePalette`, `resolvePalette`; `generateSkinVariants`, `grantSkin`, `equipSkin`, `DEFAULT_SKIN_PRESET` |

## 4. The hero

The hero is a **small round Sokpop-outlineRect chunk** — NOT pixel-art Mario. The visual genre-cue is "what if Mario was Sokpop". An homage, not a brand-exact copy.

- **Body:** positive `volumeScale` offsets stretch vertically; negative offsets
  squash vertically. Use positive on jump and negative on landing.
- **Face:** two `outlineRect` eyes + a `drawText` mouth dot, looking in facing direction.
- **Legs:** advance locomotion with
  `state.core.vx * dt * state.core.facing`, then evaluate and draw the pose.
- **⚠ Facing mirror (MANDATORY — or you moonwalk):** locomotion foot offsets are LOCAL-space assuming horizontal mirror. Wrap body+feet+face in `ctx.scale(facing, 1)`:
    ```ts
    ctx.save(); ctx.translate(bodyCx, bodyBottomY); ctx.scale(facing, 1);
    drawSimpleFeet(ctx, pose, { ...DEFAULT_SIMPLE_FEET, color: palette.base, outline: palette.outline });
    outlineRect(ctx, -w/2, -h, w, h, palette.base, palette.outline);
    // ...eyes/face...  ctx.restore();
    ```
- **Controller:** assign the immutable return:
  `state = stepPlatformer(state, input, solids, dt, CLASSIC_PLATFORMER).state`,
  then drive feedback from `state.events`.
- **Variable-height jump:** accumulate key edges with `createEdgeAccumulator`, then pass the result of `pollEdge` in `PlatformerInput.jump`.
- **Footstep audio:** assign `plantState = plantResult.state` and read
  `plantResult.events` after `advanceFootPlant`.
- **Cap/hair (stretch):** optional `createSpringRod` strand anchored at body top, `restDirection` up-and-back. Use `advanceSpringRod` (NOT raw chain). Draw OUTSIDE the facing mirror.
- **Death:** enemy contact or pit fall sends the shipped FSM a `die` event;
  use consumer-owned animation state during `gameover`, then `retry` or `quit`.

## 5. Enemies

Two archetypes. Both drawn with `outlineRect` and stepped via the platformer module's enemy pipeline.

### Goomba

- **Body:** `outlineRect` dome (two calls — body + head-bump). Warm-brown fill, two white eyes with dark pupils. Mushroom-shaped.
- **Behaviour:** patrol left at about `40 px/s` (2.5 tiles/s at a 16px tile
  size). Store velocity in px/s; convert any designer-authored tiles/s value by
  multiplying by `tileSize`. Reverse on wall/ledge probes. A non-stomp
  collision sends `{ type: 'die' }` to the FSM.
- **Stomp hit:** `triggerHitStop(hitStop, 4 ticks)`; `spawn` particle burst puffs; `audio.playNoise(60, 'lowpass', 250, 0.18)`; floating "+100" via `drawText`.

### Koopa

- **Body:** `outlineRect` shell (~18×22). Distinctive palette (green shell + cream underbelly + orange head peek). **Use `solveLimb`** for two 2-segment IK legs underneath — this is what `solveLimb` is for; don't fake stride with a single draw.
- **Behaviour:** same wall/ledge patrol. Shell contact sends `{ type: 'die' }`
  to the FSM; shell mode remains consumer-owned enemy state.
- **Stomp:** same hit-stop, louder `playNoise(80, 'lowpass', 300, 0.25)`. Score+200 first-stomp, +400 shell-kick.

### Wiring

`createEnemyBehaviorRegistry()` registers `EnemyBehaviorHandler` objects, not
bare functions. Define one object per archetype with a
`step(state, context, params): EnemyStepResult` method, then pass those objects
in the registry's custom-handler map. `spinnyBehavior` is **NOT applicable** —
these are grounded, finite-state enemies. Drive patrol with
`advanceLocomotionByDisplacement` (feet lock when stopping); wall/ledge probes
via `tileRect`/`worldToTile`. Compile level enemies with `compileEnemies(level)`
and pass the resulting state through `stepEnemies` each fixed tick.

## 6. Level entities

The level is a hand-authored **`LevelData`** constant in
`src/levels/world-1-1.ts`: 200 columns × 14 rows at 16px, so
`width: 3200`, `height: 224`, and `tileSize: 16`. `TileGrid` indices are tile
coordinates, but every `LevelEntity.rect` uses world-space pixels. Convert an
authored column with `column * tileSize`.

| Entity | Count | What it does |
|---|---|---|
| Ground (tile row + deliberate pit gaps) | full width | `TileGrid` row; pit columns 120–124 (x=1920–1984px) and 180–184 (x=2880–2944px) |
| `?`-block (`kind: 'platform'`; contents in a consumer-owned map keyed by entity ID) | **≥3** | Bumpable from below → coin + score |
| Brick blocks (`kind: 'platform'`, breakable) | **≥6** | Bumpable → shatter burst + `playNoise(60, 'lowpass', 300, 0.2)` + score+50 |
| Pipes (2–3-tall `kind: 'platform'`) | **2** | Force lateral routing; green helmet palette |
| Goomba spawns (`kind: 'enemy'`) | **≥2** | Archetype `goomba`, around columns 80 and 130 (x=1280px and 2080px), walking left |
| Koopa spawn (`kind: 'enemy'`) | **1** | Archetype `koopa`, around column 165 (x=2640px), before the flag |
| Coins (`kind: 'collectible'`, `props.kind: 'coin'`) | **≥8** | Floating + in `?`-blocks; +200 each |
| Flagpole (`kind: 'exit'`) | **1** around column 192 (x=3072px) | Final encounter after the koopa; climbed → game-state → `'levelComplete'` |

Compile once at boot:

```ts
const validation = validateLevel(WORLD_1_1);
if (!validation.valid) throw new Error(validation.errors.map(e => e.message).join('\n'));
const compiled = compileLevel(WORLD_1_1, { tileTypeMap });
const tileQuery = compiled.tileQuery;
```

Pass this same captured `tileQuery` through `EnemyUpdateContext.tileQuery` when
calling `stepEnemies`; do not classify the grid a second time.

Map the generated `Palette` into an `EntityPalette` by spreading
`DEFAULT_ENTITY_PALETTE` and overriding semantic slots. Render terrain with
`drawTileGrid(ctx, WORLD_1_1.tiles, drawTile)` and entities with
`drawLevelEntity(ctx, ent, { palette: entityPalette, drawOverride })`.

## 7. Coins & collectibles

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

## 9. Parallax background

Three layers at the engine's exported depth constants `PARALLAX_FAR` /
`PARALLAX_MID` / `PARALLAX_NEAR` (0.25 / 0.5 / 1.0). All three via
**`drawTiledParallax`**. Pre-render each tile once at boot with
`outlineRect`/`drawGlow` and a per-layer palette, then tile horizontally forever:

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
    compile.ts                  # validateLevel → migrateLevel → compileLevel; expose compiled.tileQuery
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
10. **Zero duplicate engine systems** — no direct animation-frame loop,
    random authoritative simulation, manual collision/easing, or duplicate
    tile-grid traversal. Required renderer callbacks are allowed.
11. **No moonwalk.** Walking left faces left on hero and every locomotion-driven enemy. Enforced by `ctx.scale(facing, 1)`.
12. **No appendage blow-out.** Hero cap/hair stretch drives from `advanceSpringRod`, never raw `advanceSpringChain`.
13. **Level data is valid** (`validateLevel(level).valid`, with diagnostics
    surfaced from `.errors`); FSM checks call
    `isLegalTransition(state.current, event)` with a real `GameEvent`.

## 14. Stretch goals (only after criteria 1–13)

1. **Per-zone palettes via `generatePalette`** — add `World 1-2` (underground) and `World 1-3` (castle). Three modes: overworld, underground (dark blue + greens), castle (purple-grey + red).
2. **Cosmetic palette skins** — `generateSkinVariants(levelSeed, DEFAULT_SKIN_PRESET, 3)` × `grantSkin` × `createMemoryIAPAdapter`. Bitmap-font pause-menu picker cycles owned skins.
3. **Power-up equivalent** — "super mushroom" that, on pickup, swaps hero to a bigger `outlineRect` via `cosmetics` + `iap` unlock. Drives the power-up `playTone` from §11.
4. **Three HUD cosmetic themes** — "Classic" / "Sokpop" / "NES Limited" — pulled from `DEFAULT_SKIN_PRESET` at HUD draw time.

---

**Build order suggestion:** loop + input + static hero on a flat floor (✓1) → tile collision + `compileLevel` of a 30-tile strip (✓1, 13) → gravity + jump + horizontal camera (✓1, 2) → `?`-blocks + coins via `collectibles` (✓4, 7) → goombas + stomp hit-stop (✓5) → koopas + shell + flagpole (✓6) → parallax 3-layer (✓8) → juice (squash/shake/footsteps) (✓10–12) → coin persistence + reduced-motion gate (✓4, 9) → cosmetic stretch. Get the SMB-on-Sokpop feel right in step 1 and every later step slots into that vibe.
