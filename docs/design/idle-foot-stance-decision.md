# Decision: Idle Foot Stance Blend

> Date: 2026-07-20.
> Decided by: @team (orchestrator). Architect returned no verdict after two
> attempts — decision grounded in geometry, prototype, and benchmark evidence.
> Proposal: `docs/design/idle-foot-stance-proposal.md`.
> Architect critique: NO VERDICT (two attempts — see notes below).
> Benchmark: `benchmarks/idle-foot-stance/` (hero-comparison.png, playground-comparison.png).

## Decision

**Chosen approach:** A — `blendLocomotionToStance`.

## Why

The benchmark comparison images are conclusive. At hero scale (footW 28, spread 30),
`benchmarks/idle-foot-stance/hero-comparison.png` shows four rows across five blend
weights (t = 0.00 → 1.00). In the STANCE BLEND (A) rows, feet separate cleanly as
`idleFootSpread/2` (15 px each side) replaces the walk-cycle offset — at t = 1.00
there is a visible 2 px gap between foot rectangles. In the BLEND-TO-ZERO (OLD) rows,
both feet converge to the midline and overlap as a single rect at t = 1.00, confirming
the bug the requirement describes. The mid-swing phase (φ = 1.50π) shows the same
result: Approach A preserves the IK-parity crossing at t = 0 and resolves to a stance
at t = 1, with no intermediate-frame artifacts.

At playground scale (footW 7, spread 8), `benchmarks/idle-foot-stance/playground-comparison.png`
confirms the same behaviour at character scale. The 1 px gap at t = 1.00 is subtle but
visible — the two small rects are distinct. The OLD blend-to-zero rows show overlap at
full idle, exactly matching the playground's known bug.

Geometry confirms the math: `idleFootSpread = footW + desiredGap` produces
`halfSpread = (footW + gap) / 2`. At full blend, each foot sits at `±halfSpread` from
the midline. The inner edges are at `halfSpread - footW/2 = gap/2` from the midline on
each side, yielding a total gap of `gap` pixels. Hero: `gap/2 = 1 px` each side → 2 px
total. Playground: `gap/2 = 0.5 px` each side → 1 px total (sub-pixel rounding handled
by `Math.round` in the renderer).

The architect was invited to critique the proposal twice. No verdict was returned on
either attempt. The orchestrator proceeded on the basis that (a) the proposal's formulas
are algebraically correct (lerp to `±spread/2`), (b) the benchmark images visually
confirm correct behaviour at both scales, (c) Approach A mirrors the existing
`blendAirborneTuck` API shape (same file, same pattern), and (d) no alternative
approach was championed by the architect.

## Locked Semantics

These are binding implementation constraints. `@coder` must respect them; future
design changes require a new proposal.

1. **`idleFootSpread` is the total center-to-center distance** between the two feet
   at full idle (stanceBlend = 1). Each foot targets `±spread/2` from the body
   midline. Not half-spread, not per-foot — total.

2. **Hero spread = 30.** footW 28 + desiredGap 2 = 30. Half-spread = 15. Inner gap
   = 2 px.

3. **Playground spread = 8.** footW 7 + desiredGap 1 = 8. Half-spread = 4. Inner gap
   = 1 px.

4. **No engine default.** There is no `DEFAULT_IDLE_FOOT_SPREAD`. Foot scale is
   character-specific; the consumer supplies `idleFootSpread` explicitly. `footW +
   desiredGap` is the documented formula for choosing a spread that produces
   visibly distinct foot rectangles.

5. **Consumer owns stop/ground blend.** The engine does NOT couple speed or grounded
   state into `blendLocomotionToStance`. The consumer computes `stanceBlend` from
   its own speed/ground detection and passes it in. The engine is a pure pose
   transformer.

6. **Consumer owns airborne gating.** The consumer gates `stanceBlend` by `(1 -
   airborneBlend)` before passing it to `blendLocomotionToStance`. The engine does
   not read `airborneBlend`.

7. **Composition order: stance before tuck.** `blendLocomotionToStance` is applied
   FIRST; `blendAirborneTuck` is applied SECOND on each foot offset from the stance
   result. This ensures:
   - Idle + grounded: stanceBlend = 1 → feet at `±idleFootSpread/2`
   - Walking + grounded: stanceBlend = 0 → pure walk pose
   - Idle + airborne: consumer gates stanceBlend by `(1 - airborneBlend)`, then
     tuck overrides → feet tuck
   - Walking + airborne: stance blend = 0, tuck overrides → feet tuck

8. **Defensive finite/clamp behaviour.**
   - `stanceBlend`: finite values clamped to [0, 1]; non-finite (NaN, ±Infinity)
     treated as 0 (pure walk pose).
   - `idleFootSpread`: finite values clamped to >= 0 (negative treated as 0);
     non-finite treated as 0.
   - Never throws on any numeric input.

## Architect Notes

The architect was given two opportunities to return a verdict on
`docs/design/idle-foot-stance-proposal.md`. Neither attempt produced a response. The
orchestrator assessed that the proposal was self-contained (formulas derivable from
first principles, benchmark images independently verifiable) and proceeded to decide
without architect approval. This is an exception to the normal review flow, justified
by the low risk profile: the proposal is a single additive pure function with no
breaking changes and no new dependencies.

## What was rejected, and why

- **Approach B (Extend `SimpleFeetConfig`):** rejected because it bakes blend logic
  into the renderer, hiding the blended pose from consumers who need it for foot-plant
  detection and dust spawning. It also adds a 4th optional parameter to `drawSimpleFeet`,
  breaking the clean 3-param signature.
- **Approach C (Consumer-only / documentation patch):** rejected because it perpetuates
  the exact bug the requirement describes — consumers will keep blending to 0 and
  producing overlap. The playground's current bug is the proof.

## Implementation notes for @coder

1. Add `blendLocomotionToStance` to `src/animation/locomotion.ts` alongside the
   existing `blendAirborneTuck`. Use the exact formula from the proposal (§Approach A,
   "Exact formulas"). The function must be exported from the module barrel and from
   `src/index.ts`.

2. JSDoc must match the wording locked in the proposal exactly — parameter descriptions,
   defensive handling, composition order, and usage examples. The `@example` blocks
   show both hero and playground consumer patterns.

3. Unit tests in `src/tests/` must cover: (a) identity at t=0 (output === input pose
   fields), (b) full stance at t=1 (feet at `±spread/2`, Y = 0, hip = 0), (c)
   midpoint at t=0.5 (lerp verification), (d) non-finite stanceBlend treated as 0,
   (e) non-finite idleFootSpread treated as 0, (f) negative idleFootSpread clamped to 0,
   (g) stanceBlend clamped outside [0,1], (h) input not mutated.

4. Do NOT modify `drawSimpleFeet`, `SimpleFeetConfig`, or any existing export. This is
   purely additive.

5. The proposal's "Resolved Design Decisions" section (§1–5) is binding — do not
   introduce engine defaults, composition-order changes, or throw-on-bad-input
   behaviour.
