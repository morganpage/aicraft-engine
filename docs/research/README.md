# Research Notes

This directory holds prior-art research written by the `@researcher` agent. Each note is the foundation for an API proposal (`docs/design/<technique>-proposal.md`) and the implementations in `src/`.

## Convention

- One file per technique, named `<technique-slug>.md` (lowercase-kebab).
- The note format is defined in `prompts/researcher.md` — every note follows it exactly.
- Notes are dated in the front-matter (`> Investigated: YYYY-MM-DD.`). Research goes stale; the date tells future readers when to re-verify.
- Notes cite sources for every claim. Unsourced assertions are opinion, not research.
- Notes do **not** propose APIs (that's `@api-designer`'s job) or implement code (that's `@coder`'s job). They surface patterns; the rest of the team acts on them.

## When to write a note

Write a new note whenever the team starts work on a non-trivial technique. "Non-trivial" means: the best API design is not obvious from prior work in this library, or the technique has a research literature worth surveying.

Skip notes for:

- Bug fixes (write a failing test, fix it).
- New utilities with obvious design (e.g., adding a new color math function).
- Refactors that don't change semantics.
- Documentation polish.

## Relationship to other docs

```
docs/research/<technique>.md        # Prior-art survey (@researcher)
    ↓
docs/design/<technique>-proposal.md # 2-3 API approaches (@api-designer)
    ↓
docs/design/<technique>-decision.md # What was chosen and why (@team decides, @api-designer records)
    ↓
src/<module>/<thing>.ts             # Implementation (@coder)
    ↓
benchmarks/<technique>/             # Visual proof (@benchmarker)
    ↓
docs/api-surface.md                 # Canonical export map (@api-designer maintains)
```

## Cross-references

When writing a note, include cross-references to:

- Other notes in this directory that informed or are informed by this one.
- Related strategic docs in `~/Documents/VSCODE/OPENCODE/ai-craft-strategy/knowledge/` — especially `sokpop-minimalist-rendering-teardown.md` (the canonical Sokpop reference) and `clone-to-jest-methodology.md` (the pipeline this engine serves).
- Existing modules in `src/` that this technique would extend or replace.

## Current techniques to research (v0.1 backlog)

As of Phase 1 completion, the next techniques worth research notes are:

- **Procedural character generation** (Sokpop part-2 method, demoscene character stacks, billboarded primitive composition) — feeds Pillar 4 fake-3D and Pillar 2 cosmetics
- **Algorithmic skin variation** (palette rotation, HSL variation, seed-driven parameter jitter, contrast preservation) — feeds Pillar 2 cosmetics
- **Cosmetic manifest format** (JSON schema for skin/theme/content packs; migration pattern; defensive parse) — feeds Pillar 2 cosmetics
- **IAP bridge adapter pattern** (interface shape mirroring Spitekeep's `SaveStorage`; entitlement state model; platform adapter lifecycle) — feeds Pillar 3 IAP
- **Fake-3D cube face-sorting** (painter's algorithm; depth key; camera-orientation culling) — feeds Pillar 4 fake-3D
- **Isometric tile projection** (Sokpop's orthographic projection in pure Canvas2D; tile vs. entity layers) — feeds Pillar 4 fake-3D
