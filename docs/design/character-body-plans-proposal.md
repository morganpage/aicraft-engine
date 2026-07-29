# API Proposal: Character Body-Plan Catalog

> Target pillar: 1 (Animation / Primitives). Module: `src/character/`.
> Builds on research: `docs/research/character-body-plans.md`.
> Status: HISTORICAL DESIGN INPUT — active validation is limited to the
> humanoid plan by `post-0.4-character-enemy-validation-plan.md`. No body-plan
> API is approved until that plan's Phase 10 architecture review.

## Active validation contract

The older alternatives below are retained for design history. The validation
spike uses a visual-only humanoid contract:

- `CharacterBodyFrame` supplies consumer-owned `x`, `y`, `width`, `height`, and
  `facing`; `src/character/` never imports from `src/platformer/`.
- `HumanoidVisualState` contains only evolving presentation state. It contains
  no position, velocity, `JumpState`, or copy of `HumanoidConfig`.
- `HumanoidMotionSample` is assembled by the consumer from platformer core and
  event data, including `supported`, `gravityDirection`, and
  `verticalVelocity`.
- `advanceHumanoidVisual(config, state, motion, dt)` advances gait only through
  `advanceLocomotionByDisplacement`.
- `drawHumanoid(ctx, body, config, state, tick, options?)` receives immutable
  configuration explicitly; `options?.lookTarget` replaces the old bare
  `look` argument.
- Direct humanoid exports are the required fallback if a heterogeneous registry
  cannot be proven without consumer-facing casts or fake index signatures.
- Floater, serpentine, and slime migration remain deferred research candidates.

All npm examples for a shipping API import from `'aicraft-engine'`. Relative
`./lib/aicraft-engine/src/...` examples below describe git-submodule consumers
only.

## Executive Summary

The library currently ships exactly one player character body plan (slime-knight) as showcase-local code in `showcase/helpers/slime-knight.ts`. Consumers wanting a humanoid biped, floater/drone, or serpentine character have no library-level starting point. This proposal designs the abstraction layer so consumers can pick a body plan, seed a variant, step animation deterministically, and render with Canvas2D. Three approaches are evaluated: per-plan modules (mirroring the spider pattern), a discriminated-union dispatcher, and a registry pattern (mirroring the enemy behavior registry). Each body plan has fundamentally different state topology (humanoid = bone rig + IK limbs; floater = hover oscillator + spring tentacles; serpentine = multi-segment chain), making a forced generic `CharacterState` union undesirable. The recommendation is **Approach C (Registry)** with a lightweight `BodyPlanHandler` interface that encapsulates per-plan state, step, and draw — the same shape as `EnemyBehaviorHandler` — providing maximum extensibility while respecting each plan's unique physics.

---

## Consumer Need

- **Spitekeep (IMP - Not a Troll)**: Currently renders the slime-knight hero from showcase-local code. A platformer with a humanoid knight protagonist needs a humanoid biped body plan. Flying hazard enemies need a floater. Worm/snake bosses need serpentine.
- **Future Clone-to-Jest siblings**: Card-based village builders, procedural RTSs, idle gardens — all need distinct character archetypes beyond the blob slime.
- **Without this**: Each consumer hand-builds body plans from raw primitives (exactly what `showcase/helpers/slime-knight.ts` does today — 2200 lines of bespoke rendering). This is the antipattern the library exists to prevent.

---

## Approach A: Per-Plan Modules (Spider Pattern)

**Source pattern:** `src/animation/spider/` — the shipped spider body plan is a self-contained module with its own state (`SpiderState`), step function (`stepSpider`), pose evaluator (`evaluateSpiderPose`), renderer (`drawSpider`), config types (`SpiderConfig`), and constants (`DEFAULT_SPIDER`). Each plan gets its own subdirectory under `src/character/`.

**Signature sketch:**

