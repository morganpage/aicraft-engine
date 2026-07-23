# API Proposal: Turret ShootTo

> Target pillar: Pillar 4 (Level Schema + Runtime — turret behavior, projectile stepping).
> Module: `src/platformer/enemy/registry.ts` (modify), `src/platformer/enemy/types.ts` (extend), `src/platformer/enemy/projectile.ts` (modify).
> Builds on research: `docs/research/turret-shoot-to-widget.md`.
> Status: **DECIDED** — see `docs/design/turret-shoot-to-decision.md`.

## Orchestrator Decision

**Chosen scope:** Turret-only relative `params.shootTo: {x, y}` for prototyping and shipping. No new `src/primitives/vector.ts` module. No duplicate `Vec2` type. No polar public APIs. Widget stays showcase-only (consumer-owned, not a library export). The vector math lives inline in the turret behavior — reusability is deferred until a second consumer arrives.

**Rejected approaches:**
- **Approach B (Vector Module + Integration):** Rejected because `cartesianToPolar`/`polarToCartesian`/`snapPolar`/`resolveDragVector`/`maxRangeToTicks` are not needed by any shipped consumer. The turret is the only ranged entity; premature abstraction adds surface area without demand. If a second ranged entity (cannon, trap launcher) materializes, extract at that point.
- **Approach C (Polar Serialization):** Rejected because `shootAngle` + `shootRange` is less ergonomic than `shootTo: {x, y}` for visual editing and level JSON readability.

---

## Consumer Need

**Who:** Spitekeep (IMP - Not a Troll) and future Clone-to-Jest siblings feature turrets, cannons, and hazard-launchers.

**Current state:** Turret params accept `aimDirection: {x, y}` (a direction-only vector) and `projectileSpeed` (px/s). No range concept — projectiles fly forever until they hit a solid or leave the viewport.

**What becomes possible:**
1. **ShootTo param** — `params.shootTo: {x, y}` defines both direction (vector angle) and range (vector magnitude) relative to turret center.
2. **Deterministic range-limited projectiles** — projectiles deactivate after traveling `maxRange` pixels.
3. **Backward-compatible** — existing turrets without `shootTo` work identically. New param is opt-in.

---

## Locked Prototype Contract

### 1. Serialized shape (level JSON)

```ts
{
  archetype: 'turret',
  params: {
    fireRate: 1,          // existing — unchanged
    projectileSpeed: 120, // existing — unchanged
    projectileSize: 6,    // existing — unchanged
    aimMode: 'fixed',     // existing — unchanged
    aimDirection: { x: 1, y: 0 },  // existing — legacy fallback
    detectionRadius: 200, // existing — aimed mode only

    // NEW (optional): relative vector from turret center
    // x = horizontal offset, y = vertical offset
    // Vector angle = shot direction, vector magnitude = max range in px
    // Omitted or zero-length → legacy aimDirection + no range limit
    shootTo: { x: 120, y: 0 },  // right, 120px range
  }
}
```

### 2. Turret behavior resolution rules (registry.ts)

```
Resolution order (fixed mode):
  1. Parse shootTo: must be a plain object with isFinite(x) AND isFinite(y)
  2. If shootTo is missing, non-object, or either component is non-finite:
     → use aimDirection (existing legacy behavior), maxRange = 0 (no limit)
  3. If shootTo present and both components finite:
     → compute magnitude = Math.hypot(shootTo.x, shootTo.y)
     → if magnitude === 0:
         → use aimDirection, maxRange = 0 (no limit)  [zero-length fallback]
     → if magnitude > 0:
         → dirX = shootTo.x / magnitude
         → dirY = shootTo.y / magnitude
         → maxRange = magnitude

Resolution order (aimed mode):
  → shootTo is COMPLETELY IGNORED
  → existing detectionRadius + player-tracking logic unchanged
  → maxRange = 0 (no limit) — aimed turrets always fire unbounded
```

