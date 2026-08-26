/**
 * Camera (§5.4): the Celeste preset — one follow vcam per room at the
 * campaign-constant window zoom, driven through the camera brain.
 *
 * The zoom is fitted to the 320x184 window, never to the room. Fitting the
 * room varies zoom with room size and is a §12.8 failure.
 */
import {
  CELESTE_FOLLOW_AHEAD,
  CELESTE_FOLLOW_CENTERED,
  celesteFollowVcam,
  type CameraBrainOptions,
  type CompiledLdtkRoom,
  type VirtualCamera,
} from 'aicraft-engine';
import type { Game } from './types';

/** One cached vcam per room — the zoom depends on the viewport, so resize clears. */
export class RoomVcams {
  private readonly cache = new Map<string, VirtualCamera>();
  private key = '';

  vcamFor(
    room: CompiledLdtkRoom,
    viewport: { width: number; height: number },
    dpr: number,
  ): VirtualCamera {
    const k = `${viewport.width}x${viewport.height}@${dpr}`;
    if (k !== this.key) {
      this.cache.clear();
      this.key = k;
    }
    const iid = room.ldtkLevel.iid;
    let vcam = this.cache.get(iid);
    if (!vcam) {
      vcam = celesteFollowVcam(iid, {
        viewport,
        dpr,
        followX: CELESTE_FOLLOW_AHEAD,
        followY: CELESTE_FOLLOW_CENTERED,
      });
      this.cache.set(iid, vcam);
    }
    return vcam;
  }
}

export const vcams = new RoomVcams();

export function cameraOptionsFor(game: Game, dt: number): CameraBrainOptions {
  return {
    vcams: [vcams.vcamFor(game.active, game.viewport, game.dpr)],
    targets: { player: game.player.core },
    bounds: { width: game.active.levelData.width, height: game.active.levelData.height },
    viewport: game.viewport,
    activeId: game.active.ldtkLevel.iid,
    dt,
  };
}
