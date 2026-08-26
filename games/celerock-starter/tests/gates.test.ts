/**
 * The §13 visual gates, made fail-loud (§12.10).
 *
 * THIS TEST SHIPS RED. That is the point: a scaffold whose gates start green
 * has to be opted INTO, and four runs have shown that gates nobody opts into
 * are gates nobody builds. Turn it green by producing the captures, never by
 * shortening the manifest.
 *
 * The failure this closes: a real build wrote
 *   expect(missingShotManifest(dir, [])).toEqual([])
 * — the right function, correct arguments, an empty requirement list, and an
 * empty directory. Every §13 gate passed by asserting nothing.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { missingShotManifest } from '../src/recipes/game-test-harness';
import { GATE_SHOTS, SHOTS_DIR } from '../gate/gates';

const shotsDir = fileURLToPath(new URL(`../${SHOTS_DIR}`, import.meta.url));

describe('§13 visual gates', () => {
  it('has a non-empty manifest (an empty one asserts nothing)', () => {
    expect(GATE_SHOTS.length).toBeGreaterThanOrEqual(14);
  });

  it('every gate capture exists on disk', () => {
    expect(missingShotManifest(shotsDir, GATE_SHOTS)).toEqual([]);
  });
});
