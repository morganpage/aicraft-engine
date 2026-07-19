# API Proposal: Platformer Kernel

> Target pillar: 1 (Primitives). Module: `src/platformer/`.
> Builds on research: `docs/research/platformer-kernel.md`.
> Status: DRAFT.

---

## Problem Statement

The library already ships the primitives a precision platformer needs — `advanceJump` (apex-parameterized jump with coyote, buffering, variable height), `resolveAxisX`/`resolveAxisY` (per-axis AABB collision), `advanceLocomotionByDisplacement` (walk-cycle phase), `updateCamera` (follow camera), and `pollEdge` (input edges). But every consumer must hand-wire these into a ~300-line tick function (see `showcase/sections/playground.ts` lines 930–1189 and `core/player.ts` in Spitekeep). The kernel module composes these existing primitives into a single authoritative, deterministic step function that supports a full precision-platformer conformance suite — coyote time, jump buffering, wall slide/jump, dash, double-jump, and moving-platform push-and-carry — without duplicating any underlying logic. It is NOT a new physics engine; it is the orchestration layer that connects the primitives in the correct update order and manages the persistent state each ability needs between ticks.

---

## Approach A: Flat-Config Step Function

**Source pattern:** Spitekeep's `updatePlayer` (`core/player.ts`) — a single function with a flat config, no ability abstraction. The research note flags this as the simplest viable approach but warns of god-function risk.

**Core idea:** One `PlatformerState` record containing everything (position, velocity, jump sub-state, wall-slide timers, dash timers, contact info). One `PlatformerConfig` with all tunable knobs. One `stepPlatformer(state, input, world, dt, config)` function that runs the full tick inline with `if` branches for each ability.

### Signature sketch

```ts
// src/platformer/types.ts

import type { Rect, Solid, ResolveXResult, ResolveYResult } from '../collision/types';
import type { JumpState, JumpConfig, JumpInputs } from '../animation/jump';
import type { LocomotionState } from '../animation/locomotion';
import type { Camera, CameraTarget, CameraBounds, CameraConfig } from '../camera/types';
import type { PolledEdge } from '../input/types';

/** Contact identity — which solid the actor is touching, updated each tick. */
export interface Contacts {
  /** The solid the actor is standing on, or null. */
  readonly groundId: string | null;
  /** The solid the actor is touching on the left, or null. */
  readonly leftWallId: string | null;
  /** The solid the actor is touching on the right, or null. */
  readonly rightWallId: string | null;
  /** The solid the actor hit on the ceiling, or null. */
  readonly ceilingId: string | null;
}

/** Events emitted by a single tick (consumer reads and clears). */
export interface PlatformerEvents {
  /** `true` on the tick the actor landed. */
  readonly justLanded: boolean;
  /** `true` on the tick the actor launched (jump fired). */
  readonly justLaunched: boolean;
  /** `true` on the tick the actor started wall-sliding. */
  readonly startedWallSlide: boolean;
  /** `true` on the tick the actor hit a ceiling. */
  readonly hitCeiling: boolean;
}

/** Input snapshot consumed by the kernel each tick. */
export interface PlatformerInput {
  /** Horizontal movement: -1 (left), 0 (idle), +1 (right). */
  readonly moveX: -1 | 0 | 1;
  /** Polled jump edge (from `pollEdge`). */
  readonly jump: PolledEdge;
  /** Polled dash edge (from `pollEdge`), or null if dash disabled. */
  readonly dash: PolledEdge | null;
}

/** Persistent kernel state — one per character, cloned each tick. */
export interface PlatformerState {
  /** World-space position (top-left of the AABB). */
  readonly x: number;
  readonly y: number;
  /** Body dimensions (immutable per character). */
  readonly width: number;
  readonly height: number;
  /** Horizontal velocity in px/s. */
  readonly vx: number;
  /** Vertical velocity in px/s (+Y is down). */
  readonly vy: number;
  /** Facing direction: +1 right, -1 left. */
  readonly facing: 1 | -1;
  /** Whether the actor was on ground last tick. */
  readonly onGround: boolean;
  /** Whether the actor is wall-sliding. */
  readonly wallSliding: boolean;
  /** Which side the wall-slide is on: 'left' | 'right'. */
  readonly wallSlideSide: 'left' | 'right' | null;
  /** Wall-slide vertical speed (capped). */
  readonly wallSlideVy: number;
  /** Dash state: remaining duration, cooldown, count. */
  readonly dashTimer: number;
  readonly dashCooldown: number;
  readonly dashCount: number;
  /** Remaining dashes this airborne cycle. */
  readonly dashesRemaining: number;
  /** Jump sub-state (delegates to `JumpState`). */
  readonly jump: JumpState;
  /** Locomotion phase (delegates to `LocomotionState`). */
  readonly locomotion: LocomotionState;
  /** Contact identity from last tick's collision resolution. */
  readonly contacts: Contacts;
  /** Events from last tick (consumer reads and clears). */
  readonly events: PlatformerEvents;
}

/** All tunable knobs — spread `DEFAULT_PLATFORMER_CONFIG` to override. */
export interface PlatformerConfig {
  /** Gravity in px/s². */
  readonly gravity: number;
  /** Terminal fall velocity in px/s. */
  readonly maxFallSpeed: number;
  /** Ground move speed in px/s. */
  readonly moveSpeed: number;
  /** Air control multiplier (0–1). */
  readonly airControl: number;
  /** Jump tuning (delegates to `JumpConfig`). */
  readonly jump: JumpConfig;
  /** Wall-slide enabled. */
  readonly wallSlideEnabled: boolean;
  /** Wall-slide terminal velocity in px/s. */
  readonly wallSlideSpeed: number;
  /** Wall-jump launch velocity X component in px/s. */
  readonly wallJumpVx: number;
  /** Wall-jump lock time (prevents re-wall-slide briefly). */
  readonly wallJumpLockTime: number;
  /** Dash enabled. */
  readonly dashEnabled: boolean;
  /** Dash speed in px/s. */
  readonly dashSpeed: number;
  /** Dash duration in seconds. */
  readonly dashDuration: number;
  /** Dash cooldown in seconds. */
  readonly dashCooldown: number;
  /** Max dashes per airborne cycle. */
  readonly maxDashes: number;
  /** Double-jump enabled. */
  readonly doubleJumpEnabled: boolean;
  /** Camera follow config (optional; consumer can skip). */
  readonly camera?: CameraConfig;
}

export const DEFAULT_PLATFORMER_CONFIG: Readonly<PlatformerConfig> = {
  gravity: 980,
  maxFallSpeed: 600,
  moveSpeed: 200,
  airControl: 0.65,
  jump: { /* DEFAULT_JUMP fields */ } as JumpConfig,
  wallSlideEnabled: true,
  wallSlideSpeed: 60,
  wallJumpVx: 200,
  wallJumpLockTime: 0.1,
  dashEnabled: true,
  dashSpeed: 400,
  dashDuration: 0.12,
  dashCooldown: 0.3,
  maxDashes: 1,
  doubleJumpEnabled: false,
};
```

