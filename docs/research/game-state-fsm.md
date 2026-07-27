# Game-State FSM (Top-Level Mode Orchestration)

> Research note for a top-level game-state finite-state machine (menu / playing / paused / gameover / levelComplete orchestration). Slug: `game-state-fsm`.
> Investigated: 2026-07-27.

## TL;DR

The library has a fixed-step loop (`src/game-loop/fixed-step.ts`) that drives a simulation, but no high-level mode orchestration — the consumer currently has to roll their own `if (paused) return` / `if (gameOver) ...` flags every tick. This note surveys flat FSMs vs hierarchical state machines vs behavior trees, the Phaser/Godot/Unity top-level lifecycle patterns, the Redux/Elm pure-reducer discipline, and the existing pure-progression-ops shape in `src/cosmetics/ownership.ts` and `src/iap/entitlements.ts`. The recommendation is a **flat FSM** (5–7 modes is well within FSM scope; HSM and BT are over-engineering for a top-level game mode machine), with a **declarative adjacency table as data**, a **pure `(state, event, dt) → state` reducer** that lives inside the consumer's `step(fixedDt)` callback (the loop module stays untouched), **time-in-state advanced by `dt`** (never `Date.now()`), and **minimal payload** on transitions in v1 (a discriminated union per event type, payload fields stored on the returned state — not side-channel arguments). The FSM is deterministic-core (no host access, no defensive adapter needed); the consumer's `step` reads the FSM state to decide whether to advance the sim, so pause is a state, not a loop pause.

## Why this matters for aicraft-engine

- **Pillars Touched**: Extends **Pillar 1 (Primitives / Game Loop)**. Composes with the existing fixed-step accumulator, the particle-emitter state facade (`createEmitter` / `stepEmitters`), the easing tween driver (`createTweenState` / `advanceTween`), and the jump state machine (`createJumpState` / `advanceJump`). It is the missing connective tissue that lets a consumer wire all of these into a coherent game.
- **Consumer Games**: Spitekeep (renamed IMP - Not a Troll) and every future Clone-to-Jest title. Every shipped game needs menu / playing / paused / gameover orchestration — currently every consumer reimplements it.
- **Unlocks**:
  - **Replay-deterministic mode orchestration.** A pure reducer advanced by fixed `dt` means the same input sequence yields the same state sequence on every machine — the foundation for input-replay files, save-restore, and rollback netcode.
  - **Composable pause semantics.** The FSM's `paused` state is the single source of truth for "should the sim advance this tick?" — the consumer's `step` reads it and short-circuits. The loop's `visibilitychange` pause is orthogonal (it pauses the loop; the FSM pause pauses the sim within the loop).
  - **Time-in-state for fade-ins and delayed transitions.** A `dt`-driven `timeInState` field on the returned state lets consumers drive menu fade-ins, "press any key to continue" prompts, and gameover-to-menu delays without touching `Date.now()`.
  - **Declarative adjacency table as data.** The legal-transitions table is plain data — consumers can serialize it, edit it in a level editor, or unit-test it without instantiating the FSM.

---

## Prior Art Survey

### Pattern 1: Flat FSM with Declarative Adjacency Table (the canonical shape)

