import { describe, expect, it } from 'vitest';
import { cameraApertureLetterbox, type RoomSlideState } from 'aicraft-engine';
import { roomSlideAperture, roomSlideApertureLetterbox } from '../room-slide-aperture';

// Minimal hand-built slide: 320x240 source room sliding to a 480x240
// destination (union 800x240), mid-flight at linear t = 0.5.
function slideAt(t: number, active = true): RoomSlideState {
  return {
    active,
    elapsed: 0.3 * t,
    duration: 0.3,
    t,
    sourceLevelIid: 'src-iid',
    destLevelIid: 'dst-iid',
    easing: (x) => x,
    freezeSimulation: false,
    space: {
      bounds: { width: 800, height: 240 },
      sourceOffset: { x: 0, y: 0 },
      destinationOffset: { x: 320, y: 0 },
    },
    sourceAperture: { width: 320, height: 240 },
    destinationAperture: { width: 480, height: 240 },
    sourceView: { camera: { x: 0, y: 0 }, zoom: 1 },
    destinationView: { camera: { x: 0, y: 0 }, zoom: 1 },
    initialPlayerOffset: { x: 0, y: 0 },
    particleRebaseDelta: { x: 0, y: 0 },
  };
}

const viewport = { width: 640, height: 480 };

describe('roomSlideAperture', () => {
  it('interpolates the ONE-ROOM aperture between source and destination', () => {
    expect(roomSlideAperture(slideAt(0))).toEqual({ width: 320, height: 240 });
    expect(roomSlideAperture(slideAt(0.5))).toEqual({ width: 400, height: 240 });
    expect(roomSlideAperture(slideAt(1))).toEqual({ width: 480, height: 240 });
  });

  it('returns the destination aperture once the slide is finished', () => {
    expect(roomSlideAperture(slideAt(1, false))).toEqual({ width: 480, height: 240 });
  });
});

describe('roomSlideApertureLetterbox (the never-bounds rule)', () => {
  it('masks with the interpolated room, not the union bounds', () => {
    const box = roomSlideApertureLetterbox(slideAt(0.5), viewport, 1);
    // Interpolated aperture 400 wide → centered frame with side bars.
    expect(box.frame.width).toBe(400);
    expect(box.bars.length).toBe(4);
    expect(box.covered).toBe(false);
  });

  it('the union-bounds anti-pattern would swallow the side bars', () => {
    // The exact failure this recipe exists to prevent: masking with the
    // slide's union bounds yields a near-full-width frame and the side bars
    // vanish mid-transition.
    const union = cameraApertureLetterbox({ width: 800, height: 240 }, viewport, 1);
    expect(union.bars.length).toBe(2);
  });
});
