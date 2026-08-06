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
  ldtkLevelToLevelData,
  paintLdtkIntGrid,
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
  zoomAbout,
  zoomIn,
  zoomOut,
  type Viewport,
} from './viewport';
import { renderEditorScene } from './render';
import { PREVIEW_TOOLS, toolCells, lineCells, type Cell, type LdtkToolId } from './tools';
import { createPlaySession, type PlaySession } from './play';

// Bundled sample — the demo works with no file access at all.
import sampleText from '../../../assets/ldtk/samples/Typical_2D_platformer_example.ldtk?raw';
import sunnyLandUrl from '../../../assets/ldtk/samples/atlas/SunnyLand_by_Ansimuz-extended.png';

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
  const levelSelect = query<HTMLSelectElement>('.ldtk-level-select');
  const toolbar = query<HTMLElement>('.ldtk-tools');
  const zoomValue = query<HTMLElement>('.ldtk-zoom-value');
  const fileInput = query<HTMLInputElement>('.ldtk-file-input');

  resizeCanvasToBackingStore(canvas, CANVAS_W, CANVAS_H);

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
  };

  const history: LdtkProject[] = [];
  const future: LdtkProject[] = [];
  let play: PlaySession | null = null;

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

  // --- pointer ------------------------------------------------------------

  let gestureStart: Cell | null = null;
  let gesturePath: Cell[] = [];
  let previewCells: readonly Cell[] = [];
  let cursorCell: Cell | undefined;
  let panning: { x: number; y: number; vx: number; vy: number } | null = null;

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
    const translated = ldtkLevelToLevelData(level);
    if (translated.level === undefined) {
      setStatus(
        `Cannot play: ${translated.diagnostics.map((d) => d.message).join('; ')}`,
      );
      return;
    }
    play = createPlaySession(translated.level, translated.tileSemantics, canvas, level);
    section.dataset.mode = 'play';
    setStatus('Playing. Arrows to move, Space to jump, Esc to stop.');
  }

  // --- loop ---------------------------------------------------------------

  const loop: GameLoop = createGameLoop({
    fixedDt: 1 / 60,
    step: (dt) => play?.step(dt),
    render: () => {
      const level = currentLevel();
      if (state.loaded === null || level === undefined) {
        context.fillStyle = '#0b0e12';
        context.fillRect(0, 0, CANVAS_W, CANVAS_H);
        return;
      }
      if (play !== null) {
        play.render(context, CANVAS_W, CANVAS_H, level, state.loaded.tilesets);
        return;
      }
      const layer = currentLayer();
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
      });
    },
  });

  // --- wiring -------------------------------------------------------------

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', () => { cursorCell = undefined; });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  toolbar?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-tool]');
    if (button?.dataset.tool === undefined) return;
    state.tool = button.dataset.tool as LdtkToolId;
    refreshChrome();
  });

  levelSelect?.addEventListener('change', () => {
    state.levelIid = levelSelect.value;
    const level = currentLevel();
    const paintable = level?.layerInstances?.find(isPaintable);
    state.layerIid = paintable?.iid ?? level?.layerInstances?.[0]?.iid ?? '';
    state.viewport = fitViewport(contentSize(), { width: CANVAS_W, height: CANVAS_H });
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

  // Bundled sample so the section is live with no interaction.
  void (async (): Promise<void> => {
    try {
      const images = new Map<string, CanvasImageSource>([
        ['sunnyland_by_ansimuz-extended.png', await loadImageFromUrl(sunnyLandUrl)],
      ]);
      report(openBundledProject(sampleText, images, 'Typical_2D_platformer_example.ldtk'));
    } catch (error) {
      setStatus(
        `Could not load the bundled sample (${(error as Error).message}). `
        + 'Open a .ldtk file to begin.',
      );
    }
  })();

  loop.start();

  return () => {
    loop.stop();
    play?.dispose();
    window.removeEventListener('keydown', onKeyDown);
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
