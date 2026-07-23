# Decision: Minimalist Death Feedback

> Date: 2026-07-22.
> Decided by: @team (orchestrator) — architect returned no verdict after two attempts; decision from research/prototype/benchmark evidence.
> Proposal: `docs/design/minimalist-death-feedback-proposal.md` (REVISED).
> Research: `docs/research/minimalist-death-feedback.md`.
> Architect critique: **NO VERDICT** (two empty sessions — orchestrator decided from evidence).
> Benchmark: `benchmarks/death-feedback/comparison-gallery.png`, `benchmarks/death-feedback/best-candidate-sequence.png`, `benchmarks/death-feedback/README.md`.

## Decision

**Chosen approach: Showcase-local Stack A (Temporal Freeze & Kinetic Burst)** — no public module. The consumer composes death feedback locally using existing engine primitives. The recipe (constants + wiring pattern) is documented; the code stays in the consumer until a second game proves the pattern.

### Locked values (Stack A — Vlambeer-style)

| Parameter | Value | Source |
|---|---|---|
| Death anim ticks | **15** (250ms at 60fps) | `benchmarks/death-feedback/README.md` — shared across all stacks |
| Hit-stop ticks | **6** (hard freeze on impact) | Stack A benchmark; 6-tick freeze confirmed as crucial for impact |
| Particle count | **16** (deterministic radial burst) | Stack A benchmark; forms readable radial ring |
| Shake amplitude | **6** | Stack A benchmark |
| Shake duration | **10** ticks | Stack A benchmark; decaying sinusoidal envelope |
| Flash duration | **3** ticks (white) | Stack A benchmark; brief jolt without eye strain |
| Player hidden | Yes — player sprite NOT drawn while dying | Proposal §Player hidden/pop-fade policy |
| Delayed reset | Yes — `deathTimer` increments per tick, respawn at `deathAnimTicks` | Proposal §Deterministic dying timer |
| Respawn pop | **8-tick** pop-scale spring recovery (volumeScale(-0.3) → spring to 1,1) | Proposal §Player hidden/pop-fade policy; confirmed by best-candidate-sequence.png |
| One-shot audio/FX | Hit-stop + particles fire ONCE on `deathTimer === 0` only | Proposal §One-shot trigger semantics |
| Projectile hit deactivates source | All active projectiles deactivated on `triggerDeath` | Proposal §Projectile deactivation on hit |
| Fall policy | Player vy/position frozen during dying; teleports to spawn on respawn | Proposal §Fall policy |

### Reduced-motion policy

`prefersReducedMotion()` affects **effects only**, not **timing**:

| Parameter | Default | Reduced Motion | Rationale |
|---|---|---|---|
| `deathAnimTicks` | 15 | **15** (preserved) | Simulation desync prevention |
| `hitStopTicks` | 6 | **6** (preserved) | Impact registration preserved |
| `particleCount` | 16 | **8** (halved) | Fewer particles, same radial pattern |
| `shakeAmplitude` | 6 | **0** (zeroed) | Motion sickness prevention |
| `flashDuration` | 3 | **0** (zeroed) | Seizure/flash prevention |
| `respawnPop` | 8-tick spring | **8-tick spring** (preserved) | Accessibility ≠ no feedback |

**Timing preservation invariant:** `deathAnimTicks` NEVER changes under reduced motion. The player experiences the same game-state duration; only visual intensity scales. This prevents simulation desync (enemy positions, projectile paths, cooldowns all advance identically regardless of accessibility setting).

### Pipeline sharing

The death feedback pipeline shares the same engine primitives as other game systems:

| Effect | Engine primitive | Module |
|---|---|---|
| Freeze-frame | `triggerHitStop`, `stepHitStop`, `isHitStopActive` | `src/primitives/hit-stop.ts` |
| Particle burst | `spawn`, `step` | `src/particles/` |
| Screen shake | `sineShake(tick, magnitude, freqX, freqY)` | `src/animation/oscillators.ts` |
| Shake decay | `shakeEnvelope(tick, duration, initialMagnitude)` | `src/animation/oscillators.ts` |
| Audio | `playTone(freq, duration, volume)` or `playNoise(duration, volume)` | `src/audio/factory.ts` |
| Reduced motion | `prefersReducedMotion()` | `src/primitives/motion.ts` |
| Pop-scale | `volumeScale(deltaY)` | `src/animation/squash-stretch.ts` |

No new engine primitives are needed. The consumer composes these into the death sequence.

## Why

