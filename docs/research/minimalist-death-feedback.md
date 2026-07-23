# Minimalist Player-Death Feedback

> Research note for satisfying minimalist 2D player-death feedback suitable for procedural Canvas2D games and a reusable zero-dependency TypeScript library. Slug: `minimalist-death-feedback`.
> Investigated: 2026-07-22.

## TL;DR

Player-death feedback in minimalist 2D procedural games must deliver a high-impact, multi-sensory punctuation mark that clarifies the failure state without breaking the game's aesthetic or performance constraints. Under a zero-dependency TypeScript and Canvas2D architecture, this is achieved by separating pure, deterministic simulation state (lifecycle tracking, hit-stop timers, kinetic particle vectors) from decorative host-side rendering effects (screen flashes, camera shake, and procedural audio synthesis). Prototyping should focus on three core effect stacks: (1) the **Temporal Freeze & Kinetic Burst** stack (combining hit-stop with a seeded radial particle explosion), (2) the **Sensory Jolt & Palette Inversion** stack (using temporary slot-swaps and screen flashes), and (3) the **Spring-Driven Pop & Fade** stack (applying volume-preserving scale deformation to represent character disintegration).

## Why this matters for aicraft-engine

This research directly impacts **Pillar 1 (Primitives & secondary dynamics)** and **Pillar 2 (Cosmetics & palettes)**.
- **Pillar 1 Validation**: It exercises and integrates multiple core modules: `src/primitives/hit-stop.ts` (temporal freeze), `src/particles/` (deterministic particle systems), and `src/animation/oscillators.ts` (screen shake).
- **Pillar 2 Integration**: It leverages the semantic-slot palette model of `src/palette/` to perform instant, asset-free color flashes and palette inversions on impact, aligning perfectly with the library's "the algorithm IS the art" thesis.
- **Consumer Games**: Sibling games like *IMP: Not a Troll* (formerly *Spitekeep*) or future Clone-to-Jest titles (such as *Embertomb*, a side-view platformer, or a *Stacklands*-like card game) require highly polished, responsive, and satisfying death feedback to elevate game-feel without shipping heavy art assets.
- **Replay-Perfect Determinism**: By modeling death state transitions and particle trajectories in the pure core, we ensure that game replays and multiplayer syncs reproduce the exact same death sequences.

---

## Prior Art Survey

### Pattern 1: Freeze-Frame / Hit-Stop (Temporal Freeze)
- **Source**: Vlambeer's "The Art of Screenshake" (Jan Willem Nijman), and standard game-feel implementations in *Celeste* and *Super Meat Boy*.
- **What it does**: Temporarily pauses the gameplay simulation clock (for 6-15 ticks, ~100-250ms) immediately upon player death, while decorative visual effects (particles, screen shake, screen flash) continue to update and render. This highlights the fatal impact and gives the player's brain time to register the failure.
- **Algorithmic shape**:
  ```typescript
  // Core State representation
  export interface SimulationState {
    player: Player;
    enemies: Enemy[];
    hitStop: HitStopState; // Reuses src/primitives/hit-stop.ts
    particles: Particle[];
  }

  export function stepSimulation(state: SimulationState, dt: number): SimulationState {
    const frozen = isHitStopActive(state.hitStop);
    
    return {
      player: frozen ? state.player : stepPlayer(state.player, dt),
      enemies: frozen ? state.enemies : stepEnemies(state.enemies, dt),
      hitStop: stepHitStop(state.hitStop, dt),
      // Particles and other decorative FX continue to advance during freeze
      particles: stepParticles(state.particles, dt)
    };
  }
  ```
- **Determinism profile**: Pure mathematical state progression. 100% deterministic.
- **Runtime cost**: Negligible ($O(1)$).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Already supported via `src/primitives/hit-stop.ts`.
- **What to steal**: The separation of the simulation clock from the visual effects clock. Freezing the world while letting particles drift and the screen shake creates an incredible sense of mass and impact.
- **What to avoid**: Freezing the entire update loop, which would freeze the camera shake and particles, making the game look like it crashed rather than paused for impact.

