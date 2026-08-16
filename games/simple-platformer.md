# Embertomb — A Five-Biome Procedural Descent on `aicraft-engine@0.15.0`

> Paste this entire document to a coding agent (Claude / Cursor / etc.). It is a complete, self-contained build brief: concept, architecture, exact data contracts, biome specifications, implementation stages, acceptance gates, and anti-shortcut checks. The agent should produce a single runnable Vite + TypeScript browser game that imports everything from `aicraft-engine` (the npm package) and writes **no** re-implementations of what the engine already provides.

---

## 0. What You Are Building

**Embertomb** — a side-view procedural platformer set in a flooded, half-molten ruin. A small seed-generated hero descends through procedural rooms drawn from **five distinct biome archetypes**, each with a unique visual identity, hazard mix, and enemy roster. The feel target is **Sokpop-meets-Celeste**: chunky vector outlines, squash-and-stretch, screen shake, hit-stop, phase-synced footstep audio, and tight fixed-step physics. Everything procedural — no imported art.

**This is NOT a tech demo.** It is a designed procedural game with five biomes that escalate from gentle onboarding (Ash Ruins) through three showcase biomes (Ember Caverns for lava, Drowned Halls for water, Gear Sanctum for the mechanical enemy tier) to an escalation finale (Heart Vault). The procedural generator must produce rooms whose biome is recognizable at a glance — distinct silhouette, distinct connected-terrain motif, distinct palette, distinct hazard mix, distinct enemy roster.

**This brief is expanded to preempt the failure modes the Flipside rewrite addressed.** The previous Flipside implementation failed because it used one shared box template for all rooms, producing procedural mush with no visual variety — every room looked identical, the music was a 1.85-second ringtone, and the result was a bland, unfun game. Embertomb's generator risks the exact same failure: a `mulberry32`-driven room generator without explicit biome specifications produces rooms that all look the same. This brief fixes that risk up front by specifying five biome archetypes the generator selects between based on depth, each with a complete design contract.

**Non-negotiable: build the entire game on top of `aicraft-engine@0.15.0`.** Do not hand-roll fixed-step loops, AABB collision, cameras, footstep detection, particles, jump arcs, locomotion, palettes, or audio — those are all in the engine. If you find yourself writing a `requestAnimationFrame` accumulator, an AABB resolver, a sine-based walk cycle, a hand-drawn tile renderer, or a `Math.random()` in the simulation, stop and use the engine instead.

---

## 1. Tech Stack & Install

