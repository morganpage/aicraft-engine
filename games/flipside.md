# Prompt: "Flipside" — a no-jump, gravity-flip explorer with procedural chiptune on `aicraft-engine`

> Paste this whole document to a coding agent (Claude / Cursor / etc.). It is a complete build brief: concept, tech stack, architecture mapped to the engine's real API, per-system specs, and acceptance criteria. The agent should produce a single runnable Vite + TypeScript browser game that imports everything from `aicraft-engine` (the npm package) and writes **no** re-implementations of what the engine already provides.

---

## 0. You are building

**Flipside** — a minimalist black-and-white explorer in the *VVVVVV* aesthetic: a small crewmate drifts through six connected single-screen rooms (A–F), rescuing one stranded crewmate and collecting one gold trinket, while a procedural chiptune plays in the background. The player has **no jump**. The only vertical move is a single button that **flips gravity up or down** — the player walks on ceilings the same way they walk on floors, and spike traps that are safe from below become lethal from above (that IS the puzzle). The feel target is **minimalist + atmospheric**: chiptune "Pushing Onwards" homage, no imported art, every sound synthesized from oscillators + noise, every room hand-designed and byte-identical across reloads.

**Non-negotiable: build the entire game on top of `aicraft-engine`.** Do not hand-roll fixed-step loops, AABB collision, cameras, tile rendering, joypad input, particle bursts, the music sequencer, audio synthesis, or chiptune OSC graphs. If you find yourself writing a `requestAnimationFrame` accumulator, a gravity-flip velocity integrator, an `OscillatorNode` graph, a hand-drawn tile renderer, or a `Math.random()` in the simulation, stop and use the engine instead.

The engine's **`music` module is the headline pillar of Flipside.** The fixed-step loop owns `SequencerState`, calls `advanceSequencer` exactly once per tick, and passes those exact events to `createNoteFirePlayer` using the shared `AudioAdapter`.

## 1. Tech stack & install

```bash
npm create vite@latest flipside -- --template vanilla-ts
cd flipside
npm install aicraft-engine@0.4.0
```

