# Platformer Game-Feel ("Juice")

> Research note for platformer game-feel ("juice") techniques — specifically for 2D side-on platformers built with minimalist procedural rendering (Sokpop-style, zero art assets). Slug: `platformer-juice`.
> Investigated: 2026-06-21.

## TL;DR

To transform a flat, rigid 2D side-on platformer into a highly responsive, satisfying, and "juicy" experience under strict zero-dependency and minimalist procedural rendering constraints, we must combine physical responsiveness with expressive secondary dynamics. The core of platformer juice lies in the asymmetric timing of squash and stretch (snapping in on impact over 1-2 frames, and easing out over 6-10 frames via a spring-damper system) and the elimination of input lag through instant physics launch paired with visual-only anticipation or post-launch stretch. By replacing hand-rolled, flat physics with a unified, apex-parameterized jump state machine that integrates coyote time, jump buffering, and variable jump height, we establish a rock-solid foundation for feel. Prototyping should focus on: (1) integrating the library's existing `jump.ts` state machine to solve the landing squash bug and add coyote/buffer mechanics, (2) implementing deterministic landing dust puffs and running footstep particles using the library's particle emitter, and (3) adding camera lookahead and screen shake driven by a decaying sinusoidal envelope to ground the character's weight in the world.

## Why this matters for aicraft-engine

This research directly impacts **Pillar 1 (Primitives & secondary dynamics)** and **Pillar 4 (Fake-3D & advanced rendering)**.
- **Showcase Polish:** The playable platformer playground (`showcase/sections/playground.ts`) is the ultimate "proof that the stack works" composite. If the playground feels flat, rigid, or buggy, it undermines the credibility of the entire library. Adding professional-grade game-feel to this playground demonstrates that minimalist, zero-asset procedural rendering can stand alongside premium indie titles.
- **Pillar Validation:** It exercises and validates multiple core modules in the library: `src/animation/jump.ts` (the jump state machine), `src/particles/` (deterministic particle systems), `src/animation/oscillators.ts` (screen shake), and `src/primitives/hit-stop.ts` (temporal freeze).
- **Aesthetic Synergy:** Sokpop-style games prove that when art assets are absent, procedural animation (squash, stretch, bounce, tilt) must do 100% of the work to convey weight, speed, and character.

---

## Prior Art Survey

### Pattern 1: Squash/Stretch Tuning for Platformers
- **Source**: Disney's "12 Principles of Animation" (Thomas & Johnston), and standard game-feel implementations in Celeste and Super Meat Boy.
- **What it does**: Deforms the character's visual representation based on vertical velocity and impact events to emphasize speed, weight, and elasticity.
  - **Asymmetric Impact Principle**: Landing squash must be sudden and sharp (snapping to maximum squash in 1-2 frames) to convey the sudden transfer of momentum, followed by a slower, springy recovery (6-10 frames) as the character regains their shape.
  - **Volume Preservation**: True squash and stretch preserves the character's area/volume (`scaleX * scaleY = 1`). If a character squashes vertically by 20% (`scaleY = 0.8`), they must stretch horizontally by 25% (`scaleX = 1.25`) to maintain visual mass.
  - **Anti-Pattern (Independent Axis Decay)**: Decaying `scaleX` and `scaleY` independently using simple linear interpolation (lerp) toward 1 violates volume preservation during the transition (e.g., at 50% decay, `scaleX * scaleY != 1`), making the character look "mushy" or "ghostly."
  - **Correct Approach**: Maintain a single fractional displacement offset (e.g., `squashOffset` from a 1D spring-damper), decay that single value, and compute the volume-preserving scale pair `(scaleX = 1 / (1 + squashOffset), scaleY = 1 + squashOffset)` on every frame.
