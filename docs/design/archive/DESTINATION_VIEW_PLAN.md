# Destination-View Hardening Plan — Remove the Slide-Endpoint Discovery Tax

## Problem

When the Celerock game AI wired up room transitions, it spent ~⅔ of its effort
reverse-engineering the engine's coordinate-space contract — work the engine
already knew but never stated at the API boundary. Concretely it had to:

1. **Discover what unit `RoomSlideView.camera` is in.** It traced through
   `presentationForRoomSlide`, `updateCameraBrain`, and `brain.ts`'s
   `viewport.width / zoom` divisions to conclude "room-px, not physical-px."
   That is the engine's contract and should be stated at the type boundary.
2. **Invent a correct destination endpoint.** `beginRoomSlide` requires the
   caller to supply `views.destination: RoomSlideView`, but the engine provides
   no helper for producing one. The game hardcoded `{ x: 0, y: 0 }` (the room
   corner), which produced the visible "dip" on its 4px Y-overflow band, then
   hand-rolled a `roomEntryView` helper.
3. **Navigate two different viewport contracts.** `updateCameraBrain` accepts a
   physical-pixel viewport and divides it by zoom internally. The legacy
   `updateCamera` has no zoom input and instead expects a visible viewport
   already expressed in the same world/room units as its target and bounds.
   Passing the raw physical viewport to that legacy helper produced `-628` in a
   room-local slot. The engine must document both contracts without conflating
   the two.

The root gap: **the slide API requires a destination view but gives no supported
way to produce a follow-compatible endpoint.** Every game otherwise has to
rediscover the coordinate spaces, deadzone rules, clamp, and letterbox behavior.

## Scope decisions

- **Engine fix (highest leverage):** ship a destination-framing helper, make its
  deadzone compatibility explicit, preserve its endpoint through slide-space
  clamping, and state the coordinate-space contracts on the types.
- **Celerock prompt:** point to the supported helpers by name and update the
  existing transition example so the brief does not simultaneously demonstrate
  the obsolete hardcoded endpoint.
- **No game implementation migration:** replacing a separate game's existing
  `roomEntryView` remains a follow-up in that game repository.

---

## Change 1 — `roomEntrySlideView` follow-compatible destination helper

**File:** `src/platformer/room-slide.ts` (new exports).

Add a pure helper that computes a deterministic destination `RoomSlideView` in
destination-local room-px. The result is an equilibrium of the destination
follow body for the supplied deadzone bands and padding: if a destination brain
is seeded at this view with the same target, zoom, bands, and padding, its first
follow step does not move the camera.

This is deliberately **not** described as the unique position an arbitrary
already-running deadzone solver would eventually reach; deadzones have a range
of valid hold positions, so no unique historical settle point exists.

```ts
export interface RoomEntrySlideViewOptions {
  /** Match the destination follow vcam. Defaults to DEFAULT_FOLLOW_BODY.followX. */
  readonly followX?: Readonly<FollowBand>;
  /** Match the destination follow vcam. Defaults to DEFAULT_FOLLOW_BODY.followY. */
  readonly followY?: Readonly<FollowBand>;
  /** Match the destination follow vcam. Defaults to 0. */
  readonly padding?: number;
}

/**
 * Compute a follow-compatible destination view for a room slide.
 *
 * `viewport` is in physical screen pixels. The returned camera top-left is in
 * destination-local room-px, the coordinate space required by RoomSlideView.
 * Pass the same follow bands and padding used by the destination follow vcam.
 */
export function roomEntrySlideView(
  room: CompiledLdtkRoom,
  entryTarget: Readonly<CameraTarget>,
  viewport: Readonly<CameraViewport>,
  zoom: number,
  options?: Readonly<RoomEntrySlideViewOptions>,
): RoomSlideView;
```

### Algorithm

1. Resolve inputs with the same defensive numeric policy as the camera brain:
   strictly-positive finite viewport dimensions and zoom are kept, otherwise
   each falls back to `1`; non-negative finite room bounds are kept, otherwise
   `0`; non-finite target coordinates and invalid target dimensions fall back
   to `0`; padding is non-negative finite or `0`.
2. Resolve `followX` / `followY` with the existing `resolveBand` logic and
   `DEFAULT_FOLLOW_BODY` fallbacks. Reuse the engine implementation rather than
   duplicating band validation.
3. Compute visible room-px dimensions as `physical viewport / resolved zoom`.
4. For each axis, choose the valid deadzone anchor closest to screen center:
   `anchor = clamp(0.5, trail, lead)`. This preserves centered framing whenever
   `0.5` lies in the band (including the Celerock/default bands), while still
   producing a stable equilibrium for a custom band that excludes the center.
