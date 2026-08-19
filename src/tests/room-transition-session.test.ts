import { describe, it, expect } from 'vitest';
import {
  createRoomTransitionSession,
  pollRoomTransition,
  beginSessionRoomSlide,
  advanceSessionRoomSlide,
  endRoomTransitionSession,
  type RoomTransitionSessionState,
} from '../platformer/room-transition-session';
import {
  detectLdtkRoomExit,
  createRoomExitDetectorState,
  type RoomExitDetectorState,
} from '../platformer/room-transitions';
import {
  beginRoomSlideFromBrain,
  advanceRoomSlide,
  enterRoomSlideCameraSpace,
  finishRoomSlideCameraSpace,
  cancelRoomSlideCameraSpace,
} from '../platformer/room-slide';
import type { CompiledLdtkRoom } from '../platformer/ldtk-room';
import type { LdtkLevel, LdtkProject, LdtkNeighbour } from '../ldtk/types';
import type { Rect } from '../collision/types';
import type { CameraBrain } from '../camera';

/**
 * Room-transition session — the orchestrator owning `{ detector, slide }` as
 * ONE immutable state machine (0.15.0 hardening, Change B).
 *
 * The matrix: suppressed polls during an active slide (identical session
 * reference), begin refusal during an active slide, poll auto-adoption
 * (including the discarded-session tick-tock repro), the enter-rebase applied
 * exactly once at begin, the finish-rebase applied exactly once at completion
 * (and never twice — advance-after-completion idempotency), the
 * reduced-motion immediate cut, death-mid-slide cancel-with-rebase equality,
 * defensive refusals (bad viewport, missing destination), and purity
 * (no input mutation, JSON-clone detector equivalence).
 *
 * @module
 */

const DT = 1 / 60;

// --- fixtures (same two-room LDtk style as room-transitions.test.ts) --------

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

// Two cardinally-linked rooms sharing an east/west seam at world x=160.
const PROJECT = makeProject(
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
);
const L0 = PROJECT.levels[0];
const L1 = PROJECT.levels[1];

/** Duck-typed CompiledLdtkRoom — the slide reads only `.ldtkLevel`. */
function roomOf(level: LdtkLevel): CompiledLdtkRoom {
  return { ldtkLevel: level } as unknown as CompiledLdtkRoom;
}

const SRC = roomOf(L0);
const DST = roomOf(L1);
const VIEWPORT = { width: 160, height: 112 };
const DEST_VIEW = { camera: { x: 0, y: 0 }, zoom: 1.5 };
const ACTOR = { sourceLocal: { x: 10, y: 10 }, destinationLocal: { x: -150, y: 10 } };

function brainAt(x: number, y: number, zoom = 2): CameraBrain {
  return {
    camera: { x, y },
    zoom,
    activeId: 'room-cam',
    bodyCamera: { x, y },
    lensZoom: zoom,
    blend: null,
  };
}

// A letterbox brain (camera peeking left/up of the source room) makes the
// slide's sourceOffset NON-ZERO — (30, 24) for this geometry — so every
// enter/finish/cancel rebase is visibly applied, not a no-op +0.
const LETTERBOX_BRAIN = brainAt(-30, -24);

function slideInput(
  brain: CameraBrain,
  viewport: Readonly<{ width: number; height: number }> = VIEWPORT,
): {
  source: CompiledLdtkRoom;
  destination: CompiledLdtkRoom;
  viewport: Readonly<{ width: number; height: number }>;
  brain: CameraBrain;
  destinationView: Readonly<typeof DEST_VIEW>;
  actor: Readonly<typeof ACTOR>;
} {
  return {
    source: SRC,
    destination: DST,
    viewport,
    brain,
    destinationView: DEST_VIEW,
    actor: ACTOR,
  };
}

/** JSON snapshot (functions replaced by a marker so slides compare stably). */
function snapSession(s: RoomTransitionSessionState): string {
  return JSON.stringify({
    detector: s.detector,
    slide: s.slide === null ? null : { ...s.slide, easing: null },
  });
}

function snap(v: unknown): string {
  return JSON.stringify(v);
}

