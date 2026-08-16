import { describe, expect, it } from 'vitest';
import { fnv1aHash } from '../hash/fnv1a';
import { fnv1a } from '../level/serialize';
import { hashTerrainArtProject } from '../terrain-art/storage';
import { serializeTerrainArtProject } from '../terrain-art/serialize';
import type { TerrainArtProject } from '../terrain-art/types';

/**
 * Byte-exactness pins for the consolidated FNV-1a. The three former copies
 * (level `fnv1a`, cosmetics `fnv1aBase36`, terrain-art `hashTerrainArtProject`)
 * feed persisted data — replay share-codes, trace canaries, cache keys,
 * cosmetics variant ids — so consolidation must not move a single digest.
 * The known-answer vectors predate the consolidation (they were the two
 * examples in `fnv1a`'s own JSDoc); the cross-consumer checks decode each
 * wrapper's encoding back to the same unsigned 32-bit integer.
 */
describe('fnv1a consolidation is byte-exact', () => {
  it('known-answer vectors', () => {
    expect(fnv1aHash('')).toBe(2166136261);   // 0x811c9dc5 — the offset basis
    expect(fnv1aHash('a')).toBe(3826002220);  // 0xe40c292c
    expect(fnv1aHash('celerock')).toBe(fnv1aHash('celerock'));
    expect(fnv1aHash('ab')).not.toBe(fnv1aHash('ba'));
  });

  it('the public level wrapper delegates to the leaf unchanged', () => {
    for (const s of ['', 'a', 'share-code-payload', '🎉 non-BMP-adjacent ✓']) {
      expect(fnv1a(s)).toBe(fnv1aHash(s));
    }
  });

  it('the terrain-art cache hash is the leaf digest, hex-8 encoded', () => {
    const project = makeProject();
    const expected = fnv1aHash(serializeTerrainArtProject(project))
      .toString(16)
      .padStart(8, '0');
    expect(hashTerrainArtProject(project)).toBe(expected);
  });

  it('terrain-art canonicalize is cycle-safe and DAG-safe', () => {
    // A repeated-but-acyclic reference serializes twice (no global-seen collapse).
    const shared = { marker: 1 };
    const dag = { a: shared, b: shared } as unknown as TerrainArtProject;
    const out = serializeTerrainArtProject(dag);
    expect(out).toContain('"marker": 1');
    expect(out.match(/"marker": 1/g)).toHaveLength(2);
    // A cycle back-edge becomes null instead of recursing forever.
    const cyclic = { name: 'c' } as unknown as Record<string, unknown>;
    cyclic.self = cyclic;
    expect(() => serializeTerrainArtProject(cyclic as unknown as TerrainArtProject)).not.toThrow();
    expect(serializeTerrainArtProject(cyclic as unknown as TerrainArtProject)).toContain('"self": null');
  });
});

/** Minimal valid project for the cache-hash check. */
function makeProject(): TerrainArtProject {
  return {
    version: 1,
    size: { width: 4, height: 4 },
    materials: [],
    layers: [],
  } as unknown as TerrainArtProject;
}
