# API Proposal: Enemy Archetype Catalog Extension

> Target pillar: 4 (Platformer / Level Loading / Editor). Module: `src/platformer/enemy/`.
> Builds on research: `docs/research/enemy-archetype-catalog.md`.
> Builds on prior decision: `docs/design/platformer-enemy-archetypes-decision.md` (Approach A shipped).
> Status: DRAFT.

## Executive Summary

This proposal extends the shipped `EnemyBehaviorRegistry` with 5 new archetypes (`charger`, `chaser`, `burster`, `flyer`, `crawler`) without breaking any existing consumer. The design questions are: (1) how to type per-archetype params, (2) how to decouple the growing renderer switch, (3) how to extend `EnemyUpdateContext` for line-of-sight and surface queries, (4) how to represent the burster's explosion without a combat system, and (5) how the editor catalog exposes new prefabs. Three approaches are proposed, ranging from minimal extension (A) to a per-archetype module structure (C). All three maintain zero breaking changes to the shipped API surface.

---

## Shipped Baseline (Do Not Break)

The following types and functions MUST remain unchanged in signature:

```ts
// src/platformer/enemy/types.ts
export type EnemyArchetype = 'spinny' | 'turret' | 'spider';
export interface EnemyBehaviorHandler {
  step(state: EnemyState, ctx: EnemyUpdateContext, params: Record<string, unknown>): EnemyStepResult;
}
export interface EnemyBehaviorRegistry {
  get(archetype: string): EnemyBehaviorHandler | undefined;
}

// src/platformer/enemy/registry.ts
export function createEnemyBehaviorRegistry(
  customHandlers?: Readonly<Record<string, EnemyBehaviorHandler>>,
): EnemyBehaviorRegistry;
```

```ts
// src/level/types.ts
export interface EnemyProps {
  readonly archetype: string;           // free string — MUST stay free
  readonly params: Record<string, unknown>;  // untyped bag — MUST stay untyped
}
```

