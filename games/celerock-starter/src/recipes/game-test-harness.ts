import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The game-test harness: the pieces every game's `tests/` needs to test GAME
 * code (not just the engine) under Node/Vitest.
 *
 * This recipe exists because a real build shipped green with 34 passing
 * tests — none of which imported a single line of game code. Every wiring
 * defect it shipped (a footstep cue consumed before it was produced, a snow
 * layer simulated but never drawn, particle speeds 60× too fast, a respawn
 * that dropped its facing) was invisible to an engine-only suite by
 * construction. Three pieces close that hole:
 *
 * 1. `createRecordingContext2D` + `stubCanvas` — run the game's real draw
 *    code against a recording stub and assert the emitted operations (the
 *    snow layer, the world-space draws).
 * 2. `scanForbiddenIdentifiers` — the §12.8 static-contract greps as a
 *    function: walk the game's `src/`, fail on `Math.random` / `Date.now` /
 *    `requestAnimationFrame` / `fillText` (configurable).
 * 3. `missingShotManifest` — the §13 QA gates made fail-loud: a build once
 *    referenced a gate screenshot its QA script silently never produced.
 *    Assert the manifest is empty in a test and the gate cannot vanish.
 *
 * Node-only (fs imports) — use from `tests/`, never from game runtime code.
 */

/** One recorded context operation (method name + positional args). */
export interface RecordedOp {
  readonly op: string;
  readonly args: readonly unknown[];
}

/**
 * A recording `CanvasRenderingContext2D` stub: every method call appends to
 * `ops`; property assignments (`fillStyle`, `globalAlpha`, …) append a
 * `set:<name>` op. All methods are no-ops; gradient/filter shorthands return
 * benign values so render code that reads them does not crash.
 */
export interface RecordingContext2D {
  readonly ops: RecordedOp[];
  /** Ops named `fillRect`/`drawImage`/… — convenience filter. */
  opsNamed(name: string): readonly RecordedOp[];
}

export function createRecordingContext2D(): RecordingContext2D & CanvasRenderingContext2D {
  const ops: RecordedOp[] = [];
  const state = {
    globalAlpha: 1,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    imageSmoothingEnabled: true,
    globalCompositeOperation: 'source-over',
  };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop: string) {
      if (prop === 'ops') return ops;
      if (prop === 'opsNamed') return (name: string) => ops.filter((o) => o.op === name);
      if (prop === 'canvas') return null;
      if (prop === 'measureText') return () => ({ width: 0 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop: () => undefined });
      }
      if (prop === 'createPattern') return () => null;
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
      if (prop === 'isPointInPath') return () => false;
      if (typeof prop === 'string' && prop in state) return (state as Record<string, unknown>)[prop];
      // Every other property access: a record-and-no-op method (save/restore/
      // translate/drawImage/fillRect/… all flow through here).
      return (...args: unknown[]) => {
        ops.push({ op: prop, args });
        return undefined;
      };
    },
    set(_target, prop: string, value) {
      ops.push({ op: `set:${prop}`, args: [value] });
      if (prop in state) (state as Record<string, unknown>)[prop] = value;
      return true;
    },
  };
  return new Proxy({}, handler) as unknown as RecordingContext2D & CanvasRenderingContext2D;
}

/**
 * A minimal `HTMLCanvasElement` stub for harness-constructed games: `getContext`
 * hands out the recorder (or `null` after the first call when `nullContext` —
 * the "render is not under test" mode), `width`/`height` are plain fields.
 */
export function stubCanvas(width = 1280, height = 720): HTMLCanvasElement {
  return {
    width,
    height,
    style: {},
    getContext: () => null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as HTMLCanvasElement;
}

/** A canvas whose `getContext` returns the recording context. */
export function stubCanvasWithRecorder(
  width = 1280,
  height = 720,
): { canvas: HTMLCanvasElement; ctx: RecordingContext2D & CanvasRenderingContext2D } {
  const ctx = createRecordingContext2D();
  const canvas = {
    width,
    height,
    style: {},
    getContext: () => ctx,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as HTMLCanvasElement;
  return { canvas, ctx };
}

/** A default forbidden-identifier rule: the call pattern + the reason. */
export interface ForbiddenIdentifierRule {
  /** What to grep for (regex source).
   */
  readonly pattern: string;
  readonly reason: string;
}

/** The §12.8 defaults: unseeded randomness, host clocks, self-scheduling, canvas text. */
export const DEFAULT_FORBIDDEN_IDENTIFIERS: readonly ForbiddenIdentifierRule[] = [
  { pattern: String.raw`Math\.random\s*\(`, reason: 'unseeded randomness — use mulberry32' },
  { pattern: String.raw`Date\.now\s*\(`, reason: 'host clock — use the tick or the loop dt' },
  { pattern: String.raw`requestAnimationFrame\s*\(`, reason: 'the fixed-tick loop owns scheduling' },
  { pattern: String.raw`fillText\s*\(`, reason: 'canvas text — the bitmap font is the only text path' },
];

export interface ScanOptions {
  /** Directory names to skip (engine copy-ins, node_modules). Default `['recipes', 'node_modules']`. */
  readonly excludeDirs?: readonly string[];
  /** Extra rules beyond {@link DEFAULT_FORBIDDEN_IDENTIFIERS}. */
  readonly extraRules?: readonly ForbiddenIdentifierRule[];
  /** When true, ONLY `extraRules` apply (defaults not merged). */
  readonly replaceDefaults?: boolean;
}

export interface IdentifierOffender {
  readonly file: string;
  readonly pattern: string;
  readonly reason: string;
  readonly line: number;
}

function walk(dir: string, exclude: readonly string[], out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (exclude.includes(entry)) continue;
      walk(full, exclude, out);
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Scan a source tree for forbidden identifiers — the static-contract greps as
 * a testable function. Returns every offender (file, 1-based line, rule);
 * an empty array is the pass condition:
 *
 * ```ts
 * expect(scanForbiddenIdentifiers('src')).toEqual([]);
 * ```
 */
export function scanForbiddenIdentifiers(rootDir: string, opts: ScanOptions = {}): readonly IdentifierOffender[] {
  const exclude = opts.excludeDirs ?? ['recipes', 'node_modules'];
  const rules = opts.replaceDefaults
    ? [...(opts.extraRules ?? [])]
    : [...DEFAULT_FORBIDDEN_IDENTIFIERS, ...(opts.extraRules ?? [])];
  const regexes = rules.map((rule) => ({ ...rule, re: new RegExp(rule.pattern) }));
  const offenders: IdentifierOffender[] = [];
  if (!existsSync(rootDir)) return offenders;
  for (const file of walk(rootDir, exclude)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const rule of regexes) {
        if (rule.re.test(line)) {
          offenders.push({ file, pattern: rule.pattern, reason: rule.reason, line: i + 1 });
        }
      }
    });
  }
  return offenders;
}

/**
 * The QA gate manifest check — fail-loud by construction. A build once
 * referenced a hot-reload gate screenshot its QA script silently skipped
 * (a needle-match branch that never fired); the gap shipped unnoticed. Wrap
 * in a test and a missing shot is a red suite:
 *
 * ```ts
 * it('every §13 gate shot exists', () => {
 *   expect(missingShotManifest('.qa/shots', GATE_SHOTS)).toEqual([]);
 * });
 * ```
 *
 * Returns the missing entries as `${filename} (required by gate ${n})`
 * strings; extra files in the directory are NOT offenders (captures grow).
 */
export function missingShotManifest(
  shotsDir: string,
  required: readonly string[],
): readonly string[] {
  return required.filter((name) => !existsSync(join(shotsDir, name)));
}
