/**
 * Platformer `SimulationAdapter` for the generic scenario runner.
 *
 * Connects a compiled platformer level to the generic `simtest` verification
 * framework. Handles:
 * - Creating initial `PlatformerState` at the level's spawn point
 * - Advancing the platformer kernel each tick
 * - Deriving collectible pickups from AABB collision
 * - Advancing moving platforms each tick
 * - Evaluating win conditions
 *
 * **Determinism:** All adapter callbacks are pure — same inputs → same output,
 * forever. No `Math.random`, no `Date.now()`, no DOM reads, no global mutable
 * state. Never throw (degrade gracefully on malformed input).
 *
 * @module
 */

import type { SimulationAdapter } from '../simtest/types';
import type { PlatformerState, PlatformerInput } from '../platformer/types';
import type { LevelData } from '../level/types';
import type { CollectibleSave, CollectibleEntity } from '../collectibles/types';
import type {
  CompiledLevel,
  CompiledMovingPlatform,
} from '../platformer/level-runtime';
import type { Solid } from '../collision/types';
import type { LevelTestConfig } from './verify';
import type { WinCondition } from './win-conditions';
import { DEFAULT_WIN_CONDITION } from './win-conditions';
import { stepPlatformer } from '../platformer/kernel';
import { derivePickups } from '../collectibles/derive-pickups';
import { collect } from '../collectibles/collectibles';
import {
  advanceMovingPlatform,
  movingPlatformToSolid,
} from '../platformer/level-runtime';
import { canonicalize, fnv1a } from '../level/serialize';

// ---------------------------------------------------------------------------
// PolledEdge helpers
// ---------------------------------------------------------------------------

const EDGE_OFF = { held: false, pressed: false, released: false };
const EDGE_PRESS = { held: true, pressed: true, released: false };

// ---------------------------------------------------------------------------
// PlatformerSimulationState
// ---------------------------------------------------------------------------

/**
 * The internal simulation state maintained by the platformer adapter.
 *
 * Contains the authoritative `PlatformerState`, the per-run collectible save,
 * and the monotonic tick counter.
 */
