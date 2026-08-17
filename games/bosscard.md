# Bosscard — A Three-Phase Bullet-Hell Boss Fight on `aicraft-engine@0.17.3`

> Paste this entire document to a coding agent (Claude / Cursor / etc.). It is a complete, self-contained build brief: concept, architecture, exact data contracts, the centerpiece custom boss behavior code, per-phase specs, ASCII timeline, implementation stages, acceptance gates, and anti-shortcut checks. The agent should produce a single runnable Vite + TypeScript browser game that imports everything from `aicraft-engine` (the npm package) and writes **no** re-implementations of what the engine already provides.

---

## 0. What You Are Building

**Bosscard** — a *Cuphead* homage crammed onto one screen. A screen-filling cartoon boss cycles three phases — **radial bullet ring → spiral bullets → aimed stream** — while a chunky cup-headed hero runs, jumps, and dashes around a small arena, parrying pink projectiles and smashing into the boss body to deal damage. Three player hits = death; deplete the boss HP bar = win. ~3–4 minutes of tight, fair, juicy gameplay. The feel target is **1930s-cartoon-meets-Sokpop**: chunky vector outlines, screen-shake on every hit, hit-stop on every hit, a boss drawn from multiple animated `outlineRect` parts with a `drawGlow` aura that shifts colour per phase.

**This is NOT a tech demo.** It is a designed boss fight with three distinct phases, each with its own bullet-pattern rhythm, its own telegraph, its own visual identity (aura colour + boss pose), and its own difficulty target. The previous version of this brief had the boss behavior code right but only a one-line-per-phase table — agents produced bullet soup with no phase identity. This brief fixes that by specifying the **feel** of each phase, the intro animation, the inter-phase transition layer (the Cuphead mercy mechanic of dropping heal coins), and a screenshot gate per phase.

**Non-negotiable: build the entire game on top of `aicraft-engine@0.17.3`.** Do not hand-roll fixed-step loops, AABB collision, bullet velocity math, cameras, palettes, particles, or audio — those are all in the engine. If you find yourself writing `Math.cos(angle) * speed` to spawn a bullet, a `requestAnimationFrame` accumulator, a manual AABB resolver, or `Math.random()` in the simulation, STOP and use the engine instead. The whole point of Bosscard is to show off two things Embertomb / Celerock / World 1-1 only hint at: **(a)** a *custom* boss behavior plugged into `createEnemyBehaviorRegistry` (the registry is not limited to the shipped `spinny`/`spider`/`turret` archetypes), and **(b)** `sampleConeVelocity` as the canonical bullet-hell pattern helper.

---

## 1. Tech Stack & Install

```bash
npm create vite@latest bosscard -- --template vanilla-ts
cd bosscard
npm install aicraft-engine@0.17.3
```

> This brief targets the published `0.17.3` API exactly. It was originally written against `0.4.0` and repinned; **every API it names still exists and compiles at `0.17.0`** — the export surface has been additive, so `createEnemyBehaviorRegistry`, the `sampleConeVelocity` bullet patterns, and the cosmetics/IAP surface are all unchanged. (References below to the "0.4.0 `volumeScale` sign" and signed `PlatformerConfig.gravity` are historical provenance — those landed in `0.4.0` and still hold.) **The kernel changed underneath you, and this prompt uses `PRECISION_PLATFORMER`:** `0.14.0` made the wall-jump direction-aware (into-wall slide+jump launches straight up; the away leap now fires from a `wallJumpGraceTime` window), `0.9.2` fixed super-jump grace to seed-once-and-decay, and `0.9.0` added the mantle and a direction-aware climb-jump — all reachable from the arena's walls, so retune the dodge feel against current behavior rather than the `0.4.0` notes. **Compatibility breaks:** the replay physics version is **14** (0.17.0: the collision snap is order-independent nearest-wall/highest-floor, and a spring launch preserves a buffered jump press — v13 replays are rejected) (the §19 share-code stretch cannot match pre-repin hashes), and a manually-constructed `PlatformerState` needs `moments: []`. Worth adopting: `state.moments` (`0.8.0`+) gives you one-shot `dashBonk` moments with a surface normal — a better hit-stop trigger than inferring contact from the dash phase — and `0.13.0`'s `startNoiseLoop` is the right shape for sustained boss-phase drones.

- **TypeScript**, strict. Target ES2021, `moduleResolution: bundler` (matches the engine; Vite resolves its ESM fine).
- **Vite** dev server + build. Single `<canvas>` in `index.html`.
- **`aicraft-engine@0.17.3`** is your only runtime dependency. Import from the **root barrel only**:
  ```ts
  import {
    // game-loop + state FSM
    createGameLoop, DEFAULT_FIXED_DT, advanceAccumulator,
    createGameState, reduceGameState, isLegalTransition, DEFAULT_GAME_STATE_ADJACENCY,

    // input
    createKeyboardAdapter, createTouchButtonSet, createTouchButton, createGamepadAdapter,
    createEdgeAccumulator, pressEdge, releaseEdge, resetEdge, pollEdge, orEdges,

    // ★ platformer kernel — PRECISION feel (Cuphead-tight dodge + dash)
    createPlatformerController, createPlatformerState, stepPlatformer,
    PRECISION_PLATFORMER, defaultPrecisionPipeline, DEFAULT_PLATFORMER_CONFIG,
    DEFAULT_PLAYER_WIDTH, DEFAULT_PLAYER_HEIGHT,
    jumpAbility, wallSlideAbility, dashAbility, doubleJumpAbility,
    compileLevel, drawActor, drawTileGrid, drawLevelEntity, DEFAULT_ENTITY_PALETTE,
    type PlatformerConfig, type PlatformerState, type PlatformerInput,

    // ★★ enemy behavior registry — the boss is a CUSTOM handler
    createEnemyBehaviorRegistry, spinnyBehavior, turretBehavior, spiderBehavior,
    compileEnemies, stepEnemies, drawEnemies, stepProjectile, drawProjectiles,
    type EnemyBehaviorHandler, type EnemyStepResult, type EnemyUpdateContext,
    type EnemyState, type ProjectileState, type CompiledEnemy,

    // collision (hazard / bullet / boss-body AABB)
    aabbOverlap, worldToTile, tileToWorld, tileRect, type TileSolidityQuery,

    // camera (locked single-screen)
    createCamera, updateCamera, DEFAULT_CAMERA,

    // hit-stop + shake (the "every hit freezes" feel)
    createHitStop, triggerHitStop, stepHitStop, isHitStopActive, DEFAULT_HIT_STOP_DURATION,
    sineShake, shakeEnvelope,

    // animation
    volumeScale, breathe, DEFAULT_BREATH,
    advanceLocomotionByDisplacement, evaluateLocomotion, DEFAULT_GAIT,
    blendAirborneTuck, DEFAULT_TUCK,
    drawSimpleFeet, DEFAULT_SIMPLE_FEET,
    createFootPlantState, advanceFootPlant,
    createSpringRod, advanceSpringRod, DEFAULT_SPRING_ROD,

    // ★★ particles — sampleConeVelocity is THE bullet-pattern helper
    spawn, advance as advanceParticles, cull, step as stepParticles,
    sampleConeVelocity, sampleRegion, type ConeConfig,
    createEmitter, stepEmitters, advanceEmission,
    DEFAULT_GRAVITY_SCALE, DEFAULT_DRAG_SCALE,

    // level schema + validation
    migrateLevel, validateLevel, canonicalize, fnv1a,
    type LevelData, type LevelEntity, type TileGrid, type EntityKind,

    // collectibles (heal coins between phases)
    collect, hasCollected, derivePickups, DEFAULT_COLLECTIBLE_RECT,
    type CollectibleSave,

    // save
    createLocalStorageSaveStorage, createMemorySaveStorage,
    loadSave, writeSave, DEFAULT_SAVE_KEY,

    // ★★ cosmetics + iap — three boss skins
    generateSkinVariants, grantSkin, equipSkin, unequipSkin,
    DEFAULT_SKIN_PRESET, DEFAULT_COSMETIC_SAVE, DEFAULT_MANIFEST,
    createMemoryIAPAdapter, createLocalStorageIAPAdapter,
    flushIAPEvents, drainQueue, pushTransaction,
    DEFAULT_IAP_CATALOG, DEFAULT_ENTITLEMENT_SAVE,
    type IAPProduct, type EntitlementSave,

    // vector look + glow + bitmap text + retina + reduced-motion
    outlineRect, lerp, clamp, floor, approach, shade, mixHex, parseHex, toHex, complement,
    drawGlow, DEFAULT_GLOW_INTENSITY,
    createFont, addGlyph, measureText, drawText, drawTextOutlined, DEFAULT_FONT,
    resizeCanvasToBackingStore, getDevicePixelRatio, prefersReducedMotion,

    // easing + tween (phase-transition flash)
    easeOutCubic, easeOutBack, easeOutQuart, powOut,
    createTweenState, advanceTween,

    // audio + rng + palette
    createAudioAdapter, DEFAULT_AUDIO_VOLUME,
    mulberry32, nextInt, nextFloat, pick,
    generatePalette, resolvePalette, repairContrast,
  } from 'aicraft-engine';
  ```
  Tree-shaking works because every export has `sideEffects: false`. Never deep-import subpaths like `aicraft-engine/platformer` — use the root barrel.

---

## 2. Determinism & Discipline Rules (enforced by the engine — follow them)