// --- pollRoomTransition ------------------------------------------------------

describe('room transition session — pollRoomTransition', () => {
  it('suppresses exits while a slide is active and returns the IDENTICAL session reference', () => {
    const begun = beginSessionRoomSlide(createRoomTransitionSession(), slideInput(LETTERBOX_BRAIN));
    expect(begun.ok).toBe(true);
    // The body crosses L0's east seam, but a slide is in flight: held, and the
    // session comes back byte-identical (Celerock bug 2 impossible).
    const poll = pollRoomTransition(begun.session, body(158, 50), L0, PROJECT);
    expect(poll.result).toEqual({ type: 'suppressed-slide-active' });
    expect(poll.session).toBe(begun.session);
  });

  it('auto-adopts detector state: an exit poll carries the post-exit detector without consumer hand-adoption', () => {
    let session = createRoomTransitionSession();
    // An interior poll latches containment in L0 (the actor has been polling
    // inside the room before reaching the seam).
    const interior = pollRoomTransition(session, body(50, 50), L0, PROJECT);
    expect(interior.result).toEqual({ type: 'idle' });
    session = interior.session;
    expect(session.detector.fullyInsideXIid).toBe('L0');

    const crossing = pollRoomTransition(session, body(158, 50), L0, PROJECT);
    expect(crossing.result.type).toBe('exit');
    if (crossing.result.type === 'exit') {
      expect(crossing.result.exit.dir).toBe('e');
      expect(crossing.result.exit.neighbourLevelIid).toBe('L1');
    }
    // Auto-adopted: the returned session carries exactly the detector state the
    // bare detector returns — the consumer stores the session, nothing else.
    const manual = detectLdtkRoomExit(session.detector, body(158, 50), L0, PROJECT);
    expect(crossing.session.detector).toEqual(manual.state);
    expect(crossing.session.detector.blockedEntryEdge).toBe('w');
    expect(crossing.session.detector.expectedLevelIid).toBe('L1');
    expect(crossing.session.slide).toBeNull();
  });

  it('a consumer that discards the returned session cannot tick-tock: a straddling destination poll fires no second exit (stale OR fresh session)', () => {
    // The actor polled inside L0, fired the east exit, and was mapped into L1
    // at local (-2, 50) — straddling the west seam (Celerock bug-1 geometry).
    let session = createRoomTransitionSession();
    session = pollRoomTransition(session, body(50, 50), L0, PROJECT).session;
    const preExit = session; // the consumer forgets to store anything past here.
    const fired = pollRoomTransition(session, body(158, 50), L0, PROJECT);
    expect(fired.result.type).toBe('exit');

    const arrival = body(-2, 50);
    // (a) STALE session: pre-exit detector with latches keyed to L0.
    const stale = pollRoomTransition(preExit, arrival, L1, PROJECT);
    expect(stale.result).toEqual({ type: 'idle' });
    // (b) FRESH session: the Celerock bug-1 detector reset.
    const fresh = pollRoomTransition(createRoomTransitionSession(), arrival, L1, PROJECT);
    expect(fresh.result).toEqual({ type: 'idle' });
    // The containment latch re-derived from geometry either way — the discarded
    // session only ever cost deadband jitter absorption, never correctness.
    expect(fresh.session.detector.fullyInsideXIid).toBeNull();
    expect(fresh.session.detector.fullyInsideYIid).toBe('L1');
  });
});

// --- beginSessionRoomSlide ---------------------------------------------------