```ts
// src/character/slime/types.ts
export interface SlimeConfig {
  readonly seed: number;
  readonly palette: Palette;
  readonly bodyWidth: number;
  readonly bodyHeight: number;
  readonly eyeRadius: number;
  readonly gaitConfig: GaitConfig;
  readonly boneLengths: { thigh: number; shin: number };
  readonly antennaSegments: number;
  readonly antennaSegmentLength: number;
  readonly springConfig: SpringConfig;
  readonly breathConfig: BreathConfig;
  speed: number;
}

export interface SlimeFrameState {
  readonly config: SlimeConfig;
  locomotion: LocomotionState;
  antenna: VerletNode[];
  jump: JumpState;
  x: number;
  facing: 1 | -1;
  eyeCount: 1 | 2;
  idleSettle: number;
}

// src/character/slime/slime.ts
export function deriveSlimeConfig(seed: number): SlimeConfig;
export function createSlimeFrameState(config: SlimeConfig): SlimeFrameState;
export function stepSlime(state: SlimeFrameState, dt: number, inputs?: SlimeInputs): SlimeFrameState;
export function drawSlime(ctx: CanvasRenderingContext2D, state: SlimeFrameState, tick: number, look?: Vec2): void;

// src/character/humanoid/types.ts
export interface HumanoidConfig {
  readonly seed: number;
  readonly palette: Palette;
  readonly torsoWidth: number;
  readonly torsoHeight: number;
  readonly headRadius: number;
  readonly armSegments: number;
  readonly legSegments: number;
  readonly gaitConfig: GaitConfig;
  readonly breathConfig: BreathConfig;
  speed: number;
}

export interface HumanoidFrameState {
  readonly config: HumanoidConfig;
  locomotion: LocomotionState;
  jump: JumpState;
  armSwingPhase: number;
  x: number;
  facing: 1 | -1;
}

// src/character/humanoid/humanoid.ts
export function deriveHumanoidConfig(seed: number): HumanoidConfig;
export function createHumanoidFrameState(config: HumanoidConfig): HumanoidFrameState;
export function stepHumanoid(state: HumanoidFrameState, dt: number, inputs?: HumanoidInputs): HumanoidFrameState;
export function drawHumanoid(ctx: CanvasRenderingContext2D, state: HumanoidFrameState, tick: number, look?: Vec2): void;

// src/character/floater/types.ts — analogous
// src/character/floater/floater.ts — analogous
// src/character/serpentine/types.ts — analogous
// src/character/serpentine/serpentine.ts — analogous

// src/character/index.ts — barrel re-exports everything
```

**Usage example:**

```ts
import { deriveHumanoidConfig, createHumanoidFrameState, stepHumanoid, drawHumanoid } from './lib/aicraft-engine/src/character';
import { deriveSlimeConfig, createSlimeFrameState, stepSlime, drawSlime } from './lib/aicraft-engine/src/character';

// Create configs from seeds
const knightConfig = deriveHumanoidConfig(42);
const slimeConfig = deriveSlimeConfig(99);

// Create frame states
let knightState = createHumanoidFrameState(knightConfig);
let slimeState = createSlimeFrameState(slimeConfig);

// Game loop
function step(dt: number) {
  knightState = stepHumanoid(knightState, dt, { walkDx: 2, facing: 1 });
  slimeState = stepSlime(slimeState, dt, { walkDx: -1, facing: -1 });
}

function render(ctx: CanvasRenderingContext2D, tick: number) {
  ctx.save();
  ctx.translate(100, 200);
  drawHumanoid(ctx, knightState, tick);
  ctx.restore();

  ctx.save();
  ctx.translate(250, 200);
  drawSlime(ctx, slimeState, tick);
  ctx.restore();
}
```

**Trade-offs:**