export interface PlatformerSimulationState {
  /** Current platformer kernel state (position, velocity, contacts, abilities). */
  readonly platformerState: PlatformerState;
  /** Current collectible save for this run. */
  readonly save: CollectibleSave;
  /** Monotonic tick counter (0-based). */
  readonly tick: number;
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a {@link SimulationAdapter} for a compiled platformer level.
 *
 * The adapter is used by `verifyScenario` to run deterministic simulation
 * with bot policies. It handles the full game loop for a platformer level:
 * stepping the kernel, advancing moving platforms, deriving pickups, and
 * checking the win condition.
 *
 * **Pure factory:** creates a closure-captured adapter with no side effects.
 * Never throws.
 *
 * @param compiled - The compiled level (static solids, moving platforms,
 *                   initial state).
 * @param level    - The original level data (used for entity list and bounds).
 * @param config   - Level test configuration (win condition, fixed dt, etc.).
 * @returns A `SimulationAdapter<PlatformerSimulationState, PlatformerInput>`.
 *
 * @example
 * ```ts
 * const adapter = createPlatformerAdapter(compiled, level, config);
 * const result = verifyScenario(adapter, { policies: [wrappedPolicy] });
 * ```
 */
export function createPlatformerAdapter(
  compiled: CompiledLevel,
  level: LevelData,
  config: LevelTestConfig,
): SimulationAdapter<PlatformerSimulationState, PlatformerInput> {
  // -----------------------------------------------------------------------
  // Capture config with defaults
  // -----------------------------------------------------------------------
  const winCondition: WinCondition = config.winCondition ?? DEFAULT_WIN_CONDITION;
  const fixedDt = config.fixedDt ?? (1 / 60);
  const levelHeight: number =
    (level && typeof level.height === 'number' && Number.isFinite(level.height))
      ? level.height
      : 1000;

  // -----------------------------------------------------------------------
  // Compute scenario fingerprint
  // -----------------------------------------------------------------------
  let fingerprint: string;
  try {
    const fpData = {
      staticSolids: compiled.staticSolids,
      movingPlatformCount: compiled.movingPlatforms.length,
      spawn: level.spawn,
      playerWidth: compiled.initialState.core.width,
      playerHeight: compiled.initialState.core.height,
      configSeed: config.seed ?? 0,
      configDt: config.fixedDt ?? (1 / 60),
      configMaxTicks: config.maxTicks ?? 6000,
      winConditionName: winCondition.name || 'custom',
    };
    fingerprint = fnv1a(canonicalize(fpData)).toString(16);
  } catch {
    fingerprint = '0';
  }

  // -----------------------------------------------------------------------
  // Build the adapter object
  // -----------------------------------------------------------------------
  const adapter: SimulationAdapter<PlatformerSimulationState, PlatformerInput> = {
    id: 'platformer-level',
    version: 1,
    scenarioFingerprint: fingerprint,

    createInitialState(_seed: number): PlatformerSimulationState {
      let platState: PlatformerState;
      try {
        platState = JSON.parse(JSON.stringify(compiled.initialState)) as PlatformerState;
      } catch {
        platState = compiled.initialState;
      }
      return {
        platformerState: platState,
        save: { collected: [] },
        tick: 0,
      };
    },

    actions(
      _state: Readonly<PlatformerSimulationState>,
    ): readonly PlatformerInput[] {
      try {
        const actions: PlatformerInput[] = [];

        // Always include basic movement
        actions.push({ moveX: 0, jump: EDGE_OFF, dash: EDGE_OFF });
        actions.push({ moveX: -1, jump: EDGE_OFF, dash: EDGE_OFF });
        actions.push({ moveX: 1, jump: EDGE_OFF, dash: EDGE_OFF });

        // Jump variants
        actions.push({ moveX: 0, jump: EDGE_PRESS, dash: EDGE_OFF });
        actions.push({ moveX: -1, jump: EDGE_PRESS, dash: EDGE_OFF });
        actions.push({ moveX: 1, jump: EDGE_PRESS, dash: EDGE_OFF });

        // Dash variants
        actions.push({ moveX: -1, jump: EDGE_OFF, dash: EDGE_PRESS });
        actions.push({ moveX: 1, jump: EDGE_OFF, dash: EDGE_PRESS });

        // Jump + dash variants
        actions.push({ moveX: 0, jump: EDGE_PRESS, dash: EDGE_PRESS });
        actions.push({ moveX: -1, jump: EDGE_PRESS, dash: EDGE_PRESS });
        actions.push({ moveX: 1, jump: EDGE_PRESS, dash: EDGE_PRESS });

        return actions;
      } catch {
        return [{ moveX: 0, jump: EDGE_OFF, dash: EDGE_OFF }];
      }
    },

    step(
      state: Readonly<PlatformerSimulationState>,
      action: Readonly<PlatformerInput>,
      dt: number,
    ): PlatformerSimulationState {
      try {
        const safeDt = Number.isFinite(dt) && dt > 0 ? dt : fixedDt;

        // 1. Advance moving platforms
        const currentPlatforms: CompiledMovingPlatform[] = [];
        for (const mp of compiled.movingPlatforms) {
          try {
            currentPlatforms.push(advanceMovingPlatform(mp, safeDt));
          } catch {
            currentPlatforms.push(mp);
          }
        }

        // 2. Build solids array: static + moving platform solids
        const solids: Solid[] = [...compiled.staticSolids];
        for (const mp of currentPlatforms) {
          try {
            solids.push(movingPlatformToSolid(mp));
          } catch {
            // Skip malformed platform
          }
        }

        // 3. Step the platformer kernel
        const stepResult = stepPlatformer(
          state.platformerState,
          action as PlatformerInput,
          solids,
          safeDt,
        );

        // 4. Derive pickups from player rect
        const player = stepResult.state.core;
        const collectibleEntities = (
          Array.isArray(level.entities)
            ? level.entities.filter(
                (e): e is CollectibleEntity =>
                  e !== null && typeof e === 'object' && e.kind === 'collectible',
              )
            : []
        );

        const pickups = derivePickups(
          { x: player.x, y: player.y, width: player.width, height: player.height },
          collectibleEntities,
          state.save,
        );

        // 5. Update save
        let nextSave: CollectibleSave = state.save;
        for (const id of pickups.collected) {
          try {
            nextSave = collect(nextSave, String(id));
          } catch {
            // Defensive: skip uncollectable entity
          }
        }

        return {
          platformerState: stepResult.state,
          save: nextSave,
          tick: state.tick + 1,
        };
      } catch {
        // On error, return current state so outcome() can still be evaluated
        return {
          platformerState: state.platformerState,
          save: state.save,
          tick: state.tick + 1,
        };
      }
    },

    outcome(
      state: Readonly<PlatformerSimulationState>,
    ): 'running' | 'success' | 'failure' {
      try {
        // Check win condition first
        if (winCondition(state.platformerState, level.entities ?? [], state.save)) {
          return 'success';
        }

        // Check death: player fell out of bounds
        const core = state.platformerState.core;
        if (core.y > levelHeight + 100 || core.y < -2000) {
          return 'failure';
        }

        return 'running';
      } catch {
        return 'failure';
      }
    },

    stateKey(state: Readonly<PlatformerSimulationState>): string {
      try {
        const core = state.platformerState.core;
        return `${core.x.toFixed(1)},${core.y.toFixed(1)},${core.vx.toFixed(1)},${core.vy.toFixed(1)}`;
      } catch {
        return '';
      }
    },
  };

  return adapter;
}
