# Prompt: "Celerock" — a juicy Celeste-aesthetic precision platformer built on `aicraft-engine`

> Paste this whole document to a coding agent (Claude / Cursor / etc.). It is a complete build brief: concept, tech stack, architecture mapped to the engine's real API, per-system specs, and acceptance criteria. The agent should produce a single runnable Vite + TypeScript browser game that imports everything from `aicraft-engine` (the npm package) and writes **no** re-implementations of what the engine already provides.

---

## 0. You are building

**Celerock** — a single-character precision platformer in the *Forsaken City* aesthetic: a young mountaineer climbs a snowy peak through ~5 hand-designed rooms, each teaching one new technique (jump / wall-jump / dash / dash-into-wall). The feel target is **Celeste-tight**: variable-height jump (tap = short hop, hold = full), a horizontal dash that snaps exactly four tiles, wall-slide that slows the fall, wall-jump that fires the player up-and-opposite, hit-stop on dash-into-wall, screen shake on hard landings, instant respawn, and a strawberry counter that persists across reloads. Nothing procedural — every room is hand-built and deterministic.

**Non-negotiable: build the entire game on top of `aicraft-engine`.** Do not hand-roll the controller, fixed-step loops, AABB collision, cameras, footstep detection, particles, jump arcs, locomotion, palettes, or audio — those are all in the engine. If you find yourself writing a horizontal-velocity clamp, a wall-slope check, a jump-apex formula, a dash-frame counter, or `Math.random()` in the simulation, STOP and use the engine instead. The whole point of Celerock is to show off the **platformer kernel** (`defaultPrecisionPipeline`) plus the **`collectibles`** + **`save`** pillars that Embertomb doesn't touch.

## 1. Tech stack & install

```bash
npm create vite@latest celerock -- --template vanilla-ts
cd celerock
npm install aicraft-engine
npm install -D vite
```

- **TypeScript**, strict. Target ES2021, `moduleResolution: bundler` (matches the engine; Vite resolves its ESM fine).
- **Vite** dev server + build. Single `<canvas>` in `index.html`.
- **`aicraft-engine`** is your only runtime dependency. Import from the **root barrel only**:
  ```ts
  import {
    // game-loop + game-state
    createGameLoop, DEFAULT_FIXED_DT,
    createGameState, reduceGameState, isLegalTransition, DEFAULT_GAME_STATE_ADJACENCY,

    // input
    createKeyboardAdapter, createTouchButtonSet, orEdges,

    // platformer kernel — THE big showcase for Celerock
    createPlatformerController, createPlatformerState, stepPlatformer,
    defaultPrecisionPipeline, DEFAULT_PLATFORMER_CONFIG,
    DEFAULT_PLAYER_WIDTH, DEFAULT_PLAYER_HEIGHT,
    jumpAbility, wallSlideAbility, dashAbility, doubleJumpAbility,
    compileLevel, advanceMovingPlatform, movingPlatformToSolid,
    createMovingPlatformDisplacementProvider,
    drawActor, drawTileGrid, drawLevelEntity,

    // collision (only for hazards — the player uses the kernel)
    aabbOverlap, tileToWorld, worldToTile,

    // camera
    createCamera, updateCamera,

    // collectibles (pillar that Embertomb doesn't show)
    collect, hasCollected, derivePickups,

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

    // bitmap text (death counter, room title cards, "Press X to respawn")
    drawText, drawTextOutlined, measureText, DEFAULT_FONT, DEFAULT_TEXT_COLOR,

    // easing + tween (death-and-respawn flash, room transitions)
    easeOutCubic, easeOutBack, createTweenState, advanceTween,

    // audio + rng + palette
    createAudioAdapter,
    mulberry32, nextInt, nextFloat, pick,
    generatePalette, lerp,
  } from 'aicraft-engine';
  ```
  Tree-shaking works because every export has `sideEffects: false`. Never deep-import subpaths like `aicraft-engine/platformer` — use the root barrel.