- **Source**: Jake Gordon's [JavaScript Game Foundations — State Management](https://jakesgordon.com/writing/javascript-game-foundations-state-management/) (the foundational pattern for browser games); the `javascript-state-machine` library (jakesgordon, MIT); Matt Pocock's [`use-fsm-reducer`](https://github.com/mattpocock/use-fsm-reducer) (Khourshid-inspired, MIT); the [XState](https://xstate.js.org/) finite-state-machine subset (`@xstate/fsm`, MIT).
- **What it does**: The state set is a closed enum (`'menu' | 'playing' | 'paused' | 'gameover' | 'levelComplete'`). Legal transitions are encoded as a flat lookup table — `Record<State, Partial<Record<Event, State>>>` — and the reducer looks up `(currentState, event)` to find the next state. Illegal transitions are silent no-ops (the FSM stays in the current state). This is the simplest possible FSM shape and the one that matches the library's pure-progression-ops discipline.
- **Algorithmic shape** (the canonical reducer):

```typescript
// The adjacency table — plain data, serialisable, unit-testable.
const ADJACENCY: Record<GameState, Partial<Record<GameEvent, GameState>>> = {
  menu:         { start: 'playing' },
  playing:      { pause: 'paused', win: 'levelComplete', die: 'gameover' },
  paused:       { resume: 'playing', quit: 'menu' },
  gameover:     { retry: 'playing', quit: 'menu' },
  levelComplete:{ next: 'playing', quit: 'menu' },
};

// The pure reducer — same discipline as advanceJump / advanceTween / advanceEmitter.
function reduceGameState(
  state: GameState,
  event: GameEvent | null,    // null = "no event this tick, just advance time"
  dt: number,                 // from the fixed-step loop's step(fixedDt)
): GameState {
  // 1. Advance time-in-state (always, even with no event).
  const next: GameState = { ...state, timeInState: state.timeInState + dt };
  // 2. If no event, return the time-advanced state.
  if (event === null) return next;
  // 3. Look up the legal next state for (currentState, event).
  const legalNext = ADJACENCY[state.current][event];
  // 4. If legal, transition (reset timeInState). If illegal, silent no-op.
  if (legalNext !== undefined) {
    return { ...next, current: legalNext, timeInState: 0 };
  }
  return next;
}
```

- **Determinism profile**: Pure. No `Math.random`, no `Date.now()`, no DOM, no globals. Same `(state, event, dt)` → same returned state. Replay-deterministic when `dt` comes from the fixed-step accumulator.
- **Runtime cost**: O(1) per call — one object spread + one table lookup. Negligible.
- **Dependencies**: None. Pure data + a pure function.
- **Fit for our constraints**: **Strong.** This shape mirrors `advanceJump` (pure reducer, consumer-owned state, `dt`-driven), `advanceTween` (same), `advanceEmitter` (same), and `grantEntitlement` (immutable in, fresh out, never throws). The adjacency table is the FSM analog of `DEFAULT_JUMP` / `DEFAULT_TWEEN_CONFIG` — declarative config the consumer can spread.
- **What to steal**: The lookup-table shape. The "no event = just advance time" convention (lets the consumer call the reducer every tick, not just on events). The silent-no-op-on-illegal-transition rule (matches the library's "invalid types are coerced or ignored, never thrown" convention from `docs/conventions.md`).
- **What to avoid**: Don't add `enter` / `exit` callbacks to the FSM itself. The FSM is a pure reducer; the consumer reads `state.current` in their `step` and dispatches to their own state handlers (mirrors how `advanceJump` exposes `state.phase` for the consumer to read, not for the library to act on). Don't add a `subscribe` / observer pattern — that's host-touching and belongs in the consumer.

### Pattern 2: Phaser Scene Lifecycle (Boot / Preload / Create / Update / Shutdown)

- **Source**: [Phaser 3 Scene Manager docs](https://docs.phaser.io/phaser/concepts/scenes) (MIT); the [Phaser FSM tutorial](https://osmose.ceo/blog/phaser-finite-state-machine/) (open-source); the [Phaser best-practices scenes reference](https://github.com/onmax/nuxt-skills/blob/main/skills/phaser-best-practices/references/scenes-state-architecture.md).
- **What it does**: Phaser 3 replaced Phaser 2's "States" with "Scenes" specifically to disambiguate from state machines. Each Scene has a lifecycle: `init(data) → preload() → create() → update(time, delta) → shutdown()`. The Scene Manager runs multiple Scenes in parallel (e.g., a `Game` scene + a `HUD` scene + a `Pause` scene on top), each with its own state. The recommended scene split for a platformer is `BootScene / MenuScene / GameScene / UIScene / PauseScene / GameOverScene`. Each scene can be `pause`d (still renders, doesn't update), `sleep`d (neither), `stop`ped (shuts down, can restart), or `remove`d (destroyed, can't restart).
- **Algorithmic shape** (the consumer-side wiring the FSM enables):

```typescript
// Consumer's step callback — the FSM state drives what runs.
function step(dt: number): void {
  const event = drainInputEvents();  // poll input ONCE per fixed step
  gameState = reduceGameState(gameState, event, dt);

  switch (gameState.current) {
    case 'menu':         updateMenu(gameState, dt);   break;
    case 'playing':      updatePlaying(gameState, dt); break;
    case 'paused':       /* sim frozen */              break;
    case 'gameover':     updateGameOver(gameState, dt); break;
    case 'levelComplete':updateLevelComplete(gameState, dt); break;
  }
}
```

- **Determinism profile**: Phaser's `update(time, delta)` receives a variable `delta` (frame time, not fixed). The FSM must NOT use this `delta` — it must use the fixed `dt` from the loop. Phaser's Scene lifecycle is host-touching (it manages DOM, RAF, audio contexts); the FSM is not.
- **Runtime cost**: O(1) per scene per frame. Phaser can run dozens of scenes in parallel; the FSM is a single state value, so it's strictly cheaper.
- **Dependencies**: None. Phaser is the reference, not a dependency.
- **Fit for our constraints**: **Medium-strong for the lifecycle shape, weak for the scene-as-class shape.** The lifecycle (`init → create → update → shutdown`) is the right mental model, but Phaser's "Scene is a class with methods" doesn't fit our pure-function discipline. The FSM captures the lifecycle as data: `state.current` is the "scene", `state.timeInState` is the "time since scene started", and the consumer's `switch` is the "update method". The FSM is the data; the consumer's `switch` is the behavior.
- **What to steal**: The scene-as-data mental model. The `pause` / `sleep` / `stop` distinction (we collapse it: the FSM has a `paused` state, and the consumer's `step` short-circuits). The "scenes as top-level game modes, not as random code buckets" anti-pattern warning — the FSM's `current` field is the single source of truth for "what mode is the game in right now?"
- **What to avoid**: Don't model scenes as objects with methods. Don't add a Scene Manager that runs multiple FSMs in parallel (the consumer can compose multiple FSMs themselves if they need to — e.g., a top-level mode FSM + a sub-FSM for the player's ability state, mirroring the platformer-kernel research note's "State-Machine-Driven Ability Composition Pattern"). Don't add `enter` / `exit` lifecycle methods to the FSM — the consumer's `switch` is the lifecycle.

### Pattern 3: Godot 4 State Machine Node (SceneTree-based)

- **Source**: [Godot 4 StateMachine tutorial](https://ziva.sh/blogs/godot-state-machine); the [Lost Dune platformer paper](https://www.irejournals.com/formatedpaper/1714549.pdf) (Godot 4 FSM case study); the [Godot `StateMachine` reference](https://docs.godotengine.org/en/stable/classes/class_state_machine.html).
- **What it does**: Godot's recommended pattern is a `StateMachine` node that holds child `State` nodes. Each `State` is a node with `enter()`, `exit()`, `update(delta)`, `physics_update(delta)` methods. The `StateMachine` calls `current_state.exit()` then `current_state.enter()` on transition. The Godot docs explicitly warn against using `AnimationTree`'s state machine for game logic (it's for animation blending only) and recommend a code-based FSM for gameplay.
- **Algorithmic shape** (the Godot `StateMachine` node script, simplified):

```gdscript
class_name StateMachine extends Node
@export var initial_state: State
var current_state: State

func _ready() -> void:
    current_state = initial_state
    current_state.enter()

func _physics_process(delta: float) -> void:
    current_state.physics_update(delta)

func transition_to(target_state_name: String) -> void:
    var target_state := get_node_or_null(target_state_name) as State
    if target_state == null: return
    if target_state == current_state: return
    current_state.exit()
    current_state = target_state
    current_state.enter()
```

- **Determinism profile**: Godot's `_physics_process(delta)` uses a fixed `delta` (default 60 Hz, configurable). This is the closest analog to our fixed-step loop. The FSM is deterministic if `delta` is fixed.
- **Runtime cost**: O(1) per tick. Godot's node-based overhead is higher than our pure-function approach (node lookup, signal dispatch).
- **Dependencies**: None (Godot is the reference, not a dependency).
- **Fit for our constraints**: **Medium.** Godot's node-based pattern is the right mental model but doesn't fit our zero-dep, pure-function discipline. We can capture the same semantics — `enter` / `exit` / `update` lifecycle, fixed-dt advancement, explicit transition table — without the node overhead. The Godot tutorial's "if your `StateMachine` script is longer than 30 lines, you are probably putting logic in the wrong place" warning is directly applicable: the FSM module should be small (the reducer + the adjacency table + a factory), and all per-state logic lives in the consumer's `switch`.
- **What to steal**: The `enter` / `exit` lifecycle mental model (we expose it as `state.timeInState === 0` after a transition — the consumer's `switch` can detect "just entered this state" by checking `timeInState === 0`). The "fixed `_physics_process` for FSM, variable `_process` for rendering" split (mirrors our `step(fixedDt)` for FSM, `render(alpha)` for rendering). The "transition table is data, not code" principle.
- **What to avoid**: Don't add `enter` / `exit` callbacks to the FSM (the consumer owns the lifecycle). Don't add a node-based or class-based state representation (we use plain data + a pure function). Don't add signal/event dispatch (the consumer polls input and calls `reduceGameState` with the event).

### Pattern 4: Redux / Elm Pure Reducer (`(state, action) → state`)

- **Source**: [Redux is half of a pattern (1/2)](https://stately.ai/blog/2020-01-20-redux-is-half-a-pattern-1-2) (Stately blog, the foundational "treat your reducer as a state machine" essay); [Pragmatic types: Redux as Finite State Machine](https://dev.to/stereobooster/pragmatic-types-how-to-turn-redux-to-finite-state-machine-with-the-help-of-types-5f08) (the discriminated-union state shape); the [Elm Architecture](https://guide.elm-lang.org/architecture/) (`update : Msg -> Model -> (Model, Cmd Msg)`).
- **What it does**: A reducer is a pure function `(state, action) → state`. The Redux style guide explicitly recommends treating reducers as state machines: "the combination of both the current state and the dispatched action determines whether a new state value is actually calculated, not just the action itself unconditionally." The Elm `update` function adds an `Effect` return value for side-effects (network requests, audio), but the state itself is pure. The discriminated-union state shape (each state has its own type with only the fields valid in that state) prevents impossible states at the type level.
- **Algorithmic shape** (the Elm-style update with effects, adapted to our `dt`-driven model):

```typescript
// The discriminated-union state shape — each state has only the fields valid in it.
type GameState =
  | { current: 'menu';          timeInState: number }
  | { current: 'playing';       timeInState: number; level: number; score: number }
  | { current: 'paused';        timeInState: number; level: number; score: number }
  | { current: 'gameover';      timeInState: number; finalScore: number; level: number }
  | { current: 'levelComplete'; timeInState: number; finalScore: number; level: number };

// The reducer — pure, advances time, validates transitions.
function reduceGameState(state: GameState, event: GameEvent | null, dt: number): GameState {
  // Always advance time-in-state first.
  const advanced: GameState = { ...state, timeInState: state.timeInState + dt } as GameState;
  if (event === null) return advanced;
  // Validate the transition against the adjacency table.
  const next = ADJACENCY[state.current][event];
  if (next === undefined) return advanced;  // illegal = silent no-op
  return INITIAL_STATES[next];  // transition resets timeInState, carries payload fields
}
```

- **Determinism profile**: Pure. No `Math.random`, no `Date.now()`, no DOM. Same `(state, event, dt)` → same returned state. This is the same determinism profile as `advanceJump`, `advanceTween`, and `grantEntitlement`.
- **Runtime cost**: O(1) per call. The discriminated-union type adds zero runtime cost (TypeScript types erase at compile time).
- **Dependencies**: None.
- **Fit for our constraints**: **Strong.** This is the closest match to our existing pure-progression-ops discipline. The discriminated-union state shape is a strict superset of the flat-record shape — both are valid, but the discriminated union catches impossible states at compile time. The Elm `Effect` return value is NOT a fit for v1 (effects are host-touching; the consumer composes them at their own boundary, mirroring how `flushIAPEvents` returns `GrantDescriptor[]` for the consumer to apply).
- **What to steal**: The pure `(state, action) → state` shape. The "treat the reducer as a state machine" discipline (validate transitions against the current state, not just the action). The discriminated-union state shape as an OPTIONAL type-level safety net (the flat-record shape is the runtime default; the discriminated union is a type-only export consumers can opt into).
- **What to avoid**: Don't add an `Effect` return value (effects belong to the consumer). Don't add middleware / thunk / saga patterns (the consumer composes side-effects at their own boundary). Don't add a `subscribe` / observer pattern (host-touching). Don't add a `dispatch` function (the consumer calls `reduceGameState` directly).

### Pattern 5: Behavior Trees vs FSM (when NOT to use an FSM)

- **Source**: [Opsive: FSM vs Behavior Trees](https://opsive.com/support/documentation/behavior-designer-pro/concepts/behavior-trees-vs-finite-state-machines/); [Socratopia: FSM vs Behavior Tree vs Hybrid](https://www.socratopia.app/library/game-ai-patterns-en/chapter-10); the [arxiv BT vs FSM comparison paper](https://doi.org/10.48550/arxiv.2405.16137) (Iovino et al., 2024).
- **What it does**: Behavior Trees (BTs) are a decision-making system optimized for dynamic, reactive, priority-based behavior selection. FSMs are a state-control system optimized for stable modes with explicit transitions. The Socratopia diagnostic gives a six-question check: 1–3 modes → FSM unambiguously; 4–8 modes → FSM or HFSM; 9–15 modes → HFSM or BT; 16+ modes → BT with FSM at the leaves. The arxiv paper confirms that FSMs are simpler to conceive for short tasks; BTs scale better for complex, reactive tasks.
- **Algorithmic shape**: Not applicable — BTs are a different paradigm. The key takeaway is the diagnostic: **for a top-level game-mode FSM with 5–7 modes, a flat FSM is unambiguously the right choice.**
- **Determinism profile**: BTs can be deterministic if the tree structure is fixed and conditions are pure. FSMs are simpler to make deterministic (no tree traversal, no condition evaluation order).
- **Runtime cost**: FSMs are O(1) per tick (table lookup). BTs are O(N) per tick (tree traversal, condition evaluation).
- **Dependencies**: None (BTs are the reference, not a dependency).
- **Fit for our constraints**: **N/A for v1.** The top-level game-mode FSM has 5–7 modes — flat FSM is the correct choice per the diagnostic. BTs would be over-engineering. Sub-FSMs (e.g., the player's ability state machine in the platformer-kernel research note) might benefit from BTs at much higher complexity, but that's a separate module.
- **What to steal**: The diagnostic itself — it's the justification for choosing flat FSM over HSM/BT. The "FSMs at the leaves, BT at the supervisor" hybrid pattern (relevant if we ever add a BT module for AI).
- **What to avoid**: Don't add a BT module to this research. Don't add HSM (hierarchical) nesting to the top-level FSM — the 5–7 modes don't need it. Don't add pushdown automata (stack-based FSMs) — the `paused` state handles the common case of "pause and resume" without needing a stack.

### Pattern 6: Time-in-State and Delayed Transitions

- **Source**: [Godot 4 State Machine tutorial](https://ziva.sh/blogs/godot-state-machine) ("When you need to track how long you have been in a state, run one-time setup when entering a state, or clean up when leaving a state"); the [Celeste Player state machine](https://github.com/NoelFB/Celeste/blob/master/Source/Player/Player.cs) (timer-based cooldowns driven by fixed `dt`); the [Lost Dune paper](https://www.irejournals.com/formatedpaper/1714549.pdf) (FSM with `timeInState` for delayed transitions).
- **What it does**: Every state tracks `timeInState` (seconds elapsed in the current state). The reducer increments it by `dt` every tick. On transition, it resets to 0. Consumers use `timeInState` to drive fade-ins (alpha curve over the first 0.3s of `menu`), delayed transitions ("press any key to continue" after 2s in `gameover`), and one-shot setup ("just entered `playing` — reset the level").
- **Algorithmic shape** (the time-in-state advancement, lifted from the reducer):

```typescript
// Inside reduceGameState:
const advanced: GameState = { ...state, timeInState: state.timeInState + dt };
// On transition:
return { ...INITIAL_STATES[next], timeInState: 0 };  // reset on entry
```

- **Determinism profile**: Pure. `timeInState` is a number advanced by `dt` — no `Date.now()`, no `performance.now()`. Replay-deterministic.
- **Runtime cost**: O(1) per tick. One addition per call.
- **Dependencies**: None.
- **Fit for our constraints**: **Strong.** This is the same pattern as `advanceJump`'s `coyoteTimer` / `jumpBufferTimer` / `anticipationTimer` — `dt`-driven timers that the consumer reads. The `timeInState` field is the most generic of these timers (it works for any state, not just `jump`).
- **What to steal**: The `timeInState` field on the state. The "reset to 0 on transition" rule. The "consumer reads `timeInState === 0` to detect 'just entered this state'" pattern (no `enter` callback needed).
- **What to avoid**: Don't add per-state named timers (e.g., `menuFadeInTimer`, `gameoverDelayTimer`) — the consumer composes them from `timeInState` and their own config. Don't add a `scheduleTransition(state, event, delaySeconds)` API — the consumer drives delayed transitions by checking `timeInState >= delay` in their `step` and calling `reduceGameState` with the event.

### Pattern 7: Pause Semantics (FSM-driven vs Loop-driven)

- **Source**: [Godot 4 Pause & Main Menu tutorial](https://dev.to/christinec_dev/learn-godot-4-by-making-a-2d-platformer-part-19-pause-main-menu-2hoe) (`get_tree().paused = true`); [sebadorn's js13k 2020 postmortem](https://sebadorn.de/2020/09/27/and-then-it-was-gone-notes-about-developing-my-js13k-entry-of-2020) ("When paused, the game renders the pause screen once and then stops the main loop — no updates, no rendering"); the library's own `src/game-loop/fixed-step.ts` (the loop already pauses on `visibilitychange`).
- **What it does**: There are two distinct pause mechanisms:
  1. **Loop pause** (the library's `visibilitychange` handler): the loop stops calling `step` and `render`. The sim and the renderer both freeze. This is for tab-hidden / background scenarios.
  2. **FSM pause** (the `paused` state): the loop keeps running, but the consumer's `step` reads `state.current === 'paused'` and short-circuits — the sim doesn't advance, but the renderer keeps drawing (for the pause menu overlay). This is for user-initiated pause.
- **Algorithmic shape** (the consumer's `step` with both pause mechanisms):

```typescript
function step(dt: number): void {
  // The loop's visibilitychange pause is already handled — if the tab is hidden,
  // step() is not called. So we only need to handle FSM pause here.
  const event = drainInputEvents();
  gameState = reduceGameState(gameState, event, dt);

  // FSM pause: the sim doesn't advance, but the loop keeps running.
  if (gameState.current === 'paused') {
    return;  // sim frozen, but the consumer's render() still draws the pause overlay
  }

  // Sim advances only in 'playing'.
  if (gameState.current === 'playing') {
    world = stepWorld(world, input, dt);
  }
}
```

- **Determinism profile**: Pure. The FSM's `paused` state is just a state value; the consumer's `step` reads it. No host access.
- **Runtime cost**: O(1) per tick. One comparison + one early return.
- **Dependencies**: None.
- **Fit for our constraints**: **Strong.** This is the cleanest separation: the loop handles tab-hidden pause (host-touching, defensive adapter), the FSM handles user-pause (deterministic core, pure reducer). The two are orthogonal — the consumer can be in `paused` while the tab is visible, and the loop can be paused (tab hidden) while the FSM is in `playing`.
- **What to steal**: The "FSM pause is a state, not a loop pause" principle. The "sim advances only in `playing`" convention. The "renderer keeps drawing during FSM pause" rule (for the pause menu overlay).
- **What to avoid**: Don't add a `pause()` / `resume()` method to the FSM (the consumer dispatches `pause` / `resume` events through the reducer). Don't add a `isPaused()` reader (the consumer reads `state.current === 'paused'`). Don't modify the loop module — the FSM sits inside the consumer's `step`, not in the loop.

---

## Reference Implementations

| Source | What it teaches | URL |
|---|---|---|
| **Jake Gordon's State Management** | The foundational pattern for browser-game FSMs with declarative adjacency tables and event-driven transitions. The `javascript-state-machine` library is the canonical open-source implementation. | https://jakesgordon.com/writing/javascript-game-foundations-state-management/ |
| **Matt Pocock's `use-fsm-reducer`** | Khourshid-inspired FSM-as-reducer for React. Shows the discriminated-union state shape and the `Effect` return value pattern (we skip effects in v1). | https://github.com/mattpocock/use-fsm-reducer |
| **XState (`@xstate/fsm`)** | The minimal FSM subset of XState (MIT, zero deps). Shows the pure `machine.transition(state, event)` API — the closest analog to our `reduceGameState`. We deliberately ship a smaller, zero-dep version. | https://xstate.js.org/ |
| **Phaser 3 Scene Manager** | The lifecycle pattern (`init → preload → create → update → shutdown`) and the scene-as-data mental model. The FSM captures this as data, not as classes. | https://docs.phaser.io/phaser/concepts/scenes |
| **Godot 4 State Machine tutorial** | The `enter` / `exit` / `update` lifecycle and the "if your StateMachine script is longer than 30 lines, you're putting logic in the wrong place" warning. Directly applicable to our module size budget. | https://ziva.sh/blogs/godot-state-machine |
| **Redux is half of a pattern (Stately blog)** | The foundational essay on "treat your reducer as a state machine." The Redux style guide's explicit recommendation to validate transitions against `(currentState, action)`, not just `action`. | https://stately.ai/blog/2020-01-20-redux-is-half-a-pattern-1-2 |
| **Pragmatic types: Redux as FSM** | The discriminated-union state shape (`{ current: 'loading' } \| { current: 'loaded'; data: T }`) — type-level prevention of impossible states. | https://dev.to/stereobooster/pragmatic-types-how-to-turn-redux-to-finite-state-machine-with-the-help-of-types-5f08 |
| **Socratopia FSM vs BT diagnostic** | The six-question check for choosing FSM vs HFSM vs BT. Confirms flat FSM for 5–7 modes. | https://www.socratopia.app/library/game-ai-patterns-en/chapter-10 |
| **Celeste Player.cs** | Timer-based cooldowns (`dashTimer`, `dashCooldown`) driven by fixed `dt` — the closest analog to our `timeInState` field. | https://github.com/NoelFB/Celeste/blob/master/Source/Player/Player.cs |
| **sebadorn's js13k 2020 postmortem** | The "FSM pause stops the main loop" pattern — confirms our decision to keep FSM pause as a state, not a loop-level pause. | https://sebadorn.de/2020/09/27/and-then-it-was-gone-notes-about-developing-my-js13k-entry-of-2020 |
| **picosonic's js13k 2018 dev diary** | A real shipped js13k platformer with a game-state machine ("Worked on game state machine and used new timeline to add a basic intro"). Shows the pattern works under 13KB. | https://github.com/picosonic/js13k-2018/blob/master/devdiary/diary.md |

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Jake Gordon's Gauntlet state diagram | The canonical FSM diagram for a top-down dungeon crawler: `booting → menu → starting → loading → playing → won/lost → menu`. Shows the full adjacency table as a flowchart. | https://jakesgordon.com/writing/javascript-game-foundations-state-management/ |
| XState visualizer | Live FSM diagrams with state nodes, transition edges, and event labels. The visualizer is the gold standard for FSM documentation. | https://stately.ai/viz |
| Phaser scene lifecycle diagram | The `init → preload → create → update → shutdown` lifecycle as a state diagram. Shows the parallel-scene pattern (Game + HUD + Pause). | https://docs.phaser.io/phaser/concepts/scenes |
| Godot StateMachine node diagram | The parent StateMachine node with child State nodes, showing `enter` / `exit` / `update` / `physics_update` method dispatch. | https://ziva.sh/blogs/godot-state-machine |
| Lost Dune FSM diagram | A real shipped Godot 4 platformer's FSM: `Idle → Run → Jump → Fall → Dead`. Shows the player-state FSM (not the top-level mode FSM, but the same shape). | https://www.irejournals.com/formatedpaper/1714549.pdf |

---

## Open Questions

1. **Discriminated-union state shape vs flat-record state shape.** The Redux/Elm pattern uses a discriminated union (`{ current: 'menu' } \| { current: 'playing'; level: number; score: number }`) to prevent impossible states at the type level. The flat-record shape (`{ current: GameState; timeInState: number; level: number; score: number; finalScore: number }`) is simpler and matches our existing pure-progression-ops pattern (e.g., `EntitlementSave` is a flat record). Which to ship as the default? My recommendation: **flat record as the runtime default (matches existing modules), discriminated union as an OPTIONAL type-only export** (consumers who want type-level safety can use it). This is a design decision for `@api-designer`.

2. **Payload on transitions in v1.** Should `gameover` carry a `finalScore`, should `levelComplete` carry a `nextLevel`, should `start` carry a `startingLevel`? My recommendation: **yes, but minimal — payload fields are stored on the returned state, not as side-channel arguments.** The reducer signature stays `reduceGameState(state, event, dt) → state`; the event type is a discriminated union (`{ type: 'die' } | { type: 'win'; score: number } | { type: 'start'; level: number }`); the payload fields are read from the event inside the reducer and written to the returned state. This matches the `flushIAPEvents` pattern (events carry data, the reducer writes it to the save).

3. **Initial state factory.** Should the library provide `createInitialGameState(config?)` that returns a fresh state with all fields zeroed? My recommendation: **yes** — mirrors `createJumpState`, `createTweenState`, `createEmitter`, `createHitStop`. The factory takes an optional config (e.g., `startingLevel: number`) and returns the initial `'menu'` state.

4. **Adjacency table as a parameter or a hardcoded constant?** Should the consumer pass their own adjacency table to the reducer, or should the library ship a default table for the canonical 5-state platformer set? My recommendation: **ship a default table for the canonical 5 states, but allow the consumer to pass a custom table** (for games that add `cutscene`, `loading`, `shop`, etc.). The reducer signature becomes `reduceGameState(state, event, dt, table?)` with the default table as the fallback. This matches the `DEFAULT_JUMP` / `DEFAULT_TWEEN_CONFIG` pattern.

5. **`timeInState` reset on self-transitions.** If the consumer dispatches `pause` while already in `paused` (illegal transition), should `timeInState` reset? My recommendation: **no — illegal transitions are silent no-ops, `timeInState` keeps advancing.** This matches the "invalid types are coerced or ignored, never thrown" convention. The consumer can detect "just entered this state" by snapshotting `timeInState` before the call and comparing after.

6. **Pause interaction with the loop's `visibilitychange` handler.** The loop already pauses on tab-hidden. Should the FSM's `paused` state also pause the loop? My recommendation: **no — the two pause mechanisms are orthogonal.** The loop's pause is for tab-hidden (host-touching, defensive adapter); the FSM's pause is for user-initiated pause (deterministic core, pure reducer). The consumer's `step` reads both: if the loop is paused, `step` isn't called; if the FSM is in `paused`, `step` short-circuits. This is the cleanest separation.

7. **Multiple FSMs (top-level mode + sub-FSMs).** Should the library support composing multiple FSMs (e.g., a top-level mode FSM + a player's ability FSM)? My recommendation: **out of scope for v1.** The consumer composes multiple `reduceGameState` calls themselves if they need to. The sub-FSMs (player abilities, enemy AI) are separate concerns covered by other modules (`src/animation/jump.ts` already has a sub-FSM for jumping).

---

## Top 3 Patterns Worth Prototyping

1. **Pure `reduceGameState` reducer with declarative adjacency table.** Ship `reduceGameState(state, event, dt, table?) → state` as the core export. The adjacency table is `Record<GameState, Partial<Record<GameEvent, GameState>>>` — plain data, serialisable, unit-testable. The reducer advances `timeInState` by `dt` every call, looks up the legal next state for `(currentState, event)`, and either transitions (resetting `timeInState`) or silently no-ops on illegal transitions. Ship a default adjacency table for the canonical 5 states (`menu / playing / paused / gameover / levelComplete`). This mirrors `advanceJump` / `advanceTween` / `advanceEmitter` exactly — the consumer owns the state, the engine provides the pure function.

2. **`createInitialGameState` factory + discriminated-union event type.** Ship `createInitialGameState(config?) → GameState` that returns a fresh state with all fields zeroed (matching `createJumpState`, `createTweenState`, `createEmitter`). Ship a discriminated-union `GameEvent` type (`{ type: 'start' } | { type: 'pause' } | { type: 'resume' } | { type: 'die'; finalScore: number } | { type: 'win'; finalScore: number } | { type: 'retry' } | { type: 'next' } | { type: 'quit' }`) so consumers get type-level safety on event payloads. The reducer reads payload fields from the event and writes them to the returned state — no side-channel arguments.

3. **`isLegalTransition` reader + `DEFAULT_GAME_STATE_ADJACENCY` constant.** Ship `isLegalTransition(from, event, table?) → boolean` as a pure reader (no state mutation, no `dt`) so consumers can validate transitions without calling the reducer. Ship `DEFAULT_GAME_STATE_ADJACENCY` as the canonical adjacency table for the 5-state platformer set, exported as a `const` so consumers can spread it into their own custom tables. This matches the `DEFAULT_JUMP` / `DEFAULT_TWEEN_CONFIG` / `DEFAULT_GAIT` pattern — declarative config the consumer can override.

---

## Cross-References

- `docs/architecture.md` — Layer separation (FSM is deterministic core; no host access, no defensive adapter needed); pure-progression-ops discipline (mirrors `src/cosmetics/ownership.ts` and `src/iap/entitlements.ts`).
- `docs/conventions.md` — Pure progression ops, no magic numbers, JSDoc requirements, "invalid types are coerced or ignored, never thrown" (illegal transitions are silent no-ops).
- `src/game-loop/fixed-step.ts` — The fixed-step accumulator that the FSM sits INSIDE. The loop module stays untouched; the consumer's `step(dt)` calls `reduceGameState` and reads the result.
- `src/game-loop/types.ts` — The `GameLoopConfig.step` and `GameLoopConfig.render` callbacks. The FSM is consumer-side logic that lives inside `step`.
- `src/animation/jump.ts` — The closest existing analog: pure `advanceJump(state, inputs, dt, config) → state` reducer with `dt`-driven timers (`coyoteTimer`, `jumpBufferTimer`, `anticipationTimer`). The FSM's `timeInState` is the most generic version of these timers.
- `src/easing/tween.ts` — Another pure-progression-ops analog: `advanceTween(state, dt, config) → state` with consumer-owned state. The FSM reducer follows the same shape.
- `src/particles/emitter.ts` — `advanceEmission(state, dt, config) → { next, spawnCount }` — the FSM reducer can return a similar compound result if we ever need to expose "did a transition happen this tick?" (for the consumer to fire one-shot effects).
- `src/primitives/hit-stop.ts` — `stepHitStop(state, dt)` — the simplest existing pure-progression-op. The FSM reducer is a generalization (hit-stop has one state; the FSM has N states).
- `src/cosmetics/ownership.ts` — The pure-progression-ops canonical example. The FSM reducer mirrors `grantEntitlement` exactly: immutable in, JSON-clone (or shallow spread) out, never throws.
- `src/iap/entitlements.ts` — `flushIAPEvents(save, events, resolver) → { save, grants }` — the pattern for events that carry data. The FSM's `GameEvent` discriminated union follows the same shape.
- `docs/research/platformer-kernel.md` — The "State-Machine-Driven Ability Composition Pattern" — the FSM is the top-level mode orchestration; the platformer-kernel's sub-FSMs (jump, dash, wall slide) compose under it.
- `docs/research/easing-tween.md` — The closest research-note analog: same pure-progression-ops discipline, same `dt`-driven advancement, same consumer-owned state. The FSM note deliberately mirrors its structure.
- `docs/research/iap-bridge.md` — The deterministic-async-event-queue pattern. The FSM's event dispatch is the synchronous, deterministic-core analog: events are pure data, the reducer is pure, no host access.
- `ai-craft-strategy/knowledge/sokpop-minimalist-rendering-teardown.md` — The canonical Sokpop reference. Sokpop's games (Llama Villa, Stacklands, Pyramida) all use top-level mode FSMs — the pattern is proven across genres.