> This brief targets the published `0.4.0` API exactly. It relies on
> `0.4.0`-only exports: signed platformer gravity, the fixed-step
> `advanceSequencer` step-boundary fix, `createNoteFirePlayer`, and the
> unified `compileLevel` that returns `compiled.tileQuery` + tile-derived
> `staticSolids`. Do not substitute `0.3.0`.

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
    type Rect, type TileSolidityQuery,
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
    secondsPerBeat, swingLongDuration,
    generatePattern, advanceSequencer, createNoteFirePlayer,
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
    LEVEL_VERSION, migrateLevel, validateLevel, canonicalize, fnv1a,
    type LevelData, type LevelEntity, type TileGrid, type EntityKind,
    type PlatformerConfig, type PlatformerInput,

    // collectibles + save + (stretch) cosmetics + iap
    collect, hasCollected, derivePickups, DEFAULT_COLLECTIBLE_RECT,
    createLocalStorageSaveStorage, createMemorySaveStorage,
    loadSave, writeSave, DEFAULT_SAVE_KEY,
    generateSkinVariants, grantSkin, equipSkin, unequipSkin,
    DEFAULT_SKIN_PRESET, DEFAULT_COSMETIC_SAVE,
    createMemoryIAPAdapter, createLocalStorageIAPAdapter, flushIAPEvents,
  } from 'aicraft-engine';
  ```
  The published package only exposes the root `"."` entry — never deep-import subpaths like `aicraft-engine/music`; use the root barrel. The import block above mirrors the in-development `0.4.0` root barrel; until `0.4.0` is published, verify each symbol against the installed tarball's root type declarations rather than against this repo's local `src/` (the npm contract is the published declaration surface, not the working tree).

## 2. Determinism & discipline rules (enforced by the engine — follow them)

- **Fixed-step sim, variable render** via `createGameLoop({ fixedDt: 1/60, step, render })`. Poll input **exactly once per `step`**.
- **No `Math.random()` in the simulation.** Use `mulberry32(zoneSeed)` → `nextInt` / `nextFloat` / `pick` for crewmate names, trinket sparkle counters, particle jitter. `Math.random` is OK only for purely decorative audio/visual side-effects that never feed back into game state.
- **No `Date.now()` in the sim.** Time comes from `tick` or the loop's `dt`.
- **Music is deterministic.** Call `advanceSequencer` exactly once per fixed tick, assign its returned state, and pass only its returned events to `createNoteFirePlayer.play`.
- **Defensive host access.** Anything touching `window`/`AudioContext`/`matchMedia`/`localStorage` goes through the engine's adapters (`createAudioAdapter`, `prefersReducedMotion`, `resizeCanvasToBackingStore`, `createLocalStorageSaveStorage`) — they're lazy, error-swallowing, no-op in Node.
- **Reduced-motion gate.** If `prefersReducedMotion()` is true, render one static frame and create no audio adapter, note player, or game loop.
- **Pure progression ops.** `collect` / `grantSkin` / `loadSave` return brand-new state objects; mirror their discipline (never mutate the player, room, or save in place).

## 3. Architecture — engine module → game system map

| Game system | Engine API |
|---|---|
| Game loop (60 Hz fixed) | `createGameLoop`, `DEFAULT_FIXED_DT` |
| Keyboard + touch input, edge merging | `createKeyboardAdapter`, `createTouchButtonSet`, `orEdges` |
| **Gravity-flip player controller (no jump)** | `createPlatformerController`, `createPlatformerState`, `stepPlatformer`, `PUZZLE_PLATFORMER` config + externally driven `gravitySign` (see §4) |
| Tile collision/render | `compileLevel(room, { tileTypeMap })`; `drawTileGrid(ctx, room.tiles, drawTile)` |
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
| ★ **Procedural chiptune (THE SHOWCASE — see §10)** | `generatePattern`; fixed-step `advanceSequencer`; `createNoteFirePlayer(audio)` |
| Synthesized SFX (gravity-flip zap, trinket ping, death, door) | `createAudioAdapter` — `playTone('square', ...)` for the lead timbre the chiptune also uses |
| Retina canvas + reduced-motion gate | `resizeCanvasToBackingStore`, `getDevicePixelRatio`, `prefersReducedMotion` |
| Stretch — cosmetic skin variants + dev IAP | `cosmetics` (`generateSkinVariants`), `iap` (`createMemoryIAPAdapter`) |

## 4. The player — **no jump, gravity is the verb**

The player is a chunky capsule drawn with `outlineRect`, two square eye dots
that face the move direction, and a short spring-rod antenna. There are no
ability processors; the only Y-axis input toggles the `1 | -1` gravity
direction with an explicit ternary assignment.

- **Physics layer.** Use the signed-gravity kernel exclusively. Build both controllers once with an empty ability pipeline and keep one logical state:
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
  const downController = createPlatformerController([], FLIPPER_CONFIG);
  const upController = createPlatformerController([], {
    ...FLIPPER_CONFIG,
    gravity: -FLIPPER_CONFIG.gravity,
  });
  let state = createPlatformerState(spawnX, spawnY);
  let gravitySign: 1 | -1 = 1;
  // each fixed tick:
  const idleJump = { held: false, pressed: false, released: false };
  const input: PlatformerInput = {
    moveX: edges.left.held ? -1 : edges.right.held ? 1 : 0,
    jump: idleJump,
    dash: null,
  };
  const controller = gravitySign === 1 ? downController : upController;
  const { state: next } = controller.step(state, input, compiled.staticSolids, dt);
  state = next;
  // on flip press AND |state.core.vy| < 80:
  if (flipEdge && Math.abs(state.core.vy) < 80) {
    gravitySign = gravitySign === 1 ? -1 : 1;
  }
  ```
  **Space / W / Up / touch binds only to the polled gravity-flip edge.** Do not add a consumer gravity integrator or collision path.
