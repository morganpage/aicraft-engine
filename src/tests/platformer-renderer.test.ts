import { describe, it, expect, vi } from 'vitest';
import {
  drawLevelEntity,
  drawActor,
  drawTileGrid,
  DEFAULT_ENTITY_PALETTE,
} from '../platformer/renderer';
import type { LevelEntity, EntityKind } from '../level/types';
import type { ActorCore } from '../platformer/types';

/**
 * Unit tests for the platformer renderer helpers (`drawLevelEntity`,
 * `drawActor`, `drawTileGrid`). These touch a `CanvasRenderingContext2D`
 * but no real DOM; we mock the context with a plain object that records
 * method calls. Assertions are behavioral, not pixel-exact.
 */

interface StubCtx {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalCompositeOperation: string;
  fillRect: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  setLineDash: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
}

function createStubCtx(): StubCtx {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalCompositeOperation: 'source-over',
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  };
}

function entity(
  kind: EntityKind,
  id = 1,
  rect: { x: number; y: number; width: number; height: number } = { x: 0, y: 0, width: 32, height: 16 },
): LevelEntity {
  const props: Record<string, unknown> =
    kind === 'exit'
      ? { isTrap: false, locked: false }
      : kind === 'trap'
        ? { type: 'spikes', params: {} }
        : kind === 'decoration'
          ? { sprite: 'a' }
          : kind === 'trigger'
            ? { action: 'x', params: {} }
            : kind === 'movingPlatform'
              ? { speed: 30, path: [], loopMode: 'loop' }
              : kind === 'enemy'
                ? { archetype: 'spinny', params: {} }
                : kind === 'collectible'
                  ? { kind: 'coin' }
                  : kind === 'platform'
                    ? {}
                    : {};
  return { id, kind, rect, props } as unknown as LevelEntity;
}

function actorCore(overrides: Partial<ActorCore> = {}): ActorCore {
  return {
    x: 0,
    y: 0,
    width: 16,
    height: 24,
    vx: 0,
    vy: 0,
    facing: 1,
    onGround: false,
    contacts: { groundId: null, leftWallId: null, rightWallId: null, ceilingId: null },
    ...overrides,
  };
}

