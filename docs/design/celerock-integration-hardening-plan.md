# Celerock Integration Hardening Plan

**Status:** Proposed  
**Scope:** `aicraft-engine`, the Celerock build prompt, published examples, and release verification  
**Primary evidence:**

- `/Users/morganpage/Documents/VSCODE/OPENCODE/TUTORIALS/simple-platformer/BUILD_NOTES.md`
- `/Users/morganpage/Documents/VSCODE/OPENCODE/TUTORIALS/celerock/ISSUES.md`
- `games/celerock.md`
- The current `aicraft-engine@0.6.0` source and built package

## 1. Executive summary

Two independent Celerock builds encountered the same classes of failure:

1. The prompt's executable examples had drifted from the published API.
2. The engine exposed the required primitives but left substantial LDtk/platformer integration glue to each game.
3. Several engine contracts were ambiguous or internally inconsistent, especially spawn coordinates, entity-to-solid identity, and room-local camera transitions.
4. The supplied LDtk content did not satisfy the prompt's unconditional gameplay requirements.
5. Presentation requirements such as camera framing, room transitions, player sprites, and hair were underspecified or contradictory.
6. The test and QA guidance did not provide a reliable, engine-owned reference harness.

The plan is to address these failures at the lowest correct layer:

- Fix package and runtime defects in the engine.
- Add a supported LDtk platformer integration layer instead of repeating consumer glue.
- Replace fragile state inference with semantic engine events.
- Publish a compiler-checked Celerock starter and adversarial fixture.
- Reduce `games/celerock.md` to a product brief whose code snippets are release-tested.

The intended outcome is that a future coding agent can build Celerock by composing supported APIs, without reverse-engineering `.d.ts` files, reading unpublished showcase code, fabricating collision triggers, or inventing room-transition math.

## 2. Goals

### 2.1 Product goals

- A fresh Celerock build boots on the first implementation of the documented load path.
- The supplied LDtk project remains the source of level geometry and authored gameplay entities.
- Player feel remains consistent across 8, 16, and 32 pixel tile sizes.
- Spawn, respawn, and room entry are visually and physically stable from the first rendered frame.
- Room transitions have an explicit presentation policy and preserve momentum and visual continuity.
- Missing optional LDtk content produces actionable diagnostics rather than contradictory acceptance failures.
- Pixel sprites remain crisp and stable when procedural animation effects are enabled elsewhere.
- Errors in consumer callbacks cannot silently leave the game frozen on its last frame.

### 2.2 Engineering goals

- The packed npm artifact imports in every environment claimed by `package.json`.
- Public examples compile against the exact package version they document.
- LDtk entity translation covers every engine entity kind intended for platformer play.
- Coordinate conventions are documented and tested end to end.
- Common LDtk room compilation and transition logic is engine-owned, pure where possible, and independently testable.
- Release CI exercises both Node import and a real Vite consumer.
- The engine remains zero-runtime-dependency.

## 3. Non-goals

- Replacing LDtk as the level-authoring source.
- Adding a general scene graph or full entity-component system.
- Moving game-specific art direction, narrative, or strawberry presentation into the engine.
- Making the core engine depend on Node canvas, Playwright, or another runtime package.
- Automatically adding hazards, collectibles, or traversal mechanics to user-authored LDtk projects.
- Guaranteeing that every arbitrary LDtk level is fun or completable.
- Replacing the low-level APIs; existing parse, translate, compile, render, and kernel functions remain available.

## 4. Design principles

1. **Fix the lowest responsible layer.** API shape errors belong in documentation tests; coordinate mismatches belong in the engine; art-direction choices belong in the prompt.
2. **Prefer additive APIs.** Preserve the existing low-level surface while adding a reliable golden path.
3. **Make invalid states visible.** Return structured diagnostics and provenance rather than silently fabricating data that appears authored.
4. **Keep simulation deterministic.** Host loading and presentation may be asynchronous, but authoritative progression remains fixed-step and reproducible.
5. **Do not make consumers know private conventions.** Prefixes, pivot conversion, field aliases, and config-unit classification must be owned by the engine.
6. **Test the published artifact.** Source tests alone do not prove that npm consumers can import or build the package.
7. **Separate capability from content.** The engine can support springs even when a particular LDtk project contains none.
8. **Use one canonical example per workflow.** The prompt, integration guide, starter, and tests must derive from the same source rather than duplicating snippets.