- **Algorithmic shape**:
  ```typescript
  // 1D Semi-Implicit Euler Spring-Damper for squash recovery
  function advanceSquashSpring(
    offset: number,
    velocity: number,
    stiffness: number,
    damping: number,
    dt: number
  ): { offset: number; velocity: number } {
    const force = -stiffness * offset - damping * velocity;
    const nextVelocity = velocity + force * dt;
    const nextOffset = offset + nextVelocity * dt;
    return { offset: nextOffset, velocity: nextVelocity };
  }

  // Volume-preserving scale mapping
  function getSquashScale(offset: number): { scaleX: number; scaleY: number } {
    const scaleY = 1 + offset; // offset is negative for squash
    return { scaleX: 1 / scaleY, scaleY };
  }
  ```
- **Determinism profile**: Pure mathematical operations. 100% deterministic.
- **Runtime cost**: Negligible. A few arithmetic operations per frame.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is a pure-code visual effect that requires no art assets and perfectly preserves mathematical invariants.
- **What to steal**: Decaying a single spring-driven offset and applying `volumeScale` to preserve volume throughout the entire animation.
- **What to avoid**: Simple linear decay of separate axes, and extreme squash amplitudes (e.g., scaling width by 20x) caused by unnormalized velocity inputs.

### Pattern 2: Anticipation / Pre-Squash on Jump
- **Source**: Celeste dev blog (Maddy Thorson), Super Meat Boy post-mortems (Tommy Refenes), and Vlambeer's "The Art of Screenshake".
- **What it does**: Prepares the audience for an action by performing a brief reverse movement (crouching down) before launching upward.
  - **The Responsiveness Tradeoff**: In high-precision platformers, delaying the jump physics by even 3 frames (0.05s) to play an anticipation crouch makes the controls feel "sluggish" or "laggy." Responsiveness is king; the character must launch upward on the *exact frame* the button is pressed.
  - **Visual-Only Post-Launch Squash**: To get the visual benefit of anticipation without the physical lag, games like Celeste launch the player *instantly*, but apply a vertical stretch (e.g., `scaleY = 1.15`, `scaleX = 0.87`) on the launch frame, or play a visual-only crouch that doesn't delay the physics.
  - **Buffered Anticipation**: If a jump is buffered (pressed 0.1s before landing), the anticipation crouch can play *during* the buffer window while the character is still falling, making the landing-to-re-jump transition look incredibly fluid and natural.
- **Algorithmic shape**:
  ```typescript
  // In the jump state machine:
  // If instant responsiveness is desired, set anticipationDuration = 0.
  // Otherwise, use a tiny delay (e.g., 0.03s - 0.05s) for weightier games.
  interface JumpConfig {
    anticipationDuration: number; // seconds
    anticipationSquash: number;   // scaleY during anticipation (e.g., 0.85)
    launchStretch: number;        // scaleY on launch frame (e.g., 1.15)
  }
  ```
- **Determinism profile**: Pure state transitions. 100% deterministic.
- **Runtime cost**: Negligible.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Already supported in `src/animation/jump.ts`.
- **What to steal**: The ability to toggle between instant launch (launch stretch only) and weighted launch (anticipation delay) by tuning `anticipationDuration`.
- **What to avoid**: Forcing physical input lag on high-precision gameplay sections.

### Pattern 3: The Canonical Platformer Juice Checklist
- **Source**: Vlambeer's "The Art of Screenshake", "Juice It or Lose It", Game Maker's Toolkit, Sebastian Lague.
- **What it does**: A comprehensive suite of minor visual, temporal, and physical tweaks that collectively elevate game-feel.
- **Checklist**:
  1. **Coyote Time**: Grace period (0.08s - 0.15s) to jump after walking off a ledge. (Supported in `src/animation/jump.ts`).
  2. **Jump Buffering**: Queueing jump inputs (0.1s) before landing. (Supported in `src/animation/jump.ts`).
  3. **Variable Jump Height**: Cutting vertical velocity on button release. (Supported in `src/animation/jump.ts`).
  4. **Screen Shake**: Decaying sinusoidal offset applied to camera on impact. (Supported in `src/animation/oscillators.ts`).
  5. **Hit-Stop (Freeze Frames)**: Freezing the simulation for 2-6 frames on heavy landing. (Supported in `src/primitives/hit-stop.ts`).
  6. **Landing Dust Puff**: Spawning horizontal particles on impact. (Supported via `src/particles/`).
  7. **Running Footstep Dust**: Spawning tiny drift particles behind the player while running. (Supported via `src/particles/`).
  8. **Camera Lookahead**: Offsetting the camera in the direction of movement/facing. (Supported via `src/camera/`).
  9. **Character Tilt**: Tilting the character's body in the direction of horizontal movement. (Can be implemented via `ctx.rotate` in the renderer).
  10. **Afterimage / Trail**: Drawing faded silhouettes behind fast-moving characters. (Requires a simple position-history buffer in the renderer).