**Zero-component preservation:** `shootTo: { x: 0, y: 120 }` (straight down) must preserve the zero x-component. Validation uses `Number.isFinite(v)` — not `v || 0` — so zero is a valid component. The defensive parser extracts:
```ts
const shootToX = Number(st.x);
const shootToY = Number(st.y);
// Only reject if NaN or Infinity — zero is valid
if (!Number.isFinite(shootToX) || !Number.isFinite(shootToY)) { ... fallback ... }
```

### 3. ProjectileState extension (backward-compatible)

```ts
// In src/platformer/enemy/types.ts — add optional fields to ProjectileState
export interface ProjectileState {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly width: number;
  readonly height: number;
  readonly alive: boolean;

  // NEW (backward-compatible — consumers that don't read these are unaffected)
  /** Maximum travel distance in px. Undefined = no limit (legacy behavior). */
  readonly maxRange?: number;
  /** Total distance traveled in px. Undefined when maxRange is undefined or 0. */
  readonly distanceTraveled?: number;
}
```

**Field preservation rules:**
- When `maxRange` is `undefined` or `0`: `distanceTraveled` is `undefined`. The projectile behaves identically to current code — no range check, no distance accumulation.
- When `maxRange > 0`: `distanceTraveled` starts at `0` on spawn and accumulates each tick.
- `ProjectileStepResult` carries through both fields from `ProjectileState` (already extends it).

### 4. Final-step clamping (projectile.ts)

```
Each tick in stepProjectile():
  1. Compute tickDistance = Math.hypot(nextX - prevX, nextY - prevY)
  2. newDistance = (projectile.distanceTraveled ?? 0) + tickDistance
  3. Range check: if maxRange > 0 AND newDistance >= maxRange → alive = false
  4. If alive: carry distanceTraveled = newDistance in result
  5. If NOT alive (range exceeded OR solid hit): distanceTraveled = undefined
```

**Clamping detail:** The projectile is deactivated the first tick where accumulated distance meets or exceeds `maxRange`. No sub-pixel position clamping to the exact range boundary — the projectile simply stops. At 120px/s and 60fps, each tick moves 2px, so overshoot is ≤2px. Acceptable for prototyping.

**Determinism note:** `Math.hypot(nextX - prevX, nextY - prevY)` equals `|v| * dt` exactly (Euclidean norm of velocity × dt). No drift: `distanceTraveled = n * |v| * dt` after n ticks, which is `n * speed * fixedDt`. No floating-point accumulation error beyond standard IEEE 754 rounding per tick.

### 5. Validation (validate.ts)

```ts
// Add to validateTurretParams (or equivalent):
if (params.shootTo !== undefined) {
  const st = params.shootTo;
  if (!isPlainObject(st)
    || !Number.isFinite(Number((st as Record<string, unknown>).x))
    || !Number.isFinite(Number((st as Record<string, unknown>).y))) {
    errors.push(err(
      `${base}.params.shootTo`,
      'turret.params.shootTo must be {x, y} with finite numbers, or omitted',
    ));
  }
}
```

### 6. Showcase widget (showcase-owned, NOT a library export)

The showcase playground adds a `shootTo` widget when a turret entity is selected in edit mode. This is consumer-owned code in `showcase/sections/playground.ts` — it is NOT exported from the library. The widget:

- Draws a dashed trajectory line from turret center to `(center + shootTo)`
- Draws a range-circle at `Math.hypot(shootTo.x, shootTo.y)` radius
- Drag endpoint updates `shootTo` in entity params via `updateEntityProps`
- Shows direction arrow and range label

No library-level `drawShootToWidget` helper. If a second consumer needs the same widget, extract at that point.

---

## Usage Examples

**Level editor (showcase):**
```ts
// Designer configures turret to shoot 120px to the right
updateEntityProps(editorState, turretId, {
  ...currentProps,
  params: { ...currentParams, shootTo: { x: 120, y: 0 } },
});
```

**Level JSON (manual):**
```json
{
  "archetype": "turret",
  "params": {
    "fireRate": 1,
    "projectileSpeed": 120,
    "shootTo": { "x": 120, "y": 0 }
  }
}
```

**Runtime (deterministic):**
```ts
// Turret spawns a range-limited projectile
const result = turretBehavior.step(state, ctx, {
  fireRate: 1,
  projectileSpeed: 120,
  shootTo: { x: 120, y: 0 },
});
// result.projectile.maxRange === 120
// result.projectile.distanceTraveled === 0 (just spawned)
```

