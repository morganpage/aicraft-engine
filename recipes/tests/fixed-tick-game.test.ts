import { describe, expect, it, vi } from 'vitest';
import { startFixedTickGame } from '../fixed-tick-game';

describe('startFixedTickGame', () => {
  it('renders exactly one static frame and never starts under reduced motion', () => {
    const render = vi.fn();
    const step = vi.fn();
    const loop = startFixedTickGame({
      step,
      render,
      reducedMotion: () => true,
    });

    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(0);
    expect(step).not.toHaveBeenCalled();
    expect(loop.isRunning()).toBe(false);
  });

  it('starts the loop when motion is allowed', () => {
    const render = vi.fn();
    const loop = startFixedTickGame({
      step: () => {},
      render,
      reducedMotion: () => false,
    });

    // Under Node there is no requestAnimationFrame, so createGameLoop's
    // start() is a documented silent no-op — the gate must still not have
    // rendered a static frame.
    expect(render).not.toHaveBeenCalled();
    expect(loop.isRunning()).toBe(false);
    expect(loop.stoppedDueToError).toBe(false);
    loop.dispose();
  });

  it('a throwing first static render does not crash boot', () => {
    expect(() =>
      startFixedTickGame({
        step: () => {},
        render: () => {
          throw new Error('canvas not ready');
        },
        reducedMotion: () => true,
      }),
    ).not.toThrow();
  });

  it('a throwing reduced-motion probe degrades to starting the loop', () => {
    const loop = startFixedTickGame({
      step: () => {},
      render: () => {},
      reducedMotion: () => {
        throw new Error('matchMedia hostile');
      },
    });
    expect(loop).toBeDefined();
    loop.dispose();
  });
});
