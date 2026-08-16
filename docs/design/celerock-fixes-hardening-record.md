# Celerock `FIXES.md` Hardening Record

**Status:** Engine work landed (unreleased); brief edits deferred to the next version bump
**Date:** 2026-08-16
**Scope:** `src/sprites`, `src/camera`, `showcase/`, and a deferred edit to `games/celerock.md`
**Primary evidence:**

- `/Users/morganpage/Documents/2D_PLATFORMERS/Celerock-4/FIXES.md` (the build's own defect record)
- `/Users/morganpage/Documents/2D_PLATFORMERS/Celerock-4/src/main.ts` (the shipped consumer, 749 lines, `aicraft-engine@0.16.0`)
- `games/celerock.md` §4.4 / §5.4 / §8 — the recipes that build followed

This is the second Celerock hardening round; the first is `celerock-integration-hardening-plan.md`. Its design principle governs here too: **fix the lowest responsible layer**. Two of the five defects turned out to be caused by the brief's own published recipe, which makes the brief — not the game — the responsible layer, and the engine the place to remove the choice that the recipe got wrong.

---

## 1. The five defects, mapped

| # | `FIXES.md` symptom | Root cause | Responsible layer | Resolution |
|---|---|---|---|---|
| 1 | Level appeared small in the top-left quadrant | Consumer drew the world during the title mode, through a brain that had never been updated (`zoom: 1` at `(0, 0)`) | Consumer (render gating) — but the *same symptom* was live in the showcase from an unscaled HiDPI backing store | Showcase fixed; `snapCameraBrain` removes the never-updated-brain state |
| 2 | Missing game menu | Build did not implement `games/celerock.md` §8 | Consumer (non-compliance) | None — §8 has specified the two-entry menu since `0.14.0` |
| 3 | Unintended initial camera zoom-in | Brain eases from its creation state to the room's fitted framing over the first second; seeding `{ zoom }` fixes only the zoom half, the body still pans in from the origin | **Engine** — no way to solve the brain to its settled state | `snapCameraBrain` |
| 4 | Jump animation replayed while holding `C` | The brief's recipe restarts the clock on every KIND change; `ascent`/`apex`/`descent` are three kinds in ONE clip, so it restarts twice per arc | **Engine + brief** — five kinds, three clips, and nothing owned the collapse | `spriteAnimClipFor` + `advanceSpriteAnimPlayer` |
| 5 | Horizontal seam at the bottom of the play area | The brief's recipe rounds the camera in WORLD units inside `ctx.scale(zoom, zoom)`; a fractional cover-fit zoom maps that straight back onto a fractional device pixel | **Engine + brief** — the snap was left to each consumer's render code | `cameraTransform` / `applyCameraTransform` |

### 1.1 Two corrections to the build's own account

- **#4 is not a held-key bug.** `FIXES.md` attributes it to holding `C`. The clock restarts at the ascent→apex and apex→descent phase boundaries, which **every** jump crosses — a single tap reproduces it. Holding the key only makes the arc long enough to notice. The pinning test runs one arc.
- **#1's stated cause is incomplete for the general case.** "The title screen was still rendering the LDtk room at its native world scale" describes the consumer's bug correctly, but the identical symptom — content confined to the top-left `1/dpr` of the canvas — is produced by a DPR-scaled backing store with no matching context scale, and that variant was live in two showcase demos (§3).

---

## 2. What shipped

All additive; no kernel trajectory change, no replay-version bump, no altered signature. Full detail in `CHANGELOG.md` `[Unreleased]`.

| API | Module | Closes |
|---|---|---|
| `spriteAnimClipFor`, `createSpriteAnimPlayer`, `advanceSpriteAnimPlayer`, `SpriteAnimClip`, `SpriteAnimPlayer` | `src/sprites/anim-state.ts` | #4 |
| `snapCameraBrain` | `src/camera/brain.ts` | #3, and #1's never-updated-brain state |
| `cameraTransform`, `applyCameraTransform`, `CameraSnapMode`, `CameraTransformOptions`, `CameraTransformResult`, `CameraWorldView` | `src/camera/transform.ts` (new) | #5 |

### 2.1 Design notes worth keeping

- **`snapCameraBrain` is the ease's fixed point, not a separate framing rule.** It is the existing solver under a finite maximum snap threshold, so bands, clamps, padding, re-anchoring, and state repair are byte-identical to the eased path. This matters: snapping produces exactly what waiting produces, so a boot snap and a mid-run snap never disagree with the camera's own steady state. Pinned by a 600-tick convergence test and an idempotence test. A consequence worth knowing: for a follow body the fixed point is the **deadzone band edge**, and if the target already sits inside the band relative to the seed, the snap holds the seed — because that is what the ease does too.
- **`cameraTransform`'s `pixelAligned` is deliberately honest.** Snapping fixes the ORIGIN. Only an integral `zoom · dpr` maps the whole world grid onto device pixels, so a fractional cover fit can still land far edges mid-pixel however the origin is snapped. The flag reports which case the caller is in; `fitCameraZoom`'s `integerScale` is the lever when crisp edges matter more than filling the viewport exactly. **Snapping alone is not a complete answer to #5** and the JSDoc says so.
- **`createSpriteAnimPlayer()` doubles as the reset.** `FIXES.md` notes respawn/restart paths must reset the animation; a separate `resetSpriteAnimPlayer` would have been the same function, so it was not added.

---

## 3. The showcase defect found while dogfooding

`sections/camera-brain-demo.ts` and `sections/sprite-demo.ts` called `resizeCanvasToBackingStore` — which multiplies the backing store by the DPR and **returns that ratio precisely so the caller can compose it** — and discarded the return value. On any `dpr > 1` display the whole scene drew into the top-left `1/dpr` of the canvas: defect #1's symptom, in the code the briefs point consumers at.

Both call the resize *inside* their render function, and assigning `canvas.width`/`height` resets the context transform, so the scale must be re-applied **every frame** — unlike `hero.ts` / `parallax.ts` / `lava-pool.ts`, which resize once at setup and scale once (all three verified correct).

`sprite-demo` additionally had **no CSS rule at all**, so its canvas box followed the DPR-multiplied attributes and doubled on Retina. `.sprite-demo-stage` now pins a `480 × 270` box the way `.camera-brain-stage` already pinned its own. CSS sizing stays consumer-owned — the DPR helper deliberately never touches it.

**Verification (in-browser, forced `dpr = 2`):** at a `1280 × 720` backing store, camera-brain content spans the right half (12,080 non-background px) and bottom half (50,492) — both zero without the scale. `sprite-demo` settles at a `480 × 270` CSS box over a `960 × 540` backing store, which is correct crisp Retina rendering at the intended size.

---

## 4. Deferred: the `games/celerock.md` edits

**Gated on the version repin, not on review.** The brief pins `0.16.0` throughout; these recipes call APIs that ship in the next version. Applying them before the bump would leave the brief documenting APIs its own pin does not have — the exact failure the first hardening plan called out ("public examples compile against the exact package version they document"). Apply these **in the same changeset as the repin.**

### 4.1 §4.4 — the anim clock (currently `:433`, the cause of #4)

Replace the reset + the two-clock branch:

```ts
// Reset the clock on a kind change; reset to idle on respawn.
if (kind !== lastKind) { walkClock = createSpriteAnimState(); jumpClock = createSpriteAnimState(); }
lastKind = kind;
```

with the clip-aware player, which restarts only when the CLIP changes:

```ts
// ONE clock. The player restarts it only when the CLIP changes, so the three
// airborne phases (ascent/apex/descent) share one uninterrupted jump arc.
anim = advanceSpriteAnimPlayer(anim, kind, dt * 1000);

let frameIndex: number;
if (anim.clip === 'walk') {
  frameIndex = walkAnim!.frameIndices[currentFrameIndex(anim.state, walkAnim!) ?? 0];
} else if (anim.clip === 'idle') {
  frameIndex = 0;                                     // hold cell 0
} else {
  frameIndex = jumpAnim!.frameIndices[currentFrameIndex(anim.state, jumpAnim!) ?? 0];  // 60..64
}
```

Respawn/restart: `anim = createSpriteAnimPlayer();`. Delete the "reset the clock whenever the kind changes" sentence in the paragraph above the block — it is the defect, stated as guidance. Add a line to §12.7 acceptance: *a single jump plays its clip once, straight through; the launch frames never replay mid-arc.*

### 4.2 §5.4 — the render transform (currently `:628`, the cause of #5)

Replace:

```ts
ctx.scale(brain.zoom, brain.zoom);
const worldView = { width: viewport.width / brain.zoom, height: viewport.height / brain.zoom };
surfaceCache.draw(ctx, active.ldtkLevel, {
  tilesets,
  worldOffset: { x: -Math.round(brain.camera.x), y: -Math.round(brain.camera.y) },
  view: { x: brain.camera.x, y: brain.camera.y, width: worldView.width, height: worldView.height },
});
```

with:

```ts
// Device-pixel snap: rounding in WORLD units (the old recipe) still lands on a
// fractional device pixel under a fractional cover-fit zoom, which antialiases
// the level's edges into a hairline seam.
const t = cameraTransform(brain.camera, viewport, {
  zoom: brain.zoom,
  devicePixelRatio: dpr,          // from resizeCanvasToBackingStore
});
ctx.scale(t.zoom, t.zoom);
surfaceCache.draw(ctx, active.ldtkLevel, {
  tilesets,
  worldOffset: { x: t.offsetX, y: t.offsetY },
  view: t.view,                   // derived from the SNAPPED position
});
```

Add to the §5.4 "seamless fractional zoom" paragraph: snapping fixes the origin; only an integral `zoom · dpr` aligns the whole grid (`t.pixelAligned` reports it), and `fitCameraZoom(..., { integerScale: true })` is the lever if edge crispness outranks exact viewport fill.

### 4.3 §5.4 — boot framing (#3)

Replace `let brain = createCameraBrain({ zoom: fitCameraZoom(active, viewport) });` with a `snapCameraBrain` seed, and call it again on campaign reset and hard respawn:

```ts
// Solve the first frame outright — seeding only the zoom still pans the body
// in from the origin.
let brain = snapCameraBrain(createCameraBrain(), cameraOptionsFor(active, dt));
```

### 4.4 DPR (from §3's finding)

§5.4 opens with "Set the canvas once (`image-rendering: pixelated`, DPR-aware backing store)" but shows no DPR composition. State the rule that bit both showcase demos: `resizeCanvasToBackingStore` **returns** the DPR and the caller must `ctx.scale(dpr, dpr)`; if the resize runs inside the render loop, re-apply it every frame, because assigning `canvas.width` resets the transform.

---

## 5. Remaining work

- **`showcase/sections/ldtk-editor/play.ts:755-756`** still hand-rolls `-Math.round(brain.camera.x)`. The last un-migrated transform site; deferred because that render path carries an editor overlay whose interactions need verifying alongside the change.
- **`src/primitives/snap.ts`** — `snapCameraTranslation` is now partly superseded by the zoom-aware helper (it snaps a world translation to the DPR grid, ignoring zoom). Worth a JSDoc cross-reference so callers pick the right one; no behaviour change intended.
- **Release** — `CHANGELOG.md` `[Unreleased]` is deliberately unnumbered. `ENGINE_QUALITY_PASS_PLAN.md` reserves `0.17.0` for a release carrying `CURRENT_PHYSICS_VERSION` 13→14 and re-pinned replay canaries; nothing in this pass touches trajectories, so it can ride that release or a patch before it.

---

## 6. Verification record

- `npx tsc --noEmit` clean; `npm test` **3751 passing / 195 files**.
- `npm run showcase:typecheck` clean; `npm run showcase:test` **359 passing / 20 files**.
- Dist gates after `build:dist`: total +1.32%, js +0.70%, declarations +1.13% — all within the `0.16.0` ceilings. `check:ldtk-runtime-size` and `check:terrain-tree-shaking` unchanged.
- Showcase DPR fix verified in-browser by pixel sampling (§3), not by screenshot — the screenshot path returned a flat capture for this page.
