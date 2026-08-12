# Plan: Camera Brain — a light Cinemachine-style camera system

> Date: 2026-08-12
> Status: ready for implementation
> Module: `src/camera` (`motion.ts`, `brain.ts`; extended `types.ts`,
> `constants.ts`, `index.ts`)
> TDD gate: `npm run build` + `npm test` + `npm run showcase:typecheck` +
> `npm run showcase:test` + `npm run showcase:build`

## Purpose

Add a configurable, composable camera system in the spirit of a *light Unity
Cinemachine*: virtual cameras as plain config objects, a stateful-but-pure brain
that selects and blends between them, and a Celeste-inspired deadzone follow
body that reproduces the "start at the left of the screen, camera only moves
once the player has moved into the centre a fair bit" feel.

The current `src/camera/follow.ts` lerps the viewport toward the player's centre
with a constant **per-frame factor**. Its movement is distance-proportional, not
constant-speed, and its snap threshold ensures eventual convergence. Its actual
limitations are:

- smoothing is frame-rate coupled because the lerp factor is not `dt`-based;
- it is pure centre-follow, with no deadzone or design-controlled framing;
- it has no lens (zoom) support;
- it represents only one follow camera, with nothing to select or blend for
  cutscenes and same-space camera changes.

This plan keeps `createCamera` and `updateCamera` unchanged and adds the new
system alongside them.

## Background

### Celeste's camera (reference behaviour)

Celeste's camera (Everest/Celeste.Net decompile, `Level.CameraUpdate`) is the
feel reference, not an exact implementation contract:

1. `CameraTarget` is exponentially smoothed toward the player, followed by a
   second camera-convergence stage.
2. Catch-up scales with distance, so the camera moves faster when far behind
   and eases near the target.
3. Named camera targets can override or lock normal follow behaviour.
4. Death can freeze follow.
5. Zoom and render-side shake are independent presentation controls.
6. Bounds may allow a small intentional overscan.

V1 adopts the deadzone, distance-scaled convergence, explicit target, freeze,
and lens ideas. It does not claim an exact reproduction of Celeste's two-stage
target smoothing.

The engine already provides deterministic numeric primitives in
`src/primitives/pixel.ts`, render-side shake in
`src/animation/oscillators.ts`, and the state-in/new-state-out pattern in
`src/primitives/hit-stop.ts`.

### Current baseline

- `src/camera/follow.ts` — `createCamera()` returns `{x:0,y:0}`;
  `updateCamera(camera, target, bounds, viewport, config)` is pure, centres the
  target, clamps or letterboxes, lerps by `DEFAULT_CAMERA.lerp` per call, and
  snaps within `snapThreshold`.
- `src/camera/types.ts` — `Camera`, `CameraTarget`, `CameraBounds`,
  `CameraConfig`.
- `src/camera/constants.ts` — `DEFAULT_CAMERA`.
- `src/camera/index.ts` — camera barrel exports.
- `src/tests/camera.test.ts` — pins smoothing, clamping, snap, convergence,
  purity, and determinism.
- `src/tests/barrel-contract.test.ts` — pins top-level `createCamera` and
  `updateCamera` exports.

### Approved product decisions

- Configurable camera system with a light Cinemachine model.
- Celeste-style deadzone/lead band as the core follow body.
- A `fixed` body and priority-based selection.
- Velocity lookahead and LDtk-authored camera-trigger entities are deferred.
- The default horizontal `followX.lead` value is `0.5`, so that existing band
  knob places the forward trigger at 50% of the visible width. There is no
  separate trigger parameter.

## Goals

1. Virtual cameras are plain, serializable, tree-shakeable config objects.
2. The brain selects a vcam using explicit override, then priority, then
   keep-current-on-ties.
3. The incoming vcam has an independent live body/lens state; blending its
   output never feeds the displayed interpolation back into its solver.
4. Follow uses a deadzone and analytic, `dt`-based, distance-scaled
   convergence, with a documented finite-precision edge at the snap threshold.
5. Position and zoom blend between vcams that share one coordinate space.
6. Bounds support optional intentional overscan and preserve letterbox
   centring when the world is smaller than the visible world viewport.
7. A missing follow target holds the view, providing a simple death-freeze
   mechanism.
8. `createCamera` and `updateCamera` remain backward compatible.