```ts
// src/platformer/kernel.ts

/**
 * Step the platformer kernel by one fixed tick.
 *
 * Composes: `advanceJump`, `resolveAxisX`, `resolveAxisY`, `pollEdge`,
 * `advanceLocomotionByDisplacement`, `updateCamera`.
 *
 * Pure: returns a new `PlatformerState` + `PlatformerEvents`; input never
 * mutated. Never throws.
 */
export function stepPlatformer(
  state: PlatformerState,
  input: PlatformerInput,
  solids: readonly Solid[],
  dt: number,
  config: PlatformerConfig,
): { state: PlatformerState; events: PlatformerEvents } {
  // 1. Carry from moving platforms (if last tick's groundId matches a moving solid)
  // 2. Poll input edges
  // 3. Horizontal input → vx
  // 4. Wall-slide check (onGround false + touching wall + vy > 0)
  // 5. Dash check (dashEdge.pressed + cooldown === 0 + dashesRemaining > 0)
  // 6. Jump input → JumpInputs → advanceJump
  // 7. Gravity integration (clamped to maxFallSpeed)
  // 8. resolveAxisX → resolveAxisY
  // 9. Update contacts, onGround, events
  // 10. Advance locomotion by displacement
  // 11. Return
  // ... (all inline, ~250 lines)
}
```

### Usage example

```ts
import {
  stepPlatformer,
  createPlatformerState,
  DEFAULT_PLATFORMER_CONFIG,
} from 'aicraft-engine/src/platformer';
import { pollEdge, createEdgeAccumulator } from 'aicraft-engine/src/input';

const config = {
  ...DEFAULT_PLATFORMER_CONFIG,
  wallSlideEnabled: true,
  dashEnabled: true,
  maxDashes: 1,
};

let state = createPlatformerState(100, 200, 16, 24, config);
const jumpEdge = createEdgeAccumulator();
const dashEdge = createEdgeAccumulator();

// Each tick:
const jump = pollEdge(jumpEdge);
const dash = pollEdge(dashEdge);
const input: PlatformerInput = { moveX: 1, jump, dash };
const result = stepPlatformer(state, input, solids, 1 / 60, config);
state = result.state;
console.log(result.events.justLanded); // boolean
console.log(result.state.contacts.groundId); // string | null
```

### Trade-offs

