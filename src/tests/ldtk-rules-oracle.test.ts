/**
 * The auto-tiler's correctness oracle.
 *
 * Every vendored `.ldtk` sample carries the inputs to auto-tiling *and* the
 * tiles LDtk itself produced from them. This suite re-derives those tiles with
 * `runLdtkAutoLayer` and demands an exact match. There is no tolerance band:
 * a divergence means our rule evaluation differs from LDtk's, and a level
 * painted in this engine would not look like the same level opened in LDtk.
 *
 * Cases are split by determinism. Rules driven by `chance`, Perlin, tile
 * jitter, or a choice among several tile alternatives all consume LDtk's
 * internal RNG; reproducing those requires matching that generator exactly and
 * is handled separately from plain pattern matching.
 */

import { describe, expect, it } from 'vitest';
import {
  allOracleCases,
  diffTiles,
  ruleGroupsOf,
  type LdtkOracleCase,
} from './ldtk-fixtures';
import { runLdtkAutoLayer, ldtkRuleSourceFromCsv } from '../ldtk/rules';
import type { LdtkAutoRule } from '../ldtk/types';

/** True when a rule's output depends on LDtk's RNG rather than the pattern alone. */
function isStochastic(rule: LdtkAutoRule): boolean {
  return (
    rule.chance < 1 ||
    rule.perlinActive ||
    rule.tileRectsIds.length > 1 ||
    rule.tileRandomXMin !== 0 ||
    rule.tileRandomXMax !== 0 ||
    rule.tileRandomYMin !== 0 ||
    rule.tileRandomYMax !== 0
  );
}

/** True when every active rule reachable in this case is deterministic. */
function isDeterministicCase(testCase: LdtkOracleCase): boolean {
  const enabled = new Set(testCase.layer.optionalRules ?? []);
  for (const group of ruleGroupsOf(testCase.layerDef)) {
    if (!group.active) continue;
    if (group.isOptional && !enabled.has(group.uid)) continue;
    for (const rule of group.rules) {
      if (rule.active && isStochastic(rule)) return false;
    }
  }
  return true;
}

function resolve(testCase: LdtkOracleCase): ReturnType<typeof diffTiles> {
  const source = ldtkRuleSourceFromCsv(
    testCase.intGrid,
    testCase.cols,
    testCase.rows,
    testCase.layerDef,
  );
  const actual = runLdtkAutoLayer(source, testCase.layerDef, {
    seed: testCase.layer.seed ?? 0,
    enabledOptionalGroups: testCase.layer.optionalRules ?? [],
    gridSize: testCase.layer.__gridSize,
    tileset: testCase.tileset,
    ...(testCase.biomeValues === undefined ? {} : { biomeValues: testCase.biomeValues }),
  });
  return diffTiles(actual, testCase.expected);
}

/** `label` for a case, stable across runs so failures are greppable. */
function label(testCase: LdtkOracleCase): string {
  return `${testCase.sample} · ${testCase.level} · ${testCase.layerDef.identifier}`;
}

const cases = allOracleCases();
const deterministic = cases.filter(isDeterministicCase);
const stochastic = cases.filter((c) => !isDeterministicCase(c));

describe('LDtk auto-layer oracle', () => {
  it('finds oracle cases in the vendored samples', () => {
    // Guards against the suite silently passing because the fixtures moved.
    expect(cases.length).toBeGreaterThan(20);
    expect(deterministic.length).toBeGreaterThan(5);
  });

  describe('deterministic rules reproduce LDtk exactly', () => {
    for (const testCase of deterministic) {
      it(label(testCase), () => {
        const { matched, missing, extra } = resolve(testCase);
        expect({
          missing: missing.slice(0, 5),
          extra: extra.slice(0, 5),
          matched,
          expected: testCase.expected.length,
        }).toEqual({
          missing: [],
          extra: [],
          matched: testCase.expected.length,
          expected: testCase.expected.length,
        });
      });
    }
  });

  it('attributes every tile to the same rule and cell LDtk did', () => {
    // Matching tiles could in principle be reached by different reasoning.
    // LDtk stamps each tile with `d: [ruleUid, coordId]`, so comparing that too
    // upgrades the claim from "same picture" to "same derivation".
    let matched = 0;
    let mismatched = 0;
    const key = (tile: { px: readonly number[]; src: readonly number[]; f?: number; a?: number; d?: readonly number[] }): string =>
      `${tile.px.join(',')}|${tile.src.join(',')}|${tile.f ?? 0}|${tile.a ?? 1}|${tile.d?.join(',') ?? ''}`;

    for (const testCase of cases) {
      const pool = new Map<string, number>();
      for (const tile of testCase.expected) {
        const k = key(tile);
        pool.set(k, (pool.get(k) ?? 0) + 1);
      }
      const source = ldtkRuleSourceFromCsv(
        testCase.intGrid, testCase.cols, testCase.rows, testCase.layerDef,
      );
      const actual = runLdtkAutoLayer(source, testCase.layerDef, {
        seed: testCase.layer.seed ?? 0,
        enabledOptionalGroups: testCase.layer.optionalRules ?? [],
        gridSize: testCase.layer.__gridSize,
        tileset: testCase.tileset,
        ...(testCase.biomeValues === undefined ? {} : { biomeValues: testCase.biomeValues }),
      });
      for (const tile of actual) {
        const k = key(tile);
        const left = pool.get(k) ?? 0;
        if (left > 0) {
          pool.set(k, left - 1);
          matched++;
        } else {
          mismatched++;
        }
      }
    }
    expect({ mismatched, matchedIsSubstantial: matched > 10000 })
      .toEqual({ mismatched: 0, matchedIsSubstantial: true });
  });

  describe('stochastic rules reproduce LDtk exactly', () => {
    for (const testCase of stochastic) {
      it(label(testCase), () => {
        const { matched, missing, extra } = resolve(testCase);
        expect({
          missing: missing.slice(0, 5),
          extra: extra.slice(0, 5),
          matched,
          expected: testCase.expected.length,
        }).toEqual({
          missing: [],
          extra: [],
          matched: testCase.expected.length,
          expected: testCase.expected.length,
        });
      });
    }
  });
});
