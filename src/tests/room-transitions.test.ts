import { describe, it, expect } from 'vitest';
import {
  findLdtkRoomExit,
  mapLdtkRoomEntry,
  transitionPlatformerToRoom,
  rebasePointBetweenLdtkRooms,
  createRoomExitDetectorState,
  detectLdtkRoomExit,
  DEFAULT_EXIT_DEADBAND,
  type RoomExitDetectorState,
} from '../platformer/room-transitions';
import { createPlatformerState } from '../platformer/kernel';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import type { Rect, Solid } from '../collision/types';
import type { LdtkLevel, LdtkProject, LdtkNeighbour } from '../ldtk/types';
import type { PlatformerConfig, PlatformerState } from '../platformer/types';

/**
 * Phase E2 — pure room-transition helpers over the LDtk `__neighbours` graph.
 *
 * The matrix: all four cardinals, partial seams (inside-span transitions vs
 * outside-span voids), corner exits (normalized penetration + the stable
 * `n → e → s → w` tie order), missing/diagonal-only neighbours, forward-mapping
 * and rapid-reversal world-position identities, momentum/facing/slice
 * preservation, per-tick channel clearing, conservative vs revalidated support,
 * and `spawn.source === 'seam-entry'`.
 *
 * @module
 */

interface LevelSpec {
  iid: string;
  worldX: number;
  worldY: number;
  pxWid: number;
  pxHei: number;
  neighbours?: readonly { dir: string; levelIid: string }[];
}

function makeLevel(spec: LevelSpec): LdtkLevel {
  const neighbours: LdtkNeighbour[] = (spec.neighbours ?? []).map((n) => ({
    dir: n.dir,
    levelIid: n.levelIid,
  }));
  return {
    identifier: spec.iid,
    iid: spec.iid,
    uid: 1,
    pxWid: spec.pxWid,
    pxHei: spec.pxHei,
    worldX: spec.worldX,
    worldY: spec.worldY,
    worldDepth: 0,
    fieldInstances: [],
    layerInstances: null,
    __neighbours: neighbours,
    externalRelPath: null,
    bgColor: null,
    bgRelPath: null,
    bgPos: null,
  };
}

function makeProject(...levels: LevelSpec[]): LdtkProject {
  return {
    jsonVersion: '1.5.3',
    iid: 'project-iid',
    bgColor: '#000000',
    defs: {} as LdtkProject['defs'],
    levels: levels.map(makeLevel),
    externalLevels: false,
    worldLayout: 'Free',
    worldGridWidth: 8,
    worldGridHeight: 8,
    worlds: [],
  };
}

function body(x: number, y: number, w = 8, h = 8): Rect {
  return { x, y, width: w, height: h };
}

// The adversarial-fixture geometry: two cardinally-linked rooms of unequal
// height sharing a partial east/west seam at world x=160, y-span [0,112].
const PARTIAL: LevelSpec[] = [
  {
    iid: 'L0',
    worldX: 0,
    worldY: 0,
    pxWid: 160,
    pxHei: 112,
    neighbours: [{ dir: 'e', levelIid: 'L1' }],
  },
  {
    iid: 'L1',
    worldX: 160,
    worldY: 0,
    pxWid: 144,
    pxHei: 128,
    neighbours: [{ dir: 'w', levelIid: 'L0' }],
  },
];

// Per-axis-latch fixture: C is linked WEST (W) and SOUTH (S), so a body can
// straddle C's west seam (X unlatched) while vertically inside (Y latches),
// then cross the south seam on a later poll while still straddling west —
// the exact Celerock bug-1 arrival geometry plus a legitimate orthogonal
// exit. C has NO east/north neighbours (those edges are void crossings).
const ORTHO: LevelSpec[] = [
  {
    iid: 'C',
    worldX: 100,
    worldY: 0,
    pxWid: 100,
    pxHei: 100,
    neighbours: [
      { dir: 'w', levelIid: 'W' },
      { dir: 's', levelIid: 'S' },
    ],
  },
  { iid: 'W', worldX: 0, worldY: 0, pxWid: 100, pxHei: 100, neighbours: [{ dir: 'e', levelIid: 'C' }] },
  { iid: 'S', worldX: 100, worldY: 100, pxWid: 100, pxHei: 100, neighbours: [{ dir: 'n', levelIid: 'C' }] },
];

