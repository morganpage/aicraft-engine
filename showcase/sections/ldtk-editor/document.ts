/**
 * Opening, resolving and saving an LDtk project in the browser.
 *
 * A `.ldtk` file references its tilesets by path *relative to itself*, which a
 * plain file input cannot follow — you get the JSON and nothing to draw it
 * with. Three strategies are offered, best first:
 *
 * 1. **Directory handle** (File System Access API) — resolves `relPath`
 *    properly and saves in place, so LDtk desktop sees edits immediately.
 *    Chromium only.
 * 2. **Multi-file pick** — the user selects the `.ldtk` and its PNGs together
 *    and paths are matched by basename. Works everywhere; saving downloads.
 * 3. **Bundled sample** — no file access at all, for the demo.
 *
 * Host APIs are resolved lazily inside the functions that use them, never at
 * module load, so importing this module is safe in any environment.
 */

import {
  buildLdtkTilesetBundle,
  ldtkOpaqueTileLookup,
  readLdtkDocument,
  runLdtkAutoLayer,
  ldtkRuleSourceFromCsv,
  setLdtkLayerTiles,
  writeLdtkDocument,
  type LdtkDocument,
  type LdtkLayerInstance,
  type LdtkLevel,
  type LdtkProject,
  type LdtkTilesetBundle,
  type LdtkTilesetDef,
} from '../../../src/ldtk';

/** A resolved project ready to edit: document, images, and lookup tables. */
export interface LoadedLdtkProject {
  readonly document: LdtkDocument;
  readonly tilesets: LdtkTilesetBundle;
  /** Where the file came from, for the status line. */
  readonly source: string;
  /** Present when the project can be saved back in place. */
  readonly fileHandle?: FileSystemFileHandle;
}

/** Images keyed by the basename of their path. */
type ImagesByName = ReadonlyMap<string, CanvasImageSource>;

/** Last path segment of a relative path, lowercased. */
function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return (parts[parts.length - 1] ?? path).toLowerCase();
}

/**
 * Decode a blob into something drawable.
 *
 * `createImageBitmap` is strongly preferred. The `Image` + `decode()` fallback
 * exists only for engines that lack it, and it is genuinely unreliable: on a
 * `304 Not Modified` response `decode()` can never settle, hanging the caller
 * forever with no error to catch. The timeout below turns that into a normal
 * failure so one bad image cannot wedge the whole load.
 */
async function decodeImage(blob: Blob): Promise<CanvasImageSource> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await Promise.race([
      image.decode(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('image decode timed out')), DECODE_TIMEOUT_MS),
      ),
    ]);
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** How long to wait on the unreliable `decode()` fallback before giving up. */
const DECODE_TIMEOUT_MS = 5000;

/**
 * Fetch and decode an image by URL.
 *
 * Goes through `fetch` so the bytes are in hand before decoding, which avoids
 * the `decode()`-on-304 hang entirely.
 */
