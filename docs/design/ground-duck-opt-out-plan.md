# Ground Duck Opt-Out Plan

## Status

- Status: Proposed
- Scope: Platformer kernel configuration and LDtk editor showcase
- Compatibility goal: Preserve the existing Celeste-faithful behavior by default
- Showcase goal: Let Down/S retain ladder descent and air fast-fall without causing a stationary ground crouch
- Proposed config name: `groundDuckEnabled`

## Problem

The LDtk editor showcase maps Down/S to `PlatformerInput.moveY = 1`. When the
player is grounded in normal locomotion, the kernel interprets that input as a
request to duck and latches `locomotion.ducking = true`. Horizontal input is
then ignored while `vx` approaches zero at `duckFriction`, so a player holding
Down/S and Left/Right appears to become stuck.

That behavior is intentional in the precision-platformer kernel: ducking is a
stationary Celeste-style crouch and is part of the hyper-slide to duck-super-
jump movement chain. It is a poor fit for the LDtk showcase because the
showcase has no crouch sprite, affordance, instruction, or drop-through action
that explains why Down/S stops horizontal movement.

The vertical input cannot simply be removed from the showcase. The same
`moveY` channel is also used for:

- Ladder ascent and descent.
- Air fast-fall cap easing.
- Vertical and diagonal dash direction.
- Wall-slide suppression while fast-falling.
- Wall-grab vertical movement.

Suppressing `moveY` only while the showcase player appears grounded is also
the wrong layer: the showcase would have to mirror kernel locomotion state to
distinguish ordinary ground movement from ladders, wall grabs, dash aiming,
and other ability-owned modes. A kernel configuration switch keeps that state
decision with the system that owns it.

## Root Cause

The relevant flow is:

1. `showcase/sections/ldtk-editor/play.ts` maps held Down/S to `moveY = 1`.
2. The grounded, normal-mode duck-maintenance branch in
   `src/platformer/kernel.ts` sets `locomotion.ducking = true`.
3. `applyHorizontalInput` sees `ducking && core.onGround`, ignores horizontal
   intent, and bleeds `vx` toward zero using `config.duckFriction`.

Hyper-slides establish ducking through a separate path:
`src/platformer/abilities/dash-ability.ts` emits
`locomotionPatch: { ducking: true }` when a down-diagonal grounded dash becomes
a hyper-slide. The kernel applies that patch before duck maintenance. The new
configuration must not gate or clear this ability-owned patch.

## Decision

Add an optional `groundDuckEnabled` configuration field whose default behavior
is enabled:

```ts
readonly groundDuckEnabled?: boolean;
```

The kernel will establish a new grounded duck from held Down only when:

```ts
config.groundDuckEnabled !== false
```

Use `groundDuckEnabled`, not `duckEnabled`. The latter would read as a master
switch for every source of ducking, while the required behavior leaves hyper-
induced ducking and duck-super-jump tech intact.

The field remains optional so existing manually constructed
`PlatformerConfig` objects retain the old default-on behavior. Add
`groundDuckEnabled: true` to `DEFAULT_PLATFORMER_CONFIG` so the canonical
configuration and its derived presets are explicit and self-documenting.

## Behavioral Contract

When `groundDuckEnabled` is absent or `true`:

- Grounded Down in normal locomotion establishes ducking.
- Ducking blocks horizontal control and uses `duckFriction`.
- Existing precision-platformer behavior is unchanged.

When `groundDuckEnabled` is `false`:

- Grounded Down alone does not establish a new duck.
- Left/Right remains responsive while Down is held on ordinary ground.
- Pressing Up still clears an existing duck.
- Leaving the ground still clears ducking in normal locomotion.
- Dash, ladder, and wall-grab modes carry the existing duck through the outer
  mode guard; they do not run the normal-mode airborne clearing branch.
- A hyper-slide may still establish ducking through its locomotion patch.
- Hyper-induced ducking still persists after the dash until jump, airborne
  movement, or Up clears it.
- Duck-super-jump/wavedash multipliers remain available.
- Ladder descent, wall-grab descent, air fast-fall, dash aiming, and wall-slide
  suppression continue to read `moveY` unchanged.

## Implementation Plan

### 1. Add the public configuration field

File: `src/platformer/types.ts`

- Add `readonly groundDuckEnabled?: boolean` in the Phase 5 ducking section,
  near `duckFriction`.
- Document that it controls only the grounded Down-input latch.
- Document absent as enabled.
- State explicitly that it does not disable ability-owned ducking such as a
  hyper-slide patch.