```bash
npm create vite@latest embertomb -- --template vanilla-ts
cd embertomb
npm install aicraft-engine@0.15.0
```

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
    shade, mixHex,           // palette derivation per biome (connected terrain renderer)
    fnv1a,                   // biome unique hashes (static contracts)
    drawTileGrid,
  } from 'aicraft-engine';
  ```
  (The published package only exposes the root `"."` entry — never deep-import subpaths like `aicraft-engine/animation`; use the root barrel. Tree-shaking works because each module has its own barrel.)

> This brief targets the published `0.15.0` API exactly. It was originally written against `0.4.0` and repinned; **every API it names still exists and compiles at `0.15.0`** — the export surface has been additive, so the per-axis collision resolver path this brief teaches (`resolveAxisX`/`resolveAxisY` + `resolveTileX`/`resolveTileY`, driven by hand instead of through the platformer kernel) is unchanged and still the point of the exercise. Embertomb is the one prompt in the catalog that deliberately does **not** use the kernel, so the kernel-side changes across `0.5.0`–`0.15.0` (wall-jump, mantle, dash-tech, the room-transition layer) do not touch it at all. What is worth adopting: `0.13.0`'s **sustained audio** — `startNoiseLoop(filterType, freq, peak)` returns a handle you `stop()` when a state ends, which is the correct shape for continuous sounds like lava hiss or water, replacing per-tick `playNoise` retriggering (that pattern phase-locks into an audible buzz, and `0.13.0` also de-correlates burst starts to fix it). Note also the replay physics version is now **13**, and a manually-constructed `PlatformerState` needs `moments: []`.

---

## 2. Determinism & Discipline Rules (enforced by the engine — follow them)

- **Fixed-step sim, variable render** via `createGameLoop({ fixedDt: 1/60, step, render })`. Poll input **exactly once per `step`**.
- **No `Math.random()` in the simulation.** Use `mulberry32(seed)` → `nextInt` / `nextFloat` / `pick` for level generation, enemy spawns, loot, AI jitter, biome selection. `Math.random` is OK only for purely decorative audio/visual side-effects that never feed back into game state (e.g. blink timing).
- **No `Date.now()` in the sim.** Time comes from `tick` or the loop's `dt`. (Daily-seed mode may use `Date.now` *outside* the sim — only to *select* a seed, never to drive physics.)
- **Defensive host access.** Anything touching `window`/`AudioContext`/`matchMedia` goes through the engine's adapters (`createAudioAdapter`, `prefersReducedMotion`, `resizeCanvasToBackingStore`) — they're lazy, error-swallowing, and no-op in Node.
- **Reduced motion.** Gate the loop: if `prefersReducedMotion()`, render one static frame and never call `loop.start()`.
- **Pure progression ops.** State updates return new objects (the engine's collision/camera/locomotion functions already do this — follow their lead). The room generator is pure: same `levelSeed` → same tile grid, same enemy spawns, same hazards, byte-identical forever.
- **Procedural determinism is the headline.** Embertomb is replay-perfect: the same `levelSeed` must produce the same descent through all five biomes on every run, every reload, every machine.

---

## 3. Architecture — Engine Module → Game System Map

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
| Per-biome palette derivation (connected terrain) | `shade`, `mixHex` |
| Biome identity hashing (static contracts) | `fnv1a` |
| Save checkpoints / progress | the `save` storage adapter |
| Cosmetic skin unlocks (optional stretch) | `cosmetics` + `iap` modules |

---

## 4. The Player

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

---

## 5. Enemies — Thirteen Types (each exercises different engine primitives)

All enemies are drawn with `outlineRect` in `palette.accent`/`palette.feature`. AI runs in the fixed `step`. The full bestiary is the engine-primitive tour; **not every type appears in every biome** (see §8.5 for the per-biome roster).

1. **Walker** — patrols a platform, turns at walls/ledges. `advanceLocomotionByDisplacement` + `drawSimpleFeet` + `advanceFootPlant` (its own footsteps!). Ledge/wall detection via `resolveAxisX`/`resolveAxisY` probes.
2. **Hopper** — periodic hops toward the player using `advanceJump`/`evaluateJump` (reuse the jump trajectory). Squashes via `volumeScale` before each hop (telegraph).
3. **Flyer** — sinusoidal flight path (pure `Math.sin` of a per-enemy phase accumulator) + `advanceSpringRod` wings/trail that lag the body (set a light backward `restDirection`).
4. **Spitter** — stationary; periodically `spawn`s projectiles toward the player using `sampleConeVelocity` aimed at the hero. Projectiles are particles advanced via `stepParticles` and culled; on player hit, `aabbOverlap`.
5. **Chaser** — ground pursuit using `advanceLocomotionByDisplacement` with `facing` flipped toward the player; `solveLimb` IK legs (the beefier enemy that warrants full IK).
6. **Spike-trap** — static, drawn as `outlineRect` triangles; pops up/down on a seeded timer (`mulberry32` per-trap stream).
7. **Saw-blade** — rotates (visual angle from `tick`) and travels a patrol path; damage on `aabbOverlap`. (This one tested well — the Gear Sanctum biome §8.5.4 leans on the whole mechanical tier, types 7, 11, 12, 13.)
8. **Bouncy slime** — `volumeScale` squashes on each bounce off walls/floor (springs back), with a `createSpringRod` antenna that whips on impact. Chases by bouncing.
9. **Swimmer** (water-dweller) — lives in water zones; `advanceSpringRod` serpentine body (low stiffness, horizontal `restDirection`), leaves a `spawn` bubble trail, lunges when the player is near.
10. **Lava-bubble** — emerges from lava pools on a timer; a short-lived `createEmitter` fire+ember burst (reuse `LAVA_FIRE_PARTICLES`) that arcs up then falls back.
11. **Spinning mace** (mechanical, saw-tier) — a heavy spiked ball on a `solveLimb` or `advanceSpringRod` chain pivoting around a fixed anchor, sweeping a pendulum arc (`angle = amp · sin((time+phase)·speed)`). The enemy AABB tracks the BALL, not the pivot. Always dangerous, non-stompable.
12. **Crusher** (mechanical, saw-tier) — a ceiling block on a seeded period (`2.2–3.2s`): rest → **telegraph** (0.5–0.58 fraction, block shakes, harmless) → slam down → hold at floor (dangerous) → retract. Piston rod + hazard-stripe face; stripes brighten when extended. Telegraph gives a fair read.
13. **Laser turret** (mechanical, saw-tier) — charges (thin `outlineRect` beam grows as a telegraph), then fires a damaging beam for a window; seeded timing. Distinct SFX on charge/ fire.

Each enemy: own hitbox (`aabbOverlap` vs player), own death = particle burst (`spawn` in the player's facing), and a distinct SFX (`audio.playNoise`/`playTone`).

---

## 6. Water Set-Piece

- **Surface:** `generateWaveLine(0, waterY, W, waterY, spacing, t, DEFAULT_WAVE_LINE)` — a gentle sine ripple. Stroked in a translucent blue.
- **Body:** fill below the surface polyline, semi-transparent.
- **Physics when submerged** (player center below `waterY`): water is a MODIFIER on the single authoritative `JumpState` / vertical path from §4 — never a second integrator, never a separate swim-velocity field. Detect submersion by sampling the wave line's Y at the player's X, then:
  - **Vertical (the one path):** select a water `JumpConfig` (e.g. `{ ...DEFAULT_JUMP, apexHeight: smaller, timeToApex: larger, fallMultiplier: ~1, coyoteTime: 0 }`) and pass it to the SAME `advanceJump(jumpState, inputs, dt, waterConfig)` call you use on land — `advanceJump` then emits the floaty swim arc on `jumpState.vy` itself. The swim-stroke is just `jumpPressed` → the normal launch impulse; there is no branch that writes a second vertical velocity. Optionally clamp `jumpState.vy` to a buoyant max-fall (`jumpState = { ...jumpState, vy: Math.min(jumpState.vy, BUOYANT_TERMINAL) }`) AFTER `advanceJump` and BEFORE handing it to `resolveTileY`, exactly as the §8 loop does. One field, one path.
  - **Horizontal (independent of the jump path):** damp `vx` toward zero each tick (water drag).
- **Splash:** on surface entry, `spawn` a burst of droplets upward via `sampleConeVelocity` (cone pointing up), advanced + culled by `stepParticles`. `audio.playNoise` splash.
- **Bubble ambience:** a slow `createEmitter` under the surface emitting rising particles (negative gravity scale). The ratified `WATER_BUBBLE_PARTICLES` preset exists for this — spread it, only override `region`/`rng`.
- **Underwater tint:** draw a translucent blue rect over the viewport when the camera is submerged.

> The Drowned Halls biome (§8.5.3) is the showcase for this set-piece. Every Drowned Halls room has a mandatory water section.

---

## 7. Lava Set-Piece (the showcase)

**Use the engine's tuned presets — do NOT invent emitter params.** The engine ships the showcase's hand-tuned recipe as constants; spread them into `createEmitter`. (Embertomb invented mediocre params once and the lava looked terrible. Never again.)

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

> The Ember Caverns biome (§8.5.2) is the showcase for this set-piece. Every Ember Caverns room has a mandatory lava pool.

---

## 8. World — Five Procedural Biome Types

This is the headline section. The procedural generator does not produce one undifferentiated stream of rooms — it produces rooms drawn from **five biome archetypes** selected by depth. Each biome has a complete design contract (silhouette, motif, palette, hazard mix, enemy roster). A room's biome is recognizable at a glance from across the room.

### 8.1 Logical Resolution & Grid

| Parameter | Value |
|---|---|
| Logical resolution | 320 × 240 (typical room) |
| Grid | 20 × 15 tiles per room (TILE_SIZE 16) |
| Tile size | 16 px |
| CSS upscale | `image-rendering: pixelated` on the canvas, backing store at 320×240, CSS scales to viewport |
| Player body | ~12 × 16 px (about one tile wide, one tile tall) |

Canvas setup matches §1's `resizeCanvasToBackingStore` call; the biome's `tile-style.ts` (§8.4) reads the rendered grid and applies per-biome motifs.

### 8.2 Procedural Descent Topology

Embertomb is a vertical descent. The generator selects a biome for each depth based on the depth index, then generates a room of that biome from a per-depth seed. The descent has a fixed biome progression so the player experiences all five biomes in a known escalation order:

```
   depth 0 ──┬──── Ash Ruins ──────── (onboarding: walkers, hoppers, gentle gaps)
             │
   depth 4 ──┼──── Ember Caverns ──── (lava showcase: mandatory lava pool, lava-bubbles)
             │
   depth 8 ──┼──── Drowned Halls ──── (water showcase: mandatory water, swimmers)
             │
  depth 12 ──┼──── Gear Sanctum ───── (mechanical tier: saw-blade, mace, crusher, laser)
             │
  depth 16 ──┴──── Heart Vault ────── (escalation: mixed roster from all 4 + boss stretch)
             ↓
          (descent continues; Heart Vault recurs with escalating density)