describe('room transition session — beginSessionRoomSlide', () => {
  it('applies the enter-rebase exactly once: the returned brain equals enterRoomSlideCameraSpace(slide, input brain)', () => {
    const session = createRoomTransitionSession();
    const input = slideInput(LETTERBOX_BRAIN);
    const res = beginSessionRoomSlide(session, input);
    expect(res.ok).toBe(true);
    const manualSlide = beginRoomSlideFromBrain(SRC, DST, VIEWPORT, LETTERBOX_BRAIN, DEST_VIEW, ACTOR);
    const manualEntered = enterRoomSlideCameraSpace(manualSlide, LETTERBOX_BRAIN);
    expect(res.brain).toEqual(manualEntered);
    // The fixture has a non-zero sourceOffset — the rebase demonstrably moved
    // the brain into slide space ((-30,-24) + (30,24) → (0,0)).
    expect(manualSlide.space.sourceOffset).toEqual({ x: 30, y: 24 });
    expect(res.brain.camera).toEqual({ x: 0, y: 0 });
    expect(res.brain.activeId).toBeNull();
    expect(res.session.slide).toEqual(manualSlide);
  });

  it('refuses a second begin during an active slide: ok false, session and brain unchanged', () => {
    const begun = beginSessionRoomSlide(createRoomTransitionSession(), slideInput(LETTERBOX_BRAIN));
    expect(begun.ok).toBe(true);
    const secondInput = slideInput(brainAt(5, 5));
    const second = beginSessionRoomSlide(begun.session, secondInput);
    expect(second.ok).toBe(false);
    expect(second.session).toBe(begun.session);
    expect(second.brain).toBe(secondInput.brain);
    // The refused begin applied no enter-rebase (a stray rebase would corrupt
    // the in-flight slide camera by one room offset).
    expect(second.brain.camera).toEqual({ x: 5, y: 5 });
  });

  it('refuses non-finite / zero / negative viewport dimensions without throwing', () => {
    for (const bad of [NaN, Infinity, -Infinity, 0, -1]) {
      const session = createRoomTransitionSession();
      const badWidth = beginSessionRoomSlide(session, slideInput(LETTERBOX_BRAIN, { width: bad, height: 112 }));
      expect(badWidth.ok).toBe(false);
      expect(badWidth.session).toBe(session);
      expect(badWidth.brain).toBe(LETTERBOX_BRAIN);
      const badHeight = beginSessionRoomSlide(session, slideInput(LETTERBOX_BRAIN, { width: 160, height: bad }));
      expect(badHeight.ok).toBe(false);
      expect(badHeight.session).toBe(session);
      expect(badHeight.brain).toBe(LETTERBOX_BRAIN);
      expect(badHeight.session.slide).toBeNull();
    }
  });

  it('refuses missing destination room inputs without throwing (defensive, never-throw)', () => {
    const session = createRoomTransitionSession();
    const input = {
      ...slideInput(LETTERBOX_BRAIN),
      destination: undefined as unknown as CompiledLdtkRoom,
    };
    const res = beginSessionRoomSlide(session, input);
    expect(res.ok).toBe(false);
    expect(res.session).toBe(session);
    expect(res.brain).toBe(LETTERBOX_BRAIN);
  });
});

// --- advanceSessionRoomSlide -------------------------------------------------

