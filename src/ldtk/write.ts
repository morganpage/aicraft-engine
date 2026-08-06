/**
 * Write a `.ldtk` file back out after editing.
 *
 * The engine models a deliberate subset of LDtk's schema, so reconstructing a
 * file from that subset would silently discard everything it does not know
 * about — editor layout, custom commands, tileset metadata, per-level
 * bookkeeping. Instead the original `JSON.parse` result is kept alongside the
 * typed view, and saving writes *only* the fields the engine owns back into it.
 * Anything unmodelled survives untouched, which is what makes a saved file
 * reopen cleanly in LDtk desktop.
 *
 * Byte-identity is guaranteed the only way it honestly can be: an unmodified
 * document returns its original text. A modified one is re-serialized through
 * `format.ts`, which reproduces LDtk's layout closely but not exactly — LDtk's
 * own writer has a few bespoke habits (notably inlining the first key of
 * `defs`) that are not worth reverse-engineering. LDtk rewrites the file in its
 * own style on its next save.
 *
 * Determinism note: pure functions over plain data. Never throws.
 *
 * @module
 */

import { formatLdtkJson } from './format';
import { parseLdtkProject } from './parse';
import type { LdtkParseError, LdtkProject } from './types';

/**
 * An LDtk file as opened: the typed view the engine edits, plus everything
 * needed to write it back without losing unmodelled data.
 */
export interface LdtkDocument {
  /** The typed project — what editing operations consume and produce. */
  readonly project: LdtkProject;
  /** The untouched `JSON.parse` result, carrying every field we do not model. */
  readonly raw: unknown;
  /** The original file text, returned verbatim when nothing changed. */
  readonly text: string;
}

/** Result of {@link readLdtkDocument}. */
export interface LdtkReadResult {
  readonly ok: boolean;
  readonly document?: LdtkDocument;
  readonly errors: readonly LdtkParseError[];
}

/**
 * Parse a `.ldtk` file into an editable, writable document.
 *
 * Prefer this over `parseLdtkProject` whenever the file may be saved again;
 * the plain parser keeps only the typed subset and cannot round-trip.
 *
 * **Never throws.**
 */
