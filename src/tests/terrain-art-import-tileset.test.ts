import { describe, expect, it } from 'vitest';
import {
  importTerrainArtTilesetAtlas,
  createImportedTerrainArtMaterial,
  kenneyPixelPlatformerRoles,
  TERRAIN_TILESET_ROLE_KEYS,
  generateTerrainArtMaterialAtlas,
  createTerrainArtProject,
  terrainArtMaterialResolution,
  resizeTerrainArtProject,
  validateTerrainArtProject,
  createTerrainArtTilesetResolver,
  createTerrainArtTilesetBinding,
  compileTerrainArtRuntime,
  serializeTerrainArtProject,
  deserializeTerrainArtProject,
  type TerrainTilesetRoleMap,
  type TerrainTilesetSource,
} from '../terrain-art';

/**
 * A 3×3 wall block where every tile is a single flat colour. That makes each
 * output pixel traceable to exactly one source role, so the quadrant algebra can
 * be asserted directly rather than eyeballed.
 */
const ROLE_COLOR: Record<string, number> = {
  fill: 10,
  top: 20,
  right: 30,
  bottom: 40,
  left: 50,
  topLeft: 60,
  topRight: 70,
  bottomRight: 80,
  bottomLeft: 90,
};

const LAYOUT: readonly (readonly string[])[] = [
  ['topLeft', 'top', 'topRight'],
  ['left', 'fill', 'right'],
  ['bottomLeft', 'bottom', 'bottomRight'],
];

function flatRoles(): TerrainTilesetRoleMap {
  const map: Record<string, { col: number; row: number }> = {};
  LAYOUT.forEach((row, rowIndex) => row.forEach((role, colIndex) => {
    map[role] = { col: colIndex, row: rowIndex };
  }));
  return map as unknown as TerrainTilesetRoleMap;
}

function flatSource(tileSize = 8, margin = 0, spacing = 0): TerrainTilesetSource {
  const stride = tileSize + spacing;
  const width = margin + stride * 3;
  const height = margin + stride * 3;
  const pixels = new Uint8ClampedArray(width * height * 4);
  LAYOUT.forEach((row, rowIndex) => row.forEach((role, colIndex) => {
    const originX = margin + colIndex * stride;
    const originY = margin + rowIndex * stride;
    for (let y = 0; y < tileSize; y++) for (let x = 0; x < tileSize; x++) {
      const offset = ((originY + y) * width + originX + x) * 4;
      pixels[offset] = ROLE_COLOR[role]!;
      pixels[offset + 1] = ROLE_COLOR[role]!;
      pixels[offset + 2] = ROLE_COLOR[role]!;
      pixels[offset + 3] = 255;
    }
  }));
  return { pixels, width, height, tileSize, margin, spacing };
}

/** Read the role that produced the centre pixel of one output quadrant. */
function quadrantRole(
  atlas: ReturnType<typeof importTerrainArtTilesetAtlas>,
  mask: number,
  corner: 'nw' | 'ne' | 'se' | 'sw',
): string | 'empty' {
  const t = atlas.tileSize;
  const half = Math.ceil(t / 2);
  const baseX = (mask % 4) * t + (corner === 'ne' || corner === 'se' ? half : 0);
  const baseY = Math.floor(mask / 4) * t + (corner === 'sw' || corner === 'se' ? half : 0);
  const quarter = Math.floor(half / 2);
  const offset = ((baseY + quarter) * atlas.width + baseX + quarter) * 4;
  if (atlas.pixels[offset + 3] === 0) return 'empty';
  const value = atlas.pixels[offset];
  return Object.keys(ROLE_COLOR).find((role) => ROLE_COLOR[role] === value) ?? 'unknown';
}

