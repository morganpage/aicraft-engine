import type { Solid, TileSolidityQuery, TileType } from '../../../src/collision/types';
import type {
  EnemyBehaviorHandler,
  EnemyState,
  EnemyStepResult,
  EnemyUpdateContext,
} from '../../../src/platformer/enemy/types';
import {
  CHARGER_DEFAULTS,
  CHARGER_HEIGHT,
  CHARGER_WIDTH,
} from './constants';
import { checkLineOfSight } from './los';

export type ChargerPhase = 'patrol' | 'windup' | 'dash' | 'recovery';

export interface ChargerParams {
  readonly speed?: number;
  readonly dashSpeed?: number;
  readonly windupDuration?: number;
  readonly recoveryDuration?: number;
  readonly dashMaxDistance?: number;
  readonly detectionRadius?: number;
  readonly verticalTolerance?: number;
  readonly ledgeTurnAround?: boolean;
}

interface ResolvedChargerParams {
  readonly speed: number;
  readonly dashSpeed: number;
  readonly windupDuration: number;
  readonly recoveryDuration: number;
  readonly dashMaxDistance: number;
  readonly detectionRadius: number;
  readonly verticalTolerance: number;
  readonly ledgeTurnAround: boolean;
}

interface ChargerData {
  readonly phase: ChargerPhase;
  readonly windupTimer: number;
  readonly recoveryTimer: number;
  readonly distanceTraveled: number;
  readonly dashDir: 1 | -1;
}

interface SweepResult {
  readonly x: number;
  readonly traveled: number;
  readonly hitWall: boolean;
}

function inRange(
  value: unknown,
  min: number,
  max: number,
  minExclusive = false,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (minExclusive ? value > min : value >= min) &&
    value <= max
  );
}

export function resolveChargerParams(
  params: Readonly<Record<string, unknown>>,
): ResolvedChargerParams {
  return {
    speed: inRange(params.speed, 0, 1024)
      ? params.speed
      : CHARGER_DEFAULTS.speed,
    dashSpeed: inRange(params.dashSpeed, 0, 4096, true)
      ? params.dashSpeed
      : CHARGER_DEFAULTS.dashSpeed,
    windupDuration: inRange(params.windupDuration, 0, 60)
      ? params.windupDuration
      : CHARGER_DEFAULTS.windupDuration,
    recoveryDuration: inRange(params.recoveryDuration, 0, 60)
      ? params.recoveryDuration
      : CHARGER_DEFAULTS.recoveryDuration,
    dashMaxDistance: inRange(params.dashMaxDistance, 0, 65_536)
      ? params.dashMaxDistance
      : CHARGER_DEFAULTS.dashMaxDistance,
    detectionRadius: inRange(params.detectionRadius, 0, 65_536)
      ? params.detectionRadius
      : CHARGER_DEFAULTS.detectionRadius,
    verticalTolerance: inRange(params.verticalTolerance, 0, 4096)
      ? params.verticalTolerance
      : CHARGER_DEFAULTS.verticalTolerance,
    ledgeTurnAround:
      typeof params.ledgeTurnAround === 'boolean'
        ? params.ledgeTurnAround
        : CHARGER_DEFAULTS.ledgeTurnAround,
  };
}

