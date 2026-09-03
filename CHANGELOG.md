# Changelog

All notable changes to `aicraft-engine` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **RPG module (`src/rpg/`) — a zero-asset, top-down monster-tamer vertical slice** (170 dedicated tests + starter game): explore → talk → tall grass → encounter → fight → weaken → capture → XP → heal → save → reload, authored primarily as data. Design record: `docs/design/rpg-kernel-decision.md`; full plan and milestone audit: `RPG_STARTER_PLAN.md`.
  - **Serializable RNG streams** — `src/rng` gains a pure-state Mulberry32 API (`createRpgState`/`advanceRng`/`nextRngInt` over a one-word `SerializableRngState`) byte-identical to the closure (one shared internal step, known-answer vectors pinned), plus `deriveSeed` for simulation stream addressing. `deriveSeed` domain-separates from `deriveVisualSeed`, so a decorative seed can never alias a battle roll.
  - **Overworld kernel** — four-direction tick-counted grid movement (facing updates on blocked attempts, exactly one `stepCompleted` per arrival, arrival priority warp → heal → encounter zone), never-throw map/catalog validation with paths like `maps[field].warps[door].targetAnchorId`, whole-world BFS verification across warps, and a seeded two-map world generator with carved guaranteed paths and deterministic corridor repair.
  - **Content compilation** — one JSON bundle (types/moves/species/items/encounters/dialogues/maps) validated for ids, integer ranges, weights, every cross-reference, the complete 2/1·1/1·1/2 effectiveness matrix, dialogue reachability, and terminal-effect ordering; immutable indexed result plus a canonical FNV fingerprint that saves and traces bind to.
  - **Procedural creatures** — six species from original syllable grammars (reserved-name blacklist with deterministic reroll), five body-plan grammars with index-locked feature counts so species sharing a plan always differ structurally, exact 48-point stat budgets (8–16 each, envelope-pinned), and serializable visual manifests.
  - **Battle kernel** — pure 1v1 wild battles with an exact legal-command reader (`getBattleRequest`) and revalidated commands; fixed versioned RNG draw budgets (fight 8 / catch 4 / switch 3 / flee 4, zero for forced/rejected), integer-only math with explicit floor points, capture/flee escalation, forced switches, and rewards applied exactly once. Golden transcripts (`scripts/gen-rpg-golden.mjs`) pin exact event sequences; regenerating is an explicit rules-version decision.
  - **Session facade** — `createRpgState`/`createRpgController` with a discriminated activity union (overworld/dialogue/battle/transition, each non-overworld variant owning its `returnTo`), defeat recovery to the last heal anchor, and effective party/inventory readers for the battle-snapshot authority rule.
  - **Saves** — idle-overworld-only projection, migration ladder, fingerprint/rules-bound validation, restore, and canonical hashing; save/restore continuation equals the uninterrupted run.
  - **Procedural presentation** — themed Canvas2D renderers (map/actor/creature/dialogue/battle/HUD; WCAG-AA panel text; reduced-motion freeze; decorative animation from visual seeds + presentation tick only), an event-driven battle presentation queue whose skipping provably cannot change simulation state, and 12 synthesized audio cues with silent-failure contracts. `npm run rpg:sheets` writes deterministic contact sheets to `benchmarks/rpg/`.
  - **`games/rpg-starter/` — "Meadow Tamers"** — a real consumer of the root barrel: vite + vitest, zero asset files, shared `createStarterGame` wiring driving both the browser entry and headless full-loop tests (loop twice → identical final and save hashes). Production bundle: 83.6 kB / 27.5 kB gzip including the engine.
  - **Clean-room 20-minute claim: not yet performed.** Per the plan's timing protocol this is a recorded, independent-agent gate; until it is run (up to three attempts per release cycle), the "in 20 minutes" video claim must not be used. Technical release gates are unaffected.