describe('room transition session — advanceSessionRoomSlide', () => {
  it('returns the brain UNCHANGED while the slide is still active (per-tick camera drive is the consumer’s job)', () => {
    const begun = beginSessionRoomSlide(createRoomTransitionSession(), slideInput(LETTERBOX_BRAIN));
    expect(begun.ok).toBe(true);
    const advanced = advanceSessionRoomSlide(begun.session, DT, begun.brain);
    expect(advanced.done).toBe(false);
    expect(advanced.brain).toBe(begun.brain); // identical reference — no rebase mid-slide
    expect(advanced.session.slide).not.toBeNull();
    expect(advanced.session.slide?.active).toBe(true);
    expect(advanced.session.slide?.elapsed).toBeGreaterThan(0);
  });

  it('normal completion: the finishing advance applies finishRoomSlideCameraSpace exactly once and clears the slide', () => {
    const begun = beginSessionRoomSlide(
      createRoomTransitionSession(),
      slideInput(LETTERBOX_BRAIN),
      { duration: 0.3 },
    );
    expect(begun.ok).toBe(true);

    let session = begun.session;
    let brain = begun.brain;
    let manualSlide = begun.session.slide!;
    let manualBrain = begun.brain;
    let finishCount = 0;
    let finished: ReturnType<typeof advanceSessionRoomSlide> | null = null;

    for (let i = 0; i < 30; i++) {
      const next = advanceSessionRoomSlide(session, DT, brain);
      session = next.session;
      brain = next.brain;
      manualSlide = advanceRoomSlide(manualSlide, DT);
      if (!manualSlide.active) {
        // This was the finishing advance: apply the manual finish-rebase and
        // compare — the session must have done exactly the same, exactly once.
        manualBrain = finishRoomSlideCameraSpace(manualSlide, manualBrain);
        finishCount++;
        finished = next;
        break;
      }
      expect(next.brain).toBe(manualBrain); // inert while active
      expect(next.done).toBe(false);
    }
    expect(finishCount).toBe(1);
    expect(finished).not.toBeNull();
    expect(finished!.done).toBe(true);
    expect(finished!.brain).toEqual(manualBrain);
    expect(finished!.session.slide).toBeNull();
    // The rebase is real: enter put the brain at slide-space (0,0); finish
    // subtracts destinationOffset (190,24) → destination-local (-190,-24).
    expect(finished!.brain.camera).toEqual({ x: -190, y: -24 });
  });

  it('advance-after-completion is inert: the brain comes back byte-identical and done stays true (no double rebase)', () => {
    const begun = beginSessionRoomSlide(createRoomTransitionSession(), slideInput(LETTERBOX_BRAIN));
    expect(begun.ok).toBe(true);
    let res = advanceSessionRoomSlide(begun.session, DT, begun.brain);
    let guard = 0;
    while (!res.done && guard < 120) {
      res = advanceSessionRoomSlide(res.session, DT, res.brain);
      guard++;
    }
    expect(res.done).toBe(true);
    const finishedBrain = res.brain;

    const again = advanceSessionRoomSlide(res.session, DT, finishedBrain);
    expect(again.done).toBe(true);
    expect(again.brain).toBe(finishedBrain); // the finish-rebase is NOT applied twice
    expect(again.session.slide).toBeNull();
    // A further no-op advance is equally inert (a double rebase would silently
    // offset the camera by one room).
    const third = advanceSessionRoomSlide(again.session, DT, again.brain);
    expect(third.done).toBe(true);
    expect(third.brain).toBe(finishedBrain);
  });

  it('reduced-motion immediate cut: enter at begin; the FIRST advance finishes, rebases, and clears', () => {
    const begun = beginSessionRoomSlide(
      createRoomTransitionSession(),
      slideInput(LETTERBOX_BRAIN),
      { reducedMotion: true },
    );
    expect(begun.ok).toBe(true);
    const slide = begun.session.slide!;
    expect(slide.active).toBe(false);
    expect(slide.t).toBe(1);
    // The enter-rebase was already applied at begin…
    expect(begun.brain).toEqual(enterRoomSlideCameraSpace(slide, LETTERBOX_BRAIN));

    const advanced = advanceSessionRoomSlide(begun.session, DT, begun.brain);
    expect(advanced.done).toBe(true);
    expect(advanced.session.slide).toBeNull();
    // …and the first advance applies the finish-rebase exactly once — enter +
    // finish land in one presentation frame.
    expect(advanced.brain).toEqual(finishRoomSlideCameraSpace(slide, begun.brain));
    expect(advanced.brain.camera).toEqual({ x: -190, y: -24 }); // destination-local
  });
});

// --- endRoomTransitionSession ------------------------------------------------

