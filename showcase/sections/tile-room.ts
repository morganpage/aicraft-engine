/**
 * Section 6 — Tile room.
 *
 * The showcase's **second validation scene**, and a blocking Phase 0
 * deliverable of `docs/design/level-visual-rendering-plan.md` (§9.0). The
 * playground validates the rectangle half of the level-visual plan: entity
 * rectangles, roles, edge exposure, edit/play split, and a world that equals
 * its screen. It cannot validate the tile half at all — it has no tiles and no
 * camera. Everything the tile renderer will need proved (`connectivity`,
 * `visibleTileRange`, culling invariance, tile surface details, scrolling) has
 * no consumer without this scene.
 *
 * So: a real tile grid from `src/levelgen`, compiled through
 * `compileGeneratedLevel`, simulated by `stepPlatformer`, and viewed through a
 * 600×400 camera over a level that is 960×544 — smaller viewport than level, on
 * both axes.
 *
 * Two scenes, switchable:
 *
 * - **Generated room** — `generateLevel(1337, …)`. The honest output of the
 *   generator that shipped in 0.4: a ground strip with gaps and a couple of
 *   single-tile platforms.
 * - **Topology room** — a hand-authored fixture embedding every §14.6 shape
 *   (isolated cell, ledge, corner, tunnel, pillar, enclosed room, staircase).
 *   The generator does not currently emit these, and the renderer still has to
 *   handle them.
 *
 * Two treatments, switchable:
 *
 * - **Fallback** — the current renderer, unchanged. The baseline.
 * - **Terrain materials** — the Phase 2 production connected-terrain renderer.
 *
 * Gameplay is explicitly activated from the canvas overlay. This keeps page
 * keyboard shortcuts inert until the reviewer chooses to play, while allowing
 * user-driven simulation even when reduced motion is preferred.
 */

import { createGameLoop, type GameLoop } from '../../src/game-loop';
import { createCamera, updateCamera, type Camera } from '../../src/camera';
import {
  compileGeneratedLevel,
  advanceMovingPlatform,
  movingPlatformToSolid,
  createMovingPlatformDisplacementProvider,
  stepPlatformer,
  PRECISION_PLATFORMER,
  type CompiledLevel,
  type CompiledMovingPlatform,
  type PlatformerConfig,
  type PlatformerInput,
  type PlatformerState,
} from '../../src/platformer';
import { DEFAULT_JUMP } from '../../src/animation/jump';
import type { Solid } from '../../src/collision';
import {
  collect,
  derivePickups,
  type CollectibleEntity,
  type CollectibleSave,
} from '../../src/collectibles';
import {
  createKeyboardAdapter,
  createTouchButtonSet,
  orEdges,
  type KeyboardAdapter,
  type PolledEdge,
  type TouchButtonSetAdapter,
} from '../../src/input';
import { resizeCanvasToBackingStore, getDevicePixelRatio } from '../../src/primitives';
import type { LevelRect } from '../../src/level/types';
import type { Store } from '../store';
import type { GlobalState } from '../main';
import {
  createGeneratedRoomScene,
  createTopologyRoomScene,
  clampCameraToLevel,
  TILE_ROOM_SEED,
  TILE_ROOM_VIEW_H,
  TILE_ROOM_VIEW_W,
  type TileRoomScene,
} from './tile-room-fixtures';
import { drawTileRoomFrame, type TileRoomTreatment } from './tile-room-render';

/** Fixed timestep, matching every other simulated section. */
const DT = 1 / 60;

/** An edge that is never pressed — used when input is gated off. */
const IDLE_EDGE: PolledEdge = { pressed: false, released: false, held: false };

/**
 * Keys suppressed while the section is onscreen so arrow/space input drives the
 * room instead of scrolling the page. Mirrors the playground's guard.
 */
const SUPPRESSED_CODES: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Space',
]);

/**
 * Kernel tuning. Identical to the playground's numbers so a reviewer comparing
 * the two scenes is comparing *rendering*, not feel: gravity 1800 px/s²,
 * move 180 px/s, an 81px apex over 0.3s (five 16px tiles).
 */
