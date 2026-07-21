# API Proposal: Idle Foot Stance Blend

> Target pillar: Pillar 1. Module: `src/animation/locomotion.ts`.
> Builds on research: `docs/research/procedural-locomotion.md`.
> Builds on decision: `docs/design/simple-feet-gait-decision.md` (IK-parity feet).
> Status: **DECIDED** — Approach A chosen. See `docs/design/idle-foot-stance-decision.md`.

## Consumer Need

When `idleSpread = 0` (IK-parity / orbital gait), the walk cycle drives both
feet across the midline with equal-magnitude endpoint separation — the correct
IK-parity trajectory. But when the character stops walking, displacement-driven
phase freezes and both feet's X offsets converge to 0 (via the consumer's idle
blend). At full idle (`idleBlend = 1`), both feet sit at the body midline
**overlapping as one foot**.

The requirement: during walking, feet cross the midline (IK parity). At full
grounded idle, feet settle **slightly apart** — a natural standing stance with
visible foot separation. The transition between the two states must be smooth.

**Who needs this:** Both the hero (slime-knight showcase, footW 28) and the
playground (demonstration platformer, footW 7). Any future game using
`IK_PARITY_FEET` with a standing idle needs this blend. The library must not
couple speed/ground detection into the engine — the consumer owns the blend
weight.

**Current consumer workaround (buggy):** Both the hero (`slime-knight.ts`
`drawSlimeKnight`) and the playground (`playground.ts` `drawPlayer`) manually
lerp foot offsets toward zero:

```ts
leftFootOffset: {
  x: locoPose.leftFootOffset.x * (1 - idleBlend),
  y: locoPose.leftFootOffset.y * (1 - idleBlend),
},
```

At `idleBlend = 1`, both offsets become 0 → feet overlap at the midline. The
fix is to blend toward a **stance target** (`±idleFootSpread/2`) instead of
zero.

### Spread value guidance

`idleFootSpread` is the **total center-to-center distance** between the two
feet at full idle. Each foot targets `±spread/2` from the body midline.

To choose a spread that produces **visibly distinct foot rectangles**, use
`footW + desiredGap`:

| Consumer | `footW` | `desiredGap` | `idleFootSpread` | Notes |
|---|---|---|---|---|
| Hero (slime-knight) | 28 | 2 | **30** | Tight 2px gap, wide feet fill the stance |
| Playground | 7 | 1 | **8** | 1px gap, compact character |

The gap is a visual tuning knob — increase for a wider stance, decrease for
feet that almost touch. There is no engine default because foot scale is
character-specific.

## Approach A: Pure Pose Helper — `blendLocomotionToStance`

**Source pattern:** Mirrors the existing `blendAirborneTuck` in
`src/animation/locomotion.ts` — a pure function that takes a single foot offset
and blends it toward a target pose by a weight. `blendLocomotionToStance`
generalises this to the full `LocomotionPose` with a spread-based stance target.

**Signature sketch:**