## Non-goals (v1)

- Velocity/input lookahead.
- LDtk `CameraTargetTrigger`/`BossCamTarget` entity authoring.
- Shake inside the brain. Consumers continue composing render-side
  `sineShake`/`shakeEnvelope`.
- Simultaneously sampling both the outgoing and incoming bodies. The outgoing
  side is a frozen rendered-view snapshot; only the incoming side remains live.
- Cross-coordinate-space position blends. All positions passed to one running
  brain must use the same origin and units.
- Rendering adjacent LDtk rooms. Overscan only reveals content the consumer
  actually renders; it does not make a neighbouring room appear by itself.

## Coordinate and lens contract

This contract is an invariant of the public API:

- `Camera`, targets, fixed-body coordinates, and bounds are expressed in the
  same world coordinate space. `CameraBounds` retains its legacy origin at
  `(0, 0)` and supplies only `width`/`height`.
- Vcam position blends are valid only while that coordinate space remains the
  same. A caller changing from one room-local origin to another must reset or
  explicitly rebase its brain before updating it.
- `CameraBrainOptions.viewport` is the physical, unzoomed render size in screen
  pixels. Callers do **not** divide it by zoom.
- For zoom `z`, the brain derives the visible world size as
  `{ width: viewport.width / z, height: viewport.height / z }`.
- Zoom is anchored at the visible world's centre. When a live lens changes,
  the brain adjusts the live top-left camera so the pre-zoom world centre stays
  fixed before the body is advanced.
- During a blend, the brain interpolates world-space view centres and zoom,
  then derives the displayed top-left from the interpolated centre and zoom.
  It does not linearly interpolate top-left coordinates, which would make zoom
  appear anchored to the upper-left corner.

These rules remove any caller/brain feedback loop around `worldView` and make
the render order explicit.

## V1 scope and proof in the showcase

The brain remains in v1 because selection and same-space blends are approved
product requirements, but its riskiest path must be exercised by a real
consumer rather than only synthetic core tests. V1 therefore has two showcase
integrations:

1. The LDtk play session exercises deadzone follow, lens convergence, and the
   explicit reset required between room-local coordinate spaces.
2. A small dedicated camera-brain showcase uses two vcams in one level
   coordinate space. A visible **Director focus** control changes vcam
   priorities and drives a real position-and-zoom blend in both directions.

This keeps the feature in one coherent plan while making every major subsystem
observable in the running app. Details and integration tests appear below.

## Conceptual model

Three layers form the light Cinemachine model:

1. **Virtual camera** (`VirtualCamera`) — selection metadata, a placement body,
   a lens target, and the incoming blend duration.
2. **Body** (`CameraBody`) — either:
   - `follow`: deadzone follow of a target key resolved from the caller's table;
   - `fixed`: converge to an exact world-space viewport top-left.
3. **Brain** (`CameraBrain`) — the rendered camera/zoom, active selection,
   independent incoming body/lens state, and an optional frozen-source blend.

The distinction between rendered state and live destination state is
essential. During a blend, `bodyCamera` and `lensZoom` advance independently;
`camera` and `zoom` are only the composited output. A slow blend therefore
cannot slow the incoming follow solver or cause double easing.

## API surface

### Types (`src/camera/types.ts`, extended)

