# Plan: Engine 0.4.0 and Game Prompt Alignment

> Date: 2026-07-27
> Status: implementation plan
> Baseline audited release: `aicraft-engine@0.3.0`
> Target release: `aicraft-engine@0.4.0`

## Purpose

Bring `games/README.md` and every prompt in `games/` into exact agreement with
the public npm API. The prompts must produce strict TypeScript games that build
against one reproducible engine version without inventing APIs, relying on
unpublished source, or reimplementing functionality the engine already owns.

The audit found three genuine engine gaps that prevent the game briefs from
being truthful:

1. The platformer kernel only treats positive-Y gravity and floor contact as
   grounded. It cannot model an actor supported by a ceiling after a gravity
   flip.
2. The music module has no host adapter for externally advanced `NoteFire`
   events. `createSequencer` owns a private sequencer state and host clock, so a
   game cannot also call `advanceSequencer` in its fixed-step simulation and
   claim that `createSequencer` consumes those same events.
3. `compileLevel` compiles entity platforms but ignores numeric tile collision.
   `createTileQuery` exposes tile classification separately, while
   `stepPlatformer` accepts only a flat `Solid[]`. A tile-authored game therefore
   has no single public compilation path that makes its rendered terrain solid
   to the platformer kernel.

Those gaps require engine work and a new npm publication. Published `0.3.0`
cannot be changed retroactively, so the final prompts will pin `0.4.0` after it
is published.

## Verified npm baseline

The npm registry reported the following on 2026-07-27:

- `latest`: `0.3.0`
- published versions: `0.1.0`, `0.2.0`, `0.3.0`
- package entry: root `"."` only
- implementation: compiled ESM under `dist/`
- types: `dist/index.d.ts`
- runtime dependencies: none
- npm tarball integrity: `sha512-mskN3VolIA+opTDFuJiGKeQOm04wI4ljwy1DvE8fb1Dz6Rsm7nCJktw7z3brbCxmEJGr3MmnTE//vQlPCNqEXQ==`
- published git commit: `d05509c34a026c6ee6de28cde47b032bbf56250e`

The published declarations were checked directly for the platformer kernel,
level runtime, level schema, renderer, and save modules. They match the local
`0.3.0` API used by this plan.

## Success criteria

The work is complete when all of the following are true:

1. Positive-gravity platformer behavior remains byte-identical for existing
   configurations and tests.
2. A negative `PlatformerConfig.gravity` accelerates toward negative Y, clamps
   to `-maxFallSpeed`, and treats collision with a solid underside as support.
3. Gravity can switch sign between fixed steps without recreating logical game
   state or using a consumer-written collision integrator.
4. `advanceSequencer(state, 1 / 60, pattern)` fires notes only when actual song
   step boundaries are crossed, not once per simulation call.
5. A defensive host adapter can render the exact `NoteFire[]` returned by
   `advanceSequencer` through an existing `AudioAdapter`.
6. `createSequencer` remains available as the self-scheduling host-clock
   convenience API and does not regress.
7. One `compileLevel` call classifies numeric tiles once, exposes the resulting
   `tileQuery`, and combines deterministic tile-derived solids with entity
   platform solids in `staticSolids`.
8. Existing `compileLevel(level)` calls remain valid and preserve their current
   entity-only collision behavior when no tile classifier is supplied.
9. Every code block and named API in `games/*.md` matches the `0.4.0` root
   barrel and current signatures.
10. During release preparation every game prompt pins the verified published
    release; after registry verification every prompt installs
    `aicraft-engine@0.4.0` exactly.
11. `npm test`, `npm run build`, and `npm run build:dist` pass before publish.
12. A clean external Vite TypeScript smoke project can install the packed
    tarball, import the APIs used by the prompts, and build successfully.

## Non-goals

- Do not add a second collision engine or a Flipside-specific controller.
- Do not make jump, wall-slide, dash, or double-jump fully gravity-relative in
  this release. Flipside is a no-jump game and will use a pipeline/config with
  those abilities disabled.
- Do not make upward one-way platforms block inverted actors. Existing
  `passthrough` semantics remain downward-only.
- Do not synchronize decorative audio back into authoritative simulation
  state.
- Do not add runtime dependencies.
- Do not expose npm subpath exports. Prompts continue importing from the root.
- Do not redesign `LevelData`, renderer helpers, save storage, camera, or
  collectibles merely to fit stale prompt examples. `compileLevel` receives
  only the additive tile-classification output described in Workstream 4; the
  prompts must otherwise adapt to existing APIs.

## Workstream 1: Signed platformer gravity

### Public contract

Expand the documented meaning of two existing fields and add one optional
ability switch:

```ts
interface PlatformerConfig {
  /** Signed gravity in px/s2. Positive pulls down; negative pulls up. */
  readonly gravity: number;
  /** Maximum speed in the current gravity direction, expressed as a magnitude. */
  readonly maxFallSpeed: number;
  /** Master switch for the jump ability. Omitted means enabled. */
  readonly jumpEnabled?: boolean;
  // Existing fields unchanged.
}
```

`jumpEnabled` is optional so existing complete `PlatformerConfig` object
literals remain source-compatible. `DEFAULT_PLATFORMER_CONFIG` explicitly sets
it to `true`. The jump processor treats only `false` as disabled; `true` and
`undefined` preserve existing positive-gravity behavior.

A game that needs the default ability stack can continue passing a signed
config to `stepPlatformer`. Flipside has no abilities at all, so it creates two
controllers once with an empty pipeline and selects between them without
recreating logical state:

```ts
const downController = createPlatformerController([], {
  ...PUZZLE_PLATFORMER,
  gravity: GRAVITY_MAGNITUDE,
});
const upController = createPlatformerController([], {
  ...PUZZLE_PLATFORMER,
  gravity: -GRAVITY_MAGNITUDE,
});

const controller = gravityDirection === 1 ? downController : upController;
state = controller.step(state, input, solids, dt).state;
```