- **Ergonomics:** ★★★★★ — Each plan has purpose-built types and functions. Consumers import exactly the plan they need. No union gymnastics. Each `deriveXxxConfig` and `stepXxx` reads like English.
- **Determinism:** ★★★★★ — Each plan owns its own state shape; no shared mutable state. Same `(seed, dt, inputs)` → identical output by construction.
- **Runtime cost:** ★★★★★ — No dispatch overhead. No union narrowing. Direct function calls.
- **Consumer complexity:** ★★★☆☆ — Consumer must import from 4 separate modules and use different function names per plan. Switching body plans at runtime requires a plan-keyed dispatch on the consumer side.
- **Extensibility:** ★★★★☆ — Adding a 5th plan means adding a new subdirectory + barrel re-export. No existing code changes. But the consumer's dispatch table grows.
- **Cosmetics-pillar composition:** ★★★★★ — Each plan can define its own palette mapping strategy internally. `HumanoidConfig` can include helmet/weapon slots; `FloaterConfig` can include tentacle color. No need to shoehorn into a generic 5-slot palette contract.
- **Convention fit:** ★★★★★ — Mirrors the spider pattern exactly (`src/animation/spider/`). Same file layout, same `types.ts` + implementation + constants split.

**What this makes easy:**
- Adding body-plan-specific state (humanoid arm IK targets, serpentine segment chain, floater tentacle arrays)
- Rendering each plan with bespoke Canvas2D code tuned for its silhouette
- Tree-shaking: import only the plans you use
- Testing each plan in isolation

**What this makes hard:**
- Writing generic code that operates on "any character" (no shared `CharacterState` type to iterate over)
- Consumer-side dispatch: switching body plans requires a runtime switch/if-else on the plan name
- The showcase's "draw all plans side-by-side" benchmark requires importing each plan separately

---

## Approach B: Discriminated Union + Dispatch

**Source pattern:** Roadmap's API hypothesis (`type BodyPlan = 'slime' | 'humanoid' | 'floater' | 'serpentine'`), combined with the spider's `SpiderConfig.mode` discriminator pattern. One `CharacterConfig` union, one `deriveCharacterConfig`, one `stepCharacter`, one `drawCharacter`.

**Signature sketch:**

```ts
// src/character/types.ts
export type BodyPlan = 'slime' | 'humanoid' | 'floater' | 'serpentine';

/** Shared fields present on every body plan config. */
interface CharacterConfigBase {
  readonly seed: number;
  readonly palette: Palette;
  readonly plan: BodyPlan;
  speed: number;
}

/** Per-plan config variants. */
export interface SlimeCharacterConfig extends CharacterConfigBase {
  readonly plan: 'slime';
  readonly bodyWidth: number;
  readonly bodyHeight: number;
  readonly eyeRadius: number;
  readonly boneLengths: { thigh: number; shin: number };
  readonly antennaSegments: number;
  readonly antennaSegmentLength: number;
  readonly gaitConfig: GaitConfig;
  readonly springConfig: SpringConfig;
  readonly breathConfig: BreathConfig;
}

export interface HumanoidCharacterConfig extends CharacterConfigBase {
  readonly plan: 'humanoid';
  readonly torsoWidth: number;
  readonly torsoHeight: number;
  readonly headRadius: number;
  readonly gaitConfig: GaitConfig;
  readonly breathConfig: BreathConfig;
  // ... plan-specific fields
}

export interface FloaterCharacterConfig extends CharacterConfigBase {
  readonly plan: 'floater';
  readonly coreRadius: number;
  readonly tentacleCount: number;
  readonly tentacleSegments: number;
  readonly hoverAmplitude: number;
  readonly hoverFrequency: number;
  // ... plan-specific fields
}

export interface SerpentineCharacterConfig extends CharacterConfigBase {
  readonly plan: 'serpentine';
  readonly segmentCount: number;
  readonly headRadius: number;
  readonly tailRadius: number;
  readonly segmentSpacing: number;
  // ... plan-specific fields
}

export type CharacterConfig =
  | SlimeCharacterConfig
  | HumanoidCharacterConfig
  | FloaterCharacterConfig
  | SerpentineCharacterConfig;

/** Shared frame-state base. */
interface CharacterFrameStateBase {
  readonly config: CharacterConfig;
  x: number;
  facing: 1 | -1;
}

export interface SlimeFrameState extends CharacterFrameStateBase {
  readonly config: SlimeCharacterConfig;
  locomotion: LocomotionState;
  antenna: VerletNode[];
  jump: JumpState;
  eyeCount: 1 | 2;
  idleSettle: number;
}

// ... analogous per-plan frame state variants ...

export type CharacterFrameState =
  | SlimeFrameState
  | HumanoidFrameState
  | FloaterFrameState
  | SerpentineFrameState;

// src/character/dispatch.ts
export function deriveCharacterConfig(seed: number, plan: BodyPlan): CharacterConfig;
export function createCharacterFrameState(config: CharacterConfig): CharacterFrameState;
export function stepCharacter(state: CharacterFrameState, dt: number, inputs?: CharacterInputs): CharacterFrameState;
export function drawCharacter(ctx: CanvasRenderingContext2D, state: CharacterFrameState, tick: number, look?: Vec2): void;
```