const TILE_ROOM_CONFIG: Readonly<PlatformerConfig> = {
  ...PRECISION_PLATFORMER,
  gravity: 1800,
  maxFallSpeed: 720,
  moveSpeed: 180,
  airControl: 0.5,
  jump: {
    ...DEFAULT_JUMP,
    apexHeight: 81,
    timeToApex: 0.3,
  },
};

/**
 * Camera framing used for the reduced-motion still and as the loop's starting
 * position: a little way into the level so the shot is not a corner.
 */
const STATIC_CAMERA_X = 180;
const STATIC_CAMERA_Y = 144;

/** Live per-scene runtime. Rebuilt whenever the scene changes. */
interface SceneRuntime {
  readonly scene: TileRoomScene;
  readonly compiled: CompiledLevel;
  state: PlatformerState;
  platforms: readonly CompiledMovingPlatform[];
  camera: Camera;
}

function createSceneRuntime(scene: TileRoomScene): SceneRuntime {
  const compiled = compileGeneratedLevel(
    { level: scene.level, tileSemantics: scene.tileSemantics },
    { config: TILE_ROOM_CONFIG },
  );
  return {
    scene,
    compiled,
    state: compiled.initialState,
    platforms: compiled.movingPlatforms,
    camera: createCamera(),
  };
}

/** Runtime rectangles for this frame's moving platforms, keyed by entity id. */
function movingRectsOf(
  platforms: readonly CompiledMovingPlatform[],
): ReadonlyMap<number, LevelRect> {
  const map = new Map<number, LevelRect>();
  for (const p of platforms) {
    map.set(p.entity.id, {
      x: p.x,
      y: p.y,
      width: p.entity.rect.width,
      height: p.entity.rect.height,
    });
  }
  return map;
}

/**
 * Initialize the tile-room section.
 *
 * @param container - the `<section id="tile-room">` element
 * @param _store - the global observable store. Intentionally unused: the scene,
 *   treatment, and marker toggles are presentation state local to this section,
 *   and the room's seed is fixed so the benchmark and the contact sheets frame
 *   the same level. Accepted to match the uniform section-init signature.
 * @returns a `dispose` callback (idempotent — safe to call more than once)
 */