The optional switch and the empty pipeline are complementary. `jumpEnabled`
supports conventional-gravity controllers that selectively disable jump while
retaining other processors. The empty pipeline expresses Flipside's stronger
contract: kernel movement and collision with no jump, wall-slide, dash, or
double-jump processors installed.

### Kernel behavior

Change `src/platformer/kernel.ts` as follows:

1. Derive `gravityDirection` from `Math.sign(config.gravity)`, treating only a
   negative value as inverted. Zero gravity applies no acceleration and retains
   the existing collision behavior; stationary zero-gravity support is outside
   the signed-support scope for `0.4.0`.
2. Apply signed acceleration with `core.vy + config.gravity * dt`.
3. Clamp positive gravity with `Math.min(nextVy, abs(maxFallSpeed))`.
4. Clamp negative gravity with `Math.max(nextVy, -abs(maxFallSpeed))`.
5. Continue using `resolveAxisY`; it already reports physical downward contact
   as `landed` and physical upward contact as `hitCeiling`.
6. Define support contact as `ry.landed` under non-negative gravity and
   `ry.hitCeiling` under negative gravity.
7. Set `core.onGround` from support contact, not unconditionally from
   `ry.landed`.
8. Emit `justLanded` when the actor transitions from unsupported to supported
   in the current gravity direction.
9. Preserve physical contact identity: floor support continues to populate
   `contacts.groundId`; ceiling support populates `contacts.ceilingId`.
10. Preserve `hitCeiling` as a physical upward-collision event. Under inverted
    gravity a newly supported actor may emit both `hitCeiling` and
    `justLanded`; document that intentional result.
11. Preserve canonical velocity units in px/s and zero `vy` on either vertical
    collision as today.

### Moving-platform carry

`createRidingTracker` currently keys carry from `contacts.groundId`. Update the
kernel-to-tracker integration so the support ID is selected by gravity:

- positive or zero gravity: `contacts.groundId`
- negative gravity: `contacts.ceilingId`

Prefer extending the riding tracker to accept an explicit support ID rather
than manufacturing a temporary `ActorCore` with swapped contact fields. Keep
the public behavior backward-compatible for existing callers. If changing the
tracker's public method would be breaking, add an optional support-ID argument
whose default remains `core.contacts.groundId`.

### Ability boundary

The shipped jump stack assumes negative Y is upward. Do not silently claim it
supports inverted gravity. For `0.4.0`:

- Add `jumpEnabled?: boolean` to `PlatformerConfig`, set it to `true` in
  `DEFAULT_PLATFORMER_CONFIG`, and short-circuit `jumpAbility` only when it is
  explicitly `false`.
- The disabled branch returns the input core and jump state unchanged and emits
  no events, matching the existing wall-slide, dash, and double-jump switches.
- Flipside does not rely on four config switches. It uses two prebuilt
  positive/negative-gravity controllers with an empty ability pipeline.
- Existing gravity-positive presets and ability pipelines remain unchanged.
- Do not add an `abilitiesEnabledPipeline` selector in this release. Consumers
  that need a subset compose the existing exported processors explicitly.
- Ability switches freeze their processor state while disabled. Apply a
  mid-game unlock at a grounded/reset boundary; arbitrary midair disable and
  re-enable state reconciliation is deferred.
- JSDoc states that signed gravity support covers kernel force integration,
  support contact, horizontal movement, collision, and carry. Gravity-relative
  jump abilities are deferred.

### Tests

Add signed-gravity cases to `src/tests/platformer-kernel.test.ts`:

1. Existing positive gravity still accelerates downward and clamps at positive
   `maxFallSpeed`.
2. Negative gravity accelerates upward and clamps at negative
   `maxFallSpeed`.
3. An inverted actor colliding with a ceiling has `onGround === true`,
   `contacts.ceilingId` set, and `vy === 0`.
4. First inverted ceiling support emits `justLanded` once.
5. Remaining on the ceiling does not repeatedly emit `justLanded`.
6. Flipping from positive to negative gravity makes the former floor contact
   cease to count as support.
7. Flipping back restores downward support behavior.
8. Input state remains immutable.
9. Two runs with the same gravity-sign sequence remain byte-identical.
10. Negative-gravity support can be carried by a moving ceiling when a
    displacement provider is present.
11. Existing positive-gravity snapshots and tests remain unchanged.

Add or update public barrel assertions only if a new tracker overload/type is
exported.

Extend `src/tests/platformer-jump-ability.test.ts`:

1. `jumpEnabled: false` returns the input core and jump state unchanged and
   emits no launch event, even when jump is pressed.
2. `jumpEnabled: false` does not overwrite signed kernel vertical velocity.
3. `jumpEnabled: true` preserves existing jump behavior.
4. An omitted `jumpEnabled` preserves existing jump behavior for source and
   runtime compatibility.
5. Disabled processing does not mutate the input context or state.

### Documentation

Update:

- `src/platformer/types.ts` JSDoc for `gravity`, `maxFallSpeed`, `onGround`,
  `jumpEnabled`, `groundId`, `ceilingId`, `justLanded`, and `hitCeiling`.
- `src/platformer/constants.ts` with `jumpEnabled: true` in
  `DEFAULT_PLATFORMER_CONFIG`.
- `src/platformer/abilities/jump-ability.ts` with the explicit-false guard and
  public contract JSDoc.
- `src/platformer/kernel.ts` module and function examples.
- `docs/api-surface.md` platformer kernel section.
- `docs/design/platformer-kernel-decision.md` with an additive `0.4.0`
  signed-gravity clarification rather than rewriting the original decision.