```ts
// In src/animation/locomotion.ts

/**
 * Blend a locomotion pose toward a neutral standing stance.
 *
 * When the character stops walking, the locomotion phase freezes and the
 * foot offsets retain their last swing/stance values. This function
 * smoothly transitions the pose toward a neutral standing stance where
 * both feet rest on the ground at a configurable spread.
 *
 * `idleFootSpread` is the **total center-to-center distance** between the
 * two feet at full idle. The stance target for each foot is:
 *   - Left:  `{ x: -idleFootSpread / 2, y: 0 }`
 *   - Right: `{ x: +idleFootSpread / 2, y: 0 }`
 *
 * To choose a visibly-distinct spread: use `footW + desiredGap`. E.g. hero
 * (footW 28, gap 2) → spread 30; playground (footW 7, gap 1) → spread 8.
 * There is no engine default because foot scale is character-specific.
 *
 * Foot Y is blended toward 0 (grounded) — the swing-phase lift fades out
 * so the foot lowers to the ground. Hip offset is also blended toward
 * neutral (0, 0) — the walk-cycle bob and sway fade out.
 *
 * **Determinism contract:** pure function of `(pose, stanceBlend,
 * idleFootSpread)`. Same inputs → same output, forever. No side effects.
 * Returns a fresh `LocomotionPose`; the input is never mutated. Never
 * throws.
 *
 * **Defensive handling (non-finite inputs):**
 *   - `stanceBlend`: finite values clamped to [0, 1]; non-finite (NaN,
 *     Infinity, -Infinity) treated as 0 (pure walk pose).
 *   - `idleFootSpread`: finite values clamped to >= 0 (negative treated
 *     as 0); non-finite treated as 0.
 *   - Never throws on any numeric input.
 *
 * **Composition order:** apply `blendLocomotionToStance` FIRST, then
 * `blendAirborneTuck` on each foot. Stance blend happens before airborne
 * tuck. The consumer owns stop/ground detection — the engine does NOT
 * couple speed or grounded state. This way:
 *   - Idle + grounded: stance blend = 1 → feet at ±idleFootSpread/2
 *   - Walking + grounded: stance blend = 0 → pure walk pose
 *   - Idle + airborne: consumer gates stanceBlend by (1 - airborneBlend),
 *     then tuck overrides → feet tuck
 *   - Walking + airborne: stance blend = 0, tuck overrides → feet tuck
 *
 * @param pose - locomotion pose from `evaluateLocomotion`
 * @param stanceBlend - blend weight. 0 = pure walk pose, 1 = pure
 *   standing stance. Consumer-owned (speed/ground detection is NOT in the
 *   engine). Finite values clamped to [0, 1]; non-finite treated as 0.
 * @param idleFootSpread - total center-to-center distance in px between
 *   the two feet at full idle (stanceBlend = 1). Each foot sits at
 *   ±spread/2 from the body midline. Use `footW + desiredGap` for
 *   visibly distinct rectangles. No engine default (scale is
 *   character-specific). Finite values clamped to >= 0; non-finite
 *   treated as 0.
 * @returns a new `LocomotionPose` with blended offsets
 *
 * @example
 * ```ts
 * // Hero: footW=28, desiredGap=2 → spread=30
 * const pose = evaluateLocomotion(loco, DEFAULT_GAIT);
 * const stanceBlend = idleSettle * (1 - jumpPose.airborneBlend);
 * const stancePose = blendLocomotionToStance(pose, stanceBlend, 30);
 * const leftFoot = blendAirborneTuck(stancePose.leftFootOffset, jumpPose.airborneBlend, DEFAULT_TUCK);
 * const rightFoot = blendAirborneTuck(stancePose.rightFootOffset, jumpPose.airborneBlend, DEFAULT_TUCK);
 * ```
 */
export function blendLocomotionToStance(
  pose: LocomotionPose,
  stanceBlend: number,
  idleFootSpread: number,
): LocomotionPose;
```

**Exact formulas:**

```ts
export function blendLocomotionToStance(
  pose: LocomotionPose,
  stanceBlend: number,
  idleFootSpread: number,
): LocomotionPose {
  // Defensive: non-finite → 0, finite → clamped
  const t = Number.isFinite(stanceBlend)
    ? Math.max(0, Math.min(1, stanceBlend))
    : 0;
  const spread = Number.isFinite(idleFootSpread)
    ? Math.max(0, idleFootSpread)
    : 0;
  const halfSpread = spread / 2;

  return {
    hipOffset: {
      x: pose.hipOffset.x * (1 - t),
      y: pose.hipOffset.y * (1 - t),
    },
    leftFootOffset: {
      x: pose.leftFootOffset.x + (-halfSpread - pose.leftFootOffset.x) * t,
      y: pose.leftFootOffset.y * (1 - t),
    },
    rightFootOffset: {
      x: pose.rightFootOffset.x + (halfSpread - pose.rightFootOffset.x) * t,
      y: pose.rightFootOffset.y * (1 - t),
    },
  };
}
```

**Derivation of the X blend:**

The foot X position is a lerp between the walk-cycle position and the stance
target:

```
leftX(t) = lerp(walkLeftX, stanceLeftX, t)
         = walkLeftX + (stanceLeftX - walkLeftX) * t
         = walkLeftX + (-halfSpread - walkLeftX) * t
```

At `t = 0`: `leftX = walkLeftX` (pure walk, IK-parity crossing preserved).
At `t = 1`: `leftX = -halfSpread` (stance: foot at left spread position).

The Y blend is a simple fade-to-zero: `y * (1 - t)`. At `t = 1`, Y = 0
(foot fully grounded, no lift).

**Usage example — hero (slime-knight.ts):**

