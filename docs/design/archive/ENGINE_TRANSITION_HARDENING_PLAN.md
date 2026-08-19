# Engine Hardening Plan — Tick-tock + Dip-down Room Transitions

**Goal:** add a safe, shipped transition path that prevents seam tick-tock and
camera-origin dip-down when consumers use the recommended APIs. The existing
pure low-level primitives remain public for backward compatibility, so this is
not an absolute guarantee for callers that deliberately continue composing the
unsafe bare sequence themselves.

Fixes land in `src/` and ship through `dist/`. The showcase-local fix remains a
valid consumer example and can be migrated to the new engine helpers in a
follow-up.

## Background (confirmed by audit)

- **Tick-tock:** `findLdtkRoomExit` is intentionally stateless. After an east
  crossing, `mapLdtkRoomEntry` preserves the actor's exact world position, which
  normally leaves part of its AABB at a negative destination-local X. Polling
  the bare exit helper immediately in the destination can therefore detect the
  reverse west exit before the actor clears the seam.
- **Dip-down on a hard cut:** a destination brain created at its default `(0,0)`
  seeds first-activation `bodyCamera` from that origin. The destination follow
  solver then visibly moves from the wrong local Y instead of continuing the
  source camera's world-space framing.
- **Dip-down on a slide:** `beginRoomSlide` correctly accepts explicit endpoint
  views, but a consumer can accidentally supply a source view that differs from
  the `CameraBrain` currently being rendered. The engine has no constructor that
  captures the rendered source view by construction.

The existing camera-brain first-activation behavior and room-slide interpolation
math are correct. Hardening belongs in the room-transition composition layer.

---

## Change 1 — immutable room-exit detector state

**File:** `src/platformer/room-transitions.ts`

Keep `findLdtkRoomExit`, `mapLdtkRoomEntry`, and
`transitionPlatformerToRoom` unchanged. Add an immutable, serializable detector
state and a pure polling function:

```ts
/** Default positive re-arm margin in room/world pixels. */
export const DEFAULT_EXIT_DEADBAND = 1;

export interface RoomExitDetectorOptions {
  /** Finite positive margin; invalid or non-positive values use the default. */
  readonly deadband?: number;
}

/** Persist one instance per traversing actor alongside game/save/replay state. */
export interface RoomExitDetectorState {
  /** Destination edge that must be cleared before another exit can fire. */
  readonly blockedEntryEdge: Cardinal | null;
  /** Room in whose local coordinates `blockedEntryEdge` is meaningful. */
  readonly expectedLevelIid: string | null;
}

export interface RoomExitDetection {
  readonly state: RoomExitDetectorState;
  readonly exit?: LdtkRoomExit;
}

export function createRoomExitDetectorState(): RoomExitDetectorState;

export function detectLdtkRoomExit(
  state: Readonly<RoomExitDetectorState>,
  body: Rect,
  level: LdtkLevel,
  project: LdtkProject,
  options?: Readonly<RoomExitDetectorOptions>,
): RoomExitDetection;
```

### Detector semantics

1. Normalize `deadband` once per call: accept only finite values `> 0`; otherwise
   use `DEFAULT_EXIT_DEADBAND`. This prevents `NaN`/`Infinity` from permanently
   blocking the detector and prevents zero/negative margins from defeating the
   default protection.
2. An armed state is `{ blockedEntryEdge: null, expectedLevelIid: null }`.
3. If a blocked state is presented with a different `level.iid` than
   `expectedLevelIid`, treat it as a teleport/retry/stale state: reset to armed
   and continue polling in the supplied room during the same call.
4. If the level matches, re-arm only when the actor has moved at least the
   deadband inside the recorded entry edge:
   - `w`: `body.x >= margin`
   - `e`: `body.x + body.width <= level.pxWid - margin`
   - `n`: `body.y >= margin`
   - `s`: `body.y + body.height <= level.pxHei - margin`
5. While the matching entry edge has not cleared, return the same blocked state
   and no exit without calling `findLdtkRoomExit`.
6. Once armed, call `findLdtkRoomExit`. If there is no exit, return armed state.
   If there is an exit, return it with next state set to the opposite destination
   edge and `expectedLevelIid: exit.neighbourLevelIid`.

The returned detector state and room transition must be adopted atomically:

```ts
const detection = detectLdtkRoomExit(exitDetector, actor.core, activeLevel, project);
if (detection.exit !== undefined) {
  const destination = levelsByIid.get(detection.exit.neighbourLevelIid);
  if (destination !== undefined) {
    const entry = mapLdtkRoomEntry(actor.core, activeLevel, destination, detection.exit);
    actor = transitionPlatformerToRoom(actor, entry).state;
    activeLevel = destination;
    exitDetector = detection.state;
  }
  // If the transition is rejected or delayed, do not adopt detection.state yet.
} else {
  exitDetector = detection.state;
}
```