- **Body render.** Positive `volumeScale` offsets stretch vertically and
  negative offsets squash vertically. On flip, create state with
  `createTweenState()` and advance it using
  `{ duration: 0.15, ease: easeOutCubic }`; map the normalized result from a
  negative squash offset back to zero.
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
- **Antenna.** Advance using scalar anchors and full config:
  `antenna = advanceSpringRod(antenna, anchor.x, anchor.y, dt, {
  ...DEFAULT_SPRING_ROD,
  restDirection: { x: 0, y: -gravitySign },
  })`.
- **No footstep tap.** VVVVVV is silent during walking. Don't add `playNoise` for steps — the chiptune is the backdrop.

## 5. World — six connected single-screen rooms (A–F)

The VVVVVV structure: a **room graph** of exactly six rooms labelled A–F (each node a `LevelData`, each edge a cardinal direction door). Room `A` is the overworld spawn; rooms `B`/`C` are connectors; room `D` holds the spike puzzle (§6); room `E` holds the trinket (§7); room `F` holds the crewmate rescue (§8). Walking off one edge → arrive at the next room, camera lerps to the new screen over `0.25 s` (`easeOutCubic`), the player ports to the new room's matching edge spawn.

- **Room definition.** Each room is a `LevelData`; build with `compileLevel` and read the kernel-exposed `tileQuery`:
  ```ts
  const roomA: LevelData = {
    version: LEVEL_VERSION, id: 'a', name: 'Overworld',
    width: 768, height: 448, tileSize: 32,
    spawn: { x: 64, y: 352 },
    tiles: { data: grid, cols: 24, rows: 14, tileSize: 32 },
    entities: [
      { id: 1, kind: 'spawn', rect: { x: 64, y: 352, width: 16, height: 24 }, props: {} },
      { id: 2, kind: 'collectible', rect: { x: 384, y: 64, width: 16, height: 16 }, props: { kind: 'gem', persists: true } },
      { id: 3, kind: 'decoration', rect: { x: 736, y: 224, width: 32, height: 32 }, props: { sprite: 'doorEast' } },
      { id: 4, kind: 'exit', rect: { x: 736, y: 224, width: 32, height: 32 }, props: { isTrap: false, locked: false } },
    ],
    nextEntityId: 5,
  };
  const compiled = compileLevel(roomA, { tileTypeMap });
  const tileQuery: TileSolidityQuery = compiled.tileQuery;
  ```
- **Room graph.** Crossing `player.x + player.width >= room.width - 1`
  triggers the door. Recompile every transitioned room with
  `compileLevel(nextRoom, { tileTypeMap })`; top-level width is already pixels.
- **Background.** `drawTiledParallax` at the exported depth factors `PARALLAX_FAR = 0.25 / PARALLAX_MID = 0.5 / PARALLAX_NEAR = 1.0` — three layers of monochrome vector tiles (distant stars, dim bars, foreground dust). All drawn in `palette.outline` — the VVVVVV near-monochrome look.
- **Tile render.** `drawTileGrid(ctx, room.tiles, drawTile)`. The required
  appearance callback is allowed; do not duplicate grid traversal.
- **Restricted palette.** Use `generatePalette(zoneSeed, { strategy:
  'analogous' })` for deterministic structure, then explicitly replace the
  gameplay roles with grayscale values because generated `feature` chroma is
  intentionally nonzero even when `baseChroma` is zero. Reserve gold as the
  one deliberate exception for the trinket:
  ```ts
  const generated = generatePalette(zoneSeed, { strategy: 'analogous' });
  const palette = {
    ...generated,
    base: '#d8d8d8', accent: '#888888', outline: '#111111',
    background: '#f4f4f4', feature: '#d4af37',
  };
  ```
  Do not invent unsupported `mono` or named-pair contrast options.

