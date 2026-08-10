# Enemy Archetype Catalog

> Research note for platformer enemy archetypes. Slug: `enemy-archetype-catalog`.
> Investigated: 2026-07-27.

## TL;DR

This catalog establishes the prior-art foundation for expanding the `aicraft-engine` platformer enemy behaviors beyond the initial three built-ins (`spinny`, `turret`, `spider`). By surveying canonical 2D platformers and metroidvanias, we identify and evaluate five new candidate archetypes: `chaser` (aggressive ground pursuit), `flyer` (aerial patrol and seek), `burster` (kamikaze proximity hazard), `charger` (telegraphed high-speed dash), and `crawler` (gravity-orthogonal surface-hugging patrol). These archetypes provide maximum behavioral diversity under our strict zero-runtime-dependency and 100% deterministic constraints. We recommend prioritizing all five as they introduce distinct spatial navigation patterns and compose beautifully with a future telegraphed attack system, requiring minimal additions to our core AABB and tile-grid primitives.

## Why this matters for aicraft-engine

- **Pillars Touched**: Directly expands **Pillar 4 (Fake-3D / Level Loading / Editor)** and leverages **Pillar 1 (Primitives / Seeded RNG / Particles / Collision)**.
- **Consumer Games**: Consumer titles require a rich palette of enemy behaviors to create engaging, varied levels without bloating the bundle size.
- **Unlocks**:
  - **Telegraph System Synergy**: Establishes clear hooks for Phase 3's deterministic windup → active → recovery state-machine, making enemy attacks readable and fair.
  - **Level Design Depth**: Moves beyond static hazards and simple patrols into active player tracking, aerial zoning, and terrain-adaptive movement.
  - **Deterministic Replays**: Ensures that complex seeking, charging, and exploding behaviors remain byte-identical across replays and clear-checks.

---

## Prior Art Survey

### Dead Cells (Motion Twin)
- **Source**: *Dead Cells* Enemy Design & Combat System
- **What it does**: *Dead Cells* is a masterclass in telegraphed, high-impact combat. Enemies have highly readable silhouettes and distinct attack sequences.
  - *Shieldbearer*: Slow-moving patrol with front-facing armor. Blocks all attacks from the front, forcing the player to roll behind or parry.
  - *Runner*: Rapidly chases the player on sight, teleporting or dashing to catch up.
  - *Kamikaze*: Small, flying bat-like enemy that dives toward the player and explodes after a brief, high-frequency flashing countdown.
  - *Caster*: Stationary mage that casts a telegraphed magic circle at the player's position, inflicting area-of-effect (AOE) damage after a delay.
- **Key Patterns to Steal**:
  - **Visual Telegraphing**: A distinct "exclamation mark" or silhouette squash/stretch warning (200–400ms) before any attack frames become active.
  - **Directional Vulnerability**: Checking the relative angle between the attacker and the defender to resolve blocks/shields.
- **Traps to Avoid**:
  - *Combinatorial State Explosion*: Avoid complex behavior trees; prefer flat, table-driven state machines with simple timers.

### Axiom Verge (Thomas Happ)
- **Source**: *Axiom Verge* Biomechanical Enemy Taxonomy
- **What it does**: *Axiom Verge* uses simple, highly constrained movement patterns that combine to create a hostile, alien atmosphere.
  - *Drones*: Small flying mechanical or organic pods that patrol along simple vertical/horizontal lines or smooth sine waves.
  - *Brains (Floating Seekers)*: Slow-moving aerial seekers that float directly toward the player, ignoring tile collisions.
  - *Coalesced Spawn (Swarmers)*: Tiny, weak enemies that spawn in large numbers from nests, swarming the player with simple, high-speed seeking.
- **Key Patterns to Steal**:
  - **Sine-Wave Patrols**: Adding a simple harmonic offset to a linear movement vector to create organic-feeling flight.
  - **Swarm Physics**: Lightweight, collision-less (or slide-only) seeking for tiny entities to keep runtime costs negligible.
- **Traps to Avoid**:
  - *Wall-Clipping without Cues*: Enemies that move through solid tiles must have a distinct visual appearance (e.g., ghost-like, phasing) so players understand why their weapons might or might not hit them.

