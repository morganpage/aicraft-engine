# API Proposal: Deterministic Platformer Enemy Archetypes

> Target pillar: Pillar 4 (Level Schema + Runtime). Module: `src/platformer/enemy/` (new sub-module).
> Builds on research: `docs/research/platformer-enemy-archetypes.md`.
> Status: DRAFT.

## Consumer Need

**Who:** The consumer game is the first real consumer. Future consumer titles need the same enemy archetypes. The showcase needs interactive hazards to demonstrate the platformer kernel in action.

**What they're doing now:** The consumer game has a `TrapHandler` system (`src/core/traps/types.ts`) with a mutable `runtime.data` bag, but that architecture is consumer-specific — it mutates `GameState` directly and reads `GameState` in the `update` call. The aicraft-engine library has no enemy/hazard runtime at all — only static `hazard` entities (empty props, no behavior). The showcase playground can place hazards but they're inert colored rects.

**What becomes possible:** Two MVP archetypes that cover the two fundamental enemy patterns:
1. **Spinny / contact-patrol** — walks a path, kills on touch, has a spinning visual pose. The "goomba" of deterministic platformers.
2. **Shooty / ranged turret** — stationary or patrolling, fires deterministic projectiles on a cooldown. The "lakitu/hammer bro" of deterministic platformers.

Both must serialize cleanly into `LevelData` (editor integration), compile to a flat runtime state (game loop integration), and render with a thin renderer-adjacent helper (showcase integration). The API must NOT commit the library to a full combat/health system — this is about hazards and projectiles, not HP, damage numbers, or AI states.

## Approach A: Extend EntityKind + Flat Enemy Runtime

**Source pattern:** the reference `TrapHandler` registry (Pattern 1 from research — table-driven behavior dictionary), fused with the existing `EntityKind` discriminated union from `src/level/types.ts`.

**Core idea:** Add `'enemy'` as a new `EntityKind` variant with typed `EnemyProps`. Compile time converts level entities to flat `CompiledEnemy` runtime descriptors. Enemies and projectiles live in a global flat array in the level runtime. Behaviors are dispatched by a `behavior` string key in `EnemyProps`, looked up in a `Record<string, EnemyBehaviorHandler>` dictionary.

### Interface Sketches

```ts
// src/platformer/enemy/types.ts

/**
 * The behavioral archetype key. MVP ships two; consumers register custom
 * archetypes via `createEnemyBehaviorRegistry`.
 */
export type EnemyArchetype = 'spinny' | 'turret';

/**
 * Serialized enemy configuration — stored in LevelEntity.props.enemy
 * and surviving a JSON round-trip.
 */
export interface EnemyProps {
  /** Behavioral archetype dispatch key. */
  readonly archetype: EnemyArchetype | string;
  /** Patrol speed in px/s (spinny only). */
  readonly speed?: number;
  /** Optional waypoint path for patrol. */
  readonly patrolPath?: readonly { readonly x: number; readonly y: number }[];
  /** Waypoint cycle mode. */
  readonly patrolLoopMode?: 'loop' | 'pingpong';
  /** Reverse direction at platform edges (spinny only). */
  readonly ledgeTurnAround?: boolean;
  /** Shots per second (turret only). */
  readonly fireRate?: number;
  /** Projectile speed in px/s. */
  readonly projectileSpeed?: number;
  /** Projectile AABB size. */
  readonly projectileSize?: number;
  /** 'fixed' (constant direction) or 'aimed' (targets player). */
  readonly projectileType?: 'fixed' | 'aimed';
  /** Fixed firing direction vector (turret + fixed mode). */
  readonly aimDirection?: { readonly x: number; readonly y: number };
  /** Detection radius in px for aimed turrets. */
  readonly detectionRadius?: number;
  /** Color override for this enemy instance. */
  readonly color?: string;
}

/**
 * Runtime enemy state — immutable-in, immutable-out per tick.
 */
export interface EnemyState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly facing: 1 | -1;
  readonly behavior: string;
  readonly timers: Readonly<Record<string, number>>;
  readonly alive: boolean;
  /** Generic behavior-specific bag (serializable). */
  readonly data?: Readonly<Record<string, unknown>>;
}

/**
 * Result of stepping one enemy by dt.
 */
export interface EnemyStepResult {
  readonly state: EnemyState;
  readonly spawnedProjectiles: readonly ProjectileState[];
  readonly events: readonly string[];
}

/**
 * Behavior handler — pure function, deterministic, never throws.
 */
export type EnemyBehaviorHandler = (
  state: EnemyState,
  props: EnemyProps,
  ctx: EnemyUpdateContext,
) => EnemyStepResult;

/**
 * Read-only context for enemy update (player pos, solids, tick, dt).
 */
export interface EnemyUpdateContext {
  readonly playerX: number;
  readonly playerY: number;
  readonly playerWidth: number;
  readonly playerHeight: number;
  readonly solids: readonly import('../../collision/types').Solid[];
  readonly tileSize: number;
  readonly tick: number;
  readonly dt: number;
}
```