## 6. Hazards — spikes (the gravity-flip puzzle)

A **2-tile-row spike pit** sits in one room (call it room `D`). The pattern is: spikes on the FLOOR; ceiling above is solid. The player cannot walk past on the floor (would touch spikes — death); but if they flip UP onto the ceiling first, the spikes are on the wrong side of them (now BELOW them) and the corridor is clear. **This is the gravity-flip-as-puzzle demo — it MUST be in the build.**

- **Spike entity.** Add `'trap'` entities to the room's `LevelData`:
  ```ts
  { id: 10, kind: 'trap', rect: { x: 256, y: 384, width: 32, height: 32 }, props: { type: 'spikes', params: { facing: 'up' } } },
  { id: 11, kind: 'trap', rect: { x: 320, y: 384, width: 32, height: 32 }, props: { type: 'spikes', params: { facing: 'up' } } },
  { id: 12, kind: 'trap', rect: { x: 384, y: 384, width: 32, height: 32 }, props: { type: 'spikes', params: { facing: 'up' } } },
  ```
- **Hazard AABB.** Filter entities with
  `entity.kind === 'trap' && entity.props.type === 'spikes'` and use each
  entity’s pixel-space `rect` directly.
  ```ts
  const playerRect: Rect = {
    x: state.core.x, y: state.core.y,
    width: state.core.width, height: state.core.height,
  };
  for (const h of hazardRects) {
    if (aabbOverlap(playerRect, h)) {
      // aabbOverlap is a DIRECTION-BLIND, symmetric strict-AABB overlap
      // test — it has no knowledge of gravity sign, player velocity, or
      // which way a spike "faces". It returns true for ANY interior pixel
      // overlap, regardless of flip state. The puzzle works because
      // flipping changes which SURFACE (floor vs ceiling) the player walks
      // on, and therefore whether the player's body overlaps the spike row
      // at all — NOT because the hit detection changes with gravity.
      die();
      break;
    }
  }
  ```
  (You do NOT need a per-axis or per-facing spike test — VVVVVV's spike
  hitbox is a symmetric rect, and one `aabbOverlap` call covers both flip
  states. The `props.params.facing` value on the trap entity is a
  rendering/decoration hint only; the gameplay check ignores it. Note
  `aabbOverlap` is *strict*: edges that merely touch do not count, so a
  player resting exactly on a spike row's top edge is not killed until a
  1px overlap appears.)
- **Death.** Assign `hitStop = triggerHitStop(hitStop, 8)` and advance it by
  one tick per fixed step. Use a consumer-owned 12-tick respawn phase; the
  shipped FSM represents failure as `gameover`, then returns through `retry`.

## 7. Collectibles — the gold trinket

A single gold trinket sits in the rescue-room-adjacent area (room `E`). It persists across reloads via the `save` module — the engine's Pillar 2 (collectibles + save) demo.

