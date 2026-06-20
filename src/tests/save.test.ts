import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createMemorySaveStorage,
  createLocalStorageSaveStorage,
  loadSave,
  writeSave,
  DEFAULT_SAVE_KEY,
} from '../save';
import type { SaveStorage } from '../save';

/** Minimal localStorage mock backed by an in-process Map. */
function makeLsMock(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => store.clear()),
    key: vi.fn(() => null),
    length: 0,
  };
}

describe('createMemorySaveStorage', () => {
  it('load() returns null on a fresh storage', () => {
    const s = createMemorySaveStorage();
    expect(s.load()).toBeNull();
  });

  it('save() then load() returns the saved string', () => {
    const s = createMemorySaveStorage();
    s.save('{"x":1}');
    expect(s.load()).toBe('{"x":1}');
  });

  it('clear() makes load() return null again', () => {
    const s = createMemorySaveStorage();
    s.save('hello');
    s.clear();
    expect(s.load()).toBeNull();
  });

  it('overwrites: save("a") then save("b") → load() returns "b"', () => {
    const s = createMemorySaveStorage();
    s.save('a');
    s.save('b');
    expect(s.load()).toBe('b');
  });

  it('save() with empty string is preserved (distinct from null)', () => {
    const s = createMemorySaveStorage();
    s.save('');
    expect(s.load()).toBe('');
  });

  it('instances are isolated (no shared state)', () => {
    const a = createMemorySaveStorage();
    const b = createMemorySaveStorage();
    a.save('in-a');
    expect(b.load()).toBeNull();
  });
});

describe('createLocalStorageSaveStorage — Node / no window', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('load() returns null when window is undefined', () => {
    const s = createLocalStorageSaveStorage();
    expect(s.load()).toBeNull();
  });

  it('save() does not throw when window is undefined', () => {
    const s = createLocalStorageSaveStorage();
    expect(() => s.save('{"a":1}')).not.toThrow();
  });

  it('clear() does not throw when window is undefined', () => {
    const s = createLocalStorageSaveStorage();
    expect(() => s.clear()).not.toThrow();
  });

  it('does NOT access window.localStorage at factory creation (lazy)', () => {
    const ls = makeLsMock();
    vi.stubGlobal('window', { localStorage: ls });
    ls.getItem.mockClear();
    ls.setItem.mockClear();
    ls.removeItem.mockClear();
    // Creating the adapter must not touch storage.
    createLocalStorageSaveStorage();
    expect(ls.getItem).not.toHaveBeenCalled();
    expect(ls.setItem).not.toHaveBeenCalled();
    expect(ls.removeItem).not.toHaveBeenCalled();
  });
});

