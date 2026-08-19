/**
 * `compileRoomSeamApron` / `createSeamApronCache` — the seam collision apron.
 *
 * The companion to `room-seam-characterization.test.ts`: that file pins the
 * discontinuity (embed depth ∝ fall speed, with the source room's solids
 * alone), this one proves the apron removes it — same crossings, 0px embed,
 * grounded, at every fall speed.
 *
 * Also pins the two edges the plan's review surfaced: hazards deliberately do
 * NOT ride the apron, and overlapping room rects must not change the result.
 *
 * @module
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseLdtkProject } from '../ldtk';
import type { LdtkLevel } from '../ldtk';
import {
  compileRoomSeamApron,
  createLdtkRoomCache,
  createPrecisionPlatformerConfig,
  createRoomTransitionSession,
  createSeamApronCache,
  DEFAULT_SEAM_APRON_DEPTH,
  mapLdtkRoomEntry,
  pollRoomTransition,
  seamApronSourceFromSolidId,
  stepPlatformer,
} from '../platformer';
import type { PlatformerConfig, PlatformerState, SeamApronRoom } from '../platformer';
import type { Solid } from '../collision';

const DT = 1 / 60;
const WALKWAY_TOP = 160;

// ===========================================================================
// Synthetic geometry — units
// ===========================================================================
function level(over: Partial<LdtkLevel> & Pick<LdtkLevel, 'iid'>): LdtkLevel {
  return {
    iid: over.iid,
    identifier: over.identifier ?? over.iid,
    uid: 0,
    worldX: over.worldX ?? 0,
    worldY: over.worldY ?? 0,
    pxWid: over.pxWid ?? 320,
    pxHei: over.pxHei ?? 184,
    layerInstances: [],
    __neighbours: over.__neighbours ?? [],
  } as unknown as LdtkLevel;
}

const rect = (id: string, x: number, y: number, width: number, height: number, extra: Partial<Solid> = {}): Solid =>
  ({ id, x, y, width, height, ...extra });

/** Two flush rooms, `main` with a neighbour on `dir`. */
function pair(dir: 'e' | 'w' | 'n' | 's', neighbourSolids: readonly Solid[]) {
  const offsets = { e: [320, 0], w: [-320, 0], s: [0, 184], n: [0, -184] } as const;
  const [dx, dy] = offsets[dir];
  const main = level({ iid: 'main', __neighbours: [{ dir, levelIid: 'nb' }] as never });
  const nb = level({ iid: 'nb', worldX: dx, worldY: dy });
  const rooms: Record<string, SeamApronRoom> = {
    main: { ldtkLevel: main, solids: [] },
    nb: { ldtkLevel: nb, solids: neighbourSolids },
  };
  return { main: rooms.main, resolve: (iid: string) => rooms[iid] };
}