5. Desired top-left is `entryTarget.center - anchor * visible`.
6. Reuse `clampTopLeft(desired, roomBound, visible, padding)`. When
   `roomBound <= visible`, this returns the negative letterbox center; otherwise
   it applies the same padded clamp as the follow body.
7. Return `{ camera: { x, y }, zoom: resolvedZoom }`.

Motion settings are intentionally absent: they control the route and rate of
convergence, not whether the computed endpoint is a follow equilibrium.

## Change 2 — preserve endpoint view rectangles in slide space

**File:** `src/platformer/room-slide.ts` (`beginRoomSlide` space construction and
the affected module/type JSDoc).

The current slide space is only the union of the two room rectangles. That is
insufficient for a legitimate negative letterbox camera: when a small
destination is on the union's left/top edge, the transient fixed vcam clamps
the negative endpoint back to `0` before handoff.

Use the existing `viewport` argument (currently discarded) to build the
normalized union from **four rectangles** in authored world coordinates:

- source room rectangle;
- destination room rectangle;
- source endpoint view rectangle (`room world origin + local camera`, sized
  `viewport / sourceView.zoom`);
- destination endpoint view rectangle (`room world origin + local camera`,
  sized `viewport / destinationView.zoom`).

Normalize all four through their minimum X/Y. Room render offsets remain
`room.world - min`, so they may gain a positive letterbox margin but stay
non-negative. The slide bounds become the maximum right/bottom minus that min.
Player continuity math and particle rebasing are unchanged because the same
normalization shift applies to both rooms.

This keeps zero-padding fixed-vcam clamping authoritative while making both
endpoint views representable. With strictly-positive endpoint zooms, the whole
interpolated viewport also remains inside the expanded bounds: top-left is
linear between contained endpoints, and `viewport / interpolatedZoom` cannot
extend farther than the chord between the two contained endpoint view edges.

Defensive behavior for direct low-level callers: use the same positive-finite
fallbacks (`viewport` dimension or endpoint zoom → `1`) only for constructing
the presentation-space rectangles; do not mutate the caller-supplied endpoint
objects stored in `RoomSlideState`.

The slide easing and endpoint interpolation math do not change.

## Change 3 — state both coordinate-space contracts accurately

**File:** `src/platformer/room-slide.ts` — tighten `RoomSlideView` JSDoc:

```ts
export interface RoomSlideView {
  /**
   * Camera top-left in that room's LOCAL coordinates, in ROOM-PIXELS (the same
   * unit as `level.pxWid`/`pxHei`, not physical/screen px). The camera brain
   * accepts a physical viewport and divides it by zoom internally. Use
   * roomEntrySlideView for a follow-compatible destination endpoint.
   */
  readonly camera: Readonly<Camera>;
  /** Strictly-positive camera magnification. */
  readonly zoom: number;
}
```

**File:** `src/camera/types.ts` — retain/tighten the physical-pixel contract on
`CameraViewport` and `CameraBrainOptions.viewport`:

```ts
/** Physical screen-space dimensions before camera zoom is applied. */
export interface CameraViewport { /* ... */ }
```

**File:** `src/camera/follow.ts` — document the different legacy contract:

```ts
/**
 * @param viewport - Visible dimensions in the SAME world-space units as
 *   `target` and `bounds`. This legacy solver has no zoom input; callers using
 *   a zoomed renderer must pass `physicalViewport / zoom` themselves.
 * @returns camera top-left in the same coordinate space as target and bounds.
 */
```

Do not say that legacy `updateCamera` divides by zoom—it does not.

## Change 4 — barrel re-export

**File:** `src/platformer/index.ts` — add `roomEntrySlideView` and
`RoomEntrySlideViewOptions` to the existing `./room-slide` export block. The root
barrel already re-exports the platformer barrel.

## Change 5 — tests

### `src/tests/room-slide.test.ts`

Add `describe('roomEntrySlideView')` coverage:

- **Room-px, not physical-px:** for a 320×184 room at zoom 8 with a 2560×1440
  physical viewport, visible size is 320×180; target `{ y: 90, height: 8 }`
  yields camera Y `4`, not `0` and not a physical-px value such as `-628`.
- **Fitted axis:** when room width equals visible width, X is `0`.
- **Overflow clamps:** target positions at both extremes clamp to the same
  padded bounds the follow body uses.
- **Small-room letterbox:** when a room bound is smaller than visible size, the
  result is the negative letterbox center.
- **Custom deadzone excluding center:** the helper uses the nearest valid band
  edge, not an unconditional `0.5` anchor.
- **Follow equilibrium:** pass the result to `followPosition` with the same
  target, viewport, zoom, bands, and padding; a positive-dt step returns the
  identical camera for default and custom bands.