This keeps transition acceptance transactional, supports async/delayed consumers,
and makes rollback/save/replay deterministic. One detector state belongs to one
actor; multi-actor games keep one state per actor. A JSON-cloned state must behave
identically to the original.

Update the module header to continue claiming purity accurately: the new detector
is data plus pure functions, not a hidden mutable closure.

## Change 2 — `seedRoomCutCamera` for non-slide handoff

**File:** `src/platformer/room-slide.ts`

Add an explicitly named helper for hard room cuts:

```ts
/**
 * Create an inactive destination-local brain for a HARD ROOM CUT, preserving
 * the source brain's rendered world-space top-left and rendered zoom.
 *
 * Do not use this result as a room-slide destination endpoint and do not use it
 * after a slide; `finishRoomSlideCameraSpace` already owns post-slide handoff.
 * The next destination `updateCameraBrain` remains the sole viewport/zoom-aware
 * clamp authority.
 */
export function seedRoomCutCamera(
  sourceBrain: Readonly<CameraBrain>,
  sourceLevel: LdtkLevel,
  destinationLevel: LdtkLevel,
): CameraBrain;
```

Implementation:

```ts
const camera = rebasePointBetweenLdtkRooms(
  sourceBrain.camera,
  sourceLevel,
  destinationLevel,
);
return createCameraBrain({ ...camera, zoom: sourceBrain.zoom });
```

This intentionally starts an inactive destination brain and clears any old
selection/blend/live solver state. It preserves the rendered camera, not
`bodyCamera`/`lensZoom`, because those may represent an off-screen live target
during a blend. Negative destination-local coordinates are preserved until the
destination brain performs its real viewport-aware clamp.

Do **not** describe this as a slide endpoint. Exact world-space rebasing makes
the source and rebased destination top-left identical once both are expressed in
slide space, producing zero spatial slide travel. A slide destination view must
be selected independently from the destination's desired framing and lens.

## Change 3 — `beginRoomSlideFromBrain` safe slide constructor

**File:** `src/platformer/room-slide.ts`

Keep the low-level `beginRoomSlide` unchanged for backward compatibility. Add a
recommended pure wrapper that derives the source endpoint directly from the
rendered brain:

```ts
/**
 * Begin a room slide using the brain's CURRENTLY RENDERED camera/zoom as the
 * source endpoint. This prevents source-view/brain divergence by construction.
 */
export function beginRoomSlideFromBrain(
  source: CompiledLdtkRoom,
  destination: CompiledLdtkRoom,
  viewport: Readonly<{ width: number; height: number }>,
  sourceBrain: Readonly<CameraBrain>,
  destinationView: Readonly<RoomSlideView>,
  actor: Readonly<RoomSlideActorMapping>,
  options?: Readonly<RoomSlideOptions>,
): RoomSlideState;
```

The wrapper delegates to `beginRoomSlide` with:

```ts
{
  source: {
    camera: { x: sourceBrain.camera.x, y: sourceBrain.camera.y },
    zoom: sourceBrain.zoom,
  },
  destination: destinationView,
}
```

Copy the source point rather than retaining the brain's nested object reference.
This wrapper remains pure and never reads environment globals or logs. It also
captures rendered `zoom`, so lens continuity cannot diverge independently from
position. The caller still chooses destination framing because the engine cannot
infer a game's desired destination follow target, fit mode, or lens policy.

Do not add `assertSlideSourceMatchesBrain`: an opt-in warning would not make the
path safe, portable development-mode detection is undefined across Node and
bundlers, checking position alone misses zoom, and an optional throwing public
assertion conflicts with the repository's never-throw public-API convention.

## Change 4 — public exports and documentation

**File:** `src/platformer/index.ts`

Add to the existing export blocks:

- From `./room-transitions`: `DEFAULT_EXIT_DEADBAND`,
  `createRoomExitDetectorState`, `detectLdtkRoomExit`,
  `RoomExitDetectorOptions`, `RoomExitDetectorState`, and `RoomExitDetection`.
- From `./room-slide`: `seedRoomCutCamera` and
  `beginRoomSlideFromBrain`.

Update JSDoc on `findLdtkRoomExit` to identify it as a low-level stateless
primitive and point per-tick consumers to `detectLdtkRoomExit`. Do not deprecate
it: direct stateless queries remain valid for callers that manage their own
hysteresis.

Add the new recommended sequences to the relevant room-transition/slide docs or
README API example. The documentation must distinguish these paths:

- Hard cut: `detectLdtkRoomExit` → simulation transition → `seedRoomCutCamera`.
- Slide: `detectLdtkRoomExit` → simulation transition →
  `beginRoomSlideFromBrain` → existing enter/presentation/finish helpers.

## Change 5 — tests

### `src/tests/room-transitions.test.ts`

Add `describe('detectLdtkRoomExit')` covering:

- Exact east→west tick-tock reproduction: one forward exit, then no reverse exit
  until the actor clears the west entry edge by the deadband.
- All four entry-edge clearance predicates, including exact seam, sub-margin,
  and exact-margin cases.
