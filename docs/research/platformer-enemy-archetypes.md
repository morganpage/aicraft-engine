# Deterministic Platformer Enemy Archetypes

> Research note for reusable deterministic platformer enemy archetypes. Slug: `platformer-enemy-archetypes`.
> Investigated: 2026-07-20.

## TL;DR

A deterministic platformer enemy system provides a headless, modular, and serializable behavior-kernel for simulating hazards and ranged threats in a zero-runtime-dependency TypeScript library. By separating pure physical simulation (using our existing AABB resolvers) from procedural rendering, the system guarantees byte-identical replays and stable level-editor integration. We propose a lightweight, table-driven behavior dictionary that supports: (A) a spinny/contact-hazard patrol enemy with ledge-detection and (B) a shooty turret with deterministic, cooldown-based projectile aiming. The top 3 patterns worth prototyping are: (1) a **Stateless Behavior-Kernel Dictionary** with generic state/timer bags, (2) **Kinematic Projectile Sub-stepping** with direct AABB overlap checks, and (3) **Procedural Visual Posing** driven entirely by tick and logical state.

## Why this matters for aicraft-engine

- **Pillars Touched**: Directly establishes **Pillar 4 (Fake-3D / Level Loading / Editor)** and integrates with **Pillar 1 (Primitives / Seeded RNG / Particles / Collision)**.
- **Consumer Games**: Consumer titles need interactive hazards and enemies to create challenging, engaging levels.
- **Unlocks**:
  - **Level-Editor Integration**: Allows creators to place, configure, and path enemies visually in the level editor, saving them directly to the serializable `LevelData` schema.
  - **Deterministic Replays & Clear-Checks**: Since enemy behaviors and projectile timings are 100% deterministic, level clear-checks (verifying a level is winnable) remain completely stable across replays.
  - **Zero-Dependency Extensibility**: A thin behavior-kernel allows consumers to define custom enemy types by simply registering new behavior handlers in a dictionary, without modifying the library core.

---

## Prior Art Survey

### Pattern 1: Table-Driven Behavior Dictionary (JS13k / Minimalist Engines)
- **Source**: JS13k game architectures (e.g., *Lost in Cyberspace*, *Ninja Adventure*)
- **What it does**: Represents enemy behaviors as a set of pure, stateless transition and update functions mapped to a behavior dictionary. The enemy state contains a `behaviorState` string/integer and a generic `customState` or timers. The kernel updates the enemy by looking up the behavior in the dictionary and executing it.
- **Algorithmic shape**:
  ```typescript
  export interface EnemyState {
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly vx: number;
    readonly vy: number;
    readonly facing: 1 | -1;
    readonly behaviorState: string;
    readonly timers: Readonly<Record<string, number>>;
    readonly customState?: Readonly<Record<string, unknown>>;
  }

  export type EnemyBehaviorHandler = (
    state: EnemyState,
    config: EnemyConfig,
    ctx: EnemyUpdateContext
  ) => {
    readonly state: EnemyState;
    readonly spawnedProjectiles?: readonly ProjectileState[];
    readonly events?: readonly string[];
  };
  ```
- **Determinism profile**: Purely deterministic. All timers are decremented by the fixed `dt` parameter.
- **Runtime cost**: Extremely low. $O(1)$ lookup and execution per enemy.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is a pure, headless mathematical model that perfectly aligns with our zero-dependency, deterministic core.
- **What to steal**: **Stateless behavior dictionary and generic timer/state bags**. This keeps the core engine tiny while allowing infinite extensibility.
- **What to avoid**: Avoid nesting deep inheritance hierarchies; prefer flat composition and simple state transitions.

### Pattern 2: Kinematic Projectile Integration (Celeste)
- **Source**: Noel Berry's [Celeste Player.cs / SeekerBarrier.cs](https://github.com/NoelFB/Celeste)
- **What it does**: Simulates projectiles (like fireballs, arrows, or custom hazard spheres) as simple kinematic bounding boxes that move at constant velocity, checking for solid collisions and player collisions on each tick.
- **Algorithmic shape**:
  ```typescript
  export interface ProjectileState {
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly vx: number;
    readonly vy: number;
    readonly width: number;
    readonly height: number;
    readonly active: boolean;
  }

  export function stepProjectile(
    p: ProjectileState,
    solids: readonly Solid[],
    player: Rect | null,
    dt: number
  ): {
    readonly projectile: ProjectileState;
    readonly hitPlayer: boolean;
  } {
    const nextX = p.x + p.vx * dt;
    const nextY = p.y + p.vy * dt;
    const nextRect = { ...p, x: nextX, y: nextY };
    
    if (checkSolidCollision(nextRect, solids)) {
      return { projectile: { ...p, active: false }, hitPlayer: false };
    }
    if (player && checkOverlap(nextRect, player)) {
      return { projectile: { ...p, active: false }, hitPlayer: true };
    }
    return { projectile: nextRect, hitPlayer: false };
  }
  ```