- **Fixed-step sim, variable render** via `createGameLoop({ fixedDt: 1/60, step, render })`. Poll input **exactly once per `step`**.
- **No `Math.random()` in the simulation.** Use `mulberry32(seed)` → `nextInt` / `nextFloat` / `pick`. The boss's bullet jitter, parry-pink selection, and skin variants all draw from seeded streams. `Math.random` is only OK for purely decorative audio/visual side-effects that never feed back into game state.
- **No `Date.now()` in the sim.** Time comes from `tick` or the loop's `dt`.
- **The boss behavior is PURE.** `step(state, ctx, params) → EnemyStepResult`. No closure over mutable outer state, no `Date.now`, no `Math.random`. The seeded RNG is derived inside the handler from `state.data` (see §6) — `EnemyUpdateContext` deliberately has no `rng` field, so determinism is the handler's responsibility.
- **Defensive host access.** Anything touching `window`/`AudioContext`/`matchMedia`/`localStorage` goes through the engine's adapters (`createAudioAdapter`, `prefersReducedMotion`, `resizeCanvasToBackingStore`, `createLocalStorageIAPAdapter`) — lazy, error-swallowing, no-op in Node.
- **Reduced motion.** Gate the loop: if `prefersReducedMotion()`, render one static frame and never call `loop.start()`.
- **Pure progression ops.** Player HP, boss HP, cosmetics ownership, and entitlements are immutable-in / new-object-out. Never mutate `PlatformerState`, `EnemyState`, `CosmeticSave`, or `EntitlementSave` in place.

---

## 3. Architecture — Engine Module → Game System Map

| Game system | Engine API |
|---|---|
| Game loop (60 Hz fixed) | `createGameLoop`, `DEFAULT_FIXED_DT`, `advanceAccumulator` |
| Frame FSM (intro → playing → gameover / victory) | `createGameState`, `reduceGameState`, `isLegalTransition`, `DEFAULT_GAME_STATE_ADJACENCY` |
| Keyboard / touch / gamepad input, edge merging | `createKeyboardAdapter`, `createTouchButtonSet`, `createGamepadAdapter`, `orEdges` |
| **Hero controller (jump + dash; tight dodge)** | `createPlatformerController`, `stepPlatformer`, `defaultPrecisionPipeline`, `PRECISION_PLATFORMER` — do NOT use `CLASSIC_PLATFORMER` (too loose for bullet-hell) |
| Ability composition (read-mostly; precision pipeline covers jump+dash) | `jumpAbility`, `dashAbility`, `wallSlideAbility`, `doubleJumpAbility` |
| Arena compile (`LevelData` → solids + `tileQuery`) | `compileLevel(level, { tileTypeMap })`, `validateLevel`, `migrateLevel` |
| Tile + entity rendering | `drawTileGrid`, `drawLevelEntity`, `drawActor`, `DEFAULT_ENTITY_PALETTE` (do NOT hand-draw tiles) |
| **★ Boss = custom enemy behavior** | `createEnemyBehaviorRegistry({ boss: myBossBehavior })`, `compileEnemies`, `stepEnemies`, `drawEnemies` |
| **★★ Bullet velocity patterns** | `sampleConeVelocity`, `ConeConfig` — the ONLY public bullet-pattern helper |
| Bullet physics + culling | `stepProjectile` (reuse for the consumer-owned bullet field), `aabbOverlap` for hits |
| Hazard / boss-body / parry AABB | `aabbOverlap` against the hero rect (read from the kernel state) |
| Camera (locked single-screen, clamp to arena) | `createCamera`, `updateCamera`, `DEFAULT_CAMERA` |
| Hit-stop on EVERY hit | `createHitStop`, `triggerHitStop`, `stepHitStop`, `isHitStopActive` |
| Screen shake scaled to boss-HP-missing | `sineShake`, `shakeEnvelope` |
| Hero squash/stretch + breathing | `volumeScale`, `breathe`, `DEFAULT_BREATH` |
| Hero walk cycle (anti-foot-slide) | `advanceLocomotionByDisplacement`, `evaluateLocomotion`, `DEFAULT_GAIT` |
| Hero legs / airborne tuck | `drawSimpleFeet`, `DEFAULT_SIMPLE_FEET`; `blendAirborneTuck`, `DEFAULT_TUCK` |
| Hero straw/hat strand | `createSpringRod`, `advanceSpringRod`, `DEFAULT_SPRING_ROD` (NEVER raw `advanceSpringChain`) |
| Explosion / dust / parry-spark bursts | `spawn`, `advanceParticles`, `cull`, `sampleConeVelocity` |
| Continuous boss-aura emitters | `createEmitter`, `stepEmitters`, `advanceEmission` |
| Boss aura + parry-pink glow + phase-aura colour | `drawGlow`, `DEFAULT_GLOW_INTENSITY` |
| Phase-transition flash + intro card | `createTweenState`, `advanceTween`, `easeOutBack` |
| Chunky vector rendering (the Sokpop-cartoon look) | `outlineRect` |
| HUD (HP hearts, boss HP bar, phase card, FIGHT! card) | `drawText`, `drawTextOutlined`, `DEFAULT_FONT`; `resizeCanvasToBackingStore`, `prefersReducedMotion` |
| Synthesized SFX + phase stingers | `createAudioAdapter` (`playTone`, `playNoise`) |
| Heal coins between phases (the mercy mechanic) | `derivePickups`, `collect`, `hasCollected` |
| Persisted unlocks + progress | `save` (`createLocalStorageSaveStorage`, `loadSave`, `writeSave`) |
| **★★ Three boss skins (cosmetics + IAP)** | `generateSkinVariants`, `grantSkin`, `equipSkin`; `createLocalStorageIAPAdapter`, `pushTransaction`, `flushIAPEvents`, `drainQueue` |
| Deterministic arena/hero/boss theming | `generatePalette`, `resolvePalette`, `repairContrast`, `mulberry32` |

---

## 4. The Hero

A small cup-headed chunk built in **two layers**: physics = the platformer kernel, art = overlay rendering.

- **Physics layer.** `PRECISION_PLATFORMER` is the config (Cuphead-tight: responsive ground speed, snappy dash, no momentum). The engine always runs its built-in `defaultPrecisionPipeline()` internally:
  ```ts
  const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, ...PRECISION_PLATFORMER };
  const controller = createPlatformerController(defaultPrecisionPipeline(), config);
  let pState = createPlatformerState(spawnX, spawnY, config);
  // each fixed tick:
  const { state: next } = controller.step(pState, input, solids, dt);
  pState = next;
  ```
  The kernel owns jump + dash; do not write a second velocity path. `0.4.0` makes `PlatformerConfig.gravity` **signed** and adds optional `jumpEnabled` — Bosscard stays positive-gravity so this is mostly background, but do not assume gravity is a magnitude.
- **Body / face.** Rounded `outlineRect` cup (fill `palette.base`, outline `palette.outline`), two eye dots, a small straw drawn as a `createSpringRod` strand anchored at the lid (`restDirection` up-and-back). Advance the straw OUTSIDE the facing mirror — its physics already own a screen-space direction. Use `advanceSpringRod` (NEVER raw `advanceSpringChain`).
- **`volumeScale` sign (0.4.0 — corrected).** Positive offsets stretch *taller*; negative offsets squash *shorter*. **Launch uses a POSITIVE argument** (`volumeScale(0.08)`), **landing uses a NEGATIVE one** (`volumeScale(-0.08)`). The old `volumeScale(-0.08)`-on-launch convention is wrong in 0.4.0 — do not copy it from older prompts.
- **⚠ Facing mirror (MANDATORY — or you moonwalk):** wrap body+feet+face in `ctx.scale(facing, 1)` around the body's vertical axis:
  ```ts
  ctx.save();
  ctx.translate(bodyCx, bodyBottomY);
  ctx.scale(facing, 1);           // ← do NOT omit
  drawSimpleFeet(ctx, pose, { ...DEFAULT_SIMPLE_FEET, color: palette.base, outline: palette.outline });
  outlineRect(ctx, -w/2, -h, w, h, palette.base, palette.outline);
  // ...eyes/face...
  ctx.restore();
  ```