### Hollow Knight (Team Cherry)
- **Source**: *Hollow Knight* Combat & Enemy Behaviors
- **What it does**: *Hollow Knight* uses simple movement scripts enhanced by superb animation and sound design to create distinct combat encounters.
  - *Vengefly*: Floats in place or patrols. Upon detecting the player, it lets out a telegraphed screech (windup), then flies directly toward the player's position.
  - *Crawlid*: Simple, mindless ground crawler that walks back and forth, turning around at walls.
  - *Mossfly*: Aerial enemy that hovers, then charges horizontally at the player after a brief windup.
- **Key Patterns to Steal**:
  - **Screech/Roar Windup**: A brief pause in movement coupled with a visual/audio cue before transitioning to high-speed pursuit.
  - **Stun/Rebound**: Enemies bouncing back or entering a brief recovery state when hitting walls or being struck.
- **Traps to Avoid**:
  - *Over-reliance on Custom Physics*: Keep movement equations simple and grid-aligned rather than writing bespoke, non-deterministic gravity/friction curves for every enemy.

### Super Metroid (Nintendo)
- **Source**: Classic Metroidvania Taxonomy
- **What it does**: *Super Metroid* established the foundational taxonomy of 2D platformer enemies.
  - *Zoomer*: The canonical wall/ceiling crawler. It hugs the contours of platforms, rotating 90 degrees around corners.
  - *Skree*: Clings to the ceiling. When the player passes underneath, it dives down like a drill, getting stuck in the ground or exploding into debris.
  - *Ripper*: Slow, armored, floating platform-like enemy that patrols back and forth. It is immune to basic attacks but can be frozen to serve as a temporary platform.
- **Key Patterns to Steal**:
  - **Surface-Hugging Locomotion**: Using tile-grid checks to rotate the enemy's "up" vector and align its movement to floors, walls, and ceilings.
  - **Ceiling-Drop Trigger**: Simple vertical raycast/bounding-box checks to trigger a downward dive behavior.
- **Traps to Avoid**:
  - *Complex Normal-Vector Math*: Avoid floating-point surface normal calculations; use discrete tile-grid coordinates and 90-degree cardinal rotations.

### Celeste (Maddy Makes Games)
- **Source**: *Celeste* Hazard & Seeker Architecture
- **What it does**: *Celeste* uses a very small cast of enemies, but each is extremely polished and serves a precise gameplay purpose.
  - *Snowballs*: Fly horizontally across the screen at regular, telegraphed intervals, forcing the player to time their dashes.
  - *Seekers*: Large, menacing creatures that patrol. Upon spotting the player, they screech, lock their dash direction, and charge at high speed. If they hit a solid tile, they get stunned, shaking in place before resuming patrol.
- **Key Patterns to Steal**:
  - **Stun on Solid Hit**: Rewarding the player for baiting a charging enemy into a wall by giving them a clear vulnerability window.
  - **Locked-Direction Dash**: Forcing the charger to commit to a straight-line vector at the moment of the dash, allowing the player to dodge vertically.
- **Traps to Avoid**:
  - *Complex Pathfinding*: Seekers use simple line-of-sight and direct-line charges rather than expensive $A^*$ pathfinding through complex mazes.

### JS13k Winners (Constrained Environments)
- **Source**: Highly optimized, zero-dependency JS13k game architectures (e.g., *Phobos*, *Ninja Adventure*)
- **What it does**: Achieves high enemy variety under 13KB by using a table-driven behavior dictionary and a single flat array of entities.
- **Key Patterns to Steal**:
  - **Generic Timer Bags**: Storing all cooldowns and state durations in a flat `Record<string, number>` inside the enemy's `data` bag, decremented automatically by `dt` in a single loop.
  - **Shared Collision Routines**: Reusing the same AABB solid-collision resolver for players, enemies, and projectiles.
- **Traps to Avoid**:
  - *Hardcoded State Transitions*: Avoid hardcoding transitions inside the core loop; keep them encapsulated within each archetype's `step` handler.

---

## Candidate Archetypes Evaluation

### 1. `chaser` (Ground Chase)

- **Behavior Sketch**:
  The `chaser` patrols back and forth horizontally. It continuously checks for the player within a detection rectangle and line-of-sight (LOS). Upon detection, it transitions to a `chase` state, running toward the player's X coordinate. It can be configured as *cautious* (stops and turns around at ledges) or *reckless* (falls off ledges to pursue the player). If the player is lost (e.g., hides behind a wall or moves out of range), a `lostTimer` counts down before the chaser returns to its `patrol` state.