describe('room transition session — endRoomTransitionSession', () => {
  it('death mid-slide: the output brain equals a direct cancelRoomSlideCameraSpace(…, \'destination\') — destination-local, not slide space', () => {
    const begun = beginSessionRoomSlide(createRoomTransitionSession(), slideInput(LETTERBOX_BRAIN));
    expect(begun.ok).toBe(true);
    // The consumer drove the slide-space camera for a while (their job), e.g.
    // to (200, 100), then died: the simulation resumes in the destination.
    const deathBrain: CameraBrain = {
      ...begun.brain,
      camera: { x: 200, y: 100 },
      bodyCamera: { x: 200, y: 100 },
    };
    const ended = endRoomTransitionSession(begun.session, deathBrain, 'destination');
    expect(ended.brain).toEqual(
      cancelRoomSlideCameraSpace(begun.session.slide!, deathBrain, 'destination'),
    );
    // (200,100) − destinationOffset (190,24) = (10,76): destination-room-local.
    expect(ended.brain.camera).toEqual({ x: 10, y: 76 });
    expect(ended.brain.activeId).toBeNull();
    // The session comes back idle with a fresh detector.
    expect(ended.session.slide).toBeNull();
    expect(ended.session.detector).toEqual(createRoomExitDetectorState());
  });

  it('cancel-to-source rebases through the source offset (rapid-reversal support)', () => {
    const begun = beginSessionRoomSlide(createRoomTransitionSession(), slideInput(LETTERBOX_BRAIN));
    const reversalBrain: CameraBrain = {
      ...begun.brain,
      camera: { x: 200, y: 100 },
      bodyCamera: { x: 200, y: 100 },
    };
    const ended = endRoomTransitionSession(begun.session, reversalBrain, 'source');
    expect(ended.brain).toEqual(
      cancelRoomSlideCameraSpace(begun.session.slide!, reversalBrain, 'source'),
    );
    // (200,100) − sourceOffset (30,24) = (170,76): source-room-local.
    expect(ended.brain.camera).toEqual({ x: 170, y: 76 });
    expect(ended.session.slide).toBeNull();
  });

  it('with no active slide: brain unchanged and a fresh idle session', () => {
    const session = pollRoomTransition(
      createRoomTransitionSession(),
      body(50, 50),
      L0,
      PROJECT,
    ).session;
    const brain = brainAt(20, 20);
    const ended = endRoomTransitionSession(session, brain, 'destination');
    expect(ended.brain).toBe(brain); // unchanged
    expect(ended.session).toEqual(createRoomTransitionSession());
    expect(ended.session.slide).toBeNull();
    expect(ended.session.detector).toEqual(createRoomExitDetectorState());
  });
});

// --- cameraRebaseDelta (screen-continuous raw-camera consumers) --------------

