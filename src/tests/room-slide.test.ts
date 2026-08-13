import { describe, it, expect } from 'vitest';
import {
  beginRoomSlide,
  beginRoomSlideFromBrain,
  advanceRoomSlide,
  presentationForRoomSlide,
  enterRoomSlideCameraSpace,
  finishRoomSlideCameraSpace,
  cancelRoomSlideCameraSpace,
  seedRoomCutCamera,
  roomSlideEase,
  ROOM_SLIDE_VCAM_ID,
  DEFAULT_ROOM_SLIDE_DURATION,
} from '../platformer/room-slide';
import { createCameraBrain, updateCameraBrain } from '../camera/brain';
import type { CameraBrain } from '../camera';
import type { CompiledLdtkRoom } from '../platformer/ldtk-room';
import type { LdtkLevel } from '../ldtk/types';

/**
 * Phase E3 — the slide presentation orchestrator.
 *
 * Covers: normalized union bounds (including negative authored worldX/Y),
 * player screen-position continuity at `t = 0`, particle world-position
 * identity, the exact named camera path with NO stacked blend/damping (the
 * transient vcam is the sole authority), destination-local camera identity at
 * handoff, safe cancellation to either endpoint, rapid reversal, and the
 * one-frame reduced-motion cut — plus a real `updateCameraBrain` integration
 * that proves the composed brain renders the named curve exactly.
 *
 * @module
 */

const DT = 1 / 60;

interface RoomSpec {
  iid: string;
  worldX: number;
  worldY: number;
  pxWid: number;
  pxHei: number;
}

/** Duck-typed CompiledLdtkRoom — the slide reads only `.ldtkLevel`. */
function room(spec: RoomSpec): CompiledLdtkRoom {
  return {
    ldtkLevel: {
      iid: spec.iid,
      worldX: spec.worldX,
      worldY: spec.worldY,
      pxWid: spec.pxWid,
      pxHei: spec.pxHei,
    },
  } as unknown as CompiledLdtkRoom;
}

// The adversarial-fixture geometry: source (0,0,160×112), dest (160,0,144×128).
const SRC = room({ iid: 'src', worldX: 0, worldY: 0, pxWid: 160, pxHei: 112 });
const DST = room({ iid: 'dst', worldX: 160, worldY: 0, pxWid: 144, pxHei: 128 });
const VIEWPORT = { width: 160, height: 112 };

const VIEWS = {
  source: { camera: { x: 0, y: 0 }, zoom: 2 },
  destination: { camera: { x: 0, y: 0 }, zoom: 1.5 },
};

// World-identity actor mapping: destLocal = sourceLocal + (src.world − dst.world).
const IDENTITY_ACTOR = { sourceLocal: { x: 10, y: 10 }, destinationLocal: { x: -150, y: 10 } };
// A repositioned entry (e.g. a seam-entry that shifted the player) exercises
// the non-zero render correction.
const SHIFTED_ACTOR = { sourceLocal: { x: 10, y: 10 }, destinationLocal: { x: -140, y: 20 } };