describe('room transitions — findLdtkRoomExit', () => {
  it('crossing the east edge inside the shared span returns the e exit + seam span', () => {
    const project = makeProject(...PARTIAL);
    const exit = findLdtkRoomExit(body(158, 50), project.levels[0], project);
    expect(exit).toBeDefined();
    expect(exit?.dir).toBe('e');
    expect(exit?.neighbourLevelIid).toBe('L1');
    // World-space shared seam span on the perpendicular (Y) axis.
    expect(exit?.seamMin).toBe(0);
    expect(exit?.seamMax).toBe(112);
  });

  it('crossing the east edge OUTSIDE the shared Y span is void (undefined)', () => {
    const project = makeProject(...PARTIAL);
    // L1 extends lower than L0; below y=112 there is no shared seam.
    expect(findLdtkRoomExit(body(158, 114), project.levels[0], project)).toBeUndefined();
    // Just inside the span still transitions (inclusive edge behaviour of the
    // body overlap): body y=104..112 overlaps [0,112].
    expect(findLdtkRoomExit(body(158, 104), project.levels[0], project)).toBeDefined();
  });

  it('crossing the west edge from the destination back to the source returns the w exit', () => {
    const project = makeProject(...PARTIAL);
    // In L1-local coords, the west boundary is x=0.
    const exit = findLdtkRoomExit(body(-3, 50), project.levels[1], project);
    expect(exit?.dir).toBe('w');
    expect(exit?.neighbourLevelIid).toBe('L0');
    expect(exit?.seamMin).toBe(0);
    expect(exit?.seamMax).toBe(112);
  });

  it('north and south crossings return the matching cardinal exits', () => {
    // Vertical stack: L0 at (0,100) 160×100; north neighbour above, south below.
    const specs: LevelSpec[] = [
      {
        iid: 'C',
        worldX: 0,
        worldY: 100,
        pxWid: 160,
        pxHei: 100,
        neighbours: [
          { dir: 'n', levelIid: 'N' },
          { dir: 's', levelIid: 'S' },
        ],
      },
      // Flush north: N.bottom === C.y === 100.
      { iid: 'N', worldX: 0, worldY: 0, pxWid: 160, pxHei: 100, neighbours: [{ dir: 's', levelIid: 'C' }] },
      // Flush south: S.y === C.bottom === 200.
      { iid: 'S', worldX: 0, worldY: 200, pxWid: 160, pxHei: 100, neighbours: [{ dir: 'n', levelIid: 'C' }] },
    ];
    const project = makeProject(...specs);
    const center = project.levels[0];
    // North crossing: body.y < 0 within the shared X span [0,160].
    const n = findLdtkRoomExit(body(40, -4), center, project);
    expect(n?.dir).toBe('n');
    expect(n?.neighbourLevelIid).toBe('N');
    expect(n?.seamMin).toBe(0);
    expect(n?.seamMax).toBe(160);
    // South crossing: body bottom past pxHei=100.
    const s = findLdtkRoomExit(body(40, 98), center, project);
    expect(s?.dir).toBe('s');
    expect(s?.neighbourLevelIid).toBe('S');
    // North/south crossings outside the shared X span are void.
    expect(findLdtkRoomExit(body(-12, -4), center, project)).toBeUndefined();
  });

  it('a body still inside the room returns undefined', () => {
    const project = makeProject(...PARTIAL);
    expect(findLdtkRoomExit(body(40, 50), project.levels[0], project)).toBeUndefined();
    // Flush against the east edge but not past it is not a crossing.
    expect(findLdtkRoomExit(body(152, 50), project.levels[0], project)).toBeUndefined();
  });

  it('missing neighbour / diagonal-only neighbour / non-flush neighbour ⇒ undefined', () => {
    // Missing: the linked iid is not present in the project.
    const ghost = makeProject(
      { iid: 'A', worldX: 0, worldY: 0, pxWid: 100, pxHei: 100, neighbours: [{ dir: 'e', levelIid: 'ghost' }] },
    );
    expect(findLdtkRoomExit(body(98, 40), ghost.levels[0], ghost)).toBeUndefined();

    // Diagonal-only: dir 'ne' is not a cardinal seam.
    const diag = makeProject(
      {
        iid: 'A',
        worldX: 0,
        worldY: 0,
        pxWid: 100,
        pxHei: 100,
        neighbours: [{ dir: 'ne', levelIid: 'B' }],
      },
      { iid: 'B', worldX: 100, worldY: -100, pxWid: 100, pxHei: 100, neighbours: [{ dir: 'sw', levelIid: 'A' }] },
    );
    expect(findLdtkRoomExit(body(98, -4), diag.levels[0], diag)).toBeUndefined();

    // Non-flush: a 10 px gap between the rooms means no shared seam.
    const gap = makeProject(
      { iid: 'A', worldX: 0, worldY: 0, pxWid: 100, pxHei: 100, neighbours: [{ dir: 'e', levelIid: 'B' }] },
      { iid: 'B', worldX: 110, worldY: 0, pxWid: 100, pxHei: 100, neighbours: [{ dir: 'w', levelIid: 'A' }] },
    );
    expect(findLdtkRoomExit(body(98, 40), gap.levels[0], gap)).toBeUndefined();
  });

  it('corner exits choose the greatest normalized penetration; ties use n → e → s → w', () => {
    const specs: LevelSpec[] = [
      {
        iid: 'C',
        worldX: 0,
        worldY: 0,
        pxWid: 100,
        pxHei: 100,
        neighbours: [
          { dir: 'e', levelIid: 'E' },
          { dir: 's', levelIid: 'S' },
        ],
      },
      { iid: 'E', worldX: 100, worldY: 0, pxWid: 100, pxHei: 100, neighbours: [{ dir: 'w', levelIid: 'C' }] },
      { iid: 'S', worldX: 0, worldY: 100, pxWid: 100, pxHei: 100, neighbours: [{ dir: 'n', levelIid: 'C' }] },
    ];
    const project = makeProject(...specs);
    const center = project.levels[0];

    // East penetration 6/8 = 0.75 > south 4/8 = 0.5 → east wins.
    expect(findLdtkRoomExit(body(98, 96), center, project)?.dir).toBe('e');
    // South penetration 6/8 > east 4/8 → south wins.
    expect(findLdtkRoomExit(body(96, 98), center, project)?.dir).toBe('s');
    // Exact tie (5/8 both) → stable order n → e → s → w → east wins.
    expect(findLdtkRoomExit(body(97, 97), center, project)?.dir).toBe('e');
  });

  it('multi-world projects resolve neighbours across worlds[].levels', () => {
    const project: LdtkProject = {
      ...makeProject(
        {
          iid: 'A',
          worldX: 0,
          worldY: 0,
          pxWid: 100,
          pxHei: 100,
          neighbours: [{ dir: 'e', levelIid: 'B' }],
        },
      ),
      worlds: [
        {
          identifier: 'W1',
          iid: 'w1',
          worldLayout: 'Free',
          worldGridWidth: null,
          worldGridHeight: null,
          levels: [
            makeLevel({
              iid: 'B',
              worldX: 100,
              worldY: 0,
              pxWid: 100,
              pxHei: 100,
              neighbours: [{ dir: 'w', levelIid: 'A' }],
            }),
          ],
        },
      ],
    };
    expect(findLdtkRoomExit(body(98, 40), project.levels[0], project)?.neighbourLevelIid).toBe('B');
  });

  it('applies no gating: returns the top-ranked candidate even on an axis a detector would suppress (A.2 refactor)', () => {
    const project = makeProject(...ORTHO);
    const C = project.levels[0];
    // West penetration 6/8 outranks south 5/8, and a fresh detector would
    // suppress west (X unlatched) — but the stateless primitive has no
    // containment latch: it still returns the top-ranked west candidate.
    expect(findLdtkRoomExit(body(-6, 97), C, project)?.dir).toBe('w');
    // A single straddling candidate is returned identically.
    expect(findLdtkRoomExit(body(-3, 50), C, project)?.dir).toBe('w');
    expect(findLdtkRoomExit(body(-3, 50), C, project)?.neighbourLevelIid).toBe('W');
  });
});

