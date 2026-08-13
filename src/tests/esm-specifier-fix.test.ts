/**
 * Unit tests for the post-build ESM specifier rewriter
 * (`scripts/fix-esm-specifiers.mjs`).
 *
 * The pure core (`resolveRelativeSpecifier`, `rewriteSource`) is exercised with
 * injectable filesystem predicates so no real disk I/O is required and the
 * tests are deterministic.
 */

import { describe, it, expect } from 'vitest';

// Vitest loads the `.mjs` directly at runtime. `tsc --noEmit` is satisfied by
// the sibling declaration file `scripts/fix-esm-specifiers.d.mts`.
import {
  resolveRelativeSpecifier,
  rewriteSource,
  splitCodeAndComments,
} from '../../scripts/fix-esm-specifiers.mjs';

interface FakeFs {
  dirs?: string[];
  files?: string[];
}

/** Build injectable `existsDir` / `existsFile` predicates from a fake fs. */
function predicates(fs: FakeFs) {
  const dirs = new Set(fs.dirs ?? []);
  const files = new Set(fs.files ?? []);
  return {
    existsFile: (p: string) => files.has(p),
    existsDir: (p: string) => dirs.has(p),
  };
}

describe('resolveRelativeSpecifier', () => {
  it('(a) rewrites a file import when <name>.js exists', () => {
    const fs = predicates({ files: ['/proj/lib/foo.js'] });
    expect(resolveRelativeSpecifier('./foo', '/proj/lib', 'js', fs)).toBe('./foo.js');
  });

  it('(b) rewrites a directory import when <name>/index.js exists', () => {
    const fs = predicates({
      dirs: ['/proj/lib/primitives'],
      files: ['/proj/lib/primitives/index.js'],
    });
    expect(resolveRelativeSpecifier('./primitives', '/proj/lib', 'js', fs)).toBe(
      './primitives/index.js',
    );
  });

  it('(c) leaves already-extensioned specifiers unchanged (idempotency)', () => {
    const fs = predicates({ files: ['/proj/lib/bar.js'] });
    expect(resolveRelativeSpecifier('./bar.js', '/proj/lib', 'js', fs)).toBe('./bar.js');
  });

  it('(d) leaves bare specifiers unchanged', () => {
    const fs = predicates({ files: [], dirs: [] });
    expect(resolveRelativeSpecifier('aicraft-engine', '/proj/lib', 'js', fs)).toBe(
      'aicraft-engine',
    );
  });

  it('(e) resolves a sibling directory via ../ ', () => {
    const fs = predicates({
      dirs: ['/proj/a/sibling'],
      files: ['/proj/a/sibling/index.js'],
    });
    expect(resolveRelativeSpecifier('../sibling', '/proj/a/b', 'js', fs)).toBe(
      '../sibling/index.js',
    );
  });

  it('prefers a sibling <name>.js over an unrelated directory', () => {
    // `./foo` resolves to a file `foo.js`; a *different* dir `foo/sub` must not
    // pull it toward the directory branch.
    const fs = predicates({
      dirs: ['/proj/lib/foo'], // dir exists but has no index.js
      files: ['/proj/lib/foo.js'],
    });
    expect(resolveRelativeSpecifier('./foo', '/proj/lib', 'js', fs)).toBe('./foo.js');
  });

  it('uses the .d.ts family for declaration files but emits a .js specifier', () => {
    // Resolution checks the on-disk `.d.ts`, but the emitted specifier must be
    // `.js`: TS resolves a `.js` specifier in a `.d.ts` to the matching `.d.ts`,
    // whereas a value import of `.d.ts` is rejected with TS2846.
    const fs = predicates({ files: ['/proj/lib/types.d.ts'] });
    expect(resolveRelativeSpecifier('./types', '/proj/lib', 'd.ts', fs)).toBe('./types.js');
  });

  it('uses index.d.ts for a directory in the .d.ts family but emits index.js', () => {
    const fs = predicates({
      dirs: ['/proj/lib/types'],
      files: ['/proj/lib/types/index.d.ts'],
    });
    expect(resolveRelativeSpecifier('./types', '/proj/lib', 'd.ts', fs)).toBe(
      './types/index.js',
    );
  });

  it('leaves unresolvable specifiers unchanged', () => {
    const fs = predicates({ files: [], dirs: [] });
    expect(resolveRelativeSpecifier('./missing', '/proj/lib', 'js', fs)).toBe('./missing');
    expect(resolveRelativeSpecifier('../missing', '/proj/lib', 'js', fs)).toBe('../missing');
  });

  it('ignores absolute, URL, and node: specifiers', () => {
    const fs = predicates({ files: [], dirs: [] });
    expect(resolveRelativeSpecifier('/abs/path', '/proj/lib', 'js', fs)).toBe('/abs/path');
    expect(resolveRelativeSpecifier('https://x/y', '/proj/lib', 'js', fs)).toBe('https://x/y');
    expect(resolveRelativeSpecifier('node:fs', '/proj/lib', 'js', fs)).toBe('node:fs');
  });

  it('does not double-apply: re-resolving the output is stable', () => {
    const fs = predicates({
      dirs: ['/proj/lib/primitives'],
      files: ['/proj/lib/primitives/index.js'],
    });
    const once = resolveRelativeSpecifier('./primitives', '/proj/lib', 'js', fs);
    const twice = resolveRelativeSpecifier(once, '/proj/lib', 'js', fs);
    expect(twice).toBe(once);
    expect(twice).toBe('./primitives/index.js');
  });
});

