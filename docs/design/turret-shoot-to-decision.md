# Decision: Turret ShootTo

> Date: 2026-07-22.
> Decided by: @team (orchestrator) — architect returned no verdict after two attempts; decision from research/prototype/benchmark evidence.
> Proposal: `docs/design/turret-shoot-to-proposal.md` (REVISED).
> Research: `docs/research/turret-shoot-to-widget.md`.
> Architect critique: **NO VERDICT** (two empty sessions — orchestrator decided from evidence).
> Benchmark: `benchmarks/turret-shoot-to/widget-treatments.png`, `benchmarks/turret-shoot-to/trajectory-clamping.png`, `benchmarks/turret-shoot-to/README.md`.

## Decision

**Chosen approach: A (Turret-only relative `params.shootTo`)** — the only surviving approach after orchestrator revision. No vector module, no polar API, no library-exported widget.

### Locked values

| Parameter | Value | Source |
|---|---|---|
| Widget treatment | **C: High-Contrast Reticle** — solid amber vector, faint range disk with subtle fill, double-ring target reticle handle (10px outer, 4px inner dot, crosshair ticks), dark-blue-on-amber pill label | `benchmarks/turret-shoot-to/widget-treatments.png` §Treatment C |
| Selected-only range disk | Faint solid circle with `rgba(251, 191, 36, 0.03)` fill — drawn ONLY when entity is selected | Treatment C design |
| Amber arrow | Solid amber (`#fbbf24`) vector line from turret center to shootTo endpoint | Treatment C design |
| Reticle handle | 10px outer radius, 4px inner dot, crosshair ticks — only when entity is selected and in Select mode | Treatment C design |
| Distance pill | Dark-blue text on amber pill background — guarantees high contrast on any background | Treatment C design |
| Default catalog vector | **128px right** (`{x: 128, y: 0}`) unless source scale strongly suggests another named value | Consistent with turret default range in gameplay |
| Turret placement mode | Turret becomes **selected** and enters **Select mode** on placement in the editor | UX: immediate widget visibility after placement |

### shootTo resolution rules

**Fixed mode:**
1. Parse `shootTo`: must be a plain object with `Number.isFinite(x)` AND `Number.isFinite(y)`.
2. If missing, non-object, or either component non-finite → use `aimDirection` (legacy), `maxRange = 0` (no limit).
3. If present and both finite → compute `magnitude = Math.hypot(shootTo.x, shootTo.y)`.
4. If magnitude === 0 → use `aimDirection`, `maxRange = 0` (zero-length fallback).
5. If magnitude > 0 → `dirX = shootTo.x / magnitude`, `dirY = shootTo.y / magnitude`, `maxRange = magnitude`.

**Zero-component preservation:** `shootTo: {x: 0, y: 120}` (straight down) preserves the zero x-component. Validation uses `Number.isFinite(v)` — not `v || 0` — so zero is a valid component.

**Aimed mode:** `shootTo` is **COMPLETELY IGNORED**. Existing `detectionRadius` + player-tracking logic unchanged. `maxRange = 0` (no limit) — aimed turrets always fire unbounded.

**Missing/zero/malformed fallback:** Falls back to legacy `aimDirection` + unbounded range. No error thrown; graceful degradation.

### ProjectileState extension

```ts
// src/platformer/enemy/types.ts — add to existing ProjectileState
readonly maxRange?: number;        // max travel distance in px; undefined = no limit
readonly distanceTraveled?: number; // accumulated distance; undefined when maxRange absent
```

**Field preservation rules:**
- `maxRange` undefined or `0` → `distanceTraveled` is `undefined`. Projectile behaves identically to current code.
- `maxRange > 0` → `distanceTraveled` starts at `0` on spawn, accumulates each tick.
- `ProjectileStepResult` carries both fields through.

### Production clamping (mandatory — prototype overshoot is REJECTED)

The prototype benchmark showed ≤3.3px overshoot (single-frame travel distance). This is **rejected for production**. The production implementation MUST:

1. Compute `tickDistance = Math.hypot(nextX - prevX, nextY - prevY)`.
2. Compute `newDistance = (projectile.distanceTraveled ?? 0) + tickDistance`.
3. Range check: if `maxRange > 0` AND `newDistance >= maxRange` → **clamp final position to exact range boundary** and deactivate.
4. The clamped position is: `finalX = prevX + (shootDirX * (maxRange - prevDistance))`, `finalY = prevY + (shootDirY * (maxRange - prevDistance))`.
5. Deactivate with `alive = false` and **zero overshoot**.
6. Preserve `maxRange` and `distanceTraveled` on every deactivation path (solid hit, player hit, range exceeded).

**Benchmark reference:** `benchmarks/turret-shoot-to/trajectory-clamping.png` demonstrates the deactivation behavior. Case A (horizontal): 0.0px overshoot. Case B (vertical): 3.3px overshoot — this is the prototype value that production MUST eliminate via position clamping. Case C (diagonal): 0.1px overshoot — also eliminated by clamping.

### Player hit deactivation

