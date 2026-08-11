# Celeste-Inspired Platformer Improvements — Phased Roadmap

**Date:** 2026-08-11 (rev. 3 — restructured around update ordering)
**Source of inspiration:** [`NoelFB/Celeste` — `Source/Player/Player.cs`](https://github.com/NoelFB/Celeste/blob/master/Source/Player/Player.cs)

> **Verification status.** All `[C:]` constants verified line-by-line against `Player.cs` @ `master` (5,471 lines; `Source/Player/` holds only `Player.cs` + `Readme.md`). Constants are exact. **Mechanisms were repeatedly mis-specified in earlier drafts** even where the constant was right. Every mechanism claim below now cites its call site as `Player.cs:N`.

## The central lesson

Earlier revisions of this document treated Celeste as a bag of constants and aicraft as a bag of independent ability modules, and asked how to port one into the other. That framing produced four mechanism errors and, more importantly, missed the actual transferable insight:

**Celeste's feel comes from tightly controlled update ordering and a single authoritative physics state — not from its numbers.** Its own directory [`Readme.md`](https://github.com/NoelFB/Celeste/blob/master/Source/Player/Readme.md) warns that platformer movement code must stay tightly ordered. One `Speed` vector, one `varJumpTimer`, one buffered jump input, one exclusive state, consumed in a fixed sequence.

aicraft currently has **two vertical authorities, no arbitration between abilities, and wall contacts that cannot survive the very move Phase 3 was built on.** Tuning constants on top of that will produce values that appear correct in isolation and desync across ticks.

Hence **Phase 0**. Nothing downstream is safe until it lands.

---

## Phase 0 — Physics authority & ability arbitration (blocking)

No feel work. No new constants. This phase exists to make every later phase's numbers mean what they say.

**Start with §0a — the harness lands before any refactor, against current behavior.** Everything else in Phase 0 rewrites how velocity is produced, and the replay hash changes underneath as it does. Without a baseline captured first, there is no way to tell an intended trajectory change from a regression: the tests would only ever validate the new code against itself.

### 0a. Multi-tick integration harness — **build this first**

Every defect in this phase is invisible to a single-tick unit test. The diagnostic that found §0b needed two ticks: `core.vy = -326.52` looks correct in isolation and only collapses to `-42.85` on the tick after.

Build the harness **against current `main`, before touching kernel or abilities**, and commit the baseline. Sequence:

1. **Land the harness on unmodified code.** Assert over N-tick sequences, not single ticks.
2. **Record baselines as fixtures** — full `(vx, vy, x, y, mode)` traces for a set of scripted input sequences, plus the replay hash for each.
3. **Refactor §0b–§0e.** Every baseline diff is now either an intended fix or a regression, and you must classify each one explicitly.
4. **Re-baseline once, deliberately**, with the `physicsVersion` bump from Phase 1 attached to the same commit.

Sequences worth covering before the refactor — each currently encodes a *bug*, so record what it does today and expect the diff:

| Scenario | Ticks | Asserts | Today |
|---|---|---|---|
| Double-jump impulse persistence | 3 | `vy` at tick 2 reflects the impulse | **fails** — stale jump slice reasserts (§0b) |
| Wall-jump impulse persistence | 3 | same, for wall-jump | **fails** — same cause |
| Held vs. tapped jump apex | 20 | tapped apex < held apex | passes for ground jump only |
| Grab holds against a wall | 30 | still grabbing at tick 30 | n/a — releases at tick 2 once built (§0e) |
| Buffered jump fires once | 5 | exactly one `justLaunched` | passes; must survive §0d |
| Dash → ground transition | 10 | `vx` at dash-expiry tick | records the clobber (Phase 3/§4c) |
| Spring into jump slice | 3 | launch survives to tick 2 | n/a — will fail without §0b |

The traces are the deliverable, not the assertions — several of the above *should* change, and the fixture diff is how you prove the change was the one you meant.

**Files:** `src/tests/` (new multi-tick harness + fixtures). No `src/platformer/` changes in this step.

### 0b. Collapse vertical velocity to one authority

**The defect.** [`jump-ability.ts:76`](src/platformer/abilities/jump-ability.ts:76) returns `core: { ...core, vy: nextJump.vy }` — the jump slice advances a *private* trajectory and overwrites `core.vy` wholesale each tick. [`kernel.ts:248`](src/platformer/kernel.ts:248) then adds a second, independent gravity term to `core.vy`. Next tick, `advanceJump(state.jump, …)` integrates from the **jump slice's** internal `vy`, discarding both the kernel's gravity and any `vy` written by another ability.

Confirmed by two-tick diagnostic: a double jump sets `core.vy = -326.52`, which collapses to `-42.85` on the next held-jump tick as the stale jump trajectory reasserts itself.

**Consequences that invalidate earlier phases:**

- Wall-jump and double-jump impulses aren't merely missing variable height — **they are discarded**. The old §1d ("honor `jump.held` in both") treated a symptom.
- Applying half-gravity in the kernel only — as earlier drafts instructed — is **incorrect**; the jump slice overwrites it.
- Springs (Phase 8) would be swallowed the same way.

**Celeste's contract** (`Player.cs:1660-1799`): one `Speed.Y`. Every launch variant — normal jump, wall jump, super jump, super wall jump, bounce — writes `Speed.Y` directly and then initializes the *shared* window:

```cs
varJumpTimer = VarJumpTime;
varJumpSpeed = Speed.Y;     // Player.cs:1664, 1673 (Jump); :1698, :1720 (SuperJump)
```

**Required change.** `core.vy` becomes the single authority. The jump slice keeps *phase* and *timers*, never a parallel `vy`. Introduce a shared launch contract:

```ts
interface LaunchIntent {
  readonly vy: number;
  readonly vx?: number;
  readonly varJumpTime: number;   // shared window this launch opens
  readonly source: 'jump' | 'wallJump' | 'doubleJump' | 'superJump' | 'superWallJump' | 'spring';
}
```

Any ability may submit one; arbitration (§0d) picks at most one per tick; the kernel applies it to `core` and opens the shared variable-jump window. Gravity is applied **once**, by the kernel, to `core.vy`.

### 0c. Shared locomotion state, not per-ability duplicates

Celeste keeps one buffered jump input and one variable-jump window, consumed by whichever variant wins — `Input.Jump.ConsumeBuffer()` appears in `Jump()`, `SuperJump()` (`Player.cs:1697`), `WallJump()`, and `SuperWallJump()` alike.

Introduce a `LocomotionState` slice holding what is genuinely global:

| Field | Why shared |
|---|---|
| `jumpBufferTimer` | one buffered press, consumed by whichever jump variant wins |
| `varJumpTimer`, `varJumpSpeed` | the window is opened by *any* launch, not just the ground jump |
| `coyoteTimer` | also gates super-jump (`Player.cs:3503`) |
| `stamina` | wall-grab (Phase 6), but read by others |
| `dashesRemaining`, `dashCooldown` | refills (Phase 8) mutate it from outside the dash ability |
| `forceMoveXTimer`, `forceMoveX` | wall-jump lockout — Celeste's `forceMoveX` (`Player.cs:760-764`) |

This directly supersedes old §6a, which proposed a *second* `jumpBufferTimer` inside `WallSlideAbilityState`. Two buffers racing on one keypress is exactly the class of bug Phase 0 exists to prevent.

### 0d. Exclusive locomotion mode + intent arbitration

Old §3f assumed pipeline *position* ("between wallSlide and dash") establishes precedence. It does not. Ordering controls who writes last; it does not stop wall-slide, wall-grab, double-jump, and dash from all reacting to the same `jump.pressed`, nor from leaving several slices simultaneously "active."

Celeste uses an explicit exclusive state (`StNormal`, `StClimb`, `StDash`, …) with ordered early returns — climb acquisition precedes dash in normal movement; climb-jump precedes dash while climbing.

**Hybrid design that fits aicraft's pipeline:**

```ts
type LocomotionMode = 'normal' | 'dash' | 'wallGrab' | 'ladder';

interface AbilityIntent {
  readonly mode?: LocomotionMode;   // request an exclusive transition
  readonly launch?: LaunchIntent;
  readonly consumesJump?: boolean;  // claims the buffered jump press
  readonly priority: number;
}
```

- **Exclusive mode** — only the owning ability writes velocity in that mode.
- **Auxiliary slices stay additive** — stamina, dash budget, buffers, variable-jump window.
- **Abilities submit intents; one arbitration step selects and consumes.** No ability mutates `core` velocity directly.

This replaces the current `isDashActive` / `isClimbActive` ad-hoc guards ([`kernel.ts:538-553`](src/platformer/kernel.ts:538)), which already gesture at exclusivity without a general mechanism — and which every new ability would otherwise extend by hand (as old §3f proposed, adding a third bespoke guard).

### 0e. Deterministic wall probes

**The defect.** Old §3b said to zero `vx` while grabbing and read wall presence from `core.contacts.leftWallId` / `rightWallId`. But contacts are rebuilt from horizontal collision each tick, and [`findWallSolidId:566`](src/platformer/kernel.ts:566) opens with:

```ts
if (appliedVx === 0) return null;
```

Zeroing `vx` therefore clears the wall contact on the *following* tick, releasing the grab. **The proposed mechanic destroys its own precondition.**

Celeste never treats last tick's collision as persistent geometry — it runs explicit offset probes: `ClimbCheck(dir)`, `WallJumpCheck(dir)` at `WallJumpCheckDist = 3` (`Player.cs:56`), `ClimbBoundsCheck`, `CollideCheck<Solid>(Position + Vector2.UnitX * Facing)` (`Player.cs:2935`).

**Required change.** Add pure geometry queries to the collision layer:

```ts
function probeWall(body: Rect, side: -1 | 1, distance: number, solids: readonly Solid[]): Solid | null;
function probeGround(body: Rect, distance: number, solids: readonly Solid[]): Solid | null;
```

Deterministic, no state, no dependence on last tick's motion. **Contacts describe collisions that happened; probes answer questions about geometry.** Wall-grab, wall-slide, wall-jump, and corner correction all need the latter.

**Files:** `src/platformer/kernel.ts`, `src/platformer/types.ts`, all five files in `src/platformer/abilities/`, `src/collision/` (new probes), `src/animation/jump.ts`, tests.

---

## Phase 1 — Replay physics versioning

Do this immediately after Phase 0, before any tuning.

**Format versioning is insufficient.** Almost every phase changes replay *outcomes* while leaving the serialized shape untouched — Phase 0 alone changes every trajectory. A format version won't catch that.

[`ReplayConfig`](src/replay/types.ts) already invites exactly this: its doc comment names *"level id, physics version, seed-replay-keys"* as the consumer extension surface, and it lands in the canonical hash. Note also `ReplayFrame = PlatformerInput`, so widening that type (Phase 9) changes the frame type directly.

**Required:**

1. Promote `physicsVersion` from suggestion to **required**, bumped by every phase that alters trajectories.
2. Define behavior on mismatch — reject, or migrate — rather than silently replaying wrong.
3. **Migrate initial states for new ability slices.** [`kernel.ts:212-213`](src/platformer/kernel.ts:212) does `if (stateSlice === undefined) continue;` — a missing slice is silently **skipped**, not initialized. An old replay lacking `wallGrab` or `locomotion` will run without them and diverge quietly instead of failing loudly. Adding a slice requires an explicit migration step.

---

## Phase 2 — Input wiring & correctly ordered dash startup

### 2a. Bind a dash key
`dashEnabled: true` is the default, but **no section binds dash** — `sprite-demo.ts:228`, `playground.ts:2205`, `tile-room.ts:1746`, `ldtk-editor/play.ts:470` all pass `dash: null`, and the ability's first gate is `input.dash !== null` ([`dash-ability.ts:71`](src/platformer/abilities/dash-ability.ts:71)). **Dash has never run in the showcase.**

**Host:** [`ldtk-editor/play.ts`](showcase/sections/ldtk-editor/play.ts) — spreads `PRECISION_PLATFORMER`, has climb and `stepHeight` live, clean `step(dt)` at [`:455`](showcase/sections/ldtk-editor/play.ts:455). Not `playground.ts` (a deliberate faithful port of an original game's raw physics — it zeroes coyote, buffer, cutoff, squash as a block, and disables dash) and not `tile-room.ts` (documented at [`:190`](showcase/sections/tile-room.ts:190) as existing so reviewers compare *rendering*, not feel).

Coyote and buffer are **already on** everywhere except the playground — `DEFAULT_JUMP` ships `0.08` / `0.1` ([`jump.ts:84`](src/animation/jump.ts:84)). No action beyond a comment noting the playground's zeroes are intentional.

### 2b. Dash startup phase — freeze *before* motion

Consumer-side hit-stop keyed on `dashStarted` observes the event only **after** the kernel has already applied a full tick of dash velocity. Celeste's ordering is the opposite:

```cs
private void DashBegin() { ... Celeste.Freeze(.05f); ... }   // Player.cs:3448 — freeze first

private IEnumerator DashCoroutine()
{
    yield return null;                                        // Player.cs:3550 — a frame passes
    var newSpeed = dir * DashSpeed;
    if (Math.Sign(beforeDashSpeed.X) == Math.Sign(newSpeed.X)
        && Math.Abs(beforeDashSpeed.X) > Math.Abs(newSpeed.X))
        newSpeed.X = beforeDashSpeed.X;                       // :3557 — keep faster same-dir speed
    Speed = newSpeed;                                         // :3559 — speed applied here
}
```

Two things fall out:

1. **A dash startup tick is required** — the dash direction is captured and the freeze fires *before* velocity is applied. Model it as a `startup` phase in the dash slice, emitting a pre-motion `dashStarting` event distinct from `dashStarted`.
2. **Same-direction speed preservation** (`:3557`) — a dash never *slows* you. Absent from every earlier draft; matters directly for the tech in Phase 5.

`[C: Celeste.Freeze(.05f)]` — a duration, transfers verbatim (3 ticks @ 60 Hz).

**Files:** `showcase/sections/ldtk-editor/play.ts`, `src/platformer/abilities/dash-ability.ts`, `src/platformer/types.ts`.

---

## Phase 3 — Run/air acceleration + decaying wall-slide

### 3a. Ground and air acceleration — and a correction to `RunReduce`

[`applyHorizontalInput`](src/platformer/kernel.ts:515) snaps to `±moveSpeed` on the ground and zeroes `vx` on release. Replace with rate-based approach.

**Earlier drafts misread `RunReduce`.** They mapped `400` to release-deceleration and proposed `groundDecel: 400`. The source (`Player.cs:2891-2894`) says otherwise:

```cs
if (Math.Abs(Speed.X) > max && Math.Sign(Speed.X) == moveX)
    Speed.X = Calc.Approach(Speed.X, max * moveX, RunReduce * mult * dt);  //Reduce back from beyond the max speed
else
    Speed.X = Calc.Approach(Speed.X, max * moveX, RunAccel * mult * dt);   //Approach the max speed
```

`RunReduce` applies **only when already above max speed and still holding that direction** — bleeding off overspeed from a dash or spring. Releasing input *and* reversing both use `RunAccel = 1000`. A `groundDecel = 400` would add markedly more skid than Celeste has.

Correct knobs:

| Knob | `[C]` | derivation | `[A]` |
|---|---|---|---|
| `runAccel` | `RunAccel 1000` | `/MaxRun 90 = 11.1 /s` → `× 200` | `≈ 2220 px/s²` |
| `overspeedReduce` | `RunReduce 400` | `= 0.4 × RunAccel` | `≈ 890 px/s²` |
| `airAccelMultiplier` | `AirMult .65` | ratio | `0.65` |
| `duckFriction` | `DuckFriction 500` | `= 0.5 × RunAccel` | `≈ 1110 px/s²` |

> **False friend:** Celeste's `AirMult` is `.65f` and aicraft's `airControl` is `0.65`. **Different quantities** — Celeste's multiplies the *accel rate* (`mult = onGround ? 1 : AirMult`, `Player.cs:2885`); aicraft's is a `dt`-free per-tick lerp fraction ([`kernel.ts:529`](src/platformer/kernel.ts:529)). The coincidence is not confirmation.

Use the **existing** [`approach()` at `src/primitives/pixel.ts:27`](src/primitives/pixel.ts:27) — already the exact `Calc.Approach` contract. Convert the air branch too; it is the kernel's only `dt`-free integration.

Surface modifiers become trivial once accel is a rate — Celeste's ice is `mult *= .3f` on the same line.

### 3b. Decaying wall-slide (missing from all earlier drafts)

aicraft clamps wall-slide at `wallSlideSpeed: 60` **forever** ([`wall-slide-ability.ts:97-101`](src/platformer/abilities/wall-slide-ability.ts:97)). Celeste's decays (`Player.cs:2933-2947`):

```cs
if ((moveX == (int)Facing || (moveX == 0 && Input.Grab.Check)) && Input.MoveY.Value != 1)
{
    ...
    max = MathHelper.Lerp(MaxFall, WallSlideStartMax, wallSlideTimer / WallSlideTime);
}
```

Three properties, none present in aicraft:

1. **Requires intent** — you must hold *into* the wall, or hold grab. aicraft slides on mere contact.
2. **Suppressed while fast-falling** (`Input.MoveY != 1`).
3. **The clamp eases** from `WallSlideStartMax 20` back toward `MaxFall 160` over `WallSlideTime 1.2s` — you slide slowly at first, then accelerate. A permanent clamp reads as sticky.

`[A]`: `wallSlideStartMax` pegged `20/160 = 0.125 × 600 = 75 px/s`; `wallSlideTime 1.2s` verbatim; ease toward `maxFallSpeed`.

This is a **more direct parity gap than analog input** and should precede wall-grab, which builds on the same contact/intent machinery. Needs §0e probes.

**Files:** `src/platformer/kernel.ts`, `src/platformer/constants.ts`, `src/platformer/abilities/wall-slide-ability.ts`.

---

## Phase 4 — 8-directional dash

`dirY` is hardcoded `0` ([`dash-ability.ts:82`](src/platformer/abilities/dash-ability.ts:82)).

### 4a. Add `moveY` to `PlatformerInput`
Add `readonly moveY?: -1 | 0 | 1`. Note the collision with the existing optional `climb: -1 | 0 | 1 | null`, already derived from the same up/down keys at [`play.ts:466`](showcase/sections/ldtk-editor/play.ts:466). Decide whether `climb` becomes a derived view of `moveY` or stays independent — do not leave two fields fed by one key pair. Bump `physicsVersion`.

Also unlocks **fast-fall**, which is not a clamp swap — `maxFall` is mutable state easing between limits at `FastMaxAccel * dt` in *both* directions (`Player.cs:2910-2924`). `[C: FastMaxFall 240/MaxFall 160 = 1.5]` → `[A: 900 px/s]`; `[C: FastMaxAccel 300]` pegged to gravity `300/900 = 0.33` → `[A: ≈327 px/s²]`.

### 4b. Direction capture
Capture `(dirX, dirY)` from `(moveX, moveY)` falling back to `facing`. **Normalize diagonals (÷ √2)** so diagonals aren't 41% faster. `[C: lastAim 8-dir vector × DashSpeed 240]`

### 4c. End-dash velocity
`Player.cs:3625-3632`:

```cs
if (DashDir.Y <= 0)
{
    Speed = DashDir * EndDashSpeed;   // absolute SET along the dash axis
    ...
}
if (Speed.Y < 0)
    Speed.Y *= EndDashUpMult;
```

Two corrections to earlier drafts: it is an **absolute set** to `dashDir × endDashSpeed`, not a multiplier on current speed; and it is **gated on `DashDir.Y <= 0`** — a downward dash keeps its accumulated speed untouched. `[C: EndDashSpeed/DashSpeed = 0.67]`, `[C: EndDashUpMult 0.75]`, both ratios, verbatim.

Depends on Phase 3: before it, `applyHorizontalInput` runs the same tick the dash timer expires ([`kernel.ts:241-245`](src/platformer/kernel.ts:241)) and destroys any carried velocity.

### 4d. Dash corner correction
Celeste has **two** corner-correction systems: `UpwardCornerCorrection = 4` (jump, `:2591`, `:2603`) and `DashCornerCorrection = 4` (dash, five sites: `:2408`, `:2511`, `:2524`, `:2668`, `:2682`). The dash variant belongs here, with 8-directional dash; the jump variant is Phase 7.

> **Pegging-rule violation to fix:** earlier drafts copied `4` as a magnitude, which the rule forbids. It is a *pixel tolerance*, so peg it to body width or tile size — `4/8 = 0.5 tile` → `[A: 8px at 16px tiles]` — or select it from measured collision tolerance. Do not copy `4`.

---

## Phase 5 — Explicit super / hyper / wavedash

**Dash-tech does not emerge from end-dash carry.** Both the original doc and the first revision of this critique claimed it did. It is false: these are hand-written moves with their own constants (`Player.cs:68-73`) and dispatch sites.

**Correct trigger conditions** (`Player.cs:3495-3524`) — earlier drafts guessed "grounded + `dashAttackTimer`", wrong on both counts:

| Move | Trigger | Source |
|---|---|---|
| **Super jump** | `DashDir.Y == 0` (horizontal dash) `&& Input.Jump.Pressed && jumpGraceTimer > 0` | `:3495-3507` |
| **Super wall jump** | `DashDir.X == 0 && DashDir.Y == -1` (straight-up dash) `&& WallJumpCheck(±1)` | `:3510-3524` |

It is **coyote grace**, not a dash-attack timer, and each is gated on a specific dash direction.

**The hyper is a two-stage mechanism.** A down-diagonal dash on the ground converts to a ducking horizontal slide (`Player.cs:3578-3585`):

```cs
if (onGround && DashDir.X != 0 && DashDir.Y > 0 && Speed.Y > 0 ...)
{
    DashDir.X = Math.Sign(DashDir.X); DashDir.Y = 0;
    Speed.Y = 0;
    Speed.X *= DodgeSlideSpeedMult;    // 1.2
    Ducking = true;
}
```

…and `SuperJump` out of that ducking state applies further multipliers (`Player.cs:1711-1715`):

```cs
if (Ducking) { Ducking = false; Speed.X *= DuckSuperJumpXMult; Speed.Y *= DuckSuperJumpYMult; }  // 1.25×, 0.5×
```

So the hyper's speed is `SuperJumpH 260 × 1.2 × 1.25`, with vertical halved — a fast, flat trajectory. Reproducing it requires **ducking** as a real state, plus `DodgeSlideSpeedMult`, both duck multipliers, ground-entry tracking (`dashStartedOnGround`, `Player.cs:3444`), and the §2b startup timing.

Ratio-derived targets:

| Knob | `[C]` | peg | `[A]` |
|---|---|---|---|
| `superJumpVx` | `SuperJumpH 260` | `/MaxRun 90 = 2.89` | `≈ 578` |
| `superJumpVy` | `= JumpSpeed` | — | `≈ -343` |
| `superWallJumpVx` | `SuperWallJumpH 170` | `/MaxRun 90 = 1.89` | `≈ 378` |
| `superWallJumpVy` | `SuperWallJumpSpeed -160` | `/JumpSpeed 105 = 1.52` | `≈ -523` |
| `dodgeSlideSpeedMult` | `1.2` | ratio | `1.2` |
| `duckSuperJumpXMult` / `YMult` | `1.25` / `.5` | ratio | verbatim |

Every one of these writes through the §0b launch contract and consumes the §0c shared buffer — which is why Phase 0 precedes it.

---

## Phase 6 — Wall-grab + stamina

Now safe: §0d gives exclusivity, §0e gives probes that survive `vx = 0`, §0b/§0c give a launch contract that doesn't discard the climb-jump.

New `wallGrabAbility` module claiming exclusive mode `'wallGrab'`. **Do not** read wall presence from `contacts` (§0e).

- **Stamina** (rates are scale-independent — verbatim): `wallGrabMaxStamina 110` `[C: ClimbMaxStamina]`; up-cost `100/2.2 ≈ 45.45/s`; still-cost `10/s`; climb-jump cost `110/4 = 27.5`; refill on ground. *(Celeste derives per-second costs from `100` but the pool from `110`; copy both as-is.)*
- **Climb speed:** `[C: ClimbUpSpeed -45, ClimbDownSpeed 80]`, pegged to aicraft's `climbSpeed 120`.
- **Climb-hop is 2D** — `ClimbHopY -120` **and** `ClimbHopX 100`, over `ClimbHopForceTime .2s`, driving `forceMoveX` from §0c. Earlier drafts had only `ClimbHopY`.
- **Climb-jump leniency:** `ClimbJumpBoostTime .2s`, `ClimbUpCheckDist 2`.
- Off by default (`wallGrabEnabled: false`), matching `climbEnabled`.

**Files:** new `src/platformer/abilities/wall-grab-ability.ts`; edits to `types.ts`, `constants.ts`, `pipelines.ts`, `kernel.ts`; tests.

---

## Phase 7 — Jump corner correction + wall-speed retention

- **Upward corner correction** — `[C: UpwardCornerCorrection 4]`, pegged not copied (see §4d). Reconcile with the existing `stepHeight` nudge machinery ([`kernel.ts:303-322`](src/platformer/kernel.ts:303), [`:600-627`](src/platformer/kernel.ts:600)), which already does bounded position probing on wall contact — extend it or deliberately don't, but decide.
- **Wall-speed retention** — `[C: WallSpeedRetentionTime .06f]` (`Player.cs:54`), a duration, verbatim. Stash `vx` on wall contact; restore if the path clears before expiry.

Wall-jump buffering is **not** here — it moved to §0c as shared state.

---

## Phase 8 — Springs, dash refills, and presentation FX

### 8a. Interaction model — not boolean events

The kernel receives `Solid[]`, **not level entities**. Boolean `springLaunched` / `dashRefilled` events cannot say *which* refill was consumed, and so cannot support per-entity cooldown or respawn — the core of Celeste's dash-refresh loop.

Use identified interaction events with consumer-owned entity state:

```ts
interface InteractionEvent {
  readonly kind: 'spring' | 'dashRefill';
  readonly entityId: string;
}
```

The kernel reports *what was touched*; the consumer owns cooldowns, respawn timers, and visuals.

> **Missed file dependency:** adding any field to `PlatformerEvents` requires updating the exhaustive initializer in **all five** ability files (`jump`, `wallSlide`, `dash`, `doubleJump`, `climb` — each spells out every event field, e.g. [`jump-ability.ts:61-70`](src/platformer/abilities/jump-ability.ts:61)) plus `EMPTY_EVENTS` ([`constants.ts:73`](src/platformer/constants.ts:73)). Earlier drafts' file lists omitted all six.

### 8b. Entity kinds & spring values
Add `'spring'` / `'dashRefill'` to `EntityKind` ([`level/types.ts:43`](src/level/types.ts:43)) with props following the established convention.

Spring launches route through the §0b launch contract — otherwise the jump slice discards them, exactly as it currently discards double-jump.

```
[C: Bounce 140 / JumpSpeed 105      = 1.33]  →  [A: ≈ -460]
[C: SuperBounce 185 / JumpSpeed 105 = 1.76]  →  [A: ≈ -605]
```

Plus `BounceAutoJumpTime .1`, `BounceVarJumpTime .2` — springs open the shared variable-jump window and auto-rejump.

### 8c. FX
Squash is **per-event**, not one global pair: `(.6, 1.4)` jump/dash, `(.8, 1.2)` softer beats, `(1.5, .5)` / `(1.4, .6)` horizontal impacts, and fast-fall lerps toward `(.5, 1.5)` (`Player.cs:2918-2920`). Ease-back is verbatim `Calc.Approach(scale, 1f, 1.75f * dt)` (`Player.cs:1165`).

---

## Phase 9 — Analog input (engine extension, *not* Celeste parity)

Earlier drafts cited `[C: analog aim/walk]`. **Celeste has no analog walk.** `moveX = Input.MoveX.Value` is an integer (`Player.cs:770`); `lastAim = Input.GetAimVector(Facing)` (`Player.cs:797`) is a *separate* aiming vector used for dash direction, not locomotion.

Phase 9 is a legitimate aicraft extension — just not parity. Widen `moveX` to `number`; keep edge detection magnitude-independent. Changes `ReplayFrame`; bump `physicsVersion` and update [`replay.test.ts:55`](src/tests/replay.test.ts:55).

If 8-directional *aim* is the actual goal, that is Phase 4, and it is already digital in Celeste.

---

## Execution order

```
0a harness  →  0b–0e refactor  →  1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9
(baseline)     (classify diffs)
```

**The harness is the first commit, not the first refactor.** §0a lands on unmodified `main` and records baseline traces; §0b–§0e then change those traces on purpose, and each diff gets classified. Reversing this means validating the new physics only against itself.

| Phase | Why here |
|---|---|
| **0a** Multi-tick harness | First. Captures current behavior before anything moves, so §0b–§0e's diffs are legible. |
| **0b–0e** Physics authority & arbitration | Blocking. Every later number is meaningless until velocity has one owner. |
| **1** Replay `physicsVersion` | Phase 0 changes every trajectory; land versioning before more churn. |
| **2** Input wiring + dash startup ordering | Dash has never run; startup phase is a structural prerequisite for FX. |
| **3** Run/air accel + decaying wall-slide | Both are direct parity gaps; 4c depends on the accel rewrite. |
| **4** 8-directional dash | Needs 2 and 3. |
| **5** Super / hyper / wavedash | Explicit moves; needs 0b/0c contracts and 4's direction gating. |
| **6** Wall-grab + stamina | Needs 0d exclusivity and 0e probes. |
| **7** Corner correction + wall-speed retention | Small, follows the collision work in 0e/4d. |
| **8** Springs, refills, FX | Mostly plumbing; needs 0b so launches survive. |
| **9** Analog input | Optional extension, not parity. Lowest ROI. |

Every phase extends the §0a harness with new multi-tick sequences, updates `ldtk-editor/play.ts` to exercise the change, and adds constants/preset entries. Phases that alter trajectories re-baseline the fixtures deliberately and bump `physicsVersion`.

---

## Open questions

- **§0d:** does `ladder` become a locomotion mode, or stay the current `isClimbActive` special case? Folding it in is more consistent but touches working code.
- **§0b:** does `jump.ts` remain the trajectory owner with `core.vy` mirrored out, or does the kernel own integration and `jump.ts` reduce to phase/timers? The latter is cleaner; the former is a smaller diff.
- **§1:** reject or migrate on `physicsVersion` mismatch?
- **§4a:** `climb` as a derived view of `moveY`, or independent?
- **§5:** is ducking in scope? Without it there is no hyper — only super-jump and super-wall-jump.
- **§7:** extend `stepHeight`'s nudge machinery or add a separate pass?

---

## Appendix: verified Celeste constants

All values verified against `Player.cs` @ `master`. **A correct constant does not imply a correct mechanism** — §3a (`RunReduce`), §4c (end-dash), §5 (tech triggers), and the old §1e (half-gravity, fast-fall) were each mis-specified around an accurate number. Read the call site.

| Category | Field | Value | Line | Used by |
|---|---|---|---|---|
| Gravity | `Gravity` / `MaxFall` | `900` / `160` | `:24`, `:23` | 0b, 3a |
| Gravity | `HalfGravThreshold` | `40` — **gated on `Input.Jump.Check`** (`:2952`) | `:25` | 0b |
| Gravity | `FastMaxFall` / `FastMaxAccel` | `240` / `300` | `:27`, `:28` | 4a |
| Run | `MaxRun` / `RunAccel` | `90` / `1000` | `:30`, `:31` | 3a |
| Run | `RunReduce` | `400` — **overspeed only** (`:2891`) | `:32` | 3a |
| Run | `AirMult` / `DuckFriction` | `.65` / `500` | `:33`, `:40` | 3a |
| Jump | `JumpSpeed` / `JumpHBoost` | `-105` / `40` (additive, `:1670`) | `:49`, `:50` | 0b |
| Jump | `JumpGraceTime` / `VarJumpTime` | `0.1` / `.2` | `:48`, `:51` | 0c |
| Jump | `CeilingVarJumpGrace` | `.05` | `:52` | 0c |
| Corner | `UpwardCornerCorrection` / `DashCornerCorrection` | `4` / `4` — **two systems** | `:53`, `:82` | 7, 4d |
| Wall | `WallSpeedRetentionTime` | `.06` | `:54` | 7 |
| Wall | `WallJumpCheckDist` | `3` | `:56` | 0e |
| Wall | `WallJumpForceTime` / `WallJumpHSpeed` | `.16` / `130` | `:57`, `:58` | 0c |
| Wall-slide | `WallSlideStartMax` / `WallSlideTime` | `20` / `1.2` — **lerped** (`:2947`) | `:60`, `:61` | 3b |
| Super | `SuperJumpSpeed` / `SuperJumpH` | `= JumpSpeed` / `260` | `:68`, `:69` | 5 |
| Super | `SuperWallJumpSpeed` / `H` | `-160` / `170` | `:70`, `:73` | 5 |
| Super | `DodgeSlideSpeedMult` | `1.2` | `:44` | 5 |
| Super | `DuckSuperJumpXMult` / `YMult` | `1.25` / `.5` | `:45`, `:46` | 5 |
| Dash | `DashSpeed` / `EndDashSpeed` / `EndDashUpMult` | `240` / `160` / `.75` | `:75`-`:77` | 4c |
| Dash | `DashTime` / `DashCooldown` / `DashRefillCooldown` | `.15` / `.2` / `.1` | `:78`-`:80` | 2b, 8 |
| Dash | `DashAttackTime` | `.3` | `:84` | 5 |
| Dash | `DashHJumpThruNudge` / `DashVFloorSnapDist` | `6` / `3` | `:81`, `:83` | 7 |
| Dash | Freeze on start | `Celeste.Freeze(.05f)` — **before motion** (`:3448`, `:3550`) | — | 2b |
| Climb | `ClimbMaxStamina` | `110` | `:102` | 6 |
| Climb | `ClimbUpCost` / `StillCost` / `JumpCost` | `100/2.2` / `100/10` / `110/4` | `:103`-`:105` | 6 |
| Climb | `ClimbUpSpeed` / `ClimbDownSpeed` | `-45` / `80` | `:110`, `:111` | 6 |
| Climb | `ClimbHopY` / `ClimbHopX` / `ForceTime` | `-120` / `100` / `.2` | `:115`-`:117` | 6 |
| Climb | `ClimbJumpBoostTime` / `ClimbUpCheckDist` | `.2` / `2` | `:118`, `:107` | 6 |
| Bounce | `BounceSpeed` / `SuperBounceSpeed` | `-140` / `-185` | `:64`, `:66` | 8b |
| Bounce | `BounceAutoJumpTime` / `BounceVarJumpTime` | `.1` / `.2` | `:38`, `:63` | 8b |
| Squash | ease rate | `1.75/sec` toward 1 (`:1165`) | — | 8c |

### Scaling: there is no single conversion factor

Measured ratios span **1.09× to 3.75×** — these are unrelated tunings, not a scaled port:

| Quantity | Celeste | aicraft | ratio |
|---|---|---|---|
| gravity (`PlatformerConfig`) | `900` | `980` | 1.09× |
| gravity (derived in `jump.ts`) | `900` | `1225` | 1.36× |
| dash speed | `240` | `420` | 1.75× |
| run speed | `90` | `200` | 2.22× |
| launch velocity | `105` | `343` | 3.27× |
| max fall | `160` | `600` | 3.75× |

**The pegging rule:** `[A] = celesteValue / celesteReference × aicraftReference`. Never transfer a magnitude. Timings, ratios, and per-second rates transfer verbatim; everything else must be pegged and must show its derivation.

Note the two gravities: `PlatformerConfig.gravity` (980) and the value `jump.ts` derives from `apexHeight`/`timeToApex` (1225). §0b resolves which is authoritative.

**Not ported, deliberately:** hair-color constants and the 23 player states (`Player.cs:140-162` — `const int` `0..22` on a `StateMachine`, not a C# `enum`). §0d adopts the *idea* of exclusive modes with four, not twenty-three.
