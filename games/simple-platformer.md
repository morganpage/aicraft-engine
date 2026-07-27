# Prompt: "Embertomb" — a juicy one-button-deep platformer built on `aicraft-engine`

> Paste this whole document to a coding agent (Claude / Cursor / etc.). It is a complete build brief: concept, tech stack, architecture mapped to the engine's real API, per-system specs, and acceptance criteria. The agent should produce a single runnable Vite + TypeScript browser game that imports everything from `aicraft-engine` (the npm package) and writes **no** re-implementations of what the engine already provides.

---

## 0. You are building

**Embertomb** — a side-view platformer set in a flooded, half-molten ruin. A small seed-generated hero descends through procedural rooms full of walkers, hoppers, flyers, spitters, lava pools, and water sections, collecting coins and reaching the exit door. The feel target is **Sokpop-meets-Celeste**: chunky vector outlines, squash-and-stretch, screen shake, hit-stop, phase-synced footstep audio, and tight fixed-step physics. Everything procedural — no imported art.

**Non-negotiable: build the entire game on top of `aicraft-engine`.** Do not hand-roll fixed-step loops, AABB collision, cameras, footstep detection, particles, jump arcs, locomotion, palettes, or audio — those are all in the engine. If you find yourself writing a `requestAnimationFrame` accumulator, an AABB resolver, a sine-based walk cycle, or a `Math.random()` in the simulation, stop and use the engine instead.

## 1. Tech stack & install

```bash
npm create vite@latest embertomb -- --template vanilla-ts
cd embertomb
npm install aicraft-engine@0.4.0
```

> This brief targets the published `0.4.0` API exactly.

- **TypeScript**, strict. Target ES2021, `moduleResolution: bundler` (matches the engine; Vite resolves its ESM fine).
- **Vite** dev server + build. Single `<canvas>` in `index.html`.
- **`aicraft-engine`** is your only runtime dependency. Import from the **root barrel only**:
  ```ts
  import {
    createGameLoop, createKeyboardAdapter, createTouchButtonSet, orEdges,
    resolveAxisX, resolveAxisY, aabbOverlap,
    resolveTileX, resolveTileY, createTileQuery, worldToTile, tileToWorld, tileRect,
    type TileSolidityQuery, type TileGrid,
    createCamera, updateCamera,
    createHitStop, triggerHitStop, stepHitStop, isHitStopActive,
    volumeScale, breathe, DEFAULT_BREATH,
    advanceLocomotionByDisplacement, evaluateLocomotion, DEFAULT_GAIT, blendAirborneTuck, DEFAULT_TUCK,
    createFootPlantState, advanceFootPlant,
    drawSimpleFeet, DEFAULT_SIMPLE_FEET,
    solveLimb, sineShake, shakeEnvelope,
    advanceJump, createJumpState, evaluateJump, DEFAULT_JUMP,
    advanceSpringRod, createSpringRod, DEFAULT_SPRING_ROD,
    spawn, step as stepParticles, sampleConeVelocity,
    createEmitter, stepEmitters, type SpawnRegion,
    advanceGapMotion, gapSolids,
    LAVA_FIRE_PARTICLES, LAVA_SMOKE_PARTICLES, WATER_BUBBLE_PARTICLES,
    LAVA_SURFACE_COLOR, LAVA_BODY_COLOR, WATER_SURFACE_COLOR,
    generateWaveLine, DEFAULT_GERSTNER, DEFAULT_WAVE_LINE,
    drawTiledParallax, outlineRect, drawGlow, resizeCanvasToBackingStore,
    prefersReducedMotion,
    createAudioAdapter,
    mulberry32, nextInt, nextFloat, pick,
    generatePalette, lerp,
    drawTileGrid,
  } from 'aicraft-engine';
  ```
  (The published package only exposes the root `"."` entry — never deep-import subpaths like `aicraft-engine/animation`; use the root barrel.)

## 2. Determinism & discipline rules (enforced by the engine — follow them)