- **Textual State-Machine**:
  ```
  [Patrol] ──(Player in LOS & Range)──> [Chase]
     ^                                    │
     └──────(Player lost for > X sec)─────┘
  ```
- **EnemyUpdateContext Usage**:
  - `playerRect`: Used to calculate horizontal distance, direction, and vertical alignment.
  - `tileQuery` & `tileSize`: Used for wall collision and ledge detection.
  - `solids`: Used for AABB solid-collision resolution.
- **Data-Bag Shape**:
  ```typescript
  interface ChaserData {
    phase: 'patrol' | 'chase';
    lostTimer: number;       // Countdown (seconds) before giving up chase
    spinAngle?: number;      // Reused if drawing a rolling/spinning chaser
    waypointIndex?: number;  // Reused if patrolling along a path
  }
  ```
- **Determinism Profile**:
  100% pure and deterministic. Timers decrement by `ctx.dt`.
- **Runtime Cost**:
  Low. $O(1)$ per tick. Line-of-sight is resolved via a simple tile-grid raycast or basic bounding box overlap.
- **Reuses of Existing Primitives**:
  - `worldToTile` for ledge and wall detection.
  - `aabbOverlap` for player contact hazard.
- **NEW Primitives Required**:
  - `checkLineOfSight(x1, y1, x2, y2, tileQuery, tileSize)`: A simple DDA (Digital Differential Analyzer) or tile-stepping raycast helper to verify solid blocks do not obstruct the line of sight.

---

### 2. `flyer` (Aerial Patrol/Seek)

- **Behavior Sketch**:
  The `flyer` is an aerial hazard that ignores gravity. It can patrol along a horizontal line while applying a vertical sine-wave offset (`sine_patrol`), or it can actively seek the player in 2D space (`seek`) when the player enters its detection radius. It performs basic slide-collisions against solids or passes through them depending on configuration.
- **Textual State-Machine**:
  ```
  [SinePatrol] ──(Player in Radius)──> [Seek]
        ^                                │
        └──────(Player out of Radius)────┘
  ```
- **EnemyUpdateContext Usage**:
  - `playerRect`: Used to compute the 2D vector toward the player center.
  - `dt`: Used to advance accumulated time for the sine-wave oscillator and scale movement velocity.
  - `solids`: Used for optional slide-collision resolution.
- **Data-Bag Shape**:
  ```typescript
  interface FlyerData {
    phase: 'patrol' | 'seek';
    accumulatedTime: number; // Drives the sine-wave: yOffset = sin(time * freq) * amp
    startX: number;          // Anchor X for patrol
    startY: number;          // Anchor Y for patrol
  }
  ```
- **Determinism Profile**:
  100% pure and deterministic.
- **Runtime Cost**:
  Low. Simple vector math and trigonometric calculations.
- **Reuses of Existing Primitives**:
  - Trigonometric oscillators (similar to existing particle/glow effects).
- **NEW Primitives Required**:
  - `moveTowards(currentX, currentY, targetX, targetY, maxStep)`: A simple 2D vector helper to advance a position toward a target.

---

### 3. `burster` (Kamikaze)

- **Behavior Sketch**:
  The `burster` is a high-threat suicide-bomber. It flies or runs aggressively toward the player. When it enters a close proximity threshold, it locks itself in place and enters a `fuse` state. During the fuse state, it shakes violently (visual-only, but driven by a logical timer) and flashes. When the fuse timer expires, it deactivates (`alive = false`) and spawns a short-lived, static circular explosion hazard (AABB) that damages the player on contact.
- **Textual State-Machine**:
  ```
  [Seek] ──(Player in Proximity)──> [Fuse] ──(Timer Expired)──> [Explode (alive=false)]
  ```
- **EnemyUpdateContext Usage**:
  - `playerRect`: Used to track player position and calculate proximity.
  - `dt`: Used to decrement the fuse timer.
- **Data-Bag Shape**:
  ```typescript
  interface BursterData {
    phase: 'seek' | 'fuse' | 'exploded';
    fuseTimer: number;       // Countdown (seconds) to explosion
    shakeOffset: { x: number; y: number }; // Deterministic shake offset
  }
  ```
- **Determinism Profile**:
  100% pure and deterministic. The visual shake offset is computed deterministically using a high-frequency sine wave driven by `fuseTimer` (e.g., `sin(fuseTimer * 100) * amp`).
- **Runtime Cost**:
  Low. Proximity check is a simple distance-squared comparison.
