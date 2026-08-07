/**
 * Section 7 — the LDtk-native level editor.
 *
 * Open a real `.ldtk` project, paint into its IntGrid, and watch the project's
 * own auto-layer rules re-skin the terrain live using its own tilesets. Save
 * writes the file back, so the same level reopens in LDtk desktop.
 *
 * The auto-tiling is not an approximation of LDtk's: `runLdtkAutoLayer`
 * reproduces LDtk's output exactly, verified tile-for-tile against every
 * bundled sample (`src/tests/ldtk-rules-oracle.test.ts`). Painting here and
 * painting in LDtk give the same picture.
 */

import { createGameLoop, type GameLoop } from '../../../src/game-loop';
import { resizeCanvasToBackingStore } from '../../../src/primitives';
import {
  addLdtkEntity,
  ldtkLevelToLevelData,
  moveLdtkEntity,
  paintLdtkIntGrid,
  removeLdtkEntity,
  type LdtkLayerInstance,
  type LdtkLevel,
  type LdtkProject,
} from '../../../src/ldtk';
import type { Store } from '../../store';
import type { GlobalState } from '../../main';
import {
  allLevels,
  findLevel,
  openBundledProject,
  openProjectFromDirectory,
  openProjectFromFiles,
  loadImageFromUrl,
  retileProject,
  saveProject,
  supportsDirectoryAccess,
  type LoadedLdtkProject,
} from './document';
import {
  clampViewport,
  fitViewport,
  screenToCell,
  screenToWorld,
  zoomAbout,
  zoomIn,
  zoomOut,
  type Viewport,
} from './viewport';
import { renderEditorScene, type EntityDrawEntry } from './render';
import { PREVIEW_TOOLS, toolCells, lineCells, type Cell, type LdtkToolId } from './tools';
import { createPlaySession, type PlaySession } from './play';
import {
  createMobOverlay,
  loadSpriteBundle,
  loadKnightBundle,
  ONE_BIT_PLATFORMER_SAMPLE,
  TWO_D_PLATFORMER_SAMPLE,
  type MobOverlay,
  type SpriteBundle,
} from './mob-sprites';
import {
  entityAtPoint,
  entityInstanceFromDef,
  levelEntityCount,
  nextEntityIid,
  paletteForLayer,
} from './entities';