**Usage example:**

```ts
import {
  type BodyPlan,
  deriveCharacterConfig,
  createCharacterFrameState,
  stepCharacter,
  drawCharacter,
} from './lib/aicraft-engine/src/character';

// Pick a plan
const plans: BodyPlan[] = ['humanoid', 'slime', 'floater', 'serpentine'];
const characters = plans.map((plan, i) => {
  const config = deriveCharacterConfig(42 + i * 1000, plan);
  return { state: createCharacterFrameState(config), plan };
});

// Game loop
function step(dt: number) {
  for (const c of characters) {
    c.state = stepCharacter(c.state, dt, { walkDx: 1, facing: 1 });
  }
}

function render(ctx: CanvasRenderingContext2D, tick: number) {
  characters.forEach((c, i) => {
    ctx.save();
    ctx.translate(80 + i * 80, 200);
    drawCharacter(ctx, c.state, tick);
    ctx.restore();
  });
}
```

**Trade-offs:**

- **Ergonomics:** ★★★★☆ — Single import, single API surface. But consumers must narrow the union to access plan-specific fields (e.g., `if (config.plan === 'slime') config.antennaSegments`). The `deriveCharacterConfig(seed, plan)` call is cleaner than 4 separate `deriveXxxConfig` functions.
- **Determinism:** ★★★★☆ — Dispatch is deterministic (switch on string). But the shared `CharacterFrameStateBase` with mutable `x`, `facing` fields creates a tempting surface for accidental mutation across plans.
- **Runtime cost:** ★★★☆☆ — Internal switch/dispatch on every `stepCharacter` and `drawCharacter` call. Branch prediction mitigates this in practice, but it's unnecessary overhead when the consumer already knows the plan.
- **Consumer complexity:** ★★★★☆ — One API to learn. But plan-specific inputs (humanoid arm targets, floater tilt override) require widening the `CharacterInputs` union with optional fields that only apply to certain plans — a footgun for type safety.
- **Extensibility:** ★★★☆☆ — Adding a 5th plan requires modifying `BodyPlan` union, `CharacterConfig` union, `CharacterFrameState` union, AND the switch statements in `stepCharacter`/`drawCharacter`. This is a **breaking change** to the union types (consumers' exhaustive switches break). Library version bump required.
- **Cosmetics-pillar composition:** ★★★☆☆ — The 5-slot `Palette` works for slime and humanoid but may not map cleanly to floater (tentacle colors) or serpentine (segment gradient). The union must include plan-specific palette extensions, complicating the type.
- **Convention fit:** ★★★☆☆ — No existing library pattern uses a large discriminated union for rendering dispatch. The enemy registry uses free strings + handler objects, not a closed union.

**What this makes easy:**
- Writing generic code that iterates over "all characters" (common `CharacterFrameState` shape)
- The benchmark "draw all plans side-by-side" scene
- Consumer learning: one API, one import

**What this makes hard:**
- Adding new body plans (requires touching the union + switch statements in the library)
- Plan-specific inputs (arm IK targets for humanoid, tilt override for floater) bloat the shared input type
- Type narrowing at every call site when plan-specific behavior is needed
- Testing: every plan's step/draw must be tested through the dispatch layer, not independently

---

## Approach C: Registry Pattern (Enemy Registry Mirror)

**Source pattern:** `src/platformer/enemy/registry.ts` — `createEnemyBehaviorRegistry({ spinny, turret, spider })` with `get(archetype)` lookup. The `EnemyBehaviorHandler` interface has a single `step(state, ctx, params)` method. Adapted for characters: a `BodyPlanHandler` with `deriveConfig`, `createFrameState`, `step`, and `draw` methods, registered by plan name.

**Signature sketch:**

```ts
// src/character/types.ts
export type BodyPlanName = string;

/** Static config produced from a seed + plan name. Opaque to the dispatch layer. */
export type CharacterConfig = Readonly<Record<string, unknown>>;

/** Per-frame mutable state. Opaque to the dispatch layer. */
export type CharacterFrameState = Readonly<Record<string, unknown>>;

/** Per-tick inputs. Shared base + plan-specific extensions via the bag. */
export interface CharacterInputs {
  readonly walkDx?: number;
  readonly facing?: 1 | -1;
  readonly jumpPressed?: boolean;
  readonly jumpHeld?: boolean;
  /** Plan-specific input extensions (e.g., armTarget, tiltOverride). */
  readonly [key: string]: unknown;
}

/**
 * A body-plan handler encapsulating all plan-specific logic.
 * The dispatch layer calls these methods; it never inspects the config or state.
 */
export interface BodyPlanHandler<
  TConfig,
  TState,
  TMotion,
> {
  /** Derive a complete config from a seed. Same seed → same config forever. */
  deriveConfig(seed: number): TConfig;
  /** Create initial frame state from a config. */
  createVisualState(config: TConfig): TState;
  /** Advance state by one fixed timestep. Pure: returns new state. */
  advanceVisual(config: TConfig, state: TState, motion: TMotion, dt: number): TState;
  /** Render the character. Renderer-adjacent: takes ctx, may have side effects. */
  draw(
    ctx: CanvasRenderingContext2D,
    body: CharacterBodyFrame,
    config: TConfig,
    state: TState,
    tick: number,
    options?: CharacterDrawOptions,
  ): void;
}

/**
 * Registry mapping plan names to their handlers.
 */
export interface BodyPlanRegistry {
  get(plan: string): BodyPlanHandler | undefined;
}

// src/character/registry.ts
export function createBodyPlanRegistry(
  customPlans?: Readonly<Record<string, BodyPlanHandler>>,
): BodyPlanRegistry;

// Built-in plans (shipped, each in its own subdirectory):
//   'slime'      → src/character/slime/slime-handler.ts
//   'humanoid'   → src/character/humanoid/humanoid-handler.ts
//   'floater'    → src/character/floater/floater-handler.ts
//   'serpentine' → src/character/serpentine/serpentine-handler.ts
```

**Usage example:**

```ts
import { createBodyPlanRegistry } from './lib/aicraft-engine/src/character';

// Create registry with built-ins + any custom plans
const registry = createBodyPlanRegistry();

// Look up handlers
const humanoid = registry.get('humanoid')!;
const floater = registry.get('floater')!;

// Derive configs from seeds
const knightCfg = humanoid.deriveConfig(42);
const droneCfg = floater.deriveConfig(99);

// Create frame states
let knightState = humanoid.createFrameState(knightCfg);
let droneState = floater.createFrameState(droneCfg);

// Game loop
function step(dt: number) {
  knightState = humanoid.step(knightState, dt, { walkDx: 2, facing: 1 });
  droneState = floater.step(droneState, dt, { walkDx: 0 });
}

function render(ctx: CanvasRenderingContext2D, tick: number) {
  ctx.save();
  ctx.translate(100, 200);
  humanoid.draw(ctx, knightState, tick);
  ctx.restore();

  ctx.save();
  ctx.translate(250, 200);
  floater.draw(ctx, droneState, tick);
  ctx.restore();
}

// Consumer can add their own plans:
const customRegistry = createBodyPlanRegistry({
  'quadruped': {
    deriveConfig: (seed) => { /* ... */ },
    createFrameState: (config) => { /* ... */ },
    step: (state, dt, inputs) => { /* ... */ },
    draw: (ctx, state, tick) => { /* ... */ },
  },
});
```

**Trade-offs:**

- **Ergonomics:** ★★★★☆ — Consumer calls `registry.get('humanoid')` then `.deriveConfig(seed)`. Two lookups, but the handler object groups all plan-specific operations. The generic type parameters (`TConfig`, `TState`) give consumers type safety when they know the plan at compile time.
- **Determinism:** ★★★★★ — Each handler is a self-contained module with its own state shape. No shared mutable state. The registry is just a string→handler map with no logic.
- **Runtime cost:** ★★★★☆ — One hash-map lookup per `registry.get()` call (O(1)). No switch dispatch. The generic type parameters are erased at runtime — no boxing overhead.
- **Consumer complexity:** ★★★★★ — Consumer learns one interface (`BodyPlanHandler`) and one factory (`createBodyPlanRegistry`). Adding a custom plan requires implementing 4 methods, not modifying the library. The registry pattern is already familiar from `createEnemyBehaviorRegistry`.
- **Extensibility:** ★★★★★ — Adding a 5th built-in plan: add a subdirectory + handler + register in `BUILT_IN_HANDLERS`. No union types break. Consumer custom plans: implement `BodyPlanHandler`, pass to `createBodyPlanRegistry`. **Zero breaking changes.**
- **Cosmetics-pillar composition:** ★★★★★ — Each handler's `TConfig` can include whatever palette structure the plan needs. Slime uses 5-slot `Palette`; humanoid could add weapon/helmet color slots; floater could add tentacle color. The registry layer doesn't impose any palette contract.
- **Convention fit:** ★★★★★ — Mirrors `createEnemyBehaviorRegistry` exactly. Same factory shape, same `get()` lookup, same built-in + custom merge pattern. The library already has this as a proven extensibility model.

**What this makes easy:**
- Adding new body plans (library or consumer) without breaking existing code
- Swapping body plans at runtime (just look up a different handler)
- Composing with the enemy registry (enemies could use `BodyPlanHandler` for rendering)
- Type safety via generic parameters when the plan is known at compile time

**What this makes hard:**
- Generic iteration over "all characters" (no shared state type for `for (const c of characters) drawCharacter(c)` — the consumer must keep handler+state pairs)
- The `CharacterFrameState` base type is `Record<string, unknown>` — type-unsafe when accessed through the registry without narrowing

---

## Comparison Table

| Criterion | A: Per-Plan Modules | B: Discriminated Union | C: Registry |
|---|---|---|---|
| **Ergonomics** | ★★★★★ Purpose-built per plan | ★★★★ One API, but union narrowing | ★★★★ Handler lookup, generic types |
| **Determinism** | ★★★★★ Isolated by construction | ★★★★ Shared base fields | ★★★★★ Isolated by construction |
| **Runtime cost** | ★★★★★ Direct calls | ★★★☆ Switch dispatch | ★★★★ Hash lookup (O(1)) |
| **Consumer complexity** | ★★★☆ Multiple imports, consumer dispatch | ★★★★ Single API | ★★★★★ One interface, one factory |
| **Extensibility (5th plan)** | ★★★★ Add subdir, no breaks | ★★★☆ Union + switch change (breaking) | ★★★★★ Add handler, no breaks |
| **Cosmetics composition** | ★★★★★ Per-plan palette | ★★★☆ Union must accommodate all | ★★★★★ Per-handler palette |
| **Convention fit** | ★★★★★ Matches spider | ★★★☆ No precedent | ★★★★★ Matches enemy registry |
| **Tree-shake-ability** | ★★★★★ Import only used plans | ★★★☆ Entire dispatch module imported | ★★★★★ Import only used handlers |

---

## Recommendation

**Approach C (Registry)** — recommended for `@architect` review.

**Rationale:** The registry pattern is the only approach that satisfies all seven trade-off dimensions simultaneously. It mirrors the existing `createEnemyBehaviorRegistry` (the library's proven extensibility model), provides zero-breaking-change extensibility for both library and consumer plans, and respects each body plan's fundamentally different state topology through generic type parameters. The ergonomic cost (handler lookup before use) is minimal and matches the pattern consumers already learn from the enemy system.

Approach A (per-plan modules) is the second-best choice — it matches the spider pattern and has excellent ergonomics for consumers who only use 1-2 plans. The main weakness is that generic iteration over heterogeneous characters requires consumer-side dispatch, which the registry also requires but handles more elegantly.

Approach B (discriminated union) is rejected because adding body plans requires modifying the closed union (a breaking change), and the shared `CharacterFrameStateBase` with mutable `x`/`facing` fields creates a false sense of type uniformity across plans with fundamentally different state shapes.

---

## Migration Impact Assessment

### Existing slime-knight surface

The current slime-knight lives entirely in `showcase/helpers/slime-knight.ts` — it is **not** a library export. The following exports are showcase-local:

- `deriveHeroConfig(seed)` → becomes `registry.get('slime')!.deriveConfig(seed)` (renamed)
- `createHeroFrameState(config)` → becomes `registry.get('slime')!.createFrameState(config)`
- `stepHero(state, dt, inputs?)` → becomes `registry.get('slime')!.step(state, dt, inputs)`
- `drawSlimeKnight(ctx, state, tick, look?, options?)` → becomes `registry.get('slime')!.draw(ctx, state, tick, look?)`
- `HeroConfig` → becomes `SlimeConfig` (type alias in `src/character/slime/types.ts`)
- `HeroFrameState` → becomes `SlimeFrameState`
- `HERO_CANVAS_SIZE`, `HERO_GROUND_Y` → remain showcase-local constants (canvas-size-specific, not library material)

### Migration path

1. **Phase 1a:** Create `src/character/slime/` by moving the showcase's derive/config/step/draw logic into the library. The showcase's `slime-knight.ts` becomes a thin wrapper that imports from `src/character/slime/` and adds showcase-only concerns (canvas sizing, ground line, blink, emotion, leg-style toggle).

2. **Phase 1b:** Add `src/character/humanoid/`, `src/character/floater/`, `src/character/serpentine/` as new modules.

3. **Phase 1c:** Create `src/character/registry.ts` with `createBodyPlanRegistry` registering all four built-ins.

4. **Showcase update:** The hero section in the showcase switches from importing `showcase/helpers/slime-knight.ts` to importing `src/character/slime/` directly (or through the registry). The showcase-local concerns (blink, emotion, canvas sizing) remain showcase-owned.

**Breaking changes:** None. The slime-knight is showcase-local today; no consumer depends on its API. The library gains new exports only.

---

## Implementation Notes for @coder

### File structure

```
src/character/
├── types.ts              # BodyPlanName, CharacterConfig, CharacterFrameState, CharacterInputs, BodyPlanHandler, BodyPlanRegistry
├── registry.ts           # createBodyPlanRegistry, BUILT_IN_HANDLERS
├── index.ts              # Barrel re-export
├── slime/
│   ├── types.ts          # SlimeConfig, SlimeFrameState, SlimeInputs
│   ├── config.ts         # deriveSlimeConfig (seed contract: 16-draw RNG order)
│   ├── state.ts          # createSlimeFrameState, stepSlime
│   ├── draw.ts           # drawSlime (renderer-adjacent)
│   ├── constants.ts      # DEFAULT_SLIME, layout constants (HERO_CANVAS_SIZE, HERO_GROUND_Y stay showcase-local)
│   └── index.ts
├── humanoid/
│   ├── types.ts          # HumanoidConfig, HumanoidFrameState, HumanoidInputs
│   ├── config.ts         # deriveHumanoidConfig
│   ├── state.ts          # createHumanoidFrameState, stepHumanoid
│   ├── draw.ts           # drawHumanoid (renderer-adjacent)
│   ├── constants.ts      # DEFAULT_HUMANOID
│   └── index.ts
├── floater/
│   ├── types.ts          # FloaterConfig, FloaterFrameState, FloaterInputs
│   ├── config.ts         # deriveFloaterConfig
│   ├── state.ts          # createFloaterFrameState, stepFloater
│   ├── draw.ts           # drawFloater (renderer-adjacent)
│   ├── constants.ts      # DEFAULT_FLOATER
│   └── index.ts
└── serpentine/
    ├── types.ts          # SerpentineConfig, SerpentineFrameState, SerpentineInputs
    ├── config.ts         # deriveSerpentineConfig
    ├── state.ts          # createSerpentineFrameState, stepSerpentine
    ├── draw.ts           # drawSerpentine (renderer-adjacent)
    ├── constants.ts      # DEFAULT_SERPENTINE
    └── index.ts
```

### Constraints the implementation must respect

1. **No shared `CharacterState` base type in the registry layer.** The `BodyPlanHandler` is generic: `step(state: TState, ...)` where `TState` is plan-specific. The registry returns `BodyPlanHandler<CharacterConfig, CharacterFrameState>` but the consumer narrows via the generic parameter when the plan is known.

2. **Each plan's `deriveConfig` is the seed contract.** Same seed → same config → same character, forever. Document the RNG consumption order in JSDoc (the slime's 16-draw order is the precedent).

3. **Each plan's visual advance is pure-clone.** Returns a new state; input never
   mutated. The humanoid composes `advanceLocomotionByDisplacement`,
   `evaluateLocomotion`, and `solveLimb`; it never imports `advanceJump` or
   `JumpState`.

4. **Each plan's `draw` is renderer-adjacent.** Takes `CanvasRenderingContext2D`, may have canvas side effects. Must not read/write deterministic simulation state.

5. **Constants go in `constants.ts` per plan.** Every tunable number in a named constant. No magic numbers in draw or step code.

6. **JSDoc on every exported symbol.** Document the contract, not the implementation.

7. **The slime-knight seed contract (16-draw RNG order) must be preserved exactly** when migrating from showcase to library. The golden hero renders must stay byte-identical.

8. **`src/index.ts` must add `export * from './character'`** when the module ships. The top-level barrel currently re-exports all pillars; `src/character/` must be added to keep the barrel complete.

---

## Open Questions for @architect

1. **Should the registry handle cosmetics integration?** The research recommends composing with `src/palette/` and `src/cosmetics/`. Should the `BodyPlanHandler.deriveConfig` accept an optional `PaletteOverrides` parameter, or should palette be applied post-hoc by the consumer? The spider embeds its palette in `SpiderConfig`; the slime derives it from the seed via `generatePalette(seed)`.

2. **Should `draw` accept a shared `CharacterDrawContext` instead of bare `ctx + tick + look`?** A draw context could carry palette, facing, scale, and other rendering parameters that all plans share, reducing parameter count. But it adds a type that every plan must import.

3. **How does this compose with Phase 2 (enemy archetypes)?** Enemies currently use the `EnemyBehaviorRegistry` for step logic but render via `evaluateSpiderPose` + `drawSpider`. Should enemies also use `BodyPlanHandler` for rendering, or keep the existing split (behavior registry for step, plan handler for draw)?

4. **Should the slime-knight migrate into `src/character/slime/` in Phase 1, or stay showcase-local until Phase 4 (silhouette diversity)?** Migrating it now proves the abstraction works with the hardest case (2200 lines of bespoke rendering). Deferring keeps the migration risk separate from the new-plan design risk.