```ts
/** Screen-space viewport dimensions before camera zoom is applied. */
export interface CameraViewport {
  readonly width: number;
  readonly height: number;
}

/** Per-axis deadzone band as fractions of the visible dimension. */
export interface FollowBand {
  readonly trail: number;
  readonly lead: number;
}

/** Analytic scalar convergence tuning. Units depend on the value being moved. */
export interface DampedMotionConfig {
  /** Time in seconds to halve the remaining distance in the uncapped region. */
  readonly halfLife?: number;
  /** Maximum value-units per second (px/s for position, zoom-units/s for lens). */
  readonly maxSpeed?: number;
  /** Remaining distance at which to return the target exactly. */
  readonly snapThreshold?: number;
}

/** Tuning for the deadzone follow body. */
export interface FollowBodyConfig {
  /** Defaults to `DEFAULT_FOLLOW_BODY.targetKey` (`player`). */
  readonly targetKey?: string;
  /** Default `{ trail: 0.25, lead: 0.5 }`. */
  readonly followX?: Readonly<FollowBand>;
  /** Default `{ trail: 0.35, lead: 0.65 }`. */
  readonly followY?: Readonly<FollowBand>;
  readonly motion?: Readonly<DampedMotionConfig>;
  /** Non-negative world-unit overscan on every edge. Default 0. */
  readonly padding?: number;
}

export interface FixedBodyConfig {
  /** Desired viewport top-left in the current world coordinate space. */
  readonly x: number;
  readonly y: number;
  readonly motion?: Readonly<DampedMotionConfig>;
  /** Non-negative world-unit overscan on every edge. Default 0. */
  readonly padding?: number;
}

export type CameraBody =
  | ({ readonly mode: 'follow' } & FollowBodyConfig)
  | ({ readonly mode: 'fixed' } & FixedBodyConfig);

export interface CameraLens {
  /** Strictly-positive zoom target. */
  readonly zoom: number;
  readonly motion?: Readonly<DampedMotionConfig>;
}

/** A plain, serializable virtual-camera definition. */
export interface VirtualCamera {
  readonly id: string;
  /** Higher wins. Non-finite or absent values normalize to 0. */
  readonly priority?: number;
  /** Incoming brain-blend duration in seconds. Default 0.3; <= 0 disables it. */
  readonly blend?: number;
  /** Absent means hold the current live view centre, subject to lens/bounds. */
  readonly body?: CameraBody;
  /** Absent means keep the current live zoom. */
  readonly lens?: Readonly<CameraLens>;
}

/** Running state. All fields are plain JSON-compatible data. */
export interface CameraBrain {
  /** Rendered/composited viewport top-left. */
  readonly camera: Readonly<Camera>;
  /** Rendered/composited zoom. */
  readonly zoom: number;
  /** Selected vcam; changes immediately when selection changes. */
  readonly activeId: string | null;
  /** Independent solver state of the selected vcam's body. */
  readonly bodyCamera: Readonly<Camera>;
  /** Independent solver state of the selected vcam's lens. */
  readonly lensZoom: number;
  readonly blend: null | {
    readonly fromId: string;
    readonly toId: string;
    readonly elapsed: number;
    readonly duration: number;
    /** Frozen world-space centre of the rendered source view. */
    readonly fromCenter: Readonly<{ x: number; y: number }>;
    readonly fromZoom: number;
    /** Minimum frozen clamp padding required to reproduce the rendered source view. */
    readonly fromPadding: number;
  };
}

export interface CameraBrainOptions {
  readonly vcams:
    | Readonly<Record<string, VirtualCamera>>
    | readonly VirtualCamera[];
  readonly targets: Readonly<Record<string, CameraTarget>>;
  readonly bounds: CameraBounds;
  /** Physical screen pixels, never pre-divided by zoom. */
  readonly viewport: CameraViewport;
  /** Valid override wins; an unknown id falls back to automatic selection. */
  readonly activeId?: string;
  /** Frame delta in seconds. Non-finite or non-positive values advance by 0. */
  readonly dt: number;
}
```

The existing `Camera`, `CameraTarget`, `CameraBounds`, and `CameraConfig` types
remain unchanged. In particular, legacy `Camera` stays mutable for source
compatibility; the new brain exposes its nested camera as `Readonly<Camera>`.

### Functions

- `createCameraBrain(initial?: { x?: number; y?: number; zoom?: number }): CameraBrain`
  creates a fresh inactive brain. Position defaults to `(0, 0)`, zoom defaults
  to `1`, and `bodyCamera`/`lensZoom` start equal to the rendered values.
- `updateCameraBrain(state, options): CameraBrain` advances selection, the live
  lens/body, and the rendered blend without mutating any input.
- `converge(current, desired, dt, config?): number` performs analytic capped
  exponential convergence using `DEFAULT_CAMERA_MOTION` for omitted fields.
- `followPosition(camera, target, bounds, viewport, zoom, dt, config?): Camera`
  is an exported-from-file implementation helper for focused unit tests, but is
  intentionally omitted from `src/camera/index.ts` and the package API. It
  accepts the physical viewport and derives visible world dimensions internally.

### Constants (`src/camera/constants.ts`, extended)

