# Prompt: "Flipside" — a no-jump, gravity-flip explorer with procedural chiptune on `aicraft-engine`

> Paste this whole document to a coding agent (Claude / Cursor / etc.). It is a complete build brief: concept, tech stack, architecture mapped to the engine's real API, per-system specs, and acceptance criteria. The agent should produce a single runnable Vite + TypeScript browser game that imports everything from `aicraft-engine` (the npm package) and writes **no** re-implementations of what the engine already provides.

---

## 0. You are building

**Flipside** — a minimalist black-and-white explorer in the *VVVVVV* aesthetic: a small crewmate drifts through 4–6 connected single-screen rooms, rescuing one stranded crewmate and collecting one gold trinket, while a procedural chiptune plays in the background. The player has **no jump**. The only vertical move is a single button that **flips gravity up or down** — the player walks on ceilings the same way they walk on floors, and spike traps that are safe from below become lethal from above (that IS the puzzle). The feel target is **minimalist + atmospheric**: chiptune "Pushing Onwards" homage, no imported art, every sound synthesized from oscillators + noise, every room hand-designed and byte-identical across reloads.

**Non-negotiable: build the entire game on top of `aicraft-engine`.** Do not hand-roll fixed-step loops, AABB collision, cameras, tile rendering, joypad input, particle bursts, the music sequencer, audio synthesis, or chiptune OSC graphs. If you find yourself writing a `requestAnimationFrame` accumulator, a gravity-flip velocity integrator, an `OscillatorNode` graph, a hand-drawn tile renderer, or a `Math.random()` in the simulation, stop and use the engine instead.

The engine's **`music` module is the headline pillar of Flipside.** The same `(seed, config)` always produces the same `Pattern`; `advanceSequencer` is the pure determinism seam the loop calls every tick; `createSequencer` (Layer 4, host-touching) plays the same fired notes through the same `AudioAdapter` the SFX use — no second `AudioContext`. This is the only prompt in the catalog that makes procedural music a first-class citizen.

## 1. Tech stack & install

```bash
npm create vite@latest flipside -- --template vanilla-ts
cd flipside
npm install aicraft-engine
npm install -D vite
```

- **TypeScript**, strict. Target ES2021, `moduleResolution: bundler` (matches the engine; Vite resolves its ESM fine).
- **Vite** dev server + build. Single `<canvas>` in `index.html`.
- **`aicraft-engine`** is your only runtime dependency. Import **only** from the root barrel:
  ```ts
  import {
    // primitives
    outlineRect, lerp, clamp, floor, approach, parseHex, toHex,
    prefersReducedMotion, getDevicePixelRatio, resizeCanvasToBackingStore,
    createHitStop, triggerHitStop, stepHitStop, isHitStopActive, DEFAULT_HIT_STOP_DURATION,
    drawGlow, DEFAULT_GLOW_INTENSITY,
    parallaxOffset, PARALLAX_FAR, PARALLAX_MID, PARALLAX_NEAR, drawTiledParallax,
    drawText, drawTextOutlined, measureText, DEFAULT_FONT, DEFAULT_TEXT_COLOR,

    // rng + animation + particles + collision + input + easing
    mulberry32, nextInt, nextFloat, pick,
    volumeScale, breathe, DEFAULT_BREATH, sineShake, shakeEnvelope,
    createSpringRod, advanceSpringRod, DEFAULT_SPRING_ROD,
    spawn, step as stepParticles, sampleConeVelocity, createEmitter, stepEmitters,
    DEFAULT_GRAVITY_SCALE, DEFAULT_DRAG_SCALE,
    aabbOverlap, worldToTile, tileToWorld, tileRect,
    type TileSolidityQuery,
    linear, easeOutCubic, easeIn, easeInOut, createTweenState, advanceTween,
    createKeyboardAdapter, createTouchButton, createTouchButtonSet,
    createEdgeAccumulator, pressEdge, releaseEdge, pollEdge, orEdges,

    // camera + game-loop + game-state
    createCamera, updateCamera, DEFAULT_CAMERA,
    createGameLoop, DEFAULT_FIXED_DT,
    createGameState, reduceGameState, isLegalTransition, DEFAULT_GAME_STATE_ADJACENCY,

    // audio — the SHARED AudioAdapter the sequencer reuses
    createAudioAdapter, DEFAULT_AUDIO_VOLUME,

    // ★ THE SHOWCASE — procedural chiptune step-sequencer (four-layer architecture)
    noteToFrequency, frequencyToNote, buildScale, SCALES,
    secondsPerBeat, secondsPerStep, swingLongDuration,
    generatePattern, advanceSequencer, createSequencer,
    DEFAULT_BPM, DEFAULT_ROOT_MIDI, DEFAULT_SCALE_OCTAVES,
    DEFAULT_STEPS_PER_BEAT, DEFAULT_STEPS_PER_PATTERN, DEFAULT_SWING,
    LOOKAHEAD_MS, SCHEDULE_AHEAD_S,
    type Pattern, type Track, type NoteEvent, type NoteFire,
    type PatternGenConfig, type TrackGenConfig,
    type SequencerConfig, type SequencerState,

    // palette (mono-mode) + platformer kernel + level-runtime
    generatePalette, resolvePalette, repairContrast,
    createPlatformerController, createPlatformerState, stepPlatformer,
    PUZZLE_PLATFORMER, DEFAULT_PLATFORMER_CONFIG,
    DEFAULT_PLAYER_WIDTH, DEFAULT_PLAYER_HEIGHT,
    compileLevel, drawTileGrid, drawActor, drawLevelEntity, DEFAULT_ENTITY_PALETTE,
    migrateLevel, validateLevel, createTileQuery, canonicalize, fnv1a,
    type LevelData, type LevelEntity, type TileGrid, type EntityKind,

    // collectibles + save + (stretch) cosmetics + iap
    collect, hasCollected, derivePickups, DEFAULT_COLLECTIBLE_RECT,
    createLocalStorageSaveStorage, createMemorySaveStorage,
    loadSave, writeSave, DEFAULT_SAVE_KEY,
    generateSkinVariants, grantSkin, equipSkin, unequipSkin,
    DEFAULT_SKIN_PRESET, DEFAULT_COSMETIC_SAVE,
    createMemoryIAPAdapter, createLocalStorageIAPAdapter, flushIAPEvents,
  } from 'aicraft-engine';
  ```
  The published package only exposes the root `"."` entry — never deep-import subpaths like `aicraft-engine/music`; use the root barrel. Every named export above resolves today against `src/<module>/index.ts`.

