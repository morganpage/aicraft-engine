import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRecordingContext2D,
  missingShotManifest,
  scanForbiddenIdentifiers,
  stubCanvas,
  stubCanvasWithRecorder,
} from '../game-test-harness';

describe('createRecordingContext2D', () => {
  it('records method calls with positional args', () => {
    const ctx = createRecordingContext2D();
    ctx.save();
    ctx.translate(3, 4);
    ctx.fillRect(10, 20, 2, 2);
    ctx.restore();
    expect(ctx.opsNamed('translate')).toEqual([{ op: 'translate', args: [3, 4] }]);
    expect(ctx.opsNamed('fillRect')).toHaveLength(1);
    expect(ctx.ops.map((o) => o.op)).toEqual(['save', 'translate', 'fillRect', 'restore']);
  });

  it('records property assignments as set:<name> ops', () => {
    const ctx = createRecordingContext2D();
    ctx.fillStyle = '#ff0000';
    ctx.globalAlpha = 0.5;
    expect(ctx.opsNamed('set:fillStyle')[0].args[0]).toBe('#ff0000');
    expect(ctx.opsNamed('set:globalAlpha')[0].args[0]).toBe(0.5);
  });

  it('gradient/measure shorthands return benign values (render code does not crash)', () => {
    const ctx = createRecordingContext2D();
    expect(() => {
      const g = ctx.createLinearGradient(0, 0, 1, 1);
      g.addColorStop(0, '#000');
      ctx.measureText('x');
    }).not.toThrow();
  });
});

describe('stubCanvas', () => {
  it('yields a null context by default (render-not-under-test mode)', () => {
    const canvas = stubCanvas(640, 360);
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
    expect(canvas.getContext('2d')).toBeNull();
  });

  it('the recorder variant hands the recording context to game render code', () => {
    const { canvas, ctx } = stubCanvasWithRecorder();
    const gameCtx = canvas.getContext('2d') as unknown as { fillRect: (x: number, y: number, w: number, h: number) => void };
    gameCtx.fillRect(1, 2, 3, 4);
    expect(ctx.opsNamed('fillRect')).toHaveLength(1);
  });
});

describe('scanForbiddenIdentifiers', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'harness-scan-'));
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'src', 'recipes'));
    writeFileSync(
      join(dir, 'src', 'main.ts'),
      'const x = 1;\nconst y = Math.random();\nexport { x, y };\n',
    );
    writeFileSync(join(dir, 'src', 'render.ts'), 'ctx.fillText("hi", 0, 0);\nexport {};\n');
    // Copy-in engine recipes are excluded by default — this offender must NOT trip.
    writeFileSync(join(dir, 'src', 'recipes', 'copied.ts'), 'const t = Date.now();\nexport {};\n');
    writeFileSync(join(dir, 'src', 'clean.ts'), 'export const fine = 3;\n');
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds offenders with file + line, excluding recipes/ by default', () => {
    const offenders = scanForbiddenIdentifiers(join(dir, 'src'));
    expect(offenders).toHaveLength(2);
    const random = offenders.find((o) => o.file.endsWith('main.ts'));
    expect(random?.line).toBe(2);
    expect(random?.reason).toContain('mulberry32');
    expect(offenders.some((o) => o.file.endsWith('render.ts') && o.reason.includes('bitmap font'))).toBe(true);
    expect(offenders.every((o) => !o.file.includes('recipes'))).toBe(true);
  });

  it('an empty array is the pass condition (clean tree)', () => {
    const clean = mkdtempSync(join(tmpdir(), 'harness-clean-'));
    try {
      writeFileSync(join(clean, 'a.ts'), 'export const a = 1;\n');
      expect(scanForbiddenIdentifiers(clean)).toEqual([]);
    } finally {
      rmSync(clean, { recursive: true, force: true });
    }
  });
});

describe('missingShotManifest — the fail-loud QA gate', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'harness-shots-'));
    writeFileSync(join(dir, '01-menu.png'), 'x');
    writeFileSync(join(dir, '17-hotreload.png'), 'x');
    // 09-slide.png deliberately absent.
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists exactly the missing required shots', () => {
    const missing = missingShotManifest(dir, ['01-menu.png', '09-slide.png', '17-hotreload.png']);
    expect(missing).toEqual(['09-slide.png']);
  });

  it('a complete manifest is empty', () => {
    expect(missingShotManifest(dir, ['01-menu.png'])).toEqual([]);
  });

  it('a missing directory lists every requirement', () => {
    expect(missingShotManifest(join(dir, 'does-not-exist'), ['a.png'])).toEqual(['a.png']);
  });
});
