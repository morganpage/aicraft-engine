import { describe, it, expect } from 'vitest';
import {
  findLdtkRoomExit,
  mapLdtkRoomEntry,
  transitionPlatformerToRoom,
  rebasePointBetweenLdtkRooms,
  createRoomExitDetectorState,
  detectLdtkRoomExit,
  DEFAULT_EXIT_DEADBAND,
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
    let state = createRoomExitDetectorState();
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

  it('gates each entry-edge direction independently (exact seam → margin)', () => {
    const project = makeProject(...PARTIAL);
    // West entry edge: body at the seam (x=0) is blocked; at margin it clears.
    const blockedW = { blockedEntryEdge: 'w' as const, expectedLevelIid: 'L1' };
    expect(detectLdtkRoomExit(blockedW, body(0, 50), project.levels[1], project).exit).toBeUndefined();
    expect(detectLdtkRoomExit(blockedW, body(DEFAULT_EXIT_DEADBAND, 50), project.levels[1], project).state.blockedEntryEdge).toBeNull();
    // East entry edge: body.right ≤ pxWid − margin. L0 pxWid=160.
    const blockedE = { blockedEntryEdge: 'e' as const, expectedLevelIid: 'L0' };
    expect(detectLdtkRoomExit(blockedE, body(160 - 8, 50), project.levels[0], project).exit).toBeUndefined();
    expect(detectLdtkRoomExit(blockedE, body(160 - 8 - DEFAULT_EXIT_DEADBAND, 50), project.levels[0], project).state.blockedEntryEdge).toBeNull();
    // North entry edge: body.y ≥ margin.
    const blockedN = { blockedEntryEdge: 'n' as const, expectedLevelIid: 'L1' };
    expect(detectLdtkRoomExit(blockedN, body(50, 0), project.levels[1], project).exit).toBeUndefined();
    expect(detectLdtkRoomExit(blockedN, body(50, DEFAULT_EXIT_DEADBAND), project.levels[1], project).state.blockedEntryEdge).toBeNull();
    // South entry edge: body.bottom ≤ pxHei − margin. L0 pxHei=112.
    const blockedS = { blockedEntryEdge: 's' as const, expectedLevelIid: 'L0' };
    expect(detectLdtkRoomExit(blockedS, body(50, 112 - 8), project.levels[0], project).exit).toBeUndefined();
    expect(detectLdtkRoomExit(blockedS, body(50, 112 - 8 - DEFAULT_EXIT_DEADBAND), project.levels[0], project).state.blockedEntryEdge).toBeNull();
  });

  it('does not let an unrelated flush edge block re-arm', () => {
    // A grounded actor flush with L1's south floor (body.bottom === pxHei=128)
    // while clearing a WEST entry seam must still re-arm: only the entry edge
    // is gated, not every edge. (Otherwise a grounded actor could never leave.)
    const project = makeProject(...PARTIAL);
    const blockedW = { blockedEntryEdge: 'w' as const, expectedLevelIid: 'L1' };
    const grounded = body(DEFAULT_EXIT_DEADBAND, 128 - 8); // flush with floor, x past margin
    const d = detectLdtkRoomExit(blockedW, grounded, project.levels[1], project);
    expect(d.state.blockedEntryEdge).toBeNull(); // west cleared despite flush south
  });

  it('honors a custom deadband', () => {
    const project = makeProject(...PARTIAL);
    const blockedW = { blockedEntryEdge: 'w' as const, expectedLevelIid: 'L1' };
    // With a 5px deadband, x=1 (which clears the default) is still blocked.
    expect(detectLdtkRoomExit(blockedW, body(1, 50), project.levels[1], project, { deadband: 5 }).exit).toBeUndefined();
    expect(detectLdtkRoomExit(blockedW, body(1, 50), project.levels[1], project, { deadband: 5 }).state.blockedEntryEdge).toBe('w');
    // At x=5 the custom margin clears.
    expect(detectLdtkRoomExit(blockedW, body(5, 50), project.levels[1], project, { deadband: 5 }).state.blockedEntryEdge).toBeNull();
  });

  it('falls back to the default deadband for NaN / Infinity / zero / negative', () => {
    const project = makeProject(...PARTIAL);
    const blockedW = { blockedEntryEdge: 'w' as const, expectedLevelIid: 'L1' };
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
    const stale = { blockedEntryEdge: 'w' as const, expectedLevelIid: 'L1' };
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
    const state = { blockedEntryEdge: 'w' as const, expectedLevelIid: 'L1' };
    const cloned = JSON.parse(JSON.stringify(state)) as typeof state;
    // Same inputs → same outputs, original vs JSON clone.
    const fromOriginal = detectLdtkRoomExit(state, body(0, 50), project.levels[1], project);
    const fromClone = detectLdtkRoomExit(cloned, body(0, 50), project.levels[1], project);
    expect(fromClone).toEqual(fromOriginal);
  });

  it('is transactional: discarding an exit result leaves the original armed state reusable', () => {
    // A consumer may reject a transition (e.g. destination compile pending).
    // It must be able to keep the ORIGINAL state and re-poll next tick.
    const project = makeProject(...PARTIAL);
    const armed = createRoomExitDetectorState();
    const d = detectLdtkRoomExit(armed, body(158, 50), project.levels[0], project);
    expect(d.exit).toBeDefined();
    // Reject: do NOT adopt d.state. Re-polling the same armed state still fires.
    const d2 = detectLdtkRoomExit(armed, body(158, 50), project.levels[0], project);
    expect(d2.exit).toBeDefined();
  });

  it('independent detector states for two actors do not interfere', () => {
    const project = makeProject(...PARTIAL);
    const a = createRoomExitDetectorState();
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
});