## 2. Determinism & discipline rules (enforced by the engine — follow them)

- **Fixed-step sim, variable render** via `createGameLoop({ fixedDt: 1/60, step, render })`. Poll input **exactly once per `step`**.
- **No `Math.random()` in the simulation.** Use `mulberry32(seed)` → `nextInt` / `nextFloat` / `pick` for any decorative seeding. `Math.random` is only OK for purely decorative audio/visual side-effects that never feed back into game state (e.g. UI blink timing).
- **No `Date.now()` in the sim.** Time comes from `tick` or the loop's `dt`.
- **Defensive host access.** Anything touching `window`/`AudioContext`/`matchMedia` goes through the engine's adapters (`createAudioAdapter`, `prefersReducedMotion`, `resizeCanvasToBackingStore`, `createLocalStorageSaveStorage`) — they're lazy, error-swallowing, and no-op in Node.
- **Reduced motion.** Gate the loop: if `prefersReducedMotion()`, render one static frame of room 1 and never call `loop.start()`.
- **Pure progression ops.** The kernel and `collect`/`hasCollected` already return new objects — follow their lead. Never mutate `PlatformerState` or `CollectibleSave` in place. (The platformer kernel is the canonical example — it returns a brand-new state per tick.)
- **Platformer pillar's abilities return new states immutably.** `stepPlatformer(state, input, solids, dt)` returns a fresh state. If you find yourself writing manual AABB or velocity code in the player section, STOP and call the kernel instead.

## 3. Architecture — engine module → game system map

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
| Death counter, room title cards, "Press X to respawn" | `drawText`, `drawTextOutlined`, `drawText(..., DEFAULT_FONT)` |
| Tween (death-and-respawn flash, room transitions) | `createTweenState`, `advanceTween`, `easeOutCubic`, `easeOutBack` |
| Synthesized SFX | `createAudioAdapter` |
| Per-room palette (snow / dusk / dusk-2 / etc.) | `generatePalette`, `lerp` |
| Frame FSM (menu / playing / dead-flash / levelComplete) | `createGameState`, `reduceGameState`, `isLegalTransition`, `DEFAULT_GAME_STATE_ADJACENCY` |
| Cosmetic hair colour unlocks (stretch) | `cosmetics` pillar (`generateSkinVariants`), `iap` (`createMemoryIAPAdapter`) |

## 4. The player

The player is built in **two layers**: the **physics** is the platformer kernel, the **art** is overlay rendering on top.

- **Physics layer.** Build the controller once at boot, then call it every tick with the current state + input snapshot:
  ```ts
  const controller = createPlatformerController(defaultPrecisionPipeline(), DEFAULT_PLATFORMER_CONFIG);
  let state = createPlatformerState(spawnX, spawnY);
  // each fixed tick:
  const { state: next } = controller.step(state, input, solids, dt);
  state = next;
  ```
  The kernel handles variable-height jump (tap = short, hold = full), wall-slide (slower fall when grounded-on-wall side), wall-jump (fires up-and-opposite, applies `facing` flip), dash (overrides velocity for N frames, snaps 4 tiles horizontally), and double-jump in the locked pipeline order (`jump → wallSlide → dash → doubleJump`).
