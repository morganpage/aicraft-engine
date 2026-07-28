import { describe, expect, it } from 'vitest';
import {
  CAVERN_TERRAIN_MATERIAL,
  createTerrainMaterialTable,
  normalizeTerrainMaterial,
  type NormalizedTerrainMaterial,
} from '../terrain';

describe('terrain material normalization', () => {
  it('validates colors, derives the palette, and clamps geometry once', () => {
    const material = normalizeTerrainMaterial({
      id: 'test',
      palette: { fill: '#804020', top: 'bad' },
      topThickness: -10,
      sideDepth: 100,
      detailDensity: 5,
      surfaceDetail: 'cracks',
    });
    expect(material.palette.fill).toBe('#804020');
    expect(material.palette.top).not.toBe('bad');
    expect(material.topThickness).toBe(0);
    expect(material.sideDepth).toBe(24);
    expect(material.detailDensity).toBe(1);
    expect(material.edgeDetail).toBe('none');
    expect(material.edgeDensity).toBeGreaterThan(0);
    expect(material.channelId).toBeTypeOf('number');
  });

  it('is idempotent and tables expose only normalized entries', () => {
    expect(normalizeTerrainMaterial(CAVERN_TERRAIN_MATERIAL)).toBe(CAVERN_TERRAIN_MATERIAL);
    const table = createTerrainMaterialTable({
      1: { id: 'stone', palette: { fill: '#556677' } },
    });
    expect(table.get(1)?.id).toBe('stone');
    expect(table.get(2)).toBeUndefined();
  });

  it('does not allow structural literals to satisfy the normalized contract', () => {
    // @ts-expect-error the private normalization brand is intentionally absent
    const forged: NormalizedTerrainMaterial = {
      id: 'forged',
      channelId: 1,
      palette: {
        fill: '#000000', top: '#000000', side: '#000000',
        shadow: '#000000', outline: '#000000', detail: '#000000',
        accent: '#000000',
      },
      topThickness: 1,
      sideDepth: 1,
      outlineWidth: 1,
      cornerSize: 1,
      surfaceDetail: 'none',
      detailDensity: 0,
      detailScale: 1,
      edgeDetail: 'none',
      edgeDensity: 0,
      edgeScale: 1,
    };
    expect(forged.id).toBe('forged');
  });
});
