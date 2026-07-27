/**
 * Pure, flat-record, `dt`-driven FSM reducer for top-level game-mode
 * orchestration.
 *
 * Mirrors the pure-progression-ops pattern established by `advanceJump` /
 * `advanceTween` / `advanceEmitter`: the consumer owns a {@link GameState}
 * and calls {@link reduceGameState} each fixed step with `dt` drawn from the
 * fixed-step accumulator. The function is pure — same
 * `(state, event, dt, table?)` always yields byte-identical output — and
 * never throws.
 *
 * The FSM sits INSIDE the consumer's `step(fixedDt)` callback. The game-loop
 * module is untouched: the loop's `visibilitychange` tab-hidden pause and the
 * FSM's user-pause are orthogonal (a state, not a loop pause).
 *
 * Lifecycle convention (binding — see `docs/design/game-state-fsm-decision.md`):
 *   - Illegal transitions are silent no-ops. `timeInState` keeps advancing.
 *   - The consumer detects "just entered" via `state.timeInState === 0`
 *     after a legal transition.
 *   - No `enter` / `exit` callbacks — the consumer's `switch` on
 *     `state.current` IS the lifecycle.
 *
 * @module
 */

import type { GameEvent, GameMode, GameState, GameStateConfig, TransitionTable } from './types';

/**
 * Default adjacency table for the canonical 5-mode platformer FSM. Consumers
 * spread this into their own {@link TransitionTable} to add or override
 * transitions.
 *
 * Legal transitions:
 *   menu          --start-->  playing
 *   playing       --pause-->  paused
 *   playing       --win-->    levelComplete
 *   playing       --die-->    gameover
 *   paused        --resume--> playing
 *   paused        --quit-->   menu
 *   gameover      --retry-->  playing
 *   gameover      --quit-->   menu
 *   levelComplete --next-->   playing
 *   levelComplete --quit-->   menu
 *
 * Every other `(from, event)` pair is illegal — the reducer treats it as a
 * silent no-op (`timeInState` keeps advancing).
 */
export const DEFAULT_GAME_STATE_ADJACENCY: TransitionTable = {
  menu: { start: 'playing' },
  playing: { pause: 'paused', win: 'levelComplete', die: 'gameover' },
  paused: { resume: 'playing', quit: 'menu' },
  gameover: { retry: 'playing', quit: 'menu' },
  levelComplete: { next: 'playing', quit: 'menu' },
};

/**
 * Create a fresh game state in `'menu'` mode with all accumulators zeroed.
 *
 * Pure: returns a new {@link GameState}; never throws.
 *
 * @param config - optional `{ startingLevel? }`; default level `0`
 * @returns a fresh `GameState` with `current: 'menu'`, `timeInState: 0`
 *
 * @example
 * ```ts
 * let gs = createGameState({ startingLevel: 0 });
 * // inside step(fixedDt):
 * gs = reduceGameState(gs, { type: 'start', level: 1 }, fixedDt);
 * ```
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
 * Advance game state by one fixed timestep.
 *
 * Per-tick evaluation order (must be followed exactly for deterministic
 * tick-boundary behavior):
 *   1. Compute `stepDt` (`dt` clamped to `>= 0` via the
 *      {@link advanceTween} degenerate-dt guard: non-finite or `<= 0` → `0`).
 *   2. Always advance `timeInState` by `stepDt` — even on illegal transitions.
 *   3. If the event is `null` / `undefined`, return the time-advanced state.
 *   4. Look up `(state.current, event.type)` in the transition table.
 *   5. If a legal next mode exists: spread the advanced state, write the
 *      event payload onto it, set `current` to the next mode, and reset
 *      `timeInState` to `0` (the "just entered" signal).
 *   6. If no legal transition (illegal / self-transition): silent no-op —
 *      return the time-advanced state unchanged.
 *
 * **Payload mapping** (binding per `docs/design/game-state-fsm-decision.md`):
 *   - `start`  → `level`
 *   - `die`    → `finalScore` (and `score` is frozen to match)
 *   - `win`    → `finalScore` (and `score` is frozen to match)
 *   - others   → no payload
 *
 * **Determinism contract:** same `(state, event, dt, table)` → byte-identical
 * returned state, forever. No `Math.random`, no `Date.now()`, no DOM reads,
 * no global mutable state.
 *
 * Pure: returns a fresh shallow-spread {@link GameState}; the input is never
 * mutated. Shallow-spread (not JSON-clone) is safe because `GameState` is a
 * flat record of primitives. Never throws.
 *
 * @param state - current game state (not mutated)
 * @param event - transition event, or `null` / `undefined` to just advance time
 * @param dt    - fixed timestep in seconds (from the fixed-step accumulator)
 * @param table - transition table (defaults to {@link DEFAULT_GAME_STATE_ADJACENCY})
 * @returns a new {@link GameState}
 *
 * @example
 * ```ts
 * let gs = createGameState();
 * gs = reduceGameState(gs, { type: 'start', level: 3 }, 1 / 60);
 * // gs.current === 'playing', gs.timeInState === 0, gs.level === 3
 * ```
 */
export function reduceGameState(
  state: GameState,
  event: GameEvent | null | undefined,
  dt: number,
  table: TransitionTable = DEFAULT_GAME_STATE_ADJACENCY,
): GameState {
  const stepDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const advanced: GameState = { ...state, timeInState: state.timeInState + stepDt };

  if (event === null || event === undefined) return advanced;

  const legalNext = table[state.current]?.[event.type];
  if (legalNext === undefined) return advanced;

  return {
    ...advanced,
    ...extractPayload(event),
    current: legalNext,
    timeInState: 0,
  };
}

/**
 * Pure reader: check whether a transition is legal without advancing state.
 * Mirrors the reducer's transition decision exactly — returns `true` iff
 * `reduceGameState(stateWithCurrent=from, event, dt, table)` would transition
 * (i.e. `event.type` resolves to a defined next mode for `from` in `table`).
 *
 * @param from  - current game mode
 * @param event - transition event
 * @param table - transition table (defaults to {@link DEFAULT_GAME_STATE_ADJACENCY})
 * @returns `true` if the transition is legal
 */
export function isLegalTransition(
  from: GameMode,
  event: GameEvent,
  table: TransitionTable = DEFAULT_GAME_STATE_ADJACENCY,
): boolean {
  return table[from]?.[event.type] !== undefined;
}

/**
 * Extract the payload fields carried by a {@link GameEvent} for spreading onto
 * the returned state. Internal helper.
 *
 * `die` and `win` are terminal events: both write `finalScore` (per
 * `docs/design/game-state-fsm-decision.md` resolved question 6) and freeze
 * `score` to the same value so consumers reading `state.score` after a
 * terminal event see the final score. `start` writes `level` (defaults to
 * `0` when the optional field is absent). Other events carry no payload.
 */
function extractPayload(event: GameEvent): Partial<GameState> {
  switch (event.type) {
    case 'start':
      return { level: event.level ?? 0 };
    case 'die':
    case 'win':
      return { finalScore: event.finalScore ?? 0, score: event.finalScore ?? 0 };
    default:
      return {};
  }
}
