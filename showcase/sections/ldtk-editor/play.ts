/**
 * Play mode — run the platformer on the level currently being edited.
 *
 * The bridge is `ldtkLevelToLevelData`: the LDtk IntGrid becomes the engine's
 * `TileGrid`, and the same compiled geometry the runtime uses drives collision.
 * The art stays LDtk's, drawn by the same `drawLdtkLevel` the editor uses, so
 * play mode is the level as it will actually ship rather than a preview.
 *
 * The session owns a clone of the level data; nothing it does can write back
 * into the project being edited.
 */

import {
  compileGeneratedLevel,
  stepPlatformer,
  PRECISION_PLATFORMER,
  type CompiledLevel,
  type PlatformerConfig,
  type PlatformerInput,
  type PlatformerState,
} from '../../../src/platformer';
import { createCamera, updateCamera, type Camera } from '../../../src/camera';
import {
  createKeyboardAdapter,
  type KeyboardAdapter,
  type PolledEdge,
} from '../../../src/input';
import { drawLdtkLevel, type LdtkLevel, type LdtkTilesetBundle } from '../../../src/ldtk';
import type { LevelData } from '../../../src/level/types';
import type { GeneratedTileSemantics } from '../../../src/level/tile-semantics';

/** An edge that is never pressed — the default for an unmapped action. */
const IDLE_EDGE: PolledEdge = { pressed: false, released: false, held: false };

/** Colors for the play-mode actor. */
const PLAYER_COLOR = '#ffd166';
const PLAYER_OUTLINE = '#1d1300';

/** A running play session. */
export interface PlaySession {
  step(dt: number): void;
  render(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    level: LdtkLevel,
    tilesets: LdtkTilesetBundle,
  ): void;
  dispose(): void;
}

/** Keys the section claims while playing, so the page does not scroll under it. */
const CLAIMED_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space',
]);

/**
 * Start a play session over a translated level.
 *
 * @param level - Level data translated from the LDtk level.
 * @param semantics - Which IntGrid values are solid or passthrough.
 * @param canvas - Canvas the session draws into; used to size the camera.
 */
export function createPlaySession(
  level: LevelData,
  semantics: GeneratedTileSemantics,
  canvas: HTMLCanvasElement,
): PlaySession {
  const config: Readonly<PlatformerConfig> = PRECISION_PLATFORMER;
  const compiled: CompiledLevel = compileGeneratedLevel(
    { level, tileSemantics: semantics },
    { config },
  );

  let state: PlatformerState = compiled.initialState;
  let camera: Camera = createCamera();
  const keyboard: KeyboardAdapter = createKeyboardAdapter({
    codeToAction: {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      KeyA: 'left',
      KeyD: 'right',
      Space: 'jump',
      ArrowUp: 'jump',
      KeyW: 'jump',
      KeyR: 'reset',
    },
  });

  // The platformer claims arrows and space while playing; without this the page
  // scrolls out from under the level on the first jump.
  const suppress = (event: KeyboardEvent): void => {
    if (CLAIMED_KEYS.has(event.code)) event.preventDefault();
  };
  window.addEventListener('keydown', suppress);

  const viewport = { width: canvas.width, height: canvas.height };

  return {
    step(dt) {
      const edges = keyboard.poll();
      const left = edges['left'] ?? IDLE_EDGE;
      const right = edges['right'] ?? IDLE_EDGE;
      if (edges['reset']?.pressed === true) state = compiled.initialState;

      const input: PlatformerInput = {
        moveX: left.held === right.held ? 0 : left.held ? -1 : 1,
        jump: edges['jump'] ?? IDLE_EDGE,
        dash: null,
      };
      state = stepPlatformer(state, input, compiled.staticSolids, dt, config).state;

      // Falling out of the level is a normal outcome while testing an
      // unfinished room, so respawn rather than letting the actor vanish.
      if (state.core.y > level.height + level.tileSize * 4) {
        state = compiled.initialState;
      }
      camera = updateCamera(
        camera,
        state.core,
        { width: level.width, height: level.height },
        viewport,
      );
    },

    render(context, width, height, ldtkLevel, tilesets) {
      context.imageSmoothingEnabled = false;
      context.fillStyle = '#0b0e12';
      context.fillRect(0, 0, width, height);

      const offsetX = -Math.round(camera.x);
      const offsetY = -Math.round(camera.y);
      drawLdtkLevel(context, ldtkLevel, {
        tilesets,
        worldOffset: { x: offsetX, y: offsetY },
        view: { x: camera.x, y: camera.y, width, height },
      });

      const { core } = state;
      context.fillStyle = PLAYER_COLOR;
      context.fillRect(core.x + offsetX, core.y + offsetY, core.width, core.height);
      context.strokeStyle = PLAYER_OUTLINE;
      context.lineWidth = 1;
      context.strokeRect(
        core.x + offsetX + 0.5,
        core.y + offsetY + 0.5,
        core.width - 1,
        core.height - 1,
      );
    },

    dispose() {
      window.removeEventListener('keydown', suppress);
      keyboard.dispose();
    },
  };
}