## 5. Target integration shape

The final public surface should support a workflow similar to the following. Names are proposed and may change during API review.

```ts
const loaded = await loadLdtkProjectAssets({
  projectUrl: './levels/level.ldtk',
  assetBaseUrl: './assets/',
  imageTimeoutMs: 5_000,
});

if (!loaded.ok) {
  showLoadDiagnostics(loaded.diagnostics);
  return;
}

const config = createPrecisionPlatformerConfig({
  tileSize: loaded.projectInfo.primaryTileSize,
  referenceTileSize: 16,
  wallGrabEnabled: true,
  climbEnabled: loaded.projectInfo.hasLadders,
});

const rooms = createLdtkRoomCache(loaded.project, {
  configForTileSize: (tileSize) =>
    scalePlatformerConfig(config, 16, tileSize),
  playerSizeForTileSize: (tileSize) => ({
    width: 0.5 * tileSize,
    height: 1.5 * tileSize,
  }),
});

const start = rooms.getStartRoom();
if (!start.ok) {
  showLoadDiagnostics(start.diagnostics);
  return;
}

let session = createLdtkPlatformerSession({
  room: start.room,
  transitionPresentation: 'slide',
});
```

This is not a requirement to ship one monolithic session object. The important contract is that the common parse/load/translate/compile/cache/spawn/transition path is supported and demonstrated end to end.

## 6. Workstream A — package and API contract reliability

### A1. Make the npm package valid Node ESM

**Problem**

The built root barrel emits extensionless directory imports such as `./primitives`. Vite resolves these, but Node ESM rejects them with `ERR_UNSUPPORTED_DIR_IMPORT`, despite `package.json` declaring Node 18 or newer.

**Implementation options**

Choose one after a small build-system spike:

1. Emit explicit `.js` file specifiers using a Node-compatible TypeScript source/build configuration.
2. Bundle the public runtime entry point while retaining declarations and tree-shaking metadata.
3. Add an export-map entry per public module only if it does not recreate the same internal-resolution problem.

**Required changes**

- Update the distribution build.
- Keep browser bundler compatibility.
- Preserve `sideEffects: false` behavior.
- Verify declaration resolution from a consumer project.
- Correct documentation that currently describes the failure as harmless.

**Acceptance criteria**

- `node -e "import('aicraft-engine')"` succeeds from a clean install of the packed tarball.
- A strict TypeScript Node ESM consumer resolves types.
- The showcase and a Vite consumer still build.
- Tree-shaking size checks remain within the existing budget.

### A2. Add packed-artifact release tests

Create a release smoke script that:

1. Runs the distribution build.
2. Runs `npm pack` into a temporary directory.
3. Creates clean Node ESM and Vite consumers.
4. Installs the tarball.
5. Imports the root barrel under Node.
6. Type-checks representative imports.
7. Builds the Vite consumer.
8. Runs a minimal deterministic platformer probe.

The smoke test must run in `prepublishOnly` and CI. It must not depend on the repository's source-resolution behavior.

### A3. Compiler-check public code examples

Extract or generate TypeScript examples from a canonical examples directory. Do not rely on unvalidated fenced code blocks.

At minimum, compile-check examples for:

- LDtk parse and diagnostics.
- Asynchronous image loading plus synchronous bundle construction.
- LDtk translation and room compilation.
- Moving-platform displacement.
- Platformer input construction.
- Camera brain setup.
- Collectible persistence.
- Game-loop error handling.

Add a documentation lint that rejects references to nonexistent exports. A separate example test must validate behavior and return shapes; export-name validation alone would not catch the current parse and async/sync mistakes.

## 7. Workstream B — LDtk loading and translation

### B1. Add an asynchronous LDtk asset-loading adapter

**Existing low-level API**

`buildLdtkTilesetBundle` remains synchronous and accepts already-decoded images.

**Proposed high-level API**

```ts
interface LoadLdtkProjectAssetsOptions {
  readonly projectUrl: string | URL;
  readonly assetBaseUrl?: string | URL;
  readonly imageTimeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

type LoadLdtkProjectAssetsResult =
  | {
      readonly ok: true;
      readonly project: LdtkProject;
      readonly tilesets: LdtkTilesetBundle;
      readonly diagnostics: readonly LdtkAssetDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly LdtkAssetDiagnostic[];
    };
```

**Behavior**