- **Fit for our constraints**: Extremely strong. All of these can be implemented with pure code, zero art assets, and zero external dependencies.

---

## Reference Implementations

- **Sokpop Fake-3D Demo**: `https://sokpop.itch.io/sokpop-fake-3d-demo` — Reference for orthographic projection and procedural character construction.
- **Celeste Player Physics Source**: `https://github.com/NoelFB/Celeste/blob/master/Source/Player.cs` — Noel Berry's open-source C# player controller showing exact coyote time, jump buffer, and corner correction values.
- **Vlambeer's "The Art of Screenshake" Talk**: `https://www.youtube.com/watch?v=AJdEqssNZ-U` — Jan Willem Nijman's classic talk on screenshake, freeze frames, and particle feedback.
- **"Juice It or Lose It" Talk**: `https://www.youtube.com/watch?v=Fy0aCDmgnxg` — Martin Jonasson and Petri Purho's demonstration of incremental juice.

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Celeste Squash/Stretch | Instant launch stretch (scaleY ~1.2) followed by landing squash (scaleY ~0.75) recovering via a spring. | Celeste (Maddy Makes Games) |
| Super Meat Boy Trail | Constant red particle trail and wall-slide dust puffs that emphasize speed. | Super Meat Boy (Team Meat) |
| Sokpop Character Tilt | Characters tilt forward by 5-10 degrees when running, driven by a spring that overshoots on direction change. | Sokpop Collective (Hoco Poco) |

---

## Open Questions

- **Corner Correction**: Should the library provide a 2D AABB corner correction helper in `src/collision/` to prevent players from getting stuck on the bottom corners of floating platforms?
- **Reduced Motion Integration**: How should we handle screen shake and squash-stretch for players who prefer reduced motion? (Currently, the playground is completely disabled if `shouldAnimate()` is false, but could we run the simulation without the visual juice instead?)
- **Particle Performance**: Does spawning 10-20 particles on landing cause garbage collection spikes in Canvas 2D if we don't use a pre-allocated particle pool? (The library's `src/particles/` should use a static pool or lightweight objects).

---

## Top 5 Patterns Worth Prototyping

1. **Integrate the Library's `jump.ts` State Machine** — Replaces the flat, hand-rolled physics in the playground with a professional, fully-featured jump controller. It instantly adds coyote time, jump buffering, variable jump height, anticipation, launch stretch, and spring-driven landing squash.
2. **Landing Dust Puff Particles** — Spawning a small burst of horizontal dust particles on landing instantly grounds the character in the world and provides a strong visual link between the character and the platforms.
3. **Screen Shake on Hard Landing** — Shaking the screen on high-impact landings (where impact velocity exceeds a threshold) sells the weight and power of the character.
4. **Running Footstep Dust Particles** — Spawning tiny dust puffs behind the character as they run adds a sense of speed, friction, and kinetic energy.
5. **Camera Lookahead (Directional Offset)** — Offsetting the camera slightly in the direction the player is facing or moving allows them to see more of the level ahead, which is standard in professional platformers.

---

## Cross-References

- `docs/research/README.md` — Research note conventions and backlog.
- `docs/research/procedural-locomotion.md` — Procedural movement and walk cycle research.
- The canonical Sokpop reference (sokpop.itch.io) — Strategic context on Sokpop's minimalist rendering.
- `src/animation/jump.ts` — The library's existing jump state machine.
- `src/animation/squash-stretch.ts` — The library's volume-preserving scale helpers.
- `src/particles/` — The library's deterministic particle system.