- `README.md` platformer row if signed gravity is worth naming in the summary.

## Workstream 2: Correct fixed-step music advancement

### Existing defect

`advanceSequencer` currently starts each call's nominal step cursor at
`state.elapsedS`. Consequently, a game calling it with `dt = 1 / 60` advances
at least one musical step per simulation tick even when a song step is much
longer than `1 / 60` second.

The state already contains enough information to locate the next absolute song
boundary:

```ts
const absoluteStep = state.loopCount * stepsPerPattern + state.stepIndex;
const boundaryS = absoluteStep * stepDuration;
```

`stepIndex` is interpreted as the next step to fire. The initial state
`{ elapsedS: 0, stepIndex: 0, loopCount: 0 }` therefore fires step zero once at
time zero. After that, repeated sub-step advances remain silent until the next
absolute boundary enters the advance window.

### Advance algorithm

Change `src/music/advance.ts` as follows:

1. Sanitize `dt`, pattern length, tempo, and state values as today.
2. Compute the advance window as `[elapsedS, elapsedS + dt)` while retaining
   the intentional initial step-zero event.
3. Compute the absolute ordinal of the next step from `loopCount` and
   `stepIndex`.
4. Fire only boundaries that are greater than or equal to the window start and
   strictly less than the window end, with an explicit allowance for the
   initial zero boundary.
5. Calculate `whenOffset` from `boundaryS - windowStart`, then add the existing
   swing delay for odd steps.
6. Advance the ordinal for every visited step, including rests.
7. Derive returned `stepIndex` and `loopCount` from the final ordinal.
8. Set returned `elapsedS` to `windowEnd`.
9. Retain a deterministic iteration cap for malformed or enormous inputs.
10. Preserve fresh-state and never-throw guarantees.

The implementation must be checked carefully at exact floating-point
boundaries. Tests should prefer `toBeCloseTo` for elapsed values but exact event
arrays where practical.

### Tests

Extend `src/tests/music-advance.test.ts`:

1. Step zero fires once on the first `1 / 60` call.
2. Repeated `1 / 60` calls before the next musical boundary produce no
   duplicate event.
3. The next note fires on the correct accumulated boundary for a known BPM.
4. One large advance and the equivalent sequence of fixed advances produce
   the same MIDI/event order and final state.
5. Exact-boundary calls neither skip nor duplicate notes.
6. Loop wrapping increments `loopCount` exactly once.
7. Swing offsets remain relative to the current advance window.
8. Rests advance state without producing events.
9. Degenerate state and pattern inputs remain never-throw.
10. Input `SequencerState` remains unchanged.

Update `src/tests/music-sequencer.test.ts` where existing expectations relied on
the defective one-step-per-call behavior. The host scheduler still calls
`advanceSequencer` with one full `stepDur`, so its external behavior should
remain the same.

## Workstream 3: External `NoteFire` host adapter

### API choice

Add a small host adapter instead of overloading `createSequencer`:

```ts
export interface NoteFirePlayer {
  play(events: readonly NoteFire[]): void;
  setVolume(value: number): void;
  getVolume(): number;
  dispose(): void;
}

export function createNoteFirePlayer(
  audio: AudioAdapter,
): NoteFirePlayer;
```

Rationale:

- `createSequencer` owns a pattern, a private `SequencerState`, an audio-clock
  cursor, and a timer chain. It is the correct API for autonomous decorative
  music.
- `createNoteFirePlayer` owns no pattern and no simulation state. It only maps
  externally produced `NoteFire` data onto the shared `AudioAdapter`.
- The split makes it impossible to accidentally double-advance one song while
  claiming both clocks are authoritative.
- The adapter follows existing factory naming and defensive host rules.

### Adapter behavior

Create `src/music/note-fire-player.ts`:

1. Resolve no host globals at module or factory time.
2. Accept the existing `AudioAdapter`; never create an `AudioContext`.
3. For each event, convert MIDI through `noteToFrequency`.
4. Call `audio.playTone(waveform, frequency, frequency, gateS * 1000,
   peak * volume, max(0, whenOffset))`.
5. Clamp volume to `[0, 1]`, treating non-finite input as zero.
6. No-op after disposal.
7. Swallow adapter errors and malformed events.
8. Do not retain, mutate, or replay event arrays.
9. Do not expose host clock state to the simulation.

Export the interface and factory from `src/music/index.ts` and therefore the
top-level `src/index.ts` barrel.

### Simulation/host usage

Flipside will use one music progression path:

```ts
let sequencerState: SequencerState = {
  elapsedS: 0,
  stepIndex: 0,
  loopCount: 0,
};

const notePlayer = createNoteFirePlayer(audio);

function step(dt: number): void {
  const result = advanceSequencer(sequencerState, dt, pattern, { swing: 0.66 });
  sequencerState = result.next;
  notePlayer.play(result.events);
}
```

Audio remains decorative: `NoteFirePlayer.play()` must not influence the next
simulation state. Replay or headless callers can omit the adapter call while
advancing the same `SequencerState`.

### Tests

Add `src/tests/music-note-fire-player.test.ts` with a fake `AudioAdapter`:

1. Correct MIDI-to-frequency mapping.
2. Correct gate seconds-to-milliseconds conversion.
3. Correct `whenOffset` forwarding and negative-offset clamping.
4. Music volume scales event peak independently of adapter SFX volume.
5. Volume clamps finite values and treats non-finite values as zero.
6. Empty event arrays are no-ops.
7. Locked, throwing, malformed, and disposed cases never throw.
8. Event inputs are not mutated.
9. Repeated disposal is safe.

Update `src/tests/barrel-contract.test.ts` to assert the new root exports.

### Documentation

Update:

