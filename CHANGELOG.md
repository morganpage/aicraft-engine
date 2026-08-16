# Changelog

All notable changes to `aicraft-engine` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Hardening pass against the five defects recorded in the Celerock 4 build's `FIXES.md`. Three of the five were engine-shaped — the engine either had no answer for the problem or its published recipe was the cause — and each is closed at that layer below. (The remaining two were not engine defects: the title screen drawing the playable world is a consumer render-gating choice, and the missing start menu is a build non-compliance — `games/celerock.md` §8 has specified that two-entry menu since `0.14.0`.) Everything here is **additive and non-physics**: no kernel trajectory changes, no replay-version bump, no existing signature altered.

### Added
- **Sprite anim clip grouping (`spriteAnimClipFor`, `createSpriteAnimPlayer`, `advanceSpriteAnimPlayer`, `SpriteAnimClip`, `SpriteAnimPlayer`):** the deriver returns FIVE kinds but a sheet has THREE clips — `ascent`/`apex`/`descent` are phases of one arc that a jump clip is authored to play straight through — and nothing in the engine owned that collapse, so every consumer re-derived it. The recipe they had to copy (`games/celerock.md` §4.4, `:433`) re-derived it wrong: `if (kind !== lastKind) clock = createSpriteAnimState()` restarts on every KIND change, which fires at the ascent→apex and apex→descent boundaries and replays the launch frames two or three times per arc — the "jump animation replays while the jump key is held" report, which is not a held-key bug at all but a phase-boundary bug that any single jump reproduces. `advanceSpriteAnimPlayer` restarts the clock **only when the CLIP changes**, making the failure unrepresentable; the fresh clock still absorbs the boundary tick's `dt` (none is dropped), and a `restarted` flag exposes the transition for one-shot side effects (a launch puff, a footstep on the walk cycle's first frame). `createSpriteAnimPlayer()` doubles as the reset every respawn/restart path needs, so the next jump starts on frame 0 instead of inheriting the clamped fall frame of the arc that killed the player. `spriteAnimClipFor` is pure and total — an out-of-union value degrades to `'idle'` rather than throwing. Pinned by a test that runs the same phase sequence through both paths and asserts the naive one rewinds (`[60, 61, 60, 61, 60, 61, 61, 62]`) where the player advances monotonically (`[60, 61, 61, 62, 62, 63, 63, 64]`).
- **`snapCameraBrain(state, options)`:** solves the brain to the steady state its easing would eventually reach — lens exactly on the selected vcam's zoom, body exactly on its converged placement (for a follow body, the deadzone band edge, which is the ease's fixed point) — with no blend started and any blend in progress dropped. This is what makes the FIRST RENDERED FRAME correct. A brain advanced only by `updateCameraBrain` starts wherever it was created (`zoom: 1` at `(0, 0)` for a bare `createCameraBrain`) and eases toward the room's fitted framing over the following second, which reads as an unrequested zoom-in and pan the moment gameplay begins — and, if anything draws the world before the brain's first update, as a small level parked in the top-left corner. Seeding `createCameraBrain({ zoom })` fixes only the zoom half; the body still eases in from the origin. Implemented as the existing solver under a finite maximum snap threshold, so selection, bands, clamps, padding, re-anchoring, and invalid-state repair are byte-identical to the eased path — the only differences are instant convergence and no blend. `options.dt` is ignored (a snap is timeless), so the same options object used per-tick passes verbatim. Pinned by a test asserting a 600-tick eased run converges on exactly what one snap produces, and by an idempotence test (snapping twice changes nothing).
- **Camera transform with an explicit pixel-snap policy (`cameraTransform`, `applyCameraTransform`, `CameraSnapMode`, `CameraTransformOptions`, `CameraTransformResult`, `CameraWorldView`):** the engine kept the camera as a float between updates on purpose (rounding inside the lerp stalls it short of a clamp bound — see the `camera/index.ts` module note), and then left the snap to each consumer's render code. The published recipe, `ctx.translate(-Math.round(camera.x), …)` *inside* `ctx.scale(zoom, zoom)`, rounds in WORLD units, which a fractional zoom — a cover fit of 4.75×, or a lens easing between rooms — maps straight back onto a fractional device pixel; the rasterizer then antialiases every surface edge, read as a hairline seam along the level's edge or a flickering scanline between tile rows. Snapping has to happen in the grid the rasterizer quantises to: the `'device'` mode (the default) computes `offsetX = -round(camera.x · zoom · dpr) / (zoom · dpr)` so the world origin lands on an exact device pixel, with `'world'` (the old behaviour) and `'none'` retained as explicit choices. The result carries the visible world rectangle derived from the SNAPPED position — the correct cull rect, since it describes what was actually drawn — and a `pixelAligned` flag that is deliberately honest about the limit: snapping fixes the ORIGIN, but only an integral `zoom · dpr` maps the whole world grid onto device pixels, so a fractional cover fit can still land far edges mid-pixel and wants `fitCameraZoom`'s `integerScale` if crisp edges matter more than filling the viewport exactly. Offsets canonicalize `-0` to `+0` (matching `clampTopLeft` in `motion.ts` — these are presentation values a consumer may serialize or compare); `Math.round` breaks ties toward `+Infinity`, so the displacement is bounded by half a device pixel rather than being sign-symmetric. `applyCameraTransform` composes `scale` then `translate` onto the current transform and leaves `save`/`restore` to the caller, matching `applySnappedTranslate`.

### Fixed
- **Showcase (HiDPI backing store never scaled — the same defect class, live in the engine's own demos):** `sections/camera-brain-demo.ts` and `sections/sprite-demo.ts` called `resizeCanvasToBackingStore` — which multiplies the backing store by the device pixel ratio and RETURNS that ratio precisely so the caller can compose it — and discarded the return value, never scaling the context. On any display with `dpr > 1` the entire scene therefore drew into the top-left `1/dpr` of the canvas: the "level appears small in the top-left quadrant" symptom, reproduced in the showcase the briefs point consumers at. Both demos call the resize INSIDE their render function, and assigning `canvas.width`/`height` resets the context transform, so the scale has to be re-applied every frame — not once at setup as `hero.ts`, `parallax.ts`, and `lava-pool.ts` (which all got this right) do. Verified in-browser at a 1280×720 backing store: scene content now spans the right half (12,080 non-background pixels) and the bottom half (50,492), both of which are zero without the scale. `sprite-demo` additionally had **no CSS rule at all**, so its canvas box followed the DPR-multiplied width/height attributes and doubled its on-screen size on a Retina display; the stage now pins a `480 × 270` box the way `.camera-brain-stage` already pinned its own (CSS sizing is consumer-owned — the DPR helper deliberately never touches it).

### Changed
- **Showcase (camera-brain demo dogfoods the transform helper):** the demo's world-space layer now routes through `applyCameraTransform` instead of hand-rolling `scale` + `translate(-Math.round(…))`, and its module docs quote the helper as the consumer contract. The `sections/ldtk-editor/play.ts` render path still hand-rolls the world-space rounding and is a known remaining migration.

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

[Unreleased]: https://github.com/morganpage/aicraft-engine/compare/v0.15.0...HEAD
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
