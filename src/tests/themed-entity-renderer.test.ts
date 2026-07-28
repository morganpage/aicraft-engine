import { createCanvas } from 'canvas';
import { describe, expect, it } from 'vitest';
import type { LevelData, LevelEntity } from '../level/types';
import {
  drawCavernDrips,
  drawMechanicalSparks,
  drawRuinsDust,
  drawThemedLevelEntity,
  type LevelRenderFrame,
  type ResolvedLevelEntity,
} from '../platformer';

const level: LevelData = {
  version: 1, id: 'semantic-test', name: 'Semantic test',
  width: 32, height: 32, tileSize: 16, spawn: { x: 0, y: 0 },
  tiles: { cols: 2, rows: 2, tileSize: 16, data: [0, 0, 0, 0] },
  entities: [], nextEntityId: 1,
};

function frame(mode: 'play' | 'edit' = 'play', tick = 0, reducedMotion = true): LevelRenderFrame {
  return {
    level,
    devicePixelRatio: 1,
    view: { x: 0, y: 0, width: 32, height: 32 },
    entities: [],
    tick,
    reducedMotion,
    mode,
  };
}

function resolved(entity: LevelEntity): ResolvedLevelEntity {
  return { entity, rect: entity.rect };
}

function render(entity: LevelEntity, mode: 'play' | 'edit' = 'play'): Uint8Array {
  const canvas = createCanvas(32, 32);
  drawThemedLevelEntity(
    canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
    resolved(entity),
    frame(mode),
    { themeId: 'cavern' },
  );
  return canvas.toBuffer('image/png') as Uint8Array;
}

describe('themed semantic entities', () => {
  it('hides spawn and trigger markers in play and shows them in edit', () => {
    const markers: LevelEntity[] = [
      { id: 1, kind: 'spawn', rect: { x: 4, y: 4, width: 20, height: 20 }, props: {} },
      { id: 2, kind: 'trigger', rect: { x: 3, y: 3, width: 24, height: 24 }, props: { action: 'test', params: {} } },
    ];
    for (const entity of markers) {
      const blank = createCanvas(32, 32).toBuffer('image/png');
      expect(render(entity, 'play')).toEqual(blank);
      expect(render(entity, 'edit')).not.toEqual(blank);
    }
  });

  it('draws recognizable and distinct exit states', () => {
    const base = { id: 1, kind: 'exit' as const, rect: { x: 8, y: 4, width: 16, height: 24 } };
    const open = render({ ...base, props: { locked: false, isTrap: false } });
    const locked = render({ ...base, props: { locked: true, isTrap: false } });
    const trap = render({ ...base, props: { locked: false, isTrap: true } });
    expect(open).not.toEqual(locked);
    expect(open).not.toEqual(trap);
  });

  it('uses different silhouettes for coin, gem, and key', () => {
    const images = (['coin', 'gem', 'key'] as const).map((kind, index) => render({
      id: index + 1,
      kind: 'collectible',
      rect: { x: 8, y: 8, width: 16, height: 16 },
      props: { kind },
    }));
    expect(images[0]).not.toEqual(images[1]);
    expect(images[1]).not.toEqual(images[2]);
  });

  it('draws traps as warning forms and leaves runtime enemies consumer-owned', () => {
    const canvas = createCanvas(32, 32);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    expect(drawThemedLevelEntity(ctx, resolved({
      id: 1, kind: 'trap', rect: { x: 4, y: 4, width: 24, height: 24 },
      props: { type: 'unknown', params: {} },
    }), frame(), { themeId: 'ruins' })).toBe(true);
    expect(drawThemedLevelEntity(ctx, resolved({
      id: 2, kind: 'enemy', rect: { x: 4, y: 4, width: 16, height: 16 },
      props: { archetype: 'runtime', params: {} },
    }), frame(), { themeId: 'ruins' })).toBe(false);
  });
});

describe('stateless atmosphere recipes', () => {
  it.each([
    ['ruins', drawRuinsDust],
    ['cavern', drawCavernDrips],
    ['mechanical', drawMechanicalSparks],
  ] as const)('%s has a stable reduced-motion state', (_name, recipe) => {
    const draw = (tick: number): Uint8Array => {
      const canvas = createCanvas(32, 32);
      recipe(canvas.getContext('2d') as unknown as CanvasRenderingContext2D, frame('play', tick, true));
      return canvas.toBuffer('image/png') as Uint8Array;
    };
    expect(draw(0)).toEqual(draw(100));
  });
});