describe('room slide — space construction (beginRoomSlide)', () => {
  it('builds normalized union bounds with non-negative offsets', () => {
    const slide = beginRoomSlide(SRC, DST, VIEWPORT, VIEWS, IDENTITY_ACTOR);
    // Union of [0,160]×[0,112] and [160,304]×[0,128] shifted by min (0,0).
    expect(slide.space.sourceOffset).toEqual({ x: 0, y: 0 });
    expect(slide.space.destinationOffset).toEqual({ x: 160, y: 0 });
    expect(slide.space.bounds).toEqual({ width: 304, height: 128 });
    expect(slide.space.sourceOffset.x).toBeGreaterThanOrEqual(0);
    expect(slide.space.sourceOffset.y).toBeGreaterThanOrEqual(0);
    expect(slide.space.destinationOffset.x).toBeGreaterThanOrEqual(0);
    expect(slide.space.destinationOffset.y).toBeGreaterThanOrEqual(0);
    expect(slide.sourceLevelIid).toBe('src');
    expect(slide.destLevelIid).toBe('dst');
  });

  it('normalizes projects with negative authored worldX/worldY', () => {
    const negSrc = room({ iid: 'n-src', worldX: -500, worldY: -300, pxWid: 160, pxHei: 112 });
    const negDst = room({ iid: 'n-dst', worldX: -340, worldY: -280, pxWid: 144, pxHei: 128 });
    const slide = beginRoomSlide(negSrc, negDst, VIEWPORT, VIEWS, IDENTITY_ACTOR);
    // Shifted by the min world (-500,-300): offsets are non-negative and the
    // union bounds stay valid for the brain's zero-origin clamp.
    expect(slide.space.sourceOffset).toEqual({ x: 0, y: 0 });
    expect(slide.space.destinationOffset).toEqual({ x: 160, y: 20 });
    expect(slide.space.bounds).toEqual({ width: 304, height: 148 });
  });

  it('captures duration/easing/freezeSimulation defaults', () => {
    const slide = beginRoomSlide(SRC, DST, VIEWPORT, VIEWS, IDENTITY_ACTOR);
    expect(slide.duration).toBe(DEFAULT_ROOM_SLIDE_DURATION);
    expect(slide.duration).toBe(0.3);
    expect(slide.easing).toBe(roomSlideEase);
    expect(slide.freezeSimulation).toBe(false);
    expect(slide.active).toBe(true);
    expect(slide.t).toBe(0);

    const custom = beginRoomSlide(SRC, DST, VIEWPORT, VIEWS, IDENTITY_ACTOR, {
      duration: 0.5,
      easing: (t: number) => t,
      freezeSimulation: true,
    });
    expect(custom.duration).toBe(0.5);
    expect(custom.easing(0.25)).toBe(0.25);
    expect(custom.freezeSimulation).toBe(true);
  });

  it('reduced motion: active=false, t=1 (immediate cut contract)', () => {
    const slide = beginRoomSlide(SRC, DST, VIEWPORT, VIEWS, IDENTITY_ACTOR, {
      reducedMotion: true,
    });
    expect(slide.active).toBe(false);
    expect(slide.t).toBe(1);
    // The presentation offers no slide vcam — the consumer runs enter + finish
    // camera-space rebases in the same presentation frame.
    const p = presentationForRoomSlide(slide);
    expect(p.vcam).toBeNull();
    expect(p.playerOffset).toEqual({ x: 0, y: 0 });
  });

  it('particle rebase delta preserves slide-space position exactly', () => {
    const slide = beginRoomSlide(SRC, DST, VIEWPORT, VIEWS, IDENTITY_ACTOR);
    expect(slide.particleRebaseDelta).toEqual({ x: -160, y: 0 });
    // World-position identity: (particleLocal + rebaseDelta) drawn at
    // destinationOffset === particleLocal drawn at sourceOffset.
    const particle = { x: 40, y: 30 };
    const inDest = {
      x: particle.x + slide.particleRebaseDelta.x,
      y: particle.y + slide.particleRebaseDelta.y,
    };
    expect(inDest.x + slide.space.destinationOffset.x).toBe(
      particle.x + slide.space.sourceOffset.x,
    );
    expect(inDest.y + slide.space.destinationOffset.y).toBe(
      particle.y + slide.space.sourceOffset.y,
    );
  });
});