// Bundled samples — globbed so every .ldtk under assets/ldtk/samples is
// offered. The `.ldtk` text is loaded lazily (some samples are hundreds of KB),
// while atlas image URLs are resolved eagerly (they are just URL strings; the
// image bytes themselves load on demand via `loadImageFromUrl`).
const sampleLoaders = import.meta.glob('../../../assets/ldtk/samples/*.ldtk', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;
const atlasModules = import.meta.glob('../../../assets/ldtk/samples/atlas/*.png', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * A bundled sample's metadata: enough to populate the dropdown and resolve its
 * tileset images, before the (large) `.ldtk` text is loaded on selection.
 */
interface BundledSample {
  readonly fileName: string;
  readonly label: string;
  /** Lazy loader for the raw `.ldtk` text. */
  readonly load: () => Promise<string>;
  /** Image URLs by lowercased basename. */
  readonly atlas: ReadonlyMap<string, string>;
}

/** Last path segment of a relative path. */
function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/**
 * Derive a short, human-friendly label from a sample file name.
 *
 * Strips the redundant `Typical_`/`AutoLayers_` prefixes the LDtk samples share
 * and tidies underscores, so the dropdown reads "2D platformer example" rather
 * than "Typical_2D_platformer_example".
 */
function sampleLabel(fileName: string): string {
  return fileName
    .replace(/^Typical_/, '')
    .replace(/^AutoLayers_/, 'Auto-layers ')
    .replace(/\.ldtk$/, '')
    .replace(/_/g, ' ');
}

/**
 * Build the sample registry from the globbed modules, in stable (name) order.
 *
 * Tileset references cannot be read from the (not-yet-loaded) text, so each
 * sample is matched against the *whole* atlas glob — every bundled atlas image
 * is offered to every sample, and the renderer skips any tileset whose image
 * does not load. That keeps the registry build synchronous and the dropdown
 * instant; the cost is one extra (skipped) image fetch per sample at most.
 */
function buildSampleRegistry(): readonly BundledSample[] {
  const atlasByBasename = new Map<string, string>();
  for (const [path, url] of Object.entries(atlasModules)) {
    atlasByBasename.set(basename(path).toLowerCase(), url);
  }

  return Object.entries(sampleLoaders)
    .map(([path, load]) => ({
      fileName: basename(path),
      label: sampleLabel(basename(path)),
      load,
      atlas: atlasByBasename,
    }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

const SAMPLES: readonly BundledSample[] = buildSampleRegistry();

const CANVAS_W = 900;
const CANVAS_H = 520;
/** Undo depth. Projects are structurally shared, so entries are cheap. */
const HISTORY_LIMIT = 60;

interface EditorState {
  loaded: LoadedLdtkProject | null;
  project: LdtkProject | null;
  levelIid: string;
  layerIid: string;
  value: number;
  tool: LdtkToolId;
  viewport: Viewport;
  showGrid: boolean;
  showIntGrid: boolean;
  dirty: boolean;
  /** Selected entity def uid in the palette (the entity to place). */
  entityDefUid: number | null;
  /** Currently selected entity instance, or `null` when none. */
  selectedEntityIid: string | null;
}

/**
 * Mount the LDtk editor.
 *
 * @param section - the `<section id="ldtk-editor">` element
 * @param _store - global store (unused; this section owns its own state)
 * @returns dispose callback
 */
export function initLdtkEditor(
  section: HTMLElement,
  _store: Store<GlobalState>,
): () => void {
  const canvasElement = section.querySelector<HTMLCanvasElement>('.ldtk-canvas');
  const statusElement = section.querySelector<HTMLElement>('.ldtk-status');
  if (canvasElement === null || statusElement === null) return () => undefined;
  const context = canvasElement.getContext('2d');
  if (context === null) {
    statusElement.textContent = 'Canvas 2D unavailable.';
    return () => undefined;
  }
  // Re-bound as non-null consts: TypeScript discards the narrowing above once
  // these are captured by the event handlers below.
  const canvas: HTMLCanvasElement = canvasElement;
  const status: HTMLElement = statusElement;

  const query = <T extends HTMLElement>(selector: string): T | null =>
    section.querySelector<T>(selector);

  const layerList = query<HTMLElement>('.ldtk-layers');
  const valueList = query<HTMLElement>('.ldtk-values');
  const entityPalette = query<HTMLElement>('.ldtk-entity-palette');
  const entityTitle = query<HTMLElement>('.ldtk-entity-title');
  const levelSelect = query<HTMLSelectElement>('.ldtk-level-select');
  const sampleSelect = query<HTMLSelectElement>('.ldtk-sample-select');
  const toolbar = query<HTMLElement>('.ldtk-tools');
  const zoomValue = query<HTMLElement>('.ldtk-zoom-value');
  const fileInput = query<HTMLInputElement>('.ldtk-file-input');

  // The canvas is sized to CSS dimensions × DPR, but `imageSmoothingEnabled =
  // false` and `image-rendering: pixelated` only stay crisp if the drawing
  // surface itself is not silently stretched. Composing the DPR into the
  // per-frame transform (see the `render` callback) keeps 1 logical pixel ==
  // 1 backing pixel on HiDPI displays; without it a Retina panel upscales the
  // whole scene before nearest-neighbour can help, which is what softens the
  // sprites. Re-read fresh on resize so a window dragged between displays (or a
  // browser zoom change) keeps its 1:1 mapping.
  let dpr = resizeCanvasToBackingStore(canvas, CANVAS_W, CANVAS_H);
  let resizeRaf = 0;
  const handleResize = () => {
    if (resizeRaf !== 0) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      dpr = resizeCanvasToBackingStore(canvas, CANVAS_W, CANVAS_H);
    });
  };
  window.addEventListener('resize', handleResize);

  const state: EditorState = {
    loaded: null,
    project: null,
    levelIid: '',
    layerIid: '',
    value: 1,
    tool: 'pencil',
    viewport: { x: 0, y: 0, scale: 1 },
    showGrid: true,
    showIntGrid: false,
    dirty: false,
    entityDefUid: null,
    selectedEntityIid: null,
  };

  const history: LdtkProject[] = [];
  const future: LdtkProject[] = [];
  let play: PlaySession | null = null;
  let mobOverlay: MobOverlay | null = null;
  /**
   * Shared sprite bundle for the 1-bit platformer sample. Loaded once alongside
   * the editor overlay and shared with the play session so the PNG is decoded a
   * single time. `null` once loaded-but-unavailable (failed decode); `undefined`
   * until the first load attempt resolves.
   */
  let spriteBundle: SpriteBundle | null | undefined = undefined;
  /**
   * The 0x72 knight bundle used as the PLAYER for the 1-bit platformer sample
   * (the Kenney `spriteBundle` above still serves the slime/walker mobs, since
   * the knight sheet defines no mob characters). Same tri-state as `spriteBundle`.
   */
  let knightBundle: SpriteBundle | null | undefined = undefined;

  // --- lookups ------------------------------------------------------------

  const currentLevel = (): LdtkLevel | undefined =>
    state.project === null ? undefined : findLevel(state.project, state.levelIid);

  const currentLayer = (): LdtkLayerInstance | undefined =>
    currentLevel()?.layerInstances?.find((l) => l.iid === state.layerIid);

  /**
   * Whether a layer can be painted into.
   *
   * Must test the layer *type*, not the presence of `intGridCsv`: LDtk writes
   * that field as `[]` on every layer including Entities and Tiles, so a
   * presence check marks the whole project paintable.
   */
  const isPaintable = (layer: LdtkLayerInstance | undefined): boolean =>
    layer !== undefined && layer.__type === 'IntGrid';

  const layerDefOf = (layer: LdtkLayerInstance | undefined) =>
    state.project === null || layer === undefined
      ? undefined
      : state.project.defs.layers.find((d) => d.uid === layer.layerDefUid);

  /** IntGrid value definitions for the selected layer, for the palette. */
  const valueDefs = () => layerDefOf(currentLayer())?.intGridValues ?? [];

  const colorOfValue = (value: number): string | undefined =>
    valueDefs().find((v) => v.value === value)?.color;

  /** Resolve a selected entity instance on the current layer, if any. */
  const selectedEntity = () => {
    const layer = currentLayer();
    const iid = state.selectedEntityIid;
    if (layer === undefined || iid === null) return undefined;
    return layer.entityInstances?.find((e) => e.iid === iid);
  };

  /** The entity defs the palette should show for the current layer. */
  const currentPalette = () =>
    state.project === null ? [] : paletteForLayer(state.project, currentLayer());

  /**
   * Whether the pointer can interact with entities on the current layer.
   *
   * The entity tool targets an `Entities` layer specifically; a click there
   * either selects an existing instance or places the armed def.
   */
  const isEntityLayer = (layer: LdtkLayerInstance | undefined): boolean =>
    layer !== undefined && layer.__type === 'Entities';

  /**
   * The entities to draw this frame, resolved against defs and tagged with the
   * current selection. `undefined` when there is nothing to draw.
   */
  const entityDrawEntries = (): readonly EntityDrawEntry[] | undefined => {
    const layer = currentLayer();
    if (!isEntityLayer(layer)) return undefined;
    const instances = layer?.entityInstances ?? [];
    if (instances.length === 0) return undefined;
    const defs = state.project?.defs.entities ?? [];
    const selected = state.selectedEntityIid;
    return instances.map((entity) => ({
      entity,
      def: defs.find((d) => d.uid === entity.defUid),
      selected: entity.iid === selected,
    }));
  };

  // --- history ------------------------------------------------------------

  function commit(next: LdtkProject): void {
    if (state.project !== null) {
      history.push(state.project);
      if (history.length > HISTORY_LIMIT) history.shift();
    }
    future.length = 0;
    state.project = next;
    state.dirty = true;
    refreshChrome();
  }

  function undo(): void {
    const previous = history.pop();
    if (previous === undefined || state.project === null) return;
    future.push(state.project);
    state.project = previous;
    state.dirty = true;
    refreshChrome();
  }

  function redo(): void {
    const next = future.pop();
    if (next === undefined || state.project === null) return;
    history.push(state.project);
    state.project = next;
    state.dirty = true;
    refreshChrome();
  }

  // --- painting -----------------------------------------------------------

  /**
   * Apply a set of cells to the active IntGrid layer and re-run auto-tiling.
   *
   * Both steps land in a single history entry: an undo should restore the level
   * as it looked, not leave the grid rolled back with the art still updated.
   */
  function applyCells(cells: readonly Cell[], value: number): void {
    const layer = currentLayer();
    if (state.project === null || layer === undefined) return;
    if (!isPaintable(layer)) {
      setStatus('Select an IntGrid layer to paint. Tile and entity layers are read-only here.');
      return;
    }
    const painted = paintLdtkIntGrid(
      state.project,
      state.levelIid,
      state.layerIid,
      cells.map((cell) => ({ ...cell, value })),
    );
    if (!painted.changed) return;
    commit(retileProject(painted.project, state.levelIid, layer.layerDefUid));
  }

  // --- entities ----------------------------------------------------------

  /**
   * Place the armed entity def at a cell on the active Entities layer.
   *
   * One history entry per placement. The instance is built from the def (size,
   * pivot, field defaults) and given a fresh iid; nothing about it is random.
   */
  function placeEntity(cell: Cell): void {
    const layer = currentLayer();
    if (state.project === null || layer === undefined) return;
    if (!isEntityLayer(layer) || state.entityDefUid === null) {
      setStatus('Select an Entities layer and an entity type to place.');
      return;
    }
    const def = state.project.defs.entities.find((d) => d.uid === state.entityDefUid);
    if (def === undefined) return;
    const iid = nextEntityIid(
      state.levelIid,
      levelEntityCount(currentLevel()?.layerInstances ?? null),
    );
    const instance = entityInstanceFromDef(def, cell, layer.__gridSize, iid);
    const added = addLdtkEntity(state.project, state.levelIid, state.layerIid, instance);
    if (!added.changed) return;
    state.selectedEntityIid = iid;
    commit(added.project);
  }

  /** Remove the currently selected entity. */
  function deleteSelectedEntity(): void {
    const layer = currentLayer();
    const iid = state.selectedEntityIid;
    if (state.project === null || layer === undefined || iid === null) return;
    const removed = removeLdtkEntity(state.project, state.levelIid, state.layerIid, iid);
    if (!removed.changed) return;
    state.selectedEntityIid = null;
    commit(removed.project);
  }

  /**
   * Move the selected entity to a pixel position during a drag.
   *
   * The drag is collapsed into one undo entry: the project at drag start is
   * captured the first time this is called and pushed to history once on
   * pointer-up, so a whole drag reverses with a single undo rather than one
   * step per pointer-move sample.
   */
  function moveSelectedEntity(x: number, y: number): void {
    const layer = currentLayer();
    const iid = state.selectedEntityIid;
    if (state.project === null || layer === undefined || iid === null) return;
    if (dragStartProject === null) dragStartProject = state.project;
    const moved = moveLdtkEntity(state.project, state.levelIid, state.layerIid, iid, x, y);
    if (!moved.changed) return;
    // Swap the project in place — no per-sample history entry.
    state.project = moved.project;
    state.dirty = true;
    refreshChrome();
  }

  /**
   * Finish an entity drag: push the drag-start project as a single undo entry.
   * Called once on pointer-up; a no-op when the drag never moved anything.
   */
  function endEntityDrag(): void {
    if (dragStartProject !== null && entityDragMoved && state.project !== null) {
      history.push(dragStartProject);
      if (history.length > HISTORY_LIMIT) history.shift();
      future.length = 0;
      state.dirty = true;
    }
    dragStartProject = null;
    draggingEntity = false;
    entityDragMoved = false;
  }

  // --- pointer ------------------------------------------------------------

  let gestureStart: Cell | null = null;
  let gesturePath: Cell[] = [];
  let previewCells: readonly Cell[] = [];
  let cursorCell: Cell | undefined;
  let panning: { x: number; y: number; vx: number; vy: number } | null = null;
  /** Whether a pointer-down began on the selected entity (a move gesture). */
  let draggingEntity = false;
  /** Whether the current drag has moved the entity (for undo collapse). */
  let entityDragMoved = false;
  /** Project snapshot at drag start, pushed to history once on pointer-up. */
  let dragStartProject: LdtkProject | null = null;
  /** Footprint of a pending placement, for the ghost preview. */
  let entityGhost: { x: number; y: number; width: number; height: number } | undefined;

  const canvasPoint = (event: PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_H,
    };
  };

  const cellAt = (event: PointerEvent): Cell => {
    const point = canvasPoint(event);
    const layer = currentLayer();
    return screenToCell(state.viewport, point.x, point.y, layer?.__gridSize ?? 16);
  };

  const gridInfo = () => {
    const layer = currentLayer();
    const csv = layer?.intGridCsv ?? [];
    const cols = layer?.__cWid ?? 0;
    return {
      cols,
      rows: layer?.__cHei ?? 0,
      valueAt: (cx: number, cy: number): number => csv[cx + cy * cols] ?? 0,
    };
  };

  function onPointerDown(event: PointerEvent): void {
    if (play !== null) return;
    // Capture keeps a drag alive when the pointer leaves the canvas, but it
    // throws for a pointer the browser does not consider active. Losing capture
    // is a far smaller problem than losing the whole gesture.
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Continue without capture.
    }
    const point = canvasPoint(event);

    // Middle button, or space-drag, pans. Panning must not be a tool, or there
    // is no way to reach a level larger than the viewport while a tool is armed.
    if (event.button === 1 || event.shiftKey) {
      panning = { x: point.x, y: point.y, vx: state.viewport.x, vy: state.viewport.y };
      return;
    }
    if (event.button !== 0) return;

    const cell = cellAt(event);
    gestureStart = cell;
    gesturePath = [cell];
    draggingEntity = false;
    entityDragMoved = false;

    if (state.tool === 'entity') {
      const layer = currentLayer();
      if (!isEntityLayer(layer)) {
        setStatus('Select an Entities layer to place entities.');
        gestureStart = null;
        return;
      }
      // Click on an existing instance selects and arms a move; click on empty
      // space places the armed def. A second click on the selection also starts
      // a move, so the author can drag either after placing or after selecting.
      const world = screenToWorld(state.viewport, point.x, point.y);
      const hit = entityAtPoint(layer, world.x, world.y);
      if (hit !== undefined) {
        state.selectedEntityIid = hit.iid;
        draggingEntity = true;
        refreshChrome();
      } else if (state.entityDefUid !== null) {
        placeEntity(cell);
        gestureStart = null;
      } else {
        state.selectedEntityIid = null;
        setStatus('Pick an entity type from the palette, then click to place.');
        refreshChrome();
      }
      return;
    }

    if (state.tool === 'picker') {
      const info = gridInfo();
      const picked = info.valueAt(cell.cx, cell.cy);
      if (picked > 0) {
        state.value = picked;
        refreshChrome();
      }
      gestureStart = null;
      return;
    }
    if (PREVIEW_TOOLS.has(state.tool)) {
      previewCells = [cell];
      return;
    }
    if (state.tool === 'fill') return;
    applyCells([cell], state.tool === 'eraser' ? 0 : state.value);
  }

  function onPointerMove(event: PointerEvent): void {
    if (play !== null) return;
    const point = canvasPoint(event);

    if (panning !== null) {
      state.viewport = clampViewport(
        {
          ...state.viewport,
          x: panning.vx - (point.x - panning.x) / state.viewport.scale,
          y: panning.vy - (point.y - panning.y) / state.viewport.scale,
        },
        contentSize(),
        { width: CANVAS_W, height: CANVAS_H },
      );
      return;
    }

    const cell = cellAt(event);
    cursorCell = cell;
    if (gestureStart === null) return;

    if (state.tool === 'entity') {
      // Dragging the selection moves it (collapsed to one undo entry on
      // pointer-up); otherwise the move tracks the pointer for a placement
      // preview ghost.
      if (draggingEntity) {
        const world = screenToWorld(state.viewport, point.x, point.y);
        const layer = currentLayer();
        const entity = selectedEntity();
        if (layer !== undefined && entity !== undefined) {
          // The pointer should track the entity's centre. `px` is the pivot
          // point, so to centre the entity under the pointer we place its
          // top-left at pointer − half size, then convert back to the pivot
          // position by adding the pivot's fraction of the size.
          const pivotX = entity.__pivot[0] ?? 0;
          const pivotY = entity.__pivot[1] ?? 0;
          const px = Math.round(world.x - entity.width / 2 + pivotX * entity.width);
          const py = Math.round(world.y - entity.height / 2 + pivotY * entity.height);
          moveSelectedEntity(px, py);
          entityDragMoved = true;
        }
      } else if (state.entityDefUid !== null) {
        const layer = currentLayer();
        const def = state.project?.defs.entities.find((d) => d.uid === state.entityDefUid);
        if (layer !== undefined && def !== undefined) {
          // Mirror the placement + draw math so the ghost lands exactly where
          // the entity will: build the instance, then back out the pivot to get
          // the rect's top-left (px is the pivot point, not the corner).
          const preview = entityInstanceFromDef(def, cell, layer.__gridSize, 'preview');
          const pivotX = preview.__pivot[0] ?? 0;
          const pivotY = preview.__pivot[1] ?? 0;
          entityGhost = {
            x: preview.px[0] - pivotX * preview.width,
            y: preview.px[1] - pivotY * preview.height,
            width: def.width,
            height: def.height,
          };
        }
      }
      return;
    }

    if (PREVIEW_TOOLS.has(state.tool)) {
      previewCells = toolCells(state.tool, gestureStart, cell, [], gridInfo());
      return;
    }
    if (state.tool === 'fill' || state.tool === 'picker') return;

    // Interpolate from the last sample: pointer events are far coarser than a
    // fast drag, and without this a quick stroke paints a dotted line.
    const last = gesturePath[gesturePath.length - 1];
    const segment = lineCells(last, cell);
    if (segment.length <= 1) return;
    gesturePath.push(cell);
    applyCells(segment.slice(1), state.tool === 'eraser' ? 0 : state.value);
  }

  function onPointerUp(event: PointerEvent): void {
    try {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Nothing to release.
    }
    panning = null;
    entityGhost = undefined;
    if (state.tool === 'entity') {
      endEntityDrag();
      gestureStart = null;
      return;
    }
    if (play !== null || gestureStart === null) {
      gestureStart = null;
      return;
    }
    const cell = cellAt(event);

    if (PREVIEW_TOOLS.has(state.tool)) {
      applyCells(toolCells(state.tool, gestureStart, cell, [], gridInfo()), state.value);
    } else if (state.tool === 'fill') {
      applyCells(toolCells('fill', gestureStart, cell, [], gridInfo()), state.value);
    }
    gestureStart = null;
    gesturePath = [];
    previewCells = [];
  }

  function onWheel(event: WheelEvent): void {
    // Bare wheel belongs to the page. Only a modified wheel zooms, so scrolling
    // past this section never fights the canvas for the gesture.
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * CANVAS_W;
    const y = ((event.clientY - rect.top) / rect.height) * CANVAS_H;
    const scale = event.deltaY < 0 ? zoomIn(state.viewport.scale) : zoomOut(state.viewport.scale);
    state.viewport = clampViewport(
      zoomAbout(state.viewport, scale, x, y),
      contentSize(),
      { width: CANVAS_W, height: CANVAS_H },
    );
    refreshChrome();
  }

  // --- chrome -------------------------------------------------------------

  function setStatus(text: string): void {
    status.textContent = text;
  }

  function contentSize(): { width: number; height: number } {
    const level = currentLevel();
    return { width: level?.pxWid ?? CANVAS_W, height: level?.pxHei ?? CANVAS_H };
  }

  function refreshChrome(): void {
    renderLayerList();
    renderValueList();
    renderEntityPalette();
    renderLevelList();
    renderToolbar();
    if (zoomValue !== null) {
      zoomValue.textContent = `${Math.round(state.viewport.scale * 100)}%`;
    }
  }

  function renderLayerList(): void {
    if (layerList === null) return;
    const level = currentLevel();
    layerList.textContent = '';
    // Presented top-first, matching both LDtk's own panel and the array order.
    for (const layer of level?.layerInstances ?? []) {
      const def = layerDefOf(layer);
      const rules = (def?.autoRuleGroups ?? []).reduce((n, g) => n + g.rules.length, 0);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ldtk-layer';
      button.setAttribute('aria-pressed', String(layer.iid === state.layerIid));
      button.dataset.paintable = String(isPaintable(layer));
      button.innerHTML =
        `<span class="ldtk-layer-name">${escapeHtml(layer.__identifier)}</span>`
        + `<span class="ldtk-layer-meta">${layer.__type}${rules > 0 ? ` · ${rules} rules` : ''}</span>`;
      button.addEventListener('click', () => {
        state.layerIid = layer.iid;
        refreshChrome();
      });
      layerList.append(button);
    }
  }

  function renderValueList(): void {
    if (valueList === null) return;
    valueList.textContent = '';
    const defs = valueDefs();
    if (defs.length === 0) {
      valueList.innerHTML = '<p class="ldtk-hint">This layer has no IntGrid values to paint.</p>';
      return;
    }
    for (const def of defs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ldtk-value';
      button.setAttribute('aria-pressed', String(def.value === state.value));
      button.style.setProperty('--swatch', def.color);
      button.innerHTML =
        `<span class="ldtk-swatch" aria-hidden="true"></span>`
        + `<span>${escapeHtml(def.identifier ?? `value ${def.value}`)}</span>`;
      button.addEventListener('click', () => {
        state.value = def.value;
        refreshChrome();
      });
      valueList.append(button);
    }
  }

  function renderEntityPalette(): void {
    if (entityPalette === null) return;
    entityPalette.textContent = '';
    const layer = currentLayer();
    const isEntity = isEntityLayer(layer);
    // Toggle the panel heading so the section does not advertise a dead palette
    // on a non-Entities layer.
    if (entityTitle !== null) entityTitle.hidden = !isEntity;
    if (!isEntity) {
      entityPalette.innerHTML = '<p class="ldtk-hint">Select an Entities layer to place entities.</p>';
      return;
    }
    const entries = currentPalette();
    if (entries.length === 0) {
      entityPalette.innerHTML = '<p class="ldtk-hint">This project defines no entity types. Add them in LDtk desktop.</p>';
      return;
    }
    for (const entry of entries) {
      const { def } = entry;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ldtk-entity';
      button.setAttribute('aria-pressed', String(def.uid === state.entityDefUid));
      button.style.setProperty('--swatch', def.color);
      button.innerHTML =
        `<span class="ldtk-swatch" aria-hidden="true"></span>`
        + `<span>${escapeHtml(def.identifier)}</span>`
        + `<span class="ldtk-entity-meta">${def.width}&times;${def.height}</span>`;
      button.addEventListener('click', () => {
        state.entityDefUid = def.uid;
        state.tool = 'entity';
        state.selectedEntityIid = null;
        refreshChrome();
      });
      entityPalette.append(button);
    }
  }

  function renderLevelList(): void {
    if (levelSelect === null || state.project === null) return;
    const levels = allLevels(state.project);
    if (levelSelect.options.length !== levels.length) {
      levelSelect.textContent = '';
      for (const level of levels) {
        const option = document.createElement('option');
        option.value = level.iid;
        option.textContent = level.identifier;
        levelSelect.append(option);
      }
    }
    levelSelect.value = state.levelIid;
  }

  function renderToolbar(): void {
    if (toolbar === null) return;
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      button.setAttribute('aria-pressed', String(button.dataset.tool === state.tool));
    }
  }

  // --- loading ------------------------------------------------------------

  /**
   * (Re)build the animated-mob overlay for the current level, if it is the
   * 1-bit platformer sample. The overlay parses the sprite sheet and decodes
   * its PNG asynchronously; a sample may have changed by the time it resolves,
   * so the resolved overlay is dropped unless it still matches `loaded.source`.
   * Failures (parse/decode) degrade to `null` — the editor keeps working, the
   * mobs just stay as static rects.
   */
  function reloadMobOverlay(): void {
    mobOverlay?.dispose();
    mobOverlay = null;
    spriteBundle = undefined;
    knightBundle = undefined;
    const loaded = state.loaded;
    const level = currentLevel();
    if (loaded === null || state.project === null || level === undefined) return;
    const source = loaded.source;
    // The Kenney 1-bit bundle (player + slime/walker mobs) serves the 1-bit
    // platformer sample; the 0x72 knight bundle is the player for the full-color
    // 2D platformer sample. Each loads only for the sample that needs it, and
    // the resolved bundle is dropped if the user has since switched samples.
    if (source === ONE_BIT_PLATFORMER_SAMPLE) {
      void loadSpriteBundle().then((bundle) => {
        if (state.loaded?.source !== source) return;
        spriteBundle = bundle;
      });
    } else if (source === TWO_D_PLATFORMER_SAMPLE) {
      void loadKnightBundle().then((bundle) => {
        if (state.loaded?.source !== source) return;
        knightBundle = bundle;
      });
    }
    void createMobOverlay({ level, project: state.project, source }).then((overlay) => {
      // Drop a late result if the user has since switched samples.
      if (state.loaded?.source !== source) {
        overlay?.dispose();
        return;
      }
      mobOverlay = overlay;
    });
  }

  function adopt(loaded: LoadedLdtkProject): void {
    state.loaded = loaded;
    state.project = loaded.document.project;
    state.dirty = false;
    history.length = 0;
    future.length = 0;

    const levels = allLevels(state.project);
    state.levelIid = levels[0]?.iid ?? '';
    const level = currentLevel();
    // Default to the first paintable layer — selecting an Entities layer first
    // would make the primary action silently do nothing.
    const paintable = level?.layerInstances?.find(isPaintable);
    state.layerIid = paintable?.iid ?? level?.layerInstances?.[0]?.iid ?? '';
    state.value = valueDefs()[0]?.value ?? 1;
    // Forget any entity selection/def from the previous project — its iids and
    // def uids do not carry over.
    state.selectedEntityIid = null;
    state.entityDefUid = null;

    state.viewport = fitViewport(contentSize(), { width: CANVAS_W, height: CANVAS_H });
    refreshChrome();

    const rules = state.project.defs.layers.reduce(
      (n, d) => n + (d.autoRuleGroups ?? []).reduce((m, g) => m + g.rules.length, 0),
      0,
    );
    setStatus(
      `${loaded.source} — ${levels.length} level${levels.length === 1 ? '' : 's'}, `
      + `${rules} auto-layer rules. Paint the IntGrid and the tiles follow.`,
    );

    reloadMobOverlay();
  }

  function report(result: LoadedLdtkProject | { readonly error: string }): void {
    if ('error' in result) {
      if (result.error !== '') setStatus(result.error);
      return;
    }
    adopt(result);
  }

  // --- play ---------------------------------------------------------------

  function togglePlay(): void {
    if (play !== null) {
      play.dispose();
      play = null;
      setStatus('Stopped. Back to editing.');
      section.dataset.mode = 'edit';
      return;
    }
    const level = currentLevel();
    if (level === null || level === undefined) return;
    if (state.project === null) return;
    const translated = ldtkLevelToLevelData(level, state.project);
    if (translated.level === undefined) {
      setStatus(
        `Cannot play: ${translated.diagnostics.map((d) => d.message).join('; ')}`,
      );
      return;
    }
    play = createPlaySession(translated.level, translated.tileSemantics, canvas, level, state.project, {
      onLevelChange: (name) => setStatus(`Playing: ${name}. Arrows to move, Space to jump, Esc to stop.`),
      // The player sprite bundle: the 0x72 knight for the 2D platformer sample,
      // the Kenney player for the 1-bit sample. Only one is loaded at a time
      // (whichever matches the open sample); whichever is present wins. The
      // bundle may still be loading on the first play press — the session falls
      // back to the rect renderer until it resolves.
      ...(() => {
        const player = knightBundle ?? spriteBundle;
        return player === undefined || player === null ? {} : { sprites: player };
      })(),
    });
    section.dataset.mode = 'play';
    setStatus(`Playing: ${level.identifier}. Arrows to move, Space to jump, Esc to stop.`);
  }

  // --- loop ---------------------------------------------------------------

  const loop: GameLoop = createGameLoop({
    fixedDt: 1 / 60,
    step: (dt) => {
      play?.step(dt);
      // The mob overlay is editor-only chrome, so it animates while editing and
      // is paused in play mode (play mode renders its own scene).
      if (play === null) mobOverlay?.step(dt);
    },
    render: () => {
      // Reset to a DPR-scaled identity so the 900×520 logical-space draws below
      // land 1:1 on the (larger) HiDPI backing store. Each scene re-applies its
      // own transform on top of this base via save()/scale()/translate().
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const level = currentLevel();
      if (state.loaded === null || level === undefined) {
        context.fillStyle = '#0b0e12';
        context.fillRect(0, 0, CANVAS_W, CANVAS_H);
        return;
      }
      if (play !== null) {
        // Render the room the player is actually in, not the editor's selected
        // level — the two diverge once the player crosses into a neighbour.
        play.render(context, CANVAS_W, CANVAS_H, play.activeLdtkLevel(), state.loaded.tilesets);
        return;
      }
      const layer = currentLayer();
      const entityEntries = entityDrawEntries();
      const skipEntityIids = mobOverlay?.animatedIids;
      renderEditorScene(context, {
        level,
        tilesets: state.loaded.tilesets,
        viewport: state.viewport,
        canvasWidth: CANVAS_W,
        canvasHeight: CANVAS_H,
        showGrid: state.showGrid,
        gridSize: layer?.__gridSize ?? 16,
        ...(state.showIntGrid && isPaintable(layer) && layer?.intGridCsv !== undefined
          ? {
              intGridOverlay: {
                csv: layer.intGridCsv,
                cols: layer.__cWid,
                rows: layer.__cHei,
                gridSize: layer.__gridSize,
                colorOf: colorOfValue,
              },
            }
          : {}),
        previewCells,
        ...(cursorCell === undefined ? {} : { cursorCell }),
        ...(entityEntries === undefined ? {} : { entities: entityEntries }),
        ...(skipEntityIids === undefined ? {} : { skipEntityIids }),
        ...(entityGhost === undefined ? {} : { entityGhost }),
      });
      // Animated mobs overlay on top of the scene (every layer), in world-pixel
      // space. The scene transform is still applied from `renderEditorScene`'s
      // save/restore, but that has already returned — re-apply it here so the
      // sprites land in level space at the right pan/zoom.
      if (mobOverlay !== null) {
        context.save();
        try {
          context.scale(state.viewport.scale, state.viewport.scale);
          context.translate(-state.viewport.x, -state.viewport.y);
          mobOverlay.draw(context);
        } finally {
          context.restore();
        }
      }
    },
  });

  // --- wiring -------------------------------------------------------------

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', () => {
    cursorCell = undefined;
    entityGhost = undefined;
  });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  toolbar?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-tool]');
    if (button?.dataset.tool === undefined) return;
    state.tool = button.dataset.tool as LdtkToolId;
    // Drop the entity selection when leaving the entity tool so the highlight
    // does not linger over an uninteractable layer.
    if (state.tool !== 'entity') state.selectedEntityIid = null;
    refreshChrome();
  });

  levelSelect?.addEventListener('change', () => {
    state.levelIid = levelSelect.value;
    const level = currentLevel();
    const paintable = level?.layerInstances?.find(isPaintable);
    state.layerIid = paintable?.iid ?? level?.layerInstances?.[0]?.iid ?? '';
    // An entity selection from another level is meaningless here.
    state.selectedEntityIid = null;
    state.viewport = fitViewport(contentSize(), { width: CANVAS_W, height: CANVAS_H });
    reloadMobOverlay();
    refreshChrome();
  });

  query<HTMLButtonElement>('.ldtk-open-folder')?.addEventListener('click', () => {
    setStatus('Choose the folder holding your .ldtk file and its tilesets…');
    void openProjectFromDirectory().then(report);
  });
  query<HTMLButtonElement>('.ldtk-open-files')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    if (files.length > 0) void openProjectFromFiles(files).then(report);
  });
  query<HTMLButtonElement>('.ldtk-save')?.addEventListener('click', () => {
    if (state.loaded === null || state.project === null) return;
    void saveProject(state.loaded, state.project).then((message) => {
      state.dirty = false;
      setStatus(message);
    });
  });
  query<HTMLButtonElement>('.ldtk-undo')?.addEventListener('click', undo);
  query<HTMLButtonElement>('.ldtk-redo')?.addEventListener('click', redo);
  query<HTMLButtonElement>('.ldtk-zoom-in')?.addEventListener('click', () => {
    state.viewport = zoomAbout(state.viewport, zoomIn(state.viewport.scale), CANVAS_W / 2, CANVAS_H / 2);
    refreshChrome();
  });
  query<HTMLButtonElement>('.ldtk-zoom-out')?.addEventListener('click', () => {
    state.viewport = zoomAbout(state.viewport, zoomOut(state.viewport.scale), CANVAS_W / 2, CANVAS_H / 2);
    refreshChrome();
  });
  query<HTMLButtonElement>('.ldtk-fit')?.addEventListener('click', () => {
    state.viewport = fitViewport(contentSize(), { width: CANVAS_W, height: CANVAS_H });
    refreshChrome();
  });
  query<HTMLButtonElement>('.ldtk-toggle-grid')?.addEventListener('click', (event) => {
    state.showGrid = !state.showGrid;
    (event.currentTarget as HTMLElement).setAttribute('aria-pressed', String(state.showGrid));
  });
  query<HTMLButtonElement>('.ldtk-toggle-intgrid')?.addEventListener('click', (event) => {
    state.showIntGrid = !state.showIntGrid;
    (event.currentTarget as HTMLElement).setAttribute('aria-pressed', String(state.showIntGrid));
  });
  query<HTMLButtonElement>('.ldtk-play')?.addEventListener('click', togglePlay);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!section.contains(document.activeElement) && document.activeElement !== document.body) return;
    if (event.key === 'Escape' && play !== null) {
      togglePlay();
      return;
    }
    if (play !== null) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    // Delete the selected entity. Guarded to the entity tool so the editor's
    // other tools keep their current behaviour, and to non-text inputs so a
    // field editor (future work) is not starved of Backspace.
    if (
      state.tool === 'entity'
      && state.selectedEntityIid !== null
      && (event.key === 'Delete' || event.key === 'Backspace')
      && !isTextTarget(event.target)
    ) {
      event.preventDefault();
      deleteSelectedEntity();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  if (!supportsDirectoryAccess()) {
    const folderButton = query<HTMLButtonElement>('.ldtk-open-folder');
    if (folderButton !== null) {
      folderButton.disabled = true;
      folderButton.title = 'This browser has no File System Access API. Use "Open files" instead.';
    }
  }

  /**
   * Populate the sample dropdown from the globbed registry. Each entry's value
   * is the sample's file name, so the change handler can look it up directly.
   */
  function populateSampleSelect(): void {
    if (sampleSelect === null) return;
    const options = SAMPLES.map((s) => {
      const option = document.createElement('option');
      option.value = s.fileName;
      option.textContent = s.label;
      return option;
    });
    if (options.length === 0) return;
    sampleSelect.textContent = '';
    sampleSelect.append(...options);
  }

  /**
   * Load a bundled sample by file name. The `.ldtk` text is fetched lazily;
   * then only the tileset images the project actually references are loaded,
   * matched against the globbed atlas by basename. Defaults to the platformer
   * sample when the name is unknown.
   */
  async function loadBundledSample(fileName: string): Promise<void> {
    const sample = SAMPLES.find((s) => s.fileName === fileName)
      ?? SAMPLES.find((s) => s.fileName === 'Typical_2D_platformer_example.ldtk');
    if (sample === undefined) {
      setStatus('No bundled samples found. Open a .ldtk file to begin.');
      return;
    }
    const text = await sample.load();
    // Which tilesets does this project reference? Pull every "relPath": "…png"
    // out of the raw text and match against the bundled atlas.
    const referenced = new Set<string>();
    const relPathRe = /"relPath":\s*"([^"]+)"/g;
    for (let m = relPathRe.exec(text); m !== null; m = relPathRe.exec(text)) {
      referenced.add(basename(m[1]).toLowerCase());
    }
    const images = new Map<string, CanvasImageSource>();
    await Promise.all(
      [...referenced].map(async (name) => {
        const url = sample.atlas.get(name);
        if (url === undefined) return;
        try {
          images.set(name, await loadImageFromUrl(url));
        } catch {
          // A missing image just leaves its tileset undrawn; the editor still
          // loads so the level structure is visible.
        }
      }),
    );
    report(openBundledProject(text, images, sample.fileName));
  }

  populateSampleSelect();
  sampleSelect?.addEventListener('change', () => {
    setStatus(`Loading ${sampleSelect.value}…`);
    void loadBundledSample(sampleSelect.value);
  });

  // Bundled sample so the section is live with no interaction. The platformer
  // sample is the default — its auto-tiling is the section's headline.
  if (sampleSelect !== null) sampleSelect.value = 'Typical_2D_platformer_example.ldtk';
  void loadBundledSample('Typical_2D_platformer_example.ldtk').catch((error: Error) => {
    setStatus(
      `Could not load the bundled sample (${error.message}). Open a .ldtk file to begin.`,
    );
  });

  loop.start();

  return () => {
    loop.stop();
    play?.dispose();
    mobOverlay?.dispose();
    window.removeEventListener('keydown', onKeyDown);
    if (resizeRaf !== 0) cancelAnimationFrame(resizeRaf);
    window.removeEventListener('resize', handleResize);
  };
}

/** Escape text destined for `innerHTML`. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

/** Whether a key event originated in a text-editing element. */
function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}
