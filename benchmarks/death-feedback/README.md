# Minimalist Death Feedback Benchmark

This benchmark showcases and validates the minimalist death feedback system designed for `aicraft-engine` consumers.

## Visual Artifacts

- **[Comparison Gallery](comparison-gallery.png)**: Shows all three visual stacks side-by-side at key ticks (0, 5, 10, 14) under both default and reduced-motion modes.
- **[Best Candidate Sequence](best-candidate-sequence.png)**: Shows a frame-by-frame progression of the winning candidate (Stack A) during the dying phase, followed by the respawn pop-scale spring recovery.
- **[Integration Sequence](integration-sequence.png)**: Shows an integration-focused sequence including pre-hit, death ticks (0, 3, 6, 10, 14), and respawn ticks (0, 4, 7) with realistic HUD coordinates and status text.

---

## Three Visual Stacks Compared

All three stacks share the same deterministic 15-tick lifecycle timing but use different effect parameters:

### Stack A: Temporal Freeze & Kinetic Burst (Vlambeer-style)
- **Hit-stop**: 6 ticks (hard freeze on impact)
- **Particles**: 16 red particles, speed 4, life 20, drag 0.96
- **Camera Shake**: Amplitude 6, duration 10 ticks, frequency (0.8, 1.2)
- **Screen Flash**: 3 ticks white flash
- **Feel**: High-impact, juicy, and physical. The freeze-frame gives the player time to register the hit, followed by a satisfying radial dispersion and camera shake.

### Stack B: Sensory Jolt & Palette Inversion
- **Hit-stop**: 2 ticks
- **Particles**: 8 red particles, speed 3, life 15, drag 0.97
- **Camera Shake**: Amplitude 3, duration 8 ticks, frequency (1.5, 2.0)
- **Screen Flash**: 5 ticks white flash + 3 ticks of background palette inversion (red/white)
- **Feel**: High sensory jolt, but the palette inversion and longer flash can be visually fatiguing and potentially problematic for photosensitive players.

### Stack C: Spring-Driven Pop & Fade
- **Hit-stop**: 0 ticks
- **Particles**: 4 red particles, speed 2, life 12, drag 0.98
- **Camera Shake**: None
- **Screen Flash**: None
- **Feel**: Extremely soft and subtle. Lacks the physical impact of a death event, but serves as a useful baseline for pure progress-driven animation.

---

## Reduced-Motion Behavior

To support accessibility without causing simulation desync, `prefersReducedMotion()` scales down effect intensities while **preserving exact timing**:
- **Timing**: `DEATH_ANIM_TICKS` (15) and `HIT_STOP_TICKS` are preserved.
- **Particles**: Count is halved (e.g., 16 → 8 in Stack A).
- **Camera Shake**: Amplitude is zeroed (no screen shake).
- **Screen Flash**: Duration is zeroed (no screen flash).
- **Respawn Pop**: Preserved (volume-preserving squash-stretch is safe and provides essential feedback).

This ensures that the game simulation remains perfectly deterministic across all players while protecting those sensitive to flashing or shaking.

---

## Production Recommendation: Stack A (Vlambeer-style)

**Stack A** is the clear winner for production due to its superior impact, clarity, and readability:
1. **The 6-tick Hit-Stop** is crucial. It pauses the world, drawing immediate focus to the player's death before any particles disperse.
2. **The 16-particle Kinetic Burst** forms a beautiful, readable radial ring that clearly communicates the point of dispersion.
3. **The 3-tick Screen Flash** provides a clean sensory jolt without the eye strain of Stack B's 5-tick flash and palette inversion.
4. **The Respawn Pop-Scale** (volume-preserving squash-stretch spring recovery) makes the player's reappearance feel juicy and alive.
