# Prompt: "Celerock" — a juicy Celeste-aesthetic precision platformer built on `aicraft-engine`

> Paste this whole document to a coding agent (Claude / Cursor / etc.). It is a complete build brief: concept, tech stack, architecture mapped to the engine's real API, per-system specs, and acceptance criteria. The agent should produce a single runnable Vite + TypeScript browser game that imports everything from `aicraft-engine` (the npm package) and writes **no** re-implementations of what the engine already provides.

---

## 0. You are building

**Celerock** — a single-character precision platformer in the *Forsaken City* aesthetic: a young mountaineer climbs a snowy peak through ~5 hand-designed rooms, each teaching one new technique (jump / wall-jump / dash / dash-into-wall). The feel target is **Celeste-tight**: variable-height jump (tap = short hop, hold = full), a short configured horizontal dash, wall-slide that slows the fall, wall-jump that fires the player up-and-opposite, hit-stop on dash-into-wall, screen shake on hard landings, instant respawn, and a strawberry counter that persists across reloads. Nothing procedural — every room is hand-built and deterministic.

**Non-negotiable: build the entire game on top of `aicraft-engine`.** Do not hand-roll the controller, fixed-step loops, AABB collision, cameras, footstep detection, particles, jump arcs, locomotion, palettes, or audio — those are all in the engine. If you find yourself writing a horizontal-velocity clamp, a wall-slope check, a jump-apex formula, a dash-frame counter, or `Math.random()` in the simulation, STOP and use the engine instead. The whole point of Celerock is to show off the **platformer kernel** (`defaultPrecisionPipeline`) plus the **`collectibles`** + **`save`** pillars that Embertomb doesn't touch.

## 1. Tech stack & install

```bash
npm create vite@latest celerock -- --template vanilla-ts
cd celerock
npm install aicraft-engine@0.3.0
```

> Release-preparation note: the implementation requirements below target the
> pending 0.4.0 API. Keep the verified 0.3.0 pin until 0.4.0 is published,
> then update the pin and verify this prompt against the registry tarball.

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

    // level schema (used to author the 5 hand-designed rooms)
    type LevelData, type LevelEntity, type EntityKind, type CollectibleKind,

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

    // bitmap text (death counter, room title cards, "Press X to respawn")
    drawText, drawTextOutlined, measureText, DEFAULT_FONT, DEFAULT_TEXT_COLOR,

    // easing + tween (death-and-respawn flash, room transitions)
    easeOutCubic, easeOutBack, createTweenState, advanceTween,

    // audio + rng + palette
    createAudioAdapter,
    mulberry32, nextInt, nextFloat, pick,
    generatePalette, lerp, type Palette,
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
| Death counter, room title cards, "Press X to respawn" | `drawText`, `drawTextOutlined`, `drawText(..., { font: DEFAULT_FONT })` |
| Tween (death-and-respawn flash, room transitions) | `createTweenState`, `advanceTween`, `easeOutCubic`, `easeOutBack` |
| Synthesized SFX | `createAudioAdapter` |
| Per-room palette (snow / dusk / dusk-2 / etc.) | `generatePalette`, `lerp` |
| Frame FSM (menu / playing / gameover / levelComplete) | `createGameState`, `reduceGameState`, `isLegalTransition`, `DEFAULT_GAME_STATE_ADJACENCY` |
| Cosmetic hair colour unlocks (stretch) | `cosmetics` pillar (`generateSkinVariants`), `iap` (`createMemoryIAPAdapter`) |

## 4. The player

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

## 5. Rooms (5 hand-designed rooms, each teaches one technique)

Celerock is **hand-designed**, not procedural. Use the level schema (`compileLevel` accepts `LevelData` with `entities: LevelEntity[]` discriminated by `EntityKind`). Below is a sketch — write them out as actual tile grids + entity lists, then `compileLevel(levelData, { tileTypeMap })` each at boot. Keep rooms small (≤ 20 tiles wide × ≤ 15 tiles tall). `DEFAULT_TILE_SIZE` is exactly 16; use it or choose one explicit consumer tile size and keep it consistent.

| # | Name | Teaches | Sketch |
|---|---|---|---|
| **1** | **Forsaken City** | Flat ground + first jump | A 12-tile floor, one 1-tile high platform at x=6, one strawberry above it. Teaches the kernel: walk + jump + variable-height. |
| **2** | **Old Site** | Variable-height jump over gaps | A 10-tile floor with two 2-tile gaps (2 tiles wide × 1 tile deep). One strawberry at the far end. Teaches jump-arc judgment. |
| **3** | **Resolution** | Wall-slide | Tall narrow corridor (4 tiles wide × 14 tiles tall). Walls on both sides. Snowfall particle layer behind. Teaches wall-slide. |
| **4** | **Through the Mirror** | Wall-jump | Same corridor as room 3 but with horizontal ledges every 3 tiles vertically. Teaches chaining wall-jumps to ascend. |
| **5** | **The Summit** | Dash + dash-into-wall hit-stop | Corridor with a vertical wall used as a dash target; bonking it triggers hit-stop and shake. Put the strawberry above the wall on a ledge reached by chaining wall-jump into dash (dash collides with solids; it never phases through them). One moving-platform gully sits before the goal. |

Room transitions: on reaching the `trigger` goal tile (treat as an AABB hit against a `goalRect` registered at boot), emit `{ type: 'win' }` to take the shipped `playing → levelComplete` edge (see §8). After the "Cleared" card, emit `{ type: 'next' }` to return to `playing`, bump `roomIndex` (loop back to room 0 after room 4), then recompile with the same classifier: `compiled = compileLevel(roomDef, { tileTypeMap })`.

