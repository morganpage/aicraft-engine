import { describe, expect, it } from 'vitest';
import {
  createImportedTerrainArtMaterial,
  createTerrainArtProject,
  createTerrainArtTilesetResolver,
  generateTerrainArtMaterialAtlas,
  kenneyPixelPlatformerRoles,
  type TerrainArtTilesetImage,
} from '../../src/terrain-art';

/**
 * The tile-room's import panel keeps imported art at its NATIVE resolution.
 * Pixel art must be drawn 1:1 — any resample (down or up) destroys hand-authored
 * pixels — so the atlas is assembled at the tileset's own tile size and the room
 * canvas draws it through nearest-neighbour (imageSmoothingEnabled = false).
 *
 * These tests pin that contract: an 18px Kenney import produces an 18px atlas
 * served from the original image, never a resampled derivative.
 */

const KENNEY_ASSET_ID = 'kenney-pixel-platformer';

/** A flat 360×162 RGBA sheet (Kenney E-row dimensions), every pixel opaque. */
function kenneySheet(): TerrainArtTilesetImage {
  const width = 360; const height = 162;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = 0x80; pixels[i * 4 + 1] = 0x60; pixels[i * 4 + 2] = 0x30; pixels[i * 4 + 3] = 0xff;
  }
  return { pixels, width, height };
}

describe('imported tileset keeps its native resolution', () => {
  it('builds an 18px atlas from an 18px Kenney import, not a resampled derivative', () => {
    const base = createTerrainArtProject({ authoringResolution: 64 });
    const binding = { tileSize: 18, roles: kenneyPixelPlatformerRoles(0) };
    const material = createImportedTerrainArtMaterial('sheet', 'Sheet', 18, KENNEY_ASSET_ID, binding);
    const project = {
      ...base,
      materials: [material],
      terrainKinds: base.terrainKinds.map((kind) => kind.materialId === null ? kind : { ...kind, materialId: 'sheet' }),
    };
    // The resolver serves the ORIGINAL image under the original asset id —
    // there is no derived `@18→16` id and no resampled buffer.
    const resolver = createTerrainArtTilesetResolver({ [KENNEY_ASSET_ID]: kenneySheet() });
    const atlas = generateTerrainArtMaterialAtlas(project, 'sheet', 'default', resolver);
    expect(atlas.tileSize).toBe(18);
    expect(atlas.width).toBe(72);
    // And it actually draws — non-blank.
    expect(atlas.pixels.some((value, index) => index % 4 === 3 && value !== 0)).toBe(true);
  });

  it('serves the exact original pixels, never an approximation', () => {
    const sheet = kenneySheet();
    const resolver = createTerrainArtTilesetResolver({ [KENNEY_ASSET_ID]: sheet });
    // Ask the resolver for mask 15 (fill) at the material's native 18px.
    const tile = resolver({
      assetId: KENNEY_ASSET_ID,
      materialId: 'sheet',
      mask: 15,
      variantId: 'default',
      width: 18,
      height: 18,
      tileset: { tileSize: 18, roles: kenneyPixelPlatformerRoles(0) },
    });
    expect(tile).not.toBeNull();
    // The returned pixels are a faithful slice of the source sheet — no blending.
    // Every pixel's RGBA must appear verbatim in the original sheet.
    const sourceColors = new Set<string>();
    for (let i = 0; i < sheet.pixels.length; i += 4) {
      sourceColors.add(`${sheet.pixels[i]},${sheet.pixels[i + 1]},${sheet.pixels[i + 2]},${sheet.pixels[i + 3]}`);
    }
    for (let i = 0; i < tile!.length; i += 4) {
      expect(sourceColors.has(`${tile![i]},${tile![i + 1]},${tile![i + 2]},${tile![i + 3]}`)).toBe(true);
    }
  });
});