- Resolve relative tileset paths with `URL`, not string concatenation.
- Correctly handle spaces, brackets, Unicode, and nested paths.
- Fetch bytes before decoding.
- Prefer `createImageBitmap` when available.
- Use a bounded `Image.decode()` fallback.
- Skip `LdtkIcons` and null paths.
- Return warnings for missing optional tilesets and errors when no drawable gameplay tileset remains.
- Never hang indefinitely on decode.
- Resolve host APIs lazily and follow the engine's defensive-adapter conventions.

Promote or adapt the proven image-loading logic currently used by the LDtk showcase rather than implementing a third loader.

### B2. Complete default entity mapping

Extend `LDTK_DEFAULT_ENTITY_MAP` with case-insensitive aliases:

| LDtk identifiers | Engine kind |
|---|---|
| `Spring`, `SuperSpring` | `spring` |
| `DashRefill`, `DashCrystal`, `Refill` | `dashRefill` |

Parse spring fields into existing `SpringProps`:

- `power`: `normal | super`.
- `facing`: preserve supported values, while warning that sideways launch is not yet active if necessary.

Unknown identifiers must continue to fall back to `trigger` without data loss.

**Tests**

- Every default alias maps to the correct entity kind.
- Spring props survive translation.
- `compileGeneratedLevel` emits the expected non-blocking marker solid.
- Kernel interactions contain the correct stable solid ID.
- Custom entity maps continue to override defaults.

### B3. Export stable entity/solid identity helpers

Add public helpers such as:

```ts
solidIdForEntity(entityId: EntityId): string;
entityIdFromSolidId(solidId: string): EntityId | undefined;
```

Consumers must not reproduce the `entity-` prefix. Document that tile-solid IDs are a separate namespace and are not reversible to entities.

### B4. Add LDtk project preflight analysis

Provide a pure inspection function:

```ts
inspectLdtkPlatformerProject(project): LdtkPlatformerProjectReport
```

The report should include:

- Levels and neighbour connectivity.
- Collision layers and tile sizes.
- Tileset references.
- Authored spawn count and location by room.
- Entity counts by engine kind and original identifier.
- Presence of ladders, hazards, collectibles, springs, dash refills, exits, and moving platforms.
- Unknown trigger identifiers.
- Spawn-less rooms.
- Disconnected rooms.
- Conflicting tile sizes where relevant.

Diagnostics should distinguish errors, warnings, and informational capability notes. Missing optional gameplay content is informational unless the caller supplies a content contract that requires it.

## 8. Workstream C — spawn and room compilation contracts

### C1. Define spawn coordinates unambiguously

Choose and document one `LevelData.spawn` convention. The recommended convention is actor top-left because that is what `createPlatformerState(x, y)` consumes.

LDtk conversion must account for:

- Entity `px` coordinates.
- Entity width and height.
- `__pivot`.
- The configured player collision dimensions when the authored marker is a point rather than a body-sized rectangle.

If player dimensions are needed to resolve the final top-left, spawn resolution should occur during the LDtk platformer compile step, not in the generic translation step. In that design, generic translation should preserve an explicit spawn anchor and pivot rather than prematurely converting it to `LevelData.spawn`.

### C2. Preserve spawn provenance

Introduce a resolved spawn type:

```ts
interface ResolvedPlatformerSpawn {
  readonly x: number;
  readonly y: number;
  readonly source: 'authored' | 'seam-entry' | 'fallback';
  readonly entityId?: EntityId;
}
```

Rules:

- An authored spawn may initialize a checkpoint.
- A seam entry may initialize the active-room retry checkpoint when the room has no authored spawn.
- A fallback spawn is diagnostic recovery only and must not silently become a persistent checkpoint.

### C3. Validate initial-state placement

During room compilation, detect whether the initial actor AABB overlaps blocking solids.

Preferred behavior:

1. Correct coordinate conversion should normally yield no overlap.
2. If authored data still overlaps, report a warning with the entity and solid IDs.
3. Offer a pure `settlePlatformerState` helper for intentionally approximate markers or legacy projects.
4. Bound settlement by a small number of fixed steps and return diagnostics if no stable support is found.

Do not settle seam-entry states automatically; doing so could destroy valid mid-air momentum.

### C4. Add `compileLdtkRoom`

Proposed result:

```ts
interface CompiledLdtkRoom {
  readonly ldtkLevel: LdtkLevel;
  readonly levelData: LevelData;
  readonly compiled: CompiledLevel;
  readonly tileSemantics: GeneratedTileSemantics;
  readonly solids: readonly Solid[];
  readonly hazards: readonly LevelEntity[];
  readonly collectibles: readonly LevelEntity[];
  readonly springs: readonly LevelEntity[];
  readonly dashRefills: readonly LevelEntity[];
  readonly exits: readonly LevelEntity[];
  readonly ladders: readonly Solid[];
  readonly spawn: ResolvedPlatformerSpawn;
  readonly diagnostics: readonly LdtkRoomDiagnostic[];
}
```

The function should own:

- Translation and diagnostics.
- Player-size-aware spawn resolution.
- Tile semantics.
- Ladder-cell marker solids.
- Entity bucketing.
- Static and moving platform compilation.
- Initial overlap validation.

### C5. Add a lazy room cache

`createLdtkRoomCache(project, options)` should:

- Resolve levels across project-level and world-level arrays.
- Compile lazily by `iid`.
- Return the same immutable compiled room for revisits.
- Expose `get`, `has`, `clear`, and `getStartRoom`.
- Select the start room using authored spawn presence, with an explicit override.
- Surface diagnostics rather than silently returning fabricated `(0, 0)` rooms.

## 9. Workstream D — tile-unit configuration and feel events

### D1. Add unit-aware config scaling

Provide a canonical scaler that classifies every `PlatformerConfig` field as one of:

- World distance.
- Velocity.
- Acceleration.
- Dimensionless ratio.
- Time duration.
- Count/boolean/enum.
- Nested jump distance/time.

Scaling a 16 pixel reference config to 8 pixels should halve distances, velocities, and accelerations while preserving times and ratios. The classification table must be exhaustive and compile-time reviewed when new config fields are added.

Suggested API:

```ts
scalePlatformerConfig(
  config: Readonly<PlatformerConfig>,
  scale: number,
): PlatformerConfig;
```

Optionally add:

```ts
createPrecisionPlatformerConfig({
  tileSize,
  referenceTileSize: 16,
  jumpApexTiles,
  timeToApex,
  coyoteTime,
  wallGrabEnabled,
  climbEnabled,
}): PlatformerConfig;
```

If a consumer overrides jump apex/time, the helper must preserve or explicitly recompute the intended hierarchy among ground jump, wall jump, climb hop, spring, super spring, and dash-tech impulses.

### D2. Replace magic feel thresholds with semantic events

Extend platformer events additively. Proposed events:

```ts
interface LandingEvent {
  readonly impactSpeed: number;
  readonly normalizedImpact: number;
  readonly hard: boolean;
  readonly solidId: string | null;
}

interface DashBonkEvent {
  readonly normalX: -1 | 0 | 1;
  readonly normalY: -1 | 0 | 1;
  readonly solidId: string | null;
}

interface DashEndedEvent {
  readonly reason: 'timeout' | 'wall' | 'ceiling' | 'floor';
}
```

Also expose single-tick signals for:

- Stamina exhausted while grabbing.
- Wall-grab latched.
- Spring launch with source entity ID.
- Dash refill with source entity ID.

Existing boolean events remain for compatibility. The richer events eliminate consumer checks such as unscaled `prevVy > 520` and horizontal-only bonk inference.

### D3. Add shared input constants and standard mappings

Export an immutable `IDLE_EDGE`. Consider an additive standard-platformer mapping helper for keyboard and W3C Standard Gamepad layouts.

This is lower priority than the loading and spawn work but removes another repeated local constant and reduces button-index mistakes.

## 10. Workstream E — room transitions and camera framing

### E1. Separate simulation transition from presentation transition

The simulation transition owns:

- Detecting the cardinal edge crossed.
- Resolving the LDtk neighbour.
- Converting the actor through world coordinates into destination-local coordinates.
- Preserving velocity, facing, abilities, and relevant locomotion state.
- Resetting contacts that are invalid in the new room.
- Selecting checkpoint provenance.

The presentation transition owns:

- Source and destination room offsets.
- Camera path and easing.
- Player render correction at the coordinate-space switch.
- Rendering both rooms during the overlap.
- Rebasing existing room-local particles.
- Clearing safely on death, retry, teleport, or reversal.

### E2. Add pure room-transition helpers

Proposed helpers:

```ts
findLdtkRoomExit(body, level): LdtkRoomExit | undefined;
mapLdtkRoomEntry(body, from, to): LdtkRoomEntry;
transitionPlatformerToRoom(state, entry): PlatformerState;
rebasePointBetweenLdtkRooms(point, from, to): Point;
```

Tests must cover all four cardinal directions, partial overlaps, corner exits, missing neighbours, rapid reversal, and preservation of world position at the switch.

### E3. Add a supported slide presentation

The default Celerock policy should be explicit:

- Duration: approximately 0.25–0.35 seconds.
- Easing: a named, exported curve.
- Both rooms render during the slide.
- Player screen position is continuous at transition start.
- Existing particles remain visually continuous.
- Input and simulation continue unless the product explicitly requests a freeze.
- Reduced motion uses an immediate seam-aligned cut.

The camera brain should continue to own the destination live camera. A presentation camera composes the source seam view toward that live destination without feeding presentation state back into simulation.

### E4. Standardize camera fit policy

Add a helper with explicit modes rather than repeating `Math.min`/`Math.max`:

```ts
fitCameraZoom(level, viewport, {
  mode: 'contain' | 'cover' | 'native',
  minZoom,
  maxZoom,
  integerScale,
  margin,
});
```

For Celerock, select one policy in the prompt. Recommended default:

- `cover` for compact Celeste-like rooms, preventing side gaps.
- Clamp or deliberately quantize zoom when strict pixel scaling is required.
- Use authored background/letterbox treatment only when cropping would hide gameplay-critical geometry.

Do not claim integer pixel scaling while multiplying by arbitrary factors such as `0.98` or `0.86`.

## 11. Workstream F — game-loop failure handling

### F1. Add explicit callback error handling

Proposed additions to `GameLoopConfig`:

```ts
readonly onError?: (
  error: unknown,
  context: { readonly phase: 'step' | 'render' },
) => void;

readonly errorPolicy?: 'stop' | 'continue';
```

Recommended default policy: `stop` and report through `onError` when supplied. The loop should expose its last error or stopped state so a host can render a visible failure overlay.

Avoid silently swallowing consumer exceptions and avoid an uncontrolled repeated-error loop.

### F2. Improve particle RNG ergonomics

Keep the deterministic requirement that jitter needs an RNG, but make misuse easier to detect:

- Include the option path in the thrown error.
- Provide seeded examples for every jittered particle recipe.
- Consider requiring `rng` at the type level through a discriminated options union when `speedJitter` is nonzero.
- Ensure the Celerock starter owns one seeded presentation RNG and never uses `Math.random()`.

## 12. Workstream G — prompt rewrite

### G1. Split product requirements from API cookbook

Replace the current long, duplicated brief with:

1. A short product specification in `games/celerock.md`.
2. A compiler-checked starter under `examples/celerock/`.
3. Versioned integration documentation generated from or linked to the starter.
4. A machine-checkable acceptance manifest.

The prompt should describe what must be true, while the starter demonstrates how to use the current engine version.

### G2. Correct immediate API errors

Before the larger engine work lands, update the prompt to:

- Handle `parseLdtkProject` as `{ ok, project, errors }`.
- Preload decoded images before calling synchronous `buildLdtkTilesetBundle`.
- Define a local `IDLE_EDGE` until the engine exports one.
- Pass the moving-platform displacement provider into `stepPlatformer`.
- Use the complete tile-size config scaling implementation.
- Check translation diagnostics before non-null assertions.
- Avoid claiming `CompiledLevel` contains entities.
- Avoid references to nonexistent easing exports.
- Explain the real gamepad index mapping.

### G3. Add an asset preflight stage

The first build stage must inspect the supplied assets and produce a short report before gameplay work begins:

- Project parse status.
- Level count and neighbour graph.
- Collision layer and tile size per level.
- Tileset paths and decode status.
- Authored spawn rooms.
- Counts of hazards, collectibles, springs, dash refills, exits, ladders, and moving platforms.
- Sprite-sheet dimensions and available metadata.

Then select one declared content policy:

1. **Preserve mode:** do not modify the LDtk; feature acceptance is conditional on authored content.
2. **Enrichment mode:** the user explicitly authorizes adding gameplay entities to the LDtk, using an idempotent script and preserving existing terrain and art.

The prompt must never simultaneously forbid authoring content and require mechanics absent from the supplied file.

### G4. Make acceptance criteria capability-aware

Separate unconditional engine/runtime criteria from conditional content criteria.