```

- **Biome selection rule:** `function biomeForDepth(depth): BiomeKind { if (depth < 4) return 'ash'; if (depth < 8) return 'ember'; if (depth < 12) return 'drowned'; if (depth < 16) return 'gear'; return 'heart'; }`. This is the contract — do not randomize biome order.
- **Per-depth seed:** `const depthSeed = (levelSeed ^ (depth * 0x9E3779B1)) >>> 0;` (xorshift-style mixing — same depth, same seed, same room, byte-identical forever).
- **Per-biome seed:** each biome owns a `biomeSeed = mulberry32(depthSeed)` stream the generator pulls from for layout, hazards, enemies, palette hue. Never share one stream across concerns.
- **Exit door:** every room has exactly one exit door at the bottom (south edge), leading to the next depth. The descent is linear; biome variety is the variety, not branching topology.

### 8.3 Tile Schema

Build a `TileSolidityQuery` from your grid, then drive a per-axis move-and-resolve loop with `resolveTileX` / `resolveTileY`:

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

Use `worldToTile` / `tileToWorld` / `tileRect` when you need to convert between world and tile coordinates (ray probes, debug overlay, spawn placement). One-way platforms are `'passthrough'` tiles — they only block downward movement and only when the body was above the tile last tick (`prevBottom` drives the rule inside `resolveTileY`).

> **Render note:** do NOT render via a second nested row/column traversal. The connected-terrain renderer in §8.4 is the only tile-render path. `drawTileGrid` is allowed *only* as the outer traversal; the `drawTile` callback owns per-tile appearance.

### 8.4 Connected Terrain Renderer (Biome Visual Identity System)

This is the visual identity system. It lives in the game as `tile-style.ts` — NOT in the engine. The engine provides `drawTileGrid(ctx, tiles, drawTile)`, `TileGrid` (with `.data` as a flat array), and the `shade`/`mixHex` color helpers. **The previous Embertomb rendered every solid tile as a flat `outlineRect(ctx, x, y, tileSize, tileSize, palette.background, palette.outline)` — visually identical across the entire descent, which is exactly the procedural-mush failure mode this brief exists to prevent.** The connected-terrain renderer replaces that.

**Neighbor bitmask.** For each solid tile, read N/E/S/W neighbors from the flat `TileGrid.data` (safe reads — out-of-bounds = not solid):

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
| Fill | Connected mass color (biome-specific palette via `shade`/`mixHex`) |
| Highlight | Only exposed north and west edges (lighter shade) |
| Shadow | Only exposed south and east edges (darker shade) |
| Outline | ONLY external edges — **NEVER outline internal borders between connected tiles** |
| Interior motif | Biome-specific (see table below) |

**Five biome motifs.** Each biome's `drawTile` callback closes over the grid and applies a motif-specific interior detail, drawn after the fill/highlight/shadow pass. The motif is what makes a biome recognizable at a glance:

| Biome | Motif | Visual |
|---|---|---|
| Ash Ruins | Horizontal mortar lines | 2px horizontal stripes at the vertical mid-line of each solid tile (crumbling brick courses) |
| Ember Caverns | Cracked obsidian + ember veins | 1px diagonal lines in `mixHex(biomeBase, '#ff8a3a', 0.4)` crossing the tile (ember-filled cracks in dark stone) |
| Drowned Halls | Vertical rivulet streaks | 1px vertical lines in `shade(biomeBase, 1.15)` (water-stained tile with running water marks) |
| Gear Sanctum | Riveted metal plates | 2×2 corner dots (`shade(biomeBase, 0.5)`) + a heavy 2px top edge band (industrial plating) |
| Heart Vault | Veined crystal lattice | X-bracing (`shade(biomeBase, 1.2)` diagonals corner-to-corner) + a small diamond outline at tile center |

**Color derivation per biome.** Each biome has a base hue. Derive fill/highlight/shadow/outline from the base via `shade`, never pure black:

```ts
const biomeBase    = shade(zoneColor, 0.6);   // base fill
const biomeHigh    = shade(zoneColor, 0.8);   // exposed N/W edges
const biomeShadow  = shade(zoneColor, 0.35);  // exposed S/E edges
const biomeOutline = shade(zoneColor, 0.15);  // external edges only — NEVER '#000000'
```

Zone colors per biome are in §8.5 (one per biome, distinct enough that two adjacent-depth rooms of different biomes read as different places).

**Gate:** a five-motif sample sheet (one 320×240 screenshot per biome motif) must be produced and reviewed before biome integration. No biome is accepted based on unit tests alone.

### 8.5 Biome Specifications — Detailed

Each biome is a generator module. The generator pulls from its biome's design contract — silhouette, motif, palette, hazard mix, enemy roster — using the per-depth seed.

#### 8.5.1 Ash Ruins (depths 0–3) — Onboarding Tier

- **Arc / role in the descent:** Safe onboarding. Teaches walk, jump, gap-crossing, and the basic enemy roster before any hazard set-piece appears.
- **Depth range:** depths 0, 1, 2, 3 (4 rooms).
- **Layout concept:** Wide flat floors with gentle 1–2 tile gaps. Low ceilings (room for jumping but no tall vertical chambers). Platforms are large and forgiving. Sparse coin trails guide the player toward the exit. The exit door at the south is reachable without advanced movement.
- **Unique silhouette:** Wide horizontal mass with shallow vertical variation. Floor-led geometry dominates. No tall pillars, no large open chambers — visually reads as "tutorial ruins."
- **Hazard mix:** Gentle gaps only. **Banned:** lava, water, spike-traps, all mechanical hazards. The biome is genuinely safe — failure here is a fall into a pit, not death by hazard.
- **Enemy roster:**
  - **Required:** Walker (1–2 per room).
  - **Optional:** Hopper (0–1 per room).
  - **Banned:** All other 11 types.
  - Min 1, max 3 enemies per room.
- **Visual motif:** Horizontal mortar lines (2px stripes mid-tile).
- **Palette derivation:** Zone color `#8a7a68` (warm grey). Base `#5a4f43`, highlight `#786a5a`, shadow `#342e27`, outline `#17140f`.
- **Music emphasis:** Sparse. Low lead motif only, no busy percussion. (When the music pillar is adopted: ambient drone, occasional low note.)

#### 8.5.2 Ember Caverns (depths 4–7) — Lava Showcase