| Dimension | Rating | Justification |
|---|---|---|
| **Ergonomics (precision platformer)** | High | One function call, one config object. Dead simple call site. |
| **Ergonomics (adding grapple hook)** | Low | Must modify the state type, config type, and the step function body. Every new ability touches the god-function. |
| **Ergonomics (swapping feel)** | Medium | Config-presets work (precision vs momentum = different config values), but structural changes (grapple = new ability) require editing the kernel. |
| **Determinism testability** | Medium | Can test the full step function deterministically, but cannot test individual abilities in isolation — they're interleaved in one function. |
| **Composability with `advanceJump`** | High | Wraps `advanceJump` as a delegation call. No duplication. |
| **Performance** | High | Zero iteration overhead. Inline branches are branchless-predictable. |
| **Public API stability** | Low | Adding a new ability (e.g. wall-slide) changes `PlatformerState` and `stepPlatformer`'s internals. Existing consumers may break on type changes. |
| **Replay friendliness** | High | Flat state is trivially serializable. All info in one record. |

### What this makes easy

- Shipping a complete precision platformer with minimal API surface.
- Consumer understanding — one function, one config, one state.
- Replay: serialize the flat state every tick for byte-identical replay.

### What this makes hard

- Adding abilities without breaking existing consumers.
- Unit-testing individual abilities in isolation.
- Supporting multiple platformer families (precision vs combat vs momentum) via composition — every family variant touches the same function.

**Prior-art pattern:** Spitekeep's `updatePlayer` (`core/player.ts:124-238`). Single function, flat config, inline ability branches.

---

## Approach B: Composable Ability Processors

**Source pattern:** Research note §Pattern 2 ("State-Machine-Driven Ability Composition Pattern") — "Define a pure `updatePlatformerKernel(state, inputs, dt, config)` function that delegates to a set of active ability states."

**Core idea:** A thin `PlatformerState` core (position, velocity, contacts) + separate ability modules (`JumpAbility`, `WallSlideAbility`, `DashAbility`, `DoubleJumpAbility`). Each ability owns its own state slice and has an `advance` function. The controller runs them in a fixed, deterministic order. Adding an ability = adding a new module and registering it in the controller's pipeline — no changes to existing ability code.

### Signature sketch

```ts
// src/platformer/types.ts (shared with Approach A, plus:)

/** Core physics state — position, velocity, contacts. Abilities read/write through this. */
export interface ActorCore {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly vx: number;
  readonly vy: number;
  readonly facing: 1 | -1;
  readonly onGround: boolean;
  readonly contacts: Contacts;
}

/** An ability's private state slice. */
export interface AbilityState {
  /** Discriminator for debugging / serialization. */
  readonly kind: string;
}

/** One ability's per-tick processor. */
export interface AbilityProcessor<T extends AbilityState> {
  /** The ability's state kind discriminator. */
  readonly kind: T['kind'];
  /**
   * Run this ability for one tick. May mutate `core` in place (velocity,
   * position adjustments) and must return a new ability state.
   *
   * Called in a fixed order defined by the controller pipeline.
   */
  advance(
    core: ActorCore,
    input: PlatformerInput,
    abilityState: T,
    dt: number,
    config: PlatformerConfig,
  ): T;
}

/** Jump ability state (wraps the existing `JumpState`). */
export interface JumpAbilityState extends AbilityState {
  readonly kind: 'jump';
  readonly jump: JumpState;
  /** Remaining coyote time (managed by JumpState, but also tracked here for wall-jump logic). */
  readonly jumpCount: number;
}

/** Wall-slide ability state. */
export interface WallSlideAbilityState extends AbilityState {
  readonly kind: 'wallSlide';
  readonly sliding: boolean;
  readonly side: 'left' | 'right' | null;
  readonly lockTimer: number;
}

/** Dash ability state. */
export interface DashAbilityState extends AbilityState {
  readonly kind: 'dash';
  readonly timer: number;
  readonly cooldown: number;
  readonly dashesRemaining: number;
  readonly dashDirX: number;
  readonly dashDirY: number;
}
```

```ts
// src/platformer/abilities/jump-ability.ts

/**
 * Jump ability processor. Wraps `advanceJump` — no trajectory logic
 * duplicated. Owns the jump state slice and feeds `JumpInputs` derived
 * from `ActorCore.onGround` + `PlatformerInput.jump`.
 */
export const jumpAbility: AbilityProcessor<JumpAbilityState> = {
  kind: 'jump',

  advance(core, input, state, dt, config) {
    const jumpInputs: JumpInputs = {
      jumpHeld: input.jump.held,
      jumpPressed: input.jump.pressed,
      isGrounded: core.onGround,
    };
    const nextJump = advanceJump(state.jump, jumpInputs, dt, config.jump);
    // Apply vy from jump state to core
    // ...
    return { ...state, jump: nextJump, jumpCount: /* updated */ };
  },
};
```