```ts
export const DEFAULT_CAMERA_MOTION: Required<DampedMotionConfig> = {
  halfLife: 0.12,
  maxSpeed: 1600,
  snapThreshold: 0.5,
};

export const DEFAULT_LENS_MOTION: Required<DampedMotionConfig> = {
  halfLife: 0.12,
  maxSpeed: 4,
  snapThreshold: 0.001,
};

export const DEFAULT_FOLLOW_BODY = {
  targetKey: 'player',
  followX: { trail: 0.25, lead: 0.5 },
  followY: { trail: 0.35, lead: 0.65 },
  padding: 0,
} as const;

export const DEFAULT_BRAIN_BLEND_DURATION = 0.3;
```

Body `motion` fields fall back field-by-field to `DEFAULT_CAMERA_MOTION`.
Lens motion falls back field-by-field to `DEFAULT_LENS_MOTION`.

## Behaviour details

### Vcam normalization and selection

1. Arrays use array order. Records use ECMAScript `Object.values` enumeration
   order. Empty ids are ignored; if ids are duplicated, the first normalized
   entry wins. Consumers that depend on record tie order should use
   non-integer-like ids; ECMAScript enumerates integer-like keys before other
   string keys regardless of insertion order. Arrays are preferred whenever
   authored order is semantically important.
2. A valid `options.activeId` wins. An absent or unknown override falls back to
   automatic selection; it does not force the brain inactive.
3. Automatic selection chooses the highest normalized priority. On ties it
   keeps `state.activeId` if that id is still present; otherwise it chooses the
   first normalized vcam.
4. With no valid vcam, the brain sets `activeId` to `null`, clears any blend,
   and holds its rendered and live state after numeric repair.

### Activation and interruption lifecycle

- **First activation:** when `state.activeId` is `null`, select the vcam
  immediately, seed `bodyCamera`/`lensZoom` from the rendered state, and advance
  it normally without a brain blend. There is no nullable `fromId` case.
- **Normal switch:** when a different vcam is selected, `activeId` changes
  immediately. Seed the incoming body's independent state from the currently
  rendered camera/zoom. If its normalized incoming duration is positive,
  capture the current rendered view centre/zoom and the minimum clamp padding
  required to reproduce that view, then begin a blend; otherwise expose the
  incoming live state directly. The source padding is derived from the rendered
  view rather than the outgoing vcam config, so removal remains continuous.
- **Interrupted blend:** start a new blend from the currently rendered
  camera/zoom, not from the original blend's source. Reseed the new incoming
  live state from that rendered view and derive its current effective clamp
  padding from the rendered composite. This guarantees visual continuity.
- **Removed active vcam:** run normal selection. A replacement starts a switch;
  no replacement makes the brain inactive and holding.
- A finite `blend <= 0` disables the brain-level blend. A non-finite blend uses
  `DEFAULT_BRAIN_BLEND_DURATION`.

Body damping remains active even when the brain blend is disabled. “No blend”
means no source-to-destination compositing; it does not mean teleporting a
damped body to its aim.

### Per-step update order

After selection/lifecycle handling:

1. Sanitize `dt`, viewport, bounds, config, and carried state.
2. Advance `lensZoom` toward the selected lens target. An absent or invalid lens
   target holds the current live zoom.
3. Re-anchor `bodyCamera` for the live zoom change so its prior world-space view
   centre is preserved.
4. Advance the selected body from `bodyCamera`, using the **new live zoom** to
   derive its visible world dimensions. A missing follow target or absent body
   holds the re-anchored live centre, then clamps it to bounds. This result
   remains independent of the rendered interpolation.
5. Without a blend, publish `bodyCamera`/`lensZoom` as `camera`/`zoom`.
6. With a blend, advance `elapsed`, apply smoothstep
   `e = t*t*(3 - 2*t)`, interpolate `fromCenter` to the current live view
   centre and `fromZoom` to `lensZoom`, then derive the rendered top-left.
7. Clamp the rendered top-left using the rendered zoom and a padding interpolated
   from the captured source view's minimum required padding to the incoming
   body's padding. This reproduces the prior rendered view at `t = 0`, including
   when the outgoing vcam was removed or the switch interrupts another blend.
   At `t >= 1`, publish the live state exactly and clear the blend so there is no
   last-frame rounding discontinuity.

### Follow body