- **`PlatformerConfig.wallJumpAlwaysAway` (physics v15) — opts the grab-less wall-jump into Celeste's ACTUAL rule instead of this engine's own physics-v13 variant, on two axes.** v13 deliberately made a wall-jump press made while still holding into the wall launch straight up (chimney-climbable) rather than being flung away, and required having actively engaged the wall-slide (falling, holding into the wall) before any wall-jump could fire at all — both are this engine's own additions, not Celeste mechanics. Real Celeste's `WallJump(dir)` (`Player.cs`) pushes away from the wall unconditionally regardless of held input, and its jump handler checks `jumpGraceTimer > 0` (ground/coyote) first, falling through to pure wall-proximity (`WallJumpCheck(dir)`, either side, no held-direction/vy requirement) only when that fails — so a normal ground jump taken beside a wall, followed by a second press while still airborne and beside it (rising or falling), wall-jumps away without ever having slid. `wallJumpAlwaysAway: true` restores both: the unconditional away push, and the proximity-only fire path (mirrored via the shared `locomotion.coyoteTimer` so it correctly yields to an available ground/coyote jump, since `wallJump` outranks `jump` in this engine's launch-priority arbitration). The grace-window away leap and the wall-grab ability's climb-hop/climb-jump direction branch are unaffected. Default `false` preserves v13/v14 trajectories exactly. `createPrecisionPlatformerConfig` gains a matching override option. Exercised in `platformer-wall-slide.test.ts`.

## [0.23.0] - 2026-08-29

### Added
- **Terrain pieces (`src/terrain-art/piece.ts`, `src/terrain-art/piece-render.ts`) — a terrain fragment rendered as a *finished object* rather than a sliced rectangle** (69 tests). When a platform splits or breaks apart, the newly-exposed ends must resolve to end-cap tiles instead of showing the raw cross-section of a filled rect. This is the **rendering** sibling of `collision/moving-gap`: that module decides which solids exist, this one decides how the exposed ends are drawn. Two consumers justify the primitive — capped ends on opening hidden pits, and crumbling terrain — so motion never enters the module: a piece bakes to an offscreen canvas and the caller supplies the transform, exactly as `moving-gap` separates gap motion from gap geometry.
  - **Bonded vs free sampling** — `resolveTerrainPiece` / `resolveTerrainPieceFromPrepared`. `'bonded'` samples the global field so a closed pit's seam vanishes into the surrounding floor; `'free'` samples only the piece so every exposed face caps. Neither needed new resolution code: `prepareTerrainArtRuleGrid` already clamps out-of-bounds neighbours to `0`, and `0` is air — which is precisely what makes a boundary cell cap. Policy is chosen by **motion family**, not once per piece: the same geometry wants `'bonded'` when eroding in place (it never moves, so its outer end stays welded to its neighbour) and `'free'` when sliding or falling. Prefer the `FromPrepared` form whenever several pieces share a field — the convenience form re-resolves the whole field per piece.
  - **`rectsToTileGrid`** — the rect-list → `TileGrid` rasterizer the engine previously lacked. A cell is solid iff a rect covers its **centre**: exact for grid-aligned input, and stable otherwise where *any-overlap* over-covers and *full-coverage* drops a half-cell ledge. Returns `unalignedRects` / `skippedRects` as first-class diagnostics rather than logging, because under the centre rule a rect thinner than half a cell renders nothing and a level quietly losing thin ledges is hard to trace back.
  - **`bakeTerrainPiece` + `createTerrainPieceCache`** — bake once, draw forever. The cache is invalidated by an `fnv1aHash` topology fingerprint rather than caller discipline: `createLdtkLevelSurfaceCache` can ask consumers to `drop` after edits because levels change at authoring time, but a terrain piece flips bonded→free the exact frame a pit opens, every time, and a missed `drop` would paint caps on a still-closed pit. Piece **position** is excluded from the fingerprint, so moving a piece never rebakes it. Reference identity is checked before hashing, so a caller re-resolving every frame still bakes exactly once; `bakeCount()` keeps the invariant observable.
  - **Two readings of shrinking motion, separated by one offset.** `drawClippedTerrainPiece` translates the piece so it reads as *sliding into a wall* (surviving art is its far portion, where the free end's cap lives). `drawMaskedTerrainPiece` applies the same clip with no offset, so the texture stays **pinned to the ground** and the end is *eroded in place* — the shape crumbling terrain wants. Both collapse shrinking into rigid motion, removing the only case that would otherwise need per-frame re-tiling.
  - **The eroding cut's cap is an optional overlay, off by default.** A body's own cap sits at its original end, so a mask eats it first; passing `cap` draws a one-tile strip — baked once — at the moving boundary inside the same clip. Left off, the cut stays raw, which is usually right for fracture: a bevelled cap reads as *finished* where a raw cut reads as *freshly broken*.
- **Showcase section `#terrain-piece`** — a platform eaten away from the middle, with and without the cap, plus the rigid-translate family for contrast. Tiles are painted procedurally at runtime from a 16-rule edge-mask set, so the demo cannot lean on flattering art.

### Notes
- Placement deviates from the originating spec, which asked for this beside `collision/moving-gap.ts`. `src/collision/` has zero imports from outside itself and zero canvas references; all of this module's dependencies live in `terrain-art/` and the bake needs Canvas2D, so landing it in `collision/` would have inverted the dependency direction. A `@see` in `moving-gap.ts` covers discoverability. Full rationale and the other rulings: `docs/design/terrain-piece-decision.md`.
- **Known gap:** `TerrainArtRuleAtlasEntry.mirroredX` is still always `false` and no resolver sets it. Both the tests and the showcase author two cap tiles rather than mirroring one, so a rule set that relies on `flipX` mirroring exercises an untested path.

## [0.22.0] - 2026-08-24

Sourced from an audit of **Celerock-6** — a fresh single-shot build from the corrected 0.21.1 brief — against the polished **Celerock-5**. The 0.21.1 brief corrections held (structure ~90% compliant, golden paths verbatim), but the build still shipped every effect at 60× speed, a snow layer simulated but never drawn, a footstep cue consumed before it was produced, a respawn that dropped its facing — under a 34-test suite where zero tests imported game code. Documentation did not save it twice; this release converts the recurring defect classes into API shape, tuned data, and fail-loud checks.

### Added
- **Tuned one-shot burst effect presets (`src/particles/effects.ts`) — game-feel moments, not emitters.** `DASH_TRAIL_EFFECT`, `LANDING_DUST_EFFECT` / `LANDING_DUST_HARD_EFFECT` (buoyant, hangs at the feet, color-fades as it dies), `PICKUP_SPARKLE_EFFECT`, `GEM_AMBIENT_SPARKLE_EFFECT` (weightless twinkle for the id-staggered ambient period), `DEATH_BURST_EFFECT`, `RESPAWN_FLASH_EFFECT`, `SWEAT_DROP_EFFECT`, plus the `RadialBurstEffect` / `ConeBurstEffect` spec types. All tick-unit, all paired with `DEFAULT_PARTICLE_AIR`, all played in a shipped build — authoring px/s against the px/tick solver is over: spread the preset, pass the seeded `rng`. `SpawnOptions` correspondingly gains optional `gravityScale` / `dragScale` (stamped onto every emitted particle) so a radial preset spreads into `spawn` whole instead of `.map(p => ({ ...p, gravityScale }))`.
- **Dev-time plausibility guards (`src/particles/plausibility.ts`) — the units trap, made loud.** `spawn` and `sampleConeVelocity` warn ONCE per process when a speed exceeds `IMPLAUSIBLE_SPEED_PX_PER_TICK` (12 ≈ 720 px/s at 60 Hz — a px/s-authored `14` trips immediately) or a life exceeds `IMPLAUSIBLE_LIFE_TICKS` (600 = 10 s — the seconds-valued-life signature); the message names the likely unit error and the presets. Warn, not throw — a legitimate large-scale scene may exceed a room-scale game's ceiling; both thresholds are exported for a game to document its own.
- **`Particle.colorEnd` — engine-owned color-over-lifetime.** `spawn` accepts `colorEnd`, `advance` preserves it (the explicit field list grows one entry), and the new `particleColorAt(p, fallback?)` reader (`src/particles/lifetime.ts`, built on `mixHex` with pre-checked endpoints so it never throws) lerps `color` → `colorEnd` by age — dust that greys out, embers that cool. This retires `recipes/particle-color-fade.ts` (deleted per the governance ladder: the field, the carry-through, and the reader are all engine-owned now; the recipe existed precisely because `advance` dropped the tag).
- **`createPlatformerState` gains a `facing` parameter** (6th positional, `1 | -1`, default `1`). The respawn contract: a build stored the seam-entry facing on its anchor and rebuilt with the default — every leftward room entry respawned facing right, into the wall it came through. The anchor rebuild is now `createPlatformerState(anchor.x, anchor.y, config, w, h, anchor.facing)` instead of a hand-spread.
- **`recipes/feel-effects.ts` — the one-shot feel kit as copy-in wiring** (12 tests): the tuned burst spawn sites over the engine presets, the gem-sparkle id-stagger scheduler, the dash-afterimage ring buffer (`createAfterimageTrail` / `recordAfterimage` / `afterimagesFor` / `clearAfterimages` — past poses drawn back as ghosts), and one shared step (`stepSeconds` + air) / draw (`colorEnd` + alpha fade together, raw world coordinates) pair. The polish layer that previously only existed inside a hand-tuned build ships as wiring.
- **`recipes/game-test-harness.ts` — testing GAME code under Node** (10 tests): `createRecordingContext2D` (a Proxy-based recording stub — run the game's real draw code and assert the emitted ops: the snow layer, the world-space draws), `stubCanvas` / `stubCanvasWithRecorder`, `scanForbiddenIdentifiers` (the §12.8 static-contract greps as a testable function — defaults `Math.random` / `Date.now` / `requestAnimationFrame` / `fillText`, configurable, excludes `src/recipes/` copy-ins), and `missingShotManifest` (the §13 QA gates made fail-loud — a build shipped a hot-reload gate screenshot its QA script silently never produced; wrap the manifest in a test and the gate cannot vanish). Born from the audit's headline finding: a green engine-only suite verifies nothing about the game.

## [0.21.1] - 2026-08-21

A docs + recipes maintenance release — **no engine API change** — sourced from a multi-review audit of `games/celerock.md` (the reference brief for the modern golden path) cross-verified against `src/`, `recipes/`, and the shipped asset pack.

### Added
- **`recipes/image-decoder.ts` — the shared, bounded, never-throwing image decoder** (11 unit tests). Two exports because the two call sites differ: `decodeImageBounded(url, opts?)` is the URL-facing loader `recipes/sprite-sheet-boot.ts` takes as its `decodeImage` option, and `decodeImageBytesBounded(bytes, opts?)` is the bytes core `loadLdtkProjectAssets({ decodeImage })` adopts with a one-line wrap. The celerock brief's §4.4 referenced a `decodeImageBounded` nothing supplied — the golden LDtk path applies bounded decode internally and never makes a game write one, and the sprite path shouldn't either. Host-defensive (bitmap path → `<img>` + object-URL fallback → `undefined`), timeout-guarded so a hung decode can never hang boot.

### Fixed
- **`recipes/ldtk-draw-pipeline.ts` no longer teaches a forbidden pattern.** Its `worldOffset` doc and example said "feed your camera transform's x/y" — exactly the camera-offset-as-`worldOffset` double-count the celerock brief's §12.8 forbids. `worldOffset` is now documented as a room's own origin WITHIN world/slide space (a §5.5 slide's `sourceOffset`/`destinationOffset`), with the camera composed once via `composeCameraTransform`.
- **`recipes/platformer-input.ts` JSDoc** now maps the touch set's POSITIONAL `PolledEdge[]` to action names before `mergePolledEdgeMaps` (merging the raw array would use array indices as action names — the adapter's `poll()` returns an array, not a record).
- **`recipes/particle-color-fade.ts`** parameter renamed `dt` → `dtTicks`, matching the 0.21.0 `advance` rename; JSDoc notes the seconds-facing `advanceSeconds` pairing.
- **`games/celerock.md` — the audit pass itself (~50 corrections in four commits):** snippet bugs a builder would copy verbatim are fixed structurally (the room transition is now transactional — candidate state committed only inside `begun.ok`, with `slide.particleRebaseDelta` actually applied; multi-gem pickup accumulates and persists once; the touch merge is an eight-button positional map including pause; §5.7 hot reload validates the whole replacement world severity-aware and clears the seam-apron cache, whose handle the old snippet destructured away; `project`/`rooms`/`active` are `let` — the consts were a strict-TS compile break). Stale instructions are gone (the `fitCameraZoom` slide-lens regressions, the retired rect-key entity-art index, `settlePlatformerToRoom`, the false Enter/Space confirm claim, the three-way reduced-motion audio conflict — now uniformly "no adapter, no ambience"). And the **living-file restructure**: room counts, sizes, identifiers, and entity tallies are the `.ldtk`'s state, not the brief's facts — the verify block and §12.1 assert structure (≥1 level, ≥1 spawn, uniform tile size, one connected chain with a UNIQUE east-terminal reachable from the start) and log the rest; `spawnLessRoomIids` is asserted as a set, never `levels.length − 1` arithmetic. The §1 import block gains the five symbols its own snippets call (`createSeamApronCache`, `seamApronSourceFromSolidId`, `DEFAULT_PARTICLE_AIR`, `spriteAnimClipFor`, `createSpriteTintCache`), and the recipe catalog gains `fixed-tick-game`, `image-decoder`, `ldtk-draw-pipeline` (full painter migration — no raw-cache hybrid), and `ldtk-entity-tile-art` (falling blocks bake terrain-like art with the project's own auto-rules instead of a placeholder rectangle).

## [0.21.0] - 2026-08-21

### Added
- **`recipes/` — the structured home for reusable game wiring (compiled + tested, shipped in the npm tarball).** Build briefs used to inline the same TypeScript wiring sketches by hand (audio unlock-on-first-gesture, the reduced-motion-gated fixed-tick boot, the sprite slot→cell mapping, re-stamping particle `colorEnd` after every `advance()`, the LDtk surface-cache draw pipeline, the room-slide one-room letterbox aperture); eight briefs carried eight independently-drifting copies, and a real build (Celerock, 0.20.0) hit ~14 brief-vs-API drifts before writing any game code. Recipes are copy-in consumer modules (they `import` from the `aicraft-engine` root barrel exactly as a game does), typechecked against live `src/` on every commit (`npm run typecheck:recipes`, chained into `npm run build` via a `paths` alias) and unit-tested in the root Vitest run (`recipes/tests/`). Governance: a sketch reusable by more than one game becomes a recipe; a recipe two shipped games import verbatim is promoted to a first-class export (`docs/conventions.md`, `recipes/README.md`). `games/simple-platformer.md` migrated as the first consumer — its loop gate, audio unlock, and particle-fade guidance now reference recipes by name instead of inlining sketches.
- **Two recipes sourced from the Celerock-5 particle/falling-block fix pass.** (1) `recipes/particle-system.ts` — `createParticleSystem({ fixedDt })` owns the seconds→ticks conversion for the tick-unit particle pillar; the build passed its fixed step's SECONDS `dt` straight into tick-unit `advance`, so life burned 60× too slow and every effect drifted for most of a minute ("particles shooting off across the screen") — the unit was documented and documentation did not save it. The recipe's API takes seconds and converts internally, applies a shared air medium (`DEFAULT_PARTICLE_AIR`, with per-effect `gravityScale`/`dragScale` profiles), and warns once if handed a dt that looks like ticks. (2) `recipes/ldtk-entity-tile-art.ts` — `bakeLdtkEntityTileArt` bakes a terrain-like LDtk ENTITY's art with the project's own auto-rules: the footprint stamped IN-CONTEXT into the room's real IntGrid (an isolated grid autotiles as all-fill under `outOfBoundsValue` rules), `runLdtkAutoLayer` windowed to the footprint, tiles blitted with flip/alpha into one entity-sized canvas — the fix for the "falling block rendered as a hardcoded bordered rectangle" placeholder class. `games/celerock.md`'s dash-trail sketch — the exact line that taught the 60× bug — now converts inline and points at the recipe; its checklist gains the units contract.
- **Seconds-facing particle entry points — the recipe's ladder promotion into `src/` (`src/particles/seconds.ts`).** `advanceSeconds(particles, dtSeconds, opts?)` / `stepSeconds(...)` convert `dtSeconds / opts.fixedDt` (default `DEFAULT_FIXED_DT`) to the solver's tick units internally — a 60 Hz step is byte-identical to `advance(particles, 1)` — so the 60× seconds/ticks mismatch cannot happen at the call site. Plus `secondsToTicks(dtSeconds, fixedDt?)` (the pure conversion) and `DEFAULT_PARTICLE_AIR` (`{gravity: 0.1, drag: 0.9}`, the shared air medium in tick units). The tick-facing signatures renamed their parameter `dt` → `dtTicks` (`advance`/`step`/`advanceEmission`/`stepEmitters`; positional, non-breaking) with the unit stamped in every JSDoc — the parameter name now carries the contract. `recipes/particle-system.ts` remains as the documented back-port for briefs pinned to pre-promotion engine versions.
- **Hit-stop units guard (the same mismatch class, fail-fast).** `triggerHitStop` now THROWS on a positive non-integer duration: durations are WHOLE ticks, and `0.1`-meaning-100 ms would have frozen for a single tick and vanished silently — the error message names the correct value (`6` for ~100 ms at 60 Hz), same self-healing discipline as `spawn`'s jitter-without-rng throw. Also fixed the two doc sites that TAUGHT the bug: `stepHitStop`'s `@param` said "pass the sim's fixed dt" (a seconds dt would stretch a 6-tick freeze into ~6 seconds), and the module-header example passed the seconds `dt` into both `stepHitStop` and the tick-unit particle `step` — the example now uses `stepSeconds` and one-tick decrements.
- **Celerock brief migrated to recipes — four new extractions from its remaining inline wiring.** A block-by-block pass over `games/celerock.md`'s 26 code sketches classified each as reusable wiring vs game-specific design; the reusable wiring became recipes and the brief now references them by name (§1 lists the full set): **`platformer-input.ts`** (`derivePlatformerInput` — the merged-edge → `PlatformerInput` derivation), **`sprite-sheet-boot.ts`** (`loadSpriteSheetAssets` — the defensive PNG+JSON → parse → compile → clip-lookup boot, `null` on any failure; tested against the real `games/Player.json`), **`ldtk-hot-reload-plugin.ts`** (`createLdtkHotReloadPlugin` — the Vite dev-server watcher emitting `ldtk:update`; structurally typed, no `vite` dependency), and **`ldtk-entity-art.ts`** (`ldtkEntityTileOverride` — the `drawLevelEntity` override map over the engine-owned `entityArt` side channel, routing all 13 entity kinds). Three sections that had re-inlined their own copies of existing recipes were converted to references (§5.4's hand-derived aperture frame → `room-slide-aperture`, §4.4's slot→cell mapping → `sheet-frame-index`, §10's audio unlock → `audio-unlock`), and `audio-unlock` gained an `onUnlock` hook for the cue-gating pattern the brief teaches. What stays inline is game design, not wiring: the Celeste config, the anim-kind derivation, the render frame composition, the transition-session consume, and the FSM. With the release, `games/celerock.md` is repinned to `0.21.0` — its dash trail advances via the engine-native `stepSeconds(trail, dt)` (no inline conversion left to get wrong), the version-history and per-feature floor lists carry the 0.21.0 additions, and the recipes catalog is copyable from the installed tarball.

## [0.20.0] - 2026-08-20

Sourced from a line-by-line review of the reference Celerock build (the
"Celerock TAL") against `games/celerock.md`: every addition below deletes a
system that build had to hand-roll, and the brief is repinned to match.

### Added
- **Authored one-shot clips + per-clip pacing — `meta.frameTags` grows `loop`,
  `duration`, and `durations` (engine extensions; a strict Aseprite file is
  unchanged).** `compileSpriteSheet` hardcoded `loop = true` for every tag, so
  the verified jump feel — play 60→64 once, then CLAMP on the fall frame until
  landing — required hand-building the `CompiledAnim`, and a grid sheet played
  every clip at the 100 ms compile default, which reads as vibration on a
  two-frame clip (a real build did copy-on-write surgery on the compiled
  sheet's frozen `anims` map to re-pace idle). `loop: false` now compiles
  verbatim (the frame player already clamped); `duration` authors a uniform
  per-clip pace; `durations` authors per-frame pacing (parallel to the tag's
  range — a length mismatch or non-positive entry is a compile diagnostic,
  never a throw; the parse drops an invalid array whole rather than shifting
  positions). Precedence: `durations` over `duration` over the per-frame table.
- **The `climb` sprite kind — `SpriteAnimKind`/`SpriteAnimClip` gain `'climb'`,
  and `SpriteAnimInputs` gains `climbing`.** The kind system covered exactly
  idle/walk/jump, so a Celeste wall-climb clip needed a parallel hand-rolled
  animation clock (the reference build shipped a whole `climb-anim.ts` for it).
  `deriveSpriteAnimKind({ climbing: true, … })` returns `'climb'` with priority
  over the grounded/airborne branches (a cling is a cling while sliding), and
  `spriteAnimClipFor('climb')` maps it onto its own clip so the clock restarts
  entering and leaving the wall, never mid-arc. The parked-cling touch needs
  no API: advance with `dtMs = 0` while stationary. Widening the kind union is
  the only breaking edge (exhaustive switches on `SpriteAnimKind`).
- **`TriggerProps.fields` — authored LDtk field values as a first-class
  record.** Custom-entity recipes had to reach through
  `props.params.fieldInstances` for data the author placed in the file (the
  reference build read `(props.params.fieldInstances as …)?.tiletype` for its
  falling blocks). Every `trigger` translation now carries
  `fields: Record<string, unknown>` — the field values keyed by identifier,
  `__value` unwrapped — alongside the unchanged `params` (back-compat).
- **The FallingBlock recipe — `collectFallingBlocks` / `advanceFallingBlocks`
  / `fallingBlockSolids` / `fallingBlockArmed` / `FALLING_BLOCK_TUNING` /
  `scaleFallingBlockTuning` (`platformer/falling-block.ts`).** The Celeste
  prologue ceiling block as a pure state machine, ported from the reference
  build's game-side module: arms on X-only footprint overlap (wider than
  `IntroCrusher`'s centre band), shakes 0.2 s, a 0.4 s grace window that keeps
  extending while the player stays under (the fall is committed either way —
  `FallingBlock.cs Sequence()` semantics), falls at accel 500 px/s² to a
  160 px/s cap, lands FLUSH on statics and on landed blocks, and reports
  `armed`/`released`/`landed`/`crushed` events for the game to score.
  `collectFallingBlocks` consumes LDtk `FallingBlock` trigger entities through
  the new `props.fields` (`tiletype` material); `scaleFallingBlockTuning`
  rescales the distances/velocities for non-8px rooms (times never scale).
- **The multi-device input merge — `mergeEdges` / `mergePolledEdgeMaps`
  (`input/merge.ts`).** Every multi-device build hand-rolls the
  keyboard+gamepad+touch cascade. `mergeEdges(...edges)` is the variadic
  `orEdges` (zero sources → the idle edge); `mergePolledEdgeMaps(...maps)`
  merges the `poll()` records of every adapter into one record over the union
  of actions — the documented `PlatformerInput` recipe becomes three lines.
- **Frozen-map extension — `extendKeyboardMap` / `extendGamepadMap`.** The
  standard maps ship deeply frozen (deliberately), so a build adding one key
  (gamepad Start → pause) hand-rolled a shallow copy. Both extenders return a
  NEW frozen map with the additions winning on collision; the base is never
  mutated.
- **Menu navigation — `createMenuNav` / `advanceMenuNav` / `openMenuNav` /
  `clampMenuNavIndex` + `IDLE_MENU_INPUT` (`game-state/menu-nav.ts`).** The
  selection state machine every start menu and pause menu hand-rolls: a
  wrapped index, a confirm edge, an open-grace window (default 8 ticks) so the
  key that opened the menu cannot also confirm inside it, same-frame nav +
  confirm resolved as the DESTINATION entry, and opposing simultaneous presses
  cancelled. Presentation-free: rendering, muting, and FSM dispatch stay with
  the game (a pause menu is `menu-nav` + the `paused` FSM state driven by its
  outputs).

### Changed
- `docs/api-surface.md`: rows added for everything above, plus the 0.18.0
  seam-apron exports (`compileRoomSeamApron`, `createSeamApronCache`,
  `seamApronSourceFromSolidId`, `seamSpanFor`, `DEFAULT_SEAM_APRON_DEPTH`) and
  the `dash-tech-ability`, `climb-ability`, `wall-grab-ability`, and `mantle`
  modules, which the catalog had drifted past.

## [0.19.1] - 2026-08-19

### Fixed
- **Seamless long noise buffers — sustained voices stop sounding 1 Hz-periodic.**
  Both shared noise buffers (white and pink) were exactly one second, so every
  `startNoiseLoop` voice repeated its waveform every second — audible through
  any filter as a regular, industrial texture (a real build's wind read as
  machinery; the 0.19.0 random start-offset only ROTATES the loop and cannot
  change its period). Both buffers are now 10 s (~1.9 MB mono at 48 kHz per
  color, still built lazily once per adapter), with a seamless loop seam by
  equal-power crossfade: the fill generates L + F samples (F = 0.5 s) and folds
  the tail into the head with `√` weights, so the loop wrap continues the
  texture with no click (safe even under resonant Q filtering, where a butt
  joint rings) and no RMS dip. Equal-power, not linear, because the two folded
  samples are L seconds apart in the stream and therefore UNCORRELATED — whose
  powers add (linear weights dip −3 dB at mid-crossfade); for pink the tail
  must come from the end of the L+F generation, since ADJACENT pink samples
  are strongly correlated and folding those boosts the low-frequency content
  up to +3 dB instead of holding the level. The pink fill also warms the
  Kellet filter ~0.25 s before recording, so the loop body carries a settled
  −3 dB/octave spectrum from sample zero. Downstream effects at no extra API:
  the loop start-offset rotation now spans the full 10 s, and `playNoise`'s
  random-offset decorrelation range grows with the buffer — multi-second
  bursts de-correlate instead of falling back to phase-locked offset 0. No
  public API change; internal buffers only (a patch bump).

## [0.19.0] - 2026-08-19

### Added
- **The entity-art side channel — the engine supplies the entity↔art join it
  used to make consumers reconstruct.** `ldtkLevelToLevelData` now returns
  `entityArt: ReadonlyMap<EntityId, LdtkEntityArt>` next to `tileSemantics`,
  and `compileLdtkRoom` carries it onto `CompiledLdtkRoom.entityArt`. The map
  is built inside the translate loop that assigns the engine entity ids, so
  `room.entityArt.get(entity.id)` in a `drawLevelEntity` override resolves the
  instance's authored `__tile` plus its def's `tileRenderMode` and
  `nineSliceBorders` in one lookup — keyed by the id the engine itself
  assigned, which a consumer re-walking the raw layer cannot reproduce (one
  unrecognized entity silently shifts any reconstructed mapping). This retires
  the consumer-side rect-key index and both of its shipped failure modes: a
  room slide draws TWO rooms in one frame, so a single active-room index left
  the outgoing room's entities falling through to `DEFAULT_ENTITY_PALETTE`
  (hazards flashing red for the length of every transition), and because rect
  keys are room-LOCAL, two rooms sharing a local rect silently resolved each
  other's tiles rather than missing. The art travels with the room, so both are
  structurally impossible. An entry exists iff the entity translated AND has an
  authored `__tile` — a missing key means the engine shape (return `false`);
  `tileRenderMode` is `undefined` when the def cannot be resolved, which
  `drawLdtkEntityTile` treats as its geometry heuristic. New exported type
  `LdtkEntityArt` (`src/ldtk/translate.ts`).
- **`cameraRebaseDelta` on the room-transition session results — parallax
  backdrops stop teleporting at seams.** `beginSessionRoomSlide`,
  `advanceSessionRoomSlide`, and `endRoomTransitionSession` each report the
  camera-SPACE rebase they applied to the returned brain (the enter-rebase at
  begin, the finish-rebase on exactly the completing advance, the cancel-rebase
  at end; zero on refusal, active ticks, and idle calls). The world render
  compensates for space changes by construction, but any consumer of the RAW
  `brain.camera` — a parallax backdrop is the canonical one — teleports by the
  rebase distance at the seam while the world holds still. Accumulate the
  deltas and feed such consumers `brain.camera − accumulated`; in-room camera
  motion (including the eased slide pan) passes through untouched. Mirrors the
  existing `particleRebaseDelta`, which exists for the same class of problem
  on the particle side. A real build hand-diffed the brain before and after
  both calls to derive these numbers; the reported delta is that diff, owned
  where the rebase is.
- **The Celeste camera preset — the decompile-verified constants, shipped.**
  New `src/camera/celeste.ts`: `CELESTE_CAMERA_WINDOW` (the one-screen room,
  320×184 — the rectangle the lens fits), `CELESTE_FOLLOW_CENTERED` (the
  decompile's unconditional recenter; no deadzone) and `CELESTE_FOLLOW_AHEAD`
  (the authored-cameraOffset 1/3-pin framing), `celesteCameraZoom(viewport)`
  (the campaign-constant window fit — takes no room, so zoom cannot track room
  size), `celesteFollowMotion(zoom, dpr)` (half-life 0.15 s, the conservative
  1600 px/s cap, device-pixel snap), `celesteFollowVcam(id, options)` (the
  complete per-room follow vcam), and `CELESTE_ROOM_SLIDE_OPTIONS` (0.65 s
  under easeOutCubic, spreading into `beginSessionRoomSlide`). The module docs
  carry the full decompile reference table (file + line per constant) so the
  next build does not re-derive it. Alongside: **`devicePixelSnapThreshold(zoom,
  dpr)`** in `src/camera/motion.ts` — one device pixel in world units, the
  largest snap threshold a display cannot see; the fixed 0.5 world-px default
  lurches `zoom·0.5` device pixels at the terminal snap, visibly at zoom 3+
  (settles to near-stillness, then clicks into place — shipped by a real
  build). **Docs corrected:** `fit.ts` marketed `'cover'` as "the
  Celeste-compact-room policy" for the camera fit, and
  `DEFAULT_FOLLOW_BODY`'s deadzone as "Celeste-style" — neither is true
  (Celeste's lens never fits anything and its follow has no deadzone), and the
  mislabeling is what steered a real build into per-room fits it then had to
  undo. No behavior change in `fitCameraZoom` or the defaults.
- **Sustained-voice modulation — a noise loop's spectrum can finally move.**
  `NoiseLoopHandle` gains `setFrequency(freq)` and `setQ(q)`: anchor-then-
  `setTargetAtTime` with a ~50 ms time constant (the standard dezippering
  idiom — frequency steps zipper where gain steps hide behind the attack ramp,
  and the exponential approach makes the host's update rate irrelevant).
  Clamped to [10, 20000] Hz and [0.1, 20]; non-finite input ignored; no-ops
  after `stop()` and on inert handles, like every adapter method.
  `startNoiseLoop` gains an optional `NoiseLoopOptions` — `q` (biquad Q at
  voice start; Q > 1 narrows a bandpass into a resonant peak, which whistles
  and hums need and the WebAudio default of 1 cannot do) and `noise: 'pink'`
  (a −3 dB/octave buffer via the Paul Kellet economy filter, built lazily once
  per adapter — natural beds for wind/rain/surf, where white reads as hiss).
  Omitting the options reproduces prior behavior exactly. Why: every
  authoritative source on procedural wind says the perceptual core is a moving
  SPECTRUM — gusts brighten before they louden — and amplitude-only modulation
  (all the old API could do) reads as a volume knob. **One benign behavior
  change:** sustained voices now start at a random offset inside the looping
  buffer instead of sample zero — a rotation (a single voice is audibly
  identical; its spectrum is unchanged), but two concurrently running voices
  become time-shifted rather than the same correlated signal in parallel
  filters. Same rationale `playNoise` has had since 0.13.0.

## [0.18.0] - 2026-08-19

### Added
- **The seam apron — the floor across a linked seam exists in the collision
  set.** New `src/platformer/room-seam-apron.ts`: `compileRoomSeamApron(active,
  resolveNeighbour, { depth? })` rebases every neighbour-room static solid
  within `depth` px (default `DEFAULT_SEAM_APRON_DEPTH = 64`) of a FLUSH
  shared seam into the active room's local coordinates — flags preserved
  verbatim, ids namespaced `apron:<levelIid>:<originalId>` and reversible via
  `seamApronSourceFromSolidId`. `createSeamApronCache(resolveRoom)` memoizes
  per room (plus `drop`/`clear`), cycle-free by construction. The shared seam
  comes from `seamSpanFor`, now exported from `room-transitions.ts` (and the
  barrel): the exit poll and the apron use the ONE definition of "linked
  seam", so a partial seam's void band grows no phantom floor and an authored
  drop stays a drop. Why: a body leaving a seam ledge while falling stepped
  past the source floor's reach in the same tick it crossed, and the
  world-exact entry mapping preserved the overshoot as an embed that grows
  with fall speed (up to +2.34px at vy 300 — pinned by the new
  `room-seam-characterization.test.ts`). With the apron in the tick set, the
  kernel's own resolution lands every crossing flush at every speed: no
  tolerance, no correction. The new `room-seam-apron.test.ts` proves it over
  the real `games/celerock.ldtk` seam — the vy table reproduced flush, the
  hazard decision pinned (hazards deliberately do NOT ride the apron; at a
  seam, failing to kill is the safe direction), the adversarial authored
  drop, the guard-retirement scenarios, and a committed **1,548-crossing
  sweep** (43 offsets × 6 speeds × 2 directions × 3 poll orderings), all
  landing flush. The showcase ldtk-editor play loop now carries the apron.
  Design record: `docs/design/room-seam-apron-plan.md`.

### Removed
- **`protectGroundedRoomSlide` and `ROOM_SLIDE_SUPPORT_EPSILON`
  (`src/platformer/room-slide-safety.ts`) — removed; the seam apron replaces
  them.** The guard clamped a grounded actor to its support span and zeroed
  `vx`/`vy`, compensating for exactly the floor the apron now supplies; with
  the seam continuous, a grounded walk across keeps support AND momentum —
  strictly better than the clamp. `stabilizePlatformerRoomEntry` remains, at
  its 1px default: the float-noise guard at the mapping boundary, now rarely
  exercised. **Migration, both halves:** (1) add the apron to the per-tick
  set — `const apronFor = createSeamApronCache((iid) => rooms.get(iid)).apronFor;`
  then `[...active.solids, ...apronFor(active.ldtkLevel.iid), ...platforms]`,
  and pass `[...target.solids, ...apronFor(target.ldtkLevel.iid)]` as
  `destinationSolids`; (2) **delete any local fallback copy of the guard** —
  a shim of the form `engine.protectGroundedRoomSlide?.(…) ?? localFallback(…)`
  silently keeps clamping after the export disappears, invisible to the
  upgrade.

## [0.17.5] - 2026-08-18

### Added
- **`applyCanvasDprTransform(ctx, dpr)`:** the explicit screen-space boundary
  for a DPR-aware canvas. It replaces, rather than composes with, the current
  transform, so a HUD or menu cannot inherit a camera transform or be scaled
  by DPR twice after a world pass. Use the DPR returned by
  `resizeCanvasToBackingStore` before drawing screen-space UI.

## [0.17.4] - 2026-08-18

### Added
- **Room-slide render aperture:** `RoomSlidePresentation.aperture` is now
  separate from the two-room camera-clamp `bounds`, and
  `cameraApertureLetterbox` / `applyCameraApertureLetterbox` provide the
  centered mask for that aperture.
- **Generic seam safety:** `stabilizePlatformerRoomEntry` repairs sub-pixel
  support embedding without settling genuine airborne entries, and
  `protectGroundedRoomSlide` prevents a grounded actor from being carried off
  a short support surface while a slide is active.
- **`composeCameraTransform(ctx, transform)` — the world-space boundary as a named call.** `applyCameraTransform` already composed `scale` + `translate` in one step, but the published recipe for a level draw did the opposite: `ctx.scale(zoom, zoom)` alone, with the camera offset handed to the draw as its own `worldOffset` parameter. That works for every layer the engine draws and silently fails for every layer the consumer draws — nothing forces a hand-written particle, entity, or debug pass to receive the offset. A real Celerock build spawned its dash trail at correct world positions, drew it under the zoom alone, and shipped particles welded to the screen while the level scrolled behind them; the spawn coordinates were never wrong, so the obvious "fix" would have been the wrong repair. This is the second half of `applyCameraTransform`, split out because the result is often needed before the context is touched — the letterbox mask below needs `zoom` to place the level frame in screen units, and both have to agree on the same snapped offset. Compose once and `worldOffset` is left for its real job: a room's own origin *within* world space (a room slide's `sourceOffset`/`destinationOffset`), which composes on top rather than replacing the camera. Degrades a non-finite zoom/offset to an identity-safe composition. `applyCameraTransform` is now implemented in terms of it — no behaviour change.
- **`cameraLetterbox` / `applyCameraLetterbox` (+ `CameraLetterbox`, `CameraFrameRect`, `ApplyCameraLetterboxOptions`) — the contain-fit mask the fit helper never covered.** `fitCameraZoom(..., { mode: 'contain' })` guarantees the whole authored room stays visible, which necessarily leaves slack on one axis, and the engine said nothing about that slack. The consistent real-build outcome: backdrop painted across the entire canvas, world drawn unclipped on top, and the empty margin reads as playable level — reported as "the camera lets you see past the level" when the camera bounds were right all along. `cameraLetterbox(bounds, viewport, transform)` resolves the level's screen `frame`, the `clip` rect (frame ∩ viewport), and the 0–4 **disjoint** bars outside it (full-width top/bottom first, side bars spanning only the band between them, so a translucent fill never doubles); `applyCameraLetterbox` fills the bars and clips, mirroring `applyCameraTransform`'s compute-apply-return shape. Bounds accept a bare `{ width, height }` or a compiled LDtk room, the same duck-typing `fitCameraZoom` does, and they are the APERTURE — one room — never a room slide's union (see the aperture note below). Units are the caller's current transform (CSS pixels under `ctx.scale(dpr, dpr)`), computed BEFORE the zoom is composed — applying it under the zoom would square the frame. The fill is internally save/restored so `fillStyle` never leaks; the clip deliberately survives the call, because it is the point, and the caller's `restore()` owns it. Invalid bounds, a degenerate viewport, or a non-finite transform all resolve to a full-viewport frame with no bars: a masking helper that cannot compute its mask must never blank the game.

### Changed
- **The letterbox aperture is the ROOM, never a room slide's union bounds** (`cameraLetterbox` docs, `RoomSlidePresentation.bounds`, `games/celerock.md` §5.4 + criterion 20 + §12.2b). The union is the camera's CLAMP space — it spans both rooms, so a mask sized from it is roughly twice a room wide, exceeds the viewport, and every bar disappears for the length of the transition: the world fills the whole window and then snaps back when the slide ends. A real build shipped exactly that, on this brief's instructions. The window the player looks through does not change during a slide — the rooms move, the window stays put. The frame's POSITION cannot come from the slide camera either (it is sweeping through union space, so a camera-derived frame slides with it): during a slide, derive the frame from the room size and the viewport directly, which in the steady state is identical to the camera-derived one because the clamp centres a room smaller than the view. §12.2b now requires sampling the frame every tick across a full transition and asserting it never changes size — a single-frame test cannot see this class of bug.
- **`games/celerock.md` repinned to `0.17.4` with the render section rebuilt around one world transform (§5.4/§5.5/§9).** The brief's own recipe was the responsible layer for both defects above: it left the camera offset in a draw parameter and then handed off with `// ...player art, entities, particles, UI...`, and it described the contain-fit margin as "intentional letterbox space filled by the existing atmosphere/parallax pass" — an instruction that produces the unmasked-margin bug when followed literally. §5.4 now shows the full frame in order (clear → backdrop → `cameraTransform` → `applyCameraLetterbox` → shake → `composeCameraTransform` → tiles/entities/player/particles → restore → HUD), §5.5's slide comment states that the camera offset stays in the context while `worldOffset` carries only each room's slide-space origin (drawing at `sourceOffset` alone pins the view to the union's top-left for the whole slide — the same missing rule, and live in the same build), and §9's particle recipe names the transform it must run under. New acceptance criteria 20 and 21, two forbidden patterns (a world draw outside the composed transform; an unmasked contain-fit margin), a `12.2b` composition test whose camera is deliberately off the origin (every composition bug is invisible at `(0, 0)`), and visual gate 12 for camera-tracking. The rest of the catalog is repinned to `0.17.4` unchanged.
- **`games/celerock.md` §8 — the ending is now specified as an ending.** The terminal-room rule said "fire the chapter-complete card and transition the FSM however the game already handles completion", which a real build satisfied by drawing SUMMIT REACHED over a player who could still walk, jump, dash, and die on a spike underneath it. §8 now names the mechanism (`{ type: 'win' }` → `levelComplete`) and the four things that follow: the kernel is fed a NEUTRAL input rather than skipped (an arrival is airborne as often as not — skipping the sim strands the player mid-air, stepping it neutrally lets them land and settle); hazards, the void respawn, and the transition poll are all suspended, since each of them can undo the ending; the card must state its own exit (`quit` → menu) after a grace window, because locking input without one is a dead end needing a page reload; and the camera + sprite clock keep running, which is where a celebration animation slots in later. Acceptance criterion 15 rewritten, a `No playable ending` forbidden pattern (naming the frozen-mid-air and no-exit failures too), and visual gate 11 — hold every control at the summit and nothing moves. The optional celebration is noted in §9 with what the supplied `Player.png` actually contains: no authored victory row, so it needs new art rather than a repurposed cell.
- **Showcase (`sections/ldtk-editor/play.ts`) dogfoods the composition.** The play render was the engine's own demonstration of the pattern that broke the build — a scale-only world transform with `+ offsetX` re-added at fourteen call sites (mobs, sprite dest, body rect, outline). It now composes once and draws everything in raw world coordinates, and its cull rect comes from the snapped `t.view` instead of the pre-snap camera.
- **`fitCameraZoom` no longer throws on a non-object level.** Its dimension resolver (now shared with the letterbox helper) reads anything that is not an object as `NaN × NaN`, so an `undefined` room degrades through the documented invalid-dimensions path and returns `1` instead of raising a `TypeError`.

## [0.17.3] - 2026-08-17

### Fixed
- **Surface cache owns its smoothing (crisp levels under fractional zoom).** `LdtkLevelSurfaceCache.draw`'s single scaled blit of the baked room ran under the CALLER's `imageSmoothingEnabled` — every other pixel-art path in the engine guards its own (`drawLdtkLayer`, `drawSprite`, `drawLdtkEntityTile`), but the one draw whose entire job is a fractional-zoom resample did not. A consumer that never set the flag (canvas default `true`) got the whole level bilinear-blurred while sprites stayed crisp — exactly the "platforms are blurry" report from a real build. The blit now saves/disables/restores internally. Related trap now documented on the brief: assigning `canvas.width`/`height` resets ALL context state — the transform AND smoothing — so even a set-once-at-boot build silently re-blurs after its first resize. Regression-tested red/green: a 2.5x caller-scaled blit with caller-default smoothing must produce only pure tile colors (a bilinear resample yields blends), and the caller's own state must come back untouched.

## [0.17.2] - 2026-08-17

### Added
- **`canvasCssViewport(canvas)`:** the canvas's layout size in CSS pixels — the viewport unit the camera stack consumes, with the unit in the name so it cannot be confused with `canvas.width`. Exists because of the second DPR-composition trap (found in a real Celerock build): after `resizeCanvasToBackingStore`, `canvas.width`/`height` hold the DPR-MULTIPLIED backing store, and passing that as the viewport doubles the camera's assumed view on Retina — zoom and framing wrong by the DPR factor, while at `dpr === 1` the two coincide, so the bug ships invisible on a standard display and detonates on the first high-DPI laptop. Everything handed to `fitCameraZoom` / `updateCameraBrain` / `cameraTransform` must be CSS units (drawing runs under `ctx.scale(dpr, dpr)`; `cameraTransform` does its own device-grid math via `devicePixelRatio`). Defensively reads `clientWidth`/`clientHeight` with a backing-store/fresh-DPR fallback; host-touching, call at setup / on resize / top of render, never inside the fixed-step sim.

## [0.17.1] - 2026-08-17

### Added
- **`DrawSpriteOptions.snap` (default `false`):** rounds the sprite's destination coordinates before drawing (before the facing mirror, so mirrored sprites stay on the same grid). Pixel-art correctness under zoom — raw physics floats (a body's `x`/`y`) scaled by `ctx.scale(zoom, zoom)` land on fractional device pixels, and browser rasterizers antialias the image edge even under `imageSmoothingEnabled = false`: a shimmering artifact column tracking the fractional position, most visible mid-jump as `vy` sweeps fractions every frame. Found in a real Celerock build whose level seams were already fixed by `cameraTransform` (0.17.0) but whose sprite destinations were never pinned. Tested by the environment-independent contract — for a sweep of fractional destinations, `snap` renders pixel-identically to the direct integer call, with and without the mirror (node-canvas's Cairo rounds-to-nearest on its own, so the browser-only blur cannot be reproduced in CI).

## [0.17.0] - 2026-08-16

### Changed
- **Physics v14 — order-independent collision snap + spring auto-jump buffer.** `resolveAxisX/Y` re-snapped iteratively off the UPDATED position, making multi-overlap results array-order-dependent and letting an intermediate snap cascade the body through solids the original move never overlapped (a rightward nudge could eject the body LEFT through an adjacent wall; a landing cascade could fall UP through an unreachable platform — pinned pre-change by characterization tests, rewritten post-change; the diff between the two commits is the reviewable semantics change). The snap is now the nearest wall / highest floor / lowest ceiling computed by min/max directly over the candidates the ORIGINAL moved rect overlaps. Real solids arrays routinely contain overlapping blockers (entity-over-tile, moving-platform-over-static), so kernel trajectories change in overlap cases — **replay physics version 13 → 14; v13 replays are rejected; every `replayHashFor` canary re-pinned.** Riding the same bump: `springAutoJumpTime` is wired at last (Celeste `BounceAutoJumpTime`) — a winning spring launch preserves a buffered jump press (max'd with the grace window) on both the locomotion mirror and the authoritative jump slice, so a press just before the bounce fires as a jump off the spring instead of being swallowed by the higher-priority launch.
- **FNV-1a consolidated to one implementation** (`src/hash/fnv1a.ts`, zero deps). Three byte-identical copies had drifted across level/serialize, cosmetics/generate, and terrain-art/storage, all feeding persisted data (replay share-codes + trace canaries, terrain-art cache keys, cosmetics variant ids). Byte-exact by construction and pinned by known-answer vectors; the full suite green against the pre-existing canaries IS the output-neutrality proof — the hash consolidation deliberately landed BEFORE the physics bump so a share-code regression bisects to exactly one change. terrain-art's object-returning `canonicalize` (a separate persisted-format function, kept separate on purpose) gains the level version's path-scoped cycle-safety: a back-edge becomes null instead of a stack overflow caught as an empty string; no output change for anything validatable.
- **levelgen verification types consolidated onto leveltest.** The hand-re-duplicated `VerificationStatus`/`VerificationDiagnostic`/`VerificationResult`/`ReachabilityResult` (with a 4-field summary vs leveltest's 9-field graph — the divergence that forced unsound `as unknown as` bridges) are now re-exported from their canonical homes; the compact shape survives as `VerificationSummary` via `summarizeReachability()`; `calibrateDifficulty`'s verification parameter earns its keep — an inconclusive or proven-unreachable verification surfaces as a diagnostic instead of being silently ignored. No public names disappear.
- **Showcase (camera-brain demo dogfoods the transform helper):** the demo's world-space layer now routes through `applyCameraTransform` instead of hand-rolling `scale` + `translate(-Math.round(…))`, and its module docs quote the helper as the consumer contract. The `sections/ldtk-editor/play.ts` render path — the last un-migrated site, deferred by the hardening record because the editor overlay needed verifying alongside (its pointer mapping uses the editor's own viewport model, not the brain camera — unaffected) — is migrated too, and `snapCameraTranslation`'s JSDoc cross-references the zoom-aware helper so callers pick the right one.

### Added
- **`snapCameraBrain(state, options)`:** solves the brain to the steady state its easing would eventually reach — lens exactly on the selected vcam's zoom, body exactly on its converged placement (for a follow body, the deadzone band edge, which is the ease's fixed point) — with no blend started and any blend in progress dropped. This is what makes the FIRST RENDERED FRAME correct. A brain advanced only by `updateCameraBrain` starts wherever it was created (`zoom: 1` at `(0, 0)` for a bare `createCameraBrain`) and eases toward the room's fitted framing over the following second, which reads as an unrequested zoom-in and pan the moment gameplay begins — and, if anything draws the world before the brain's first update, as a small level parked in the top-left corner. Seeding `createCameraBrain({ zoom })` fixes only the zoom half; the body still eases in from the origin. Implemented as the existing solver under a finite maximum snap threshold, so selection, bands, clamps, padding, re-anchoring, and invalid-state repair are byte-identical to the eased path — the only differences are instant convergence and no blend. `options.dt` is ignored (a snap is timeless), so the same options object used per-tick passes verbatim. Pinned by a test asserting a 600-tick eased run converges on exactly what one snap produces, and by an idempotence test (snapping twice changes nothing).
- **Camera transform with an explicit pixel-snap policy (`cameraTransform`, `applyCameraTransform`, `CameraSnapMode`, `CameraTransformOptions`, `CameraTransformResult`, `CameraWorldView`):** the engine kept the camera as a float between updates on purpose (rounding inside the lerp stalls it short of a clamp bound — see the `camera/index.ts` module note), and then left the snap to each consumer's render code. The published recipe, `ctx.translate(-Math.round(camera.x), …)` *inside* `ctx.scale(zoom, zoom)`, rounds in WORLD units, which a fractional zoom — a cover fit of 4.75×, or a lens easing between rooms — maps straight back onto a fractional device pixel; the rasterizer then antialiases every surface edge, read as a hairline seam along the level's edge or a flickering scanline between tile rows. Snapping has to happen in the grid the rasterizer quantises to: the `'device'` mode (the default) computes `offsetX = -round(camera.x · zoom · dpr) / (zoom · dpr)` so the world origin lands on an exact device pixel, with `'world'` (the old behaviour) and `'none'` retained as explicit choices. The result carries the visible world rectangle derived from the SNAPPED position — the correct cull rect, since it describes what was actually drawn — and a `pixelAligned` flag that is deliberately honest about the limit: snapping fixes the ORIGIN, but only an integral `zoom · dpr` maps the whole world grid onto device pixels, so a fractional cover fit can still land far edges mid-pixel and wants `fitCameraZoom`'s `integerScale` if crisp edges matter more than filling the viewport exactly. Offsets canonicalize `-0` to `+0` (matching `clampTopLeft` in `motion.ts` — these are presentation values a consumer may serialize or compare); `Math.round` breaks ties toward `+Infinity`, so the displacement is bounded by half a device pixel rather than being sign-symmetric. `applyCameraTransform` composes `scale` then `translate` onto the current transform and leaves `save`/`restore` to the caller, matching `applySnappedTranslate`.
- **Per-emitter `worldGravity` / `worldDrag` on `EmitterConfig`** (`src/particles`): `stepEmitters` took a single shared world gravity/drag per call, forcing heterogeneous scenes into the gravityScale-negation workaround (fire and smoke paired at one shared gravity with opposing per-particle scales). The per-emitter overrides take precedence over the `StepEmittersOptions` defaults; signature unchanged, fully additive.
- **`nineSliceBorders` parsed + real `NineSlice` and `FullSize*` rendering** (`src/ldtk`): `LdtkEntityDef` gains the borders (`[up, right, down, left]` per the schema; a 4-int array parses to the tuple, anything else to `null`). `drawLdtkEntityTile` takes them as an optional trailing param: standard 9-slice (corners 1:1, edges one-axis, center both), borders clamped to half the rect on under-sized destinations, any slice with a ≤ 0 source or dest span SKIPPED (a zero-size `drawImage` throws, and one shipped fixture — Entities.ldtk's Door, 12px wide against 6+6 borders — is a zero-width center by construction; its sides still stretch, the horizontal center collapses). `NineSlice` without borders keeps the geometry-heuristic fallback; `FullSizeCropped`/`FullSizeUncropped` render at native size, clipped/unclipped (schema names but does not define them — semantics per the LDtk editor, noted in the JSDoc). The `LdtkTileRenderMode` enum is now fully implemented.

### Fixed
- **Showcase (HiDPI backing store never scaled — the same defect class, live in the engine's own demos):** `sections/camera-brain-demo.ts` and `sections/sprite-demo.ts` called `resizeCanvasToBackingStore` — which multiplies the backing store by the device pixel ratio and RETURNS that ratio precisely so the caller can compose it — and discarded the return value, never scaling the context. On any display with `dpr > 1` the entire scene therefore drew into the top-left `1/dpr` of the canvas: the "level appears small in the top-left quadrant" symptom, reproduced in the showcase the briefs point consumers at. Both demos call the resize INSIDE their render function, and assigning `canvas.width`/`height` resets the context transform, so the scale has to be re-applied every frame — not once at setup as `hero.ts`, `parallax.ts`, and `lava-pool.ts` (which all got this right) do. Verified in-browser at a 1280×720 backing store: scene content now spans the right half (12,080 non-background pixels) and the bottom half (50,492), both of which are zero without the scale. `sprite-demo` additionally had **no CSS rule at all**, so its canvas box followed the DPR-multiplied width/height attributes and doubled its on-screen size on a Retina display; the stage now pins a `480 × 270` box the way `.camera-brain-stage` already pinned its own (CSS sizing is consumer-owned — the DPR helper deliberately never touches it).
- **Degenerate-config guards (zero-divisions):** `timeToApex: 0` no longer bakes Infinity gravity / NaN launch into a `JumpState` (`deriveJumpPhysics`/`jumpLaunchVelocity` fall back to the default parameterization); `createPrecisionPlatformerConfig` survives `timeToApex: 0` and `referenceTileSize: 0` without Infinity-scaled jump impulses; a `fixedDt: 0` normalizes to 1/60 BEFORE the verification scenario runs (it previously ran frozen ticks that could never win) and can never freeze `tickRate: Infinity` into an emitted `ReplayConfig`.
- **Leveltest structural fast-fail:** a structurally invalid level returned `'inconclusive'` only after running reachability plus every bot policy against a world that cannot be trusted (observed: 3 policies × 76 ticks against an empty solid set). The pipeline now returns the same status and diagnostic immediately with empty scenario/reachability artifacts, and the belt-and-braces compile-catch stubs no longer flow `null as any` states (`compileLevel` documents itself as never-throwing).
- **terrain-art cache invalidation matches the materialId SEGMENT exactly.** The old substring match deleted other materials' entries whose VARIANT segment equaled the id — `invalidate('grass')` took `hash:stone:grass:15` with it, and `invalidate('default')` massacred every default-variant entry.
- **levelgen fallback config dedup:** the ~60-field inline `DEFAULT_PLATFORMER_CONFIG` duplicate (with `as any`) in `realize.ts` is the canonical import; the swap adds five optional fields the literal omitted, all kernel-read through `??` fallbacks — derivation output pinned unchanged by test.
- **Degraded-bot orphan release edge:** while a jump press is latched in the delay window, the base `released` edge no longer leaks through (an orphan `released` before any `pressed` is a lie on the wire). Heights and `runLowSkillPerturbation` numbers are unchanged — the kernel's variable-jump cut keys on held-state.

## [0.16.0] - 2026-08-16

### Added
- **LDtk entity display tiles (authoritative `tileRenderMode`):** `LdtkEntityDef` now carries `tileRenderMode` — a new `LdtkTileRenderMode` union covering all seven LDtk schema values (`Cover`, `FitInside`, `Repeat`, `Stretch`, `FullSizeCropped`, `FullSizeUncropped`, `NineSlice`); defs omitting the key parse as `'FitInside'` (pinned by tests at both the parse level, against the adversarial fixture, and the draw level, against a synthetic oversized instance). The parser previously dropped the field, forcing every consumer to re-derive Repeat-vs-Fit from rect geometry — a heuristic that renders exactly two of the seven modes correctly and misrepresents a `Stretch` or `Cover` author's intent as tiling.
- **`drawLdtkEntityTile(context, tile, dest, tilesets, mode?)`:** the entity-side counterpart of the tile-layer draw path. Entities are deliberately not drawn by `drawLdtkLevel` (spawning is owned by the translated `LevelData`), so consumers rendering an entity's authored LDtk art had to hand-roll the blit — repeat-with-partial-clip, stretch, letterbox — in a codebase whose stated rule is "never hand-roll a tile blit." The helper implements `Repeat` (tiles across the rect, clipping the last partial column/row from the SOURCE rect, not by smearing), `Stretch` (one scaled blit), `FitInside` (aspect-preserving, centered), and `Cover` (aspect-covering, clipped to the rect); `NineSlice` and the `FullSize*` pair fall back to the geometry heuristic with the boundary documented in the JSDoc (nine-slice needs the def's `nineSliceBorders`, which neither the instance tile nor the parsed def carries — a known gap). An omitted `mode` also uses the geometry heuristic (instance no larger than its tile → one plain blit; larger → repeat), preserving the behavior consumers derived before the mode was parsed. Never throws; returns `false` for a missing tileset, degenerate rect, or throwing draw.

### Fixed
- **Levelgen (degraded-bot jump delay):** the jump-delay knob had no setting that produced a real delay. `delay = 1` fired on the SAME tick as the press (zero delay) because the decrement block ran inside the arming tick; `delay ≥ 2` dropped the press entirely because the re-fire gated on `baseInput.jump.pressed` — a one-tick edge that cannot still be true at expiry; and `delay = 0`, nominally a passthrough, also suppressed the press forever. The wrapper now latches the press at arming, skips the decrement on the arming tick so N means N ticks, and fires a synthetic pressed/held edge on expiry regardless of the current base edge, suppressing held during the delay window. `runLowSkillPerturbation` results shift accordingly: delay-1 configs are now actually degraded, delay-2+ configs no longer degrade past intent. `createDegradedPolicy` is now exported at the `levelgen/calibration` module level (not the barrel) so these semantics are unit-testable without a full verification run.
- **Input (gamepad adapter listener leak):** the `gamepadconnected`/`gamepaddisconnected` window listeners were attached BEFORE the no-navigator early return, whose `dispose()` is a no-op — so every adapter constructed in a window-without-gamepad environment (the SSR/no-host guard's own path) leaked two unremovable listeners. Attachment now happens only once a host is confirmed.
- **Terrain art (`terrainArtLinePixels`):** a NaN or non-finite endpoint (e.g. from mouse math) never satisfied the `while (true)` break condition — an editor hang/OOM. Non-finite endpoints now return `[]`, matching the defensive style of every other module.

### Changed
- **Showcase (tile-room spawn drift):** `compileGeneratedLevel` has defaulted `spawnResolution: 'rest-on-surface'` since the Celerock C1 hardening (LDtk emits feet-center spawn anchors), but the tile-room fixtures author spawns as actor-top-left rects — so both the showcase runtime and its tests spawned the player 8px left of the authored position, surfacing as a failing test that rotted silently because CI never ran the showcase suite. All three call sites now pass the resolution explicitly (`tile-room` → `'actor-top-left'`, `ldtk-editor` → `'rest-on-surface'`, matching `ldtk-room`), no call site relies on the implicit default (a future flip of the default is now safe), and a default-path assertion pins `'rest-on-surface'`.
- **CI:** `showcase:typecheck` and `showcase:test` now run on every push/PR; `src/` was already typechecked via `build:dist`.
- **Docs/hygiene:** the showcase section lists in `README.md` and `showcase/README.md` now list all nine sections (were four and six of nine); the three shipped plan docs moved from the repo root to `docs/design/archive/`. This entry also covers the post-0.15.0 docs-only commits (Celerock brief review pass, the six-prompt repin to 0.15.0, the CC0 asset pack) that had no changelog trace of their own.

## [0.15.0] - 2026-08-16

### Added
- **Room transitions (session orchestrator):** `createRoomTransitionSession` / `pollRoomTransition` / `beginSessionRoomSlide` / `advanceSessionRoomSlide` / `endRoomTransitionSession` — one immutable `{ detector, slide }` state machine owning the transition layer's invariants by construction, making each named Celerock `TRANSITION_ISSUES` failure mode structurally impossible: bug 1 (tick-tock loop after a discarded/reset detector — the poll auto-adopts the returned detector state, and the per-axis containment latch re-derives from body geometry, so a consumer that discards the returned session loses only deadband jitter absorption, never the tick-tock protection), bug 2 (a second transition begun during an active slide — polls are suppressed and begins refused while `slide !== null`), bug 3 (death mid-slide leaving the camera in slide space — every abnormal exit goes through one cancel-with-rebase path, `endRoomTransitionSession`, which also owns the reset-on-respawn discipline with a fresh detector). `beginSessionRoomSlide` returns `{ session, brain, ok }` and applies the slide-space enter rebase internally on success; `advanceSessionRoomSlide` owns only the finish-rebase — while the slide is active the consumer still drives the per-tick slide camera (`presentationForRoomSlide` + their own `updateCameraBrain`). All functions pure, immutable, never-throw, no environment reads (the reduced-motion decision stays an explicit `RoomSlideOptions` input).
- **LDtk preflight (multi-room steer):** `capabilities.multiRoom` — true iff the project has more than one level AND some level's `__neighbours` entry resolves to a DIFFERENT real level within the project (dangling/self links excluded); an info diagnostic when true (`multi-room world: N rooms chained via __neighbours — seam traversal (room-transition path) is in scope`); and the `capabilities.exits` JSDoc now states it counts Exit ENTITIES (resolved kind `'exit'`) only — NOT `__neighbours` seam traversal. Closes the observability gap behind the skipped-transitions build: a fully chained five-room world with no Exit entities now reports `exits: false, multiRoom: true` instead of burying the multi-room signal in per-level fields.

### Changed
- **Room transitions (per-axis containment latch):** `RoomExitDetectorState` gains `fullyInsideXIid`/`fullyInsideYIid`; straddle suppression is now intrinsic and reset-immune — a discarded or freshly created detector state can no longer tick-tock, because containment is re-derived from body geometry on every poll. An exit additionally requires the body to have been fully contained once on the exit's crossing axis (`e`/`w` → X, `n`/`s` → Y) in the current room; the orthogonal axis is unaffected, so diagonal seam exits and corner arrivals behave as in 0.14.1. Old serialized states (missing the fields) are treated as unlatched and latch on first containment with no lost tick. `findLdtkRoomExit` is unchanged (still the ungated stateless primitive). Plan: `docs/design/room-transition-session-hardening-plan.md`.

## [0.14.1] - 2026-08-14

### Changed
- **Celerock brief:** version pins bumped to `0.14.1`; the version ledger notes the flush-landing fix rides this version (engine-side landing reporting — no game-layer compensation needed).

### Fixed
- **Platformer (flush landings):** the `landing` feel moment and the `justLanded` pulse now fire when a body arrives EXACTLY flush with its support (the gravity-facing edge lands precisely on the support edge). Touching is deliberately not AABB overlap, so the arrival tick itself reports no landing — and the next tick's start-of-tick flush probe (`hasPhysicalSupport`, the same probe that keeps resting bodies flagged `onGround`) already saw the body as supported, so the old edge `landedThisTick = nowOnGround && !wasOnGround` measured the airborne→grounded transition *inside* the tick and stayed false both ticks: the whole landing was silently dropped. Deterministic producer: a full-height held jump's symmetric arc returns the body exactly to its rest height (the "no landing puff/shake/audio while holding jump" repro). The edge is now `nowOnGround && !(enteredOnGround && wasOnGround)` (with `enteredOnGround` the end-of-previous-tick flag captured before the probe overwrites the working copy) — a body reports a landing unless it was CONTINUOUSLY supported across the tick boundary, which also un-masks the downstream `justLanded` consumers — the squash/stretch landing squat, the humanoid `landingBlend` — and the super-jump ground-grace seed for a flush touchdown after a horizontal air dash. Every other configuration is byte-identical to the old edge (a same-tick support swap under a gravity flip — floor-supported one tick, ceiling-supported the next, never airborne — still reports). A flush landing reports one tick after the contact with an `impactSpeed` within a couple of gravity steps of the true arrival speed (presentation-only scaling); penetrating landings, resting ticks, contacts, and all trajectory behavior are unchanged (the probe still owns `core.onGround`; `wasOnGround` keeps its start-of-tick meaning everywhere else).

## [0.14.0] - 2026-08-14

### Changed
- **Wall-jump (direction-aware, physics v13):** the wall-slide's jump now branches on the SIGN of `moveX` at the press (magnitude ignored, analog-safe). A jump made while sliding (the slide only stays engaged while holding INTO the wall, so every active-slide press is into-wall) launches STRAIGHT UP (`vx = 0`, facing the wall) instead of always being flung off the wall it was holding into — a single wall becomes chimney-climbable (slide, hop, land back on the wall, repeat). The kernel resolves `forceMoveX = sign(0) = 0`, so the standard `wallJumpLockTime` lockout holds `vx ≈ 0` and commits the hop vertically (steering suppressed for the lockout, then normal air control resumes) — no kernel launch-handling change. The classic away-from-wall leap now fires from a new post-slide grace window: `wallJumpGraceTime` (optional `PlatformerConfig` field, default `0.1` s, coyote-style — armed on every sliding tick, decaying after; classified `'time'` by the config scaler) keeps the wall jump armed after the slide direction is released or turned away, and a press with neutral or away input — while still beside the wall — leaps away (`vx = ±wallJumpVx`, facing the push). The grace gates mirror the slide's own engage gates so the leap can never fire where a slide could not: grounded presses are NOT hijacked (the plain ground jump owns them — `wallJump` outranks `jump` in launch arbitration), `lockTimer` must be expired, grab held defers to wall-grab, fast-fall and a vanished wall suppress the leap. `WallSlideAbilityState` gained `graceTimer` (and `side` now persists through the grace window); both variants emit `source: 'wallJump'`, report through the same `wallJumpLaunched` pulse, keep variable jump height, and reset the lock/grace timers. Trajectory-changing: into-wall slide+jumps go from up-and-away to straight-up, so the replay physics version is 13 (v12 replays rejected; every `replayHashFor` canary re-pinned).
- **Celerock brief:** `games/celerock.md` §4.1 documents the direction-aware wall-jump in the wall-kit block (both variants, the grace tuning key, and the suppression rules); §8 specifies the start menu (NEW GAME / RESUME GAME — up/down select, jump/dash/grab edge confirms, RESUME hidden while the save carries no progress, NEW GAME wipes the persisted save); §12.7 acceptance criteria renumbered for the menu gate. Version pins bumped to `0.14.0`.

### Fixed
- **Room transitions (re-arm gate):** `detectLdtkRoomExit` no longer suppresses exits indefinitely when an actor backs out through the arrival edge without first clearing the deadband (a quick doorway tap, a sub-pixel crossing, a poke-through-and-reverse). Previously the gate released only on inward clearance or a room-IID change — neither can fire during a suppressed back-out, because no exit is ever reported and so the room never changes — and while gated it suppressed **every** edge, not just the arrival edge. Consumers' void-fall checks then killed the player right at/after a transition (the "sometimes during level transitions the player dies" class of bug). The gate now holds only while the body still overlaps the room it arrived in — a true hysteresis band: suppressed only while straddling the arrival seam, released on any full departure, after which the bare helper reports the genuine reverse transition (or void, if the departure is outside the shared seam span). Tick-tock prevention is unchanged: a post-transition body always straddles, since `mapLdtkRoomEntry` preserves world position.

## [0.13.0] - 2026-08-14

### Added
- **Audio (sustained sounds):** `startNoiseLoop(filterType, freq, peak)` + the `NoiseLoopHandle` it returns (`stop()` fades out over ~0.1 s and releases — a natural tail; `setPeak()` live-adjusts loudness; `isPlaying()`). A sustained filtered-noise voice on the shared one-second noise buffer (`loop = true` — the buffer loops seamlessly), for sounds that last exactly as long as a game state: wall-slide scrapes, wind, hums. Starts on a state's onset edge and stops on its end — the correct replacement for the only alternative the fire-and-forget `playTone`/`playNoise` left consumers: hand-rolled per-tick grain counters in game code. Fully defensive per the adapter pattern: pre-unlock/muted/disposed/no-WebAudio returns an INERT handle (never null — callers never null-check), and every handle method swallows errors (including after adapter `dispose()` closed the context).

### Changed
- **Audio (burst de-correlation):** `playNoise` now starts each burst at a random offset inside the shared noise buffer (offset 0 only when the burst outlasts the one-second buffer). Every burst previously restarted the identical waveform from sample 0, so overlapping/retriggered bursts were phase-coherent — comb filtering, and a rate-limited per-tick retrigger pattern phase-locks into an audible 60 Hz buzz (the exact failure the Celerock brief's original wall-slide recipe produced across builds). `Math.random()` here joins the noise-buffer fill as an explicitly-allowed decorative audio side-effect. No API change; existing isolated one-shots sound identical.
- **Celerock brief:** `games/celerock.md` §10's wall-slide recipe is now the sustained-loop pattern (start ONE `startNoiseLoop('lowpass', 600, 0.06)` on the `startedWallSlide` pulse, `handle.stop()` when sliding ends) with a general sustained-sound rule in the §10 preamble (one-shots fire on event edges; sustained sounds are start/stop — never per-tick one-shot retriggers), and the Stage 6 audio gate verifies the scrape by ear. Version pins bumped to `0.13.0`.

## [0.12.0] - 2026-08-14

### Added
- **LDtk rendering (seam-free fractional zoom):** `createLdtkLevelSurfaceCache` — a lazy, identity-preserving cache of native-resolution level surfaces. `draw(ctx, level, opts)` is a drop-in replacement for `drawLdtkLevel` under a consumer camera transform: it bakes a level once at `pxWid × pxHei` (tile art through `drawLdtkLevel` verbatim, `imageSmoothingEnabled = false`), then blits the single finished surface per frame. Scaling hundreds of tiles independently at a fractional zoom (a cover-fit, or a lens easing between rooms) can expose a duplicated/empty scanline between adjacent tile rows on some browser/GPU combinations; one surface has no internal draw boundaries for the compositor to split. `get` exposes the baked surface for consumers that own the blit; `has`/`drop(iid)`/`clear` manage rebaking after tile edits. Canvas creation mirrors the sprite tint helper (consumer `createCanvas` factory → `OffscreenCanvas` → `document.createElement`); with no canvas host, `draw` falls back to the direct `drawLdtkLevel` path so mock/non-DOM hosts never lose level art. Also cheaper per frame: one blit instead of per-tile blits, culling for free. Adopted in the showcase LDtk play mode.

### Changed
- **Celerock brief:** `games/celerock.md` §5.4 documents the seam-free surface-cache option for the golden-path render pass. Version pins bumped to `0.12.0`.
- **Tooling:** `check:ldtk-runtime-size` now budgets the surface cache as its own runtime draw-path leaf (`ldtk surface`: 3,726 bytes max 12,000, same authoring-code bans as the render leaf).

## [0.11.0] - 2026-08-14

### Added
- **Room transitions (destination framing):** `roomEntrySlideView` — computes a follow-compatible destination `RoomSlideView` for a room slide, so the slide ends exactly where the post-slide follow vcam begins (no dip toward the room corner, no post-slide correction pop). The result is an equilibrium of the destination follow body for the supplied deadzone bands and padding (its first follow step does not move the camera). Takes the PHYSICAL viewport and returns a room-local room-px camera (the brain divides the viewport by zoom internally). Replaces the common hand-rolled `{ x: 0, y: 0 }` hardcoded destination endpoint that produced a visible dip on any overflow axis. New `RoomEntrySlideViewOptions` type for matching the destination follow vcam's bands/padding.

### Fixed
- **Room slide:** endpoint-inclusive slide space. `beginRoomSlide` now builds its normalized two-room union from FOUR rectangles (both rooms + both endpoint view rectangles) using the previously-discarded `viewport` argument, so a legitimate negative letterbox camera (a room smaller than the viewport) is representable in slide space rather than clamped back to the room origin by the fixed vcam before handoff. Backward-compatible: existing fixtures with endpoints at room origins retain their offsets/bounds.

### Changed
- **Docs:** the coordinate-space contracts are now explicit on the types. `RoomSlideView.camera` documents that it is room-local ROOM-PIXELS (not physical/screen px) and points to `roomEntrySlideView`. `CameraViewport` documents that it is physical screen-space. The legacy `updateCamera`'s `viewport` parameter documents that it expects the SAME world units as `target`/`bounds` and has NO zoom input (unlike `updateCameraBrain`, which takes a physical viewport and divides by zoom internally) — the exact distinction that previously required reverse-engineering the brain's internals.
- **Celerock brief:** `games/celerock.md` now points at the supported transition helpers by name (`detectLdtkRoomExit`, `beginRoomSlideFromBrain`, `roomEntrySlideView`) and the §5.5 example uses them instead of bare `findLdtkRoomExit` + a hardcoded `{ x: 0, y: 0 }` destination. Version pins bumped to `0.11.0`.

## [0.10.0] - 2026-08-14

### Added
- **Room transitions (tick-tock prevention):** `createRoomExitDetectorState` + `detectLdtkRoomExit` — an immutable, serializable re-arm wrapper over the bare `findLdtkRoomExit`. After an exit fires, the detector gates the reverse exit until the actor clears the entry seam by a deadband (default 1 world pixel via `DEFAULT_EXIT_DEADBAND`), so a body lingering on a seam no longer oscillates between rooms every tick. Direction-specific (an actor flush with an unrelated edge — e.g. a grounded actor on the floor — can still clear a west/east gate). Handles teleport/stale-state via an `expectedLevelIid` mismatch reset. Transactional: the consumer adopts the returned state only if it accepts the transition, so a rejected transition leaves the original armed state reusable. One state per actor; a JSON-cloned state behaves identically (deterministic across save/load and replay).
- **Room transitions (dip-down prevention, hard cut):** `seedRoomCutCamera` — a single-call continuity-preserving camera-brain seed for room switches WITHOUT a slide. Rebases the rendered camera through world space so the destination's first-activation `bodyCamera` does not restart from the room's `(0,0)` origin and visibly dip. Preserves the rendered `camera`/`zoom` (not `bodyCamera`/`lensZoom`, which may represent an off-screen live target during a blend); leaves the real viewport/zoom clamp to the next `updateCameraBrain`. Documented as a hard-cut helper only — explicitly NOT a room-slide endpoint.
- **Room transitions (dip-down prevention, slide):** `beginRoomSlideFromBrain` — a safe `beginRoomSlide` constructor that derives the source endpoint directly from the rendered brain (camera AND zoom, copied not retained), making source-view/brain divergence impossible by construction rather than caught after the fact. The caller still chooses the destination view.

### Notes
- The low-level primitives `findLdtkRoomExit`, `mapLdtkRoomEntry`, and `beginRoomSlide` are unchanged and remain public for callers that manage their own hysteresis or supply explicit endpoints. The new APIs are purely additive.
- `findLdtkRoomExit`'s JSDoc now identifies it as a low-level stateless primitive and points per-tick consumers at `detectLdtkRoomExit`.
- `release:smoke` now explicitly imports and exercises every new public name across all three generated consumers (Node ESM / NodeNext `skipLibCheck:false` / Vite), so a missing or renamed export fails the publish gate loudly.

## [0.9.2] - 2026-08-13

### Fixed
- **Platformer:** super-jump grace (`superJumpGraceTimer`) now seeds once and only decays. Previously the timer was refreshed to `config.superJumpGrace` (0.1s) on every tick the actor stayed grounded after a horizontal dash; because `lastDashDirX/Y` persist, the timer never decayed while standing — so every subsequent grounded jump fired a Super Jump no matter how long the player waited ("dash, land, stand still, then jump → you go flying"). The window now seeds on the tick a horizontal dash ends (active→idle, covering ground dashes and hyper slides that never produce a landing event) and on the tick the actor lands after an air dash; after seeding it only decays, so standing >0.1s clears the window and a plain grounded jump is a plain jump again. The intended wavedash tech (dash → land/end → jump within grace) is preserved. Adds a full-kernel regression test.

## [0.9.1] - 2026-08-13

### Fixed
- **Docs:** corrected `README.md` — the package works in **plain Node ESM with no bundler** (the `build:dist` step rewrites the dist's extensionless specifiers to `.js`, verified by `release:smoke`'s Node-ESM gate). The prior "Bundler required" note was stale.
- **Dependencies:** `npm audit fix` resolved two high-severity **development-only** transitive advisories (`nanoid` ≤3.3.17, `postcss` ≤8.5.22, both via Vite). Lockfile-only — `package.json` devDependency ranges unchanged, so no runtime/tarball impact.
- **Changelog:** backfilled the missing `[0.7.0]`/`[0.8.0]`/`[0.8.1]`/`[0.9.0]` comparison links and repointed `[Unreleased]` at `v0.9.1...HEAD`; resynced the stale `package-lock.json` top-level version.

## [0.9.0] - 2026-08-13

### Added
- **Platformer:** Ledge mantle (physics v12) — holding grab + Up near the top of a clear wall performs a continuous multi-tick assisted hop onto the ledge: the actor rises beside the wall, crosses the lip once its feet clear, and lands through the normal collision resolver. Mantle code never assigns actor position (no teleport/snap); a conservative preflight (`src/platformer/mantle.ts`, module-private) declines under ceilings/overhangs or onto occupied footholds, and passthrough/ladder/spring/dash-refill volumes never block it. Tuning: `mantleEnabled` (default on, inert without `wallGrabEnabled`), `mantleHopVx`, `mantleHopVy` (minimum — the launch magnitude is derived from actor/wall geometry under the jump gravity), `mantleApexClearance`, `mantleLandingInset`, `mantleAssistTime`.
- **Platformer:** Direction-aware grab+jump (physics v12) — jumping while grabbing now branches on the latched wall side + the SIGN of `moveX` (analog magnitude ignored): Away keeps the classic up-and-away climb-hop; Neutral/Toward launches a straight-up **climb-jump** (`vx = 0`, faces the wall, `climbJumpRegrabLockTime` re-grab lock — fixes the 4 px re-cling jitter). New launch sources `'climbJump'`/`'mantle'` (priority 3, no forced-horizontal window); new event pulses `climbJumpLaunched`/`mantled`; `WallGrabAbilityState` gained `regrabTimer` + the `mantle` assist record; `LocomotionMode` gained `'mantle'` (skips horizontal input only — gravity + collision stay authoritative).

### Changed
- **Platformer:** `wallJumpLaunched` was DELIBERATELY WIDENED to also fire for away climb-hops (previously pulse-less) — consumers reading that pulse will start seeing climb-hops. Dash retains priority over both new behaviors; jump retains priority over the mantle.
- **Replay:** `CURRENT_PHYSICS_VERSION` 11 → 12. Neutral/toward grab+jump trajectories intentionally change; scenarios that never hold grab are trace-unchanged but every replay hash shifts (widened config/events/state + version).
- **Docs:** the Celerock build brief (`games/celerock.md`) now mandates Celeste's actual PC-default keyboard bindings (Arrows + `C`/`X`/`Z`, not the engine's `Space`/`Shift`/`KeyK` standard map) and renders the supplied `Player.png` sprite from the first play tick (no procedural-then-swap phase).

### Fixed
- **Platformer:** the wall-grab ability now clears any active grab/mantle state when `wallGrabEnabled` is false, so disabling the ability (e.g. a per-call `config` flip on `stepPlatformer`) cannot leave its exclusive `'wallGrab'`/`'mantle'` locomotion mode latched. An already-idle state remains an identity no-op.

## [0.8.1] - 2026-08-13

### Fixed
- **LDtk:** resolve `projectUrl` relative to the project file (was treating it as absolute); narrowed the collectibles bucket.

## [0.8.0] - 2026-08-13

### Added
- **Platformer feel + traversal layer:** structured feel channel (`state.moments` — `landing { impactSpeed, normalizedImpact, hard, solidId }`, one-shot `dashBonk { normalX, normalY, solidId }` per blocked axis per dash, observation-only `dashEnded { reason, terminalContact }`, `grabLatch`/`staminaExhausted`, `springLaunch`/`dashRefill`); pure room-transition helpers (`findLdtkRoomExit` / `mapLdtkRoomEntry` / `transitionPlatformerToRoom` / `rebasePointBetweenLdtkRooms`); room-slide orchestrator (`beginRoomSlide` + the camera-space rebases); explicit camera fit (`fitCameraZoom`).

### Changed
- **Replay:** physics version 10 → 11 (the `moments` state field is replay data; v10 replays rejected). A manually-constructed `PlatformerState` now needs `moments: []`.

## [0.7.0] - 2026-08-13

### Added
- **Celerock golden path:** Node-ESM-importable dist; high-level async LDtk loader (`loadLdtkProjectAssets`) + asset preflight (`inspectLdtkPlatformerProject`); per-room `compileLdtkRoom` / `createLdtkRoomCache`; tile-unit config scaling (`scalePlatformerConfig` / `createPrecisionPlatformerConfig`); shared input edges (`IDLE_EDGE`, `STANDARD_KEYBOARD_PLATFORMER_MAP`, `STANDARD_GAMEPAD_PLATFORMER_MAP`); game-loop `onError` / `errorPolicy`; spawn `'rest-on-surface'` resolution; spring / dash-refill entity mappings.

### Fixed
- **Package:** packed dist is Node-ESM-importable (extensionless `.d.ts` specifier fix); added `release:smoke` (packed-tarball Node + NodeNext + Vite consumer gates) and CI; the nested `npm pack`/`install` inside the publish lifecycle survives.

## [0.6.0] - 2026-08-12

### Added
- **Camera:** Light Cinemachine-style camera brain — virtual cameras (vcams), blends, and deadzone follow.
- **Platformer:** Celeste-inspired physics overhaul (Phases 0–9): tighter movement, jump, and air-control feel.
- **Platformer:** `groundDuckEnabled` opt-out for the grounded duck latch.

### Fixed
- **Camera:** Preserve blend continuity when a virtual-camera source is removed.
- **Camera:** Blend clamp crossfade correctness; `dt=0` is now a no-op, and the director guide is corrected.

## [0.5.1] - 2026-08-10

### Changed
- Filled the npm package's empty storefront fields now that the repo is public (repository, homepage, bugs, author, keywords) so npmjs.com links to source/issues and npm search finds the package.
- Added the "Create Games with AI" community link to the README tagline; genericized remaining brand-specific prose to brand-neutral phrasing.

### Notes
- No code change; `dist/` identical to 0.5.0 apart from `package.json`/`README` metadata.

## [0.5.0] - 2026-08-10

### Added
- Scope expansion release: charger + idle humanoid + LDtk native pipeline + Aseprite sprites + ladder/climb + terrain-art.

### Notes
- Humanoid motion poses (H3/H4) deferred to a future release. See `docs/design/0.5.0-scope-decision.md`.

[Unreleased]: https://github.com/morganpage/aicraft-engine/compare/v0.19.1...HEAD
[0.19.1]: https://github.com/morganpage/aicraft-engine/compare/v0.19.0...v0.19.1
[0.19.0]: https://github.com/morganpage/aicraft-engine/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/morganpage/aicraft-engine/compare/v0.17.5...v0.18.0
[0.17.5]: https://github.com/morganpage/aicraft-engine/compare/v0.17.4...v0.17.5
[0.17.4]: https://github.com/morganpage/aicraft-engine/compare/v0.17.3...v0.17.4
[0.17.3]: https://github.com/morganpage/aicraft-engine/compare/v0.17.2...v0.17.3
[0.17.2]: https://github.com/morganpage/aicraft-engine/compare/v0.17.1...v0.17.2
[0.17.1]: https://github.com/morganpage/aicraft-engine/compare/v0.17.0...v0.17.1
[0.17.0]: https://github.com/morganpage/aicraft-engine/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/morganpage/aicraft-engine/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/morganpage/aicraft-engine/compare/v0.14.1...v0.15.0
[0.14.1]: https://github.com/morganpage/aicraft-engine/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/morganpage/aicraft-engine/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/morganpage/aicraft-engine/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/morganpage/aicraft-engine/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/morganpage/aicraft-engine/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/morganpage/aicraft-engine/compare/v0.9.2...v0.10.0
[0.9.2]: https://github.com/morganpage/aicraft-engine/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/morganpage/aicraft-engine/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/morganpage/aicraft-engine/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/morganpage/aicraft-engine/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/morganpage/aicraft-engine/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/morganpage/aicraft-engine/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/morganpage/aicraft-engine/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/morganpage/aicraft-engine/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/morganpage/aicraft-engine/releases/tag/v0.5.0
