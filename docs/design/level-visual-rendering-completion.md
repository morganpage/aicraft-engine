# Level visual rendering — completion record

> **Status:** COMPLETE
> **Completed:** 2026-07-29
> **Plan:** [`level-visual-rendering-plan.md`](./level-visual-rendering-plan.md)

## Outcome

Phases 0–6 are delivered. The unchanged rectangle-authored playground and the
scrolling tile room render through fallback, Ruins, Cavern, Mechanical, and
Outdoor treatments. The public stack includes deterministic visual addressing,
prepared connectivity/exposure, normalized materials, connected tile and
rectangle renderers, ordered theme passes, semantic entity art, atmosphere,
editor previews, fallback theme resolution, and deterministic thumbnails.

Theme persistence is intentionally outside `LevelData` for this release. That is
the accepted result of
[`level-visuals-persistence-decision.md`](./level-visuals-persistence-decision.md),
not an incomplete deliverable.

## Release budgets

### Distribution

Phase 0 baseline:

| Measure | Baseline | Phase 6 ceiling | Final |
|---|---:|---:|---:|
| Total `dist` | 1,662,368 B | 1,828,604 B (+10%) | 1,777,426 B (+6.92%) |
| JavaScript | 973,436 B | 1,090,248 B (+12%) | 1,062,526 B (+9.15%) |
| Declarations | 688,932 B | 757,825 B (+10%) | 714,900 B (+3.77%) |

`npm run check:level-visual-size` enforces these ceilings after
`npm run build:dist`.

### Rendering

`npm run bench:level-visual` measures every §13.3 fixture through fallback and
production Cavern rendering in the same process. The portable blocking budget is
production median and p95 no greater than **5×** the corresponding same-host
fallback. The final run passed every cell.

On the Phase 0 Apple M1 host, the optimized production terrain measured:

| Fixture | Median | p95 |
|---|---:|---:|
| Playground rectangles | 0.103 ms | 0.141 ms |
| Generated 60×34 room | 0.315 ms | 0.692 ms |
| Topology 60×34 room | 1.647 ms | 2.040 ms |
| Large 200×34 room | 0.257 ms | 0.680 ms |
| Dense 60×34 worst case | 4.947 ms | 16.978 ms |
| Parallax plus terrain | 1.477 ms | 2.000 ms |
| 160×107 thumbnail | 1.307 ms | 1.637 ms |

The benchmark caught and blocked a dense Cavern-facet regression during closeout;
the final renderer uses one bounded coordinate-addressed facet candidate per
visible cell instead of a nested lattice scan.

### Bundle isolation

`npm run check:terrain-tree-shaking` performs a real Vite/Rollup production
bundle from the `drawTerrainRect` leaf module. Its final chunk contains only:

- `src/rng/visual-seed.ts`
- `src/terrain/rect-renderer.ts`

It fails if the bundle contains built-in themes, `tile-renderer.ts`, or the
surface-detail catalog.

## Visual review

`npm run visual:sheets` produces nine sheets and renders every sheet twice,
failing if the PNG buffers differ:

1. fallback baseline scenes;
2. topology comparison;
3. 8/16/32px scale matrix;
4. fallback/Ruins/Cavern/Mechanical/Outdoor comparison;
5. fractional-DPR snapping junction;
6. reduced-motion theme thumbnails;
7. every built-in surface-detail treatment;
8. semantic role sheet;
9. play versus edit/debug presentation.

The advisory Phase 6 review accepted the gallery: themes are distinguishable,
roles remain readable, connected cells show no internal grid, details remain
legible across the scale matrix, thumbnails are meaningful without animation,
and authoring markers stay out of play mode.

## Final acceptance audit

| Plan §18 criterion | Result |
|---|---|
| 1–7: treatments, identity, connectivity, rectangle vocabulary, roles, exits, editor markers | Passed by the two showcase scenes, semantic renderer tests, and review sheets |
| 8–10: stable details, no mutation, theme/simulation separation | Passed by visual-seed, theme, renderer, and preview tests |
| 11–12: visible-only work and balanced Canvas state | Passed by viewport/culling and Canvas-discipline tests |
| 13–15: reduced motion, procedural/raster layers, safe malformed data | Passed by theme/thumbnail tests and showcase integration |
| 16–17: zero runtime dependencies, documented public exports | Passed by `package.json`, build, API map, architecture, and integration guide |
| 18: unit/integration/showcase/typecheck/dist/benchmark gates | Passed by the release command set below |
| 19: fractional-DPR seam matrix | Passed at 8/16/32px × DPR 1/1.25/1.5/1.75/2/3 plus 9px × 1.3 |
| 20–22: prepare-time normalization, branded inputs, resolved entities exactly once | Passed by material and theme contract tests |
| 23: distribution ceiling and leaf bundle isolation | Passed by the two Phase 6 scripts |

## Release command set

```bash
npm run build
npm test
npm run build:dist
npm run check:level-visual-size
npm run check:terrain-tree-shaking
npm run showcase:typecheck
npm run showcase:test
npm run showcase:build
npm run visual:sheets
npm run bench:level-visual
npm pack --dry-run
```
