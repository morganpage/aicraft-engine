# API Proposal: Game-State FSM

> Target pillar: 1 (extends game-loop). Module: `src/game-state/`.
> Builds on research: `docs/research/game-state-fsm.md`.
> Status: DRAFT.

## Consumer Need

Every game needs top-level mode orchestration: menu → playing → paused → gameover → levelComplete. Currently every consumer (the reference implementation/IMP, future consumer titles) reimplements this from scratch — ad-hoc `scene` string fields, manual `if (paused) return` guards, and scattered transition logic. The FSM module provides a **pure, deterministic, `dt`-driven reducer** that consumers wire into their `step(fixedDt)` callback, eliminating this duplication while enabling replay-deterministic mode orchestration and time-in-state driven UI (fade-ins, delayed transitions, "press any key" prompts).

the reference implementation (IMP) already has `Scene = 'title' | 'levelSelect' | 'playing' | 'paused' | 'won' | 'levelComplete'` in `src/main.ts:177` with a `GameSession.scene` field and `stepSession` managing transitions imperatively. The FSM module would replace this with a declarative adjacency table and a pure reducer call — the same transition logic, but data-driven and unit-testable.

---

## Open Questions — Resolved

Before proposing approaches, here are the decisions on the 10 open questions and 5 convention conflicts.

### Open Questions

| # | Question | Decision | Rationale |
|---|---|---|---|
| 1 | Flat FSM vs HSM | **Flat FSM.** | 5–7 modes is well within flat-FSM scope (Socratopia diagnostic: 1–3 → FSM unambiguously; 4–8 → FSM or HFSM). HSM adds nesting overhead with no benefit here. Future sub-FSMs (player abilities, enemy AI) are separate modules. |
| 2 | Canonical state set | **`menu` / `playing` / `paused` / `gameover` / `levelComplete`.** | Matches the research note and covers platformer needs. The consumer game adds `title`, `levelSelect`, and `won` — these are consumer-specific states added via custom adjacency tables. The default set is the minimal platformer skeleton. |
| 3 | Adjacency table as data | **Ship `DEFAULT_GAME_STATE_ADJACENCY` + consumer pass custom table (spread-override pattern).** | Mirrors `DEFAULT_JUMP` / `DEFAULT_TWEEN_CONFIG` / `DEFAULT_GAIT`. The reducer takes an optional `table?` parameter; omitting it uses the default. Consumers spread the default and override specific transitions. |
| 4 | Pure reducer signature | **`reduceGameState(state, event, dt, table?) → state`.** | Matches `advanceJump(state, inputs, dt, config)` shape exactly. The consumer owns the state, the engine provides the pure function. |
| 5 | Discriminated-union vs flat-record state | **Flat record as runtime default + optional type-only discriminated-union export.** | Flat record matches existing modules (`EntitlementSave`, `CosmeticSave`, `JumpState`). Discriminated union is a type-only export for consumers who want compile-time impossible-state prevention. Both share the same runtime shape. |
| 6 | Payload on transitions in v1 | **Yes, minimal.** Event type is a discriminated union; payload fields are read from the event and written to the returned state. `GameEvent` union defined below. | Matches `flushIAPEvents` pattern (events carry data, reducer writes to save). |
| 7 | `timeInState` reset on self/illegal transitions | **Illegal = silent no-op, `timeInState` keeps advancing. Consumer detects "just entered" via `timeInState === 0` after a legal transition.** | Matches "invalid types are coerced or ignored, never thrown" convention from `docs/conventions.md`. |
| 8 | Pause semantics vs loop `visibilitychange` | **Orthogonal.** Loop pause = tab hidden (host-touching, defensive adapter). FSM pause = user-initiated (deterministic core, pure reducer). The consumer's `step` reads both. | Cleanest separation. No coupling between the two pause mechanisms. |
| 9 | `isLegalTransition(from, event, table?)` reader | **Ship it.** Pure reader, no `dt`, no state mutation. Consumers can validate transitions without calling the reducer. | Matches `isHitStopActive` pattern — pure reader on pure data. |
| 10 | Enter/exit callbacks | **No.** Consumer's `switch` on `state.current` is the lifecycle. `timeInState === 0` detects "just entered". | Matches `advanceJump` — the consumer reads `state.phase` and dispatches; the library never calls back. Keeps the reducer pure and side-effect-free. |