- `src/music/types.ts` with `NoteFirePlayer`.
- `src/music/index.ts` exports.
- `docs/api-surface.md` music section.
- `docs/design/music-sequencer-decision.md` with the additive external-output
  path and the distinction between autonomous and simulation-driven playback.
- `README.md` music row if needed.

## Workstream 4: Unified tile and entity level compilation

### Public contract

Extend the existing compiler without changing `LevelData` or adding a second
collision engine:

```ts
interface CompileLevelOptions {
  /** Classify serialized numeric tile values for platformer collision. */
  readonly tileTypeMap?: (tileValue: number) => TileType;
  // Existing fields unchanged.
}

interface CompiledLevel {
  /** Entity-derived and tile-derived static collision geometry. */
  readonly staticSolids: readonly Solid[];
  readonly movingPlatforms: readonly CompiledMovingPlatform[];
  readonly initialState: PlatformerState;
  /** Classification captured during compilation for debug/gameplay queries. */
  readonly tileQuery: TileSolidityQuery;
}
```

Consumers provide the numeric classification once:

```ts
const compiled = compileLevel(level, {
  tileTypeMap: value =>
    value === 1 ? 'solid' :
    value === 2 ? 'passthrough' :
    'empty',
});
```

The compiler owns the bridge from both serialized sources to platformer
runtime data:

- Numeric tiles become static collision geometry according to `tileTypeMap`.
- `platform` and `passthrough` entities continue becoming static geometry.
- `movingPlatform` entities continue becoming consumer-advanced descriptors.
- `staticSolids` is the complete static input to `stepPlatformer`.
- `tileQuery` exposes the exact captured classification used to build the tile
  solids. It is suitable for collision debug views and gameplay sampling.
- Rendering still reads `level.tiles` through `drawTileGrid`; `tileQuery` does
  not replace serialized tile values or tile appearance callbacks.

### Compatibility and defensiveness

1. `tileTypeMap` is optional. When omitted, every numeric tile classifies as
   `empty`, so existing `compileLevel(level)` calls retain entity-only collision
   behavior.
2. Classification happens exactly once per in-bounds grid cell, in row-major
   order, during `compileLevel`.
3. `staticSolids` and `tileQuery` are both derived from that captured
   classification. The consumer callback is not retained or called by later
   queries, so mutable callback state cannot make query results drift from the
   compiled geometry.
4. A malformed grid, invalid classifier result, or throwing classifier degrades
   that cell to `empty`; `compileLevel` and the returned `tileQuery` remain
   never-throwing.
5. Existing entity-derived solids appear first and retain their current order.
   Tile-derived solids follow them. This preserves entity contact identity when
   entity and tile geometry intentionally overlap.
6. Entity solid IDs remain `entity-<id>`. Tile-derived solids receive stable,
   namespaced IDs derived only from their compiled bounds, such as
   `tile-<x>-<y>-<width>-<height>`.
7. The standalone `createTileQuery(grid, typeMap)` API remains available for
   consumers that do not use `compileLevel`; its existing contract is unchanged.

### Deterministic flattening

Do not emit one `Solid` for every occupied cell. Flatten the captured tile
classification into stable rectangles:

1. Traverse cells in deterministic row-major order.
2. Merge adjacent full-solid cells into non-overlapping rectangles using one
   documented deterministic greedy rule.
3. Merge passthrough cells horizontally within each row only. Do not merge
   passthrough cells vertically because their one-way top surfaces are
   semantically significant.
4. Never merge `solid` and `passthrough` cells together.
5. Express all generated bounds in world pixels using `tileSize`.
6. Emit tile solids after entity solids in deterministic top-to-bottom,
   left-to-right order.
7. Keep the generated arrays and query detached from later mutation of the
   source `LevelData.tiles.data` array.

### Runtime usage

Kernel games use one compilation path:

```ts
const compiled = compileLevel(level, { tileTypeMap });
let movingPlatforms = compiled.movingPlatforms;

function step(dt: number): void {
  const previous = movingPlatforms;
  movingPlatforms = movingPlatforms.map(platform =>
    advanceMovingPlatform(platform, dt),
  );
  const solids = [
    ...compiled.staticSolids,
    ...movingPlatforms.map(movingPlatformToSolid),
  ];
  const displacement = createMovingPlatformDisplacementProvider(
    movingPlatforms,
    previous,
  );
  state = stepPlatformer(
    state,
    input,
    solids,
    dt,
    config,
    displacement,
  ).state;
}
```

Games must not separately flatten tiles, append duplicate tile geometry, or run
`resolveTileX`/`resolveTileY` alongside `stepPlatformer` for the same actor.

### Tests

Extend `src/tests/platformer-level-runtime.test.ts`:

1. Omitted `tileTypeMap` preserves existing entity-only `staticSolids` output.
2. Solid numeric tiles join entity-derived static solids.
3. Passthrough numeric tiles produce `passthrough: true` solids.
4. `tileQuery` returns the exact captured type for every in-bounds cell and
   `empty` out of bounds.
5. Mutating the source grid or classifier state after compilation changes
   neither `tileQuery` nor `staticSolids`.
6. Full-solid rectangles are coalesced according to the documented greedy rule.
7. Passthrough tiles merge horizontally but not vertically.
8. Tile-derived IDs and output order are deterministic and stable.
9. Entity solids precede tile solids, preserving entity identity on overlap.
10. Malformed grids, invalid classifier values, and throwing classifiers never
    throw and degrade affected cells to `empty`.
11. Input `LevelData` remains unchanged.
12. Two compilations of the same level and classifier are byte-identical apart
    from function identity; sampled query results and serialized data outputs
    are identical.

Add an integration case to `src/tests/platformer-kernel.test.ts` proving that an
actor passed `compiled.staticSolids` lands on tile-authored terrain without a
consumer collision adapter.

### Documentation

Update:

- `src/platformer/level-runtime.ts` JSDoc and examples.
- `docs/api-surface.md` entries for `CompileLevelOptions`, `CompiledLevel`, and
  `compileLevel`.
- The relevant level/runtime design decision with an additive `0.4.0` unified
  compilation clarification.
- `README.md` level-loading summary if it currently implies entity-only
  collision compilation.

## Workstream 5: Shared prompt corrections

Apply these corrections consistently to all four game prompts.

### Installation and imports

- Replace `npm install aicraft-engine` with
  `npm install aicraft-engine@0.4.0` after publication.
- Keep root-barrel imports only.
- Remove redundant `npm install -D vite` after `npm create vite@latest` unless a
  prompt intentionally pins Vite separately.
- Include every referenced runtime export and `type` import in each prompt's
  claimed complete import block.
- Do not claim that every exported symbol lives in a specific local source
  path; the npm contract is the published root declaration barrel.

### Level schema and runtime

Every `LevelData` example must use:

```ts
const level: LevelData = {
  version: LEVEL_VERSION,
  id: 'level-id',
  name: 'Level Name',
  width: 640,
  height: 360,
  tileSize: 16,
  spawn: { x: 32, y: 288 },
  tiles: {
    data: [],
    cols: 40,
    rows: 22,
    tileSize: 16,
  },
  entities: [],
  nextEntityId: 1,
};
```

Use numeric entity IDs and the current discriminated shape:

```ts
const coin: LevelEntity = {
  id: 1,
  kind: 'collectible',
  rect: { x: 64, y: 240, width: 12, height: 12 },
  props: { kind: 'coin', value: 1, persists: true },
};
```

State the responsibilities accurately:

- `level.tiles`: serialized tile data.
- `compileLevel(level, { tileTypeMap })`: the unified runtime bridge. It
  classifies numeric tiles once, combines tile-derived and entity-derived
  geometry in `staticSolids`, and returns `tileQuery`, `movingPlatforms`, and
  `initialState`.
- `createTileQuery(level.tiles, typeMap)`: the standalone tile-solidity bridge
  for consumers that are not using the unified platformer compiler.
- `level.entities`: consumer-owned rendering and gameplay semantics for exits,
  traps, hazards, enemies, and collectibles.

Do not reference nonexistent `compiled.tileGrid`, `compiled.entities`,
`compiled.collectibles`, or `compiled.solids` fields. `compiled.tileQuery` is a
real `0.4.0` field and must match the classification used for tile-derived
`compiled.staticSolids`.

### Rendering

Use the actual signatures:

```ts
drawTileGrid(ctx, level.tiles, drawTile);
drawActor(ctx, state.core, { palette });
drawLevelEntity(ctx, entity, { palette, drawOverride });
```

The consumer-provided `drawTile` callback is part of the documented engine API,
not a forbidden reimplementation. Acceptance criteria may forbid duplicating
grid traversal, but they must permit tile appearance callbacks.

Use the actual parallax signature:

```ts
drawTiledParallax(ctx, drawTile, cameraX, factor, tileWidth, viewportWidth);
```

Do not invent callback-free image/layer overloads or redefine the shipped
`PARALLAX_FAR`, `PARALLAX_MID`, and `PARALLAX_NEAR` constants.

### Save and collectibles

Use one key per storage instance:

```ts
const storage = createLocalStorageSaveStorage('game-save-key');
let save = loadSave(storage, DEFAULT_SAVE);
writeSave(storage, save);
```

Use immutable collectible state threading:

```ts
const pickups = derivePickups(playerRect, collectibleEntities, save.collectibles);
for (const id of pickups.collected) {
  save = {
    ...save,
    collectibles: collect(save.collectibles, id),
  };
}
```

Use the exact `derivePickups` result shape: `collected` IDs plus `remaining`
entities. Do not expect point records or pass a collectible-kind string as the
save argument.

### Immutable APIs

Every prompt must assign returned state:

```ts
hitStop = triggerHitStop(hitStop);
hitStop = stepHitStop(hitStop, 1);

const footPlantResult = advanceFootPlant(footPlant, leftLift, rightLift);
footPlant = footPlantResult.state;

gameState = reduceGameState(gameState, event, dt);
```

Review all uses of progression operations for the same mistake.

### Units

- `createGameLoop` passes fixed `dt` in seconds.
- Platformer, camera, tween, jump, spring, and music progression use seconds
  according to their documented contracts.
- Hit-stop duration is in ticks and should be advanced by `1` per fixed tick.
- Shipped emitter presets use tick units and should be stepped with `1`, or the
  prompt must explicitly convert the seconds delta.
- Locomotion-by-displacement receives actual per-step displacement, normally
  `state.core.vx * dt * state.core.facing`, not raw velocity.

### Common acceptance criteria

Replace brittle grep wording with behavior-oriented checks:

- No direct `requestAnimationFrame`; use `createGameLoop`.
- No `Math.random` or `Date.now` in authoritative simulation.
- No duplicate AABB implementation; use engine collision APIs.
- No duplicate tile-grid traversal; use `drawTileGrid`, while permitting its
  required `drawTile` callback.
- No raw WebAudio graph; use `AudioAdapter`, `createSequencer`, or
  `createNoteFirePlayer` as appropriate.
- Reduced-motion mode renders a static frame and starts neither the game loop
  nor music host adapters.

## Workstream 6: Embertomb prompt

File: `games/simple-platformer.md`

### Required corrections

1. Keep the verified published pin during release preparation; switch to
   `aicraft-engine@0.4.0` only after registry verification.
2. Complete the root import block with every referenced export, including
   `solveLimb`, `sineShake`, `shakeEnvelope`, moving-gap helpers, and any save,
   cosmetics, or IAP APIs retained by stretch goals.
