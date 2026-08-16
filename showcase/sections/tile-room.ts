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
import type { LevelData, LevelEntity, LevelRect } from '../../src/level/types';
import {
  hitTestTerrainArtDualGrid,
  editTerrainArtSourceTile,
  clearTerrainArtSourceTileEdits,
  renderTerrainArtSourceTile,
  updateTerrainArtGenerator,
  terrainArtLinePixels,
  terrainArtRectanglePixels,
  terrainArtEllipsePixels,
  terrainArtFloodFillPixels,
  paintTerrainArtLogicalCells,
  terrainArtLogicalLine,
  terrainArtLogicalRectangle,
  terrainArtLogicalFill,
  pickTerrainArtLogicalValue,
  addTerrainArtMaterial,
  removeTerrainArtMaterial,
  renameTerrainArtMaterial,
  resetTerrainArtMaterial,
  applyTerrainArtPreset,
  type TerrainArtPresetId,
  hashTerrainArtProject,
  resizeTerrainArtProject,
  updateTerrainArtLayer,
  reorderTerrainArtLayer,
  serializeTerrainArtProject,
  deserializeTerrainArtProject,
  generateTerrainArtMaterialAtlas,
  addTerrainArtVariant,
  updateTerrainArtVariant,
  pinTerrainArtOccurrenceVariant,
  terrainArtVariantUsage,
  transformTerrainArtSourceTile,
  moveTerrainArtSourceTile,
  moveTerrainArtSourceSelection,
  stampTerrainArtSourceTile,
  type TerrainArtPixelSelection,
  type TerrainArtTransform,
  setTerrainArtTransitionRule,
  editTerrainArtOccurrenceLayer,
  deleteTerrainArtOccurrenceOverride,
  renderTerrainArtOccurrenceTile,
  getTerrainArtOccurrenceStatus,
  rebindTerrainArtOccurrenceOverride,
  hideTerrainArtOccurrenceOverride,
  clearTerrainArtOccurrenceOverrides,
  type PreparedTerrainArtDualGrid,
  type TerrainArtImportedAssetResolver,
  type TerrainArtProject,
  type TerrainArtPixelEdit,
  type TerrainArtDualGridMask,
  type TerrainArtPalette,
  type TerrainArtVisualHit,
} from '../../src/terrain-art';
import type { Store } from '../store';
import type { GlobalState } from '../main';
import {
  createGeneratedRoomScene,
  createTopologyRoomScene,
  addTileRoomEntity,
  addTileRoomMovingPlatform,
  addTileRoomMovingPlatformWaypoint,
  addTileRoomSpikes,
  deleteTileRoomEntity,
  deleteTileRoomSpikes,
  duplicateTileRoomEntity,
  moveTileRoomEntity,
  moveTileRoomMovingPlatform,
  moveTileRoomMovingPlatformWaypoint,
  moveTileRoomSceneSpawn,
  removeTileRoomMovingPlatformWaypoint,
  renameTileRoomScene,
  updateTileRoomCollectible,
  updateTileRoomExit,
  updateTileRoomMovingPlatform,
  isTileRoomExitReached,
  isTileRoomPlayerDead,
  clampCameraToLevel,
  TILE_ROOM_SEED,
  TILE_ROOM_VIEW_H,
  TILE_ROOM_VIEW_W,
  type TileRoomPlaceableEntity,
  type TileRoomScene,
} from './tile-room-fixtures';
import {
  hashTileRoomScene,
  parseTileRoomScene,
  serializeTileRoomScene,
} from './tile-room-level-io';
import { drawTileRoomFrame, type TileRoomTreatment } from './tile-room-render';
import {
  createTileRoomTerrainArtAtlas,
  createTileRoomTerrainArtProject,
  prepareTileRoomTerrainArt,
} from './tile-room-dual-grid';
import {
  createTileRoomTilesetImport,
  type TileRoomTilesetImport,
} from './tile-room-tileset-import';

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
  airAccelMultiplier: 0.5,
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
  scene: TileRoomScene;
  readonly compiled: CompiledLevel;
  state: PlatformerState;
  platforms: readonly CompiledMovingPlatform[];
  camera: Camera;
}

