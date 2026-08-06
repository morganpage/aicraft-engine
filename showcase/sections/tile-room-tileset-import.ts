/**
 * Tileset import panel for the tile room's terrain style editor.
 *
 * Kept out of `tile-room.ts` deliberately. That file is already a single large
 * closure holding every control in the section, which is what makes its UI
 * impossible to make modal; adding a tenth concern to it would make that worse.
 * This owns its own DOM, its own state, and exposes only what the room needs:
 * a resolver to render with, and a sync call when the active material changes.
 *
 * The split between what persists and what does not is the important part. The
 * project stores an `assetId` plus the slicing — tile size, margin, spacing and
 * the nine role positions — and never the image. That mirrors LDtk storing a
 * path to a tileset rather than the tileset, and it keeps saved projects small
 * and diffable. The pixels are supplied separately at render time, here from a
 * record this module owns, mirrored into `localStorage` so a reload still draws.
 */

import {
  createImportedTerrainArtMaterial,
  createRuleTerrainArtMaterial,
  createTerrainArtTilesetBinding,
  createTerrainArtTilesetResolver,
  importTerrainArtTilesetAtlas,
  kenneyPixelPlatformerRoles,
  kenneyPixelPlatformerRules,
  resetTerrainArtMaterial,
  TERRAIN_TILESET_ROLE_KEYS,
  type TerrainArtImportedAssetResolver,
  type TerrainArtProject,
  type TerrainArtRuleSet,
  type TerrainArtTilesetImage,
  type TerrainTilesetRoleMap,
  type TerrainTilesetTileRef,
} from '../../src/terrain-art';
import kenneyTilesetUrl from '../../assets/vendor/kenney-pixel-platformer/Tilemap/tilemap_packed.png';

type RoleKey = (typeof TERRAIN_TILESET_ROLE_KEYS)[number];

/** Reading order of a 3×3 wall block, so the role list mirrors the artwork. */
const ROLE_ORDER: readonly RoleKey[] = [
  'topLeft', 'top', 'topRight',
  'left', 'fill', 'right',
  'bottomLeft', 'bottom', 'bottomRight',
];

const ROLE_LABEL: Readonly<Record<RoleKey, string>> = {
  topLeft: '↖ Top-left', top: '↑ Top', topRight: '↗ Top-right',
  left: '← Left', fill: '■ Fill', right: '→ Right',
  bottomLeft: '↙ Bottom-left', bottom: '↓ Bottom', bottomRight: '↘ Bottom-right',
};

const STORAGE_KEY = 'tile-room-tileset-images';
const KENNEY_ASSET_ID = 'kenney-pixel-platformer';

/** What the panel needs from the room to read and update shared state. */
export interface TileRoomTilesetImportHost {
  getProject(): TerrainArtProject;
  /** Replace the project, committing `before` to the art history and redrawing. */
  applyProject(next: TerrainArtProject, before: TerrainArtProject): void;
  getActiveMaterialId(): string;
}

export interface TileRoomTilesetImport {
  /** Pass to every atlas/tile render so `imported` layers resolve to pixels. */
  readonly resolver: TerrainArtImportedAssetResolver;
  /** Re-read the active material and reflect its binding in the panel. */
  sync(): void;
  dispose(): void;
}

interface LoadedSheet {
  readonly assetId: string;
  readonly label: string;
  readonly image: TerrainArtTilesetImage;
}

function readStoredImages(): Record<string, { dataUrl: string; label: string }> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, { dataUrl: string; label: string }> : {};
  } catch {
    return {};
  }
}

function decode(dataUrl: string): Promise<{ image: TerrainArtTilesetImage; element: HTMLImageElement } | null> {
  return new Promise((resolve) => {
    const element = new Image();
    element.addEventListener('load', () => {
      const canvas = document.createElement('canvas');
      canvas.width = element.naturalWidth;
      canvas.height = element.naturalHeight;
      const context = canvas.getContext('2d');
      if (context === null || canvas.width === 0 || canvas.height === 0) { resolve(null); return; }
      context.drawImage(element, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height);
      resolve({
        image: { pixels: new Uint8ClampedArray(data.data), width: canvas.width, height: canvas.height },
        element,
      });
    });
    element.addEventListener('error', () => resolve(null));
    element.src = dataUrl;
  });
}

