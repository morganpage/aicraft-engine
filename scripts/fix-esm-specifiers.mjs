/**
 * Post-build specifier rewriter.
 *
 * `tsc` emits extensionless relative specifiers in ESM output
 * (`export * from './primitives'`, `import { x } from './types'`, ...). Node's
 * ESM resolver rejects directory / extensionless imports
 * (`ERR_UNSUPPORTED_DIR_IMPORT`); only bundlers resolve them. This script walks
 * the compiled `dist/` tree and rewrites every RELATIVE module specifier in a
 * real import/export statement to be Node-ESM-resolvable, while leaving bare,
 * absolute, URL, and already-extensioned specifiers untouched.
 *
 * Design goals:
 *  - Keep `tsc` as the compiler; zero source churn.
 *  - Preserve tree-shaking: only specifiers change, statements stay verbatim.
 *  - Idempotent: running twice yields identical output.
 *  - Pure, injectable core for unit testing.
 *
 * Usage: `node scripts/fix-esm-specifiers.mjs [distDir]`
 *   distDir defaults to `<repo>/dist`.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Specifiers ending in one of these are already Node-ESM-resolvable and are
 * never touched. Order matters only for readability.
 */
const ALREADY_EXTENSIONED = /\.(?:js|cjs|mjs|json|d\.ts)$/;

/**
 * Rewrite a single RELATIVE module specifier to be Node-ESM-resolvable.
 *
 * Pure over its arguments when `resolvers` is injected. `resolvers` is an
 * object with two predicates:
 *   - `existsDir(absPath)`  -> is `absPath` a directory?
 *   - `existsFile(absPath)` -> is `absPath` a file?
 *
 * Resolution rules (Node-compatible):
 *  1. `<dir>/<spec>` is a directory containing `index.<ext>`  -> `<spec>/index.<ext>`
 *  2. `<dir>/<spec>.<ext>` is a file                           -> `<spec>.<ext>`
 *  3. otherwise leave the specifier unchanged.
 *
 * @param {string}  specifier   The raw specifier text (e.g. `./primitives`, `../types`).
 * @param {string}  fromFileDir Absolute directory of the file containing the specifier.
 * @param {'js'|'d.ts'} ext     Extension family to resolve for.
 * @param {{existsDir:(p:string)=>boolean, existsFile:(p:string)=>boolean}} [resolvers]
 *        Injectable fs predicates. Defaults to real fs checks.
 * @returns {string} The rewritten specifier, or the input unchanged.
 */
export function resolveRelativeSpecifier(specifier, fromFileDir, ext, resolvers = defaultResolvers) {
  if (typeof specifier !== 'string' || specifier === '') return specifier;

  // Only relative specifiers are candidates. Bare (`aicraft-engine`),
  // absolute (`/abs/x`), and URL (`https://...`, `node:...`) are left alone.
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return specifier;

  // Already-extensioned: leave verbatim (idempotency + explicit intent).
  if (ALREADY_EXTENSIONED.test(specifier)) return specifier;

  // Resolve against the filesystem using the REAL extension family (`d.ts`
  // for declaration files) so file/dir detection is correct, but EMIT a `.js`
  // specifier. TypeScript resolves a `.js` specifier inside a `.d.ts` to the
  // corresponding `.d.ts` on disk, whereas a value import of a `.d.ts`
  // specifier is rejected with TS2846 ("A declaration file cannot be imported
  // without 'import type'"). Emitting `.js` keeps the output correct under
  // `skipLibCheck:false` and stays idempotent (`.js` is in the
  // ALREADY_EXTENSIONED set, so a second pass leaves it untouched).
  const resolveExt = ext === 'd.ts' ? 'd.ts' : 'js';
  const emitExt = 'js';
  const resolveFileExt = '.' + resolveExt;
  const emitFileExt = '.' + emitExt;
  const target = resolve(fromFileDir, specifier);

  // Rule 1: directory containing an index.<resolveExt>.
  const indexFile = join(target, 'index.' + resolveExt);
  if (resolvers.existsDir(target) && resolvers.existsFile(indexFile)) {
    const base = specifier.replace(/\/+$/, '');
    return base + '/index.' + emitExt;
  }

  // Rule 2: a file at <target>.<resolveExt>.
  const fileTarget = target + resolveFileExt;
  if (resolvers.existsFile(fileTarget)) {
    return specifier + emitFileExt;
  }

  // Rule 3: cannot resolve (e.g. comment-only path, generated-later module).
  return specifier;
}

