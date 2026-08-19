/**
 * Characterization — the seam discontinuity, BEFORE the apron exists.
 *
 * At a linked seam the walkway is continuous in the authored world:
 * `games/celerock.ldtk` `Level_0` carries a floor run at y=160 spanning
 * x=296→320, and `Level_1` continues it at y=160 spanning x=0→32, the two rooms
 * flush at worldX 0 and 320. It is NOT continuous in the simulation — the
 * kernel takes `solids` per tick and every consumer passes strictly the ACTIVE
 * room's set, so while the body is still in the source room the destination's
 * floor does not exist.
 *
 * A body that leaves the source ledge while falling therefore drops through the
 * hole where the neighbour's floor should be, and `mapLdtkRoomEntry` — which is
 * world-exact by design — faithfully preserves that overshoot into the
 * destination, landing the body INSIDE the floor.
 *
 * This file pins that behavior deliberately. It builds the tick set the way
 * consumers do today (source solids only), so it stays valid as the
 * "without apron" baseline after `room-seam-apron.ts` lands: the apron changes
 * what a consumer PASSES to the kernel, not this math.
 *
 * The measurement it records — embed depth is a function of fall speed — is the
 * reason a fixed-tolerance entry repair cannot close this class. See
 * `ROOM_SEAM_APRON_PLAN.md`.
 *
 * @module
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseLdtkProject } from '../ldtk';
import {
  createLdtkRoomCache,
  createPrecisionPlatformerConfig,
  createRoomTransitionSession,
  mapLdtkRoomEntry,
  pollRoomTransition,
  stepPlatformer,
} from '../platformer';
import type { PlatformerConfig, PlatformerState } from '../platformer';

const DT = 1 / 60;
/** Top face of the walkway that runs across the Level_0 → Level_1 seam. */
const WALKWAY_TOP = 160;

function loadProject() {
  const url = new URL('../../games/celerock.ldtk', import.meta.url);
  const { project } = parseLdtkProject(readFileSync(url, 'utf8'));
  if (project === undefined) throw new Error('games/celerock.ldtk failed to parse');
  return project;
}

const project = loadProject();
const rooms = createLdtkRoomCache(project, {
  playerWidthForTileSize: (tileSize) => 0.5 * tileSize,
  playerHeightForTileSize: (tileSize) => 1.5 * tileSize,
  spawnResolution: 'rest-on-surface',
});
const levelByName = new Map(project.levels.map((level) => [level.identifier, level]));
const source = rooms.get(levelByName.get('Level_0')!.iid);
const destination = rooms.get(levelByName.get('Level_1')!.iid);

/** The shipped Celerock tuning (games/celerock.md §5.3). */
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
  moveX: 1,
  moveY: 0,
  jump: { pressed: false, released: false, held: false },
  dash: { pressed: false, released: false, held: false },
  grab: { pressed: false, released: false, held: false },
} as const;

/**
 * Leave the source ledge already falling at `vy`, and report how deep into the
 * destination walkway the mapped entry lands. Positive = embedded.
 */
function embedDepthLeavingLedgeAt(vy: number): number {
  let state: PlatformerState = {
    ...source.compiled.initialState,
    core: {
      ...source.compiled.initialState.core,
      x: 317, y: 145, vx: 200, vy, onGround: false,
    },
  };
  let session = createRoomTransitionSession();

  for (let tick = 0; tick < 80; tick += 1) {
    // The tick set every consumer builds today: the ACTIVE room only.
    state = stepPlatformer(state, RUN_EAST, source.solids, DT, config).state;
    const poll = pollRoomTransition(session, state.core, source.ldtkLevel, project);
    session = poll.session;
    if (poll.result.type === 'exit') {
      const entry = mapLdtkRoomEntry(
        state.core, source.ldtkLevel, destination.ldtkLevel, poll.result.exit,
      );
      return entry.y + state.core.height - WALKWAY_TOP;
    }
  }
  throw new Error(`no seam crossing within 80 ticks at vy=${vy}`);
}

describe('seam discontinuity (characterization — no apron)', () => {
  it('the walkway is continuous in the authored world', () => {
    const sourceRun = source.solids.filter(
      (s) => s.y === WALKWAY_TOP && s.x + s.width === source.levelData.width,
    );
    const destinationRun = destination.solids.filter((s) => s.y === WALKWAY_TOP && s.x === 0);

    expect(sourceRun.length).toBeGreaterThan(0);
    expect(destinationRun.length).toBeGreaterThan(0);
    // Flush rooms, same floor height: nothing in the AUTHORED world explains a
    // fall here. Whatever goes wrong is a property of the simulation.
    expect(destination.ldtkLevel.worldX - source.ldtkLevel.worldX)
      .toBe(source.levelData.width);
  });

  it('embed depth into the destination floor is a function of fall speed', () => {
    const table = [120, 180, 229, 260, 300].map((vy) => ({
      vy, embed: Number(embedDepthLeavingLedgeAt(vy).toFixed(2)),
    }));

    // Monotonic in vy: faster fall, deeper embed. This is the shape that makes
    // a tuned constant the wrong tool — there is no threshold that is correct
    // at every speed.
    for (let i = 1; i < table.length; i += 1) {
      expect(table[i].embed).toBeGreaterThan(table[i - 1].embed);
    }

    // The slow crossing still clears the floor...
    expect(table[0].embed).toBeLessThan(0);
    // ...and the fast ones land inside it.
    expect(table[table.length - 1].embed).toBeGreaterThan(0);
  });

  it('a fast crossing embeds beyond the 1px entry-repair tolerance', () => {
    // `stabilizePlatformerRoomEntry` defaults to a 1px tolerance, which is
    // correct for float noise at the mapping boundary and cannot cover this:
    // the overshoot is real physics, not rounding. Raising the tolerance to
    // reach it would also yank genuinely airborne entries down onto floors.
    expect(embedDepthLeavingLedgeAt(300)).toBeGreaterThan(1);
  });
});
