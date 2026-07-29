import { createCanvas } from 'canvas';
import { describe, expect, it } from 'vitest';
import { createEditorState } from '../editor';
import type { LevelData } from '../level/types';
import {
  CAVERN_LEVEL_THEME,
  MECHANICAL_LEVEL_THEME,
  RUINS_LEVEL_THEME,
  createLevelThemeRenderer,
  drawLevelThumbnail,
  resolveLevelThemeOption,
  type LevelThemeOption,
} from '../platformer';

const options: readonly LevelThemeOption[] = [
  { id: 'ruins', label: 'Ruins', theme: RUINS_LEVEL_THEME },
  { id: 'cavern', label: 'Cavern', theme: CAVERN_LEVEL_THEME },
  { id: 'mechanical', label: 'Mechanical', theme: MECHANICAL_LEVEL_THEME },
];

const level: LevelData = {
  version: 1,
  id: 'thumbnail',
  name: 'Thumbnail',
  width: 64,
  height: 32,
  tileSize: 8,
  spawn: { x: 4, y: 16 },
  tiles: {
    cols: 8,
    rows: 4,
    tileSize: 8,
    data: [
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 1, 1, 1, 0, 0, 0,
      0, 0, 1, 0, 1, 0, 0, 0,
      1, 1, 1, 1, 1, 1, 1, 1,
    ],
  },
  entities: [
    { id: 1, kind: 'collectible', rect: { x: 28, y: 12, width: 6, height: 6 }, props: { kind: 'gem' } },
  ],
  nextEntityId: 2,
};

describe('theme option fallback', () => {
  it('resolves exact ids without falling back', () => {
    expect(resolveLevelThemeOption(options, 'mechanical', 'cavern')).toMatchObject({
      option: { id: 'mechanical' },
      usedFallback: false,
    });
  });

  it('uses the configured fallback, then the first option', () => {
    expect(resolveLevelThemeOption(options, 'missing', 'cavern')?.option.id).toBe('cavern');
    expect(resolveLevelThemeOption(options, 'missing', 'also-missing')?.option.id).toBe('ruins');
    expect(resolveLevelThemeOption([], 'missing')).toBeNull();
  });

  it('does not touch editor level state or undo history', () => {
    const editor = createEditorState(level);
    const levelBefore = JSON.stringify(editor.level);
    const undoBefore = editor.undoStack;
    resolveLevelThemeOption(options, 'mechanical', 'cavern');
    resolveLevelThemeOption(options, 'ruins', 'cavern');
    expect(editor.undoStack).toBe(undoBefore);
    expect(JSON.stringify(editor.level)).toBe(levelBefore);
  });
});

describe('level thumbnails', () => {
  function render(): Uint8Array {
    const canvas = createCanvas(160, 90);
    const scene = createLevelThemeRenderer(CAVERN_LEVEL_THEME).prepare(level);
    drawLevelThumbnail(
      canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
      scene,
      level,
      { width: 160, height: 90, padding: 4 },
    );
    return canvas.toBuffer('image/png') as Uint8Array;
  }

  it('is byte-identical for the same level and theme', () => {
    expect(render()).toEqual(render());
  });

  it('does not mutate serialized level data', () => {
    const before = JSON.stringify(level);
    render();
    expect(JSON.stringify(level)).toBe(before);
  });
});