### Projectile Representation

```ts
// src/platformer/enemy/projectile.ts

/**
 * Projectile — kinematic AABB, constant velocity, deactivates on solid hit
 * or player overlap. Lives in a global flat array alongside enemies.
 */
export interface ProjectileState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly width: number;
  readonly height: number;
  readonly alive: boolean;
}

/**
 * Step one projectile: move, check solid collision, check player overlap.
 * Returns new state + hitPlayer flag.
 */
export function stepProjectile(
  p: ProjectileState,
  solids: readonly Solid[],
  playerRect: Rect | null,
  dt: number,
): { readonly projectile: ProjectileState; readonly hitPlayer: boolean };
```

### Serialized LevelData / Editor Catalog

```ts
// LevelEntity variant (added to src/level/types.ts)
| {
    readonly id: EntityId;
    readonly kind: 'enemy';
    readonly rect: LevelRect;
    readonly props: EnemyProps;
  }

// Editor catalog entry (added to src/editor/catalog.ts)
{
  kind: 'enemy',
  label: 'Enemy (Spinny)',
  defaultRect: { x: 0, y: 0, width: 16, height: 16 },
  defaultProps: {
    archetype: 'spinny',
    speed: 60,
    patrolPath: [],
    ledgeTurnAround: true,
    color: '#ff3a3a',
  } satisfies EnemyProps,
}
```

### Runtime Compile / Step

```ts
// src/platformer/enemy/compile.ts

/**
 * Compiled enemy — runtime state extracted from level entity.
 */
export interface CompiledEnemy {
  readonly entity: LevelEntity;           // back-ref for rendering
  readonly state: EnemyState;             // current tick state
  readonly props: EnemyProps;             // config
}

/**
 * Level → enemy runtime bridge. Extracts all 'enemy' entities,
 * compiles them to CompiledEnemy[], returns flat array.
 */
export function compileEnemies(level: LevelData): readonly CompiledEnemy[];

/**
 * Step all enemies by dt. Returns new enemies + accumulated projectiles.
 * Pure: never mutates input.
 */
export function stepEnemies(
  enemies: readonly CompiledEnemy[],
  registry: EnemyBehaviorRegistry,
  ctx: EnemyUpdateContext,
): {
  readonly enemies: readonly CompiledEnemy[];
  readonly projectiles: readonly ProjectileState[];
};
```

### Renderer Boundary

```ts
// src/platformer/enemy/renderer.ts

/**
 * Draw all enemies using outlineRect + procedural transforms.
 * Renderer-adjacent: may use Math.sin for spinny rotation, may
 * use ctx.rotate — these never leak back into the simulation.
 */
export function drawEnemies(
  ctx: CanvasRenderingContext2D,
  enemies: readonly CompiledEnemy[],
  tick: number,
  palette?: EnemyPalette,
): void;

/**
 * Draw all active projectiles as small outlined rects.
 */
export function drawProjectiles(
  ctx: CanvasRenderingContext2D,
  projectiles: readonly ProjectileState[],
): void;
```