function normalizeTimer(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function readData(state: EnemyState): ChargerData {
  const raw =
    state.data && typeof state.data === 'object'
      ? state.data
      : {};
  const phase =
    raw.phase === 'patrol' ||
    raw.phase === 'windup' ||
    raw.phase === 'dash' ||
    raw.phase === 'recovery'
      ? raw.phase
      : 'patrol';
  if (phase === 'patrol' && raw.phase !== 'patrol') {
    return {
      phase: 'patrol',
      windupTimer: 0,
      recoveryTimer: 0,
      distanceTraveled: 0,
      dashDir: state.facing,
    };
  }
  return {
    phase,
    windupTimer: normalizeTimer(raw.windupTimer),
    recoveryTimer: normalizeTimer(raw.recoveryTimer),
    distanceTraveled: normalizeTimer(raw.distanceTraveled),
    dashDir:
      raw.dashDir === 1 || raw.dashDir === -1
        ? raw.dashDir
        : state.facing,
  };
}

function result(
  state: EnemyState,
  data: ChargerData,
  overrides?: Partial<Pick<EnemyStepResult, 'x' | 'y' | 'vx' | 'vy' | 'facing'>>,
): EnemyStepResult {
  return {
    x: overrides?.x ?? state.x,
    y: overrides?.y ?? state.y,
    vx: overrides?.vx ?? state.vx,
    vy: overrides?.vy ?? state.vy,
    facing: overrides?.facing ?? state.facing,
    alive: state.alive,
    data: { ...state.data, ...data },
  };
}

function validSolid(solid: Solid): boolean {
  return (
    Number.isFinite(solid.x) &&
    Number.isFinite(solid.y) &&
    Number.isFinite(solid.width) &&
    Number.isFinite(solid.height) &&
    solid.width >= 0 &&
    solid.height >= 0
  );
}

export function sweepChargerX(
  x: number,
  y: number,
  direction: 1 | -1,
  requestedDistance: number,
  solids: readonly Solid[],
): SweepResult {
  const intendedX = x + requestedDistance * direction;
  let resolvedX = intendedX;
  let hitWall = false;

  for (const solid of solids) {
    if (!validSolid(solid) || solid.passthrough) continue;
    if (
      y + CHARGER_HEIGHT <= solid.y ||
      y >= solid.y + solid.height
    ) {
      continue;
    }
    if (direction === 1) {
      const contactX = solid.x - CHARGER_WIDTH;
      if (contactX >= x && contactX <= resolvedX) {
        resolvedX = contactX;
        hitWall = true;
      }
    } else {
      const contactX = solid.x + solid.width;
      if (contactX <= x && contactX >= resolvedX) {
        resolvedX = contactX;
        hitWall = true;
      }
    }
  }

  return {
    x: resolvedX,
    traveled: Math.abs(resolvedX - x),
    hitWall,
  };
}

function queryIsValid(value: unknown): value is TileType {
  return value === 'empty' || value === 'solid' || value === 'passthrough';
}

function hasPatrolSupport(
  x: number,
  y: number,
  direction: 1 | -1,
  ctx: EnemyUpdateContext,
): 'supported' | 'unsupported' | 'unavailable' | 'invalid' {
  const leadingFootX = direction === 1 ? x + CHARGER_WIDTH : x;
  const probeY = y + CHARGER_HEIGHT + 1;
  let finiteSolidSeen = false;
  for (const solid of ctx.solids) {
    if (!validSolid(solid)) continue;
    finiteSolidSeen = true;
    if (
      leadingFootX >= solid.x &&
      leadingFootX <= solid.x + solid.width &&
      probeY >= solid.y &&
      probeY <= solid.y + solid.height + 1
    ) {
      return 'supported';
    }
  }

  const validTileSource =
    typeof ctx.tileQuery === 'function' &&
    Number.isFinite(ctx.tileSize) &&
    ctx.tileSize > 0;
  if (validTileSource) {
    try {
      const value: unknown = ctx.tileQuery!(
        Math.floor(leadingFootX / ctx.tileSize),
        Math.floor(probeY / ctx.tileSize),
      );
      if (!queryIsValid(value)) return finiteSolidSeen ? 'unsupported' : 'invalid';
      if (value === 'solid' || value === 'passthrough') return 'supported';
      return 'unsupported';
    } catch {
      return finiteSolidSeen ? 'unsupported' : 'invalid';
    }
  }
  return finiteSolidSeen ? 'unsupported' : 'unavailable';
}

function playerDetected(
  state: EnemyState,
  ctx: EnemyUpdateContext,
  params: ResolvedChargerParams,
): { readonly detected: boolean; readonly direction: 1 | -1 } {
  if (!ctx.playerRect) return { detected: false, direction: state.facing };
  const enemyCenterX = state.x + CHARGER_WIDTH / 2;
  const enemyCenterY = state.y + CHARGER_HEIGHT / 2;
  const playerCenterX = ctx.playerRect.x + ctx.playerRect.width / 2;
  const playerCenterY = ctx.playerRect.y + ctx.playerRect.height / 2;
  const direction =
    playerCenterX === enemyCenterX
      ? state.facing
      : playerCenterX > enemyCenterX
        ? 1
        : -1;
  if (
    Math.abs(playerCenterX - enemyCenterX) > params.detectionRadius ||
    Math.abs(playerCenterY - enemyCenterY) > params.verticalTolerance
  ) {
    return { detected: false, direction };
  }

  if (
    typeof ctx.tileQuery !== 'function' ||
    !Number.isFinite(ctx.tileSize) ||
    ctx.tileSize <= 0
  ) {
    return { detected: true, direction };
  }

  return {
    detected: checkLineOfSight(
      enemyCenterX,
      enemyCenterY,
      playerCenterX,
      playerCenterY,
      ctx.tileQuery as TileSolidityQuery,
      ctx.tileSize,
    ),
    direction,
  };
}

export const chargerBehavior: EnemyBehaviorHandler = {
  step(
    state: EnemyState,
    ctx: EnemyUpdateContext,
    rawParams: Record<string, unknown>,
  ): EnemyStepResult {
    const data = readData(state);
    if (!Number.isFinite(ctx.dt) || ctx.dt <= 0) return result(state, data);
    const params = resolveChargerParams(rawParams);

    if (data.phase === 'windup') {
      if (data.windupTimer <= ctx.dt) {
        return result(state, { ...data, phase: 'dash' });
      }
      return result(state, {
        ...data,
        windupTimer: data.windupTimer - ctx.dt,
      });
    }

    if (data.phase === 'recovery') {
      if (data.recoveryTimer <= ctx.dt) {
        return result(state, {
          ...data,
          phase: 'patrol',
          distanceTraveled: 0,
        });
      }
      return result(state, {
        ...data,
        recoveryTimer: data.recoveryTimer - ctx.dt,
      });
    }

    if (data.phase === 'dash') {
      const movementProduct = params.dashSpeed * ctx.dt;
      if (!Number.isFinite(movementProduct)) return result(state, data);
      const remaining = Math.max(0, params.dashMaxDistance - data.distanceTraveled);
      if (remaining === 0) {
        return result(state, {
          ...data,
          phase: 'recovery',
          recoveryTimer: params.recoveryDuration,
        });
      }
      const sweep = sweepChargerX(
        state.x,
        state.y,
        data.dashDir,
        Math.min(movementProduct, remaining),
        ctx.solids,
      );
      const distanceTraveled = data.distanceTraveled + sweep.traveled;
      const finished =
        sweep.hitWall || distanceTraveled >= params.dashMaxDistance;
      return result(
        state,
        {
          ...data,
          phase: finished ? 'recovery' : 'dash',
          recoveryTimer: finished
            ? params.recoveryDuration
            : data.recoveryTimer,
          distanceTraveled,
        },
        {
          x: sweep.x,
          vx: data.dashDir * params.dashSpeed,
          facing: data.dashDir,
        },
      );
    }

    const movementProduct = params.speed * ctx.dt;
    if (!Number.isFinite(movementProduct)) return result(state, data);
    const detection = playerDetected(state, ctx, params);
    if (detection.detected) {
      return result(
        state,
        {
          ...data,
          phase: 'windup',
          windupTimer: params.windupDuration,
          distanceTraveled: 0,
          dashDir: detection.direction,
        },
        { facing: detection.direction, vx: 0 },
      );
    }

    const sweep = sweepChargerX(
      state.x,
      state.y,
      state.facing,
      movementProduct,
      ctx.solids,
    );
    let x = sweep.x;
    let facing = state.facing;
    if (sweep.hitWall) {
      facing = state.facing === 1 ? -1 : 1;
    } else if (params.ledgeTurnAround) {
      const support = hasPatrolSupport(x, state.y, state.facing, ctx);
      if (support === 'unsupported' || support === 'invalid') {
        x = state.x;
        facing = state.facing === 1 ? -1 : 1;
      }
    }

    return result(state, data, {
      x,
      vx: x === state.x ? 0 : state.facing * params.speed,
      facing,
    });
  },
};