3. Correct `advanceJump` inputs to `jumpPressed`, `jumpHeld`, `isGrounded`, and
   optional `hitCeiling`.
4. Thread the returned `JumpState` and other immutable state.
5. Replace spring shorthand with full scalar anchor coordinates and config.
6. Replace the invalid wave-line-as-emitter-region example with an actual
   `SpawnRegion`, such as a line region matching the liquid surface bounds.
7. Explain that `WavePoint[]` is rendering geometry, not an emitter region.
8. Pass `vx * dt * facing` to displacement-driven locomotion.
9. Correct `volumeScale` wording: positive values stretch vertically;
   negative values squash vertically.
10. Normalize emitter and hit-stop units.
11. Import or remove `advanceGapMotion` and `gapSolids` references.
12. Correct the enemy count after the final enemy list is settled.
13. Renumber acceptance and stretch criteria so cross-references are valid.

### Verification

- Every imported name resolves from the `0.4.0` root barrel.
- Jump and spring examples typecheck.
- The emitter example accepts a legal `SpawnRegion`.
- Acceptance criteria permit required game-specific render callbacks.

## Workstream 7: Celerock prompt

File: `games/celerock.md`

### Required corrections

1. Keep the verified published pin during release preparation; switch to
   `aicraft-engine@0.4.0` only after registry verification.
2. Add omitted gamepad and type imports.
3. Replace obsolete level/runtime examples with current `LevelData` and the
   unified `compileLevel(level, { tileTypeMap })` path. Tile-derived and entity
   solids come from `compiled.staticSolids`; do not flatten tiles separately.
4. Call `createMovingPlatformDisplacementProvider(current, previous)` with the
   two moving-platform snapshots.
5. Build current solids each tick from `compiled.staticSolids` and
   `movingPlatforms.map(movingPlatformToSolid)`.
6. Use exact spring-rod factory and advance signatures.
7. Replace the false four-tile dash statement with the actual time/velocity
   tuning. If exact four-tile travel is a game requirement, calculate and set
   Celerock's own `dashSpeed` and `dashDuration` explicitly.
8. Remove the claim that the kernel lacks coyote time and jump buffering.
9. Correct `drawText` to pass an options object rather than `DEFAULT_FONT` as a
   positional argument.
10. Correct palette generation to pass a numeric seed.
11. Correct locomotion displacement and squash/stretch signs.
12. Correct all save and collectible examples.
13. Replace the game-state example with the current API:
    `state.current`, legal shipped modes/events, `createGameState` options, and
    `reduceGameState(state, event, dt)` returning `GameState` directly.
14. Assign immutable hit-stop and foot-plant returns.
15. Resolve the internal contradiction over whether death count is persisted.
16. Do not append a second dash processor when the text says to replace or
    customize dash behavior.

### Verification

- The platformer step assembles correct static and moving solids.
- FSM examples compile and use only canonical modes/events.
- Collectible persistence survives a save round-trip.
- Dash distance claimed by prose agrees with the configured arithmetic.

## Workstream 8: World 1-1 prompt

File: `games/world-1-1.md`

### Required corrections

1. Keep the verified published pin during release preparation; switch to
   `aicraft-engine@0.4.0` only after registry verification.
2. Remove all claims that `CLASSIC_PLATFORMER` provides double-jump. It
   explicitly sets `doubleJumpEnabled: false` and `maxDoubleJumps: 0`.
3. Correct `stepPlatformer` to
   `stepPlatformer(state, input, solids, dt, CLASSIC_PLATFORMER)`.
4. Replace obsolete level and entity examples with the current schema.
5. Use `tiles`, not `tileGrid`, and pixel dimensions at the level top level.
6. Replace unsupported block `contains` metadata with consumer-owned metadata
   outside `LevelEntity` or a supported entity/props representation.
7. Pass the tile classifier to `compileLevel(level, { tileTypeMap })` and use
   its captured `tileQuery`; do not run a separate tile collision path beside
   `stepPlatformer`.
8. Use `validateLevel(level).valid` and surface its `errors` diagnostics.
9. Either remove migration from a newly authored current-version level or call
   `migrateLevel(raw, migrations, targetVersion)` and inspect its result.
10. Use `createCamera()` with no arguments and call
    `updateCamera(camera, targetRect, bounds, viewport, config)`.
11. Implement lookahead as consumer-owned target-rectangle positioning rather
    than invented camera config fields.
12. Correct `derivePickups`, immutable `collect`, and save storage usage.
13. Replace invalid `pressEdge(state, 'jump')` usage with proper edge
    accumulation and polling.
14. Remove nonexistent `defaultTextStyle`.
15. Construct custom enemy registries with handlers rather than registering
    them through a nonexistent mutator.
16. Pass `GameEvent` to `isLegalTransition`, not a destination mode string.
17. Use canonical game modes; remove `attract` and `dying` unless modeled as
    consumer-owned state outside the engine FSM.
18. Correct `drawTiledParallax` and `drawLevelEntity` calls.
19. Correct locomotion displacement and squash/stretch signs.
20. Resolve the wording contradiction between a procedural visual style and a
    deliberately hand-authored level.
21. Renumber acceptance criteria and build-order cross-references.

### Verification

- The level validates under the current schema.
- `CLASSIC_PLATFORMER` behavior and prompt claims agree.
- Camera, collectibles, input, and FSM snippets typecheck.
- The build brief never refers to nonexistent criterion 14.

## Workstream 9: Flipside prompt

File: `games/flipside.md`

### Required corrections

1. Keep the verified published pin during release preparation; switch to
   `aicraft-engine@0.4.0` only after registry verification.