The `EnemyProps.archetype` is a **free string**, not a union. The prior decision (§Answers to Open Questions, #1) explicitly chose this for extensibility. The `params` bag is `Record<string, unknown>`, matching `TrapProps.params`.

---

## New Primitives Required

Before the approaches, here are the primitives all approaches share. These are new exports that no existing approach uses, so they are additive-only.

### 1. Line-of-Sight Tile Raycast

```ts
// src/platformer/enemy/los.ts

/**
 * Check whether a straight line between two world-space points is
 * unobstructed by solid tiles. Uses DDA (Digital Differential Analyzer)
 * stepping through the tile grid.
 *
 * Determinism: pure function over plain data. No Math.random, no DOM.
 * Never throws (returns false on degenerate input).
 *
 * @param x1 - start world X
 * @param y1 - start world Y
 * @param x2 - end world X
 * @param y2 - end world Y
 * @param tileQuery - tile solidity query (returns 'solid' | 'passthrough' | 'empty')
 * @param tileSize - tile size in pixels
 * @returns true if the line is clear (no solid tiles block the path)
 */
export function checkLineOfSight(
  x1: number, y1: number,
  x2: number, y2: number,
  tileQuery: (tileX: number, tileY: number) => string,
  tileSize: number,
): boolean;
```

**Source pattern:** Research §1 (chaser) and §4 (charger) both require LOS. DDA is the standard grid-stepping raycast for tile-based games (Bresenham variant). Cost: O(max(|dx|, |dy|)) tile queries — bounded by level diagonal.

### 2. Surface-Hugging Stepper (Crawler)

```ts
// src/platformer/enemy/crawler-stepper.ts

/** Which side of the enemy is touching the solid surface. */
export type AttachmentSide = 'bottom' | 'left' | 'top' | 'right';

/**
 * Advance a crawler by one step along its current surface.
 * Queries tiles ahead, below, and diagonally to detect walls (inward corner)
 * and ledges (outward corner), rotating the attachment side and visual angle
 * by 90 degrees as needed.
 *
 * Determinism: pure function over plain data. No Math.random, no DOM.
 * Never throws.
 *
 * @param x - current world X (top-left of enemy hitbox)
 * @param y - current world Y (top-left of enemy hitbox)
 * @param crawlDir - 1 = clockwise, -1 = counter-clockwise around surface
 * @param speed - movement speed in px/s
 * @param dt - timestep in seconds
 * @param side - current attachment side
 * @param hitboxSize - enemy hitbox width/height (square)
 * @param tileQuery - tile solidity query
 * @param tileSize - tile size in pixels
 * @returns new position, updated attachment side, and visual angle in radians
 */
export function stepCrawler(
  x: number, y: number,
  crawlDir: 1 | -1,
  speed: number, dt: number,
  side: AttachmentSide,
  hitboxSize: number,
  tileQuery: (tileX: number, tileY: number) => string,
  tileSize: number,
): { x: number; y: number; side: AttachmentSide; angle: number };
```

**Source pattern:** Research §5 (crawler / Super Metroid Zoomer). The stepper translates 1D crawl displacement into 2D world-space based on `attachmentSide`, rotating 90 degrees at corners. No slopes — grid-aligned only.

### 3. `lifetime` on `ProjectileState`

The burster's explosion is a **zero-velocity projectile with a short lifetime**. This requires adding a `lifetime` field to `ProjectileState`:

```ts
// Addition to ProjectileState in src/platformer/enemy/types.ts
export interface ProjectileState {
  // ... existing fields ...
  /**
   * Remaining lifetime in seconds. When `> 0`, decremented by `dt` each
   * tick. Projectile deactivates when lifetime reaches 0. `undefined`
   * means no lifetime limit (legacy turrets).
   */
  readonly lifetime?: number;
}
```

This is a **non-breaking addition** — existing consumers that don't read `lifetime` are unaffected. The `stepProjectile` function gains a lifetime-decrement path (if `lifetime > 0` and `alive`, subtract `dt`; if `<= 0`, set `alive = false`). Zero-velocity projectiles with `lifetime` naturally represent the burster's explosion: `vx: 0, vy: 0, width: 32, height: 32, lifetime: 0.3`.

### 4. `projectiles` Array on `EnemyStepResult`

The burster may need to spawn an explosion projectile while the chaser doesn't. Current `EnemyStepResult` has `projectile?: ProjectileState` (singular). For multi-projectile futures (burster explosion + optional shrapnel), change to:

```ts
// src/platformer/enemy/types.ts
export interface EnemyStepResult {
  // ... existing fields ...
  /**
   * Projectile spawned this tick, or `undefined` if none.
   * @deprecated Use `projectiles` instead. Singular kept for backward compat.
   */
  readonly projectile?: ProjectileState;
  /**
   * All projectiles spawned this tick (may be 0, 1, or many).
   * Merged with `projectile` by `stepEnemies` for backward compat.
   */
  readonly projectiles?: readonly ProjectileState[];
}
```

**Backward compat:** `stepEnemies` checks both `result.projectile` and `result.projectiles`, merging them. Existing handlers that return only `projectile` continue to work. New handlers may use `projectiles` for multi-spawn.

### 5. Extended `EnemyUpdateContext`

New archetypes need tile-grid queries not currently on `EnemyUpdateContext`. Add optional fields:

```ts
// Additions to EnemyUpdateContext in src/platformer/enemy/types.ts
export interface EnemyUpdateContext {
  // ... existing fields (dt, solids, tileQuery, tileSize, playerRect) ...

  /**
   * Player's velocity this tick, or `null` if no player.
   * Used by chaser to predict player movement, by flyer to lead targets.
   */
  readonly playerVelocity?: { readonly vx: number; readonly vy: number } | null;

  /**
   * Current world tick count (monotonic integer, starting from 0).
   * Used for visual timing (flash frequency, shake phase).
   * NOT for simulation decisions — use `dt` for that.
   */
  readonly tick?: number;
}
```

**Why not `queryLineOfSight` on ctx?** The LOS function is stateless — it takes `tileQuery` and `tileSize` which are already on `ctx`. Keeping it as a standalone function (`checkLineOfSight`) avoids closure allocation per tick and is more composable (consumers can call it for non-enemy purposes). Same rationale as `worldToTile` being standalone.

---

## Approach A: Minimal Extension (Registry-Only Growth)

**Source pattern:** The existing shipped pattern — `spinnyBehavior` and `turretBehavior` in `registry.ts`. Each archetype is a handler object exported from `registry.ts`. The renderer has a switch. The catalog has prefab entries.

### Signature Sketch

```ts
// src/platformer/enemy/types.ts — NO CHANGES to handler shape
export interface EnemyBehaviorHandler {
  step(state: EnemyState, ctx: EnemyUpdateContext, params: Record<string, unknown>): EnemyStepResult;
}

// src/platformer/enemy/registry.ts — add 5 new built-in handlers
export const chargerBehavior: EnemyBehaviorHandler = { step(state, ctx, params) { ... } };
export const chaserBehavior: EnemyBehaviorHandler = { step(state, ctx, params) { ... } };
export const bursterBehavior: EnemyBehaviorHandler = { step(state, ctx, params) { ... } };
export const flyerBehavior: EnemyBehaviorHandler = { step(state, ctx, params) { ... } };
export const crawlerBehavior: EnemyBehaviorHandler = { step(state, ctx, params) { ... } };

// Built-in handlers dict grows:
const BUILT_IN_HANDLERS: Readonly<Record<string, EnemyBehaviorHandler>> = {
  spinny: spinnyBehavior,
  turret: turretBehavior,
  spider: spiderBehavior,
  charger: chargerBehavior,
  chaser: chaserBehavior,
  burster: bursterBehavior,
  flyer: flyerBehavior,
  crawler: crawlerBehavior,
};

// src/platformer/enemy/renderer.ts — switch grows:
export function drawEnemies(ctx, enemies, tick, palette?) {
  for (const enemy of enemies) {
    if (enemy.archetype === 'spinny') { /* ... */ }
    else if (enemy.archetype === 'turret') { /* ... */ }
    else if (enemy.archetype === 'spider') { /* ... */ }
    else if (enemy.archetype === 'charger') { /* new */ }
    else if (enemy.archetype === 'chaser') { /* new */ }
    else if (enemy.archetype === 'burster') { /* new */ }
    else if (enemy.archetype === 'flyer') { /* new */ }
    else if (enemy.archetype === 'crawler') { /* new */ }
    else { /* fallback: outlined rect */ }
  }
}

// src/editor/catalog.ts — add prefab entries:
const DEFAULT_CATALOG: EntityCatalog = {
  entries: {
    // ... existing entries ...
    charger: {
      kind: 'enemy',
      label: 'Charger Enemy',
      defaultRect: { x: 0, y: 0, width: 16, height: 16 },
      defaultProps: { archetype: 'charger', params: {
        speed: 40, windupDuration: 0.5, dashSpeed: 300,
        dashMaxDistance: 128, recoveryDuration: 0.8,
        detectionRadius: 160, losBlocked: false,
      }},
    },
    chaser: {
      kind: 'enemy',
      label: 'Chaser Enemy',
      defaultRect: { x: 0, y: 0, width: 16, height: 16 },
      defaultProps: { archetype: 'chaser', params: {
        patrolSpeed: 50, chaseSpeed: 90,
        detectionRadius: 160, lostTimer: 2.0,
        ledgeTurnAround: true,
      }},
    },
    burster: {
      kind: 'enemy',
      label: 'Burster Enemy',
      defaultRect: { x: 0, y: 0, width: 16, height: 16 },
      defaultProps: { archetype: 'burster', params: {
        seekSpeed: 60, fuseDuration: 0.6,
        explosionRadius: 32, explosionLifetime: 0.3,
        detectionRadius: 200, proximityThreshold: 32,
      }},
    },
    flyer: {
      kind: 'enemy',
      label: 'Flyer Enemy',
      defaultRect: { x: 0, y: 0, width: 16, height: 16 },
      defaultProps: { archetype: 'flyer', params: {
        patrolSpeed: 40, seekSpeed: 70,
        sineAmplitude: 20, sineFrequency: 2,
        detectionRadius: 160,
      }},
    },
    crawler: {
      kind: 'enemy',
      label: 'Crawler Enemy',
      defaultRect: { x: 0, y: 0, width: 16, height: 16 },
      defaultProps: { archetype: 'crawler', params: {
        speed: 30, crawlDir: 1,
      }},
    },
  },
};
```

### Usage Example

```ts
import { createEnemyBehaviorRegistry, compileEnemies, stepEnemies, drawEnemies } from 'aicraft-engine/src/platformer/enemy';
import { stepProjectile } from 'aicraft-engine/src/platformer/enemy/projectile';
import { checkLineOfSight } from 'aicraft-engine/src/platformer/enemy/los';
import { stepCrawler } from 'aicraft-engine/src/platformer/enemy/crawler-stepper';

// Create registry with all 8 built-in archetypes (no custom needed)
const registry = createEnemyBehaviorRegistry();

// Compile level
const enemies = compileEnemies(levelData);

// Step enemies
const result = stepEnemies(enemies, registry, {
  dt: 1 / 60,
  solids,
  tileQuery,
  tileSize: 16,
  playerRect: player ? { x: player.x, y: player.y, width: 16, height: 24 } : null,
});

// Step projectiles (including burster explosions)
for (const p of result.projectiles) {
  stepProjectile(p, 1 / 60, solids, playerRect);
}

// Render
drawEnemies(ctx, result.enemies, tick);
```

### Trade-offs

| Dimension | Assessment |
|---|---|
| **Ergonomics** | ★★★★ — Same pattern as shipped 3. Consumers already know it. Params are untyped (same as turret). |
| **Determinism** | ★★★★★ — Pure handler functions, same pattern. |
| **Runtime cost** | ★★★★★ — No additional indirection. Handler + renderer switch are both O(1). |
| **Consumer complexity** | ★★★ — Params require runtime type checking inside each handler (already the pattern). No type safety on param shapes. |
| **Extensibility (6th archetype)** | ★★★ — Add one handler to registry, one case to renderer switch, one catalog entry. Three files to touch. |
| **Level-schema migration** | ★★★★★ — Zero changes. `archetype` stays free string, `params` stays `Record<string, unknown>`. |
| **Editor-catalog ergonomics** | ★★★ — Catalog entries are plain objects. Param editor requires consumer to build per-archetype form (same as trap `ParamSchema` pattern in Spitekeep). |

**What this makes easy:**
- Adding the 5 new archetypes (just add handlers + switch cases + catalog entries).
- Consumer override (custom handlers still override built-in via `createEnemyBehaviorRegistry`).

**What this makes hard:**
- No compile-time param safety — typos in param keys are silent.
- The `renderer.ts` switch grows by 5 cases (total 8 + fallback).
- No param schema for the editor — consumer must build per-archetype param forms manually.
- Adding a 6th archetype later requires touching 3 separate files (registry, renderer, catalog).

---

## Approach B: Typed Metadata Registry

**Source pattern:** Spitekeep's `TrapSchema` / `TRAP_SCHEMAS` pattern (`src/dev/editor/param-schemas.ts`). Each trap type has a declarative schema describing its params with labels, types, defaults, and bounds. The editor reads the schema to auto-generate param forms. We lift this pattern into the enemy system.

### Signature Sketch

```ts
// src/platformer/enemy/types.ts — add metadata types (additive)

/**
 * Describes a single editable parameter for an archetype.
 * Mirrors `ParamSchema` from Spitekeep's trap system.
 */
export interface ArchetypeParamSchema {
  /** Param key in `EnemyProps.params`. */
  readonly name: string;
  /** Widget type for the editor. */
  readonly type: 'number' | 'boolean' | 'enum' | 'pointArray';
  /** Human-readable label. */
  readonly label: string;
  /** Default value. */
  readonly default: number | boolean | string | readonly { readonly x: number; readonly y: number }[];
  /** Numeric bounds (number params). */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Allowed values (enum params). */
  readonly enumValues?: readonly string[];
  /** Help text. */
  readonly description?: string;
}

/**
 * Metadata for an archetype: param schema + display name + default params.
 * Carried on the registry, NOT on the handler (clean separation of
 * runtime behavior from editor metadata).
 */
export interface ArchetypeMetadata {
  /** Human-facing label (e.g. "Charger Enemy"). */
  readonly label: string;
  /** Param schema for the editor form generator. */
  readonly paramSchema: readonly ArchetypeParamSchema[];
  /** Default params for catalog prefab placement. */
  readonly defaultParams: Record<string, unknown>;
  /** Default hitbox size (width and height in px). */
  readonly defaultSize: number;
  /** Palette fill color for the default renderer. */
  readonly defaultColor: string;
}

// Handler interface — UNCHANGED
export interface EnemyBehaviorHandler {
  step(state: EnemyState, ctx: EnemyUpdateContext, params: Record<string, unknown>): EnemyStepResult;
}

// Extended registry — adds metadata lookup
export interface EnemyBehaviorRegistry {
  get(archetype: string): EnemyBehaviorHandler | undefined;
  /** Get metadata for a registered archetype, or undefined. */
  getMetadata(archetype: string): ArchetypeMetadata | undefined;
  /** Get all registered archetype names. */
  keys(): readonly string[];
}
```

```ts
// src/platformer/enemy/registry.ts — registry carries metadata

/** Metadata for all built-in archetypes. */
const BUILT_IN_METADATA: Readonly<Record<string, ArchetypeMetadata>> = {
  spinny: {
    label: 'Spinny Enemy',
    paramSchema: [
      { name: 'speed', type: 'number', label: 'Speed (px/s)', default: 60, min: 0, step: 1 },
      { name: 'ledgeTurnAround', type: 'boolean', label: 'Ledge Turn', default: false },
      { name: 'patrolPath', type: 'pointArray', label: 'Patrol Path', default: [] },
    ],
    defaultParams: { speed: 60, ledgeTurnAround: true, patrolPath: [{ x: 0, y: 0 }, { x: 48, y: 0 }] },
    defaultSize: 16,
    defaultColor: '#ff3a3a',
  },
  // ... existing 3 + new 5, all with paramSchema ...
  charger: {
    label: 'Charger Enemy',
    paramSchema: [
      { name: 'speed', type: 'number', label: 'Patrol Speed (px/s)', default: 40, min: 0, step: 1 },
      { name: 'windupDuration', type: 'number', label: 'Windup (s)', default: 0.5, min: 0, step: 0.1 },
      { name: 'dashSpeed', type: 'number', label: 'Dash Speed (px/s)', default: 300, min: 0, step: 10 },
      { name: 'dashMaxDistance', type: 'number', label: 'Max Dash (px)', default: 128, min: 16, step: 16 },
      { name: 'recoveryDuration', type: 'number', label: 'Recovery (s)', default: 0.8, min: 0, step: 0.1 },
      { name: 'detectionRadius', type: 'number', label: 'Detect Radius (px)', default: 160, min: 16, step: 16 },
    ],
    defaultParams: { speed: 40, windupDuration: 0.5, dashSpeed: 300, dashMaxDistance: 128, recoveryDuration: 0.8, detectionRadius: 160 },
    defaultSize: 16,
    defaultColor: '#ff2222',
  },
  // ... chaser, burster, flyer, crawler similarly ...
};

export function createEnemyBehaviorRegistry(
  customHandlers?: Readonly<Record<string, EnemyBehaviorHandler>>,
  customMetadata?: Readonly<Record<string, ArchetypeMetadata>>,
): EnemyBehaviorRegistry {
  const merged = { ...BUILT_IN_HANDLERS, ...customHandlers };
  const meta = { ...BUILT_IN_METADATA, ...customMetadata };
  return {
    get(archetype: string) { return merged[archetype]; },
    getMetadata(archetype: string) { return meta[archetype]; },
    keys() { return Object.keys(merged); },
  };
}
```

```ts
// src/editor/catalog.ts — catalog reads metadata from registry
// Consumer builds catalog from registry metadata:
function buildCatalogFromRegistry(registry: EnemyBehaviorRegistry): EntityCatalog {
  const entries: Record<string, CatalogEntry> = {};
  for (const name of registry.keys()) {
    const meta = registry.getMetadata(name);
    if (!meta) continue;
    entries[name] = {
      kind: 'enemy',
      label: meta.label,
      defaultRect: { x: 0, y: 0, width: meta.defaultSize, height: meta.defaultSize },
      defaultProps: { archetype: name, params: { ...meta.defaultParams } },
    };
  }
  return { entries };
}
```

### Renderer Approach

Same as Approach A — the renderer switch grows. Alternatively, the renderer can read `registry.getMetadata(archetype)` for the `defaultColor` and use a generic shape (outlined rect + color) for unknown archetypes, falling back to per-archetype special rendering only for the 8 built-ins. This reduces the switch to 8 cases but doesn't eliminate it.

### Usage Example

```ts
import { createEnemyBehaviorRegistry, compileEnemies, stepEnemies, drawEnemies } from 'aicraft-engine/src/platformer/enemy';

// Registry with metadata
const registry = createEnemyBehaviorRegistry();

// Editor uses metadata to build param forms
const meta = registry.getMetadata('charger');
if (meta) {
  // meta.paramSchema drives the form generator
  // meta.defaultParams seeds the catalog entry
}

// Compile and step — same as Approach A
const enemies = compileEnemies(levelData);
const result = stepEnemies(enemies, registry, ctx);
drawEnemies(ctx, result.enemies, tick);
```

### Trade-offs

| Dimension | Assessment |
|---|---|
| **Ergonomics** | ★★★★ — Same handler ergonomics. Metadata is opt-in (read from registry when needed). |
| **Determinism** | ★★★★★ — Metadata is static data, never read by step functions. |
| **Runtime cost** | ★★★★★ — Metadata lookup is O(1). No per-tick cost. |
| **Consumer complexity** | ★★★★ — Param schema auto-generates editor forms (huge UX win). `createEnemyBehaviorRegistry` gains optional 2nd arg (non-breaking). |
| **Extensibility (6th archetype)** | ★★★★ — Add handler + metadata. Renderer switch still grows, but metadata makes catalog self-service. |
| **Level-schema migration** | ★★★★★ — Zero changes. |
| **Editor-catalog ergonomics** | ★★★★★ — Metadata provides labels, defaults, types, bounds. Consumer can auto-generate forms without hand-coding per-archetype schemas. |

**What this makes easy:**
- Editor integration: `getMetadata()` returns everything the form generator needs.
- Adding new archetypes: handler + metadata object in one place.
- Consumer override: `createEnemyBehaviorRegistry(customHandlers, customMetadata)` — consumers can override both behavior and metadata.

**What this makes hard:**
- The `EnemyBehaviorRegistry` interface gains new methods (`getMetadata`, `keys`). This is **additive** (existing consumers that only call `get()` are unaffected), but it is a visible API surface expansion.
- The renderer switch still grows.
- Metadata is decoupled from the handler — a consumer could register a handler without metadata, and vice versa. The registry validates on creation but there's no compile-time guarantee.

---

## Approach C: Per-Archetype Modules + Discriminated Union (Module Augmentation)

**Source pattern:** The `src/character/` proposal (character-body-plans-proposal.md) uses a `BodyPlanHandler<TConfig, TState>` generic handler with a registry that maps plan names to handlers. Each body plan lives in its own subdirectory. We apply the same module-organization principle to enemies, but keep the existing handler interface unchanged for backward compat.

### Key Innovation: Module Augmentation for Type-Safe Archetype Union

```ts
// src/platformer/enemy/types.ts

/**
 * Built-in enemy archetype identifiers. Consumers may register additional
 * archetypes via `createEnemyBehaviorRegistry` — the type is a free string
 * for extensibility, but these eight are the shipped built-ins.
 *
 * Consumers can extend this union via module augmentation:
 *
 * ```ts
 * declare module 'aicraft-engine/src/platformer/enemy/types' {
 *   interface EnemyArchetype { 'myCustom': never }
 * }
 * ```
 */
export type EnemyArchetype = 'spinny' | 'turret' | 'spider'
  | 'charger' | 'chaser' | 'burster' | 'flyer' | 'crawler';
```

This lets consumers narrow the type for their own game while keeping the library's `string` for external consumers. The union is open (module augmentation), not closed.

### File Layout

```
src/platformer/enemy/
├── types.ts              # EnemyArchetype union, handler types (extended)
├── registry.ts           # Built-in handlers + createEnemyBehaviorRegistry
├── compile.ts            # compileEnemies, stepEnemies
├── renderer.ts           # drawEnemies, drawProjectiles (registry-driven)
├── projectile.ts         # stepProjectile (with lifetime)
├── los.ts                # NEW: checkLineOfSight
├── crawler-stepper.ts    # NEW: stepCrawler, AttachmentSide
├── param-schemas.ts      # NEW: built-in archetype param schemas
├── index.ts              # Barrel export
└── archetypes/           # NEW: per-archetype modules
    ├── charger.ts        # chargerBehavior + ChargerParams type
    ├── chaser.ts         # chaserBehavior + ChaserParams type
    ├── burster.ts        # bursterBehavior + BursterParams type
    ├── flyer.ts          # flyerBehavior + FlyerParams type
    └── crawler.ts        # crawlerBehavior + CrawlerParams type
```

### Signature Sketch

```ts
// src/platformer/enemy/archetypes/charger.ts

/** Typed params for the charger archetype. */
export interface ChargerParams {
  /** Patrol speed in px/s. */
  readonly speed?: number;
  /** Windup duration in seconds before dash. */
  readonly windupDuration?: number;
  /** Dash speed in px/s. */
  readonly dashSpeed?: number;
  /** Maximum dash distance in pixels. */
  readonly dashMaxDistance?: number;
  /** Recovery (stun) duration in seconds after dash. */
  readonly recoveryDuration?: number;
  /** Detection radius in pixels for player LOS check. */
  readonly detectionRadius?: number;
}

/** Internal data bag shape for charger state machine phases. */
interface ChargerData {
  phase: 'patrol' | 'windup' | 'dash' | 'recovery';
  windupTimer: number;
  recoveryTimer: number;
  dashDir: 1 | -1;
  dashDistance: number;
}

/** Default charger params. */
const DEFAULTS: Required<ChargerParams> = {
  speed: 40,
  windupDuration: 0.5,
  dashSpeed: 300,
  dashMaxDistance: 128,
  recoveryDuration: 0.8,
  detectionRadius: 160,
};

function resolveParams(raw: Record<string, unknown>): Required<ChargerParams> {
  return {
    speed: typeof raw.speed === 'number' && Number.isFinite(raw.speed) ? raw.speed : DEFAULTS.speed,
    windupDuration: typeof raw.windupDuration === 'number' ? raw.windupDuration : DEFAULTS.windupDuration,
    dashSpeed: typeof raw.dashSpeed === 'number' ? raw.dashSpeed : DEFAULTS.dashSpeed,
    dashMaxDistance: typeof raw.dashMaxDistance === 'number' ? raw.dashMaxDistance : DEFAULTS.dashMaxDistance,
    recoveryDuration: typeof raw.recoveryDuration === 'number' ? raw.recoveryDuration : DEFAULTS.recoveryDuration,
    detectionRadius: typeof raw.detectionRadius === 'number' ? raw.detectionRadius : DEFAULTS.detectionRadius,
  };
}

export const chargerBehavior: EnemyBehaviorHandler = {
  step(state, ctx, params) {
    const p = resolveParams(params);
    const data = (state.data.phase ? state.data : { phase: 'patrol', windupTimer: 0, recoveryTimer: 0, dashDir: state.facing, dashDistance: 0 }) as unknown as ChargerData;

    switch (data.phase) {
      case 'patrol': {
        // ... patrol logic using p.speed, ctx.solids, ctx.tileQuery ...
        // Check LOS to player using checkLineOfSight
        if (ctx.playerRect && ctx.tileQuery && ctx.tileSize > 0) {
          const pcx = ctx.playerRect.x + ctx.playerRect.width / 2;
          const pcy = ctx.playerRect.y + ctx.playerRect.height / 2;
          const ecx = state.x + 8;
          const ecy = state.y + 8;
          const dist = Math.hypot(pcx - ecx, pcy - ecy);
          if (dist <= p.detectionRadius && checkLineOfSight(ecx, ecy, pcx, pcy, ctx.tileQuery, ctx.tileSize)) {
            // Transition to windup
            const dir = pcx > ecx ? 1 : -1;
            return { ...state, facing: dir, data: { ...data, phase: 'windup', windupTimer: p.windupDuration, dashDir: dir } };
          }
        }
        // ... normal patrol movement ...
        return { x, y, vx: 0, vy: 0, facing: state.facing, alive: state.alive, data };
      }
      case 'windup': {
        // ... timer countdown, visual flash via data ...
        if (data.windupTimer <= 0) {
          return { ...state, data: { ...data, phase: 'dash', dashDistance: 0 } };
        }
        return { ...state, data: { ...data, windupTimer: data.windupTimer - ctx.dt } };
      }
      case 'dash': {
        // ... high-speed movement, wall collision check ...
        // If hit wall or max distance → recovery
        return { ...state, data: { ...data, phase: 'recovery', recoveryTimer: p.recoveryDuration } };
      }
      case 'recovery': {
        // ... stun timer, no movement ...
        if (data.recoveryTimer <= 0) {
          return { ...state, data: { ...data, phase: 'patrol' } };
        }
        return { ...state, data: { ...data, recoveryTimer: data.recoveryTimer - ctx.dt } };
      }
    }
  },
};
```

```ts
// src/platformer/enemy/archetypes/burster.ts

/** Typed params for the burster archetype. */
export interface BursterParams {
  readonly seekSpeed?: number;
  readonly fuseDuration?: number;
  readonly explosionRadius?: number;
  readonly explosionLifetime?: number;
  readonly detectionRadius?: number;
  readonly proximityThreshold?: number;
}

export const bursterBehavior: EnemyBehaviorHandler = {
  step(state, ctx, params) {
    const p = resolveParams(params);
    const data = state.data as unknown as BursterData;

    switch (data.phase) {
      case 'seek': {
        // Move toward player. If within proximityThreshold → fuse
        if (ctx.playerRect) {
          const dist = Math.hypot(
            (ctx.playerRect.x + ctx.playerRect.width / 2) - (state.x + 8),
            (ctx.playerRect.y + ctx.playerRect.height / 2) - (state.y + 8),
          );
          if (dist <= p.proximityThreshold) {
            return {
              ...state,
              data: { ...data, phase: 'fuse', fuseTimer: p.fuseDuration },
            };
          }
        }
        // ... move toward player ...
        return { x, y, vx, vy, facing: state.facing, alive: true, data };
      }
      case 'fuse': {
        const remaining = data.fuseTimer - ctx.dt;
        if (remaining <= 0) {
          // SPWN EXPLOSION: zero-velocity projectile with lifetime
          const r = p.explosionRadius;
          const explosion: ProjectileState = {
            x: state.x + 8 - r,
            y: state.y + 8 - r,
            vx: 0, vy: 0,
            width: r * 2, height: r * 2,
            alive: true,
            lifetime: p.explosionLifetime,
          };
          return {
            ...state, alive: false,
            data: { ...data, phase: 'exploded', fuseTimer: 0 },
            projectiles: [explosion],
          };
        }
        return { ...state, data: { ...data, fuseTimer: remaining } };
      }
      case 'exploded':
        return { ...state, alive: false, data };
    }
  },
};
```

```ts
// src/platformer/enemy/archetypes/crawler.ts

/** Typed params for the crawler archetype. */
export interface CrawlerParams {
  readonly speed?: number;
  readonly crawlDir?: 1 | -1;
}

export const crawlerBehavior: EnemyBehaviorHandler = {
  step(state, ctx, params) {
    const p = resolveParams(params);
    const data = state.data as unknown as CrawlerData;

    // Delegate movement to the surface-hugging stepper
    if (ctx.tileQuery && ctx.tileSize > 0) {
      const result = stepCrawler(
        state.x, state.y,
        p.crawlDir, p.speed, ctx.dt,
        data.attachmentSide, 16,
        ctx.tileQuery, ctx.tileSize,
      );
      return {
        x: result.x, y: result.y,
        vx: 0, vy: 0,
        facing: state.facing,
        alive: state.alive,
        data: { ...data, attachmentSide: result.side, angle: result.angle },
      };
    }
    // Fallback: patrol on floor (same as spinny)
    return spinnyBehavior.step(state, ctx, params);
  },
};
```

```ts
// src/platformer/enemy/renderer.ts — REGISTRY-DRIVEN (eliminates the switch)

/**
 * Per-archetype draw function. Each built-in registers here.
 * Consumers can add custom draw functions via the registry.
 */
type ArchetypeDrawFn = (
  ctx: CanvasRenderingContext2D,
  enemy: CompiledEnemy,
  tick: number,
  palette: EnemyPalette,
) => void;

const DRAW_REGISTRY: Record<string, ArchetypeDrawFn> = {
  spinny: drawSpinny,
  turret: drawTurret,
  spider: drawSpiderEnemy,
  charger: drawCharger,
  chaser: drawChaser,
  burster: drawBurster,
  flyer: drawFlyer,
  crawler: drawCrawler,
};

export function drawEnemies(ctx, enemies, tick, palette?) {
  const pal = { ...DEFAULT_ENEMY_PALETTE, ...(palette ?? {}) };
  for (const enemy of enemies) {
    if (!enemy || !enemy.state.alive) continue;
    const drawFn = DRAW_REGISTRY[enemy.archetype];
    if (drawFn) {
      drawFn(ctx, enemy, tick, pal);
    } else {
      // Fallback: outlined rect
      outlineRect(ctx, enemy.state.x, enemy.state.y, 16, 16, pal.default, DEFAULT_OUTLINE_COLOR);
    }
  }
}
```

### Usage Example

```ts
import { createEnemyBehaviorRegistry, compileEnemies, stepEnemies, drawEnemies } from 'aicraft-engine/src/platformer/enemy';
import { chargerBehavior } from 'aicraft-engine/src/platformer/enemy/archetypes/charger';
import { bursterBehavior } from 'aicraft-engine/src/platformer/enemy/archetypes/burster';

// Built-in registry includes all 8 (charger etc. pre-registered)
const registry = createEnemyBehaviorRegistry();

// Consumer can override or add:
const customRegistry = createEnemyBehaviorRegistry({
  charger: { step: (state, ctx, params) => {
    // Custom charger with extra behavior
    return chargerBehavior.step(state, ctx, { ...params, dashSpeed: 500 });
  }},
});

// Compile, step, render — same consumer code
const enemies = compileEnemies(levelData);
const result = stepEnemies(enemies, registry, {
  dt: 1 / 60,
  solids,
  tileQuery,
  tileSize: 16,
  playerRect,
  tick: currentTick,
});

// Step projectiles (burster explosions included)
for (const p of result.projectiles) {
  stepProjectile(p, 1 / 60, solids, playerRect);
}

// Render — drawEnemies is now registry-driven, no switch
drawEnemies(ctx, result.enemies, tick);
```

### Trade-offs

| Dimension | Assessment |
|---|---|
| **Ergonomics** | ★★★★★ — Per-archetype files with typed params. `resolveParams` provides type safety at the handler level. Renderer is registry-driven (no switch). |
| **Determinism** | ★★★★★ — Same pure handler pattern. Metadata is static. |
| **Runtime cost** | ★★★★ — One extra `DRAW_REGISTRY` lookup per enemy per tick (O(1) hash). Negligible. |
| **Consumer complexity** | ★★★★★ — Per-archetype files are self-contained (handler + params type + defaults). Editor metadata in `param-schemas.ts`. |
| **Extensibility (6th archetype)** | ★★★★★ — Add one file to `archetypes/`, register in `BUILT_IN_HANDLERS` + `DRAW_REGISTRY`. Two touch points, both in the registry module. |
| **Level-schema migration** | ★★★★★ — Zero changes. Free string + Record. |
| **Editor-catalog ergonomics** | ★★★★★ — `param-schemas.ts` provides full schema. Module augmentation lets consumers type their own archetypes. |

**What this makes easy:**
- Adding a 6th archetype: one file + two registry entries.
- Per-archetype param types: `ChargerParams`, `BursterParams` etc. are importable.
- Renderer extensibility: `DRAW_REGISTRY` is open — consumers can add draw functions.
- The editor form generator reads `param-schemas.ts` directly (same pattern as Spitekeep's `TRAP_SCHEMAS`).

**What this makes hard:**
- More files to create initially (5 archetype files + `los.ts` + `crawler-stepper.ts` + `param-schemas.ts`).
- The `DRAW_REGISTRY` in `renderer.ts` must be kept in sync with `BUILT_IN_HANDLERS` in `registry.ts` — but they live in the same module, so this is a local concern.
- Module augmentation for `EnemyArchetype` requires consumers to write a `declare module` block — advanced TypeScript feature.

---

## Comparison Table

| Criterion | A: Minimal | B: Metadata Registry | C: Per-Archetype Modules |
|---|---|---|---|
| **Ergonomics** | ★★★★ | ★★★★ | ★★★★★ |
| **Determinism** | ★★★★★ | ★★★★★ | ★★★★★ |
| **Runtime cost** | ★★★★★ | ★★★★★ | ★★★★ |
| **Consumer complexity** | ★★★ | ★★★★ | ★★★★★ |
| **Extensibility** | ★★★ | ★★★★ | ★★★★★ |
| **Level-schema migration** | ★★★★★ | ★★★★★ | ★★★★★ |
| **Editor-catalog ergonomics** | ★★★ | ★★★★★ | ★★★★★ |
| **Initial implementation cost** | Low (1 file + switch) | Medium (metadata layer) | Medium (5 files + registry) |
| **Public API surface change** | Minimal | Additive (getMetadata, keys) | Additive (DRAW_REGISTRY, param types) |
| **Backward compat risk** | None | Very low (additive methods) | None (handler shape unchanged) |

---

## Recommendation

**Approach C: Per-Archetype Modules + Registry-Driven Renderer.**

Rationale: The research identified 5 archetypes with complex state machines (charger has 4 phases, burster has 3, crawler has continuous rotation). Each archetype benefits from its own file with typed params and dedicated constants. The renderer switch is the most fragile part of Approach A — it's already 3 cases and would grow to 8. Approach C's `DRAW_REGISTRY` eliminates this fragility by making rendering extensible at registration time, not at compile time.

Approach B's metadata layer is valuable but orthogonal — it can be added on top of Approach C as a follow-up (the `param-schemas.ts` file serves the same purpose without modifying the registry interface). Approach C captures 80% of B's editor ergonomics through the standalone `param-schemas.ts` without expanding the `EnemyBehaviorRegistry` interface.

The per-archetype file structure also composes cleanly with Phase 3 (telegraph system): each archetype's state machine already has named phases (`windup`, `dash`, `recovery` for charger; `seek`, `fuse`, `exploded` for burster) that map directly to `TelegraphPhase`. The `draw` functions in `DRAW_REGISTRY` can be extended to accept a `TelegraphState` overlay in Phase 3 without rewriting the renderer.

---

## Concrete Answers to Research Open Questions

### 1. How does `burster`'s explosion work without a combat system?

**Zero-velocity projectile with lifetime.** The burster's `step` handler returns `alive: false` and a `ProjectileState` with `vx: 0, vy: 0, width: 32, height: 32, lifetime: 0.3`. The consumer's existing `stepProjectile` pipeline detects player overlap via `aabbOverlap`. On the tick the burster dies, the explosion projectile is alive and overlapping — the consumer registers the hit. After `0.3s`, `lifetime` expires and the projectile deactivates. No new systems needed.

The `lifetime` field on `ProjectileState` is the minimal addition: ~5 lines in `stepProjectile` (decrement `lifetime` by `dt`, deactivate if `<= 0`). Zero-velocity means no tunneling concern.

### 2. How is line-of-sight detection exposed for chaser/charger?

**Standalone `checkLineOfSight` function in `src/platformer/enemy/los.ts`.** DDA tile-grid raycast between two world-space points. Takes `tileQuery` and `tileSize` (both already on `EnemyUpdateContext`). Not on `ctx` as a method — same rationale as `worldToTile` being a standalone function: no closure allocation, composable, testable independently.

Usage in chaser:
```ts
const hasLOS = ctx.tileQuery && ctx.tileSize > 0
  ? checkLineOfSight(ecx, ecy, pcx, pcy, ctx.tileQuery, ctx.tileSize)
  : true; // no tile grid → assume visible
```

### 3. How does `crawler` query wall/ceiling attachment?

**Standalone `stepCrawler` function in `src/platformer/enemy/crawler-stepper.ts`.** Takes current position, `attachmentSide`, `crawlDir`, `speed`, `dt`, `hitboxSize`, `tileQuery`, `tileSize`. Returns new position, updated `attachmentSide`, and visual `angle`.

The stepper checks 3 tiles per tick:
1. **Ahead** (in crawl direction): if solid → inward corner → rotate `attachmentSide` 90°.
2. **Below** (relative to `attachmentSide`): if empty → outward corner → rotate `attachmentSide` 90°.
3. **Ahead-below diagonal**: for smooth corner transitions.

No slopes — grid-aligned 90° only. This matches Super Metroid's Zoomer behavior (research §5).

### 4. Does adding these 5 archetypes require ANY changes to existing types/files?

**Minimal, additive-only changes:**

| File | Change | Breaking? |
|---|---|---|
| `src/platformer/enemy/types.ts` | Add `lifetime?: number` to `ProjectileState`. Add `projectiles?: readonly ProjectileState[]` to `EnemyStepResult`. Add `playerVelocity?` and `tick?` to `EnemyUpdateContext`. Extend `EnemyArchetype` union (still a free string at runtime). | No — all additive optional fields |
| `src/platformer/enemy/registry.ts` | Add 5 new handler exports + register in `BUILT_IN_HANDLERS`. | No — additive |
| `src/platformer/enemy/compile.ts` | Merge `result.projectile` + `result.projectiles` in `stepEnemies`. | No — backward compat path |
| `src/platformer/enemy/projectile.ts` | Add lifetime decrement in `stepProjectile`. | No — `lifetime` is optional; undefined = no-op |
| `src/platformer/enemy/renderer.ts` | Replace switch with `DRAW_REGISTRY` lookup (Approach C) or add 5 cases (Approach A). | No — internal refactor |
| `src/platformer/enemy/index.ts` | Export new symbols (`checkLineOfSight`, `stepCrawler`, param types, archetype behaviors). | No — additive |
| `src/editor/catalog.ts` | Add 5 prefab entries to `DEFAULT_CATALOG`. | No — additive |
| `src/level/types.ts` | **NO CHANGES.** `EnemyProps.archetype: string` stays free. `EnemyProps.params: Record<string, unknown>` stays untyped. | N/A |

---

## Migration Impact Assessment

**Zero breaking changes.** Every change is additive:
- New optional fields on existing interfaces (`lifetime`, `projectiles`, `playerVelocity`, `tick`).
- New exports (behaviors, helpers, types).
- New catalog entries.
- Existing consumer code that calls `createEnemyBehaviorRegistry()` without arguments gets the 5 new built-ins for free.
- Existing levels with `archetype: 'spinny'` continue to work identically.
- `EnemyProps.archetype` stays `string` — no version bump, no schema migration.

---

## Open Questions for @architect

1. **`DRAW_REGISTRY` vs. renderer switch:** Approach C proposes replacing the `if/else if` chain in `drawEnemies` with a `Record<string, ArchetypeDrawFn>` registry. Is this safe? The registry lookup is O(1) hash vs. O(N) string comparison — strictly faster for N ≥ 3. But it changes the renderer's internal dispatch mechanism. Should we keep the switch for simplicity and defer the registry to a later PR?

2. **`lifetime` on `ProjectileState`:** The burster's explosion uses `lifetime` to auto-deactivate. Should `lifetime` also apply to turret projectiles (replacing the current `maxRange` logic)? Or should `lifetime` be a separate concept (time-based) from `maxRange` (distance-based)? Recommendation: keep them separate — `maxRange` is spatial (distance traveled), `lifetime` is temporal (ticks remaining). Both can coexist.

3. **`projectiles` array on `EnemyStepResult`:** The current singular `projectile?` is well-established. Adding `projectiles?` creates two paths. Should we deprecate `projectile?` immediately, or keep both indefinitely? Recommendation: keep both, with `stepEnemies` merging them. No deprecation in v1.

4. **`stepCrawler` as standalone vs. on `EnemyUpdateContext`:** The crawler's surface-hugging logic is ~80 lines. Should it live in its own file (`crawler-stepper.ts`) or be a method on the context? Standalone is more composable (consumers could use it for non-enemy crawling); context method is more discoverable. Recommendation: standalone.

5. **`checkLineOfSight` complexity:** DDA is ~40 lines. Should it live in `src/platformer/enemy/los.ts` (enemy-specific) or `src/collision/tiles.ts` (general collision utility)? If other systems need LOS (e.g., future traps, player abilities), `src/collision/` is better. Recommendation: `src/collision/los.ts` for maximum composability, re-exported from `src/platformer/enemy/index.ts` for convenience.

6. **Renderer palette extension:** Each new archetype needs a default color in `EnemyPalette`. Should `EnemyPalette` gain per-archetype optional fields (`charger?: string`, `chaser?: string`, etc.)? Or should colors be on the `ArchetypeMetadata` (Approach B)? Recommendation: add to `EnemyPalette` for Approach A/C (renderer needs it); defer metadata to Approach B follow-up.

---

## Files Modified (Summary)

| Approach | New Files | Modified Files | Deleted Files |
|---|---|---|---|
| **A: Minimal** | `los.ts`, `crawler-stepper.ts` | `types.ts`, `registry.ts`, `compile.ts`, `projectile.ts`, `renderer.ts`, `index.ts`, `catalog.ts` | None |
| **B: Metadata** | `los.ts`, `crawler-stepper.ts` | `types.ts`, `registry.ts`, `compile.ts`, `projectile.ts`, `renderer.ts`, `index.ts`, `catalog.ts` | None |
| **C: Per-Archetype** | `los.ts`, `crawler-stepper.ts`, `archetypes/charger.ts`, `archetypes/chaser.ts`, `archetypes/burster.ts`, `archetypes/flyer.ts`, `archetypes/crawler.ts`, `param-schemas.ts` | `types.ts`, `registry.ts`, `compile.ts`, `projectile.ts`, `renderer.ts`, `index.ts`, `catalog.ts` | None |
