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
import type { LdtkLevel, LdtkProject } from '../ldtk';
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
  transitionPlatformerToRoom,
} from '../platformer';
import type {
  CompiledLdtkRoom,
  PlatformerConfig,
  PlatformerInput,
  PlatformerState,
  SeamApronCache,
  SeamApronRoom,
} from '../platformer';
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
// Real-pack fixture — frozen, deliberately NOT the living games/celerock.ldtk
// ===========================================================================
// Engine tests must not read the living pack: `games/celerock.ldtk` is edited
// as game content (dc2f18a dug a pit into this very walkway to make the
// FallingBlock playable), and every pack edit would red the engine suite —
// the celerock brief's own "living-file doctrine" trap, one directory over.
// This fixture freezes the pack-v2 geometry the assertions below were
// calibrated against (the floor run at y=160 reaching Level_0's east edge,
// continued by Level_1's west floor across the seam).
const url = new URL('./fixtures/celerock-seam-pack.ldtk', import.meta.url);
const parsed = parseLdtkProject(readFileSync(url, 'utf8'));
if (parsed.project === undefined) throw new Error('celerock-seam-pack.ldtk fixture failed to parse');
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

  it('a hazard authored INTO the band is still air to the kernel (the pin)', () => {
    // The shipped pack happens to place no hazard near a seam, so the test
    // above alone would be vacuous. Place one where it would hurt — directly
    // above the walkway continuation — and pin that no apron solid carries it
    // and a crossing through its volume completes flush and grounded.
    const hazard = { x: 328, y: 148, width: 16, height: 8 };
    const apron = apronCache.apronFor(source.ldtkLevel.iid);
    for (const solid of apron) {
      const overlaps =
        solid.x < hazard.x + hazard.width && hazard.x < solid.x + solid.width &&
        solid.y < hazard.y + hazard.height && hazard.y < solid.y + solid.height;
      expect(overlaps, solid.id).toBe(false);
    }
    const run = runApronCrossing({
      project, rooms, apron: apronCache, config,
      input: RUN_EAST, mode: 'post',
      start: { iid: source.ldtkLevel.iid, x: 317, y: 145, vx: 200, vy: 180 },
    });
    expect(run.maxEmbed).toBeLessThanOrEqual(EPS);
    // It landed flush on the continued walkway (later gaps in Level_1 are
    // authored geometry — the budget must not run into them).
    expect(run.groundedFeet.length).toBeGreaterThan(0);
    for (const feet of run.groundedFeet) {
      expect(Math.abs(feet - WALKWAY.top)).toBeLessThanOrEqual(EPS);
    }
  });

  it('rebases the vertically offset seam (Level_1 ↔ Level_2) exactly', () => {
    // Level_2 sits at worldY -72; its floor run tile-0-160-32-24 must appear
    // in Level_1's apron at (320, 88) — world-exact Y, span-filtered.
    const apron = apronCache.apronFor(destination.ldtkLevel.iid);
    expect(
      apron.some((s) => s.x === 320 && s.y === 88 && s.width === 32 && s.height === 24),
    ).toBe(true);
  });
});

// ===========================================================================
// The full golden loop — step → poll → transitionPlatformerToRoom → continue,
// with the apron in force on BOTH sides of the seam.
// ===========================================================================

const RUN_WEST: PlatformerInput = {
  moveX: -1, moveY: 0,
  jump: { pressed: false, released: false, held: false },
  dash: { pressed: false, released: false, held: false },
  grab: { pressed: false, released: false, held: false },
};
const JUMP_EAST: PlatformerInput = {
  moveX: 1, moveY: 0,
  jump: { pressed: true, released: false, held: true },
  dash: { pressed: false, released: false, held: false },
  grab: { pressed: false, released: false, held: false },
};

/** Sub-pixel slack for "landed exactly on the face" (float noise only). */
const EPS = 1e-9;
/** The walkway slab across the Level_0 → Level_1 seam, in world px. */
const WALKWAY = { minX: 296, maxX: 352, top: 160, bottom: 168 } as const;

interface CrossingObservations {
  /** Deepest feet penetration into the slab while horizontally over it. */
  maxEmbed: number;
  /** Feet heights seen GROUNDED while over the slab and level with it. */
  groundedFeet: number[];
  transitions: number;
  final: { worldX: number; worldFeet: number; onGround: boolean; vx: number };
}