### Behavior Registry

```ts
// src/platformer/enemy/registry.ts

export interface EnemyBehaviorRegistry {
  readonly handlers: Readonly<Record<string, EnemyBehaviorHandler>>;
}

/**
 * Create a registry from a dictionary of behavior handlers.
 * Ships with spinny + turret pre-registered.
 */
export function createEnemyBehaviorRegistry(
  custom?: Record<string, EnemyBehaviorHandler>,
): EnemyBehaviorRegistry;

/**
 * Built-in spinny patrol behavior.
 */
export const spinnyBehavior: EnemyBehaviorHandler;

/**
 * Built-in turret shooting behavior.
 */
export const turretBehavior: EnemyBehaviorHandler;
```

### Usage Example

```ts
import {
  compileLevel,
  stepPlatformer,
  compileEnemies,
  createEnemyBehaviorRegistry,
  stepEnemies,
  drawEnemies,
  drawProjectiles,
} from 'aicraft-engine/src/platformer';

const compiled = compileLevel(levelData);
const enemies = compileEnemies(levelData);
const registry = createEnemyBehaviorRegistry();

let enemyStates = enemies;
let projectiles: ProjectileState[] = [];

// Game loop tick:
function tick(dt: number) {
  // Step enemies
  const enemyResult = stepEnemies(enemyStates, registry, {
    playerX: state.core.x,
    playerY: state.core.y,
    playerWidth: state.core.width,
    playerHeight: state.core.height,
    solids: [...compiled.staticSolids, ...movingSolids],
    tileSize: levelData.tileSize,
    tick: state.tick,
    dt,
  });
  enemyStates = enemyResult.enemies;

  // Step projectiles
  projectiles = projectiles
    .map(p => stepProjectile(p, allSolids, playerRect, dt))
    .filter(r => r.projectile.alive);

  // Check player hit by contact enemy
  for (const e of enemyStates) {
    if (aabbOverlap(playerRect, e.state)) {
      // Player died from contact
    }
  }

  // Check player hit by projectile
  for (const r of projectiles) {
    if (r.hitPlayer) {
      // Player died from projectile
    }
  }
}

// Render:
function render(ctx, tick) {
  drawEnemies(ctx, enemyStates, tick);
  drawProjectiles(ctx, projectiles);
}
```

### Trade-offs

