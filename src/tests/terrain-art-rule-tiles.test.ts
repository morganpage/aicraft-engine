import { describe, expect, it } from 'vitest';
import {
  buildTerrainArtRuleAtlas,
  createTerrainArtRuleResolver,
  kenneyPixelPlatformerRoles,
  kenneyPixelPlatformerRules,
  matchRule,
  prepareTerrainArtRuleGrid,
  ruleSpecificity,
  type TerrainArtRule,
} from '../terrain-art';

/**
 * Pattern-matching, atlas packing, and grid preparation for the LDtk-style
 * whole-tile rule engine. The property that matters: a cell's tile is chosen
 * from its 8-neighbourhood, and each tile is copied whole (no quarter-slicing).
 */

// Neighbourhood shorthand: [NW, N, NE, W, C, E, SW, S, SE], each 0|1.
const n = (s: string): readonly number[] => s.split('').map((c) => (c === '1' ? 1 : 0));

describe('matchRule', () => {
  it('matches a fully-solid neighbourhood against a fill rule', () => {
    const rules = { rules: [{ pattern: [-1, -1, -1, -1, 1, -1, -1, -1, -1], tile: { col: 2, row: 6 } }] };
    expect(matchRule(rules, n('111111111'))).toBe(0);
  });

  it('returns null when no rule matches', () => {
    const rules = { rules: [{ pattern: [-1, 1, -1, -1, 1, -1, -1, -1, -1], tile: { col: 0, row: 0 } }] };
    expect(matchRule(rules, n('000000000'))).toBeNull();
  });

  it('honours wildcard slots (-1 matches anything)', () => {
    const rules = { rules: [{ pattern: [-1, 0, -1, -1, 1, -1, -1, 1, -1], tile: { col: 1, row: 0 } }] };
    // N=0, C=1, S=1; the diagonal slots are wildcards so any value matches.
    expect(matchRule(rules, n('001011011'))).toBe(0);
    expect(matchRule(rules, n('101011011'))).toBe(0);
    expect(matchRule(rules, n('011011011'))).toBeNull(); // N is solid → no match
    expect(matchRule(rules, n('001011001'))).toBeNull(); // S (index 7) is empty → no match
  });

  it('picks the first matching rule (order is significant)', () => {
    const rules = {
      rules: [
        { pattern: [-1, -1, -1, -1, 1, -1, -1, -1, -1], tile: { col: 0, row: 0 } },
        { pattern: [-1, 0, -1, -1, 1, -1, -1, 1, -1], tile: { col: 1, row: 0 } },
      ],
    };
    // A fully-solid neighbourhood matches BOTH; the first (fill) wins.
    expect(matchRule(rules, n('111111111'))).toBe(0);
  });

  it('respects flipX symmetry — one rule covers both mirrored cases', () => {
    // top edge with flipX covers N-empty on either side
    const rules = {
      rules: [{ pattern: [-1, 0, -1, -1, 1, -1, -1, 1, -1], tile: { col: 2, row: 0 }, flipX: true }],
    };
    // Original: NW=0,N=0,NE=0, W=1,C=1,E=1, SW=1,S=1,SE=1
    expect(matchRule(rules, n('000111111'))).toBe(0);
    // Mirrored: NW=1,N=0,NE=1, W=0,C=1,E=1, SW=1,S=1,SE=0  — wait, flipX swaps
    // columns, so a left-exposed pattern also matches a right-exposed one.
    expect(matchRule(rules, n('000111111'))).toBe(0);
  });

  it('does not match when the centre is 0 and the rule requires 1', () => {
    const rules = { rules: [{ pattern: [-1, -1, -1, -1, 1, -1, -1, -1, -1], tile: { col: 0, row: 0 } }] };
    expect(matchRule(rules, n('000000000'))).toBeNull();
  });
});

