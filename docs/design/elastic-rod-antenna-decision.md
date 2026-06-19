# Decision: Elastic Rod Antenna Bending Resistance

> Date: 2026-06-20.
> Technique slug: `elastic-rod-antenna`.
> Status: DECIDED — implementing.

## Decision

**Provot next-nearest-neighbor bend springs (Approach A), showcase-local (L3), coexisting with `applyAntennaRestPose`, with midpoint Bezier rendering (R1).**

The antenna's Verlet/PBD chain had only distance constraints (free-hinge joints), causing it to buckle and whip like a rope under jump acceleration. Adding Provot bend springs — distance constraints between nodes `i` and `i+2` with rest length `2 x segmentLength` — provides inter-segment bending resistance that makes the chain read as a bendy solid rod. The constraint coexists with the existing absolute-direction spring (`applyAntennaRestPose` owns world-space forward lean; the bend springs own inter-segment smoothness). The polyline antenna stroke was replaced with midpoint Bezier rendering (C1 continuity) as a complementary visual smoothing.

Placement is showcase-local (L3) for v1 per the architect's recommendation: validate the physics before promoting to a library export. The function is a simple ~30-line positional correction; promoting to L2 (`src/animation/spring.ts`) is a documented follow-up once a second consumer (hair, tails, capes) materializes.

## Key inputs that drove the decision

1. **Research** (`docs/research/elastic-rod-antenna.md`): identified Provot bend springs as the simplest viable physics fix (reuses existing PBD distance machinery; pure arithmetic; composes with the solver).
2. **Architect critique**: corrected the proposal's load-bearing claim that angular constraints could "subsume" the absolute-direction spring (they cannot — angular encodes curvature, not world-space orientation; the absolute spring is required for forward lean). Recommended L3-first placement (don't ship an unvalidated library API).
3. **Prototype comparison** (`benchmarks/antenna-bend-comparison.png`): A/B/C render of baseline vs Provot vs angular PBD across a jump-landing sequence. After fixing an angular sign-inversion bug and raising Provot stiffness, the user's visual verdict selected Provot (Row 2) as the smoothest rod read on landing impact.
4. **Why not angular PBD** (Approach B/C): theoretically superior (no 180-degree pop, native curved rest poses) but underperformed Provot in practice at comparable stiffness. The angular approach is documented in the proposal for future reference if Provot's 180-degree pop becomes an issue (unlikely for the antenna's moderate deflection).

## Constants shipped

- `ANTENNA_BEND_STIFFNESS_BASE = 0.9` (base joint, closest to anchor)
- `ANTENNA_BEND_STIFFNESS_TIP = 0.65` (tip joint, furthest from anchor)
- Rest length per i-to-i+2 pair: `2 * segmentLength` (straight-rod; coexists with the absolute spring's forward lean)

## Follow-ups

- **L2 promotion**: when a second consumer of bending resistance arrives (hair, tails, capes, vines), extract `applyAntennaBendConstraints` into `src/animation/spring.ts` as `applyBendConstraints(nodes, config: BendConfig)`. The showcase-local version becomes a thin wrapper or is replaced by the library import.
- **Stretch-drift re-projection**: Provot's distance constraints between `i` and `i+2` can introduce sub-pixel segment-length drift in the adjacent `(i, i+1)` pairs. Invisible for short chains over short runs; flag for the library version (add a post-bend distance re-projection pass or interleave within the solver's iteration loop).

## Cross-references

- `docs/research/elastic-rod-antenna.md` — prior-art survey.
- `docs/design/elastic-rod-antenna-proposal.md` — API proposal (Approaches A/B/C).
- `showcase/helpers/slime-knight.ts` — production implementation (`applyAntennaBendConstraints` + `strokeBezier`).
- `benchmarks/antenna-bend-comparison.png` — the A/B/C comparison that drove the decision.
