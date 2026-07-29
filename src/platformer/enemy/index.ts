/**
 * Enemy archetype system — behavior registry, built-in archetypes, and
 * projectile stepping.
 *
 * Enemies are runtime entities compiled from `LevelEntity` entries with
 * `kind: 'enemy'`. Each enemy has an `archetype` string that dispatches to
 * a behavior handler in the `EnemyBehaviorRegistry`.
 *
 * @module
 */

export type {
  EnemyArchetype,
  EnemyProps,
  EnemyState,
  EnemyStepResult,
  EnemyBehaviorHandler,
  EnemyUpdateContext,
  ProjectileState,
  ProjectileStepResult,
  CompiledEnemy,
  EnemyBehaviorRegistry,
} from './types';

export {
  createEnemyBehaviorRegistry,
  spinnyBehavior,
  turretBehavior,
  spiderBehavior,
  chargerBehavior,
} from './registry';

export {
  CHARGER_HEIGHT,
  CHARGER_WIDTH,
  DEFAULT_CHARGER_PALETTE,
  drawCharger,
  resolveChargerParams,
  sweepChargerX,
  type ChargerPalette,
  type ChargerParams,
  type ChargerPhase,
} from './archetypes/charger';

export { stepProjectile } from './projectile';

export {
  compileEnemies,
  stepEnemies,
  type StepEnemiesResult,
} from './compile';

export {
  drawEnemies,
  drawProjectiles,
  type EnemyPalette,
} from './renderer';