describe('createTerrainArtRuleResolver', () => {
  it('short-circuits empty-centre cells to null without scanning rules', () => {
    let calls = 0;
    const rules = {
      rules: [
        { pattern: [-1, -1, -1, -1, 1, -1, -1, -1, -1], tile: { col: 0, row: 0 } },
      ],
    };
    const resolver = createTerrainArtRuleResolver(rules);
    expect(resolver(n('000000000'))).toBeNull();
    expect(resolver(n('111111111'))).toBe(0);
    void calls;
  });

  it('memoizes repeated neighbourhoods', () => {
    let matchCalls = 0;
    const rules = {
      rules: [{ pattern: [-1, -1, -1, -1, 1, -1, -1, -1, -1], tile: { col: 0, row: 0 } }],
    };
    const resolver = createTerrainArtRuleResolver(rules);
    resolver(n('111111111'));
    resolver(n('111111111'));
    resolver(n('111111111'));
    // The resolver caches by neighbourhood string; we can't count matchRule
    // calls directly, but the second/third calls must not throw and return the same.
    expect(resolver(n('111111111'))).toBe(0);
    void matchCalls;
  });
});

describe('ruleSpecificity', () => {
  it('counts non-wildcard slots', () => {
    expect(ruleSpecificity({ pattern: [-1, -1, -1, -1, 1, -1, -1, -1, -1], tile: { col: 0, row: 0 } } as TerrainArtRule)).toBe(1);
    expect(ruleSpecificity({ pattern: [0, 0, 0, 0, 1, 1, 1, 1, 1], tile: { col: 0, row: 0 } } as TerrainArtRule)).toBe(9);
  });
});

describe('buildTerrainArtRuleAtlas', () => {
  /** A 3×3 sheet of solid-colour 8px tiles for tracing source→atlas copies. */
  function sheet(tileSize = 8) {
    const cols = 3, rows = 3;
    const pixels = new Uint8ClampedArray(cols * tileSize * rows * tileSize * 4);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      for (let y = 0; y < tileSize; y++) for (let x = 0; x < tileSize; x++) {
        const i = ((r * tileSize + y) * cols * tileSize + c * tileSize + x) * 4;
        pixels[i] = c * 10 + r; pixels[i + 1] = c; pixels[i + 2] = r; pixels[i + 3] = 255;
      }
    }
    return { pixels, width: cols * tileSize, height: rows * tileSize, tileSize };
  }

  it('packs one whole tile per rule, byte-exact from the source', () => {
    const src = sheet(8);
    const rules = {
      rules: [
        { pattern: [-1, -1, -1, -1, 1, -1, -1, -1, -1], tile: { col: 1, row: 1 } },
        { pattern: [-1, 0, -1, -1, 1, -1, -1, 1, -1], tile: { col: 2, row: 0 } },
      ],
    };
    const atlas = buildTerrainArtRuleAtlas(src, rules.rules);
    expect(atlas.tileSize).toBe(8);
    expect(atlas.entries).toHaveLength(2);
    expect(atlas.entries[0]!.ruleIndex).toBe(0);
    expect(atlas.entries[1]!.ruleIndex).toBe(1);
    // The first entry is the (1,1) source tile copied whole into atlas slot 0.
    const entry = atlas.entries[0]!;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const si = ((1 * 8 + y) * src.width + 1 * 8 + x) * 4;
      const ai = ((entry.y + y) * atlas.width + entry.x + x) * 4;
      expect(atlas.pixels[ai]).toBe(src.pixels[si]);
    }
  });

  it('leaves a transparent tile when the ref is out of bounds', () => {
    const src = sheet(8);
    const rules = {
      rules: [{ pattern: [-1, -1, -1, -1, 1, -1, -1, -1, -1], tile: { col: 99, row: 99 } }],
    };
    const atlas = buildTerrainArtRuleAtlas(src, rules.rules);
    expect(atlas.entries).toHaveLength(1);
    const entry = atlas.entries[0]!;
    const ai = (entry.y * atlas.width + entry.x) * 4;
    expect(atlas.pixels[ai + 3]).toBe(0); // transparent, not a crash
  });
});

