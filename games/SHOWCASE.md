# Game prompt showcase

> A visual-lineup-friendly index of the 7 build-briefs in `games/`. Each brief is a single markdown file you paste into a coding agent (Claude / Cursor / etc.) to produce a runnable Vite + TypeScript browser game built on [`aicraft-engine`](../README.md).

The catalog is a portfolio of vertical slices of famous 2D platformers. Each prompt is chosen to exercise a *different* engine pillar as its headline, so building two or three of them touches most of the library without redundant work. All seven install `aicraft-engine@0.17.4` exactly and import only from the root barrel. Six were written against `0.4.0` and repinned — their claimed imports were typechecked against the `0.15.0` surface, and each carries a note on what changed behaviorally since. They still differ in *reach*: [Celerock](./celerock.md) was authored against the modern golden path (LDtk levels, the camera brain, the room-transition session), while the other six teach the pillars that predate it. Where a row below says "all 7", read it as the `0.4.0`-era shared surface — Celerock has moved off several of those on purpose, and the rows say which.

Pick the homage you recognize ("oh, mini-Celeste!"), check the *Headline pillar* column to see what you'll actually learn, and follow a learning path below if you want a curriculum instead of a one-off.

## Lineup

> **Phase 2 (not yet rendered):** a 7-thumbnail grid, one PNG per game, will live at `../benchmarks/game-showcase/lineup.png`. Each thumbnail is a representative frame rendered headlessly by `@benchmarker`. For now, open each prompt's §0 concept paragraph for a written description of what the finished game looks like.

## Comparison

| Game | Genre | Homage to | Difficulty | Est. agent build time | LOC target | Headline pillar |
|---|---|---|---|---|---|---|
| **[World 1-1](./world-1-1.md)** | Horizontal-scrolling classic platformer | *Super Mario Bros.* | ★ | ~20 min | ~1100 | [`platformer`](../src/platformer/index.ts) (`CLASSIC_PLATFORMER`) + [`parallax`](../src/primitives/index.ts) (`drawTiledParallax`) |
| **[Embertomb](./simple-platformer.md)** | Side-view procedural platformer | *Sokpop-meets-Celeste* | ★★ | ~30 min | ~1500 | [`particles`](../src/particles/index.ts) (emitters + LAVA/WATER presets) + `wave-line` surfaces |
| **[Flipside](./flipside.md)** | No-jump gravity-flip explorer | *VVVVVV* | ★★ | ~35 min | ~1400 | [`music`](../src/music/index.ts) (`createNoteFirePlayer`, fixed-step four-layer split) |
| **[Doodle Knight](./doodle-knight.md)** | Mobile endless vertical climber | *Doodle Jump* | ★★ | ~30 min | ~1300 | Procedural spawn via [`rng`](../src/rng/index.ts) `mulberry32` + [`music`](../src/music/index.ts) `createNoteFirePlayer` + [`cosmetics`](../src/cosmetics/index.ts)/[`iap`](../src/iap/index.ts) |
| **[Celerock](./celerock.md)** | Multi-room precision platformer (LDtk-driven) | *Celeste* | ★★★★★ | ~60 min | ~2500 | [`ldtk`](../src/ldtk/index.ts) as the level source (loader + preflight + room cache + `drawLdtkLevel`) + the **camera brain** + the **room-transition session** across `__neighbours` seams |
| **[Bosscard](./bosscard.md)** | Single-screen bullet-hell boss | *Cuphead* | ★★★ | ~35 min | ~1500 | Custom enemy registry ([`createEnemyBehaviorRegistry`](../src/platformer/index.ts)) + [`particles`](../src/particles/index.ts) `sampleConeVelocity` bullets + [`cosmetics`](../src/cosmetics/index.ts)/[`iap`](../src/iap/index.ts) |
| **[Spin Loop](./spin-loop.md)** | Momentum horizontal act | *Sonic the Hedgehog* | ★★★★ | ~40 min | ~1500 | **0.4.0 signed-gravity kernel** (`PlatformerConfig.gravity` sign flip + two-controller loop pattern) |