- **Arc / role in the descent:** Introduces instant-death terrain. The biome where §7's lava set-piece lives — Gerstner surface, LAVA_FIRE/LAVA_SMOKE emitters, ambient glow, lava-bubble enemies.
- **Depth range:** depths 4, 5, 6, 7 (4 rooms).
- **Layout concept:** Volcanic caverns. **Every room has a mandatory lava pool** (≥4 tiles wide, ≥2 tiles deep) occupying the lower third. Platforms are narrow stone ledges above the lava. Vertical bias is moderate — the player hops between ledges over the molten surface. Some rooms have rising/falling lava level via a per-depth phase.
- **Unique silhouette:** A glowing orange-red mass at the bottom of the room, narrow dark ledges above it. The lava emitter glow dominates the lower screen. Visually reads as "the hot biome" from the first frame.
- **Hazard mix:**
  - **Required:** Lava pool (≥1 per room, Gerstner surface + LAVA_FIRE_PARTICLES + LAVA_SMOKE_PARTICLES + drawGlow).
  - **Optional:** Spike-trap (0–2 per room, on stone ledges).
  - **Banned:** Water sections, all mechanical-tier hazards (saw/mace/crusher/laser).
- **Enemy roster:**
  - **Required:** Lava-bubble (1–2 per room, emerging from the mandatory pool).
  - **Optional:** Flyer (0–1 per room), Hopper (0–1 per room).
  - **Banned:** Walker (the caverns are too hostile for ground patrols), Swimmer, Spitter, all mechanical tier.
  - Min 2, max 5 enemies per room.
- **Visual motif:** Cracked obsidian with thin orange ember veins (1px diagonal lines in `mixHex(biomeBase, '#ff8a3a', 0.4)`).
- **Palette derivation:** Zone color `#8a3a2a` (deep red-ochre). Base `#5a2419`, highlight `#78301f`, shadow `#34150e`, outline `#170805`.
- **Music emphasis:** Driving. Busier percussion (imagined conga / tom pulse), mid-register lead. The heat gets a beat.

#### 8.5.3 Drowned Halls (depths 8–11) — Water Showcase

- **Arc / role in the descent:** Introduces the buoyancy modifier. The biome where §6's water set-piece lives — floaty physics, splash on entry, bubble ambience, swimmers.
- **Depth range:** depths 8, 9, 10, 11 (4 rooms).
- **Layout concept:** Flooded halls. **Every room has a mandatory water section** (≥6 tiles wide, ≥3 tiles deep) with a wave-line surface. Architecture is taller than other biomes — the player swims up through flooded chambers and emerges onto dry ledges. Alcoves in the walls hold spitters. Horizontal bias low; vertical bias high.
- **Unique silhouette:** A translucent teal-blue mass occupying the lower half of the room with a visible ripple surface. Vertical pillars break the water into chambers. Visually reads as "the wet biome."
- **Hazard mix:**
  - **Required:** Water section (≥1 per room, wave-line surface + WATER_BUBBLE_PARTICLES + splash + underwater tint + buoyancy config).
  - **Optional:** Spike-trap (0–1 per room, on dry ledges only).
  - **Banned:** Lava pools (water and lava never coexist), all mechanical-tier hazards.
- **Enemy roster:**
  - **Required:** Swimmer (1–2 per room, in the mandatory water), Spitter (1–2 per room, in wall alcoves).
  - **Optional:** Flyer (0–1 per room, above the water line).
  - **Banned:** Walker, Hopper, Lava-bubble, all mechanical tier.
  - Min 2, max 5 enemies per room.
- **Visual motif:** Vertical rivulet streaks (1px vertical lines in `shade(biomeBase, 1.15)` — water-stained tile with running marks).
- **Palette derivation:** Zone color `#2a6a8a` (teal-blue). Base `#1a4459`, highlight `#26607a`, shadow `#0f2733`, outline `#071319`.
- **Music emphasis:** Sustained. Pad-like lead, slow arpeggios. The underwater feel gets a wash.

#### 8.5.4 Gear Sanctum (depths 12–15) — Mechanical Tier Showcase

- **Arc / role in the descent:** Introduces timing-based deterministic hazards. The biome where §5's mechanical tier (types 7, 11, 12, 13) is showcased. No organic enemies at all — pure industrial danger.
- **Depth range:** depths 12, 13, 14, 15 (4 rooms).
- **Layout concept:** Tight corridors with mechanical hazards blocking chokepoints. Vertical clearance is low (crusher telegraph must fit). Rooms are smaller and denser than other biomes. Spike-traps on seeded timers guard the floor. Saw-blades patrol horizontal corridors. The biome forces the player to read telegraphs and time movement.
- **Unique silhouette:** Dense mechanical detail — rotating saw-blades, swinging mace chains, ceiling crushers with hazard-stripe faces, laser-turret charge beams. Steel-grey mass with brass accents. Visually reads as "the industrial biome."
- **Hazard mix:**
  - **Required:** Spike-trap (1–2 per room, on seeded timers).
  - **Optional:** Saw-blade path (the corridor patrol).
  - **Banned:** Lava pools, water sections, organic enemies.
- **Enemy roster (mechanical only):**
  - **Required:** Saw-blade (1–2 per room).
  - **Optional:** Spinning mace (0–1), Crusher (0–1), Laser turret (0–1).
  - **Banned:** All 9 organic types (Walker, Hopper, Flyer, Spitter, Chaser, Bouncy slime, Swimmer, Lava-bubble — all absent from this biome).
  - Min 2, max 4 enemies per room (mechanical enemies are individually dangerous; density is lower).
- **Visual motif:** Riveted metal plates (2×2 corner dots + heavy 2px top edge band in `shade(biomeBase, 0.5)`).
- **Palette derivation:** Zone color `#7a7a8a` (steel grey) with brass accent `#8a7a4a`. Base `#4d4d57`, highlight `#6e6e7c`, shadow `#2d2d33`, outline `#16161a`.
- **Music emphasis:** Mechanical. Staccato percussion, metallic SFX bleeding into the lead. Tick-tock feel.

#### 8.5.5 Heart Vault (depths 16+) — Escalation Finale