### Pattern 2: Squash / Stretch / Pop (Spatial Deformation)
- **Source**: Disney's "12 Principles of Animation", and Sokpop's *Stacklands* and *Pyramida*.
- **What it does**: Deforms the character's visual representation upon death. A common minimalist pattern is a rapid vertical squash (representing the crush of the blow) followed by a violent, volume-preserving "pop" (scaling the character up to 1.5x or 2.0x in 2-3 frames before shrinking them to 0 or breaking them into pieces).
- **Algorithmic shape**:
  ```typescript
  export interface DeathDeformation {
    tick: number;
    duration: number;
  }

  export function getDeathScale(tick: number, duration: number): { scaleX: number; scaleY: number; alpha: number } {
    if (tick >= duration) return { scaleX: 0, scaleY: 0, alpha: 0 };
    const t = tick / duration; // [0, 1]
    
    // Rapid initial squash, then a violent expansion (pop), then shrinking to zero
    let scale = 1.0;
    let alpha = 1.0;
    if (t < 0.2) {
      // Squash phase
      const st = t / 0.2;
      scale = 1.0 - 0.3 * Math.sin(st * Math.PI / 2); // 1.0 -> 0.7
    } else if (t < 0.6) {
      // Pop phase
      const pt = (t - 0.2) / 0.4;
      scale = 0.7 + 0.8 * Math.sin(pt * Math.PI / 2); // 0.7 -> 1.5
    } else {
      // Shrink and fade phase
      const ft = (t - 0.6) / 0.4;
      scale = 1.5 * (1 - ft); // 1.5 -> 0.0
      alpha = 1 - ft; // 1.0 -> 0.0
    }
    
    // Volume preservation: scaleX * scaleY = scale^2
    return { scaleX: scale, scaleY: scale, alpha };
  }
  ```
- **Determinism profile**: Pure mathematical operations. 100% deterministic.
- **Runtime cost**: Negligible. A few arithmetic operations per frame.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is a pure-code visual effect that requires no art assets.
- **What to steal**: Non-linear interpolation (using sine ease-outs) to make the pop feel snappy and explosive rather than linear and robotic.
- **What to avoid**: Linear scaling, which looks lifeless and lacks the "snap" of professional animation.

### Pattern 3: Deterministic Particle Bursts (Kinetic Dispersion)
- **Source**: JS13k winners (*Space Huggers*) and Spitekeep's particle burst pattern.
- **What it does**: Spawns a radial or directional burst of simple geometric particles (squares, circles, or outline rects) at the player's death position. The particles fly outward with high initial velocity, decaying over time due to drag, and optionally falling due to gravity.
- **Algorithmic shape**:
  ```typescript
  import { spawn } from '../particles/spawn';
  import { mulberry32 } from '../rng/mulberry32';

  export function spawnDeathParticles(x: number, y: number, seed: number, color: string): Particle[] {
    const rng = mulberry32(seed);
    // Spawn 16 particles in a radial burst
    return spawn(x, y, {
      count: 16,
      speed: 4.0,
      speedJitter: 0.5,
      life: 30, // 30 ticks
      size: 3,
      color,
      rng
    });
  }
  ```
- **Determinism profile**: Pure state progression. 100% deterministic when using a seeded PRNG (`mulberry32`).
- **Runtime cost**: $O(N)$ where $N$ is the particle count. Spawning 16-24 particles is extremely cheap.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Already supported via `src/particles/`.
- **What to steal**: **Seeded RNG for particle vectors**. This ensures that the exact same death always produces the exact same particle trajectories, which is critical for replay systems and debugging.
- **What to avoid**: Using `Math.random()` in the simulation layer, which breaks determinism.