export function readLdtkDocument(json: string): LdtkReadResult {
  const parsed = parseLdtkProject(json);
  if (!parsed.ok || parsed.project === undefined) {
    return { ok: false, errors: parsed.errors };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, errors: parsed.errors };
  }
  return {
    ok: true,
    document: { project: parsed.project, raw, text: json },
    errors: parsed.errors,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structured deep clone of plain JSON data. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Fields the engine owns on a layer instance.
 *
 * Everything else on a layer — and every field on every other node — is left
 * exactly as LDtk wrote it.
 */
function applyLayer(rawLayer: Record<string, unknown>, layer: LdtkProject['levels'][number]['layerInstances'] extends readonly (infer L)[] | null ? L : never): void {
  rawLayer.__cWid = layer.__cWid;
  rawLayer.__cHei = layer.__cHei;
  rawLayer.visible = layer.visible;
  if (layer.intGridCsv !== undefined) rawLayer.intGridCsv = [...layer.intGridCsv];
  if (layer.gridTiles !== undefined) rawLayer.gridTiles = layer.gridTiles.map(tileJson);
  if (layer.autoLayerTiles !== undefined) {
    rawLayer.autoLayerTiles = layer.autoLayerTiles.map(tileJson);
  }
  if (layer.entityInstances !== undefined) {
    // Entity instances carry consumer fields we do not model, so merge by iid
    // into the originals rather than rebuilding them.
    const originals = new Map<string, Record<string, unknown>>();
    for (const item of Array.isArray(rawLayer.entityInstances) ? rawLayer.entityInstances : []) {
      if (isRecord(item) && typeof item.iid === 'string') originals.set(item.iid, item);
    }
    rawLayer.entityInstances = layer.entityInstances.map((entity) => {
      const base = originals.get(entity.iid) ?? {};
      return {
        ...base,
        __identifier: entity.__identifier,
        __grid: [...entity.__grid],
        __pivot: [...entity.__pivot],
        __tags: [...entity.__tags],
        width: entity.width,
        height: entity.height,
        defUid: entity.defUid,
        px: [...entity.px],
        iid: entity.iid,
        fieldInstances: entity.fieldInstances.map((field) => {
          const previous = Array.isArray(base.fieldInstances)
            ? base.fieldInstances.find(
                (f) => isRecord(f) && f.__identifier === field.__identifier,
              )
            : undefined;
          return {
            ...(isRecord(previous) ? previous : {}),
            __identifier: field.__identifier,
            __type: field.__type,
            __value: field.__value,
          };
        }),
      };
    });
  }
  if (layer.optionalRules !== undefined) rawLayer.optionalRules = [...layer.optionalRules];
  if (layer.seed !== undefined) rawLayer.seed = layer.seed;
  if (layer.overrideTilesetUid !== undefined) {
    rawLayer.overrideTilesetUid = layer.overrideTilesetUid;
  }
}

/** Serialize a tile in LDtk's own field order. */
function tileJson(tile: {
  px: readonly number[];
  src: readonly number[];
  f?: number;
  t: number;
  d?: readonly number[];
  a?: number;
}): Record<string, unknown> {
  return {
    px: [...tile.px],
    src: [...tile.src],
    f: tile.f ?? 0,
    t: tile.t,
    d: tile.d === undefined ? [] : [...tile.d],
    a: tile.a ?? 1,
  };
}

/** Apply a typed level's owned fields onto its raw counterpart. */
function applyLevel(rawLevel: Record<string, unknown>, level: LdtkProject['levels'][number]): void {
  rawLevel.pxWid = level.pxWid;
  rawLevel.pxHei = level.pxHei;
  rawLevel.worldX = level.worldX;
  rawLevel.worldY = level.worldY;
  rawLevel.worldDepth = level.worldDepth;
  rawLevel.identifier = level.identifier;

  if (level.layerInstances === null) return;
  const rawLayers = Array.isArray(rawLevel.layerInstances) ? rawLevel.layerInstances : [];
  const byIid = new Map<string, Record<string, unknown>>();
  for (const item of rawLayers) {
    if (isRecord(item) && typeof item.iid === 'string') byIid.set(item.iid, item);
  }
  for (const layer of level.layerInstances) {
    const rawLayer = byIid.get(layer.iid);
    if (rawLayer === undefined) continue;
    applyLayer(rawLayer, layer);
  }
}

/**
 * Serialize an edited project back to `.ldtk` text.
 *
 * Pass the document as opened and the project as edited. When the project is
 * the document's own (nothing was edited), the original text is returned
 * byte-for-byte.
 *
 * **Never throws** — a document whose raw form is unusable falls back to
 * formatting the typed project alone, which still yields valid JSON.
 *
 * @param document - The document from {@link readLdtkDocument}.
 * @param project - The edited project, or omit to write the original.
 * @returns `.ldtk` file text.
 *
 * @example
 * ```ts
 * const { document } = readLdtkDocument(text);
 * const edited = paintLdtkIntGrid(document.project, levelIid, layerIid, cells);
 * await writeFile(path, writeLdtkDocument(document, edited.project));
 * ```
 */
export function writeLdtkDocument(
  document: Readonly<LdtkDocument>,
  project?: Readonly<LdtkProject>,
): string {
  const next = project ?? document.project;
  if (next === document.project) return document.text;
  if (!isRecord(document.raw)) return formatLdtkJson(next);

  let raw: Record<string, unknown>;
  try {
    raw = cloneJson(document.raw);
  } catch {
    return formatLdtkJson(next);
  }

  const applyInto = (container: unknown, levels: readonly LdtkProject['levels'][number][]): void => {
    if (!Array.isArray(container)) return;
    const byIid = new Map<string, Record<string, unknown>>();
    for (const item of container) {
      if (isRecord(item) && typeof item.iid === 'string') byIid.set(item.iid, item);
    }
    for (const level of levels) {
      const rawLevel = byIid.get(level.iid);
      if (rawLevel === undefined) continue;
      applyLevel(rawLevel, level);
    }
  };

  applyInto(raw.levels, next.levels);
  if (Array.isArray(raw.worlds)) {
    for (const rawWorld of raw.worlds) {
      if (!isRecord(rawWorld) || typeof rawWorld.iid !== 'string') continue;
      const world = next.worlds.find((w) => w.iid === rawWorld.iid);
      if (world === undefined) continue;
      applyInto(rawWorld.levels, world.levels);
    }
  }

  return formatLdtkJson(raw);
}