## 2. Determinism & discipline rules (enforced by the engine — follow them)

- **Fixed-step sim, variable render** via `createGameLoop({ fixedDt: 1/60, step, render })`. Poll input **exactly once per `step`**.
- **No `Math.random()` in the simulation.** Use `mulberry32(zoneSeed)` → `nextInt` / `nextFloat` / `pick` for crewmate names, trinket sparkle counters, particle jitter. `Math.random` is OK only for purely decorative audio/visual side-effects that never feed back into game state.
- **No `Date.now()` in the sim.** Time comes from `tick` or the loop's `dt`.
- **Music is deterministic.** Same `(levelSeed, zoneId)` produces a byte-identical `Pattern` from `generatePattern`. The pure `advanceSequencer(state, dt, pattern)` seam is the engine's guarantee — your loop step **calls it every tick**, threading `state` through. `createSequencer` (Layer 4) consumes those fired notes; the chiptune you hear is the deterministic advance output rendered through `audio.playTone`. The wall-clock scheduling adds nothing the simulation can depend on.
- **Defensive host access.** Anything touching `window`/`AudioContext`/`matchMedia`/`localStorage` goes through the engine's adapters (`createAudioAdapter`, `prefersReducedMotion`, `resizeCanvasToBackingStore`, `createLocalStorageSaveStorage`) — they're lazy, error-swallowing, no-op in Node.
- **Reduced-motion gate.** If `prefersReducedMotion()` is true, render one static frame of room 1 and never call `loop.start()`. **Corollary:** `createSequencer` must not be called either. See §10.7.
- **Pure progression ops.** `collect` / `grantSkin` / `loadSave` return brand-new state objects; mirror their discipline (never mutate the player, room, or save in place).

## 3. Architecture — engine module → game system map

| Game system | Engine API |
|---|---|
| Game loop (60 Hz fixed) | `createGameLoop`, `DEFAULT_FIXED_DT` |
| Keyboard + touch input, edge merging | `createKeyboardAdapter`, `createTouchButtonSet`, `orEdges` |
| **Gravity-flip player controller (no jump)** | `createPlatformerController`, `createPlatformerState`, `stepPlatformer`, `PUZZLE_PLATFORMER` config + externally driven `gravitySign` (see §4) |
| Tile render in each single-screen room | `compileLevel` → `drawTileGrid(ctx, room.tileGrid, dt, parallaxOffset(camera, 0.2))` |
| Spike hazard AABB | `aabbOverlap` against the player's rect (read from the kernel state) |
| Camera (locked per room, ease tween on room entry) | `createCamera` + `updateCamera` + `createTweenState` / `easeOutCubic` for the brief pan |
| **Gold trinket** + persistence | `collect`, `hasCollected`, `derivePickups`; `loadSave` / `writeSave` over `createLocalStorageSaveStorage` (key `'flipside:trinkets'`) |
| Hit-stop on spike death | `createHitStop`, `triggerHitStop` |
| Tween-down on gravity flip + death shake | `volumeScale`, `breathe`; `sineShake + shakeEnvelope` |
| Particles (flip dust, trinket sparkle, death burst) | `spawn`, `stepParticles`, `sampleConeVelocity` |
| Parallax background (3 mono layers) | `drawTiledParallax`, `PARALLAX_FAR`, `PARALLAX_MID`, `PARALLAX_NEAR` |
| Vector look + glow + text | `outlineRect`, `drawGlow`, `drawText`, `drawTextOutlined` |
| Frame FSM | `createGameState`, `reduceGameState`, `isLegalTransition` |
| Mono palette | `generatePalette`, `repairContrast` |
| ★ **Procedural chiptune (THE SHOWCASE — see §10)** | Layer 1 `buildScale` / `SCALES`, Layer 2 `generatePattern(seed, config)`, Layer 3 `advanceSequencer(state, dt, pattern)` (the determinism seam), Layer 4 `createSequencer(audio, pattern, config)` (reuses the `AudioAdapter`, NO second `AudioContext`) |
| Synthesized SFX (gravity-flip zap, trinket ping, death, door) | `createAudioAdapter` — `playTone('square', ...)` for the lead timbre the chiptune also uses |
| Retina canvas + reduced-motion gate | `resizeCanvasToBackingStore`, `getDevicePixelRatio`, `prefersReducedMotion` |
| Stretch — cosmetic skin variants + dev IAP | `cosmetics` (`generateSkinVariants`), `iap` (`createMemoryIAPAdapter`) |