describe('compileRoomSeamApron — geometry', () => {
  it('rebases a neighbour solid into active-local coordinates on every side', () => {
    const cases = [
      ['e', rect('f', 0, 160, 32, 8), { x: 320, y: 160 }],
      ['w', rect('f', 288, 160, 32, 8), { x: -32, y: 160 }],
      ['s', rect('f', 40, 0, 32, 8), { x: 40, y: 184 }],
      ['n', rect('f', 40, 176, 32, 8), { x: 40, y: -8 }],
    ] as const;
    for (const [dir, solid, expected] of cases) {
      const { main, resolve } = pair(dir, [solid]);
      const apron = compileRoomSeamApron(main, resolve);
      expect(apron, dir).toHaveLength(1);
      expect({ x: apron[0].x, y: apron[0].y }, dir).toEqual(expected);
    }
  });

  it('keeps only solids within the depth band', () => {
    const { main, resolve } = pair('e', [
      rect('near', 0, 160, 8, 8),                              // at the seam
      rect('edge', DEFAULT_SEAM_APRON_DEPTH - 4, 160, 8, 8),   // inside the band
      rect('far', DEFAULT_SEAM_APRON_DEPTH + 8, 160, 8, 8),    // beyond it
    ]);
    const ids = compileRoomSeamApron(main, resolve)
      .map((s) => seamApronSourceFromSolidId(s.id!)?.solidId);
    expect(ids).toEqual(['near', 'edge']);
  });

  it('excludes solids outside the shared seam span — a partial seam keeps its void', () => {
    // Neighbour is half-height, so the lower half of the edge is not a seam.
    const main = level({ iid: 'main', __neighbours: [{ dir: 'e', levelIid: 'nb' }] as never });
    const nb = level({ iid: 'nb', worldX: 320, pxHei: 92 });
    const rooms: Record<string, SeamApronRoom> = {
      main: { ldtkLevel: main, solids: [] },
      nb: {
        ldtkLevel: nb,
        solids: [rect('inSpan', 0, 40, 16, 8), rect('belowSpan', 0, 120, 16, 8)],
      },
    };
    const apron = compileRoomSeamApron(rooms.main, (iid) => rooms[iid]);
    expect(apron.map((s) => seamApronSourceFromSolidId(s.id!)?.solidId)).toEqual(['inSpan']);
  });

  it('namespaces ids so a neighbour solid can never collide with a local one', () => {
    const { main, resolve } = pair('e', [rect('tile-7', 0, 160, 16, 8)]);
    const [solid] = compileRoomSeamApron(main, resolve);
    expect(solid.id).toBe('apron:nb:tile-7');
    expect(seamApronSourceFromSolidId(solid.id!)).toEqual({ levelIid: 'nb', solidId: 'tile-7' });
    expect(seamApronSourceFromSolidId('tile-7')).toBeNull();
  });

  it('preserves every solid flag verbatim', () => {
    const { main, resolve } = pair('e', [
      rect('p', 0, 160, 16, 8, { passthrough: true }),
      rect('l', 0, 100, 16, 8, { ladder: true }),
      rect('s', 8, 120, 16, 8, { spring: { launch: -260 } } as Partial<Solid>),
    ]);
    const apron = compileRoomSeamApron(main, resolve);
    expect(apron.map((s) => s.passthrough ?? false)).toEqual([true, false, false]);
    expect(apron.map((s) => s.ladder ?? false)).toEqual([false, true, false]);
    expect(apron[2].spring).toEqual({ launch: -260 });
  });

  it('contributes nothing for a missing, diagonal, or non-flush neighbour', () => {
    const missing = pair('e', [rect('f', 0, 160, 32, 8)]);
    expect(compileRoomSeamApron(missing.main, () => undefined)).toEqual([]);

    const diagonal = level({ iid: 'main', __neighbours: [{ dir: 'ne', levelIid: 'nb' }] as never });
    expect(compileRoomSeamApron(
      { ldtkLevel: diagonal, solids: [] },
      () => ({ ldtkLevel: level({ iid: 'nb', worldX: 320 }), solids: [rect('f', 0, 160, 32, 8)] }),
    )).toEqual([]);

    // Neighbour declared east but sitting 8px away — not flush, so not a seam.
    const gapped = level({ iid: 'main', __neighbours: [{ dir: 'e', levelIid: 'nb' }] as never });
    expect(compileRoomSeamApron(
      { ldtkLevel: gapped, solids: [] },
      () => ({ ldtkLevel: level({ iid: 'nb', worldX: 328 }), solids: [rect('f', 0, 160, 32, 8)] }),
    )).toEqual([]);
  });

  it('memoizes per room and can be dropped', () => {
    const { main, resolve } = pair('e', [rect('f', 0, 160, 32, 8)]);
    const cache = createSeamApronCache((iid) => (iid === 'main' ? main : resolve(iid)));
    const first = cache.apronFor('main');
    expect(cache.apronFor('main')).toBe(first);      // identity, not just equality
    cache.drop('main');
    expect(cache.apronFor('main')).not.toBe(first);
    expect(cache.apronFor('main')).toEqual(first);
  });

  it('is unaffected by overlapping room rects (LDtk free-world layouts)', () => {
    // Rooms that overlap by 16px are not flush, so no seam and no phantom
    // duplicate of the active room's own geometry.
    const main = level({ iid: 'main', __neighbours: [{ dir: 'e', levelIid: 'nb' }] as never });
    const nb = level({ iid: 'nb', worldX: 304 });
    expect(compileRoomSeamApron(
      { ldtkLevel: main, solids: [rect('own', 296, 160, 24, 8)] },
      () => ({ ldtkLevel: nb, solids: [rect('f', 0, 160, 32, 8)] }),
    )).toEqual([]);
  });
});

// ===========================================================================
// Real fixture — games/celerock.ldtk
// ===========================================================================
const url = new URL('../../games/celerock.ldtk', import.meta.url);
const parsed = parseLdtkProject(readFileSync(url, 'utf8'));
if (parsed.project === undefined) throw new Error('games/celerock.ldtk failed to parse');
const project = parsed.project;