- **Trinket entity.** Register as a `'collectible'` `LevelEntity` with `props.kind: 'gem'` (engine's `CollectibleKind` enum is `coin | gem | key` — `gem` is the gold single-pickup semantic):
  ```ts
  {
    id: 1,
    kind: 'collectible',
    rect: { x: 576, y: 160, width: 16, height: 16 },
    props: { kind: 'gem', persists: true },
  },
  ```
- **Per-tick `derivePickups`** — deterministic AABB, byte-identical for the same `(state, room, save)` on every reload:
  ```ts
  const playerRect: Rect = {
    x: state.core.x, y: state.core.y,
    width: state.core.width, height: state.core.height,
  };
  const { collected } = derivePickups(playerRect, collectibleEntities, trinketSave);
  for (const id of collected) {
    trinketSave = collect(trinketSave, String(id));
    writeSave(storage, trinketSave);
    audio.playTone('square', 1200, 1600, 90, 0.18);   // sharp trig "ping"
    particles = [
      ...particles,
      ...spawn(trinketX, trinketY, { count: 10, speed: 4, life: 22, size: 3 }),
    ];
  }
  ```
- **Persistence.** Boot with
  `const storage = createLocalStorageSaveStorage('flipside:trinkets')` and
  `let trinketSave = loadSave(storage, { collected: [] as string[] })`.
- **Render.** Skip when `hasCollected(trinketSave, '1')` is true. Rendering
  and `drawGlow` occur only in the render phase. Use
  `outlineRect(ctx, x, y, w, h, palette.feature, palette.outline, 'ceil')`.

## 8. NPCs — one crewmate to rescue

A single stranded crewmate sits in the final room (`F`). It does NOT block or move — it's a visual goal. The system example is the demo of `pick` — deterministic from seed, but visibly different across seeds. **This is the smallest possible demonstrable use of the `pick` helper** and the cheapest way to teach an LLM coding agent "deterministic ≠ pre-baked — same seed reproduces, switching seed changes outcome".

```ts
const crewmateNames = ['Viridian', 'Verdigris', 'Victoria', 'Vermilion'];
const crewmateName = pick(mulberry32((levelSeed ^ 0x5EA51DE) >>> 0), crewmateNames);
// Fixed-step update: this is the only place rescueTimer changes.
const isRescuing = aabbOverlap(playerRect, crewmateRect);
rescueTimer = isRescuing ? rescueTimer + 1 : 0;
if (rescueTimer > 60) {
  fsm = reduceGameState(fsm, { type: 'win' }, dt);
}

// Render phase: display only; never advance authoritative state here.
if (isRescuing) {
  drawText(ctx, `${crewmateName}: Thank you!`, playerX, playerY - 12, {
    font: DEFAULT_FONT,
    color: palette.feature,
  });
}
```

## 9. Camera — locked per room, briefly easing on room-entry

VVVVVV is screen-locked; the camera doesn't follow. Use the engine's `createCamera` for the locked target snap + `createTweenState` for the room-entry ease:

- **Locked camera.** Pass a full target rectangle:
  `camera = updateCamera(camera, { x: roomX, y: roomY, width: viewport.width, height: viewport.height }, bounds, viewport, DEFAULT_CAMERA)`.
- **Room-entry ease.** Use `createTweenState()` plus
  `advanceTween(tweenState, dt, { duration: 0.25, ease: easeOutCubic })`, then
  interpolate `fromX`/`toX` with the returned normalized value.

## 10. ★ Procedural chiptune (THE showcase pillar)

> This section teaches the four-layer architecture of the engine's `music` module. The chiptune you hear at runtime **is** the engine's pure `advanceSequencer` determinism seam, played through the same `AudioAdapter` the SFX use.

### 10.1 Why music is a first-class citizen here

A typical VVVVVV-like game ships an `.mp3` and calls `audio.play()`. A typical procedural-music demo calls `playNote(440, ...)` on a `setInterval`. **Flipside does neither.** It uses a four-layer split that mirrors the rest of the engine:

| Layer | What | Where it lives | Determinism |
|---|---|---|---|
| **1 — Theory** | MIDI ↔ Hz, scales, swing math | `music/theory.ts` | Pure (no host, no state) |
| **2 — Pattern** | Seeded `Pattern` (bass+lead+harmony+perc) | `music/pattern.ts` via `generatePattern(seed, config)` | Pure (`mulberry32` only) |
| **3 — Advance** | Walk the pattern; emit `NoteFire[]` | `music/advance.ts` via `advanceSequencer(state, dt, pattern)` | **Pure — the determinism seam** |
| **4 — Host** | Render external events through the shared `AudioAdapter` | `createNoteFirePlayer(audio)` | Host-only; owns no clock or simulation state |

The engine guarantee you ship: **Layer 3 is the only thing gameplay logic depends on.** Same `(state, dt, pattern)` → same `NoteFire[]` `.events`, byte-identical, forever. The wall-clock scheduler in Layer 4 is the determinism carve-out (decorative audio output) — it never feeds back into game state.

### 10.2 Layer 1 — Theory

```ts
import { SCALES, buildScale, noteToFrequency } from 'aicraft-engine';

// VVVVVV's lead lives in C-minor pentatonic. Two octaves of it.
const scale = buildScale(60, SCALES.minorPentatonic, 2);
// [60, 63, 65, 67, 70, 72, 75, 77, 79, 82] — C4 minor pentatonic

const freq = (midi: number) => noteToFrequency(midi);   // MIDI → Hz (12-tone ET)
freq(60); // ~261.6256 (C4)
```

`SCALES` ships six presets. Use `minorPentatonic`; `createNoteFirePlayer`
converts each returned event's MIDI value to frequency.

### 10.3 Layer 2 — Pattern

`generatePattern(seed, config)` produces a complete `Pattern` (bass+lead by default). Pass a full track config for the three tonal voices; percussion is a separate noise lane driven by sequencer step boundaries:

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
  ],
});
```

The pattern is **JSON-serializable, pure**. Same `(levelSeed, config)` → same `Pattern.tracks[x].patterns[y][z]` byte-for-byte. Dump to console once for a determinism sanity check.

> ⚠ **Determinism contract pinned:** every note in the pattern comes from `scaleDegree` (Layer 1), **never** `pick`. The `degreeMin` / `degreeMax` bounds on each `TrackGenConfig` mean the seeded PRNG can never produce a note outside your scale — safe for degenerate configs (see `music/pattern.ts` decision §10).

### 10.4 Layer 3 — Advance: the determinism seam (call it every fixed step)

Hold the playback state on your game store. Each fixed step, advance by the simulator's `dt` and commit the next state:

```ts
import { advanceSequencer, type SequencerState, type NoteFire } from 'aicraft-engine';