### Convention Conflicts — Resolved

| # | Conflict | Decision |
|---|---|---|
| C1 | Deterministic core vs defensive adapter | **Deterministic core.** No host access, no `try/catch`, no `window`. The FSM is pure data + pure function. |
| C2 | `timeInState` driver | **`dt`-driven.** Reducer takes `dt` parameter, never reads `Date.now()`. |
| C3 | Illegal transition behavior | **Silent no-op.** Never throw. State unchanged, `timeInState` keeps advancing. |
| C4 | State mutation discipline | **Fresh state object on every call.** Shallow-spread; never mutates input. |
| C5 | Game-loop module changes | **No changes to `GameLoopConfig.step` signature.** The FSM sits inside the consumer's `step` callback. |

---

## Approach A: Pure Reducer + Flat Record (Canonical)

**Source pattern:** Pattern 1 (Flat FSM with Declarative Adjacency Table) + Pattern 4 (Redux/Elm Pure Reducer), combined.

**Signature sketch:**

```ts
// src/game-state/types.ts

/** Game mode — the five canonical platformer modes. */
export type GameMode =
  | 'menu'
  | 'playing'
  | 'paused'
  | 'gameover'
  | 'levelComplete';

/**
 * Events that drive transitions. Discriminated union — each event carries
 * only the payload relevant to its transition.
 */
export type GameEvent =
  | { type: 'start'; level?: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'die'; finalScore?: number }
  | { type: 'win'; finalScore?: number }
  | { type: 'retry' }
  | { type: 'next' }
  | { type: 'quit' };

/**
 * Game state — flat record. Consumer-owned, passed to and returned from
 * {@link reduceGameState}. All fields are present on every state variant
 * (flat-record default); consumers who want type-level safety can use
 * the optional {@link GameStateExact} type-only export.
 *
 * All fields are `readonly`. The reducer returns a fresh shallow-spread
 * object each call — `readonly` is compatible with the clone-then-return
 * discipline and reinforces the immutability contract (same pattern as
 * `JumpState`). Shallow-spread (not JSON-clone) is safe here because
 * `GameState` is a flat record of primitives — no nested objects.
 */
export interface GameState {
  /** Current game mode. */
  readonly current: GameMode;
  /** Seconds elapsed in the current mode. Reset to 0 on every legal transition. */
  readonly timeInState: number;
  /** Current level index (set by 'start' event, carried through transitions). */
  readonly level: number;
  /** Score carried through transitions (set by 'die'/'win' events). */
  readonly score: number;
  /** Final score set on gameover (set by 'die' event). */
  readonly finalScore: number;
}

/**
 * Transition table — plain data. Maps `(fromState, eventType) → nextState`.
 * A missing entry means the transition is illegal (silent no-op).
 *
 * @example
 * ```ts
 * const myTable = {
 *   ...DEFAULT_GAME_STATE_ADJACENCY,
 *   playing: { ...DEFAULT_GAME_STATE_ADJACENCY.playing, cutscene: 'playing' },
 * };
 * ```
 */
export type TransitionTable = Record<GameMode, Partial<Record<GameEvent['type'], GameMode>>>;

/**
 * Config for {@link createGameState}. All fields optional.
 */
export interface GameStateConfig {
  /** Starting level index. Default 0. */
  startingLevel?: number;
}
```