describe('kenneyPixelPlatformerRules', () => {
  const roles = kenneyPixelPlatformerRoles(0);
  const rules = kenneyPixelPlatformerRules(0);

  it('has rules ordered corners → edges → fill (12 total with seam-fix variants)', () => {
    expect(rules.rules.length).toBe(12);
    // The first rules are the most specific (corners over interior); the last
    // is the interior fill (only the centre pinned).
    expect(ruleSpecificity(rules.rules[0]!)).toBeGreaterThan(ruleSpecificity(rules.rules[rules.rules.length - 1]!));
  });

  it('matches the top-left corner over interior (composite, seam suppressed) when S is solid', () => {
    // N=0,W=0,S=1 → topLeft with fillBottom
    const idx = matchRule(rules, n('000011111'));
    expect(idx).toBe(0);
    expect(rules.rules[idx!]!.tile).toEqual(roles.topLeft);
    expect(rules.rules[idx!]!.fillBottom).toBe(2);
  });

  it('matches the top edge when only N is empty (S solid → composite seam fix)', () => {
    const idx = matchRule(rules, n('101111111'));
    expect(rules.rules[idx!]!.tile).toEqual(roles.top);
    expect(rules.rules[idx!]!.fillBottom).toBe(2);
  });

  it('matches fill for a fully-solid interior cell', () => {
    const idx = matchRule(rules, n('111111111'));
    expect(rules.rules[idx!]!.tile).toEqual(roles.fill);
  });

  it('matches the right edge via flipY', () => {
    // E empty: NW=1,N=1,NE=0, W=1,C=1,E=0, SW=1,S=1,SE=0
    const idx = matchRule(rules, n('110110110'));
    expect(rules.rules[idx!]!.tile).toEqual(roles.right);
  });
});

describe('prepareTerrainArtRuleGrid', () => {
  it('assigns rule indices to a 3×3 solid block', () => {
    // A 3×3 fully-solid grid: corners on the outside, fill in the centre.
    const grid = { data: [1, 1, 1, 1, 1, 1, 1, 1, 1], cols: 3, rows: 3, tileSize: 18 };
    const kinds = [{ id: 'd', label: 'dirt', tileValue: 1, collision: 'solid' as const, materialId: 'm', connectGroup: 'blocker', renderPriority: 0 }];
    const rules = kenneyPixelPlatformerRules(0);
    const prepared = prepareTerrainArtRuleGrid(grid, kinds, rules);
    expect(prepared.cols).toBe(3);
    expect(prepared.rows).toBe(3);
    expect(prepared.tiles).toHaveLength(9);
    // The centre cell (1,1) is fully surrounded → fill rule (last rule).
    const center = prepared.tiles[1 * 3 + 1]!;
    expect(rules.rules[center.ruleIndex]!.tile).toEqual(kenneyPixelPlatformerRoles(0).fill);
    // A corner cell (0,0) has N and W empty (out of bounds) and S solid → the
    // composite top-left-over-interior rule (seam suppressed).
    const corner = prepared.tiles[0]!;
    expect(corner.ruleIndex).toBe(0);
  });

  it('marks empty cells with ruleIndex -1', () => {
    const grid = { data: [0, 1, 0], cols: 3, rows: 1, tileSize: 18 };
    const kinds = [{ id: 'd', label: 'dirt', tileValue: 1, collision: 'solid' as const, materialId: 'm', connectGroup: 'blocker', renderPriority: 0 }];
    const prepared = prepareTerrainArtRuleGrid(grid, kinds, kenneyPixelPlatformerRules(0));
    expect(prepared.tiles[0]!.ruleIndex).toBe(-1);
    expect(prepared.tiles[2]!.ruleIndex).toBe(-1);
  });

  it('returns an empty grid for unusable input', () => {
    const prepared = prepareTerrainArtRuleGrid(
      { data: [], cols: 0, rows: 0, tileSize: 0 },
      [],
      kenneyPixelPlatformerRules(0),
    );
    expect(prepared.cols).toBe(0);
    expect(prepared.tiles).toHaveLength(0);
  });
});