describe('room transition session — cameraRebaseDelta (parallax continuity)', () => {
  it('begin reports the enter-rebase: the delta equals both the slide’s sourceOffset and the brain-camera jump it caused', () => {
    const begun = beginSessionRoomSlide(createRoomTransitionSession(), slideInput(LETTERBOX_BRAIN));
    expect(begun.ok).toBe(true);
    // The fixture geometry: sourceOffset (30, 24), so the enter-rebase moved the
    // camera from (-30,-24) to (0,0).
    expect(begun.cameraRebaseDelta).toEqual({ x: 30, y: 24 });
    expect(begun.cameraRebaseDelta).toEqual(begun.session.slide!.space.sourceOffset);
    expect(begun.cameraRebaseDelta).toEqual({
      x: begun.brain.camera.x - LETTERBOX_BRAIN.camera.x,
      y: begun.brain.camera.y - LETTERBOX_BRAIN.camera.y,
    });
  });

  it('a refused begin reports zero — no rebase happened, so nothing to compensate', () => {
    const begun = beginSessionRoomSlide(createRoomTransitionSession(), slideInput(LETTERBOX_BRAIN));
    const second = beginSessionRoomSlide(begun.session, slideInput(brainAt(5, 5)));
    expect(second.ok).toBe(false);
    expect(second.cameraRebaseDelta).toEqual({ x: 0, y: 0 });
  });

  it('the completing advance reports the finish-rebase (negated destinationOffset); active and idle advances report zero', () => {
    const begun = beginSessionRoomSlide(
      createRoomTransitionSession(),
      slideInput(LETTERBOX_BRAIN),
      { duration: 0.3 },
    );
    expect(begun.ok).toBe(true);

    let session = begun.session;
    let brain = begun.brain;
    let sawActiveZero = false;
    let completing: ReturnType<typeof advanceSessionRoomSlide> | null = null;
    for (let i = 0; i < 30; i++) {
      const next = advanceSessionRoomSlide(session, DT, brain);
      session = next.session;
      brain = next.brain;
      if (next.done) {
        completing = next;
        break;
      }
      expect(next.cameraRebaseDelta).toEqual({ x: 0, y: 0 });
      sawActiveZero = true;
    }
    expect(sawActiveZero).toBe(true);
    expect(completing).not.toBeNull();
    // destinationOffset is (190, 24); the finish-rebase subtracts it.
    expect(completing!.cameraRebaseDelta).toEqual({ x: -190, y: -24 });
    // An advance after completion stays inert.
    const idle = advanceSessionRoomSlide(completing!.session, DT, completing!.brain);
    expect(idle.cameraRebaseDelta).toEqual({ x: 0, y: 0 });
  });

  it('end reports the cancel-rebase (negated offset of the room cancelled INTO); zero with no active slide', () => {
    const begun = beginSessionRoomSlide(createRoomTransitionSession(), slideInput(LETTERBOX_BRAIN));
    const fed: CameraBrain = {
      ...begun.brain,
      camera: { x: 200, y: 100 },
      bodyCamera: { x: 200, y: 100 },
    };
    const toDest = endRoomTransitionSession(begun.session, fed, 'destination');
    expect(toDest.cameraRebaseDelta).toEqual({ x: -190, y: -24 });
    const toSource = endRoomTransitionSession(begun.session, fed, 'source');
    expect(toSource.cameraRebaseDelta).toEqual({ x: -30, y: -24 });
    const noSlide = endRoomTransitionSession(createRoomTransitionSession(), fed, 'destination');
    expect(noSlide.cameraRebaseDelta).toEqual({ x: 0, y: 0 });
  });

  it('the compensated camera is continuous: subtracting the accumulated deltas, a rebase never moves it', () => {
    // The screen-continuity contract a parallax backdrop relies on: for the
    // brain itself, `camera - Σ cameraRebaseDelta` is INVARIANT across every
    // space change (enter, finish, cancel). With the consumer's own camera
    // drive frozen, the compensated value is identical before the slide and
    // after completion — the raw camera teleported by the rebases, the
    // compensated one did not move at all.
    const begun = beginSessionRoomSlide(
      createRoomTransitionSession(),
      slideInput(LETTERBOX_BRAIN),
      { duration: 0.3 },
    );
    expect(begun.ok).toBe(true);
    const before = { x: LETTERBOX_BRAIN.camera.x, y: LETTERBOX_BRAIN.camera.y };

    let shift = { x: 0, y: 0 };
    let session = begun.session;
    let brain = begun.brain;
    shift = {
      x: shift.x + begun.cameraRebaseDelta.x,
      y: shift.y + begun.cameraRebaseDelta.y,
    };
    expect(brain.camera.x - shift.x).toBe(before.x);
    expect(brain.camera.y - shift.y).toBe(before.y);

    for (let i = 0; i < 30; i++) {
      const next = advanceSessionRoomSlide(session, DT, brain);
      session = next.session;
      brain = next.brain;
      shift = {
        x: shift.x + next.cameraRebaseDelta.x,
        y: shift.y + next.cameraRebaseDelta.y,
      };
      expect(brain.camera.x - shift.x).toBe(before.x);
      expect(brain.camera.y - shift.y).toBe(before.y);
      if (next.done) break;
    }
    expect(session.slide).toBeNull();
    // The raw camera DID teleport (destination-local after the finish-rebase —
    // (-30,-24) + (30,24) + (-190,-24)); only the compensated one held still.
    expect(brain.camera).toEqual({ x: -190, y: -24 });

    // Death-mid-slide continuity: cancel out of an active slide and the same
    // invariant holds for the cancel-rebase too.
    const begun2 = beginSessionRoomSlide(createRoomTransitionSession(), slideInput(LETTERBOX_BRAIN));
    const ended = endRoomTransitionSession(begun2.session, begun2.brain, 'destination');
    expect(
      ended.brain.camera.x - (begun2.cameraRebaseDelta.x + ended.cameraRebaseDelta.x),
    ).toBe(before.x);
    expect(
      ended.brain.camera.y - (begun2.cameraRebaseDelta.y + ended.cameraRebaseDelta.y),
    ).toBe(before.y);
  });

  it('reduced-motion cut: enter and finish deltas both land, and their sum compensates the double rebase in one frame', () => {
    const begun = beginSessionRoomSlide(
      createRoomTransitionSession(),
      slideInput(LETTERBOX_BRAIN),
      { reducedMotion: true },
    );
    expect(begun.ok).toBe(true);
    expect(begun.cameraRebaseDelta).toEqual({ x: 30, y: 24 });
    const first = advanceSessionRoomSlide(begun.session, DT, begun.brain);
    expect(first.done).toBe(true);
    expect(first.cameraRebaseDelta).toEqual({ x: -190, y: -24 });
    // Camera: (-30,-24) + (30,24) [enter] + (-190,-24) [finish] = (-190,-24);
    // Σ deltas = (-160, 0); compensated = (-190,-24) − (-160,0) = (-30,-24).
    expect(first.brain.camera.x - (begun.cameraRebaseDelta.x + first.cameraRebaseDelta.x))
      .toBe(LETTERBOX_BRAIN.camera.x);
    expect(first.brain.camera.y - (begun.cameraRebaseDelta.y + first.cameraRebaseDelta.y))
      .toBe(LETTERBOX_BRAIN.camera.y);
  });
});

