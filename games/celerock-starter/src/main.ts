/**
 * Celerock — §14 Stage 1, complete and working.
 *
 * This stage is GIVEN. It is the one every known run got wrong in some way, and
 * the one whose mistakes never show up in a screenshot: the painter over the
 * surface cache, the Celeste camera preset at a campaign-constant zoom, the
 * letterbox mask, and the single `composeCameraTransform` render skeleton that
 * every later stage inherits.
 *
 * Stage 2 onward is yours. Work §14's stages in order. Bump `config.stage` in
 * package.json as each lands — `npm test` and `npm run build` gate on it, so a
 * stage you have not finished stays red and a stage you have goes green.
 */
import {
  DEFAULT_FIXED_DT,
  IDLE_EDGE,
  canvasCssViewport,
  createCameraBrain,
  createPlatformerState,
  getDevicePixelRatio,
  prefersReducedMotion,
  resizeCanvasToBackingStore,
  snapCameraBrain,
  stepPlatformer,
  updateCameraBrain,
  type PlatformerInput,
} from 'aicraft-engine';

import { startFixedTickGame } from './recipes/fixed-tick-game';
import { cameraOptionsFor } from './camera';
import { loadWorld, playConfigFor } from './ldtk';
import { renderGame } from './render';
import type { Game } from './types';

/** Stage 2 replaces this with the real merged device map (§4.3). */
const IDLE_INPUT: PlatformerInput = {
  moveX: 0,
  jump: IDLE_EDGE,
  dash: IDLE_EDGE,
  grab: IDLE_EDGE,
};

function upkeepCanvas(game: Game): void {
  const rect = game.canvas.getBoundingClientRect();
  game.dpr = resizeCanvasToBackingStore(game.canvas, rect.width, rect.height);
  game.viewport = canvasCssViewport(game.canvas);
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  if (!canvas) throw new Error('[celerock] no #game canvas in index.html');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('[celerock] 2d context unavailable');

  canvas.style.width = '100vw';
  canvas.style.height = '100vh';

  const world = await loadWorld();
  if (!world) return;

  const start = world.rooms.getStartRoom();
  if (!start.ok) {
    console.error('[celerock] start room failed to resolve', start.diagnostics);
    return;
  }

  const active = start.room;
  const config = playConfigFor(active.levelData.tileSize);
  const spawn = active.compiled.initialState.core;

  const game: Game = {
    canvas,
    ctx,
    painter: world.painter,
    tilesets: world.tilesets,
    active,
    brain: createCameraBrain(),
    player: createPlatformerState(spawn.x, spawn.y, config, spawn.width, spawn.height, 1),
    config,
    viewport: { width: 1, height: 1 },
    dpr: getDevicePixelRatio(),
  };

  upkeepCanvas(game);
  game.brain = snapCameraBrain(game.brain, cameraOptionsFor(game, DEFAULT_FIXED_DT));
  window.addEventListener('resize', () => upkeepCanvas(game));

  startFixedTickGame({
    fixedDt: DEFAULT_FIXED_DT,
    reducedMotion: prefersReducedMotion,
    step: (dt: number) => {
      const stepped = stepPlatformer(
        game.player,
        IDLE_INPUT,
        game.active.solids,
        dt,
        game.config,
      );
      game.player = stepped.state;
      game.brain = updateCameraBrain(game.brain, cameraOptionsFor(game, dt));
    },
    render: () => renderGame(game),
    onError: (error: unknown) => console.error('[celerock] loop error', error),
  });

  // §5.7 — dev-time .ldtk hot reload. Dead code in production builds. The vite
  // plugin fires 'ldtk:update'; this is the half that consumes it. Both halves
  // or neither: a mounted plugin whose event nothing handles has never reloaded.
  if (import.meta.hot) {
    import.meta.hot.on('ldtk:update', () => {
      console.info('[celerock] ldtk:update — implement the §5.7 transactional swap here');
    });
  }
}

void boot().catch((error: unknown) => {
  console.error('[celerock] boot failed', error);
});
