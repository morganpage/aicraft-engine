# Roadmap: Character & Enemy Variety

> Status: **VALIDATION IN PROGRESS — humanoid + charger only**
> Created: 2026-07-27.
> Owner: `@team` (orchestrator).

The active work is governed by
`docs/design/post-0.4-character-enemy-validation-plan.md`. Earlier proposal
critiques are historical inputs only; promotion remains unapproved until the
Phase 10 architecture verdict. Floater, serpentine, chaser, burster, flyer, and
crawler are deferred.

The current API hypothesis is a heterogeneous typed registry with direct
humanoid exports as the required fallback. A closed discriminated-union
dispatcher is no longer the active direction.

## Purpose

Increase the variety of player character and enemy archetypes that
`aicraft-engine` can produce, inspired by **Dead Cells** (fluid hand-drawn
combat platformer with distinct enemy silhouettes and telegraphed attacks)
and **Axiom Verge** (biomech pixel-art metroidvania with many variants of a
small base). Each phase runs the full research-first R&D loop (research →
API design → architect critique → prototype → benchmark → decide →
implement → document).

## The variety problem, reframed for this library

The library is **procedural** — no raster art ships. "More characters" does
**not** mean more bespoke sprite sheets; it means **more combinatorial
surface area** across three orthogonal axes:

1. **Body plans** (silhouette archetypes — slime ✓, humanoid biped, biomech,
   flyer, quadruped…)
2. **Behaviors** (movement + attack archetypes — patrol ✓, turret ✓,
   spider ✓, chaser, flyer, burster, shielder, swarmer, caster…)
3. **Cosmetics** (seeded parametric variation — palette ✓, limb/eye count,
   body proportions, appendages…)

Both reference games achieve their felt variety through exactly this shape:
Dead Cells enemies are silhouettes × behaviors × weapon variants; Axiom
Verge enemies are biomech bodies × movement patterns × glitch tints. The
library's existing pillars (cosmetics, palette, skeletal rig) are already
the right substrate. This roadmap extends them.

## Current state (the foundation we build on)

| Surface | What exists | Where |
|---|---|---|
| Player character | Slime-knight hero: seeded config, squash/stretch, antenna spring, IK legs OR simple feet, cyclops/two-eye toggle, parametric mouth | `showcase/sections/hero.ts`, `showcase/helpers/slime-knight.ts` |
| Enemy archetypes | 3 built-ins: `spinny` (contact sawblade), `turret` (ranged shooter, fixed/aimed), `spider` (multi-legged IK gait) | `src/platformer/enemy/` |
| Behavior registry | Extensible: `createEnemyBehaviorRegistry(customHandlers)` | `src/platformer/enemy/registry.ts` |
| Animation | Skeletal rig, 2-bone IK + CCD + FABRIK, procedural locomotion, foot-lock, oscillators, spring-rods, squash/stretch | `src/animation/` |
| Cosmetics | Versioned manifest, seeded variant generation, multi-slot ownership | `src/cosmetics/` |
| Palette | OKLCH substitution, harmonic generation, WCAG AA contrast repair | `src/palette/` |
| Game-feel | Hit-stop (freeze-frame), particles, screen shake | `src/primitives/`, `src/particles/` |
| Combat | None — no HP, no damage, no i-frames, no knockback, no telegraph system | (gap) |

## Gap analysis (what's missing for Dead Cells / Axiom Verge variety)

1. **Only one player body plan.** Slime-knight is great but consumers wanting
   a humanoid knight, biomech, or flying protagonist have no starting point.
2. **Only 3 enemy archetypes.** No melee chaser, no aerial flyer, no
   kamikaze, no armored/shielded foe, no swarmer, no AOE caster.
3. **No combat primitives.** No HP, no damage events, no i-frames, no
   knockback. Enemies currently are pure movement/hazard; they cannot wound
   or be wounded deterministically.
4. **No telegraph system.** Dead Cells' signature is windup → active →
   recovery frames on every enemy attack. Axiom Verge enemies pulse/glow
   before firing. Without this, combat variety feels arbitrary.
5. **No within-plan silhouette diversity.** A slime-knight seeded variant
   changes color and a few params, but cannot gain/lose limbs, eyes, or
   appendages within the slime plan.

## Proposed phases

Each phase is a full R&D loop. Phases 1 and 2 can be researched in
parallel (independent surfaces). Phase 3 depends on Phase 2 having at
least one melee archetype to demo against. Phase 4 composes with all
prior phases.

### Phase 1 — Player Character Body-Plan Catalog

- **Slug**: `character-body-plans`
- **Goal**: 2-3 new body plans alongside slime-knight.
- **Candidates** (research will narrow):
  - **Humanoid biped** (knight / cyborg — head + torso + 2 arms + 2 legs)
  - **Biomech / robot** (asymmetric, plated, mechanical joints — Axiom Verge flavor)
  - **Floater / drone** (no legs, hover bob, thrusters or tentacles)
- **API hypothesis** (for `@api-designer` to refine):
  ```ts
  type BodyPlan = 'slime' | 'humanoid' | 'biomech' | 'floater';
  deriveCharacterConfig(seed: number, plan: BodyPlan): CharacterConfig;
  drawCharacter(ctx, frame, plan, options): void;
  ```
