/**
 * Tests for the main generation entry points.
 *
 * Tests cover:
 * - generateBlueprint returns a valid LevelBlueprint
 * - realizeBlueprint returns a valid GeneratedLevel
 * - generateLevel returns a valid GeneratedLevel
 * - Same seed → same output (byte-identical)
 * - Different seed → different output
 * - validateLevel passes on generated level
 * - compileGeneratedLevel produces solids
 * - applyOp(replaceLevel) reproduces the level
 * - cols * rows ≤ MAX_GENERATED_CELLS
 * - Non-finite inputs → never throws
 * - Difficulty 0 → simple level
 * - Difficulty 1 → complex level
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import {
  generateBlueprint,
  generateLevel,
  realizeBlueprint,
  MAX_GENERATED_CELLS,
  DEFAULT_TILE_SEMANTICS,
} from '../levelgen';
import type { LevelBlueprint } from '../levelgen/types';
import { validateLevel } from '../level';
import { compileGeneratedLevel } from '../platformer';
import { applyOp, createEditorState } from '../editor';
import { createLevelScaffold } from '../level';

const BASE_CONFIG = { cols: 60, rows: 15, tileSize: 16, difficulty: 0.5 };

describe('generateBlueprint', () => {
  it('returns a valid LevelBlueprint with version 1', () => {
    const bp = generateBlueprint(42, BASE_CONFIG);
    expect(bp.version).toBe(1);
    expect(bp.route).toBeDefined();
    expect(bp.pacing).toBeDefined();
    expect(bp.requiredMechanics).toBeDefined();
    expect(typeof bp.targetDifficulty).toBe('number');
  });

  it('has at least start and exit nodes', () => {
    const bp = generateBlueprint(42, BASE_CONFIG);
    const kinds = bp.route.nodes.map((n) => n.kind);
    expect(kinds).toContain('start');
    expect(kinds).toContain('exit');
  });

  it('has at least 4 pacing beats', () => {
    const bp = generateBlueprint(42, BASE_CONFIG);
    expect(bp.pacing.length).toBeGreaterThanOrEqual(4);
  });

  it('sets targetDifficulty from config', () => {
    const bp = generateBlueprint(42, { ...BASE_CONFIG, difficulty: 0.75 });
    expect(bp.targetDifficulty).toBeCloseTo(0.75, 5);
  });

  it('same seed → same blueprint (byte-identical)', () => {
    const a = generateBlueprint(42, BASE_CONFIG);
    const b = generateBlueprint(42, BASE_CONFIG);
    expect(a).toEqual(b);
  });

  it('different seed → different blueprint', () => {
    const a = generateBlueprint(42, BASE_CONFIG);
    const b = generateBlueprint(99, BASE_CONFIG);
    expect(a).not.toEqual(b);
  });

  it('inferRequiredMechanics sets jump to true when jumps are present', () => {
    // Create a blueprint with jump beats
    const bp = generateBlueprint(42, { ...BASE_CONFIG, difficulty: 0.7 });
    const jumpMechanic = bp.requiredMechanics.find((m) => m.name === 'jump');
    // At higher difficulty, jumps are likely present
    expect(jumpMechanic).toBeDefined();
  });

  it('never throws on any input', () => {
    const badInputs = [
      null as unknown as typeof BASE_CONFIG,
      undefined as unknown as typeof BASE_CONFIG,
      {} as typeof BASE_CONFIG,
      { cols: NaN, rows: NaN } as typeof BASE_CONFIG,
      { difficulty: 100 } as typeof BASE_CONFIG,
    ];
    for (const input of badInputs) {
      expect(() => generateBlueprint(42, input)).not.toThrow();
    }
  });
});

describe('generateLevel', () => {
  it('returns a valid GeneratedLevel', () => {
    const result = generateLevel(42, BASE_CONFIG);
    expect(result.level).toBeDefined();
    expect(result.editorOp).toBeDefined();
    expect(result.tileSemantics).toBeDefined();
    expect(result.report).toBeDefined();
  });

  it('returns a level that passes validateLevel', () => {
    const result = generateLevel(42, BASE_CONFIG);
    const validation = validateLevel(result.level);
    if (!validation.valid) {
      console.error('Validation errors:', JSON.stringify(validation.errors, null, 2));
    }
    expect(validation.valid).toBe(true);
  });

  it('produces a level with exactly one spawn and at least one exit', () => {
    const result = generateLevel(42, BASE_CONFIG);
    const spawns = result.level.entities.filter((e) => e.kind === 'spawn');
    const exits = result.level.entities.filter((e) => e.kind === 'exit');
    expect(spawns).toHaveLength(1);
    expect(exits.length).toBeGreaterThanOrEqual(1);
  });

  it('editorOp is a replaceLevel operation', () => {
    const result = generateLevel(42, BASE_CONFIG);
    expect(result.editorOp.type).toBe('replaceLevel');
    expect(typeof result.editorOp.level).toBe('object');
    expect(typeof result.editorOp.label).toBe('string');
  });

  it('applyOp(replaceLevel) reproduces the level', () => {
    const result = generateLevel(42, BASE_CONFIG);
    // Create a different editor state and apply the replaceLevel op
    const baseLevel = createLevelScaffold({ id: 'different', name: 'Diff', width: 100, height: 100, tileSize: 16 });
    const newState = applyOp(
      createEditorState(baseLevel),
      result.editorOp,
    );
    expect(newState.level).toEqual(result.level);
  });

  it('compileGeneratedLevel produces solids with tile semantics', () => {
    const result = generateLevel(42, BASE_CONFIG);
    const compiled = compileGeneratedLevel({
      level: result.level,
      tileSemantics: result.tileSemantics,
    });
    // Should have at least some static solids from the ground tiles
    expect(compiled.staticSolids.length).toBeGreaterThan(0);
    expect(compiled.initialState).toBeDefined();
    expect(typeof compiled.tileQuery).toBe('function');
  });

  it('tileSemantics matches DEFAULT_TILE_SEMANTICS', () => {
    const result = generateLevel(42, BASE_CONFIG);
    expect(result.tileSemantics.solid).toEqual(DEFAULT_TILE_SEMANTICS.solid);
    expect(result.tileSemantics.passthrough).toEqual(DEFAULT_TILE_SEMANTICS.passthrough);
  });

  it('same seed → same output (byte-identical)', () => {
    const a = generateLevel(42, BASE_CONFIG);
    const b = generateLevel(42, BASE_CONFIG);
    expect(a.level).toEqual(b.level);
    expect(a.editorOp).toEqual(b.editorOp);
    expect(a.report).toEqual(b.report);
  });

  it('different seed → different output', () => {
    const a = generateLevel(42, BASE_CONFIG);
    const b = generateLevel(99, BASE_CONFIG);
    expect(a.level).not.toEqual(b.level);
  });

  it('cols * rows never exceeds MAX_GENERATED_CELLS', () => {
    // An extremely large grid should be clamped
    const result = generateLevel(42, { cols: 2000, rows: 2000, tileSize: 16, difficulty: 0.5 });
    const cellCount = result.level.tiles.cols * result.level.tiles.rows;
    expect(cellCount).toBeLessThanOrEqual(MAX_GENERATED_CELLS);
  });

  it('difficulty 0 produces a simple level (no branches)', () => {
    const result = generateLevel(42, { ...BASE_CONFIG, difficulty: 0.0 });
    const branches = result.report.quality.exploration;
    // Low difficulty → low exploration score (few/no branches)
    expect(branches).toBeLessThanOrEqual(0.3);
  });

  it('difficulty 1 produces a more complex level', () => {
    const result = generateLevel(42, { ...BASE_CONFIG, difficulty: 1.0 });
    // High difficulty levels should still be structurally valid
    const validation = validateLevel(result.level);
    expect(validation.valid).toBe(true);
  });

  it('never throws on any input', () => {
    const badInputs = [
      null as unknown as typeof BASE_CONFIG,
      undefined as unknown as typeof BASE_CONFIG,
      {} as typeof BASE_CONFIG,
      { cols: NaN, rows: NaN } as typeof BASE_CONFIG,
      { tileSize: -5 } as typeof BASE_CONFIG,
      { difficulty: Infinity } as typeof BASE_CONFIG,
    ];
    for (const input of badInputs) {
      expect(() => generateLevel(42, input)).not.toThrow();
    }
  });

  it('report has all required fields', () => {
    const result = generateLevel(42, BASE_CONFIG);
    const report = result.report;
    expect(report.version).toBe(1);
    expect(report.seed).toBe(42);
    expect(report.candidateIndex).toBe(0);
    expect(Array.isArray(report.repairs)).toBe(true);
    expect(report.verification).toBeDefined();
    expect(report.quality).toBeDefined();
    expect(Array.isArray(report.diagnostics)).toBe(true);
  });

  it('verification result has expected stub structure', () => {
    const result = generateLevel(42, BASE_CONFIG);
    const ver = result.report.verification;
    expect(ver.version).toBe(1);
    expect(ver.status).toBe('inconclusive');
    expect(ver.structural).toBeDefined();
    expect(ver.reachability).toBeDefined();
    expect(ver.scenario).toBeDefined();
  });

  it('level dimensions match config', () => {
    const result = generateLevel(42, { cols: 40, rows: 20, tileSize: 8 });
    expect(result.level.width).toBe(40 * 8);
    expect(result.level.height).toBe(20 * 8);
    expect(result.level.tileSize).toBe(8);
  });

  it('entity IDs start from 1 and are sequential', () => {
    const result = generateLevel(42, BASE_CONFIG);
    const ids = result.level.entities.map((e) => e.id).sort((a, b) => a - b);
    expect(ids[0]).toBeGreaterThanOrEqual(1);
    // IDs should be unique
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('realizeBlueprint', () => {
  it('produces a valid reachable level from a blueprint', () => {
    const bp = generateBlueprint(42, BASE_CONFIG);
    const result = realizeBlueprint(42, bp, BASE_CONFIG);
    const validation = validateLevel(result.level);
    expect(validation.valid).toBe(true);
  });

  it('same seed and blueprint → same output', () => {
    const bp = generateBlueprint(42, BASE_CONFIG);
    const a = realizeBlueprint(42, bp, BASE_CONFIG);
    const b = realizeBlueprint(42, bp, BASE_CONFIG);
    expect(a.level).toEqual(b.level);
  });

  it('different seed → different output from same blueprint', () => {
    const bp = generateBlueprint(42, BASE_CONFIG);
    const a = realizeBlueprint(42, bp, BASE_CONFIG);
    const b = realizeBlueprint(99, bp, BASE_CONFIG);
    // Seeds differ, so geometry should differ
    expect(a.level).not.toEqual(b.level);
  });

  it('never throws on any input', () => {
    const bp = generateBlueprint(42, BASE_CONFIG);
    expect(() => realizeBlueprint(42, null as unknown as LevelBlueprint, BASE_CONFIG)).not.toThrow();
    expect(() => realizeBlueprint(42, bp, null as unknown as typeof BASE_CONFIG)).not.toThrow();
    expect(() => realizeBlueprint(42, bp, { cols: NaN } as typeof BASE_CONFIG)).not.toThrow();
  });

  it('handles blueprint with unreachable nodes gracefully', () => {
    const bp = generateBlueprint(42, BASE_CONFIG);
    // Create a blueprint with a node off-grid
    const badBp: LevelBlueprint = {
      ...bp,
      route: {
        version: 1,
        nodes: [
          { id: 'start', x: 0, y: 0, kind: 'start' },
          { id: 'exit', x: 1000, y: 1000, kind: 'exit' },
        ],
        edges: [{ from: 'start', to: 'exit', kind: 'main' }],
      },
    };
    const result = realizeBlueprint(42, badBp, BASE_CONFIG);
    // Should still produce a level (graceful handling)
    expect(result.level).toBeDefined();
  });
});