- **Arc / role in the descent:** The finale. Mixed roster from all four prior biomes — escalation. Tighter spaces, denser hazards, spike clusters. Optional boss room (§16 stretch goal, pulled forward as the biome's set-piece).
- **Depth range:** depths 16, 17, 18, … (the descent continues; Heart Vault recurs with escalating density until the player quits or reaches a boss room).
- **Layout concept:** Cramped chambers with overlapping hazards. Spike clusters (3+ adjacent spike-traps) guard chokepoints. Mixed-tier enemies force the player to apply every skill learned in the prior four biomes. Rooms are the smallest in the game — tight tolerances, fair but demanding.
- **Unique silhouette:** Visually the densest — crystal veins (motif), spike clusters, mixed enemy types, purple-amber lighting. Visually reads as "the final biome."
- **Hazard mix:**
  - **Required:** Spike clusters (≥1 cluster of 3+ spike-traps per room).
  - **Optional:** Lava pool (0–1, smaller than Ember Caverns), water section (0–1, smaller than Drowned Halls), saw-blade path.
  - **Banned:** Nothing. The finale tier throws everything.
- **Enemy roster (mixed escalation):**
  - **Required:** ≥4 enemies per room drawn from any of the 13 types.
  - **Optional:** Any of the 13.
  - **Banned:** Nothing.
  - Min 4, max 8 enemies per room.
- **Visual motif:** Veined crystal lattice (X-bracing `shade(biomeBase, 1.2)` diagonals + diamond center outline).
- **Palette derivation:** Zone color `#6a3a8a` (purple) with amber accent `#b08a3a`. Base `#44255a`, highlight `#62357c`, shadow `#271433`, outline `#11081a`.
- **Music emphasis:** Climactic. Full lead + busy percussion + descending bassline. The descent reaches its musical peak.

### 8.6 Coins, Parallax, Moving Gaps

- **Coins:** `outlineRect` diamonds in `palette.feature` with a `drawGlow`; on collect, a `spawn` sparkle burst + `audio.playTone` ping. Coin placement is per-biome: Ash Ruins gets generous coin trails; Ember Caverns coins sit on lava-skim ledges; Drowned Halls coins sit just under the water surface; Gear Sanctum coins sit behind crusher/saw timing windows; Heart Vault coins are clustered behind spike-trap timing puzzles.
- **Parallax background:** 3 layers via `drawTiledParallax` at depth factors 0.15 / 0.4 / 0.75, each a procedurally-drawn tile (no art). **Per-biome background:** distant silhouettes (Ash Ruins = broken columns, Ember Caverns = distant magma glow, Drowned Halls = flooded archways, Gear Sanctum = pipe geometry, Heart Vault = crystal outcroppings). Palette from `generatePalette(biomeSeed)` so each biome has a cohesive hue that matches §8.4's zone color.
- **Moving gaps:** `advanceGapMotion` + `gapSolids` model a traveling hole in an otherwise static span. The returned span fragments are collision solids, but they are not rideable moving platforms and provide no carry displacement. Use level `movingPlatform` entities with the platformer runtime's displacement provider when the player must ride moving geometry. (Embertomb drives collision directly per §8.3, so moving platforms are consumer-local Mover entities stepped in the fixed `step` and merged into the per-axis resolver query.)

---

## 9. Game Feel Checklist (the juice — every item uses the engine)

- [ ] Launch stretch + landing squash (`volumeScale`)
- [ ] Hit-stop on hard landings and enemy stomps (`triggerHitStop`)
- [ ] Screen shake on impacts (`sineShake` + `shakeEnvelope`, decaying envelope)
- [ ] Phase-synced footstep taps (`advanceFootPlant`)
- [ ] Dust on every footplant + on landings (`spawn`)
- [ ] Coyote time + jump buffer from `advanceJump` / `JumpState`; do not duplicate them in consumer state.
- [ ] Spring-rod tail/hair lag on the player (`advanceSpringRod`, never the raw `advanceSpringChain`)
- [ ] Reduced-motion gate (`prefersReducedMotion`) that renders one static frame

---

## 10. Audio (all synthesized via `createAudioAdapter`)

Unlock on first user gesture (one-shot `keydown`/`pointerdown` listener calling `audio.unlock()`). Then:
- **Footsteps:** `playNoise(40, 'lowpass', 200, 0.12)` per `advanceFootPlant` event.
- **Jump:** `playTone('sine', 200, 400, 80, 0.2)` (upward "boing").
- **Land:** `playNoise(80, 'lowpass', 300, 0.3)` (hard) / `playNoise(50, 'lowpass', 250, 0.18)` (soft), scaled by impact.
- **Coin:** `playTone('triangle', 600, 1200, 60, 0.15)`.
- **Hurt:** `playNoise(120, 'lowpass', 400, 0.3)`.
- **Lava hiss / water splash / enemy deaths:** distinct `playNoise`/`playTone` recipes.
- **Biome entry sting:** one distinct `playTone` arpeggio per biome (5 total) on first entry — sells the biome change.

---

## 11. Visual & Play Gates

### 11.1 Screenshot Requirements

Before any biome is accepted as complete:

1. **One 320×240 screenshot per biome** — five screenshots total (Ash Ruins, Ember Caverns, Drowned Halls, Gear Sanctum, Heart Vault). Each must show the biome's mandatory hazards (Ember Caverns = visible lava pool + emitters; Drowned Halls = visible water section; Gear Sanctum = visible mechanical enemy).
2. **Contact sheet** — all five biome screenshots in one image, side by side, so the visual identity differences are legible at a glance.
3. **Benchmarker / vision review** — the screenshots must show distinct visual identities (motif, palette, silhouette). If two biomes look interchangeable, the build is rejected.
4. **No biome accepted based only on unit tests.** Structural tests prove data correctness, not visual quality.

### 11.2 Playthrough Requirements

- **Full descent playthrough** — depths 0 through 16+ (all five biomes) must be completable in sequence.
- **Manual playtest targets:**
  - First full descent to depth 16: 8–14 minutes (includes learning biome-specific hazards).
  - Expected deaths: 6–14 (2–3 per showcase biome as the player learns the new set-piece).
  - Fast post-death restart: <1.5 seconds from death to controllable respawn at the same depth's spawn.
- **Per-biome playtest targets:**
  - Ash Ruins: 0–1 deaths (onboarding tier — should be nearly free).
  - Ember Caverns: 1–3 deaths (lava is unforgiving).
  - Drowned Halls: 1–3 deaths (buoyancy takes adjustment).
  - Gear Sanctum: 2–4 deaths (timing windows are tight).
  - Heart Vault: 2–4 deaths (escalation tier — densest rooms).

### 11.3 Rejection Criteria

The following are grounds for rejecting the build:

- **Two biomes look identical.** If the Ash Ruins and Gear Sanctum screenshots are visually indistinguishable, the connected-terrain motifs and palettes have failed. Each biome must read as a different place.
- **Lava looking the same everywhere.** Every Ember Caverns room must have a lava pool — but every lava pool must use the tuned presets, not invented params. Flat fire / off-screen sparks = reject.
- **Water with no swimmers.** Drowned Halls rooms must have at least one Swimmer enemy in the water. Empty water is a failure.
- **Mechanical tier missing entirely.** The Gear Sanctum biome must use at least 2 of the 4 mechanical-tier enemies (saw-blade, spinning mace, crusher, laser turret). A Gear Sanctum with only spike-traps is a failure.
- **Only 2–3 of the 13 enemies ever appearing.** Across the full descent, at least 7 of the 13 enemy types must appear (acceptance criterion §12.3). The biome rosters in §8.5 mandate which types appear where — follow them.
- **Empty space without gameplay.** Rooms with large dead areas that don't contribute to platforming, hazard navigation, or enemy encounters.
- **Procedural mush.** If the player cannot tell which biome they're in within 2 seconds of entering a room, the visual identity system has failed.
- **Screenshot only of Ash Ruins.** Must show all five biomes.
- **A flat tile renderer.** The connected-terrain renderer with neighbor bitmasking is mandatory. Falling back to flat `outlineRect` per solid tile is the failure mode this brief exists to prevent.

---

## 12. Tests & Static Contracts

### 12.1 Tile Schema

- Each generated room's grid passes `createTileQuery` without throwing.
- Each room has exactly one spawn point and exactly one exit door at the south edge.
- Each room's biome matches `biomeForDepth(depth)` from §8.2.

### 12.2 Biome Content Counts

The generator must respect these per-biome contracts. Tests assert them by running the generator for every depth in the biome's range with a fixed `levelSeed` and counting content:

| Biome | Depth range | Min enemies | Max enemies | Mandatory hazards | Banned hazards | Palette seed hue |
|---|---|---|---|---|---|---|
| Ash Ruins | 0–3 | 1 | 3 | (none — gentle gaps only) | lava, water, mechanical | warm grey `#8a7a68` |
| Ember Caverns | 4–7 | 2 | 5 | lava pool (≥1 per room) | water, mechanical tier | red-ochre `#8a3a2a` |
| Drowned Halls | 8–11 | 2 | 5 | water section (≥1 per room) | lava, mechanical tier | teal `#2a6a8a` |
| Gear Sanctum | 12–15 | 2 | 4 | spike-trap (timed) | lava, water, organic enemies | steel grey `#7a7a8a` |
| Heart Vault | 16+ | 4 | 8 | spike cluster (≥1 of 3+) | (none — escalation tier) | purple `#6a3a8a` |

### 12.3 Enemy Variety Across the Descent

- Across depths 0–16 (the five-biome vertical slice), at least **7 of the 13 enemy types** must appear.
- At least **2 from the mechanical tier** (saw-blade / spinning mace / crusher / laser turret) must appear in the Gear Sanctum biome (depths 12–15).
- No biome may spawn an enemy type marked **Banned** in its §8.5 roster.

### 12.4 Set-Piece Coverage

- A **water section** (floaty physics, splash on entry, animated surface, ≥1 Swimmer) appears in every Drowned Halls room.
- A **lava pool** (Gerstner surface, LAVA_FIRE_PARTICLES + LAVA_SMOKE_PARTICLES emitters, glow, damage, ≥1 Lava-bubble) appears in every Ember Caverns room.

### 12.5 Biome Unique Hashes

- For each biome, generate one representative room and compute `fnv1a` over the canonicalized tile data (e.g. `fnv1a(grid.flat().join(','))`).
- All five biome hashes must be distinct (proves the 5 motifs / palettes produce visually distinct rooms — not the same data with a label swap).
- Hashes must be stable across runs (same `levelSeed` → same hash, byte-identical forever).

### 12.6 Simulation Determinism

- Run 600 ticks of `stepGame` for a fixed depth with fixed inputs. Record final state (player position, enemy positions, hazard states).
- Re-run. Final state must be byte-identical.
- Same `levelSeed` → same descent through all five biomes on every run, every reload, every machine.

### 12.7 Player Feel Contracts

- **No moonwalk.** Walking left faces left in both the player and every locomotion-driven enemy (walker, chaser). Playtest: hold ←/A — the character's face + feet must point left. (Enforced by the `ctx.scale(facing, 1)` mirror around the body draw, §4.)
- **No tail/appendage blow-out.** Every Verlet strand (player tail, flyer trail, slime antenna, swimmer body) uses `advanceSpringRod`, never the raw `advanceSpringChain`. Grep for `advanceSpringChain` in appendage code — it must not appear there. (The rod is blowout-proof; the raw chain is not — Embertomb had a swimmer node stroked across the whole viewport.)
- **Lava uses the presets.** Grep for `LAVA_FIRE_PARTICLES` / `LAVA_SMOKE_PARTICLES` in the lava setup — the tuned recipe must be used, not invented params.

### 12.8 Forbidden Patterns

Static analysis (grep / AST) must find:

- **No `requestAnimationFrame`** in game code (only in the engine's `createGameLoop`).
- **No `Math.random`** in game code.
- **No `Date.now`** in game code (except in daily-seed selection if implemented — and only there).
- **No manual gravity integration** (no `vy += gravity * dt` outside the engine's `advanceJump`).
- **No `advanceSpringChain`** in appendage code (use `advanceSpringRod`).
- **No deep imports** (no `aicraft-engine/src/...` — only root barrel).
- **No flat `outlineRect` per solid tile** in the tile renderer (must use the connected-terrain renderer from §8.4).
- **No second nested row/column tile traversal** alongside `drawTileGrid` (the `drawTile` callback owns per-tile appearance; `drawTileGrid` owns traversal).

### 12.9 Reduced-Motion Gate

- `prefersReducedMotion()` returns true → render exactly one static frame, never call `loop.start()`, never create an audio adapter.

### 12.10 End-to-End Descent Tests (Where Practical)

Scripted input sequences that drive the player from depth 0 through depth 16 (one room per biome: depth 0, 4, 8, 12, 16). These are NOT proof of fun — they prove the descent is mechanically possible and that biome transitions don't strand the player. Use replay recording if available, or hardcode a sequence of `InputEdges` per tick per biome. Each biome's scripted route should pass through the biome's mandatory set-piece (lava pool dodge in Ember Caverns, water-section swim in Drowned Halls, mechanical timing window in Gear Sanctum).

---

## 13. Preserved Constraints

- **Reduced-motion early gate** — `prefersReducedMotion()` checked before audio setup; renders one static frame; creates no audio adapter or loop.
- **Touch + keyboard input** — `createKeyboardAdapter` + `createTouchButtonSet` + `orEdges`. On-screen touch buttons appear on coarse-pointer devices.
- **DPR / pixel scaling** — `resizeCanvasToBackingStore` + `ctx.setTransform(dpr, ...)`.
- **Fixed-step sim** — `createGameLoop({ fixedDt: 1/60 })`. Input polled exactly once per step.
- **No `Math.random` / `Date.now` in the sim** — seeded `mulberry32` only.
- **Spring rod over raw chain** — every Verlet appendage uses `advanceSpringRod`, never `advanceSpringChain`.
- **Single vertical-velocity path** — `jumpState.vy` is the only vertical velocity; water modifies the `JumpConfig`, it does not write a second swim velocity.
- **Lava presets, not invented params** — `LAVA_FIRE_PARTICLES` / `LAVA_SMOKE_PARTICLES` / `WATER_BUBBLE_PARTICLES` spread into `createEmitter`, only `region`/`rng` overridden.
- **Connected-terrain renderer** — the §8.4 neighbor-bitmask renderer is the only tile-render path. Flat `outlineRect` per solid tile is forbidden.
- **Five-biome contract** — `biomeForDepth(depth)` is the law; biome order is fixed (Ash → Ember → Drowned → Gear → Heart). Do not randomize biome order.
- **Zero runtime deps** — `aicraft-engine` is the only dependency.

---

## 14. Install & Version

```bash
npm install aicraft-engine@0.15.0
```

`aicraft-engine@0.15.0` is published and stable. Do not pin below `0.15.0`. The brief targets the published `0.15.0` API exactly — the per-axis collision resolver (`resolveAxisX`/`resolveTileX`/etc.), the ratified emitter presets (`LAVA_FIRE_PARTICLES` / `LAVA_SMOKE_PARTICLES` / `WATER_BUBBLE_PARTICLES`), the wave-line surfaces (`generateWaveLine` + `DEFAULT_GERSTNER` / `DEFAULT_WAVE_LINE`), the locomotion / foot-plant / jump / spring-rod animation primitives, and the `shade`/`mixHex`/`fnv1a` helpers used by the connected-terrain renderer and biome unique-hash tests.

---

## 15. Implementation Workflow

Build in this order. Each stage must pass its gate before the next begins.

### Stage 1: Terrain Prototype + 5-Motif Sample Sheet

1. Set up Vite + TypeScript + `aicraft-engine@0.15.0`.
2. Implement the connected-terrain renderer (`tile-style.ts`) per §8.4 — neighbor bitmask, fill/highlight/shadow/outline, and all five biome motifs (mortar lines, ember veins, rivulet streaks, riveted plates, crystal lattice).
3. Generate one hand-crafted test room per biome (a fixed tile grid, not procedurally generated yet) wired to its motif + palette.
4. Produce a five-style sample sheet (one 320×240 screenshot per biome motif).
5. **Gate:** Visual review confirms five distinct biomes. No two biomes look the same. The biome of each screenshot is identifiable at a glance.

### Stage 2: Biome Design Review

1. Lock the per-biome design contracts from §8.5 (silhouette, motif, palette, hazard mix, enemy roster) into the generator's type system.
2. Write the `biomeForDepth(depth)` selector and the per-depth seed mixer.
3. **Gate:** Biome specs reviewed for escalation arc (gentle → showcase × 3 → finale), distinct silhouettes, and the mandatory set-pieces (lava in Ember, water in Drowned, mechanical in Gear).

### Stage 3: Procedural Generator (Per-Biome Generator Modules)

1. Implement the procedural room generator — one generator module per biome, each pulling from its design contract via `mulberry32(depthSeed)`.
2. Each generator places platforms, gaps, hazards, enemy spawns, coins, and the exit door using `nextInt`/`nextFloat`/`pick`.
3. Validate: same `levelSeed` + same depth → byte-identical room.
4. Compute biome unique hashes — all five must be distinct.
5. **Gate:** Generator determinism verified. Five distinct biome hashes. Each generated room's content matches its biome's §12.2 content-counts table.

### Stage 4: Graybox Mechanics Per Biome

1. Wire the game loop, input, per-axis collision resolver.
2. Add biome transitions (exit door → next depth → biome re-select).
3. Implement the player feel loop (jump, locomotion, footstep audio, squash/stretch, hit-stop, screen shake, dust).
4. Wire the water set-piece (§6) for Drowned Halls rooms.
5. Wire the lava set-piece (§7) for Ember Caverns rooms.
6. Implement the mechanical-tier enemies (saw-blade, spinning mace, crusher, laser turret) for Gear Sanctum rooms.
7. **Gate:** All five biomes are playable end-to-end from depth 0 to depth 16. Each biome's mandatory set-piece works. Death + respawn cycle works.

### Stage 5: Playtest Per Biome

1. Playtest each biome individually. Tune enemy density, hazard timing, platform spacing per the §11.2 per-biome death targets.
2. Verify the onboarding tier (Ash Ruins) is nearly free (0–1 deaths).
3. Verify the showcase biomes (Ember, Drowned, Gear) each teach their set-piece fairly.
4. Verify the finale (Heart Vault) escalates without being unfair.
5. **Gate:** 8–14 minute first descent to depth 16, 6–14 expected deaths, <1.5s restart.

### Stage 6: Polish

1. Add particles (dust, splashes, ember bursts, death bursts, coin sparkles).
2. Add screen shake on impacts.
3. Add hit-stop on hard landings and stomps.
4. Add biome-entry sting arpeggios (5 total).
5. Add per-biome parallax background tiles.
6. Add HUD (depth counter, biome name on entry, coin total, reduced-motion hint).
7. **Gate:** Game feel matches Sokpop-meets-Celeste — chunky, juicy, readable.

### Stage 7: All-Biome Screenshots + Vision Review

1. Capture full 320×240 screenshots of all five biomes (one representative room each).
2. Capture a contact sheet (all five biomes side by side).
3. **Gate:** Vision review confirms distinct visual identities, readable hazards, and no two biomes looking the same. The biome of each screenshot is identifiable without reading the HUD.

### Stage 8: Verification

1. Run all static contracts (§12) — content counts, unique hashes, determinism, forbidden patterns, E2E descent.
2. Grep for forbidden patterns (`requestAnimationFrame`, `Math.random` in step, `advanceSpringChain` in appendages, flat `outlineRect` per tile, deep imports).
3. **Gate:** All tests pass. No forbidden patterns found. Five-biome vertical slice is playable and visually distinct.

---

## 16. Anti-Failure Wording

**This build is NOT complete merely because a procedural generator produces valid tile grids for five biome labels.** The previous Flipside implementation produced six valid rooms and was still a failure because every room looked identical. Embertomb's generator risks the same failure: without the explicit biome contracts in §8.5 and the connected-terrain renderer in §8.4, a `mulberry32`-driven generator produces procedural mush. The following failure modes are explicit grounds for rejection:

- **A biome label is not a visual identity.** Calling a room "Ember Caverns" does not make it look different from "Ash Ruins." The connected-terrain motif (§8.4) and the palette derivation (§8.5 per-biome) do that work. If two biomes share a motif or a palette, the build is rejected.
- **Lava looking the same everywhere is a failure.** Every Ember Caverns room must have a lava pool — and every pool must use the tuned `LAVA_FIRE_PARTICLES` / `LAVA_SMOKE_PARTICLES` presets, not invented params. Embertomb invented mediocre emitter params once and the lava looked terrible. The presets exist precisely to prevent this. Spread the preset, override only `region`/`rng`.
- **Water with no swimmers is a failure.** Drowned Halls rooms must have at least one Swimmer enemy in the water. An empty water section is decorative set-dressing, not gameplay — the swimmer is what makes the buoyancy modifier matter.
- **The mechanical tier missing entirely is a failure.** The Gear Sanctum biome (depths 12–15) is the showcase for enemy types 7, 11, 12, 13 (saw-blade, spinning mace, crusher, laser turret). A Gear Sanctum with only spike-traps wastes the entire mechanical tier. At least 2 of the 4 mechanical types must appear.
- **Only 2–3 of the 13 enemies ever appearing is a failure.** The bestiary exists to be used. The biome rosters in §8.5 mandate which types appear where — follow them. Across the descent, at least 7 of 13 must appear (§12.3).
- **A flat tile renderer is a failure.** The previous Embertomb rendered every solid tile as a flat `outlineRect(ctx, x, y, tileSize, tileSize, palette.background, palette.outline)` — visually identical across the entire descent. The §8.4 connected-terrain renderer with neighbor bitmasking and per-biome motifs is mandatory. Falling back to flat `outlineRect` is the failure mode this brief exists to prevent.
- **A screenshot only of Ash Ruins is insufficient.** All five biomes must be screenshot-reviewed for distinct visual identity.
- **Procedural determinism broken is a failure.** Same `levelSeed` must produce the same descent on every run, every reload, every machine. If the generator ever non-deterministically picks biome order, enemy spawns, or hazard positions, the build is rejected.
- **A second vertical-velocity path is a failure.** Water modifies the `JumpConfig` passed to the same `advanceJump` call — it does not write a second swim velocity. Two integrators drift apart and break replay-perfect determinism.

---

## 17. Stretch Goals (only after §12 acceptance criteria pass)

- `cosmetics` + `iap` modules: unlockable seeded character skins via a dev/local-storage IAP adapter.
- `save` storage: depth reached + coin total persist across reloads.
- **A boss** that combines flyer + spitter + lava-bubble phases. Pulled forward as the Heart Vault (§8.5.5) set-piece — the biome that hosts the boss if/when implemented.
- Daily-seed mode (`Date.now()` → day bucket → seed; here `Date.now` is acceptable because it's *selecting* a seed, not driving the sim).
- `music` pillar adoption: the per-biome "music emphasis" notes in §8.5 become real `advanceSequencer` + `createNoteFirePlayer` patterns (one per biome, escalating in density from Ash Ruins's sparse drone to Heart Vault's climactic full-lead).

---

## 18. File Layout (Suggested)

```
src/
  main.ts                  # boot: canvas, store, loop.start()
  game/
    state.ts               # World, Player, Enemy, Particle[] state shapes
    step.ts                # the fixed-step: input → physics → AI → collisions → audio
    render.ts              # pure draw: parallax, tiles (connected terrain), water, lava, entities, FX
    biomes.ts              # biomeForDepth selector + biome design contracts (§8.5)
    generator.ts           # mulberry32-seeded room generator dispatching to per-biome generators
    biomes/
      ash-ruins.ts         # Ash Ruins generator (depths 0–3)
      ember-caverns.ts     # Ember Caverns generator (depths 4–7) + mandatory lava pool
      drowned-halls.ts     # Drowned Halls generator (depths 8–11) + mandatory water section
      gear-sanctum.ts      # Gear Sanctum generator (depths 12–15) + mechanical tier
      heart-vault.ts       # Heart Vault generator (depths 16+) + escalation + boss stretch
    enemies.ts             # the 13 enemy types (each: step AI + render) + biome roster filter
    player.ts              # player step + render (locomotion/jump/squash/feet)
    water.ts lava.ts       # surface + emitters + physics hooks (the §6 and §7 set-pieces)
    tile-style.ts          # connected-terrain renderer (neighbor bitmask, 5 motifs, shade/mixHex)
  input.ts                 # createKeyboardAdapter + createTouchButtonSet + orEdges
  audio.ts                 # createAudioAdapter + the SFX recipe helpers + biome-entry stings
```

---

## 19. Summary of Key Changes from Previous Brief

This brief is expanded to preempt the failure modes the recent Flipside rewrite addressed. Embertomb had not yet failed, but its previous 303-line form had the same structural weaknesses that produced Flipside's bland, unfun game: a procedural generator with no specified variety, a flat tile renderer with no visual identity system, no per-biome design contracts, and no visual review gates. The table below summarizes the structural additions.

| Aspect | Previous (303-line) | This brief |
|---|---|---|
| World design | One undifferentiated procedural stream of rooms | Five explicit biome archetypes (Ash / Ember / Drowned / Gear / Heart) with full design contracts |
| Biome selection | Implicit / random per room | `biomeForDepth(depth)` — fixed escalation order, deterministic per-depth seed |
| Tile rendering | Flat `outlineRect` per solid tile | Connected-terrain renderer (neighbor bitmask + 5 biome motifs + shade/mixHex palettes) |
| Visual identity | One shared palette per level | Per-biome zone color → base/highlight/shadow/outline derivation; 5 distinct motifs |
| Lava | One set-piece, params could be invented | Mandatory in every Ember Caverns room; `LAVA_FIRE_PARTICLES`/`LAVA_SMOKE_PARTICLES` presets enforced (no invented params) |
| Water | One set-piece, optional | Mandatory in every Drowned Halls room; ≥1 Swimmer enemy per room |
| Mechanical tier | Listed in bestiary but unplaced | Gear Sanctum biome (depths 12–15) showcases types 7, 11, 12, 13; ≥2 of 4 mandatory |
| Enemy placement | "At least 7 of 13 across first few levels" | Per-biome rosters in §8.5 with required/optional/banned lists and min/max counts |
| Visual review | Unit tests only | 5-biome screenshot sample sheet + contact sheet + vision review gate (§11.1, §15 Stage 1 & Stage 7) |
| Anti-failure wording | None | Explicit §16 listing 9 failure modes (procedural mush, lava-looking-the-same, water-without-swimmers, missing mechanical tier, flat tile renderer, broken determinism, second velocity path, etc.) |
| Implementation workflow | Single build-order suggestion | 8-stage workflow with per-stage gates (§15) |
| Static contracts | 12 acceptance criteria | Expanded §12 with biome content-counts table, biome unique hashes (`fnv1a`), simulation determinism, forbidden patterns, E2E descent tests across 5 biomes |
| Prior-failure callout | None | §0 names the Flipside failure explicitly and frames Embertomb's expansion as preemption |
| File layout | 7 files | Per-biome generator modules under `game/biomes/` + dedicated `tile-style.ts` + `biomes.ts` contract file |
| Length | 303 lines | ~830 lines (matches Flipside's depth) |

---

**Build order:** terrain prototype + 5-motif sample sheet → biome design review → procedural generator → graybox mechanics per biome → playtest per biome → polish → all-biome screenshots + vision review → verification.

**The game is not done when the code compiles. It is done when five visually distinct biomes are playable in sequence, each biome is recognizable at a glance from its motif and palette, every showcase biome delivers its mandatory set-piece (lava in Ember, water + swimmer in Drowned, ≥2 mechanical-tier enemies in Gear), and a human player can descend from depth 0 to depth 16 in 8–14 minutes on their first try.**