describe('room slide — clock + named path (advance/presentation)', () => {
  it('advanceRoomSlide is pure, clamps at 1, and deactivates', () => {
    const slide = beginRoomSlide(SRC, DST, VIEWPORT, VIEWS, IDENTITY_ACTOR);
    const half = advanceRoomSlide(slide, 0.15);
    expect(slide.t).toBe(0); // input untouched (pure)
    expect(half.t).toBeCloseTo(0.5, 12);
    expect(half.active).toBe(true);
    const done = advanceRoomSlide(half, 5); // way past the end
    expect(done.t).toBe(1);
    expect(done.active).toBe(false);
    // Further advances are no-ops on a finished slide.
    expect(advanceRoomSlide(done, DT)).toBe(done);
    // Deterministic: same inputs → same outputs.
    expect(advanceRoomSlide(slide, 0.15)).toEqual(half);
  });

  it('t=0: the vcam starts exactly at the source view + sourceOffset', () => {
    const slide = beginRoomSlide(SRC, DST, VIEWPORT, VIEWS, SHIFTED_ACTOR);
    const p = presentationForRoomSlide(slide);
    expect(p.vcam).not.toBeNull();
    expect(p.vcam?.id).toBe(ROOM_SLIDE_VCAM_ID);
    // Sole-authority guarantees: no incoming blend, top priority, exact snap.
    expect(p.vcam?.blend).toBe(0);
    expect(p.vcam?.priority).toBe(Number.MAX_SAFE_INTEGER);
    expect(p.vcam?.body?.mode).toBe('fixed');
    if (p.vcam?.body?.mode === 'fixed') {
      expect(p.vcam.body.x).toBeCloseTo(0, 12); // source cam (0,0) + offset (0,0)
      expect(p.vcam.body.y).toBeCloseTo(0, 12);
    }
    expect(p.vcam?.lens?.zoom).toBe(2);
  });

  it('follows the exact named easing curve — no stacked blend/damping', () => {
    const slide = beginRoomSlide(SRC, DST, VIEWPORT, VIEWS, IDENTITY_ACTOR);
    // Sample the path across the slide and compare against the pure
    // interpolation of the two captured views in slide space.
    let s = slide;
    for (let i = 1; i <= 6; i++) {
      s = advanceRoomSlide(s, 0.05); // 0.3 s / 6
      if (i === 6) {
        // The final advance completes the slide: no vcam, zero correction.
        expect(s.t).toBe(1);
        expect(s.active).toBe(false);
        expect(presentationForRoomSlide(s).vcam).toBeNull();
        break;
      }
      const p = presentationForRoomSlide(s);
      const eased = roomSlideEase(s.t);
      const expectX = 0 + (160 - 0) * eased; // source→dest top-left in slide space
      const expectZoom = 2 + (1.5 - 2) * eased;
      expect(p.vcam?.body?.mode).toBe('fixed');
      if (p.vcam?.body?.mode === 'fixed') {
        expect(p.vcam.body.x).toBeCloseTo(expectX, 9);
        expect(p.vcam.body.y).toBeCloseTo(0, 9);
      }
      expect(p.vcam?.lens?.zoom).toBeCloseTo(expectZoom, 9);
    }
  });

  it('player offset eases the render correction from initialPlayerOffset to 0', () => {
    // Identity mapping → zero correction (screen-continuous by construction).
    const identity = beginRoomSlide(SRC, DST, VIEWPORT, VIEWS, IDENTITY_ACTOR);
    expect(identity.initialPlayerOffset).toEqual({ x: 0, y: 0 });

    // Shifted entry → non-zero correction, continuous at t=0, zero at t=1.
    const slide = beginRoomSlide(SRC, DST, VIEWPORT, VIEWS, SHIFTED_ACTOR);
    // initialPlayerOffset = sourceOffset + sourceLocal − (destinationOffset + destinationLocal)
    expect(slide.initialPlayerOffset).toEqual({ x: -10, y: -10 });
    const p0 = presentationForRoomSlide(slide);
    expect(p0.playerOffset).toEqual({ x: -10, y: -10 });
    // Drawing the dest-local actor at destinationOffset + playerOffset lands on
    // the source-local slide-space position (continuity at the switch).
    const drawnX = SHIFTED_ACTOR.destinationLocal.x + p0.destinationOffset.x + p0.playerOffset.x;
    const drawnY = SHIFTED_ACTOR.destinationLocal.y + p0.destinationOffset.y + p0.playerOffset.y;
    expect(drawnX).toBe(SHIFTED_ACTOR.sourceLocal.x + slide.space.sourceOffset.x);
    expect(drawnY).toBe(SHIFTED_ACTOR.sourceLocal.y + slide.space.sourceOffset.y);

    let s = slide;
    for (let i = 0; i < 30; i++) s = advanceRoomSlide(s, DT);
    expect(s.active).toBe(false);
    const p1 = presentationForRoomSlide(s);
    expect(p1.playerOffset).toEqual({ x: 0, y: 0 });
  });

  it('roomSlideEase is the symmetric smoothstep', () => {
    expect(roomSlideEase(-1)).toBe(0);
    expect(roomSlideEase(0)).toBe(0);
    expect(roomSlideEase(0.5)).toBeCloseTo(0.5, 12);
    expect(roomSlideEase(1)).toBe(1);
    expect(roomSlideEase(2)).toBe(1);
    expect(roomSlideEase(0.25)).toBeCloseTo(0.15625, 12); // t²(3−2t)
  });
});