**Zero-length fallback:**
```ts
// shootTo {0, 0} → legacy aimDirection, no range limit
const result = turretBehavior.step(state, ctx, {
  fireRate: 1,
  shootTo: { x: 0, y: 0 },
});
// result.projectile.maxRange === undefined (no limit)
```

**Aimed mode ignores shootTo:**
```ts
// Aimed mode: shootTo is ignored, player-tracking + detectionRadius as before
const result = turretBehavior.step(state, ctx, {
  fireRate: 1,
  shootTo: { x: 120, y: 0 },  // IGNORED
  aimMode: 'aimed',
  detectionRadius: 200,
});
// result.projectile.maxRange === undefined (no limit)
// Direction = toward player, not shootTo
```

---

## Comparison: What Changed from Original

| Aspect | Original (DRAFT) | Revised (REVISED) |
|---|---|---|
| Approaches | A, B, C | **A only** — others rejected |
| Vector module | `src/primitives/vector.ts` (new) | **None** — no new library exports |
| Vec2 type | Duplicate in vector.ts | **None** — no new types |
| Polar APIs | `cartesianToPolar`, `snapPolar`, etc. | **None** — not needed |
| ProjectileState | `maxRange?` + `distanceTraveled?` | Same fields, **exact clamping spec** |
| Mode behavior | Not specified | **Fixed uses shootTo; aimed ignores it** |
| Zero-length | Mentioned but not specified | **Exact finite-check preservation** |
| Widget | Library helper proposed | **Showcase-only, consumer-owned** |
| Open questions | 5 unresolved | **All resolved by decision** |

---

## What This Makes Easy

- One param `shootTo: {x, y}` replaces both direction and range for fixed-mode turrets
- Backward-compatible: existing turrets without `shootTo` work identically
- Zero-length and missing shootTo have clear fallback semantics
- Aimed mode is unaffected — no behavioral change for player-tracking turrets
- Widget stays in showcase — no library coupling to Canvas2D rendering

## What This Makes Hard

- Future ranged entities (cannon, trap launcher) must re-implement the same inline math
- No reusable polar conversion helpers until a second consumer arrives
- The widget code is duplicated if a second consumer needs it

---

## Implementation Notes for @coder

1. **File changes:** `src/platformer/enemy/types.ts` (add 2 optional fields to `ProjectileState`), `src/platformer/enemy/registry.ts` (add shootTo resolution in `turretBehavior.step`), `src/platformer/enemy/projectile.ts` (add distance accumulation + range check in `stepProjectile`).
2. **Backward compatibility:** `stepProjectile` must work identically when `maxRange` is `undefined`. The existing `ProjectileStepResult` interface already extends `ProjectileState`, so it inherits the optional fields automatically.
3. **Validation:** Add shootTo shape check to `src/level/validate.ts` turret param validation.
4. **Tests:** Unit tests for: (a) shootTo with direction+range, (b) zero-length fallback, (c) missing shootTo, (d) aimed mode ignores shootTo, (e) distance accumulation across ticks, (f) range deactivation, (g) zero-component preservation (`{x:0, y:120}`).
5. **No new files.** All changes are modifications to existing files.

---

## Benchmark Criteria (Prototype)

| Criterion | Target | How to verify |
|---|---|---|
| Backward compat | Existing turret tests pass unchanged | `npm test` — no regressions |
| Range-limited projectile | Projectile deactivates at maxRange px | Unit test: fire at {x:60, y:0}, speed 120, verify alive=false after 0.5s |
| Zero-length fallback | {x:0, y:0} → aimDirection + no limit | Unit test: shootTo {0,0}, verify maxRange undefined |
| Zero-component | {x:0, y:120} → straight down, 120px range | Unit test: verify dirY=1, dirX=0, maxRange=120 |
| Aimed mode | shootTo ignored, player-tracking works | Unit test: aimed + shootTo, verify direction toward player |
| Determinism | Same inputs → byte-identical outputs | 1000-tick replay test, compare state snapshots |