```ts
// In drawSlimeKnight, replace the manual idle blend:
const pose = evaluateLocomotion(state.locomotion, config.gaitConfig);
const stanceBlend = state.idleSettle * (1 - jumpPose.airborneBlend);
const stancePose = blendLocomotionToStance(pose, stanceBlend, 30); // footW=28, gap=2

const leftFootOffset = blendAirborneTuck(
  stancePose.leftFootOffset,
  jumpPose.airborneBlend,
  DEFAULT_TUCK,
);
const rightFootOffset = blendAirborneTuck(
  stancePose.rightFootOffset,
  jumpPose.airborneBlend,
  DEFAULT_TUCK,
);
// ... pass to drawHeroSimpleFeet / IK solver
```

**Usage example — playground (playground.ts):**

```ts
// In drawPlayer, replace the manual idle blend:
const locoPose = evaluateLocomotion(loco, PLAYGROUND_GAIT);
const stanceBlend = idleBlend; // already ramped in step()
const stancePose = blendLocomotionToStance(locoPose, stanceBlend, 8); // footW=7, gap=1
const blendedPose: LocomotionPose = {
  hipOffset: stancePose.hipOffset,
  leftFootOffset: blendAirborneTuck(
    stancePose.leftFootOffset,
    0, // playground has no airborne tuck (airborneBlendRamp = 0)
    DEFAULT_TUCK,
  ),
  rightFootOffset: blendAirborneTuck(
    stancePose.rightFootOffset,
    0,
    DEFAULT_TUCK,
  ),
};
drawSimpleFeet(ctx, blendedPose, { ...IK_PARITY_FEET, baseY: vis.feetBaseY, color: COLOR_PLAYER });
```

**Trade-offs:**
- **Ergonomics:** Excellent. Single pure function, clear parameter names, reads
  naturally at the call site. `blendLocomotionToStance(pose, 0.8, 30)` is
  self-documenting (spread = footW 28 + gap 2).
- **Determinism:** Perfect. Pure function of three numbers → fresh pose. No
  host access, no RNG, no global state. Same inputs → byte-identical output.
- **Runtime cost:** Negligible. ~12 multiplications + 6 additions per call
  (lerp × 3 fields × 2 coords) plus 2 `Number.isFinite` checks. O(1). Called
  once per character per frame.
- **Consumer complexity:** Minimal. Consumer computes `stanceBlend` from
  speed/ground state (as required — no coupling in engine). The helper
  composes cleanly with `blendAirborneTuck`.
- **Tree-shake-ability:** Full. Individual function export; consumers that
  don't use it pay nothing.
- **Convention fit:** Perfect. Pure function in `locomotion.ts` alongside
  `blendAirborneTuck`. File naming, JSDoc, determinism invariants all match
  existing conventions.
- **Composition order:** Stance blend FIRST → tuck SECOND. This is correct:
  at idle+grounded, stance puts feet at spread; at idle+airborne, the consumer
  gates `stanceBlend` by `(1 - airborneBlend)` so tuck wins. At
  walking+airborne, stance blend = 0, tuck wins. No conflict.

**What this makes easy:**
- Any consumer using IK-parity feet can get a clean idle stance with one call
- The `idleFootSpread` parameter is a single, obvious tuning knob
  (`footW + desiredGap`)
- Composable with existing `blendAirborneTuck` — no pipeline changes
- Both hero (spread 30) and playground (spread 8) migrate with ~5 line
  changes each

**What this makes hard:**
- Nothing. This is purely additive.

## Approach B: Extend `SimpleFeetConfig` with `idleFootSpread`

**Source pattern:** Extends the existing `SimpleFeetConfig` interface in
`src/animation/simple-feet.ts` and adds renderer-internal blend logic.

**Signature sketch:**

```ts
// In src/animation/simple-feet.ts

export interface SimpleFeetConfig {
  // ... existing fields ...
  readonly idleFootSpread?: number; // NEW: spread at full idle (px)
}

export function drawSimpleFeet(
  ctx: CanvasRenderingContext2D,
  pose: LocomotionPose,
  config: SimpleFeetConfig,
  stanceBlend?: number, // NEW: optional blend weight [0,1]
): void;
```

**Implementation sketch:**