```ts
// src/game-state/game-state.ts

import type { GameEvent, GameState, GameStateConfig, TransitionTable } from './types';

/**
 * Default adjacency table for the canonical 5-state platformer FSM.
 *
 * Legal transitions:
 *   menu         → start            → playing
 *   playing      → pause            → paused
 *   playing      → win              → levelComplete
 *   playing      → die              → gameover
 *   paused       → resume           → playing
 *   paused       → quit             → menu
 *   gameover     → retry            → playing
 *   gameover     → quit             → menu
 *   levelComplete→ next             → playing
 *   levelComplete→ quit             → menu
 */
export const DEFAULT_GAME_STATE_ADJACENCY: TransitionTable = {
  menu:         { start: 'playing' },
  playing:      { pause: 'paused', win: 'levelComplete', die: 'gameover' },
  paused:       { resume: 'playing', quit: 'menu' },
  gameover:     { retry: 'playing', quit: 'menu' },
  levelComplete:{ next: 'playing', quit: 'menu' },
};

/**
 * Create a fresh game state in the `'menu'` mode with all fields zeroed.
 *
 * @param config - optional `{ startingLevel? }`; default level 0
 * @returns a new {@link GameState}
 */
export function createGameState(config?: GameStateConfig): GameState {
  return {
    current: 'menu',
    timeInState: 0,
    level: config?.startingLevel ?? 0,
    score: 0,
    finalScore: 0,
  };
}

/**
 * Pure reducer: advance game state by one fixed timestep.
 *
 * 1. Always advance `timeInState` by `dt`.
 * 2. If `event` is `null`/`undefined`, return the time-advanced state.
 * 3. Look up `(currentState, event.type)` in the transition table.
 * 4. If legal: transition to the new state, reset `timeInState` to 0,
 *    apply event payload to the returned state.
 * 5. If illegal: silent no-op — return the time-advanced state unchanged.
 *
 * **Determinism contract:** same `(state, event, dt, table?)` → byte-identical
 * returned state, forever. No `Math.random`, no `Date.now()`, no DOM.
 *
 * Pure: input is never mutated. A fresh {@link GameState} is returned every call.
 * Never throws.
 *
 * @param state  - current game state (not mutated)
 * @param event  - transition event, or `null`/`undefined` to just advance time
 * @param dt     - fixed timestep in seconds (from `advanceAccumulator`)
 * @param table  - custom transition table (defaults to {@link DEFAULT_GAME_STATE_ADJACENCY})
 * @returns a new {@link GameState}
 *
 * @example
 * ```ts
 * // In your step callback:
 * let gs = createGameState();
 * const event: GameEvent = { type: 'start', level: 3 };
 * gs = reduceGameState(gs, event, 1/60);
 * // gs.current === 'playing', gs.timeInState === 0, gs.level === 3
 * ```
 */
export function reduceGameState(
  state: GameState,
  event: GameEvent | null | undefined,
  dt: number,
  table: TransitionTable = DEFAULT_GAME_STATE_ADJACENCY,
): GameState {
  // 1. Advance time-in-state (always, even on illegal transitions).
  const stepDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const advanced: GameState = { ...state, timeInState: state.timeInState + stepDt };

  // 2. No event → just advance time.
  if (event === null || event === undefined) return advanced;

  // 3. Look up legal next state.
  const legalNext = table[state.current]?.[event.type];

  // 4. Illegal → silent no-op.
  if (legalNext === undefined) return advanced;

  // 5. Legal transition → apply payload, reset timeInState.
  const payload = extractPayload(event);
  return {
    ...advanced,
    ...payload,
    current: legalNext,
    timeInState: 0,
  };
}

/**
 * Pure reader: check whether a transition is legal without advancing state.
 *
 * @param from  - current game mode
 * @param event - transition event
 * @param table - custom transition table (defaults to {@link DEFAULT_GAME_STATE_ADJACENCY})
 * @returns `true` if the transition is legal
 */
export function isLegalTransition(
  from: GameMode,
  event: GameEvent,
  table: TransitionTable = DEFAULT_GAME_STATE_ADJACENCY,
): boolean {
  return table[from]?.[event.type] !== undefined;
}

/** Extract payload fields from a GameEvent (spread into the returned state). */
function extractPayload(event: GameEvent): Partial<GameState> {
  switch (event.type) {
    case 'start':  return { level: event.level ?? 0 };
    case 'die':    return { finalScore: event.finalScore ?? 0, score: event.finalScore ?? 0 };
    case 'win':    return { score: event.finalScore ?? 0 };
    default:       return {};
  }
}
```

```ts
// src/game-state/index.ts
export {
  DEFAULT_GAME_STATE_ADJACENCY,
  createGameState,
  reduceGameState,
  isLegalTransition,
} from './game-state';

export type {
  GameMode,
  GameEvent,
  GameState,
  TransitionTable,
  GameStateConfig,
} from './types';
```

**Usage example (driving menu→playing→paused→gameover):**