- **Determinism profile**: 100% deterministic.
- **Runtime cost**: Low. $O(M \times S)$ where $M$ is the number of active projectiles and $S$ is the number of solids.
- **Dependencies**: None.
- **Fit for our constraints**: Strong.
- **What to steal**: **Deactivation on solid hit and direct AABB overlap checks for player damage**.
- **What to avoid**: Avoid complex physics integration (like gravity or air resistance) for basic projectiles unless explicitly required; simple constant-velocity vectors are cheaper and feel more predictable to the player.

### Pattern 3: Sokpop's Procedural Visual Posing (Decoupled Renderer)
- **Source**: Sokpop Collective (e.g., *Pyramida*, *Llama Villa*) and [Sokpop Fake-3D Demo](https://sokpop.itch.io/sokpop-fake-3d-demo)
- **What it does**: Separates the logical simulation state of the enemy from its visual representation. The simulation tracks only the raw position, velocity, and behavior state. The renderer uses the current tick and logical state to procedurally compute rotation angles, squash/stretch, and bobbing offsets, drawing them using simple Canvas2D primitives.
- **Algorithmic shape**:
  ```typescript
  export function drawEnemy(
    ctx: CanvasRenderingContext2D,
    enemy: EnemyState,
    tick: number
  ): void {
    ctx.save();
    ctx.translate(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2);
    
    // Procedural animation based on logical state
    if (enemy.behaviorState === 'patrol') {
      const bob = Math.sin(tick * 0.2) * 2;
      ctx.translate(0, bob);
      const angle = tick * 0.1; // Spinny sawblade effect
      ctx.rotate(angle);
    } else if (enemy.behaviorState === 'shoot') {
      const squash = 1 + Math.sin(tick * 0.4) * 0.1;
      ctx.scale(1 / squash, squash);
    }
    
    // Draw primitive shape
    outlineRect(ctx, -enemy.width / 2, -enemy.height / 2, enemy.width, enemy.height, '#FF0000');
    ctx.restore();
  }
  ```
- **Determinism profile**: The visual-only effects can relax determinism rules (e.g., using `Math.random` for particle sparks or screen shake) since they do not leak back into the simulation.
- **Runtime cost**: Low to medium (depends on rendering complexity, but Canvas2D is highly optimized for simple paths).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It keeps the simulation core pure and 100% deterministic while allowing maximum visual juice.
- **What to steal**: **Visual-only procedural transforms driven by tick and logical state**.
- **What to avoid**: Avoid storing visual variables (like current rotation angle or squash factor) in the authoritative simulation state; compute them on the fly in the renderer.

### Pattern 4: Ledge-Detection & Turnaround (Goomba Pattern)
- **Source**: Classic platformers (NES Super Mario Bros, retro demoscene)
- **What it does**: Simulates a basic patrol enemy that walks left/right and turns around when it hits a wall or reaches a ledge (the edge of a platform). Ledge detection is resolved by checking the solidity of the tile directly beneath the enemy's leading edge.
- **Algorithmic shape**:
  ```typescript
  export function checkLedge(
    x: number,
    y: number,
    width: number,
    height: number,
    facing: 1 | -1,
    query: TileSolidityQuery,
    tileSize: number
  ): boolean {
    const leadingX = facing === 1 ? x + width + 2 : x - 2;
    const checkY = y + height + 2;
    const { tileX, tileY } = worldToTile(leadingX, checkY, tileSize);
    return query(tileX, tileY) === 'empty';
  }
  ```
- **Determinism profile**: 100% deterministic.
- **Runtime cost**: Negligible (single tile query).
- **Dependencies**: None (uses existing `worldToTile` primitive).
- **Fit for our constraints**: Strong.
- **What to steal**: **Leading-edge offset tile queries** to detect ledges before the enemy's center of mass falls off.
- **What to avoid**: Avoid complex raycasting or geometric line-segment intersections when a simple grid-aligned tile lookup is sufficient.

---

## Serializable Editor Schemas

To integrate enemies with the level editor (`src/editor/`) and level schema (`src/level/`), we define a new `LevelEntity` variant with `kind: 'enemy'`. The configuration is stored in the entity's `props` bag:

```typescript
export interface EnemyProps {
  /** The behavioral archetype: 'patrol' (contact hazard) or 'turret' (ranged shooter). */
  readonly archetype: 'patrol' | 'turret';
  /** Movement speed in pixels per second (only applicable to patrolling enemies). */
  readonly speed: number;
  /** Optional list of waypoints for path-based patrolling. */
  readonly patrolPath?: readonly { readonly x: number; readonly y: number }[];
  /** Waypoint cycle mode: 'loop' or 'pingpong'. */
  readonly patrolLoopMode?: 'loop' | 'pingpong';
  /** If true, the enemy reverses direction when reaching a platform edge. */
  readonly ledgeTurnAround?: boolean;
  /** Shots fired per second (only applicable to turrets). */
  readonly fireRate?: number;
  /** Speed of spawned projectiles in pixels per second. */
  readonly projectileSpeed?: number;
  /** Size (width/height) of spawned projectiles in pixels. */
  readonly projectileSize?: number;
  /** Shooting style: 'fixed' (constant direction) or 'aimed' (targets player). */
  readonly projectileType?: 'fixed' | 'aimed';
  /** Constant shooting vector for fixed turrets (e.g. {x: 0, y: 1} for down). */
  readonly aimDirection?: { readonly x: number; readonly y: number };
  /** Radius in pixels within which the player triggers the turret to fire. */
  readonly detectionRadius?: number;
}
```

This schema is fully JSON-serializable, contains no closures or non-finite numbers, and can be validated defensively by `validateLevel` in `src/level/validate.ts`.

---

## Reference Implementations

- **Celeste State Machine** ([GitHub: NoelFB/Celeste](https://github.com/NoelFB/Celeste)): Teaches modular state machines and timer-based cooldowns.
- **Sokpop Fake-3D Demo** ([itch.io](https://sokpop.itch.io/sokpop-fake-3d-demo)): Illustrates procedural visual posing and primitive-stack character construction.
- **Phobos JS13k** ([GitHub: brenoc/phobos](https://github.com/brenoc/phobos)): Demonstrates highly compressed, table-driven enemy behavior updates under extreme size constraints.

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Celeste Sawblades | Spinny sawblade hazards following visual-only rotation curves | [Celeste Game](https://maddymakesgames.com/) |
| Sokpop Pyramida | Procedural walking and bobbing animations driven by logical state | [Sokpop Pyramida](https://sokpop.itch.io/pyramida) |
| Super Mario Maker Turrets | Cooldown-based aimed firing with visual anticipation squash/stretch | [Super Mario Maker 2](https://supermariomaker2.nintendo.com/) |

---

## Open Questions

- **How to handle projectile tunneling at high speeds?**
  - *Proposal*: Cap projectile speeds to the `tileSize` per frame, or perform sub-stepping (dividing the movement step into smaller increments) if high-speed projectiles are required.
- **Should projectiles be managed globally or locally?**
  - *Proposal*: Projectiles should be managed in a global flat array `readonly ProjectileState[]` in the level runtime state, rather than nested inside individual enemy states. This makes global collision checks and rendering much simpler and more performant.
- **How to handle enemy-on-enemy collisions?**
  - *Proposal*: For minimalist platformers, enemies should pass through each other to avoid complex physics resolution. If collision is needed, simple AABB bounce-back can be applied without full rigid-body integration.

---

## Top 3 Patterns Worth Prototyping

1. **Stateless Behavior-Kernel Dictionary** — Decouples enemy logic into pure, stateless handlers mapped to a dictionary, allowing infinite extensibility without god-classes.
2. **Kinematic Projectile Sub-stepping** — Simulates projectiles as simple constant-velocity AABBs that deactivate on solid/player hit, ensuring deterministic projectile timing.
3. **Procedural Visual Posing** — Keeps the simulation pure while allowing rich, juicy animations (spinning sawblades, aiming turrets, squash/stretch) to be computed on the fly in the renderer.

---

## Cross-References

- `docs/research/platformer-kernel.md` — The core platformer simulation loop.
- `docs/research/level-schema.md` — Serializable level formats and entity taxonomies.
- `src/collision/resolve.ts` — Existing per-axis AABB resolver.
- `src/level/types.ts` — Shipped level entity types.
