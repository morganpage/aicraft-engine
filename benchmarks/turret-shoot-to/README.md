# Benchmark: Turret ShootTo Widget & Trajectory Clamping

This benchmark evaluates the visual design of the editor widget for the new `shootTo` parameter and validates the deterministic range-clamping behavior of projectiles.

## Outputs
- `benchmarks/turret-shoot-to/widget-treatments.png` — 1200×1120, comparison of three widget treatments across multiple directions and lengths (including the default 128px catalog vector).
- `benchmarks/turret-shoot-to/trajectory-clamping.png` — 1000×700, trajectory simulation showing exact projectile deactivation at the range limit.

---

## Widget Treatments Evaluated

### 1. Treatment A: Minimalist Vector
- **Description**: A simple dashed sky-blue line (`#38bdf8`) with a small arrowhead and a 6px circular handle.
- **Clutter**: Extremely low. Only shows the vector itself.
- **Discoverability**: Poor. The 6px handle is small and hard to target for dragging.
- **Legibility**: Moderate. Raw white text is readable on dark backgrounds but will fail on light backgrounds.

### 2. Treatment B: Full Range Ring
- **Description**: Treatment A plus a dashed cyan range circle (`#06b6d4`) showing the full coverage area.
- **Clutter**: Moderate-to-high. When multiple turrets are placed close together, overlapping full circles create a "spaghetti" effect in the editor.
- **Discoverability**: Poor. Uses the same small 6px handle.
- **Legibility**: Moderate. Same raw text contrast limitations.

### 3. Treatment C: High-Contrast Reticle (Recommended)
- **Description**: A solid amber vector line (`#fbbf24`), a faint solid range circle with a subtle fill (`rgba(251, 191, 36, 0.03)`), a double-ring target reticle handle (10px outer radius, 4px inner dot, plus crosshair ticks), and a bold dark-blue text label inside an amber pill background.
- **Clutter**: Low. The faint range circle and fill provide clear spatial context without visual noise.
- **Discoverability**: Outstanding. The target reticle handle is highly intuitive, visually distinct, and provides a comfortable drag target.
- **Legibility**: Perfect. The solid amber pill background guarantees high contrast and readability on any background (light or dark).

---

## Trajectory & Range Clamping Validation

The trajectory simulation panel demonstrates that projectiles deactivate exactly at the authored `maxRange` distance with absolute mathematical precision:
- **Case A (Horizontal Right)**: Range 180px, Speed 180px/s. Deactivates at exactly **Tick 60** with **0.0000px overshoot** (final distance 180.0px).
- **Case B (Vertical Up)**: Range 100px, Speed 200px/s. Deactivates at exactly **Tick 31** with **0.0000px overshoot** (final distance 100.0px). The production `stepProjectile` clamps the final position to the exact range boundary, eliminating any single-frame overshoot.
- **Case C (Diagonal 45°)**: Range 149.9px, Speed 150px/s. Deactivates at exactly **Tick 60** with **0.0000px overshoot** (final distance 149.9px, matching the exact magnitude of `{ x: 106, y: 106 }`).

---

## Visual Analysis & Recommendations

1. **Clutter**: Treatment C is the clear winner. The faint solid range circle with a subtle fill is much less distracting than the dashed circle of Treatment B, while still providing the necessary range boundary context that Treatment A lacks.
2. **Handle Discoverability**: The target reticle handle in Treatment C is a massive improvement. It clearly signals interactivity and is much easier to grab.
3. **Vertical-Vector Correctness**: All treatments correctly handle vertical vectors (e.g., Case 2: Up) by offsetting the distance label perpendicularly to the right, preventing overlap with the turret body or the handle.
4. **Distance Legibility & Contrast**: Treatment C's text pill is a non-negotiable requirement for production. Raw text (Treatments A & B) will inevitably fail contrast checks when drawn over light-colored level tiles or background elements.
5. **Recommendation**: Implement **Treatment C (High-Contrast Reticle)** in the showcase playground editor. It provides the best balance of discoverability, legibility, and low clutter.
