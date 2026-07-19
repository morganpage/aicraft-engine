import { describe, it, expect } from 'vitest';
import { canonicalize, fnv1a } from '../level/serialize';

describe('canonicalize — key order independence', () => {
  it('produces the same output regardless of object key order', () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe(canonicalize({ a: 1, b: 2 }));
  });

  it('produces the same output regardless of nested key order', () => {
    const a = { outer: { z: 1, a: 2 }, first: 0 };
    const b = { first: 0, outer: { a: 2, z: 1 } };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('sorts keys lexicographically', () => {
    expect(canonicalize({ b: 2, a: 1, c: 3 })).toBe('{"a":1,"b":2,"c":3}');
  });
});

describe('canonicalize — primitives and structures', () => {
  it('serializes null', () => {
    expect(canonicalize(null)).toBe('null');
  });

  it('serializes booleans', () => {
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(false)).toBe('false');
  });

  it('serializes finite numbers', () => {
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize(-3.5)).toBe('-3.5');
    expect(canonicalize(0)).toBe('0');
  });

  it('serializes strings', () => {
    expect(canonicalize('hello')).toBe('"hello"');
  });

  it('serializes empty objects and arrays', () => {
    expect(canonicalize({})).toBe('{}');
    expect(canonicalize([])).toBe('[]');
  });

  it('serializes arrays in element order (not sorted)', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('serializes nested objects and arrays', () => {
    const v = { list: [{ b: 2, a: 1 }, { z: 9 }], name: 'x' };
    expect(canonicalize(v)).toBe('{"list":[{"a":1,"b":2},{"z":9}],"name":"x"}');
  });

  it('drops undefined object fields (JSON.stringify parity)', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('serializes undefined array elements as null (JSON.stringify parity)', () => {
    expect(canonicalize([1, undefined, 3])).toBe('[1,null,3]');
  });

  it('serializes top-level undefined as null', () => {
    expect(canonicalize(undefined)).toBe('null');
  });
});

describe('canonicalize — non-finite numbers', () => {
  it('serializes NaN as null', () => {
    expect(canonicalize(NaN)).toBe('null');
  });

  it('serializes Infinity as null', () => {
    expect(canonicalize(Infinity)).toBe('null');
  });

  it('serializes -Infinity as null', () => {
    expect(canonicalize(-Infinity)).toBe('null');
  });

  it('serializes a non-finite field value as null', () => {
    expect(canonicalize({ a: NaN, b: Infinity, c: 1 })).toBe('{"a":null,"b":null,"c":1}');
  });
});

describe('canonicalize — unsupported types', () => {
  it('serializes functions as null', () => {
    expect(canonicalize(() => 1)).toBe('null');
  });

  it('drops function-valued object fields', () => {
    expect(canonicalize({ a: 1, fn: () => 2 })).toBe('{"a":1}');
  });

  it('drops symbol-valued object fields', () => {
    expect(canonicalize({ a: 1, s: Symbol('s') })).toBe('{"a":1}');
  });

  it('drops bigint-valued object fields', () => {
    expect(canonicalize({ a: 1, big: BigInt(123) })).toBe('{"a":1}');
  });

  it('serializes function / symbol / bigint array elements as null', () => {
    expect(canonicalize([1, () => 2, Symbol('s'), BigInt(3)])).toBe('[1,null,null,null]');
  });

  it('serializes symbols as null', () => {
    expect(canonicalize(Symbol('s'))).toBe('null');
  });

  it('serializes bigint as null', () => {
    expect(canonicalize(BigInt(123))).toBe('null');
  });
});

describe('canonicalize — circular references', () => {
  it('does not throw on a self-referencing object', () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    const out = canonicalize(a);
    expect(out).toBe('{"self":null,"x":1}');
  });

  it('does not throw on a mutual circular reference', () => {
    const a: Record<string, unknown> = { name: 'a' };
    const b: Record<string, unknown> = { name: 'b' };
    a.peer = b;
    b.peer = a;
    expect(() => canonicalize(a)).not.toThrow();
  });

  it('does not throw on a circular array', () => {
    const a: unknown[] = [1, 2];
    a.push(a);
    expect(() => canonicalize(a)).not.toThrow();
  });

  it('preserves non-cyclic repeated references (tree with same leaf)', () => {
    const shared = { v: 1 };
    const tree = { a: shared, b: shared };
    expect(canonicalize(tree)).toBe('{"a":{"v":1},"b":{"v":1}}');
  });
});

describe('fnv1a — known constants', () => {
  it('returns the FNV offset basis for the empty string', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('')).toBe(2166136261);
  });

  it('returns the known FNV-1a hash for a single "a"', () => {
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('a')).toBe(3826002220);
  });

  it('returns the known FNV-1a hash for "foobar"', () => {
    // Canonical FNV-1a test vector for "foobar" (32-bit, big-endian).
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });
});

describe('fnv1a — determinism', () => {
  it('returns the same value across repeated calls', () => {
    const a = fnv1a('hello world');
    const b = fnv1a('hello world');
    expect(a).toBe(b);
  });

  it('returns unsigned 32-bit values', () => {
    const h = fnv1a('some longer string input that exercises the hash');
    expect(h).toBe(Math.floor(h));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });

  it('produces different hashes for different inputs', () => {
    expect(fnv1a('a')).not.toBe(fnv1a('b'));
  });
});
