# Wall Mantle & Direction-Aware Climb-Jump — Implementation Walkthrough

**Status:** Companion overview of `docs/design/platformer-wall-mantle-directional-climb-jump-plan.md` (the canonical, corrected plan — **implemented**; landed as physics version 12, see `src/platformer/mantle.ts` + the wall-grab ability/kernel changes and `platformer-wall-grab.test.ts` / `platformer-traces.test.ts` scenarios 8–11)
**Target release:** next trajectory-changing minor after `0.8.1`; replay physics version **11 → 12**
**Written:** 2026-08-13

This is a readable digest of the canonical plan plus the review findings already folded
into it. When the two disagree, the canonical plan wins.

---

## 1. The two mechanics

### 1.1 Ledge mantle

While wall-grabbing, holding **Up** when the actor's head is near the top of a clear
wall starts a continuous assisted hop. The actor rises beside the wall over
several physics ticks, crosses the lip once their feet clear it, and lands through
the normal collision resolver.

There is no relocation step. No mantle code assigns `core.x` or `core.y`, and no
finish coordinate is copied into actor position. This is the defining constraint,
not merely a visual-polish goal.

### 1.2 Direction-aware grab+jump

Pressing jump while grabbing branches on the **latched wall side** (`WallGrabAbilityState.side`
— not velocity, not the input edge):

- **Away** → the existing up-and-away climb-hop (`source: 'climbHop'`), trajectory
  unchanged. Faces away from the wall; keeps `climbHopVy/Vx/ForceTime`.
- **Neutral or Toward** → a new straight-up **climb-jump** (`source: 'climbJump'`):
  `vx = 0`, faces the wall, no forced horizontal move, and a short
  `regrabTimer` lock so the actor actually rises instead of instantly re-clinging
  (the 4 px re-cling jitter).

Direction tests are sign-based (`moveX < 0` / `> 0`), matching the kernel's analog
contract; magnitude is ignored.

### 1.3 Precedence (fixed, inside one ability)

1. Release conditions (grab let go, wall lost, ladder overlap, dash pressed)
2. Jump pressed → direction-aware grab+jump
3. Mantle conditions satisfied → mantle
4. Otherwise cling/climb + stamina drain as today

So **dash beats both**, and **jump beats mantle**.

---

## 2. Why it is engine work

The original consumer proposal patched `stepPlatformer` output in game files. The
plan moves both transitions into `wallGrabAbility`'s state machine because a
consumer-side patch would split ownership of wall-grab state, stamina, launch
arbitration, replay determinism, and collision safety across the engine/consumer
boundary. Everything the mechanic needs (stamina, launch intents, wall probes,
contacts) is already engine-owned.

---

## 3. The safety-critical mantle design

### 3.1 The previous version still teleported

The earlier plan proposed validating a vertical-plus-horizontal route in 1 px
steps and then relocating the actor to its end. That prevents embedding, but it
does not create motion: the player still disappears from the wall and appears on
the ledge in one simulation tick. A collision sweep validates intermediate
positions; it does not make the actor occupy them.

That design is rejected.

### 3.2 Edge-anchored finish marker, never a destination assignment

```
inset    = min(max(0, config.mantleLandingInset), core.width, wall.width)
landingY = wall.y - core.height
landingX = side === 'right' ? wall.x - core.width + inset
                              : wall.x + wall.width - inset
```

`landingX` is only the point at which the horizontal assist may stop. The engine
never sets `core.x = landingX` or `core.y = landingY`. This also avoids the wide-
solid bug: LDtk can merge a floor into a room-width rectangle, but its total width
never enters the actor's movement distance.

### 3.3 Geometry-safe ballistic launch

The actor must lift their entire collision body past the wall top. The old
`mantleHopVy ≈ 120` has only about a 6 px continuous apex under the default jump
gravity, so it could look correct only because the plan first teleported the
24 px-tall body upward.

The corrected plan derives a minimum impulse from the required rise:

```ts
const gravity = (2 * config.jump.apexHeight) /
  (config.jump.timeToApex * config.jump.timeToApex);
const requiredRise = Math.max(0, core.y + core.height - wall.y) +
  config.mantleApexClearance;
const clearanceVy = Math.sqrt(2 * gravity * requiredRise) + gravity * dt;
const launchVy = -Math.max(config.mantleHopVy, clearanceVy);
```

