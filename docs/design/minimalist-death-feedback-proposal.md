# API Proposal: Minimalist Death Feedback

> Target pillar: Consumer-owned (showcase-local). No new library exports.
> Reuses: `src/primitives/hit-stop.ts`, `src/particles/`, `src/animation/oscillators.ts`, `src/audio/`.
> Builds on research: `docs/research/minimalist-death-feedback.md`.
> Status: **DECIDED** — see `docs/design/minimalist-death-feedback-decision.md`.

## Orchestrator Decision

**Chosen scope:** Showcase-local pure lifecycle/effect composition for prototyping. Do NOT add a public `src/primitives/death-feedback.ts`. The consumer (the reference implementation/showcase) composes the deterministic lifecycle and effects locally using existing engine primitives. No new types, no new config objects, no new functions ship from the library.

**Rejected approaches:**
- **Approach A (Pure Config + Effect Descriptors):** Would add `DeathFeedbackConfig`, `DeathEffectDescriptors`, `resolveDeathEffects()`, `resolveDeathConfig()`, `isDying()`, `deathProgress()`, `shouldRespawn()` to `src/primitives/`. Rejected because: (a) the consumer already owns `GameState.status` and `deathTimer`; (b) the "6-7 lines per tick" wiring is trivial and game-specific; (c) shipping a config type now locks in parameters before any game has actually shipped the death feel. Extract to library only when a second consumer arrives.
- **Approach B (State Machine + Events):** Rejected because engine-owned `DeathStatus` overlaps with consumer `GameState.status` union.
- **Approach C (Convenience Composer):** Rejected because mutable handle violates pure-ops discipline.

---

## Consumer Need

The consumer game hand-wires death feedback across 4+ files. Every sibling game will need the same pattern. The question was: where does the reusable abstraction live? The answer: the **recipe** is reusable (documented here); the **code** stays in the consumer until a second game proves the pattern.

The engine provides the building blocks (hit-stop, particles, sineShake, shakeEnvelope, prefersReducedMotion, playTone/playNoise). The consumer composes them into a death sequence.

---

## Locked Prototype Contract

### 1. Deterministic dying timer

```
State machine (consumer-owned):
  alive → dying (triggerDeath) → [death animation plays] → alive (respawn)

Timer:
  deathTimer: number — ticks since death onset (0 = first dying tick)
  deathAnimTicks: constant — total ticks of death animation (e.g. 15 at 60fps ≈ 250ms)

  Each tick while dying:
    deathTimer += 1  (tick-based, not dt-based, for determinism)
    if deathTimer >= deathAnimTicks → respawn

  respawn:
    deathTimer = 0
    status = 'alive'
    player position reset to spawn point
```

**Tick-based vs dt-based:** The death timer increments by 1 per fixed-timestep tick, NOT by `dt`. This ensures the death animation always lasts exactly `deathAnimTicks` ticks regardless of frame rate. The fixed-timestep accumulator guarantees one tick = one increment.

### 2. One-shot trigger semantics

```
triggerDeath() fires ONCE:
  - Sets status = 'dying'
  - Resets deathTimer = 0
  - Triggers hit-stop (one-shot: triggerHitStop on first dying tick only)
  - Spawns death particles (one-shot: spawn on first dying tick only)

  Subsequent ticks while dying:
    - deathTimer increments
    - hitStop steps (stepHitStop) — visual freeze
    - particles advance (step/advance)
    - screen shake decays (sineShake × shakeEnvelope)
    - flash alpha decays
    - NO re-trigger of hit-stop or particle spawn
```

**One-shot guards:**
```ts
// First dying tick only:
if (deathTimer === 0) {
  hitStop = triggerHitStop(hitStop, HIT_STOP_TICKS);
  particles = spawn(playerCenterX, playerCenterY, PARTICLE_OPTS);
}
```

### 3. Player hidden/pop-fade policy

```
During dying (deathTimer in [0, deathAnimTicks)):
  - Player sprite is HIDDEN (not drawn)
  - On respawn (deathTimer reaches deathAnimTicks):
    - Player sprite REAPPEARS with a brief pop-scale effect
    - Pop: volumeScale(−0.3) → spring recovery to scale(1,1) over ~8 ticks
    - Uses existing squash-stretch: volumeScale() for initial pop,
      spring recovery via the landing-squash pattern (1D spring)
```

