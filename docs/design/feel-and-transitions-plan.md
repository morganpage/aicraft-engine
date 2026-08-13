# Feel Events & Room Transitions — Next-Stage Hardening Plan

**Status:** Proposed
**Scope:** `aicraft-engine` platformer kernel (feel-event channel) + a new room-transitions module (pure seam helpers + slide presentation orchestrator + camera-fit helper) + the Celerock brief
**Predecessor:** `docs/design/celerock-integration-hardening-plan.md` (Phases 0–2 shipped in `0.7.0`; this is the Phase 3 remainder — D2 + E1–E4 — plus F1, which already shipped)
**Primary evidence:**
- `/Users/morganpage/Documents/VSCODE/OPENCODE/TUTORIALS/simple-platformer/BUILD_NOTES.md` (§8 cover-fit, §10 slide transition, §11 transition-test pitfalls)
- `/Users/morganpage/Documents/VSCODE/OPENCODE/TUTORIALS/celerock/ISSUES.md` (§4.2 unscaled hard-land threshold, §4.4 missing vertical dash bonk, §5.2 silent stamina-out)
- The current `aicraft-engine@0.7.0` source (kernel + camera-brain internals re-verified for this plan)

---

## 1. Executive summary

`0.7.0` shipped the golden path (LDtk load/compile/cache, spawn rest-on-surface, spring/dashRefill mapping, config scaling, loop resilience). Two categories of consumer glue remain — the two areas where both independent Celerock builds wrote the most fragile, most-debugged code:

1. **Game feel is reverse-engineered from boolean pulses.** The kernel emits `justLanded`/`hitWall`/`hitCeiling` as bare booleans; the impact speed it computed is discarded; the dash ability has no contact detection; grab-latch and stamina-exhaustion are internal with no signal. Every consumer reconstructs the feel moments (hard landing, dash-into-wall, stamina-out) by peeking velocity and diffing ability slices — and gets the scaling and the detection window wrong (ISSUES §4.2, §4.4, §5.2).
2. **Seamless room traversal is entirely consumer code.** The Celeste-style slide transition (hundreds of lines: edge detection, world→dest-local conversion, momentum preservation, particle rebase, both-rooms render, camera continuity) is rewritten by every builder, who hits camera pops (ISSUES §4.6), side gaps (BUILD_NOTES §8), and the slide itself (BUILD_NOTES §10). The camera brain already owns every primitive the slide needs — but no one composes it for them.

The plan adds these at the lowest responsible layer, with no removal or re-typing of an existing field:
- A structured **feel-moment channel** (`state.moments`) that surfaces data the kernel already computes, plus a dash-lifecycle pulse and grab/stamina pulses. The required state-field addition is runtime-additive but source-visible to consumers that manually construct `PlatformerState`; §9 defines the migration and replay-version bump.
- **Pure, canvas-free room-transition helpers** + a **slide presentation orchestrator** that composes and rebases the existing camera brain's plain state (no new camera solver) + an explicit **camera-fit helper**.

The intended outcome: a future Celerock builder consumes `state.moments` for feel and `findLdtkRoomExit → transitionPlatformerToRoom → beginRoomSlide` for traversal, and writes neither an unscaled `prevVy > 520` threshold nor a hand-rolled slide.

---

## 2. Goals

### 2.1 Product goals
- Hard-landing shake/SFX fire identically at 8, 16, and 32 px tiles (no per-tile magic number).
- Horizontal **and** vertical (ceiling) dash-into-wall both bonk with hit-stop + shake, and the consumer knows the collision normal and surface id.
- Wall-grab latch and stamina exhaustion each have a one-tick signal (so the gasp/latch SFX are not silent).
- Room-to-room travel is a seamless slide (no camera pop, no side-gap letterbox, momentum + particles continuous), with an immediate seam-aligned cut for reduced motion.
- Camera framing is an explicit policy (`cover`/`contain`/`native`), not a builder's `Math.min`/`Math.max` guess.