```ts
// src/platformer/kernel.ts

/**
 * Pipeline of ability processors — run in fixed order each tick.
 * The consumer builds this once and passes it to `createPlatformerController`.
 */
export interface AbilityPipeline {
  readonly processors: readonly AbilityProcessor<any>[];
}

/**
 * Create a platformer controller with a fixed ability pipeline.
 * The controller owns the update order; the pipeline owns the abilities.
 */
export function createPlatformerController(
  pipeline: AbilityPipeline,
  config: PlatformerConfig,
): {
  step(
    state: PlatformerState,
    input: PlatformerInput,
    solids: readonly Solid[],
    dt: number,
  ): { state: PlatformerState; events: PlatformerEvents };
} {
  return {
    step(state, input, solids, dt) {
      const core: ActorCore = { /* extract from state */ };
      let abilities = state.abilities;

      // 1. Carry from moving platforms
      // 2. For each processor in pipeline: advance ability
      for (const proc of pipeline.processors) {
        const idx = abilities.findIndex(a => a.kind === proc.kind);
        if (idx >= 0) {
          abilities = [
            ...abilities.slice(0, idx),
            proc.advance(core, input, abilities[idx], dt, config),
            ...abilities.slice(idx + 1),
          ];
        }
      }
      // 3. Gravity integration
      // 4. resolveAxisX → resolveAxisY
      // 5. Update contacts, events
      // 6. Return combined state
      return { state: { ...state, ...core, abilities }, events };
    },
  };
}
```

### Usage example

```ts
import {
  createPlatformerController,
  DEFAULT_PLATFORMER_CONFIG,
  type AbilityPipeline,
  type PlatformerState,
  type PlatformerInput,
} from 'aicraft-engine/src/platformer';
import { jumpAbility } from 'aicraft-engine/src/platformer/abilities/jump-ability';
import { wallSlideAbility } from 'aicraft-engine/src/platformer/abilities/wall-slide';
import { dashAbility } from 'aicraft-engine/src/platformer/abilities/dash';

// Configure pipeline — order matters (jump before wall-slide for wall-jump).
const pipeline: AbilityPipeline = {
  processors: [jumpAbility, wallSlideAbility, dashAbility],
};

const controller = createPlatformerController(pipeline, {
  ...DEFAULT_PLATFORMER_CONFIG,
  wallSlideEnabled: true,
  dashEnabled: true,
});

// Each tick:
const result = controller.step(state, input, solids, 1 / 60);
state = result.state;
console.log(result.events.justLanded);
console.log(result.state.contacts.groundId);
```

### Trade-offs

| Dimension | Rating | Justification |
|---|---|---|
| **Ergonomics (precision platformer)** | Medium | Consumer must assemble the pipeline. Slightly more setup than Approach A. |
| **Ergonomics (adding grapple hook)** | High | Write one new `AbilityProcessor`, add it to the pipeline. Zero changes to existing abilities. |
| **Ergonomics (swapping feel)** | High | Swap pipeline entries: precision uses [jump, wallSlide, dash]; momentum uses [jump, dash, wallSlide] with different config. |
| **Determinism testability** | High | Each `AbilityProcessor` is independently unit-testable with a mock `ActorCore`. |
| **Composability with `advanceJump`** | High | `jumpAbility` wraps `advanceJump` directly. No duplication. |
| **Performance** | Medium | Pipeline iteration has array-find overhead per ability per tick (~4 finds at O(n) where n ≤ 6). Negligible in practice but non-zero vs inline. |
| **Public API stability** | High | New abilities are additive modules. Existing types unchanged. |
| **Replay friendliness** | High | `abilities` array is trivially serializable. Each ability state is a plain record. |

### What this makes easy

- Adding new abilities (grapple, swim, climb) as standalone modules.
- Unit-testing each ability in isolation.
- Swapping controller feel by reconfiguring the pipeline + config.

### What this makes hard

- More initial setup for the consumer (must assemble the pipeline).
- The `ActorCore` shared-mutable object in `advance` creates a potential ordering hazard (abilities must agree on the update order).
- Slightly harder to reason about the full tick when abilities are spread across files.

**Prior-art pattern:** Research note §Pattern 2 + §Open Question 1 ("array of Ability Processors that execute in a fixed order during the tick").

---

## Approach C: Phase-Gated State Machine

**Source pattern:** Research note §Pattern 2 ("State-Machine-Driven Ability Composition Pattern") + §Pattern 2 from the Celeste research ("explicit `CharacterPhase` union with a transition table; each phase has its own update function; abilities are gated by phase"). Also Celeste's `PlayerStateEnum` from the research note.