```ts
import {
  createGameState,
  reduceGameState,
  type GameEvent,
  type GameState,
} from './lib/aicraft-engine/src/game-state';

let gs: GameState = createGameState({ startingLevel: 0 });

function step(dt: number): void {
  // Poll input once per fixed step.
  const event: GameEvent | null = drainInputEvent();

  // Advance the FSM.
  gs = reduceGameState(gs, event, dt);

  // Consumer dispatches on state — the lifecycle.
  switch (gs.current) {
    case 'menu':
      updateMenu(gs, dt);
      break;
    case 'playing':
      world = stepWorld(world, input, dt);
      if (world.playerDead) {
        gs = reduceGameState(gs, { type: 'die', finalScore: world.score }, 0);
      }
      if (world.levelWon) {
        gs = reduceGameState(gs, { type: 'win', finalScore: world.score }, 0);
      }
      break;
    case 'paused':
      // Sim frozen — renderer keeps drawing the pause overlay.
      break;
    case 'gameover':
      updateGameOver(gs, dt);
      // Auto-transition to menu after 3 seconds:
      if (gs.timeInState >= 3) {
        gs = reduceGameState(gs, { type: 'quit' }, 0);
      }
      break;
    case 'levelComplete':
      updateLevelComplete(gs, dt);
      break;
  }
}
```

**Trade-offs:**

- **Ergonomics:** Excellent. `reduceGameState(gs, event, dt)` reads like English. The flat record means every field is always accessible — no narrowing needed. Consumer's `switch` on `gs.current` is the natural lifecycle pattern.
- **Determinism:** Perfect. Pure function, `dt`-driven, no host access. Same `(state, event, dt)` → same output forever.
- **Runtime cost:** O(1) per call — one object spread + one table lookup. Negligible.
- **Consumer complexity:** Low. Consumer owns the state, calls the reducer each tick, reads the result. No subscriptions, no lifecycle callbacks, no middleware.
- **Extensibility:** Strong. Custom states/events via spread-override: `{ ...DEFAULT_GAME_STATE_ADJACENCY, playing: { ...DEFAULT_GAME_STATE_ADJACENCY.playing, cutscene: 'playing' } }`. New states are just new keys in the table.
- **Convention fit:** Perfect. Matches `advanceJump`/`advanceTween`/`advanceEmitter` pure-reducer shape exactly. Flat record matches `EntitlementSave`/`CosmeticSave`. `DEFAULT_GAME_STATE_ADJACENCY` matches `DEFAULT_JUMP`/`DEFAULT_TWEEN_CONFIG` pattern.

**What this makes easy:**
- Unit-testing transitions (pure function, no setup/teardown)
- Replay-deterministic mode orchestration (same input → same state)
- Time-in-state driven UI (fade-ins, delayed transitions)
- Consumer composition (multiple `reduceGameState` calls for sub-FSMs)

**What this makes hard:**
- Type-level impossible-state prevention (flat record allows `{ current: 'menu', finalScore: 100 }`)
- Per-state typed payload (the flat record carries all fields always)

---

## Approach B: Discriminated-Union State + Payload Factory

**Source pattern:** Pattern 4 (Redux/Elm Pure Reducer with discriminated-union state shape).

**Signature sketch:**

```ts
// src/game-state/types.ts

/** Game mode — the five canonical platformer modes. */
export type GameMode =
  | 'menu'
  | 'playing'
  | 'paused'
  | 'gameover'
  | 'levelComplete';

/** Events that drive transitions. */
export type GameEvent =
  | { type: 'start'; level?: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'die'; finalScore?: number }
  | { type: 'win'; finalScore?: number }
  | { type: 'retry' }
  | { type: 'next' }
  | { type: 'quit' };

/**
 * Discriminated-union game state — each variant carries only the fields
 * valid in that mode. Prevents impossible states at the type level.
 *
 * @example
 * ```ts
 * const s: GameStateUnion = { current: 'playing', timeInState: 0, level: 1, score: 0 };
 * // s.finalScore → compile error (not valid in 'playing')
 * ```
 */
export type GameStateUnion =
  | { current: 'menu';          timeInState: number; level: number }
  | { current: 'playing';       timeInState: number; level: number; score: number }
  | { current: 'paused';        timeInState: number; level: number; score: number }
  | { current: 'gameover';      timeInState: number; level: number; score: number; finalScore: number }
  | { current: 'levelComplete'; timeInState: number; level: number; score: number; finalScore: number };

export type TransitionTable = Record<GameMode, Partial<Record<GameEvent['type'], GameMode>>>;

export interface GameStateConfig {
  startingLevel?: number;
}
```