- **Fixed-step sim, variable render** via `createGameLoop({ fixedDt: 1/60, step, render })`. Poll input **exactly once per `step`**.
- **No `Math.random()` in the simulation.** Use `mulberry32(seed)` → `nextInt` / `nextFloat` / `pick` for level generation, enemy spawns, loot, AI jitter. `Math.random` is only OK for purely decorative audio/visual side-effects that never feed back into game state (e.g. blink timing).
- **No `Date.now()` in the sim.** Time comes from `tick` or the loop's `dt`.
- **Defensive host access.** Anything touching `window`/`AudioContext`/`matchMedia` goes through the engine's adapters (`createAudioAdapter`, `prefersReducedMotion`, `resizeCanvasToBackingStore`) — they're lazy, error-swallowing, and no-op in Node.
- **Reduced motion.** Gate the loop: if `prefersReducedMotion()`, render one static frame and never call `loop.start()`.
- **Pure progression ops.** State updates return new objects (the engine's collision/camera/locomotion functions already do this — follow their lead).

## 3. Architecture — engine module → game system map

| Game system | Engine API |
|---|---|
| Game loop (60 Hz fixed) | `createGameLoop` |
| Keyboard + touch input, edge merging | `createKeyboardAdapter`, `createTouchButtonSet`, `orEdges` |
| Player/tile/world collision | `resolveAxisX`, `resolveAxisY`, `aabbOverlap`, `resolveTileX`, `resolveTileY`, `worldToTile`, `tileToWorld`, `tileRect`, `TileSolidityQuery` |
| Follow camera with clamp + lookahead | `createCamera`, `updateCamera` |
| Hit-stop freeze on heavy impacts | `createHitStop`, `triggerHitStop`, `stepHitStop`, `isHitStopActive` |
| Player squash/stretch + idle breathing | `volumeScale`, `breathe`, `DEFAULT_BREATH` |
| Player walk cycle (anti-foot-slide) | `advanceLocomotionByDisplacement`, `evaluateLocomotion`, `DEFAULT_GAIT` |
| Player legs | `drawSimpleFeet`, `DEFAULT_SIMPLE_FEET` (heroes with knees: `solveLimb`) |
| Footstep audio synced to real steps | `createFootPlantState`, `advanceFootPlant` |
| Jump arc + landing squash | `advanceJump`, `createJumpState`, `evaluateJump`, `DEFAULT_JUMP`, `blendAirborneTuck`, `DEFAULT_TUCK` |
| Tail / antenna / hair physics | `advanceSpringRod`, `createSpringRod`, `DEFAULT_SPRING_ROD` (use this — the raw `advanceSpringChain` can blow out; the rod is blowout-proof) |
| Dust, splashes, sparks, bubbles, embers | `spawn`, `stepParticles`, `sampleConeVelocity` |
| Continuous fire/smoke/lava-bubble emitters | `createEmitter`, `stepEmitters`, + the ratified presets: showcase-tuned `LAVA_FIRE_PARTICLES` / `LAVA_SMOKE_PARTICLES` and derived `WATER_BUBBLE_PARTICLES` (do NOT invent params — spread the preset, only override `region`/`rng`) |
| Water + lava animated surfaces | `generateWaveLine`, `DEFAULT_GERSTNER`, `DEFAULT_WAVE_LINE` |
| Parallax background layers | `drawTiledParallax` |
| Glow (lava, coins, magic) | `drawGlow` |
| Chunky vector rendering | `outlineRect` (the Sokpop look) |
| Crisp Retina canvas | `resizeCanvasToBackingStore` |
| Synthesized SFX | `createAudioAdapter` (`playTone`, `playNoise`) |
| Deterministic world/character theming | `generatePalette`, `mulberry32` |
| Save checkpoints / progress | the `save` storage adapter |
| Cosmetic skin unlocks (optional stretch) | `cosmetics` + `iap` modules |

## 4. The player

- **Body:** rounded-rect drawn with `outlineRect`, fill = `palette.base`, outline = `palette.outline`. For `volumeScale`, positive offsets stretch vertically and negative offsets squash vertically: use positive on launch and negative on landing.
- **Legs:** `drawSimpleFeet` driven by `evaluateLocomotion(loco, DEFAULT_GAIT)`.
  Advance phase with actual per-step displacement:
  `loco = advanceLocomotionByDisplacement(loco, player.vx * dt * player.facing, DEFAULT_GAIT)`.
- **⚠ Facing mirror (MANDATORY — or you get a moonwalk):** the locomotion foot offsets are LOCAL-space and assume the draw is mirrored for facing. You MUST wrap the body+feet+face draw in `ctx.scale(facing, 1)` around the body's vertical axis, or walking left shows the character facing right. Canonical pattern:
  ```ts
  ctx.save();
  ctx.translate(bodyCx, bodyBottomY);
  ctx.scale(facing, 1);           // ← do NOT omit, or it moonwalks
  drawSimpleFeet(ctx, pose, { ...DEFAULT_SIMPLE_FEET, color: palette.base, outline: palette.outline });
  outlineRect(ctx, -w/2, -h, w, h, palette.base, palette.outline);  // body
  // ...eyes/face...
  ctx.restore();
  ```
  (Draw any spring-rod tail/antenna OUTSIDE the mirror — its physics already own a screen-space direction.)
- **Footstep audio:** call `const plant = advanceFootPlant(...)`, assign
  `plantState = plant.state`, and read `plant.events`.
- **Jump:** keep one vertical velocity path. Call
  `jumpState = advanceJump(jumpState, { jumpPressed, jumpHeld, isGrounded, hitCeiling }, dt, DEFAULT_JUMP)`,
  copy `jumpState.vy` into the collision body before `resolveTileY`, then feed
  `yRes.landed`/`yRes.hitCeiling` into the next jump inputs. Never integrate or
  mutate a second independent vertical velocity. (Water in §6 obeys this rule:
  it swaps the `JumpConfig` and clamps this same `jumpState.vy` for buoyancy —
  no separate swim integrator.)
- **Tail/hair:** a `createSpringRod` strand anchored at the body (`restDirection` points back/down for a tail, up/forward for an antenna). Use `advanceSpringRod` — NOT the raw `advanceSpringChain`, which lacks bend resistance and can numerically blow a node across the screen. The rod is blowout-proof by construction.
- **Feel:** launch stretch, landing squash, hit-stop on hard landings (`triggerHitStop` when impact > threshold), screen shake (`sineShake`/`shakeEnvelope`), landing-dust (`spawn` upward cone).

## 5. Enemies (thirteen types — each exercises different engine primitives)

All enemies are drawn with `outlineRect` in `palette.accent`/`palette.feature`. AI runs in the fixed `step`.

1. **Walker** — patrols a platform, turns at walls/ledges. `advanceLocomotionByDisplacement` + `drawSimpleFeet` + `advanceFootPlant` (its own footsteps!). Ledge/wall detection via `resolveAxisX`/`resolveAxisY` probes.
2. **Hopper** — periodic hops toward the player using `advanceJump`/`evaluateJump` (reuse the jump trajectory). Squashes via `volumeScale` before each hop (telegraph).
3. **Flyer** — sinusoidal flight path (pure `Math.sin` of a per-enemy phase accumulator) + `advanceSpringRod` wings/trail that lag the body (set a light backward `restDirection`).
4. **Spitter** — stationary; periodically `spawn`s projectiles toward the player using `sampleConeVelocity` aimed at the hero. Projectiles are particles advanced via `stepParticles` and culled; on player hit, `aabbOverlap`.
5. **Chaser** — ground pursuit using `advanceLocomotionByDisplacement` with `facing` flipped toward the player; `solveLimb` IK legs (the beefier enemy that warrants full IK).
6. **Spike-trap** — static, drawn as `outlineRect` triangles; pops up/down on a seeded timer (`mulberry32` per-trap stream).
7. **Saw-blade** — rotates (visual angle from `tick`) and travels a patrol path; damage on `aabbOverlap`. (This one tested well — make more in this mechanical tier, see 11–13.)
8. **Bouncy slime** — `volumeScale` squashes on each bounce off walls/floor (springs back), with a `createSpringRod` antenna that whips on impact. Chases by bouncing.
9. **Swimmer** (water-dweller) — lives in water zones; `advanceSpringRod` serpentine body (low stiffness, horizontal `restDirection`), leaves a `spawn` bubble trail, lunges when the player is near.
10. **Lava-bubble** — emerges from lava pools on a timer; a short-lived `createEmitter` fire+ember burst (reuse `LAVA_FIRE_PARTICLES`) that arcs up then falls back.
11. **Spinning mace** (mechanical, saw-tier) — a heavy spiked ball on a `solveLimb` or `advanceSpringRod` chain pivoting around a fixed anchor, sweeping a pendulum arc (`angle = amp · sin((time+phase)·speed)`). The enemy AABB tracks the BALL, not the pivot. Always dangerous, non-stompable.
12. **Crusher** (mechanical, saw-tier) — a ceiling block on a seeded period (`2.2–3.2s`): rest → **telegraph** (0.5–0.58 fraction, block shakes, harmless) → slam down → hold at floor (dangerous) → retract. Piston rod + hazard-stripe face; stripes brighten when extended. Telegraph gives a fair read.
13. **Laser turret** (mechanical, saw-tier) — charges (thin `outlineRect` beam grows as a telegraph), then fires a damaging beam for a window; seeded timing. Distinct SFX on charge/ fire.

Each enemy: own hitbox (`aabbOverlap` vs player), own death = particle burst (`spawn` in the player's facing), and a distinct SFX (`audio.playNoise`/`playTone`).

## 6. Water

- **Surface:** `generateWaveLine(0, waterY, W, waterY, spacing, t, DEFAULT_WAVE_LINE)` — a gentle sine ripple. Stroked in a translucent blue.
- **Body:** fill below the surface polyline, semi-transparent.
- **Physics when submerged** (player center below `waterY`): water is a MODIFIER on the single authoritative `JumpState` / vertical path from §4 — never a second integrator, never a separate swim-velocity field. Detect submersion by sampling the wave line's Y at the player's X, then:
  - **Vertical (the one path):** select a water `JumpConfig` (e.g. `{ ...DEFAULT_JUMP, apexHeight: smaller, timeToApex: larger, fallMultiplier: ~1, coyoteTime: 0 }`) and pass it to the SAME `advanceJump(jumpState, inputs, dt, waterConfig)` call you use on land — `advanceJump` then emits the floaty swim arc on `jumpState.vy` itself. The swim-stroke is just `jumpPressed` → the normal launch impulse; there is no branch that writes a second vertical velocity. Optionally clamp `jumpState.vy` to a buoyant max-fall (`jumpState = { ...jumpState, vy: Math.min(jumpState.vy, BUOYANT_TERMINAL) }`) AFTER `advanceJump` and BEFORE handing it to `resolveTileY`, exactly as the §8 loop does. One field, one path.
  - **Horizontal (independent of the jump path):** damp `vx` toward zero each tick (water drag).
- **Splash:** on surface entry, `spawn` a burst of droplets upward via `sampleConeVelocity` (cone pointing up), advanced + culled by `stepParticles`. `audio.playNoise` splash.
- **Bubble ambience:** a slow `createEmitter` under the surface emitting rising particles (negative gravity scale).
- **Underwater tint:** draw a translucent blue rect over the viewport when the camera is submerged.

## 7. Lava (the showcase set-piece)

**Use the engine's tuned presets — do NOT invent emitter params.** The engine ships the showcase's hand-tuned recipe as constants; spread them into `createEmitter`. (Embertomb invented mediocre params and the lava looked terrible.)

- **Surface:** `generateWaveLine(..., DEFAULT_GERSTNER)` — Gerstner waves for a choppier molten crust. Stroke with `LAVA_SURFACE_COLOR`.
- **Body fill:** `LAVA_BODY_COLOR`, drawn as the wave polyline closed to the bottom.
- **Emitters (the tuned recipe):**
  ```ts
  const surfaceRegion: SpawnRegion = {
    type: 'line', x1: 0, y1: lavaY, x2: levelWidth, y2: lavaY,
  };
  let fire = createEmitter({ ...LAVA_FIRE_PARTICLES, region: surfaceRegion, rng: rngA });
  let smoke = createEmitter({ ...LAVA_SMOKE_PARTICLES, region: surfaceRegion, rng: rngB });
  // each tick:
  [fire, smoke] = stepEmitters([fire, smoke], 1, { gravity, drag, rateScale: intensity });
  ```
  `WavePoint[]` is render geometry only; it is not a `SpawnRegion`.
  ⚠ **Units contract:** the presets are TICK-based (the showcase uses `dt = 1`). If your game steps in seconds, either step emitters with `dt = 1` (tick units) or convert the preset values to seconds. Mixing units silently produces flat fire / off-screen sparks. Document your choice.
- **Ambient glow:** `drawGlow` at the surface center, low intensity, warm color — sells the light spill.
- **Contact = damage + knockback + heavy hit-stop** (`triggerHitStop`) + a molten splash (`spawn` yellow embers upward) + `audio.playNoise` hiss.

## 8. World & level generation

- **Tile grid.** Solid/empty tiles. Build a `TileSolidityQuery` from your grid, then drive a per-axis move-and-resolve loop with `resolveTileX` / `resolveTileY`:

  ```ts
  // 1 = solid, 0 = empty. Y-major 2D array (grid[y][x]).
  const grid: number[][] = [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 1, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
  ];
  const TILE_SIZE = 16;

  const renderGrid: TileGrid = {
    data: grid.flat(),
    cols: grid[0].length,
    rows: grid.length,
    tileSize: TILE_SIZE,
  };
  const tileQuery: TileSolidityQuery = createTileQuery(
    renderGrid,
    value => value === 1 ? 'solid' : 'empty',
  );

  // JumpState is the authoritative vertical-velocity path (px/s). Collision
  // receives a per-tick delta and feeds contact-zeroed velocity back into it.
  player.vy = jumpState.vy;
  const prevBottom = player.y + player.height;
  const xRes = resolveTileX(player, player.vx * dt, tileQuery, TILE_SIZE);
  player.x = xRes.x;
  if (xRes.hitWall) {
    player.vx = 0;
    player.onWallHit();
  }

  const yRes = resolveTileY(player, player.vy * dt, tileQuery, TILE_SIZE, prevBottom);
  player.y = yRes.y;
  player.vy = yRes.landed || yRes.hitCeiling ? 0 : jumpState.vy;
  jumpState = { ...jumpState, vy: player.vy };
  isGrounded = yRes.landed;
  hitCeiling = yRes.hitCeiling;
  if (yRes.hitCeiling) player.onCeilingHit();
  ```

  Render that same grid through the engine renderer; do not write a second
  nested row/column traversal:
  ```ts
  drawTileGrid(ctx, renderGrid, (c, x, y, tileValue, tileSize) => {
    if (tileValue === 1) outlineRect(c, x, y, tileSize, tileSize, palette.background, palette.outline);
  });
  ```
  The callback signature is `(ctx, x, y, tileValue, tileSize)` — screen-space
  pixel origin first, then the tile value, then the pixel size. The callback
  owns only tile appearance; `drawTileGrid` owns traversal.

  Use `worldToTile` / `tileToWorld` / `tileRect` when you need to convert between world and tile coordinates (ray probes, debug overlay, spawn placement). One-way platforms are `'passthrough'` tiles — they only block downward movement and only when the body was above the tile last tick (`prevBottom` drives the rule inside `resolveTileY`).
- **Procedural rooms** seeded per-level: `const rng = mulberry32(levelSeed)`. Place platforms, gaps, hazards, enemy spawns, coins, and the exit door using `nextInt`/`nextFloat`/`pick`. Same seed → same level forever (replay-perfect).
- **Parallax background:** 3 layers via `drawTiledParallax` at depth factors 0.15 / 0.4 / 0.75, each a procedurally-drawn tile (no art) — distant silhouettes, mid ruins, foreground debris. Palette from `generatePalette(levelSeed)` so each level has a cohesive hue.
- **Coins:** `outlineRect` diamonds in `palette.feature` with a `drawGlow`; on collect, a `spawn` sparkle burst + `audio.playTone` ping.
- **Moving gaps:** `advanceGapMotion` + `gapSolids` model a traveling hole in
  an otherwise static span. The returned span fragments are collision solids,
  but they are not rideable moving platforms and provide no carry
  displacement. Use level `movingPlatform` entities with the platformer
  runtime's displacement provider when the player must ride moving geometry.

## 9. Game feel checklist (the juice — every item uses the engine)

- [ ] Launch stretch + landing squash (`volumeScale`)
- [ ] Hit-stop on hard landings and enemy stomps (`triggerHitStop`)
- [ ] Screen shake on impacts (`sineShake` + `shakeEnvelope`, decaying envelope)
- [ ] Phase-synced footstep taps (`advanceFootPlant`)
- [ ] Dust on every footplant + on landings (`spawn`)
- [ ] Coyote time + jump buffer from `advanceJump` / `JumpState`; do not duplicate them in consumer state.
- [ ] Spring-rod tail/hair lag on the player (`advanceSpringRod`, never the raw `advanceSpringChain`)
- [ ] Reduced-motion gate (`prefersReducedMotion`) that renders one static frame

## 10. Audio (all synthesized via `createAudioAdapter`)

Unlock on first user gesture (one-shot `keydown`/`pointerdown` listener calling `audio.unlock()`). Then:
- **Footsteps:** `playNoise(40, 'lowpass', 200, 0.12)` per `advanceFootPlant` event.
- **Jump:** `playTone('sine', 200, 400, 80, 0.2)` (upward "boing").
- **Land:** `playNoise(80, 'lowpass', 300, 0.3)` (hard) / `playNoise(50, 'lowpass', 250, 0.18)` (soft), scaled by impact.
- **Coin:** `playTone('triangle', 600, 1200, 60, 0.15)`.
- **Hurt:** `playNoise(120, 'lowpass', 400, 0.3)`.
- **Lava hiss / water splash / enemy deaths:** distinct `playNoise`/`playTone` recipes.

## 11. File layout (suggested)

```
src/
  main.ts            # boot: canvas, store, loop.start()
  game/
    state.ts         # World, Player, Enemy, Particle[] state shapes
    step.ts          # the fixed-step: input → physics → AI → collisions → audio
    render.ts        # pure draw: parallax, tiles, water, lava, entities, FX
    levels.ts        # mulberry32-seeded room generator
    enemies.ts       # the 13 enemy types (each: step AI + render)
    player.ts        # player step + render (locomotion/jump/squash/feet)
    water.ts lava.ts # surface + emitters + physics hooks
  input.ts           # createKeyboardAdapter + createTouchButtonSet + orEdges
  audio.ts           # createAudioAdapter + the SFX recipe helpers
```

## 12. Acceptance criteria

1. `npm run dev` boots a playable level with keyboard (←→/A/D move, Space jump) **and** on-screen touch buttons on coarse-pointer devices.
2. The player walks (feet plant, no slide), jumps (variable height), squashes on land, and makes a tap on every visible step.
3. At least **7 of the 13 enemy types** appear across the first few levels, each behaving distinctly, including at least **2 from the mechanical tier** (saw-blade / spinning mace / crusher / laser turret).
4. A **water section** (floaty physics, splash on entry, animated surface) and a **lava pool** (Gerstner surface, fire+smoke emitters, glow, damage) are both present.
5. Hit-stop + screen shake fire on hard landings and stomps.
6. Parallax background (≥2 layers) + a seeded palette per level.
7. `prefers-reduced-motion` renders a static frame and starts no loop.
8. **Zero hand-rolled reimplementations** of: fixed-step loop, AABB/tile collision, camera follow, locomotion phase, jump trajectory, foot-plant detection, particle stepping, wave surfaces, or audio synthesis. All come from `aicraft-engine`. (The reviewer will grep for `requestAnimationFrame`, `Math.random` in `step`, and manual AABB — none should exist outside the engine.)
9. Same `levelSeed` produces a byte-identical level layout every run.
10. **No moonwalk.** Walking left faces left in both the player and every locomotion-driven enemy (walker, chaser). The reviewer will playtest: hold ←/A — the character's face + feet must point left. (Enforced by the `ctx.scale(facing, 1)` mirror around the body draw.)
11. **No tail/appendage blow-out.** Every Verlet strand (player tail, flyer trail, slime antenna, swimmer body) uses `advanceSpringRod`, never the raw `advanceSpringChain`. The reviewer will grep for `advanceSpringChain` in appendage code — it must not appear there. (The rod is blowout-proof; the raw chain is not — Embertomb had a swimmer node stroked across the whole viewport.)
12. **Lava uses the presets.** The reviewer will grep for `LAVA_FIRE_PARTICLES` / `LAVA_SMOKE_PARTICLES` in the lava setup — the tuned recipe must be used, not invented params.

## 13. Stretch goals (only after criteria 1–12)

- `cosmetics` + `iap` modules: unlockable seeded character skins via a dev/local-storage IAP adapter.
- `save` storage: checkpoints + coin total persist across reloads.
- A boss that combines flyer + spitter + lava-bubble phases.
- Daily-seed mode (`Date.now()` → day bucket → seed; here `Date.now` is acceptable because it's *selecting* a seed, not driving the sim).

---

**Build order suggestion:** loop + input + a player that walks/jumps/collides on a flat tile floor (criteria 1–2) → camera + a walker enemy → hit-stop/shake/dust (juice) → water → lava → more enemies → parallax + seeded palettes → polish. Get the feel right before breadth.