**Why hidden:** The player is dead. Showing a corpse sprite requires art investment. Hiding is the zero-cost default. The pop-scale on respawn sells the "back from death" feel without any additional assets.

### 4. Projectile deactivation on hit

```
When player dies (triggerDeath):
  - All active projectiles are DEACTIVATED (alive = false)
  - Reason: prevents "death by same projectile that killed you" on respawn
  - Implementation: consumer iterates projectiles array and sets alive = false
    on the same tick as triggerDeath

  // In the consumer's death trigger:
  projectiles = projectiles.map(p => ({ ...p, alive: false }));
```

**No engine helper needed.** This is a one-line consumer-side mutation. Documenting the pattern is sufficient.

### 5. Fall policy

```
During dying:
  - Player vy is ZEROED (no gravity applied)
  - Player position is LOCKED at death location
  - The player does not fall off-screen during the death animation
  - On respawn: player teleports to spawn point, vy = 0

  // In the consumer's tick loop:
  if (status === 'dying') {
    // Skip physics — player frozen at death location
    player.vy = 0;
    player.vx = 0;
  }
```

**Why frozen:** Falling during death creates confusing respawn positions. Freezing at the death location keeps the camera stable and the respawn predictable.

### 6. Reduced-motion behavior

```
prefersReducedMotion() affects EFFECTS only, not TIMING:

  Reduced motion:
    - hitStopTicks: PRESERVED (same freeze duration)
    - deathAnimTicks: PRESERVED (same total timing)
    - particleCount: HALVED (e.g. 8 → 4)
    - shakeAmplitude: 0 (no screen shake)
    - flashDurationTicks: 0 (no screen flash)
    - sineShake: magnitude = 0
    - pop-scale on respawn: PRESERVED (accessibility ≠ no feedback)

  NOT reduced motion (default):
    - All effects at full intensity

  // Consumer-side resolution:
  const rm = prefersReducedMotion();
  const hitStopTicks = rm ? HIT_STOP_TICKS : HIT_STOP_TICKS;  // preserved
  const particleCount = rm ? PARTICLE_COUNT / 2 : PARTICLE_COUNT;
  const shakeAmp = rm ? 0 : SHAKE_AMPLITUDE;
  const flashTicks = rm ? 0 : FLASH_DURATION_TICKS;
```

**Timing preservation invariant:** `deathAnimTicks` NEVER changes under reduced motion. The player experiences the same game-state duration; only the visual intensity scales. This prevents simulation desync (enemy positions, projectile paths, cooldowns all advance identically regardless of accessibility setting).

### 7. Screen flash (consumer-owned rendering)

```
Flash is a full-screen alpha rect drawn AFTER the game world:

  // In consumer renderer, during dying:
  if (status === 'dying' && deathTimer < FLASH_DURATION_TICKS) {
    const alpha = 1 - (deathTimer / FLASH_DURATION_TICKS);  // linear decay
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }

  // No engine helper — 5 lines of fillRect in consumer code
```

---

## Three Visual Stacks for Benchmark Comparison

All three stacks use the same lifecycle contract above. Only the effect parameters differ. The consumer code is structurally identical; the constants change.

### Stack 1: Temporal Freeze & Kinetic Burst (Vlambeer-style)

```ts
const HIT_STOP_TICKS = 6;
const PARTICLE_COUNT = 16;
const PARTICLE_SPEED = 4;
const PARTICLE_SIZE = 3;
const PARTICLE_LIFE = 20;  // ticks
const SHAKE_AMPLITUDE = 6;
const SHAKE_DURATION = 10;  // ticks
const SHAKE_FREQ_X = 0.8;
const SHAKE_FREQ_Y = 1.2;
const FLASH_DURATION_TICKS = 3;
const DEATH_ANIM_TICKS = 15;
```

**Feel:** Hard freeze → radial particle burst → camera shake → brief white flash. Classic Vlambeer/Juice feedback. Validates hit-stop → particle → shake → flash composition.

### Stack 2: Sensory Jolt & Palette Inversion

