# Decision: Procedural Level Generation

**Status:** APPROVED DIRECTION — amended by the canonical implementation plan.
**Date:** 2026-07-28
**Loop:** 2 of max 2 architect critique loops.

> **Implementation authority:** `docs/design/level-generation-quality-implementation-plan.md`.
> The amendment preserves the approved deterministic, physics-aware direction while
> correcting runtime compilation, editor integration, verification, and quality
> contracts found during implementation-readiness review.

## Chosen approach

**Physics-aware constructive generation**, expanded into a staged composition:
path-first macro layout + rhythm/pacing plan + physics-constrained realization +
verification, scoring, repair, and deterministic candidate selection.

The canonical `GeneratedLevel` shape is defined in the implementation plan. It
returns authoritative `LevelData`, explicit generated-tile semantics, a singular
undoable `replaceLevel` editor operation, and a generation/quality report.

## Rationale

The architect approved the revised proposal with no objections (loop 2 returned
APPROVED). The implementation-readiness amendment retains its useful foundation:

1. **Physics-aware construction** — authoritative kernel configuration constrains
   placements, while joint trajectory checks and replay verification establish what
   scalar maxima alone cannot prove.
2. **Editor integration** — a `replaceLevel` operation can reproduce arbitrary
   generated dimensions, metadata, tile grids, and entity counters with one-step
   undo/redo.
3. **Runtime-safe output** — generated tile semantics are explicit, so compilation,
   static analysis, and simulation use the same collision interpretation.
4. **Convention fit** — pure, deterministic, never-throw, no-mutate, JSDoc-complete, zero-dep, barrel-exported. All 12 architect objections addressed in the revision.

## Original alternatives and amendment

- Approach C remains the realization foundation.
- Approach A's path-first structure is adopted as the macro-layout stage.
- Approach B's rhythm grammar is adopted as the pacing stage.
- The public API retains a one-call `generateLevel` entry point; advanced consumers
  may inspect or supply the intermediate blueprint.

## Implementation plan

Follow phases 0–7 in
`docs/design/level-generation-quality-implementation-plan.md`. Runtime tile
semantics and editor replacement are prerequisites; generation is not marked
shipped until the plan's acceptance criteria pass.

## Follow-ups (not blocking v1)

- Consumer-replaceable rhythm stages beyond the shipped default pipeline (v2).
- Vertical level support (v2).
- Chunk template library expansion (v2, after consumer feedback).
