import { describe, expect, it, vi } from 'vitest';
import { attachAudioUnlock } from '../audio-unlock';

describe('attachAudioUnlock', () => {
  it('calls unlock exactly once on the first gesture event', () => {
    const adapter = { unlock: vi.fn() };
    const target = new EventTarget();
    attachAudioUnlock(adapter, { target });

    target.dispatchEvent(new Event('keydown'));
    target.dispatchEvent(new Event('pointerdown'));
    target.dispatchEvent(new Event('keydown'));

    expect(adapter.unlock).toHaveBeenCalledTimes(1);
  });

  it('fires on any of the configured event names', () => {
    const target = new EventTarget();
    const adapter = { unlock: vi.fn() };
    attachAudioUnlock(adapter, { target, events: ['gamepadconnected'] });

    target.dispatchEvent(new Event('pointerdown'));
    expect(adapter.unlock).not.toHaveBeenCalled();

    target.dispatchEvent(new Event('gamepadconnected'));
    expect(adapter.unlock).toHaveBeenCalledTimes(1);
  });

  it('detaching before the first gesture prevents the unlock', () => {
    const target = new EventTarget();
    const adapter = { unlock: vi.fn() };
    const detach = attachAudioUnlock(adapter, { target });

    detach();
    target.dispatchEvent(new Event('keydown'));

    expect(adapter.unlock).not.toHaveBeenCalled();
  });

  it('is a silent no-op with no resolvable target (Node/SSR default)', () => {
    const adapter = { unlock: vi.fn() };
    // No target option and no window/document on the Node global — must not throw.
    const detach = attachAudioUnlock(adapter);
    expect(() => detach()).not.toThrow();
    expect(adapter.unlock).not.toHaveBeenCalled();
  });
});