```ts
// src/game-state/game-state.ts

import type { GameEvent, GameStateUnion, GameMode, TransitionTable, GameStateConfig } from './types';

export const DEFAULT_GAME_STATE_ADJACENCY: TransitionTable = { /* same as Approach A */ };

/**
 * Create a fresh game state in `'menu'` mode. Returns the discriminated-union
 * variant `{ current: 'menu', timeInState: 0, level: N }`.
 */
export function createGameState(config?: GameStateConfig): GameStateUnion {
  return { current: 'menu', timeInState: 0, level: config?.startingLevel ?? 0 };
}

/**
 * Pure reducer — same contract as Approach A but returns a discriminated-union
 * variant. On transition, constructs the target variant with only its valid
 * fields (no dead fields carried).
 */
export function reduceGameState(
  state: GameStateUnion,
  event: GameEvent | null | undefined,
  dt: number,
  table: TransitionTable = DEFAULT_GAME_STATE_ADJACENCY,
): GameStateUnion {
  const stepDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const timeInState = state.timeInState + stepDt;

  if (event === null || event === undefined) {
    // Advance time, preserving the current variant's shape.
    return { ...state, timeInState } as GameStateUnion;
  }

  const legalNext = table[state.current]?.[event.type];
  if (legalNext === undefined) {
    return { ...state, timeInState } as GameStateUnion;
  }

  // Construct the target variant with only valid fields.
  return createVariant(legalNext, event, state.level);
}

function createVariant(
  mode: GameMode,
  event: GameEvent,
  inheritedLevel: number,
): GameStateUnion {
  const base = { timeInState: 0, level: inheritedLevel };
  switch (mode) {
    case 'menu':
      return { ...base, current: 'menu' };
    case 'playing':
      return { ...base, current: 'playing', score: 0 };
    case 'paused':
      return { ...base, current: 'paused', score: 0 };
    case 'gameover': {
      const finalScore = event.type === 'die' ? (event.finalScore ?? 0) : 0;
      return { ...base, current: 'gameover', score: finalScore, finalScore };
    }
    case 'levelComplete': {
      const finalScore = event.type === 'win' ? (event.finalScore ?? 0) : 0;
      return { ...base, current: 'levelComplete', score: finalScore, finalScore };
    }
  }
}

export function isLegalTransition(
  from: GameMode,
  event: GameEvent,
  table: TransitionTable = DEFAULT_GAME_STATE_ADJACENCY,
): boolean {
  return table[from]?.[event.type] !== undefined;
}
```

**Trade-offs:**

- **Ergonomics:** Good at the type level (impossible states are compile errors), but the consumer must narrow the union to access variant-specific fields (`if (gs.current === 'gameover') { gs.finalScore }`). Slightly more cognitive overhead than the flat record.
- **Determinism:** Perfect — same as Approach A.
- **Runtime cost:** Same O(1). The discriminated-union type erases at compile time.
- **Consumer complexity:** Moderate. The consumer must handle every variant in their `switch` or use type narrowing. The reducer's internal `createVariant` switch adds implementation complexity.
- **Extensibility:** Weaker. Adding a new state means adding a new variant to the union AND updating `createVariant`. Spread-override on the adjacency table works, but the union type must be manually extended.
- **Convention fit:** Partial. The discriminated-union shape does NOT match existing modules (`EntitlementSave`, `CosmeticSave` are flat records). The `createVariant` factory is more complex than the simple spread in Approach A.

**What this makes easy:**
- Compile-time prevention of impossible states (`{ current: 'menu', finalScore: 100 }` is a type error)
- Variant-specific field access after narrowing

