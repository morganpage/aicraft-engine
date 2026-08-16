# Game prompts for `aicraft-engine`

A catalog of build-briefs (prompts) for games built **on top of** the
[`aicraft-engine`](https://www.npmjs.com/package/aicraft-engine) library. Each
file is a self-contained prompt — paste it to a coding agent (Claude / Cursor /
etc.) and it produces a runnable game that imports everything from the engine
and writes no re-implementations of what the engine already provides.

All seven prompts pin `aicraft-engine@0.16.0` exactly — a version, not a range.
Six of them were written against `0.4.0` and repinned; every import each one
claims was typechecked against the `0.15.0` surface at repin time, so they
compile as written. They differ in *how much* of the engine they reach:
[celerock.md](./celerock.md) was authored against the modern golden path
(LDtk levels, the camera brain, the room-transition session) and is the
reference for it, while the other six teach the pillars that predate those
waves — the hand-authored `LevelData` path, the legacy follow camera — which
remain fully supported. Each of the six carries a version note listing the
behavioral changes since `0.4.0` that touch it.

Celerock is also the only prompt that ships **assets** — a CC0 level, tileset,
and sprite sheet linked from its §1.1 and downloaded at scaffold time (see
[`THIRD_PARTY.md`](../THIRD_PARTY.md) for provenance).

The common contract every prompt here enforces:

- **Fixed-step sim** via `createGameLoop` (60 Hz, input polled once per step).
- **No `Math.random` / `Date.now` in the simulation** — seeded `mulberry32` only.
- **Defensive host access** through the engine's adapters (audio, motion, dpr).
- **Reduced-motion** gate (static frame, no loop).
- **Zero hand-rolled** reimplementations of the engine's primitives (the
  acceptance criteria grep for `requestAnimationFrame`, `Math.random` in `step`,
  manual AABB, and duplicate tile-grid traversal). Renderer callbacks required
  by APIs such as `drawTileGrid` and `drawTiledParallax` are explicitly allowed.

> **New: [SHOWCASE.md](./SHOWCASE.md)** — a skim-friendly landing page with a
> comparison table, four curated learning paths, a reverse-index of
> "which prompt shows off which feature?", overlap warnings, and the Batch 4
> candidate list. Start there if you're picking which prompt to build first.

## Prompts

| Game | File | Genre | Engine pillars exercised |
|---|---|---|---|
| **Embertomb** | [simple-platformer.md](./simple-platformer.md) | Side-view platformer | loop, input, tile/AABB collision, camera, hit-stop, squash, locomotion, foot-plant audio, jump, **spring rods**, particles, emitters (lava/water presets), wave-lines (water+lava), parallax, glow, palettes, RNG level-gen |
| **Celerock** | [celerock.md](./celerock.md) | Multi-room Celeste-like precision platformer (LDtk-driven) | The whole modern golden path: **LDtk as the level source** (`loadLdtkProjectAssets` + `inspectLdtkPlatformerProject` preflight + `createLdtkRoomCache` + `drawLdtkLevel`), the **camera brain** (per-room vcams, `fitCameraZoom`), the **full Celeste movement kernel** (8-dir dash, wall-grab/stamina, wall-slide, direction-aware wall-jump, mantle, dash-tech), the **room-transition session orchestrator** (`createRoomTransitionSession` → `pollRoomTransition` → `beginSessionRoomSlide`) across `__neighbours` seams, `state.moments` feel channel, the **sprite pipeline** (`parseSpriteSheet` → `drawSprite`), collectibles + `save`, hit-stop + shake, sustained-noise audio, **dev-time LDtk hot reload** (live room swap with player state preserved, §5.7). **Ships its own CC0 asset pack.** |
| **World 1-1** | [world-1-1.md](./world-1-1.md) | Horizontal-scrolling classic platformer | **platformer kernel** (`CLASSIC_PLATFORMER`: jump, no double-jump), hand-authored `LevelData` + `validateLevel`, unified `compileLevel`, moving platforms, parallax, collectibles + save |
| **Flipside** | [flipside.md](./flipside.md) | No-jump gravity-flip explorer | Signed-gravity controllers with empty ability pipelines, unified tile compilation, and fixed-step `advanceSequencer` events rendered by `createNoteFirePlayer` |
| **Spin Loop** | [spin-loop.md](./spin-loop.md) | Momentum-speed horizontal act | **Signed-gravity two-controller pattern** for the loop-de-loop (`PRECISION_PLATFORMER` + `gravity: ±magnitude`), `sampleConeVelocity` for the **lost-rings burst**, speed-scaled camera + `sineShake`, `compileLevel` + `tileTypeMap`, 3-layer `drawTiledParallax`, `collectibles` + `save`, `replay` stretch |
| **Bosscard** | [bosscard.md](./bosscard.md) | Single-screen bullet-hell boss | `sampleConeVelocity` bullet patterns (radial / spiral / aimed), **custom boss behavior** in `createEnemyBehaviorRegistry`, `hit-stop` + `sineShake` + `shakeEnvelope`, `compileLevel` arena, **cosmetics + IAP** for 3 boss skins, parry mechanic |
| **Doodle Knight** | [doodle-knight.md](./doodle-knight.md) | Mobile endless vertical climber | **Procedural spawn via `mulberry32`** (the only procedural-level prompt), `PUZZLE_PLATFORMER` + `jumpEnabled: false` (auto-bounce on landing), **`createNoteFirePlayer` music-drives-difficulty** (lead-track note density feeds spawn density), vertical-clamp camera, **3-character cosmetics + IAP**, `replay` stretch |

_More to come — see "Adding a new prompt" below._

## Adding a new prompt

1. Create `<slug>.md` in this directory (e.g. `top-down-dungeon.md`).
2. Follow the structure of `simple-platformer.md`: concept → tech stack &
   exact-version install (root-barrel import) → determinism rules → **engine module → game
   system map** → per-system specs → acceptance criteria (incl. the
   no-reimplementation checks). Compile the claimed public imports in a clean,
   strict TypeScript consumer project.
3. Add a row to the table above with the genre and the engine pillars it
   stresses — pick game ideas that **differ in which pillars they lean on** so
   the catalog collectively exercises the whole engine (e.g. a top-down roguelike
   stresses `cosmetics`/`iap`/`save` + procedural generation; a rail-shooter
   stresses `drawTiledParallax` + `sampleConeVelocity` projectiles; an idle game
   stresses `save` + `entitlements`; a demake stresses the rendering primitives
   under extreme constraint).

## Candidate ideas (not yet written)

- **Top-down dungeon roguelike** — seeded room generation, `cosmetics` skin
  unlocks, `iap` dev adapter, `save` runs; projectile + melee enemies.
- **Endless runner** — `drawTiledParallax` at its purest, `advanceLocomotion`
  single-direction, obstacle `aabbOverlap`, ramping difficulty via seed.
- **Boss-rush / bullet-hell** — `sampleConeVelocity` bullet patterns, `sineShake`
  heavy use, `createEmitter` for explosions, hit-stop on every hit.
- **Fishing / cozy sim** — `generateWaveLine` water as the star, `spring` rod
  physics, `particles` for ripples/splash, `save` for the collection log.
- **13k / demake** — the engine under a byte budget; stress-tests the
  "ultra-minimalist" rendering primitives (`outlineRect`, `pixel`, `rng`).