export function createTileRoomTilesetImport(
  container: HTMLElement,
  host: Readonly<TileRoomTilesetImportHost>,
): TileRoomTilesetImport {
  // Imported images, keyed by asset id. The resolver reads this record; it
  // captures the object by reference and looks up per request, so mutating it
  // in place is enough to expose new images to the render path. Persisted to
  // localStorage so a reload still draws.
  const images: Record<string, TerrainArtTilesetImage> = {};
  const elements = new Map<string, HTMLImageElement>();
  const resolver = createTerrainArtTilesetResolver(images);

  const panel = container.querySelector<HTMLElement>('[data-art-panel-content="import"]')!;
  const fileInput = panel.querySelector<HTMLInputElement>('.tile-art-import-file')!;
  const kenneyButton = panel.querySelector<HTMLButtonElement>('.tile-art-import-kenney')!;
  const sheetStatus = panel.querySelector<HTMLOutputElement>('.tile-art-import-sheet-status')!;
  const tileSizeInput = panel.querySelector<HTMLInputElement>('.tile-art-import-tile-size')!;
  const marginInput = panel.querySelector<HTMLInputElement>('.tile-art-import-margin')!;
  const spacingInput = panel.querySelector<HTMLInputElement>('.tile-art-import-spacing')!;
  const roleBar = panel.querySelector<HTMLElement>('.tile-art-import-roles')!;
  const presetButton = panel.querySelector<HTMLButtonElement>('.tile-art-import-preset')!;
  const sheetCanvas = panel.querySelector<HTMLCanvasElement>('.tile-art-import-sheet')!;
  const previewCanvas = panel.querySelector<HTMLCanvasElement>('.tile-art-import-preview')!;
  const statusOutput = panel.querySelector<HTMLOutputElement>('.tile-art-import-status')!;
  const applyButton = panel.querySelector<HTMLButtonElement>('.tile-art-import-apply')!;
  const clearButton = panel.querySelector<HTMLButtonElement>('.tile-art-import-clear')!;

  let sheet: LoadedSheet | null = null;
  let roles: Partial<Record<RoleKey, TerrainTilesetTileRef>> = {};
  /** Auto-tiling rules for the loaded sheet, when one is known (e.g. Kenney).
   *  When present, Apply builds a whole-tile 'rule' material; otherwise it falls
   *  back to the quarter-tile 'imported' path. `null` = no rules (plain import). */
  let ruleSet: TerrainArtRuleSet | null = null;
  let activeRole: RoleKey = ROLE_ORDER[0]!;
  let disposed = false;

  const tileSize = (): number => Math.max(2, Math.trunc(Number(tileSizeInput.value) || 0));
  const margin = (): number => Math.max(0, Math.trunc(Number(marginInput.value) || 0));
  const spacing = (): number => Math.max(0, Math.trunc(Number(spacingInput.value) || 0));

  const gridSize = (): { cols: number; rows: number } => {
    if (sheet === null) return { cols: 0, rows: 0 };
    const stride = tileSize() + spacing();
    return {
      cols: Math.max(0, Math.floor((sheet.image.width - margin() + spacing()) / stride)),
      rows: Math.max(0, Math.floor((sheet.image.height - margin() + spacing()) / stride)),
    };
  };

  const completeRoles = (): TerrainTilesetRoleMap | null =>
    ROLE_ORDER.every((key) => roles[key] !== undefined) ? roles as TerrainTilesetRoleMap : null;

  const roleButtons = new Map<RoleKey, HTMLButtonElement>();
  for (const key of ROLE_ORDER) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tile-art-import-role';
    button.dataset.role = key;
    button.addEventListener('click', () => { activeRole = key; refresh(); });
    roleButtons.set(key, button);
    roleBar.append(button);
  }

  /** Draw the sheet at an integer zoom with the tile grid and role tags on top. */
  function drawSheet(): void {
    const context = sheetCanvas.getContext('2d');
    if (context === null) return;
    if (sheet === null) {
      sheetCanvas.width = 360; sheetCanvas.height = 120;
      context.clearRect(0, 0, sheetCanvas.width, sheetCanvas.height);
      return;
    }
    const zoom = Math.max(1, Math.min(6, Math.floor(720 / Math.max(1, sheet.image.width))));
    sheetCanvas.width = sheet.image.width * zoom;
    sheetCanvas.height = sheet.image.height * zoom;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, sheetCanvas.width, sheetCanvas.height);
    const element = elements.get(sheet.assetId);
    if (element !== undefined) context.drawImage(element, 0, 0, sheetCanvas.width, sheetCanvas.height);

    const { cols, rows } = gridSize();
    const stride = tileSize() + spacing();
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(255,255,255,.18)';
    for (let col = 0; col <= cols; col++) {
      const x = (margin() + col * stride) * zoom + .5;
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, sheetCanvas.height); context.stroke();
    }
    for (let row = 0; row <= rows; row++) {
      const y = (margin() + row * stride) * zoom + .5;
      context.beginPath(); context.moveTo(0, y); context.lineTo(sheetCanvas.width, y); context.stroke();
    }

    context.font = `${Math.max(9, 4 * zoom)}px system-ui, sans-serif`;
    context.textBaseline = 'top';
    for (const key of ROLE_ORDER) {
      const ref = roles[key];
      if (ref === undefined) continue;
      const x = (margin() + ref.col * stride) * zoom;
      const y = (margin() + ref.row * stride) * zoom;
      const size = tileSize() * zoom;
      const current = key === activeRole;
      context.strokeStyle = current ? '#f4d35e' : '#59d0ff';
      context.lineWidth = current ? 3 : 2;
      context.strokeRect(x + 1, y + 1, size - 2, size - 2);
      context.fillStyle = current ? '#f4d35e' : '#59d0ff';
      context.fillText(ROLE_LABEL[key].slice(0, 2), x + 3, y + 3);
    }
  }

  function drawPreview(): void {
    const context = previewCanvas.getContext('2d');
    const map = completeRoles();
    if (context === null) return;
    if (sheet === null || map === null) {
      previewCanvas.width = 72; previewCanvas.height = 72;
      context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      return;
    }
    const atlas = importTerrainArtTilesetAtlas(
      { pixels: sheet.image.pixels, width: sheet.image.width, height: sheet.image.height, tileSize: tileSize(), margin: margin(), spacing: spacing() },
      map,
      { materialId: host.getActiveMaterialId() },
    );
    if (atlas.tileSize === 0) {
      previewCanvas.width = 72; previewCanvas.height = 72;
      context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      return;
    }
    const zoom = Math.max(1, Math.min(6, Math.floor(240 / atlas.width)));
    const buffer = document.createElement('canvas');
    buffer.width = atlas.width; buffer.height = atlas.height;
    const bufferContext = buffer.getContext('2d');
    if (bufferContext === null) return;
    const data = bufferContext.createImageData(atlas.width, atlas.height);
    data.data.set(atlas.pixels);
    bufferContext.putImageData(data, 0, 0);
    previewCanvas.width = atlas.width * zoom;
    previewCanvas.height = atlas.height * zoom;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    context.drawImage(buffer, 0, 0, previewCanvas.width, previewCanvas.height);
  }

  function refresh(): void {
    if (disposed) return;
    for (const key of ROLE_ORDER) {
      const button = roleButtons.get(key)!;
      const ref = roles[key];
      button.textContent = ref === undefined ? ROLE_LABEL[key] : `${ROLE_LABEL[key]} · ${ref.col},${ref.row}`;
      button.setAttribute('aria-pressed', String(key === activeRole));
      button.classList.toggle('is-assigned', ref !== undefined);
    }
    sheetStatus.textContent = sheet === null
      ? 'No tileset loaded.'
      : `${sheet.label} · ${sheet.image.width}×${sheet.image.height} · ${gridSize().cols}×${gridSize().rows} tiles`;

    const assigned = ROLE_ORDER.filter((key) => roles[key] !== undefined).length;
    const map = completeRoles();
    applyButton.disabled = sheet === null || map === null;
    statusOutput.textContent = sheet === null
      ? 'Load a tileset to begin.'
      : map === null
        ? `${assigned} of 9 roles assigned. Next: ${ROLE_LABEL[activeRole]}.`
        : `Ready — 16 shapes assembled at ${tileSize()}px.`;

    const material = host.getProject().materials.find((entry) => entry.id === host.getActiveMaterialId());
    clearButton.hidden = !material?.layers.some((layer) => layer.type === 'imported');

    drawSheet();
    drawPreview();
  }

  /** Advance to the next role with nothing assigned, so a full pass is one click each. */
  function advanceRole(): void {
    const next = ROLE_ORDER.find((key) => roles[key] === undefined);
    if (next !== undefined) activeRole = next;
  }

  async function adoptSheet(assetId: string, label: string, dataUrl: string, persist: boolean): Promise<void> {
    const decoded = await decode(dataUrl);
    if (decoded === null || disposed) { sheetStatus.textContent = 'That file could not be read as an image.'; return; }
    images[assetId] = decoded.image;
    elements.set(assetId, decoded.element);
    sheet = { assetId, label, image: decoded.image };
    if (persist) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStoredImages(), [assetId]: { dataUrl, label } }));
      } catch { /* Quota is optional here; the sheet still works this session. */ }
    }
    refresh();
  }

  const onFile = (): void => {
    const file = fileInput.files?.[0];
    if (file === undefined) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const result = reader.result;
      if (typeof result !== 'string') return;
      ruleSet = null; // arbitrary upload has no known auto-tiling rule set
      void adoptSheet(`upload:${file.name}`, file.name, result, true);
    });
    reader.readAsDataURL(file);
  };
  fileInput.addEventListener('change', onFile);

  const onKenney = (): void => {
    kenneyButton.disabled = true;
    void (async () => {
      try {
        const response = await fetch(kenneyTilesetUrl);
        const blob = await response.blob();
        const reader = new FileReader();
        reader.addEventListener('load', () => {
          if (typeof reader.result === 'string') {
            tileSizeInput.value = '18'; marginInput.value = '0'; spacingInput.value = '0';
            roles = { ...kenneyPixelPlatformerRoles(0) };
            ruleSet = kenneyPixelPlatformerRules(0);
            activeRole = ROLE_ORDER[0]!;
            void adoptSheet(KENNEY_ASSET_ID, 'Kenney Pixel Platformer (CC0)', reader.result, true);
          }
        });
        reader.readAsDataURL(blob);
      } catch {
        sheetStatus.textContent = 'The bundled tileset could not be loaded.';
      } finally {
        if (!disposed) kenneyButton.disabled = false;
      }
    })();
  };
  kenneyButton.addEventListener('click', onKenney);

  const onPreset = (): void => {
    tileSizeInput.value = '18'; marginInput.value = '0'; spacingInput.value = '0';
    roles = { ...kenneyPixelPlatformerRoles(0) };
    ruleSet = kenneyPixelPlatformerRules(0);
    refresh();
  };
  presetButton.addEventListener('click', onPreset);

  const onGridChange = (): void => { refresh(); };
  tileSizeInput.addEventListener('change', onGridChange);
  marginInput.addEventListener('change', onGridChange);
  spacingInput.addEventListener('change', onGridChange);

  const onSheetClick = (event: MouseEvent): void => {
    if (sheet === null) return;
    const rect = sheetCanvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const zoom = sheetCanvas.width / sheet.image.width;
    const x = (event.clientX - rect.left) * (sheetCanvas.width / rect.width) / zoom;
    const y = (event.clientY - rect.top) * (sheetCanvas.height / rect.height) / zoom;
    const stride = tileSize() + spacing();
    const col = Math.floor((x - margin()) / stride);
    const row = Math.floor((y - margin()) / stride);
    const { cols, rows } = gridSize();
    if (col < 0 || row < 0 || col >= cols || row >= rows) return;
    roles = { ...roles, [activeRole]: { col, row } };
    advanceRole();
    refresh();
  };
  sheetCanvas.addEventListener('click', onSheetClick);

  const onApply = (): void => {
    const map = completeRoles();
    if (sheet === null || map === null) return;
    const before = host.getProject();
    const materialId = host.getActiveMaterialId();
    const existing = before.materials.find((entry) => entry.id === materialId);
    if (existing === undefined) return;
    // The material pins its resolution to the tileset's native tile size, so the
    // atlas is assembled 1:1 from the source pixels. Pixel art must never be
    // resampled. When an auto-tiling rule set is known (e.g. the bundled Kenney
    // pack), build a whole-tile 'rule' material — the rule engine paints one
    // complete source tile per matched cell, which is what conventional whole-
    // unit tilesets are authored for. Otherwise fall back to the quarter-tile
    // 'imported' path.
    const binding = createTerrainArtTilesetBinding(tileSize(), map, margin(), spacing());
    const material = ruleSet === null
      ? createImportedTerrainArtMaterial(existing.id, existing.name, tileSize(), sheet.assetId, binding)
      : createRuleTerrainArtMaterial(existing.id, existing.name, tileSize(), sheet.assetId, binding, ruleSet);
    host.applyProject({
      ...before,
      materials: before.materials.map((entry) => entry.id !== materialId
        ? entry
        : { ...material, enabled: existing.enabled, priority: existing.priority }),
    }, before);
    refresh();
  };
  applyButton.addEventListener('click', onApply);

  const onClear = (): void => {
    const before = host.getProject();
    host.applyProject(resetTerrainArtMaterial(before, host.getActiveMaterialId(), 'meadow'), before);
    refresh();
  };
  clearButton.addEventListener('click', onClear);

  // Rehydrate anything a previous session stored, so a saved project that names
  // an imported asset still draws after a reload.
  void (async () => {
    const stored = readStoredImages();
    for (const [assetId, entry] of Object.entries(stored)) {
      if (typeof entry?.dataUrl !== 'string') continue;
      const decoded = await decode(entry.dataUrl);
      if (decoded === null || disposed) continue;
      images[assetId] = decoded.image;
      elements.set(assetId, decoded.element);
    }
    if (!disposed) { sync(); }
  })();

  /** Reflect the active material's stored binding, so switching styles is lossless. */
  function sync(): void {
    if (disposed) return;
    const material = host.getProject().materials.find((entry) => entry.id === host.getActiveMaterialId());
    const layer = material?.layers.find((entry) => entry.type === 'imported' || entry.type === 'rule');
    if (layer?.tileset !== undefined && layer.assetId !== undefined) {
      tileSizeInput.value = String(layer.tileset.tileSize);
      marginInput.value = String(layer.tileset.margin ?? 0);
      spacingInput.value = String(layer.tileset.spacing ?? 0);
      roles = { ...layer.tileset.roles };
      // Restore the rule set if this is a rule layer (so re-Apply keeps the
      // whole-tile path); clear it for plain imported layers.
      ruleSet = layer.type === 'rule' ? layer.rules ?? null : null;
      const image = images[layer.assetId];
      sheet = image === undefined
        ? null
        : { assetId: layer.assetId, label: layer.assetId.replace(/^upload:/, ''), image };
    }
    refresh();
  }

  refresh();

  return {
    resolver,
    sync,
    dispose() {
      disposed = true;
      fileInput.removeEventListener('change', onFile);
      kenneyButton.removeEventListener('click', onKenney);
      presetButton.removeEventListener('click', onPreset);
      tileSizeInput.removeEventListener('change', onGridChange);
      marginInput.removeEventListener('change', onGridChange);
      spacingInput.removeEventListener('change', onGridChange);
      sheetCanvas.removeEventListener('click', onSheetClick);
      applyButton.removeEventListener('click', onApply);
      clearButton.removeEventListener('click', onClear);
      roleBar.replaceChildren();
    },
  };
}
