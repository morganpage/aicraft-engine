/**
 * Top-down map renderer: terrain tiles, warp doors, heal points, and NPCs
 * from palette-driven primitives. Decorative per-tile variation is addressed
 * by `deriveVisualSeed` and a presentation tick — it never feeds simulation.
 */

import { deriveVisualSeed } from '../../rng/visual-seed';
import { mixHex } from '../../primitives/color';
import type { RpgMapDefinition } from '../map';
import type { RpgVisualTheme } from './theme';
import { DEFAULT_RPG_THEME } from './theme';

export interface RpgMapDrawOptions {
  readonly theme?: RpgVisualTheme;
  /** Camera offset in pixels (world → screen). Default none. */
  readonly cameraX?: number;
  readonly cameraY?: number;
  /** Presentation tick for decorative motion only. */
  readonly tick?: number;
}

/**
 * Draw a full map. Tiles are drawn row-major; grass gets blade marks,
 * obstacles get rock shading, doors and heal points get explicit markers so
 * walkability and interaction stay visually unambiguous.
 */
export function drawRpgMap(
  ctx: CanvasRenderingContext2D,
  map: RpgMapDefinition,
  options: RpgMapDrawOptions = {},
): void {
  const theme = options.theme ?? DEFAULT_RPG_THEME;
  const tick = options.tick ?? 0;
  const cameraX = options.cameraX ?? 0;
  const cameraY = options.cameraY ?? 0;

  for (let y = 0; y < map.heightTiles; y++) {
    for (let x = 0; x < map.widthTiles; x++) {
      const index = y * map.widthTiles + x;
      const kind = map.terrain[index];
      const screenX = x * map.tileSize - cameraX;
      const screenY = y * map.tileSize - cameraY;
      const variation = deriveVisualSeed(1, map.id, x, y) % 100 / 100;

      switch (kind) {
        case 'path':
          ctx.fillStyle = variation > 0.5 ? theme.terrain.path : mixHex(theme.terrain.path, '#000000', 0.04);
          ctx.fillRect(screenX, screenY, map.tileSize, map.tileSize);
          break;
        case 'grass': {
          ctx.fillStyle = variation > 0.5 ? theme.terrain.grass : theme.terrain.grassAlt;
          ctx.fillRect(screenX, screenY, map.tileSize, map.tileSize);
          ctx.fillStyle = mixHex(theme.terrain.grass, '#ffffff', 0.18);
          const blades = 3;
          for (let b = 0; b < blades; b++) {
            const sway = ((tick + b * 7 + variation * 100) % 16) < 8 ? 0 : 1;
            const bx = screenX + 3 + b * Math.max(2, (map.tileSize - 6) / blades) + sway;
            ctx.fillRect(Math.round(bx), screenY + map.tileSize - 6, 1, 4);
          }
          break;
        }
        case 'obstacle':
          ctx.fillStyle = theme.terrain.ground;
          ctx.fillRect(screenX, screenY, map.tileSize, map.tileSize);
          ctx.fillStyle = theme.terrain.obstacle;
          ctx.fillRect(screenX + 2, screenY + 2, map.tileSize - 4, map.tileSize - 4);
          ctx.fillStyle = theme.terrain.obstacleEdge;
          ctx.fillRect(screenX + 2, screenY + map.tileSize - 4, map.tileSize - 4, 2);
          break;
        default:
          ctx.fillStyle = variation > 0.5 ? theme.terrain.ground : theme.terrain.groundAlt;
          ctx.fillRect(screenX, screenY, map.tileSize, map.tileSize);
          break;
      }

      const warp = map.warps.find((w) => w.source.tileX === x && w.source.tileY === y);
      if (warp) {
        ctx.fillStyle = theme.markers.door;
        ctx.fillRect(screenX + 3, screenY + 3, map.tileSize - 6, map.tileSize - 6);
        ctx.fillStyle = theme.terrain.obstacleEdge;
        ctx.fillRect(screenX + map.tileSize / 2 - 1, screenY + 4, 2, 3);
      }
      const heal = map.healPoints.find((h) => h.tile.tileX === x && h.tile.tileY === y);
      if (heal) {
        ctx.fillStyle = theme.markers.heal;
        const cx = screenX + map.tileSize / 2;
        const cy = screenY + map.tileSize / 2;
        ctx.fillRect(cx - 1, cy - 5, 2, 10);
        ctx.fillRect(cx - 5, cy - 1, 10, 2);
      }
    }
  }
}

/** Draw a subtle encounter-zone shimmer over grass tiles (decorative only). */
export function drawRpgEncounterShimmer(
  ctx: CanvasRenderingContext2D,
  map: RpgMapDefinition,
  options: RpgMapDrawOptions = {},
): void {
  const theme = options.theme ?? DEFAULT_RPG_THEME;
  const tick = options.tick ?? 0;
  const phase = Math.floor(tick / 24) % 2;
  ctx.fillStyle = phase === 0 ? theme.markers.encounter : mixHex(theme.markers.encounter, '#000000', 0.35);
  for (let index = 0; index < map.encounterZones.length; index++) {
    if (map.encounterZones[index] == null) continue;
    const x = (index % map.widthTiles) * map.tileSize - (options.cameraX ?? 0);
    const y = Math.floor(index / map.widthTiles) * map.tileSize - (options.cameraY ?? 0);
    ctx.fillRect(x + map.tileSize - 5, y + 3, 2, 2);
    ctx.fillRect(x + 3, y + map.tileSize - 5, 2, 2);
  }
}