export async function loadImageFromUrl(url: string): Promise<CanvasImageSource> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} loading ${url}`);
  return decodeImage(await response.blob());
}

/** True when the File System Access API is available. */
export function supportsDirectoryAccess(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/** Walk a directory handle, collecting images and `.ldtk` files by name. */
async function collectFromDirectory(
  directory: FileSystemDirectoryHandle,
  images: Map<string, CanvasImageSource>,
  projects: Map<string, FileSystemFileHandle>,
  depth = 0,
): Promise<void> {
  // Sample projects keep tilesets one level down (`atlas/`); a couple of levels
  // is plenty and stops a mis-picked home directory from being crawled.
  if (depth > 3) return;
  for await (const [name, handle] of directory as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    if (handle.kind === 'directory') {
      await collectFromDirectory(handle as FileSystemDirectoryHandle, images, projects, depth + 1);
      continue;
    }
    const lower = name.toLowerCase();
    if (lower.endsWith('.ldtk')) {
      projects.set(lower, handle as FileSystemFileHandle);
      continue;
    }
    if (!/\.(png|gif|jpe?g)$/.test(lower)) continue;
    try {
      const file = await (handle as FileSystemFileHandle).getFile();
      images.set(lower, await decodeImage(file));
    } catch {
      // An undecodable image just leaves its tileset missing; the renderer
      // skips layers whose tileset uid is absent.
    }
  }
}

/** Build the tileset bundle for a project from images keyed by basename. */
function bundleFor(project: LdtkProject, images: ImagesByName): LdtkTilesetBundle {
  return buildLdtkTilesetBundle(project.defs.tilesets, (def: LdtkTilesetDef) => {
    if (def.relPath === null) return undefined;
    return images.get(basename(def.relPath));
  });
}

/**
 * Open a project through a directory handle.
 *
 * The whole directory is read so `relPath` resolves the way LDtk means it,
 * and the returned handle allows saving in place.
 *
 * @param preferredName - Basename to open when the folder holds several
 *   projects. Falls back to the first found.
 */
export async function openProjectFromDirectory(
  preferredName?: string,
): Promise<LoadedLdtkProject | { readonly error: string }> {
  if (!supportsDirectoryAccess()) {
    return { error: 'This browser has no directory access. Use "Open files" instead.' };
  }
  try {
    const picker = (window as unknown as {
      showDirectoryPicker: (options?: unknown) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker;
    const directory = await picker({ mode: 'readwrite' });

    const images = new Map<string, CanvasImageSource>();
    const projects = new Map<string, FileSystemFileHandle>();
    await collectFromDirectory(directory, images, projects);

    if (projects.size === 0) return { error: 'No .ldtk file in that folder.' };
    const wanted = preferredName?.toLowerCase();
    const handle = (wanted !== undefined ? projects.get(wanted) : undefined)
      ?? [...projects.values()][0];
    const name = [...projects.entries()].find(([, h]) => h === handle)?.[0] ?? 'project.ldtk';

    const text = await (await handle.getFile()).text();
    const read = readLdtkDocument(text);
    if (!read.ok || read.document === undefined) {
      return { error: `Could not parse ${name}: ${read.errors.map((e) => e.message).join('; ')}` };
    }
    return {
      document: read.document,
      tilesets: bundleFor(read.document.project, images),
      source: name,
      fileHandle: handle,
    };
  } catch (error) {
    // An aborted picker is a normal user action, not a failure.
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { error: '' };
    }
    return { error: `Could not open folder: ${(error as Error).message}` };
  }
}

/**
 * Open a project from a set of files the user picked together.
 *
 * Tileset paths are matched on basename, since the browser gives no directory
 * structure for a multi-file selection.
 */
export async function openProjectFromFiles(
  files: readonly File[],
): Promise<LoadedLdtkProject | { readonly error: string }> {
  const projectFile = files.find((f) => f.name.toLowerCase().endsWith('.ldtk'));
  if (projectFile === undefined) return { error: 'Select a .ldtk file (and its tileset images).' };

  const images = new Map<string, CanvasImageSource>();
  for (const file of files) {
    if (!/\.(png|gif|jpe?g)$/i.test(file.name)) continue;
    try {
      images.set(file.name.toLowerCase(), await decodeImage(file));
    } catch {
      // Skipped; the layer using it simply will not draw.
    }
  }

  const read = readLdtkDocument(await projectFile.text());
  if (!read.ok || read.document === undefined) {
    return {
      error: `Could not parse ${projectFile.name}: ${read.errors.map((e) => e.message).join('; ')}`,
    };
  }
  const bundle = bundleFor(read.document.project, images);
  const missing = read.document.project.defs.tilesets.filter(
    (def) => def.relPath !== null && def.embedAtlas !== 'LdtkIcons' && !bundle.has(def.uid),
  );
  return {
    document: read.document,
    tilesets: bundle,
    source: missing.length === 0
      ? projectFile.name
      : `${projectFile.name} (missing ${missing.map((d) => basename(d.relPath ?? '')).join(', ')})`,
  };
}

/**
 * Open the project bundled with the showcase.
 *
 * @param text - The `.ldtk` contents, imported at build time.
 * @param images - Tileset images keyed by basename.
 */
export function openBundledProject(
  text: string,
  images: ImagesByName,
  source: string,
): LoadedLdtkProject | { readonly error: string } {
  const read = readLdtkDocument(text);
  if (!read.ok || read.document === undefined) {
    return { error: `Could not parse ${source}: ${read.errors.map((e) => e.message).join('; ')}` };
  }
  return { document: read.document, tilesets: bundleFor(read.document.project, images), source };
}

/**
 * Save a project, writing in place when the file handle allows it.
 *
 * @returns A human-readable outcome for the status line.
 */
export async function saveProject(
  loaded: LoadedLdtkProject,
  project: LdtkProject,
): Promise<string> {
  const text = writeLdtkDocument(loaded.document, project);
  if (loaded.fileHandle !== undefined) {
    try {
      const writable = await loaded.fileHandle.createWritable();
      await writable.write(text);
      await writable.close();
      return `Saved ${loaded.source} in place — reopen it in LDtk to see the change.`;
    } catch (error) {
      return `Could not write the file: ${(error as Error).message}`;
    }
  }
  try {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = loaded.source.endsWith('.ldtk') ? loaded.source : `${loaded.source}.ldtk`;
    anchor.click();
    URL.revokeObjectURL(url);
    return `Downloaded ${anchor.download}. Grant folder access to save in place instead.`;
  } catch (error) {
    return `Could not save: ${(error as Error).message}`;
  }
}

/**
 * Re-run auto-tiling for every rule-driven layer whose rules read a given
 * layer's IntGrid, and return the updated project.
 *
 * A layer's rules may read a *different* layer's grid (`autoSourceLayerDefUid`),
 * so painting one IntGrid can restyle several layers at once — the shadow and
 * background layers of the platformer sample both key off its collision grid.
 * Missing that would leave them stale.
 *
 * The whole layer is re-resolved rather than a dirty window. It is exact by
 * construction and measured at a few milliseconds even for the heaviest sample
 * ruleset, which is well inside a pointer-move budget.
 */
export function retileProject(
  project: LdtkProject,
  levelIid: string,
  changedLayerDefUid: number,
): LdtkProject {
  const level = findLevel(project, levelIid);
  if (level === undefined || level.layerInstances === null) return project;

  let next = project;
  for (const layer of level.layerInstances) {
    const def = project.defs.layers.find((d) => d.uid === layer.layerDefUid);
    if (def === undefined) continue;
    const rules = def.autoRuleGroups ?? [];
    if (rules.length === 0) continue;

    const sourceUid = def.autoSourceLayerDefUid ?? def.uid;
    if (sourceUid !== changedLayerDefUid) continue;

    const sourceLayer = sourceUid === def.uid
      ? layer
      : level.layerInstances.find((l) => l.layerDefUid === sourceUid);
    if (sourceLayer?.intGridCsv === undefined) continue;

    const tiles = resolveLayerTiles(project, level, layer, def, sourceLayer);
    next = setLdtkLayerTiles(next, levelIid, layer.iid, tiles).project;
  }
  return next;
}

/** Resolve one layer's tiles from its rules. */
function resolveLayerTiles(
  project: LdtkProject,
  level: LdtkLevel,
  layer: LdtkLayerInstance,
  def: LdtkProject['defs']['layers'][number],
  sourceLayer: LdtkLayerInstance,
): ReturnType<typeof runLdtkAutoLayer> {
  const tilesetUid = layer.overrideTilesetUid ?? layer.__tilesetDefUid
    ?? def.autoTilesetDefUid ?? def.tilesetDefUid;
  const tilesetDef = project.defs.tilesets.find((t) => t.uid === tilesetUid);
  const source = ldtkRuleSourceFromCsv(
    sourceLayer.intGridCsv ?? [],
    sourceLayer.__cWid,
    sourceLayer.__cHei,
    def,
  );
  const biomeValues = biomeValuesOf(level, def);
  return runLdtkAutoLayer(source, def, {
    seed: layer.seed ?? 0,
    gridSize: layer.__gridSize,
    enabledOptionalGroups: layer.optionalRules ?? [],
    ...(biomeValues === undefined ? {} : { biomeValues }),
    ...(tilesetDef === undefined ? {} : {
      tileset: {
        cWid: tilesetDef.__cWid,
        tileGridSize: tilesetDef.tileGridSize,
        padding: tilesetDef.padding ?? 0,
        spacing: tilesetDef.spacing ?? 0,
        ...(ldtkOpaqueTileLookup(tilesetDef) === undefined
          ? {}
          : { isOpaque: ldtkOpaqueTileLookup(tilesetDef) }),
      },
    }),
  });
}

/** Biome values gating a layer's rule groups, or `undefined` when absent. */
function biomeValuesOf(
  level: LdtkLevel,
  def: LdtkProject['defs']['layers'][number],
): readonly string[] | undefined {
  const uid = def.biomeFieldUid;
  if (uid === undefined || uid === null) return undefined;
  const field = level.fieldInstances.find((f) => f.defUid === uid);
  if (field === undefined) return undefined;
  const raw = field.__value;
  const values = Array.isArray(raw) ? raw : [raw];
  return values.filter((v): v is string => typeof v === 'string');
}

/** Find a level by iid across single-world and multi-world projects. */
export function findLevel(project: LdtkProject, levelIid: string): LdtkLevel | undefined {
  for (const level of project.levels) if (level.iid === levelIid) return level;
  for (const world of project.worlds) {
    for (const level of world.levels) if (level.iid === levelIid) return level;
  }
  return undefined;
}

/** Every level in a project, in a stable order. */
export function allLevels(project: LdtkProject): readonly LdtkLevel[] {
  return project.worlds.length > 0
    ? project.worlds.flatMap((w) => w.levels)
    : project.levels;
}
