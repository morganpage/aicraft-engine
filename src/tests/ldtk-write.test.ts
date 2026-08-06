/**
 * Round-trip guarantees for saving `.ldtk` files.
 *
 * The property that matters is not byte-identity but *lossless* round-tripping:
 * a file opened, edited and saved must keep every field the engine does not
 * model, or reopening it in LDtk desktop would silently lose editor state.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLdtkDocument, writeLdtkDocument } from '../ldtk/write';
import { formatLdtkJson } from '../ldtk/format';
import { paintLdtkIntGrid } from '../ldtk/edit';
import { parseLdtkProject } from '../ldtk/parse';
import { LDTK_SAMPLE_DIR } from './ldtk-fixtures';

const sampleNames = readdirSync(LDTK_SAMPLE_DIR).filter((n) => n.endsWith('.ldtk')).sort();

function readSample(name: string): string {
  return readFileSync(join(LDTK_SAMPLE_DIR, name), 'utf8');
}

describe('formatLdtkJson', () => {
  it('is a faithful JSON serializer for every sample', () => {
    for (const name of sampleNames) {
      const original = JSON.parse(readSample(name));
      // Style differs from LDtk's; the data must not.
      expect(JSON.parse(formatLdtkJson(original))).toEqual(original);
    }
  });

  it('keeps leaf number arrays on one line', () => {
    const text = formatLdtkJson({ pattern: [0, 1, -1000001] });
    expect(text).toContain('"pattern": [0,1,-1000001]');
  });

  it('wraps IntGrid rows instead of emitting one number per line', () => {
    const csv = new Array(80).fill(1);
    const text = formatLdtkJson({ intGridCsv: csv });
    // 80 values at 35 per line is 3 lines of numbers, not 80.
    const numberLines = text.split('\n').filter((line) => /^\t+1,/.test(line));
    expect(numberLines).toHaveLength(3);
    expect(numberLines[0].trim().split(',').filter(Boolean)).toHaveLength(35);
  });

  it('puts each tile on its own line', () => {
    const text = formatLdtkJson({
      autoLayerTiles: [
        { px: [0, 0], src: [8, 8], f: 0, t: 1, d: [3, 4], a: 1 },
        { px: [8, 0], src: [8, 8], f: 1, t: 1, d: [3, 5], a: 1 },
      ],
    });
    expect(text).toContain('{ "px": [0,0], "src": [8,8], "f": 0, "t": 1, "d": [3,4], "a": 1 }');
    const tileLines = text.split('\n').filter((line) => line.includes('"px"'));
    expect(tileLines).toHaveLength(2);
  });

  it('emits empty arrays compactly', () => {
    expect(formatLdtkJson({ a: [] })).toContain('"a": []');
  });
});

describe('readLdtkDocument', () => {
  it('reads every sample and keeps the raw document', () => {
    for (const name of sampleNames) {
      const result = readLdtkDocument(readSample(name));
      expect({ name, ok: result.ok, hasRaw: result.document?.raw !== undefined })
        .toEqual({ name, ok: true, hasRaw: true });
    }
  });

  it('fails without throwing on malformed input', () => {
    expect(readLdtkDocument('{ not json').ok).toBe(false);
    expect(readLdtkDocument('null').ok).toBe(false);
    expect(readLdtkDocument('').ok).toBe(false);
  });
});

describe('writeLdtkDocument', () => {
  it('returns the original text byte-for-byte when nothing changed', () => {
    for (const name of sampleNames) {
      const text = readSample(name);
      const { document } = readLdtkDocument(text);
      expect(document).toBeDefined();
      if (document === undefined) continue;
      expect(writeLdtkDocument(document)).toBe(text);
    }
  });

  it('preserves fields the engine does not model', () => {
    for (const name of sampleNames) {
      const text = readSample(name);
      const { document } = readLdtkDocument(text);
      if (document === undefined) continue;

      // Force the modified path by passing a distinct-but-equal project.
      const written = writeLdtkDocument(document, { ...document.project });
      const before = JSON.parse(text) as Record<string, unknown>;
      const after = JSON.parse(written) as Record<string, unknown>;

      // Unmodelled top-level blocks must survive verbatim.
      for (const key of ['__header__', 'defs', 'customCommands', 'flags', 'toc']) {
        expect({ name, key, value: after[key] }).toEqual({ name, key, value: before[key] });
      }
    }
  });

  it('round-trips through the parser with identical typed data', () => {
    for (const name of sampleNames) {
      const text = readSample(name);
      const { document } = readLdtkDocument(text);
      if (document === undefined) continue;

      const written = writeLdtkDocument(document, { ...document.project });
      const reparsed = parseLdtkProject(written);
      expect({ name, ok: reparsed.ok }).toEqual({ name, ok: true });
      expect(reparsed.project).toEqual(document.project);
    }
  });

  it('carries an edit through to the saved file', () => {
    const name = 'Typical_2D_platformer_example.ldtk';
    const { document } = readLdtkDocument(readSample(name));
    expect(document).toBeDefined();
    if (document === undefined) return;

    const level = document.project.levels[0];
    const layer = level.layerInstances?.find((l) => l.intGridCsv !== undefined);
    expect(layer).toBeDefined();
    if (layer === undefined) return;

    const before = layer.intGridCsv?.[0] ?? 0;
    const painted = paintLdtkIntGrid(document.project, level.iid, layer.iid, [
      { cx: 0, cy: 0, value: before === 1 ? 2 : 1 },
    ]);
    expect(painted.changed).toBe(true);

    const written = writeLdtkDocument(document, painted.project);
    const reparsed = parseLdtkProject(written);
    const savedLayer = reparsed.project?.levels[0].layerInstances?.find(
      (l) => l.iid === layer.iid,
    );
    expect(savedLayer?.intGridCsv?.[0]).toBe(before === 1 ? 2 : 1);

    // The edit must not disturb anything else in the layer.
    expect(savedLayer?.intGridCsv?.slice(1)).toEqual(layer.intGridCsv?.slice(1));
  });

  it('writes resolved tiles in a form the parser reads back unchanged', () => {
    const name = 'AutoLayers_1_basic.ldtk';
    const { document } = readLdtkDocument(readSample(name));
    if (document === undefined) return;
    const level = document.project.levels[0];
    const layer = level.layerInstances?.find((l) => (l.autoLayerTiles ?? []).length > 0);
    expect(layer).toBeDefined();
    if (layer === undefined) return;

    const written = writeLdtkDocument(document, { ...document.project });
    const reparsed = parseLdtkProject(written);
    const savedLayer = reparsed.project?.levels[0].layerInstances?.find(
      (l) => l.iid === layer.iid,
    );
    expect(savedLayer?.autoLayerTiles).toEqual(layer.autoLayerTiles);
  });
});