describe('quarter-tile tileset import', () => {
  it('keeps the source tile size instead of resampling', () => {
    for (const tileSize of [8, 16, 18, 32]) {
      const atlas = importTerrainArtTilesetAtlas(flatSource(tileSize), flatRoles(), { materialId: 'imported' });
      expect(atlas.tileSize).toBe(tileSize);
      expect(atlas.width).toBe(tileSize * 4);
      expect(atlas.height).toBe(tileSize * 4);
      expect(atlas.pixels.length).toBe(tileSize * 4 * tileSize * 4 * 4);
    }
  });

  it('leaves mask 0 fully transparent and mask 15 fully filled', () => {
    const atlas = importTerrainArtTilesetAtlas(flatSource(), flatRoles(), { materialId: 'imported' });
    for (const corner of ['nw', 'ne', 'se', 'sw'] as const) {
      expect(quadrantRole(atlas, 0, corner)).toBe('empty');
      expect(quadrantRole(atlas, 15, corner)).toBe('fill');
    }
  });

  it('renders a lone corner with the art for the faces it exposes', () => {
    const atlas = importTerrainArtTilesetAtlas(flatSource(), flatRoles(), { materialId: 'imported' });
    // A dual tile is offset half a cell, so a quadrant shows the *opposite*
    // corner of the logical cell it draws: the north-west quadrant of the tile
    // draws that cell's bottom-right quarter, and is exposed right and below.
    const cases = [
      [1, 'nw', 'bottomRight'],
      [2, 'ne', 'bottomLeft'],
      [4, 'se', 'topLeft'],
      [8, 'sw', 'topRight'],
    ] as const;
    for (const [mask, corner, role] of cases) {
      expect(quadrantRole(atlas, mask, corner)).toBe(role);
      for (const other of (['nw', 'ne', 'se', 'sw'] as const).filter((value) => value !== corner)) {
        expect(quadrantRole(atlas, mask, other)).toBe('empty');
      }
    }
  });

  it('exposes the outward face of a half-filled tile', () => {
    const atlas = importTerrainArtTilesetAtlas(flatSource(), flatRoles(), { materialId: 'imported' });
    // Top half solid, bottom empty: a ceiling, so the bottom face is exposed.
    expect(quadrantRole(atlas, 3, 'nw')).toBe('bottom');
    expect(quadrantRole(atlas, 3, 'ne')).toBe('bottom');
    // Bottom half solid: ground, top face exposed.
    expect(quadrantRole(atlas, 12, 'sw')).toBe('top');
    expect(quadrantRole(atlas, 12, 'se')).toBe('top');
    // Left half solid: right face exposed.
    expect(quadrantRole(atlas, 9, 'nw')).toBe('right');
    expect(quadrantRole(atlas, 9, 'sw')).toBe('right');
    // Right half solid: left face exposed.
    expect(quadrantRole(atlas, 6, 'ne')).toBe('left');
    expect(quadrantRole(atlas, 6, 'se')).toBe('left');
  });

  it('forms a concave corner from two edge quadrants without inner-corner art', () => {
    const atlas = importTerrainArtTilesetAtlas(flatSource(), flatRoles(), { materialId: 'imported' });
    // Mask 7 = NW+NE+SE, south-west notched out. The notch's top face belongs to
    // NW and its right face to SE; they meet at the tile centre. NE is interior.
    expect(quadrantRole(atlas, 7, 'nw')).toBe('bottom');
    expect(quadrantRole(atlas, 7, 'se')).toBe('left');
    expect(quadrantRole(atlas, 7, 'ne')).toBe('fill');
    expect(quadrantRole(atlas, 7, 'sw')).toBe('empty');
    // Mask 11 = NW+NE+SW, south-east notched out.
    expect(quadrantRole(atlas, 11, 'ne')).toBe('bottom');
    expect(quadrantRole(atlas, 11, 'sw')).toBe('right');
    expect(quadrantRole(atlas, 11, 'nw')).toBe('fill');
    expect(quadrantRole(atlas, 11, 'se')).toBe('empty');
  });

  it('treats diagonal masks as two independent outer corners', () => {
    const atlas = importTerrainArtTilesetAtlas(flatSource(), flatRoles(), { materialId: 'imported' });
    expect(quadrantRole(atlas, 5, 'nw')).toBe('bottomRight');
    expect(quadrantRole(atlas, 5, 'se')).toBe('topLeft');
    expect(quadrantRole(atlas, 5, 'ne')).toBe('empty');
    expect(quadrantRole(atlas, 10, 'ne')).toBe('bottomLeft');
    expect(quadrantRole(atlas, 10, 'sw')).toBe('topRight');
  });

  /**
   * Guards the inversion directly: an isolated logical cell is drawn as four
   * quadrants spread across four neighbouring dual tiles, and those four must
   * reassemble into a complete cell — grass on top, not underneath.
   */
  it('reassembles an isolated cell with its corners the right way up', () => {
    const atlas = importTerrainArtTilesetAtlas(flatSource(), flatRoles(), { materialId: 'imported' });
    // Cell (c,r) is the SE corner of dual (c,r), SW of (c+1,r), NE of (c,r+1)
    // and NW of (c+1,r+1) — masks 4, 8, 2 and 1 when the cell stands alone.
    expect(quadrantRole(atlas, 4, 'se')).toBe('topLeft');
    expect(quadrantRole(atlas, 8, 'sw')).toBe('topRight');
    expect(quadrantRole(atlas, 2, 'ne')).toBe('bottomLeft');
    expect(quadrantRole(atlas, 1, 'nw')).toBe('bottomRight');
  });

  it('covers every mask with the expected opaque quadrant count', () => {
    const atlas = importTerrainArtTilesetAtlas(flatSource(), flatRoles(), { materialId: 'imported' });
    for (let mask = 0; mask < 16; mask++) {
      const filled = (['nw', 'ne', 'se', 'sw'] as const)
        .filter((corner) => quadrantRole(atlas, mask, corner) !== 'empty').length;
      const bits = [1, 2, 4, 8].filter((bit) => (mask & bit) !== 0).length;
      expect(filled).toBe(bits);
    }
  });

  it('honours margin and spacing', () => {
    const plain = importTerrainArtTilesetAtlas(flatSource(8, 0, 0), flatRoles(), { materialId: 'imported' });
    const padded = importTerrainArtTilesetAtlas(flatSource(8, 3, 2), flatRoles(), { materialId: 'imported' });
    expect(Array.from(padded.pixels)).toEqual(Array.from(plain.pixels));
  });

  it('is deterministic', () => {
    const a = importTerrainArtTilesetAtlas(flatSource(), flatRoles(), { materialId: 'imported' });
    const b = importTerrainArtTilesetAtlas(flatSource(), flatRoles(), { materialId: 'imported' });
    expect(Array.from(a.pixels)).toEqual(Array.from(b.pixels));
  });

  it('reassembles odd tile sizes without gaps', () => {
    const atlas = importTerrainArtTilesetAtlas(flatSource(9), flatRoles(), { materialId: 'imported' });
    expect(atlas.tileSize).toBe(9);
    // Mask 15 is entirely fill, so every pixel of that tile must be opaque.
    const originX = (15 % 4) * 9;
    const originY = Math.floor(15 / 4) * 9;
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
      const offset = ((originY + y) * atlas.width + originX + x) * 4;
      expect(atlas.pixels[offset + 3]).toBe(255);
    }
  });

  it('returns a zero-sized atlas for unusable input rather than throwing', () => {
    const source = flatSource();
    const roles = flatRoles();
    const bad: readonly [TerrainTilesetSource, TerrainTilesetRoleMap][] = [
      [{ ...source, tileSize: 0 }, roles],
      [{ ...source, width: 0 }, roles],
      [{ ...source, pixels: new Uint8ClampedArray(4) }, roles],
      // A role pointing past the edge of the sheet.
      [source, { ...roles, fill: { col: 99, row: 0 } }],
      [source, { ...roles, fill: { col: -1, row: 0 } }],
      [source, { ...roles, fill: { col: 0.5, row: 0 } } as unknown as TerrainTilesetRoleMap],
    ];
    for (const [badSource, badRoles] of bad) {
      const atlas = importTerrainArtTilesetAtlas(badSource, badRoles, { materialId: 'imported' });
      expect(atlas.tileSize).toBe(0);
      expect(atlas.width).toBe(0);
      expect(atlas.pixels.length).toBe(0);
    }
  });

  it('exposes all nine role keys', () => {
    expect([...TERRAIN_TILESET_ROLE_KEYS].sort()).toEqual(Object.keys(ROLE_COLOR).sort());
  });

  it('maps the Kenney block to in-bounds tiles for every surface row', () => {
    for (const surface of [0, 1, 2, 3, 4, 5] as const) {
      const roles = kenneyPixelPlatformerRoles(surface);
      for (const key of TERRAIN_TILESET_ROLE_KEYS) {
        expect(roles[key].col).toBeGreaterThanOrEqual(0);
        expect(roles[key].col).toBeLessThan(20);
        expect(roles[key].row).toBeGreaterThanOrEqual(0);
        expect(roles[key].row).toBeLessThan(9);
      }
      expect(roles.top.row).toBe(surface);
      expect(roles.fill.row).toBe(6);
      expect(roles.bottom.row).toBe(7);
    }
  });
});