## 4. The player — **no jump, gravity is the verb**

The player is a chunky capsule drawn with `outlineRect`, two square eye dots that face the move direction, and a short `createSpringRod` antenna that whips when gravity flips. The key difference vs. Celerock/Embertomb: **no jumpAbility, no dashAbility, no wallSlideAbility — the only Y-axis input is a `gravitySign *= -1` swap.**

- **Physics layer.** Two clean paths — pick ONE and stick to it.

  **Path A (recommended — kernel-driven)** keeps `stepPlatformer` in the loop and inverts the kernel's `gravity` field from your external `gravitySign` each tick. Collapse Path A into the boot block:
  ```ts
  // 🔒 NO JUMP — Flipside's gravity flip IS the verb. Do not bind Space to input.jump.
  const FLIPPER_CONFIG: PlatformerConfig = {
    ...PUZZLE_PLATFORMER,                       // already disables dash/wall-slide/double-jump
    gravity: 1100,                              // VVVVVV-ish gentle fall
    maxFallSpeed: 520,
    moveSpeed: 160,
    airControl: 0.6,
    wallJumpVx: 0, wallJumpVy: 0,
  };
  const controller = createPlatformerController(defaultPrecisionPipeline(), FLIPPER_CONFIG);
  let state = createPlatformerState(spawnX, spawnY);
  let gravitySign: 1 | -1 = 1;
  // each fixed tick:
  const flipped: PlatformerConfig = { ...FLIPPER_CONFIG, gravity: gravitySign * FLIPPER_CONFIG.gravity };
  const idleJump = { held: false, pressed: false, released: false };
  const input: PlatformerInput = { moveX: edges.left ? -1 : edges.right ? 1 : 0, jump: idleJump, dash: null };
  const { state: next } = controller.step(state, input, compiled.solids, dt);
  state = next;
  // on flip press AND |state.core.vy| < 80:
  if (flipEdge && Math.abs(state.core.vy) < 80) {
    gravitySign *= -1;
    state = { ...state, core: { ...state.core, vy: -gravitySign * 4 } };   // small kick
  }
  ```

  **Path B (lightweight — manual)** skips the kernel entirely: `Player = { x, y, vx, vy, w, h }` + `resolveAxisX` + `resolveAxisY` against a `TileSolidityQuery` built from `compiled.tileQuery`. On flip, swap `gravitySign`, set `vy = -gravitySign * 4`, and let the axis resolver handle the rest. Use this when you want maximum transparency on the gravity rule.

  Either way: **Space / W / Up / the touch flip button binds ONLY to `gravitySign *= -1`.** LLM coding agents will default to "platformers have jumping" — this rule IS the mechanic. Reinforce with a code comment `// 🔒 NO JUMP`.
- **Body render.** `outlineRect(ctx, cx − w/2, cy − h/2, w, h, palette.base, palette.outline)` + idle `breathe(tick, DEFAULT_BREATH)`. On gravity flip, drive `squashOffset` from `1.0 → 0` over 0.15 s via `createTweenState({ from: 1.0, to: 0, dur: 0.15 })` + `easeOutCubic` (volumePreserved via `volumeScale(squashOffset)`). The body flattens one frame, springs back — that's the tween-down.
- **Face.** Two `outlineRect` 2×2 eye dots above the body's midline. **Horizontal mirror only** (facing flips, gravity does NOT mirror vertically — Viridian's eye positions don't change when upside-down):
  ```ts
  ctx.save();
  ctx.translate(bodyCx, bodyBottomY);
  ctx.scale(facing, 1);                      // ← facing-horizontal mirror MANDATORY (no moonwalk)
  outlineRect(ctx, -w/2, -h, w, h, palette.base, palette.outline);
  outlineRect(ctx, -3, -h + 6, 2, 2, palette.accent);   // left eye
  outlineRect(ctx, +1, -h + 6, 2, 2, palette.accent);   // right eye
  ctx.restore();
  ```
- **Antenna.** One `createSpringRod` anchored at the head, `restDirection: { x: 0, y: -gravitySign }` (points away from the floor = away from gravity). Each tick: `antenna = advanceSpringRod(antenna, anchor, dt)` — on flip, the antenna whips to the other side. **Never** raw `advanceSpringChain`.
- **No footstep tap.** VVVVVV is silent during walking. Don't add `playNoise` for steps — the chiptune is the backdrop.

## 5. World — 4–6 connected single-screen rooms

The VVVVVV structure: a **room graph** (each node a `LevelData`, each edge a cardinal direction door). Walking off one edge → arrive at the next room, camera lerps to the new screen over `0.25 s` (`easeOutCubic`), the player ports to the new room's matching edge spawn.