| Criterion | Assessment |
|---|---|
| **Ergonomics** | ★★★★☆ — `compileEnemies(level)` / `stepEnemies(enemies, registry, ctx)` mirrors the existing `compileLevel` / `stepPlatformer` pattern. The `EnemyUpdateContext` is verbose but typed — consumers never guess what to pass. |
| **Determinism** | ★★★★★ — All behavior handlers are pure functions of `(state, props, ctx)`. No `Math.random`, no `Date.now`, no DOM reads. Same inputs → byte-identical output. |
| **Runtime cost** | ★★★★★ — O(N) per enemy per tick + O(M) per projectile. Flat arrays, no allocations in hot path (spread-clone is ~6 fields). |
| **Consumer complexity** | ★★★★☆ — The consumer owns the game loop. The library provides compile/step/draw; the consumer orchestrates player-hit checks and death handling. No hidden side effects. |
| **Schema migration** | ★★★★☆ — Adding `'enemy'` to `EntityKind` is a non-breaking union expansion (the existing discriminated union already handles unknown kinds gracefully via `default` in switch). `EnemyProps` fields are all optional with documented defaults — forward-compatible. |
| **Public API stability** | ★★★★★ — The `EnemyBehaviorHandler` signature is the extensibility surface. Once shipped, new archetypes are additive (register new handlers). No breaking changes to shipped archetypes. |
| **What this makes easy** | Placing enemies in the editor. Custom enemy archetypes (register a handler). Deterministic replays. Serializing enemy state. |
| **What this makes hard** | Enemies with complex multi-phase AI (boss patterns). Enemies that interact with each other. Health/damage systems (out of scope for MVP — that's consumer-side). |

## Approach B: Enemy as Composition of Ability Processors

**Source pattern:** The existing `PlatformerKernel` composable ability pipeline (Pattern 2 from research — ability composition pattern from `docs/design/platformer-kernel-decision.md` Approach B). Each enemy is an `ActorCore` + `abilities: Record<string, EnemyAbilityState>` — the same shape as the player, just with different abilities.

**Core idea:** Enemies reuse the `ActorCore` shape (position, velocity, facing, contacts) and compose behaviors as `EnemyAbilityProcessor` instances — one for patrol, one for shoot, one for contact-kill. The kernel runs a pipeline per enemy per tick, exactly like the player kernel runs jump/wallSlide/dash abilities.

### Interface Sketches

```ts
// src/platformer/enemy/types.ts

/**
 * Enemy ability state — mirrors AbilityState from the player kernel.
 */
export interface EnemyAbilityState {
  readonly kind: string;
}

/**
 * Enemy ability processor — mirrors AbilityProcessor from the player kernel.
 */
export interface EnemyAbilityProcessor<TState extends EnemyAbilityState> {
  readonly kind: TState['kind'];
  advance(ctx: EnemyAbilityContext, state: TState): {
    readonly core: ActorCore;
    readonly state: TState;
    readonly spawnedProjectiles?: readonly ProjectileState[];
    readonly events?: readonly string[];
  };
}

/**
 * Read-only context for enemy abilities.
 */
export interface EnemyAbilityContext {
  readonly core: ActorCore;
  readonly props: EnemyProps;
  readonly playerX: number;
  readonly playerY: number;
  readonly solids: readonly Solid[];
  readonly tileSize: number;
  readonly tick: number;
  readonly dt: number;
}

/**
 * Full enemy state — same shape as PlatformerState, different abilities.
 */
export interface EnemyState {
  readonly core: ActorCore;
  readonly abilities: Readonly<Record<string, EnemyAbilityState>>;
  readonly alive: boolean;
  readonly tick: number;
}

/**
 * Enemy pipeline = array of ability processors, run in fixed order.
 */
export type EnemyPipeline = readonly EnemyAbilityProcessor<any>[];
```

### Pre-registered Abilities

```ts
// src/platformer/enemy/abilities/patrol-ability.ts
export const patrolAbility: EnemyAbilityProcessor<PatrolAbilityState>;

// src/platformer/enemy/abilities/ledge-turn-ability.ts
export const ledgeTurnAbility: EnemyAbilityProcessor<LedgeTurnAbilityState>;

// src/platformer/enemy/abilities/shoot-ability.ts
export const shootAbility: EnemyAbilityProcessor<ShootAbilityState>;

// src/platformer/enemy/abilities/contact-kill-ability.ts
export const contactKillAbility: EnemyAbilityProcessor<ContactKillAbilityState>;
```

### Usage Example

```ts
import {
  compileLevel,
  compileEnemies,
  createEnemyController,
  stepEnemies,
  drawEnemies,
} from 'aicraft-engine/src/platformer';

// Spinny enemy = patrol + ledgeTurn + contactKill
const spinnyPipeline = [patrolAbility, ledgeTurnAbility, contactKillAbility];

// Turret = patrol (optional) + shoot
const turretPipeline = [patrolAbility, shootAbility];

const spinnyController = createEnemyController(spinnyPipeline, DEFAULT_ENEMY_CONFIG);
const turretController = createEnemyController(turretPipeline, DEFAULT_ENEMY_CONFIG);

// Step:
const result = stepEnemies(enemies, { spinny: spinnyController, turret: turretController }, ctx);
```

### Trade-offs

| Criterion | Assessment |
|---|---|
| **Ergonomics** | ★★★☆☆ — Heavily mirrors the player kernel, which is good for consistency but bad for MVP simplicity. Composing a spinny enemy requires knowing which 3 abilities to combine. The player kernel's complexity (4 abilities, ~300 lines of types) is justified for a player controller; replicating it for enemies feels heavy. |
| **Determinism** | ★★★★★ — Same pure-processor guarantee as the player kernel. |
| **Runtime cost** | ★★★★☆ — Same O(N) per enemy, but more allocations per tick (each ability spreads its own core copy). 3 abilities × N enemies = 3 spreads per enemy per tick vs. 1 in Approach A. |
| **Consumer complexity** | ★★★☆☆ — The consumer must understand the ability pipeline pattern, register controllers per archetype, and compose pipelines. This is powerful but overkill for "place a spinning sawblade." |
| **Schema migration** | ★★★☆☆ — `EnemyProps` would need a `abilities: string[]` field instead of `archetype`, or the compile step must map archetypes to pipelines. More moving parts for the editor to expose. |
| **Public API stability** | ★★★★☆ — Adding new abilities is additive. But the `EnemyAbilityProcessor` interface is a large surface — any change to the context or result shape breaks all processors. |
| **What this makes easy** | Adding complex multi-phase behaviors (boss AI = pipeline of stateful abilities). Reusing player abilities on enemies (e.g., an enemy that can wall-slide). |
| **What this makes hard** | The MVP: "make a spinning sawblade that walks and kills on touch." This requires 3 ability processors, a controller, and a pipeline — overkill. |

## Approach C: Minimal Kinematic Enemies (No Registry, No Abilities)

**Source pattern:** the reference `moving-hazard.ts` — the simplest possible pattern. A flat `EnemyKind` string, a single `stepEnemy(state, props, ctx)` switch-dispatch, no registry, no pipeline. Enemies and projectiles live in `CompiledLevel` output.

**Core idea:** No extensibility layer at all. The library ships a single `stepEnemy` function with a `switch` on `archetype`. New archetypes require modifying the library. This is the absolute minimum to get enemies working in the showcase.

### Interface Sketches

```ts
// src/platformer/enemy/types.ts

export type EnemyArchetype = 'spinny' | 'turret';

export interface EnemyProps {
  readonly archetype: EnemyArchetype;
  readonly speed?: number;
  readonly patrolPath?: readonly { readonly x: number; readonly y: number }[];
  readonly patrolLoopMode?: 'loop' | 'pingpong';
  readonly ledgeTurnAround?: boolean;
  readonly fireRate?: number;
  readonly projectileSpeed?: number;
  readonly projectileSize?: number;
  readonly projectileType?: 'fixed' | 'aimed';
  readonly aimDirection?: { readonly x: number; readonly y: number };
  readonly detectionRadius?: number;
  readonly color?: string;
}

export interface EnemyState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly facing: 1 | -1;
  readonly timers: Readonly<Record<string, number>>;
  readonly alive: boolean;
  readonly data?: Readonly<Record<string, unknown>>;
}
```

### Step Function

```ts
// src/platformer/enemy/step.ts

/**
 * Step one enemy by dt. Dispatches on props.archetype via switch.
 * Pure: never mutates input, never throws.
 */
export function stepEnemy(
  state: EnemyState,
  props: EnemyProps,
  ctx: EnemyUpdateContext,
): {
  readonly state: EnemyState;
  readonly projectiles: readonly ProjectileState[];
};
```

### Usage Example

```ts
import { compileLevel, compileEnemies, stepEnemy } from 'aicraft-engine/src/platformer';

const compiled = compileLevel(levelData);
const enemies = compileEnemies(levelData);

function tick(dt: number) {
  const ctx = { playerX, playerY, solids, tileSize, tick, dt };
  const next = enemies.map(e =>
    e.state.alive ? stepEnemy(e.state, e.props, ctx) : { state: e.state, projectiles: [] }
  );
  // Merge results...
}
```

### Trade-offs

| Criterion | Assessment |
|---|---|
| **Ergonomics** | ★★★★★ — Absolute simplest. One function, one switch. No registry, no pipeline, no controller factory. The consumer calls `stepEnemy` and gets the result. |
| **Determinism** | ★★★★★ — Same pure-function guarantee. |
| **Runtime cost** | ★★★★★ — Minimal. One switch, one clone per enemy. No polymorphic dispatch overhead. |
| **Consumer complexity** | ★★★★★ — The consumer calls one function. No concept of registries, pipelines, or controllers. |
| **Schema migration** | ★★★★☆ — Same `EnemyProps` shape. Adding a new archetype to the `switch` is a non-breaking library update (the consumer's existing code compiles unchanged). |
| **Public API stability** | ★★☆☆☆ — Any new archetype requires modifying the library source. No consumer extensibility. The `EnemyArchetype` union is closed. This is the fundamental weakness: every new enemy type is a library release. |
| **What this makes easy** | The MVP: "place a spinning sawblade and a shooting turret in a level and they work." |
| **What this makes hard** | Consumer-defined enemy types (e.g., a bouncing slime, a teleporting ghost) require forking or modifying the library. The `switch` grows without bound as archetypes accumulate. |

## Comparison Table

| Criterion | A: Extend + Registry | B: Ability Pipeline | C: Minimal Switch |
|---|---|---|---|
| Ergonomics | ★★★★☆ | ★★★☆☆ | ★★★★★ |
| Determinism | ★★★★★ | ★★★★★ | ★★★★★ |
| Runtime cost | ★★★★★ | ★★★★☆ | ★★★★★ |
| Consumer complexity | ★★★★☆ | ★★★☆☆ | ★★★★★ |
| Schema migration | ★★★★☆ | ★★★☆☆ | ★★★★☆ |
| Public API stability | ★★★★★ | ★★★★☆ | ★★☆☆☆ |
| Extensibility | ★★★★★ | ★★★★★ | ★☆☆☆☆ |
| MVP speed | ★★★★☆ | ★★☆☆☆ | ★★★★★ |
| **Overall** | **30/35** | **24/35** | **26/35** |

## Recommendation

**Approach A: Extend EntityKind + Flat Enemy Runtime with Behavior Registry.**

Reasoning: It balances all constraints. The `EnemyBehaviorHandler` registry gives consumers infinite extensibility without the complexity of the ability-pipeline pattern. The `compileEnemies` / `stepEnemies` API mirrors the existing `compileLevel` / `stepPlatformer` pattern — consumer-game developers already know this shape. The `EnemyProps` discriminated union on `archetype` is the same pattern as `TrapProps.type` in the consumer game and `TriggerProps.action` in the level schema — proven, serializable, editor-friendly.

Approach C is tempting for its simplicity but blocks extensibility — every new enemy type would be a library release, which is unacceptable for a library that aims to serve multiple games. Approach B is over-engineered for the MVP; the ability-pipeline pattern is justified for a player controller (where the consumer composes dash/jump/wallSlide at runtime) but not for enemies (where the library ships the archetypes and consumers mostly configure them).

Approach A with the `EnemyBehaviorHandler` registry also aligns with the research note's Pattern 1 (Table-Driven Behavior Dictionary) and the reference implementation's existing `TrapHandler` pattern — both proven shapes that our first consumer already understands.

### What We're NOT Doing (Scope Guard)

- **No health/damage system.** Enemies are hazards — they kill on touch or projectile hit. The consumer decides what "death" means in their game.
- **No AI state machines.** The `behavior` string and `timers` bag are sufficient for MVP archetypes. Complex multi-phase AI (bosses) is deferred.
- **No enemy-on-enemy collision.** Enemies pass through each other. This is standard for minimalist platformers.
- **No gravity for enemies.** Spinny enemies use simple kinematic movement (constant velocity along a path). They don't fall or jump. Gravity-affected enemies are a future extension.
- **No damage numbers, knockback, or i-frames.** Those are consumer-side mechanics built on top of the library's projectile/contact events.

## Implementation Notes for @coder

1. **New files:** `src/platformer/enemy/types.ts`, `src/platformer/enemy/step.ts`, `src/platformer/enemy/projectile.ts`, `src/platformer/enemy/compile.ts`, `src/platformer/enemy/registry.ts`, `src/platformer/enemy/renderer.ts`, `src/platformer/enemy/index.ts`.
2. **Modified files:** `src/level/types.ts` (add `'enemy'` to `EntityKind` union + `EnemyProps` interface + `LevelEntity` variant), `src/editor/catalog.ts` (add enemy entries to `DEFAULT_CATALOG`), `src/platformer/index.ts` (re-export enemy module), `src/index.ts` (add `export * from './platformer/enemy'`).
3. **Level migration:** Adding `'enemy'` to `EntityKind` is a non-breaking union expansion. No level version bump needed. Existing levels with no `enemy` entities compile unchanged.
4. **Tests:** One test file per behavior (spinny, turret) + one for projectile stepping + one for compile. Use the existing vitest/node pattern.
5. **Renderer:** The `drawEnemies` function uses `ctx.rotate()` for spinny rotation (renderer-adjacent, may use `Math.sin`). The rotation angle is `tick * angularSpeed` — deterministic, computed on the fly, never stored in `EnemyState`.
6. **Projectile tunneling:** Cap projectile speed to `tileSize / dt` or implement sub-stepping. The research note recommends capping; sub-stepping is a v2 option.
7. **Ledge detection for spinny:** Use `worldToTile` from `src/collision/tiles.ts` to check the tile beneath the enemy's leading edge. Return `'empty'` = turn around.
8. **Player hit detection:** The consumer owns this. The library provides `stepProjectile` which returns `hitPlayer: boolean` and `CompiledEnemy` state — the consumer runs `aabbOverlap(playerRect, enemyRect)` in their own loop.

## Open Questions for @architect

1. **Should `EnemyProps.archetype` be a closed union (`'spinny' | 'turret'`) or a free string?** The proposal uses free string for extensibility, but a closed union gives stronger type safety and editor autocomplete. If free string, the registry approach is mandatory; if closed union, Approach C could work with type narrowing.

2. **Should `stepEnemies` return a global projectile pool, or should each enemy own its projectiles?** The research note recommends a global flat array (Pattern 2 — Kinematic Projectile Integration). This is simpler for rendering and collision but means projectiles must survive enemy death. The proposal uses a global pool — is this the right call?

3. **Should the enemy module live under `src/platformer/enemy/` (sub-module of platformer) or `src/enemy/` (top-level module)?** The proposal puts it under `src/platformer/` because enemies compose with the platformer kernel (they share `Solid`, `Rect`, `ActorCore`, `resolveAxisX/Y`). But a top-level `src/enemy/` would be more tree-shakeable if consumers want enemies without the player kernel.

4. **Should `CompiledEnemy` carry the full `LevelEntity` back-reference, or just the entity ID?** The proposal carries the full entity for rendering convenience. The alternative is `entityId: number` + a separate entity lookup, which is leaner but requires the consumer to maintain the mapping.

5. **Health system future-proofing:** Even though the MVP doesn't include HP, should `EnemyState` include a `health?: number` field so consumers can opt in without forking? The research note's `EnemyState` had no health; the reference `TrapHandler` also has no health. Adding it preemptively risks designing for a use case that hasn't materialized.