describe('room transitions — mapLdtkRoomEntry / rebase', () => {
  it('preserves the actor top-left exactly through world space (forward + reversal)', () => {
    const project = makeProject(...PARTIAL);
    const from = project.levels[0];
    const to = project.levels[1];

    // Forward: crossing east at body (158, 50).
    const b = body(158, 50);
    const exit = findLdtkRoomExit(b, from, project)!;
    const entry = mapLdtkRoomEntry(b, from, to, exit);
    expect(entry.dir).toBe('e');
    expect(entry.toLevelIid).toBe('L1');
    // World-position identities.
    expect(to.worldX + entry.x).toBe(from.worldX + b.x);
    expect(to.worldY + entry.y).toBe(from.worldY + b.y);

    // Rapid reversal: the actor in L1-local at (entry.x, entry.y) crosses back
    // west; the re-mapped L0-local position round-trips to the original body.
    const back = body(entry.x, entry.y);
    const backExit = findLdtkRoomExit(back, to, project)!;
    const backEntry = mapLdtkRoomEntry(back, to, from, backExit);
    expect(from.worldX + backEntry.x).toBe(to.worldX + back.x);
    expect(from.worldY + backEntry.y).toBe(to.worldY + back.y);
    expect(backEntry.x).toBe(b.x);
    expect(backEntry.y).toBe(b.y);
  });

  it('does not clamp: a body crossing the seam maps to a negative destination-local x', () => {
    const project = makeProject(...PARTIAL);
    const from = project.levels[0];
    const to = project.levels[1];
    const b = body(159, 50); // 1 px past the east edge (body right = 167).
    const exit = findLdtkRoomExit(b, from, project)!;
    const entry = mapLdtkRoomEntry(b, from, to, exit);
    expect(entry.x).toBe(-1); // 159 - 160, un-clamped (momentum-preserving).
  });

  it('rebasePointBetweenLdtkRooms preserves world position in both directions', () => {
    const project = makeProject(...PARTIAL);
    const from = project.levels[0];
    const to = project.levels[1];
    const p = { x: 10, y: 10 };
    const inDest = rebasePointBetweenLdtkRooms(p, from, to);
    expect(inDest).toEqual({ x: -150, y: 10 });
    // Round-trip identity.
    const round = rebasePointBetweenLdtkRooms(inDest, to, from);
    expect(round).toEqual(p);
  });
});

describe('room transitions — transitionPlatformerToRoom', () => {
  function makeStateWith(over: { vx?: number; vy?: number; facing?: 1 | -1 }): PlatformerState {
    const base = createPlatformerState(158, 50);
    return {
      ...base,
      core: {
        ...base.core,
        vx: over.vx ?? 220,
        vy: over.vy ?? -140,
        facing: over.facing ?? 1,
        onGround: false,
      },
      // Distinct locomotion content to prove the slice is carried verbatim.
      locomotion: { ...base.locomotion, coyoteTimer: 0.05, stamina: 42 },
    };
  }

  it('returns seam-entry provenance + preserves momentum, facing, and slices', () => {
    const state = makeStateWith({});
    const entry = { x: -2, y: 50, dir: 'e' as const, toLevelIid: 'L1' };
    const { state: next, spawn } = transitionPlatformerToRoom(state, entry);

    expect(spawn).toEqual({ x: -2, y: 50, source: 'seam-entry' });
    // Position rebased; momentum + facing preserved (an airborne entry keeps vy).
    expect(next.core.x).toBe(-2);
    expect(next.core.y).toBe(50);
    expect(next.core.vx).toBe(220);
    expect(next.core.vy).toBe(-140);
    expect(next.core.facing).toBe(1);
    // Ability + locomotion slices carried verbatim.
    expect(next.abilities).toBe(state.abilities);
    expect(next.locomotion).toBe(state.locomotion);
    expect(next.locomotion.stamina).toBe(42);
    // Per-tick output channels cleared.
    expect(next.events.justLanded).toBe(false);
    expect(next.interactions.length).toBe(0);
    expect(next.moments.length).toBe(0);
    // Conservative support: without destination solids, onGround=false + no contacts.
    expect(next.core.onGround).toBe(false);
    expect(next.core.contacts.groundId).toBeNull();
    expect(next.core.contacts.ceilingId).toBeNull();
  });

  it('revalidates exact ground support with destination solids (no repositioning)', () => {
    const state = makeStateWith({ vy: 0 });
    const entry = { x: 40, y: 76, dir: 'e' as const, toLevelIid: 'L1' };
    const floor: Solid = { id: 'dest-floor', x: -100, y: 100, width: 400, height: 16 };
    const { state: next } = transitionPlatformerToRoom(state, entry, {
      destinationSolids: [floor],
    });
    // Body height 24 → bottom at 100, flush with the floor top.
    expect(next.core.onGround).toBe(true);
    expect(next.core.contacts.groundId).toBe('dest-floor');
    // Never moved/repositioned beyond `entry`.
    expect(next.core.x).toBe(40);
    expect(next.core.y).toBe(76);

    // Airborne entry with solids present but no support under it stays airborne.
    const air = transitionPlatformerToRoom(state, entry, {
      destinationSolids: [{ id: 'far', x: -500, y: 500, width: 10, height: 10 }],
    });
    expect(air.state.core.onGround).toBe(false);
    expect(air.state.core.contacts.groundId).toBeNull();
  });

  it('revalidates against the CEILING under negative gravity', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, gravity: -980 };
    const state = makeStateWith({});
    const entry = { x: 40, y: 4, dir: 'e' as const, toLevelIid: 'L1' };
    const ceiling: Solid = { id: 'dest-ceil', x: -100, y: -20, width: 400, height: 24 };
    const { state: next } = transitionPlatformerToRoom(state, entry, {
      destinationSolids: [ceiling],
      config,
    });
    // Body top at 4... ceiling bottom at 4 → flush under inverted gravity.
    expect(next.core.onGround).toBe(true);
    expect(next.core.contacts.ceilingId).toBe('dest-ceil');
  });
});