**Unconditional**

- Project loads and tilesets render.
- Player can traverse authored solid geometry.
- Movement, input, camera, save, and deterministic loop work.
- No manual collision/controller replacement.
- Spawn and room transitions are stable.

**Conditional on authored content**

- Springs launch correctly if springs exist.
- Dash refills work if refill entities exist.
- Hazards kill if hazards exist.
- Collectibles persist if collectibles exist.
- Goals complete the chapter if exits exist.
- Ladders climb if ladder cells exist.

If a capability is required for the showcase regardless of supplied content, the fixture must contain it or enrichment mode must be authorized.

### G5. Resolve presentation ambiguity

The revised prompt must state:

- Room transition policy: slide by default, immediate seam cut for reduced motion.
- Camera fit policy: `cover` for the provided fixture unless overridden.
- Supplied player sprite policy: use it as the primary renderer when present and valid.
- Procedural player policy: fallback only unless explicitly requested.
- Pixel-sprite transform policy: stable scale; no continuous breathing or squash scaling. Use frame animation, positional recoil, flashes, aura, and afterimages instead.
- Hair policy: optional and subordinate to the supplied sprite art; never an acceptance requirement.
- Contact shadow policy: derive from rendered sprite bounds or omit it.

### G6. Resolve determinism wording

Adopt the simple rule for Celerock game code: no `Math.random()` or `Date.now()` anywhere. Use seeded RNG for both authoritative and presentation particles.

This removes the current contradiction between allowing decorative `Math.random()` and forbidding every textual occurrence during static analysis.

### G7. Fix collectible update logic

When multiple collectibles overlap in one tick, fold over the latest save state rather than repeatedly applying `collect` to the same pre-loop snapshot. Add a unit test for collecting two entities in one tick.

### G8. Remove unpublished-source dependencies

Do not instruct npm consumers to read `showcase/sections/ldtk-editor/play.ts`, because it is not included in the package. Move canonical behavior into one of:

- Public engine APIs.
- Published integration documentation.
- The shipped Celerock example.

## 13. Workstream H — fixtures, tests, and QA

### H1. Add an adversarial Celerock LDtk fixture

Create a small engine-owned fixture containing:

- At least two cardinally linked rooms.
- 8 pixel tiles to exercise scaling.
- A tileset filename with spaces and brackets.
- One authored spawn room and one spawn-less neighbour.
- Solid, passthrough, and ladder IntGrid values.
- A hazard, collectible, normal spring, super spring, dash refill, moving platform, and exit.
- A partial-overlap room seam.
- A location suitable for horizontal and vertical dash bonks.

Keep it compact enough for fast deterministic tests.

### H2. Add integration test layers

#### Layer 1: pure unit tests

- Config scaling classification.
- Spawn pivot conversion.
- Entity mapping and props.
- Solid ID round-trip.
- Room lookup and lazy caching.
- Seam coordinate conversion.
- Camera fit modes.
- Semantic event emission.

#### Layer 2: deterministic simulation tests

- Initial state does not overlap the floor.
- Ground jump, wall jump, spring, and super spring maintain the intended height hierarchy at 8, 16, and 32 pixel tiles.
- Dash travel expressed in tiles is invariant across tile sizes.
- Horizontal and vertical dash bonks emit semantic events.
- Moving platforms carry the player using the documented displacement path.
- Transition preserves `vx`, `vy`, and facing.
- Spawn-less-room retry uses seam-entry provenance.
- Two collectibles collected in one tick both persist.
- Repeating a 600-tick input trace is byte-identical.

Measure peak velocity or displacement over the relevant window, not only end-of-test velocity.

#### Layer 3: render geometry tests

- Player screen position is continuous at slide start.
- Source and destination rooms cover the transition viewport without unintended gaps.
- Particle world position is invariant across rebasing.
- Pixel sprite bounds are stable during idle frames.
- `cover` and `contain` policies produce documented crop/letterbox results.

These may use fake canvas contexts for geometry assertions. Optional PNG golden generation can use a development-only canvas dependency without entering the runtime package.

#### Layer 4: packed consumer tests

- Node root import.
- Vite build.
- TypeScript strict build.
- Browser boot with the adversarial asset path.

### H3. Provide a deterministic QA harness

Publish example-local helpers that can:

- Create a session without browser input or audio.
- Feed a tick-indexed input script.
- Step the exact fixed-step simulation.
- Render selected ticks through an injected canvas context.
- Record state traces and event logs.

Keep the engine core independent of Node canvas. The example or development tooling may optionally adapt the renderer to `@napi-rs/canvas` or `canvas`.

### H4. Define correct test invariants

Use structural invariants rather than brittle visual guesses:

- AABB overlap requires positive area, not edge contact.
- Dash collision walls must be tall enough that corner correction cannot bypass the test target.
- Transition continuity compares adjacent frames at the coordinate switch.
- World-position identities are preferred over arbitrary one-pixel screen thresholds.
- Camera reversal tests compare the reversal boundary, not widely separated samples.
- Hard landing is based on the engine's emitted impact severity.

## 14. Delivery phases

### Phase 0 — lock decisions and baseline

**Deliverables**

- Approve spawn coordinate convention.
- Approve Node ESM build strategy.
- Approve Celerock room transition and camera fit policies.
- Capture current package size and test baselines.
- Add failing regression tests for Node import, spawn overlap, spring/refill translation, and moving-platform example wiring.

**Exit gate**

- Each observed failure has a failing automated reproduction or a documented reason it is prompt-only.

### Phase 1 — release blockers

**Deliverables**

- Node-compatible packed artifact.
- Packed-artifact smoke tests.
- Correct spawn resolution and provenance.
- Spring/refill default mappings.
- Public entity/solid ID helpers.
- Immediate prompt API corrections.

**Exit gate**

- The current two-room fixture imports, loads, compiles, and begins with a non-overlapping player under Node-driven and Vite-driven tests.

### Phase 2 — golden LDtk platformer path

**Deliverables**

- Asynchronous asset loader.
- Project preflight report.
- `compileLdtkRoom`.
- Lazy room cache.
- Unit-aware config scaling.
- Exported `IDLE_EDGE` and corrected moving-platform example.

**Exit gate**

- A minimal consumer no longer implements its own image timeout, entity bucketing, ladder solids, spawn provenance, or room cache.

### Phase 3 — transitions, feel events, and resilience

**Deliverables**

- Pure room transition helpers.
- Supported slide presentation.
- Camera fit helper.
- Semantic landing/bonk/stamina events.
- Game-loop error hook and policy.

**Exit gate**

- All four room directions preserve simulation and presentation continuity, and a callback error produces an observable stopped/error state.

### Phase 4 — prompt and example consolidation

**Deliverables**

- Engine-owned adversarial fixture.
- Compiler-checked Celerock starter.
- Shortened `games/celerock.md`.
- Generated or synchronized integration documentation.
- Capability-aware acceptance manifest.
- Deterministic QA harness and trace suite.

**Exit gate**

- A fresh build using only the published package, prompt, starter, and supplied assets passes the defined gates without consulting engine source or showcase internals.

## 15. Dependency order

```text
Node ESM fix ────────────────┐
                             ├─> packed consumer CI ─> release gate
spawn convention ─> room compile ─> room cache ─> transitions
entity mapping ───────┘              │
asset loader ─> project preflight ───┘
config scaler ─> feel invariance tests ─> semantic events
camera fit policy ─────────────────────> slide presentation
all stable APIs ───────────────────────> starter ─> prompt rewrite
```

## 16. Migration and compatibility

### 16.1 Additive changes

The following should be additive and non-breaking:

- Async asset loader.
- Project preflight.
- Room compiler/cache.
- Config scaler.
- ID helpers.
- Rich semantic events.
- `IDLE_EDGE`.
- Camera fit and room-transition helpers.
- Game-loop error callback.

### 16.2 Spawn behavior risk

Correcting spawn coordinates may change games that unknowingly relied on the current overlap-and-settle behavior.

Mitigation options:

1. Fix only the new `compileLdtkRoom` path initially and deprecate the ambiguous generic conversion.
2. Add a translation option such as `spawnMode: 'legacy-feet' | 'actor-top-left'`, defaulting the new high-level path to the correct mode.
3. Schedule the generic behavior correction for the next semver-major release.

The API review must choose one explicitly; silent behavioral drift is not acceptable.

### 16.3 Prompt versioning

The rewritten prompt must name the first engine version that contains the golden path. Keep older version notes in a short migration section rather than embedding workarounds throughout the main build flow.