For one axis, let `cam` be the independently advancing live top-left, `p` the
target rectangle's centre, `visible` the screen dimension divided by live zoom,
and `{trail, lead}` the normalized band:

1. If the bound is no larger than `visible`, aim at
   `(bound - visible) / 2`; skip the band and ignore padding on that axis.
2. Compute `s = (p - cam) / visible`.
3. If `s > lead`, aim at `p - lead * visible`.
4. If `s < trail`, aim at `p - trail * visible`.
5. Otherwise aim at `cam`, producing the deadzone hold.
6. Clamp the aim to `[-padding, bound - visible + padding]`.
7. Analytically converge `cam` toward that aim.

The band is stateless and relative to the live body camera. At a level start
with the camera at zero, a player near the left wall remains pinned until the
player crosses the default 50% forward trigger.

A band is valid only when both values are finite and
`0 <= trail <= lead <= 1`; otherwise that entire axis uses its default band.

### Analytic convergence

`converge` solves a capped exponential response rather than recalculating an
Euler `speed * dt` step. Let:

```ts
lambda = Math.LN2 / halfLife;
r = Math.abs(desired - current);
capDistance = maxSpeed / lambda;
```

The remaining distance obeys:

```ts
dr/dt = -min(maxSpeed, lambda * r)
```

If `r > capDistance`, move at `maxSpeed` until the cap boundary, then spend any
remaining time in the exponential region. Otherwise:

```ts
rNext = r * Math.exp(-lambda * dt);
```

Reconstruct the signed value toward `desired`, never pass the target, and
return `desired` exactly when `rNext <= snapThreshold`.

In exact arithmetic, the capped ODE has the semigroup property: for a static
target, one step of `dt` equals two steps of `dt / 2`, including a step that
crosses the speed-cap boundary. The monotone snap projection preserves that
property in exact arithmetic as well: if an earlier partition reaches the snap
band, the unpartitioned trajectory's final distance is also inside it.

Finite precision adds one deliberate edge case. If the mathematical result is
on the snap boundary, differently partitioned calculations can land on opposite
sides of the comparison and amplify a rounding difference into a discrepancy
of at most `snapThreshold`. Partition-invariance tests must therefore stay a
clear epsilon outside the snap band; a separate boundary test pins the bounded
snap behavior. Moving targets can also differ when sampled at different rates,
so consumers should continue using the engine's fixed simulation timestep for
replay-identical camera trajectories.

### Fixed body

The fixed body's `x/y` is the desired viewport top-left. Each axis is clamped
with the same bounds/letterbox rule and converged using the body's optional
motion config. Non-finite `x/y` holds that axis rather than poisoning state.

### Zoom-only vcam

A vcam without a body preserves the live **view centre** while its lens moves.
Its top-left may therefore change as zoom changes or bounds clamp the view; this
is intentional and is more useful than upper-left anchoring.

### Missing follow target

If a follow target key is absent, the live body holds its world-space view
centre and the brain blend continues toward that held live view. A simultaneous
lens change may alter the top-left while preserving the centre. Death-freeze
consumers should normally remove the target without changing the lens.

### Bounds and padding

- Bounds have origin `(0, 0)`.
- For `bound > visible`, top-left clamps to
  `[-padding, bound - visible + padding]`.
- For `bound <= visible`, top-left is exactly `(bound - visible) / 2`; padding
  does not shift letterbox centring.
- Padding is non-negative and finite; invalid values normalize to zero.
- Padding permits deliberate overscan only. The renderer must draw something
  outside the bound if the overscan is expected to reveal content.

### Defensive numeric policy

The typed API is defensive about runtime numeric/config errors without claiming
to accept arbitrary `unknown` structures:

- non-finite/non-positive viewport dimensions normalize to `1`;
- non-finite/negative bound dimensions normalize to `0`;
- non-finite or non-positive state zoom repairs to `1`;
- non-finite state coordinates repair to `0`;
- non-finite/non-positive `halfLife` and `maxSpeed`, and negative/non-finite
  `snapThreshold`, use their applicable defaults;
- non-finite/non-positive lens targets hold the current live zoom;
- non-finite or non-positive `dt` advances by zero;
- invalid ids/selectors and missing targets follow the lifecycle rules above.