### 2.2 Engineering goals
- **No removal or re-typing.** The boolean `state.events` and the `state.interactions` spring/dashRefill channel are retained. `state.moments` widens the exported state shape, so manual state constructors must add `moments: []`; engine-created states always populate it.
- The feel-moment channel is a **single-tick, pure, replay-deterministic** stream (it must not perturb the simulation, mirroring the brain's presentation-only contract).
- Transition/slide/fit helpers are **pure where possible** (canvas-free, unit-testable) and compose the already-shipped camera brain rather than duplicating its solver.
- Every feel number that claims "Celeste-tight" is **feel-invariant** across tile sizes (peak/normalized quantities expressed in tiles or ratios, never raw px).
- The reserved `'seam-entry'` spawn source (already in the `0.7.0` union, unpopulated) gets a producer.

## 3. Non-goals
- Changing the boolean event surface or removing `state.interactions` (deprecation only, post-ship).
- A general animation/timeline engine or a full scene-graph.
- Authoring room geometry or transition seams (those come from LDtk `__neighbours`).
- Game-specific SFX/animation wiring (the engine emits the *moment*; the consumer still chooses the cue).
- Moving art direction, hair, or the supplied-sprite policy into the engine.

---

## 4. Design principles
1. **Surface what is already computed.** Impact speed, the bonk solid id + normal, grab latch, and stamina exhaustion are all evaluated internally today and thrown away. Plumb them out before inventing new detectors.
2. **Compose the camera brain, don't fork it.** The brain already supports fixed-body vcams and priority takeover. Its automatic selection blend is useful within one coordinate space, but the slide deliberately disables it at room-space boundaries and uses pure state rebases so the named slide curve remains the sole path authority.
3. **Additive channels over re-typed fields.** A new `state.moments` array (like the existing `state.interactions` array) rather than changing `justLanded: boolean` to an object. Read-only consumers keep their existing event code; manual `PlatformerState` constructors add the new empty channel as documented in §9.
4. **Tile-unit / ratio invariants, not pixel literals.** Feel thresholds are ratios (`normalizedImpact`); transition math is in world coordinates derived from level dimensions; zoom is a policy enum.
5. **Pure helpers first.** Everything testable without a canvas is pure and unit-tested over the cardinal directions, partial overlaps, and reversals before any render integration.
6. **Presentation never feeds simulation.** The feel channel and the slide are read-only over `PlatformerState` / the brain's targets.

---

## 5. Current state (verified against `0.7.0` source)

### 5.1 Feel (`src/platformer/kernel.ts`, `types.ts`, `abilities/*`)
- `stepPlatformer(...)` returns `{ state }`. `state.events` is **9 booleans only**: `justLanded`, `justLaunched`, `hitCeiling`, `hitWall`, `startedWallSlide`, `wallJumpLaunched`, `dashStarting`, `dashStarted`, `doubleJumped` (`types.ts:86-117`).
- `state.interactions: InteractionEvent[]` is hard-wired to `{ kind: 'spring' | 'dashRefill', entityId }` (`types.ts:63,74-79,801`).
- **Impact speed is computed and discarded.** At landing the pre-zero `core.vy` is the impact speed, but `nextVy = (landed || hitCeiling) ? 0 : core.vy` (`kernel.ts:934`); `justLanded` is a bare boolean (`kernel.ts:1014-1017`). `src/platformer/squash.ts:82-89` documents that its fixed-pair landing squash exists *because the kernel does not expose impact velocity* — the load-bearing citation for D2.
- **The bonk solid id + normal are already known.** `findWallSolidId` returns `{ id, side: 'left' | 'right' }` (`kernel.ts:1552-1585`); `findCeilingSolidId`/`findGroundSolidId` resolve the Y contacts. They land on `core.contacts.{leftWallId,rightWallId,ceilingId,groundId}` (`types.ts:44-53`) — but the boolean `hitWall`/`hitCeiling` carry no id and no "this was the contact" linkage.
- **The dash ability has no contact detection.** `dash-ability.ts` ends a dash **only on timeout** (`timer <= 0`, `:275`); it never reads `ctx.solids`/`ctx.core.contacts`. A dash into a wall has its `vx` zeroed each tick by the kernel's `resolveAxisX` (`kernel.ts:914`) while the dash phase runs to timeout. D2 therefore keeps timeout as the truthful end reason, reports ending-tick contact separately, and adds kernel-owned per-dash contact latches for one-shot bonks.
- **Grab latch + stamina exhaustion are internal.** The latch is the `canEngage` branch (`wall-grab-ability.ts:248-262`); exhaustion is `depleted <= 0` (`:238-241`), which silently sets `grabbing = false`. No pulse; consumers diff `abilities.wallGrab.grabbing` and `locomotion.stamina`.

### 5.2 Camera brain (`src/camera/*`) — already slide-capable
- `CameraBrain` exposes the composited `camera`/`zoom` plus independent live `bodyCamera`/`lensZoom` and a `blend` object `{ fromId, toId, elapsed, duration, fromCenter, fromZoom, fromPadding }` (`types.ts:151-173`).
- **Blend trigger = `activeId` change.** Switching the active vcam (explicit `options.activeId`, or a priority flip) starts a blend **from the currently rendered view** (`brain.ts:373-409`) — visual continuity is free; interrupting an in-flight blend re-seeds correctly.
- **Blend easing is smoothstep**, duration from the incoming vcam's `blend` (`DEFAULT_BRAIN_BLEND_DURATION = 0.3`, `constants.ts:68`) (`brain.ts:468-498`).
- **`fixed`-body vcams** converge to an explicit world-space `(x, y)` top-left via `converge` (`types.ts:110-117`, `brain.ts:436-442`), independent of any target. An animated presentation vcam = update its `x`/`y` per tick (or swap fixed vcams).
- **Priority selection** — highest `priority` wins each tick; `options.activeId` overrides even priority (`brain.ts:182-199`). A transient high-priority `fixed` vcam can therefore take over. Releasing it normally auto-blends; E3 clears selection/blend at the room-space handoff instead, because source/slide/destination camera coordinates use different origins.
- **Presentation-only.** The brain "consumes simulation state but produces presentation state only" (`brain.ts:24-25`) — a slide vcam cannot perturb the kernel.

### 5.3 What does NOT exist
- No structured feel channel; no `dashEnded`/`grabLatch`/`staminaExhausted` signals; no surfaced impact speed.
- No transition/slide/fit code anywhere in `src/`. The only seam-related token is the **reserved, unpopulated** `ResolvedPlatformerSpawn.source === 'seam-entry'` (`level-runtime.ts:110`), documented as "reserved for future room-transition spawn resolution" (`:81-82`). All actual transition code is consumer/showcase-side.

---

## 6. Workstream D2 — Semantic feel-events

### 6.1 Proposed shape (additive)
Add a new single-tick structured channel on `PlatformerState`, parallel to `state.events` (booleans) and `state.interactions` (spring/dashRefill). Names are proposed, subject to API review.

```ts
export type FeelMoment =
  | { readonly kind: 'landing';         readonly impactSpeed: number;     readonly normalizedImpact: number; readonly hard: boolean; readonly solidId: string | null }
  | { readonly kind: 'dashBonk';        readonly normalX: -1 | 0 | 1;     readonly normalY: -1 | 0 | 1;      readonly solidId: string | null }
  | { readonly kind: 'dashEnded';       readonly reason: 'timeout';       readonly terminalContact: 'none' | 'wall' | 'ceiling' | 'floor' }
  | { readonly kind: 'grabLatch';       readonly solidId: string | null }
  | { readonly kind: 'staminaExhausted' }
  | { readonly kind: 'springLaunch';    readonly solidId: string | null; readonly super: boolean }
  | { readonly kind: 'dashRefill';      readonly solidId: string | null };

export interface PlatformerState {
  // ...existing fields unchanged...
  /** Single-tick feel moments this tick (landing/dash-bonk/grab/stamina/spring/refill). Additive; presentation-only. */
  readonly moments: readonly FeelMoment[];
}
```

- **`impactSpeed = abs(preResolveVy)`; `normalizedImpact = clamp(impactSpeed / max(abs(config.maxFallSpeed), ε), 0, 1)`** — scale-invariant and correct under either gravity sign. `hard = normalizedImpact >= clamp(config.hardLandingThreshold ?? 0.72, 0, 1)`. The supporting `solidId` is `groundId` under positive gravity and `ceilingId` under negative gravity. This is the direct fix for ISSUES §4.2 (`prevVy > 520` was an unscaled 16 px-era magic number that never fired at 8 px). Add `hardLandingThreshold?: number` (ratio) to `PlatformerConfig`, classified `ratio` in the D1 unit table (unscaled).
- **`dashBonk`** emits once per blocked axis per dash. Its normal is the conventional outward surface normal: a wall on the actor's left/right gives `normalX = +1/-1`; a ceiling/floor gives `normalY = +1/-1`. `solidId` comes from the resolved contact. A per-dash X/Y contact latch prevents a pinned dash from retriggering hit-stop every tick; both latches reset when a new dash starts.
- **`dashEnded`** remains observation-only in this ship: the dash still ends on timeout, so `reason` is honestly `'timeout'`. `terminalContact` records the wall/ceiling/floor context on the ending tick without claiming that contact caused the end. Ending a dash early on contact is a separate, behaviour-changing follow-up that may widen `reason` under a later physics version.
- **`grabLatch`** fires on `WallGrabAbilityState.grabbing: false → true`; **`staminaExhausted`** on the `depleted <= 0` branch.
- **`springLaunch`/`dashRefill`** supersede (and initially parallel) the `interactions` array, adding the `super` flag for super-springs and a uniform `solidId`.

### 6.2 Why a new channel, not re-typed booleans
Changing `justLanded: boolean` → `justLanded: LandingEvent | null` would break every reader of that field. A parallel `moments` array mirrors the existing channel pattern (`interactions` was added alongside `events`) and leaves existing boolean behaviour unchanged. It does widen the required `PlatformerState` shape: consumers that manually construct a complete state add `moments: []`, while engine factories, level compilation, replay fallbacks, and every kernel step populate it automatically. The booleans stay the canonical "did this happen" pulse; `moments` adds the "with what intensity/on what surface." Deprecation of `interactions` (in favour of the `springLaunch`/`dashRefill` moments) is a later, signposted step.

### 6.3 Implementation notes
- **Impact speed (cheap):** capture `abs(core.vy)` before the Y resolver zeroes it (`kernel.ts:~934`). Emit only on the existing unsupported→supported transition, and choose the support id from the gravity-facing side. One local variable; no behavioural change to the sim.
- **Bonk id + normal:** the `findWallSolidId`/`findCeilingSolidId`/`findGroundSolidId` results are already computed. Add two optional observational booleans to `DashAbilityState` (`bonkedX?`, `bonkedY?`, absent means `false`), populate/reset them on dash start, and let the kernel set them after collision resolution. Emit only on each latch's false→true transition. This is replay-state plumbing, not a velocity/trajectory change, and optional input fields avoid another manual-constructor migration.
- **`dashEnded` terminal context:** compare the pre-pipeline and post-pipeline dash phases to find `active → idle`, then inspect that tick's resolved contacts. Always emit `reason: 'timeout'` in this release; fill `terminalContact` from the dominant resolved contact or `'none'`. (`reason` is intentionally a single literal now for API stability; a later versioned change that ends dashes on contact widens it to `'timeout' | 'wall' | 'ceiling' | 'floor'`.)
- **Ability contribution:** extend `AbilityResult` with optional `moments?: readonly FeelMoment[]`; the kernel appends those in pipeline order before adding collision/environment moments. This is how wall-grab contributes without overloading the boolean event record.
- **Grab/stamina (cheap):** the `canEngage` and `depleted <= 0` branches already exist; emit the moment there. `probeWall` already returns `Solid | null` (`src/collision/aabb.ts`) and needs no change — the work is at the call site (don't `!== null`-reduce it) plus a new `solidId` on `WallGrabAbilityState`, so `grabLatch.solidId` is available. Exhaustion is the strict `staminaCur > 0 && depleted <= 0` crossing.
- **Spring power:** preserve the compiled spring semantic on the trigger marker (for example `spring: { launch, super }`) instead of reverse-inferring `super` from a velocity equality. Hand-rolled springs default to `super: false` when the marker is absent.
- **Purity/determinism:** `moments` is derived purely from the same inputs the kernel already consumes; it does not alter `core`/`abilities`/`locomotion`. It is included in the simulation's replay determinism (same inputs ⇒ same moments).

### 6.4 Tests (Layer 2, deterministic simulation)
- **Feel-invariance (the headline):** drop the player from `N` tiles at tile sizes 8/16/32 (config via `scalePlatformerConfig`); assert `normalizedImpact` is equal across tile sizes (within ε) and `hard` agrees. Repeat under negative gravity and assert the landing uses the ceiling id with the same positive magnitude. Assert the old `prevVy`-threshold approach would *not* be invariant (document the contrast).
- **dashBonk:** horizontal dash into a tall right wall ⇒ `normalX = -1`, correct `solidId` (`=== solidIdForEntity(id)`); upward dash into a ceiling ⇒ `normalY = +1` (the ISSUES §4.4 case). Hold the dash pinned for multiple ticks and assert exactly one moment for that axis; start another dash and assert the latch resets.
- **dashEnded:** open space emits `{ reason: 'timeout', terminalContact: 'none' }`; timeout while pinned to each surface emits the matching `terminalContact` without changing dash duration or velocity traces.
- **grab/stamina:** `grabLatch` fires exactly once on engage (not while held); `staminaExhausted` fires once on the `>0 → 0` crossing while grabbing, not on every depleted tick.
- **springLaunch/dashRefill:** `solidId === solidIdForEntity(entityId)`; `super` true only for `SuperSpring`.
- **Back-compat:** the 9 booleans still fire on the same ticks; `state.interactions` unchanged.

---

## 7. Workstream E — Room transitions, slide, and camera fit

### 7.1 E1 — Separate simulation transition from presentation transition (the contract)
Define and document the split so the two concerns don't get conflated (the root cause of the camera pops and rebase bugs in BUILD_NOTES §10).

- **Simulation transition** owns: detecting an eligible cardinal seam crossing; resolving the LDtk `__neighbour`; converting the actor through world coordinates into **destination-local** coordinates; preserving `vx`/`vy`/`facing`/abilities/locomotion; clearing or revalidating room-specific support; clearing per-tick output channels; and returning checkpoint provenance (`source: 'seam-entry'`) alongside the next state.
- **Presentation transition** owns: a temporary normalized two-room coordinate space; the camera path + easing; the render-only player correction at the coordinate-space switch; rendering both rooms during the overlap; rebasing existing room-local particles; explicitly rebasing the camera brain into and out of slide space; and clearing safely on death/retry/teleport/reversal.

### 7.2 E2 — Pure transition helpers (`src/platformer/room-transitions.ts`, new)
Canvas-free, fully unit-testable. Build on `createLdtkRoomCache`/`CompiledLdtkRoom` (0.7.0) and the LDtk `__neighbours` graph.

```ts
export type Cardinal = 'n' | 's' | 'e' | 'w';

export interface LdtkRoomExit {
  readonly dir: Cardinal;
  readonly neighbourLevelIid: string;
  /** Inclusive world-space span of the shared seam on its perpendicular axis. */
  readonly seamMin: number;
  readonly seamMax: number;
}

/** Which linked shared seam (if any) the body's AABB has crossed out of `level`. */
export function findLdtkRoomExit(body: Rect, level: LdtkLevel, project: LdtkProject): LdtkRoomExit | undefined;

export interface LdtkRoomEntry { readonly x: number; readonly y: number; readonly dir: Cardinal; readonly toLevelIid: string }

/** Where the actor enters the destination room, in destination-local coordinates (momentum-preserving seam point). */
export function mapLdtkRoomEntry(body: Rect, from: LdtkLevel, to: LdtkLevel, exit: LdtkRoomExit): LdtkRoomEntry;

export interface TransitionPlatformerToRoomOptions {
  /** Optional destination collision set used only to revalidate exact support; never used to settle/reposition. */
  readonly destinationSolids?: readonly Solid[];
  readonly config?: Readonly<PlatformerConfig>;
}

export interface PlatformerRoomTransition {
  readonly state: PlatformerState;
  readonly spawn: ResolvedPlatformerSpawn;
}

/** Produce the post-transition state + seam provenance. Pure; never settles/repositions beyond `entry`. */
export function transitionPlatformerToRoom(
  state: PlatformerState,
  entry: LdtkRoomEntry,
  options?: TransitionPlatformerToRoomOptions,
): PlatformerRoomTransition;

/** Rebase a world point from source-room-local into destination-room-local across a seam (for particle/dust continuity). */
export function rebasePointBetweenLdtkRooms(point: { readonly x: number; readonly y: number }, from: LdtkLevel, to: LdtkLevel): { x: number; y: number };
```

`findLdtkRoomExit` considers only cardinal neighbours that exist in the project and whose world-space rectangles share a non-empty seam. Crossing the nominal east/west edge outside the neighbour's shared Y span (or north/south outside the shared X span) is void, not a transition. When two eligible seams are crossed at a corner, choose the greatest normalized penetration; stable ties use `n → e → s → w`.

`mapLdtkRoomEntry` does not clamp. It preserves the actor top-left exactly through world space:

```
to.worldX + entry.x === from.worldX + body.x
to.worldY + entry.y === from.worldY + body.y
```

`transitionPlatformerToRoom` returns `{ state, spawn }`, because spawn provenance belongs to `ResolvedPlatformerSpawn`/compiled-room metadata rather than `PlatformerState`. `spawn` is `{ x: entry.x, y: entry.y, source: 'seam-entry' }`. The state uses its existing `core.width`/`core.height`; no redundant player-dimension arguments are needed. It preserves momentum/facing/ability/locomotion slices, clears `events`/`interactions`/`moments`, and handles support as follows:

- With `destinationSolids`, revalidate exact gravity-facing support at the mapped position without moving the actor; populate `onGround` and the destination contact id from that probe. Gravity direction comes from `options.config ?? DEFAULT_PLATFORMER_CONFIG`.
- Without `destinationSolids`, conservatively set `onGround: false` and clear all contacts. The next destination tick re-establishes support.
- Never call `settlePlatformerState` for a seam entry; settling would destroy valid mid-air momentum.

**Tests:** all four cardinal directions; partial-overlap seams (rooms of differing height/offset); a crossing inside the shared span transitions while one outside it returns `undefined`; corner exits use normalized penetration + the stable tie order; missing neighbour/diagonal-only neighbour ⇒ `undefined`; forward mapping and rapid reversal satisfy both world-position identities above; `vx`/`vy`/`facing` and ability/locomotion slices are preserved; output channels are empty; support is conservatively cleared without solids and exactly revalidated with destination solids; `spawn.source === 'seam-entry'`.

### 7.3 E3 — Supported slide presentation (`src/platformer/room-slide.ts`, new)
**Composes the existing camera brain — no new camera solver.** The orchestrator drives a transient high-priority `fixed` vcam in a normalized two-room coordinate space. Entry and exit helpers translate the brain's plain state between source-local, slide-space, and destination-local coordinates; selection is reset at each boundary so the brain does not stack its default blend on top of the named slide curve.

```ts
export interface RoomSlideView {
  /** Camera top-left in that room's local coordinates. */
  readonly camera: Readonly<Camera>;
  readonly zoom: number;
}

export interface RoomSlideActorMapping {
  readonly sourceLocal: Readonly<{ x: number; y: number }>;
  readonly destinationLocal: Readonly<{ x: number; y: number }>;
}

export interface RoomSlideOptions {
  readonly duration?: number;                 // default 0.30 s
  readonly easing?: (t: number) => number;    // default exported roomSlideEase; captured in state
  readonly freezeSimulation?: boolean;        // default false
  /** Explicit defensive-adapter input; beginRoomSlide never reads window/matchMedia. */
  readonly reducedMotion?: boolean;           // default false
}

export interface RoomSlideSpace {
  /** Union bounds after subtracting the min world X/Y, so the brain's zero-origin clamp remains valid. */
  readonly bounds: CameraBounds;
  readonly sourceOffset: Readonly<{ x: number; y: number }>;
  readonly destinationOffset: Readonly<{ x: number; y: number }>;
}

export interface RoomSlideState {
  readonly active: boolean;
  readonly elapsed: number;
  readonly duration: number;
  readonly t: number;
  readonly sourceLevelIid: string;
  readonly destLevelIid: string;
  readonly easing: (t: number) => number;
  readonly freezeSimulation: boolean;
  readonly space: RoomSlideSpace;
  readonly sourceView: RoomSlideView;
  readonly destinationView: RoomSlideView;
  /** Dest-player render correction at t=0; presentation eases this to zero. */
  readonly initialPlayerOffset: Readonly<{ x: number; y: number }>;
  /** Add once to source-local particles to express them in destination-local coordinates. */
  readonly particleRebaseDelta: Readonly<{ x: number; y: number }>;
}

export interface RoomSlidePresentation {
  readonly vcam: VirtualCamera | null;
  readonly bounds: CameraBounds;
  readonly sourceOffset: Readonly<{ x: number; y: number }>;
  readonly destinationOffset: Readonly<{ x: number; y: number }>;
  readonly playerOffset: Readonly<{ x: number; y: number }>;
  readonly freezeSimulation: boolean;
}

/** Build the slide clock, coordinate space, endpoints, and correction deltas. Pure. */
export function beginRoomSlide(
  source: CompiledLdtkRoom,
  dest: CompiledLdtkRoom,
  viewport: { readonly width: number; readonly height: number },
  views: { readonly source: RoomSlideView; readonly destination: RoomSlideView },
  actor: RoomSlideActorMapping,
  options?: RoomSlideOptions,
): RoomSlideState;
/** Advance the slide clock by dt. Pure. */
export function advanceRoomSlide(slide: RoomSlideState, dt: number): RoomSlideState;
/** Vcam + bounds + render offsets for this tick. Pure. */
export function presentationForRoomSlide(slide: RoomSlideState): RoomSlidePresentation;
/** Rebase source-local brain state into normalized slide space and clear active selection/blend. Call once. Pure. */
export function enterRoomSlideCameraSpace(slide: RoomSlideState, brain: CameraBrain): CameraBrain;
/** Rebase slide-space brain state into destination-local space and clear active selection/blend. Call once. Pure. */
export function finishRoomSlideCameraSpace(slide: RoomSlideState, brain: CameraBrain): CameraBrain;
/** Abort/reverse and rebase slide-space brain state into either endpoint room's local space. Pure. */
export function cancelRoomSlideCameraSpace(
  slide: RoomSlideState,
  brain: CameraBrain,
  returnTo: 'source' | 'destination',
): CameraBrain;
```

Behavioural policy (stated, so every builder implements the same thing — this is what G5 put in the brief as "policy"; E3 makes it a helper):
- Duration defaults to 0.30 s; easing is a **named, exported** curve (`roomSlideEase`). `duration`, `easing`, and `freezeSimulation` are captured in `RoomSlideState`, so `advanceRoomSlide(slide, dt)` has everything required to finish deterministically.
- The caller supplies exact endpoint views because the current brain advances only the selected vcam; there is no independently live inactive destination solver to sample. `views.source` is normally the current rendered `brain.camera`/`brain.zoom`; `views.destination` is the seam-aligned destination-local view, commonly using `fitCameraZoom` for its lens policy.
- `RoomSlideSpace` is the source/destination world-rectangle union shifted by its minimum world X/Y. Both offsets are therefore non-negative and `space.bounds` is valid for the camera brain's zero-origin clamp, including LDtk projects whose authored `worldX`/`worldY` are negative.
- The transient vcam is the sole slide-path authority: a reserved id/priority, `blend: 0`, and body/lens motion with `snapThreshold: Number.MAX_VALUE` (positive `dt` therefore publishes each finite target exactly). Its body/lens targets are the eased interpolation of the two captured views after adding their room offsets. This prevents default brain blending or body/lens damping from applying a second curve.
- **Both rooms render during the slide** using `presentation.sourceOffset` / `destinationOffset` as `drawLdtkLevel(..., { worldOffset })` inputs.
- **Player screen position is continuous at slide start.** `initialPlayerOffset = sourceOffset + sourceLocal - (destinationOffset + destinationLocal)`; `presentation.playerOffset` eases that correction to zero over the slide.
- **Particles rebase once** when the slide begins by adding `particleRebaseDelta = { x: source.worldX - dest.worldX, y: source.worldY - dest.worldY }` (equivalent to `rebasePointBetweenLdtkRooms`). Rendering the rebased destination-local particles at `destinationOffset` preserves their slide-space position exactly.
- **Input/sim continue** unless `freezeSimulation` is requested.
- **Reduced motion is explicit:** the consumer passes `reducedMotion: prefersReducedMotion()`. The pure core never reads host state. `true` returns `active: false, t: 1`; enter + finish camera-space rebases run in the same presentation frame, yielding an immediate destination-local cut with no brain blend.
- **Handoff is explicit, not auto-blended:** `enterRoomSlideCameraSpace` adds `sourceOffset` to `camera`, `bodyCamera`, and any frozen blend centre, then clears `activeId`/`blend`. `finishRoomSlideCameraSpace` subtracts `destinationOffset` and clears selection/blend again. The next destination vcam activation is therefore a first activation (no incoming brain blend), seeded from the exact final rendered view; its ordinary follow solver may continue smoothly from there.
- **Cancellation/reversal is defined:** `cancelRoomSlideCameraSpace(..., returnTo)` subtracts the chosen endpoint offset and clears selection/blend. Death/retry/teleport chooses the room the simulation will resume in; rapid reversal first cancels to the current simulation room, then begins the reverse slide from that local camera state. No slide-space brain may leak into ordinary room rendering.
- The slide and brain rebase are presentation-only and never feed camera output back into the kernel (brain.ts:24-25).

### 7.4 E4 — Camera-fit helper (`src/camera/fit.ts`, new)
Replaces the repeated `Math.min`/`Math.max` `fitZoom` with an explicit, tested policy.

```ts
export type CameraFitMode = 'contain' | 'cover' | 'native';
export interface FitCameraZoomOptions {
  readonly mode?: CameraFitMode;     // default 'cover' (Celeste compact rooms — no side gaps)
  readonly minZoom?: number;
  readonly maxZoom?: number;
  readonly integerScale?: boolean;   // quantise to an integer factor when feasible
}
export function fitCameraZoom(
  level: { readonly width: number; readonly height: number } | CompiledLdtkRoom,
  viewport: { readonly width: number; readonly height: number },
  options?: FitCameraZoomOptions,
): number;
```

`cover` ⇒ `max(zx, zy)` (BUILD_NOTES §8 — the one-line flip from `min`); `contain` ⇒ `min` (letterbox); `native` ⇒ `1`. Invalid/non-positive dimensions return `1`. With `integerScale`, a raw zoom `>= 1` rounds **up** for `cover` and **down** (minimum `1`) for `contain`; a sub-unit raw zoom is left fractional because no positive integer preserves that fit. Apply validated `minZoom`/`maxZoom` last and document that an explicit clamp may override the geometric cover/contain guarantee. Document the chosen policy in the Celerock brief (`cover` for the supplied fixture).

---

## 8. Delivery batches & dependency order

Three items are mutually independent and file-disjoint ⇒ one parallel wave; E3 depends on E2.

```
D2  (kernel feel channel) ──────────────────────> feel-invariance tests
E2  (pure transition helpers) ──────> E3 (slide orchestrator) ──> render-geometry + integration tests
camera brain (already shipped) ─────> E3
E4  (fitCameraZoom) ───────────────────────────────────────────> fit-policy tests + destination-view setup
all stable APIs ────────────────────────────────> brief updates + fixture-backed integration tests + version bumps
```

- **Batch 1 (parallel):** D2 (`src/platformer/feel-moments.ts` + kernel plumbing), E2 (`src/platformer/room-transitions.ts`), E4 (`src/camera/fit.ts`). Each implementer → harsh-critic loop (the same discipline as the `0.7.0` work); file-disjoint, barrels wired centrally afterward.
- **Batch 2:** E3 (`src/platformer/room-slide.ts`), sequenced after E2 (it uses the same room-rebase identities) and composing the camera brain through explicit state-space rebase helpers.
- **Batch 3:** use the existing adversarial fixture (`src/tests/fixtures/celerock-adversarial.ldtk`), which already has two cardinally-linked unequal-height rooms, a partial seam, and horizontal/vertical dash-bonk geometry. Add integration tests for: inside-span transition vs outside-span void; both rooms covering the slide viewport; normalized union bounds; particle world-position identity; player screen-position continuity at `t = 0`; exact named camera path without stacked damping/blends; destination-local camera identity at handoff; cancellation to either endpoint; rapid reversal; and documented `cover`/`contain` crops. Change the fixture only if a test proves an additional geometry case cannot be expressed with its existing rooms.
- **Batch 4:** brief + compatibility sync — point `games/celerock.md` at the new APIs (`state.moments`, `findLdtkRoomExit`/`transitionPlatformerToRoom`/`beginRoomSlide`, `fitCameraZoom`), retire the "policy only" wording in §5.4/§5.5 now that they're supported APIs, bump `CURRENT_PHYSICS_VERSION` from 10 to 11 with replay-hash canary updates, and bump the package to the next pre-1 minor.

Every batch runs the full gate already established in `0.7.0`: `npm test`, `npm run build:dist`, `npm run release:smoke`, `npm run check:level-visual-size`, CI on Node 24.

---

## 9. Migration & compatibility
- **Existing fields retain their types and behaviour.** New `feel-moments`/`room-transitions`/`room-slide`/`fit` modules and `fitCameraZoom` are additive exports. `hardLandingThreshold?: number` is an optional ratio on `PlatformerConfig` (classified `ratio`, unscaled — extend the compile-gated exhaustive `PLATFORMER_CONFIG_FIELD_UNITS` table).
- **`PlatformerState` shape migration:** `moments` is required so engine outputs have a uniform, null-free channel. Engine factories, compiled levels, replay fallbacks, and kernel results populate it. A consumer that manually constructs a complete `PlatformerState` must add `moments: []`. This is a source-visible interface widening even though existing runtime readers and trajectories remain valid.
- **Replay identity:** `canonicalize` (`src/level/serialize.ts`) hashes `PlatformerState` comprehensively over every field — `events`/`interactions` are already in the hash — so adding a populated `moments` (and the dash contact latches) genuinely shifts `replayHash`, not just defensively. Bump `CURRENT_PHYSICS_VERSION` 10 → 11 (defined in `src/replay/constants.ts:127`; carried on `ReplayConfig`, not `PlatformerState`), update the version history and replay-hash canaries, and reject v10 replays under the existing version guard (`assertPhysicsVersion`, `src/replay/player.ts`). Deterministic physics traces should remain unchanged because the new fields do not feed velocity/position.
- **`'seam-entry'`** gains a producer in `PlatformerRoomTransition.spawn`; the literal was already in the `0.7.0` union. It is deliberately not added to `PlatformerState`.
- **Booleans + `interactions` retained.** `interactions` is candidate for future deprecation (the `springLaunch`/`dashRefill` moments supersede it); signal in JSDoc, remove in a later major.
- **Camera solver untouched.** E3 does not change `updateCameraBrain`/blend/priority/convergence semantics. Its enter/finish/cancel helpers return rebased plain `CameraBrain` records and deliberately clear selection/blend at coordinate-space boundaries.
- **Version:** next pre-1 minor (e.g. `0.8.0`). Release notes must call out the required `PlatformerState.moments` constructor migration and physics-version bump rather than claiming the release is source-compatible everywhere.

## 10. Risks & mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| New state fields shift replay hashes while v10 remains accepted | Cross-version replay ambiguity | Bump `CURRENT_PHYSICS_VERSION` to 11, update hash canaries, and assert v10 rejection + v11 deterministic playback |
| `dashBonk` retriggers while pinned | Repeated hit-stop/SFX | Per-dash X/Y latches; exactly-once pinned-contact test; reset latches on each new dash |
| `dashEnded` contact is mistaken for cause | Mis-attributed analytics/SFX | Keep `reason: 'timeout'` in this release and report contact separately as `terminalContact`; contact-ending behaviour requires a later versioned change |
| Slide composes the brain incorrectly (stacked blend/damping or wrong bounds) | Jitter/pop/path drift | `blend: 0`, exact-snap body/lens, normalized union bounds, explicit enter/finish/cancel rebases, and adjacent-frame/path-identity tests |
| Cancel/reversal leaks slide-space camera coordinates | Full-room camera jump | Rebase to the selected endpoint before ordinary rendering or starting the reverse slide; test both endpoints and an interrupted reversal |
| Reduced-motion cut still auto-blends | Accessibility regression | Pass reduced motion explicitly; enter + finish camera-space rebases in one frame; clear active selection/blend before destination activation |
| `transitionPlatformerToRoom` settles mid-air entries | Lost momentum | Never settle seam-entry states (matches C3); test that an airborne entry preserves `vy` |
| Edge crossing outside a partial seam enters the neighbour | Teleport into void | Gate exits by the shared world-space seam span; fixture test covers inside-span transition and outside-span void |
| `fitCameraZoom` `integerScale` claim overfits | Crisp-pixel regression | Document that `integerScale` is best-effort; the fixture's `cover` policy is the acceptance, not integer scaling |
| Feel thresholds still tile-dependent | Feel drift returns | `normalizedImpact` is a ratio by construction; the feel-invariance test is the gate |

## 11. Definition of done
- [ ] `state.moments` carries landing/dashBonk/dashEnded/grabLatch/staminaExhausted/springLaunch/dashRefill with correct payloads; the 9 booleans + `interactions` remain behaviourally unchanged.
- [ ] `normalizedImpact` is equal at 8/16/32 px for the same drop under positive and negative gravity; `hard` agrees and the gravity-facing support id is correct.
- [ ] Horizontal **and** vertical dash-into-wall emit exactly one `dashBonk` per blocked axis per dash with conventional outward normal + correct `solidId`; a new dash resets the latches.
- [ ] `dashEnded.reason` is truthfully `'timeout'`; `terminalContact` reports only ending-tick context and the existing dash duration/velocity traces do not change.
- [ ] `findLdtkRoomExit`/`mapLdtkRoomEntry`/`transitionPlatformerToRoom`/`rebasePointBetweenLdtkRooms` are pure, pass the four-direction + inside/outside partial-seam + reversal + corner + missing-neighbour matrix, return `spawn.source === 'seam-entry'`, clear per-tick channels, and clear/revalidate support per the options contract.
- [ ] `beginRoomSlide`/`advanceRoomSlide`/`presentationForRoomSlide` plus the enter/finish/cancel camera-space helpers compose the existing brain with one authoritative curve, normalized union bounds, no stacked blend/damping, destination-local handoff identity, both-room rendering, player continuity at `t = 0`, particle rebase, a one-frame reduced-motion cut, and safe cancellation/reversal to either endpoint.
- [ ] `fitCameraZoom` implements `cover`/`contain`/`native`; the adversarial fixture's compact rooms produce no side gaps under `cover`.
- [ ] `games/celerock.md` references the new APIs (no drift) and retires the policy-only wording.
- [ ] `CURRENT_PHYSICS_VERSION === 11`; v10 replay rejection, v11 deterministic playback, replay-hash canaries, and manual-state migration coverage are green.
- [ ] Full release gate green (`npm test`, `build:dist`, `release:smoke`, size, CI Node 24); a fresh `npm install aicraft-engine@next` imports with the new exports present.

## 12. Traceability
| Observed issue | This plan |
|---|---|
| Unscaled hard-land threshold `prevVy > 520` (ISSUES §4.2) | D2 `landing.normalizedImpact` (ratio) |
| Vertical dash bonk missing (ISSUES §4.4) | D2 `dashBonk { normalX, normalY }` |
| Stamina-out SFX silent (ISSUES §5.2) | D2 `staminaExhausted` pulse |
| Grab latch undetectable | D2 `grabLatch` pulse |
| Camera pops on room transition (ISSUES §4.6) | E1 split + E3 normalized slide space + explicit brain rebase/handoff |
| Side gaps / contain-vs-cover (BUILD_NOTES §8) | E4 `fitCameraZoom { mode: 'cover' }` |
| Hand-rolled slide + rebase pitfalls (BUILD_NOTES §10) | E2 pure helpers + E3 orchestrator |
| Transition-continuity tests measured wrong windows (BUILD_NOTES §11) | E2/E3 tests compare adjacent frames at the switch + world-position identities |
| Reserved `'seam-entry'` unpopulated (`0.7.0`) | E2 `transitionPlatformerToRoom` returns it in `PlatformerRoomTransition.spawn` |