/**
 * One full crossing run over the session golden path: step → poll → map →
 * `transitionPlatformerToRoom` with apron-augmented `destinationSolids` →
 * continue in the destination, observing the body in world coordinates.
 *
 * `mode` varies the consumer ordering the sweep must survive: 'post' polls
 * after the step (the golden loop); 'pre' polls before it; 'arrival' seeds
 * the detector as if the body had just arrived through the entry edge (the
 * re-arm gate + unlatched axes of a fresh seam arrival).
 */
function runApronCrossing(options: {
  project: LdtkProject;
  rooms: { get(iid: string): CompiledLdtkRoom; has(iid: string): boolean };
  apron: SeamApronCache;
  config: Readonly<PlatformerConfig>;
  input: PlatformerInput;
  mode: 'post' | 'pre' | 'arrival';
  arrivalEdge?: 'n' | 's' | 'e' | 'w';
  start: { iid: string; x: number; y: number; vx: number; vy: number; onGround?: boolean };
  slab?: { minX: number; maxX: number; top: number; bottom: number };
  maxTicks?: number;
}): CrossingObservations {
  const { project, rooms, apron, config } = options;
  let active = rooms.get(options.start.iid);
  const initial = active.compiled.initialState;
  let state: PlatformerState = {
    ...initial,
    core: {
      ...initial.core,
      x: options.start.x,
      y: options.start.y,
      vx: options.start.vx,
      vy: options.start.vy,
      onGround: options.start.onGround ?? false,
    },
  };
  let session = createRoomTransitionSession();
  if (options.mode === 'arrival') {
    session = {
      ...session,
      detector: {
        blockedEntryEdge: options.arrivalEdge ?? 'w',
        expectedLevelIid: active.ldtkLevel.iid,
        fullyInsideXIid: null,
        fullyInsideYIid: null,
      },
    };
  }

  const slab = options.slab ?? WALKWAY;
  const observations: CrossingObservations = {
    maxEmbed: 0, groundedFeet: [], transitions: 0,
    final: { worldX: 0, worldFeet: 0, onGround: false, vx: 0 },
  };
  const observe = (): void => {
    const worldX = active.ldtkLevel.worldX + state.core.x;
    const worldFeet = active.ldtkLevel.worldY + state.core.y + state.core.height;
    const overSlab = worldX < slab.maxX && slab.minX < worldX + state.core.width;
    if (overSlab) {
      if (worldFeet > slab.top + EPS && worldFeet < slab.bottom - EPS) {
        observations.maxEmbed = Math.max(observations.maxEmbed, worldFeet - slab.top);
      }
      // Only record groundings AT or BELOW the face. The transition's support
      // probe reports `onGround` up to 1px ABOVE the face (flush-rest
      // tolerance), so a body still falling at the crossing tick can show as
      // grounded at top − 0.9 for exactly one tick — transient, not resting.
      if (state.core.onGround && worldFeet >= slab.top - EPS && worldFeet < slab.bottom) {
        observations.groundedFeet.push(worldFeet);
      }
    }
  };

  const handlePoll = (): void => {
    const poll = pollRoomTransition(session, state.core, active.ldtkLevel, project);
    session = poll.session;
    if (poll.result.type !== 'exit') return;
    const next = rooms.get(poll.result.exit.neighbourLevelIid);
    if (next === undefined) return;
    const entry = mapLdtkRoomEntry(state.core, active.ldtkLevel, next.ldtkLevel, poll.result.exit);
    ({ state } = transitionPlatformerToRoom(state, entry, {
      destinationSolids: [...next.solids, ...apron.apronFor(next.ldtkLevel.iid)],
      config,
    }));
    active = next;
    observations.transitions += 1;
  };

  const maxTicks = options.maxTicks ?? 160;
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (options.mode === 'pre') handlePoll();
    state = stepPlatformer(
      state, options.input,
      [...active.solids, ...apron.apronFor(active.ldtkLevel.iid)],
      DT, config,
    ).state;
    if (options.mode !== 'pre') handlePoll();
    observe();
    const worldFeet = active.ldtkLevel.worldY + state.core.y + state.core.height;
    if (worldFeet > slab.bottom + 160) break; // legitimately fell into the pit below
  }
  observations.final = {
    worldX: active.ldtkLevel.worldX + state.core.x,
    worldFeet: active.ldtkLevel.worldY + state.core.y + state.core.height,
    onGround: state.core.onGround,
    vx: state.core.vx,
  };
  return observations;
}