Tests cover these supported degeneracies. Values whose runtime structure
violates the TypeScript signature are outside the contract and need not be
silently accepted.

## File changes

| File | Change |
|---|---|
| `src/camera/types.ts` | Add the vcam, body, lens, motion, brain, blend, and viewport types |
| `src/camera/constants.ts` | Add body/lens motion, follow-band, and blend defaults |
| `src/camera/motion.ts` | **New** — analytic `converge`, clamp helpers, and package-internal `followPosition` |
| `src/camera/brain.ts` | **New** — normalization, selection, live destination state, centre-based blends, zoom anchoring |
| `src/camera/index.ts` | Export brain API, types, constants, and `converge`; retain legacy exports; omit `followPosition` |
| `src/camera/follow.ts` | Unchanged |
| `src/tests/camera-brain.test.ts` | **New** — motion and brain unit tests below |
| `src/tests/camera.test.ts` | Unchanged legacy contract |
| `src/tests/barrel-contract.test.ts` | Pin representative new top-level exports as well as legacy ones |
| `showcase/sections/ldtk-editor/play.ts` | Migrate the play session using the room-local policy below; export the `resetRoomCameraBrain` helper |
| `showcase/tests/ldtk-editor-transitions.test.ts` | Extend with room-transition camera policy tests, or add a focused sibling test |
| `showcase/sections/camera-brain-session.ts` | **New** — DOM-free demo state, vcam factory, priority toggle, and fixed-step update |
| `showcase/sections/camera-brain-demo.ts` | **New** — canvas rendering, loop, accessible controls, and active/blend status |
| `showcase/tests/camera-brain-session.test.ts` | **New** — integration-level priority switch and bidirectional position/zoom blend test |
| `showcase/main.ts` | Initialize and dispose the new camera-brain section |
| `showcase/index.html` | Add the visible Director focus control, canvas, explanation, and sample snippet |
| `showcase/style.css` | Add the camera-brain section layout and control/status styles |
| `docs/api-surface.md` | Document every new camera export |
| `src/index.ts` | No code change expected: it already re-exports `./camera`; verify via barrel test |

## Test plan (`src/tests/camera-brain.test.ts`)

### Motion and follow

- hold while the target is inside each band;
- move forward after crossing `lead` and backward after crossing `trail`;
- level-start pin at zero until the horizontal 50% trigger is crossed;
- target rectangle centre, rather than its top-left, drives the band;
- padding and per-axis letterbox rules;
- fixed-body-equivalent clamping on both axes;
- analytic convergence never overshoots and snaps exactly;
- analytic convergence gives one `dt` step equal to two `dt / 2` steps within a
  tight floating-point tolerance, both below and across the speed cap, using
  inputs whose result stays safely outside the snap band;
- a result mathematically on the snap boundary remains deterministic per call,
  and alternate partitions differ by no more than `snapThreshold` if floating
  rounding sends the comparison down opposite branches;
- invalid bands and numeric motion values use documented defaults.

### Brain

- valid explicit id wins; invalid explicit id falls back to priority;
- highest priority wins and ties retain the active vcam;
- duplicate/empty id normalization is deterministic;
- first activation does not create a blend;
- active id changes immediately on a normal switch;
- a normal blend captures rendered centre/zoom and finishes exactly at the live
  destination state;
- the incoming `bodyCamera` trajectory matches an equivalent no-blend live
  solver, proving rendered blend output never feeds back into it;
- interruption restarts from the currently rendered view with no discontinuity;
- zero/negative duration disables the brain blend; non-finite duration defaults;
- active removal selects a replacement or becomes inactive and holds;
- lens convergence is analytic and centre-anchored;
- centre-based position/zoom blend has no upper-left anchoring jump;
- missing follow target holds the live centre while a blend can complete;
- zoom-only vcam holds the centre;
- fixed body is clamped and uses its supplied motion config;
- input brain/vcams/targets are never mutated and outputs are fresh objects;
- identical inputs yield identical outputs;
- all documented numeric degeneracies return finite state without throwing.

### Integration and contracts

- existing `src/tests/camera.test.ts` remains unchanged and green;
- barrel test pins `createCameraBrain`, `updateCameraBrain`, `converge`, and
  legacy camera functions;
- showcase test pins the room-local transition reset and preservation of the
  previous rendered zoom as the next lens's starting value;