```ts
export function drawSimpleFeet(
  ctx: CanvasRenderingContext2D,
  pose: LocomotionPose,
  config: SimpleFeetConfig,
  stanceBlend = 0,
): void {
  const halfFootW = config.footW / 2;
  const idleSpread = config.idleFootSpread ?? 0;

  // Blend each foot toward its idle stance position
  const t = Math.max(0, Math.min(1, stanceBlend));
  const halfIdle = idleSpread / 2;

  const leftFootX = pose.leftFootOffset.x + (-halfIdle - pose.leftFootOffset.x) * t;
  const leftFootY = pose.leftFootOffset.y * (1 - t);
  const rightFootX = pose.rightFootOffset.x + (halfIdle - pose.rightFootOffset.x) * t;
  const rightFootY = pose.rightFootOffset.y * (1 - t);

  const leftX = Math.round(-config.idleSpread - halfFootW + leftFootX);
  const leftY = Math.round(config.baseY - leftFootY);
  const rightX = Math.round(config.idleSpread - halfFootW + rightFootX);
  const rightY = Math.round(config.baseY - rightFootY);
  // ... draw ...
}
```

**Usage example:**

```ts
drawSimpleFeet(ctx, locoPose, {
  ...IK_PARITY_FEET,
  idleFootSpread: 8, // footW 7 + gap 1
  color: COLOR_PLAYER,
}, idleBlend);
```

**Trade-offs:**
- **Ergonomics:** Decent at the call site — one extra parameter. But the
  parameter ordering is awkward: the blend weight comes after the config object.
  Consumers who don't need it must still see it.
- **Determinism:** Perfect (pure function of inputs).
- **Runtime cost:** Same as Approach A (~12 muls). But the blend is inside the
  renderer, so consumers who need the blended pose for other purposes (foot-plant
  detection, dust spawning at foot positions) cannot access it without
  duplicating the blend logic.
- **Consumer complexity:** Lower at the call site (no separate function call).
  But the blended pose is hidden inside the renderer — consumers who need it for
  foot-plant detection or dust spawning must re-derive it, violating DRY.
- **Tree-shake-ability:** Poor. The blend logic is baked into `drawSimpleFeet`,
  pulling it in for consumers who only want the renderer without the stance
  blend.
- **Convention fit:** Poor. `drawSimpleFeet` currently takes 3 params; adding a
  4th optional param breaks the clean signature. The config interface gains a
  field that's only meaningful when the renderer is called (not a pure-config
  concern). The blend logic is rendering-coupled rather than pose-level.
- **Breaking change risk:** The 4th parameter is optional so it's technically
  non-breaking, but it changes the mental model of what `drawSimpleFeet` does
  (it was "position feet from a pose" → now it's "position feet from a pose AND
  blend toward idle").

**What this makes easy:**
- One-call rendering with built-in idle blend (for consumers who only draw)

**What this makes hard:**
- Accessing the blended pose for foot-plant detection (playground needs this)
- Composing with `blendAirborneTuck` (must apply tuck BEFORE the renderer, not
  after)
- The renderer becomes a blend+draw pipeline instead of a pure draw function

## Approach C: Consumer-Only (No New Engine API)

**Source pattern:** The playground and hero already manually blend. Document the
correct pattern (blend toward `±spread/2` instead of `0`).

**Signature sketch:** No new exports. Documentation-only.

**Usage example:**

```ts
// Consumer manually computes the stance blend (the correct way):
const pose = evaluateLocomotion(loco, config);
const halfSpread = 4; // total spread 8 / 2 (footW 7 + gap 1)
const t = idleBlend; // consumer-owned blend weight

const blendedPose: LocomotionPose = {
  hipOffset: {
    x: pose.hipOffset.x * (1 - t),
    y: pose.hipOffset.y * (1 - t),
  },
  leftFootOffset: {
    x: pose.leftFootOffset.x + (-halfSpread - pose.leftFootOffset.x) * t,
    y: pose.leftFootOffset.y * (1 - t),
  },
  rightFootOffset: {
    x: pose.rightFootOffset.x + (halfSpread - pose.rightFootOffset.x) * t,
    y: pose.rightFootOffset.y * (1 - t),
  },
};
drawSimpleFeet(ctx, blendedPose, { ...IK_PARITY_FEET, color: palette.base });
```

**Trade-offs:**
- **Ergonomics:** Poor. Every consumer must write 15+ lines of identical lerp
  math. Easy to get wrong (the playground's current bug is exactly this —
  blending to 0 instead of ±spread).
- **Determinism:** Perfect (consumer-owned pure math).
- **Runtime cost:** Same as A (the math is identical).
- **Consumer complexity:** High. Each consumer reimplements the same blend.
  Foot-plant detection must use the pre-blend pose (because the blend would
  zero the lift, producing false plant edges). This creates a subtle ordering
  dependency that's easy to get wrong.
- **Tree-shake-ability:** N/A (no new export).
- **Convention fit:** Poor. The library provides `blendAirborneTuck` for the
  same category of concern (pose blending for animation transitions). Not
  providing an equivalent for stance blending is an inconsistency. Both are
  "blend a locomotion pose toward a target by a weight." One is exported;
  the other is left to consumers.
- **Risk of consumer error:** HIGH. The playground's current bug (blending to 0
  causing overlap) is exactly what this approach perpetuates. Without a
  documented canonical helper, consumers will continue to blend to 0.