- **Room definition.** Each room is a `LevelData`; build with `compileLevel` and read the kernel-exposed `tileQuery`:
  ```ts
  const roomA: LevelData = {
    version: 1, id: 'a', name: 'Overworld', seed: levelSeed,
    width: 24, height: 14, tileSize: 32, tileGrid: grid,
    entities: [
      { id: 'sp_a_1', kind: 'spawn', x: 4, y: 11 },
      { id: 'tr_a',   kind: 'collectible', x: 12, y: 2, props: { kind: 'gem' } },
      { id: 'door_e', kind: 'decoration', x: 24, y: 7, props: { decoration: 'doorEast' } },
    ],
  };
  const compiled = compileLevel(roomA);
  const tileQuery: TileSolidityQuery = (tx, ty) => compiled.tileQuery(tx, ty);
  ```
- **Room graph.** Hand-authored. Typical layout: `A (overworld) → B (north)`, `A → C (east)`, `C → D (spike trap)`, `D → E (trinket)`, `E → F (rescue)`. Crossing `player.x + player.w ≥ room.width * tileSize − 1` triggers the door; `roomIndex++`, re-`compileLevel(nextRoom.data)`.
- **Background.** `drawTiledParallax` at depth factors `PARALLAX_FAR = 0.15 / PARALLAX_MID = 0.4 / PARALLAX_NEAR = 0.75` — three layers of monochrome vector tiles (distant stars, dim bars, foreground dust). All drawn in `palette.outline` — the VVVVVV near-monochrome look.
- **Tile render.** `drawTileGrid(ctx, compiled.tileGrid, dt, parallaxOffset(camera, 0.2), DEFAULT_ENTITY_PALETTE)` — the kernel's renderer reads your `tileGrid` directly. **Do not** hand-roll a tile traversal.
- **Mono palette.** `generatePalette({ strategy: 'mono', baseLightness: 0.65, lightnessJitter: 0.05, chromaJitter: 0 })` — near-grayscale with controlled lightness jitter; `repairContrast(palette, { pair: 'base/outline', targetRatio: 7 })`. Same `zoneSeed` → same palette forever.

## 6. Hazards — spikes (the gravity-flip puzzle)

A **2-tile-row spike pit** sits in one room (call it room `D`). The pattern is: spikes on the FLOOR; ceiling above is solid. The player cannot walk past on the floor (would touch spikes — death); but if they flip UP onto the ceiling first, the spikes are on the wrong side of them (now BELOW them) and the corridor is clear. **This is the gravity-flip-as-puzzle demo — it MUST be in the build.**

- **Spike entity.** Add `'trap'` entities to the room's `LevelData`:
  ```ts
  { id: 'spike_d_1', kind: 'trap', x: 8,  y: 12, props: { trap: 'spikes', facing: 'up' } },
  { id: 'spike_d_2', kind: 'trap', x: 10, y: 12, props: { trap: 'spikes', facing: 'up' } },
  { id: 'spike_d_3', kind: 'trap', x: 12, y: 12, props: { trap: 'spikes', facing: 'up' } },
  ```