- **Reuses of Existing Primitives**:
  - Particle emitters (to spawn a burst of smoke/fire particles upon explosion).
- **NEW Primitives Required**:
  - A temporary explosion hazard primitive, or a way for `stepEnemies` to return a short-lived, non-moving projectile with a large hitbox.

---

### 4. `charger` (Telegraphed Dash)

- **Behavior Sketch**:
  The `charger` patrols slowly. When the player enters its horizontal line of sight (same Y level or within a narrow Y band) and is within range, it stops and enters a `windup` state. It flashes or scrapes its feet (visual-only) for a set duration. Once the windup timer expires, it locks its dash direction and charges rapidly across the screen. The charge continues until the charger hits a solid wall or travels its maximum dash distance, at which point it enters a `recovery` (stunned) state, shaking in place before returning to slow patrol.
- **Textual State-Machine**:
  ```
  [Patrol] ──(Player in LOS)──> [Windup] ──(Timer Expired)──> [Dash]
     ^                                                         │
     └──────────(Stun Timer Expired) <── [Recovery] <──(Hit Wall/Max Dist)
  ```
- **EnemyUpdateContext Usage**:
  - `playerRect`: Used to detect horizontal alignment and trigger the windup.
  - `solids` & `tileQuery`: Used to detect wall collisions during the high-speed dash.
  - `dt`: Used to advance positions and decrement windup/recovery/dash timers.
- **Data-Bag Shape**:
  ```typescript
  interface ChargerData {
    phase: 'patrol' | 'windup' | 'dash' | 'recovery';
    windupTimer: number;
    recoveryTimer: number;
    dashDir: 1 | -1;
    dashDistance: number;    // Accumulated distance traveled during the current dash
  }
  ```
- **Determinism Profile**:
  100% pure and deterministic.
- **Runtime Cost**:
  Low. Reuses standard AABB wall collision checks.
- **Reuses of Existing Primitives**:
  - `aabbOverlap` for player contact.
  - Wall collision checks from the platformer kernel.
- **NEW Primitives Required**:
  - None. It beautifully composes existing movement and collision primitives with a robust state machine.

---

### 5. `crawler` (Wall/Ceiling Crawler)

- **Behavior Sketch**:
  The `crawler` is a terrain-adaptive hazard that hugs solid tiles. It can walk on floors, climb up walls, walk upside-down on ceilings, and descend down the other side. It maintains constant contact with the solid surface and rotates its orientation (facing and "up" vector) by 90 degrees when traversing corners (both inward corners, like hitting a wall, and outward corners, like reaching a ledge).
- **Textual State-Machine**:
  ```
  [Crawl] ──(Hit Wall Ahead)───────────> [Rotate Inward 90°] ──> [Crawl]
     │
     └────(Ground Disappears Under) ──> [Rotate Outward 90°] ──> [Crawl]
  ```
- **EnemyUpdateContext Usage**:
  - `tileQuery` & `tileSize`: Used heavily to query adjacent tiles (ahead, below, and diagonally below-ahead) to detect walls and ledges.
  - `dt`: Used to advance position along the current cardinal direction.
- **Data-Bag Shape**:
  ```typescript
  interface CrawlerData {
    phase: 'crawl';
    attachmentSide: 'bottom' | 'left' | 'top' | 'right'; // Side touching the solid
    crawlDir: 1 | -1; // 1 = clockwise, -1 = counter-clockwise around the solid
    angle: number;    // Visual rotation angle (radians) for rendering
  }
  ```
- **Determinism Profile**:
  100% pure and deterministic.
- **Runtime Cost**:
  Medium. Requires 3–4 tile queries per tick to handle corner transitions correctly.
- **Reuses of Existing Primitives**:
  - `worldToTile` for tile coordinate lookups.
- **NEW Primitives Required**:
  - **Surface-Hugging Stepper**: A specialized movement solver that translates a 1D crawl displacement into 2D world-space coordinates based on the current `attachmentSide`, updating the side and visual angle when traversing corners.

---

## Comparison Table