/**
 * Real fs-backed predicates used by the CLI. Exported so tests can assert the
 * default wiring without importing private state.
 */
export const defaultResolvers = {
  existsFile(p) {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  },
  existsDir(p) {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
};

/**
 * Matches the specifier-literal portion of any static `from` clause or dynamic
 * `import(...)` expression. Captures:
 *   [1] prefix   -> `from ` | `import(` (with surrounding whitespace)
 *   [2] quote    -> `'` | `"`
 *   [3] specifier-> the raw module specifier text
 * The closing quote is matched via backreference (\2) so the pair is balanced.
 *
 * NOTE: this regex intentionally matches the *syntactic* form. Comment and
 * string-literal exclusion is handled upstream by `rewriteSource` /
 * `splitCodeAndComments`, which only expose genuine code regions to this regex
 * (never comment regions, and never the BODIES of value string literals).
 */
const SPECIFIER_RE = /(from\s+|import\s*\(\s*)(['"])([^'"]+)\2/g;

/**
 * Matches the tail of a code buffer that immediately precedes a specifier
 * argument — i.e. an unterminated `from ` clause or `import(...)` expression.
 * Used by the lexer to decide whether the next quoted literal is a module
 * specifier (kept in the scanned code buffer) or an ordinary value string
 * (emitted as a non-scanned segment).
 */
const SPECIFIER_ARG_RE = /(?:from\s+|import\s*\(\s*)$/;

/**
 * Rewrite all import/export specifiers in a source string.
 *
 * `source` is split into code, comment, and string-literal regions; only code
 * regions are scanned. This prevents rewriting specifiers that appear inside
 * JSDoc / block comments (e.g. `{@link import('./verify')}` examples in doc
 * text) and inside value string/template literals (e.g.
 * `const s = "from './nope'"`).
 *
 * @param {string} source
 * @param {string} fromFileDir Absolute directory of the file this source came from.
 * @param {'js'|'d.ts'} ext
 * @param {{existsDir:(p:string)=>boolean, existsFile:(p:string)=>boolean}} [resolvers]
 * @returns {{source: string, changed: number}}
 */
export function rewriteSource(source, fromFileDir, ext, resolvers = defaultResolvers) {
  let changed = 0;
  const out = [];
  for (const seg of splitCodeAndComments(source)) {
    if (seg.type === 'comment' || seg.type === 'string') {
      out.push(seg.text);
      continue;
    }
    const rewritten = seg.text.replace(SPECIFIER_RE, (match, prefix, quote, spec) => {
      const next = resolveRelativeSpecifier(spec, fromFileDir, ext, resolvers);
      if (next === spec) return match;
      changed += 1;
      return prefix + quote + next + quote;
    });
    out.push(rewritten);
  }
  return { source: out.join(''), changed };
}

/**
 * Split a source string into code, comment, and string-literal regions.
 *
 * Region types: `{ type: 'code' | 'comment' | 'string', text }`. The
 * concatenation of all `text` fields equals the original source.
 *
 *  - `code`    : scanned by `SPECIFIER_RE`.
 *  - `comment` : never scanned (line / block / JSDoc).
 *  - `string`  : never scanned. Covers the full literal (opening quote + body +
 *               closing quote) so neither `//`/`/*` inside the body nor a
 *               `from '...'` / `import('...')` substring inside the body can be
 *               mistaken for real syntax (BUG 2 fix).
 *
 * A quoted literal that is the specifier argument of a `from` clause or
 * `import(...)` expression is detected via `SPECIFIER_ARG_RE` and is kept in the
 * `code` buffer (so the `from '<spec>'` / `import('<spec>')` pattern remains
 * intact for scanning). Backtick template literals are ALWAYS emitted as
 * non-scanned `string` regions — their `${...}` interpolations are not rescanned.
 * This is a deliberate, pragmatic choice: real relative specifiers are never
 * assembled via template interpolation in `tsc`-emitted output, so treating the
 * whole template body as opaque is safe and keeps the lexer simple.
 *
 * @param {string} src
 * @returns {Array<{type: 'code'|'comment'|'string', text: string}>}
 */
export function splitCodeAndComments(src) {
  const segments = [];
  let i = 0;
  const n = src.length;
  let buf = '';
  const flush = () => {
    if (buf) {
      segments.push({ type: 'code', text: buf });
      buf = '';
    }
  };

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    // Line comment: `// ... <EOL>`
    if (c === '/' && c2 === '/') {
      flush();
      let j = i + 2;
      while (j < n && src[j] !== '\n') j++;
      segments.push({ type: 'comment', text: src.slice(i, j) });
      i = j;
      continue;
    }

    // Block comment / JSDoc: `/* ... */`
    if (c === '/' && c2 === '*') {
      flush();
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      j = Math.min(n, j + 2);
      segments.push({ type: 'comment', text: src.slice(i, j) });
      i = j;
      continue;
    }

    // String / template literal. The whole literal span (quotes + body) is
    // consumed so its contents cannot start a comment or be scanned. If the
    // literal is the specifier argument of a `from`/`import(` (detected by the
    // trailing code buffer), it is kept in the code buffer so SPECIFIER_RE can
    // match the `from '<spec>'` / `import('<spec>')` pattern across the quote;
    // otherwise it is emitted as a non-scanned 'string' segment. Backtick
    // templates are always non-scanned (see JSDoc above).
    if (c === '"' || c === "'" || c === '`') {
      const isSpecifierArg = c !== '`' && SPECIFIER_ARG_RE.test(buf);
      if (isSpecifierArg) {
        buf += c;
        i += 1;
        while (i < n) {
          const d = src[i];
          if (d === '\\') {
            buf += d;
            if (i + 1 < n) buf += src[i + 1];
            i += 2;
            continue;
          }
          buf += d;
          i += 1;
          if (d === c) break; // matching unescaped quote
        }
      } else {
        flush();
        let j = i + 1;
        while (j < n) {
          const d = src[j];
          if (d === '\\') {
            j += 2;
            continue;
          }
          j += 1;
          if (d === c) break; // matching unescaped quote
        }
        segments.push({ type: 'string', text: src.slice(i, j) });
        i = j;
      }
      continue;
    }

    buf += c;
    i += 1;
  }
  flush();
  return segments;
}

/** Rewrite a single file in place. Returns number of specifiers changed. */
function rewriteFile(filePath, ext) {
  const original = readFileSync(filePath, 'utf8');
  const { source, changed } = rewriteSource(original, dirname(filePath), ext);
  if (changed > 0) {
    writeFileSync(filePath, source);
  }
  return changed;
}

/** Recursively collect all target files under `root`. */
function collectFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const entry = stack.pop();
    let st;
    try {
      st = statSync(entry);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      for (const name of readdirSync(entry)) stack.push(join(entry, name));
    } else if (st.isFile()) {
      if (entry.endsWith('.js') || entry.endsWith('.d.ts')) out.push(entry);
    }
  }
  return out;
}

function main() {
  const distDir = resolve(repoRoot, process.argv[2] ?? 'dist');
  let st;
  try {
    st = statSync(distDir);
  } catch {
    console.error(`[fix-esm-specifiers] dist dir not found: ${distDir}`);
    process.exitCode = 1;
    return;
  }
  if (!st.isDirectory()) {
    console.error(`[fix-esm-specifiers] not a directory: ${distDir}`);
    process.exitCode = 1;
    return;
  }

  const files = collectFiles(distDir).sort();
  let totalChanged = 0;
  let touched = 0;
  for (const file of files) {
    const ext = file.endsWith('.d.ts') ? 'd.ts' : 'js';
    const changed = rewriteFile(file, ext);
    if (changed > 0) {
      touched += 1;
      totalChanged += changed;
    }
  }
  console.log(
    `[fix-esm-specifiers] rewrote ${totalChanged} specifier(s) across ${touched} file(s) ` +
      `of ${files.length} scanned in ${distDir.replace(repoRoot + '/', '')}`,
  );
}

// Run only when invoked directly, not when imported by tests.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main();
}
