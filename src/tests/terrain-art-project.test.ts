import { describe, expect, it } from 'vitest';
import {
  TERRAIN_ART_PROJECT_VERSION,
  createTerrainArtProject,
  deserializeTerrainArtProject,
  serializeTerrainArtProject,
  validateTerrainArtProject,
} from '../terrain-art';

describe('terrain-art project source model', () => {
  it('creates a complete valid procedural starting point', () => {
    const project = createTerrainArtProject({ id: 'forest', name: 'Forest' });
    const validation = validateTerrainArtProject(project);

    expect(project).toMatchObject({
      version: TERRAIN_ART_PROJECT_VERSION,
      id: 'forest',
      name: 'Forest',
      authoringResolution: 64,
      visualSeed: 1337,
    });
    expect(project.terrainKinds.map((kind) => kind.id)).toEqual(['empty', 'solid']);
    expect(project.materials).toHaveLength(1);
    expect(project.materials[0]?.layers.map((layer) => layer.type)).toEqual([
      'base', 'shading', 'contour', 'decoration', 'manual',
    ]);
    expect(project.materials[0]?.variants).toEqual([
      expect.objectContaining({ id: 'default', weight: 1 }),
    ]);
    expect(validation.valid).toBe(true);
    expect(validation.diagnostics).toEqual([]);
  });

  it('clamps authoring resolution and sanitizes blank identity options', () => {
    expect(createTerrainArtProject({
      id: '   ',
      name: '',
      authoringResolution: 999,
    })).toMatchObject({
      id: 'terrain-art',
      name: 'Terrain art',
      authoringResolution: 128,
    });
  });

  it('reports duplicate tile values and missing material references', () => {
    const project = createTerrainArtProject();
    const malformed = {
      ...project,
      terrainKinds: [
        ...project.terrainKinds,
        {
          ...project.terrainKinds[1],
          id: 'duplicate',
          materialId: 'missing',
        },
      ],
    };
    const validation = validateTerrainArtProject(malformed);

    expect(validation.valid).toBe(false);
    expect(validation.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate-tile-value' }),
      expect.objectContaining({ code: 'missing-material' }),
    ]));
  });

  it('round-trips a canonical source document without live host objects', () => {
    const project = createTerrainArtProject({
      id: 'cavern',
      visualSeed: 42,
      authoringResolution: 32,
    });
    const source = serializeTerrainArtProject(project);
    const restored = deserializeTerrainArtProject(source);

    expect(restored).toEqual(project);
    expect(serializeTerrainArtProject(restored!)).toBe(source);
  });

  it('rejects malformed, unsupported, and structurally invalid input', () => {
    expect(deserializeTerrainArtProject('{')).toBeNull();
    expect(deserializeTerrainArtProject(JSON.stringify({
      ...createTerrainArtProject(),
      version: 999,
    }))).toBeNull();
    expect(deserializeTerrainArtProject(JSON.stringify({
      ...createTerrainArtProject(),
      terrainKinds: [],
    }))).toBeNull();
  });

  it('migrates the version-zero source fixture through the explicit ladder', () => {
    const current = createTerrainArtProject();
    const legacy = { ...current, version: 0 } as Record<string, unknown>;
    delete legacy.transitionRules; delete legacy.occurrenceOverrides;
    expect(deserializeTerrainArtProject(JSON.stringify(legacy))).toEqual(current);
  });
});
