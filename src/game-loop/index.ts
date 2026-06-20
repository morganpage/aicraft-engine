/**
 * game-loop module barrel.
 *
 * @module
 */

export {
  advanceAccumulator,
  createGameLoop,
  DEFAULT_FIXED_DT,
  DEFAULT_MAX_FRAME_DELTA,
  type AccumulatorStep,
} from './fixed-step';
export type { GameLoop, GameLoopConfig } from './types';
