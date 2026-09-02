/**
 * Four-direction tick-based grid movement.
 *
 * The step lifecycle is authoritative and integer-timed: a step started at
 * tick `T` with duration `D` arrives on the tick-`T + D` call, which commits
 * the location, emits exactly one `stepCompleted`, and resolves the arrival
 * tile (warp → heal → encounter zone). Nothing happens mid-step: new
 * direction input is ignored while stepping, and the arrival tick never also
 * starts a chained step — chaining begins on the following tick.
 *
 * Facing updates even when the destination is blocked. Blocked attempts,
 * idle ticks, and non-arrival ticks never emit events or arrivals.
 */

import { npcAt, resolveArrival, type GridArrival } from './interaction';
import type { RpgMapDefinition } from './map';
import type { GridStepState, OverworldState, RpgConfig, RpgEvent } from './state';
import type { RpgDiagnostic, RpgDirection, RpgInput, RpgLocation, RpgTileRef } from './types';

const DIRECTION_DELTA: Readonly<Record<RpgDirection, Readonly<{ x: number; y: number }>>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** One movement tick's outcome. */
export interface GridMovementResult {
  readonly overworld: OverworldState;
  /** `stepCompleted` on the arrival tick; empty otherwise. */
  readonly events: readonly RpgEvent[];
  /** Arrival resolution, non-null exactly on the arrival tick. */
  readonly arrival: GridArrival | null;
  readonly diagnostics: readonly RpgDiagnostic[];
}

/**
 * Build an idle overworld at a named spawn anchor. Returns `null` when the
 * anchor does not exist — callers treat that as invalid content, not a crash.
 */
export function createOverworldAtAnchor(
  map: RpgMapDefinition,
  anchorId: string,
): OverworldState | null {
  for (const spawn of map.spawns) {
    if (spawn.id === anchorId) {
      return {
        location: {
          mapId: map.id,
          tileX: spawn.tile.tileX,
          tileY: spawn.tile.tileY,
          facing: spawn.facing,
        },
        step: null,
      };
    }
  }
  return null;
}

function mapHasValidGrids(map: RpgMapDefinition): boolean {
  return (
    Number.isInteger(map.widthTiles) && map.widthTiles > 0 &&
    Number.isInteger(map.heightTiles) && map.heightTiles > 0 &&
    map.collision.length === map.widthTiles * map.heightTiles &&
    map.encounterZones.length === map.widthTiles * map.heightTiles
  );
}

function destinationBlocked(
  map: RpgMapDefinition,
  to: RpgTileRef,
): boolean {
  if (to.tileX < 0 || to.tileX >= map.widthTiles) return true;
  if (to.tileY < 0 || to.tileY >= map.heightTiles) return true;
  if (map.collision[to.tileY * map.widthTiles + to.tileX]) return true;
  return npcAt(map, to) !== null;
}

/**
 * Advance one fixed tick of grid movement. Pure: returns a fresh overworld
 * and never mutates the input. Malformed map grids produce a diagnostic and
 * a no-op rather than throwing.
 */
export function advanceGridMovement(
  overworld: OverworldState,
  tick: number,
  input: RpgInput,
  map: RpgMapDefinition,
  config: RpgConfig,
): GridMovementResult {
  if (!mapHasValidGrids(map)) {
    return {
      overworld,
      events: [],
      arrival: null,
      diagnostics: [{
        code: 'rpg.movement.mapMalformed',
        severity: 'error',
        path: `maps[${map.id}]`,
        message: `Map grid arrays do not match dimensions ${map.widthTiles}×${map.heightTiles}.`,
      }],
    };
  }

  const safeTick = Number.isFinite(tick) ? Math.floor(tick) : 0;
  const active = overworld.step;

  if (active) {
    if (safeTick < active.startedTick + active.durationTicks) {
      return { overworld, events: [], arrival: null, diagnostics: [] };
    }
    const to = active.to;
    const location: RpgLocation = {
      mapId: overworld.location.mapId,
      tileX: to.tileX,
      tileY: to.tileY,
      facing: active.facing,
    };
    return {
      overworld: { location, step: null },
      events: [{
        type: 'stepCompleted',
        mapId: location.mapId,
        tileX: to.tileX,
        tileY: to.tileY,
      }],
      arrival: resolveArrival(map, to),
      diagnostics: [],
    };
  }

  const direction = input?.direction ?? null;
  if (!direction) {
    return { overworld, events: [], arrival: null, diagnostics: [] };
  }

  const delta = DIRECTION_DELTA[direction] ?? { x: 0, y: 0 };
  const from: RpgTileRef = {
    tileX: overworld.location.tileX,
    tileY: overworld.location.tileY,
  };
  const to: RpgTileRef = { tileX: from.tileX + delta.x, tileY: from.tileY + delta.y };
  const facingLocation: RpgLocation = { ...overworld.location, facing: direction };

  if (destinationBlocked(map, to)) {
    return { overworld: { location: facingLocation, step: null }, events: [], arrival: null, diagnostics: [] };
  }

  const durationTicks = Number.isFinite(config?.stepDurationTicks)
    ? Math.max(1, Math.floor(config.stepDurationTicks))
    : 1;
  const step: GridStepState = { from, to, facing: direction, startedTick: safeTick, durationTicks };
  return { overworld: { location: facingLocation, step }, events: [], arrival: null, diagnostics: [] };
}
