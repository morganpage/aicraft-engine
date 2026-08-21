import {
  drawLdtkEntityTile,
  type CompiledLdtkRoom,
  type DrawLevelEntityOverrideMap,
  type LevelEntity,
  type LdtkTilesetBundle,
} from 'aicraft-engine';

/**
 * The `drawLevelEntity` override map that renders entities with their AUTHORED
 * LDtk tiles, via the engine's entity-art side channel.
 *
 * The join is engine-owned: `room.entityArt` is keyed by the entity's engine
 * id and holds `{ tile, tileRenderMode, nineSliceBorders }` — everything
 * `drawLdtkEntityTile` takes. This recipe is the map that routes every drawn
 * kind through one rule: look up the entity's art, delegate the blit to the
 * engine helper (which owns `Repeat` tiling for resized strips, `FitInside`
 * letterboxing, and the flip/alpha bits), and return `false` when there is no
 * art — handing the draw back to the engine's `DEFAULT_ENTITY_PALETTE` shape.
 *
 * No index to build, memoize, rebuild on room transitions, or clear on hot
 * reload: a recompiled room arrives with its own fresh map, so call this once
 * per active room (and again when the room changes).
 *
 * @example
 * ```ts
 * const overrides = ldtkEntityTileOverride(active, tilesets);
 * for (const e of active.hazards) drawLevelEntity(ctx, e, { drawOverride: overrides });
 * ```
 */
export function ldtkEntityTileOverride(
  room: Readonly<CompiledLdtkRoom>,
  tilesets: LdtkTilesetBundle,
): DrawLevelEntityOverrideMap {
  const draw = (ctx: CanvasRenderingContext2D, entity: LevelEntity): boolean => {
    const art = room.entityArt.get(entity.id);
    if (art === undefined) return false;
    // `tileRenderMode` is `undefined` when the def could not be resolved —
    // passing it through selects drawLdtkEntityTile's geometry heuristic,
    // the intended fallback. `false` (unknown tileset, throwing draw) hands
    // the draw back to the engine shape.
    return drawLdtkEntityTile(ctx, art.tile, entity.rect, tilesets, art.tileRenderMode, art.nineSliceBorders);
  };
  // Every drawn kind routes through the same rule.
  return {
    spawn: draw,
    exit: draw,
    platform: draw,
    passthrough: draw,
    trap: draw,
    hazard: draw,
    decoration: draw,
    trigger: draw,
    movingPlatform: draw,
    enemy: draw,
    collectible: draw,
    spring: draw,
    dashRefill: draw,
  };
}