_*Phase 1 estimates. Phase 2 will replace with measured numbers from actual agent builds._

_Difficulty key: ★ = your first prompt; ★★★★ = you've built three others first. Celerock is rated ★★★★★ as the only prompt on the current release: it is the widest surface in the catalog (LDtk + camera brain + the full Celeste kit + seam transitions + sprite pipeline + persistence), and it is the one to build if you want the engine as it stands today rather than as it stood at `0.4.0`. Flipside is rated ★★ (not ★★★) because its kernel is `PUZZLE_PLATFORMER` with an empty ability pipeline — the hard part (the music determinism seam) is bounded by `advanceSequencer`'s pure contract, not the kernel._

## Learning paths

#### Path A — "I'm new to the engine"

1. **[World 1-1](./world-1-1.md)** — the most recognizable level in gaming; broadest pillar coverage; lowest difficulty. Start here.
   You learn the `platformer` kernel with `CLASSIC_PLATFORMER` (the Mario config), a hand-authored `LevelData` constant, `compileLevel` + `drawTileGrid` + `drawLevelEntity`, the 3-layer `drawTiledParallax` background, the `collectibles` + `save` loop on real coin pickups, and two custom enemy handlers in `createEnemyBehaviorRegistry` (goomba + koopa).
2. **[Celerock](./celerock.md)** — tightens kernel understanding: you swap in `PRECISION_PLATFORMER` and the `defaultPrecisionPipeline` jumps to the **ability pipeline**, adding `dashAbility` + `wallSlideAbility` + `wallGrabAbility` to the familiar jump. (**Not** `doubleJumpAbility` — Celeste has no double jump, and the brief forbids importing it.)
   You also pick up the `game-state` FSM (`createGameState` + `reduceGameState` + `isLegalTransition`) for `menu → playing → gameover`, plus the LDtk load path and the seam-transition session. Note the version jump: this is the only step on `0.17.4`, so its API surface is much wider than step 1's.
3. **[Embertomb](./simple-platformer.md)** — the "soup" demo. You drop the platformer kernel entirely and drive the [`collision`](../src/collision/index.ts) per-axis resolver loop (`resolveAxisX` + `resolveAxisY` + `resolveTileX` + `resolveTileY`) by hand.
   You get the broadest rendering tour: Gerstner wave-line water + lava, `LAVA_FIRE_PARTICLES` / `LAVA_SMOKE_PARTICLES` / `WATER_BUBBLE_PARTICLES` emitter presets, `drawGlow`, `drawTiledParallax`, `outlineRect` bounce/squash, and a 13-enemy bestiary each stressing a different primitive.

Through-line: kernel fundamentals → ability pipeline → rendering breadth. After this path you've touched every rendering primitive and the whole `platformer` kernel except signed gravity. Goal: ~75 minutes end-to-end.

#### Path B — "I want to learn procedural audio"

1. **[Flipside](./flipside.md)** — [`music`](../src/music/index.ts) via `createNoteFirePlayer` (fixed-step event-renderer). The four-layer theory / pattern / advance / host split is laid out in full: `noteToFrequency` + `SCALES` (Layer 1), `generatePattern` (Layer 2), `advanceSequencer` (Layer 3 — the determinism seam), `createNoteFirePlayer` (Layer 4 — external-event renderer).
   You turn reduced-motion into a test of the seam (call `advanceSequencer` even with audio muted, so the `NoteFire[]` output is byte-identical across runs).
2. **[Doodle Knight](./doodle-knight.md)** — [`music`](../src/music/index.ts) via the *same* `createNoteFirePlayer` path, but with the **music-drives-difficulty** coupling: the lead track's note events feed straight into the procedural spawner (`busy lead → more rewards; sparse lead → wider gaps`).
   Same determinism contract; new gameplay wiring.

