# Game prompts for `aicraft-engine`

A catalog of build-briefs (prompts) for games built **on top of** the
[`aicraft-engine`](https://www.npmjs.com/package/aicraft-engine) library. Each
file is a self-contained prompt — paste it to a coding agent (Claude / Cursor /
etc.) and it produces a runnable game that imports everything from the engine
and writes no re-implementations of what the engine already provides.
Every prompt pins the latest registry-verified release exactly — currently
`aicraft-engine@0.4.0`.

The common contract every prompt here enforces:

- **Fixed-step sim** via `createGameLoop` (60 Hz, input polled once per step).
- **No `Math.random` / `Date.now` in the simulation** — seeded `mulberry32` only.
- **Defensive host access** through the engine's adapters (audio, motion, dpr).
- **Reduced-motion** gate (static frame, no loop).
- **Zero hand-rolled** reimplementations of the engine's primitives (the
  acceptance criteria grep for `requestAnimationFrame`, `Math.random` in `step`,
  manual AABB, and duplicate tile-grid traversal). Renderer callbacks required
  by APIs such as `drawTileGrid` and `drawTiledParallax` are explicitly allowed.

## Prompts

| Game | File | Genre | Engine pillars exercised |
|---|---|---|---|
| **Embertomb** | [simple-platformer.md](./simple-platformer.md) | Side-view platformer | loop, input, tile/AABB collision, camera, hit-stop, squash, locomotion, foot-plant audio, jump, **spring rods**, particles, emitters (lava/water presets), wave-lines (water+lava), parallax, glow, palettes, RNG level-gen |
| **Celerock** | [celerock.md](./celerock.md) | Single-screen precision platformer | **platformer kernel** (`defaultPrecisionPipeline`: jump + wall-slide + dash), `compileLevel` + `drawTileGrid` + `drawActor`, **collectibles** (`collect`/`hasCollected`), `save`, bitmap text, hit-stop + sineShake, tween, parallax |
| **World 1-1** | [world-1-1.md](./world-1-1.md) | Horizontal-scrolling classic platformer | **platformer kernel** (`CLASSIC_PLATFORMER`: jump, no double-jump), hand-authored `LevelData` + `validateLevel`, unified `compileLevel`, moving platforms, parallax, collectibles + save |
| **Flipside** | [flipside.md](./flipside.md) | No-jump gravity-flip explorer | Signed-gravity controllers with empty ability pipelines, unified tile compilation, and fixed-step `advanceSequencer` events rendered by `createNoteFirePlayer` |

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
