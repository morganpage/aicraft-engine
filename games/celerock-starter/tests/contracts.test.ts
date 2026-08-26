/**
 * §12.8 forbidden patterns and §12.9 required wiring, as TESTS rather than as a
 * shell script somebody remembers to run. `npm test` also runs gate/check.sh
 * via the pretest hook; this file is the half that survives being copied into
 * a CI job that only knows how to run vitest.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scanForbiddenIdentifiers } from '../src/recipes/game-test-harness';

const root = (p: string): string => fileURLToPath(new URL(`../${p}`, import.meta.url));

describe('§12.8 — forbidden identifiers in game code', () => {
  it('finds none (src/recipes/ is excluded — those are engine-tested)', () => {
    expect(scanForbiddenIdentifiers(root('src'))).toEqual([]);
  });
});

describe('§12.9 — the pin and the structural floor', () => {
  it('pins aicraft-engine exactly, with no caret', () => {
    const pkg = readFileSync(root('package.json'), 'utf8');
    expect(pkg).toContain('"aicraft-engine": "0.22.0"');
  });

  it('keeps the gate wired to the npm lifecycle', () => {
    const pkg = JSON.parse(readFileSync(root('package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    // Deleting these is the one-line way to defeat the scaffold. It is a
    // legitimate edit for a fork; it is not legitimate mid-build, so it fails
    // here loudly rather than silently widening what "green" means.
    expect(pkg.scripts.pretest).toBeDefined();
    expect(pkg.scripts.prebuild).toBeDefined();
  });
});
