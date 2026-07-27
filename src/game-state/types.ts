/**
 * Type definitions for the game-state FSM module.
 *
 * The module provides a pure, flat-record, `dt`-driven finite-state-machine
 * reducer for top-level game-mode orchestration (menu / playing / paused /
 * gameover / levelComplete). It mirrors the pure-progression-ops discipline
 * established by `advanceJump` / `advanceTween` / `advanceEmitter`:
 * `reduceGameState(state, event, dt, table?) → state` — consumer-owned state,
 * fresh shallow-spread return, never mutates input, never throws.
 *
 * The FSM sits INSIDE the consumer's `step(fixedDt)` callback; the game-loop
 * module is completely untouched (pause is a state, not a loop pause).
 *
 * @module
 */

/**
 * The five canonical platformer modes. Consumers add custom modes by
 * spread-overriding {@link TransitionTable} (the reducer looks up
 * `(currentState, eventType)` at runtime via string keys).
 */
export type GameMode = 'menu' | 'playing' | 'paused' | 'gameover' | 'levelComplete';

/**
 * Events that drive transitions. Discriminated union — each event carries
 * only the payload relevant to its transition. Payload fields are read by
 * {@link reduceGameState} and written onto the returned {@link GameState}.
 *
 * `start`  — begin playing, optionally at a specific level.
 * `pause`  — user-initiated pause (orthogonal to the loop's tab-hidden pause).
 * `resume` — leave the paused state.
 * `die`    — run out of lives / fail the level; freezes the score.
 * `win`    — complete the level; freezes the score.
 * `retry`  — restart from gameover back into playing.
 * `next`   — advance from levelComplete into the next level.
 * `quit`   — bail to menu from paused / gameover / levelComplete.
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
 * Game state — flat record of primitives. Consumer-owned; passed to and
 * returned from {@link reduceGameState}. All fields are present on every
 * state variant (flat-record default). Consumers who want compile-time
 * impossible-state prevention can cast to the optional {@link GameStateExact}
 * type-only export.
 *
 * All fields are `readonly`. The reducer returns a fresh shallow-spread
 * object every call — `readonly` is compatible with the clone-then-return
 * discipline and reinforces the immutability contract (same pattern as
 * `JumpState`).
 *
 * Shallow-spread (not JSON-clone) is safe here because `GameState` is a flat
 * record of primitives — there are no nested objects to share by reference.
 * Mirrors the rationale documented on `JumpState`.
 */
export interface GameState {
  /** Current game mode. */
  readonly current: GameMode;
  /** Seconds elapsed in the current mode. Reset to `0` on every legal transition. */
  readonly timeInState: number;
  /** Current level index (set by the `start` event, carried through transitions). */
  readonly level: number;
  /** Score carried through transitions (frozen at the terminal value by `die`/`win`). */
  readonly score: number;
  /** Final score set on a terminal event (`die` or `win`). */
  readonly finalScore: number;
}

/**
 * Transition table — plain data. Maps `(fromMode, eventType) → toMode`.
 * A missing entry means the transition is illegal (silent no-op in
 * {@link reduceGameState}; `false` from {@link isLegalTransition}).
 *
 * Keys are the canonical {@link GameMode} set; inner keys are
 * {@link GameEvent}['type'] string literals. Consumers spread
 * {@link DEFAULT_GAME_STATE_ADJACENCY} and override individual transitions,
 * including custom event types (via type assertion at the call site).
 *
 * @example
 * ```ts
 * const myTable: TransitionTable = {
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
  /** Starting level index. Default `0`. */
  readonly startingLevel?: number;
}

/**
 * TYPE-ONLY discriminated union — additive opt-in for consumers who want
 * compile-time impossible-state prevention. Same runtime shape as
 * {@link GameState} (the reducer returns the flat record; consumers `as`-cast
 * when they want narrowing). Erases completely at compile time; zero runtime
 * cost.
 *
 * Variants carry only the fields valid in that mode. `menu` omits score and
 * finalScore (`?: never`); `playing` / `paused` omit finalScore; `gameover` /
 * `levelComplete` carry both.
 *
 * @example
 * ```ts
 * function handle(s: GameStateExact) {
 *   switch (s.current) {
 *     case 'gameover': console.log(s.finalScore); break; // ✓
 *     case 'menu':     console.log(s.finalScore); break; // ✗ compile error
 *   }
 * }
 * ```
 */
export type GameStateExact =
  | { readonly current: 'menu'; readonly timeInState: number; readonly level: number; readonly score?: never; readonly finalScore?: never }
  | { readonly current: 'playing'; readonly timeInState: number; readonly level: number; readonly score: number; readonly finalScore?: never }
  | { readonly current: 'paused'; readonly timeInState: number; readonly level: number; readonly score: number; readonly finalScore?: never }
  | { readonly current: 'gameover'; readonly timeInState: number; readonly level: number; readonly score: number; readonly finalScore: number }
  | { readonly current: 'levelComplete'; readonly timeInState: number; readonly level: number; readonly score: number; readonly finalScore: number };