1. **The benchmark settled it.** `benchmarks/death-feedback/comparison-gallery.png` shows all three stacks side-by-side at key ticks (0, 5, 10, 14) under both default and reduced-motion modes. Stack A is the clear winner: the 6-tick hit-stop provides crucial impact registration, the 16-particle radial burst forms a beautiful readable ring, and the 3-tick flash provides sensory jolt without the eye strain of Stack B's 5-tick flash and palette inversion. Stack C is too subtle — lacks the physical impact of a death event.

2. **The best-candidate sequence validates timing.** `benchmarks/death-feedback/best-candidate-sequence.png` shows the frame-by-frame progression of Stack A: tick 0 (freeze + particle spawn + shake onset), tick 5 (particles dispersing + shake decaying + flash fading), tick 10 (particles near death + shake minimal), tick 14 (near respawn), then the 8-tick pop-scale spring recovery. The timing feels right — not too fast, not too slow.

3. **Showcase-local is correct.** The consumer already owns `GameState.status` and `deathTimer`. The "6-7 lines per tick" wiring is trivial and game-specific. Shipping a config type now locks in parameters before any game has actually shipped the death feel. The recipe is the reusable artifact; the code stays in the consumer.

4. **Reduced-motion preserves timing, halves intensity.** The research (Pattern 8: Accessibility) and benchmark both confirm that timing preservation is critical for simulation desync prevention. The reduced-motion policy zeroes shake/flash (motion sickness prevention), halves particles (visual intensity reduction), but preserves hit-stop and total timing (gameplay balance).

5. **One-shot semantics prevent re-trigger bugs.** The `deathTimer === 0` guard ensures hit-stop and particle spawn fire exactly once. Subsequent ticks advance the effects without re-triggering. This is a common source of bugs in death feedback systems; the recipe makes the guard explicit.

6. **Projectile deactivation prevents death loops.** All active projectiles are deactivated on `triggerDeath`. This prevents "death by same projectile that killed you" on respawn — a critical gameplay bug that every sibling game will hit.

## What was rejected, and why

- **Approach A (Pure Config + Effect Descriptors):** Would add `DeathFeedbackConfig`, `DeathEffectDescriptors`, `resolveDeathEffects()`, `resolveDeathConfig()`, `isDying()`, `deathProgress()`, `shouldRespawn()` to `src/primitives/`. Rejected because: (a) the consumer already owns `GameState.status` and `deathTimer`; (b) the "6-7 lines per tick" wiring is trivial and game-specific; (c) shipping a config type now locks in parameters before any game has actually shipped the death feel.
- **Approach B (State Machine + Events):** Rejected because engine-owned `DeathStatus` overlaps with consumer `GameState.status` union. Two competing status discriminants create confusion.
- **Approach C (Convenience Composer):** Rejected because mutable handle violates pure-ops discipline. The library's architecture mandates immutable-in, immutable-out for all state operations.
- **Stack B (Sensory Jolt & Palette Inversion):** Rejected for production because the palette inversion and longer 5-tick flash can be visually fatiguing and potentially problematic for photosensitive players. The benchmark confirms Stack A's 3-tick flash is sufficient.
- **Stack C (Spring-Driven Pop & Fade):** Rejected for production because it lacks the physical impact of a death event. No hit-stop, no shake, no flash — just 4 particles and a pop. Useful as a baseline but insufficient for satisfying death feedback.

## Implementation notes for @coder

1. **No new library files.** All death feedback is consumer-owned code in the showcase/game. The library provides primitives; the consumer assembles them.
2. **The recipe IS the design document.** The locked values above and the three-stack comparison in the proposal are the constants the consumer tunes. Stack A is the production default.
3. **Tests:** (a) deathTimer increments per tick, (b) respawn fires at exactly `deathAnimTicks` (15), (c) one-shot triggers fire only on `deathTimer === 0`, (d) reduced-motion halves particles and zeros shake/flash, (e) projectile deactivation on death trigger, (f) player position frozen during dying, (g) pop-scale spring recovery over 8 ticks.
4. **Benchmark verification:** Screenshot the three stacks at tick 0 (freeze), tick 5 (particles + shake), tick 10 (decay), tick 15 (respawn pop). Compare against `benchmarks/death-feedback/comparison-gallery.png` and `benchmarks/death-feedback/best-candidate-sequence.png`.

## Benchmark paths (reference all)

- `benchmarks/death-feedback/comparison-gallery.png` — all three stacks side-by-side at key ticks (0, 5, 10, 14) under both default and reduced-motion modes. Stack A recommended.
- `benchmarks/death-feedback/best-candidate-sequence.png` — frame-by-frame progression of Stack A during dying phase, followed by respawn pop-scale spring recovery.
- `benchmarks/death-feedback/README.md` — full analysis and production recommendation.