let seqState: SequencerState = { elapsedS: 0, stepIndex: 0, loopCount: 0 };
let firedNotes: NoteFire[] = [];   // last-tick buffer for any consumer (HUD, derives from the deterministic seam)

// each fixed step (from the engine's createGameLoop callback):
const { next, events } = advanceSequencer(seqState, dt, pattern, { swing: 0.5 });
seqState = next;
firedNotes = events.slice();        // immutable — already a fresh array
notePlayer.play(events);             // render every tonal event from this fixed-step window
```

**This is the seam.** `advanceSequencer` is the only place that decides when a note fires. The keyboard input, the player's x position, the spike hit, the gravity-flip — none of them touch the music. Input → simulation → `advanceSequencer(state, dt, pattern)` → `events` → `audio.playTone(...)`. The cross-loop determinism test (§14.6) is the proof you shipped the split correctly.

> ⚠ **`dt` units:** the engine's fixed-step loop gives you `dt = 1/60` per tick. Don't multiply by anything before passing to `advanceSequencer` — the function's window-crossing math expects `dt` in seconds. `secondsPerStep(bpm, stepsPerBeat)` returns the step duration in seconds, ready for both the advance layer and the host layer.

### 10.5 Layer 4 — Host: render the exact fixed-step events

This is the consumer-facing entry point. **You pass your already-unlocked `AudioAdapter`**; the sequencer does not allocate a second `AudioContext`, does not require a separate user gesture, does not duplicate the master-gain chain:

```ts
import { createNoteFirePlayer, type AudioAdapter } from 'aicraft-engine';