### Pattern 4: Screen Flash & Palette Inversion (Sensory Jolt)
- **Source**: Demoscene effects, retro console hardware tricks (NES/Game Boy palette swaps), and *Vlambeer's* screen flash.
- **What it does**: Triggers a full-screen flash of solid white (or red) that decays rapidly over 2-5 frames, or temporarily inverts/swaps the color palette slots (e.g., swapping `outline` and `base` colors) for 1-3 frames. This provides a massive sensory jolt that immediately signals death.
- **Algorithmic shape**:
  ```typescript
  // Renderer-side palette swapping
  export function getActivePalette(
    basePalette: Palette,
    deathTick: number,
    flashDuration: number
  ): Palette {
    // Invert colors for the first 3 frames of death
    if (deathTick > 0 && deathTick <= 3) {
      return {
        outline: basePalette.base,
        base: basePalette.outline,
        accent: basePalette.feature,
        feature: basePalette.accent,
        background: basePalette.background
      };
    }
    return basePalette;
  }

  // Canvas2D screen flash rendering
  export function drawScreenFlash(ctx: CanvasRenderingContext2D, tick: number, duration: number, color = '#ffffff') {
    if (tick >= duration) return;
    const alpha = 1.0 - (tick / duration);
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }
  ```
- **Determinism profile**: Pure rendering side-effect. Deterministic relative to the death tick.
- **Runtime cost**: Extremely cheap. Drawing a single full-screen rect is highly optimized by browsers.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It requires zero assets and leverages native Canvas2D operations.
- **What to steal**: **Palette slot swapping**. By swapping semantic slots (e.g., making the character's body the outline color and vice versa), we get a violent "flash" effect that is perfectly tailored to the character's current skin, without needing hardcoded colors.
- **What to avoid**: Leaving the screen flash active for too long, which causes eye strain and obscures the death particles. Keep flashes extremely short (1-5 frames).

### Pattern 5: Camera Shake (Sinusoidal Decay)
- **Source**: Vlambeer's "The Art of Screenshake", and `src/animation/oscillators.ts`.
- **What it does**: Displaces the camera viewport using high-frequency, decaying noise on death. This transfers the kinetic energy of the death event to the entire screen.
- **Algorithmic shape**:
  ```typescript
  import { sineShake, shakeEnvelope } from '../animation/oscillators';

  export function getCameraOffset(deathTick: number, duration = 20, magnitude = 8): { x: number; y: number } {
    const m = shakeEnvelope(deathTick, duration, magnitude);
    return sineShake(deathTick, m);
  }
  ```
- **Determinism profile**: Pure mathematical operations. 100% deterministic.
- **Runtime cost**: Negligible.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Already supported via `src/animation/oscillators.ts`.
- **What to steal**: **Decaying sinusoidal envelopes**. Sines are smooth and predictable, but when decorrelated on the X and Y axes (using different frequencies and phase offsets), they read as organic, violent shaking.
- **What to avoid**: Pure random camera offsets per frame (e.g., `Math.random() * magnitude`), which can look "buzzy" or "jittery" rather than weighty, and are non-deterministic.

### Pattern 6: Procedural Audio Cues (Synthesized Feedback)
- **Source**: JS13k synth engines, Spitekeep's Web Audio synthesis.
- **What it does**: Generates a low-frequency noise burst (explosion) or a descending square/triangle wave pitch sweep (defeat boop) entirely in code using the Web Audio API.
- **Algorithmic shape**:
  ```typescript
  import { AudioAdapter } from '../audio/types';

  export function playDeathSFX(audio: AudioAdapter) {
    // 1. Descending "defeat" tone sweep (triangle wave for retro feel)
    audio.playTone('triangle', 180, 60, 350, 0.4);
    
    // 2. Low-pass filtered noise burst for the explosion impact
    audio.playNoise(200, 'lowpass', 300, 0.5);
  }
  ```
- **Determinism profile**: Host side-effect. Non-deterministic (uses Web Audio API clock).
- **Runtime cost**: Very low. Web Audio API runs on a separate browser thread.
- **Dependencies**: None (uses native browser `AudioContext`).
- **Fit for our constraints**: Strong. Supported via `src/audio/factory.ts`.
- **What to steal**: **Layering noise and tones**. A pure tone sounds like a beep; a pure noise burst sounds like static. Layering a descending pitch sweep (the "sad" indicator) with a low-pass filtered noise burst (the "impact" indicator) produces a professional, punchy retro sound.
- **What to avoid**: Loading heavy external `.wav` or `.mp3` files, which violates the zero-asset constraint.

### Pattern 7: Delayed Reset & State Abstraction (Temporal Pacing)
- **Source**: Standard game loop pacing in *Celeste* and *Super Meat Boy*.
- **What it does**: Separates the moment of death from the level reset. When the player dies, the simulation transitions to a `dying` state for a set duration (e.g., 40-60 ticks, ~0.6-1.0s). During this window, the player's controls are disabled, their physics are frozen (or they fall slowly), and the death visual effects play out. Only when the timer expires does the game reset.
- **Algorithmic shape**:
  ```typescript
  export interface PlayerState {
    status: 'alive' | 'dying' | 'dead';
    deathTicks: number;
    x: number;
    y: number;
  }

  export const DEATH_SEQUENCE_DURATION = 45; // 45 ticks ≈ 0.75s

  export function stepPlayerDeath(player: PlayerState, dt: number): PlayerState {
    if (player.status === 'dying') {
      const nextTicks = player.deathTicks + dt;
      if (nextTicks >= DEATH_SEQUENCE_DURATION) {
        return {
          ...player,
          status: 'dead',
          deathTicks: nextTicks
        };
      }
      return {
        ...player,
        deathTicks: nextTicks
      };
    }
    return player;
  }
  ```
- **Determinism profile**: Pure state machine. 100% deterministic.
- **Runtime cost**: Negligible.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Fits perfectly into the pure state progression model of `aicraft-engine`.
- **What to steal**: **Explicit state machine tracking**. Separating `dying` (playing effects) from `dead` (triggering reset) allows the game loop to easily coordinate camera shake, particles, and input disabling without messy global flags.
- **What to avoid**: Instantly resetting the level on the frame of death, which is extremely jarring and robs the player of the visual feedback of their mistake.

### Pattern 8: Accessibility & Reduced Motion (Sensory Comfort)
- **Source**: WCAG 2.1 guidelines, and `src/primitives/motion.ts`.
- **What it does**: Detects the host's `prefers-reduced-motion` setting and provides a clean way to scale down or eliminate intense visual effects (screen flashes, rapid palette inversion, violent camera shake) to prevent motion sickness, seizures, or sensory overload.
- **Algorithmic shape**:
  ```typescript
  import { prefersReducedMotion } from '../primitives/motion';

  export interface DeathJuiceConfig {
    shakeMagnitude: number;
    flashDuration: number;
    particleCount: number;
    paletteInversion: boolean;
  }

  export function resolveDeathJuiceConfig(userOverrides?: Partial<DeathJuiceConfig>): DeathJuiceConfig {
    const reduced = prefersReducedMotion();
    
    return {
      shakeMagnitude: reduced ? 0 : (userOverrides?.shakeMagnitude ?? 8),
      flashDuration: reduced ? 0 : (userOverrides?.flashDuration ?? 5),
      particleCount: reduced ? 4 : (userOverrides?.particleCount ?? 16),
      paletteInversion: reduced ? false : (userOverrides?.paletteInversion ?? true)
    };
  }
  ```
- **Determinism profile**: Host-dependent configuration resolution.
- **Runtime cost**: Negligible.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Already supported via `prefersReducedMotion()` in `src/primitives/motion.ts`.
- **What to steal**: **Scaling rather than binary switching**. Instead of completely disabling all animations, reduced motion can scale down camera shake by 100% (or 80%), reduce particle counts to a minimum, and completely disable screen flashes, while keeping the core timing (delayed reset) identical so gameplay balance is preserved.
- **What to avoid**: Changing the logical timing of the death sequence (`DEATH_SEQUENCE_DURATION`) based on reduced motion, which would desync the simulation between players with different accessibility settings.

---

## Reusable Deterministic State/Event Abstractions vs. Showcase-Only Rendering

To maintain a clean architectural boundary, we must separate the **simulation logic** from the **decorative rendering layer**:

1. **The Core Simulation Layer (Deterministic State & Event Abstractions)**:
   - Tracks the player's lifecycle state: `alive`, `dying` (with a timer), and `dead`.
   - Triggers hit-stop freezes by returning a `HitStopState` with a non-zero `remaining` value.
   - Spawns deterministic particles via `src/particles/` using a seeded PRNG.
   - Emits plain JSON event descriptors (e.g., `PlayerDeathEvent`) to notify the outer system.
   - This keeps the simulation perfectly replayable, testable in Node, and free of side effects.

2. **The Host/Renderer Layer (Showcase-Only Rendering & Audio)**:
   - Receives the updated state and emitted events.
   - Triggers non-deterministic visual and auditory "juice" that does not affect physics:
     - Screen flashes (drawing solid rects with decaying alpha).
     - Camera shake (translating the Canvas2D context by a sinusoidal offset).
     - Procedural audio playback (firing Web Audio API synthesizers).
     - Palette inversion (modifying color slot mappings passed to drawing functions).
     - Accessibility scaling (reading `prefersReducedMotion()` and scaling offsets down).

---

## Reference Implementations

- **Celeste Player Death Source**: `https://github.com/NoelFB/Celeste/blob/master/Source/Player.cs` — Noel Berry's open-source C# player controller showing how the player is frozen, a screen flash is triggered, and a radial burst of 12 circular particles is spawned.
- **Vlambeer's "The Art of Screenshake" Talk**: `https://www.youtube.com/watch?v=AJdEqssNZ-U` — Jan Willem Nijman's classic talk on screenshake, freeze frames, and particle feedback.
- **Sokpop Fake-3D Demo**: `https://sokpop.itch.io/sokpop-fake-3d-demo` — Reference for orthographic projection and character construction.
- **JS13k "Space Huggers" Source**: `https://github.com/phoboslab/space-huggers` — Dominic Szablewski's 13KB game showing procedural particle explosions, screen shake, and Web Audio synthesis under extreme constraints.

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Celeste Death Burst | Player sprite disappears instantly, replaced by a circular ring of 12 expanding particles, a 0.15s freeze-frame, a screen flash, and a camera shake. | Celeste (Maddy Makes Games) |
| Stacklands Card Pop | Cards scale up to 1.2x, then shrink to 0.0x over 8 frames, emitting a small puff of white dust particles. | Stacklands (Sokpop Collective) |
| Super Meat Boy Splat | Player sprite is replaced by a permanent blood splat on the obstacle, accompanied by a heavy camera shake and a rapid reset. | Super Meat Boy (Team Meat) |

---

## Open Questions

- **Particle Pooling**: Should the death particles be allocated dynamically on the heap, or should we use a pre-allocated particle pool to avoid garbage collection spikes in high-frequency death loops (e.g., in a fast-paced platformer)?
- **Custom Palette Inversion Recipes**: Should the library provide a helper to generate inverted or high-contrast palettes automatically from any input palette, or should this be defined statically in the cosmetic manifest?
- **Web Audio Threading**: Does playing multiple procedural sounds simultaneously on rapid deaths cause audio clipping in low-end mobile browsers, and should we implement a voice-limiting queue in `AudioAdapter`?

---

## Top 3 Patterns Worth Prototyping

1. **The "Temporal Freeze & Kinetic Burst" Stack** — Combines `HitStopState` with a seeded radial particle burst. Why: It is the most critical feel-multiplier, separating the impact from the reset and grounding the character's physical presence.
2. **The "Sensory Jolt & Palette Inversion" Stack** — Swaps semantic palette slots (e.g., `outline` and `base`) for 3 frames on death, paired with a decaying full-screen Canvas2D flash. Why: It delivers a massive visual punctuation mark with zero asset overhead and perfect integration with Pillar 2 cosmetics.
3. **The "Spring-Driven Pop & Fade" Stack** — Applies a non-linear scale deformation to the character's primitive stack on death, scaling up to 1.5x before shrinking to 0. Why: It provides an organic, cartoonish "disintegration" effect that perfectly fits the Sokpop aesthetic.

---

## Cross-References

- `docs/research/platformer-juice.md` — Platformer game-feel and squash/stretch.
- `docs/research/particle-emitters.md` — Particle emitter state and regional spawning.
- `docs/research/algorithmic-palette-substitution.md` — Semantic-slot palette model and OKLCH color space.
- `src/primitives/hit-stop.ts` — Hit-stop freeze-frame helper.
- `src/animation/oscillators.ts` — Sine shake and decay envelopes.
- `src/audio/factory.ts` — Web Audio SFX adapter.