Map the generated `Palette` into an `EntityPalette`, for example
`{ ...DEFAULT_ENTITY_PALETTE, player: palette.base, platform: palette.accent }`.
Render with `drawTileGrid(ctx, room.tiles, drawTile)` and
`drawActor(ctx, state.core, { palette: entityPalette })`. The draw callback owns appearance,
not traversal or collision.

Hand-tip: put one **moving platform** in room 5 (or as the room-to-room connector) so the kernel's `movingPlatformToSolid` + `createMovingPlatformDisplacementProvider` path gets exercised. The kernel's step-2 (carry) will automatically move the player with the platform.

## 6. Hazards

The engine does **not** ship a first-class hazard module (hazards are level entities of `kind === 'trap'` in the level schema). Celerock needs spikes — wrap a player-state AABB check in a `tryStep` so the player respawns in place:

- **Static spikes.** Where the level designer places `'trap'` entities of subtype `"spikes"` (your convention), fold them into a `hazardRects: Rect[]` array at boot. Each tick, check `aabbOverlap(playerRect, hazardRect)` — if true AND the player is moving downward (`state.core.vy > 0`) or freshly landed on a hazard tile (`events.justLanded` while their AABB overlapped a hazard), trigger death.
- **Moving spike row (room 5 stretch).** One `'movingPlatform'` entity carrying a `'trap'`/`'hazard'` child entity whose rect is the spike row on top of the platform. **Hazards are NOT collision surfaces** — `compileLevel` ignores them, so the kernel never sees them and the "the kernel kills the player for free" claim is false. You must derive the spike rect from the platform's *current advanced* position each tick and run the same `aabbOverlap(playerRect, currentSpikeRect)` check as for static spikes:
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

## 7. Collectibles — strawberries (the engine's `collectibles` pillar)

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

## 8. Game state FSM

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
- `levelComplete → playing` via `{ type: 'next' }` to advance `roomIndex` (loop back to room 0 after room 4). The reducer itself does not bump `roomIndex` — your game bumps its own `roomIndex` when it observes a legal `levelComplete → playing` transition, then recompiles the next room.
- A brief `levelComplete` stay should still call `reduceGameState` 1× (with `dt` and no event) to render the "Cleared" text card (via `drawTextOutlined`), then emit `{ type: 'next' }`.

Use the shipped events: `start`, `die`, `retry`, `win`, `next`, `pause`,
`resume`, and `quit`. Do not invent destination-mode events.

## 9. Game feel checklist (the juice — every item uses the engine)

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

## 11. File layout (suggested)

```
src/
  main.ts              # boot: canvas, store, audio.unlock, loop.start()
  game/
    state.ts           # CelerockSave (collectibles: Record<roomId, CollectibleSave>, deaths), World, RoomData
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
2. All **5 rooms reachable**; each teaches one new technique from the room
   progression in §5. Same input sequence → same-room-geometry on every reload
   (no `Math.random` in level defs).
3. At least **one room uses wall-jump** (room 4) and **one room uses dash** (room 5) **and** room 5 uses **both** (wall + dash past it).
4. The **"dash-into-wall"** moment narrows the dash ability state before
   reading `timer`, then applies hit-stop and shake.
5. Strawberries persist across page reload via the engine's `save` module (`createLocalStorageSaveStorage` + `writeSave`).
6. Death counter increments every respawn and persists through the same save adapter.
7. `prefersReducedMotion` renders room 1 statically and never calls `loop.start()`.
8. **Zero duplicate engine systems**: no direct animation-frame loop, random
   authoritative simulation, manual collision resolver, or duplicate tile-grid
   traversal. Required tile/entity appearance callbacks are allowed.
9. **No moonwalk.** Walking left faces left in the player. Enforced by the `ctx.scale(facing, 1)` mirror around the body draw (see §4). The reviewer will playtest.
10. **No appendage blow-out.** The hair uses `advanceSpringRod`, never the raw `advanceSpringChain`. Grep for `advanceSpringChain` outside `node_modules` — must not appear.

## 13. Stretch goals (only after criteria 1–10)

- **Optional 8-way dash.** Replace the kernel's shipped `dashAbility` with a custom variant that takes an aim direction. Build a pipeline that filters out the existing `kind === 'dash'` ability and inserts `customDashAbility` at that same position; do not append a second dash processor.
- **Badeline chase ghost (visual only):** render a colored "ghost" character whose input snapshot is the player's from N frames ago. Buffer the last `N` `PlatformerInput` snapshots in a ring; on each tick, replay the buffered input through a *second* `createPlatformerController` instance with a tinted `palette.feature` and render its `state.core.x/y`. No new physics code — the kernel does the work twice.
- **Cosmetic hair colour unlocks** via `generateSkinVariants` + `createMemoryIAPAdapter` from the `cosmetics` + `iap` pillars. Skin variants change the hair's `palette.feature`; one unlockable per room-clear (a lavender, a cyan, an auburn). This is the **easiest possible cosmetics demo** and the cleanest bridge from Celerock to Embertomb's IAP surface.
- **Per-room seeded palette** — `const palette = generatePalette(room.seed | 0)`.

---

**Build order suggestion:** loop + input + the kernel running on a static player in room 1 (criterion 2) → touch/parallax + kill the moonwalk (criteria 1, 9) → variable-height jump feel + landing squash (juice) → wall-slide + wall-jump in rooms 3 & 4 (criterion 3) → dash + dash-into-wall hit-stop/shake (criteria 4) → strawberries + persistence (criteria 5–6) → FSM polish + reduced-motion gate (criteria 7, 8) → cosmetic stretch (badeline / hair unlocks). Get the **dash-into-wall** moment right before breadth — that's the feel target.