// Call only after §10.7 has admitted the non-reduced-motion boot path.
function wireMusicHost(audio: AudioAdapter) {
  const notePlayer = createNoteFirePlayer(audio);
  notePlayer.setVolume(0.5);
  return notePlayer;
}
```

The player owns no clock or pattern. It converts MIDI to frequency, gate
seconds to milliseconds, scales peak by its music volume, and forwards
`whenOffset`. Never also create `createSequencer` for this song.

### 10.6 Percussion via noise

Keep percussion as a fourth, independent rhythm lane. At this brief's fixed
`1/60 s` step and 130 BPM, at most one music-step boundary can be crossed per
simulation tick, so a change in `stepIndex` is the drum clock. Do not emit one
drum hit per melodic event; that would couple percussion density to the number
of sounding tonal tracks.

> The block below **replaces** the tonal-only advance from §10.4 — it is the
> same single `advanceSequencer` call, now bracketed by the drum-edge test.
> Do NOT paste both blocks into `step.ts`; acceptance #12 requires exactly
> one `advanceSequencer` call per fixed tick.

```ts
const percussion = [true, false, true, false, true, false, true, false,
                    true, false, true, false, true, false, true, false];
const previousStep = seqState.stepIndex;
const { next, events } = advanceSequencer(seqState, dt, pattern, { swing: 0.5 });
seqState = next;
notePlayer.play(events);
if (seqState.stepIndex !== previousStep &&
    percussion[previousStep % percussion.length]) {
  audio.playNoise(60, 'bandpass', 1800, 0.18, events[0]?.whenOffset ?? 0);
}
```

The drummer shares the sequencer's `stepIndex`, but remains a distinct fourth
voice. It never uses `setInterval`.

### 10.7 Reduced-motion → no audio host or loop

Check reduced motion before allocating any audio host. If it is active, render
once and create neither the audio adapter, note player, nor loop:

```ts
if (prefersReducedMotion()) {
  renderStaticFrame(roomA, camera); // one frame; no audio host, scheduler, or loop
} else {
  const audio = createAudioAdapter();
  const notePlayer = wireMusicHost(audio);
  installAudioUnlockHandlers(audio);
  loop.start();
}
```

### 10.8 Per-zone seed → different melody

The pickup room (`E`) and rescue room (`F`) may have different `levelSeed` salts; same `(levelSeed, patternConfig)` reproduces the same melody forever. Switch seed → different melody. Re-cross into room `A` → same melody, byte-for-byte:

```ts
// per-room pattern regen on door cross:
const pattern: Pattern = generatePattern((levelSeed ^ currentRoom.seedSalt) >>> 0, patternConfig);
seqState = { elapsedS: 0, stepIndex: 0, loopCount: 0 };
```

## 11. Game feel (every item uses the engine)

- [ ] **Gravity flip tween-down**: advance a valid `TweenState`/`TweenConfig`
  pair and map its normalized value from a negative squash offset to zero.
- [ ] **Hit-stop on spike death**: `triggerHitStop(hitStop, 8)` for the freeze-frame flash.
- [ ] **Screen shake on death**: `sineShake + shakeEnvelope` decay envelope for 12 ticks, magnitude 4.
- [ ] **Instant respawn**: use a consumer-owned 12-tick respawn counter while
  the shipped FSM is in `gameover`, then send `{ type: 'retry' }`.
- [ ] **Trinket sparkle on collect**: `spawn` 10 small particles outward + `drawGlow` burn-out (one frame).
- [ ] **Room-entry camera ease**: 0.25 s `easeOutCubic` position tween (held player position until complete).
- [ ] **Reduced-motion gate** (`prefersReducedMotion`) renders room 1 and creates no audio adapter, note player, or loop.
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
    rooms.ts         # the six hand-authored LevelData rooms (A–F)
    player.ts        # player input → flip + walk; cheap render of body + eyes + antenna
    hazards.ts       # spike AABB check + die()
    collectibles.ts  # trinket: derivePickups → collect → writeSave
    npcs.ts          # crewmate render + drawText line
  music.ts           # pattern config + advanceSequencer + createNoteFirePlayer
  audio.ts           # createAudioAdapter + the SFX recipe helpers (gravity-flip zap, etc.)
  save.ts            # createLocalStorageSaveStorage + the trinket key
```

## 14. Acceptance criteria

1. Playable in browser via `npm run dev`; keyboard and touch flip with
   `gravitySign = gravitySign === 1 ? -1 : 1` and never trigger jump.