Through-line: the determinism seam ([`advanceSequencer`](../src/music/index.ts)) is identical in both; the second adds the gameplay coupling that turns the music pillar from background into a *gameplay* feature. (Note: neither prompt uses the older `createSequencer` host-clock adapter — that's an unexercised gap, see the reverse index.) Goal: ~65 minutes.

#### Path C — "I want to ship a mobile game"

1. **[Doodle Knight](./doodle-knight.md)** — vertical-endless, one-thumb touch + tilt, three cosmetic characters with IAP. The closest thing to a shippable mobile vertical slice.
   You learn the only consumer-side vertical-clamp camera in the catalog (`Math.min(camera.y, player.y)`), the [`cosmetics`](../src/cosmetics/index.ts) + [`iap`](../src/iap/index.ts) end-to-end flow (`generateSkinVariants` → `grantSkin` → `equipSkin` → `flushIAPEvents`), and tilt-as-axis input via the gamepad left-stick X.
2. **[Bosscard](./bosscard.md)** — single-screen premium showcase; cosmetics + IAP for three boss skins.
   You learn the `createEnemyBehaviorRegistry` extension point (a **custom** `EnemyBehaviorHandler` not in the shipped `spinny` / `spider` / `turret` set), `sampleConeVelocity` as the bullet-pattern helper, and the parry / dash-attack feel loop using AABB-on-kernel-state.

Through-line: both exercise the full [`cosmetics`](../src/cosmetics/index.ts) → [`iap`](../src/iap/index.ts) → [`save`](../src/save/index.ts) persistence loop end-to-end. Doodle Knight adds tilt input + vertical-clamp camera + auto-bounce (`jumpEnabled: false`); Bosscard adds the custom-boss enemy registry + bullet-hell patterns + the parry mechanic. Goal: ~65 minutes.

#### Path D — "I want the demos that look best in a screenshot"

1. **[Spin Loop](./spin-loop.md)** — momentum + speed-scaled screen-shake + 3-layer parallax = the most visually kinetic. The lost-rings burst (`sampleConeVelocity` with a 360° cone) is the single most cinematic single frame in the catalog.
2. **[Bosscard](./bosscard.md)** — one screen-filling boss with radial / spiral / aimed bullet-hell patterns + a `drawGlow` aura + phase-flash tweens = the *most* visually dense. The 1930s-cartoon flavor is its own thing.
3. **[Doodle Knight](./doodle-knight.md)** — cleanest Sokpop-aesthetic demo; one knight + sparse platforms + drifting clouds = the most visually legible. The vertical-endless frame composition is friendly to static captures.

Through-line: these three are the ones that survive a still frame. Spin Loop sells speed, Bosscard sells density, Doodle Knight sells clarity. Phase 2's `lineup.png` grid will lean on these three for thumbnail quality. Goal: ~105 minutes end-to-end.

After finishing a path, jump to the reverse index below to find which pillar you haven't touched yet — that's how you pick the next prompt.

## Reverse index — which prompt shows off which feature?

Read this table the opposite way from §*Comparison*: pick a pillar, find the prompt that headlines it. `—` means no prompt exercises it yet; those rows are the most valuable output of this doc — they surface catalog gaps for Batch 4.

| Pillar / feature | Best prompt | Second-best | Notes |
|---|---|---|---|
| [`platformer`](../src/platformer/index.ts) kernel (`createPlatformerController` / `stepPlatformer`) | [Celerock](./celerock.md) | [Spin Loop](./spin-loop.md) | 6 of 7 prompts use the kernel. Embertomb is the lone exception — it drives [`collision`](../src/collision/index.ts) directly. |
| `platformer` presets (`PRECISION_PLATFORMER` / `CLASSIC_PLATFORMER` / `EXPLORATION_PLATFORMER` / `PUZZLE_PLATFORMER`) | [World 1-1](./world-1-1.md) (`CLASSIC`) | [Celerock](./celerock.md) (`PRECISION`) | `PUZZLE_PLATFORMER` is used by [Flipside](./flipside.md) + [Doodle Knight](./doodle-knight.md). **`EXPLORATION_PLATFORMER` is not exercised by any prompt — Batch 4 candidate.** |
| **0.4.0 signed gravity** — `PlatformerConfig.gravity` sign flip | [Spin Loop](./spin-loop.md) | [Flipside](./flipside.md) | Only Spin Loop (loop-de-loop) + Flipside (gravity-flip verb) use this in 0.4.0. |
| **0.4.0 `jumpEnabled`** — the master-switch config | [Doodle Knight](./doodle-knight.md) | — | Only Doodle Knight flips `jumpEnabled: false` (auto-bounce on landing). |
| **0.4.0 `tileTypeMap`** — unified tile + entity `compileLevel` | [World 1-1](./world-1-1.md) | [Flipside](./flipside.md) | 4 of 7 compile via `tileTypeMap`; Embertomb uses legacy `createTileQuery`; Doodle Knight has no tiles; **Celerock moved to the LDtk path (`compileLdtkRoom`) and now forbids `compileLevel`.** |
| [`collision`](../src/collision/index.ts) (`aabbOverlap` + `resolveAxisX/Y` + `resolveTileX/Y`) | [Embertomb](./simple-platformer.md) | [World 1-1](./world-1-1.md) | `aabbOverlap` is used by all 7 for hazards/pickups; only Embertomb drives the full per-axis resolver loop itself. |
| [`camera`](../src/camera/index.ts) legacy follow (`createCamera` / `updateCamera`) | [World 1-1](./world-1-1.md) | [Doodle Knight](./doodle-knight.md) | 6 of 7. Doodle Knight's vertical-clamp (follows UP only) is the unique variant; Spin Loop adds speed-scaled lookahead. **Celerock is the exception — it forbids both names and drives the camera brain instead (next row).** |
| **Camera brain** (`createCameraBrain` / `updateCameraBrain` + per-room `VirtualCamera` + `fitCameraZoom`) | [Celerock](./celerock.md) | — | **Only Celerock.** One follow vcam per LDtk room, Celeste-style deadzone bands, cover-fit zoom, and a transient fixed vcam driving the room slide. The legacy single follow-camera cannot express per-room framing — that's why the brief bans it. |
| **[`ldtk`](../src/ldtk/index.ts) as the level source** (`loadLdtkProjectAssets` / `inspectLdtkPlatformerProject` / `createLdtkRoomCache` / `drawLdtkLevel`) | [Celerock](./celerock.md) | — | **Only Celerock**, and it is the whole point of that brief: geometry, entities, and tile art all come from a supplied `.ldtk` + tileset rather than hand-authored `LevelData`. Standard dev-time **hot reload** too (§5.7): save the `.ldtk` and the live game swaps the active room by iid with the player's state preserved. Also the only prompt that ships its own CC0 asset pack. |
| **Room transitions** (`createRoomTransitionSession` / `pollRoomTransition` / `beginSessionRoomSlide` + `mapLdtkRoomEntry` / `transitionPlatformerToRoom`) | [Celerock](./celerock.md) | — | **Only Celerock.** Momentum-preserving traversal across LDtk `__neighbours` seams with a slide that renders both rooms. The `0.15.0` session makes the invariants structural (no second transition mid-slide, one finish-rebase, one cancel path). |
| **Sprite pipeline** (`parseSpriteSheet` / `compileSpriteSheet` / `deriveSpriteAnimKind` / `drawSprite`) | [Celerock](./celerock.md) | — | **Only Celerock.** The other six draw procedural `outlineRect` bodies; Celerock renders a supplied 10×8 sheet of 16×16 frames from the first play tick, with the procedural body kept as the load-failure fallback. |
| [`input`](../src/input/index.ts) (`createKeyboardAdapter` + touch + gamepad, `orEdges`) | [World 1-1](./world-1-1.md) | [Doodle Knight](./doodle-knight.md) | All 7 use it. Doodle Knight adds device tilt via the gamepad left-stick X axis. |
| [`game-loop`](../src/game-loop/index.ts) (`createGameLoop`) | [World 1-1](./world-1-1.md) | [Flipside](./flipside.md) | Used identically by all 7. Flipside is the interesting variant — the fixed step also owns the music advance. |
| [`particles`](../src/particles/index.ts) (`spawn` / `advance` / `step` / `sampleConeVelocity`) | [Embertomb](./simple-platformer.md) | [Bosscard](./bosscard.md) | `sampleConeVelocity` is the headline of Bosscard (bullets) and Spin Loop (lost-rings 360° burst); Embertomb has the broadest `spawn` / `step` use. |
| `particles` emitters (`createEmitter` / `stepEmitters` + LAVA/WATER presets) | [Embertomb](./simple-platformer.md) | [Doodle Knight](./doodle-knight.md) | Only Embertomb uses the ratified `LAVA_FIRE_PARTICLES` / `LAVA_SMOKE_PARTICLES` / `WATER_BUBBLE_PARTICLES` presets. |
| [`animation`](../src/animation/index.ts) locomotion (`advanceLocomotionByDisplacement` + `evaluateLocomotion`) | [Embertomb](./simple-platformer.md) | [World 1-1](./world-1-1.md) | All 7 use it; Embertomb drives it across the player + 13 enemy types. |
| `animation` squash/stretch (`volumeScale` + `breathe`) | [Embertomb](./simple-platformer.md) | [Spin Loop](./spin-loop.md) | All 7. Spin Loop + Bosscard + Doodle Knight explicitly enforce the **0.4.0 sign convention** (positive = stretch-up on launch, negative = squash on land). |
| `animation` spring rod (`createSpringRod` / `advanceSpringRod`) | [Embertomb](./simple-platformer.md) | [Celerock](./celerock.md) | All 7 use the rod; "never raw `advanceSpringChain` in appendage code" is a universal acceptance criterion. Embertomb has the most strands (tail, antenna, wings, swimmer). |
| `animation` IK — `solveLimb` | [World 1-1](./world-1-1.md) | [Embertomb](./simple-platformer.md) | Koopa legs (World 1-1) + chaser legs (Embertomb). |
| `animation` IK — `solveCCD` / `solveFABRIK` | — | — | **Not exercised by any prompt — Batch 4 candidate.** Only `solveLimb` (2-segment) gets used. |
| [`primitives`](../src/primitives/index.ts) — `outlineRect` (the Sokpop vector look) | [Embertomb](./simple-platformer.md) | [World 1-1](./world-1-1.md) | Universal — every game's art is `outlineRect` shapes. |
| `primitives` `drawGlow` | [Embertomb](./simple-platformer.md) | [Bosscard](./bosscard.md) | Embertomb: lava + coins + magic. Bosscard: boss aura + parry-pink bullets. |
| `primitives` `drawTiledParallax` + `parallaxOffset` | [World 1-1](./world-1-1.md) | [Spin Loop](./spin-loop.md) | 6 of 7 use a 3-layer far/mid/near stack. Spin Loop's scrolls speed-scaled to `\|vx\|`. |
| `primitives` `createHitStop` / `triggerHitStop` | [Bosscard](./bosscard.md) | [Celerock](./celerock.md) | All 7. Bosscard fires hit-stop on *every* hit (player and boss) and is the only prompt with a documented sharp edge: the boss's `iframes` must keep ticking through the freeze. |
| `primitives` `drawText` / `drawTextOutlined` + `DEFAULT_FONT` | [Celerock](./celerock.md) | [World 1-1](./world-1-1.md) | Celerock: death counter + room title cards + "Press X to respawn". World 1-1: HUD score + floating "+200" popups. |
| [`rng`](../src/rng/index.ts) — `mulberry32` / `nextInt` / `nextFloat` / `pick` | [Doodle Knight](./doodle-knight.md) | [Embertomb](./simple-platformer.md) | Only Doodle Knight (the whole level) + Embertomb (rooms + bestiary) generate content from a seed; the other 5 are hand-authored. |
| [`easing`](../src/easing/index.ts) — Penner curves + `createTweenState` / `advanceTween` | [World 1-1](./world-1-1.md) | [Celerock](./celerock.md) | World 1-1: floating score popups (`easeOutCubic` + `easeOutBack`). Celerock: room-title fade + the death-and-respawn flash (the old per-room "Cleared" card is gone — rooms now flow seamlessly). |
| [`audio`](../src/audio/index.ts) SFX — `createAudioAdapter` / `playTone` / `playNoise` | [Embertomb](./simple-platformer.md) | [World 1-1](./world-1-1.md) | All 7. Embertomb has the most distinct recipes (one per enemy type); World 1-1 nails the iconic SMB coin ding-ding + death jingle. |
| [`music`](../src/music/index.ts) — `createNoteFirePlayer` (0.4.0 fixed-step event-renderer path) | [Flipside](./flipside.md) | [Doodle Knight](./doodle-knight.md) | Only Flipside + Doodle Knight. Flipside is the dedicated four-layer showcase; Doodle Knight adds music-drives-difficulty coupling. |
| `music` — `advanceSequencer` (the pure determinism seam) | [Flipside](./flipside.md) | [Doodle Knight](./doodle-knight.md) | Both call it exactly once per fixed tick (Flipside §10.4, Doodle Knight §9.2). |
| `music` — `createSequencer` (host-clock self-scheduling adapter) | — | — | **Not exercised by any prompt — Batch 4 candidate.** Both music prompts use the `createNoteFirePlayer` path. |
| [`save`](../src/save/index.ts) — `loadSave` / `writeSave` + storage backends | [Celerock](./celerock.md) | [World 1-1](./world-1-1.md) | 6 of 7 persist via `save`. Celerock composes collectibles + a death counter; World 1-1 composes coins + score. |
| [`collectibles`](../src/collectibles/index.ts) — `collect` / `hasCollected` / `derivePickups` | [Celerock](./celerock.md) | [Spin Loop](./spin-loop.md) | Used by 6 of 7 (not Embertomb), always paired with `save`. **Pillar 1 of 7 prompts headline it; Celerock does so via strawberry persistence, Spin Loop via the lost-rings burst + ring total.** |
| [`cosmetics`](../src/cosmetics/index.ts) — `generateSkinVariants` / `grantSkin` / `equipSkin` | [Bosscard](./bosscard.md) | [Doodle Knight](./doodle-knight.md) | Only Bosscard (3 boss skins) + Doodle Knight (3 characters) make cosmetics first-class; the other 5 list it as a stretch. |
| [`iap`](../src/iap/index.ts) — `createMemoryIAPAdapter` / `createLocalStorageIAPAdapter` / `flushIAPEvents` | [Bosscard](./bosscard.md) | [Doodle Knight](./doodle-knight.md) | Same two prompts as cosmetics. Both grep-target `flushIAPEvents` in the purchase path. |
| [`replay`](../src/replay/index.ts) — `createReplayRecorder` / `playReplay` / `replayHash` | — | — | **Not exercised as a headline by any prompt — Batch 4 candidate.** Spin Loop + Doodle Knight + Bosscard all list share-codes as a stretch only. |
| [`level`](../src/level/index.ts) schema — `LevelData` / `validateLevel` / `migrateLevel` | [World 1-1](./world-1-1.md) | [Flipside](./flipside.md) | 4 of 7 hand-author `LevelData`; Embertomb uses a raw tile grid; Doodle Knight has no tiles; **Celerock reaches `LevelData` only as the output of `ldtkLevelToLevelData`, never by hand.** |
| Procedural level generation (consumer-side `mulberry32` — not an engine module per se) | [Doodle Knight](./doodle-knight.md) | [Embertomb](./simple-platformer.md) | Doodle Knight is the explicit counter-example to World 1-1's hand-authoring — the only fully-procedural level. |
| [`palette`](../src/palette/index.ts) — `generatePalette` / `resolvePalette` / `repairContrast` | [Flipside](./flipside.md) | [World 1-1](./world-1-1.md) | All 7 theme via `generatePalette`. Flipside is the notable variant — mono-mode with grayscale overrides + a single gold exception for the trinket. |
| [`game-state`](../src/game-state/index.ts) FSM (`createGameState` / `reduceGameState`) | — | — | **Used by all 7 prompts, but never the headline pillar.** A menu-heavy or state-machine-driven game would make it the star — Batch 4 candidate. |
| [`editor`](../src/editor/index.ts) — `applyOp` / `undo` / `beginTransaction` / `selectInRect` / `enterPlaytest` | — | — | **Not exercised by any prompt — Batch 4 candidate.** The headless level-editor core ships but no game demo consumes it. |
| [`blend`](../src/blend/index.ts) — `blendPose` / `blendPoses` | — | — | **Not exercised by any prompt — Batch 4 candidate.** Pose interpolation is independent of the animation pillar but nothing in the catalog drives it. |
| 1930s-cartoon aesthetic (Bosscard) | [Bosscard](./bosscard.md) | — | Not an engine feature — a visual theme. Surfaced here because it's a recurring flavor note (chunky outlines + `drawGlow` aura + phase-flash tweens) unique to Bosscard. |

## Overlap notes

So you don't accidentally build near-duplicates back-to-back. Each callout names the *specific* pillar both prompts share, so you can gauge the marginal cost of doing them in sequence:

- If you've built **[Celerock](./celerock.md)**, **[Bosscard](./bosscard.md)** will teach you little new about the kernel.
  Both run `PRECISION_PLATFORMER` + `defaultPrecisionPipeline`. The new pieces Bosscard adds (custom `createEnemyBehaviorRegistry`, `sampleConeVelocity` bullets, parry mechanic) are narrow — and Bosscard pins `0.4.0`, so you will also be stepping *back* a long way in API surface.
  Pick **[Flipside](./flipside.md)** or **[Spin Loop](./spin-loop.md)** instead for your next.
- If you've built **[World 1-1](./world-1-1.md)**, **[Spin Loop](./spin-loop.md)** is the natural sequel (both horizontal scrollers with `drawTiledParallax` at `PARALLAX_FAR/MID/NEAR` + `createCamera` follow + `sineShake`/shakeEnvelope) — but the scaffolding overlap is so heavy that you'll get more new pillars from **[Bosscard](./bosscard.md)** (one screen + custom boss behavior) or **[Flipside](./flipside.md)** (six rooms + a music pillar you haven't seen).
- If you've built **[Flipside](./flipside.md)**, **[Doodle Knight](./doodle-knight.md)** is the natural music-pillar sequel — and is worth doing because it uses the *same* `createNoteFirePlayer` path with a new gameplay coupling (music-drives-difficulty), not a different adapter.
  The shared pillars are `advanceSequencer` + `createNoteFirePlayer` + the four-layer music architecture; the new piece is the note-density → spawn-density wiring.
- If you've built **[Embertomb](./simple-platformer.md)**, you've already touched ~70% of the rendering primitives (`outlineRect` + `drawGlow` + `drawTiledParallax` + Gerstner wave-line + `LAVA_FIRE_PARTICLES` + 13 enemies + squash/spring-rod).
  Your next prompt should lean on a *non-rendering* pillar ([`music`](../src/music/index.ts) via [Flipside](./flipside.md) or [Doodle Knight](./doodle-knight.md), [`cosmetics`](../src/cosmetics/index.ts)/[`iap`](../src/iap/index.ts) via [Bosscard](./bosscard.md) or [Doodle Knight](./doodle-knight.md), or [`replay`](../src/replay/index.ts) via the Stretch goal on any of the three).
- If you've built **[Bosscard](./bosscard.md)**, **[Doodle Knight](./doodle-knight.md)** teaches the *same* cosmetics/IAP surface in a different genre (`generateSkinVariants` + `grantSkin` + `equipSkin` + `flushIAPEvents` + the `createLocalStorageIAPAdapter` purchase flow).
  Pick **[Celerock](./celerock.md)** or **[Flipside](./flipside.md)** instead for more new pillars.
- **[Celerock](./celerock.md)** and **[Spin Loop](./spin-loop.md)** share `PRECISION_PLATFORMER`; Spin Loop's novelty is *signed gravity* (the two-controller loop-de-loop pattern), Celerock's is the *ability pipeline* (wall-slide + dash + wall-grab/stamina + mantle + dash-tech) — plus everything around it that Spin Loop has no version of: LDtk levels, the camera brain, and seam transitions. The kernel is the only real overlap.
  Building both back-to-back gives diminishing kernel returns — interleave one with a non-kernel prompt (Flipside's music, Doodle Knight's cosmetics/IAP) for max new-pillar coverage per hour.
- **[World 1-1](./world-1-1.md)** and **[Bosscard](./bosscard.md)** both exercise `createEnemyBehaviorRegistry` with custom `EnemyBehaviorHandler` objects (goomba/koopa vs. the boss — same API, different bodies).
  If you've built one, the other's enemy system will feel familiar. Pick **[Doodle Knight](./doodle-knight.md)** for a prompt with no enemy registry at all — the only one you can use for a clean break from the enemy-pipeline pattern.
- **[Flipside](./flipside.md)**'s signed-gravity + two-controller pattern is structurally similar to **[Spin Loop](./spin-loop.md)**'s loop-de-loop two-controller swap — both register two `createPlatformerController` instances and pick one per tick based on a region flag.
  If you've built one, the other is a short ride; skip ahead to a non-kernel prompt.

## What's next

### Phase 2 of this showcase

All items below are **Phase 2 — not yet done**:

- 7 representative-frame thumbnails in `../benchmarks/game-showcase/`, one PNG per game, rendered headlessly by `@benchmarker`.
- The combined `../benchmarks/game-showcase/lineup.png` grid referenced in the *Lineup* section above.
- Verified build-time + LOC numbers from actual agent runs, replacing the † Phase 1 estimates in *Comparison*.
- A second pass on the *Difficulty* column grounded in measured agent use of the acceptance criteria, not prompt-text inference.

### Batch 4 prompt candidates

Surfaced from the `—` gap rows in the reverse index — each fills a pillar no current prompt headlines:

- **"Build-a-Level"** (*Mario Maker* homage) → headlines [`editor`](../src/editor/index.ts) (level-editor core: `applyOp` / `undo` / `beginTransaction` / `enterPlaytest`).
- **"Beat Cube"** (*Geometry Dash* homage) → headlines [`music`](../src/music/index.ts) + [`game-loop`](../src/game-loop/index.ts) coupling + one-button input; could also be the first to exercise `createSequencer` (host-clock path).
- **"Limbo Cube"** (*Limbo* homage) → headlines [`palette`](../src/palette/index.ts) (mono-mode) + atmospheric [`primitives`](../src/primitives/index.ts) (`drawGlow` + `drawTiledParallax`).
- **"Shovel Bounce"** (*Shovel Knight* homage) → headlines [`animation`](../src/animation/index.ts) IK (`solveCCD` / `solveFABRIK`) for the pogo-shovel, and `EXPLORATION_PLATFORMER`.
- **"Thomas-Style"** (*Thomas Was Alone* homage) → headlines [`blend`](../src/blend/index.ts) (`blendPose` / `blendPoses`) across multiple rectangle characters, with [`game-state`](../src/game-state/index.ts) FSM as the headline (character-swap routing).

## Cross-references

- [games/README.md](./README.md) — the catalog entry point + how to add a new prompt.
- [../README.md](../README.md) — engine overview, pillar status table, install (submodule + npm).
- [../docs/api-surface.md](../docs/api-surface.md) — the export map by pillar; useful when picking a prompt by pillar.
- [../docs/architecture.md](../docs/architecture.md) — the determinism rules every prompt in this catalog enforces.