- Update the `LocomotionState.ducking` documentation so grounded Down is
  conditional on `groundDuckEnabled !== false`.
- Keep the hyper-slide path described as unconditional; the new switch must
  not read as though it gates both sources of ducking.

### 2. Make the canonical default explicit

File: `src/platformer/constants.ts`

- Add `groundDuckEnabled: true` to `DEFAULT_PLATFORMER_CONFIG` in the Phase 5
  block.
- Update the Phase 5 derivation/default comments to describe the switch as
  default-on.
- Do not change `duckFriction` or any hyper/dash-tech tuning value.

All named presets spread `DEFAULT_PLATFORMER_CONFIG`, so no individual preset
change is required. `groundDuckEnabled` is the natural future opt-out for a
non-precision preset; if such a preset also has dash disabled, opting out would
intentionally leave it with no route into ducking at all.

### 3. Gate only the grounded Down latch

File: `src/platformer/kernel.ts`

- Preserve the existing control-flow structure exactly:
  - A launch clears ducking earlier in launch application, and
    `!launchFired` skips maintenance for that tick.
  - The outer `mode === 'normal'` guard means dash, ladder, and wall-grab modes
    carry the current value without entering this block.
  - Inside normal mode, airborne movement clears ducking; grounded Down may
    establish it; grounded Up clears it; and neutral grounded input carries it
    through an implicit fall-through.
- Change only the branch that creates a new duck from grounded `moveY === 1`:

```ts
} else if (
  (input.moveY ?? 0) === 1 &&
  config.groundDuckEnabled !== false
) {
  if (!locomotion.ducking) locomotion = { ...locomotion, ducking: true };
}
```

- Do not restructure the `if`/`else if` chain or add an explicit carry
  assignment. The grounded-neutral carry behavior is deliberately the result
  of no branch assigning a new value.
- Do not include `groundDuckEnabled` in the condition passed to
  `applyHorizontalInput`. An already-active hyper duck must continue to apply
  duck friction even when the grounded input latch is disabled.
- Update the duck-maintenance comments to distinguish input-induced ducking
  from ability-induced ducking.

### 4. Opt the LDtk showcase out

File: `showcase/sections/ldtk-editor/play.ts`

- Add `groundDuckEnabled: false` to `playConfigFor`.
- Add a short comment explaining that Down/S remains assigned to vertical
  intent for ladders and fast-fall, while ordinary grounded movement should
  not enter an invisible stationary crouch.
- Do not alter keyboard bindings or the `moveY` calculation.

### 5. Add regression coverage

Primary file: `src/tests/platformer-dash-tech.test.ts`

Add focused kernel-level tests covering both sides of the contract.

#### Ground latch remains default-on

- Start grounded with `vx = 0`.
- Step with `moveX = 1` and `moveY = 1` using the default config.
- Assert `locomotion.ducking === true`.
- Assert horizontal acceleration is suppressed (`vx === 0`).

This pins backward-compatible default behavior rather than relying only on the
existing tests: no current test isolates the latch from rest with zero
horizontal velocity and directly proves that acceleration is suppressed.

#### Ground latch can be disabled

- Use `{ ...DEFAULT_PLATFORMER_CONFIG, groundDuckEnabled: false }`.
- Start grounded with `vx = 0`.
- Step with `moveX = 1` and `moveY = 1`.
- Assert `locomotion.ducking === false`.
- Assert `vx > 0`.
- Compare against a control tick with the same config and `moveY = 0`; the
  horizontal results should match.

Starting from rest makes the assertion unambiguous: the test proves horizontal
input is honored, not merely that an actor with inherited momentum has not yet
reached zero.

#### Hyper duck remains enabled

- Run the existing full hyper-slide trace with
  `groundDuckEnabled: false`.
- Assert the hyper transition still produces `locomotion.ducking === true`.
- Release Down after dash expiry and assert the hyper-induced duck still
  latches and applies `duckFriction`.
- Trigger the follow-up jump and assert the duck-super-jump/wavedash velocity
  multipliers still apply and ducking clears on launch.

The test should exercise the full pipeline rather than unit-testing a manually
constructed locomotion patch, because the regression risk is the ordering
between the dash ability patch and kernel duck maintenance.

#### Related behavior remains independent

Existing fast-fall, wall-grab, and dash-tech tests already cover the shared
`moveY` paths. Run them as targeted regression suites. Add new assertions only
if implementation changes touch those paths.

### 6. Version deterministic replay physics