**Core idea:** An explicit `CharacterPhase` discriminated union (`'grounded' | 'airborne' | 'wallSliding' | 'dashing'`). Each phase has its own update function. Abilities are only active in specific phases (dash only from grounded/airborne, wall-slide only from airborne+touching wall, etc.). Phase transitions are the primary composition mechanism — the consumer defines which abilities are available by which phases they activate in.

### Signature sketch

```ts
// src/platformer/types.ts (shared core, plus:)

/** Character phase — the primary state discriminator. */
export type CharacterPhase =
  | 'grounded'
  | 'airborne'
  | 'wallSliding'
  | 'dashing';

/** Phase transition result. */
export interface PhaseTransition {
  /** The next phase. */
  readonly phase: CharacterPhase;
  /** Whether this phase just entered (for one-shot effects). */
  readonly justEntered: boolean;
}

/** Per-phase update function signature. */
export interface PhaseUpdate {
  /**
   * Run the phase update for one tick. Returns phase transition + modified
   * velocity. Does NOT resolve collisions (that happens after phase update).
   */
  (
    core: ActorCore,
    input: PlatformerInput,
    phaseState: PhaseState,
    dt: number,
    config: PlatformerConfig,
  ): { core: ActorCore; phaseState: PhaseState; transition: PhaseTransition };
}

/** Phase-specific state. Discriminated by `phase`. */
export type PhaseState =
  | { readonly phase: 'grounded'; readonly jumpBufferTimer: number }
  | { readonly phase: 'airborne'; readonly jumpCount: number; readonly jumpState: JumpState }
  | { readonly phase: 'wallSliding'; readonly side: 'left' | 'right'; readonly wallVy: number }
  | { readonly phase: 'dashing'; readonly timer: number; readonly dirX: number; readonly dirY: number };

/** Transition table — maps (current phase, conditions) → next phase. */
export interface PhaseTransitionTable {
  /**
   * Evaluate whether a phase transition should occur.
   * Called after the phase update but before collision resolution.
   */
  evaluate(
    core: ActorCore,
    input: PlatformerInput,
    phaseState: PhaseState,
    config: PlatformerConfig,
  ): PhaseTransition | null;
}
```

```ts
// src/platformer/phases/airborne.ts

export const airborneUpdate: PhaseUpdate = (core, input, phaseState, dt, config) => {
  // Only jump + gravity. No horizontal snapping. Air control via config.airControl.
  // If onGround → transition to 'grounded'.
  // If touching wall + vy > 0 + wallSlideEnabled → transition to 'wallSliding'.
  // If dash pressed + dashesRemaining > 0 → transition to 'dashing'.
  // ...
};

export const airborneTransition: PhaseTransitionTable = {
  evaluate(core, input, phaseState, config) {
    if (core.onGround) return { phase: 'grounded', justEntered: true };
    if (config.wallSlideEnabled && core.contacts.leftWallId && core.vy > 0) {
      return { phase: 'wallSliding', justEntered: true };
    }
    return null;
  },
};
```

```ts
// src/platformer/kernel.ts

/** Phase handler bundle — update + transitions for one phase. */
export interface PhaseHandler {
  readonly phase: CharacterPhase;
  readonly update: PhaseUpdate;
  readonly transitions: PhaseTransitionTable;
}

/**
 * Create a platformer controller from a set of phase handlers.
 * The controller owns the tick loop: run phase update → check transitions →
 * resolve collisions → repeat if phase changed.
 */
export function createPlatformerController(
  handlers: readonly PhaseHandler[],
  config: PlatformerConfig,
): {
  step(
    state: PlatformerState,
    input: PlatformerInput,
    solids: readonly Solid[],
    dt: number,
  ): { state: PlatformerState; events: PlatformerEvents };
} {
  const handlerMap = new Map(handlers.map(h => [h.phase, h]));

  return {
    step(state, input, solids, dt) {
      let core = { /* extract from state */ };
      let phaseState = state.phaseState;
      let phase = state.phase;
      let events = { justLanded: false, justLaunched: false, /* ... */ };

      // 1. Carry from moving platforms
      // 2. Run current phase's update
      const handler = handlerMap.get(phase)!;
      const result = handler.update(core, input, phaseState, dt, config);
      core = result.core;
      phaseState = result.phaseState;

      // 3. Check transitions
      const transition = handler.transitions.evaluate(core, input, phaseState, config);
      if (transition) {
        phase = transition.phase;
        phaseState = createPhaseState(phase); // reset phase-specific state
        events = { ...events, /* set phase-entry flags */ };
      }

      // 4. Gravity integration (skip during dashing)
      if (phase !== 'dashing') {
        core = { ...core, vy: Math.min(core.vy + config.gravity * dt, config.maxFallSpeed) };
      }

      // 5. resolveAxisX → resolveAxisY
      // 6. Update contacts
      // 7. Return
      return { state: { ...state, ...core, phase, phaseState }, events };
    },
  };
}
```