- camera-brain demo integration starts on the follow vcam without an override,
  raises the fixed focus vcam's priority, observes a non-null position-and-zoom
  blend, reaches the independent live destination, then lowers focus priority
  and observes the blended return to live follow;
- showcase typecheck/build ensures its render and culling paths consume the
  brain's viewport/zoom contract correctly.

## Showcase integration (`showcase/sections/ldtk-editor/play.ts`)

The showcase's physics, player, camera, and renderer all use **room-local**
coordinates. Only the active room is drawn. Consequently it must not blend a
position captured in one room directly into another room's local coordinates,
and `padding: 32` would reveal only the background rather than the neighbour.

The v1 integration therefore uses this explicit policy:

1. Build or cache one room vcam with:

   ```ts
   {
     id: room.iid,
     priority: 0,
     blend: 0,
     body: {
       mode: 'follow',
       targetKey: 'player',
       followX: { trail: 0.25, lead: 0.5 },
       followY: { trail: 0.35, lead: 0.65 },
       padding: 0,
     },
     lens: { zoom: fitZoom(level, viewport) },
   }
   ```

2. Initialize the starting brain with the current fitted zoom so entering play
   mode does not introduce an unnecessary startup zoom:

   ```ts
   let brain = createCameraBrain({ zoom: fitZoom(active.levelData, viewport) });
   ```

3. Each `step(dt)`, pass the physical canvas viewport directly:

   ```ts
   brain = updateCameraBrain(brain, {
     vcams,
     targets: { player: state.core },
     bounds: {
       width: active.levelData.width,
       height: active.levelData.height,
     },
     viewport,
     activeId: active.ldtkLevel.iid,
     dt,
   });
   ```

4. On a room transition, after moving the player into destination-local space,
   cut position to a valid destination-local origin while retaining the old
   rendered zoom as the new lens solver's starting value:

   ```ts
   export function resetRoomCameraBrain(brain: CameraBrain): CameraBrain {
     return createCameraBrain({ x: 0, y: 0, zoom: brain.zoom });
   }

   brain = resetRoomCameraBrain(brain);
   ```

   The new room becomes a first activation, so no cross-space brain blend is
   created. Its follow body begins from the left/top origin, preserving the
   requested level-start behaviour, while its lens smoothly converges from the
   previous room's zoom. Keeping this reset as a small exported pure helper lets
   the showcase test exercise the policy without constructing a DOM session.

5. Render with `brain.camera` and `brain.zoom`. Derive a local `worldView` only
   for tile culling:

   ```ts
   const zoom = brain.zoom;
   const worldView = {
     width: viewport.width / zoom,
     height: viewport.height / zoom,
   };
   const offsetX = -Math.round(brain.camera.x);
   const offsetY = -Math.round(brain.camera.y);
   ```

This LDtk integration deliberately demonstrates follow and lens behaviour, not
cross-room position blends. A future multi-room showcase may move rendering and
physics cameras into LDtk project-world coordinates and render both rooms during
a transition; only then should it enable cross-room position blends or
next-room overscan. The same-space blend path is exercised separately below.

## Same-space blend showcase

Add a compact **Camera brain** section rather than forcing a same-space example
into the room-local LDtk renderer. It uses only procedural Canvas2D art and the
public camera API, so the novel brain path remains easy to inspect and cheap to
test.

### DOM-free demo session

`showcase/sections/camera-brain-session.ts` owns plain state for a
`1600 x 900` world viewed through a `640 x 360` physical viewport. A small
target moves deterministically back and forth through the world at the
showcase's fixed timestep. The session creates these two same-space vcams:

```ts
function cameraDemoVcams(directorFocus: boolean): readonly VirtualCamera[] {
  return [
    {
      id: 'player-follow',
      priority: 10,
      blend: 0.45,
      body: { mode: 'follow', targetKey: 'player' },
      lens: { zoom: 1 },
    },
    {
      id: 'director-focus',
      priority: directorFocus ? 20 : 0,
      blend: 0.6,
      body: { mode: 'fixed', x: 720, y: 300 },
      lens: { zoom: 1.35 },
    },
  ];
}
```

The session always omits `activeId`. Priority selection is therefore real, not
an override-shaped demo:

```ts
brain = updateCameraBrain(brain, {
  vcams: cameraDemoVcams(directorFocus),
  targets: { player },
  bounds: { width: 1600, height: 900 },
  viewport: { width: 640, height: 360 },
  dt,
});
```

On first update, `player-follow` activates without a blend. Enabling director
focus raises the fixed vcam's priority and starts a simultaneous position/zoom
blend. Disabling it makes the live follow vcam win again and starts the reverse
blend while the target is still moving. This visibly exercises selection,
live-destination independence, frozen-source blending, centre-based zoom, and
blend interruption if the control is toggled mid-transition.

### Visible section

`showcase/sections/camera-brain-demo.ts` renders:

- world bounds and a high-contrast grid so camera translation and zoom anchoring
  are visually obvious;
- the moving follow target and the fixed director-focus marker;
- the current deadzone as a screen-space overlay;
- `activeId`, rendered camera/zoom, live camera/zoom, and blend progress;
- a keyboard-accessible **Director focus** toggle with correct `aria-pressed`
  state and a **Reset demo** control.

The canvas transform is exactly the documented consumer contract:

```ts
context.scale(brain.zoom, brain.zoom);
context.translate(-Math.round(brain.camera.x), -Math.round(brain.camera.y));
```

The demo uses the normal fixed game loop and pauses when offscreen. With reduced
motion requested, autonomous target movement is paused; the explicit focus
control remains available, and the section may advance directly to settled
states rather than autoplay a transition.

### Showcase integration test

`showcase/tests/camera-brain-session.test.ts` drives the real DOM-free session:

1. First step selects `player-follow` with `blend === null`.
2. Raising director focus selects `director-focus` by priority and creates a
   blend whose rendered position and zoom differ from both frozen source and
   live destination during progress.
3. Repeated fixed steps complete exactly at `bodyCamera`/`lensZoom`.
4. Lowering focus selects `player-follow` and produces a second real blend.
5. Toggling focus during that blend captures the current rendered centre,
   proving the visible consumer handles interruption without a discontinuity.

The test never supplies `activeId`; an accidental implementation that bypasses
priority selection fails it. The rendered section then supplies human-visible
coverage that a synthetic unit test cannot.

During implementation, visually check the default lens motion both in this
`1 -> 1.35` demo and across the smallest/largest bundled LDtk `fitZoom` change.
The acceptance target is no one-tick zoom pop and practical settling within
roughly `0.75s`; tune `DEFAULT_LENS_MOTION` once if those concrete transitions
show that `maxSpeed: 4` is too slow or too abrupt.

## Determinism and architecture compliance

- Pure functions throughout; immutable-in/new-out; all state is plain data.
- No `Math.random`, `Date.now()`, DOM reads, or module-load host resolution.
- `dt`, viewport, targets, bounds, and vcams are supplied by the caller.
- Away from the snap comparison boundary, analytic static-target convergence is
  partition-invariant up to normal floating-point error. At that boundary, the
  maximum partition discrepancy is explicitly bounded by `snapThreshold`.
- The camera brain is deliberately outside the replay hash: it consumes
  simulation state but produces presentation state only, so it cannot change a
  physics trajectory or win condition. No `physicsVersion` bump is required.
- No new runtime dependency; `package.json` remains unchanged.
- Strict/no-unused checks apply to both library and showcase TypeScript.
- Required gate:

  ```sh
  npm run build
  npm test
  npm run showcase:typecheck
  npm run showcase:test
  npm run showcase:build
  ```

## Known v1 tradeoffs

- The source side of a blend is frozen. A moving outgoing target is not sampled
  after the switch.
- Incoming body state is seeded from the rendered view on selection; the brain
  does not retain a per-vcam history for inactive cameras.
- Moving targets sampled at different rates can produce different paths even
  though the static-target convergence equation itself is partition-invariant.
- A finite-precision comparison exactly at the snap boundary can magnify a
  rounding difference into a discrepancy no larger than `snapThreshold`.
- The LDtk showcase cuts position between room-local spaces and eases only
  through the new room's lens/body motion. Seamless cross-room visuals require
  a later project-world, multi-room renderer; the separate camera-brain demo is
  the v1 proof for same-space blends.
- Legacy `updateCamera` remains available for consumers that do not need vcams.
