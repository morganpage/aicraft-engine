# Celerock Render-Composition Hardening Record

**Status:** Shipped in `0.17.4` (engine + brief + catalog repin, one changeset)
**Date:** 2026-08-17
**Scope:** `src/camera` (`letterbox.ts` new, `transform.ts`, `fit.ts`), `games/*.md`, `showcase/sections/ldtk-editor/play.ts`
**Primary evidence:**

- `/Users/morganpage/Documents/2D_PLATFORMERS/Celerock-TAL-2/src/main.ts` (the shipped consumer on `aicraft-engine@0.17.3`)
- The build's own two defect reports (particles rendered without the camera offset; backdrop filling the canvas outside the level bounds)
- `games/celerock.md` §5.4 / §5.5 / §9 — the recipes that build followed

Third Celerock hardening round, after `celerock-integration-hardening-plan.md` and `celerock-fixes-hardening-record.md`. Same governing principle: **fix the lowest responsible layer.** Both reported defects trace to the brief's published recipe, so the brief is the responsible layer and the engine is where the choice that produced them gets removed.

---

## 1. The defects, mapped

| # | Reported symptom | Root cause | Responsible layer | Resolution |
|---|---|---|---|---|
| 1 | Dash-trail particles spawn at correct world positions but render without the camera offset — pinned to the screen while the level scrolls | §5.4's recipe leaves the camera offset in the surface draw's `worldOffset` **parameter** and hands off with `// ...player art, entities, particles, UI...`; every hand-drawn layer must re-apply it and nothing says so | **Brief + engine** — `applyCameraTransform` existed but was unusable here (the letterbox needs the resolved transform *before* the context is touched), so nothing named the world-space boundary | `composeCameraTransform`; §5.4 rebuilt around it |
| 2 | The area outside the level looked like level — backdrop filled the whole canvas under a contain fit | §5.4 mandates `mode: 'contain'` and then describes the slack as "intentional letterbox space filled by the existing atmosphere/parallax pass" — following that literally *is* the bug | **Brief + engine** — no engine helper for the mask, so every build hand-rolls four clamped bar rects and a clip (this one wrote ~25 lines) | `cameraLetterbox` / `applyCameraLetterbox`; §5.4 letterbox rule, criterion 20, forbidden pattern |
| 3 | *(found while reading, not reported)* the slide branch drops the camera offset entirely | §5.5's comment shows `cache.draw(ctx, src.ldtkLevel, { tilesets, worldOffset: p.sourceOffset })` with no camera term, and [main.ts:893](file:///Users/morganpage/Documents/2D_PLATFORMERS/Celerock-TAL-2/src/main.ts) copied it | **Brief** — same missing rule as #1, in the one place a reader would look for it | §5.5 comment states the composition; §12.2b slide assertion |

### 1.1 Why #1's obvious repair is the wrong one

The report ends "Don't change the particle spawn coordinates — their world-space values are correct," which is exactly right and worth preserving as a rule. Every layer in this family fails the same way (correct data, one transform short), and every one of them is invisible at camera `(0, 0)` — which is where a developer checks first. §12.2b therefore mandates a camera deliberately off the origin, and the assertion that the *defect* fails the test: a test that cannot fail on the bug is not a test.

### 1.2 Evidence for #3

`presentationForRoomSlide` returns `sourceOffset`/`destinationOffset` as each room's static origin in slide space, while the slide vcam sweeps the camera through that same space. Run against the shipped pack (`Level_0` → `Level_1`, 1280×720 viewport, contain fit):

```
space        sourceOffset {x:0,y:0}   destinationOffset {x:320,y:0}
t=0     slideCam  40.0, 20.0    camOffset -39.99, -20.06
t=0.15  slideCam 178.2, 10.0    camOffset -178.25,  -9.97
```

Drawing at `sourceOffset` alone therefore pins the view to the union's top-left for the whole ~0.3 s slide (≈150–700 device px of misplacement at this fit), then snaps when the destination vcam takes over. The `renderFrame` in that build *does* include `transform.offsetX`, so its clip rect and its drawn content also disagree mid-slide.

---

## 2. What shipped

Additive; no kernel trajectory change, no replay-version bump, no altered signature.

| API | Module | Closes |
|---|---|---|
| `composeCameraTransform` | `src/camera/transform.ts` | #1, #3 |
| `cameraLetterbox`, `applyCameraLetterbox`, `CameraLetterbox`, `CameraFrameRect`, `ApplyCameraLetterboxOptions` | `src/camera/letterbox.ts` (new) | #2 |
| `resolveLevelDims` (module-internal, shared with `fit.ts`) | `src/camera/fit.ts` | — |
| `RoomSlidePresentation` composition JSDoc | `src/platformer/room-slide.ts` | #3 |

### 2.1 Design notes worth keeping