- **Deliverable**: a 4-up benchmark sheet showing one of each plan, idle +
  walk + jump, each seeded with 3 different seeds.

### Phase 2 — Enemy Archetype Catalog Extension

- **Slug**: `enemy-archetype-catalog`
- **Goal**: ~5 new behavior handlers added to the registry.
- **Candidates** (research will prioritize against Dead Cells / Axiom Verge
  patterns):
  | Archetype | Reference | Behavior |
  |---|---|---|
  | `chaser` | Dead Cells Runner / Zombie | Walks/runs toward player on sight, melee on contact |
  | `flyer` | Axiom Verge drone / Dead Cells Fly | Sine-wave or seek-path aerial movement |
  | `burster` | Dead Cells Kamikaze | Approaches then explodes on a telegraphed timer |
  | `shielder` | Dead Cells Shieldbearer | Front-armor block; must be hit from behind or during attack |
  | `swarmer` | Axiom Verge coalesced spawn | Small, fast, spawns in groups, weak individually |
- **Deliverable**: a benchmark sheet of all new archetypes in a test level,
  plus updated `DEFAULT_CATALOG` entries for the editor.

### Phase 3 — Telegraphed Attack System

- **Slug**: `telegraphed-attacks`
- **Goal**: a deterministic state-machine primitive for windup → active →
  recovery, composable with any enemy or the player.
- **Reference**: Dead Cells telegraphs (200–400ms windup with silhouette
  change); Axiom Verge pulse-glow telegraphs.
- **Composes with**: existing hit-stop primitive (freeze-frame on active
  frame connect).
- **API hypothesis**:
  ```ts
  type TelegraphPhase = 'idle' | 'windup' | 'active' | 'recovery';
  advanceTelegraph(state, dt, triggers): TelegraphState;
  drawTelegraphOverlay(ctx, state, pose): void; // flash / glow / silhouette squash
  ```
- **Deliverable**: at least one Phase-2 enemy (likely `chaser` or
  `burster`) gains a telegraphed attack; benchmarked.

### Phase 4 — Within-Plan Silhouette Diversity

- **Slug**: `silhouette-diversity`
- **Goal**: seeded parametric variation within a single body plan — limb
  count, eye count, body proportions, optional appendages (antenna, tail,
  spikes, fins).
- **Composes with**: existing cosmetics manifest and palette pillars.
- **API hypothesis**: extend `CharacterConfig` (or `CosmeticVariant`) with
  a `morphology` slot.
- **Deliverable**: an 8-up sheet showing 8 silhouette-distinct variants of
  the same body plan, all reachable from a seed.

### Phase 5 (stretch, only if Phase 4 surfaces the need)

- **Slug**: `combat-kernel`
- **Goal**: HP, damage events, i-frames, knockback — the minimum combat
  surface to make Phase 2 + Phase 3 enemies actually fight back.
- **Note**: currently out of scope per the existing decision doc's Scope
  Guard. Only revisit if Phases 2–4 feel inert without it.

## Execution strategy

- **Parallel kickoff**: dispatch `@researcher` for Phase 1 and Phase 2 in
  parallel after approval (independent surfaces, no shared decisions).
- **Sequential after that**: Phase 3 waits for Phase 2's `chaser` or
  `burster` to anchor the telegraph demo. Phase 4 can start as soon as
  Phase 1's body-plan API stabilises (so it knows what to extend).
- **One technique in flight per phase** to keep `@architect` critique
  focused. The orchestrator may overlap phases at different stages (e.g.
  Phase 1 in implement while Phase 2 in research) per the team workflow.
- **Per phase**, the orchestrator writes a `docs/design/<slug>-decision.md`
  before implementation, referencing the research note, proposal, architect
  verdict, and benchmark PNGs that drove the decision.

## Verification per phase

Every phase must clear before its decision is filed:

- Research note in `docs/research/<slug>.md`
- 2-3 API approaches in `docs/design/<slug>-proposal.md`
- `@architect` APPROVED verdict
- At least one benchmark PNG in `benchmarks/<slug>/`
- `npm test` and `npm run build` clean after implementation
- `docs/api-surface.md` updated by `@api-designer`

## Out of scope (this roadmap)

- Raster sprite sheet import (violates the procedural rendering principle)
- Dialogue / quest / story systems
- Multiplayer / netcode
- Save-game schema changes (combat state, if added, must fit existing pure-
  progression-ops discipline)

## Cross-references

- Existing research: `docs/research/platformer-enemy-archetypes.md`
- Existing decision: `docs/design/platformer-enemy-archetypes-decision.md`
- Spider locomotion: `docs/research/procedural-spider-locomotion.md`
- Skin variation: `docs/research/algorithmic-skin-variation.md`
- Sokpop teardown: `ai-craft-strategy/knowledge/sokpop-minimalist-rendering-teardown.md`
- Clone-to-Jest methodology: `ai-craft-strategy/knowledge/clone-to-jest-methodology.md`