describe('createLocalStorageSaveStorage — with mocked window.localStorage', () => {
  let ls: ReturnType<typeof makeLsMock>;

  beforeEach(() => {
    ls = makeLsMock();
    vi.stubGlobal('window', { localStorage: ls });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('load() calls getItem with the default key', () => {
    const s = createLocalStorageSaveStorage();
    s.load();
    expect(ls.getItem).toHaveBeenCalledWith(DEFAULT_SAVE_KEY);
  });

  it('save() calls setItem with the key and the payload', () => {
    const s = createLocalStorageSaveStorage();
    s.save('{"a":1}');
    expect(ls.setItem).toHaveBeenCalledWith(DEFAULT_SAVE_KEY, '{"a":1}');
  });

  it('clear() calls removeItem with the key', () => {
    const s = createLocalStorageSaveStorage();
    s.clear();
    expect(ls.removeItem).toHaveBeenCalledWith(DEFAULT_SAVE_KEY);
  });

  it('load() returns the value previously stored by save() (roundtrip)', () => {
    const s = createLocalStorageSaveStorage();
    s.save('{"x":42}');
    expect(s.load()).toBe('{"x":42}');
  });

  it('load() returns null when the key is absent', () => {
    const s = createLocalStorageSaveStorage();
    expect(s.load()).toBeNull();
  });

  it('clear() after save() makes load() return null', () => {
    const s = createLocalStorageSaveStorage();
    s.save('data');
    s.clear();
    expect(s.load()).toBeNull();
  });

  it('load() returns null (swallowed) when getItem throws', () => {
    ls.getItem.mockImplementation(() => {
      throw new Error('getItem exploded');
    });
    const s = createLocalStorageSaveStorage();
    expect(() => s.load()).not.toThrow();
    expect(s.load()).toBeNull();
  });

  it('save() does not throw when setItem throws (quota exceeded)', () => {
    ls.setItem.mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const s = createLocalStorageSaveStorage();
    expect(() => s.save('{"big":"data"}')).not.toThrow();
  });

  it('clear() does not throw when removeItem throws', () => {
    ls.removeItem.mockImplementation(() => {
      throw new Error('removeItem exploded');
    });
    const s = createLocalStorageSaveStorage();
    expect(() => s.clear()).not.toThrow();
  });

  it('passes a custom key through to getItem/setItem/removeItem', () => {
    const s = createLocalStorageSaveStorage('my-game-save');
    s.save('payload');
    s.load();
    s.clear();
    expect(ls.setItem).toHaveBeenCalledWith('my-game-save', 'payload');
    expect(ls.getItem).toHaveBeenCalledWith('my-game-save');
    expect(ls.removeItem).toHaveBeenCalledWith('my-game-save');
  });
});

describe('loadSave', () => {
  it('parses valid JSON from the storage backend', () => {
    const s = createMemorySaveStorage();
    s.save('{"x":1,"y":"hi"}');
    const result = loadSave(s, { x: 0, y: '' });
    expect(result).toEqual({ x: 1, y: 'hi' });
  });

  it('returns defaultValue when storage has no save', () => {
    const s = createMemorySaveStorage();
    const fallback = { x: 99 };
    expect(loadSave(s, fallback)).toBe(fallback);
  });

  it('returns defaultValue when the stored JSON is corrupt (no throw)', () => {
    const s = createMemorySaveStorage();
    s.save('not-valid-json{');
    const fallback = { recovered: true };
    expect(() => loadSave(s, fallback)).not.toThrow();
    expect(loadSave(s, fallback)).toEqual({ recovered: true });
  });

  it('roundtrips a complex object through writeSave + loadSave', () => {
    const s = createMemorySaveStorage();
    const payload = { a: 1, b: [2, 3], c: { nested: true } };
    writeSave(s, payload);
    expect(loadSave(s, { a: 0, b: [], c: { nested: false } })).toEqual(payload);
  });

  it('works with primitive defaults (e.g. number)', () => {
    const s = createMemorySaveStorage();
    expect(loadSave<number>(s, 0)).toBe(0);
    s.save('7');
    expect(loadSave<number>(s, 0)).toBe(7);
  });

  it('returns defaultValue when storage.load() throws (swallowed)', () => {
    const failing: SaveStorage = {
      load: () => {
        throw new Error('backend exploded');
      },
      save: () => {},
      clear: () => {},
    };
    const fallback = { ok: true };
    expect(() => loadSave(failing, fallback)).not.toThrow();
    expect(loadSave(failing, fallback)).toEqual({ ok: true });
  });
});

describe('writeSave', () => {
  it('writes JSON-serialized data to the storage backend', () => {
    const s = createMemorySaveStorage();
    writeSave(s, { a: 1, b: [2, 3] });
    expect(s.load()).toBe(JSON.stringify({ a: 1, b: [2, 3] }));
  });

  it('does not throw on a circular reference (stringify failure swallowed)', () => {
    const s = createMemorySaveStorage();
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => writeSave(s, circular)).not.toThrow();
    // The failed write must not have left a previous/corrupt payload behind.
    expect(s.load()).toBeNull();
  });

  it('does not throw when storage.save() throws (swallowed)', () => {
    const failing: SaveStorage = {
      load: () => null,
      save: () => {
        throw new Error('backend write exploded');
      },
      clear: () => {},
    };
    expect(() => writeSave(failing, { x: 1 })).not.toThrow();
  });

  it('preserves existing data when a new write succeeds', () => {
    const s = createMemorySaveStorage();
    writeSave(s, { first: true });
    writeSave(s, { second: true });
    expect(JSON.parse(s.load() ?? '{}')).toEqual({ second: true });
  });
});