## 17. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| High-level API becomes a monolithic game framework | Reduced composability | Keep parse/load/compile/cache/transition helpers independently usable |
| Spawn fix breaks legacy consumers | Runtime placement changes | Add provenance, compatibility mode, and a documented migration |
| Async loader expands host responsibilities | SSR/Node incompatibility | Keep it in a defensive host-adapter module; retain synchronous core |
| Config scaler misses new fields | Feel drift returns | Exhaustive classification test tied to `keyof PlatformerConfig` |
| Slide transition duplicates camera brain | Conflicting camera authority | Treat slide as presentation composition over the destination live brain |
| Example and prompt drift again | Repeated build failures | Generate docs from tested source or compile extracted snippets in CI |
| Optional content becomes silently ignored | Incomplete games appear successful | Preflight report plus capability-aware acceptance manifest |
| Loop `continue` policy repeats failures forever | Performance/error flood | Default to `stop`; make continuation explicit |
| Pixel-art constraints overfit one sprite | Less flexibility | Make transform policy configurable and document sprite vs vector modes |

## 18. Issue traceability

| Observed issue | Corrective workstream |
|---|---|
| Node ESM import failure | A1, A2 |
| Wrong parse return shape in prompt | A3, G2 |
| Async callback passed to sync tileset builder | B1, G2 |
| Tileset filename caused boot hang | B1, H4 |
| Incomplete tile-size config scaling | D1 |
| Hard-land threshold did not scale | D2 |
| Missing vertical dash bonk | D2 |
| `IDLE_EDGE` assumed to be exported | D3, G2 |
| Gamepad key-name misunderstanding | D3, G2 |
| Private solid ID prefix leaked | B3 |
| Particle RNG exception froze loop | F1, F2 |
| Spring/refill entities became triggers | B2 |
| Initial player overlapped floor | C1, C3 |
| Spawn-less room checkpointed fallback | C2, C5 |
| Room camera reset caused pop | E1–E3 |
| Hard cut did not meet desired slide | E3, G5 |
| `contain` versus `cover` disagreement | E4, G5 |
| Supplied LDtk lacked required mechanics | B4, G3, G4 |
| Supplied sprite was treated as stretch goal | G5 |
| Pixel sprite shimmered under breathing scale | G5, H2 |
| Hair mandate produced unwanted visuals | G5 |
| Browser QA was unreliable | H3 |
| Transition/feel tests measured wrong invariants | H4 |
| Prompt referenced unpublished showcase code | G8 |
| Decorative `Math.random()` both allowed and forbidden | G6, F2 |

## 19. Definition of done

This plan is complete when all of the following are true:

- [ ] The packed npm package imports under Node 18+ ESM.
- [ ] A strict Vite consumer builds from the packed artifact.
- [ ] Public code examples compile against the documented version.
- [ ] The default LDtk map translates springs and dash refills directly.
- [ ] Consumers no longer depend on the private `entity-` solid prefix.
- [ ] LDtk tilesets with spaces and brackets load or fail with bounded diagnostics.
- [ ] Spawn coordinates have one documented convention.
- [ ] The initial player does not overlap authored floor geometry in the adversarial fixture.
- [ ] Spawn-less-room retries use seam-entry provenance rather than a fabricated spawn.
- [ ] Platformer feel expressed in tiles is invariant at 8, 16, and 32 pixel tile sizes.
- [ ] Moving-platform displacement is passed correctly in every canonical example.
- [ ] Horizontal and vertical dash bonks emit semantic events.
- [ ] Room transitions preserve momentum and screen continuity.
- [ ] The camera fit policy is explicit and tested.
- [ ] Callback failures are observable through the game-loop API.
- [ ] The Celerock asset preflight distinguishes missing optional content from runtime failure.
- [ ] The prompt contains no contradictory content, transition, RNG, or sprite requirements.
- [ ] The Celerock starter passes deterministic simulation and packed-consumer tests.
- [ ] A future builder can complete the game without reading private engine source or writing duplicate LDtk integration glue.

## 20. Immediate next actions

1. Open four regression issues: Node ESM import, spawn coordinate mismatch, spring/refill translation, and prompt example drift.
2. Add the adversarial LDtk fixture before changing behavior.
3. Write failing tests for the four release blockers.
4. Decide the spawn migration strategy and Node build strategy.
5. Implement Phase 1 as the next patch series.
6. Draft the smaller prompt only after the Phase 2 APIs are stable, so it documents the final golden path rather than another temporary workaround.