describe('drawLevelEntity', () => {
  it('dispatches to outlineRect for platform entities (fillRect + strokeRect called with palette color)', () => {
    const ctx = createStubCtx();
    drawLevelEntity(ctx as unknown as CanvasRenderingContext2D, entity('platform'));
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillStyle).toBe(DEFAULT_ENTITY_PALETTE.platform);
  });

  it('draws hazards with the hazard palette color', () => {
    const ctx = createStubCtx();
    drawLevelEntity(ctx as unknown as CanvasRenderingContext2D, entity('hazard'));
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillStyle).toBe(DEFAULT_ENTITY_PALETTE.hazard);
  });

  it('draws moving platforms with the movingPlatform palette color', () => {
    const ctx = createStubCtx();
    drawLevelEntity(ctx as unknown as CanvasRenderingContext2D, entity('movingPlatform'));
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillStyle).toBe(DEFAULT_ENTITY_PALETTE.movingPlatform);
  });

  it('draws traps with the trap palette color (solid-feeling outline)', () => {
    const ctx = createStubCtx();
    drawLevelEntity(ctx as unknown as CanvasRenderingContext2D, entity('trap'));
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillStyle).toBe(DEFAULT_ENTITY_PALETTE.trap);
  });

  it('draws passthrough entities with solid-fill treatment (regression: was invisible)', () => {
    // Passthrough was missing from SOLID_FEELING_KINDS, causing it to be
    // silently skipped by drawLevelEntity. Verify it now draws as a solid.
    const ctx = createStubCtx();
    drawLevelEntity(ctx as unknown as CanvasRenderingContext2D, entity('passthrough'));
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillStyle).toBe(DEFAULT_ENTITY_PALETTE.passthrough);
  });

  it('uses a dashed outline for spawn entities and resets the dash afterward', () => {
    const ctx = createStubCtx();
    drawLevelEntity(ctx as unknown as CanvasRenderingContext2D, entity('spawn'));
    expect(ctx.setLineDash).toHaveBeenCalledTimes(2);
    expect(ctx.setLineDash.mock.calls[0][0]).toEqual([3, 3]);
    expect(ctx.setLineDash.mock.calls[1][0]).toEqual([]);
  });

  it('uses a dashed outline for exit, trigger, decoration entities', () => {
    (['exit', 'trigger', 'decoration'] as const).forEach((kind) => {
      const ctx = createStubCtx();
      drawLevelEntity(ctx as unknown as CanvasRenderingContext2D, entity(kind));
      expect(ctx.setLineDash).toHaveBeenCalled();
    });
  });

  it('per-kind override intercepts drawing when it returns true', () => {
    const ctx = createStubCtx();
    const override = vi.fn(() => true);
    drawLevelEntity(ctx as unknown as CanvasRenderingContext2D, entity('platform'), {
      drawOverride: { platform: override },
    });
    expect(override).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('per-kind override falls through to the default when it returns false', () => {
    const ctx = createStubCtx();
    const override = vi.fn(() => false);
    drawLevelEntity(ctx as unknown as CanvasRenderingContext2D, entity('platform'), {
      drawOverride: { platform: override },
    });
    expect(override).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
  });

  it('palette override spreads over defaults', () => {
    const ctx = createStubCtx();
    drawLevelEntity(ctx as unknown as CanvasRenderingContext2D, entity('platform'), {
      palette: { platform: '#abcdef' },
    });
    expect(ctx.fillStyle).toBe('#abcdef');
  });

  it('draws a coin collectible with the collectibleCoin palette color (gold #ffd700)', () => {
    const ctx = createStubCtx();
    const coin = { ...entity('collectible'), props: { kind: 'coin' } } as unknown as LevelEntity;
    drawLevelEntity(ctx as unknown as CanvasRenderingContext2D, coin);
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillStyle).toBe(DEFAULT_ENTITY_PALETTE.collectibleCoin);
  });

  it('draws a gem collectible with the collectibleGem palette color (blue #4a9eff)', () => {
    const ctx = createStubCtx();
    const gem = { ...entity('collectible'), props: { kind: 'gem' } } as unknown as LevelEntity;
    drawLevelEntity(ctx as unknown as CanvasRenderingContext2D, gem);
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillStyle).toBe(DEFAULT_ENTITY_PALETTE.collectibleGem);
  });

  it('draws a key collectible with the collectibleKey palette color (silver #c0c0c0)', () => {
    const ctx = createStubCtx();
    const key = { ...entity('collectible'), props: { kind: 'key' } } as unknown as LevelEntity;
    drawLevelEntity(ctx as unknown as CanvasRenderingContext2D, key);
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillStyle).toBe(DEFAULT_ENTITY_PALETTE.collectibleKey);
  });

  it('collectible respects a palette override (e.g. consumer recolors coin)', () => {
    const ctx = createStubCtx();
    const coin = { ...entity('collectible'), props: { kind: 'coin' } } as unknown as LevelEntity;
    drawLevelEntity(ctx as unknown as CanvasRenderingContext2D, coin, {
      palette: { collectibleCoin: '#custom' },
    });
    expect(ctx.fillStyle).toBe('#custom');
  });
});

describe('drawActor', () => {
  it('draws an outlined rect at the actor core position', () => {
    const ctx = createStubCtx();
    const core = actorCore({ x: 100, y: 50, width: 16, height: 24 });
    drawActor(ctx as unknown as CanvasRenderingContext2D, core);
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect.mock.calls[0]).toEqual([100, 50, 16, 24]);
    expect(ctx.fillStyle).toBe(DEFAULT_ENTITY_PALETTE.player);
  });

  it('palette override changes the player color', () => {
    const ctx = createStubCtx();
    const core = actorCore();
    drawActor(ctx as unknown as CanvasRenderingContext2D, core, {
      palette: { player: '#ffffff' },
    });
    expect(ctx.fillStyle).toBe('#ffffff');
  });
});

describe('drawTileGrid', () => {
  it('iterates each non-zero cell and calls drawTile with world x/y, value, tileSize', () => {
    const ctx = createStubCtx();
    const grid = { data: [1, 0, 2, 0, 3, 0], cols: 3, rows: 2, tileSize: 16 };
    const seen: Array<[number, number, number, number]> = [];
    drawTileGrid(
      ctx as unknown as CanvasRenderingContext2D,
      grid,
      (_c, x, y, v, ts) => {
        seen.push([x, y, v, ts]);
      },
    );
    expect(seen).toEqual([
      [0, 0, 1, 16],
      [32, 0, 2, 16],
      [16, 16, 3, 16],
    ]);
  });

  it('includeZeros: true calls drawTile for zero cells too', () => {
    const ctx = createStubCtx();
    const grid = { data: [1, 0], cols: 2, rows: 1, tileSize: 8 };
    let count = 0;
    drawTileGrid(
      ctx as unknown as CanvasRenderingContext2D,
      grid,
      () => {
        count++;
      },
      { includeZeros: true },
    );
    expect(count).toBe(2);
  });
});