- **Spawn.** Build one level at a time via `compileLevel(levelData)` — that returns a `CompiledLevel` (tile grid + entities + moving-platform runtime). Pass the entities' solids (via `tileRect` from the grid or `movingPlatformToSolid` for moving ones) to the kernel as the `solids` argument. For moving-platform rooms, pass `createMovingPlatformDisplacementProvider(level)` to `createPlatformerController`'s options as `getSolidDisplacement` so the kernel carries the player off moving solids automatically.
- **Body render.** Body = `outlineRect(ctx, cx - w/2, cy - h/2, w, h, palette.base, palette.outline)` with `volumeScale(squashOffset)` composed over idle `breathe(tick, DEFAULT_BREATH)`. Volume-preserving: when vertical squashes by `s`, horizontal stretches by `1/s`. `squashOffset` spikes **negative** (stretch up) on launch and **positive** (squash down) on landing, decaying exponentially each step.
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
- **Hair.** One `createSpringRod` strand anchored at the top-back of the head (forward `restDirection` bias so it flows back while moving forward, lifts up when dashing). Always `advanceSpringRod(hair, anchor, dt)` — never the raw `advanceSpringChain`, which lacks bend resistance and can numerically blow a node off-screen.
- **Walk cycle.** `evaluateLocomotion(loco, DEFAULT_GAIT)` drives feet via `drawSimpleFeet`. Advance phase by displacement, not time: `loco = advanceLocomotionByDisplacement(loco, vx * facing, DEFAULT_GAIT)` so feet plant when idle (no foot-slide while standing still or holding against a wall).
- **Foot-tap audio.** `plantState = createFootPlantState()`; each step `plantState = advanceFootPlant(plantState, pose.leftFootOffset.y, pose.rightFootOffset.y)`. On `plantState.events.leftPlanted` / `rightPlanted` fire `audio.playNoise(40, 'lowpass', 200, 0.12)`. Syncs taps to the *visible* walk cycle, not a timer.
- **Airborne tuck.** `blendAirborneTuck(footOffset, airborneBlend, DEFAULT_TUCK)` — `airborneBlend` ramps 0→1 once the player leaves the ground; releases on contact.

## 5. Rooms (5 hand-designed rooms, each teaches one technique)

Celerock is **hand-designed**, not procedural. Use the level schema (`compileLevel` accepts `LevelData` with `entities: LevelEntity[]` discriminated by `EntityKind`). Below is a sketch — write them out as actual tile grids + entity lists, then `compileLevel(levelData)` each at boot. Keep rooms small (≤ 20 tiles wide × ≤ 15 tiles tall, `DEFAULT_TILE_SIZE` is usually 16 or 32 — pick one and stick to it).

| # | Name | Teaches | Sketch |
|---|---|---|---|
| **1** | **Forsaken City** | Flat ground + first jump | A 12-tile floor, one 1-tile high platform at x=6, one strawberry above it. Teaches the kernel: walk + jump + variable-height. |
| **2** | **Old Site** | Variable-height jump over gaps | A 10-tile floor with two 2-tile gaps (2 tiles wide × 1 tile deep). One strawberry at the far end. Teaches jump-arc judgment. |
| **3** | **Resolution** | Wall-slide | Tall narrow corridor (4 tiles wide × 14 tiles tall). Walls on both sides. Snowfall particle layer behind. Teaches wall-slide. |
| **4** | **Through the Mirror** | Wall-jump | Same corridor as room 3 but with horizontal ledges every 3 tiles vertically. Teaches chaining wall-jumps to ascend. |
| **5** | **The Summit** | Dash + dash-into-wall hit-stop | Corridor with one vertical wall mid-room and one strawberry placed directly behind it — only reachable with dash. Teaches dash + the iconic hit-stop-and-shake moment. One moving-platform gully between room transitions. |

Room transitions: on reaching the `trigger` goal tile (treat as an AABB hit against a `goalRect` registered at boot), transition `playing → levelComplete` (see §8), advance `roomIndex`, re-`compileLevel(roomDef)`.

