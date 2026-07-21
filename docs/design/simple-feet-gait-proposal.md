# API Proposal: Simple-Feet Orbital Gait

> Target pillar: 1 (Animation). Module: `src/animation/simple-feet.ts`.
> Builds on research: `docs/research/procedural-locomotion.md` §Pattern 1.
> Status: DECIDED (see `docs/design/simple-feet-gait-decision.md`).

## Consumer Need

The user reports that `drawSimpleFeet` produces a "crab-like" visual: the feet swing side-to-side without ever crossing, rather than orbiting around each other with **equal-magnitude horizontal separation at alternating footfall endpoints** — the visual read the IK version achieves.

Concrete need: "rotate around each other so with each footfall the feet are the same width apart" and "mimic the IK version." The primary requirement is **endpoint symmetry / side swapping**, NOT rigid constant separation at all phases.

### Root cause analysis

**The IK version** achieves its visual because both hips sit at the same X coordinate (`hipLeftX = hipRightX = bodyCx` in `slime-knight.ts:1266-1267`). Foot targets swing as `cos(phase) * strideLength` from the co-located hip, so at phase 0 the left foot is at `+stride` (forward) and the right foot at `-stride` (backward) — the feet pass through each other. The 2-bone IK solver then positions the knee joints to resolve the overlap into a natural bent-leg walk. The visual result: the forward leg crosses in front of the back leg, and the silhouette reads as a single entity walking.

**The current `drawSimpleFeet`** applies a fixed horizontal offset (`±idleSpread`) from the body midline, THEN adds the locomotion foot offset:

```
leftX  = -idleSpread - footW/2 + pose.leftFootOffset.x
rightX = +idleSpread - footW/2 + pose.rightFootOffset.x
```

The foot **center** positions are:
```
leftCenter  = -idleSpread + cos(φ) * strideLength
rightCenter = +idleSpread - cos(φ) * strideLength
```

Center-to-center distance: `2 * idleSpread - 2 * cos(φ) * strideLength`