The extra gravity frame accounts for semi-implicit Euler applying gravity before
position. The configured vertical speed remains a minimum/tuning floor; unusual
actor heights still receive enough lift to clear naturally.

### 3.4 Conservative preflight plus live collision

Before launch, `findMantleRoute` samples the vertical column beside the wall and
the above-ledge crossing corridor in ≤1 px increments. The landing foothold must
also be clear. Passthrough, ladder, spring, and dash-refill volumes stay excluded.

This preflight can conservatively decline a mantle. It never authorizes a
teleport. During the actual hop, `resolveAxisX` and `resolveAxisY` run every tick,
so changed geometry, a ceiling, or an unexpected obstruction blocks the actor at
the physical contact point.

### 3.5 How the natural hop moves

1. The start tick leaves `x` and `y` unchanged, ends the grab, charges stamina,
   and emits a `'mantle'` launch with upward and toward-ledge velocity.
2. A short serialized mantle-assist state re-applies only the toward-ledge `vx`.
3. The `'mantle'` locomotion mode skips normal horizontal input but **does not
   skip gravity**.
4. While the body still overlaps the wall vertically, the normal X resolver
   blocks that velocity, so the actor visibly rises beside the wall.
5. Once the feet clear the top, the same velocity moves the actor smoothly over
   the lip. Gravity carries the arc down and the normal Y resolver lands them.
6. Reaching `landingX` only ends the assist. It never snaps the actor there.

Dash, landing, timeout, or a failed collision state can cancel the assist. Every
exit preserves the position produced by physics that tick.

---

## 4. Surface changes (all additive)

| Layer | Change |
|---|---|
| `PlatformerConfig` | `mantleEnabled`; `mantleHopVx`; minimum `mantleHopVy`; `mantleApexClearance`; `mantleLandingInset`; `mantleAssistTime`; `climbJumpRegrabLockTime`. Velocities/distances scale, times/booleans copy, and the hop velocities are jump-repegged by `createPrecisionPlatformerConfig` |
| `WallGrabAbilityState` | optional `regrabTimer?` plus an optional active mantle-assist record (`side`, `wallTopY`, `landingX`, `solidId`, `assistTimer`) |
| `LocomotionMode` | new `'mantle'` mode: ability-owned horizontal assist, normal gravity, normal X/Y collision |
| `LaunchSource` / `LAUNCH_PRIORITY` | `'climbJump'` + `'mantle'`, ranked with the wallJump family; only `wallJump`/`superWallJump`/`climbHop` open horizontal force timers — the two new sources explicitly resolve `forceMoveX = 0`, `forceMoveXTimer = 0` |
| `PlatformerEvents` | `climbJumpLaunched` + `mantled` boolean pulses (widens the 9-boolean surface to 11; every full event literal in abilities/fallbacks/fixtures/tests updates) |
| `state.moments` | Optional matching cue moments carrying `solidId`; add them only if consumers need surface identity, because existing launch events do not universally have moment twins |
| Replay | `CURRENT_PHYSICS_VERSION` **11 → 12** with a history entry; v11 rejection + hash recapture. Genuinely trajectory-changing: neutral/toward grab+jumps change on purpose |
| Files | new `src/platformer/mantle.ts` (pure `findMantleRoute`); `wall-grab-ability.ts`, `kernel.ts`, `types.ts`, `constants.ts`, `config-scale.ts`, barrels, `replay/constants.ts` + `player.ts`, `games/celerock.md` |

### Mantle transition (on a valid route)

Keep position and contacts exactly as they are at ability evaluation. End the
grab, deduct stamina, arm the assist/re-grab state, and emit the `'mantle'`
`LaunchIntent` with `vx = wallDirection * mantleHopVx`, the derived negative
`launchVy`, and `varJumpTime: 0`. Reset the jump slice when the launch wins for
pose/anti-relaunch purposes without reporting a normal jump.

From there, gravity, velocity integration, and collision do all movement. There
is no mantle-specific position write on the start tick or any later tick.

---

## 5. Review findings already folded into the plan

1. **§3.3 factual error (fixed in doc):** the plan originally claimed the kernel
   emits `events.wallJumpLaunched` for a winning `climbHop`. It does not —
   `kernel.ts` emits that pulse only for `wallJump`/`superWallJump`. "Report Away
   as a wall jump" is therefore an **explicit widening** of an existing event's
   meaning (consumers already reading that pulse will start seeing climb-hops), or
   Away stays pulse-less. Decide deliberately at implementation time.