describe('per-material art resolution', () => {
  it('falls back to the project resolution when unset', () => {
    expect(terrainArtMaterialResolution(64, undefined)).toBe(64);
    expect(terrainArtMaterialResolution(64, 18)).toBe(18);
    expect(terrainArtMaterialResolution(64, 0)).toBe(64);
    expect(terrainArtMaterialResolution(64, 1.5)).toBe(64);
    expect(terrainArtMaterialResolution(0, undefined)).toBe(0);
  });

  it('generates a procedural atlas at the material resolution', () => {
    const base = createTerrainArtProject({ authoringResolution: 64 });
    expect(generateTerrainArtMaterialAtlas(base, 'solid').tileSize).toBe(64);
    const pinned = {
      ...base,
      materials: base.materials.map((material) => ({ ...material, resolution: 18 })),
    };
    const atlas = generateTerrainArtMaterialAtlas(pinned, 'solid');
    expect(atlas.tileSize).toBe(18);
    expect(atlas.width).toBe(72);
    // The mask-15 tile must still be rendered, not blank.
    expect(atlas.pixels.some((value) => value !== 0)).toBe(true);
  });

  it('accepts a pinned resolution as valid and rejects out-of-range values', () => {
    const base = createTerrainArtProject({ authoringResolution: 64 });
    const pinned = { ...base, materials: base.materials.map((m) => ({ ...m, resolution: 18 })) };
    expect(validateTerrainArtProject(pinned).valid).toBe(true);
    const broken = { ...base, materials: base.materials.map((m) => ({ ...m, resolution: 4096 })) };
    const result = validateTerrainArtProject(broken);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'invalid-material-resolution')).toBe(true);
  });

  it('leaves pinned materials alone when the project resolution migrates', () => {
    const base = createTerrainArtProject({ authoringResolution: 64 });
    const withPatch = {
      ...base,
      materials: base.materials.map((material) => ({
        ...material,
        resolution: 18,
        layers: material.layers.map((layer) => layer.type !== 'manual' ? layer : ({
          ...layer,
          patches: [{ mask: 15 as const, variantId: 'default', runs: [{ y: 4, x: 4, length: 4, mode: 'paint' as const, rgba: 0xff0000ff }] }],
        })),
      })),
    };
    const resized = resizeTerrainArtProject(withPatch, 128);
    expect(resized.authoringResolution).toBe(128);
    const run = resized.materials[0]!.layers.find((layer) => layer.type === 'manual')!.patches![0]!.runs[0]!;
    expect(run).toEqual({ y: 4, x: 4, length: 4, mode: 'paint', rgba: 0xff0000ff });
  });

  it('builds an imported material that pins its resolution and drops procedural layers', () => {
    const material = createImportedTerrainArtMaterial('kenney', 'Kenney Grass', 18, 'kenney-grass');
    expect(material.resolution).toBe(18);
    expect(material.layers.map((layer) => layer.type)).toEqual(['imported', 'manual']);
    expect(material.layers[0]!.assetId).toBe('kenney-grass');
  });
});