describe('rewriteSource', () => {
  it('rewrites `export *`, named export, and import from-clauses', () => {
    const fs = predicates({
      dirs: ['/dist/primitives', '/dist/rng'],
      files: ['/dist/primitives/index.js', '/dist/rng/index.js'],
    });
    const src = [
      "export * from './primitives';",
      "export { x } from './rng';",
      "import { y } from './primitives';",
    ].join('\n');
    const { source, changed } = rewriteSource(src, '/dist', 'js', fs);
    expect(changed).toBe(3);
    expect(source).toContain("export * from './primitives/index.js';");
    expect(source).toContain("export { x } from './rng/index.js';");
    expect(source).toContain("import { y } from './primitives/index.js';");
  });

  it('rewrites dynamic import(...) expressions', () => {
    const fs = predicates({ files: ['/dist/types.js'] });
    const src = "const t = import('./types');";
    const { source, changed } = rewriteSource(src, '/dist', 'js', fs);
    expect(changed).toBe(1);
    expect(source).toBe("const t = import('./types.js');");
  });

  it('preserves the original quote style', () => {
    const fs = predicates({ files: ['/dist/types.js'] });
    const src = `import a from "./types";`;
    const { source, changed } = rewriteSource(src, '/dist', 'js', fs);
    expect(changed).toBe(1);
    expect(source).toBe(`import a from "./types.js";`);
  });

  it('does not rewrite specifiers that appear inside comments', () => {
    // Mirrors the real `{@link import('./verify')}` JSDoc false-positive.
    const fs = predicates({ files: ['/dist/leveltest/verify.js'] });
    const src = [
      '/**',
      " * policies in {@link import('./verify').LevelTestConfig}.",
      ' */',
      "import { run } from './verify';",
    ].join('\n');
    const { source, changed } = rewriteSource(src, '/dist/leveltest', 'js', fs);
    expect(changed).toBe(1);
    // Comment specifier untouched.
    expect(source).toContain("{@link import('./verify').LevelTestConfig}");
    // Code specifier rewritten.
    expect(source).toContain("from './verify.js'");
  });

  it('does not mistake a `//` inside a string for a comment', () => {
    const fs = predicates({ files: ['/dist/types.js'] });
    const src = "const url = 'https://example.com//path';\nimport { x } from './types';\n";
    const { source, changed } = rewriteSource(src, '/dist', 'js', fs);
    expect(changed).toBe(1);
    expect(source).toContain("'https://example.com//path'");
    expect(source).toContain("from './types.js'");
  });

  it('does not rewrite specifiers that appear inside string literals', () => {
    // BUG 2 regression: `from './nope'` appears INSIDE a double-quoted value
    // string, not as a real import. Both ./nope and ./x resolve on the fake fs,
    // so without the fix the string contents would be corrupted to
    // "from './nope.js'". Only the real ./x import must be rewritten.
    const fs = predicates({ files: ['/dist/nope.js', '/dist/x.js'] });
    const src = `const s = "from './nope'";\nimport { y } from './x';\n`;
    const { source, changed } = rewriteSource(src, '/dist', 'js', fs);
    expect(changed).toBe(1);
    // Value string preserved byte-for-byte.
    expect(source).toContain(`const s = "from './nope'";`);
    expect(source).not.toContain(`from './nope.js'`);
    // Real import rewritten.
    expect(source).toContain("from './x.js'");
  });

  it('does not rewrite specifiers inside backtick template literals', () => {
    // Template bodies are treated as wholly non-scanned (pragmatic: real
    // relative specifiers are never built via template interpolation here).
    const fs = predicates({ files: ['/dist/types.js', '/dist/x.js'] });
    const src = "const t = `from './types' ${1}`;\nimport { y } from './x';\n";
    const { source, changed } = rewriteSource(src, '/dist', 'js', fs);
    expect(changed).toBe(1);
    expect(source).toContain('const t = `from \'./types\' ${1}`;');
    expect(source).not.toContain("from './types.js'");
    expect(source).toContain("from './x.js'");
  });

  it('never emits a relative .d.ts specifier in declaration-file output', () => {
    // Regression guard for BUG 1: a `.d.ts` file must never contain a relative
    // specifier ending in `.d.ts`; every relative specifier must end in `.js`
    // or `/index.js` (TS resolves those to the on-disk `.d.ts`).
    const fs = predicates({
      dirs: ['/dist/primitives'],
      files: ['/dist/types.d.ts', '/dist/primitives/index.d.ts'],
    });
    const src = [
      "import { Foo } from './types';",
      "export * from './primitives';",
    ].join('\n');
    const { source, changed } = rewriteSource(src, '/dist', 'd.ts', fs);
    expect(changed).toBe(2);
    for (const line of source.split('\n')) {
      expect(line).not.toMatch(/(?:from\s+|import\s*\(\s*)['"][./][^'"]*\.d\.ts['"]/);
    }
    expect(source).toContain("from './types.js'");
    expect(source).toContain("from './primitives/index.js'");
  });

  it('is idempotent on already-rewritten output', () => {
    const fs = predicates({
      dirs: ['/dist/primitives'],
      files: ['/dist/primitives/index.js'],
    });
    const src = "export * from './primitives';\n";
    const first = rewriteSource(src, '/dist', 'js', fs);
    const second = rewriteSource(first.source, '/dist', 'js', fs);
    expect(second.changed).toBe(0);
    expect(second.source).toBe(first.source);
  });
});

describe('splitCodeAndComments', () => {
  it('reconstructs the source exactly', () => {
    const src = [
      '// line comment',
      '/* block */ const s = "str";',
      '`tmpl ${1}`',
      '/** jsdoc */',
    ].join('\n');
    const segs = splitCodeAndComments(src);
    expect(segs.map((s) => s.text).join('')).toBe(src);
  });
});