### Usage example

```ts
import {
  createPlatformerController,
  DEFAULT_PLATFORMER_CONFIG,
} from 'aicraft-engine/src/platformer';
import { groundedUpdate, groundedTransition } from 'aicraft-engine/src/platformer/phases/grounded';
import { airborneUpdate, airborneTransition } from 'aicraft-engine/src/platformer/phases/airborne';
import { wallSlidingUpdate, wallSlidingTransition } from 'aicraft-engine/src/platformer/phases/wall-sliding';
import { dashingUpdate, dashingTransition } from 'aicraft-engine/src/platformer/phases/dashing';

const controller = createPlatformerController(
  [
    { phase: 'grounded', update: groundedUpdate, transitions: groundedTransition },
    { phase: 'airborne', update: airborneUpdate, transitions: airborneTransition },
    { phase: 'wallSliding', update: wallSlidingUpdate, transitions: wallSlidingTransition },
    { phase: 'dashing', update: dashingUpdate, transitions: dashingTransition },
  ],
  { ...DEFAULT_PLATFORMER_CONFIG, wallSlideEnabled: true, dashEnabled: true },
);

// Each tick:
const result = controller.step(state, input, solids, 1 / 60);
state = result.state;
console.log(state.phase); // 'grounded' | 'airborne' | 'wallSliding' | 'dashing'
console.log(result.events.justLanded);
```

### Trade-offs

| Dimension | Rating | Justification |
|---|---|---|
| **Ergonomics (precision platformer)** | Medium | More boilerplate (4 phase handler files vs 1 function). Phase transitions are explicit but verbose. |
| **Ergonomics (adding grapple hook)** | Medium | Must add a new phase (`'grappling'`) + transition rules. Phases are a closed set — adding one touches the transition table. |
| **Ergonomics (swapping feel)** | High | Precision vs momentum = different transition tables + different phase update functions. Clean swap. |
| **Determinism testability** | High | Each phase's update and transitions are independently testable. Phase state is a clean discriminated union. |
| **Composability with `advanceJump`** | Medium | `advanceJump` is called from within the airborne phase's update. Slightly less natural than Approach B's dedicated `jumpAbility` wrapper. |
| **Performance** | Medium | Phase dispatch is O(1) (Map lookup). Transition evaluation is O(1). Comparable to Approach B. |
| **Public API stability** | Medium | Adding a new phase is a breaking change to the `CharacterPhase` union. Existing consumers' switch statements break. |
| **Replay friendliness** | High | Phase + phaseState is a clean discriminated union. Trivially serializable. |

### What this makes easy

- Reasoning about which abilities are active in which states (phase = capability gate).
- Clean transition animations (justEntered flag).
- Swapping controller feel via different phase handlers.

### What this makes hard

- Adding new phases breaks the closed `CharacterPhase` union (breaking change).
- More boilerplate for a simple platformer (4 files instead of 1).
- The transition table can become complex when abilities interact (e.g. dash→wallSlide→jump is a 3-phase chain).
- `advanceJump` must be decomposed across phases (grounded handles buffer, airborne handles trajectory) rather than called as a single delegation.

**Prior-art pattern:** Celeste's `PlayerStateEnum` (research note §Pattern 2), Sonic's "Ground Modes" (research note §Pattern 6).

---

## Comparison Table

| Criterion | A: Flat-Config | B: Composable | C: Phase-Gated |
|---|---|---|---|
| **Ergonomics (precision platformer)** | High | Medium | Medium |
| **Ergonomics (adding new ability)** | Low | High | Medium |
| **Ergonomics (swapping feel)** | Medium | High | High |
| **Determinism testability** | Medium | High | High |
| **Composability with `advanceJump`** | High | High | Medium |
| **Performance** | High | Medium | Medium |
| **Public API stability** | Low | High | Medium |
| **Replay friendliness** | High | High | High |
| **Convention fit** | High | High | Medium |
| **Spitekeep integration** | High | High | Medium |

---

## Recommendation

**Approach B: Composable Ability Processors.**

Approach B is the right composition axis for this library. The research note's §Open Question 1 ("How to compose abilities without a god-class?") is answered directly: each ability is a self-contained `AbilityProcessor` with its own state slice, independently testable, independently serializable, and independently replaceable. The controller is a thin orchestration shell that runs the pipeline in fixed order — it never grows because abilities live outside it.

