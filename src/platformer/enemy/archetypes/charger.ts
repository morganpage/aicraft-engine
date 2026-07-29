import type { Solid, TileSolidityQuery, TileType } from '../../../collision/types';
import { checkLineOfSight } from '../../../collision/los';
import {
  CHARGER_HEIGHT,
  CHARGER_NUMERIC_RULES,
  CHARGER_WIDTH,
  resolveChargerNumber,
} from '../../../level/enemy-schema';
import { outlineRect } from '../../../primitives/outline-rect';
import type {
  EnemyBehaviorHandler,
  EnemyState,
  EnemyStepResult,
  EnemyUpdateContext,
} from '../types';

export { CHARGER_HEIGHT, CHARGER_WIDTH };

/** Optional charger behavior parameters. Invalid values use named defaults. */
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

/** Charger state-machine phases. */
export type ChargerPhase = 'patrol' | 'windup' | 'dash' | 'recovery';

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

/** Resolve direct handler params defensively using schema-owned defaults. */
export function resolveChargerParams(
  params: Readonly<Record<string, unknown>>,
): ResolvedChargerParams {
  return {
    speed: resolveChargerNumber('speed', params.speed),
    dashSpeed: resolveChargerNumber('dashSpeed', params.dashSpeed),
    windupDuration: resolveChargerNumber(
      'windupDuration',
      params.windupDuration,
    ),
    recoveryDuration: resolveChargerNumber(
      'recoveryDuration',
      params.recoveryDuration,
    ),
    dashMaxDistance: resolveChargerNumber(
      'dashMaxDistance',
      params.dashMaxDistance,
    ),
    detectionRadius: resolveChargerNumber(
      'detectionRadius',
      params.detectionRadius,
    ),
    verticalTolerance: resolveChargerNumber(
      'verticalTolerance',
      params.verticalTolerance,
    ),
    ledgeTurnAround:
      typeof params.ledgeTurnAround === 'boolean'
        ? params.ledgeTurnAround
        : true,
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
  const recognized =
    raw.phase === 'patrol' ||
    raw.phase === 'windup' ||
    raw.phase === 'dash' ||
    raw.phase === 'recovery';
  if (!recognized) {
    return {
      phase: 'patrol',
      windupTimer: 0,
      recoveryTimer: 0,
      distanceTraveled: 0,
      dashDir: state.facing,
    };
  }
  return {
    phase: raw.phase as ChargerPhase,
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

/** Bounded horizontal swept-AABB move; scans solids exactly once. */
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
    if (y + CHARGER_HEIGHT <= solid.y || y >= solid.y + solid.height) continue;
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

/**
 * Deterministic charger behavior: patrol → windup → dash → recovery.
 *
 * The handler never applies damage or mutates its inputs.
 */
export const chargerBehavior: EnemyBehaviorHandler = {
  step(state, ctx, rawParams) {
    try {
      const data = readData(state);
      if (!Number.isFinite(ctx.dt) || ctx.dt <= 0) return result(state, data);
      const params = resolveChargerParams(rawParams);

      if (data.phase === 'windup') {
        return data.windupTimer <= ctx.dt
          ? result(state, { ...data, phase: 'dash' })
          : result(state, {
              ...data,
              windupTimer: data.windupTimer - ctx.dt,
            });
      }
      if (data.phase === 'recovery') {
        return data.recoveryTimer <= ctx.dt
          ? result(state, {
              ...data,
              phase: 'patrol',
              distanceTraveled: 0,
            })
          : result(state, {
              ...data,
              recoveryTimer: data.recoveryTimer - ctx.dt,
            });
      }
      if (data.phase === 'dash') {
        const movementProduct = params.dashSpeed * ctx.dt;
        if (!Number.isFinite(movementProduct)) return result(state, data);
        const remaining = Math.max(
          0,
          params.dashMaxDistance - data.distanceTraveled,
        );
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
    } catch {
      const fallback = readData(state);
      return result(state, fallback);
    }
  },
};

/** Charger renderer palette. */
export interface ChargerPalette {
  readonly body: string;
  readonly armor: string;
  readonly feature: string;
  readonly outline: string;
}

/** Default charger renderer palette. */
export const DEFAULT_CHARGER_PALETTE: Readonly<ChargerPalette> = {
  body: '#d45b3f',
  armor: '#7f3140',
  feature: '#ffe066',
  outline: '#1b1020',
};

/** Draw built-in charger telegraph and recovery poses. */
export function drawCharger(
  ctx: CanvasRenderingContext2D,
  state: EnemyState,
  palette: ChargerPalette = DEFAULT_CHARGER_PALETTE,
): void {
  const phase: ChargerPhase =
    state.data.phase === 'windup' ||
    state.data.phase === 'dash' ||
    state.data.phase === 'recovery'
      ? state.data.phase
      : 'patrol';
  const windupTimer =
    typeof state.data.windupTimer === 'number' &&
    Number.isFinite(state.data.windupTimer)
      ? Math.max(
          0,
          Math.min(
            CHARGER_NUMERIC_RULES.windupDuration.defaultValue,
            state.data.windupTimer,
          ),
        )
      : CHARGER_NUMERIC_RULES.windupDuration.defaultValue / 2;
  const compression =
    phase === 'windup'
      ? 0.66 +
        (windupTimer /
          CHARGER_NUMERIC_RULES.windupDuration.defaultValue) *
          0.24
      : phase === 'recovery'
        ? 0.84
        : 1;
  const lean = phase === 'dash' ? 2.5 : phase === 'windup' ? -2 : 0;
  const slump = phase === 'recovery' ? 3 : 0;

  ctx.save();
  ctx.translate(
    state.x + CHARGER_WIDTH / 2 + lean * state.facing,
    state.y + CHARGER_HEIGHT,
  );
  ctx.scale(state.facing, 1);
  ctx.translate(0, slump);
  ctx.scale(1 / compression, compression);
  outlineRect(ctx, -6, -12, 12, 10, palette.body, palette.outline);
  ctx.fillStyle = palette.armor;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-5, -12);
  ctx.lineTo(0, -16);
  ctx.lineTo(5, -12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = palette.feature;
  ctx.fillRect(2.5, -9.5, 2, 2);
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-4, -2);
  ctx.lineTo(-5.5, 0);
  ctx.moveTo(4, -2);
  ctx.lineTo(5.5, 0);
  ctx.stroke();
  if (phase === 'recovery') {
    ctx.fillStyle = palette.feature;
    ctx.fillRect(-8, -16, 2, 2);
    ctx.fillRect(7, -18, 2, 2);
  }
  ctx.restore();
}