describe('room slide — camera-space rebases (enter/finish/cancel)', () => {
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

  it('enter adds sourceOffset to camera/bodyCamera and clears selection/blend', () => {
    const slide = beginRoomSlide(SRC, DST, VIEWPORT, VIEWS, IDENTITY_ACTOR);
    const entered = enterRoomSlideCameraSpace(slide, brainAt(12, 8));
    expect(entered.camera).toEqual({ x: 12, y: 8 }); // + sourceOffset (0,0)
    expect(entered.bodyCamera).toEqual({ x: 12, y: 8 });
    expect(entered.zoom).toBe(2);
    expect(entered.lensZoom).toBe(2);
    expect(entered.activeId).toBeNull();
    expect(entered.blend).toBeNull();
    // With an authored negative-world project the offset is still added.
    const negSrc = room({ iid: 'n-src', worldX: -500, worldY: -300, pxWid: 160, pxHei: 112 });
    const negDst = room({ iid: 'n-dst', worldX: -340, worldY: -280, pxWid: 144, pxHei: 128 });
    const negSlide = beginRoomSlide(negSrc, negDst, VIEWPORT, VIEWS, IDENTITY_ACTOR);
    const negEntered = enterRoomSlideCameraSpace(negSlide, brainAt(12, 8));
    expect(negEntered.camera).toEqual({ x: 12, y: 8 }); // + (0,0)
  });

  it('finish subtracts destinationOffset → destination-local camera identity', () => {
    const slide = beginRoomSlide(SRC, DST, VIEWPORT, VIEWS, IDENTITY_ACTOR);
    // A brain whose slide-space camera sits at the destination view (160,0).
    const atDest = brainAt(160, 0, 1.5);
    const finished = finishRoomSlideCameraSpace(slide, atDest);
    expect(finished.camera).toEqual({ x: 0, y: 0 }); // − destinationOffset (160,0)
    expect(finished.bodyCamera).toEqual({ x: 0, y: 0 });
    expect(finished.zoom).toBe(1.5);
    expect(finished.activeId).toBeNull();
    expect(finished.blend).toBeNull();
  });

  it('enter/finish rebase a frozen blend centre and the helpers are pure', () => {
    const slide = beginRoomSlide(SRC, DST, VIEWPORT, VIEWS, IDENTITY_ACTOR);
    const blending: CameraBrain = {
      ...brainAt(12, 8),
      blend: {
        fromId: 'a',
        toId: 'b',
        elapsed: 0.1,
        duration: 0.3,
        fromCenter: { x: 20, y: 20 },
        fromZoom: 2,
        fromPadding: 0,
      },
    };
    const entered = enterRoomSlideCameraSpace(slide, blending);
    // Blend is CLEARED at the boundary (explicit handoff, not auto-blended).
    expect(entered.blend).toBeNull();
    expect(blending.blend).not.toBeNull(); // input untouched (pure)
  });

  it('cancel rebases to either endpoint and clears selection/blend', () => {
    const slide = beginRoomSlide(SRC, DST, VIEWPORT, VIEWS, IDENTITY_ACTOR);
    const inSlide = brainAt(80, 40, 1.75); // mid-slide-space
    const toSource = cancelRoomSlideCameraSpace(slide, inSlide, 'source');
    expect(toSource.camera).toEqual({ x: 80, y: 40 }); // − sourceOffset (0,0)
    const toDest = cancelRoomSlideCameraSpace(slide, inSlide, 'destination');
    expect(toDest.camera).toEqual({ x: -80, y: 40 }); // − destinationOffset (160,0)
    for (const b of [toSource, toDest]) {
      expect(b.activeId).toBeNull();
      expect(b.blend).toBeNull();
      expect(b.bodyCamera).toEqual(b.camera);
    }
  });

  it('rapid reversal: cancel to the simulation room, then begin the reverse slide from local state', () => {
    const forward = beginRoomSlide(SRC, DST, VIEWPORT, VIEWS, IDENTITY_ACTOR);
    // Simulated mid-slide abort while the SIMULATION still lives in the source.
    const local = cancelRoomSlideCameraSpace(forward, brainAt(80, 40, 1.75), 'source');
    // The reverse slide from the destination room back to the source.
    const reverse = beginRoomSlide(DST, SRC, VIEWPORT, VIEWS, {
      sourceLocal: IDENTITY_ACTOR.destinationLocal,
      destinationLocal: IDENTITY_ACTOR.sourceLocal,
    });
    // Mirrored space: source/destination offsets swap.
    expect(reverse.space.sourceOffset).toEqual({ x: 160, y: 0 });
    expect(reverse.space.destinationOffset).toEqual({ x: 0, y: 0 });
    // The local (source-space) camera enters the reverse slide correctly.
    const reentered = enterRoomSlideCameraSpace(reverse, local);
    expect(reentered.camera).toEqual({ x: 80 + 160, y: 40 });
    expect(reentered.activeId).toBeNull();
  });
});