describe('imported layers through the normal render path', () => {
  const TILE = 8;

  function importedProject(binding = createTerrainArtTilesetBinding(TILE, flatRoles())) {
    const base = createTerrainArtProject({ authoringResolution: 64 });
    return {
      ...base,
      materials: [createImportedTerrainArtMaterial('sheet', 'Sheet', TILE, 'sheet-a', binding)],
      terrainKinds: base.terrainKinds.map((kind) => kind.materialId === null ? kind : { ...kind, materialId: 'sheet' }),
    };
  }

  function images(source = flatSource(TILE)) {
    return { 'sheet-a': { pixels: source.pixels, width: source.width, height: source.height } };
  }

  it('composites imported art through generateTerrainArtMaterialAtlas', () => {
    const project = importedProject();
    const resolver = createTerrainArtTilesetResolver(images());
    const withResolver = generateTerrainArtMaterialAtlas(project, 'sheet', 'default', resolver);
    expect(withResolver.tileSize).toBe(TILE);
    expect(withResolver.pixels.some((value, index) => index % 4 === 3 && value !== 0)).toBe(true);
    // Same call without a resolver has nothing to draw.
    const without = generateTerrainArtMaterialAtlas(project, 'sheet');
    expect(without.tileSize).toBe(TILE);
    expect(without.pixels.some((value, index) => index % 4 === 3 && value !== 0)).toBe(false);
  });

  it('matches the atlas the importer assembles directly', () => {
    const direct = importTerrainArtTilesetAtlas(flatSource(TILE), flatRoles(), { materialId: 'sheet' });
    const composited = generateTerrainArtMaterialAtlas(
      importedProject(),
      'sheet',
      'default',
      createTerrainArtTilesetResolver(images()),
    );
    expect(Array.from(composited.pixels)).toEqual(Array.from(direct.pixels));
  });

  it('reaches the compiled runtime atlases too', () => {
    const runtime = compileTerrainArtRuntime(
      importedProject(),
      1,
      createTerrainArtTilesetResolver(images()),
    );
    expect(runtime.atlases).toHaveLength(1);
    expect(runtime.atlases[0]!.tileSize).toBe(TILE);
    expect(runtime.atlases[0]!.pixels.some((value, index) => index % 4 === 3 && value !== 0)).toBe(true);
  });

  it('refuses a binding whose tile size disagrees with the material resolution', () => {
    // Material pinned to 8, tileset sliced at 4: rescaling would hide the error.
    const mismatched = createTerrainArtTilesetBinding(4, flatRoles());
    const atlas = generateTerrainArtMaterialAtlas(
      importedProject(mismatched),
      'sheet',
      'default',
      createTerrainArtTilesetResolver(images()),
    );
    expect(atlas.pixels.some((value, index) => index % 4 === 3 && value !== 0)).toBe(false);
  });

  it('declines unknown assets and layers with no binding', () => {
    const resolver = createTerrainArtTilesetResolver(images());
    const binding = createTerrainArtTilesetBinding(TILE, flatRoles());
    expect(resolver({ assetId: 'missing', materialId: 'sheet', mask: 15, variantId: 'default', width: TILE, height: TILE, tileset: binding })).toBeNull();
    expect(resolver({ assetId: 'sheet-a', materialId: 'sheet', mask: 15, variantId: 'default', width: TILE, height: TILE })).toBeNull();
  });

  it('round-trips the binding through serialization', () => {
    const project = importedProject();
    const restored = deserializeTerrainArtProject(serializeTerrainArtProject(project as never));
    expect(restored).not.toBeNull();
    const layer = restored!.materials[0]!.layers.find((entry) => entry.type === 'imported')!;
    expect(layer.tileset?.tileSize).toBe(TILE);
    expect(layer.tileset?.roles.fill).toEqual({ col: 1, row: 1 });
    // And the restored project still renders identically.
    const before = generateTerrainArtMaterialAtlas(project, 'sheet', 'default', createTerrainArtTilesetResolver(images()));
    const after = generateTerrainArtMaterialAtlas(restored!, 'sheet', 'default', createTerrainArtTilesetResolver(images()));
    expect(Array.from(after.pixels)).toEqual(Array.from(before.pixels));
  });

  it('assembles each tileset once however many masks are requested', () => {
    let reads = 0;
    const source = flatSource(TILE);
    const counting = {
      'sheet-a': {
        get pixels() { reads++; return source.pixels; },
        width: source.width,
        height: source.height,
      },
    };
    const resolver = createTerrainArtTilesetResolver(counting);
    generateTerrainArtMaterialAtlas(importedProject(), 'sheet', 'default', resolver);
    // Sixteen masks, one assembly.
    expect(reads).toBe(1);
  });
});