describe('the full golden loop with the apron (guard retirement proofs)', () => {
  it('a grounded walk across the seam keeps support AND momentum (the removed guard clamped and zeroed)', () => {
    const run = runApronCrossing({
      project, rooms, apron: apronCache, config,
      input: RUN_EAST, mode: 'post',
      // Start ON the source run (the [264,296] stretch before it is an
      // authored gap — not this test's subject).
      start: { iid: source.ldtkLevel.iid, x: 300, y: WALKWAY.top - 12, vx: 90, vy: 0, onGround: true },
      // Budget ends while still on Level_1's continued floor — the authored
      // gap past it is not this test's subject either.
      maxTicks: 20,
    });
    expect(run.transitions).toBe(1);
    expect(run.maxEmbed).toBeLessThanOrEqual(EPS);
    // Still walking, still grounded, flush, at full momentum — the removed
    // guard clamped x to the source span and zeroed vx/vy here.
    expect(run.final.onGround).toBe(true);
    expect(run.final.worldFeet).toBeCloseTo(WALKWAY.top, 9);
    expect(run.final.vx).toBeGreaterThan(0);
    for (const feet of run.groundedFeet) {
      expect(Math.abs(feet - WALKWAY.top)).toBeLessThanOrEqual(EPS);
    }
  });

  it('an explicit jump during the straddle launches untouched', () => {
    // Held jump: the actor launches, arcs, and re-lands over the continuous
    // surface. The removed guard passed jumps through; the apron has nothing
    // to pass through — it only adds floors — so the assertions are the
    // invariants: never embedded, and every touch-down flush.
    const run = runApronCrossing({
      project, rooms, apron: apronCache, config,
      input: JUMP_EAST, mode: 'post',
      start: { iid: source.ldtkLevel.iid, x: 306, y: WALKWAY.top - 12, vx: 90, vy: 0, onGround: true },
      maxTicks: 240,
    });
    expect(run.maxEmbed).toBeLessThanOrEqual(EPS);
    expect(run.final.vx).toBeGreaterThan(0);
    for (const feet of run.groundedFeet) {
      expect(Math.abs(feet - WALKWAY.top)).toBeLessThanOrEqual(EPS);
    }
  });

  it('away from the seam the apron is a no-op (identical trajectory)', () => {
    const mk = (): PlatformerState => ({
      ...source.compiled.initialState,
      core: { ...source.compiled.initialState.core, x: 100, y: 120, vx: 0, vy: 0, onGround: false },
    });
    let bare = mk();
    let withApron = mk();
    for (let i = 0; i < 40; i += 1) {
      bare = stepPlatformer(bare, RUN_EAST, source.solids, DT, config).state;
      withApron = stepPlatformer(
        withApron, RUN_EAST,
        [...source.solids, ...apronCache.apronFor(source.ldtkLevel.iid)],
        DT, config,
      ).state;
    }
    expect(withApron.core.x).toBe(bare.core.x);
    expect(withApron.core.y).toBe(bare.core.y);
    expect(withApron.core.vx).toBe(bare.core.vx);
    expect(withApron.core.vy).toBe(bare.core.vy);
    expect(withApron.core.onGround).toBe(bare.core.onGround);
  });
});

// ===========================================================================
// The adversarial fixture — the authored drop the apron must NOT bridge.
// ===========================================================================

const adversarialParsed = parseLdtkProject(
  readFileSync(new URL('./fixtures/celerock-adversarial.ldtk', import.meta.url), 'utf8'),
);
if (adversarialParsed.project === undefined) throw new Error('adversarial fixture failed to parse');
const advProject = adversarialParsed.project;
const advRooms = createLdtkRoomCache(advProject, {
  playerWidthForTileSize: (tileSize) => 0.5 * tileSize,
  playerHeightForTileSize: (tileSize) => 1.5 * tileSize,
  spawnResolution: 'rest-on-surface',
});
const advApron = createSeamApronCache((iid) => (advRooms.has(iid) ? advRooms.get(iid) : undefined));
const advByIid = new Map(advProject.levels.map((l) => [l.identifier, l.iid]));
const advL0 = advRooms.get(advByIid.get('Level_0')!);
const advL1 = advRooms.get(advByIid.get('Level_1')!);
const advConfig: Readonly<PlatformerConfig> = {
  ...createPrecisionPlatformerConfig({
    tileSize: advL0.levelData.tileSize,
    referenceTileSize: 16,
    jumpApexTiles: 81 / 16,
    timeToApex: 0.3,
    wallGrabEnabled: true,
    climbEnabled: true,
  }),
  groundDuckEnabled: false,
};