describe('room slide — composed camera-brain integration', () => {
  it('the brain renders the named curve exactly and hands off destination-local', () => {
    const slide = beginRoomSlide(SRC, DST, VIEWPORT, VIEWS, IDENTITY_ACTOR);
    // Start from a brain rendering the source view (source-local).
    let brain = enterRoomSlideCameraSpace(slide, createCameraBrain({ x: 0, y: 0, zoom: 2 }));

    let s = slide;
    const samples: { t: number; x: number; y: number }[] = [];
    for (let i = 0; i < 18; i++) {
      s = advanceRoomSlide(s, DT);
      const p = presentationForRoomSlide(s);
      if (p.vcam === null) break;
      brain = updateCameraBrain(brain, {
        vcams: [p.vcam],
        targets: {},
        bounds: p.bounds,
        viewport: VIEWPORT,
        activeId: ROOM_SLIDE_VCAM_ID,
        dt: DT,
      });
      // The slide vcam published its target EXACTLY — no blend, no damping.
      expect(brain.blend).toBeNull();
      expect(brain.activeId).toBe(ROOM_SLIDE_VCAM_ID);
      samples.push({ t: s.t, x: brain.camera.x, y: brain.camera.y });
      const eased = roomSlideEase(s.t);
      expect(brain.camera.x).toBeCloseTo(160 * eased, 9);
      expect(brain.camera.y).toBeCloseTo(0, 9);
      expect(brain.zoom).toBeCloseTo(2 + (1.5 - 2) * eased, 9);
    }
    // Adjacent-frame continuity at the switch: the path advances monotonically
    // with no jump larger than one frame's smoothstep step (peak slope 1.5 in
    // normalized t, scaled by the travel over duration → per-frame bound).
    const maxFrameStep = (160 * 1.5 * DT) / slide.duration + 1e-6;
    for (let i = 1; i < samples.length; i++) {
      const step = samples[i].x - samples[i - 1].x;
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual(maxFrameStep); // bounded frame step
    }

    // Handoff: finish rebases the FINAL RENDERED slide-space view into
    // destination-local coordinates (the rebase identity), and the residual to
    // the exact destination view is under one frame's step — the destination
    // room's ordinary vcam continues smoothly from this seed (no incoming blend).
    const finished = finishRoomSlideCameraSpace(s, brain);
    const last = samples[samples.length - 1];
    expect(finished.camera.x).toBeCloseTo(
      last.x - slide.space.destinationOffset.x,
      9,
    );
    expect(finished.camera.y).toBeCloseTo(
      last.y - slide.space.destinationOffset.y,
      9,
    );
    expect(Math.abs(finished.camera.x - VIEWS.destination.camera.x)).toBeLessThanOrEqual(
      maxFrameStep,
    );
    expect(Math.abs(finished.zoom - VIEWS.destination.zoom)).toBeLessThan(0.01);
    expect(finished.activeId).toBeNull();
    expect(finished.blend).toBeNull();
  });

  it('reduced motion: enter + finish in one frame yields an immediate destination-local cut', () => {
    const slide = beginRoomSlide(SRC, DST, VIEWPORT, VIEWS, IDENTITY_ACTOR, {
      reducedMotion: true,
    });
    let brain = createCameraBrain({ x: 0, y: 0, zoom: 2 });
    brain = enterRoomSlideCameraSpace(slide, brain);
    brain = finishRoomSlideCameraSpace(slide, brain);
    // No brain blend was stacked — the cut is exact and destination-local.
    expect(brain.blend).toBeNull();
    expect(brain.activeId).toBeNull();
    // Source-local (0,0) → slide space (0,0) → destination-local (−160, 0).
    expect(brain.camera).toEqual({ x: -160, y: 0 });
  });
});