- **HP.** Consumer-owned (the kernel has no HP). 3 hearts; a non-pink bullet hit = `-1` + knockback + `triggerHitStop`. At 0, emit `{ type: 'die' }`.
- **The dash is the attack.** "Is dashing" = narrow the ability union first:
  `const dash = pState.abilities.dash; const dashing = dash?.kind === 'dash' && dash.timer > 0`.
  While `dashing` AND `aabbOverlap(playerRect, bossRect)` AND `boss.iframes <= 0`: apply 1 damage to `boss.data.hp`, set `boss.data.iframes` to `BOSS_IFRAMES = 0.40` (the DPS gate — sharp edge #1), fire `triggerHitStop(hitStop, 6)`, `sineShake`, a `spawn` spark burst, and a `playTone` thwack. This reuses the kernel + AABB — no separate attack system.
- **Parry (the Cuphead mechanic).** `ProjectileState` is a closed readonly interface with no colour field, so model "pink" via a consumer-owned supertype (the open-shape pattern): `interface BossBullet extends ProjectileState { readonly parryable?: boolean; readonly hue?: number }`. When `pollEdge(jumpEdge)` rises AND the hero overlaps a bullet with `parryable === true`: reflect the hero (`vy = -PARRY_BOUNCE`; flip horizontal `vx` away from the bullet), despawn the bullet (`alive = false`), fire `triggerHitStop` + a pink `spawn` star burst + a rising `playTone`. Non-pink bullets deal damage instead.

---

## 5. The Boss Arena

A small hand-authored `LevelData`: solid floor, two side walls, hollow middle. ~20 cols × 12 rows at `tileSize: 16` → `width: 320`, `height: 192` — smaller than the viewport so the camera never follows.

```ts
const ARENA: LevelData = {
  version: 1, width: 320, height: 192, tileSize: 16,
  tiles: { data: buildArenaGrid(), cols: 20, rows: 12, tileSize: 16 },
  entities: [
    { id: 1, kind: 'enemy', rect: { x: 128, y: 16, width: 64, height: 64 },
      props: { archetype: 'boss', params: { hp: 100, seed: 1337 } } },
  ],
};
const validation = validateLevel(ARENA);
if (!validation.valid) throw new Error(validation.errors.map(e => e.message).join('\n'));
const compiled = compileLevel(ARENA, { tileTypeMap: v => (v === 1 ? 'solid' : 'empty') });
const solids = compiled.staticSolids;
const tileQuery = compiled.tileQuery;   // pass the SAME query to EnemyUpdateContext — do not reclassify
```

Render the arena once per frame through `drawTileGrid(ctx, ARENA.tiles, (c, x, y, v, ts) => { if (v === 1) outlineRect(c, x, y, ts, ts, palette.platform, palette.outline); })` — the callback owns appearance, `drawTileGrid` owns traversal. The boss spawns at the top-centre as the single `'enemy'` entity of `archetype: 'boss'`.

### 5.1 Logical Resolution & Grid

| Parameter | Value |
|---|---|
| Logical resolution | 320 × 192 (arena) inside a 320 × 240 canvas (48 px HUD strip across the top — boss HP bar + hearts) |
| Grid | 20 × 12 tiles |
| Tile size | 16 px |
| CSS upscale | `image-rendering: pixelated` on the canvas, backing store at 320×240, CSS scales to viewport |
| Hero body | ~10 × 14 px (slightly under one tile wide, ~1 tile tall — small enough to thread bullet gaps) |
| Boss body | 64 × 64 px (4×4 tiles — fills the top-centre of the arena) |

Canvas setup:
```ts
const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
canvas.style.imageRendering = 'pixelated';
const dpr = resizeCanvasToBackingStore(canvas, 320, 240);
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
```

**Camera-lock rationale.** The arena (320 × 192) fits inside the canvas (320 × 240) with no overflow — there is nowhere for the camera to scroll. A `createCamera` is still constructed so the engine's built-in clamp pins the world to the viewport and `sineShake` (scaled to boss-HP-missing) can offset the render transform. The camera **never follows the hero**: it stays centred on the arena, and the hero moves freely inside it. This is the opposite of World 1-1 / Spin Loop (horizontal follow) and Doodle Knight (vertical clamp) — Bosscard is a single-screen fight.

---

## 6. The Boss Behavior (the centerpiece — a custom handler)

The boss is a CUSTOM `EnemyBehaviorHandler` registered alongside (or instead of) the built-ins. The registry is not limited to `spinny`/`spider`/`turret` — any archetype string you pass to `createEnemyBehaviorRegistry` dispatches to your handler.

**Engine contract you MUST respect:** `EnemyBehaviorHandler.step(state, ctx, params)` returns a flat `EnemyStepResult` carrying **one** `projectile?` per step (the same contract `turretBehavior` uses). There is **no** `ctx.rng` and **no** `state.hp` — determinism and HP live in `state.data`. For a simultaneous N-bullet radial *ring*, emit the handler's single registry projectile AND signal the consumer to fan out the rest (see §7) — the consumer's extra bullets still go through `sampleConeVelocity`, never raw trig.

```ts
// Same interface shape as the shipped spinny/turret/spider handlers, but with
// three phases driven by HP thresholds stored in `state.data`. Pure: same
// (state, ctx, params) → same result, forever.
const myBossBehavior: EnemyBehaviorHandler = {
  step(state: EnemyState, ctx: EnemyUpdateContext, params: Record<string, unknown>): EnemyStepResult {
    const data: Record<string, unknown> = { ...state.data };

    // HP + iframes live in the archetype bag (EnemyState has no hp field).
    const hp = typeof data.hp === 'number' ? data.hp : 100;
    // ★ iframes ALWAYS tick here — hit-stop never freezes this (see sharp edge #1).
    const iframes = Math.max(0, (typeof data.iframes === 'number' ? data.iframes : 0) - ctx.dt);
    data.iframes = iframes;
    data.burstPending = 0;   // reset each tick; the radial-fire branch sets it to 16 below

    // Seeded RNG derived from the boss's own seed + a tick counter in `data`.
    // ctx has no rng — determinism is the handler's job.
    const tick = (typeof data.tick === 'number' ? data.tick : 0) + 1;
    const seed = typeof data.seed === 'number' ? data.seed : 1;
    const rng = mulberry32(((seed * 2654435761) + tick) >>> 0);
    data.tick = tick;

    const phase = hp > 66 ? 'radial' : hp > 33 ? 'spiral' : 'aimed';
    data.phase = phase;

    // Single registry-owned projectile this step (gated by a cooldown).
    const cd = Math.max(0, (typeof data.fireCooldown === 'number' ? data.fireCooldown : 0) - ctx.dt);
    data.fireCooldown = cd;

    let projectile: ProjectileState | undefined;
    if (cd <= 0) {
      // Aim via atan2 of the delta to the player centre — this is aim-direction
      // math, NOT bullet-velocity math. Velocity always goes through sampleConeVelocity.
      const cx = state.x + 32, cy = state.y + 32;
      const aim = ctx.playerRect
        ? Math.atan2((ctx.playerRect.y + ctx.playerRect.height / 2) - cy,
                     (ctx.playerRect.x + ctx.playerRect.width / 2) - cx)
        : -Math.PI / 2;

      // ★ sampleConeVelocity is the ONLY public bullet-pattern helper.
      //   aimed   → cone ≈ 0 toward player
      //   spiral  → baseAngle rotates tick-over-tick, narrow cone
      //   radial  → full ring; handler emits one bullet, asks consumer for the ring (§7)
      const cone: ConeConfig = phase === 'aimed'
        ? { baseAngle: aim, spread: 0.06, speedMin: 220, speedMax: 220 }
        : phase === 'spiral'
          ? { baseAngle: (tick * 0.45) % (Math.PI * 2), spread: 0.10, speedMin: 170, speedMax: 170 }
          : { baseAngle: rng() * Math.PI * 2, spread: 0.10, speedMin: 130, speedMax: 150 };
      const v = sampleConeVelocity(cone, rng);
      data.fireCooldown = phase === 'aimed' ? 0.10 : 0.24;
      if (phase === 'radial') data.burstPending = 16;   // consumer fans the ring (§7)

      projectile = { x: cx - 4, y: cy - 4, vx: v.vx, vy: v.vy, width: 8, height: 8, alive: true };
    }

    return {
      x: state.x, y: state.y, vx: 0, vy: 0,
      facing: state.facing, alive: hp > 0, data,
      ...(projectile ? { projectile } : {}),
    };
  },
};

const registry = createEnemyBehaviorRegistry({ boss: myBossBehavior });
```

Compile once, step every tick:
```ts
let enemies = compileEnemies(ARENA);
// each fixed tick:
const result = stepEnemies(enemies, registry, { dt, solids, tileQuery, tileSize: 16, playerRect });
enemies = result.enemies;
```

The handler stays pure and deterministic; phase transitions fall out of `data.hp` for free. The player applies damage at the AABB boundary (§4), writing the new HP into a fresh `data` on the next consumer tick — never by mutating the registry's returned state.

**Sharp edge #1 — hit-stop must NOT freeze the boss's invincibility timer.** Hit-stop gates the *renderer and visuals*, not the *simulation tick*. `data.iframes` is decremented inside `step` (above) on every fixed tick regardless of `isHitStopActive`. If you froze iframes during hit-stop, the player could chain-hit during the freeze and trivialize the fight. The sim always advances; only the screen freezes. The `BOSS_IFRAMES = 0.40` window therefore bounds the player's effective damage rate at ~2.5 HP/s (one dash per iframe cycle) — this is the dial that sets the ~3–4 minute fight length when combined with the three HP thresholds in §7.

**Sharp edge #2 — the boss is ONE enemy, not many.** This is the opposite of Embertomb's 13-enemy bestiary: a single, complex, screen-filling entity whose density comes from bullets, not bodies.

---

## 7. Phase Breakdown — Three Phases, Intro, and Inter-Phase Transitions

This section is the heart of Bosscard. The previous brief had a one-line-per-phase table; this section specifies the **feel** of each phase — bullet pattern, cadence, telegraph, parry-pink ratio, learning goal, visual identity, and difficulty target — so that an agent cannot ship "bullet soup with no phase identity."

The boss behavior code in §6 already drives the three phases via HP thresholds. This section is the consumer-side spec that surrounds that code: the intro, the transitions, the aura/pose visuals, and the per-phase bullet-field fan-out.

### 7.1 Phase Map

| Phase | HP range | Pattern | Aura | Pose | Bullet cadence | Pink ratio | Target duration |
|---|---|---|---|---|---|---|---|
| **Intro** | invulnerable | none (scripted) | none | "drop in" | 0 | n/a | 5–7 s |
| **P1 — Radial Ring** | 100 → 67 | full-circle ring every ~2.4 s + 1–2 aimed singles between rings | blue | neutral | ~7 rings over the phase | 1-in-4 of ring bullets (`i % 4 === 0`) | 35–45 s |
| **Transition 1** | invulnerable 1.2 s | none | white flash | brief pose change | 0 | n/a | 1.2 s + 1 heal coin |
| **P2 — Spiral** | 67 → 34 | rotating pinwheel | purple | arms spread | ~4.2 bullets/s | 1-in-6 (~17%) | 35–50 s |
| **Transition 2** | invulnerable 1.2 s | none | white flash | brief pose change | 0 | n/a | 1.2 s + 1 heal coin |
| **P3 — Aimed Stream** | 34 → 0 | relentless aimed stream + occasional 3-bullet bursts | red | rage-contracted | ~10 bullets/s | 1-in-8 (~12.5%) | 30–45 s |
| **Victory** | 0 | none (scripted) | white-out | collapse | 0 | n/a | ~3 s |

The thresholds `100 → 67 → 34 → 0` are **deliberately uneven** (33 HP, 33 HP, 34 HP) so that phase durations are roughly equal even though P3 bullets arrive faster: the player misses more dashes in P3 because of the bullet density, so HP depletes slower per second of dodging. First-kill target: ~3–4 minutes wall-clock.

### 7.2 Phase 1 — Radial Ring (HP 100 → 67)

- **HP range.** `100 → 67` (33 HP, ~13 successful dashes at `BOSS_IFRAMES = 0.40`).
- **Bullet pattern.** The radial ring is the consumer-fanned ring specified in §7.9. The handler emits one bullet (§6) and signals `data.burstPending = 16`; the consumer reads it and fans the remaining 15 bullets at `baseAngle = (i / 16) * 2π`, `spread: 0`. Result: a clean 16-bullet ring expanding outward from the boss centre.
- **Cadence.** Ring every **~2.4 s** (`fireCooldown = 0.24` for the in-between singles, but the radial branch sets a separate ring cooldown — consumer-side `data.ringCooldown` initialised to 2.4 and decremented each tick). Between rings, **1–2 single-bullet aimed shots** toward the player centre keep pressure on without overwhelming the read.
- **Telegraph.** For **8 ticks (~133 ms) before each ring**, the boss's aura pulses magenta (a `drawGlow` overlay whose intensity ramps via a `createTweenState` from `DEFAULT_GLOW_INTENSITY` to `DEFAULT_GLOW_INTENSITY * 1.8` and back). The pulse is the "tell" — a player who reads it walks to the gap between bullets before the ring fires. There is **no per-bullet telegraph** in P1; the ring's geometry is its own read.
- **Pink ratio.** Every 4th bullet in the ring is pink (`parryable: i % 4 === 0`, matching §7.9). That is 4 pink bullets per 16-bullet ring (25%). A player cornered by the ring can parry-pink to bounce out — this is the phase's mercy mechanic.
- **What the player learns.** Read the magenta aura pulse, walk to a gap before the ring fires, parry-pink if cornered. The aimed singles teach the parry timing on a slower target before P3.
- **Visual identity.** Aura is **steady blue** (`complement(palette.feature)` shifted to a blue hue via `mixHex`). Boss body is in the equipped skin's `palette.base` (default "Classic"). Pose is **neutral** — small `breathe` oscillation only, no arm extension. `sineShake` amplitude baseline: `2 + (1 - hp/100) * 3` ≈ `2.0–2.99` (calm-to-slightly-tense).
- **Difficulty target.** A first-attempt player should clear P1 in **~35–45 seconds**, taking **0–1 hits**. If a first-attempt player takes 3+ hits in P1 alone, the ring cadence is too fast or the telegraph too short — slow the ring cooldown to 2.8 s and lengthen the aura pulse to 12 ticks.

### 7.3 Phase 2 — Spiral (HP 67 → 34)

- **HP range.** `67 → 34` (33 HP, the skill check).
- **Bullet pattern.** The spiral uses the §6 `spiral` cone branch: `baseAngle = (tick * 0.45) % (Math.PI * 2)`, `spread: 0.10`, `speedMin: 170, speedMax: 170`. One bullet fires per cooldown; `baseAngle` rotates tick-over-tick, producing a pinwheel. Period of one full spiral revolution: `2π / 0.45 ≈ 14` ticks ≈ 0.23 s of baseAngle sweep per bullet → a full spiral arm sweep takes ~5–7 s wall-clock.
- **Cadence.** `fireCooldown = 0.24` → **~4.2 bullets/s**. No bursts; the spiral IS the rhythm.
- **Telegraph.** On phase entry, the aura shifts from blue to **purple** and the boss spreads its "arms" (a pose change — see §7.7). After entry, there is **no per-bullet telegraph** — the spiral's predictable geometry is its own rhythm. The player learns to read the spiral arms and dash through the gaps.
- **Pink ratio.** **1-in-6 bullets pink (~17%)** — `parryable: tick % 6 === 0` set consumer-side when wrapping the registry projectile. The spiral's predictable geometry makes pink bullets easy parry targets; a skilled player farms parries here to build the muscle memory for P3.
- **What the player learns.** Dash through gaps in the spiral arms, parry-pink to redirect toward the boss body for a dash-attack, manage positioning so the spiral doesn't pin you to a wall. The spiral is the phase where dash-iframes (the brief invuln during `dashing`) become essential.
- **Visual identity.** Aura is **purple** (interpolated from the blue via `mixHex(blueAura, redAura, 0.5)`). Boss pose is **arms-spread** — two `outlineRect` "arm" rects extend outward from the body, offset by a small tween so the spread animates rather than snaps. `sineShake` amplitude baseline: `2 + (1 - hp/100) * 3` ≈ `2.99–3.98` (tense). A slight "zoom-in" feel comes from the higher shake amplitude, not from camera FOV change.
- **Difficulty target.** A first-attempt player should clear P2 in **~35–50 seconds**, taking **1–2 hits**. The spiral is the skill check — if a first-attempt player gets hit 4+ times in P2 alone, slow `baseAngle` rotation from `0.45` to `0.35` rad/tick (longer spiral period = more time to find gaps).

### 7.4 Phase 3 — Aimed Stream (HP 34 → 0)

- **HP range.** `34 → 0` (34 HP, the DPS race).
- **Bullet pattern.** The aimed stream uses the §6 `aimed` cone branch: `baseAngle = atan2(dy, dx)` to the hero centre, `spread: 0.06`, `speedMin: 220, speedMax: 220`. Near-zero spread = a near-straight shot. The handler also occasionally fires a **3-bullet burst** (consumer-supplemented): every ~1.5 s, fire two extra bullets at `baseAngle ± 0.18` rad for a fan that the player must dash through.
- **Cadence.** `fireCooldown = 0.10` → **10 bullets/s**. Plus the 3-bullet burst every ~1.5 s.
- **Telegraph.** On phase entry, the aura shifts from purple to **red** and the boss contracts into a "rage" pose (see §7.7). There is a **0.5 s bullet-pause at the transition** — the mercy window where the player can reposition before the stream starts. After entry, **no per-bullet telegraph**; the relentless stream IS the threat.
- **Pink ratio.** **1-in-8 bullets pink (~12.5%)** — `parryable: tick % 8 === 0`. Mostly raw-damage stream; the pink bullets are the player's tool to close distance (parry-pink → dash-attack → escape).
- **What the player learns.** Constant movement required. Dash to break the line of sight (the dash-iframes tank a bullet). Parry-pink to close distance, then dash-attack the boss body, then dash out. The 3-bullet bursts punish standing still. This is the DPS race — the player has to land ~14 dashes in 30–45 s while dodging 300+ bullets.
- **Visual identity.** Aura is **red** (`palette.danger` or `complement(palette.feature)`). Boss pose is **rage-contracted** — the body's `volumeScale` compresses (a `-0.06` squash offset applied to the body draw, not the hero), the arms tuck in, `drawGlow` intensity **doubles** (`DEFAULT_GLOW_INTENSITY * 2.0`). `sineShake` amplitude peaks: `2 + (1 - hp/100) * 3` ≈ `3.98–5.0` (max-tense). The screen reads as "the boss is angry."
- **Difficulty target.** A first-attempt player should clear P3 in **~30–45 seconds**, taking **2–3 hits**. The 0.5 s mercy pause on entry is the dial — if first-attempt players die in P3 without landing a dash, lengthen the pause to 0.8 s. If P3 is trivial, shorten to 0.3 s.

### 7.5 Intro Animation Layer

Mirror Flipside's attention to transition detail. The fight opens with a scripted intro, not a cold start into bullets.

- **Duration.** 5–7 seconds total.
- **Boss drop-in.** Boss `y` starts at `-100` (off-screen top). A `createTweenState` + `easeOutBack` tween animates `y` from `-100` to `16` over 1.5 s. The `easeOutBack` overshoot gives the boss a small bounce on "landing" at its anchor position.
- **Pose on landing.** Brief squash on the boss body via `volumeScale(-0.10)` → `volumeScale(0)` over 0.2 s (`easeOutCubic`).
- **Arena darkens.** A black overlay rect at `opacity: 0 → 0.4` over 0.6 s (a `createTweenState` ramp). Stays at 0.4 through the intro to focus attention on the boss.
- **FIGHT! card.** At t = 2.5 s, a `drawTextOutlined(ctx, 'FIGHT!', ...)` card scales in via `easeOutBack` (`scale: 0 → 1.0` over 0.3 s), holds for 1.2 s, then scales out via `easeOutCubic` (`scale: 1.0 → 0` over 0.3 s). Centered on the arena.
- **Boss is invulnerable.** During intro, `data.iframes` is set to `Infinity` (or `data.intro = true`, which the consumer's dash-attack check gates on). The player can move, jump, and dash but cannot damage the boss.
- **No bullets during intro.** The handler's fire branch is gated on a `data.intro === false` flag; the consumer sets `data.intro = false` at t = 5 s (1 s after the FIGHT! card disappears) and starts phase 1.
- **Audio.** A single descending `playTone('sawtooth', 600, 200, 1800, 0.25)` over the drop-in, then a sharp `playNoise(80, 'lowpass', 200, 0.3)` on landing.

### 7.6 Inter-Phase Transition Layer

On each HP-threshold crossing (100→67, 67→34, 34→0), the consumer fires a 1.2 s scripted transition. This is where the Cuphead mercy mechanic lives.

- **White flash overlay.** A full-arena white `outlineRect` with opacity ramped by `createTweenState` + `easeOutBack`: `0.0 → 1.0 → 0.0` over 1.2 s. Drawn over everything except the HUD.
- **Boss flashes invuln.** `data.iframes` is set to `1.2` (seconds) on the transition tick. **DO NOT freeze it** — per sharp edge #1, `iframes` keeps decrementing inside `step` on every fixed tick regardless. After 1.2 s it reaches 0 and the player can damage again. This is the test in §13.5.
- **Heal coins spawn.** **1 heal coin** spawns at a fixed position (e.g. `{x: 160, y: 140}`, the arena centre-bottom) via the `collectibles` ops — the Cuphead mercy mechanic. Use `derivePickups` → `collect` scoped under a `Record<runId, CollectibleSave>` (one record per attempt) so coins don't persist across attempts. The coin is a `DEFAULT_COLLECTIBLE_RECT` (8×8) with `props.kind = 'heal'`; on pickup, the player's HP heals +1 (capped at 3).
- **Phase-stinger audio.** One-shot per transition: `playTone('sawtooth', 300, 900, 220, 0.25)` (already in §11). Fires exactly once on the transition tick, not per tick during the 1.2 s.
- **Arena palette shift.** The aura colour shifts (blue → purple → red — see §7.7) and **persists** into the next phase. The shift is a `mixHex` lerp over the 1.2 s flash, not a snap.
- **Bullet field clears.** All existing bullets have `alive = false` set on the transition tick — the new phase starts with a clean field. This is fair-to-the-player and visually reads as "the previous pattern was wiped away."

### 7.7 Boss Visual Identity — Aura + Pose System

The boss is drawn from multiple `outlineRect` parts (already specified in §0). This section defines the per-phase visual transformation system so the three phases read as distinct silhouettes at a glance.

**Aura colour table.**

| Phase | Aura colour | Hex source | `drawGlow` intensity |
|---|---|---|---|
| Intro | none (overlay handles it) | n/a | `0` |
| P1 Radial | blue | `mixHex(parseHex('#3050ff'), palette.feature, 0.5)` | `DEFAULT_GLOW_INTENSITY` |
| P1 ring-telegraph pulse | magenta | `complement(palette.feature)` | `DEFAULT_GLOW_INTENSITY * 1.8` (8-tick tween) |
| P2 Spiral | purple | `mixHex(blueAura, redAura, 0.5)` | `DEFAULT_GLOW_INTENSITY * 1.4` |
| P3 Aimed | red | `parseHex('#ff3030')` (or `palette.danger`) | `DEFAULT_GLOW_INTENSITY * 2.0` |
| Transition flash | white | `parseHex('#ffffff')` | full-arena overlay (not glow) |
| Victory | white-out → collapse | `parseHex('#ffffff')` → fade | ramps to `0` over 3 s |

The aura is drawn each frame as a `drawGlow` ellipse centred on the boss body, behind the body parts. The intensity overrides above are passed as the `intensity` argument; the colour is passed as the `color` argument.

**Pose table.** The boss body is drawn from 5 `outlineRect` parts: torso, head, left arm, right arm, and a small "eye" cluster. The pose varies per phase by offsetting the arm position and applying a `volumeScale` to the torso.

| Phase | Torso `volumeScale` | Left arm offset | Right arm offset | Eye cluster |
|---|---|---|---|---|
| Intro (drop) | `0` (ease in from `-0.10` on landing) | tucked | tucked | wide |
| P1 Neutral | `breathe(tick, DEFAULT_BREATH)` (±0.02) | tucked (`dx: -2, dy: 0`) | tucked (`dx: +2, dy: 0`) | normal |
| P2 Arms-spread | `breathe(tick, DEFAULT_BREATH)` (±0.03) | extended (`dx: -18, dy: -4`) | extended (`dx: +18, dy: -4`) | narrow |
| P3 Rage-contracted | `volumeScale(-0.06)` constant | tucked tight (`dx: -4, dy: +2`) | tucked tight (`dx: +4, dy: +2`) | very narrow |
| Victory (collapse) | tween `0 → -0.30` over 3 s | drop off-screen | drop off-screen | closed |

**Pose interpolation.** On phase entry (transition tick), the consumer captures the previous pose offsets and tweens them to the new pose offsets over the 1.2 s transition flash via `createTweenState` + `easeOutCubic`. The pose does NOT snap; it morphs while the screen flashes. After the flash, the new pose is held for the duration of the phase.

**Phase-transition flash overlay.** A full-arena white rect (`outlineRect(ctx, 0, 0, 320, 192, '#ffffff', '#ffffff')`) whose opacity is driven by `createTweenState` + `easeOutBack`:

```ts
// on transition tick:
flashTween = createTweenState({ duration: 1.2, ease: easeOutBack });
// each render:
const f = advanceTween(flashTween, dt);
const opacity = Math.sin(f.normalized * Math.PI);  // 0 → 1 → 0 over the duration
ctx.globalAlpha = opacity;
outlineRect(ctx, 0, 0, 320, 192, '#ffffff', '#ffffff');
ctx.globalAlpha = 1;
```

The `Math.sin(normalized * π)` shape (rather than `easeOutBack` on opacity directly) ensures the flash ramps up and back down symmetrically, matching how a camera flash reads.

### 7.8 Fight Timeline (ASCII)

```
t=0s      6s         46s        47s       87s        88s       125s      130s
 |--------|----------|----------|----------|----------|----------|---------|
 [INTRO]  [PHASE 1: RADIAL RING] [TR1] [PHASE 2: SPIRAL]  [TR2] [PHASE 3: AIMED] [WIN]
 5-7s     ~35-45s               1.2s  ~35-50s             1.2s   ~30-45s        ~3s
 boss     HP 100→67             flash HP 67→34            flash  HP 34→0        white-out
 drops    ring every 2.4s       +1     spiral every       +1     stream every   collapse
 in       pink i%4===0          heal   0.24s              heal   0.10s          arpeggio
          parry-pink to         coin   pink tick%6===0    coin   + 3-bullet
          escape corner                burst every 1.5s          pink tick%8===0
          magenta 8-tick              arms-spread pose          rage pose
          aura pulse                                            0.5s mercy pause

 Aura:  none ────► BLUE ─────────────────► PURPLE ──────────────► RED ────► WHITE-OUT
 Pose:  drop     NEUTRAL                 ARMS-SPREAD             RAGE         COLLAPSE
 Shake: 0        2.0-2.99                2.99-3.98               3.98-5.0     0
```

Wall-clock first-kill target: ~3–4 minutes (130–240 s). The wide bands on each phase accommodate first-attempt deaths and missed dashes.

### 7.9 Bullet Pattern Reference (`sampleConeVelocity` everywhere)

`sampleConeVelocity(config: ConeConfig, rng)` deterministically samples a `{vx, vy}` inside an angular cone (`ConeConfig = { baseAngle, spread, speedMin, speedMax }`; consumes exactly 2 rng draws). It is the **only** public bullet-pattern helper. Do NOT hand-roll `Math.cos(angle) * speed` in bullet-spawn code — that trig lives inside `sampleConeVelocity`, not your game.

Three patterns, three cones:

| Phase | Cone shape | How |
|---|---|---|
| **Radial ring** | `spread = 2π` | The handler emits 1 bullet (§6); the consumer reads `data.burstPending` and fans the remaining N bullets at `baseAngle = (i / N) * 2π`, `spread: 0`. |
| **Spiral** | narrow cone, rotating origin | `baseAngle` increments in `data` each tick (`(tick * k) % 2π`); a small `spread` adds organic jitter. |
| **Aimed stream** | `spread ≈ 0` toward the player | `baseAngle = atan2(dy, dx)` to the hero centre; tight `spread` for a near-straight shot. |

Because the registry yields ≤1 projectile per enemy per tick, the consumer owns the dense bullet field and **reuses the engine's `stepProjectile`** to advance it (no hand-rolled integration):

```ts
interface BossBullet extends ProjectileState { readonly parryable?: boolean; readonly hue?: number }
let bullets: BossBullet[] = [];

// after stepEnemies:
bullets = bullets.concat(result.projectiles.map(p => ({ ...p, parryable: false })));

// consumer-supplemented radial ring (still sampleConeVelocity, never raw trig):
const boss = enemies.find(e => e.archetype === 'boss');
const pending = boss?.state.data.burstPending;
if (typeof pending === 'number' && pending > 0 && boss) {
  const ringRng = mulberry32(((1337 * 2654435761) + (boss.state.data.tick as number)) >>> 0);
  for (let i = 0; i < pending; i++) {
    const v = sampleConeVelocity(
      { baseAngle: (i / pending) * Math.PI * 2, spread: 0, speedMin: 140, speedMax: 140 },
      ringRng,
    );
    bullets.push({
      x: boss.state.x + 28, y: boss.state.y + 28, vx: v.vx, vy: v.vy,
      width: 8, height: 8, alive: true, parryable: i % 4 === 0,   // every 4th bullet is pink
    });
  }
}

// advance + cull — reuse the engine's projectile stepper against the arena walls + player:
const playerRect = { x: pState.core.x, y: pState.core.y, width: pState.core.width, height: pState.core.height };
bullets = bullets
  .map(b => stepProjectile(b, dt, solids, playerRect))   // returns ProjectileStepResult with hitPlayer
  .filter(b => b.alive && inArena(b));
for (const b of bullets) if (b.hitPlayer) onPlayerHit(b);   // parryable → bounce; else damage
```

`stepProjectile` already deactivates on solid hit and flags `hitPlayer` — do not re-derive either. Parry-pink bullets are drawn with `drawGlow` in a magenta `complement(palette.feature)`; non-pink bullets use `palette.danger`. Keep the field culled (`inArena`) so density stays readable. The per-phase pink ratios (P1 1-in-4 on rings, P2 1-in-6, P3 1-in-8) are set consumer-side when wrapping the registry projectile — the handler does not need to know.

---

## 8. Cosmetics + IAP (Three Boss Skins)

The headline cosmetics demo. Three skins for the boss body, each a seeded variant from `generateSkinVariants`:

1. **"Classic"** — default, owned from boot (spread `DEFAULT_COSMETIC_SAVE` + `equipSkin(save, 'boss', 'classic')`).
2. **"Devil"** — IAP via `createLocalStorageIAPAdapter` + the pure entitlement queue (`pushTransaction` → `flushIAPEvents` → `grantSkin`). This is the path the acceptance grep targets.
3. **"Golden"** — earned: `grantSkin` fires once on the first victory.

```ts
const manifest = DEFAULT_MANIFEST;
const variants = generateSkinVariants(1337, DEFAULT_SKIN_PRESET, 3);   // classic / devil / golden
let cosmetic = DEFAULT_COSMETIC_SAVE;

const iap = createLocalStorageIAPAdapter({ storageKey: 'bosscard-iap', catalog: DEFAULT_IAP_CATALOG });
let entitlements = DEFAULT_ENTITLEMENT_SAVE;

// purchase "Devil" skin:
const tx = pushTransaction(iap, { sku: 'boss.skin.devil', productType: 'non-consumable' });
entitlements = drainQueue(entitlements, iap);                 // pull any finished txns into the save
const grants = flushIAPEvents(entitlements, iap);             // ★ acceptance grep target
for (const g of grants) if (g.sku === 'boss.skin.devil') cosmetic = grantSkin(cosmetic, 'boss', 'devil');
writeSave(iapStorage, entitlements);
```

On first victory: `cosmetic = grantSkin(cosmetic, 'boss', 'golden')`. Render the boss body in the equipped variant's palette (`equipSkin`/`unequipSkin` swap the active slot). Heal-coin pickups between phases use the pure `collectibles` ops (`derivePickups` → `collect`), scoped under a `Record<runId, CollectibleSave>` exactly as World 1-1 scopes coins.

---

## 9. Camera (Locked Single-Screen)

The arena fits the viewport, so the camera is **clamped to arena bounds and never follows**. Use `createCamera` + `updateCamera` with the world bounds equal to the viewport — the engine's built-in clamp pins it:

```ts
let camera = createCamera();
camera = updateCamera(
  camera,
  { x: arenaW / 2, y: arenaH / 2, width: 0, height: 0 },     // centered target, no follow
  { width: arenaW, height: arenaH },                          // world = arena
  { width: CANVAS_W, height: CANVAS_H },                      // viewport
  DEFAULT_CAMERA,
);
// each render: very subtle shake, amplitude scaled to boss-HP-missing (angrier = shakier)
const anger = 1 - (bossHp / 100);
const shake = sineShake(tick, 2 + anger * 3, 30 / 60, 23 / 60);
ctx.translate(-camera.x + shake.x, -camera.y + shake.y);
```

The shake envelope decays via `shakeEnvelope`. No horizontal scrolling (that's World 1-1 / Spin Loop territory), no vertical endless (Doodle Knight territory).

---

## 10. Game Feel Checklist (the juice — every item uses the engine)

- [ ] **Hit-stop on EVERY player-hit AND EVERY boss-hit** (`triggerHitStop(hitStop, 6)`) — and the boss's `data.iframes` keep ticking through the freeze (sharp edge #1)
- [ ] Launch stretch `volumeScale(0.08)` (POSITIVE) + landing squash `volumeScale(-0.08)` (NEGATIVE)
- [ ] `sineShake` + `shakeEnvelope` on every hit, amplitude scaled to boss-HP-missing (`2 + anger * 3`)
- [ ] Phase-transition flash: `createTweenState` + `easeOutBack` white-out → palette swap (per §7.6)
- [ ] Intro animation: boss drop-in (`easeOutBack` tween), FIGHT! card (`drawTextOutlined` + `easeOutBack`), arena darkens (per §7.5)
- [ ] Per-phase aura colour + pose interpolation (per §7.7)
- [ ] Heal coin between phases (the mercy mechanic — per §7.6)
- [ ] Dash trail: `spawn` 4 white particles per active-dash tick, `cull`'d
- [ ] Parry star burst (pink `spawn`) + bullet despawn on every parry
- [ ] Boss aura: a slow `createEmitter` + `drawGlow` at the body centre, colour per phase
- [ ] Coyote time + jump buffer from the shipped `jumpAbility` — do not duplicate
- [ ] Spring-rod straw on the hero (`advanceSpringRod`) whips on dash
- [ ] `prefersReducedMotion` mutes particles + shake + audio but keeps the fight playable

---

## 11. Audio (all synthesized via `createAudioAdapter`)

Unlock on first user gesture (one-shot `keydown`/`pointerdown` calling `audio.unlock()`). One-shot SFX only — no procedural chiptune headline (that's Flipside territory):

- **Jump:** `playTone('sine', 200, 400, 80, 0.2)`.
- **Dash:** `playNoise(60, 'bandpass', 1500, 0.18)`.
- **Boss hit (dash connect):** `playTone('square', 160, 110, 70, 0.22)` + `playNoise(70, 'lowpass', 300, 0.18)`.
- **Player hurt:** `playNoise(120, 'lowpass', 400, 0.3)` + descending `playTone('sine', 400, 80, 200, 0.25)`.
- **Parry (the Cuphead ping):** rising `playTone('triangle', 500, 1200, 90, 0.2)`.
- **Bullet spawn (subtle):** `playNoise(20, 'highpass', 2000, 0.03)` — quiet enough to spam.
- **Phase-transition stinger:** `playTone('sawtooth', 300, 900, 220, 0.25)` (one-shot per phase change — fired once on the transition tick, not per tick during the 1.2 s flash).
- **Intro drop-in:** descending `playTone('sawtooth', 600, 200, 1800, 0.25)` + `playNoise(80, 'lowpass', 200, 0.3)` on landing.
- **Heal coin pickup:** `playTone('triangle', 600, 900, 90, 0.18)`.
- **Victory:** rising arpeggio of three `playTone('triangle', …)` notes.
- **Death:** three descending square tones (200 ms each).

---

## 12. Visual & Play Gates

### 12.1 Screenshot Requirements

Before the build is accepted, capture and review these screenshots (320×240 PNG each):

1. **Phase 1 frame** — the radial ring mid-expansion, with at least 4 visible bullets in the ring (2 of them pink via `drawGlow`).
2. **Phase 2 frame** — the spiral mid-rotation, with at least 8 visible bullets tracing a clear pinwheel arc.
3. **Phase 3 frame** — the aimed stream, with the boss in rage pose (red aura) and at least 6 visible bullets between the boss and the hero.
4. **Contact sheet** — all three phase frames + the intro frame + a transition flash frame, arranged in one image.
5. **Parry moment** — a frame where the hero overlaps a pink bullet at the parry-edge-rise tick (capture is tricky; use a scripted input replay if necessary).
6. **Intro animation** — a frame mid-FIGHT! card, with the boss at its anchor position and the arena darkened.

A reviewer should be able to identify the phase from the silhouette and aura colour alone, without reading the HP bar.

### 12.2 Playthrough Requirements

- **Complete kill from spawn to victory** — the full intro → P1 → P2 → P3 → collapse sequence must play through.
- **Manual playtest targets:**
  - First kill: **3–4 minutes** wall-clock (includes learning the three patterns and the parry timing).
  - Expected deaths: **1–3** on first attempts (P2 spiral is the most common first-attempt killer; P3 stream is the second).
  - Death-to-restart: **<2 seconds** from death to controllable respawn.
- **What the player should feel at each phase:**
  - **Intro:** "Okay, this boss is here, it dropped in with weight, I'm ready."
  - **P1:** "I can read the rings. The pink bullets are mercy. I'm in control."
  - **Transition 1:** "Oh, the music/aura shifted. New pattern coming. Heal coin — thank you."
  - **P2:** "This spiral is faster. I have to dash through the arms. This is the skill check."
  - **Transition 2:** "Red aura. This is the final phase. One more heal coin. Here we go."
  - **P3:** "Constant pressure. I'm dashing on rhythm. Parry to close, dash to escape. DPS race."
  - **Victory:** "I earned that. The boss collapsed with weight."

### 12.3 Rejection Criteria

The following are grounds for rejecting the build:

- **Bullet soup with no phase identity** — if a reviewer cannot tell which phase is active from a screenshot of the bullet field alone.
- **All three phases feeling the same** — same aura colour, same pose, same cadence. The phase system exists for nothing.
- **Missing parry-pink bullets** — the pink ratio per phase (P1 1-in-4 on rings, P2 1-in-6, P3 1-in-8) must be visible and consistent.
- **Missing hit-stop on hits** — every player-hit and every boss-hit must freeze the screen briefly.
- **Iframes frozen during hit-stop** — sharp edge #1 violation. The player can chain-hit through the freeze and trivialize the fight. Test per §13.5.
- **No phase-transition flash** — phases blur together without the white flash + aura shift + pose change. The reviewer can't tell when a phase changed.
- **No heal coins between phases** — the Cuphead mercy mechanic is missing. The fight is a grind.
- **Missing dash-attack feel** — the dash-into-boss hit must `triggerHitStop` + `sineShake` + spark burst. If it doesn't, the dash feels weightless.
- **Missing 3 cosmetic skins** — only 1 or 2 skins shipped instead of 3.
- **Missing IAP path** — `flushIAPEvents` not present in the Devil-skin unlock path.
- **A screenshot only of phase 1** — must show all three phases (per §12.1).

---

## 13. Tests & Static Contracts

### 13.1 Arena Schema

- The arena `LevelData` passes `validateLevel`.
- The arena grid is exactly 20×12.
- The arena has exactly one `'enemy'` entity of `archetype: 'boss'`.
- The boss entity's `params.hp` defaults to `100`.

### 13.2 Boss Behavior Purity

- The boss `step` function has no closure over mutable outer state (static analysis: no `let`/`var` outside the function body that the function writes to).
- The boss `step` function has no `Date.now` call (grep).
- The boss `step` function has no `Math.random` call (grep) — `mulberry32` derived from `state.data.seed` and `state.data.tick` only.
- Re-running `step` with the same `(state, ctx, params)` produces byte-identical `EnemyStepResult`.

### 13.3 `sampleConeVelocity` Presence (the Bullet-Pattern Helper Test)

- `sampleConeVelocity` must appear in the boss behavior file and the bullets file (grep).
- The boss behavior + bullet-spawn code must NOT contain `Math.cos(` or `Math.sin(` directly in bullet-velocity computation. (`Math.atan2` for aim-direction is permitted; `cos/sin * speed` for velocity is not.) Grep with a regex that flags `Math.cos(*)*` and `Math.sin(*)*` patterns in those files.

### 13.4 Per-Phase Content Counts

| Phase | HP range | Bullet cadence | Pink ratio | Telegraph duration | Heal coins |
|---|---|---|---|---|---|
| Intro | invulnerable | 0/s | n/a | 5–7 s scripted | 0 |
| P1 Radial | 100 → 67 | ring every ~2.4 s + 1–2 aimed singles | 1-in-4 of ring (`i % 4 === 0`) | 8-tick magenta aura pulse before each ring | 0 |
| Transition 1 | invulnerable 1.2 s | 0 | n/a | 1.2 s white flash (`Math.sin(π * normalized)`) | 1 (heal +1, capped at 3) |
| P2 Spiral | 67 → 34 | ~4.2 bullets/s (`fireCooldown = 0.24`) | 1-in-6 (`tick % 6 === 0`) | pose change on phase entry only | 0 |
| Transition 2 | invulnerable 1.2 s | 0 | n/a | 1.2 s white flash | 1 (heal +1, capped at 3) |
| P3 Aimed | 34 → 0 | ~10 bullets/s (`fireCooldown = 0.10`) + 3-bullet burst every ~1.5 s | 1-in-8 (`tick % 8 === 0`) | pose change + 0.5 s mercy bullet-pause on entry | 0 |
| Victory | 0 | 0 | n/a | ~3 s white-out → collapse | 0 |

### 13.5 Boss-Iframes-Don't-Freeze Test (Sharp Edge #1)

This is the most important behavioural test in Bosscard. Script it as a fixed-tick sequence:

1. Spawn the boss with `data.hp = 70` (P2 range), `data.iframes = 0`.
2. Advance 1 tick with `dt = 1/60`. Verify `data.iframes` decremented to `0` (no iframes were set).
3. Apply a dash-hit: set `data.hp = 69`, `data.iframes = 0.40` (the consumer's dash-attack branch).
4. **Trigger hit-stop** (`triggerHitStop(hitStop, 6)`).
5. Advance 1 tick. **Verify `isHitStopActive(hitStop)` is true** (the screen is frozen).
6. **Verify `data.iframes` decremented to `0.40 - 1/60 ≈ 0.383`** (the sim tick ran; iframes ticked DURING the freeze).
7. Advance 5 more ticks (still inside the hit-stop window). Verify `data.iframes` continued decrementing each tick.
8. After the hit-stop window expires, verify iframes reached `0` and the player can damage again.

**Failure mode this catches:** if the consumer froze the simulation (skipped `step`) during hit-stop, `data.iframes` would stay at `0.40` until the freeze lifted, and the player could chain 6+ hits during the 100 ms freeze — trivializing the fight. The fix is always "the sim advances every fixed tick; only visuals freeze." This is enforced at the `createGameLoop` level: `step` runs every fixed tick regardless of `isHitStopActive`.

### 13.6 Parry-Mechanic Test

Script it as a fixed-tick sequence:

1. Spawn a `BossBullet` at `{x: 100, y: 100, parryable: true}`.
2. Place the hero overlapping the bullet at `{x: 102, y: 102}`.
3. Set `jumpEdge` to rising (`pressEdge` then `pollEdge` returns `true`).
4. Advance 1 tick. **Verify:** the bullet's `alive === false` (despawned), the hero's `vy === -PARRY_BOUNCE` (reflected up), the hero's `vx` flipped away from the bullet.
5. Repeat with `parryable: false`. **Verify:** the bullet is NOT despawned, the hero's HP decreased by 1, `triggerHitStop` fired.

### 13.7 Simulation Determinism (Full-Fight Hash)

- Script a 600-tick fight: spawn boss + hero, feed a deterministic input sequence (held right + jump-edge every 30 ticks + dash-edge every 20 ticks). Record the final state (hero HP, boss HP, bullet field length, boss position, `data.tick`).
- Re-run with the same inputs. Final state must be **byte-identical** (use `canonicalize` + `fnv1a` on a JSON serialization of the final state to produce a hash; both runs must hash to the same value).
- A 600-tick fight at 60 Hz = 10 s wall-clock; that covers intro + most of P1. Extend to 1200 ticks (20 s) if the test rig is fast enough.

### 13.8 Phase-Transition Tests

- **HP-threshold phase change:** step the boss from `hp = 68` to `hp = 66` (P1 → P2 threshold at 67). Verify `data.phase === 'spiral'` on the next tick.
- **HP-threshold phase change:** step from `hp = 35` to `hp = 33` (P2 → P3 threshold at 34). Verify `data.phase === 'aimed'`.
- **Transition flash tween:** on the threshold-crossing tick, verify the consumer created a `flashTween` with `duration: 1.2`.
- **Bullet-field clear on transition:** verify all bullets have `alive === false` after the transition tick.

### 13.9 Forbidden Patterns

Static analysis (grep / AST) must find:

- **No `requestAnimationFrame`** in game code (only in the engine's `createGameLoop`).
- **No `Math.random`** in game code.
- **No `Date.now`** in game code.
- **No `Math.cos` / `Math.sin` in bullet-velocity code** (only in `sampleConeVelocity` inside the engine). `Math.atan2` for aim-direction is permitted.
- **No `stepPlatformer` outside the engine** (must use `createPlatformerController` + `.step()`).
- **No `advanceSpringChain`** in appendage code (use `advanceSpringRod`).
- **No deep imports** (no `aicraft-engine/src/...` — only root barrel).
- **No manual AABB resolver** (no `resolveAxisX` / `resolveAxisY` in game code — that's Embertomb's pattern; Bosscard uses the kernel).
- **Exactly one `createGameLoop`** (grep confirms one occurrence).
- **The registry is constructed as `createEnemyBehaviorRegistry({ boss: myBossBehavior })`** (grep confirms the `boss` key with the custom handler, not just the shipped `spinny`/`spider`/`turret`).

### 13.10 End-to-End Kill Tests (Where Practical)

Script a deterministic input sequence that drives the hero from spawn to victory (applies ~100 dashes to the boss body across all three phases). This is NOT proof of fun — it proves the full intro → P1 → transition → P2 → transition → P3 → victory sequence is mechanically completable. Use the replay module if available, or hardcode a sequence of `InputEdges` per tick. The test passes when `data.hp === 0` AND `gameState === 'victory'`.

---

## 14. Anti-Failure Wording

**This build is NOT complete merely because the boss behavior handler compiles and three phases fire.** The previous version of this brief produced a boss fight that failed because:

- **A phase table cannot substitute for phase feel.** Listing "radial → spiral → aimed" in a one-line table does not make the phases feel different. The aura colour, the pose, the cadence, the telegraph, and the parry-pink ratio per phase must all be specified and implemented — that is what §7 does.
- **Bullet soup is a failure.** If a reviewer cannot tell which phase is active from a screenshot of the bullet field alone, the phases have no identity. The aura colour + pose + cadence must do that work.
- **Missing parry-pink bullets is a failure.** The parry is the Cuphead signature mechanic. Without pink bullets in the correct per-phase ratio, the player has no escape valve and the fight becomes a grind.
- **Missing phase-transition flash is a failure.** Without the white flash + aura shift + pose change, phases blur together. The reviewer can't tell when a phase changed; the player can't either.
- **Missing heal coins between phases is a failure.** The Cuphead mercy mechanic is part of the genre homage. Without it, the fight is unforgiving in a way Cuphead isn't.
- **Iframes frozen during hit-stop is a failure.** Sharp edge #1. If the consumer froze the simulation during hit-stop, the player can chain-hit through the 100 ms freeze and trivialize the fight. The sim always advances; only visuals freeze. Test per §13.5.
- **Missing dash-attack feel is a failure.** The dash-into-boss hit must `triggerHitStop(hitStop, 6)` + `sineShake` + spark burst + thwack `playTone`. If it doesn't, the dash feels weightless and the player has no reason to dash into the boss instead of away from it.
- **Missing 3 cosmetic skins is a failure.** Only 1 or 2 skins shipped instead of 3. The headline cosmetics demo is the whole point of the Bosscard prompt.
- **Missing IAP path is a failure.** `flushIAPEvents` must appear in the Devil-skin unlock path. Reviewer greps for it.
- **A screenshot only of phase 1 is a failure.** All three phases must be screenshot-reviewed for distinct visual identity. Phase 1 is the easy one; phases 2 and 3 are where the phase-identity system actually proves itself.

This is the Flipside failure by analogy: Flipside v1 had six valid rooms but they were all the same box template — valid data, failed game. Bosscard v1 had a valid boss handler but the three phases were bullet soup — valid code, failed fight. The fix in both cases is the same: specify the **feel** of each unit (room / phase) in enough detail that an agent cannot collapse them to a single template.

---

## 15. Preserved Constraints

- **Reduced-motion early gate** — `prefersReducedMotion()` checked before audio setup; renders one static frame; creates no audio adapter, note player, or loop. The boss fight stays "playable" in the sense that the static frame is the intro pose.
- **Touch + keyboard + gamepad input** — `createKeyboardAdapter` + `createTouchButtonSet` + `createGamepadAdapter` + `orEdges`.
- **DPR / pixel scaling** — `resizeCanvasToBackingStore` + `ctx.setTransform(dpr, ...)`.
- **Fixed-step sim** — `createGameLoop({ fixedDt: 1/60 })`. The sim advances every fixed tick regardless of `isHitStopActive` (sharp edge #1).
- **PRECISION feel** — `PRECISION_PLATFORMER` + `defaultPrecisionPipeline` (jump + dash). Do NOT use `CLASSIC_PLATFORMER` (too loose for bullet-hell).
- **The dash is the attack** — no separate attack system. Dash-into-boss via `aabbOverlap` + `data.iframes` check.
- **Parry on pink bullets** — `ProjectileState` is closed; the open-shape `BossBullet` supertype adds `parryable`.
- **Custom boss behavior** — `createEnemyBehaviorRegistry({ boss: myBossBehavior })`, not just the shipped `spinny`/`spider`/`turret`.
- **`sampleConeVelocity` everywhere** — never raw `Math.cos` / `Math.sin` in bullet-velocity code.
- **Three cosmetic skins** — Classic (default), Devil (IAP), Golden (earned).
- **Zero runtime deps** — `aicraft-engine` is the only dependency.

---

## 16. Implementation Workflow

Build in this order. Each stage must pass its gate before the next begins.

### Stage 1: Arena + Hero + Camera (Graybox)

1. Set up Vite + TypeScript + `aicraft-engine@0.17.3`.
2. Implement the hand-authored arena `LevelData` (§5) with `validateLevel` + `compileLevel`.
3. Render the arena via `drawTileGrid`.
4. Wire the hero (`PRECISION_PLATFORMER` + `defaultPrecisionPipeline`) with keyboard + touch input.
5. Lock the camera to arena bounds (§9).
6. **Gate:** The hero runs, jumps, and dashes on the arena floor. No moonwalk. Camera does not scroll.

### Stage 2: Static Boss + Phase 1 Only

1. Draw the boss as static `outlineRect` parts with the neutral pose and blue aura (`drawGlow`).
2. Register `createEnemyBehaviorRegistry({ boss: myBossBehavior })` (§6 code verbatim).
3. Implement the consumer-side radial ring fan-out (§7.9) for P1 only.
4. Implement the dash-into-boss attack (`aabbOverlap` + `data.iframes` + `triggerHitStop` + `sineShake`).
5. **Gate:** Phase 1 plays. Rings fire every ~2.4 s with the magenta aura pulse telegraph. Pink bullets (`i % 4 === 0`) are visible. Dash-into-boss deals damage with hit-stop + shake.

### Stage 3: Phase Design Review

1. On paper (or in a comment block), spec out the three phases per §7.1–§7.4 with the aura colour, pose, cadence, telegraph, pink ratio, and difficulty target.
2. Confirm the HP thresholds (100 → 67 → 34 → 0) and the `BOSS_IFRAMES = 0.40` DPS gate produce ~3–4 minute first-kill.
3. **Gate:** The three phase specs are written and reviewed. No code change yet.

### Stage 4: Phase 2 (Spiral)

1. Wire the spiral cone branch (§6, already in the handler) — `data.phase` flips to `'spiral'` when `hp <= 67`.
2. Implement the consumer-side pink ratio (`tick % 6 === 0`) for P2.
3. Implement the P2 pose (arms-spread, purple aura).
4. **Gate:** Phase 2 plays after Phase 1. Spiral rotates with a clear pinwheel arc. Pink bullets are visible. Pose + aura shift on entry (even without the formal transition layer — that comes in Stage 6).

### Stage 5: Phase 3 (Aimed Stream)

1. Wire the aimed cone branch — `data.phase` flips to `'aimed'` when `hp <= 34`.
2. Implement the 3-bullet burst supplement every ~1.5 s.
3. Implement the P3 pose (rage-contracted, red aura, double `drawGlow` intensity).
4. Implement the 0.5 s mercy bullet-pause on P3 entry.
5. **Gate:** Phase 3 plays after Phase 2. Stream is relentless. Burst fans are dodgeable. Pose + aura shift on entry. Full kill (intro → P1 → P2 → P3 → death) is mechanically completable.

### Stage 6: Intro + Transitions + Heal Coins

1. Implement the intro animation (§7.5): boss drop-in tween, FIGHT! card, arena darkens, 5–7 s invuln.
2. Implement the inter-phase transition layer (§7.6): white flash tween, `data.iframes = 1.2` on transition, heal coin spawn, phase-stinger audio, bullet-field clear.
3. Wire the heal coin via `derivePickups` → `collect` scoped under `Record<runId, CollectibleSave>`.
4. Implement the aura + pose interpolation (§7.7) across the transition.
5. **Gate:** Intro plays on fight start. Phase transitions flash + shift aura + shift pose + drop a heal coin. The three phases read as distinct silhouettes.

### Stage 7: Cosmetics + IAP

1. Wire `generateSkinVariants` for the three skins (Classic / Devil / Golden).
2. Wire `equipSkin` / `unequipSkin` to swap the active boss-body palette.
3. Wire the IAP path for Devil: `pushTransaction` → `drainQueue` → `flushIAPEvents` → `grantSkin`.
4. Wire the Golden skin `grantSkin` on first victory.
5. **Gate:** Three skins are equippable. IAP path produces a Devil-skin entitlement. Golden unlocks on first victory.

### Stage 8: All-Phase Screenshots + Vision Review

1. Capture all six screenshots per §12.1 (P1, P2, P3, contact sheet, parry moment, intro).
2. Confirm a reviewer can identify the phase from silhouette + aura colour alone.
3. **Gate:** Vision review confirms distinct phase identities, readable bullet fields, and the parry moment is captured.

### Stage 9: Polish + Verification

1. Add the remaining game-feel items (§10): dash trail, parry star burst, spring-rod straw, etc.
2. Run all tests in §13.
3. Grep for forbidden patterns (§13.9).
4. Run the 600-tick determinism test (§13.7).
5. Run the boss-iframes-don't-freeze test (§13.5).
6. Run the parry-mechanic test (§13.6).
7. **Gate:** All tests pass. No forbidden patterns found. Manual playtest hits the 3–4 minute first-kill target with 1–3 deaths.

---

## 17. File Layout (Suggested)

```
src/
  main.ts              # boot: canvas, validateLevel, compileLevel, loop.start()
  game/
    state.ts           # World, HeroState (hp), BossBullet, run save shape, phase constants
    step.ts            # fixed-step: input → kernel → stepEnemies → bullets → hits → phases → audio
    render.ts          # pure draw: arena, boss parts (per-pose), bullets, hero art, aura, flash, HUD
    arena.ts           # the hand-authored LevelData + buildArenaGrid()
    boss-behavior.ts   # ★ myBossBehavior (the custom EnemyBehaviorHandler) + registry
    bullets.ts         # BossBullet field, sampleConeVelocity ring/spiral supplement, stepProjectile loop
    phases.ts          # phase map, HP thresholds, BOSS_IFRAMES, intro + transition orchestration
    boss-visual.ts     # aura colour table, pose table, pose interpolation, flash overlay
    player.ts          # hero render (cup/face/straw/feet) + parry + dash-attack
    cosmetics.ts       # generateSkinVariants + grantSkin/equipSkin + IAP wiring
    heal-coins.ts      # derivePickups → collect scoped per runId, heal-on-pickup
  input.ts             # createKeyboardAdapter + createTouchButtonSet + createGamepadAdapter + orEdges
  audio.ts             # createAudioAdapter + the SFX recipe helpers
  save.ts              # createLocalStorageSaveStorage + IAP storage wrappers
```

---

## 18. Summary of Key Changes from Previous Brief

| Aspect | Previous (463 lines, "bullet soup" risk) | This brief (~870 lines) |
|---|---|---|
| Phase spec | 1-line-per-phase table in §7 | Full per-phase breakdown (§7.1–§7.4) with HP range, pattern, cadence, telegraph, pink ratio, learning goal, visual identity, difficulty target |
| Phase identity | Unspecified (aura/pose assumed) | Aura colour table (blue → purple → red) + pose table (neutral → arms-spread → rage-contracted) in §7.7 |
| Intro | Cold start into bullets | 5–7 s scripted intro (boss drop-in, FIGHT! card, arena darkens) in §7.5 |
| Inter-phase transition | Unspecified | 1.2 s white flash + iframes + heal coin + stinger + bullet-field clear in §7.6 |
| Mercy mechanic | Not present | 1 heal coin per transition (the Cuphead mercy) — via `collectibles` ops |
| Fight length | Unspecified | ~3–4 minute first-kill target, tuned via HP thresholds (33/33/34) + `BOSS_IFRAMES = 0.40` |
| Visual review | Code-compiles gate | Per-phase screenshot gate (§12.1) — one screenshot per phase + contact sheet + parry moment + intro |
| Play targets | Unspecified | 3–4 min first kill, 1–3 deaths, what the player should feel at each phase (§12.2) |
| Failure modes | Implicit | Explicit anti-failure list (§14) referencing the Flipside-style "valid data, failed game" failure by analogy |
| Implementation stages | "Build order suggestion" paragraph | 9-stage workflow with gates (§16) |
| Tests | 13 acceptance criteria | 10 test groups (§13) including per-phase content counts table, boss-iframes-don't-freeze test, `sampleConeVelocity` grep test, simulation determinism hash, E2E kill test |
| Boss behavior code | §6 | §6 — **preserved verbatim** (the centerpiece; only the surrounding phase-feel spec was added) |
| Engine API references | All present | All present and unchanged |
| Install / version | `aicraft-engine@0.4.0` | `aicraft-engine@0.4.0` — unchanged at the time of that revision (the brief has since been repinned to `0.15.0`; see §1) |

---

## 19. Stretch Goals (only after §12–§16 pass)

- **`createReplayRecorder` + `replayHash`** for "share your fastest kill" 8-char hex share codes (record inputs, hash the run, replay byte-identical). Pairs naturally with the §13.7 determinism test.
- **Phase 4 enrage** at HP < 10 — faster bullets, wider cones, a screen-wide `drawGlow` pulse.
- **A second boss** with a different behavior (e.g. a "twin" that mirrors the player's facing).
- **Parry deals damage** (true-to-Cuphead): each successful parry shaves a small chunk off `data.hp`.
- **Procedural boss-intro music** via the music module's `createSequencer` (one-shot, plays once on fight start) — verify the music exports against the released barrel before use.

---

**Build order:** arena + hero + camera (graybox) → static boss + phase 1 only → phase design review → phase 2 → phase 3 → intro + transitions + heal coins → cosmetics + IAP → all-phase screenshots + vision review → polish + verification.

**The fight is not done when the code compiles. It is done when three phases with distinct aura + pose + cadence + telegraph are playable, a reviewer can identify the phase from a screenshot alone, the parry-pink bullets are visible in the correct per-phase ratio, the boss-iframes keep ticking through hit-stop, and a human player can land their first kill in 3–4 minutes with 1–3 deaths.**