// --- detectLdtkRoomExit — re-arm hysteresis (tick-tock prevention) ---------
//
// `findLdtkRoomExit` is a bare stateless crossing: after an east exit,
// `mapLdtkRoomEntry` preserves the actor's exact world position, leaving part
// of its AABB at a negative destination-local X — so the next call in the
// destination detects the reverse west exit before the actor clears the seam.
// `detectLdtkRoomExit` wraps it with an immutable re-arm state that gates the
// reverse exit until the actor moves back inside by the deadband.

describe('detectLdtkRoomExit', () => {
  it('reproduces and prevents the east→west tick-tock at the seam', () => {
    // L0 east edge at world x=160 (local x=160). Body at L0-local (158, 50):
    // right edge 166 > 160 → east exit fires.
    const project = makeProject(...PARTIAL);
    // The actor has been polling inside L0 (fully contained on both axes)
    // before walking into the east seam, so its armed state carries the
    // containment latches.
    let state: RoomExitDetectorState = {
      blockedEntryEdge: null,
      expectedLevelIid: null,
      fullyInsideXIid: 'L0',
      fullyInsideYIid: 'L0',
    };
    const d1 = detectLdtkRoomExit(state, body(158, 50), project.levels[0], project);
    expect(d1.exit?.dir).toBe('e');
    expect(d1.exit?.neighbourLevelIid).toBe('L1');
    // The next state gates the west edge in L1 (the destination entry edge).
    expect(d1.state.blockedEntryEdge).toBe('w');
    expect(d1.state.expectedLevelIid).toBe('L1');
    state = d1.state;

    // Actor mapped into L1: world x = 0 + 158 = 158; L1-local = 158 - 160 = -2.
    // Right edge at -2 + 8 = 6, i.e. body sits at L1-local x=-2..6, straddling
    // the west seam. The bare helper WOULD fire west here; the detector holds.
    const d2 = detectLdtkRoomExit(state, body(-2, 50), project.levels[1], project);
    expect(d2.exit).toBeUndefined();
    expect(d2.state.blockedEntryEdge).toBe('w'); // still gated
    state = d2.state;

    // Sub-margin jitter (x = -1, still < margin) keeps the gate closed.
    const d3 = detectLdtkRoomExit(state, body(-1, 50), project.levels[1], project);
    expect(d3.exit).toBeUndefined();
    expect(d3.state.blockedEntryEdge).toBe('w');
    state = d3.state;

    // Once the actor clears the west edge by the deadband (x >= margin), the
    // detector re-arms and a fresh forward poll can fire.
    const d4 = detectLdtkRoomExit(state, body(1, 50), project.levels[1], project);
    expect(d4.exit).toBeUndefined(); // body inside L1, no edge crossed
    expect(d4.state.blockedEntryEdge).toBeNull(); // re-armed
  });

  it('releases the gate and fires the reverse exit when the body backs fully out', () => {
    // The doorway back-out scenario: a quick tap through a seam crosses with
    // sub-deadband penetration, then reverses before ever clearing the gate.
    // The body ends up fully west of L1 (zero overlap) while still inside the
    // shared Y span [0,112] — a genuine reverse crossing the gate must report
    // instead of suppressing forever (previously: consumers' void checks
    // killed the actor right after the transition).
    const project = makeProject(...PARTIAL);
    const gated = { blockedEntryEdge: 'w' as const, expectedLevelIid: 'L1', fullyInsideXIid: null, fullyInsideYIid: null };
    // Body at L1-local x = -8..0: no overlap with L1 → the gate releases.
    const d = detectLdtkRoomExit(gated, body(-8, 50), project.levels[1], project);
    expect(d.exit?.dir).toBe('w');
    expect(d.exit?.neighbourLevelIid).toBe('L0');
    // The reverse exit re-gates the east edge in the room it returns to.
    expect(d.state.blockedEntryEdge).toBe('e');
    expect(d.state.expectedLevelIid).toBe('L0');
  });

  it('still gates a body that straddles the arrival seam (hysteresis band)', () => {
    const project = makeProject(...PARTIAL);
    const gated = { blockedEntryEdge: 'w' as const, expectedLevelIid: 'L1', fullyInsideXIid: null, fullyInsideYIid: null };
    // Body at L1-local x = -7.9..0.1: a 0.1px overlap keeps it straddling the
    // seam. The bare helper WOULD fire west here (that is the tick-tock); the
    // detector must still hold until the deadband is cleared or the body
    // departs the room entirely.
    const d = detectLdtkRoomExit(gated, body(-7.9, 50), project.levels[1], project);
    expect(d.exit).toBeUndefined();
    expect(d.state.blockedEntryEdge).toBe('w');
  });

  it('an out-of-span back-out is void AND releases the gate (no infinite hold)', () => {
    const project = makeProject(...PARTIAL);
    const gated = { blockedEntryEdge: 'w' as const, expectedLevelIid: 'L1', fullyInsideXIid: null, fullyInsideYIid: null };
    // Fully west of L1 AND below the shared Y span [0,112] (body y 120..128):
    // the departure is void per contract, and the detector must release to
    // armed rather than holding the gate against a room the actor has left.
    const d = detectLdtkRoomExit(gated, body(-8, 120), project.levels[1], project);
    expect(d.exit).toBeUndefined();
    expect(d.state.blockedEntryEdge).toBeNull();
    expect(d.state.expectedLevelIid).toBeNull();
  });

  it('a gated body that departs through another edge is released too', () => {
    // While gated, the hold suppressed EVERY edge — including falls out an
    // unrelated edge. Once the body no longer overlaps the room, the gate
    // releases and the bare helper governs: L1 has no south neighbour, so this
    // departure is void, and the state comes back armed.
    const project = makeProject(...PARTIAL);
    const gated = { blockedEntryEdge: 'w' as const, expectedLevelIid: 'L1', fullyInsideXIid: null, fullyInsideYIid: null };
    const d = detectLdtkRoomExit(gated, body(50, 129), project.levels[1], project);
    expect(d.exit).toBeUndefined();
    expect(d.state.blockedEntryEdge).toBeNull();
  });

  it('gates each entry-edge direction independently (exact seam → margin)', () => {
    const project = makeProject(...PARTIAL);
    // West entry edge: body at the seam (x=0) is blocked; at margin it clears.
    const blockedW = { blockedEntryEdge: 'w' as const, expectedLevelIid: 'L1', fullyInsideXIid: null, fullyInsideYIid: null };
    expect(detectLdtkRoomExit(blockedW, body(0, 50), project.levels[1], project).exit).toBeUndefined();
    expect(detectLdtkRoomExit(blockedW, body(DEFAULT_EXIT_DEADBAND, 50), project.levels[1], project).state.blockedEntryEdge).toBeNull();
    // East entry edge: body.right ≤ pxWid − margin. L0 pxWid=160.
    const blockedE = { blockedEntryEdge: 'e' as const, expectedLevelIid: 'L0', fullyInsideXIid: null, fullyInsideYIid: null };
    expect(detectLdtkRoomExit(blockedE, body(160 - 8, 50), project.levels[0], project).exit).toBeUndefined();
    expect(detectLdtkRoomExit(blockedE, body(160 - 8 - DEFAULT_EXIT_DEADBAND, 50), project.levels[0], project).state.blockedEntryEdge).toBeNull();
    // North entry edge: body.y ≥ margin.
    const blockedN = { blockedEntryEdge: 'n' as const, expectedLevelIid: 'L1', fullyInsideXIid: null, fullyInsideYIid: null };
    expect(detectLdtkRoomExit(blockedN, body(50, 0), project.levels[1], project).exit).toBeUndefined();
    expect(detectLdtkRoomExit(blockedN, body(50, DEFAULT_EXIT_DEADBAND), project.levels[1], project).state.blockedEntryEdge).toBeNull();
    // South entry edge: body.bottom ≤ pxHei − margin. L0 pxHei=112.
    const blockedS = { blockedEntryEdge: 's' as const, expectedLevelIid: 'L0', fullyInsideXIid: null, fullyInsideYIid: null };
    expect(detectLdtkRoomExit(blockedS, body(50, 112 - 8), project.levels[0], project).exit).toBeUndefined();
    expect(detectLdtkRoomExit(blockedS, body(50, 112 - 8 - DEFAULT_EXIT_DEADBAND), project.levels[0], project).state.blockedEntryEdge).toBeNull();
  });

  it('does not let an unrelated flush edge block re-arm', () => {
    // A grounded actor flush with L1's south floor (body.bottom === pxHei=128)
    // while clearing a WEST entry seam must still re-arm: only the entry edge
    // is gated, not every edge. (Otherwise a grounded actor could never leave.)
    const project = makeProject(...PARTIAL);
    const blockedW = { blockedEntryEdge: 'w' as const, expectedLevelIid: 'L1', fullyInsideXIid: null, fullyInsideYIid: null };
    const grounded = body(DEFAULT_EXIT_DEADBAND, 128 - 8); // flush with floor, x past margin
    const d = detectLdtkRoomExit(blockedW, grounded, project.levels[1], project);
    expect(d.state.blockedEntryEdge).toBeNull(); // west cleared despite flush south
  });

  it('honors a custom deadband', () => {
    const project = makeProject(...PARTIAL);
    const blockedW = { blockedEntryEdge: 'w' as const, expectedLevelIid: 'L1', fullyInsideXIid: null, fullyInsideYIid: null };
    // With a 5px deadband, x=1 (which clears the default) is still blocked.
    expect(detectLdtkRoomExit(blockedW, body(1, 50), project.levels[1], project, { deadband: 5 }).exit).toBeUndefined();
    expect(detectLdtkRoomExit(blockedW, body(1, 50), project.levels[1], project, { deadband: 5 }).state.blockedEntryEdge).toBe('w');
    // At x=5 the custom margin clears.
    expect(detectLdtkRoomExit(blockedW, body(5, 50), project.levels[1], project, { deadband: 5 }).state.blockedEntryEdge).toBeNull();
  });

  it('falls back to the default deadband for NaN / Infinity / zero / negative', () => {
    const project = makeProject(...PARTIAL);
    const blockedW = { blockedEntryEdge: 'w' as const, expectedLevelIid: 'L1', fullyInsideXIid: null, fullyInsideYIid: null };
    for (const bad of [NaN, Infinity, -Infinity, 0, -1, -0.5]) {
      // x=1 clears the default (1px) but not any larger margin; each bad value
      // must behave as the default, never as a larger or zero margin.
      const d = detectLdtkRoomExit(blockedW, body(1, 50), project.levels[1], project, { deadband: bad });
      expect(d.state.blockedEntryEdge).toBeNull();
    }
  });

  it('resets stale state when the expected level no longer matches (teleport)', () => {
    // Blocked for L1, but polled in L0 — a teleport/retry/stale snapshot. The
    // detector resets to armed and polls the supplied room in the same call.
    const project = makeProject(...PARTIAL);
    const stale = { blockedEntryEdge: 'w' as const, expectedLevelIid: 'L1', fullyInsideXIid: null, fullyInsideYIid: null };
    // Body inside L0 → no exit; state is armed (not still gated for L1).
    const d = detectLdtkRoomExit(stale, body(50, 50), project.levels[0], project);
    expect(d.exit).toBeUndefined();
    expect(d.state.blockedEntryEdge).toBeNull();
    expect(d.state.expectedLevelIid).toBeNull();
  });

  it('never mutates the input state; equal inputs produce equal outputs', () => {
    const project = makeProject(...PARTIAL);
    const state = createRoomExitDetectorState();
    const snapshot = { ...state };
    detectLdtkRoomExit(state, body(158, 50), project.levels[0], project);
    expect(state).toEqual(snapshot); // input unchanged
    // Deterministic: two calls with equal inputs return equal results.
    const a = detectLdtkRoomExit(state, body(158, 50), project.levels[0], project);
    const b = detectLdtkRoomExit(state, body(158, 50), project.levels[0], project);
    expect(a).toEqual(b);
  });

  it('a JSON-cloned state behaves identically to the original', () => {
    const project = makeProject(...PARTIAL);
    const state = { blockedEntryEdge: 'w' as const, expectedLevelIid: 'L1', fullyInsideXIid: null, fullyInsideYIid: null };
    const cloned = JSON.parse(JSON.stringify(state)) as typeof state;
    // Same inputs → same outputs, original vs JSON clone.
    const fromOriginal = detectLdtkRoomExit(state, body(0, 50), project.levels[1], project);
    const fromClone = detectLdtkRoomExit(cloned, body(0, 50), project.levels[1], project);
    expect(fromClone).toEqual(fromOriginal);
  });

  it('is transactional: discarding an exit result leaves the original armed state reusable', () => {
    const project = makeProject(...PARTIAL);
    // A consumer may reject a transition (e.g. destination compile pending).
    // It must be able to keep the ORIGINAL state and re-poll next tick. The
    // actor had been polling inside L0, so the armed state carries latches.
    const armed: RoomExitDetectorState = {
      blockedEntryEdge: null,
      expectedLevelIid: null,
      fullyInsideXIid: 'L0',
      fullyInsideYIid: 'L0',
    };
    const d = detectLdtkRoomExit(armed, body(158, 50), project.levels[0], project);
    expect(d.exit).toBeDefined();
    // Reject: do NOT adopt d.state. Re-polling the same armed state still fires.
    const d2 = detectLdtkRoomExit(armed, body(158, 50), project.levels[0], project);
    expect(d2.exit).toBeDefined();
  });

  it('independent detector states for two actors do not interfere', () => {
    const project = makeProject(...PARTIAL);
    // Actor A has been polling inside L0 (both latches set); actor B's fresh
    // state is unlatched. No shared mutable closure between them.
    const a: RoomExitDetectorState = {
      blockedEntryEdge: null,
      expectedLevelIid: null,
      fullyInsideXIid: 'L0',
      fullyInsideYIid: 'L0',
    };
    const b = createRoomExitDetectorState();
    const da = detectLdtkRoomExit(a, body(158, 50), project.levels[0], project);
    // Actor A has transitioned (gated); actor B's state is still armed and can
    // poll independently. No shared mutable closure between them.
    expect(da.state.blockedEntryEdge).toBe('w');
    const db = detectLdtkRoomExit(b, body(50, 50), project.levels[0], project);
    expect(db.exit).toBeUndefined();
    expect(db.state.blockedEntryEdge).toBeNull();
  });

  it('does not change findLdtkRoomExit (backward compatibility)', () => {
    // The bare stateless primitive still fires on the exact crossing — the
    // detector is purely additive and does not alter the underlying helper.
    const project = makeProject(...PARTIAL);
    expect(findLdtkRoomExit(body(158, 50), project.levels[0], project)?.dir).toBe('e');
    expect(findLdtkRoomExit(body(-2, 50), project.levels[1], project)?.dir).toBe('w');
  });

  // --- per-axis containment latch (0.15.0 — Change A) ----------------------
  //
  // Every exit additionally requires the body to have been fully contained
  // ON THE EXIT'S CROSSING AXIS (e/w → X, n/s → Y) in the current room once
  // since the last exit. The latch is sticky (historical containment) and is
  // re-derived from body geometry on every poll, so a discarded or freshly
  // created detector state cannot tick-tock (Celerock bug-1 reset-immunity).

  it('Celerock bug-1 repro: a FRESH detector cannot fire the reverse exit on a straddling arrival (reset-immunity)', () => {
    const project = makeProject(...ORTHO);
    const from = project.levels[0]; // C
    const to = project.levels[1]; // W
    const b = body(-3, 50); // straddling C's west seam, vertically inside

    // Pre-transition: the actor polled inside C, so both latches are set and
    // the west exit fires.
    const latched: RoomExitDetectorState = {
      blockedEntryEdge: null,
      expectedLevelIid: null,
      fullyInsideXIid: 'C',
      fullyInsideYIid: 'C',
    };
    const d1 = detectLdtkRoomExit(latched, b, from, project);
    expect(d1.exit?.dir).toBe('w');
    expect(d1.exit?.neighbourLevelIid).toBe('W');

    // mapLdtkRoomEntry preserves world position: C-local -3 → W-local 97, so
    // the arrival straddles W's EAST edge.
    const entry = mapLdtkRoomEntry(b, from, to, d1.exit!);
    expect(entry.x).toBe(97);

    // BUG 1: the consumer discards d1.state and installs a FRESH detector in
    // the destination. The bare helper WOULD fire the reverse east exit; the
    // containment latch re-derives from body geometry and suppresses it.
    const d2 = detectLdtkRoomExit(createRoomExitDetectorState(), body(entry.x, entry.y), to, project);
    expect(d2.exit).toBeUndefined();
    expect(d2.state.fullyInsideXIid).toBeNull(); // still straddling east
    expect(d2.state.fullyInsideYIid).toBe('W'); // vertically inside on arrival
  });

  it('orthogonal exit preserved: a sticky Y latch lets the south exit fire on poll 2 while west stays suppressed', () => {
    const project = makeProject(...ORTHO);
    const C = project.levels[0];

    // Poll 1 — fresh detector, body straddling the west seam (x < 0) and
    // vertically inside: no exit, X unlatched, Y latches to C. Adopt state.
    const p1 = detectLdtkRoomExit(createRoomExitDetectorState(), body(-3, 50), C, project);
    expect(p1.exit).toBeUndefined();
    expect(p1.state.fullyInsideXIid).toBeNull();
    expect(p1.state.fullyInsideYIid).toBe('C');

    // Poll 2 — the body crosses the south seam while STILL straddling west.
    // The west candidate is skipped (X unlatched); the south exit fires off
    // the sticky Y latch carried from poll 1 (a body crossing the south seam
    // is not Y-contained on this poll, so only stickiness can report it).
    const p2 = detectLdtkRoomExit(p1.state, body(-3, 97), C, project);
    expect(p2.exit?.dir).toBe('s');
    expect(p2.exit?.neighbourLevelIid).toBe('S');
  });

  it('candidate-skip ordering: a gated west candidate that OUTRANKS south is skipped, not fatal to the poll', () => {
    const project = makeProject(...ORTHO);
    const C = project.levels[0];

    // Poll 1 — same fixture shape: Y latches, X does not.
    const p1 = detectLdtkRoomExit(createRoomExitDetectorState(), body(-6, 50), C, project);
    expect(p1.exit).toBeUndefined();
    expect(p1.state.fullyInsideXIid).toBeNull();
    expect(p1.state.fullyInsideYIid).toBe('C');

    // Poll 2 — west penetration 6/8 outranks south 5/8: the bare helper
    // ranks WEST first (no gating)…
    const b2 = body(-6, 97);
    expect(findLdtkRoomExit(b2, C, project)?.dir).toBe('w');
    // …but the detector walks the ranked list, skips the gated west
    // candidate, and returns the surviving south exit.
    const p2 = detectLdtkRoomExit(p1.state, b2, C, project);
    expect(p2.exit?.dir).toBe('s');
    expect(p2.exit?.neighbourLevelIid).toBe('S');
  });

  it('per-axis latch semantics: containment on one axis latches only that axis; each latch persists across straddles', () => {
    const project = makeProject(...ORTHO);
    const C = project.levels[0];

    // X-contained only (straddling south): X latches, Y stays null, and the
    // south candidate is gated by the unlatched Y axis.
    const xOnly = detectLdtkRoomExit(createRoomExitDetectorState(), body(40, 97), C, project);
    expect(xOnly.exit).toBeUndefined();
    expect(xOnly.state.fullyInsideXIid).toBe('C');
    expect(xOnly.state.fullyInsideYIid).toBeNull();

    // Y-contained only (straddling west): Y latches, X stays null.
    const yOnly = detectLdtkRoomExit(createRoomExitDetectorState(), body(-3, 50), C, project);
    expect(yOnly.exit).toBeUndefined();
    expect(yOnly.state.fullyInsideXIid).toBeNull();
    expect(yOnly.state.fullyInsideYIid).toBe('C');

    // Stickiness: the latched Y survives a later poll where the body is NOT
    // Y-contained. The body straddles C's unlinked north edge (void — no
    // candidate), so the armed return exposes the retained latches.
    const northVoid = detectLdtkRoomExit(yOnly.state, body(40, -3), C, project);
    expect(northVoid.exit).toBeUndefined();
    expect(northVoid.state.fullyInsideYIid).toBe('C'); // retained, not re-derived
    expect(northVoid.state.fullyInsideXIid).toBe('C'); // latched fresh this poll

    // Mirror: the latched X survives a poll straddling the unlinked east edge.
    const eastVoid = detectLdtkRoomExit(xOnly.state, body(97, 50), C, project);
    expect(eastVoid.exit).toBeUndefined();
    expect(eastVoid.state.fullyInsideXIid).toBe('C'); // retained
    expect(eastVoid.state.fullyInsideYIid).toBe('C'); // latched fresh this poll
  });

  it('a latch keyed to a different room counts as unlatched (teleport/stale state)', () => {
    const project = makeProject(...ORTHO);
    const C = project.levels[0];
    const foreign: RoomExitDetectorState = {
      blockedEntryEdge: null,
      expectedLevelIid: null,
      fullyInsideXIid: 'L0', // latched in another room's coordinates
      fullyInsideYIid: 'W',
    };
    // The body straddles west; the foreign X latch must NOT satisfy the gate.
    const d = detectLdtkRoomExit(foreign, body(-3, 50), C, project);
    expect(d.exit).toBeUndefined();
    expect(d.state.fullyInsideXIid).toBeNull();
    expect(d.state.fullyInsideYIid).toBe('C'); // Y re-derives from geometry
  });

  it('full back-out release: an axis-gated body that fully departs the room gets the bare helper result', () => {
    const project = makeProject(...ORTHO);
    const C = project.levels[0];

    // X-gated while straddling west (X never latched in C)…
    const straddle = detectLdtkRoomExit(createRoomExitDetectorState(), body(-3, 50), C, project);
    expect(straddle.exit).toBeUndefined();

    // …but fully west of C (zero overlap) the axis gate releases and the
    // genuine reverse crossing is reported.
    const reverse = detectLdtkRoomExit(straddle.state, body(-9, 50), C, project);
    expect(reverse.exit?.dir).toBe('w');
    expect(reverse.exit?.neighbourLevelIid).toBe('W');
    expect(reverse.state.blockedEntryEdge).toBe('e');
    expect(reverse.state.expectedLevelIid).toBe('W');

    // A fully-departed void crossing (north has no neighbour) releases to
    // armed instead of holding the gate forever.
    const voidOut = detectLdtkRoomExit(straddle.state, body(40, -9), C, project);
    expect(voidOut.exit).toBeUndefined();
    expect(voidOut.state.blockedEntryEdge).toBeNull();
    expect(voidOut.state.expectedLevelIid).toBeNull();
  });

  it('impossible containment: a body taller than the room never latches Y — N/S gated until back-out, E/W unaffected', () => {
    // C2 is 100×10; an 8×20 body can never be Y-contained inside it.
    const project = makeProject(
      { iid: 'C2', worldX: 0, worldY: 0, pxWid: 100, pxHei: 10, neighbours: [{ dir: 'w', levelIid: 'W2' }, { dir: 's', levelIid: 'S2' }] },
      { iid: 'W2', worldX: -100, worldY: 0, pxWid: 100, pxHei: 10, neighbours: [{ dir: 'e', levelIid: 'C2' }] },
      { iid: 'S2', worldX: 0, worldY: 10, pxWid: 100, pxHei: 50, neighbours: [{ dir: 'n', levelIid: 'C2' }] },
    );
    const room = project.levels[0];
    const tall = (x: number, y: number): Rect => body(x, y, 8, 20);

    // South crossings stay suppressed poll after poll, and the state stays
    // ARMED — the suppression lives in the latch, not blockedEntryEdge.
    const s1 = detectLdtkRoomExit(createRoomExitDetectorState(), tall(40, 5), room, project);
    expect(s1.exit).toBeUndefined();
    expect(s1.state.fullyInsideYIid).toBeNull();
    expect(s1.state.blockedEntryEdge).toBeNull();
    const s2 = detectLdtkRoomExit(s1.state, tall(40, 8), room, project);
    expect(s2.exit).toBeUndefined();
    expect(s2.state.fullyInsideYIid).toBeNull();

    // E/W is unaffected: X latched on the interior polls above, so a west
    // crossing fires — even though south (10/20) OUTRANKS west (3/8) in the
    // ranked list, the walk skips the gated south candidate and takes west.
    expect(s2.state.fullyInsideXIid).toBe('C2');
    const west = detectLdtkRoomExit(s2.state, tall(-3, 0), room, project);
    expect(west.exit?.dir).toBe('w');
    expect(west.exit?.neighbourLevelIid).toBe('W2');

    // Full back-out below releases the south gate: the bare helper reports
    // the genuine south departure even though Y never latched.
    const south = detectLdtkRoomExit(s2.state, tall(40, 11), room, project);
    expect(south.exit?.dir).toBe('s');
    expect(south.exit?.neighbourLevelIid).toBe('S2');
  });

  it('corner arrival is unchanged from 0.14.1: a sticky Y latch lets the south exit fire after clearing the entry deadband', () => {
    const project = makeProject(...ORTHO);
    const C = project.levels[0];

    // Arrived through C's west edge: the blocked gate holds while the body
    // is inside the deadband, but the latch update runs BEFORE gating, so
    // the held state already carries the Y latch.
    const arrived: RoomExitDetectorState = {
      blockedEntryEdge: 'w',
      expectedLevelIid: 'C',
      fullyInsideXIid: null,
      fullyInsideYIid: null,
    };
    const p1 = detectLdtkRoomExit(arrived, body(0, 50), C, project);
    expect(p1.exit).toBeUndefined();
    expect(p1.state.blockedEntryEdge).toBe('w'); // still inside the deadband
    expect(p1.state.fullyInsideYIid).toBe('C'); // latched while gated

    // Poll 2 — the body clears the west deadband while now straddling the
    // UNRELATED south edge. A non-sticky (instantaneous) latch would gate
    // this south exit; the sticky latch keeps 0.14.1 behavior: it fires.
    const p2 = detectLdtkRoomExit(p1.state, body(1, 97), C, project);
    expect(p2.exit?.dir).toBe('s');
    expect(p2.exit?.neighbourLevelIid).toBe('S');
  });

  it('a 0.14.1-serialized state (no latch fields) is treated as unlatched and loses no tick', () => {
    const project = makeProject(...ORTHO);
    const C = project.levels[0];
    // Only the two original fields, exactly as saved by 0.14.1 consumers
    // (JSON round-trip leaves the latch fields genuinely absent).
    const legacy = JSON.parse(
      JSON.stringify({ blockedEntryEdge: null, expectedLevelIid: null }),
    ) as RoomExitDetectorState;

    // Treated as unlatched: a straddling body stays suppressed…
    const straddle = detectLdtkRoomExit(legacy, body(-3, 50), C, project);
    expect(straddle.exit).toBeUndefined();

    // …and an interior body latches BOTH axes on its first poll (step 3
    // precedes all gating), so the very next crossing poll fires without an
    // extra waiting tick.
    const interior = detectLdtkRoomExit(legacy, body(40, 50), C, project);
    expect(interior.exit).toBeUndefined();
    expect(interior.state.fullyInsideXIid).toBe('C');
    expect(interior.state.fullyInsideYIid).toBe('C');
    const crossing = detectLdtkRoomExit(interior.state, body(-3, 50), C, project);
    expect(crossing.exit?.dir).toBe('w');
  });

  it('an exit-firing poll returns the next state with both axis latches cleared', () => {
    const project = makeProject(...ORTHO);
    const C = project.levels[0];
    const latched: RoomExitDetectorState = {
      blockedEntryEdge: null,
      expectedLevelIid: null,
      fullyInsideXIid: 'C',
      fullyInsideYIid: 'C',
    };
    const d = detectLdtkRoomExit(latched, body(-3, 50), C, project);
    expect(d.exit?.dir).toBe('w');
    expect(d.state).toEqual({
      blockedEntryEdge: 'e',
      expectedLevelIid: 'W',
      fullyInsideXIid: null,
      fullyInsideYIid: null,
    });
  });

  it('purity: the new latch fields never mutate the input state; JSON clones behave identically', () => {
    const project = makeProject(...ORTHO);
    const C = project.levels[0];
    const latched: RoomExitDetectorState = {
      blockedEntryEdge: null,
      expectedLevelIid: null,
      fullyInsideXIid: 'C',
      fullyInsideYIid: 'C',
    };
    const snapshot = { ...latched };
    const fired = detectLdtkRoomExit(latched, body(-3, 50), C, project);
    expect(fired.exit?.dir).toBe('w');
    expect(latched).toEqual(snapshot); // input unchanged by a firing poll

    // Deterministic and clone-stable: original vs JSON clone → equal results.
    const clone = JSON.parse(JSON.stringify(latched)) as RoomExitDetectorState;
    expect(detectLdtkRoomExit(clone, body(-3, 50), C, project)).toEqual(fired);
    expect(detectLdtkRoomExit(latched, body(-3, 50), C, project)).toEqual(fired);

    // The gated (no-exit) return is equally pure.
    const held = detectLdtkRoomExit(createRoomExitDetectorState(), body(-3, 50), C, project);
    expect(held.exit).toBeUndefined();
    const heldSnapshot = { ...held.state };
    detectLdtkRoomExit(held.state, body(-3, 97), C, project);
    expect(held.state).toEqual(heldSnapshot);
  });
});