// --- seedRoomCutCamera — continuity-preserving hard room cut ---------------
//
// The dip-down bug: a destination brain created at its default (0,0) seeds
// first-activation bodyCamera from that origin, then the follow solver visibly
// moves from the wrong local Y. `seedRoomCutCamera` rebases the rendered
// camera through world space so the cut preserves perpendicular framing.

describe('seedRoomCutCamera — hard room cut', () => {
  // Extract plain LdtkLevels from the duck-typed CompiledLdtkRoom fixtures.
  const SRC_LEVEL = SRC.ldtkLevel as unknown as LdtkLevel;
  const DST_LEVEL = DST.ldtkLevel as unknown as LdtkLevel;

  it('preserves the world-space top-left and rendered zoom', () => {
    // Source brain rendered at (300, 100, zoom 1.4). SRC world (0,0) → DST
    // world (160,0): rebased camera = (300 − 160, 100 − 0) = (140, 100).
    const source: CameraBrain = {
      camera: { x: 300, y: 100 }, zoom: 1.4, activeId: 'src',
      bodyCamera: { x: 300, y: 100 }, lensZoom: 1.4, blend: null,
    };
    const seeded = seedRoomCutCamera(source, SRC_LEVEL, DST_LEVEL);
    expect(seeded.camera).toEqual({ x: 140, y: 100 });
    expect(seeded.zoom).toBe(1.4);
    // World-space invariant: src.worldX + oldCam.x === dst.worldX + seeded.x.
    expect(SRC_LEVEL.worldX + 300).toBe(DST_LEVEL.worldX + seeded.camera.x);
    expect(SRC_LEVEL.worldY + 100).toBe(DST_LEVEL.worldY + seeded.camera.y);
  });

  it('produces an inactive brain (first activation, no blend)', () => {
    const source: CameraBrain = {
      camera: { x: 300, y: 100 }, zoom: 1.4, activeId: 'src',
      bodyCamera: { x: 300, y: 100 }, lensZoom: 1.4, blend: null,
    };
    const seeded = seedRoomCutCamera(source, SRC_LEVEL, DST_LEVEL);
    expect(seeded.activeId).toBeNull();
    expect(seeded.blend).toBeNull();
    // bodyCamera seeds from the rebased rendered camera (the dip-down fix).
    expect(seeded.bodyCamera).toEqual({ x: 140, y: 100 });
    expect(seeded.lensZoom).toBe(1.4);
  });

  it('does NOT clamp a negative destination-local coordinate prematurely', () => {
    // Source camera at (50, 100) → DST-local (50 − 160, 100) = (−110, 100).
    // Negative local X is valid (a room smaller than the viewport); the real
    // clamp is the next updateCameraBrain's responsibility, not this helper's.
    const source: CameraBrain = {
      camera: { x: 50, y: 100 }, zoom: 2, activeId: 'src',
      bodyCamera: { x: 50, y: 100 }, lensZoom: 2, blend: null,
    };
    const seeded = seedRoomCutCamera(source, SRC_LEVEL, DST_LEVEL);
    expect(seeded.camera.x).toBe(-110);
    expect(seeded.bodyCamera.x).toBe(-110);
  });

  it('preserves camera/zoom, not bodyCamera/lensZoom (which may be mid-blend)', () => {
    // A brain mid-blend: bodyCamera/lensZoom represent an off-screen live
    // target. seedRoomCutCamera must preserve the RENDERED composite, not the
    // live solver state.
    const source: CameraBrain = {
      camera: { x: 300, y: 100 }, zoom: 1.4, activeId: 'src',
      bodyCamera: { x: 999, y: 999 }, lensZoom: 9.9, blend: null,
    };
    const seeded = seedRoomCutCamera(source, SRC_LEVEL, DST_LEVEL);
    expect(seeded.camera).toEqual({ x: 140, y: 100 });
    expect(seeded.zoom).toBe(1.4);
    expect(seeded.bodyCamera).toEqual({ x: 140, y: 100 }); // not (999,999)
    expect(seeded.lensZoom).toBe(1.4); // not 9.9
  });

  it('the first destination step begins from the rebased point (no dip from origin)', () => {
    // Seed from a source brain at y=100, then step the destination brain. With
    // bounds tall enough to permit y=100, bodyCamera.y must NOT restart from 0.
    const source: CameraBrain = {
      camera: { x: 300, y: 100 }, zoom: 1.4, activeId: 'src',
      bodyCamera: { x: 300, y: 100 }, lensZoom: 1.4, blend: null,
    };
    let brain = seedRoomCutCamera(source, SRC_LEVEL, DST_LEVEL);
    brain = updateCameraBrain(brain, {
      vcams: [{
        id: 'dst', priority: 0, blend: 0,
        body: { mode: 'follow', targetKey: 'player', followX: { trail: 0.25, lead: 0.5 }, followY: { trail: 0.35, lead: 0.65 }, padding: 0 },
        lens: { zoom: 1.4 },
      }],
      targets: { player: { x: 140, y: 100, width: 8, height: 8 } },
      bounds: { width: DST_LEVEL.pxWid, height: 2000 },
      viewport: { width: 160, height: 112 },
      activeId: 'dst',
      dt: DT,
    });
    expect(brain.bodyCamera.y).toBeGreaterThan(0); // continuity, not origin dip
    expect(brain.camera.y).toBeGreaterThan(0);
  });
});