With `idleSpread = 3` and `strideLength = 2.2` (Embertomb's scaled gait):
- Phase 0: left at −3+2.2=−0.8, right at +3−2.2=+0.8 → **1.6px gap**, feet near midline but not crossing
- Phase π/2: left at −3+0=−3, right at +3+0=+3 → **6px gap**, max separation
- Phase π: left at −3−2.2=−5.2, right at +3+2.2=+5.2 → **10.4px gap**, even wider

The `idleSpread` acts as a fixed horizontal bias that the stride amplitude can barely overcome. The feet swing in parallel arcs — never crossing — producing the crab-like read.

---

## The IK-parity math (corrected)

At **`idleSpread = 0`**, both feet center on the body midline:

```
leftCenter  = cos(φ) * strideLength
rightCenter = -cos(φ) * strideLength
```

Center-to-center distance: `-2 * cos(φ) * strideLength`

At the **footfall endpoints** (when each foot is fully forward/back):
- Phase 0: left at +strideLength, right at −strideLength → distance = −2×strideLength (left is RIGHT of right — swapped sides)
- Phase π: left at −strideLength, right at +strideLength → distance = +2×strideLength (normal ordering)

**At every footfall endpoint, both feet have equal magnitude from the midline (strideLength) on opposite sides.** This is the IK-target parity: endpoint symmetry with side swapping.

**Between endpoints**, the separation varies continuously:
- Phase π/2: both feet at 0 → **0px separation** (crossing / overlap)
- Phase π/4: left at +0.71×stride, right at −0.71×stride → 1.41×stride separation

This is **NOT constant separation** — it's sinusoidal separation that peaks at the endpoints and passes through zero at the midline crossings. The feet orbit each other, crossing at midline every half-cycle. This matches the IK version's foot-target trajectory exactly (same formula, no bones).

### What "equal width at each footfall" means

The user's phrasing "the feet are the same width apart" at each footfall refers to **endpoint symmetry**: when a foot is planted (at max extension), it is the same distance from the midline as the other foot was at ITS last plant. With `idleSpread=0`, this holds exactly: each foot reaches ±strideLength at its respective endpoint. The silhouette reads as a single walking entity because the maximum horizontal extent from the body midline is always strideLength — the same on both sides, at each step.

With `idleSpread > 0`, the footfall endpoints are asymmetric relative to the midline: the left foot's max forward extent is `−idleSpread + strideLength` while the right's is `+idleSpread + strideLength`. When `idleSpread > strideLength`, the feet never reach the midline at all (the crab extreme).

---

## Approach A: Named preset `IK_PARITY_FEET` — zero-spread config recipe

**Source pattern:** The IK showcase in `slime-knight.ts` places both hips at `bodyCx` (co-located). Setting `idleSpread = 0` in `drawSimpleFeet` replicates this trajectory: both feet center on the body midline, orbiting symmetrically via `cos(phase) * strideLength`.

**Signature sketch:**

No new API field. Export a named preset that consumers spread:

```ts
// In src/animation/simple-feet.ts
export const IK_PARITY_FEET: Readonly<SimpleFeetConfig> = {
  ...DEFAULT_SIMPLE_FEET,
  idleSpread: 0,
};
```

**Usage example:**

```ts
// Embertomb player — use the IK-parity preset
drawSimpleFeet(ctx, pose, {
  ...IK_PARITY_FEET,
  footW: 5, footH: 4, baseY: -3,
  color: shade(palette.base, 0.65), outline: palette.outline,
});

// Or inline — just set idleSpread to 0
drawSimpleFeet(ctx, pose, {
  ...DEFAULT_SIMPLE_FEET,
  idleSpread: 0,
  footW: 5, footH: 4, baseY: -3,
  color: shade(palette.base, 0.65), outline: palette.outline,
});
```

**Formulas (for documentation, not runtime):**

```
leftFootX   = 0 - footW/2 + cos(φ) * strideLength
rightFootX  = 0 - footW/2 - cos(φ) * strideLength
```

At `strideLength = 4` (DEFAULT_GAIT): feet swing from `x = −4 − 3.5 = −7.5` to `x = +4 − 3.5 = +0.5` (left foot) and mirror (right). At phase π/4: both feet at `x = ±(2.83 − 3.5) = ∓0.67` — the feet overlap by ~1.3px at the midline. Equal magnitude at every footfall endpoint because the orbit is symmetric.

At `strideLength = 2.2` (Embertomb): feet swing from `x = −2.2 − 2.5 = −4.7` to `x = +2.2 − 2.5 = −0.3` (left). The overlap at midline is `0.3 − (−0.3) = 0.6px` — a subtle crossing that still reads as orbital.

**Trade-offs:**
- **Ergonomics:** Excellent — one number change, no new API to learn. The named preset makes intent explicit.
- **Determinism:** Identical — same pure functions, same formulas.
- **Runtime cost:** Identical (0 extra operations).
- **Consumer complexity:** Minimal — spread the preset, optionally override `footW`/`footH`/`color`.
- **Tree-shake-ability:** Good — one new const export, no new functions.
- **Convention fit:** Perfect — uses the existing config-object + named-preset pattern (mirrors `DEFAULT_SIMPLE_FEET`).

**What this makes easy:** Any consumer can opt into orbital gait by spreading `IK_PARITY_FEET`. The name communicates intent; no magic value to remember.

**What this makes hard:** No knob for "partial crossing" (e.g., some spread but less than default). Consumers wanting a half-way stance (some crossing, some spread) must manually compute the right `idleSpread` value.

---

## Approach B: `orbitalBlend` — semantic spread-scaling field

**Source pattern:** Research `procedural-locomotion.md` §Pattern 1: the foot trajectory is `cos(phase) * strideLength` with a configurable horizontal offset. Adding an `orbitalBlend` parameter scales the spread toward zero, giving consumers a semantic knob for crossing intensity.

**Signature sketch:**

```ts
export interface SimpleFeetConfig {
  readonly footW: number;
  readonly footH: number;
  readonly idleSpread: number;
  readonly baseY: number;
  readonly color: string;
  readonly outline?: string;
  /**
   * Blend toward orbital crossing. At 0: feet sit at ±idleSpread (current
   * behavior). At 1: feet center on the midline (IK-parity — endpoint
   * symmetry with side swapping). At 0.5: feet at ±idleSpread/2.
   *
   * Technically: effectiveSpread = idleSpread * (1 - orbitalBlend).
   * This is a convenience alias for scaling idleSpread manually.
   *
   * Default: 0 (backward-compatible with all existing consumers).
   */
  readonly orbitalBlend?: number;
}
```

**Formulas:**

```
effectiveSpread = idleSpread * (1 - orbitalBlend)

leftFootX   = -effectiveSpread - footW/2 + cos(φ) * strideLength
rightFootX  = +effectiveSpread - footW/2 - cos(φ) * strideLength
```

At `orbitalBlend = 0`: identical to current behavior (backward-compatible).
At `orbitalBlend = 1`: `effectiveSpread = 0`, IK-parity crossing.
At `orbitalBlend = 0.5`: `effectiveSpread = idleSpread/2`, partial crossing.

**Rendering change in `drawSimpleFeet`:**

```ts
const effectiveSpread = config.orbitalBlend !== undefined
  ? config.idleSpread * (1 - config.orbitalBlend)
  : config.idleSpread;
const halfFootW = config.footW / 2;
const leftX = Math.round(-effectiveSpread - halfFootW + pose.leftFootOffset.x);
const leftY = Math.round(config.baseY - pose.leftFootOffset.y);
const rightX = Math.round(effectiveSpread - halfFootW + pose.rightFootOffset.x);
const rightY = Math.round(config.baseY - pose.rightFootOffset.y);
```

**Usage example:**

```ts
// Embertomb — full orbital crossing
drawSimpleFeet(ctx, pose, {
  ...DEFAULT_SIMPLE_FEET,
  footW: 5, footH: 4, idleSpread: 3,
  orbitalBlend: 1,  // effectiveSpread = 3 * 0 = 0 → IK parity
  baseY: -3, color: shade(palette.base, 0.65), outline: palette.outline,
});

// A game wanting "some crossing but not at the midline"
drawSimpleFeet(ctx, pose, {
  ...DEFAULT_SIMPLE_FEET,
  orbitalBlend: 0.6,  // effectiveSpread = 5.5 * 0.4 = 2.2
});
```

**Trade-offs:**
- **Ergonomics:** Moderate — the semantic name communicates intent, but the interaction with `idleSpread` is non-obvious (see below).
- **Determinism:** Identical — same pure functions, no new state.
- **Runtime cost:** One multiply per foot per tick (negligible).
- **Consumer complexity:** Low — optional field, defaults to current behavior.
- **Tree-shake-ability:** N/A (no new exports; field is on existing type).
- **Convention fit:** Good — optional config field with documented default.

**What this makes easy:** Fine-grained control over crossing intensity. The semantic name `orbitalBlend` communicates "how much do the feet cross."

**What this makes hard — the alias problem:** `orbitalBlend` is mathematically equivalent to `effectiveSpread = idleSpread * (1 - orbitalBlend)`. It's a rescaled `idleSpread`. Consider:

- A consumer who already overrides `idleSpread: 3` then sets `orbitalBlend: 0.6` → effectiveSpread = 3×0.4 = 1.2. The `orbitalBlend` operates on their custom spread, not the default.
- A consumer who sets `orbitalBlend: 1` makes `idleSpread` irrelevant (multiplied by 0). The two fields partially alias each other.
- The "halfway" value depends on what `idleSpread` is — `orbitalBlend: 0.5` means different things for `idleSpread: 5.5` vs `idleSpread: 3`.

This is a confusing interaction for a field that is just `1 - (desiredSpread / idleSpread)`.

---

## Approach C: Constant-separation orbit (investigated and rejected)

**Source pattern:** The user's phrasing "the feet are the same width apart" could be interpreted as constant horizontal separation at ALL phases, not just endpoints. We investigated whether this is mathematically achievable.

**The math shows it is not.** With sinusoidal locomotion:

```
leftCenter(φ)  = -s + cos(φ) * L
rightCenter(φ) = +s - cos(φ) * L
distance(φ) = 2s - 2*cos(φ)*L
```

For constant distance D at all phases: `2s - 2*cos(φ)*L = D` for all φ. This requires `L = 0` (no stride = no walk). **Constant horizontal separation is mathematically incompatible with the alternating forward/backward foot motion of a sinusoidal walk cycle.**

The only way to achieve constant separation would be to abandon the sinusoidal trajectory entirely (e.g., feet move in parallel with fixed offset — but this reads as shuffling, not walking). This diverges fundamentally from the IK version's trajectory and would not "mimic the IK version."

**Verdict:** Not included as an approach. The user's primary requirement (endpoint symmetry) is achievable; constant all-phase separation is not, and is not what the IK version does.

---

## Comparison Table

| Criterion | A: `IK_PARITY_FEET` preset | B: `orbitalBlend` |
|---|---|---|
| IK-target parity | ✅ Exact (idleSpread=0) | ✅ Exact (at blend=1) |
| Endpoint symmetry | ✅ Both feet at ±strideLength at each plant | ✅ (at blend=1) |
| Side swapping | ✅ Feet alternate sides each half-cycle | ✅ (at blend=1) |
| Backward-compatible | ✅ (new export only, no existing change) | ✅ (optional field, default 0) |
| New API surface | 1 const (`IK_PARITY_FEET`) | 1 optional field (`orbitalBlend`) |
| Consumer effort | `...IK_PARITY_FEET, color: ...` | `orbitalBlend: 1` |
| Partial crossing | ❌ Binary (0 or not) — must manually tune `idleSpread` | ✅ Continuous [0, 1] |
| Field interaction confusion | None — `idleSpread: 0` is unambiguous | ⚠ `orbitalBlend` rescales whatever `idleSpread` is; two fields partially alias |
| Runtime cost | 0 | +1 multiply/foot |
| Convention fit | ✅ Named preset mirrors `DEFAULT_SIMPLE_FEET` | ⚠ Optional field with non-obvious interaction |

---

## Recommendation

**Approach A (`IK_PARITY_FEET` named preset) + documentation recipe.**

Reasoning:

1. **Endpoint symmetry is the requirement, and `idleSpread: 0` achieves it exactly.** The user wants feet that "rotate around each other so with each footfall the feet are the same width apart." At `idleSpread=0`, both feet reach ±strideLength at their respective endpoints — equal magnitude, opposite sides. This is the IK-parity trajectory.

2. **`orbitalBlend` is a confusing alias.** It scales `idleSpread` by `(1 - blend)`, which is just a rescaled `idleSpread`. A consumer setting `orbitalBlend: 0.6` gets `effectiveSpread = idleSpread * 0.4` — but this depends on what `idleSpread` already is. Two fields that control the same thing (horizontal spread) create ambiguity. The simpler API is to set `idleSpread` directly.

3. **Partial crossing is a niche need.** Most consumers want either "crab-like" (current `idleSpread: 5.5`) or "IK-parity" (`idleSpread: 0`). The few wanting partial crossing can compute `idleSpread = desiredSpread` directly — there's no need for a blend parameter that just rescales another parameter.

4. **Named presets are a proven pattern in this codebase.** `DEFAULT_SIMPLE_FEET`, `DEFAULT_GAIT`, `DEFAULT_SPRING` — the library already ships named config presets. `IK_PARITY_FEET` fits naturally.

5. **Zero runtime cost.** No new code paths, no new per-frame operations. Just a const to spread.

**The smallest stable API is one new const export and improved JSDoc.** No new fields, no new functions, no formula changes.

### Migration implications

| Consumer | Current config | After Approach A |
|---|---|---|
| DEFAULT_SIMPLE_FEET | `idleSpread: 5.5` | Unchanged |
| Embertomb player | `idleSpread: 3` | Use `...IK_PARITY_FEET` and override `footW`/`footH`/`color` |
| Playground showcase | Uses IK legs, not simple-feet | No change |

### Deterministic test invariants

For any approach, the following invariants must hold:

1. **Orbital symmetry:** `leftFootOffset.x + rightFootOffset.x ≈ 0` at every phase (the feet are symmetric about the midline). This is an existing invariant (tested in `locomotion.test.ts:127-134`) and remains true.
2. **Non-negative lift:** `footOffset.y ≥ 0` at every phase (feet never clip below ground). Existing invariant, unchanged.
3. **Endpoint parity (at idleSpread=0):** At each footfall endpoint (phase 0 and π), `|leftCenter| = |rightCenter| = strideLength`. The feet have equal magnitude from the midline on opposite sides. This is a new invariant to add for the preset.
4. **Side swapping (at idleSpread=0):** At phase 0, `leftCenter > 0 > rightCenter`; at phase π, `leftCenter < 0 < rightCenter`. The feet alternate which side they're on. New invariant.
5. **No mutation:** `drawSimpleFeet` does not mutate `pose` or `config`. Existing invariant, unchanged.
6. **Determinism:** Same `(pose, config)` → same `fillRect`/`strokeRect` calls, byte-identical. Existing invariant, unchanged.

---

## What the revised recommendation ships

**In `src/animation/simple-feet.ts`:**

1. **New export:** `IK_PARITY_FEET` — a named `SimpleFeetConfig` preset with `idleSpread: 0`, all other fields matching `DEFAULT_SIMPLE_FEET`. JSDoc explains: "IK-parity orbital gait — feet center on the body midline, orbiting symmetrically with endpoint parity at each footfall. Mimics the IK version's foot-target trajectory without bones."

2. **Updated JSDoc on `SimpleFeetConfig.idleSpread`:** Add a note explaining the orbital behavior: "At 0, feet center on the midline and orbit symmetrically (IK-parity). At the default 5.5, feet sit at ±5.5px from the midline (wide stance, no crossing). Values between 0 and strideLength produce partial crossing."

3. **Updated JSDoc on `drawSimpleFeet`:** Add a brief "Orbital gait" section in the existing JSDoc explaining the crossing behavior and linking to `IK_PARITY_FEET`.

**No changes to:**
- `drawSimpleFeet` implementation (same formula, same behavior)
- `SimpleFeetConfig` interface (no new fields)
- `DEFAULT_SIMPLE_FEET` (unchanged, backward-compatible)
- Any other module

---

## Open Questions for @architect

1. **Should `IK_PARITY_FEET` derive from `DEFAULT_SIMPLE_FEET` or carry its own complete config?** Spreading `DEFAULT_SIMPLE_FEET` and overriding `idleSpread: 0` is concise but creates a runtime dependency on the default. A standalone object is safer against future default changes but duplicates values. Recommendation: spread + override (matches `scaledGait` pattern).

2. **Should the JSDoc on `idleSpread` explain the endpoint-parity math, or just say "0 = orbital crossing"?** The full math (center-to-center distance formula) is useful for consumers tuning partial spread, but may be TMI for most users. Recommendation: one-sentence summary + link to proposal.

3. **Is `IK_PARITY_FEET` the right name?** Alternatives: `ORBITAL_FEET`, `CROSSING_FEET`, `WALKING_FEET`. `IK_PARITY_FEET` communicates "same trajectory as the IK version" but couples the name to an implementation detail. The user said "mimic the IK version," so the name matches their language.

4. **Should we also fix the Embertomb stride length?** The Embertomb player scales `DEFAULT_GAIT` by 0.55, producing `strideLength: 2.2`. This small stride means the feet barely move even at `idleSpread: 0`. The crab-like read may also be caused by insufficient stride amplitude. Should the proposal recommend adjusting the Embertomb gait parameters alongside the preset?