**What this makes hard:**
- Adding new states (must update the union + factory)
- Spread-override of the adjacency table (union type doesn't extend cleanly)
- Consumer code that accesses cross-variant fields (e.g., `score` in both `playing` and `gameover`)

---

## Approach C: Hybrid — Flat Record Default + Type-Only Discriminated Union Export

**Source pattern:** Pattern 1 (Flat FSM) + Pattern 4 (Redux/Elm), hybridized.

**Signature sketch:**

```ts
// src/game-state/types.ts

export type GameMode =
  | 'menu'
  | 'playing'
  | 'paused'
  | 'gameover'
  | 'levelComplete';

export type GameEvent =
  | { type: 'start'; level?: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'die'; finalScore?: number }
  | { type: 'win'; finalScore?: number }
  | { type: 'retry' }
  | { type: 'next' }
  | { type: 'quit' };

/**
 * Flat-record game state — the runtime default. All fields present on every
 * variant. Matches existing modules (`EntitlementSave`, `CosmeticSave`).
 */
export interface GameState {
  current: GameMode;
  timeInState: number;
  level: number;
  score: number;
  finalScore: number;
}

/**
 * TYPE-ONLY discriminated union. Same runtime shape as {@link GameState},
 * but each variant carries only its valid fields. Use with `as` casts or
 * in generic type parameters for compile-time safety.
 *
 * This type is NOT used at runtime — it exists purely for consumers who
 * want type-level impossible-state prevention without changing the runtime
 * shape.
 *
 * @example
 * ```ts
 * // Type-only usage — no runtime cost:
 * function handleState(s: GameStateExact) {
 *   switch (s.current) {
 *     case 'gameover': console.log(s.finalScore); } // ✓
 *     case 'menu':     console.log(s.finalScore); } // ✗ compile error
 *   }
 * }
 * ```
 */
export type GameStateExact =
  | { current: 'menu';          timeInState: number; level: number; score?: never; finalScore?: never }
  | { current: 'playing';       timeInState: number; level: number; score: number; finalScore?: never }
  | { current: 'paused';        timeInState: number; level: number; score: number; finalScore?: never }
  | { current: 'gameover';      timeInState: number; level: number; score: number; finalScore: number }
  | { current: 'levelComplete'; timeInState: number; level: number; score: number; finalScore: number };

export type TransitionTable = Record<GameMode, Partial<Record<GameEvent['type'], GameMode>>>;

export interface GameStateConfig {
  startingLevel?: number;
}
```

```ts
// src/game-state/game-state.ts
// IDENTICAL implementation to Approach A. The reducer returns the flat record.
// The consumer optionally casts to GameStateExact for type narrowing.
```

**Trade-offs:**

- **Ergonomics:** Best of both worlds. Flat record for simple access; discriminated union for type safety. Consumer chooses their level of strictness.
- **Determinism:** Perfect — same as Approach A.
- **Runtime cost:** Same O(1). The `GameStateExact` type erases at compile time.
- **Consumer complexity:** Low (flat record default) to moderate (opt-in discriminated union). The consumer decides.
- **Extensibility:** Strong. Flat record is trivially extensible. The type-only union is a convenience, not a constraint.
- **Convention fit:** Perfect. Flat record matches existing modules. The type-only union is an additive type export, not a new runtime shape.

**What this makes easy:**
- Everything Approach A makes easy
- Optional type-level safety for consumers who want it
- No runtime shape change — the type-only union is a compile-time alias

**What this makes hard:**
- Consumers must understand that `GameStateExact` is type-only (not a runtime type)
- The `? : never` trick for unused fields is a TypeScript idiom that may confuse some consumers

---

## Comparison Table

| Criterion | A: Flat Record | B: Discriminated Union | C: Hybrid |
|---|---|---|---|
| **Ergonomics** | ★★★ All fields always accessible | ★★ Requires narrowing for variant-specific fields | ★★★ Flat record default, union opt-in |
| **Determinism** | ★★★ Perfect | ★★★ Perfect | ★★★ Perfect |
| **Runtime cost** | ★★★ O(1), 1 spread + 1 lookup | ★★★ O(1), same | ★★★ O(1), same |
| **Type safety** | ★★ Flat record allows impossible states | ★★★ Compile-time prevention | ★★★ Opt-in type safety |
| **Extensibility** | ★★★ Spread-override trivial | ★★ Must update union + factory | ★★★ Spread-override + optional union |
| **Convention fit** | ★★★ Matches existing modules | ★★ New shape, not in existing modules | ★★★ Matches + additive type |
| **Implementation complexity** | ★★★ Simple spread + lookup | ★★ Factory switch per variant | ★★★ Same as A + type export |
| **Consumer learning curve** | ★★★ Obvious | ★★ Must learn narrowing | ★★★ Obvious, union optional |