2. **Six connected single-screen rooms (A–F)**, hand-authored as `LevelData`, with at least **1 room demonstrating the gravity-flip-as-puzzle** (spikes on the floor; flip to the ceiling to walk across).
3. **One gold trinket** collected in room `E` via `derivePickups` → `collect`; persists across page reload via `createLocalStorageSaveStorage` + `writeSave` + a `'flipside:trinkets'` save key.
4. **One crewmate rescue** in room `F`. The crewmate's name is generated once via `pick(rng, ['Viridian', 'Verdigris', 'Victoria', 'Vermilion'])` driven by `levelSeed ^ 0x5EA51DE`. The name is displayed via `drawText` on screen overlap.
5. **Procedural chiptune plays in the background**, generated by `generatePattern`, advanced exactly once per fixed step, and rendered from that exact `NoteFire[]` by `createNoteFirePlayer(audio)`.
6. **Strict determinism in the sequencer.** Every `NoteFire` emitted by `advanceSequencer` over the fixed window `t ∈ [0, 2.0] s` is byte-identical across reloads given the same `levelSeed`, and the window emits at least one event. (Acceptance test: serialize → string-compare against a snapshot saved alongside the seed.)
7. Death on spike assigns hit-stop, enters shipped `gameover` via `die`, waits
   a consumer-owned 12-tick flash, snaps to spawn, then sends `retry`.
8. `prefersReducedMotion()` is checked before audio setup, renders room 1 statically, and creates no audio adapter, note player, or loop.
9. **Zero hand-rolled reimplementations** — no direct animation-frame loop,
   random authoritative simulation, duplicate AABB/tile traversal, consumer
   gravity integrator, raw WebAudio graph, or duplicate parallax system.
   Required `drawTileGrid` and `drawTiledParallax` appearance callbacks are allowed.
10. **No moonwalk.** Horizontal `ctx.scale(facing, 1)` mirror is wrapped around the body + eye-dot draw — walking left faces left. Gravity flip does NOT multiply the render by `gravitySign` (no vertical mirror — VVVVVV's character does not visually invert, only the floor/ceiling detection swaps).
11. **Use `playTone('square', ...)` for the lead track** AND for the gravity-flip SFX — the chiptune sound and the gameplay feedback sound are recognised as the same voice. The reader should be able to hear the gameplay's gravity-flip blending into the music.
12. **`step` calls `advanceSequencer` exactly once per fixed tick.** Grep `advanceSequencer` — it should appear once, in `step.ts`, called in the same place as `controller.step(state, input, solids, dt)`.

## 15. Stretch goals (only after criteria 1–12)

- **No-flip zones**: wrap level data in a consumer-owned room descriptor such
  as `{ data: LevelData; lockGravity: boolean }`; do not add unsupported fields
  to `LevelData`. Guard the flip handler using the descriptor's flag.
- **V-mode visual only**: a faint vertical "checkpoint line" drawn with `outlineRect` (no time trial, no scoring — pure flourish).
- **Music-zone palette tie-in**: each zone's `levelSeed` drives BOTH the `generatePalette` (with a per-zone tint) AND the `generatePattern` seed. Listen and watch swap together.
- **Cosmetic palette skin variants** via `generateSkinVariants` + `createMemoryIAPAdapter` — violet / amber / celadon monochrome variants unlock on trinket pickup. The current `palette` becomes the unlocked variant via `equipSkin(cosmeticSave, variantId)`.
- **Badeline-style chase ghost (visual only)**: buffer the last N `input` snapshots → drive a second `createPlatformerController` instance with a tinted palette → render its `state.core.x/y` each tick. No new physics — the kernel does the work twice.

---

**Build order suggestion:** loop/input → unified level compilation/render → two signed empty-pipeline controllers → rooms/camera → collectibles/save → fixed-step music with `createNoteFirePlayer` → hazards/reduced-motion → polish.