- **`composeCameraTransform` is a split, not a new idea.** It is the second half of `applyCameraTransform`, which now calls it. The split exists because the letterbox needs the resolved `zoom` to place the level frame in *screen* units before the zoom is composed, and the mask and the world must agree on the same snapped offset. Giving the boundary a name is most of the value: `composeCameraTransform(ctx, t)` is greppable, and "everything after this line is world space" is a reviewable property.
- **`worldOffset` keeps a real job.** Composing the camera into the context does not make the parameter redundant — it narrows it to a room's own origin *within* world space, which is exactly what a room slide needs and what nothing else should use. Both offsets compose; the failure modes are dropping one (world pinned) or adding both (double offset), and §12.8 now names both.
- **The letterbox degrades toward "no mask", never "no game".** Invalid bounds, a degenerate viewport, or a non-finite transform all resolve to a full-viewport frame with empty bars and a no-op clip. The alternative — an empty clip on bad input — would blank the screen, which is a worse failure than the one the helper prevents.
- **Bars are disjoint by construction** (full-width top/bottom first, side bars spanning only the band between them) so a translucent fill cannot double along the corners. Pinned by an invariant test: bars + clip tile the viewport exactly, with no pairwise overlap, across five viewports × three camera positions.
- **The mask goes outside the shake.** `applyCameraLetterbox` before `ctx.translate(shake)` keeps the frame welded to the viewport while the world shakes inside it. The other order shakes the letterbox bars, which reads as the whole screen wobbling.

---

## 3. Brief changes (`games/celerock.md`)

Applied in the same changeset as the `0.17.4` repin, per the rule the last record established (a brief must never document APIs its own pin lacks).

- **§5.4** — the render block is now the full frame in order: clear → backdrop → `cameraTransform` → `applyCameraLetterbox` → shake → `composeCameraTransform` → tiles / entities / player / particles → `restore` → HUD. Two new rule paragraphs ("One world transform", "Letterbox the contain fit"), and the contain-fit policy sentence that *described* defect #2 is rewritten.
- **§5.5** — the slide render comment states that the camera offset stays in the context and `worldOffset` carries only the room's slide-space origin, with both failure directions named.
- **§9** — the dash-trail recipe names the transform its draw must run under, and why the spawn coordinates are not the bug.
- **§12.2b** (new) — a pure-arithmetic composition test: camera off the origin, engine-path vs composed-path equivalence, the defect's own failure, a raw-coordinate assertion on the game's `drawParticles`, the slide composition, and the letterbox tiling invariant.
- **§12.7** — criterion 20 (the margin is masked, mid-slide included) and criterion 21 (every world layer moves with the camera); §15's "criteria 1–19" updated to 1–21.
- **§12.8** — two forbidden patterns: a world-space draw outside the composed transform (either direction), and an unmasked contain-fit margin.
- **§13** — gate 10 now requires the room's edge to read as an edge; new gate 11 for camera-tracking (mid-dash away from the room origin, and mid-slide).
- **§14** — Stage 1's gate establishes the render skeleton (every later stage inherits it); Stage 5's gate checks the trail travels with the player.

The rest of the catalog (`bosscard`, `flipside`, `simple-platformer`, `spin-loop`, `doodle-knight`, `world-1-1`, `README`, `SHOWCASE`) is repinned to `0.17.4` with no other change.

---

## 4. The showcase site that taught the defect

`showcase/sections/ldtk-editor/play.ts` was the engine's own demonstration of the losing pattern: a scale-only world transform with the offset re-added by hand at fourteen call sites (`mobs.draw(ctx, { x: offsetX, y: offsetY })`, `core.x + offsetX`, `core.y + offsetY`, …), and a comment explaining that the mobs take the camera offset "since the world transform is scale-only here". It now composes once and draws in raw world coordinates; its cull rect comes from the snapped `t.view` rather than the pre-snap camera.

`camera-brain-demo.ts` already used `applyCameraTransform` (migrated in `0.17.0`) and needed no change.

---

## 5. Verification record

- `npx tsc --noEmit` clean; `npm test` **3809 passing / 198 files** (25 new in `src/tests/camera-letterbox.test.ts`).
- `npm run showcase:typecheck` clean; `npm run showcase:test` **359 passing / 20 files**.
- `build:dist` + a real ESM import of the built barrel: `cameraLetterbox` / `applyCameraLetterbox` / `composeCameraTransform` resolve and return the expected geometry for the shipped 320×184 room at 1600×736.
- Dist gates: total +0.80%, js +0.67%, declarations +1.02% against the `0.17.0` baseline — all under ceiling. `check:ldtk-runtime-size` and `check:terrain-tree-shaking` unchanged.
- Showcase migration verified in-browser by **pixel sampling** the play canvas (content spans a centred, letterboxed region — 287k–308k non-background px inside a 900×520 backing store, bbox x 25–874 / y 91–428). **The A/B baseline capture could not be completed:** this page resists programmatic driving in the harness — screenshots return a flat capture (the same limitation the `0.17.0` record noted) and repeated reloads leave the section's rAF loop parked out of view. The migration's correctness rests on the arithmetic equivalence pinned by `composeCameraTransform`'s unit tests plus the single good sample, not on a before/after image pair.

---

## 6. Remaining work

- **A render-level test for the showcase play path.** There is none today (`showcase/tests/` covers session/transition logic only), which is why the migration above leans on unit-level equivalence. A canvas-stub render test would make future transform migrations mechanical to verify.
- **The other briefs' render sections.** Only `celerock.md` teaches a camera-composed render in this detail; `flipside`, `world-1-1`, and `spin-loop` describe their own draw loops and were not audited for the same trap in this pass.