// --- purity / immutability ---------------------------------------------------

describe('room transition session — purity', () => {
  it('never mutates any input across poll / begin / advance / end (deep snapshots)', () => {
    const session0 = createRoomTransitionSession();
    const session0Snap = snapSession(session0);
    const bodyRect = body(158, 50);
    const bodySnap = snap(bodyRect);
    const levelSnap = snap(L0);
    const projectSnap = snap(PROJECT);

    const fired = pollRoomTransition(session0, bodyRect, L0, PROJECT);
    expect(snapSession(session0)).toBe(session0Snap);
    expect(snap(bodyRect)).toBe(bodySnap);
    expect(snap(L0)).toBe(levelSnap);
    expect(snap(PROJECT)).toBe(projectSnap);

    const input = slideInput(LETTERBOX_BRAIN);
    const inputSnap = snap(input);
    const brainSnap = snap(LETTERBOX_BRAIN);
    const firedSnap = snapSession(fired.session);
    const begun = beginSessionRoomSlide(fired.session, input);
    expect(begun.ok).toBe(true);
    expect(snap(input)).toBe(inputSnap);
    expect(snap(LETTERBOX_BRAIN)).toBe(brainSnap);
    expect(snapSession(fired.session)).toBe(firedSnap);

    const begunSnap = snapSession(begun.session);
    const enteredSnap = snap(begun.brain);
    const advanced = advanceSessionRoomSlide(begun.session, DT, begun.brain);
    expect(snapSession(begun.session)).toBe(begunSnap);
    expect(snap(begun.brain)).toBe(enteredSnap);

    const advancedSnap = snapSession(advanced.session);
    const deathSnap = snap(begun.brain);
    const ended = endRoomTransitionSession(advanced.session, begun.brain, 'source');
    expect(snapSession(advanced.session)).toBe(advancedSnap);
    expect(snap(begun.brain)).toBe(deathSnap);
    expect(ended.session.slide).toBeNull();
  });

  it('a JSON-cloned detector behaves identically (detector-only serialization)', () => {
    // Build a session whose detector carries post-exit state, then serialize
    // the detector alone (the documented save shape) and reconstruct.
    let session = createRoomTransitionSession();
    session = pollRoomTransition(session, body(50, 50), L0, PROJECT).session;
    const gated = pollRoomTransition(session, body(158, 50), L0, PROJECT).session;
    const cloned: RoomTransitionSessionState = {
      detector: JSON.parse(JSON.stringify(gated.detector)) as RoomExitDetectorState,
      slide: null,
    };
    const fromOriginal = pollRoomTransition(gated, body(-2, 50), L1, PROJECT);
    const fromClone = pollRoomTransition(cloned, body(-2, 50), L1, PROJECT);
    expect(fromClone).toEqual(fromOriginal);
  });
});
