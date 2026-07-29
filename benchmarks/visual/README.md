# Level-visual contact sheets

Review artifacts for
[`docs/design/level-visual-rendering-plan.md`](../../docs/design/level-visual-rendering-plan.md).

**These sheets are advisory.** Per §14.6 "What blocks a merge", contact-sheet
review informs a reviewer but does not mechanically fail a PR. The blocking
automated gate is the §14.5 determinism assertion — which the generator applies
to itself: every sheet is rendered twice and the two buffers must be
byte-identical, or the script exits non-zero.

## Reproduce

```bash
npm run visual:sheets
```

```bash
npm run bench:level-visual
```

Both are deterministic. Same code, same machine → same PNG bytes. If the PNGs
change between runs without a code change, that is a library bug, not a script
bug (see [`../README.md`](../README.md)).

## What each sheet shows

| File | Shows | Answers |
|---|---|---|
| `baseline-scenes.png` | The playground, generated room, and topology room through the fallback renderer | The retained Phase 0 comparison baseline. |
| `topology-sheet.png` | The seven §14.6 shapes — isolated, ledge, corner, tunnel, pillar, room, staircase — fallback above, production Cavern below | Review question 5: do connected surfaces look continuous? |
| `scale-sheet.png` | The same topology at 8px, 16px, and 32px tiles | Review question 3: does any surface detail become noise at small scale? |
| `treatment-compare.png` | Identical geometry/camera/player across fallback, Ruins, Cavern, Mechanical, and Outdoor | Whether a theme changes anything other than appearance. |
| `snapping-junction.png` | The playground's wall/floor junction under a fractional `sineShake` offset, rendered into real device-pixel backing stores at DPR 1, 1.25, 1.5, and 2, then magnified 5× with smoothing off | Review question 8: are visible seams or subpixel cracks present? |
| `theme-thumbnails.png` | Ruins, Cavern, and Mechanical through deterministic fit-to-box thumbnail rendering | Reduced-motion readability and stable reduced-scale detail. |
| `material-samples.png` | None, mortar, cracks, rivulets, rivets, and crystal on identical isolated cells | Every built-in surface-detail treatment remains legible. |
| `role-sheet.png` | The topology fixture in Ruins, Cavern, and Mechanical | Solid, passthrough, moving, hazard, portal, coin, and gem roles remain readable. |
| `editor-play.png` | The same Cavern playground in play and edit/debug presentation | Authoring markers are presentation-only and hidden from play. |

`snapping-junction.png` is the one sheet whose method matters as much as its
subject. Passing a DPR *number* into a 1× canvas would exercise only the
snapping arithmetic; a seam is a rasterisation outcome, so each panel is
rendered into a canvas sized `crop × dpr` with `ctx.scale(dpr, dpr)` applied
once — the way `resizeCanvasToBackingStore` sets a real canvas up — and then
blitted at an integer zoom so one backing-store pixel is one visible block.

The full §5.7 matrix (1, 1.25, 1.5, 1.75, 2, 3, plus 9px tiles at DPR 1.3) is a
Phase 2 automated test, not a sheet.

## Data files

| File | Contents |
|---|---|
| `level-visual-bench.json` | Per-fixture median/p95/mean draw cost for the §13.3 fixtures, plus the host it was captured on |
| `phase0-baseline.json` | Sheet render timings and the `dist` byte total at capture time (§13.4) |
| `reference/` | The small committed reference frame |

Timings are wall-clock on one machine. They mean nothing in absolute terms and
everything as a ratio against a baseline captured on the *same* machine, which
is why the host is recorded alongside them.

## Scenes

Both validation scenes live in
[`showcase/sections/tile-room-fixtures.ts`](../../showcase/sections/tile-room-fixtures.ts)
and are shared by the showcase section, these sheets, and the benchmark — so a
sheet shows the frame the showcase actually renders rather than a lookalike
reconstruction of it.

- **Generated room** — `generateLevel(1337, { cols: 60, rows: 34 })`. The real
  `src/levelgen` consumer §9.0 requires.
- **Topology room** — a hand-authored 60×34 fixture embedding every §14.6 shape.
  The generator does not currently emit these shapes; the renderer still has to
  handle them.

## Review outcome

The Phase 0 cave prototype was deleted when Phase 2 landed. Every themed panel
now uses the shipped prepared-theme facade and production terrain renderer.

The Phase 6 review accepted all nine sheets: the themes are distinguishable,
roles remain readable, connected terrain has no visible internal grid, details
hold up at 8/16/32px, reduced-motion thumbnails remain meaningful, and play/edit
marker ownership is clear. This review is advisory; deterministic double-render,
unit, integration, size, and bundle-isolation gates remain blocking.