When `stepProjectile` detects `hitPlayer === true`, the projectile is deactivated (`alive = false`). This prevents "death by same projectile that killed you" on respawn.

### Fall-through / legacy behavior

- Missing `shootTo` → legacy `aimDirection` + no range limit. Existing turrets work identically.
- Zero-length `shootTo` → legacy `aimDirection` + no range limit.
- Malformed `shootTo` → legacy `aimDirection` + no range limit. Validation emits a warning but does not block.

## Why

1. **The research is clear.** `docs/research/turret-shoot-to-widget.md` documents polar coordinate serialization, zero-length handling, and headless ballistic mapping as the proven patterns. The orchestrator revision correctly rejected the premature vector module — the turret is the only ranged entity; a second consumer triggers extraction.

2. **The benchmark settled the widget.** `benchmarks/turret-shoot-to/widget-treatments.png` compared three treatments across multiple directions and lengths. Treatment C (High-Contrast Reticle) wins on all criteria: outstanding discoverability (target reticle handle), perfect legibility (amber pill label), and low clutter (faint range disk vs. Treatment B's spaghetti circles). Treatments A and B have unacceptable contrast failures on light backgrounds.

3. **Prototype overshoot is rejected.** The trajectory-clamping benchmark shows the prototype's single-frame overshoot (≤3.3px). Production MUST clamp to exact range boundary. The clamping spec is mathematically precise: project the remaining distance along the normalized direction vector. Zero overshoot. Zero ambiguity.

4. **Fixed mode is the primary use case.** Aimed mode (player-tracking) is unchanged — it already works and doesn't need range limiting. The `shootTo` parameter adds value specifically for fixed-mode turrets where the designer wants to control both direction and range visually.

5. **Backward compatibility is preserved.** Every existing turret without `shootTo` works identically. The optional fields on `ProjectileState` are backward-compatible — consumers that don't read them are unaffected.

## What was rejected, and why

- **Approach B (Vector Module + Integration):** Rejected because `cartesianToPolar`/`polarToCartesian`/`snapPolar`/`resolveDragVector`/`maxRangeToTicks` are not needed by any shipped consumer. The turret is the only ranged entity; premature abstraction adds surface area without demand. Extract at that point when a second ranged entity arrives.
- **Approach C (Polar Serialization):** Rejected because `shootAngle` + `shootRange` is less ergonomic than `shootTo: {x, y}` for visual editing and level JSON readability. Cartesian offset is more natural in a 2D tile-based editor.
- **Prototype overshoot tolerance:** The proposal's "≤2px overshoot is acceptable for prototyping" was correct for the prototype phase, but production MUST clamp to zero overshoot. The benchmark proved the clamping is feasible (mathematical projection along the direction vector).

## Implementation notes for @coder

1. **Files to modify:** `src/platformer/enemy/types.ts`, `src/platformer/enemy/registry.ts`, `src/platformer/enemy/projectile.ts`, `src/level/validate.ts`.
2. **No new files.** All changes are modifications to existing files.
3. **Production clamping is mandatory.** The `stepProjectile` function MUST clamp the final position to the exact range boundary when `maxRange > 0` and `newDistance >= maxRange`. Do NOT rely on the single-frame deactivation without position correction. The formula: `finalPos = prevPos + dirUnit * (maxRange - prevDistance)`.
4. **Field preservation on every path.** When a projectile is deactivated (range exceeded, solid hit, or player hit), the result MUST carry `maxRange` and `distanceTraveled` as they were at the moment of deactivation. Do NOT set them to `undefined` on deactivation — consumers may need to read the final distance for scoring/display.
5. **Zero-component validation.** `Number.isFinite(v)` — not `v || 0`, not `!!v`. Zero is a valid component. `{x: 0, y: 120}` means straight down, 120px range.
6. **Widget is showcase-only.** The Treatment C reticle rendering lives in `showcase/sections/playground.ts`, NOT in the library. The library only provides the `shootTo` param resolution and projectile clamping.
7. **Default catalog vector.** When instantiating a turret in the editor catalog, default `shootTo` to `{x: 128, y: 0}` (128px right). Override if source scale suggests otherwise.
8. **Turret placement UX.** On placement, the turret becomes selected and enters Select mode, showing the Treatment C widget immediately.
9. **Tests:** (a) shootTo direction+range, (b) zero-length fallback, (c) missing shootTo, (d) aimed mode ignores shootTo, (e) distance accumulation across ticks, (f) range deactivation with zero overshoot (clamp test), (g) zero-component preservation `{x:0, y:120}`, (h) player hit deactivates projectile, (i) field preservation on all deactivation paths.

## Benchmark paths (reference all)

- `benchmarks/turret-shoot-to/widget-treatments.png` — 1200×900, three widget treatments across multiple directions and lengths. Treatment C recommended.
- `benchmarks/turret-shoot-to/trajectory-clamping.png` — 1000×700, trajectory simulation showing projectile deactivation at range limit. Prototype overshoot values documented; production MUST clamp to zero.
- `benchmarks/turret-shoot-to/README.md` — full analysis and recommendations.