function createSceneRuntime(scene: TileRoomScene): SceneRuntime {
  // These fixtures author the spawn entity as an actor-top-left tile rect, not
  // the LDtk feet-center anchor `compileGeneratedLevel` defaults to.
  const compiled = compileGeneratedLevel(
    { level: scene.level, tileSemantics: scene.tileSemantics },
    { config: TILE_ROOM_CONFIG, spawnResolution: 'actor-top-left' },
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
  // Pixel art: draw nearest-neighbour through the DPR scale, not bilinear.
  // Every other canvas in this section already does this; the main canvas was
  // the lone holdout, which is why tiles looked soft even at a 1:1 tile size.
  ctx.imageSmoothingEnabled = false;

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
  const dualOverlayBtn = container.querySelector<HTMLButtonElement>('.tile-room-dual-overlay')!;
  const logicalOverlayBtn = container.querySelector<HTMLButtonElement>('.tile-room-logical-overlay')!;
  const levelToolButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-level-tool]'));
  const terrainKindSelect = container.querySelector<HTMLSelectElement>('.tile-room-terrain-kind')!;
  const levelUndoButton = container.querySelector<HTMLButtonElement>('.tile-room-level-undo')!;
  const levelRedoButton = container.querySelector<HTMLButtonElement>('.tile-room-level-redo')!;
  const levelNameInput = container.querySelector<HTMLInputElement>('.tile-room-level-name')!;
  const levelSaveButton = container.querySelector<HTMLButtonElement>('.tile-room-level-save')!;
  const levelLoadButton = container.querySelector<HTMLButtonElement>('.tile-room-level-load')!;
  const levelExportButton = container.querySelector<HTMLButtonElement>('.tile-room-level-export')!;
  const levelImportButton = container.querySelector<HTMLButtonElement>('.tile-room-level-import')!;
  const levelImportFile = container.querySelector<HTMLInputElement>('.tile-room-level-import-file')!;
  const levelResetButton = container.querySelector<HTMLButtonElement>('.tile-room-level-reset')!;
  const levelSaveStatus = container.querySelector<HTMLOutputElement>('.tile-room-level-save-status')!;
  const overviewButton = container.querySelector<HTMLButtonElement>('.tile-room-overview')!;
  const zoomOutButton = container.querySelector<HTMLButtonElement>('.tile-room-zoom-out')!;
  const zoomInButton = container.querySelector<HTMLButtonElement>('.tile-room-zoom-in')!;
  const fitButton = container.querySelector<HTMLButtonElement>('.tile-room-fit')!;
  const zoomValue = container.querySelector<HTMLOutputElement>('.tile-room-zoom-value')!;
  const canvasWrap = container.querySelector<HTMLElement>('.tile-room-canvas-wrap')!;
  const inspector = container.querySelector<HTMLElement>('.tile-room-inspector')!;
  const inspectorTitle = container.querySelector<HTMLElement>('.tile-room-inspector-title')!;
  const inspectorDetail = container.querySelector<HTMLElement>('.tile-room-inspector-detail')!;
  const objectPanel = container.querySelector<HTMLElement>('.tile-room-object-panel')!;
  const objectTitle = container.querySelector<HTMLElement>('.tile-room-object-title')!;
  const objectCloseButton = container.querySelector<HTMLButtonElement>('.tile-room-object-close')!;
  const objectXInput = container.querySelector<HTMLInputElement>('.tile-room-object-x')!;
  const objectYInput = container.querySelector<HTMLInputElement>('.tile-room-object-y')!;
  const objectSize = container.querySelector<HTMLElement>('.tile-room-object-size')!;
  const objectFieldGroups = Array.from(container.querySelectorAll<HTMLElement>('[data-object-fields]'));
  const objectSpeedInput = container.querySelector<HTMLInputElement>('.tile-room-object-speed')!;
  const objectLoopSelect = container.querySelector<HTMLSelectElement>('.tile-room-object-loop')!;
  const objectRouteSummary = container.querySelector<HTMLElement>('.tile-room-object-route-summary')!;
  const objectAddWaypointButton = container.querySelector<HTMLButtonElement>('.tile-room-object-add-waypoint')!;
  const objectRemoveWaypointButton = container.querySelector<HTMLButtonElement>('.tile-room-object-remove-waypoint')!;
  const objectExitLockedInput = container.querySelector<HTMLInputElement>('.tile-room-object-exit-locked')!;
  const objectExitTrapInput = container.querySelector<HTMLInputElement>('.tile-room-object-exit-trap')!;
  const objectPickupKindSelect = container.querySelector<HTMLSelectElement>('.tile-room-object-pickup-kind')!;
  const objectPickupValueInput = container.querySelector<HTMLInputElement>('.tile-room-object-pickup-value')!;
  const objectPickupPersistsInput = container.querySelector<HTMLInputElement>('.tile-room-object-pickup-persists')!;
  const objectDuplicateButton = container.querySelector<HTMLButtonElement>('.tile-room-object-duplicate')!;
  const objectDeleteButton = container.querySelector<HTMLButtonElement>('.tile-room-object-delete')!;
  const artEditor = container.querySelector<HTMLElement>('.tile-art-editor')!;
  const artEditorTitle = container.querySelector<HTMLElement>('.tile-art-editor-title')!;
  const artCanvas = container.querySelector<HTMLCanvasElement>('.tile-art-source-canvas')!;
  const artContext = artCanvas.getContext('2d')!;
  const contextCanvas = container.querySelector<HTMLCanvasElement>('.tile-art-context-canvas')!;
  const contextPreview = contextCanvas.getContext('2d')!;
  const artColor = container.querySelector<HTMLInputElement>('.tile-art-color')!;
  const artColorLink = container.querySelector<HTMLSelectElement>('.tile-art-color-link')!;
  const onionSkin = container.querySelector<HTMLInputElement>('.tile-art-onion')!;
  const artRevert = container.querySelector<HTMLButtonElement>('.tile-art-revert')!;
  const artUndo = container.querySelector<HTMLButtonElement>('.tile-art-undo')!;
  const artRedo = container.querySelector<HTMLButtonElement>('.tile-art-redo')!;
  const brushSizeInput = container.querySelector<HTMLSelectElement>('.tile-art-brush-size')!;
  const roundnessInput = container.querySelector<HTMLInputElement>('.tile-art-roundness')!;
  const roundnessValue = container.querySelector<HTMLOutputElement>('.tile-art-roundness-value')!;
  const contourInput = container.querySelector<HTMLInputElement>('.tile-art-contour')!;
  const contourValue = container.querySelector<HTMLOutputElement>('.tile-art-contour-value')!;
  const highlightInput = container.querySelector<HTMLInputElement>('.tile-art-highlight')!;
  const sideShadeInput = container.querySelector<HTMLInputElement>('.tile-art-side-shade')!;
  const detailDensityInput = container.querySelector<HTMLInputElement>('.tile-art-detail-density')!;
  const detailScaleInput = container.querySelector<HTMLInputElement>('.tile-art-detail-scale')!;
  const clipManualInput = container.querySelector<HTMLInputElement>('.tile-art-clip-manual')!;
  const generatorReset = container.querySelector<HTMLButtonElement>('.tile-art-generator-reset')!;
  const materialReset = container.querySelector<HTMLButtonElement>('.tile-art-material-reset')!;
  const materialSelect = container.querySelector<HTMLSelectElement>('.tile-art-material')!;
  const materialNameInput = container.querySelector<HTMLInputElement>('.tile-art-material-name')!;
  const presetSelect = container.querySelector<HTMLSelectElement>('.tile-art-preset')!;
  const addMaterialButton = container.querySelector<HTMLButtonElement>('.tile-art-add-material')!;
  const removeMaterialButton = container.querySelector<HTMLButtonElement>('.tile-art-remove-material')!;
  const transitionBackground = container.querySelector<HTMLSelectElement>('.tile-art-transition-background')!;
  const transitionMode = container.querySelector<HTMLSelectElement>('.tile-art-transition-mode')!;
  const resolutionSelect = container.querySelector<HTMLSelectElement>('.tile-art-resolution')!;
  const resolutionConfirm = container.querySelector<HTMLElement>('.tile-art-resolution-confirm')!;
  const resolutionApply = container.querySelector<HTMLButtonElement>('.tile-art-resolution-apply')!;
  const resolutionCancel = container.querySelector<HTMLButtonElement>('.tile-art-resolution-cancel')!;
  const seedInput = container.querySelector<HTMLInputElement>('.tile-art-seed')!;
  const rerollButton = container.querySelector<HTMLButtonElement>('.tile-art-reroll')!;
  const layerPanel = container.querySelector<HTMLElement>('.tile-art-layers')!;
  const overrideList = container.querySelector<HTMLElement>('.tile-art-override-list')!;
  const clearOverridesButton = container.querySelector<HTMLButtonElement>('.tile-art-clear-overrides')!;
  const saveSourceButton = container.querySelector<HTMLButtonElement>('.tile-art-save')!;
  const loadSourceButton = container.querySelector<HTMLButtonElement>('.tile-art-load')!;
  const exportAtlasButton = container.querySelector<HTMLButtonElement>('.tile-art-export')!;
  const restoreAllButton = container.querySelector<HTMLButtonElement>('.tile-art-restore-all')!;
  const saveStatus = container.querySelector<HTMLOutputElement>('.tile-art-save-status')!;
  const variantSelect = container.querySelector<HTMLSelectElement>('.tile-art-variant')!;
  const addVariantButton = container.querySelector<HTMLButtonElement>('.tile-art-add-variant')!;
  const variantWeightInput = container.querySelector<HTMLInputElement>('.tile-art-variant-weight')!;
  const pinVariantButton = container.querySelector<HTMLButtonElement>('.tile-art-pin-variant')!;
  const localEditButton = container.querySelector<HTMLButtonElement>('.tile-art-local-edit')!;
  const localRevertButton = container.querySelector<HTMLButtonElement>('.tile-art-local-revert')!;
  const editScopeLabel = container.querySelector<HTMLElement>('.tile-art-edit-scope')!;
  const transitionDetails = container.querySelector<HTMLDetailsElement>('.tile-art-transition-details')!;
  const artPanelButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-art-panel]'));
  const artPanels = Array.from(container.querySelectorAll<HTMLElement>('[data-art-panel-content]'));
  const artToolButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-art-tool]'));
  const artTransformButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-art-transform]'));
  const artMoveButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-art-move]'));
  const stampMaskSelect = container.querySelector<HTMLSelectElement>('.tile-art-stamp-mask')!;
  const stampButton = container.querySelector<HTMLButtonElement>('.tile-art-stamp')!;

  // Built once: generation is deterministic, so rebuilding on every toggle
  // would only burn time and break the WeakMap-keyed exposure cache in the
  // render module.
  const originalScenes = {
    generated: createGeneratedRoomScene(),
    topology: createTopologyRoomScene(),
  } satisfies Record<string, TileRoomScene>;
  type TileRoomSceneId = keyof typeof originalScenes;
  const levelStorageKey = (id: string): string => `aicraft:tile-room-level:v1:${id}`;
  const workingScenes: Record<TileRoomSceneId, TileRoomScene> = { ...originalScenes };
  const savedLevelHashes = new Map<string, string>();
  for (const id of Object.keys(originalScenes) as TileRoomSceneId[]) {
    try {
      const source = localStorage.getItem(levelStorageKey(id));
      if (source === null) continue;
      const parsed = parseTileRoomScene(source, originalScenes[id]);
      if (parsed.ok) { workingScenes[id] = parsed.scene; savedLevelHashes.set(id, hashTileRoomScene(parsed.scene)); }
    } catch { /* Local persistence is optional; the built-in scene still loads. */ }
  }

  let terrainArtProject: TerrainArtProject = createTileRoomTerrainArtProject();
  // The import panel is built once every piece of art state exists, but atlases
  // are generated before that. Indirect through a late-bound reference so the
  // same resolver can be handed to every render path from the start.
  let tilesetImport: TileRoomTilesetImport | null = null;
  const importResolver: TerrainArtImportedAssetResolver = (request) =>
    tilesetImport === null ? null : tilesetImport.resolver(request);
  let terrainArtAtlas = createTileRoomTerrainArtAtlas(terrainArtProject, importResolver);
  const terrainArtCanvas = document.createElement('canvas');
  terrainArtCanvas.width = terrainArtAtlas.width;
  terrainArtCanvas.height = terrainArtAtlas.height;
  const terrainArtContext = terrainArtCanvas.getContext('2d')!;
  let terrainArtImage = terrainArtContext.createImageData(
    terrainArtAtlas.width,
    terrainArtAtlas.height,
  );
  terrainArtImage.data.set(terrainArtAtlas.pixels);
  terrainArtContext.putImageData(terrainArtImage, 0, 0);
  let additionalTerrainPasses: { atlas: ReturnType<typeof generateTerrainArtMaterialAtlas>; image: HTMLCanvasElement }[] = [];
  const rebuildAdditionalPasses = (): void => {
    additionalTerrainPasses = terrainArtProject.materials.slice(1).filter((material) => material.enabled).map((material) => {
      const atlas = generateTerrainArtMaterialAtlas(terrainArtProject, material.id, material.variants[0]?.id, importResolver);
      const image = document.createElement('canvas'); image.width = atlas.width; image.height = atlas.height; const imageContext = image.getContext('2d')!; const data = imageContext.createImageData(atlas.width, atlas.height); data.data.set(atlas.pixels); imageContext.putImageData(data, 0, 0); return { atlas, image };
    });
  };
  rebuildAdditionalPasses();
  const refreshTerrainAtlas = (): void => {
    terrainArtAtlas = createTileRoomTerrainArtAtlas(terrainArtProject, importResolver);
    if (terrainArtCanvas.width !== terrainArtAtlas.width || terrainArtCanvas.height !== terrainArtAtlas.height) {
      terrainArtCanvas.width = terrainArtAtlas.width; terrainArtCanvas.height = terrainArtAtlas.height;
      terrainArtImage = terrainArtContext.createImageData(terrainArtAtlas.width, terrainArtAtlas.height);
    }
    terrainArtImage.data.set(terrainArtAtlas.pixels);
    terrainArtContext.putImageData(terrainArtImage, 0, 0);
    rebuildAdditionalPasses();
  };
  const terrainArtPrepared = new WeakMap<LevelData, PreparedTerrainArtDualGrid>();
  const preparedTerrainArtFor = (level: LevelData): PreparedTerrainArtDualGrid => {
    const cached = terrainArtPrepared.get(level);
    if (cached !== undefined) return cached;
    const prepared = prepareTileRoomTerrainArt(level, terrainArtProject);
    terrainArtPrepared.set(level, prepared);
    return prepared;
  };

  let runtime: SceneRuntime = createSceneRuntime(workingScenes.generated);
  let treatment: TileRoomTreatment = 'dual-grid';
  let showMarkers = false;
  let showDualGrid = false;
  let showLogicalGrid = false;
  type LevelTool = 'inspect' | 'paint' | 'erase' | 'line' | 'rectangle' | 'fill' | 'picker' | 'spawn' | 'moving-platform' | 'spikes' | 'erase-spikes' | 'select-object' | TileRoomPlaceableEntity;
  let levelTool: LevelTool = 'inspect';
  let levelGestureStart: { col: number; row: number } | null = null;
  let levelGestureLast: { col: number; row: number } | null = null;
  let levelPendingCells = new Map<string, { col: number; row: number }>();
  let movingPlatformGesture: {
    mode: 'create' | 'move';
    start: { x: number; y: number };
    current: { x: number; y: number };
    entityId?: number;
    originRect?: Readonly<LevelRect>;
    originPath?: readonly { readonly x: number; readonly y: number }[];
  } | null = null;
  let selectedMovingPlatformId: number | null = null;
  let selectedLevelEntityId: number | null = null;
  let movingPlatformWaypointGesture: {
    entityId: number;
    waypointIndex: number;
    current: { x: number; y: number };
  } | null = null;
  let spikeGesture: {
    start: { col: number; row: number };
    current: { col: number; row: number };
  } | null = null;
  let objectMoveGesture: {
    entityId: number;
    start: { x: number; y: number };
    current: { x: number; y: number };
    originRect: Readonly<LevelRect>;
  } | null = null;
  let levelCursorWorld = { x: 0, y: 0 };
  let levelCursorInside = false;
  let levelUndoStack: TileRoomScene[] = [];
  let levelRedoStack: TileRoomScene[] = [];
  let editorZoom = 1;
  let showWholeLevel = true;
  let playing = false;
  let deathCount = 0;
  let levelNotice = '';
  let selectedDualTile: TerrainArtVisualHit | null = null;
  type ArtTool = 'paint' | 'inherit' | 'line' | 'rectangle' | 'ellipse' | 'fill' | 'eyedropper' | 'select';
  let artTool: ArtTool = 'paint';
  let artUndoStack: TerrainArtProject[] = [];
  let artRedoStack: TerrainArtProject[] = [];
  let activeStroke = false;
  let strokeVisited = new Set<number>();
  let generatorGestureStart: TerrainArtProject | null = null;
  let materialNameGestureStart: TerrainArtProject | null = null;
  let shapeStart: { x: number; y: number } | null = null;
  let strokeLast: { x: number; y: number } | null = null;
  let artSelection: TerrainArtPixelSelection | null = null;
  let activeMaterialId = terrainArtProject.materials[0]!.id;
  const stylePresetById = new Map<string, TerrainArtPresetId>([[activeMaterialId, 'meadow']]);
  let activeVariantId = 'default';
  let pendingResolution: number | null = null;
  let editLocalOccurrence = false;
  let lastSavedTerrainHash = hashTerrainArtProject(terrainArtProject);
  for (let mask = 1; mask <= 15; mask++) { const option = document.createElement('option'); option.value = String(mask); option.textContent = String(mask); stampMaskSelect.append(option); }
  let collectibleSave: CollectibleSave = { collected: [] };
  let collectedEntityIds = new Set<number>();
  let collectedValue = 0;

  const describeTerrainMask = (mask: TerrainArtDualGridMask): string => {
    const corners = [1, 2, 4, 8].filter((bit) => (mask & bit) !== 0).length;
    if (mask === 15) return 'full tile';
    if (corners === 1) return 'outer corner';
    if (corners === 3) return 'inner corner';
    if (mask === 5 || mask === 10) return 'diagonal join';
    return 'edge tile';
  };

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

  const levelPaintPreview = (): { cells: readonly { col: number; row: number }[]; behavior: 'paint' | 'erase'; cursor: { col: number; row: number } } | undefined => {
    if (levelGestureStart === null || levelGestureLast === null) return undefined;
    const cells = levelTool === 'line' ? terrainArtLogicalLine(levelGestureStart, levelGestureLast)
      : levelTool === 'rectangle' ? terrainArtLogicalRectangle(levelGestureStart, levelGestureLast, true)
        : [...levelPendingCells.values()];
    return { cells, behavior: levelTool === 'erase' ? 'erase' : 'paint', cursor: levelGestureLast };
  };

  const movingPlatformPreview = (): { rect: LevelRect; path: readonly { x: number; y: number }[]; mode: 'create' | 'move' } | undefined => {
    const gesture = movingPlatformGesture; if (gesture === null) return undefined;
    const level = runtime.scene.level; const size = level.tiles.tileSize;
    if (gesture.mode === 'create') {
      const x = Math.min(gesture.start.x, gesture.current.x); const y = Math.min(gesture.start.y, gesture.current.y);
      const rect = { x, y, width: Math.abs(gesture.current.x - gesture.start.x) + size, height: Math.abs(gesture.current.y - gesture.start.y) + size };
      const maxX = level.width - rect.width; const travel = size * 4;
      const otherX = rect.x + travel <= maxX ? rect.x + travel : Math.max(0, rect.x - travel);
      return { rect, path: [{ x: rect.x, y: rect.y }, { x: otherX, y: rect.y }], mode: gesture.mode };
    }
    const origin = gesture.originRect; if (origin === undefined) return undefined;
    const x = Math.max(0, Math.min(level.width - origin.width, origin.x + gesture.current.x - gesture.start.x));
    const y = Math.max(0, Math.min(level.height - origin.height, origin.y + gesture.current.y - gesture.start.y));
    const dx = x - origin.x; const dy = y - origin.y;
    return { rect: { ...origin, x, y }, path: (gesture.originPath ?? [{ x: origin.x, y: origin.y }]).map((point) => ({ x: point.x + dx, y: point.y + dy })), mode: gesture.mode };
  };

  const movingPlatformWidget = (): { rect: LevelRect; path: readonly { x: number; y: number }[]; activeWaypoint?: number } | undefined => {
    if (playing || (levelTool !== 'moving-platform' && levelTool !== 'select-object') || selectedMovingPlatformId === null) return undefined;
    const selected = runtime.scene.level.entities.find((entity) => entity.id === selectedMovingPlatformId);
    if (selected?.kind !== 'movingPlatform') return undefined;
    const moving = movingPlatformGesture?.mode === 'move' && movingPlatformGesture.entityId === selected.id ? movingPlatformPreview() : undefined;
    if (moving !== undefined) return { rect: moving.rect, path: moving.path };
    const waypoint = movingPlatformWaypointGesture;
    const path = waypoint?.entityId === selected.id
      ? selected.props.path.map((point, index) => index === waypoint.waypointIndex ? waypoint.current : point)
      : selected.props.path;
    return { rect: selected.rect, path, activeWaypoint: waypoint?.entityId === selected.id ? waypoint.waypointIndex : undefined };
  };

  const spikePreview = (): { rect: LevelRect; mode: 'create' | 'delete'; targets: readonly LevelRect[] } | undefined => {
    const gesture = spikeGesture; if (gesture === null) return undefined;
    const size = runtime.scene.level.tiles.tileSize;
    const minCol = Math.min(gesture.start.col, gesture.current.col);
    const maxCol = Math.max(gesture.start.col, gesture.current.col);
    const minRow = levelTool === 'spikes' ? gesture.start.row : Math.min(gesture.start.row, gesture.current.row);
    const maxRow = levelTool === 'spikes' ? gesture.start.row : Math.max(gesture.start.row, gesture.current.row);
    const rect = { x: minCol * size, y: minRow * size, width: (maxCol - minCol + 1) * size, height: (maxRow - minRow + 1) * size };
    const targets = levelTool === 'erase-spikes' ? runtime.scene.level.entities.filter((entity) => entity.kind === 'hazard' && entity.rect.x < rect.x + rect.width && entity.rect.x + entity.rect.width > rect.x && entity.rect.y < rect.y + rect.height && entity.rect.y + entity.rect.height > rect.y).map((entity) => entity.rect) : [];
    return { rect, mode: levelTool === 'erase-spikes' ? 'delete' : 'create', targets };
  };

  const placeableTool = (): TileRoomPlaceableEntity | null => levelTool === 'exit' || levelTool === 'coin' || levelTool === 'gem' || levelTool === 'key' ? levelTool : null;
  const objectAt = (point: Readonly<{ x: number; y: number }>): LevelEntity | undefined => [...runtime.scene.level.entities].reverse().find((entity) => entity.kind !== 'spawn' && entity.kind !== 'trigger' && entity.kind !== 'platform' && entity.kind !== 'passthrough' && point.x >= entity.rect.x && point.x <= entity.rect.x + entity.rect.width && point.y >= entity.rect.y && point.y <= entity.rect.y + entity.rect.height);
  const selectedLevelEntity = (): LevelEntity | undefined => runtime.scene.level.entities.find((entity) => entity.id === selectedLevelEntityId);
  const entityPreview = (): { entity: LevelEntity; mode: 'place' | 'move' | 'delete' } | undefined => {
    if (playing || !levelCursorInside) return undefined;
    if (objectMoveGesture !== null) {
      const gesture = objectMoveGesture;
      const x = Math.max(0, Math.min(runtime.scene.level.width - gesture.originRect.width, gesture.originRect.x + gesture.current.x - gesture.start.x));
      const y = Math.max(0, Math.min(runtime.scene.level.height - gesture.originRect.height, gesture.originRect.y + gesture.current.y - gesture.start.y));
      const entity = runtime.scene.level.entities.find((candidate) => candidate.id === gesture.entityId);
      return entity === undefined ? undefined : { entity: { ...entity, rect: { ...entity.rect, x, y } }, mode: 'move' };
    }
    const placeable = placeableTool();
    if (placeable !== null) {
      const size = runtime.scene.level.tileSize;
      const cellX = Math.floor(levelCursorWorld.x / size) * size; const cellY = Math.floor(levelCursorWorld.y / size) * size;
      const previewScene = addTileRoomEntity(runtime.scene, placeable, cellX, cellY);
      return { entity: previewScene.level.entities[previewScene.level.entities.length - 1]!, mode: 'place' };
    }
    if (levelTool === 'select-object') {
      const entity = objectAt(levelCursorWorld);
      return entity === undefined || entity.id === selectedLevelEntityId ? undefined : { entity, mode: 'move' };
    }
    return undefined;
  };

  const wholeLevelTransform = (): { scale: number; x: number; y: number } => {
    const level = runtime.scene.level;
    const scale = Math.min(TILE_ROOM_VIEW_W / level.width, TILE_ROOM_VIEW_H / level.height);
    return { scale, x: (TILE_ROOM_VIEW_W - level.width * scale) / 2, y: (TILE_ROOM_VIEW_H - level.height * scale) / 2 };
  };

  const render = (): void => {
    let occurrence: { dualX: number; dualY: number; image: HTMLCanvasElement } | undefined;
    if (selectedDualTile !== null) {
      const local = terrainArtProject.occurrenceOverrides.find((override) => override.levelId === runtime.scene.id && override.dualX === selectedDualTile!.dualX && override.dualY === selectedDualTile!.dualY && getTerrainArtOccurrenceStatus(override, runtime.scene.id, preparedTerrainArtFor(runtime.scene.level), terrainArtProject) === 'active');
      if (local !== undefined) {
        const tile = renderTerrainArtOccurrenceTile(terrainArtProject, local); const localCanvas = document.createElement('canvas'); localCanvas.width = tile.width; localCanvas.height = tile.height;
        const localContext = localCanvas.getContext('2d')!; const localImage = localContext.createImageData(tile.width, tile.height); localImage.data.set(tile.pixels); localContext.putImageData(localImage, 0, 0);
        occurrence = { dualX: local.dualX, dualY: local.dualY, image: localCanvas };
      }
    }
    const overview = !playing && showWholeLevel;
    const frame = {
      camera: overview ? { x: 0, y: 0 } : runtime.camera,
      viewW: overview ? runtime.scene.level.width : TILE_ROOM_VIEW_W,
      viewH: overview ? runtime.scene.level.height : TILE_ROOM_VIEW_H,
      dpr: getDevicePixelRatio(),
      player: runtime.state.core,
      movingRects: movingRectsOf(runtime.platforms),
      treatment,
      showMarkers,
      showSpawnMarker: levelTool === 'spawn' && !playing,
      collectedEntityIds,
      worldSeed: TILE_ROOM_SEED,
      dualGrid: {
        prepared: preparedTerrainArtFor(runtime.scene.level),
        atlas: terrainArtAtlas,
        image: terrainArtCanvas,
        additional: additionalTerrainPasses,
        selection: playing ? null : selectedDualTile,
        showDualGrid,
        showLogicalGrid,
        highlightMatches: true,
        occurrence,
        paintPreview: levelPaintPreview(),
        movingPlatformPreview: movingPlatformPreview(),
        movingPlatformWidget: movingPlatformWidget(),
        selectedEntity: playing ? undefined : selectedLevelEntity(),
        spikePreview: spikePreview(),
        entityPreview: entityPreview(),
      },
    } as const;
    if (overview) {
      const transform = wholeLevelTransform();
      ctx.save();
      ctx.fillStyle = '#0d1218'; ctx.fillRect(0, 0, TILE_ROOM_VIEW_W, TILE_ROOM_VIEW_H);
      ctx.translate(transform.x, transform.y); ctx.scale(transform.scale, transform.scale);
      drawTileRoomFrame(ctx, runtime.scene, frame);
      ctx.restore();
    } else {
      drawTileRoomFrame(ctx, runtime.scene, frame);
    }
  };

  const updateMaterialChrome = (): void => {
    const previous = activeMaterialId;
    materialSelect.replaceChildren(...terrainArtProject.materials.map((material) => {
      const option = document.createElement('option'); option.value = material.id; option.textContent = material.name; return option;
    }));
    activeMaterialId = terrainArtProject.materials.some((material) => material.id === previous) ? previous : terrainArtProject.materials[0]!.id;
    materialSelect.value = activeMaterialId;
    const material = terrainArtProject.materials.find((candidate) => candidate.id === activeMaterialId);
    materialNameInput.value = material?.name ?? '';
    presetSelect.value = stylePresetById.get(activeMaterialId) ?? 'meadow';
    removeMaterialButton.disabled = terrainArtProject.materials.length === 1;
    transitionBackground.replaceChildren(...terrainArtProject.materials.filter((entry) => entry.id !== activeMaterialId).map((entry) => { const option = document.createElement('option'); option.value = entry.id; option.textContent = entry.name; return option; }));
    transitionDetails.hidden = terrainArtProject.materials.length < 2;
    const existingTransition = terrainArtProject.transitionRules.find((rule) => rule.foregroundMaterialId === activeMaterialId && rule.backgroundMaterialId === transitionBackground.value); transitionMode.value = existingTransition?.mode === 'contour' ? 'contour' : 'hard';
    resolutionSelect.value = String(terrainArtProject.authoringResolution);
    seedInput.value = String(terrainArtProject.visualSeed);
    activeVariantId = material?.variants.some((variant) => variant.id === activeVariantId) ? activeVariantId : material?.variants[0]?.id ?? 'default';
    variantSelect.replaceChildren(...(material?.variants ?? []).map((variant) => { const option = document.createElement('option'); option.value = variant.id; option.textContent = variant.label; return option; }));
    variantSelect.value = activeVariantId;
    const variant = material?.variants.find((candidate) => candidate.id === activeVariantId); variantWeightInput.value = String(variant?.weight ?? 1);
    const usage = terrainArtVariantUsage(terrainArtProject, activeMaterialId)[activeVariantId] ?? 0; pinVariantButton.textContent = usage > 0 ? `Pin here · ${usage} pinned` : 'Pin here';
    layerPanel.replaceChildren(...(material?.layers ?? []).map((layer, index) => {
      const row = document.createElement('label'); row.className = 'tile-art-layer';
      const visible = document.createElement('input'); visible.type = 'checkbox'; visible.checked = layer.visible; visible.setAttribute('aria-label', `Show ${layer.name}`);
      visible.addEventListener('change', () => { const before = terrainArtProject; terrainArtProject = updateTerrainArtLayer(terrainArtProject, activeMaterialId, layer.id, { visible: visible.checked }); commitHistory(before); refreshArt(); });
      const name = document.createElement('span'); name.textContent = layer.name;
      const up = document.createElement('button'); up.type = 'button'; up.textContent = '↑'; up.disabled = index === 0; up.setAttribute('aria-label', `Move ${layer.name} up`);
      const down = document.createElement('button'); down.type = 'button'; down.textContent = '↓'; down.disabled = index === (material?.layers.length ?? 0) - 1; down.setAttribute('aria-label', `Move ${layer.name} down`);
      const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'Reset'; reset.setAttribute('aria-label', `Reset ${layer.name}`);
      const opacity = document.createElement('input'); opacity.type = 'range'; opacity.min = '0'; opacity.max = '1'; opacity.step = '.05'; opacity.value = String(layer.opacity); opacity.setAttribute('aria-label', `${layer.name} opacity`);
      const clip = document.createElement('select'); clip.setAttribute('aria-label', `${layer.name} clipping`);
      const clipLabels = { none: 'No clipping', 'material-silhouette': 'Inside this style', 'world-silhouette': 'Inside all terrain' } as const;
      for (const value of ['none', 'material-silhouette', 'world-silhouette'] as const) { const option = document.createElement('option'); option.value = value; option.textContent = clipLabels[value]; clip.append(option); } clip.value = layer.clipMode;
      up.addEventListener('click', () => { const before = terrainArtProject; terrainArtProject = reorderTerrainArtLayer(terrainArtProject, activeMaterialId, layer.id, index - 1); commitHistory(before); refreshArt(); updateMaterialChrome(); });
      down.addEventListener('click', () => { const before = terrainArtProject; terrainArtProject = reorderTerrainArtLayer(terrainArtProject, activeMaterialId, layer.id, index + 1); commitHistory(before); refreshArt(); updateMaterialChrome(); });
      reset.addEventListener('click', () => { const before = terrainArtProject; terrainArtProject = updateTerrainArtLayer(terrainArtProject, activeMaterialId, layer.id, layer.type === 'manual' ? { patches: [] } : { visible: true, opacity: 1, blendMode: 'normal' }); commitHistory(before); refreshArt(); updateMaterialChrome(); });
      opacity.addEventListener('change', () => { const before = terrainArtProject; terrainArtProject = updateTerrainArtLayer(terrainArtProject, activeMaterialId, layer.id, { opacity: Number(opacity.value) }); commitHistory(before); refreshArt(); });
      clip.addEventListener('change', () => { const before = terrainArtProject; terrainArtProject = updateTerrainArtLayer(terrainArtProject, activeMaterialId, layer.id, { clipMode: clip.value as 'none' | 'material-silhouette' | 'world-silhouette' }); commitHistory(before); refreshArt(); });
      row.append(visible, name, opacity, clip, up, down, reset); return row;
    }));
    const overrideRows: HTMLElement[] = terrainArtProject.occurrenceOverrides.map((override) => {
      const row = document.createElement('div'); const prepared = override.levelId === runtime.scene.id ? preparedTerrainArtFor(runtime.scene.level) : { cols: 0, rows: 0, tileSize: 0, tiles: [] };
      const status = getTerrainArtOccurrenceStatus(override, override.levelId, prepared, terrainArtProject); const label = document.createElement('span'); const overrideMaterial = terrainArtProject.materials.find((entry) => entry.id === override.materialId); label.textContent = `${overrideMaterial?.name ?? override.materialId} · level tile ${override.dualX},${override.dualY} · ${status}`;
      const rebind = document.createElement('button'); rebind.type = 'button'; rebind.textContent = 'Rebind'; rebind.addEventListener('click', () => { const before = terrainArtProject; terrainArtProject = rebindTerrainArtOccurrenceOverride(terrainArtProject, override.levelId, override.dualX, override.dualY, prepared); commitHistory(before); updateMaterialChrome(); refreshArt(); });
      const hide = document.createElement('button'); hide.type = 'button'; hide.textContent = override.hidden ? 'Show' : 'Hide'; hide.addEventListener('click', () => { const before = terrainArtProject; terrainArtProject = hideTerrainArtOccurrenceOverride(terrainArtProject, override.levelId, override.dualX, override.dualY, override.materialId, !override.hidden); commitHistory(before); updateMaterialChrome(); refreshArt(); });
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Delete'; remove.addEventListener('click', () => { const before = terrainArtProject; terrainArtProject = deleteTerrainArtOccurrenceOverride(terrainArtProject, override.levelId, override.dualX, override.dualY, override.materialId); commitHistory(before); updateMaterialChrome(); refreshArt(); });
      row.append(label, rebind, hide, remove); return row;
    });
    if (overrideRows.length === 0) { const empty = document.createElement('span'); empty.textContent = 'No level-only edits.'; overrideRows.push(empty); }
    overrideList.replaceChildren(...overrideRows);
  };

  const updateInspector = (): void => {
    const inspecting = treatment === 'dual-grid' && !playing;
    inspector.hidden = !inspecting;
    const sourceInspecting = inspecting && levelTool === 'inspect';
    artEditor.hidden = !sourceInspecting || selectedDualTile === null || selectedDualTile.tile.materials.length === 0;
    canvas.style.cursor = inspecting ? 'crosshair' : 'default';
    if (!inspecting) return;
    if (levelTool === 'spawn') {
      inspectorTitle.textContent = 'Move the player start';
      inspectorDetail.textContent = 'Click an empty grid cell. The player’s feet will sit on the bottom edge of that cell; Undo level restores the previous start.';
      return;
    }
    if (levelTool === 'moving-platform') {
      inspectorTitle.textContent = selectedMovingPlatformId === null ? 'Draw or select a moving platform' : 'Edit the selected moving platform';
      inspectorDetail.textContent = selectedMovingPlatformId === null
        ? 'Drag empty space to draw a platform, or click an existing one to reveal its route.'
        : 'Drag the platform body to move the complete route. Drag the cyan Move to handle to change only its destination.';
      return;
    }
    if (levelTool === 'spikes' || levelTool === 'erase-spikes') {
      inspectorTitle.textContent = levelTool === 'spikes' ? 'Draw spikes' : 'Delete spikes';
      inspectorDetail.textContent = levelTool === 'spikes'
        ? 'Drag horizontally to place a one-cell-high spike strip. It stays separate from the ground below and can be undone.'
        : 'Click or drag across spike strips to remove them. Terrain underneath is left untouched.';
      return;
    }
    if (levelTool === 'select-object') {
      inspectorTitle.textContent = selectedLevelEntityId === null ? 'Select an object' : 'Object properties are open';
      inspectorDetail.textContent = selectedLevelEntityId === null
        ? 'Click an exit, pickup, spike strip, or moving platform. Drag to reposition it, then use the Properties panel below.'
        : 'Drag the yellow selection in the level to move it, or edit, duplicate, and delete it in the panel below.';
      return;
    }
    const placeable = placeableTool();
    if (placeable !== null) {
      inspectorTitle.textContent = `Place ${placeable === 'exit' ? 'an exit' : `a ${placeable}`}`;
      inspectorDetail.textContent = 'Move over the whole-level view to preview placement, then click. Every placement is undoable and included in level saves.';
      return;
    }
    if (levelTool !== 'inspect') {
      inspectorTitle.textContent = 'Draw the level';
      inspectorDetail.textContent = 'Drag on the canvas to preview and apply the selected level tool.';
      return;
    }
    if (selectedDualTile === null) {
      inspectorTitle.textContent = 'Choose a terrain tile';
      inspectorDetail.textContent = 'Click any terrain in the level to open its automatic look and optional paint tools.';
      return;
    }
    if (selectedDualTile.tile.materials.length === 0) {
      inspectorTitle.textContent = 'Empty space';
      inspectorDetail.textContent = 'Choose a painted terrain tile to edit its style.';
      return;
    }
    const activeDefinition = terrainArtProject.materials.find((entry) => entry.id === activeMaterialId);
    const material = selectedDualTile.tile.materials.find((entry) => entry.materialId === activeMaterialId) ??
      (activeDefinition === undefined ? selectedDualTile.tile.materials[0]! : {
        materialId: activeDefinition.id,
        mask: selectedDualTile.tile.occupancyMask,
        priority: activeDefinition.priority,
      });
    activeMaterialId = material.materialId;
    updateMaterialChrome();
    const definition = terrainArtProject.materials.find((candidate) => candidate.id === material.materialId)!;
    const matchingTiles = preparedTerrainArtFor(runtime.scene.level).tiles.filter((tile) => tile.materials.some((entry) => entry.materialId === material.materialId && entry.mask === material.mask)).length;
    inspectorTitle.textContent = `Selected: ${definition.name} — ${describeTerrainMask(material.mask)}`;
    inspectorDetail.textContent = `The engine generated this shape from the level layout. Paint it once to update ${matchingTiles} matching ${matchingTiles === 1 ? 'tile' : 'tiles'}, or switch to a level-only edit.`;
    roundnessInput.value = String(definition.generator.roundness);
    roundnessValue.value = definition.generator.roundness.toFixed(2);
    contourInput.value = String(definition.generator.contourWidth);
    contourValue.value = `${definition.generator.contourWidth} px`;
    highlightInput.value = String(definition.generator.topHighlightDepth);
    sideShadeInput.value = String(definition.generator.sideShadeDepth);
    detailDensityInput.value = String(definition.generator.detailDensity);
    detailScaleInput.value = String(definition.generator.detailScale);
    clipManualInput.checked = definition.generator.clipManualToSilhouette;
    const localOverride = terrainArtProject.occurrenceOverrides.find((override) => override.levelId === runtime.scene.id && override.dualX === selectedDualTile!.dualX && override.dualY === selectedDualTile!.dualY && override.materialId === material.materialId);
    const source = !editLocalOccurrence || localOverride === undefined ? renderTerrainArtSourceTile(terrainArtProject, material.materialId, material.mask, activeVariantId, importResolver) : renderTerrainArtOccurrenceTile(terrainArtProject, localOverride, importResolver);
    localEditButton.setAttribute('aria-pressed', String(editLocalOccurrence));
    editScopeLabel.textContent = editLocalOccurrence ? 'Editing only this level tile' : 'Editing every matching tile';
    localEditButton.textContent = editLocalOccurrence ? 'Switch back to reusable tile' : 'Paint only this level tile';
    localRevertButton.disabled = localOverride === undefined;
    const image = artContext.createImageData(source.width, source.height);
    image.data.set(source.pixels);
    const buffer = document.createElement('canvas');
    buffer.width = source.width;
    buffer.height = source.height;
    buffer.getContext('2d')!.putImageData(image, 0, 0);
    artContext.imageSmoothingEnabled = false;
    artContext.clearRect(0, 0, artCanvas.width, artCanvas.height);
    artContext.drawImage(buffer, 0, 0, artCanvas.width, artCanvas.height);
    if (onionSkin.checked) {
      const generatedProject = updateTerrainArtLayer(terrainArtProject, material.materialId, 'manual', { visible: false });
      const generated = renderTerrainArtSourceTile(generatedProject, material.materialId, material.mask, activeVariantId, importResolver); const generatedImage = artContext.createImageData(generated.width, generated.height); generatedImage.data.set(generated.pixels);
      const generatedCanvas = document.createElement('canvas'); generatedCanvas.width = generated.width; generatedCanvas.height = generated.height; generatedCanvas.getContext('2d')!.putImageData(generatedImage, 0, 0);
      artContext.save(); artContext.globalAlpha = .45; artContext.drawImage(generatedCanvas, 0, 0, artCanvas.width, artCanvas.height); artContext.restore();
    }
    if (artSelection !== null) {
      const scale = artCanvas.width / source.width; artContext.strokeStyle = '#ff756a'; artContext.lineWidth = 2; artContext.setLineDash([5, 4]);
      artContext.strokeRect(artSelection.x * scale + 1, artSelection.y * scale + 1, artSelection.width * scale - 2, artSelection.height * scale - 2); artContext.setLineDash([]);
    }
    contextPreview.imageSmoothingEnabled = false; contextPreview.clearRect(0, 0, contextCanvas.width, contextCanvas.height);
    const previewSize = contextCanvas.width / 3;
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) contextPreview.drawImage(buffer, col * previewSize, row * previewSize, previewSize, previewSize);
    contextPreview.strokeStyle = '#f4d35e'; contextPreview.lineWidth = 2; contextPreview.strokeRect(previewSize + 1, previewSize + 1, previewSize - 2, previewSize - 2);
    artEditorTitle.textContent = `${definition.name} · ${describeTerrainMask(material.mask)}`;
  };

  const updateObjectPanel = (): void => {
    const entity = selectedLevelEntity(); objectPanel.hidden = playing || entity === undefined;
    if (entity === undefined) return;
    const label = entity.kind === 'movingPlatform' ? 'Moving platform'
      : entity.kind === 'collectible' ? `${entity.props.kind[0]!.toUpperCase()}${entity.props.kind.slice(1)}`
        : entity.kind === 'exit' ? 'Exit' : entity.kind === 'hazard' ? 'Spikes' : entity.kind;
    objectTitle.textContent = `${label} #${entity.id}`;
    if (document.activeElement !== objectXInput) objectXInput.value = String(Math.round(entity.rect.x));
    if (document.activeElement !== objectYInput) objectYInput.value = String(Math.round(entity.rect.y));
    objectSize.textContent = `${Math.round(entity.rect.width)}×${Math.round(entity.rect.height)} px`;
    for (const group of objectFieldGroups) group.hidden = group.dataset.objectFields !== (entity.kind === 'movingPlatform' ? 'moving-platform' : entity.kind);
    if (entity.kind === 'movingPlatform') {
      if (document.activeElement !== objectSpeedInput) objectSpeedInput.value = String(entity.props.speed);
      objectLoopSelect.value = entity.props.loopMode ?? 'pingpong';
      objectRouteSummary.textContent = `${entity.props.path.length - 1} ${entity.props.path.length === 2 ? 'destination' : 'destinations'}`;
      objectRemoveWaypointButton.disabled = entity.props.path.length <= 2;
    } else if (entity.kind === 'exit') {
      objectExitLockedInput.checked = entity.props.locked; objectExitTrapInput.checked = entity.props.isTrap;
    } else if (entity.kind === 'collectible') {
      objectPickupKindSelect.value = entity.props.kind;
      if (document.activeElement !== objectPickupValueInput) objectPickupValueInput.value = String(entity.props.value ?? 0);
      objectPickupPersistsInput.checked = entity.props.persists ?? false;
    }
    objectDeleteButton.disabled = entity.kind === 'exit' && runtime.scene.level.entities.filter((candidate) => candidate.kind === 'exit').length <= 1;
  };

  const updateStatus = (): void => {
    const { level } = runtime.scene;
    const cells = level.tiles.cols * level.tiles.rows;
    const collectibleCount = level.entities.filter(
      (entity) => entity.kind === 'collectible',
    ).length;
    const editorMode = levelTool === 'spawn' ? 'Editing spawn · click an empty cell'
      : levelTool === 'moving-platform' ? selectedMovingPlatformId === null ? 'Moving platforms · draw or select one' : 'Moving platform selected · drag body or Move to'
      : levelTool === 'spikes' ? 'Editing spikes · drag horizontally to draw'
      : levelTool === 'erase-spikes' ? 'Editing spikes · drag to delete'
      : levelTool === 'select-object' ? selectedLevelEntityId === null ? 'Objects · click to select' : 'Object selected · drag or use Properties'
      : placeableTool() !== null ? `Placing ${placeableTool()}`
      : levelTool === 'inspect' ? 'Editing · click terrain to inspect'
        : 'Editing level · drag to preview';
    statusPanel.textContent =
      `${playing ? 'Playing · Esc to stop' : editorMode} · ` +
      `${runtime.scene.label} · ${level.tiles.cols}×${level.tiles.rows} tiles ` +
      `(${cells} cells, ${level.width}×${level.height} px) · ` +
      `pickups ${collectedEntityIds.size}/${collectibleCount} (value ${collectedValue}) · ` +
      `${playing ? `deaths ${deathCount}` : showWholeLevel ? 'whole-level view' : `camera ${Math.round(runtime.camera.x)}, ${Math.round(runtime.camera.y)}`} · ` +
      `${treatment === 'fallback'
        ? 'Fallback renderer'
        : treatment === 'dual-grid' ? 'Editable dual-grid atlas' : `${treatment[0].toUpperCase()}${treatment.slice(1)} theme`} · ` +
      `${hashTerrainArtProject(terrainArtProject) === lastSavedTerrainHash ? 'Terrain art saved' : 'Terrain art modified'}` +
      (levelNotice.length > 0 ? ` · ${levelNotice}` : '');
  };

  const updateLevelSaveChrome = (): void => {
    levelNameInput.value = runtime.scene.level.name;
    const saved = savedLevelHashes.get(runtime.scene.id);
    levelSaveStatus.value = saved === undefined ? 'Not saved' : saved === hashTileRoomScene(runtime.scene) ? 'Saved' : 'Unsaved changes';
    levelNameInput.disabled = playing;
    levelSaveButton.disabled = playing;
    levelLoadButton.disabled = playing || saved === undefined;
    levelImportButton.disabled = playing;
    levelResetButton.disabled = playing;
    overviewButton.disabled = playing;
    overviewButton.setAttribute('aria-pressed', String(showWholeLevel));
  };

  const updateChrome = (): void => {
    for (const btn of sceneBtns) {
      btn.disabled = playing;
      btn.setAttribute(
        'aria-pressed',
        String(btn.dataset.scene === runtime.scene.id),
      );
    }
    for (const btn of treatmentBtns) {
      btn.setAttribute('aria-pressed', String(btn.dataset.treatment === treatment));
    }
    markerBtn.setAttribute('aria-pressed', String(showMarkers));
    dualOverlayBtn.setAttribute('aria-pressed', String(showDualGrid));
    logicalOverlayBtn.setAttribute('aria-pressed', String(showLogicalGrid));
    for (const button of levelToolButtons) button.disabled = playing;
    terrainKindSelect.disabled = playing;
    levelUndoButton.disabled = playing || levelUndoStack.length === 0;
    levelRedoButton.disabled = playing || levelRedoStack.length === 0;
    updateLevelSaveChrome();
    updateStatus();
    updateInspector();
    updateObjectPanel();
  };

  // --- Controls ------------------------------------------------------------

  const selectScene = (id: TileRoomSceneId): void => {
    if (runtime.scene.id === id) return;
    runtime = createSceneRuntime(workingScenes[id]);
    collectibleSave = { collected: [] };
    collectedEntityIds = new Set();
    collectedValue = 0;
    selectedDualTile = null;
    selectedMovingPlatformId = null;
    selectedLevelEntityId = null;
    movingPlatformWaypointGesture = null;
    levelUndoStack = []; levelRedoStack = []; levelUndoButton.disabled = true; levelRedoButton.disabled = true;
    levelNotice = '';
    runtime.camera = {
      ...clampCameraToLevel(STATIC_CAMERA_X, STATIC_CAMERA_Y, workingScenes[id].level),
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
        next !== 'outdoor' &&
        next !== 'dual-grid'
      ) return;
      treatment = next;
      selectedDualTile = null;
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
  const onDualOverlay = (): void => { showDualGrid = !showDualGrid; updateChrome(); render(); };
  const onLogicalOverlay = (): void => { showLogicalGrid = !showLogicalGrid; updateChrome(); render(); };
  dualOverlayBtn.addEventListener('click', onDualOverlay);
  logicalOverlayBtn.addEventListener('click', onLogicalOverlay);

  const updateTerrainKindOptions = (): void => {
    const previous = terrainKindSelect.value;
    const primaryMaterialId = terrainArtProject.materials[0]?.id;
    terrainKindSelect.replaceChildren(...terrainArtProject.terrainKinds.map((kind) => {
      const option = document.createElement('option'); option.value = String(kind.tileValue);
      const style = terrainArtProject.materials.find((material) => material.id === kind.materialId);
      option.textContent = kind.collision === 'empty' ? 'Erase'
        : kind.collision === 'passthrough' ? 'One-way platform'
          : kind.materialId === primaryMaterialId ? 'Solid ground'
            : `Solid ground — ${style?.name ?? kind.label}`;
      return option;
    }));
    terrainKindSelect.value = terrainArtProject.terrainKinds.some((kind) => String(kind.tileValue) === previous) ? previous : String(terrainArtProject.terrainKinds.find((kind) => kind.materialId !== null)?.tileValue ?? 1);
  };
  updateTerrainKindOptions();
  const levelToolHandlers = levelToolButtons.map((button) => {
    const handler = (): void => {
      const requested = button.dataset.levelTool;
      if (requested === 'inspect' || requested === 'paint' || requested === 'erase' || requested === 'line' || requested === 'rectangle' || requested === 'fill' || requested === 'picker' || requested === 'spawn' || requested === 'moving-platform' || requested === 'spikes' || requested === 'erase-spikes' || requested === 'select-object' || requested === 'exit' || requested === 'coin' || requested === 'gem' || requested === 'key') levelTool = requested;
      if (treatment !== 'dual-grid') { treatment = 'dual-grid'; levelNotice = 'Switched to Dual Grid for editing'; }
      else levelNotice = '';
      for (const candidate of levelToolButtons) candidate.setAttribute('aria-pressed', String(candidate === button));
      if (levelTool !== 'inspect') selectedDualTile = null;
      if (levelTool !== 'moving-platform' && levelTool !== 'select-object') { selectedMovingPlatformId = null; selectedLevelEntityId = null; movingPlatformWaypointGesture = null; }
      updateChrome(); render();
    };
    button.addEventListener('click', handler); return { button, handler };
  });

  const worldPointFor = (event: PointerEvent | MouseEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    const canvasX = (event.clientX - rect.left) * TILE_ROOM_VIEW_W / rect.width;
    const canvasY = (event.clientY - rect.top) * TILE_ROOM_VIEW_H / rect.height;
    if (!playing && showWholeLevel) {
      const transform = wholeLevelTransform();
      return { x: (canvasX - transform.x) / transform.scale, y: (canvasY - transform.y) / transform.scale };
    }
    return { x: canvasX + runtime.camera.x, y: canvasY + runtime.camera.y };
  };
  const logicalCellFor = (event: PointerEvent | MouseEvent): { col: number; row: number } => {
    const point = worldPointFor(event);
    return { col: Math.floor(point.x / runtime.scene.level.tiles.tileSize), row: Math.floor(point.y / runtime.scene.level.tiles.tileSize) };
  };
  const snappedWorldPointFor = (event: PointerEvent | MouseEvent): { x: number; y: number } => {
    const point = worldPointFor(event); const size = runtime.scene.level.tiles.tileSize;
    return { x: Math.floor(point.x / size) * size, y: Math.floor(point.y / size) * size };
  };
  const snappedWaypointPointFor = (event: PointerEvent | MouseEvent, rect: Readonly<LevelRect>): { x: number; y: number } => {
    const point = worldPointFor(event); const size = runtime.scene.level.tiles.tileSize;
    return { x: Math.round((point.x - rect.width / 2) / size) * size, y: Math.round((point.y - rect.height / 2) / size) * size };
  };
  const commitLevelScene = (scene: TileRoomScene): void => {
    if (scene === runtime.scene) { render(); return; }
    let nextRuntime: SceneRuntime;
    try { nextRuntime = createSceneRuntime(scene); }
    catch (error) { levelNotice = `Edit rejected: ${error instanceof Error ? error.message : 'invalid level'}`; updateChrome(); render(); return; }
    const camera = runtime.camera; levelUndoStack.push(runtime.scene); if (levelUndoStack.length > 50) levelUndoStack.shift(); levelRedoStack = [];
    runtime = nextRuntime; runtime.camera = camera; workingScenes[runtime.scene.id as TileRoomSceneId] = runtime.scene; selectedDualTile = null; levelNotice = '';
    if (!runtime.scene.level.entities.some((entity) => entity.id === selectedMovingPlatformId && entity.kind === 'movingPlatform')) selectedMovingPlatformId = null;
    if (!runtime.scene.level.entities.some((entity) => entity.id === selectedLevelEntityId)) selectedLevelEntityId = null;
    levelUndoButton.disabled = false; levelRedoButton.disabled = true; updateChrome(); render();
  };
  const replaceLogicalTiles = (cells: readonly { col: number; row: number }[], value: number): void => {
    const tiles = paintTerrainArtLogicalCells(runtime.scene.level.tiles, cells, value);
    const scene = { ...runtime.scene, level: { ...runtime.scene.level, tiles }, tileSemantics: {
      solid: terrainArtProject.terrainKinds.filter((kind) => kind.collision === 'solid').map((kind) => kind.tileValue),
      passthrough: terrainArtProject.terrainKinds.filter((kind) => kind.collision === 'passthrough').map((kind) => kind.tileValue),
    } };
    commitLevelScene(scene);
  };
  const moveSpawnToCell = (cell: Readonly<{ col: number; row: number }>): void => {
    const level = runtime.scene.level; const size = level.tiles.tileSize;
    const playerWidth = runtime.compiled.initialState.core.width; const playerHeight = runtime.compiled.initialState.core.height;
    const x = Math.max(0, Math.min(level.width - playerWidth, (cell.col + .5) * size - playerWidth / 2));
    const y = Math.max(0, Math.min(level.height - playerHeight, (cell.row + 1) * size - playerHeight));
    commitLevelScene(moveTileRoomSceneSpawn(runtime.scene, x, y));
  };
  const restoreLevelScene = (scene: TileRoomScene): void => { const camera = runtime.camera; runtime = createSceneRuntime(scene); runtime.camera = camera; workingScenes[runtime.scene.id as TileRoomSceneId] = runtime.scene; selectedDualTile = null; levelNotice = ''; if (!runtime.scene.level.entities.some((entity) => entity.id === selectedMovingPlatformId && entity.kind === 'movingPlatform')) selectedMovingPlatformId = null; if (!runtime.scene.level.entities.some((entity) => entity.id === selectedLevelEntityId)) selectedLevelEntityId = null; updateChrome(); render(); levelUndoButton.disabled = levelUndoStack.length === 0; levelRedoButton.disabled = levelRedoStack.length === 0; };
  const onLevelUndo = (): void => { const previous = levelUndoStack.pop(); if (!previous) return; levelRedoStack.push(runtime.scene); restoreLevelScene(previous); };
  const onLevelRedo = (): void => { const next = levelRedoStack.pop(); if (!next) return; levelUndoStack.push(runtime.scene); restoreLevelScene(next); };
  levelUndoButton.addEventListener('click', onLevelUndo); levelRedoButton.addEventListener('click', onLevelRedo);

  const onObjectClose = (): void => { selectedLevelEntityId = null; selectedMovingPlatformId = null; updateChrome(); render(); };
  const onObjectPositionChange = (): void => {
    const entity = selectedLevelEntity(); if (entity === undefined) return;
    const x = Number(objectXInput.value); const y = Number(objectYInput.value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) { updateObjectPanel(); return; }
    commitLevelScene(moveTileRoomEntity(runtime.scene, entity.id, x, y));
  };
  const onObjectSpeedChange = (): void => {
    const entity = selectedLevelEntity(); const speed = Number(objectSpeedInput.value);
    if (entity?.kind !== 'movingPlatform' || !Number.isFinite(speed)) { updateObjectPanel(); return; }
    commitLevelScene(updateTileRoomMovingPlatform(runtime.scene, entity.id, { speed }));
  };
  const onObjectLoopChange = (): void => {
    const entity = selectedLevelEntity(); if (entity?.kind !== 'movingPlatform') return;
    commitLevelScene(updateTileRoomMovingPlatform(runtime.scene, entity.id, { loopMode: objectLoopSelect.value === 'loop' ? 'loop' : 'pingpong' }));
  };
  const onObjectAddWaypoint = (): void => { const entity = selectedLevelEntity(); if (entity?.kind === 'movingPlatform') commitLevelScene(addTileRoomMovingPlatformWaypoint(runtime.scene, entity.id)); };
  const onObjectRemoveWaypoint = (): void => { const entity = selectedLevelEntity(); if (entity?.kind === 'movingPlatform') commitLevelScene(removeTileRoomMovingPlatformWaypoint(runtime.scene, entity.id)); };
  const onObjectExitChange = (): void => { const entity = selectedLevelEntity(); if (entity?.kind === 'exit') commitLevelScene(updateTileRoomExit(runtime.scene, entity.id, { locked: objectExitLockedInput.checked, isTrap: objectExitTrapInput.checked })); };
  const onObjectPickupChange = (): void => {
    const entity = selectedLevelEntity(); const value = Number(objectPickupValueInput.value); if (entity?.kind !== 'collectible' || !Number.isFinite(value)) return;
    const kind = objectPickupKindSelect.value === 'gem' ? 'gem' : objectPickupKindSelect.value === 'key' ? 'key' : 'coin';
    commitLevelScene(updateTileRoomCollectible(runtime.scene, entity.id, { kind, value, persists: objectPickupPersistsInput.checked }));
  };
  const onObjectDuplicate = (): void => {
    const entity = selectedLevelEntity(); if (entity === undefined) return;
    const id = runtime.scene.level.nextEntityId; const scene = duplicateTileRoomEntity(runtime.scene, entity.id);
    if (scene === runtime.scene) { levelNotice = 'This object cannot be duplicated'; updateChrome(); return; }
    selectedLevelEntityId = id; selectedMovingPlatformId = entity.kind === 'movingPlatform' ? id : null; commitLevelScene(scene);
  };
  const onObjectDelete = (): void => {
    const entity = selectedLevelEntity(); if (entity === undefined) return; const scene = deleteTileRoomEntity(runtime.scene, entity.id);
    if (scene === runtime.scene) { levelNotice = entity.kind === 'exit' ? 'Keep at least one exit' : 'This object is protected'; updateChrome(); return; }
    selectedLevelEntityId = null; selectedMovingPlatformId = null; commitLevelScene(scene);
  };
  objectCloseButton.addEventListener('click', onObjectClose);
  objectXInput.addEventListener('change', onObjectPositionChange); objectYInput.addEventListener('change', onObjectPositionChange);
  objectSpeedInput.addEventListener('change', onObjectSpeedChange); objectLoopSelect.addEventListener('change', onObjectLoopChange);
  objectAddWaypointButton.addEventListener('click', onObjectAddWaypoint); objectRemoveWaypointButton.addEventListener('click', onObjectRemoveWaypoint);
  objectExitLockedInput.addEventListener('change', onObjectExitChange); objectExitTrapInput.addEventListener('change', onObjectExitChange);
  objectPickupKindSelect.addEventListener('change', onObjectPickupChange); objectPickupValueInput.addEventListener('change', onObjectPickupChange); objectPickupPersistsInput.addEventListener('change', onObjectPickupChange);
  objectDuplicateButton.addEventListener('click', onObjectDuplicate); objectDeleteButton.addEventListener('click', onObjectDelete);
  const applyEditorZoom = (): void => { canvas.style.width = `${editorZoom * 100}%`; zoomValue.value = `${Math.round(editorZoom * 100)}%`; canvasWrap.style.overflow = editorZoom === 1 ? 'hidden' : 'auto'; };
  const onZoomOut = (): void => { editorZoom = Math.max(.5, editorZoom - .25); applyEditorZoom(); };
  const onZoomIn = (): void => { editorZoom = Math.min(2, editorZoom + .25); applyEditorZoom(); };
  const onFit = (): void => { editorZoom = 1; applyEditorZoom(); canvasWrap.scrollLeft = 0; canvasWrap.scrollTop = 0; };
  zoomOutButton.addEventListener('click', onZoomOut); zoomInButton.addEventListener('click', onZoomIn); fitButton.addEventListener('click', onFit); applyEditorZoom();

  const onOverviewToggle = (): void => { showWholeLevel = !showWholeLevel; updateChrome(); render(); };
  overviewButton.addEventListener('click', onOverviewToggle);
  const onLevelNameChange = (): void => {
    const scene = renameTileRoomScene(runtime.scene, levelNameInput.value);
    if (scene === runtime.scene) { levelNameInput.value = runtime.scene.level.name; return; }
    commitLevelScene(scene);
  };
  levelNameInput.addEventListener('change', onLevelNameChange);
  const onLevelSave = (): void => {
    try {
      localStorage.setItem(levelStorageKey(runtime.scene.id), serializeTileRoomScene(runtime.scene));
      savedLevelHashes.set(runtime.scene.id, hashTileRoomScene(runtime.scene)); workingScenes[runtime.scene.id as TileRoomSceneId] = runtime.scene; levelNotice = 'Saved locally'; updateChrome();
    } catch { levelNotice = 'Local save unavailable'; updateChrome(); }
  };
  const onLevelLoad = (): void => {
    try {
      const source = localStorage.getItem(levelStorageKey(runtime.scene.id));
      if (source === null) { levelNotice = 'No saved level yet'; updateChrome(); return; }
      const parsed = parseTileRoomScene(source, runtime.scene);
      if (!parsed.ok) { levelNotice = `Load failed: ${parsed.error}`; updateChrome(); return; }
      savedLevelHashes.set(runtime.scene.id, hashTileRoomScene(parsed.scene)); commitLevelScene(parsed.scene); levelNotice = 'Loaded saved level'; updateChrome();
    } catch { levelNotice = 'Saved level could not be read'; updateChrome(); }
  };
  const onLevelReset = (): void => {
    if (!window.confirm(`Reset “${runtime.scene.level.name}” to the built-in ${runtime.scene.id} room? You can still Undo this reset.`)) return;
    try { localStorage.removeItem(levelStorageKey(runtime.scene.id)); } catch { /* Reset still applies in memory. */ }
    savedLevelHashes.delete(runtime.scene.id); commitLevelScene(originalScenes[runtime.scene.id as TileRoomSceneId]); levelNotice = 'Built-in level restored · Undo available'; updateChrome();
  };
  const onLevelExport = (): void => {
    const blob = new Blob([serializeTileRoomScene(runtime.scene)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `${runtime.scene.level.id || runtime.scene.id}.json`; link.click(); URL.revokeObjectURL(url); levelNotice = 'Level JSON exported'; updateChrome();
  };
  const onLevelImport = (): void => { levelImportFile.value = ''; levelImportFile.click(); };
  const onLevelImportFile = async (): Promise<void> => {
    const file = levelImportFile.files?.[0]; if (file === undefined) return;
    try {
      const parsed = parseTileRoomScene(await file.text(), runtime.scene);
      if (!parsed.ok) { levelNotice = `Import failed: ${parsed.error}`; updateChrome(); return; }
      commitLevelScene(parsed.scene); levelNotice = `Imported ${file.name} · save when ready`; updateChrome();
    } catch { levelNotice = 'Import failed: file could not be read'; updateChrome(); }
  };
  levelSaveButton.addEventListener('click', onLevelSave); levelLoadButton.addEventListener('click', onLevelLoad); levelResetButton.addEventListener('click', onLevelReset);
  levelExportButton.addEventListener('click', onLevelExport); levelImportButton.addEventListener('click', onLevelImport); levelImportFile.addEventListener('change', onLevelImportFile);

  const onEditorShortcut = (event: KeyboardEvent): void => {
    if (!onscreen || playing) return;
    const target = event.target;
    const editingField = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
    if (!editingField && (event.code === 'Delete' || event.code === 'Backspace') && selectedLevelEntityId !== null) { event.preventDefault(); onObjectDelete(); return; }
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.code === 'KeyS') { event.preventDefault(); onLevelSave(); return; }
    if (event.code === 'KeyZ') { event.preventDefault(); if (event.shiftKey) onLevelRedo(); else onLevelUndo(); }
  };
  window.addEventListener('keydown', onEditorShortcut);

  const onCanvasInspect = (event: MouseEvent): void => {
    if (playing || treatment !== 'dual-grid' || levelTool !== 'inspect') return;
    const rect = canvas.getBoundingClientRect(); if (rect.width <= 0 || rect.height <= 0) return;
    const { x: worldX, y: worldY } = worldPointFor(event);
    selectedDualTile = hitTestTerrainArtDualGrid(
      preparedTerrainArtFor(runtime.scene.level),
      worldX,
      worldY,
      terrainArtProject.authoringResolution,
    );
    updateInspector();
    render();
  };
  canvas.addEventListener('click', onCanvasInspect);
  const onLevelPointerDown = (event: PointerEvent): void => {
    if (playing || treatment !== 'dual-grid' || levelTool === 'inspect') return;
    const world = worldPointFor(event); const level = runtime.scene.level;
    if (world.x < 0 || world.y < 0 || world.x >= level.width || world.y >= level.height) return;
    levelCursorWorld = world; levelCursorInside = true;
    const cell = logicalCellFor(event); const grid = level.tiles;
    const placeable = placeableTool();
    if (placeable !== null) {
      const size = level.tileSize; selectedLevelEntityId = runtime.scene.level.nextEntityId; selectedMovingPlatformId = null;
      commitLevelScene(addTileRoomEntity(runtime.scene, placeable, cell.col * size, cell.row * size)); return;
    }
    if (levelTool === 'select-object') {
      const selected = selectedLevelEntity();
      if (selected?.kind === 'movingPlatform') {
        const hitRadius = Math.max(8, level.tileSize * .65);
        for (let index = selected.props.path.length - 1; index >= 1; index--) {
          const point = selected.props.path[index]!;
          if (Math.hypot(world.x - point.x - selected.rect.width / 2, world.y - point.y - selected.rect.height / 2) <= hitRadius) {
            movingPlatformWaypointGesture = { entityId: selected.id, waypointIndex: index, current: point };
            canvas.setPointerCapture(event.pointerId); updateChrome(); render(); return;
          }
        }
      }
      const target = objectAt(world);
      if (target === undefined) { selectedLevelEntityId = null; selectedMovingPlatformId = null; levelNotice = 'Selection cleared'; updateChrome(); render(); return; }
      selectedLevelEntityId = target.id; selectedMovingPlatformId = target.kind === 'movingPlatform' ? target.id : null;
      const snapped = snappedWorldPointFor(event); objectMoveGesture = { entityId: target.id, start: snapped, current: snapped, originRect: target.rect };
      canvas.setPointerCapture(event.pointerId); updateChrome(); render(); return;
    }
    if (levelTool === 'moving-platform') {
      const snapped = snappedWorldPointFor(event);
      const selected = runtime.scene.level.entities.find((entity) => entity.id === selectedMovingPlatformId);
      if (selected?.kind === 'movingPlatform') {
        const hitRadius = Math.max(8, level.tileSize * .65);
        for (let index = selected.props.path.length - 1; index >= 1; index--) {
          const point = selected.props.path[index]!;
          const centerX = point.x + selected.rect.width / 2; const centerY = point.y + selected.rect.height / 2;
          if (Math.hypot(world.x - centerX, world.y - centerY) <= hitRadius) {
            movingPlatformWaypointGesture = { entityId: selected.id, waypointIndex: index, current: point };
            canvas.setPointerCapture(event.pointerId); updateChrome(); render(); return;
          }
        }
      }
      const existing = [...runtime.scene.level.entities].reverse().find((entity) => entity.kind === 'movingPlatform' && world.x >= entity.rect.x && world.x <= entity.rect.x + entity.rect.width && world.y >= entity.rect.y && world.y <= entity.rect.y + entity.rect.height);
      selectedMovingPlatformId = existing?.kind === 'movingPlatform' ? existing.id : null;
      selectedLevelEntityId = selectedMovingPlatformId;
      movingPlatformGesture = existing?.kind === 'movingPlatform'
        ? { mode: 'move', start: snapped, current: snapped, entityId: existing.id, originRect: existing.rect, originPath: existing.props.path }
        : { mode: 'create', start: snapped, current: snapped };
      canvas.setPointerCapture(event.pointerId); updateChrome(); render(); return;
    }
    if (levelTool === 'spikes' || levelTool === 'erase-spikes') {
      spikeGesture = { start: cell, current: cell };
      canvas.setPointerCapture(event.pointerId); render(); return;
    }
    if (levelTool === 'picker') {
      const value = pickTerrainArtLogicalValue(grid, cell); if (value !== null) terrainKindSelect.value = String(value); return;
    }
    if (levelTool === 'spawn') { moveSpawnToCell(cell); return; }
    if (levelTool === 'fill') { replaceLogicalTiles(terrainArtLogicalFill(grid, cell), Number(terrainKindSelect.value)); return; }
    levelGestureStart = cell; levelGestureLast = cell; levelPendingCells = new Map([[`${cell.col},${cell.row}`, cell]]); canvas.setPointerCapture(event.pointerId); render();
  };
  const onLevelPointerMove = (event: PointerEvent): void => {
    levelCursorWorld = worldPointFor(event);
    levelCursorInside = levelCursorWorld.x >= 0 && levelCursorWorld.y >= 0 && levelCursorWorld.x < runtime.scene.level.width && levelCursorWorld.y < runtime.scene.level.height;
    if (movingPlatformWaypointGesture !== null) {
      const selected = runtime.scene.level.entities.find((entity) => entity.id === movingPlatformWaypointGesture!.entityId);
      if (selected?.kind === 'movingPlatform') movingPlatformWaypointGesture.current = snappedWaypointPointFor(event, selected.rect);
      render(); return;
    }
    if (movingPlatformGesture !== null) { movingPlatformGesture.current = snappedWorldPointFor(event); render(); return; }
    if (spikeGesture !== null) { spikeGesture.current = logicalCellFor(event); render(); return; }
    if (objectMoveGesture !== null) { objectMoveGesture.current = snappedWorldPointFor(event); render(); return; }
    if (!levelGestureStart) { if (placeableTool() !== null || levelTool === 'select-object') render(); return; }
    const cell = logicalCellFor(event); if (levelGestureLast?.col === cell.col && levelGestureLast.row === cell.row) return;
    if (levelTool === 'paint' || levelTool === 'erase') for (const point of terrainArtLogicalLine(levelGestureLast ?? cell, cell)) levelPendingCells.set(`${point.col},${point.row}`, point);
    levelGestureLast = cell; render();
  };
  const onLevelPointerUp = (event: PointerEvent): void => {
    if (movingPlatformWaypointGesture !== null) {
      const selected = runtime.scene.level.entities.find((entity) => entity.id === movingPlatformWaypointGesture!.entityId);
      if (selected?.kind === 'movingPlatform') movingPlatformWaypointGesture.current = snappedWaypointPointFor(event, selected.rect);
      const gesture = movingPlatformWaypointGesture; movingPlatformWaypointGesture = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      commitLevelScene(moveTileRoomMovingPlatformWaypoint(runtime.scene, gesture.entityId, gesture.waypointIndex, gesture.current));
      return;
    }
    if (movingPlatformGesture !== null) {
      movingPlatformGesture.current = snappedWorldPointFor(event); const preview = movingPlatformPreview(); const gesture = movingPlatformGesture; movingPlatformGesture = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (preview !== undefined) {
        if (gesture.mode === 'create') selectedMovingPlatformId = runtime.scene.level.nextEntityId;
        else selectedMovingPlatformId = gesture.entityId ?? null;
        selectedLevelEntityId = selectedMovingPlatformId;
        commitLevelScene(gesture.mode === 'create' ? addTileRoomMovingPlatform(runtime.scene, preview.rect) : moveTileRoomMovingPlatform(runtime.scene, gesture.entityId ?? -1, preview.rect));
      }
      return;
    }
    if (objectMoveGesture !== null) {
      objectMoveGesture.current = snappedWorldPointFor(event); const preview = entityPreview(); const gesture = objectMoveGesture; objectMoveGesture = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (preview !== undefined) commitLevelScene(moveTileRoomEntity(runtime.scene, gesture.entityId, preview.entity.rect.x, preview.entity.rect.y)); else render();
      return;
    }
    if (spikeGesture !== null) {
      spikeGesture.current = logicalCellFor(event); const preview = spikePreview(); spikeGesture = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (preview !== undefined) {
        const scene = preview.mode === 'create' ? addTileRoomSpikes(runtime.scene, preview.rect) : deleteTileRoomSpikes(runtime.scene, preview.rect);
        if (scene !== runtime.scene) commitLevelScene(scene); else render();
      }
      return;
    }
    if (!levelGestureStart) return;
    const end = logicalCellFor(event);
    const cells = levelTool === 'paint' || levelTool === 'erase' ? [...levelPendingCells.values()] : levelTool === 'line' ? terrainArtLogicalLine(levelGestureStart, end) : terrainArtLogicalRectangle(levelGestureStart, end, true);
    levelGestureStart = null; levelGestureLast = null; levelPendingCells.clear();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    replaceLogicalTiles(cells, levelTool === 'erase' ? 0 : Number(terrainKindSelect.value));
  };
  const onLevelPointerCancel = (event: PointerEvent): void => {
    levelGestureStart = null; levelGestureLast = null; levelPendingCells.clear(); movingPlatformGesture = null; movingPlatformWaypointGesture = null; spikeGesture = null; objectMoveGesture = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    render();
  };
  canvas.addEventListener('pointerdown', onLevelPointerDown);
  canvas.addEventListener('pointermove', onLevelPointerMove);
  canvas.addEventListener('pointerup', onLevelPointerUp);
  canvas.addEventListener('pointercancel', onLevelPointerCancel);
  const onLevelPointerLeave = (): void => {
    if (levelGestureStart !== null || movingPlatformGesture !== null || movingPlatformWaypointGesture !== null || spikeGesture !== null || objectMoveGesture !== null) return;
    levelCursorInside = false; if (placeableTool() !== null || levelTool === 'select-object') render();
  };
  canvas.addEventListener('pointerleave', onLevelPointerLeave);

  const artPanelHandlers = artPanelButtons.map((button) => {
    const handler = (): void => {
      const requested = button.dataset.artPanel;
      for (const candidate of artPanelButtons) candidate.setAttribute('aria-selected', String(candidate === button));
      for (const panel of artPanels) panel.hidden = panel.dataset.artPanelContent !== requested;
    };
    button.addEventListener('click', handler);
    return { button, handler };
  });

  const artToolHandlers = artToolButtons.map((button) => {
    const handler = (): void => {
      const requested = button.dataset.artTool;
      artTool = requested === 'inherit' || requested === 'line' || requested === 'rectangle' || requested === 'ellipse' || requested === 'fill' || requested === 'eyedropper' || requested === 'select'
        ? requested : 'paint';
      for (const candidate of artToolButtons) candidate.setAttribute('aria-pressed', String(candidate === button));
    };
    button.addEventListener('click', handler);
    return { button, handler };
  });
  const updateHistoryButtons = (): void => {
    artUndo.disabled = artUndoStack.length === 0;
    artRedo.disabled = artRedoStack.length === 0;
  };
  const commitHistory = (before: TerrainArtProject): void => {
    if (before === terrainArtProject) return;
    artUndoStack.push(before);
    if (artUndoStack.length > 50) artUndoStack.shift();
    artRedoStack = [];
    updateHistoryButtons();
  };
  const refreshArt = (): void => {
    refreshTerrainAtlas();
    updateInspector();
    updateStatus();
    render();
  };

  // Built here rather than beside the other art state because its first render
  // reads the active material and the project, both of which must already exist.
  tilesetImport = createTileRoomTilesetImport(container, {
    getProject: () => terrainArtProject,
    getActiveMaterialId: () => activeMaterialId,
    applyProject: (next, before) => {
      terrainArtProject = next;
      commitHistory(before);
      updateMaterialChrome();
      refreshArt();
    },
  });

  const artPointFor = (event: PointerEvent): { x: number; y: number } => {
    const rect = artCanvas.getBoundingClientRect();
    return {
      x: Math.floor((event.clientX - rect.left) * terrainArtProject.authoringResolution / rect.width),
      y: Math.floor((event.clientY - rect.top) * terrainArtProject.authoringResolution / rect.height),
    };
  };
  const selectedArtContribution = (): { materialId: string; mask: TerrainArtDualGridMask } | null => {
    if (selectedDualTile === null || selectedDualTile.tile.occupancyMask === 0) return null;
    const direct = selectedDualTile.tile.materials.find((entry) => entry.materialId === activeMaterialId);
    return { materialId: activeMaterialId, mask: direct?.mask ?? selectedDualTile.tile.occupancyMask };
  };
  const applyArtPoints = (points: readonly { x: number; y: number }[], mode: 'paint' | 'inherit' = 'paint'): void => {
    const contribution = selectedArtContribution();
    if (!contribution) return;
    const radius = Math.floor(Number(brushSizeInput.value) / 2);
    const rgba = Number.parseInt(`${artColor.value.slice(1)}ff`, 16) >>> 0;
    const edits: TerrainArtPixelEdit[] = [];
    for (const point of points) for (let py = point.y - radius; py <= point.y + radius; py++) for (let px = point.x - radius; px <= point.x + radius; px++) {
      const key = py * terrainArtProject.authoringResolution + px;
      if (strokeVisited.has(key)) continue;
      strokeVisited.add(key);
      const colorRef = artColorLink.value === 'literal' ? undefined : artColorLink.value as keyof TerrainArtPalette;
      edits.push({ x: px, y: py, mode, ...(mode === 'paint' && colorRef === undefined ? { rgba } : {}), ...(mode === 'paint' && colorRef !== undefined ? { colorRef } : {}) });
    }
    if (edits.length === 0) return;
    terrainArtProject = editLocalOccurrence && selectedDualTile !== null
      ? editTerrainArtOccurrenceLayer(terrainArtProject, runtime.scene.id, selectedDualTile.dualX, selectedDualTile.dualY, contribution.materialId, contribution.mask, activeVariantId, 'manual', edits)
      : editTerrainArtSourceTile(terrainArtProject, contribution.materialId, 'manual', contribution.mask, activeVariantId, edits);
    refreshArt();
  };
  let strokeStart: TerrainArtProject | null = null;
  const onArtPointerDown = (event: PointerEvent): void => {
    const point = artPointFor(event);
    strokeVisited = new Set();
    strokeStart = terrainArtProject;
    if (artTool === 'eyedropper') {
      const contribution = selectedArtContribution();
      if (!contribution) return;
      const source = renderTerrainArtSourceTile(terrainArtProject, contribution.materialId, contribution.mask, activeVariantId, importResolver);
      const offset = (point.y * source.width + point.x) * 4;
      artColor.value = `#${[source.pixels[offset], source.pixels[offset + 1], source.pixels[offset + 2]].map((value) => (value ?? 0).toString(16).padStart(2, '0')).join('')}`;
      artColorLink.value = 'literal';
      strokeStart = null;
      return;
    }
    if (artTool === 'fill') {
      const contribution = selectedArtContribution();
      if (!contribution) return;
      const source = renderTerrainArtSourceTile(terrainArtProject, contribution.materialId, contribution.mask, activeVariantId, importResolver);
      applyArtPoints(terrainArtFloodFillPixels(source.pixels, source.width, source.height, point));
      if (strokeStart) commitHistory(strokeStart);
      strokeStart = null;
      return;
    }
    activeStroke = true;
    shapeStart = point;
    strokeLast = point;
    artCanvas.setPointerCapture(event.pointerId);
    if (artTool === 'paint' || artTool === 'inherit') applyArtPoints([point], artTool);
  };
  const onArtPointerMove = (event: PointerEvent): void => {
    if (activeStroke && (artTool === 'paint' || artTool === 'inherit')) {
      const point = artPointFor(event);
      applyArtPoints(strokeLast ? terrainArtLinePixels(strokeLast, point) : [point], artTool);
      strokeLast = point;
    }
  };
  const onArtPointerUp = (event: PointerEvent): void => {
    if (!activeStroke) return;
    activeStroke = false;
    if (artCanvas.hasPointerCapture(event.pointerId)) artCanvas.releasePointerCapture(event.pointerId);
    if (shapeStart && artTool !== 'paint' && artTool !== 'inherit') {
      const end = artPointFor(event);
      if (artTool === 'select') {
        artSelection = { x: Math.min(shapeStart.x, end.x), y: Math.min(shapeStart.y, end.y), width: Math.abs(end.x - shapeStart.x) + 1, height: Math.abs(end.y - shapeStart.y) + 1 };
      } else {
      const points = artTool === 'line' ? terrainArtLinePixels(shapeStart, end)
        : artTool === 'rectangle' ? terrainArtRectanglePixels(shapeStart, end)
          : terrainArtEllipsePixels(shapeStart, end);
      applyArtPoints(points);
      }
    }
    if (strokeStart) commitHistory(strokeStart);
    strokeStart = null;
    shapeStart = null;
    strokeLast = null;
  };
  artCanvas.addEventListener('pointerdown', onArtPointerDown);
  artCanvas.addEventListener('pointermove', onArtPointerMove);
  artCanvas.addEventListener('pointerup', onArtPointerUp);
  artCanvas.addEventListener('pointercancel', onArtPointerUp);
  const onArtRevert = (): void => {
    const contribution = selectedArtContribution();
    if (!contribution) return;
    const before = terrainArtProject;
    terrainArtProject = clearTerrainArtSourceTileEdits(terrainArtProject, contribution.materialId, 'manual', contribution.mask, activeVariantId);
    commitHistory(before);
    refreshArt();
  };
  artRevert.addEventListener('click', onArtRevert);
  const onOnionSkin = (): void => updateInspector(); onionSkin.addEventListener('change', onOnionSkin);
  // Every path that swaps the whole project has to re-sync the import panel,
  // or it keeps showing the previous material's tileset while the level draws
  // the new one.
  const restoreArtProject = (next: TerrainArtProject): void => {
    terrainArtProject = next;
    refreshArt();
    updateHistoryButtons();
    tilesetImport?.sync();
  };
  const onArtUndo = (): void => {
    const previous = artUndoStack.pop();
    if (!previous) return;
    artRedoStack.push(terrainArtProject);
    restoreArtProject(previous);
  };
  const onArtRedo = (): void => {
    const next = artRedoStack.pop();
    if (!next) return;
    artUndoStack.push(terrainArtProject);
    restoreArtProject(next);
  };
  artUndo.addEventListener('click', onArtUndo);
  artRedo.addEventListener('click', onArtRedo);
  const transformHandlers = artTransformButtons.map((button) => {
    const handler = (): void => { const contribution = selectedArtContribution(); if (!contribution) return; const before = terrainArtProject; terrainArtProject = transformTerrainArtSourceTile(terrainArtProject, contribution.materialId, 'manual', contribution.mask, activeVariantId, button.dataset.artTransform as TerrainArtTransform); commitHistory(before); refreshArt(); };
    button.addEventListener('click', handler); return { button, handler };
  });
  const moveHandlers = artMoveButtons.map((button) => {
    const handler = (): void => { const contribution = selectedArtContribution(); if (!contribution) return; const direction = button.dataset.artMove; const dx = direction === 'left' ? -1 : direction === 'right' ? 1 : 0; const dy = direction === 'up' ? -1 : direction === 'down' ? 1 : 0; const before = terrainArtProject; terrainArtProject = artSelection ? moveTerrainArtSourceSelection(terrainArtProject, contribution.materialId, 'manual', contribution.mask, activeVariantId, artSelection, dx, dy) : moveTerrainArtSourceTile(terrainArtProject, contribution.materialId, 'manual', contribution.mask, activeVariantId, dx, dy); if (artSelection) artSelection = { ...artSelection, x: artSelection.x + dx, y: artSelection.y + dy }; commitHistory(before); refreshArt(); };
    button.addEventListener('click', handler); return { button, handler };
  });
  const onStamp = (): void => { const contribution = selectedArtContribution(); if (!contribution) return; const before = terrainArtProject; terrainArtProject = stampTerrainArtSourceTile(terrainArtProject, contribution.materialId, 'manual', contribution.mask, activeVariantId, Number(stampMaskSelect.value) as TerrainArtDualGridMask, activeVariantId); commitHistory(before); refreshArt(); };
  stampButton.addEventListener('click', onStamp);
  const updateGeneratorFromControls = (): void => {
    const materialId = selectedArtContribution()?.materialId;
    if (!materialId) return;
    generatorGestureStart ??= terrainArtProject;
    terrainArtProject = updateTerrainArtGenerator(terrainArtProject, materialId, {
      roundness: Number(roundnessInput.value),
      contourWidth: Number(contourInput.value),
      topHighlightDepth: Number(highlightInput.value),
      sideShadeDepth: Number(sideShadeInput.value),
      detailDensity: Number(detailDensityInput.value),
      detailScale: Number(detailScaleInput.value),
      clipManualToSilhouette: clipManualInput.checked,
    });
    terrainArtProject = updateTerrainArtLayer(terrainArtProject, materialId, 'manual', { clipMode: clipManualInput.checked ? 'material-silhouette' : 'none' });
    refreshTerrainAtlas();
    updateInspector();
    render();
  };
  const generatorInputs = [roundnessInput, contourInput, highlightInput, sideShadeInput, detailDensityInput, detailScaleInput, clipManualInput];
  for (const input of generatorInputs) input.addEventListener('input', updateGeneratorFromControls);
  const beginGeneratorGesture = (): void => { generatorGestureStart ??= terrainArtProject; };
  const endGeneratorGesture = (): void => {
    if (generatorGestureStart) commitHistory(generatorGestureStart);
    generatorGestureStart = null;
  };
  for (const input of generatorInputs) {
    input.addEventListener('pointerdown', beginGeneratorGesture);
    input.addEventListener('focus', beginGeneratorGesture);
    input.addEventListener('change', endGeneratorGesture);
  }
  const onGeneratorReset = (): void => {
    const materialId = selectedArtContribution()?.materialId;
    if (!materialId) return;
    const before = terrainArtProject;
    const clean = resetTerrainArtMaterial(terrainArtProject, materialId, stylePresetById.get(materialId) ?? 'meadow');
    const cleanGenerator = clean.materials.find((material) => material.id === materialId)?.generator;
    if (cleanGenerator === undefined) return;
    terrainArtProject = updateTerrainArtGenerator(terrainArtProject, materialId, cleanGenerator);
    commitHistory(before);
    refreshArt();
    saveStatus.value = 'Automatic controls reset · manual paint kept';
  };
  generatorReset.addEventListener('click', onGeneratorReset);
  const onMaterialReset = (): void => {
    const styleName = terrainArtProject.materials.find((material) => material.id === activeMaterialId)?.name ?? 'this style';
    if (!window.confirm(`Restore ${styleName}? This clears its manual paint, variations, layer changes, and level-only edits.`)) return;
    const before = terrainArtProject;
    terrainArtProject = resetTerrainArtMaterial(terrainArtProject, activeMaterialId, stylePresetById.get(activeMaterialId) ?? 'meadow');
    activeVariantId = 'default';
    editLocalOccurrence = false;
    commitHistory(before); refreshArt(); updateMaterialChrome(); saveStatus.value = `${styleName} restored · Undo available`;
  };
  materialReset.addEventListener('click', onMaterialReset);
  const onMaterialChange = (): void => { activeMaterialId = materialSelect.value; updateMaterialChrome(); updateInspector(); tilesetImport?.sync(); };
  materialSelect.addEventListener('change', onMaterialChange);
  const onMaterialNameFocus = (): void => { materialNameGestureStart ??= terrainArtProject; };
  const onMaterialNameInput = (): void => {
    const cleanName = materialNameInput.value.trim();
    if (!cleanName) return;
    materialNameGestureStart ??= terrainArtProject;
    terrainArtProject = renameTerrainArtMaterial(terrainArtProject, activeMaterialId, cleanName);
    const selectedOption = materialSelect.selectedOptions[0]; if (selectedOption) selectedOption.textContent = cleanName;
    const contribution = selectedArtContribution(); if (contribution) artEditorTitle.textContent = `${cleanName} · ${describeTerrainMask(contribution.mask)}`;
    updateStatus();
  };
  const onMaterialNameBlur = (): void => {
    const currentName = terrainArtProject.materials.find((material) => material.id === activeMaterialId)?.name ?? '';
    const invalid = !materialNameInput.value.trim(); if (invalid) materialNameInput.value = currentName;
    if (materialNameGestureStart) commitHistory(materialNameGestureStart);
    materialNameGestureStart = null; updateMaterialChrome(); updateTerrainKindOptions(); updateInspector(); saveStatus.value = invalid ? 'A terrain style needs a name' : 'Style renamed';
  };
  materialNameInput.addEventListener('focus', onMaterialNameFocus);
  materialNameInput.addEventListener('input', onMaterialNameInput);
  materialNameInput.addEventListener('blur', onMaterialNameBlur);
  const onPresetChange = (): void => { const preset = presetSelect.value as TerrainArtPresetId; stylePresetById.set(activeMaterialId, preset); const before = terrainArtProject; terrainArtProject = applyTerrainArtPreset(terrainArtProject, activeMaterialId, preset); commitHistory(before); refreshArt(); updateInspector(); saveStatus.value = `${presetSelect.selectedOptions[0]?.textContent ?? 'Quick look'} applied · manual paint kept`; };
  presetSelect.addEventListener('change', onPresetChange);
  const onAddMaterial = (): void => {
    const before = terrainArtProject; let suffix = terrainArtProject.materials.length;
    while (terrainArtProject.materials.some((material) => material.id === `terrain-style-${suffix}`)) suffix++;
    const id = `terrain-style-${suffix}`; const name = `New terrain style ${suffix}`;
    terrainArtProject = addTerrainArtMaterial(terrainArtProject, id, name, 'meadow');
    const tileValue = Math.max(...terrainArtProject.terrainKinds.map((kind) => kind.tileValue)) + 1;
    terrainArtProject = { ...terrainArtProject, terrainKinds: [...terrainArtProject.terrainKinds, { id, label: name, tileValue, collision: 'solid', materialId: id, connectGroup: 'solid', renderPriority: terrainArtProject.materials.find((material) => material.id === id)!.priority }] };
    activeMaterialId = id; stylePresetById.set(id, 'meadow'); commitHistory(before); updateMaterialChrome(); updateInspector();
    updateTerrainKindOptions(); terrainKindSelect.value = String(tileValue); refreshArt();
    materialNameInput.focus(); materialNameInput.select(); saveStatus.value = 'New style created · type its name';
  };
  addMaterialButton.addEventListener('click', onAddMaterial);
  const onRemoveMaterial = (): void => {
    const removed = terrainArtProject.materials.find((material) => material.id === activeMaterialId); const replacement = terrainArtProject.materials.find((material) => material.id !== activeMaterialId); if (!removed || !replacement) { saveStatus.value = 'Keep at least one terrain style'; return; }
    if (!window.confirm(`Delete ${removed.name}? Level cells using it will switch to ${replacement.name}.`)) return;
    const before = terrainArtProject; terrainArtProject = removeTerrainArtMaterial(terrainArtProject, activeMaterialId, replacement.id); stylePresetById.delete(activeMaterialId); activeMaterialId = replacement.id; commitHistory(before); updateMaterialChrome(); updateTerrainKindOptions(); refreshArt(); saveStatus.value = `${removed.name} deleted · Undo available`;
  };
  removeMaterialButton.addEventListener('click', onRemoveMaterial);
  const onTransitionChange = (): void => { if (!transitionBackground.value) return; const before = terrainArtProject; terrainArtProject = setTerrainArtTransitionRule(terrainArtProject, { foregroundMaterialId: activeMaterialId, backgroundMaterialId: transitionBackground.value, mode: transitionMode.value === 'contour' ? 'contour' : 'hard', width: transitionMode.value === 'contour' ? 2 : 0, colorRef: 'contour' }); commitHistory(before); };
  transitionBackground.addEventListener('change', onTransitionChange);
  transitionMode.addEventListener('change', onTransitionChange);
  const onResolutionChange = (): void => {
    pendingResolution = Number(resolutionSelect.value); resolutionConfirm.hidden = pendingResolution === terrainArtProject.authoringResolution;
    saveStatus.value = resolutionConfirm.hidden ? '' : `Preview: ${terrainArtProject.authoringResolution}px → ${pendingResolution}px; manual pixels use nearest-neighbor`;
  };
  resolutionSelect.addEventListener('change', onResolutionChange);
  const onResolutionApply = (): void => { if (pendingResolution === null) return; const before = terrainArtProject; terrainArtProject = resizeTerrainArtProject(terrainArtProject, pendingResolution); pendingResolution = null; resolutionConfirm.hidden = true; commitHistory(before); refreshArt(); updateMaterialChrome(); saveStatus.value = 'Resolution changed · Undo available'; };
  const onResolutionCancel = (): void => { pendingResolution = null; resolutionConfirm.hidden = true; resolutionSelect.value = String(terrainArtProject.authoringResolution); saveStatus.value = 'Resize cancelled'; };
  resolutionApply.addEventListener('click', onResolutionApply);
  resolutionCancel.addEventListener('click', onResolutionCancel);
  const onSeedChange = (): void => {
    const next = Number(seedInput.value); if (!Number.isFinite(next)) return;
    const before = terrainArtProject; terrainArtProject = { ...terrainArtProject, visualSeed: Math.trunc(next) }; commitHistory(before); refreshArt();
  };
  seedInput.addEventListener('change', onSeedChange);
  const onReroll = (): void => { seedInput.value = String((terrainArtProject.visualSeed + 1) | 0); onSeedChange(); };
  rerollButton.addEventListener('click', onReroll);
  const onVariantChange = (): void => { activeVariantId = variantSelect.value; updateMaterialChrome(); updateInspector(); };
  variantSelect.addEventListener('change', onVariantChange);
  const onAddVariant = (): void => {
    const material = terrainArtProject.materials.find((candidate) => candidate.id === activeMaterialId); if (!material) return;
    let suffix = material.variants.length; while (material.variants.some((variant) => variant.id === `variation-${suffix}`)) suffix++;
    const id = `variation-${suffix}`; const before = terrainArtProject;
    terrainArtProject = addTerrainArtVariant(terrainArtProject, activeMaterialId, { id, label: `Variation ${suffix}`, enabled: true, weight: 1, eligibleMasks: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], exposure: 'any', seedOffset: suffix * 101 });
    activeVariantId = id; commitHistory(before); updateMaterialChrome(); updateInspector();
  };
  addVariantButton.addEventListener('click', onAddVariant);
  const onVariantWeight = (): void => { const before = terrainArtProject; terrainArtProject = updateTerrainArtVariant(terrainArtProject, activeMaterialId, activeVariantId, { weight: Number(variantWeightInput.value) }); commitHistory(before); updateMaterialChrome(); };
  variantWeightInput.addEventListener('change', onVariantWeight);
  const onPinVariant = (): void => {
    const contribution = selectedArtContribution(); if (!contribution || !selectedDualTile) return;
    const before = terrainArtProject; terrainArtProject = pinTerrainArtOccurrenceVariant(terrainArtProject, runtime.scene.id, selectedDualTile.dualX, selectedDualTile.dualY, contribution.materialId, contribution.mask, activeVariantId, activeVariantId); commitHistory(before); updateMaterialChrome();
  };
  pinVariantButton.addEventListener('click', onPinVariant);
  const onLocalEdit = (): void => { editLocalOccurrence = !editLocalOccurrence; updateInspector(); };
  localEditButton.addEventListener('click', onLocalEdit);
  const onLocalRevert = (): void => {
    const contribution = selectedArtContribution(); if (!contribution || !selectedDualTile) return;
    const before = terrainArtProject; terrainArtProject = deleteTerrainArtOccurrenceOverride(terrainArtProject, runtime.scene.id, selectedDualTile.dualX, selectedDualTile.dualY, contribution.materialId); commitHistory(before); updateInspector();
  };
  localRevertButton.addEventListener('click', onLocalRevert);
  const onClearOverrides = (): void => { const before = terrainArtProject; terrainArtProject = clearTerrainArtOccurrenceOverrides(terrainArtProject); commitHistory(before); updateMaterialChrome(); refreshArt(); };
  clearOverridesButton.addEventListener('click', onClearOverrides);
  const storageKey = 'aicraft:tile-room-terrain-art:v1';
  const onRestoreAll = (): void => {
    if (!window.confirm('Restore the complete terrain editor to its original meadow setup? This removes saved terrain styles, paint, variations, and level-only edits.')) return;
    const before = terrainArtProject; terrainArtProject = createTileRoomTerrainArtProject();
    activeMaterialId = terrainArtProject.materials[0]!.id; activeVariantId = 'default'; editLocalOccurrence = false; pendingResolution = null;
    stylePresetById.clear(); stylePresetById.set(activeMaterialId, 'meadow');
    try { localStorage.removeItem(storageKey); } catch { /* The in-memory reset still succeeds. */ }
    lastSavedTerrainHash = hashTerrainArtProject(terrainArtProject); commitHistory(before); refreshArt(); updateMaterialChrome(); updateTerrainKindOptions(); tilesetImport?.sync(); saveStatus.value = 'Everything restored · Undo available';
  };
  restoreAllButton.addEventListener('click', onRestoreAll);
  const onSaveSource = (): void => {
    try { localStorage.setItem(storageKey, serializeTerrainArtProject(terrainArtProject)); lastSavedTerrainHash = hashTerrainArtProject(terrainArtProject); saveStatus.value = 'Saved'; updateStatus(); }
    catch { saveStatus.value = 'Save unavailable'; }
  };
  const onLoadSource = (): void => {
    try {
      const source = localStorage.getItem(storageKey); const loaded = source === null ? null : deserializeTerrainArtProject(source);
      if (loaded === null) { saveStatus.value = source === null ? 'No save yet' : 'Invalid save'; return; }
      const before = terrainArtProject; terrainArtProject = loaded; lastSavedTerrainHash = hashTerrainArtProject(loaded); activeMaterialId = loaded.materials[0]!.id; stylePresetById.clear(); for (const material of loaded.materials) stylePresetById.set(material.id, 'meadow'); commitHistory(before); refreshArt(); updateMaterialChrome(); updateTerrainKindOptions(); updateStatus(); tilesetImport?.sync(); saveStatus.value = 'Reloaded saved terrain art';
    } catch { saveStatus.value = 'Load unavailable'; }
  };
  const onExportAtlas = (): void => {
    const atlas = generateTerrainArtMaterialAtlas(terrainArtProject, activeMaterialId, 'default', importResolver);
    const exportCanvas = document.createElement('canvas'); exportCanvas.width = atlas.width; exportCanvas.height = atlas.height;
    const exportContext = exportCanvas.getContext('2d')!; const exportImage = exportContext.createImageData(atlas.width, atlas.height); exportImage.data.set(atlas.pixels); exportContext.putImageData(exportImage, 0, 0);
    exportCanvas.toBlob((blob) => {
      if (blob === null) { saveStatus.value = 'Export unavailable'; return; }
      const link = document.createElement('a'); const url = URL.createObjectURL(blob);
      link.href = url; link.download = `${activeMaterialId}-dual-grid.png`; link.click(); URL.revokeObjectURL(url); saveStatus.value = 'PNG exported';
    }, 'image/png');
  };
  saveSourceButton.addEventListener('click', onSaveSource);
  loadSourceButton.addEventListener('click', onLoadSource);
  exportAtlasButton.addEventListener('click', onExportAtlas);

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

      if (kb['reset']?.pressed) { resetPlayer(true); levelNotice = 'Run reset'; }

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

      if (isTileRoomPlayerDead(runtime.scene.level, runtime.state.core)) {
        deathCount++; levelNotice = `Respawned after death ${deathCount}`; resetPlayer(true);
      } else {
        if (isTileRoomExitReached(runtime.scene.level, runtime.state.core)) { levelNotice = 'Exit reached · level complete'; deactivateGameplay(); return; }
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
      }

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
    deathCount = 0; levelNotice = ''; resetPlayer(true);
    playing = true;
    playOverlay.hidden = true;
    canvas.setAttribute('aria-label', 'Playable scrolling tile room. Press Escape to stop.');
    // Drain key edges gathered while the room was inactive before accepting
    // gameplay input.
    keyboard.poll();
    loop.start();
    updateChrome();
    canvas.focus({ preventScroll: true });
  };

  function deactivateGameplay(): void {
    if (!playing) return;
    playing = false;
    loop.stop();
    keyboard.poll();
    resetPlayer(false);
    playOverlay.hidden = false;
    canvas.setAttribute(
      'aria-label',
      'Paused scrolling tile room. Activate Play room to use keyboard controls.',
    );
    updateChrome();
    render();
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
    window.removeEventListener('keydown', onEditorShortcut);
    for (const { btn, handler } of sceneHandlers) btn.removeEventListener('click', handler);
    for (const { btn, handler } of treatmentHandlers) {
      btn.removeEventListener('click', handler);
    }
    markerBtn.removeEventListener('click', onMarkerToggle);
    dualOverlayBtn.removeEventListener('click', onDualOverlay);
    logicalOverlayBtn.removeEventListener('click', onLogicalOverlay);
    for (const { button, handler } of levelToolHandlers) button.removeEventListener('click', handler);
    canvas.removeEventListener('click', onCanvasInspect);
    canvas.removeEventListener('pointerdown', onLevelPointerDown);
    canvas.removeEventListener('pointermove', onLevelPointerMove);
    canvas.removeEventListener('pointerup', onLevelPointerUp);
    canvas.removeEventListener('pointercancel', onLevelPointerCancel);
    canvas.removeEventListener('pointerleave', onLevelPointerLeave);
    levelUndoButton.removeEventListener('click', onLevelUndo);
    levelRedoButton.removeEventListener('click', onLevelRedo);
    objectCloseButton.removeEventListener('click', onObjectClose);
    objectXInput.removeEventListener('change', onObjectPositionChange); objectYInput.removeEventListener('change', onObjectPositionChange);
    objectSpeedInput.removeEventListener('change', onObjectSpeedChange); objectLoopSelect.removeEventListener('change', onObjectLoopChange);
    objectAddWaypointButton.removeEventListener('click', onObjectAddWaypoint); objectRemoveWaypointButton.removeEventListener('click', onObjectRemoveWaypoint);
    objectExitLockedInput.removeEventListener('change', onObjectExitChange); objectExitTrapInput.removeEventListener('change', onObjectExitChange);
    objectPickupKindSelect.removeEventListener('change', onObjectPickupChange); objectPickupValueInput.removeEventListener('change', onObjectPickupChange); objectPickupPersistsInput.removeEventListener('change', onObjectPickupChange);
    objectDuplicateButton.removeEventListener('click', onObjectDuplicate); objectDeleteButton.removeEventListener('click', onObjectDelete);
    zoomOutButton.removeEventListener('click', onZoomOut);
    zoomInButton.removeEventListener('click', onZoomIn);
    fitButton.removeEventListener('click', onFit);
    overviewButton.removeEventListener('click', onOverviewToggle);
    levelNameInput.removeEventListener('change', onLevelNameChange);
    levelSaveButton.removeEventListener('click', onLevelSave);
    levelLoadButton.removeEventListener('click', onLevelLoad);
    levelResetButton.removeEventListener('click', onLevelReset);
    levelExportButton.removeEventListener('click', onLevelExport);
    levelImportButton.removeEventListener('click', onLevelImport);
    levelImportFile.removeEventListener('change', onLevelImportFile);
    artCanvas.removeEventListener('pointerdown', onArtPointerDown);
    artCanvas.removeEventListener('pointermove', onArtPointerMove);
    artCanvas.removeEventListener('pointerup', onArtPointerUp);
    artCanvas.removeEventListener('pointercancel', onArtPointerUp);
    artRevert.removeEventListener('click', onArtRevert);
    onionSkin.removeEventListener('change', onOnionSkin);
    artUndo.removeEventListener('click', onArtUndo);
    artRedo.removeEventListener('click', onArtRedo);
    for (const { button, handler } of transformHandlers) button.removeEventListener('click', handler);
    for (const { button, handler } of moveHandlers) button.removeEventListener('click', handler);
    stampButton.removeEventListener('click', onStamp);
    for (const input of generatorInputs) input.removeEventListener('input', updateGeneratorFromControls);
    generatorReset.removeEventListener('click', onGeneratorReset);
    materialReset.removeEventListener('click', onMaterialReset);
    materialSelect.removeEventListener('change', onMaterialChange);
    tilesetImport?.dispose();
    tilesetImport = null;
    materialNameInput.removeEventListener('focus', onMaterialNameFocus);
    materialNameInput.removeEventListener('input', onMaterialNameInput);
    materialNameInput.removeEventListener('blur', onMaterialNameBlur);
    presetSelect.removeEventListener('change', onPresetChange);
    addMaterialButton.removeEventListener('click', onAddMaterial);
    removeMaterialButton.removeEventListener('click', onRemoveMaterial);
    transitionBackground.removeEventListener('change', onTransitionChange);
    transitionMode.removeEventListener('change', onTransitionChange);
    resolutionSelect.removeEventListener('change', onResolutionChange);
    resolutionApply.removeEventListener('click', onResolutionApply);
    resolutionCancel.removeEventListener('click', onResolutionCancel);
    seedInput.removeEventListener('change', onSeedChange);
    rerollButton.removeEventListener('click', onReroll);
    variantSelect.removeEventListener('change', onVariantChange);
    addVariantButton.removeEventListener('click', onAddVariant);
    variantWeightInput.removeEventListener('change', onVariantWeight);
    pinVariantButton.removeEventListener('click', onPinVariant);
    localEditButton.removeEventListener('click', onLocalEdit);
    localRevertButton.removeEventListener('click', onLocalRevert);
    clearOverridesButton.removeEventListener('click', onClearOverrides);
    restoreAllButton.removeEventListener('click', onRestoreAll);
    saveSourceButton.removeEventListener('click', onSaveSource);
    loadSourceButton.removeEventListener('click', onLoadSource);
    exportAtlasButton.removeEventListener('click', onExportAtlas);
    for (const { button, handler } of artPanelHandlers) button.removeEventListener('click', handler);
    for (const input of generatorInputs) {
      input.removeEventListener('pointerdown', beginGeneratorGesture);
      input.removeEventListener('focus', beginGeneratorGesture);
      input.removeEventListener('change', endGeneratorGesture);
    }
    for (const { button, handler } of artToolHandlers) button.removeEventListener('click', handler);
  };
}