- **Numeric repair:** zero/negative/non-finite zoom or viewport inputs produce a
  finite view with the documented `1` fallbacks; invalid target fields cannot
  leak `NaN`/`Infinity`; a valid input zoom is preserved exactly.
- **Direct API compatibility:** the result typechecks and works as
  `beginRoomSlide` / `beginRoomSlideFromBrain`'s destination view.

Add endpoint-inclusive slide-space integration coverage:

- A small destination on the union's left/top edge returns a negative local
  letterbox camera; after conversion to slide space and a real
  `updateCameraBrain` step, the fixed vcam publishes that endpoint unchanged.
- Mirror the case with the destination on the right/bottom edge.
- Assert both endpoint view rectangles lie inside `slide.space.bounds` and the
  ordinary no-overscan fixtures retain their existing offsets/bounds.
- After rebasing to destination-local, the first destination follow step with
  matching options continues from the same equilibrium (no correction pop).

### `src/tests/barrel-contract.test.ts`

Add `roomEntrySlideView` to the room-transition-hardening function assertions
and add a compile-time use of `RoomEntrySlideViewOptions`.

## Change 6 — packed-consumer smoke coverage

**File:** `scripts/release-smoke.mjs` — explicitly import and exercise
`roomEntrySlideView` in all generated consumers:

- Node ESM: build a minimal duck-typed compiled-room fixture, compute a view,
  and assert finite expected camera/zoom values.
- NodeNext: value-import and call the helper; type-import and use
  `RoomEntrySlideViewOptions` with `skipLibCheck:false`.
- Vite: value-import and exercise the helper so it remains in the bundle.

Every new public name must be imported explicitly so a missing export fails the
packed publish gate loudly.

## Change 7 — Celerock brief (thin supported-path pointer + corrected example)

**File:** `games/celerock.md` in this engine repository.

Add the short supported-path pointer:

```text
Room transitions: use detectLdtkRoomExit (re-armed exit detection),
beginRoomSlideFromBrain (rendered source view), and roomEntrySlideView
(follow-compatible destination framing). Do not hand-roll slide endpoints or
per-tick exit hysteresis.
```

Also update the existing §5.5 transition sample and nearby golden-path list so
they no longer contradict that pointer:

- use `createRoomExitDetectorState` / `detectLdtkRoomExit` rather than calling
  `findLdtkRoomExit` directly every tick;
- compute the destination zoom with `fitCameraZoom`;
- compute `destinationView = roomEntrySlideView(target, state.core, viewport,
  destinationZoom, matchingFollowOptions)` after the destination state exists;
- call `beginRoomSlideFromBrain` instead of constructing the source view and
  calling `beginRoomSlide` directly;
- keep the existing enter/advance/present/finish camera-space pipeline.

This is still a helper-name pointer rather than a prose reimplementation of the
coordinate rules. Preserve the unrelated existing contact-shadow edit in this
dirty file.

## Not changing

- Public signatures of `beginRoomSlide` / `beginRoomSlideFromBrain`.
- Slide easing or endpoint interpolation math.
- `findLdtkRoomExit` / `detectLdtkRoomExit` behavior.
- `seedRoomCutCamera`.
- A separate game's existing `roomEntryView` implementation.

## Verification

- Targeted: `npx vitest run src/tests/room-slide.test.ts src/tests/barrel-contract.test.ts`
- Full engine suite: `npm test` (record the actual file/test count from this run;
  do not hardcode a stale baseline in the release notes).
- Typecheck: `npm run build`.
- Packed consumer gates: `npm run release:smoke` after updating its fixtures.
- Showcase regression: `npm run showcase:test` and `npm run showcase:typecheck`.
  If `tile-room-fixtures.test.ts` still has the known unrelated failure, verify
  it matches the pre-change baseline rather than silently absorbing it.

## Release

This ships a new public helper/options type and backward-compatible slide-space
behavior. The repository declares Semantic Versioning and uses minor releases
for additive public functionality, so release as **`0.11.0`**, not `0.10.1`.

- Update `package.json` and the top-level `package-lock.json` version.
- CHANGELOG `### Added`: `roomEntrySlideView` and its options type.
- CHANGELOG `### Fixed`: endpoint-inclusive slide bounds preserve legitimate
  letterboxed/overscanned endpoint views.
- CHANGELOG `### Changed`: coordinate-space contracts are explicit on the slide,
  brain, and legacy follow APIs.
- Add/update comparison links and tag `v0.11.0`.

Authorization-gated: no tag, push, or `npm publish` as an implicit part of
implementation. After all gates pass, request explicit approval for release
actions.

## Workspace safety

Work on `main`. Preserve all unrelated work and untracked plan files. The only
authorized edit inside the already-dirty `games/celerock.md` is the transition
pointer/example described in Change 7; retain its existing contact-shadow diff.