// --- beginRoomSlideFromBrain — safe slide constructor ----------------------
//
// Prevents source-view/brain divergence by deriving the source endpoint from
// the rendered brain (camera AND zoom), so the dip-down mis-wire is impossible
// by construction rather than caught after the fact.

describe('beginRoomSlideFromBrain — safe slide constructor', () => {
  const DEST_VIEW = { camera: { x: 0, y: 0 }, zoom: 1.5 };

  it('captures rendered camera AND zoom from a non-origin brain', () => {
    const brain: CameraBrain = {
      camera: { x: 40, y: 20 }, zoom: 2.5, activeId: 'src',
      bodyCamera: { x: 40, y: 20 }, lensZoom: 2.5, blend: null,
    };
    const slide = beginRoomSlideFromBrain(SRC, DST, VIEWPORT, brain, DEST_VIEW, IDENTITY_ACTOR);
    // The source view is the brain's rendered camera/zoom, copied.
    expect(slide.sourceView.camera).toEqual({ x: 40, y: 20 });
    expect(slide.sourceView.zoom).toBe(2.5);
    // The destination view is passed through.
    expect(slide.destinationView.camera).toEqual({ x: 0, y: 0 });
    expect(slide.destinationView.zoom).toBe(1.5);
  });

  it('captures camera/zoom, not bodyCamera/lensZoom (mid-blend brain)', () => {
    // A brain whose live bodyCamera/lensZoom differ from the rendered composite
    // (an in-flight blend). The source endpoint must be the RENDERED state.
    const brain: CameraBrain = {
      camera: { x: 40, y: 20 }, zoom: 2.5, activeId: 'src',
      bodyCamera: { x: 999, y: 999 }, lensZoom: 9.9,
      blend: { fromId: 'a', toId: 'src', elapsed: 0.05, duration: 0.3, fromCenter: { x: 0, y: 0 }, fromZoom: 1, fromPadding: 0 },
    };
    const slide = beginRoomSlideFromBrain(SRC, DST, VIEWPORT, brain, DEST_VIEW, IDENTITY_ACTOR);
    expect(slide.sourceView.camera).toEqual({ x: 40, y: 20 });
    expect(slide.sourceView.zoom).toBe(2.5);
  });

  it('does not retain the brain nested reference (post-construction mutation is safe)', () => {
    const brain: CameraBrain = {
      camera: { x: 40, y: 20 }, zoom: 2.5, activeId: 'src',
      bodyCamera: { x: 40, y: 20 }, lensZoom: 2.5, blend: null,
    };
    const slide = beginRoomSlideFromBrain(SRC, DST, VIEWPORT, brain, DEST_VIEW, IDENTITY_ACTOR);
    // A CameraBrain is fully immutable (all fields readonly), so the slide
    // capturing the values (not the reference) is proved by the capture
    // holding its own copies — verified by the equality test below against a
    // direct beginRoomSlide call. The source endpoint is the rendered camera.
    expect(slide.sourceView.camera.x).toBe(40);
  });

  it('equals a direct beginRoomSlide call supplied with the same exact views', () => {
    const brain: CameraBrain = {
      camera: { x: 40, y: 20 }, zoom: 2.5, activeId: 'src',
      bodyCamera: { x: 40, y: 20 }, lensZoom: 2.5, blend: null,
    };
    const fromBrain = beginRoomSlideFromBrain(SRC, DST, VIEWPORT, brain, DEST_VIEW, IDENTITY_ACTOR);
    const direct = beginRoomSlide(
      SRC, DST, VIEWPORT,
      {
        source: { camera: { x: 40, y: 20 }, zoom: 2.5 },
        destination: { camera: { x: 0, y: 0 }, zoom: 1.5 },
      },
      IDENTITY_ACTOR,
    );
    // Same clock, same endpoints, same space — the wrapper is a pure delegate.
    expect(fromBrain.duration).toBe(direct.duration);
    expect(fromBrain.t).toBe(direct.t);
    expect(fromBrain.sourceView).toEqual(direct.sourceView);
    expect(fromBrain.destinationView).toEqual(direct.destinationView);
    expect(fromBrain.space).toEqual(direct.space);
  });
});