For each room, write a small fixed-draw layer using `drawTileGrid(ctx, room.tileGrid, dt, parallaxOffset(camera, 0.2))` (the kernel handles the player's solid-against-tile collision because the tiles are in the level schema). Use `drawActor(ctx, playerRect, palette)` for the player entity render path, OR override with `drawLevelEntity` if you register the player as an entity.

Hand-tip: put one **moving platform** in room 5 (or as the room-to-room connector) so the kernel's `movingPlatformToSolid` + `createMovingPlatformDisplacementProvider` path gets exercised. The kernel's step-2 (carry) will automatically move the player with the platform.

## 6. Hazards

The engine does **not** ship a first-class hazard module (hazards are level entities of `kind === 'trap'` in the level schema). Celerock needs spikes — wrap a player-state AABB check in a `tryStep` so the player respawns in place:

- **Static spikes.** Where the level designer places `'trap'` entities of subtype `"spikes"` (your convention), fold them into a `hazardRects: Rect[]` array at boot. Each tick, check `aabbOverlap(playerRect, hazardRect)` — if true AND the player is moving downward (`state.core.vy > 0`) or freshly landed on a hazard tile (`events.justLanded` while their AABB overlapped a hazard), trigger death.
- **Moving spike row (room 5 stretch).** One `'movingPlatform'` entity with the spike geometry on top. Because the kernel rides moving platforms automatically (see step-2 carry), the player gets carried into the spike and dies correctly. No extra code — the platformer kernel already does this for free.

Death effect: `triggerHitStop(hitStop, 6)` (very short, flicks), `audio.playNoise(120, 'lowpass', 400, 0.3)`, spawn 8 dust particles via `sampleConeVelocity` upward from the player's position, transition FSM to `dead` for ~12 frames (the **respawn flash**), then instantly `playing` at the room's spawn point with `squashOffset = 0` and the death counter incremented.

## 7. Collectibles — strawberries (the engine's `collectibles` pillar)

**Use the engine's `collectibles` module. Do NOT hand-roll "is this strawberry already collected" or pickup math.**

- **Spawn strawberries as entities.** In each room's `LevelData`, include `LevelEntity` records with `kind: 'collectible'` and `props.kind: CollectibleKind` (engine-level `coin | gem | key` enum — for Celeste, **define a `'strawberry'` literal in your own union** by storing the entity's id and treating that id as the strawberry item when restoring). Or simpler: keep the engine `CollectibleKind` and use `gem` as the visual stand-in for strawberry — same AABB, same persistence semantics, render with `drawGlow` + `outlineRect` in `palette.feature`.
- **Derive pickups deterministically each tick** (this is what keeps replays correct — the kernel stays unaware of collectibles, so `derivePickups` re-derives the same pickup events from the same inputs):
  ```ts
  const playerRect: PlayerRect = {
    x: state.core.x, y: state.core.y, w: state.core.width, h: state.core.height,
  };
  const { collected } = derivePickups(playerRect, room.collectibles, collectibleSave);
  for (const id of collected) {
    collectibleSave = collect(collectibleSave, String(id));
    audio.playTone('triangle', 600, 1200, 60, 0.15);  // ping
    spawn(strawberry.x, strawberry.y, { count: 8, speed: 3, life: 24, size: 4 });
  }
  ```
- **Persistence** (the save pillar): on boot, `const save = loadSave(storage, 'celerock:strawberries') ?? { collected: [] }`. After each `collect` call, `writeSave(storage, 'celerock:strawberries', save)`. Death counter should also persist — same pattern with a `'celerock:deaths'` key.
- **Render strawberries** by reading the level entity list and skipping any where `hasCollected(collectibleSave, String(entity.id))` is true; for the uncollected ones, draw a pulsing diamond outline with `drawGlow` (intensity ramps with `Math.sin(tick / 20)` from the render frame).
- **'gem' is recommended over 'coin' for strawberries** because their value semantics match (single-pickup, persistent, persistent-across-reload). Use whatever visual look fits the room.

## 8. Game state FSM

Use the engine's `game-state` reducer, not a hand-rolled enum switch:

```ts
// boot:
const initialState = createGameState({ mode: 'menu' });

// each tick:
const { state: next } = reduceGameState(initialState, gameEvent);
if (!isLegalTransition(next.mode, gameEvent, DEFAULT_GAME_STATE_ADJACENCY)) {
  // optional: log a debug warning; never throw
}
initialState = next;
```

Adjacency in your game:

- `menu → playing` on first input (any keypress).
- `playing → playing` for everything normal.
- `playing → dead` on hazard AABB hit.
- `dead → playing` after 12-tick respawn flash (instant respawn — **no level reset**, just snap player to the room's spawn point with `squashOffset = 0`).
- `playing → levelComplete` on reaching the goal tile (pick a `trigger` entity).
- `levelComplete → playing` immediately for `roomIndex + 1` (loop back to room 0 after room 4).
- A brief `levelComplete` stay should still call `reduceGameState` 1× to render the "Cleared" text card (via `drawTextOutlined`), then auto-advance.

Events: avoid hand-rolling `state.mode = X`; just `reduceGameState(state, { type: 'enter', mode: 'playing' })`.

## 9. Game feel checklist (the juice — every item uses the engine)

- [ ] Launch stretch + landing squash (`volumeScale` over `breathe`)
- [ ] Hit-stop on **dash-into-wall** — detect as `state.abilities.dash.timer > 0 && state.events.hitWall` on the same tick, then `triggerHitStop` — the iconic Celeste moment
- [ ] Hit-stop on death
- [ ] Screen shake on dash-bonk and hard landings (`sineShake` + `shakeEnvelope` decaying)
- [ ] Air control during jump (built into `dashAbility` — verify by feel)
- [ ] Dash trail particles (`spawn` 4 small white particles on each dash tick, culled by `cull`)
- [ ] Phase-synced landing dust (`spawn` upward cone on landing)
- [ ] Reduced-motion gate (`prefersReducedMotion`) renders room 1 and starts no loop
- [ ] Coyote time + jump buffer (consumer-side 4-tick timers in `step` — the kernel's `jumpAbility` doesn't include these, so they're a thin consumer wrapper)
- [ ] Spring-rod hair (`advanceSpringRod`) wags backward when moving, lifts during dash
- [ ] Room title cards fade in over 0.6s (`createTweenState` + `easeOutCubic`); "Cleared" card uses `easeOutBack` for Celeste's bouncy entry

## 10. Audio (all synthesized via `createAudioAdapter`)

Unlock on first user gesture (one-shot `keydown`/`pointerdown` calling `audio.unlock()`). Then:

- **Walk tap:** `playNoise(40, 'lowpass', 200, 0.12)` per `advanceFootPlant` event.
- **Jump:** `playTone('sine', 200, 400, 80, 0.2)` (upward boing).
- **Wall-jump:** `playTone('triangle', 300, 500, 60, 0.18)` (slightly different timbre).
- **Wall-slide:** continuous soft noise, gated: `playNoise(20, 'highpass', 800, 0.05)` each tick while `state.abilities.wallSlide.sliding === true`. Start a smooth ramp on `events.startedWallSlide`; fade on the tick it goes false.
- **Dash:** `playNoise(60, 'bandpass', 1500, 0.18, 80)` (short whoosh).
- **Dash-into-wall hit-stop:** `playTone('square', 120, 90, 70, 0.25)` (low thump).
- **Land (hard):** `playNoise(80, 'lowpass', 300, 0.3)`; (soft): `playNoise(50, 'lowpass', 250, 0.18)`.
- **Strawberry:** `playTone('triangle', 600, 1200, 60, 0.15)` (a two-note arpeggio: same recipe played twice ascending).
- **Death:** `playNoise(120, 'lowpass', 400, 0.3)` + descending `playTone('sine', 400, 80, 200, 0.25)`.
- **Respawn:** quick rising `playTone('sine', 200, 600, 100, 0.18)`.

## 11. File layout (suggested)

```
src/
  main.ts              # boot: canvas, store, audio.unlock, loop.start()
  game/
    state.ts           # World, RoomData, CollectibleSave, death counter
    step.ts            # the fixed-step: input → controller.step → pickups → audio
    render.ts          # pure draw: parallax, tiles, hazzards, player art, UI
    rooms.ts           # 5 hand-designed room defs (LevelData[] with entities)
    player.ts          # player render: face/hair/feet (kernel does physics)
    hazards.ts         # spike geoms + the hazard AABB check + respawn flash
    collectibles.ts    # strawberry wiring: derivePickups → collect → writeSave
  input.ts             # createKeyboardAdapter + createTouchButtonSet + orEdges
  audio.ts             # createAudioAdapter + the SFX recipe helpers
  save.ts              # createLocalStorageSaveStorage + loadSave / writeSave helpers
```

## 12. Acceptance criteria

1. Playable in the browser via `npm run dev` with keyboard (`←→`/`A D`, `Space` jump, `Shift` / `X` dash) **and** on-screen touch buttons on coarse-pointer devices (via `createTouchButtonSet`).
2. All **5 rooms reachable**; each teaches one new technique (criteria 1–4 below). Same input sequence → same-room-geometry on every reload (no `Math.random` in level defs).
3. At least **one room uses wall-jump** (room 4) and **one room uses dash** (room 5) **and** room 5 uses **both** (wall + dash past it).
4. The **"dash-into-wall"** moment has audible hit-stop + visible shake — detect as `state.abilities.dash.timer > 0 && state.events.hitWall` on the same tick, then `triggerHitStop` + `sineShake` (decaying envelope).
5. Strawberries persist across page reload via the engine's `save` module (`createLocalStorageSaveStorage` + `writeSave`).
6. Death counter increments every respawn (in-memory for the bare demo; persisted via `save` is the named-stretch upgrade).
7. `prefersReducedMotion` renders room 1 statically and never calls `loop.start()`.
8. **Zero hand-rolled reimplementations** of: fixed-step loop, AABB/tile collision for the player, jump-arc math, dash-frame timer, camera follow, locomotion phase, foot-plant detection, particle stepping, or text rendering. All come from `aicraft-engine`. The reviewer will grep for `requestAnimationFrame` outside `node_modules`, `Math.random` inside `step`, manual AABB resolvers, and hand-drawn tile renderers — none should appear in `src/`.
9. **No moonwalk.** Walking left faces left in the player. Enforced by the `ctx.scale(facing, 1)` mirror around the body draw (see §4). The reviewer will playtest.
10. **No appendage blow-out.** The hair uses `advanceSpringRod`, never the raw `advanceSpringChain`. Grep for `advanceSpringChain` outside `node_modules` — must not appear.

## 13. Stretch goals (only after criteria 1–10)

- **Optional 8-way dash.** Replace the kernel's `dashAbility` horizontal snap with a custom `dashAbility` variant that takes an aim direction (8-way) — append to `[...defaultPrecisionPipeline(), customDashAbility]` to swap in.
- **Badeline chase ghost (visual only):** render a colored "ghost" character whose input snapshot is the player's from N frames ago. Buffer the last `N` `PlatformerInput` snapshots in a ring; on each tick, replay the buffered input through a *second* `createPlatformerController` instance with a tinted `palette.feature` and render its `state.core.x/y`. No new physics code — the kernel does the work twice.
- **Cosmetic hair colour unlocks** via `generateSkinVariants` + `createMemoryIAPAdapter` from the `cosmetics` + `iap` pillars. Skin variants change the hair's `palette.feature`; one unlockable per room-clear (a lavender, a cyan, an auburn). This is the **easiest possible cosmetics demo** and the cleanest bridge from Celerock to Embertomb's IAP surface.
- **Per-room seeded palette** — `const palette = generatePalette(mulberry32(room.seed | 0))` so each room has its own dusk/snow/dusk2/snow2/dusk3 look.

---

**Build order suggestion:** loop + input + the kernel running on a static player in room 1 (criterion 2) → touch/parallax + kill the moonwalk (criteria 1, 9) → variable-height jump feel + landing squash (juice) → wall-slide + wall-jump in rooms 3 & 4 (criterion 3) → dash + dash-into-wall hit-stop/shake (criteria 4) → strawberries + persistence (criteria 5–6) → FSM polish + reduced-motion gate (criteria 7, 8) → cosmetic stretch (badeline / hair unlocks). Get the **dash-into-wall** moment right before breadth — that's the feel target.