describe('the adversarial partial seam (span filter on a real file)', () => {
  it("excludes Level_1's out-of-span floor but rides the in-span passthrough verbatim", () => {
    const apron = advApron.apronFor(advL0.ldtkLevel.iid);
    // Level_1's floor (y=120) is below the shared span [0,112] — no phantom.
    expect(apron.some((s) => s.y === 120)).toBe(false);
    const pass = apron.find((s) => s.passthrough === true);
    expect(pass).toMatchObject({ x: 192, y: 88, width: 24, height: 8 });
    // And the west side carries the dash-refill entity solid verbatim.
    const west = advApron.apronFor(advL1.ldtkLevel.iid);
    expect(west.find((s) => s.dashRefill === true)).toMatchObject({ x: -56, y: 88, width: 8, height: 8 });
  });

  it('an authored drop at a misaligned seam still drops (no phantom floor)', () => {
    // Level_0's floor is at y=104, Level_1's at y=120, shared span [0,112]:
    // the 16px drop is author intent. The apron must not bridge it.
    const run = runApronCrossing({
      project: advProject, rooms: advRooms, apron: advApron, config: advConfig,
      input: RUN_EAST, mode: 'post',
      // Start on the last floor tile before the seam ([144,160], top 104) so
      // the crossing fires while the body still overlaps the shared span
      // [0,112] — one tile earlier and the drop lands OUTSIDE the span, which
      // is a void departure, not a transition.
      start: { iid: advL0.ldtkLevel.iid, x: 148, y: 92, vx: 120, vy: 0, onGround: true },
      // No-embed is asserted only over the floor's own extent — the region
      // past the seam (x>160) is the authored 16px drop itself.
      slab: { minX: 128, maxX: 160, top: 104, bottom: 112 },
      maxTicks: 60,
    });
    expect(run.transitions).toBe(1);
    expect(run.final.onGround).toBe(true);
    expect(run.final.worldFeet).toBeCloseTo(120, 9);
    expect(run.maxEmbed).toBeLessThanOrEqual(EPS);
  });
});

// ===========================================================================
// The committed sweep — 1,548 crossings over the real seam. This is the
// validation the 2026-08-18 post-mortem promised: approach positions × fall
// speeds × both directions × consumer poll orderings, every crossing flush.
// ===========================================================================

describe('the crossing sweep (43 offsets × 6 speeds × 2 directions × 3 poll modes)', () => {
  const SPEEDS = [0, 60, 120, 180, 229, 300];
  const MODES = ['post', 'pre', 'arrival'] as const;
  const eastOffsets = Array.from({ length: 43 }, (_, i) => 302 + i * 0.5);
  const westOffsets = Array.from({ length: 43 }, (_, i) => -5 + i * 0.5);

  it('every crossing lands flush: 0px embed, no fall-through, grounded-on-top', () => {
    let crossings = 0;
    const failures: string[] = [];
    for (const mode of MODES) {
      for (const vy of SPEEDS) {
        for (const x of eastOffsets) {
          crossings += 1;
          const run = runApronCrossing({
            project, rooms, apron: apronCache, config,
            input: RUN_EAST, mode, arrivalEdge: 'w',
            start: { iid: source.ldtkLevel.iid, x, y: 145, vx: 200, vy },
          });
          if (run.maxEmbed > EPS) failures.push(`E ${mode} vy=${vy} x=${x}: embed ${run.maxEmbed}`);
          for (const feet of run.groundedFeet) {
            if (Math.abs(feet - WALKWAY.top) > EPS) failures.push(`E ${mode} vy=${vy} x=${x}: grounded at ${feet}`);
          }
        }
        for (const x of westOffsets) {
          crossings += 1;
          const run = runApronCrossing({
            project, rooms, apron: apronCache, config,
            input: RUN_WEST, mode, arrivalEdge: 'e',
            start: { iid: destination.ldtkLevel.iid, x, y: 145, vx: -200, vy },
          });
          if (run.maxEmbed > EPS) failures.push(`W ${mode} vy=${vy} x=${x}: embed ${run.maxEmbed}`);
          for (const feet of run.groundedFeet) {
            if (Math.abs(feet - WALKWAY.top) > EPS) failures.push(`W ${mode} vy=${vy} x=${x}: grounded at ${feet}`);
          }
        }
      }
    }
    // The promised sweep size — a silent fixture change cannot shrink it.
    expect(crossings).toBe(1548);
    expect(failures.slice(0, 20), failures.slice(0, 20).join('; ')).toEqual([]);
  }, 120_000);
});