| Archetype | Behavioral Distinctness vs. Existing 3 | Implementation Cost | Telegraph-Friendliness | Combat-Dependency |
|---|---|---|---|---|
| **`chaser`** | **High**<br>Active ground tracking vs. blind patrol | **Low**<br>Uses existing AABB + simple LOS check | **Medium**<br>Can pause/telegraph a swipe before contact | **Low**<br>Functions perfectly as a contact hazard |
| **`flyer`** | **High**<br>Aerial flight vs. ground-bound | **Low**<br>Ignores gravity; simple vector math | **Low**<br>Continuous movement; hard to telegraph | **Low**<br>Functions perfectly as a contact hazard |
| **`burster`** | **Very High**<br>Suicide bomber vs. shooter/patrol | **Medium**<br>Requires proximity check + timers | **High**<br>Built entirely around the fuse countdown | **Low**<br>Self-destructs; doesn't need HP to be fun |
| **`charger`** | **Very High**<br>High-speed dash vs. slow patrol | **Low to Medium**<br>Composes timers with rapid movement | **Very High**<br>Perfect fit for windup → dash → recovery | **Low**<br>Functions perfectly as a contact hazard |
| **`crawler`** | **Very High**<br>Wall/ceiling vs. floor-only | **Medium to High**<br>Requires complex corner-rotation logic | **Low**<br>Continuous movement; hard to telegraph | **None**<br>Purely a movement-based hazard |

---

## Reference Implementations

- **Celeste Seeker AI** ([GitHub: NoelFB/Celeste](https://github.com/NoelFB/Celeste/blob/master/Source/Player/Player.cs)): Demonstrates telegraphed charging, line-of-sight checks, and wall-impact stun states.
- **Super Metroid Zoomer Behavior**: Classic surface-hugging crawler logic using discrete tile checks to rotate movement vectors.
- **JS13k table-driven state machines**: Examples of compressing multiple complex behaviors into a single stateless update loop using flat data bags.

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Dead Cells Kamikaze | Bat-like flyer charging, stopping, flashing red, and exploding | [Dead Cells Game](https://deadcells.com/) |
| Celeste Seeker Charge | Enemy screeching (windup), charging in a straight line, and stunning on wall hit | [Celeste Game](https://maddymakesgames.com/) |
| Super Metroid Zoomer | Small spiky creature walking seamlessly around the edges of a floating platform | [Super Metroid Game](https://www.nintendo.co.jp/) |

---

## Open Questions

- **How should the `burster`'s explosion be represented?**
  - *Proposal*: The `burster`'s step handler can return a short-lived `ProjectileState` with a velocity of zero, a large hitbox (e.g., 32x32), and a `maxRange` or lifetime timer. This allows the consumer's existing projectile-collision pipeline to handle player damage without any new systems.
- **Should the `crawler` slide along smooth slopes?**
  - *Proposal*: No. To maintain zero-dependency simplicity and high performance, the crawler should be restricted to grid-aligned 90-degree tiles. Slopes should be treated as solid blocks or ignored to avoid complex vector projections.
- **How do we handle line-of-sight (LOS) efficiently?**
  - *Proposal*: A simple tile-stepping raycast (Bresenham's line algorithm or DDA) that queries the tile grid between the enemy center and the player center. If any solid tile is hit, LOS is blocked. If the player is within range and no solids block, LOS is established.

---

## Top 5 Archetypes Worth Implementing (Ranked)

1. **`charger`**
   - *Rationale*: Offers the highest gameplay impact and telegraph-friendliness. It teaches players to bait attacks, dodge vertically, and exploit the stun/recovery window, creating highly engaging combat loops with zero combat-system dependencies.
2. **`chaser`**
   - *Rationale*: The fundamental active ground hazard. It forces players to move and react rather than just jumping over a predictable patrol. Extremely low implementation cost.
3. **`burster`**
   - *Rationale*: Introduces high-tension proximity gameplay. It composes perfectly with the future telegraph system and particle emitters, providing a spectacular visual and mechanical payoff.
4. **`flyer`**
   - *Rationale*: Adds a vital vertical dimension to enemy variety. It prevents players from simply staying airborne to avoid ground hazards, zoning the air space effectively.
5. **`crawler`**
   - *Rationale*: Highly distinct visual and spatial movement. It utilizes the tile grid in a completely new way, turning ceilings and walls into active hazard zones.

---

## Cross-References

- `docs/research/platformer-enemy-archetypes.md` — The foundational enemy research note.
- `docs/design/character-enemy-variety-roadmap.md` — The strategic roadmap for character and enemy variety.
- `src/platformer/enemy/types.ts` — The `EnemyBehaviorHandler` and `EnemyState` type definitions.
- `src/platformer/enemy/registry.ts` — The existing `spinny`, `turret`, and `spider` behavior implementations.
