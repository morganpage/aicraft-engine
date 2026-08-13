/**
 * Regression test for the adversarial Celerock LDtk fixture.
 *
 * The fixture (`celerock-adversarial.ldtk`, alongside this file) is a
 * hand-authored, parseLdtkProject-valid LDtk project engineered to stress the
 * loader/translator on shapes the engine has historically mishandled:
 *
 *  - 8-pixel tiles (the Celerock scale), not the 16px LDtk default.
 *  - A tileset whose `relPath` contains a SPACE and BRACKETS — a real-world
 *    path that breaks naive string splitting and URL handling.
 *  - Two levels cardinally linked via `__neighbours` (East/West), where the
 *    eastern neighbour (`Level_1`) has NO Player/Spawn entity — the
 *    "spawn-less neighbour" case. The two rooms also differ in height
 *    (14 vs 16 tiles), producing a partial-overlap room seam.
 *  - Named IntGrid collision values `solid`, `passthrough`, and `ladder`, so
 *    `ldtkLevelToLevelData` derives solidity/passthrough/ladder semantics by
 *    name (the project-driven path) rather than magic integers.
 *  - A tall vertical wall mass (horizontal dash-bonk target) and a ceiling
 *    overhang (vertical/upward dash-bonk target) in Level_0.
 *  - Every Celerock entity flavour: Player, Spike, Gem, Spring, SuperSpring,
 *    DashRefill, MovingPlatform, Exit.
 *
 * Stability note: `Spring`/`SuperSpring`/`DashRefill` are mapped onto the
 * dedicated `spring`/`dashRefill` entity kinds by `LDTK_DEFAULT_ENTITY_MAP`
 * (Celerock hardening, Workstream B2). This fixture test only asserts the
 * entities survive into `level.entities` via a stable count + rect match (the
 * kind-specific assertions live in `src/tests/celerock-hardening.test.ts`),
 * so it stays focused on the loader/translator shapes this fixture stresses.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseLdtkProject, ldtkLevelToLevelData } from '../../ldtk';
import type { LdtkLevel } from '../../ldtk';

const FIXTURE_URL = new URL('./celerock-adversarial.ldtk', import.meta.url);

/** Read + parse the fixture once per invocation (small file, deterministic). */
function loadFixture(): { readonly text: string; readonly level0: LdtkLevel; readonly level1: LdtkLevel } {
  const text = readFileSync(FIXTURE_URL, 'utf8');
  const { project } = parseLdtkProject(text);
  if (project === undefined) throw new Error('fixture failed to parse');
  const level0 = project.levels.find((l) => l.identifier === 'Level_0');
  const level1 = project.levels.find((l) => l.identifier === 'Level_1');
  if (level0 === undefined || level1 === undefined) throw new Error('fixture missing levels');
  return { text, level0, level1 };
}

/** True iff `level` has at least one IntGrid collision layer instance. */
function hasIntGridLayer(level: LdtkLevel): boolean {
  return (level.layerInstances ?? []).some((l) => l.__type === 'IntGrid');
}

/** The identifiers of every entity placed in any Entities layer of `level`. */
function entityIdentifiers(level: LdtkLevel): readonly string[] {
  const out: string[] = [];
  for (const layer of level.layerInstances ?? []) {
    if (layer.__type !== 'Entities') continue;
    for (const e of layer.entityInstances ?? []) out.push(e.__identifier);
  }
  return out;
}

describe('celerock-adversarial.ldtk — parse', () => {
  it('parses cleanly with ok=true and at least two levels', () => {
    const { text } = loadFixture();
    const result = parseLdtkProject(text);
    expect(result.ok).toBe(true);
    expect(result.errors.filter((e) => e.severity === 'error')).toEqual([]);
    expect(result.project).toBeDefined();
    expect(result.project!.levels.length).toBeGreaterThanOrEqual(2);
  });

  it('declares a tileset whose relPath contains a space and brackets', () => {
    const { text } = loadFixture();
    const { project } = parseLdtkProject(text);
    const relPaths = project!.defs.tilesets.map((t) => t.relPath);
    expect(relPaths).toContain('../gfx/[v1] tranquil set.png');
    // Sanity: the adversarial conditions (space + brackets) are actually met.
    const adversarial = project!.defs.tilesets.find(
      (t) => t.relPath !== null && t.relPath.includes(' ') && t.relPath.includes('['),
    );
    expect(adversarial).toBeDefined();
    // 8-pixel tiles at the tileset level too.
    expect(adversarial!.tileGridSize).toBe(8);
  });

  it('links Level_0 → Level_1 cardinally via __neighbours (East)', () => {
    const { level0, level1 } = loadFixture();
    const east = level0.__neighbours.find((n) => n.dir === 'e');
    expect(east).toBeDefined();
    expect(east!.levelIid).toBe(level1.iid);
    // Reciprocal West link from Level_1 back to Level_0.
    const west = level1.__neighbours.find((n) => n.dir === 'w');
    expect(west?.levelIid).toBe(level0.iid);
  });
});

