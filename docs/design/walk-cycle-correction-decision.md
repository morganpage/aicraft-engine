# Decision: Walk-Cycle Direction Correction

> Date: 2026-06-19.
> Decided by: @team (orchestrator).
> Proposal: `docs/design/jump-walk-proposal.md` (lines 116-118, 524-560 — original API contract).
> Prior-art: `docs/research/walk-cycle-direction-conventions.md`.
> Benchmark: `benchmarks/animation/walk-cycle-right-diagnostic.png`, `benchmarks/animation/walk-cycle-left-diagnostic.png`.
> Architect critique: NEEDS REVISION (documentation completeness — resolved by this doc).
> Type: Behavioural correction to two shipped APIs (no signature changes).

## Problem statement

Two user-reported bugs in the walk-cycle rendering:

1. **Walk-right looks backwards (moonwalk).** The character walks right but the feet swing backward while lifted — the foot lifts during the stance half-cycle instead of the swing half-cycle.
2. **Walk-left "resets mid-cycle."** When the character turns around and walks left, the gait phase appears to jump or reverse. Ironically, walk-left was accidentally correct while walk-right was broken.

Both bugs are user-visible in the showcase (`showcase/helpers/slime-knight.ts`).

## Root cause analysis

### Bug 1: Inverted foot-lift half-cycle in `evaluateLocomotion`

The foot-lift formula in `evaluateLocomotion` uses `max(0, sin(phi))` to clamp vertical offset to non-negative (foot lifts above ground, never clips below). During `phi ∈ [0, π]`, `sin(phi)` is positive, so the foot lifts. But during this same half-cycle, `cos(phi)` moves from `+1 → −1` (front-to-back). This means the foot is **lifted while moving backward** — the definition of moonwalking.

