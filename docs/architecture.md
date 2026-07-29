# Architecture

## Layer separation

The library mirrors Spitekeep's layer discipline. Code is split by what it may touch:

| Layer | May touch DOM? | May use `Math.random`? | May have side effects? |
|---|---|---|---|
| **Deterministic core** (rng, particles-advance, cosmetics-ownership, iap-entitlements) | No | No | No |
| **Renderer-adjacent** (primitives, particles-spawn helpers, `animation/rig.ts` derived caches) | Reads `CanvasRenderingContext2D` passed in; no global DOM | Yes, only if result never feeds back to sim | No **simulation**-state mutation (rendering-output buffers may be mutated in place; see below) |
| **Host-touching** (motion-probe, iap-adapters) | Yes (lazy + cached) | n/a | Yes, but always defensive (never-throw, swallow errors) |

A consumer's deterministic core (e.g. Spitekeep's `src/core/`) may freely import from this library's deterministic core. A consumer's renderer may import anything.

**Renderer-output buffer exception.** Renderer-adjacent code may mutate its own rendering-output buffers (e.g., the world-space transform / position / rotation caches in `src/animation/rig.ts`) in place, provided those buffers are never read by deterministic simulation logic. Authoritative simulation state remains pure-clone per the pure-progression-ops discipline below. This is the only relaxation of "no state mutation" and applies solely to derived/cached rendering data that is recomputed from authoritative input each frame — not to authoritative pose or simulation state.

### Terrain and level-theme boundary

`src/terrain/` owns reusable visual geometry: prepared tile connectivity,
visible ranges, rectangle exposure, normalized materials, and leaf tile/rectangle
draw functions. It knows nothing about cameras, editor modes, level entities, or
built-in theme families.

`src/platformer/level-theme.ts` is the composition boundary. A
`LevelRenderTheme` is normalized once, then `prepare(level)` captures the
level-dependent connection table and static exposure. Each frame supplies the
authoritative world view and resolved runtime entity rectangles. Drawing never
mutates or advances simulation state.

The facade exposes separate background, terrain-tile, terrain-rectangle, entity,
decoration, foreground, and tint passes. `drawPreparedLevelFrame` supplies the
standard ordering and a snapped world transform, while consumers retain explicit
hooks for actors, projectiles, effects, and HUD. Leaf imports remain valid:
consumers may use `drawTerrainRect` without importing the theme facade, tile
renderer, surface-detail catalog, or built-in themes.

## Determinism rules

1. **No `Math.random`** in any function whose output influences game state, save data, or cosmetic manifests. Use `src/rng/mulberry32.ts` instead.
2. **No `Date.now()`** or wall-clock reads in deterministic code. Take `tick` or `dt` as a parameter.
3. **No global mutable state** in deterministic functions. Pure functions only.
4. **No DOM reads** in deterministic code. Pass viewport / DPR / motion preference in as parameters.
5. **Renderers may relax rules 2-4** only when the result cannot leak back into the simulation. Spitekeep's screen-shake `Math.random` is the canonical example (`renderer.ts:91-93`).

## Adapter pattern

Inspired by Spitekeep's `SaveStorage` (`platform/types.ts:72-75`). All host-touching functionality uses the same shape:

```ts
interface SomeAdapter {
  // capability methods
}

function createHostAdapter(): SomeAdapter {
  // lazy host-API resolution
  // swallow all errors
  // fall back to in-memory implementation
}
```

Public APIs of adapters **never throw**. They degrade gracefully. This makes them safe to call from deterministic code (the adapter call itself is a side effect, but it can't crash the sim).

## Pure progression ops

Mirrors Spitekeep's `platform/progress.ts`. Any function that mutates logical state (entitlements, ownership, settings):

1. Takes the current state as input.
2. Returns a brand-new state object (via JSON-clone or shallow copy).
3. Never mutates the input.
4. Never throws.

```ts
function grantEntitlement(save: SaveData, sku: string): SaveData {
  const next = JSON.parse(JSON.stringify(save)) as SaveData;
  // ... mutate next ...
  return next;
}
```

## File layout

```
src/
├── index.ts              # Top-level barrel (re-exports every shipped module below)
├── primitives/           # color, outline-rect, pixel/DPR snapping, motion probes, glow, parallax, hit-stop, bitmap font, wave-line
├── rng/                  # seeded mulberry32 PRNG, distributions, stateless visual addresses
├── particles/            # deterministic spawn/advance/cull/step + emitters + presets
├── animation/            # skeletal rig, IK (limb/ccd/fabrik), locomotion, squash/stretch, springs, spring-rod, spider
├── easing/               # Penner curves + stateless tween driver
├── collision/            # AABB, per-axis resolve, tile-grid, moving-gap platforms
├── camera/               # follow camera (lerp, clamp, snap)
├── input/                # edge accumulator, keyboard/touch/gamepad adapters, OR-merge
├── game-loop/            # fixed-step accumulator, defensive RAF adapter
├── game-state/           # pure dt-driven FSM reducer + adjacency table
├── audio/                # WebAudio synthesized SFX adapter
├── music/                # procedural step-sequencer (theory, patterns, advanceSequencer, createSequencer, createNoteFirePlayer)
├── save/                 # defensive localStorage/memory save backends
├── blend/                # pose interpolation (blendPose/blendPoses)
├── palette/              # OKLCH substitution, harmonic generation, WCAG contrast repair
├── cosmetics/            # versioned manifest, seeded variant generation, multi-slot ownership
├── iap/                  # IAP bridge + adapters + entitlements
├── level/                # versioned platformer level schema, migration, validation, tile queries
├── terrain/              # connectivity/exposure preparation, materials, surface detail, tile/rect renderers
├── platformer/           # kernel/runtime, theme facade/layers, semantic art, preview/thumbnail helpers, leaf themes, enemies
├── editor/               # headless level-editor core (ops, history, selection, snapping, clipboard, catalog, playtest)
├── collectibles/         # pure-progression CollectibleSave + deterministic derivePickups
├── replay/               # record/playback + 32-bit replayHash fingerprint
└── tests/                # *.test.ts, vitest node env
```

_Planned: `fake3d/` (Pillar 4 — Sokpop-inspired billboarding/isometric/cube). Not yet implemented._

Each module ships with its own `index.ts` barrel. Tests live in `src/tests/<thing>.test.ts`.