File: `src/replay/constants.ts`

- Bump `CURRENT_PHYSICS_VERSION` from `9` to `10`.
- Add a Phase 10 history entry describing the optional grounded-duck latch and
  why configurations with `groundDuckEnabled: false` can produce horizontal
  trajectories that did not exist before this configuration shape.
- Describe the bump as a schema/phase convention consistent with prior
  physics-affecting config and input-shape additions. Default/absent behavior
  remains trajectory-compatible with version 9, so rejecting old recordings
  is not required to preserve their default trajectories; the version bump
  keeps the replay contract explicit across the new configurable behavior.

File: `src/tests/platformer-traces.test.ts`

- Rebaseline all `replayHashFor` canaries. Two independent serialized changes
  affect those hashes: the explicit `groundDuckEnabled: true` field inside the
  captured platformer config and the `9` to `10` physics-version value. Either
  change would move a replay hash because both are canonicalized replay data.
- Do not present hash movement as the purpose of the version bump. Hash changes
  are a mechanical result of serialized data; physics versioning identifies
  the replay contract and lets playback reject recordings from a different
  declared phase.
- Existing digital-input `traceHash` canaries should remain unchanged because
  default behavior remains enabled.
- If a default-config `traceHash` changes, treat that as an implementation bug
  unless the change is separately explained and approved.

### 7. Update public documentation references

At minimum, update comments in:

- `src/platformer/types.ts`
- `src/platformer/constants.ts`
- `src/platformer/kernel.ts`

Search documentation for unconditional statements that grounded Down always
sets ducking and qualify them with the new configuration switch. Do not rewrite
the Celeste-faithful explanation: it remains the canonical default behavior.

## Files Expected to Change

| File | Change |
|---|---|
| `src/platformer/types.ts` | Add and document `groundDuckEnabled`; qualify the grounded source in `LocomotionState.ducking` docs while preserving the unconditional hyper source |
| `src/platformer/constants.ts` | Set explicit default `true` and document it |
| `src/platformer/kernel.ts` | Gate only grounded Down-induced duck creation |
| `showcase/sections/ldtk-editor/play.ts` | Set `groundDuckEnabled: false` |
| `src/tests/platformer-dash-tech.test.ts` | Add default-on, opt-out, and hyper-preservation tests |
| `src/replay/constants.ts` | Bump physics version to 10 and record the change |
| `src/tests/platformer-traces.test.ts` | Rebaseline replay hash canaries; preserve trace canaries |

Additional documentation files may change if the final search finds public
descriptions of unconditional ground ducking.

## Verification

Run targeted tests first:

```sh
npm test -- --run \
  src/tests/platformer-dash-tech.test.ts \
  src/tests/platformer-fast-fall.test.ts \
  src/tests/platformer-wall-grab.test.ts \
  src/tests/platformer-wall-slide.test.ts \
  src/tests/platformer-traces.test.ts
```

Then run full validation:

```sh
npm run build
npm test
npm run showcase:typecheck
npm run showcase:test
```

Manually verify the LDtk editor showcase:

1. On ordinary ground, hold Down/S and Left/Right; horizontal movement remains
   responsive.
2. On a ladder, Down/S descends and Up/W ascends.
3. In the air, holding Down/S still enables fast-fall behavior.
4. A grounded down-diagonal dash still becomes a hyper-slide.
5. Jumping from the hyper-induced duck still produces the intended fast, flat
   duck-super-jump/wavedash.

## Acceptance Criteria

- The LDtk showcase no longer appears stuck when Down/S and a horizontal
  direction are held on ordinary ground.
- Default platformer behavior remains Celeste-faithful and byte-identical at
  the trajectory level.
- `groundDuckEnabled: false` prevents only the grounded Down-input duck latch.
- Hyper-induced ducking, duck friction, and duck-super-jump/wavedash remain
  functional with the flag disabled.
- Ladder descent, wall-grab descent, fast-fall, dash direction, and wall-slide
  suppression retain their existing `moveY` behavior.
- Replay physics version is 10, replay hashes are intentionally rebaselined,
  and unchanged default trace hashes remain stable.
- Build, full tests, showcase typecheck, and showcase tests pass.

## Non-Goals

- Add crouch animation or a duck sprite to the LDtk showcase.
- Implement one-way-platform drop-through.
- Remove or remap Down/S vertical input.
- Disable hyper-slides or duck-super-jump movement tech.
- Change duck friction or other movement tuning.
- Introduce a global master switch that prevents every source of ducking.