- Grounded actor flush with the south edge can still clear a west/east entry
  block; unrelated flush edges do not participate in re-arming.
- Default and custom deadbands.
- `NaN`, `Infinity`, zero, and negative deadbands fall back to the default.
- A mismatched `expectedLevelIid` resets stale state and polls the supplied room
  in the same call.
- Input state is never mutated; equal inputs produce equal outputs; a JSON-cloned
  state continues identically.
- Transactional rejection: discarding an exit result leaves the original armed
  state reusable.
- Independent detector states for two actors do not interfere.
- Backward compatibility: `findLdtkRoomExit` remains the bare stateless query.

### `src/tests/room-slide.test.ts`

Add tests covering:

- `seedRoomCutCamera` preserves world-space top-left and rendered zoom, produces
  an inactive/no-blend brain, seeds both `camera` and `bodyCamera`, and does not
  clamp a negative destination-local coordinate prematurely.
- The first destination `updateCameraBrain` begins from the rebased point and
  applies the real viewport/zoom/bounds clamp.
- `beginRoomSlideFromBrain` captures both rendered camera and rendered zoom from
  a non-origin brain, including a brain whose live `bodyCamera`/`lensZoom` differ
  during a blend.
- Mutating/replacing the caller's brain reference after construction cannot
  change the captured source endpoint.
- The wrapper's output otherwise equals a direct `beginRoomSlide` call supplied
  with the same exact views.
- A slide test continues to use an independently selected destination view,
  guarding against accidental use of `seedRoomCutCamera` as the endpoint.

### `src/tests/barrel-contract.test.ts`

Assert the new values are functions/constants on the top-level barrel and add
compile-time uses of the new exported types.

## Change 6 — packed-consumer smoke coverage

**File:** `scripts/release-smoke.mjs`

The current smoke test imports only older APIs, so merely running it does not
prove the new names ship. Extend all three generated consumers:

- Node ESM: import and minimally exercise `createRoomExitDetectorState`,
  `detectLdtkRoomExit`, `seedRoomCutCamera`, and `beginRoomSlideFromBrain`.
- NodeNext: value-import the new functions and type-import
  `RoomExitDetectorState`, `RoomExitDetection`, and related option types with
  `skipLibCheck: false`.
- Vite: import the new browser-consumable functions so tree-shaking/bundling the
  packed tarball proves they contain no Node-only environment dependency.

Keep fixtures minimal, but do not rely only on the total barrel key count; each
new public name must be imported explicitly so a missing export fails loudly.

## Not changing

- The semantics of `findLdtkRoomExit`, `mapLdtkRoomEntry`,
  `transitionPlatformerToRoom`, and `rebasePointBetweenLdtkRooms`.
- Camera-brain first-activation behavior.
- Existing room-slide interpolation, camera-space enter/finish/cancel helpers,
  or reduced-motion behavior.
- Physics/replay version: these additive helpers do not alter kernel state or
  deterministic physics for existing callers.
- The already implemented showcase-local fix. A later refactor may consume the
  new engine helpers once this API ships.

## Verification

- Targeted engine tests:
  `npx vitest run src/tests/room-transitions.test.ts src/tests/room-slide.test.ts src/tests/barrel-contract.test.ts`
- Full engine suite: `npm test` (current baseline: 192 files / 3587 tests pass).
- Typecheck: `npm run build`.
- Packed consumer gates: `npm run release:smoke` after updating its fixtures.
- Showcase regression checks: `npm run showcase:test` and
  `npm run showcase:typecheck`. Current baseline has one acknowledged unrelated
  failure in `showcase/tests/tile-room-fixtures.test.ts` (`24` vs expected `32`);
  do not attribute or silently absorb that failure into this work.
- Manual consumer check:
  - cross and linger on all four entry seams: no reverse tick-tock;
  - hard-cut east/west: no perpendicular-axis dip from local origin;
  - slide from a non-origin/mid-blend brain: first presentation sample matches
    the currently rendered camera and zoom.

## Release preparation (separate authorization required)

The implementation adds shipped public API, so prepare it as a feature release
for `0.10.0`: update package versions and add the new APIs under CHANGELOG
`### Added`, including comparison links.

Also prepare the missing `[0.9.2]` CHANGELOG section for the super-jump grace fix
at commit `e855e73`. The repository currently lacks the corresponding `v0.9.2`
tag.

Do **not** create either tag, push, or run `npm publish` as an implicit part of
implementation. After every test, build, packed-consumer, changelog, and version
gate passes, request explicit user approval for the release actions. With that
approval, create `v0.9.2` at `e855e73`, create `v0.10.0` at the final verified
release commit, push the intended refs, and publish.

## Workspace safety

Branch from `main` before implementation. Preserve all current unrelated or
already completed work, including `games/celerock.md`, the showcase transition
changes, and both plan files; do not stage or rewrite them unless they are
explicitly brought into the implementation scope.