const rooms = createLdtkRoomCache(project, {
  playerWidthForTileSize: (tileSize) => 0.5 * tileSize,
  playerHeightForTileSize: (tileSize) => 1.5 * tileSize,
  spawnResolution: 'rest-on-surface',
});
const byName = new Map(project.levels.map((l) => [l.identifier, l]));
const source = rooms.get(byName.get('Level_0')!.iid);
const destination = rooms.get(byName.get('Level_1')!.iid);
const apronCache = createSeamApronCache((iid) => (rooms.has(iid) ? rooms.get(iid) : undefined));

const config: Readonly<PlatformerConfig> = {
  ...createPrecisionPlatformerConfig({
    tileSize: source.levelData.tileSize,
    referenceTileSize: 16,
    jumpApexTiles: 81 / 16,
    timeToApex: 0.3,
    wallGrabEnabled: true,
    climbEnabled: true,
  }),
  groundDuckEnabled: false,
};
const RUN_EAST = {
  moveX: 1, moveY: 0,
  jump: { pressed: false, released: false, held: false },
  dash: { pressed: false, released: false, held: false },
  grab: { pressed: false, released: false, held: false },
} as const;

/** Leave the source ledge falling at `vy`; report the entry's embed depth. */
function crossLeavingLedge(vy: number, withApron: boolean) {
  const apron = withApron ? apronCache.apronFor(source.ldtkLevel.iid) : [];
  const solids = [...source.solids, ...apron];
  let state: PlatformerState = {
    ...source.compiled.initialState,
    core: { ...source.compiled.initialState.core, x: 317, y: 145, vx: 200, vy, onGround: false },
  };
  let session = createRoomTransitionSession();
  for (let tick = 0; tick < 80; tick += 1) {
    state = stepPlatformer(state, RUN_EAST, solids, DT, config).state;
    const poll = pollRoomTransition(session, state.core, source.ldtkLevel, project);
    session = poll.session;
    if (poll.result.type === 'exit') {
      const entry = mapLdtkRoomEntry(state.core, source.ldtkLevel, destination.ldtkLevel, poll.result.exit);
      return { embed: entry.y + state.core.height - WALKWAY_TOP, onGround: state.core.onGround };
    }
  }
  throw new Error(`no crossing at vy=${vy}`);
}

describe('seam apron — celerock Level_0 → Level_1', () => {
  it('continues the source walkway across the seam', () => {
    const apron = apronCache.apronFor(source.ldtkLevel.iid);
    const continuation = apron.filter((s) => s.y === WALKWAY_TOP && s.x >= source.levelData.width);
    expect(continuation.length).toBeGreaterThan(0);
    // The source run ends at the room edge; the apron picks up exactly there.
    expect(Math.min(...continuation.map((s) => s.x))).toBe(source.levelData.width);
    expect(apron.every((s) => s.id!.startsWith('apron:'))).toBe(true);
  });

  it('never lands the body inside the floor, at any fall speed', () => {
    // The invariant is "never embedded", not "always grounded": a slow crossing
    // legitimately passes the seam still airborne, above the walkway. What must
    // not happen at ANY speed is arriving below the floor's top face.
    const results = [120, 180, 229, 260, 300].map((vy) => ({ vy, ...crossLeavingLedge(vy, true) }));
    for (const r of results) {
      expect(r.embed, `vy=${r.vy}`).toBeLessThanOrEqual(0);
    }

    // And the fast crossings — the ones that embedded without the apron — now
    // arrive standing on the continued walkway rather than inside it.
    for (const r of results.filter((x) => x.vy >= 180)) {
      expect(r.onGround, `vy=${r.vy}`).toBe(true);
      expect(r.embed, `vy=${r.vy}`).toBe(0);
    }
  });

  it('and the same crossings embed without it (the defect, still reproducible)', () => {
    // Guards against the apron test passing for an unrelated reason: the
    // scenario must still fail the old way when the apron is withheld.
    expect(crossLeavingLedge(300, false).embed).toBeGreaterThan(1);
  });

  it('does NOT carry neighbour hazards — a documented decision, not a hole', () => {
    // Floors continue across a seam; spikes do not. Accepted because at a seam
    // failing to kill is the safe direction — the alternative kills the player
    // on geometry they cannot see yet. If this ever becomes carrying hazards,
    // it must be a deliberate change with the tradeoff re-argued.
    const apron = apronCache.apronFor(source.ldtkLevel.iid);
    const hazardRects = new Set(
      destination.hazards.map((h) => `${h.rect.x + 320}|${h.rect.y}`),
    );
    expect(apron.some((s) => hazardRects.has(`${s.x}|${s.y}`))).toBe(false);
  });
});
