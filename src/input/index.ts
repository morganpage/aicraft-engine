/**
 * Input module — deterministic edge accumulator + defensive device adapters.
 *
 * Two layers:
 *   - **Pure core** (`edges.ts`, `merge.ts`) — DOM-free, deterministic, fully
 *     unit-testable under Node.
 *   - **Defensive adapters** (`keyboard.ts`, `touch-button.ts`,
 *     `touch-button-set.ts`, `gamepad.ts`) — host-touching; lazy `window` /
 *     `navigator` resolution, swallow errors, never throw, no-op fallback in
 *     Node / SSR (see `src/primitives/motion.ts`).
 *
 * @module
 */

export type {
  EdgeAccumulator,
  PolledEdge,
  KeyboardAdapter,
  KeyboardConfig,
  TouchButtonAdapter,
  TouchButtonSetConfig,
  TouchButtonSetAdapter,
  AxisBinding,
  GamepadAdapter,
  GamepadConfig,
} from './types';

export {
  createEdgeAccumulator,
  pressEdge,
  releaseEdge,
  resetEdge,
  pollEdge,
} from './edges';

export { orEdges } from './merge';

export { createKeyboardAdapter } from './keyboard';

export { createTouchButton } from './touch-button';

export { createTouchButtonSet } from './touch-button-set';

export { createGamepadAdapter, DEFAULT_GAMEPAD_DEADZONE } from './gamepad';