2. Remove the two competing gravity implementation paths.
3. Use the signed-gravity kernel path exclusively:
   - maintain consumer-owned `gravityDirection: 1 | -1`;
   - flip it only on a polled edge;
   - create positive- and negative-gravity controllers once;
   - give both controllers an empty ability pipeline;
   - select the matching controller each fixed step without replacing
     `PlatformerState`;
   - rely on gravity-relative `onGround` and `justLanded` from `0.4.0`.
4. Remove the consumer gravity integrator and continue prohibiting duplicate
   gravity or collision resolution.
5. Replace stale room `LevelData`, entity, tile, rect, and compile examples.
6. Compile room tiles and entity platforms through one
   `compileLevel(level, { tileTypeMap })` call. Use `compiled.staticSolids` for
   all static kernel collision and `compiled.tileQuery` for debug/gameplay
   sampling; do not maintain a consumer tile flattener.
7. Correct renderer calls and permit the required tile appearance callback.
8. Correct palette generation to use a numeric seed and a shipped harmony
   strategy. There is no `mono` strategy or named `pair` contrast option in
   `0.3.0`; do not claim one unless separately added and tested.
9. Correct camera target rectangles to include `width` and `height`.
10. Correct spring-rod calls and `outlineRect` argument order.
11. Keep rendering (`drawGlow`) out of pickup simulation.
12. Correct save, collectibles, and immutable game-state updates.
13. Choose one music clock:
    - call `advanceSequencer` exactly once per fixed simulation step;
    - pass only its returned events to `createNoteFirePlayer`;
    - do not create or call `createSequencer` in this game;
    - reset or replace `SequencerState` explicitly when changing patterns.
14. Create no audio or music adapter when reduced motion is active.
15. Correct MIDI 60 to C4.
16. Resolve the one-tick versus twelve-tick death-duration contradiction.
17. Update the architecture table, file layout, acceptance criteria, and build
    order to name `createNoteFirePlayer` rather than `createSequencer`.

### Verification

- A scripted gravity-sign sequence carries the actor from floor support to
  ceiling support and back deterministically.
- The two gravity controllers are allocated once, share one logical
  `PlatformerState`, and install no ability processors.
- No consumer gravity or collision integrator exists.
- Every audible note originates from the exact `NoteFire[]` returned by the
  fixed-step `advanceSequencer` call.
- Reduced-motion boot creates neither a game loop nor a note player.
- Room, palette, camera, save, and renderer examples typecheck.

## Workstream 10: Catalog README

File: `games/README.md`

### Required corrections

1. State that prompts target and install exact engine releases.
2. Update the common contract to permit renderer callbacks required by engine
   APIs while still forbidding duplicated traversal/physics systems.
3. Correct the Celerock summary after its compile/render path is fixed.
4. Describe `CLASSIC_PLATFORMER` as jump without double-jump.
5. Describe Flipside as using signed platformer gravity and
   `advanceSequencer` plus `createNoteFirePlayer`.
6. Update the adding-a-prompt template requirements to include an exact package
   version and a public-API compilation check.
7. Ensure candidate ideas name only current exports and do not imply unsupported
   behavior.

## Workstream 11: Package and release hygiene

### Versioning

The planned release is `0.4.0` because it adds public behavior and a new public
music adapter to a pre-1.0 package. Do not update prompt pins until that exact
version exists on npm.

Update together:

- `package.json` version
- `package-lock.json` root package version
- any explicit version references in README/docs
- all `games/*.md` install commands, after the registry reports `0.4.0`

The audit found `package.json` at `0.3.0` while the lockfile root metadata still
reported `0.2.0`; correct this during release preparation.

### Pre-publish gates

Run in this order:

```bash
npm test
npm run build
npm run build:dist
npm pack --dry-run
```

Inspect the dry-run file list and confirm:

- `dist/index.js` and `dist/index.d.ts` exist.
- New music declarations and implementation files are included.
- No source tests, showcase files, benchmarks, or game prompts leak into the
  npm tarball.
- No runtime dependency block was introduced.

### External package smoke test

Before publication, create a temporary Vite vanilla TypeScript project outside
the repository and install the locally packed tarball. Compile a contract file
that imports and minimally invokes:

- signed-gravity `stepPlatformer`
- unified `compileLevel(level, { tileTypeMap })`
- `CompiledLevel.tileQuery` and tile-derived `staticSolids`
- standalone `createTileQuery`
- `drawTileGrid`
- save and collectible operations
- `advanceSequencer`
- `createNoteFirePlayer`

Run the temporary project's production build. Remove the temporary project and
tarball afterward.

### Publication verification

After explicit approval to publish:

1. Publish `0.4.0` without bypassing `prepack`.
2. Confirm `npm view aicraft-engine version` reports `0.4.0`.
3. Fetch the published `package.json` and relevant `.d.ts` files from a package
   CDN or registry tarball.
4. Repeat the external Vite smoke build against
   `aicraft-engine@0.4.0`, not the local tarball.
5. Only then finalize every prompt's exact `@0.4.0` pin.

## Implementation order

Use this sequence to keep failures localized:

1. Write failing signed-gravity kernel and disabled-jump tests.
2. Implement signed acceleration, clamping, support semantics, carry, and the
   optional `jumpEnabled` guard.
3. Run platformer and replay tests.
4. Write failing fixed-step sequencer boundary tests.
5. Correct `advanceSequencer` and update host sequencer tests.
6. Write failing `NoteFirePlayer` tests.
7. Implement and export `createNoteFirePlayer`.
8. Write failing unified level-compilation tests.
9. Implement captured tile classification, deterministic flattening,
   `CompiledLevel.tileQuery`, and combined static solids.
10. Update engine API documentation and barrel contracts.
11. Run all engine tests and typecheck.
12. Correct shared patterns across the four prompts.
13. Correct Embertomb, Celerock, World 1-1, and Flipside individually.
14. Update `games/README.md` last so it describes the final prompt contents.
15. Build `dist/`, run package dry-run inspection, and perform the local
    external smoke test.
