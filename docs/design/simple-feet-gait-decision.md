# Decision: Simple-Feet Orbital Gait

> Date: 2026-07-20.
> Decided by: @team (orchestrator).
> Proposal: `docs/design/simple-feet-gait-proposal.md`.
> Architect critique: NO VERDICT (two attempts — see note below).
> Benchmark: `benchmarks/simple-feet-gait/gait-sheet.png`.

## Decision

**Chosen approach:** A — named `IK_PARITY_FEET` config preset with `idleSpread: 0`, plus improved JSDoc on `idleSpread` and `drawSimpleFeet`.

## Why

The user's requirement is **endpoint symmetry with side swapping** — feet that "rotate around each other so with each footfall the feet are the same width apart," mimicking the IK version. The benchmark sheet (`gait-sheet.png`) and corrected geometry prove that `idleSpread: 0` achieves this exactly:

**Current Embertomb (`idleSpread: 3`, `strideLength: 2.2`):**
- Phase 0 (F00): left at −0.8, right at +0.8 → **1.6px separation**, no side swap
- Phase π (F12): left at −5.2, right at +5.2 → **10.4px separation**, no side swap
- The feet never cross. Maximum separation is 6.5× the minimum. The crab-like read persists.

**IK-parity (`idleSpread: 0`, `strideLength: 2.2`):**
- Phase 0 (F00): left at +2.2, right at −2.2 → **4.4px separation**, sides swapped (left is right of right)
- Phase π (F12): left at −2.2, right at +2.2 → **4.4px separation**, sides swapped back
- At every footfall endpoint: equal magnitude (2.2px) from the midline on opposite sides. Side swap occurs each half-cycle. This is the IK-parity trajectory.

The benchmark image confirms: column (B) IK-Parity shows the feet crossing the midline and swapping sides, while column (A) Embertomb shows the feet swinging in parallel arcs with asymmetric separation. Column (C) Rigid-Width Waddle maintains constant 4.4px separation at ALL phases — but this does not mimic the IK version. The IK version's foot targets follow `cos(phase) * strideLength`, which produces sinusoidal separation that peaks at endpoints and passes through zero at midline crossings. Constant separation is a different trajectory entirely.

### Rigid-width waddle: rejected

The user's phrasing "the feet are the same width apart" refers to **endpoint symmetry** (equal magnitude at each footfall), not constant all-phase separation. Constant separation is mathematically incompatible with sinusoidal locomotion: `distance(φ) = 2s − 2·cos(φ)·L` is constant only when `L = 0` (no stride = no walk). Rigid-width waddle would require abandoning the sinusoidal trajectory, diverging from the IK version's foot-target path. The benchmark confirms this reads as shuffling, not walking.

### `orbitalBlend`: rejected

`orbitalBlend` is a rescaled `idleSpread` (`effectiveSpread = idleSpread × (1 − blend)`). It aliases the existing field, creating a two-knob interaction where the semantic meaning of `orbitalBlend` depends on what `idleSpread` already is. A consumer setting `orbitalBlend: 0.6` gets `effectiveSpread = idleSpread × 0.4` — but this means different things for `idleSpread: 5.5` vs `idleSpread: 3`. The simpler API is to set `idleSpread` directly. No new field needed.

### Architect note

The architect returned no verdict after two attempts. The orchestrator resolved based on corrected geometry derivations (§The IK-parity math in the proposal) and the benchmark visual evidence. The math is unambiguous: at `idleSpread = 0`, foot center positions are `±cos(φ) × strideLength`, which produces equal-magnitude endpoint separation with side swapping — the exact IK-parity trajectory.

## What was rejected, and why

| Approach | Why it lost |
|---|---|
| **B: `orbitalBlend`** | Aliases `idleSpread` — two fields controlling the same thing with non-obvious interaction. Consumers must understand `effectiveSpread = idleSpread × (1 − blend)` to use it. The simpler API is setting `idleSpread` directly. |
| **C: Constant-separation orbit** | Mathematically incompatible with sinusoidal locomotion (`L = 0` required). Does not mimic the IK version. Reads as shuffling. |

## What ships

1. **New export:** `IK_PARITY_FEET` — a named `SimpleFeetConfig` preset with `idleSpread: 0`, all other fields matching `DEFAULT_SIMPLE_FEET`. JSDoc explains the orbital gait behavior and IK-parity trajectory.

2. **Updated JSDoc on `SimpleFeetConfig.idleSpread`:** Documents the orbital behavior: `0` = orbital crossing / IK-parity (feet center on midline, orbit symmetrically with endpoint parity); default `5.5` = wide stance, no crossing. Values between 0 and `strideLength` produce partial crossing.

3. **Updated JSDoc on `drawSimpleFeet`:** Adds an "Orbital gait" section explaining the crossing behavior, linking to `IK_PARITY_FEET`, and documenting the endpoint-separation formulas.

4. **Apply `idleSpread: 0` to Embertomb:** The Embertomb player should spread `IK_PARITY_FEET` instead of `DEFAULT_SIMPLE_FEET` to get the orbital gait.

**No changes to:**
- `drawSimpleFeet` implementation (same formula, same behavior — `idleSpread: 0` is just a config value)
- `SimpleFeetConfig` interface (no new fields)
- `DEFAULT_SIMPLE_FEET` (unchanged, backward-compatible)

## Implementation notes for @coder

1. **`IK_PARITY_FEET`** is a `Readonly<SimpleFeetConfig>` const in `src/animation/simple-feet.ts`. Derive from `DEFAULT_SIMPLE_FEET` with `idleSpread: 0` (matches the `scaledGait` pattern).

2. **JSDoc on `idleSpread`** must include the endpoint-separation formula: "At 0, both feet center on the midline and orbit via `cos(phase) * strideLength`. At each footfall endpoint, both feet have equal magnitude from the midline on opposite sides (IK-parity). At the default 5.5, feet sit at ±5.5px — wide stance, no crossing."

3. **JSDoc on `drawSimpleFeet`** must add a brief orbital gait section referencing `IK_PARITY_FEET` and the crossing behavior.

4. **No implementation changes to `drawSimpleFeet`** — the existing formula `leftX = -idleSpread - footW/2 + pose.leftFootOffset.x` already handles `idleSpread: 0` correctly. The preset is purely a config recipe.

5. **Tests:** Add deterministic invariants for `IK_PARITY_FEET`: at phase 0, `|leftCenter| = |rightCenter| = strideLength` and `leftCenter > 0 > rightCenter` (side swap). At phase π, the ordering reverses. These are properties of the config + locomotion formula, not new code paths.

6. **Embertomb migration:** Update the Embertomb player to spread `IK_PARITY_FEET` instead of `DEFAULT_SIMPLE_FEET`, overriding `footW`/`footH`/`color`/`outline` with its palette.
