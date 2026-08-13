import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseLdtkProject } from '../ldtk/parse';
import { inspectLdtkPlatformerProject } from '../ldtk/preflight';
import type { LdtkLevel, LdtkProject } from '../ldtk/types';

/** Path to the adversarial Celerock fixture. */
const FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/celerock-adversarial.ldtk', import.meta.url),
);

function parseFixture(): LdtkProject {
  const text = readFileSync(FIXTURE_PATH, 'utf8');
  const parsed = parseLdtkProject(text);
  if (!parsed.ok || parsed.project === undefined) {
    throw new Error(`fixture failed to parse: ${JSON.stringify(parsed.errors)}`);
  }
  return parsed.project;
}

describe('inspectLdtkPlatformerProject', () => {
  it('reports the adversarial fixture correctly', () => {
    const project = parseFixture();
    const report = inspectLdtkPlatformerProject(project);

    expect(report.levelCount).toBe(2);
    expect(report.levels).toHaveLength(2);

    // One spawn room (Level_0 has Player), one spawn-less (Level_1).
    expect(report.totalSpawns).toBe(1);
    expect(report.spawnLessRoomIids).toHaveLength(1);
    const spawnRoom = report.levels.find((l) => l.hasSpawn);
    const spawnLessRoom = report.levels.find((l) => !l.hasSpawn);
    expect(spawnRoom).toBeDefined();
    expect(spawnLessRoom).toBeDefined();
    expect(spawnRoom?.identifier).toBe('Level_0');
    expect(spawnRoom?.spawn).toBeDefined();
    expect(spawnRoom?.spawn?.x).toBe(16); // Player px[0]
    expect(spawnRoom?.spawn?.y).toBe(100); // Player px[1]
    expect(report.spawnLessRoomIids[0]).toBe(spawnLessRoom?.iid);

    // Tile size is uniform (8px) across both levels.
    expect(report.tileSizes).toEqual([8]);

    // Cardinal neighbour links both rooms → both connected.
    expect(report.disconnectedRoomIids).toHaveLength(0);
    for (const level of report.levels) {
      expect(level.connected).toBe(true);
    }

    // Both rooms reference each other via __neighbours.
    expect(spawnRoom?.neighbourIids).toContain(spawnLessRoom?.iid);
    expect(spawnLessRoom?.neighbourIids).toContain(spawnRoom?.iid);

    // Capabilities aggregated across both levels.
    expect(report.capabilities.hazards).toBe(true); // Spike
    expect(report.capabilities.collectibles).toBe(true); // Gem
    expect(report.capabilities.springs).toBe(true); // Spring + SuperSpring
    expect(report.capabilities.dashRefills).toBe(true); // DashRefill
    expect(report.capabilities.exits).toBe(true); // Exit
    expect(report.capabilities.movingPlatforms).toBe(true); // MovingPlatform
    expect(report.capabilities.ladders).toBe(true); // IntGrid value 3 = 'ladder'

    // Spring & DashRefill are RECOGNIZED — they must not appear as unknown.
    expect(report.unknownTriggerIdentifiers).not.toContain('Spring');
    expect(report.unknownTriggerIdentifiers).not.toContain('DashRefill');
    expect(report.unknownTriggerIdentifiers).toEqual([]);

    // Per-level entity counts are keyed by resolved engine kind.
    const counts0 = spawnRoom?.entityCounts ?? {};
    expect(counts0['spawn']).toBe(1);
    expect(counts0['exit']).toBe(1);
    expect(counts0['spring']).toBe(2); // Spring + SuperSpring
    expect(counts0['hazard']).toBe(1);
    expect(counts0['collectible']).toBe(1);
    expect(counts0['dashRefill']).toBe(1);
    expect(counts0['movingPlatform']).toBe(1);

    // The fixture's tileset relPath (with space + brackets) is surfaced.
    expect(report.tilesetRelPaths).toEqual(['../gfx/[v1] tranquil set.png']);
  });

  it('lists unknown entity identifiers as unknownTriggerIdentifiers', () => {
    const project = parseFixture();
    // Inject a Mystery entity into Level_0's Entities layer.
    const mutated: LdtkProject = {
      ...project,
      levels: project.levels.map((level, i) =>
        i === 0
          ? {
              ...level,
              layerInstances: (level.layerInstances ?? []).map((layer) =>
                layer.__type === 'Entities'
                  ? {
                      ...layer,
                      entityInstances: [
                        ...(layer.entityInstances ?? []),
                        {
                          __identifier: 'MysteryChest',
                          defUid: 999,
                          iid: 'mystery-1',
                          __tags: [],
                          px: [10, 10],
                          width: 8,
                          height: 8,
                          __grid: [1, 1],
                          __pivot: [0, 0],
                          __tile: null,
                          fieldInstances: [],
                        },
                      ],
                    }
                  : layer,
              ),
            }
          : level,
      ),
    };

    const report = inspectLdtkPlatformerProject(mutated);
    expect(report.unknownTriggerIdentifiers).toContain('MysteryChest');
    const spawnRoom = report.levels.find((l) => l.hasSpawn);
    expect(spawnRoom?.entityCounts['trigger']).toBe(1);
  });

  it('flags a disconnected room when there are no neighbour links', () => {
    // Two levels, no __neighbours; one has a spawn, one does not.
    const levelA: LdtkLevel = {
      identifier: 'A',
      iid: 'aaaa',
      uid: 1,
      pxWid: 16,
      pxHei: 16,
      worldX: 0,
      worldY: 0,
      worldDepth: 0,
      fieldInstances: [],
      externalRelPath: null,
      __neighbours: [],
      layerInstances: [
        {
          __type: 'IntGrid',
          __identifier: 'Collisions',
          __cWid: 2,
          __cHei: 2,
          __gridSize: 8,
          __opacity: 1,
          __pxTotalOffsetX: 0,
          __pxTotalOffsetY: 0,
          visible: true,
          iid: 'a-l',
          levelId: 'aaaa',
          layerDefUid: 1,
          intGridCsv: [1, 1, 1, 1],
          __tilesetDefUid: null,
          __tilesetRelPath: null,
        },
        {
          __type: 'Entities',
          __identifier: 'Entities',
          __cWid: 2,
          __cHei: 2,
          __gridSize: 8,
          __opacity: 1,
          __pxTotalOffsetX: 0,
          __pxTotalOffsetY: 0,
          visible: true,
          iid: 'a-e',
          levelId: 'aaaa',
          layerDefUid: 2,
          entityInstances: [
            {
              __identifier: 'Player',
              defUid: 30,
              iid: 'a-p',
              __tags: [],
              px: [0, 0],
              width: 8,
              height: 8,
              __grid: [0, 0],
              __pivot: [0, 0],
              __tile: null,
              fieldInstances: [],
            },
          ],
          __tilesetDefUid: null,
          __tilesetRelPath: null,
        },
      ],
    };
    const levelB: LdtkLevel = {
      ...levelA,
      identifier: 'B',
      iid: 'bbbb',
      uid: 2,
      __neighbours: [],
      layerInstances: (levelA.layerInstances ?? []).map((l) =>
        l.__type === 'Entities'
          ? { ...l, entityInstances: [], iid: 'b-e', levelId: 'bbbb' }
          : { ...l, iid: 'b-l', levelId: 'bbbb' },
      ),
    };

    const project: LdtkProject = {
      jsonVersion: '1.5.3',
      iid: 'proj',
      bgColor: '#000000',
      defs: { tilesets: [], enums: [], layers: [], entities: [] },
      levels: [levelA, levelB],
      externalLevels: false,
      worldLayout: null,
      worldGridWidth: null,
      worldGridHeight: null,
      worlds: [],
    };

    const report = inspectLdtkPlatformerProject(project);

    expect(report.levelCount).toBe(2);
    expect(report.totalSpawns).toBe(1);
    expect(report.disconnectedRoomIids).toEqual(['bbbb']);
    const a = report.levels.find((l) => l.iid === 'aaaa');
    const b = report.levels.find((l) => l.iid === 'bbbb');
    expect(a?.connected).toBe(true);
    expect(b?.connected).toBe(false);
    // B has no spawn AND is disconnected → both diagnostics surfaces.
    expect(report.spawnLessRoomIids).toEqual(['bbbb']);
    expect(report.diagnostics.some((d) => /disconnected/.test(d.message))).toBe(true);
    expect(report.diagnostics.some((d) => /without a spawn/.test(d.message))).toBe(true);
  });

  it('is pure: identical input yields identical output', () => {
    const project = parseFixture();
    const a = inspectLdtkPlatformerProject(project);
    const b = inspectLdtkPlatformerProject(project);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('handles an empty project without throwing', () => {
    const empty: LdtkProject = {
      jsonVersion: '1.5.3',
      iid: 'e',
      bgColor: '#000000',
      defs: { tilesets: [], enums: [], layers: [], entities: [] },
      levels: [],
      externalLevels: false,
      worldLayout: null,
      worldGridWidth: null,
      worldGridHeight: null,
      worlds: [],
    };
    const report = inspectLdtkPlatformerProject(empty);
    expect(report.levelCount).toBe(0);
    expect(report.totalSpawns).toBe(0);
    expect(report.spawnLessRoomIids).toEqual([]);
    expect(report.disconnectedRoomIids).toEqual([]);
    expect(report.unknownTriggerIdentifiers).toEqual([]);
    expect(report.capabilities.hazards).toBe(false);
  });
});
