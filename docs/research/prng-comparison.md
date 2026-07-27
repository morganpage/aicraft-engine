# Seeded PRNG Algorithms for Deterministic Procedural Rendering

> Research note for PRNG algorithms. Slug: `prng-comparison`.
> Investigated: 2026-07-26.

## TL;DR

This note compares the current seeded PRNG algorithm (`mulberry32`) used in `aicraft-engine` against three high-quality alternatives: `splitmix32`, `sfc32`, and `jsf32` (smallprng). While `mulberry32` is extremely fast and has a minimal footprint, it has a known statistical flaw where it skips approximately one-third of all possible 32-bit outputs. For games requiring high-quality, unbiased randomness with a 32-bit state, `splitmix32` is the recommended drop-in replacement, while `sfc32` is preferred if a larger 128-bit state/period is required.

## Why this matters for aicraft-engine

Deterministic procedural generation (Pillar 1/2) relies on seeded PRNGs to produce identical game states, cosmetics, and particle effects across all client devices. If the PRNG has statistical bias or skips values, it can lead to visible patterns, clustering, or broken cosmetic distributions.

## PRNG Comparison Matrix

| Algorithm | State Size | Period | Speed Ballpark (ops/sec) | Statistical Quality | Key Tradeoffs / Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **mulberry32** (Current) | 32-bit | $2^{32}$ (~4.29B) | ~10.4M | Moderate (Skips 1/3 of outputs) | Extremely fast, but the 1/3 skip bias makes it risky for unbiased distributions. |
| **splitmix32** | 32-bit | $2^{32}$ (~4.29B) | ~10.4M | Excellent (for 32-bit) | Same speed/state size as mulberry32, but without the value-skipping flaw. |
| **sfc32** (Small Fast Counter) | 128-bit | $2^{128}$ (~$3.4 \times 10^{38}$) | ~7.4M | Outstanding (Passes BigCrush) | Extremely high quality, fast, but requires 4 seed values (128-bit state). |
| **jsf32** (Jenkins Small PRNG) | 128-bit | $2^{128}$ avg | ~6.1M | Very Good (Chaotic PRNG) | Good quality, slightly slower than sfc32, requires seeding 128-bit state. |

## Code Samples (TypeScript / ES2021)

### 1. mulberry32 (Current)
```typescript
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

### 2. splitmix32 (Recommended 32-bit Drop-in)
```typescript
export function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16); t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15); t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}
```

### 3. sfc32 (Recommended 128-bit State)
```typescript
export function sfc32(s1: number, s2: number, s3: number, s4: number): () => number {
  let a = s1 | 0, b = s2 | 0, c = s3 | 0, d = s4 | 0;
  return () => {
    let t = (a + b | 0) + d | 0; d = (d + 1) | 0;
    a = b ^ (b >>> 9); b = (c + (c << 3)) | 0;
    c = (c << 21 | c >>> 11) + t | 0;
    return (t >>> 0) / 4294967296;
  };
}
```

### 4. jsf32 (Bob Jenkins' Small PRNG)
```typescript
export function jsf32(seed: number): () => number {
  let a = 0xf1ea5eed, b = seed, c = seed, d = seed;
  const rng = () => {
    let t = a - (b << 27 | b >>> 5) | 0;
    a = b ^ (c << 17 | c >>> 15); b = (c + d) | 0;
    c = (d + t) | 0; d = (a + t) | 0;
    return (d >>> 0) / 4294967296;
  };
  for (let i = 0; i < 20; i++) rng(); // Warm up state
  return rng;
}
```

## Recommendation

1. **Short-Term / Drop-in**: Replace `mulberry32` with `splitmix32`. It has the exact same state size (32-bit seed input) and speed profile, but fixes the critical value-skipping flaw of `mulberry32`.
2. **Long-Term / High-Entropy**: For complex procedural generation (e.g., large-scale world generation, complex cosmetic generation), introduce `sfc32` seeded via an `xmur3` hash generator to provide a massive $2^{128}$ state and period.

## Sources & Reference Material

- [bryc's JavaScript PRNG Implementations & Benchmarks](https://github.com/bryc/code/blob/master/jshash/PRNGs.md)
- [PractRand PRNG Test Suite](http://pracrand.sourceforge.net/)
- [Bob Jenkins' Small Noncryptographic PRNG (smallprng)](https://burtleburtle.net/bob/rand/smallprng.html)
- [SplitMix Paper (OOPSLA 2014)](http://gee.cs.oswego.edu/dl/papers/oopsla14.pdf)