- **Hazard AABB.** At boot, fold the `'trap'` entities whose `trap === 'spikes'` into `hazardRects: Rect[]` (use `tileRect(x, y, tileSize)` from the engine). Each fixed step:
  ```ts
  const playerRect: Rect = { x: state.core.x, y: state.core.y, w: state.core.width, h: state.core.height };
  for (const h of hazardRects) {
    if (aabbOverlap(playerRect, h)) {
      // spike hits are resolution-aware — touching a spike pointing UP while falling is fatal,
      // touching a spike pointing DOWN while flipped is also fatal. aabbOverlap handles both.
      die();
      break;
    }
  }
  ```
  (You do NOT need a per-axis spike test — VVVVVV's spike hitbox is symmetric, and `aabbOverlap` already returns true for either flip state.)
- **Death.** `triggerHitStop(hitStop, 8)` for a freeze-frame flash, `sineShake` + `shakeEnvelope` (decay over 12 ticks, magnitude 4), particle burst via `spawn(player.x, player.y, { count: 12, speed: 6, life: 18, size: 3 })` + `sampleConeVelocity` upward-outward, `audio.playNoise(120, 'lowpass', 400, 0.3)`. FSM transitions `playing → dead` for **one fixed tick** (12 frames), then back to `playing` with the player respawned at the **current room's `spawn` entity position** — **no animation, instant snap**. No lives, no countdown.

## 7. Collectibles — the gold trinket

A single gold trinket sits in the rescue-room-adjacent area (room `E`). It persists across reloads via the `save` module — the engine's Pillar 2 (collectibles + save) demo.

- **Trinket entity.** Register as a `'collectible'` `LevelEntity` with `props.kind: 'gem'` (engine's `CollectibleKind` enum is `coin | gem | key` — `gem` is the gold single-pickup semantic):
  ```ts
  { id: 'tr_e', kind: 'collectible', x: 18, y: 5, props: { kind: 'gem' } },
  ```
- **Per-tick `derivePickups`** — deterministic AABB, byte-identical for the same `(state, room, save)` on every reload:
  ```ts
  const playerRect: PlayerRect = { x: state.core.x, y: state.core.y, w: state.core.width, h: state.core.height };
  const { collected } = derivePickups(playerRect, compiled.collectibles, trinketSave);
  for (const id of collected) {
    trinketSave = collect(trinketSave, String(id));
    writeSave(storage, 'flipside:trinkets', trinketSave);
    audio.playTone('square', 1200, 1600, 90, 0.18);   // sharp trig "ping"
    spawn(trinketX, trinketY, { count: 10, speed: 4, life: 22, size: 3 });
    drawGlow(ctx, trinketX, trinketY, 6, palette.feature);
    reduceGameState(fsm, { type: 'enter', mode: 'levelComplete' });
  }
  ```
- **Persistence.** Boot: `const trinketSave = loadSave(storage, 'flipside:trinkets') ?? { collected: [] }`. After each `collect`: `writeSave(...)`. The kernel does not need to know about collectibles — `derivePickups` keeps replays pure.
- **Render.** Skip when `hasCollected(trinketSave, 'tr_e')` is true. Otherwise, draw a pulsing outline diamond via `outlineRect(..., 'ceil', palette.feature, palette.feature)` with a `drawGlow` ramped by `0.5 + 0.5 * Math.sin(tick / 18)` (decorative ratio — frame-only).

## 8. NPCs — one crewmate to rescue

A single stranded crewmate sits in the final room (`F`). It does NOT block or move — it's a visual goal. The system example is the demo of `pick` — deterministic from seed, but visibly different across seeds. **This is the smallest possible demonstrable use of the `pick` helper** and the cheapest way to teach an LLM coding agent "deterministic ≠ pre-baked — same seed reproduces, switching seed changes outcome".

```ts
const crewmateNames = ['Viridian', 'Verdigris', 'Victoria', 'Vermilion'];
const crewmateName = pick(mulberry32((levelSeed ^ 0x5EA51DE) >>> 0), crewmateNames);
// On overlap with the player:
if (aabbOverlap(playerRect, crewmateRect)) {
  drawText(ctx, `${crewmateName}: Thank you!`, playerX, playerY - 12, { ...DEFAULT_FONT, color: palette.feature });
  if (rescueTimer++ > 60) reduceGameState(fsm, { type: 'enter', mode: 'levelComplete' });
}
```

## 9. Camera — locked per room, briefly easing on room-entry

VVVVVV is screen-locked; the camera doesn't follow. Use the engine's `createCamera` for the locked target snap + `createTweenState` for the room-entry ease:

- **Locked camera.** Each tick: `updateCamera(camera, { x: current.room.viewport.x, y: current.room.viewport.y }, bounds, viewport, DEFAULT_CAMERA)` — `DEFAULT_CAMERA.snapThreshold` collapses the lerp once close, so the camera sits exactly on the room's origin.
- **Room-entry ease.** On door cross: `tweenState = createTweenState({ from: fromX, to: toX, dur: 0.25 })` + `easeOutCubic`. While the tween runs, hold the player at the doorway; on completion, port to the new room's matching edge spawn and unlock movement.

## 10. ★ Procedural chiptune (THE showcase pillar)

> This section teaches the four-layer architecture of the engine's `music` module. The chiptune you hear at runtime **is** the engine's pure `advanceSequencer` determinism seam, played through the same `AudioAdapter` the SFX use.

### 10.1 Why music is a first-class citizen here

A typical VVVVVV-like game ships an `.mp3` and calls `audio.play()`. A typical procedural-music demo calls `playNote(440, ...)` on a `setInterval`. **Flipside does neither.** It uses a four-layer split that mirrors the rest of the engine:

| Layer | What | Where it lives | Determinism |
|---|---|---|---|
| **1 — Theory** | MIDI ↔ Hz, scales, swing math | `music/theory.ts` | Pure (no host, no state) |
| **2 — Pattern** | Seeded `Pattern` (bass+lead+harmony+perc) | `music/pattern.ts` via `generatePattern(seed, config)` | Pure (`mulberry32` only) |
| **3 — Advance** | Walk the pattern; emit `NoteFire[]` | `music/advance.ts` via `advanceSequencer(state, dt, pattern)` | **Pure — the determinism seam** |
| **4 — Host** | Play fired notes via the consumer's `AudioAdapter` | `music/sequencer.ts` via `createSequencer(audio, pattern, config)` | Host-touching (uses `audio.currentTime` + `setTimeout`); the carve-out |

The engine guarantee you ship: **Layer 3 is the only thing gameplay logic depends on.** Same `(state, dt, pattern)` → same `NoteFire[]` `.events`, byte-identical, forever. The wall-clock scheduler in Layer 4 is the determinism carve-out (decorative audio output) — it never feeds back into game state.

### 10.2 Layer 1 — Theory

```ts
import { SCALES, buildScale, noteToFrequency } from 'aicraft-engine';

// VVVVVV's lead lives in C-minor pentatonic. Two octaves of it.
const scale = buildScale(60, SCALES.minorPentatonic, 2);
// [60, 63, 65, 67, 70, 72, 75, 77, 79, 82] — C3 minor pentatonic

const freq = (midi: number) => noteToFrequency(midi);   // MIDI → Hz (12-tone ET)
freq(60); // ~261.6256 (C4)
```

`SCALES` ships six presets (`major`, `minor`, `majorPentatonic`, `minorPentatonic`, `blues`, `dorian`). Use `minorPentatonic` for the VVVVVV feel. You need `noteToFrequency` only when calling `audio.playTone` yourself — `createSequencer` resolves `NoteFire.midi` → Hz internally.

### 10.3 Layer 2 — Pattern

`generatePattern(seed, config)` produces a complete `Pattern` (bass+lead by default). Pass a full track config for the four-voice chiptune:

```ts
import { generatePattern, SCALES } from 'aicraft-engine';

const pattern: Pattern = generatePattern(levelSeed, {
  bpm: 130,                       // VVVVVV-ish upbeat
  stepsPerBeat: 4,                // 16th notes
  stepsPerPattern: 16,            // one bar
  rootMidi: 60,                   // C4
  scale: SCALES.minorPentatonic,
  tracks: [
    // A — bass (sawtooth, sparse)
    { name: 'bass', waveform: 'sawtooth', volume: 0.22,
      rhythm: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
      degreeMin: 0, degreeMax: 4, noteDurationSteps: 2 },
    // B — lead (square — the iconic chiptune timbre)
    { name: 'lead', waveform: 'square', volume: 0.18,
      rhythm: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
      degreeMin: 2, degreeMax: 9, noteDurationSteps: 1 },
    // C — harmony (triangle, sustained)
    { name: 'harmony', waveform: 'triangle', volume: 0.10,
      rhythm: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      degreeMin: 1, degreeMax: 7, noteDurationSteps: 4 },
    // D — percussion: schedule `audio.playNoise` from the same tick (see §10.6).
  ],
});
```

The pattern is **JSON-serializable, pure**. Same `(levelSeed, config)` → same `Pattern.tracks[x].patterns[y][z]` byte-for-byte. Dump to console once for a determinism sanity check.

> ⚠ **Determinism contract pinned:** every note in the pattern comes from `scaleDegree` (Layer 1), **never** `pick`. The `degreeMin` / `degreeMax` bounds on each `TrackGenConfig` mean the seeded PRNG can never produce a note outside your scale — safe for degenerate configs (see `music/pattern.ts` decision §10).

### 10.4 Layer 3 — Advance: the determinism seam (call it every fixed step)

Hold the playback state on your game store. Each fixed step, advance by the simulator's `dt` and commit the next state:

```ts
import { advanceSequencer, secondsPerStep, type SequencerState, type NoteFire } from 'aicraft-engine';

let seqState: SequencerState = { elapsedS: 0, stepIndex: 0, loopCount: 0 };
let firedNotes: NoteFire[] = [];   // last-tick buffer for any consumer (HUD, derives from the deterministic seam)

// each fixed step (from the engine's createGameLoop callback):
const stepDur = secondsPerStep(pattern.bpm, pattern.stepsPerBeat);
const { next, events } = advanceSequencer(seqState, dt, pattern, { swing: 0.5 });
seqState = next;
firedNotes = events.slice();        // immutable — already a fresh array
```

**This is the seam.** `advanceSequencer` is the only place that decides when a note fires. The keyboard input, the player's x position, the spike hit, the gravity-flip — none of them touch the music. Input → simulation → `advanceSequencer(state, dt, pattern)` → `events` → `audio.playTone(...)`. The cross-loop determinism test (§14.6) is the proof you shipped the split correctly.

> ⚠ **`dt` units:** the engine's fixed-step loop gives you `dt = 1/60` per tick. Don't multiply by anything before passing to `advanceSequencer` — the function's window-crossing math expects `dt` in seconds. `secondsPerStep(bpm, stepsPerBeat)` returns the step duration in seconds, ready for both the advance layer and the host layer.

### 10.5 Layer 4 — Host: `createSequencer` reuses the AudioAdapter (no second AudioContext)

This is the consumer-facing entry point. **You pass your already-unlocked `AudioAdapter`**; the sequencer does not allocate a second `AudioContext`, does not require a separate user gesture, does not duplicate the master-gain chain:

```ts
import { createAudioAdapter, createSequencer } from 'aicraft-engine';

// one AudioAdapter, shared by SFX and music:
const audio = createAudioAdapter();
// on first user gesture (keydown / pointerdown / touchstart):
audio.unlock();

// like Celerock's: one AudioContext, one master gain, both SFX and music through it
const seq = createSequencer(audio, pattern, {
  // all optional — proven defaults
  swing: 0.5,
  lookaheadMs: 25,                 // LOOKAHEAD_MS
  scheduleAheadS: 0.1,             // SCHEDULE_AHEAD_S
});
seq.setVolume(0.5);                // independent of SFX volume (per decision §8)
seq.play();
```

Internally:
- The scheduler polls every `LOOKAHEAD_MS = 25` ms, pre-queueing any step whose boundary falls within `SCHEDULE_AHEAD_S = 0.1` s of `audio.currentTime`.
- Each fired note becomes one `audio.playTone(waveform, freq, freq, gateMs, peak × musicVolume, whenS)` call. (`gateS` × 1000 = `gateMs`; `peak` × `musicVolume` = scaled peak.)
- `setVolume(v)` scales `peak` multiplicatively — no extra gain node, no separate context.

**This is the only correct path.** Calling `audio.playTone` manually on a `setInterval` to simulate a step sequencer would re-implement Layer 3 (and lose byte-identical determinism) — and you would reintroduce timing drift that the lookahead scheduler already solved (Chris Wilson's "A Tale of Two Clocks").

### 10.6 Percussion via noise

`createSequencer` plays oscillator tones. For a noise-based perc line, schedule `audio.playNoise(...)` yourself at the same step boundaries that Layer 3 fires — driven by the **same `stepIndex`**:

```ts
const onSeqTick = (events: NoteFire[]) => {
  for (const ev of events) {
    audio.playNoise(60, 'bandpass', 1800, 0.18, ev.whenOffset);   // hi-hat-like hiss
  }
};
// call from the same fixed-step site as advanceSequencer:
const { next, events } = advanceSequencer(seqState, dt, pattern, { swing: 0.5 });
seqState = next;
onSeqTick(events);
```

The drummer's clock IS the bass+lead's clock — derived from `stepIndex` of the pure sequencer state, never from `setInterval`. For richer grooves, mirror a per-track rhythm array and walk it identically.

### 10.7 Reduced-motion → no `createSequencer`

If `prefersReducedMotion()` is true at boot, render room 1 statically and **do not call `createSequencer` or `loop.start`**:

```ts
if (prefersReducedMotion()) {
  renderStaticFrame(roomA, camera);           // one frame; no audio scheduler, no loop
} else {
  seq.play();
  loop.start();
}
```

### 10.8 Per-zone seed → different melody

The pickup room (`E`) and rescue room (`F`) may have different `levelSeed` salts; same `(levelSeed, patternConfig)` reproduces the same melody forever. Switch seed → different melody. Re-cross into room `A` → same melody, byte-for-byte:

```ts
// per-room pattern regen on door cross:
const pattern: Pattern = generatePattern((levelSeed ^ currentRoom.seedSalt) >>> 0, patternConfig);
seq.stop(); seq.dispose();
seq = createSequencer(audio, pattern, { swing: 0.5 });
seq.setVolume(0.5); seq.play();
```

## 11. Game feel (every item uses the engine)

- [ ] **Gravity flip tween-down**: 0.15 s body-squash then spring back via `volumeScale(squashOffset)` over `createTweenState({ from: 1.0, to: 0, dur: 0.15 })` + `easeOutCubic`. Antenna whips (one `advanceSpringRod`).
- [ ] **Hit-stop on spike death**: `triggerHitStop(hitStop, 8)` for the freeze-frame flash.
- [ ] **Screen shake on death**: `sineShake + shakeEnvelope` decay envelope for 12 ticks, magnitude 4.
- [ ] **Instant respawn**: snap player to current room's `spawn` entity, no lives, no animation. The brief `dead` state lasts 12 frames purely for the shake + flash.
- [ ] **Trinket sparkle on collect**: `spawn` 10 small particles outward + `drawGlow` burn-out (one frame).
- [ ] **Room-entry camera ease**: 0.25 s `easeOutCubic` position tween (held player position until complete).
- [ ] **Reduced-motion gate** (`prefersReducedMotion`) renders room 1 and starts no `seq.play()`, no `loop.start()`.
- [ ] **Mono parallax background** (`drawTiledParallax`, 3 layers far/mid/near).
- [ ] **Eye dots face** the move direction (mandatory `ctx.scale(facing, 1)` mirror). No moonwalk.

## 12. Audio — chip bleeps, gravity-flip zap, trinket ping, death

Unlock on first user gesture (the existing keyboard/touch handlers call `audio.unlock()`; the shared `AudioAdapter` is `audio`, same one the sequencer holds).

The chiptune from §10 covers the **music** channel. These are the **SFX** recipes (the `AudioAdapter` plays them through the same shared context):

- **Gravity flip:** `playTone('square', 880, 220, 90, 0.22)` — a 0.09 s descending square zap.
- **Trinket pickup:** `playTone('square', 1200, 1600, 90, 0.18)` — sharp ping (the two-note arpeggio comes from the sequencer's own note firing on the trinket step; the SFX layer is just the leading attack).
- **Crewmate rescue:** `playTone('triangle', 523, 784, 220, 0.20)` — short gratitude arpeggio (two calls ascending).
- **Spike death:** `playNoise(120, 'lowpass', 400, 0.30)` + descending `playTone('sine', 400, 80, 200, 0.25)`.
- **Room transition (door):** `playTone('square', 220, 440, 60, 0.12)` — a tiny ascending click.

> The SFX recipes use `playTone('square', ...)` deliberately — the same waveform the lead track uses — so the music and the gravity-flip sound are recognisably the same synth voice. (This is a bit of typological flavour — the chiptune sound is the chip sound is the game sound.)

## 13. File layout (suggested)

```
src/
  main.ts            # boot: canvas, audio.unlock on first gesture, loop.start
  game/
    state.ts         # Player, Room[], TrinketSave, SequencerState, FSM
    step.ts          # the fixed-step: input → controller → pickups → death → music advance
    render.ts        # parallax → tiles → entities → player art → text
    rooms.ts         # the 4–6 hand-authored LevelData rooms
    player.ts        # player input → flip + walk; cheap render of body + eyes + antenna
    hazards.ts       # spike AABB check + die()
    collectibles.ts  # trinket: derivePickups → collect → writeSave
    npcs.ts          # crewmate render + drawText line
  music.ts           # pattern config + per-zone regen; calls advanceSequencer + createSequencer
  audio.ts           # createAudioAdapter + the SFX recipe helpers (gravity-flip zap, etc.)
  save.ts            # createLocalStorageSaveStorage + the trinket key
```

## 14. Acceptance criteria

1. Playable in browser via `npm run dev` with **keyboard (←→ move, Space / W / Up to flip gravity)** + on-screen touch buttons (`createTouchButtonSet`) — both routes route to `gravitySign *= -1` and **never** to jump.
2. At least **4 connected single-screen rooms**, hand-authored as `LevelData`, with at least **1 room demonstrating the gravity-flip-as-puzzle** (spikes on the floor; flip to the ceiling to walk across).
3. **One gold trinket** collected in room `E` via `derivePickups` → `collect`; persists across page reload via `createLocalStorageSaveStorage` + `writeSave` + a `'flipside:trinkets'` save key.
4. **One crewmate rescue** in room `F`. The crewmate's name is generated once via `pick(rng, ['Viridian', 'Verdigris', 'Victoria', 'Vermilion'])` driven by `levelSeed ^ 0x5EA51DE`. The name is displayed via `drawText` on screen overlap.
5. **Procedural chiptune plays in the background**, generated from `generatePattern(levelSeed, PatternGenConfig)` and advanced every fixed step via `advanceSequencer(seqState, dt, pattern)`. The host adapter is `createSequencer(audio, pattern, { swing: 0.5 })` — reuses the existing `audio` `AudioAdapter`, NO second `AudioContext`. Different `(levelSeed)` produces a different melody byte-for-byte (compare `pattern.tracks[x].patterns[y][z]` across runs).
6. **Strict determinism in the sequencer.** The first 16 `NoteFire`s emitted by `advanceSequencer` over `t ∈ [0, 0.5] s` are byte-identical across reloads given the same `levelSeed`. (Acceptance test: hash → serialize → string-compare against a snapshot saved alongside the seed.)
7. Death on spike → `triggerHitStop(hitStop, 8)` freeze-frame → `sineShake` + `shakeEnvelope` → instant respawn at the current room's `spawn` entity (NO animation, NO lives). FSM goes `playing → dead` for ~12 fixed ticks then `dead → playing`.
8. `prefersReducedMotion()` renders room 1 statically and **does NOT call `seq.play()` or `loop.start()`**.
9. **Zero hand-rolled reimplementations** — grep must return zero matches in `src/` for: `requestAnimationFrame`, `Math.random` inside `step`, manual AABB collision outside `aabbOverlap` / `resolveAxis*` / `resolveTile*`, manual jump-arc math (anything reading `jumpState`), manual gravity integrator outside `state.core.vy`, hand-drawn tile renderers (anything iterating over `tileGrid` for visual draw — `drawTileGrid` is the only path), **manual chiptune synthesis (no raw `OscillatorNode` outside `createSequencer` / `audio.playTone`)**, hand-rolled parallax (`drawTiledParallax` is the only path).
10. **No moonwalk.** Horizontal `ctx.scale(facing, 1)` mirror is wrapped around the body + eye-dot draw — walking left faces left. Gravity flip does NOT multiply the render by `gravitySign` (no vertical mirror — VVVVVV's character does not visually invert, only the floor/ceiling detection swaps).
11. **Use `playTone('square', ...)` for the lead track** AND for the gravity-flip SFX — the chiptune sound and the gameplay feedback sound are recognised as the same voice. The reader should be able to hear the gameplay's gravity-flip blending into the music.
12. **`step` calls `advanceSequencer` exactly once per fixed tick.** Grep `advanceSequencer` — it should appear once, in `step.ts`, called in the same place as `controller.step(state, input, solids, dt)`.

## 15. Stretch goals (only after criteria 1–12)

- **No-flip zones**: some rooms where `gravitySign` is locked (e.g. the trinket room is always orientation-1; spikes from the underside won't help). Add a `lockGravity: boolean` flag on `LevelData` and guard the flip handler.
- **V-mode visual only**: a faint vertical "checkpoint line" drawn with `outlineRect` (no time trial, no scoring — pure flourish).
- **Music-zone palette tie-in**: each zone's `levelSeed` drives BOTH the `generatePalette` (with a per-zone tint) AND the `generatePattern` seed. Listen and watch swap together.
- **Cosmetic palette skin variants** via `generateSkinVariants` + `createMemoryIAPAdapter` — violet / amber / celadon monochrome variants unlock on trinket pickup. The current `palette` becomes the unlocked variant via `equipSkin(cosmeticSave, variantId)`.
- **Badeline-style chase ghost (visual only)**: buffer the last N `input` snapshots → drive a second `createPlatformerController` instance with a tinted palette → render its `state.core.x/y` each tick. No new physics — the kernel does the work twice.

---

**Build order suggestion:** loop + input + a player capsule that walks L/R on a flat-floor single screen (criterion 1) → `compileLevel` + `drawTileGrid` rendering that screen (criterion 2 base) → gravity-flip mechanic: external `gravitySign` + path-A kernel branch, demo on a ceiling (criterion 2 puzzle section) → 4 rooms connected by edge cells + camera ease (criteria 2 + 4) → trinket via `derivePickups` + `save` (criterion 3) → crewmate via `pick` + `drawText` (criterion 4) → **procedural music (THE long step): theory (`buildScale`) → pattern (`generatePattern`) → advance (`advanceSequencer` in `step`) → host (`createSequencer` reusing `audio`) → per-zone regen on room change** (criteria 5 + 6 + 11 + 12) → spike hazards + death + respawn + `prefersReducedMotion` gate (criteria 7–9) → polish (criteria 10 + 12). Get the gravity flip right before breadth — that is the mechanic.
