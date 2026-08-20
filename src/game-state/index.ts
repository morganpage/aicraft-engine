/**
 * game-state module barrel.
 *
 * Re-exports the pure FSM reducer, the factory, the pure reader, the default
 * adjacency table (values), and the type-only discriminated-union opt-in
 * (`GameStateExact`). Values are exported with `export {}`, types with
 * `export type {}` (per `isolatedModules`).
 *
 * @module
 */

export {
  DEFAULT_GAME_STATE_ADJACENCY,
  createGameState,
  reduceGameState,
  isLegalTransition,
} from './game-state';

export {
  createMenuNav,
  openMenuNav,
  advanceMenuNav,
  clampMenuNavIndex,
  IDLE_MENU_INPUT,
  type MenuNavState,
  type MenuNavOptions,
  type MenuNavInput,
  type MenuNavResult,
} from './menu-nav';

export type {
  GameMode,
  GameEvent,
  GameState,
  GameStateConfig,
  TransitionTable,
  GameStateExact,
} from './types';
