# Simple Feet Gait Benchmark

This benchmark showcases and verifies the trigonometric simple-feet gait rendering under different configurations.

## Samples

### `gait-sheet.png`

A 24-frame walk cycle comparison (from phase `0` to `2π`) showing three different foot-placement configurations side-by-side:

1. **(A) Embertomb (Original Wide Stance):**
   - Uses `idleSpread: 3` (wide stance).
   - The feet swing in parallel arcs and never cross.
   - Stride length is scaled down to `0.55` of the default (`strideLength = 2.2`).

2. **(B) IK-Parity (Orbital Crossing):**
   - Uses `idleSpread: 0` (orbital crossing).
   - Both feet center on the body midline and orbit symmetrically via `cos(phase) * strideLength`.
   - At each footfall endpoint (phase `0` and `π`), both feet have equal-magnitude separation from the midline on opposite sides, swapping sides each half-cycle.
   - Mimics the foot-target trajectory of the full IK rig with co-located hips, without requiring bones or a solver.

3. **(C) Rigid-Width Waddle:**
   - Uses `idleSpread: 3` with a rigid-width waddle pose where feet do not cross.

## Visual Invariants Verified

- **Endpoint Width Equality:** At phase `0` and `π`, both feet have equal-magnitude separation from the midline on opposite sides.
- **Side Swapping:** At phase `0`, the left foot is on the right side of the midline and the right foot is on the left. At phase `π`, the sides are swapped back.
- **Midline Crossing Overlap:** At phase `π/2` and `3π/2`, both feet overlap perfectly at the midline.
- **Facing Mirroring:** The canvas `scale(facing, 1)` transform is applied before rendering, ensuring that the feet swing in the correct direction when facing left or right, preventing the "moonwalk" bug.

## Reproducing the Benchmark

To regenerate the sample sheet, run:

```bash
npx tsx benchmarks/_scripts/simple-feet-gait-render.ts
```