16. Update package versions and prepare `0.4.0` publication.
17. Publish only with explicit user approval.
18. Verify npm and switch final prompt pins to the confirmed published release.

## Review checkpoints

Pause for focused review after each checkpoint:

### Checkpoint A: signed gravity

- Positive-gravity golden behavior unchanged.
- Inverted support semantics are clear and deterministic.
- Ability limitations are explicit.
- `jumpEnabled` is optional, defaults to enabled, and does not change existing
  configs or positive-gravity behavior.
- Flipside uses two prebuilt empty-pipeline controllers and one logical state;
  no new state field is introduced.

### Checkpoint B: music

- Fixed-step boundary bug is demonstrably fixed.
- `createSequencer` and `createNoteFirePlayer` have distinct, non-overlapping
  ownership models.
- Host adapter remains defensive and never feeds data into simulation.

### Checkpoint C: unified level compilation

- Existing entity-only compilation remains backward-compatible.
- Tile classification is captured once and cannot drift from generated solids.
- Flattened output is deterministic, compact, and preserves passthrough
  semantics.
- Kernel games need no consumer-authored tile collision bridge.

### Checkpoint D: prompts

- Every referenced symbol exists in the root declarations.
- Every example uses current signatures and return shapes.
- Each prompt is internally consistent about units, persistence, and reduced
  motion.
- Acceptance criteria do not ban callbacks required by the public API.

### Checkpoint E: release

- Tests, typecheck, dist build, dry-run package inspection, and external Vite
  smoke build all pass.
- Version metadata is synchronized.
- Publication happens only after explicit approval.

## Expected files changed

Engine implementation and tests:

- `src/platformer/kernel.ts`
- `src/platformer/types.ts`
- `src/platformer/constants.ts`
- `src/platformer/abilities/jump-ability.ts`
- `src/platformer/riding-tracker.ts` if explicit support-ID carry is needed
- `src/music/advance.ts`
- `src/music/note-fire-player.ts`
- `src/music/types.ts`
- `src/music/index.ts`
- `src/platformer/level-runtime.ts`
- `src/tests/platformer-kernel.test.ts`
- `src/tests/platformer-jump-ability.test.ts`
- `src/tests/platformer-determinism.test.ts` if gravity sequences get a separate
  deterministic fixture
- `src/tests/music-advance.test.ts`
- `src/tests/music-sequencer.test.ts`
- `src/tests/music-note-fire-player.test.ts`
- `src/tests/platformer-level-runtime.test.ts`
- `src/tests/barrel-contract.test.ts`

Engine documentation and release metadata:

- `docs/api-surface.md`
- `docs/design/platformer-kernel-decision.md`
- `docs/design/music-sequencer-decision.md`
- `docs/design/level-schema-decision.md`
- `README.md`
- `package.json`
- `package-lock.json`
- generated `dist/` files during release preparation

Game prompt documentation:

- `games/README.md`
- `games/simple-platformer.md`
- `games/celerock.md`
- `games/world-1-1.md`
- `games/flipside.md`

## Risks and mitigations

### Positive-gravity regression

Risk: generalizing support semantics changes existing landing, jump, or moving
platform behavior.

Mitigation: preserve the positive path exactly, add explicit regression tests,
and compare existing deterministic outputs before accepting the kernel change.

### Ambiguous contact naming

Risk: `onGround` becomes gravity-relative while `groundId` remains physical,
which may surprise consumers.

Mitigation: document `onGround` as support-relative and `groundId`/
`ceilingId` as physical sides. Avoid silently swapping contact IDs.

### Unsupported inverted abilities

Risk: consumers infer that signed gravity automatically makes jump and
wall-slide gravity-relative.

Mitigation: explicitly scope and document `0.4.0`; use empty-pipeline
controllers in Flipside and defer a full oriented-ability design.

### Ability-toggle state resumption

Risk: like the existing wall-slide, dash, and double-jump switches, disabling
`jumpEnabled` freezes its internal state. Re-enabling it during an active
airborne sequence could resume stale jump progression.

Mitigation: document `jumpEnabled` as a controller/room capability and apply
progressive unlock changes at a grounded or reset boundary. Test disabled,
enabled, and omitted behavior; defer arbitrary midair toggle reconciliation.

### Sequencer off-by-one errors

Risk: changing absolute boundary logic duplicates or skips events at exact
step and loop boundaries.

Mitigation: test initial zero, sub-step calls, exact boundaries, large versus
partitioned advances, swing, and loop wrap.

### Audio timing jitter

Risk: simulation-driven event playback has less lookahead than the autonomous
two-clock sequencer.

Mitigation: retain `whenOffset`, schedule through `AudioAdapter.playTone`, keep
the fixed step at 60 Hz, and document that `createSequencer` remains preferred
when simulation ownership is unnecessary.

### Tile flattening drift or excess geometry

Risk: compiling each occupied tile independently creates a large `Solid[]`, or
classifying tiles again at query time allows `tileQuery` to disagree with the
geometry supplied to the kernel.

Mitigation: classify each cell once, retain the captured classification, apply
a deterministic greedy rectangle merge for full solids, merge passthroughs
horizontally only, and test stable IDs/order plus source-mutation isolation.

### Prompt drift after release

Risk: unpinned packages or future edits silently invalidate examples.

Mitigation: exact `@0.4.0` pins, root-only imports, and an external package
smoke test before changing the pins.

## Definition of done

This plan is complete only when the engine capability, documentation, npm
artifact, and game prompts agree. Updating prose against unpublished local
source is not sufficient, and publishing engine changes without rebuilding the
prompts is not sufficient. The final source of truth is the installed
`aicraft-engine@0.4.0` root declaration surface as consumed by a clean strict
TypeScript Vite project.