2. **Feel-moment claim (corrected in doc):** existing launch events do not all
   have moment twins. The new booleans are sufficient unless Celerock needs the
   grabbed `solidId`; matching moments are an explicit optional surface decision,
   not a required parity rule.
3. **Version math (updated in doc):** v11 shipped with the feel-moments channel
   (`0.8.0`), so this work bumps **11 → 12**.
4. **Teleport review (fixed in doc):** a swept-and-validated relocation is still
   a teleport. The canonical plan now uses a multi-tick assisted ballistic hop
   and prohibits mantle code from assigning actor position.

---

## 6. How it dovetails with the `0.8.x` work

- The **D2 `solidId` change de-risked it**: the wall-grab ability now captures the
  wall `Solid` object (instead of `!== null`-reducing `probeWall` to a boolean) for
  the `grabLatch` moment — the mantle needs exactly that object for
  `wall.y` / `wall.x` / `wall.width` geometry.
- The feel-moments channel (`0.8.0`) gives consumers the cue surface; the plan's
  "engine emits events, consumer owns audio/particles" philosophy matches it.
- E1/E2 (`0.8.1`) are loader/type-level only — no interaction.

---

## 7. Test plan (four phases, from the canonical doc)

- **Phase A — direction semantics (failing first):** left/right walls; neutral and
  Toward → straight-up `climbJump` (`vx = 0`, facing the wall); Away → unchanged
  `climbHop` velocity + facing; partial analog follows sign not magnitude;
  regrab timing armed vs `climbHopForceTime` kept; stamina cost and
  `varJumpTime: 0` unchanged; dash press wins.
- **Phase B — mantle geometry matrix:** tall wall mid-climb does not mantle;
  symmetric left/right mantles near the top; thin one-tile wall mantles when the
  threshold is met; a wide merged solid affects only the edge-relative finish
  marker; ceiling/overhang/occupied foothold block the route;
  passthrough/ladder/spring/dashRefill never count; zero stamina and
  `mantleEnabled: false` suppress; jump-on-the-eligible-tick takes the jump path;
  dash takes neither; inputs/core/state/solids unmutated; the route helper never
  returns a replacement position.
- **Phase C — kernel trajectories:** climb-jump rises for the lock duration
  before re-grab; Toward creates no sideways velocity through the forced-move
  subsystem; Away emits `wallJumpLaunched` (if widened), not `climbJumpLaunched`;
  mantle emits `mantled`, rises beside the wall over multiple frames, crosses
  only after the feet clear, and lands with the correct ground contact id; every
  per-tick displacement is bounded by integrated velocity/collision correction;
  no trace discontinuity or destination snap; blocked/cancelled assists preserve
  their physically resolved position; pulses last exactly one tick; 30/60/120 Hz
  fixed-step runs agree qualitatively; a recorded input stream replays to the
  same final state/hash under v12. Trace-harness goldens: neutral climb-jump +
  re-grab, away climb-hop, clear mantle + landing, blocked mantle under an
  overhang.
- **Phase D — config + surface:** `platformer-config-scale` at 0.5×/2×; custom
  apex/time re-pegs `mantleHopVx`/`mantleHopVy`; barrel contract for the widened
  types; replay rejects v11 / accepts v12.

---

## 8. Effort and risk profile

The biggest single ability change since Phase 6 (wall-grab itself) — larger than
anything in the `0.8.0` feel/transitions release because it **changes
trajectories**, pulling in replay-version migration, hash recapture, event-literal
updates everywhere, and honest "wall-grab behavior intentionally changed" docs.

**Residual judgment calls at implementation time:**

- **Feel values** — `mantleHopVx` 100, minimum `mantleHopVy` 267,
  `mantleApexClearance` 6, `mantleLandingInset` 8, `mantleAssistTime` 0.35 s,
  and the 0.12 s climb-jump re-grab lock are proposals; validate deterministic
  trajectory traces and rendered motion before freezing.
- **The `wallJumpLaunched` widening** — an observable semantics change for
  existing consumers; either accept and document it, or keep Away pulse-less.

**Explicitly out of scope** (per the canonical plan): mantle animation timelines,
engine audio/particle presets, free-climbing/vaulting from the ground, mantling
passthrough platforms or ladder cells, reworking normal wall-slide wall-jumps,
and any consumer-side fallback.