describe('celerock-adversarial.ldtk — collision layers & spawns', () => {
  it('gives both levels an IntGrid collision layer with 8px cells', () => {
    const { level0, level1 } = loadFixture();
    expect(hasIntGridLayer(level0)).toBe(true);
    expect(hasIntGridLayer(level1)).toBe(true);
    const ig0 = level0.layerInstances!.find((l) => l.__type === 'IntGrid')!;
    const ig1 = level1.layerInstances!.find((l) => l.__type === 'IntGrid')!;
    expect(ig0.__gridSize).toBe(8);
    expect(ig1.__gridSize).toBe(8);
    // The collision layer's intGridCsv fills its declared cell grid exactly.
    expect(ig0.intGridCsv!.length).toBe(ig0.__cWid * ig0.__cHei);
    expect(ig1.intGridCsv!.length).toBe(ig1.__cWid * ig1.__cHei);
  });

  it('Level_0 has an authored Player on solid ground; Level_1 is spawn-less', () => {
    const { level0, level1 } = loadFixture();
    expect(entityIdentifiers(level0)).toContain('Player');
    // Level_1 must have NO Player/Spawn/Start entity — the spawn-less neighbour.
    const l1Ids = entityIdentifiers(level1).map((s) => s.toLowerCase());
    expect(l1Ids).not.toContain('player');
    expect(l1Ids).not.toContain('spawn');
    expect(l1Ids).not.toContain('start');
  });

  it('Level_0 carries the full Celerock entity flavour set in its LDtk source', () => {
    const { level0 } = loadFixture();
    const ids = entityIdentifiers(level0);
    for (const expected of [
      'Spike',
      'Gem',
      'Spring',
      'SuperSpring',
      'DashRefill',
      'MovingPlatform',
      'Exit',
    ]) {
      expect(ids).toContain(expected);
    }
  });
});

describe('celerock-adversarial.ldtk — translate (ldtkLevelToLevelData)', () => {
  it('translates Level_0 into a LevelData with entities + a solid semantics entry', () => {
    const { text } = loadFixture();
    const { project } = parseLdtkProject(text);
    const level0 = project!.levels.find((l) => l.identifier === 'Level_0')!;
    const { level, tileSemantics } = ldtkLevelToLevelData(level0, project);

    expect(level).toBeDefined();
    expect(level!.entities.length).toBe(8); // all eight LDtk entities survive
    expect(level!.tiles.tileSize).toBe(8); // 8px tiles flow through to the grid
    expect(level!.tiles.cols).toBe(20);
    expect(level!.tiles.rows).toBe(14);

    // Name-driven semantics: value 1 = solid, 2 = passthrough, 3 = ladder.
    expect(tileSemantics.solid.length).toBeGreaterThan(0);
    expect(tileSemantics.solid).toContain(1);
    expect(tileSemantics.passthrough).toContain(2);
    expect(tileSemantics.ladder).toContain(3);
    // Ladder and passthrough must never be misclassified as solid.
    expect(tileSemantics.solid).not.toContain(2);
    expect(tileSemantics.solid).not.toContain(3);
  });

  it('maps Spring/SuperSpring/DashRefill onto dedicated kinds and preserves their rects', () => {
    // Celerock hardening (Workstream B2): these identifiers now map to the
    // dedicated `spring`/`dashRefill` kinds (previously fell through to the
    // `trigger` escape hatch). Assert both the kind AND the verbatim rect.
    const { text } = loadFixture();
    const { project } = parseLdtkProject(text);
    const level0 = project!.levels.find((l) => l.identifier === 'Level_0')!;
    const ldtkEntities = level0.layerInstances!
      .filter((l) => l.__type === 'Entities')
      .flatMap((l) => l.entityInstances ?? []);

    const { level } = ldtkLevelToLevelData(level0, project);
    expect(level).toBeDefined();

    const expectedKind: Record<string, string> = {
      Spring: 'spring',
      SuperSpring: 'spring',
      DashRefill: 'dashRefill',
    };
    for (const id of ['Spring', 'SuperSpring', 'DashRefill']) {
      const src = ldtkEntities.find((e) => e.__identifier === id);
      expect(src, `LDtk source must contain ${id}`).toBeDefined();
      const matched = level!.entities.find(
        (en) => en.rect.x === src!.px[0] && en.rect.y === src!.px[1],
      );
      expect(matched, `translated level must retain an entity at ${id}'s rect`).toBeDefined();
      expect(matched!.kind).toBe(expectedKind[id]);
    }
  });

  it('handles the spawn-less Level_1 with a default-spawn warning, still producing a level', () => {
    const { text } = loadFixture();
    const { project } = parseLdtkProject(text);
    const level1 = project!.levels.find((l) => l.identifier === 'Level_1')!;
    const { level, diagnostics } = ldtkLevelToLevelData(level1, project);

    // No error — a missing spawn is recoverable, not a hard failure.
    expect(level).toBeDefined();
    expect(diagnostics.some((d) => d.severity === 'error')).toBe(false);
    // The translator emits its "no spawn entity found" warning and supplies a
    // default spawn so downstream code never sees an undefined position.
    expect(diagnostics.some((d) => /no spawn entity/.test(d.message))).toBe(true);
    expect(level!.spawn.x).toBe(8); // tileSize default
  });
});