The key insight is that this library serves *multiple consumers* (Spitekeep, future clone-to-jest siblings). A grapple hook in one game must not require touching the kernel that another game depends on. Approach B achieves this: the kernel ships a default pipeline (`[jumpAbility, wallSlideAbility, dashAbility, doubleJumpAbility]`) for the common case, and consumers can swap, extend, or reorder it without the library author's involvement. Approach A cannot do this — every new ability requires a library release. Approach C partially can, but adding a new phase is a breaking change to the `CharacterPhase` union, and the phase-gated model fights against `advanceJump`'s single-call design (the jump state machine manages its own phases internally; wrapping it in an outer phase machine creates redundant state).

For the moving-platform carry problem, Approach B handles it naturally: the controller's orchestration shell applies platform displacement before running ability processors (step 0 in the update order), exactly as Spitekeep's `updatePlayer` does (`modifiers.carryX`/`carryY` at line 139-144). The `ActorCore` that abilities read and write through already carries the post-carry position. No ability needs to know about platforms — the carry is applied once, globally, before any ability sees the state.

For stable contact identity, the `contacts` record on `ActorCore` is updated after collision resolution (step 8 in the update order) and persisted in `PlatformerState`. Each solid has an optional `id` field (consumers assign stable string identifiers to their level geometry), and the kernel's collision loop records which solid the actor landed on / touched. This is exactly how Spitekeep's `player.ts` tracks `onGround` — extended with wall/ceiling identity.

For multiple platformer families, Approach B supports this via config presets + pipeline configuration. A "precision" preset uses `[jumpAbility, wallSlideAbility, dashAbility]` with snappy acceleration. A "momentum" preset uses `[jumpAbility, dashAbility]` with high air control and no wall-slide. A "combat" preset adds a `hitboxAbility` to the pipeline. The kernel itself never changes.

---

## Simulation Update Order (Locked)

The per-tick order below is refined from the research note's recommendation (§Recommended Simulation Update Order) with one deviation: locomotion and camera are excluded from the kernel (they are consumer-side concerns — the kernel produces displacement data; the consumer decides how to feed it to `advanceLocomotionByDisplacement` and `updateCamera`).

```
[Fixed-Step Tick Start]
       │
       ▼
1. Move Solids             ◄─── Moving platforms advance via advanceGapMotion / consumer's own motion
       │
       ▼
2. Carry Actors            ◄─── If last tick's groundId matches a moving solid,
       │                          apply (solid.dx, solid.dy) to actor position.
       │                          Consumer-provided: kernel reads solid displacements.
       ▼
3. Process Inputs          ◄─── pollEdge for jump, dash, etc. Read moveX.
       │
       ▼
4. Execute Abilities       ◄─── Pipeline processors run in fixed order:
       │                          JumpAbility → WallSlideAbility → DashAbility → DoubleJumpAbility
       │                          Each may modify vx/vy/state. advanceJump is called inside JumpAbility.
       ▼
5. Integrate Forces        ◄─── Apply gravity (×gravityMultiplier during wallSlide).
       │                          Clamp vy to maxFallSpeed (skip during dash).
       ▼
6. Resolve Actor Collision ◄─── resolveAxisX(body, vx, solids)
       │                          resolveAxisY(body, vy, solids, prevBottom)
       │                          Record contact identity from the solid that caused landed/hitWall.
       ▼
7. Update Contacts & Events ◄── Set contacts.groundId/leftWallId/etc. from resolution results.
       │                          Compute events (justLanded, justLaunched, etc.).
       ▼
[Fixed-Step Tick End]
```

### Justification for ordering

1. **Move Solids First** (research note §1): Moving platforms must advance before actors so their leading edge is in place. This prevents players falling through rising platforms.

2. **Carry Before Actor Movement** (research note §2): Platform displacement is applied using the pre-tick position as reference. The actor is correctly aligned with the platform before inputs run.

3. **Inputs Before Abilities** (research note §3): Edge accumulators are drained once per tick. Abilities read the polled snapshot, not live DOM state. This guarantees determinism.

4. **Abilities Before Integration** (research note §4): Abilities (jump launch, dash) modify velocity. Gravity integration happens after so the launched velocity isn't immediately overwritten by gravity on the launch tick.

5. **Collision After Integration** (research note §5): Forces are integrated first, then resolved. This guarantees the final position is collision-free.

6. **Contacts After Collision** (refinement): Contact identity is a post-resolution record. It captures which solid the actor ended up touching, not which solid it was approaching. This is more useful for game logic (e.g. "which platform am I standing on?") than a pre-resolution prediction.

**Deviation from research note:** The research note placed "Emit Triggers & Events" as step 7 (after collision). I merged this into step 7 ("Update Contacts & Events") because events like `justLanded` are computed from collision resolution results — they must happen after resolve, not as a separate phase. The consumer reads events from the returned state and clears them on the next tick.