export function initTileRoom(
  container: HTMLElement,
  _store: Store<GlobalState>,
): () => void {
  const canvas = container.querySelector<HTMLCanvasElement>('.tile-room-canvas')!;
  const ctx = canvas.getContext('2d')!;
  const dpr = resizeCanvasToBackingStore(canvas, TILE_ROOM_VIEW_W, TILE_ROOM_VIEW_H);
  ctx.scale(dpr, dpr);

  const statusPanel = container.querySelector<HTMLElement>('.tile-room-status')!;
  const playOverlay = container.querySelector<HTMLElement>('.tile-room-play-overlay')!;
  const playBtn = container.querySelector<HTMLButtonElement>('.tile-room-play')!;
  const sceneBtns = Array.from(
    container.querySelectorAll<HTMLButtonElement>('.tile-room-btn[data-scene]'),
  );
  const treatmentBtns = Array.from(
    container.querySelectorAll<HTMLButtonElement>('.tile-room-btn[data-treatment]'),
  );
  const markerBtn = container.querySelector<HTMLButtonElement>('.tile-room-markers')!;

  // Built once: generation is deterministic, so rebuilding on every toggle
  // would only burn time and break the WeakMap-keyed exposure cache in the
  // render module.
  const scenes = {
    generated: createGeneratedRoomScene(),
    topology: createTopologyRoomScene(),
  } satisfies Record<string, TileRoomScene>;

  let runtime: SceneRuntime = createSceneRuntime(scenes.generated);
  let treatment: TileRoomTreatment = 'fallback';
  let showMarkers = false;
  let playing = false;
  let collectibleSave: CollectibleSave = { collected: [] };
  let collectedEntityIds = new Set<number>();
  let collectedValue = 0;

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

  const touch: TouchButtonSetAdapter = createTouchButtonSet({
    elements: [
      container.querySelector<HTMLButtonElement>('.tile-room-touch-btn--left'),
      container.querySelector<HTMLButtonElement>('.tile-room-touch-btn--right'),
      container.querySelector<HTMLButtonElement>('.tile-room-touch-btn--jump'),
    ],
  });

  let onscreen = false;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) onscreen = entry.isIntersecting;
    },
    { threshold: 0.01 },
  );
  observer.observe(container);

  const onKeyDownSuppress = (e: KeyboardEvent): void => {
    if (!onscreen || !playing) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      deactivateGameplay();
      return;
    }
    if (SUPPRESSED_CODES.has(e.code)) e.preventDefault();
  };
  window.addEventListener('keydown', onKeyDownSuppress, { capture: true });

  // --- Rendering -----------------------------------------------------------

  const render = (): void => {
    drawTileRoomFrame(ctx, runtime.scene, {
      camera: runtime.camera,
      viewW: TILE_ROOM_VIEW_W,
      viewH: TILE_ROOM_VIEW_H,
      dpr: getDevicePixelRatio(),
      player: runtime.state.core,
      movingRects: movingRectsOf(runtime.platforms),
      treatment,
      showMarkers,
      collectedEntityIds,
      worldSeed: TILE_ROOM_SEED,
    });
  };

  const updateStatus = (): void => {
    const { level } = runtime.scene;
    const cells = level.tiles.cols * level.tiles.rows;
    const collectibleCount = level.entities.filter(
      (entity) => entity.kind === 'collectible',
    ).length;
    statusPanel.textContent =
      `${playing ? 'Playing · Esc to stop' : 'Paused · choose Play room'} · ` +
      `${runtime.scene.label} · ${level.tiles.cols}×${level.tiles.rows} tiles ` +
      `(${cells} cells, ${level.width}×${level.height} px) · ` +
      `pickups ${collectedEntityIds.size}/${collectibleCount} (value ${collectedValue}) · ` +
      `camera ${Math.round(runtime.camera.x)}, ${Math.round(runtime.camera.y)} · ` +
      `${treatment === 'fallback' ? 'Fallback renderer' : `${treatment[0].toUpperCase()}${treatment.slice(1)} theme`}`;
  };

  const updateChrome = (): void => {
    for (const btn of sceneBtns) {
      btn.setAttribute(
        'aria-pressed',
        String(btn.dataset.scene === runtime.scene.id),
      );
    }
    for (const btn of treatmentBtns) {
      btn.setAttribute('aria-pressed', String(btn.dataset.treatment === treatment));
    }
    markerBtn.setAttribute('aria-pressed', String(showMarkers));
    updateStatus();
  };

  // --- Controls ------------------------------------------------------------

  const selectScene = (id: keyof typeof scenes): void => {
    if (runtime.scene.id === id) return;
    runtime = createSceneRuntime(scenes[id]);
    collectibleSave = { collected: [] };
    collectedEntityIds = new Set();
    collectedValue = 0;
    runtime.camera = {
      ...clampCameraToLevel(STATIC_CAMERA_X, STATIC_CAMERA_Y, scenes[id].level),
    };
    updateChrome();
    render();
  };

  const sceneHandlers = sceneBtns.map((btn) => {
    const handler = (): void => {
      const id = btn.dataset.scene;
      if (id === 'generated' || id === 'topology') selectScene(id);
    };
    btn.addEventListener('click', handler);
    return { btn, handler };
  });

  const treatmentHandlers = treatmentBtns.map((btn) => {
    const handler = (): void => {
      const next = btn.dataset.treatment;
      if (
        next !== 'fallback' &&
        next !== 'ruins' &&
        next !== 'cavern' &&
        next !== 'mechanical' &&
        next !== 'outdoor'
      ) return;
      treatment = next;
      updateChrome();
      render();
    };
    btn.addEventListener('click', handler);
    return { btn, handler };
  });

  const onMarkerToggle = (): void => {
    showMarkers = !showMarkers;
    updateChrome();
    render();
  };
  markerBtn.addEventListener('click', onMarkerToggle);

  // --- Simulation ----------------------------------------------------------

  const resetPlayer = (resetPickups = false): void => {
    runtime.state = runtime.compiled.initialState;
    runtime.platforms = runtime.compiled.movingPlatforms;
    if (resetPickups) {
      collectibleSave = { collected: [] };
      collectedEntityIds = new Set();
      collectedValue = 0;
    }
  };

  const loop: GameLoop = createGameLoop({
    fixedDt: DT,
    step: () => {
      const kb = keyboard.poll();
      const t = touch.poll();
      const left = orEdges(kb['left'] ?? IDLE_EDGE, t[0] ?? IDLE_EDGE);
      const right = orEdges(kb['right'] ?? IDLE_EDGE, t[1] ?? IDLE_EDGE);
      const jump = orEdges(kb['jump'] ?? IDLE_EDGE, t[2] ?? IDLE_EDGE);

      if (kb['reset']?.pressed) resetPlayer(true);

      const moveX: -1 | 0 | 1 = !onscreen
        ? 0
        : left.held === right.held
          ? 0
          : left.held
            ? -1
            : 1;
      const input: PlatformerInput = {
        moveX,
        jump: onscreen ? jump : IDLE_EDGE,
        dash: null,
      };

      // Advance platforms before composing solids so collision resolves
      // against this tick's positions, and the displacement provider sees
      // exactly one tick of motion.
      const advanced = runtime.platforms.map((p) => advanceMovingPlatform(p, DT));
      const displacement = createMovingPlatformDisplacementProvider(
        advanced,
        runtime.platforms,
      );
      const solids: Solid[] = [
        ...runtime.compiled.staticSolids,
        ...advanced.map(movingPlatformToSolid),
      ];
      runtime.platforms = advanced;

      runtime.state = stepPlatformer(
        runtime.state,
        input,
        solids,
        DT,
        TILE_ROOM_CONFIG,
        displacement,
      ).state;

      const collectibles = runtime.scene.level.entities.filter(
        (entity): entity is CollectibleEntity => entity.kind === 'collectible',
      );
      const pickups = derivePickups(runtime.state.core, collectibles, collectibleSave);
      for (const id of pickups.collected) {
        const entity = collectibles.find((item) => item.id === id);
        collectibleSave = collect(collectibleSave, String(id));
        collectedEntityIds.add(id);
        collectedValue += entity?.props.value ?? 1;
      }

      // A player who falls out of the world (the generated room has gaps that
      // drop to nothing) returns to spawn rather than accelerating forever.
      if (runtime.state.core.y > runtime.scene.level.height + 64) resetPlayer(true);

      const core = runtime.state.core;
      runtime.camera = updateCamera(
        runtime.camera,
        { x: core.x, y: core.y, width: core.width, height: core.height },
        { width: runtime.scene.level.width, height: runtime.scene.level.height },
        { width: TILE_ROOM_VIEW_W, height: TILE_ROOM_VIEW_H },
      );
    },
    render: () => {
      render();
      updateStatus();
    },
  });

  // --- Boot ----------------------------------------------------------------

  const activateGameplay = (): void => {
    if (playing) return;
    playing = true;
    playOverlay.hidden = true;
    canvas.setAttribute('aria-label', 'Playable scrolling tile room. Press Escape to stop.');
    // Drain key edges gathered while the room was inactive before accepting
    // gameplay input.
    keyboard.poll();
    loop.start();
    updateStatus();
    canvas.focus({ preventScroll: true });
  };

  function deactivateGameplay(): void {
    if (!playing) return;
    playing = false;
    loop.stop();
    keyboard.poll();
    playOverlay.hidden = false;
    canvas.setAttribute(
      'aria-label',
      'Paused scrolling tile room. Activate Play room to use keyboard controls.',
    );
    updateStatus();
    playBtn.focus({ preventScroll: true });
  }

  const onPlay = (): void => activateGameplay();
  playBtn.addEventListener('click', onPlay);

  runtime.camera = {
    ...clampCameraToLevel(STATIC_CAMERA_X, STATIC_CAMERA_Y, runtime.scene.level),
  };
  updateChrome();
  render();

  let disposed = false;
  return (): void => {
    if (disposed) return;
    disposed = true;
    loop.dispose();
    keyboard.dispose();
    touch.dispose();
    observer.disconnect();
    playBtn.removeEventListener('click', onPlay);
    window.removeEventListener('keydown', onKeyDownSuppress, { capture: true });
    for (const { btn, handler } of sceneHandlers) btn.removeEventListener('click', handler);
    for (const { btn, handler } of treatmentHandlers) {
      btn.removeEventListener('click', handler);
    }
    markerBtn.removeEventListener('click', onMarkerToggle);
  };
}