```ts
const HIT_STOP_TICKS = 2;
const PARTICLE_COUNT = 8;
const PARTICLE_SPEED = 3;
const PARTICLE_SIZE = 2;
const PARTICLE_LIFE = 15;
const SHAKE_AMPLITUDE = 3;
const SHAKE_DURATION = 8;
const SHAKE_FREQ_X = 1.5;
const SHAKE_FREQ_Y = 2.0;
const FLASH_DURATION_TICKS = 5;
const FLASH_COLOR = '#ffffff';
const DEATH_ANIM_TICKS = 15;
```

**Feel:** Short freeze → palette slot swap for 3 ticks (consumer swaps `base` ↔ `accent`) → white flash. Validates flash + palette composition. The palette inversion is consumer-side (engine provides `deathProgress` → consumer decides when to invert).

### Stack 3: Spring-Driven Pop & Fade

```ts
const HIT_STOP_TICKS = 0;
const PARTICLE_COUNT = 4;
const PARTICLE_SPEED = 2;
const PARTICLE_SIZE = 4;
const PARTICLE_LIFE = 12;
const SHAKE_AMPLITUDE = 0;
const SHAKE_DURATION = 0;
const FLASH_DURATION_TICKS = 0;
const DEATH_ANIM_TICKS = 15;
```

**Feel:** No freeze, no shake, no flash. Just 4 particles + the player pop-scale on respawn. Validates pure-progress-driven composition: consumer reads `deathProgress(t, DEATH_ANIM_TICKS)` to drive a volume-preserving scale deformation (squash → pop → shrink). The feel comes entirely from the squash-stretch spring.

---

## Engine Primitives Used (all shipped)

| Effect | Engine primitive | Module |
|---|---|---|
| Freeze-frame | `triggerHitStop`, `stepHitStop`, `isHitStopActive` | `src/primitives/hit-stop.ts` |
| Particle burst | `spawn`, `step` (or `advance` + `cull`) | `src/particles/` |
| Screen shake | `sineShake(tick, magnitude, freqX, freqY)` | `src/animation/oscillators.ts` |
| Shake decay | `shakeEnvelope(tick, duration, initialMagnitude)` | `src/animation/oscillators.ts` |
| Audio | `playTone(freq, duration, volume)` or `playNoise(duration, volume)` | `src/audio/factory.ts` |
| Reduced motion | `prefersReducedMotion()` | `src/primitives/motion.ts` |
| Pop-scale | `volumeScale(deltaY)` | `src/animation/squash-stretch.ts` |
| Progress calc | `deathTimer / DEATH_ANIM_TICKS` (inline math) | consumer code |

---

## Implementation Notes for @coder

1. **No new library files.** All death feedback is consumer-owned code in the showcase/game.
2. **The recipe above IS the design document.** The three stacks are constants the consumer tunes.
3. **Tests:** Unit test the lifecycle timing: (a) deathTimer increments per tick, (b) respawn fires at exactly deathAnimTicks, (c) one-shot triggers fire only on deathTimer === 0, (d) reduced-motion halves particles and zeros shake/flash.
4. **Benchmark:** Screenshot the three stacks at tick 0 (freeze), tick 5 (particles + shake), tick 10 (decay), tick 15 (respawn pop). Compare visually.

---

## What This Makes Easy

- Drop-in death feedback for any game using the engine's primitives
- No new types to learn — just constants + existing engine functions
- Three benchmark stacks prove the composition works
- Reduced-motion handled at the consumer boundary with one `prefersReducedMotion()` call

## What This Makes Hard

- Every new game must wire the same ~30 lines of death feedback manually
- No shared config type — each game invents its own constants
- Extract to library only when a second consumer arrives and the pattern is proven

---

## Benchmark Criteria (Prototype)

| Criterion | Target | How to verify |
|---|---|---|
| Timer determinism | Exactly DEATH_ANIM_TICKS ticks | Unit test: count ticks from triggerDeath to respawn |
| One-shot guards | Hit-stop + particles fire once | Unit test: verify spawn/trigger on tick 0 only |
| Reduced-motion | Particles halved, shake zeroed, timing preserved | Unit test: compare default vs reduced-motion descriptors |
| Projectile deactivation | All projectiles dead on triggerDeath | Unit test: verify projectiles array after death trigger |
| Pop-scale | Player reappears with volumeScale pop | Visual: screenshot at respawn tick |
| Determinism | 1000-tick replay byte-identical | Snapshot test across all three stacks |