**Deviation: locomotion + camera excluded from kernel.** The kernel produces `dx` (horizontal displacement) and `onGround` state. The consumer calls `advanceLocomotionByDisplacement(loco, dx * facing, gaitConfig)` and `updateCamera(camera, target, bounds, viewport)` themselves. This keeps the kernel rendering-agnostic and avoids coupling it to animation concerns.

---

## Scope for v1

### Ship in v1

- `src/platformer/types.ts` — `PlatformerState`, `PlatformerConfig`, `PlatformerInput`, `ActorCore`, `Contacts`, `PlatformerEvents`, `AbilityProcessor`, `AbilityPipeline`
- `src/platformer/kernel.ts` — `createPlatformerController`, `stepPlatformer` (convenience wrapper for the common pipeline)
- `src/platformer/abilities/jump-ability.ts` — wraps `advanceJump`; handles ground-jump, coyote-jump, buffered-jump
- `src/platformer/abilities/wall-slide-ability.ts` — wall-slide + wall-jump (modifies vy, applies wall-jump vx)
- `src/platformer/abilities/dash-ability.ts` — directional dash with cooldown + limited dashes
- `src/platformer/abilities/double-jump-ability.ts` — second jump in air (delegates to `advanceJump` with `jumpCount` gating)
- `src/platformer/pipelines.ts` — `DEFAULT_PRECISION_PIPELINE`, `DEFAULT_MOMENTUM_PIPELINE` config presets
- `src/platformer/index.ts` — barrel export
- `src/platformer/tests/` — deterministic tick tests for each ability in isolation + full integration test

### Defer to v2+

- Slopes (raycast-based or heightmap-based)
- Swimming / water physics
- Ladders / climbing (vertical movement with snap-to-ladder)
- Grapple hook (new ability module — trivially added via Approach B)
- Combat / hitbox resolution
- Multiple actors (enemies, NPCs) — the kernel is single-actor in v1
- Moving-platform carry (v1 ships the kernel's carry application; consumer must track which solid the actor is riding and provide displacement — a companion `RidingTracker` utility could be added in v2)
- Tile-grid integration (`resolveTileX`/`resolveTileY` wrappers — v1 uses the solid-list API; tile-grid convenience is a thin wrapper)

### Conformance suite (v1 tests)

1. **Coyote jump**: walk off edge, jump within coyote window → launches. Walk off edge, wait > coyoteTime, jump → no launch.
2. **Jump buffer**: press jump slightly before landing → launches on land.
3. **Variable height**: hold jump → full height. Tap jump → short hop.
4. **Wall slide**: airborne + touching wall + vy > 0 → wallSlide = true, vy capped.
5. **Wall jump**: wall-sliding + jump pressed → launches away from wall with vx.
6. **Dash**: dash pressed + cooldown === 0 → dash activates, timer counts down, vx/vy overridden.
7. **Double jump**: airborne + jumpCount < maxDashes → second jump fires.
8. **Moving platform carry**: actor on platform → platform moves → actor moves with platform.
9. **Determinism**: 1000-tick replay produces byte-identical state checksum.
10. **Replay round-trip**: serialize state every tick → deserialize → next tick is byte-identical.

---

## Open Questions for @architect

1. **Shared mutable `ActorCore` in Approach B:** The `advance` function receives an `ActorCore` that multiple abilities read/write through. Is this an acceptable deviation from pure-immutable-in-immutable-out, or should each ability receive an immutable core and return a modified core (like `advanceJump` does)? The trade-off is performance (avoid N shallow copies per tick) vs purity (each ability is a pure function of its inputs).

2. **Solid identity for contacts:** The kernel needs stable solid IDs for `contacts.groundId`. Should `Solid` gain an optional `id?: string` field, or should the kernel track contacts by index/reference? Index breaks when solids are added/removed between ticks. Reference equality is fragile across serialized replays. String ID is cleanest but requires consumer discipline.

3. **Carry tracking scope:** The kernel applies carry displacement in step 2, but tracking *which* solid the actor is riding (to know what displacement to apply) is a non-trivial problem. Should the kernel include a built-in `RidingTracker` that detects ground-contact-with-moving-solid, or should this be the consumer's responsibility? The research note recommends the latter; Spitekeep's `computeModifier` does it inline.

4. **Pipeline serialization:** For replay, the pipeline's ability order must be deterministic. Should the `AbilityPipeline` be serializable (array of string ability IDs that the consumer resolves), or is a fixed pipeline configuration sufficient (replay records the config, not the pipeline)?

5. **Phase-gated vs ability-processor for wall-jump:** Wall-jump is inherently phase-gated (only available from wallSlide). In Approach B, the `WallSlideAbility` handles both wall-slide AND wall-jump. Is this a clean separation, or should wall-jump be its own ability that reads the wallSlide state? The trade-off is module count vs cohesion.
