# Platformer Wall Mantle and Direction-Aware Climb-Jump Plan

**Status:** Implemented (physics version 12 — see `src/platformer/mantle.ts`, `src/platformer/abilities/wall-grab-ability.ts`, and the mantle/climb-jump tests in `src/tests/platformer-wall-grab.test.ts` + `src/tests/platformer-traces.test.ts` scenarios 8–11). The `wallJumpLaunched` widening (§3.3/§5 review finding 1) was accepted and documented. The optional `climbJumpLaunched`/`mantled` feel-moment twins were NOT added — the boolean pulses are sufficient (§4.3's decision point, resolved as "booleans only").  
**Scope:** Add ledge mantling and direction-aware grab+jump behavior to the reusable `src/platformer/` engine  
**Baseline:** `aicraft-engine@0.8.1`, including the shipped `PlatformerState.moments` channel<br>
**Primary implementation seam:** `src/platformer/abilities/wall-grab-ability.ts`  
**Consumer target:** Celerock and any other `stepPlatformer` caller with `wallGrabEnabled: true`

## 1. Executive summary

The requested behaviors belong in the engine, but the supplied proposal places them in Celerock-owned files (`src/game/step.ts`, `state.ts`, `audio.ts`, and `effects.ts`) that do not exist in this repository. Implementing them as pre/post-`stepPlatformer` patches would also split ownership of wall-grab state, stamina, launch arbitration, replay determinism, and collision safety between the engine and each consumer.

The engine should instead extend its existing `wallGrabAbility` state machine:

- Holding grab + Up near the top of a clear wall performs a mantle.
- The mantle is a continuous, multi-tick assisted hop: the engine never assigns
  a ledge destination directly to `core.x` or `core.y`.
- Pressing jump while grabbing and holding Away keeps the existing up-and-away climb-hop behavior and reports it as a wall jump.
- Pressing jump while neutral or holding Toward launches straight up, keeps the actor facing the wall, and temporarily prevents re-grabbing.
- Dash retains priority over both behaviors, and jump retains priority over mantle.
- Consumers receive semantic event pulses and remain responsible for audio, particles, and animation.

This is a trajectory-changing engine update. It requires config scaling, serialized ability-state changes, public event changes, replay physics-version migration, deterministic tests, and Celerock documentation updates—not only a new geometry helper.

## 2. Review of the supplied plan

| Supplied decision | Audit result | Engine plan |
|---|---|---|
| Patch the result after `stepPlatformer` | Wrong ownership layer | Implement both transitions inside `wallGrabAbility`; return one authoritative `PlatformerState` |
| Store lockouts on a consumer `World` | Duplicates engine state and weakens replay guarantees | Store one private `regrabTimer` on `WallGrabAbilityState` |
| Suppress `grab.held` in a copied input | Alters input semantics outside the owning ability | Keep the original input unchanged; gate only wall-grab re-engagement while `regrabTimer > 0` |
| Use a 12-tick mantle lockout | Ties behavior to 60 Hz | Use config durations in seconds and decay by `dt` |
| Shift by `max(actorWidth / 2, wallWidth / 2)` | Unsafe for wide merged tile solids and visibly teleports the actor | Use an edge-anchored landing point only as a route/finish marker; reach it through velocity and collision resolution |
| Relocate directly to a validated target | Still a teleport even if a 1 px sweep proves the route is clear | Start a ballistic hop and apply a short horizontal assist over subsequent ticks; never write mantle positions directly |
| Check only the destination AABB | Can miss a ceiling or overhang along the intended route | Preflight a conservative clearance corridor, then keep normal collision resolution authoritative on every live tick |
| Add `MANTLE_HOP_VY` as a local constant | Conflicts with engine tuning/scaling conventions and is too weak to lift a full actor body without a position snap | Add scale-aware horizontal/minimum-vertical hop tuning and derive the geometry-safe vertical impulse |
| Call game audio and particle functions from the mechanic | Couples deterministic physics to presentation | Emit engine events; map them to audio/particles in Celerock |
| Use `grab.side` | The side is not on the input edge | Read `WallGrabAbilityState.side` |
| Read/write a consumer stamina field | The engine already owns stamina | Continue using `LocomotionState.stamina` and `locomotionPatch` |
| Add a server-side consumer render harness to this repository | No such consumer harness exists here; engine conventions defer visual QA to consumers | Use Vitest trajectory/geometry tests here and add a Celerock manual/render check after the engine lands |

The proposal's behavior, input directions, precedence, stamina cost, seeded presentation requirement, and edge-case list are otherwise sound.

## 3. Required behavior contract

### 3.1 Direction definitions

Use the latched wall side, not current horizontal velocity:

```ts
const wallDirection = side === 'right' ? 1 : -1;
const away = side === 'right' ? input.moveX < 0 : input.moveX > 0;
```

Any nonzero analog value with the correct sign counts as directional intent, matching the kernel's existing sign-based analog contract. Neutral (`moveX === 0`) and Toward both select the straight-up climb-jump.

### 3.2 Precedence

Evaluate an already-grabbing tick in this order:

1. Grab released, wall lost, ladder overlap, or dash pressed: release; the existing dash/ladder owner takes over.
2. Jump pressed: perform the direction-aware grab+jump.
3. Mantle conditions satisfied: perform the mantle.
4. Otherwise continue cling/climb and drain stamina as today.

This makes dash beat grab+jump and mantle, and makes jump beat mantle. Do not derive precedence from a consumer post-step patch.

### 3.3 Direction-aware grab+jump

When `jump.pressed` while actively grabbing:

- **Away**
  - End the grab.
  - Keep the existing `climbHopVy`, `climbHopVx`, and `climbHopForceTime` trajectory.
  - Face away from the wall.
  - Emit a `LaunchIntent` with the existing `source: 'climbHop'`.
  - `wallJumpLaunched` today fires ONLY for `wallJump`/`superWallJump` (kernel launch handling clears it and sets it for those two sources alone; `climbHop` emits no pulse). To deliver "reports it as a wall jump" (§1), this change must EXPLICITLY add `climbHop` to that condition — a deliberate widening of an existing event's meaning that consumers already reading `wallJumpLaunched` will observe. If that is unacceptable, document Away as pulse-less instead; do not assume the kernel already emits it.
  - Do not arm the new re-grab timer; the existing forced horizontal interval supplies separation.

- **Neutral or Toward**
  - End the grab.
  - Set horizontal launch velocity to `0` and vertical velocity to `-config.climbHopVy`.
  - Face the grabbed wall (`right` -> `1`, `left` -> `-1`).
  - Emit a new `LaunchIntent` source, `'climbJump'`, at the same arbitration priority as `climbHop`/`wallJump`.
  - Open no `forceMoveX` interval and explicitly resolve its direction/timer to zero in launch arbitration.
  - Arm `WallGrabAbilityState.regrabTimer = config.climbJumpRegrabLockTime`.
  - Emit `events.climbJumpLaunched = true` only if this launch wins arbitration.

Both branches retain the existing fixed-height jump (`varJumpTime: 0`), jump-slice reset, and flat `staminaClimbJumpCost` deduction.

### 3.4 Mantle eligibility

A mantle is eligible only when all of the following are true on an already-grabbing tick:

- `config.mantleEnabled`
- grab is still held
- `input.moveY === -1`
- jump is not pressed
- dash is not pressed and the prior locomotion slice is not dashing
- `locomotion.stamina > 0`
- `regrabTimer <= 0`
- a blocking wall remains on the latched side within `wallProbeDistance`
- the actor's head is at the wall top threshold
- the conservative hop corridor and landing foothold are clear

Use the existing pre-emptive threshold:

```ts
const reach = config.wallClimbUpSpeed * dt + config.climbUpCheckDist + 0.5;
const atTop = core.y <= wall.y + reach;
```

The wall query already excludes passthroughs, ladders, springs, and dash-refill trigger volumes. Preserve those exclusions in all mantle clearance queries.

### 3.5 Mantle route and the no-teleport invariant

Add a pure internal helper in `src/platformer/mantle.ts`, for example
`findMantleRoute(...)`, and call it from `wallGrabAbility`. The helper computes
feasibility and launch metadata only. It must never return a replacement core or
apply a position.

The load-bearing invariant is:

> Mantle code never writes `core.x` or `core.y`. Only the kernel's ordinary
> velocity integration and `resolveAxisX`/`resolveAxisY` collision pass may
> change actor position.

Use an edge-anchored landing point as a finish marker, not a teleport target:

```ts
const inset = Math.min(
  Math.max(0, config.mantleLandingInset),
  core.width,
  wall.width,
);

const landingY = wall.y - core.height;
const landingX = side === 'right'
  ? wall.x - core.width + inset
  : wall.x + wall.width - inset;
```

This marker asks for only a stable foothold. It never scales movement with the
full width of a merged room/floor solid.

The hop must raise the actor's whole body past the wall top before horizontal
motion can cross the wall. A `mantleHopVy` of `120` only works after a position
snap; at the default jump gravity its continuous apex is roughly 6 px, far less
than the default 24 px body height. Derive a geometry-safe launch magnitude:

```ts
const gravity = (2 * config.jump.apexHeight) /
  (config.jump.timeToApex * config.jump.timeToApex);
const requiredRise = Math.max(0, core.y + core.height - wall.y) +
  config.mantleApexClearance;
const clearanceVy = Math.sqrt(2 * gravity * requiredRise) + gravity * dt;
const launchVy = -Math.max(config.mantleHopVy, clearanceVy);
```

The `gravity * dt` term is a fixed-step integration guard: semi-implicit Euler
applies gravity before position, so the continuous closed-form minimum alone can
fall short by a frame. Invalid/non-finite geometry returns `null` instead of
launching.

Before starting, conservatively validate:

1. The vertical body sweep beside the wall from the current Y to the predicted
   apex.
2. The above-ledge transition corridor between the apex and `landingY`, from
   the current X to `landingX`.
3. The landing AABB at the finish marker.

Sample at deterministic increments no larger than 1 world pixel against every
blocking solid. Edges that merely touch remain clear, consistent with
`aabbOverlap`. Ignore passthrough, ladder, spring, and dash-refill solids. A
conservative false negative is acceptable; tunnelling or a position snap is
not. Normal live collision resolution remains authoritative after launch, so
changed/moving geometry still blocks the actor naturally.

Return metadata such as `{ side, wallTopY, landingX, launchVy, solidId }`. No
returned coordinate is ever copied into actor position.

### 3.6 Continuous assisted-hop transition

On a valid mantle start:

- Leave `core.x` and `core.y` unchanged.
- End the grab and clear its grab side/solid id.
- Deduct `staminaClimbJumpCost`, floored at zero.
- Store an active mantle-assist state with the side, wall top, `landingX`, wall
  id, and `assistTimer = config.mantleAssistTime`.
- Arm `regrabTimer` for at least the assist interval.
- Emit a new `LaunchIntent` source, `'mantle'`, with
  `vx = wallDirection * config.mantleHopVx`, the derived negative `launchVy`,
  and `varJumpTime: 0`.
- Give `'mantle'` the same arbitration priority as the
  wall-jump/climb-jump family.
- Reset the jump slice to rising when the mantle launch wins, but do not report
  it as a normal jump.
- Emit `events.mantled = true` only when the mantle launch wins.

While the assist is active, `wallGrabAbility` re-applies the configured
horizontal velocity toward the ledge on each tick but preserves `vy`. Add a
`'mantle'` locomotion mode that skips ordinary horizontal input while allowing
normal gravity. The normal X resolver initially blocks the toward-wall velocity,
so X remains unchanged while the actor rises beside the wall. Once the actor's
feet clear the wall top, that same collision-resolved velocity carries the actor
smoothly over the edge. Gravity produces the visible arc and the normal Y
resolver lands the actor on top.

End the assist when the actor reaches `landingX`, lands, the timer expires, or a
cancel/failure condition occurs. Dash cancels the assist and keeps dash priority;
a ceiling collision or changed geometry ends the assist and leaves the actor on
the physically resolved trajectory. Reaching the marker ends only the assist—it
does not snap the actor to it.

## 4. Public and serialized API changes

### 4.1 `PlatformerConfig`

Add flat config fields consistent with the existing module:

```ts
readonly mantleEnabled: boolean;
readonly mantleHopVx: number;
readonly mantleHopVy: number;
readonly mantleApexClearance: number;
readonly mantleLandingInset: number;
readonly mantleAssistTime: number;
readonly climbJumpRegrabLockTime: number;
```

Proposed 16 px reference defaults:

| Field | Default | Unit/scaling | Rationale |
|---|---:|---|---|
| `mantleEnabled` | `true` | boolean, copied | Effective only when `wallGrabEnabled` is also true; consumers can opt out |
| `mantleHopVx` | `100` | velocity, scaled and jump-repegged | Assisted forward speed; collision pins it harmlessly until the actor clears the wall top |
| `mantleHopVy` | `267` | velocity, scaled and jump-repegged | Minimum upward impulse; the route helper raises it when actor geometry requires more clearance |
| `mantleApexClearance` | `6` | distance, scaled | Extra space above the wall top for visible hang time and enough time to move onto the ledge |
| `mantleLandingInset` | `8` | distance, scaled | Half of the reference body width; defines the assist finish marker, never a position assignment |
| `mantleAssistTime` | `0.35` | seconds, copied | Bounds the toward-ledge assist so it cannot own horizontal velocity indefinitely |
| `climbJumpRegrabLockTime` | `0.12` | seconds, copied | Allows a short ballistic rise before re-cling |

Validate the feel values in deterministic trajectories before freezing them. If tuning changes them, update the table and the default derivation together; do not introduce consumer-only overrides as the canonical behavior.

Update `PLATFORMER_CONFIG_FIELD_UNITS` exhaustively:

- `mantleHopVx`: `velocity`
- `mantleHopVy`: `velocity`
- `mantleApexClearance`: `distance`
- `mantleLandingInset`: `distance`
- `mantleAssistTime`: `time`
- `climbJumpRegrabLockTime`: `time`
- `mantleEnabled`: `boolean`

Add `mantleHopVx` and `mantleHopVy` to
`createPrecisionPlatformerConfig`'s jump-relative re-peg set so custom jump
apex/time settings preserve the mantle arc.

### 4.2 `WallGrabAbilityState`

Add one ability-private timer and one optional active-assist record:

```ts
readonly regrabTimer?: number;
readonly mantle?: {
  readonly side: 'left' | 'right';
  readonly wallTopY: number;
  readonly landingX: number;
  readonly solidId: string | null;
  readonly assistTimer: number;
} | null;
```

Initialize these to `0` and `null` in `makeInitialWallGrabState`. Treat absent
fields as inactive defensively when advancing manually constructed states.
Decay timers with `Math.max(0, timer - dt)` and preserve them deliberately
through every early return.

The re-grab timer blocks only wall-grab re-engagement, never global input or
wall-slide behavior. The mantle record owns only the short horizontal assist;
gravity and position stay kernel-owned. Store both on the owning ability rather
than `LocomotionState` or a consumer world.

### 4.3 Launch sources and events

Extend `LaunchSource` and `LAUNCH_PRIORITY` with:

```ts
'climbJump'
'mantle'
```

Both rank alongside `wallJump` and `climbHop`. Update the kernel's launch handling:

- `wallJump` / `superWallJump` / `climbHop` -> `wallJumpLaunched`
- `climbJump` -> `climbJumpLaunched`
- `mantle` -> `mantled`
- only `wallJump`, `superWallJump`, and `climbHop` open horizontal force timers
- `climbJump` and `mantle` set `forceMoveX = 0` and `forceMoveXTimer = 0`
- include all three wall-grab sources in the jump-slice anti-relaunch/rising-pose reset as appropriate

Add these boolean single-tick pulses to `PlatformerEvents` and `EMPTY_EVENTS`:

```ts
readonly climbJumpLaunched: boolean;
readonly mantled: boolean;
```

Update all full event literals in built-in abilities, fallbacks, fixtures, and tests. The current worktree also changes `types.ts`, `constants.ts`, `kernel.ts`, and `wall-grab-ability.ts` for feel moments; preserve and integrate with those edits rather than replacing them.

**Feel-moment cue data (D2, shipped in `0.8.0`):** the booleans stay the
canonical "did this happen" pulses. Existing launches do not universally have a
matching moment, so do not describe this as a parity rule. Add
`{ kind: 'climbJumpLaunched' }` and `{ kind: 'mantled' }` moments only if the
consumer needs the grabbed `solidId` on the presentation channel; otherwise the
new booleans are sufficient. Make that public-surface decision before
implementation and keep the walkthrough/event mapping consistent with it.

Do not add engine audio or particle functions. Celerock can map:

```ts
if (state.events.mantled) audio.mantle();
if (state.events.climbJumpLaunched) audio.climbJump();
if (state.events.wallJumpLaunched) audio.wallJump();
```

Particle placement remains consumer-owned and must use its seeded RNG.

## 5. File-by-file implementation plan

### New file

- `src/platformer/mantle.ts`
  - Add the pure route/launch helper.
  - Return feasibility, finish-marker, and derived launch metadata only; never a
    replacement actor position.
  - Keep blocking-solid filtering consistent with collision resolvers.
  - Prefer a module-private helper surface unless a concrete second consumer needs raw mantle geometry. Test the behavior through the public ability/kernel API.

### Engine behavior

- `src/platformer/abilities/wall-grab-ability.ts`
  - Probe using the latched `state.side` while grabbing.
  - Decay/preserve `regrabTimer` and the active mantle-assist timer.
  - Add jump-direction branching and mantle transition in the precedence order above.
  - During mantle assist, own only the toward-ledge `vx`; preserve `vy` and
    never write `x`/`y`.
  - Continue to own stamina depletion and patches.
  - Never mutate `PlatformerInput`.

- `src/platformer/kernel.ts`
  - Initialize the new state field.
  - Add `'mantle'` locomotion mode: skip ordinary horizontal input but continue
    gravity and normal X/Y collision resolution.
  - Arbitrate the new launch sources.
  - Open horizontal force only for the away path.
  - Emit the new semantic event pulses from the winning launch.
  - Reset the jump slice for climb-jump/mantle without creating a phantom normal jump.

- `src/platformer/types.ts`
  - Document config, state, launch-source, priority, and event contracts.
  - Remove the current documentation that calls climb-jump leniency wholly deferred; retain `climbJumpBoostTime` as a separate reserved Celeste nuance rather than conflating it with the new re-grab lock.

- `src/platformer/constants.ts`
  - Add the proposed defaults.
  - Add false values to `EMPTY_EVENTS`.

- `src/platformer/config-scale.ts`
  - Classify all fields.
  - Re-peg `mantleHopVx`/`mantleHopVy` with the jump family.

- `src/platformer/index.ts` and `src/index.ts`
  - Ensure widened public types/events flow through the existing barrels.
  - Do not export the internal mantle helper unless the implementation intentionally accepts it as public API.

### Replay and compatibility

- `src/replay/constants.ts`
  - Bump `CURRENT_PHYSICS_VERSION` from the current `11` to `12` and document
    mantle/directional-climb-jump trajectory changes.
  - If another trajectory-changing change lands first, use the next monotonic
    version instead of forcing `12`.

- `src/replay/player.ts`
  - Update any manually constructed fallback events/ability slices.

- Replay/trace fixtures
  - Refresh config/state hashes affected by new fields, state, events, launch sources, and version.
  - Do not claim unchanged wall-grab trajectories: neutral/toward grab+jumps intentionally change.

### Documentation and consumer follow-up

- `games/celerock.md`
  - Describe mantle and direction-aware grab+jump as engine-owned features.
  - Add `climbJumpLaunched`/`mantled` to the event table.
  - Keep Arrow/WASD movement and KeyK grab bindings; they already produce the required `moveX`/`moveY` signals.
  - Document consumer audio/particle mappings rather than adding them to deterministic physics.

- Celerock consumer (separate repository/change)
  - Delete any pre/post-step movement patch if one was started.
  - Read the new engine event pulses for SFX/particles.
  - Tune only through `PlatformerConfig` overrides.

## 6. Test-first delivery plan

### Phase A — lock current behavior and add failing direction tests

Extend `src/tests/platformer-wall-grab.test.ts` before implementation:

- Right wall: neutral and Toward produce straight-up `climbJump`, `vx = 0`, facing right.
- Left wall: neutral and Toward produce straight-up `climbJump`, `vx = 0`, facing left.
- Right/left Away preserve up-and-away `climbHop` velocity and facing.
- Partial analog Away/Toward values follow sign, not magnitude.
- Straight climb-jump arms re-grab timing and clears forced horizontal movement.
- Away climb-hop keeps the existing `climbHopForceTime` behavior.
- Stamina cost and fixed `varJumpTime: 0` remain unchanged for both branches.
- Dash press wins over grab+jump.

### Phase B — add failing mantle geometry tests

Exercise the public wall-grab ability or `stepPlatformer` with synthetic solids:

- Tall wall mid-climb does not mantle.
- Near the top, clear right and left walls mantle symmetrically.
- A thin/one-tile wall can mantle immediately when the head threshold is already met.
- A very wide merged solid uses an edge-relative finish marker and never causes
  a position jump proportional to its width.
- A ceiling above the starting side blocks the route before launch.
- An overhang above the ledge blocks the conservative transition corridor.
- An occupied landing foothold blocks the mantle.
- Passthroughs, ladders, springs, and dash refills do not count as walls or blocking clearance.
- Zero stamina and `mantleEnabled: false` suppress the transition.
- Jump pressed on the mantle-eligible tick produces the jump path, not a mantle.
- Dash pressed on the mantle-eligible tick produces neither wall-grab launch.
- Inputs, core, state, and solids remain unmutated.
- `findMantleRoute` never returns or applies a replacement core position.

### Phase C — kernel integration trajectories

Add full-step assertions:

- Straight climb-jump rises for the configured lock duration before it may re-grab; no 4 px re-cling jitter.
- Toward input does not create sideways velocity through the forced-move subsystem.
- Away input keeps velocity away and emits `wallJumpLaunched`, not `climbJumpLaunched`.
- Mantle emits `mantled` without changing position on the launch tick beyond
  `velocity * dt`, rises beside the wall over multiple frames, crosses the edge,
  then lands on top.
- X stays pinned by the ordinary resolver while the actor overlaps the wall's Y
  band, then advances smoothly once the feet clear the top.
- No mantle tick changes `x` or `y` by more than its integrated velocity plus
  the resolver's normal contact correction; assert the complete per-tick trace
  has no discontinuity.
- A blocked/cancelled assist falls or bonks from its physically resolved
  position; it never jumps to the finish marker.
- Mantle later acquires the correct ground contact id on landing.
- The two event pulses last exactly one tick.
- 30, 60, and 120 Hz fixed-step runs use duration-based locks and reach the same qualitative outcome.
- A recorded input stream replays to the same final state/hash under the new physics version.

Use `src/tests/platformer-trace-harness.ts` for at least these new golden scenarios:

1. Neutral climb-jump and re-grab.
2. Away climb-hop.
3. Clear mantle and landing.
4. Blocked mantle under an overhang.

### Phase D — config and public-surface tests

- `platformer-config-scale.test.ts`: verify distance/velocity/time/boolean behavior at 0.5x and 2x.
- `createPrecisionPlatformerConfig`: verify custom apex/time re-pegs
  `mantleHopVx` and `mantleHopVy`.
- `barrel-contract.test.ts`: ensure the widened public types/config compile through root exports.
- Replay tests: reject physics version 11 after the bump and accept the new current version.

## 7. Verification commands

Run after implementation:

```sh
npx vitest run src/tests/platformer-wall-grab.test.ts
npx vitest run src/tests/platformer-config-scale.test.ts src/tests/replay.test.ts
npm test
npm run build
npm run build:dist
npm run release:smoke
```

Then inspect the packed declarations or tarball to confirm the config/state/event additions are published through the root barrel.

Consumer visual verification is a follow-up in Celerock:

- grab + Up visibly rises beside the wall, arcs across the lip, and lands—there
  is no single-frame snap to the ledge;
- neutral/Toward grab+jump rises vertically and can chain after the lock;
- Away grab+jump visibly separates from the wall;
- overhangs fail safely without embedding;
- mantle, climb-jump, and wall-jump SFX/particles fire once from event pulses.

## 8. Acceptance criteria

- Both mechanics work through an unpatched `stepPlatformer` call.
- No consumer-owned physics/state/input rewrite is required.
- Mantle never assigns an actor position directly: all movement is produced by
  velocity integration plus normal collision resolution.
- The actor occupies the intermediate rise/crossing positions over multiple
  ticks; a clear mantle has no discontinuity in its trajectory trace.
- Mantle never embeds the actor in a blocking solid or moves proportionally to a wide merged solid's width.
- Neutral/Toward and Away grab+jumps have distinct, deterministic trajectories and correct facing.
- Straight climb-jump cannot re-grab until its seconds-based lock expires.
- Dash beats both features; jump beats mantle.
- Stamina remains engine-owned and is charged exactly once.
- Audio/particles remain outside deterministic physics and are driven by single-tick events.
- Config scaling, replay versioning, state initialization, barrels, tests, build, dist build, and release smoke all pass.
- No `Math.random`, `Date.now`, manual gravity, manual stamina refill, or consumer post-step velocity patch is introduced.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Mantle looks like a teleport despite a clear route | Never assign `core.x`/`core.y`; use a multi-tick ballistic launch plus bounded horizontal assist |
| Mantle tunnels through an overhang | Conservative preflight corridor plus authoritative live X/Y collision every tick |
| Wide compiled rectangle causes a large horizontal move | Edge-anchored finish marker affects assist duration only; it is never copied into actor position |
| Hop cannot raise the full actor above the lip | Derive a geometry-safe minimum `launchVy` from body height, wall top, gravity, clearance, and `dt` |
| Straight jump is pushed sideways by old lockout logic | Distinct `'climbJump'` source; kernel clears force direction/timer |
| Immediate re-cling cancels vertical rise | Ability-owned `regrabTimer` gated only on engagement |
| Jump and mantle both fire | Explicit branch precedence inside one ability |
| New state disappears on ladder/early return | Preserve/decay the timer in every return path; targeted tests |
| Config fields scale incorrectly | Exhaustive mapped unit table and 0.5x/2x tests |
| Old replays silently diverge | Physics-version bump and hash refresh |
| Current feel-moment work is overwritten | Rebase carefully and merge changes at the shared type/kernel/ability touch points |
| Consumers duplicate presentation cues | Document one event-to-effect mapping and one-tick gating |

## 10. Explicitly out of scope

- Mantle animation timelines, animation locks, or sprite root motion.
- Engine-owned audio or particle presets specific to Celerock.
- Arbitrary free-climbing or vaulting from the ground.
- Mantling passthrough platforms or ladder cells.
- Reworking normal wall-slide wall-jumps.
- Consuming the reserved `climbJumpBoostTime` for unrelated leniency; it remains a separate future parity item.
- A consumer-side fallback implementation after the engine feature ships.