The canonical walk-cycle convention (Richard Williams' *The Animator's Survival Kit*, Unreal/Unity locomotion blend spaces, Wolfire's *Overgrowth* devlog, Sokpop 2D characters) requires the foot to lift during the **forward swing** (`phi ∈ [π, 2π]`), where `cos(phi)` moves from `−1 → +1` (back-to-front).

**Fix:** `max(0, sin(phi))` → `max(0, -sin(phi))` for both feet. The negated sine is positive during `[π, 2π]` (swing phase), aligning foot lift with forward motion.

### Bug 2: World-space `dx` passed to displacement integrator with geometry mirror

`stepHero` in `showcase/helpers/slime-knight.ts` passes signed world-space `dx` (negative when walking left) to `advanceLocomotionByDisplacement`. For leftward walking, this reverses the phase direction. The renderer simultaneously applies `ctx.scale(facing, 1)` which mirrors the geometry horizontally. Two reversals:

- **Phase reversal:** `dx < 0` makes `dPhase < 0`, running the gait backward.
- **Geometry reversal:** `ctx.scale(-1, 1)` flips all horizontal coordinates.

These cancel out, making walk-left accidentally look correct. But the underlying gait direction is wrong — the phase runs backward, and the mirror flips it back. This creates the visual "reset" artifact on turnaround: the gait direction flips when `facing` changes, and the transition between "accidentally correct left" and "broken right" produces a visible pop.

**Fix:** Pass `dx * facing` (local-space displacement) to `advanceLocomotionByDisplacement`. The phase always advances forward in local space; `ctx.scale(facing, 1)` handles the visual direction.

### Coupling

The two bugs are coupled. Fixing only one makes the other direction worse:

- Fix Bug 1 alone (negate sine) without Bug 2: walk-right becomes correct, but walk-left now moonwalks (the phase was reversed by world-space `dx`, and the negated sine now correctly lifts during swing — but the swing is visually backward due to the double-reversal being partially broken).
- Fix Bug 2 alone (`dx * facing`) without Bug 1: both directions now advance the phase correctly, but the foot still lifts during stance — both directions moonwalk.

Both fixes must ship together.

## Evidence

| Evidence | What it shows |
|---|---|
| `benchmarks/animation/walk-cycle-right-diagnostic.png` | Walk-right: foot lifts while swinging backward (moonwalk). Confirms Bug 1. |
| `benchmarks/animation/walk-cycle-left-diagnostic.png` | Walk-left: gait phase reverses on turnaround, producing a visual reset pop. Confirms Bug 2. |
| `docs/research/walk-cycle-direction-conventions.md` §Pattern 1 | Prior art confirms `max(0, -sin(phi))` is the correct lift formula for cosine-driven horizontal swing. |
| `docs/research/walk-cycle-direction-conventions.md` §Pattern 2 | Prior art confirms local-space displacement (`dx * facing`) is the correct integration boundary when geometry mirroring is used. |

## The fix

### `evaluateLocomotion` — foot-lift correction

```ts
// BEFORE (broken — lifts during stance [0, π]):
y: Math.max(0, Math.sin(phi)) * config.strideHeight,

// AFTER (correct — lifts during swing [π, 2π]):
y: Math.max(0, -Math.sin(phi)) * config.strideHeight,
```

Applied to both `leftFootOffset.y` and `rightFootOffset.y` (the right foot uses `phi + π`, so the negation applies to both uniformly).

### `stepHero` — local-space displacement

```ts
// BEFORE (broken — world-space signed dx):
advanceLocomotionByDisplacement(loco, dx, DEFAULT_GAIT);

// AFTER (correct — local-space displacement):
advanceLocomotionByDisplacement(loco, dx * facing, DEFAULT_GAIT);
```

### `advanceLocomotionByDisplacement` — unchanged

The library function itself is **not modified**. It remains a pure signed-`dx` integrator: positive `dx` advances phase forward, negative `dx` runs it backward. This is correct — the function is general-purpose and supports backpedaling when consumers intentionally pass negative local-space displacement.

A JSDoc warning is added to `advanceLocomotionByDisplacement`:

> ⚠ **Mirror interaction:** When the renderer applies a horizontal mirror (`ctx.scale(facing, 1)`), `dx` must be local-space displacement (`dx * facing`, not world-space `dx`). Passing world-space `dx` with a mirror causes a double-reversal: the phase runs backward while the geometry flips, producing a moonwalk. See `docs/design/walk-cycle-correction-decision.md`.

## Why `dx * facing` instead of `Math.abs(dx)`

`dx * facing` is semantically **local-space displacement**:

| Scenario | `dx` | `facing` | `dx * facing` | Phase | Visual |
|---|---|---|---|---|---|
| Walk right, face right | `+5` | `+1` | `+5` | Forward | Correct |
| Walk left, face left | `−5` | `−1` | `+5` | Forward | Correct |
| Walk left, face right (backpedal) | `−5` | `+1` | `−5` | Backward | Correct backpedal |
| Walk right, face left (backpedal) | `+5` | `−1` | `−5` | Backward | Correct backpedal |

`Math.abs(dx)` would play a forward walk during backpedaling — the feet would swing forward while the character retreats, which is visually wrong. `dx * facing` naturally handles all four cases because it preserves the sign relationship between movement direction and facing direction.

## Behavioural breaking change note

`evaluateLocomotion` now returns different `leftFootOffset.y` / `rightFootOffset.y` values at most phases. Same inputs → different outputs. The function signature is unchanged. The types are unchanged. This is a **behavioural correction**, not a signature change.

No external consumers exist yet (the library is consumed only by the reference implementation, which has not yet integrated the submodule). The change protocol requires this decision doc to record the correction. If consumers existed, this would require a minor version bump.

## Known follow-up

The `max(0, -sin(phi))` clamp introduces a **C1 discontinuity** (velocity pop) at the plant/lift-off points (`phi = 0, π`). At these phase values, `−sin(phi) = 0`, and the `max(0, ...)` clamp creates a hard transition from grounded to airborne. The foot's vertical velocity jumps discontinuously. This is a minor visual issue flagged by the benchmarker and architect — it produces a subtle "pop" at the moment of foot contact/lift-off.

This is **separate from the two corrected bugs** and is out of scope for this correction. It can be smoothed in a follow-up by squaring the lift curve (e.g., `max(0, -sin(phi))²`) or using a smootherstep clamp, which eliminates the C1 discontinuity while preserving the correct swing/stance alignment.

## Implementation notes for @coder

1. Change `Math.sin(phi)` → `-Math.sin(phi)` in `evaluateLocomotion` for both foot offset `y` computations. No other changes to this function.
2. Change the `stepHero` call site in `showcase/helpers/slime-knight.ts`: `dx` → `dx * facing`.
3. Add the JSDoc mirror-interaction warning to `advanceLocomotionByDisplacement`.
4. Update the golden snapshot in `src/tests/locomotion.test.ts` — the foot-lift values will change at every phase except `phi = 0, π` (where `sin = 0` regardless of sign).
5. No signature changes. No type changes. No new exports. No new dependencies.