**What this makes easy:**
- Nothing. This is the status quo with a documentation patch.

**What this makes hard:**
- Prevents the exact bug the requirement describes (consumers will keep
  blending to 0)
- Duplicates blend logic across consumers
- Creates foot-plant detection ordering pitfalls

## Comparison Table

| Criterion | A: `blendLocomotionToStance` | B: Extend `SimpleFeetConfig` | C: Consumer-only |
|---|---|---|---|
| Ergonomics | ★★★★★ | ★★★☆☆ | ★★☆☆☆ |
| Determinism | ★★★★★ | ★★★★★ | ★★★★★ |
| Runtime cost | O(1) ~12 muls | O(1) ~12 muls | O(1) ~12 muls |
| Convention fit | ★★★★★ | ★★☆☆☆ | ★★☆☆☆ |
| Composability | ★★★★★ (works with tuck) | ★★★☆☆ (renderer-coupled) | ★★★★☆ (manual) |
| Foot-plant access | ★★★★★ (pre-blend pose available) | ★★☆☆☆ (hidden in renderer) | ★★★★☆ (if consumer orders correctly) |
| Risk | LOW | MEDIUM (sig change) | HIGH (bug perpetuation) |
| Tree-shake-ability | ★★★★★ | ★★★☆☆ (pulls blend into renderer) | N/A |

## Recommendation

**Approach A: `blendLocomotionToStance`** — a pure pose helper in
`src/animation/locomotion.ts`.

Reasoning:
1. **Mirrors `blendAirborneTuck`** — same category of concern (pose blending
   for animation transitions), same file, same composition pattern. Consumers
   already understand this API shape.
2. **Fixes the actual bug** — the playground and hero currently blend to 0,
   causing overlap. A canonical helper with `±idleFootSpread/2` as the stance
   target eliminates the footgun.
3. **Composable** — the blended pose is available for foot-plant detection,
   dust spawning, and any other consumer need. The renderer stays a pure draw
   function.
4. **No signature changes** — `drawSimpleFeet` keeps its clean 3-param
   signature. `SimpleFeetConfig` gains no new fields. Zero breaking change risk.
5. **Additive only** — one new export, one new function, no existing export
   modified. Public API stability preserved.
6. **Defensive by default** — non-finite inputs degrade silently (treated as 0),
   finite values clamped. Never throws. Matches library convention.
7. **Composition order is clear** — stance blend before tuck; consumer owns
   ground/stop detection. No engine coupling.

The `idleFootSpread` parameter is deliberately NOT in `SimpleFeetConfig` because
it's a **blend parameter** (how far apart at idle), not a **render parameter**
(foot size/color/outline). The config controls how feet are drawn; the blend
helper controls how poses transition. These are separate concerns.

## Resolved Design Decisions

1. **No engine default spread.** `idleFootSpread` is required; there is no
   `DEFAULT_IDLE_FOOT_SPREAD`. Foot scale is character-specific (hero footW 28
   vs playground footW 7), so a shared default would be misleading. Consumers
   use `footW + desiredGap`.

2. **Hip blend direction is correct.** The helper blends hip offset toward
   neutral (0, 0). `evaluateLocomotion` hip is always relative to rest — so
   blending toward 0 IS the rest pose.

3. **Non-finite / negative spread handled defensively.** Non-finite values
   (NaN, Infinity) treated as 0. Finite negative values clamped to 0. Never
   throws — consistent with the library's defensive adapter pattern.

4. **Non-finite stanceBlend handled defensively.** Non-finite values treated as
   0 (pure walk pose). Finite values clamped to [0, 1]. Never throws.

5. **Composition order locked.** Stance blend FIRST, then airborne tuck.
   Consumer owns stop/ground detection and gates `stanceBlend` by
   `(1 - airborneBlend)`. The engine does NOT couple speed or grounded state.