---

## Recommendation

**Approach A (Pure Reducer + Flat Record)** is the primary recommendation, with the discriminated-union type-only export from Approach C shipped as an additive type export.

**Reasoning:** Approach A is the simplest shape that matches every existing module in the library (`advanceJump`, `advanceTween`, `advanceEmitter`, `grantEntitlement`, `createHitStop`). The flat record is the convention; introducing a discriminated-union runtime shape would be the first of its kind in the codebase and would create a precedent that future modules might feel compelled to follow. The type-only `GameStateExact` export from Approach C is a zero-cost additive — consumers who want type safety can use it, consumers who don't can ignore it. But the runtime reducer returns the flat record.

The key insight from the reference `stepSession` (line 317-357) is that the consumer's `switch` on `scene` already handles every variant — the FSM just needs to provide the data, not enforce the type narrowing. The consumer game accesses `state.score`, `state.status`, and `state.winTimer` across multiple scenes — a flat record makes this trivial. A discriminated union would force narrowing at every access point.

---

## Open Questions for @architect

1. **Flat record vs discriminated union as the DEFAULT export.** I recommend flat record (Approach A) because it matches every existing module. The architect should pressure-test whether the type-safety benefit of Approach B justifies breaking the convention.

2. **`timeInState` granularity.** The reducer advances `timeInState` by `dt` (seconds). Should the consumer also get a `tickCount` (integer increment per call) for tick-precise delays? I chose no — `timeInState` with seconds is sufficient and matches the `advanceJump` convention (all timers in seconds). But tick-counting is trivially composable by the consumer (`if (gs.timeInState % (1/60) < dt) tick++`).

3. **Payload on `start` event.** I defined `level?: number` on the `start` event. Should there be additional payload (e.g., `seed` for procedural levels, `difficulty`)? I chose minimal v1 payload — consumers can store additional data in their own state alongside the FSM state. The architect should confirm this is sufficient for the reference implementation's needs.

4. **Self-transition semantics for `pause`/`resume`.** Dispatching `pause` while already `paused` is illegal (silent no-op). But the reference implementation's current code does `s.paused = !s.paused` (toggle). Should the FSM ship a `togglePause` event that dispatches `pause` or `resume` based on current state? I chose no — the consumer can implement toggle in one line: `gs = reduceGameState(gs, { type: gs.current === 'paused' ? 'resume' : 'pause' }, 0)`. The architect should confirm this is ergonomic enough.

5. **Module directory name.** I chose `game-state/` over `fsm/` because it describes what the module manages (game state orchestration) rather than the internal mechanism (finite state machine). It also matches the reference implementation's naming: `Scene`, `GameSession`, `GameStatus`. The architect should confirm.

---

## Implementation Notes for @coder

1. **File structure:** `src/game-state/types.ts`, `src/game-state/game-state.ts`, `src/game-state/index.ts`. Tests in `src/tests/game-state.test.ts`.
1a. **Top-level barrel:** Add `export * from './game-state';` to `src/index.ts` (top-level barrel), placed near the other Pillar 1 exports (e.g. after `./game-loop`).
2. **JSDoc:** Every public export must have JSDoc with `@param` and `@returns` tags. The `@module` tag goes on `game-state.ts`.
3. **No magic numbers:** The default `startingLevel` (0) is a documented default in `GameStateConfig`, not a magic number.
4. **Determinism:** The reducer is deterministic core — no `try/catch`, no host access, no `Date.now()`. All `dt`-driven.
5. **Pure progression ops:** Input is never mutated. A fresh `GameState` is returned every call. Shallow-spread, not JSON-clone (the state is flat, no nested objects).
6. **Illegal transitions:** Silent no-op. Never throw. `timeInState` keeps advancing.
7. **Self-transitions:** Treated as illegal (no-op). `timeInState` keeps advancing. Consumer detects "just entered" via `timeInState === 0` after a legal transition.
8. **`isLegalTransition` reader:** Pure, no `dt`, no state mutation. Takes `(from, event, table?)`.
9. **`DEFAULT_GAME_STATE_ADJACENCY`:** Exported as `const` so consumers can spread it.
10. **Game-loop module:** NO changes to `GameLoopConfig.step` or `fixed-step.ts`.
