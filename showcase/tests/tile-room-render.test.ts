import { createCanvas } from 'canvas';
import { describe, expect, it } from 'vitest';
import {
  drawTileRoomFrame,
  partitionTileRoomEntities,
  resolveTileRoomEntities,
} from '../sections/tile-room-render';
import {
  TILE_ROOM_SEED,
  TILE_ROOM_VIEW_H,
  TILE_ROOM_VIEW_W,
  createGeneratedRoomScene,
  createTopologyRoomScene,
} from '../sections/tile-room-fixtures';
import {
  createTileRoomTerrainArtAtlas,
  createTileRoomTerrainArtProject,
  prepareTileRoomTerrainArt,
} from '../sections/tile-room-dual-grid';
import type { LevelEntity } from '../../src/level/types';

function render(
  treatment: 'fallback' | 'ruins' | 'cavern' | 'mechanical' | 'outdoor' | 'dual-grid',
  collectedEntityIds?: ReadonlySet<number>,
  paintPreview?: {
    readonly cells: readonly { readonly col: number; readonly row: number }[];
    readonly behavior: 'paint' | 'erase';
    readonly cursor: { readonly col: number; readonly row: number };
  },
  movingPlatformPreview?: {
    readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
    readonly path: readonly { readonly x: number; readonly y: number }[];
    readonly mode: 'create' | 'move';
  },
  spikePreview?: {
    readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
    readonly mode: 'create' | 'delete';
    readonly targets: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[];
  },
  entityPreview?: { readonly entity: Readonly<LevelEntity>; readonly mode: 'place' | 'move' | 'delete' },
  movingPlatformWidget?: {
    readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
    readonly path: readonly { readonly x: number; readonly y: number }[];
    readonly activeWaypoint?: number;
  },
  selectedEntity?: Readonly<LevelEntity>,
): Uint8Array {
  const scene = createTopologyRoomScene();
  const canvas = createCanvas(TILE_ROOM_VIEW_W, TILE_ROOM_VIEW_H);
  const context = canvas.getContext('2d');
  const project = createTileRoomTerrainArtProject();
  const atlas = createTileRoomTerrainArtAtlas(project);
  const atlasCanvas = createCanvas(atlas.width, atlas.height);
  const atlasContext = atlasCanvas.getContext('2d');
  const image = atlasContext.createImageData(atlas.width, atlas.height);
  image.data.set(atlas.pixels);
  atlasContext.putImageData(image, 0, 0);

  drawTileRoomFrame(
    context as unknown as CanvasRenderingContext2D,
    scene,
    {
      camera: { x: 180, y: 120 },
      viewW: TILE_ROOM_VIEW_W,
      viewH: TILE_ROOM_VIEW_H,
      dpr: 1,
      player: null,
      movingRects: new Map(),
      treatment,
      showMarkers: false,
      collectedEntityIds,
      worldSeed: TILE_ROOM_SEED,
      dualGrid: {
        prepared: prepareTileRoomTerrainArt(scene.level, project),
        atlas,
        image: atlasCanvas as unknown as CanvasImageSource,
        selection: null,
        paintPreview,
        movingPlatformPreview,
        movingPlatformWidget,
        selectedEntity,
        spikePreview,
        entityPreview,
      },
    },
  );

  return canvas.toBuffer('image/png') as Uint8Array;
}

describe('tile-room frame composition', () => {
  it('renders byte-identical cave frames for identical inputs', () => {
    expect(render('cavern')).toEqual(render('cavern'));
  });

  it('keeps the fallback and cave treatments visibly distinct', () => {
    expect(render('fallback')).not.toEqual(render('cavern'));
  });

  it('renders the generated dual-grid atlas as a distinct deterministic treatment', () => {
    expect(render('dual-grid')).toEqual(render('dual-grid'));
    expect(render('dual-grid')).not.toEqual(render('fallback'));
    expect(render('dual-grid')).not.toEqual(render('outdoor'));
  });

  it('renders an observable live level-paint preview before cells are committed', () => {
    const paint = { cells: [{ col: 16, row: 12 }, { col: 17, row: 12 }], behavior: 'paint' as const, cursor: { col: 17, row: 12 } };
    const erase = { ...paint, behavior: 'erase' as const };
    expect(render('dual-grid', undefined, paint)).not.toEqual(render('dual-grid'));
    expect(render('dual-grid', undefined, erase)).not.toEqual(render('dual-grid', undefined, paint));
  });

  it('renders a live moving-platform rectangle and travel path before commit', () => {
    const preview = { rect: { x: 352, y: 240, width: 64, height: 16 }, path: [{ x: 352, y: 240 }, { x: 416, y: 240 }], mode: 'create' as const };
    expect(render('dual-grid', undefined, undefined, preview)).not.toEqual(render('dual-grid'));
  });

  it('renders the selected moving-platform route and active destination handle', () => {
    const widget = { rect: { x: 352, y: 240, width: 64, height: 16 }, path: [{ x: 352, y: 240 }, { x: 448, y: 176 }], activeWaypoint: 1 };
    expect(render('dual-grid', undefined, undefined, undefined, undefined, undefined, widget)).not.toEqual(render('dual-grid'));
  });

  it('renders a persistent object-selection outline', () => {
    const selected = createTopologyRoomScene().level.entities.find((entity) => entity.kind === 'movingPlatform')!;
    expect(render('dual-grid', undefined, undefined, undefined, undefined, undefined, undefined, selected)).not.toEqual(render('dual-grid'));
  });

  it('renders distinct spike creation and deletion previews before commit', () => {
    const create = { rect: { x: 352, y: 240, width: 64, height: 16 }, mode: 'create' as const, targets: [] };
    const remove = { ...create, mode: 'delete' as const, targets: [create.rect] };
    expect(render('dual-grid', undefined, undefined, undefined, create)).not.toEqual(render('dual-grid'));
    expect(render('dual-grid', undefined, undefined, undefined, remove)).not.toEqual(render('dual-grid', undefined, undefined, undefined, create));
  });

  it('renders distinct object placement and deletion feedback', () => {
    const entity = { id: 99, kind: 'collectible', rect: { x: 352, y: 240, width: 12, height: 12 }, props: { kind: 'coin', value: 1 } } satisfies LevelEntity;
    const place = { entity, mode: 'place' as const }; const remove = { entity, mode: 'delete' as const };
    expect(render('dual-grid', undefined, undefined, undefined, undefined, place)).not.toEqual(render('dual-grid'));
    expect(render('dual-grid', undefined, undefined, undefined, undefined, remove)).not.toEqual(render('dual-grid', undefined, undefined, undefined, undefined, place));
  });

  it('renders the four production themes distinctly', () => {
    const themed = [
      render('ruins'),
      render('cavern'),
      render('mechanical'),
      render('outdoor'),
    ];
    for (let a = 0; a < themed.length; a++) {
      for (let b = a + 1; b < themed.length; b++) {
        expect(themed[a]).not.toEqual(themed[b]);
      }
    }
  });

  it('removes collected pickups from fallback and themed frames', () => {
    for (const treatment of ['fallback', 'cavern'] as const) {
      expect(render(treatment, new Set([3]))).not.toEqual(render(treatment));
    }
  });

  it('substitutes runtime moving-platform rectangles without mutating the level', () => {
    const scene = createTopologyRoomScene();
    const moving = scene.level.entities.find((entity) => entity.kind === 'movingPlatform');
    expect(moving).toBeDefined();
    const authoredX = moving?.rect.x ?? 0;

    const resolved = resolveTileRoomEntities(
      scene.level,
      new Map([[moving?.id ?? -1, { x: authoredX + 40, y: 80, width: 48, height: 16 }]]),
      false,
    );
    const runtime = resolved.find((entity) => entity.id === moving?.id);

    expect(runtime?.rect.x).toBe(authoredX + 40);
    expect(moving?.rect.x).toBe(authoredX);
  });

  it('partitions every resolved entity exactly once', () => {
    const scene = createTopologyRoomScene();
    const resolved = resolveTileRoomEntities(scene.level, new Map(), true);
    const partition = partitionTileRoomEntities(resolved);
    const ids = [...partition.terrain, ...partition.other].map((entity) => entity.id);

    expect(ids).toHaveLength(resolved.length);
    expect(new Set(ids).size).toBe(resolved.length);
    expect([...ids].sort((a, b) => a - b)).toEqual(
      resolved.map((entity) => entity.id).sort((a, b) => a - b),
    );
  });
});

describe('marker visibility follows the edit/play split (§5.6)', () => {
  it('drops spawn and trigger markers in the play view', () => {
    const scene = createTopologyRoomScene();
    const play = resolveTileRoomEntities(scene.level, new Map(), false);
    expect(play.some((entity) => entity.kind === 'spawn')).toBe(false);
    expect(play.some((entity) => entity.kind === 'trigger')).toBe(false);
  });

  it('keeps them in the edit view, and drops nothing else', () => {
    const scene = createTopologyRoomScene();
    const play = resolveTileRoomEntities(scene.level, new Map(), false);
    const edit = resolveTileRoomEntities(scene.level, new Map(), true);

    expect(edit).toHaveLength(scene.level.entities.length);
    expect(edit.some((entity) => entity.kind === 'spawn')).toBe(true);
    const dropped = edit.length - play.length;
    expect(dropped).toBe(
      scene.level.entities.filter(
        (entity) => entity.kind === 'spawn' || entity.kind === 'trigger',
      ).length,
    );
  });

  it('omits collected entities while leaving uncollected pickups visible', () => {
    const scene = createTopologyRoomScene();
    const resolved = resolveTileRoomEntities(
      scene.level,
      new Map(),
      false,
      new Set([3]),
    );

    expect(resolved.some((entity) => entity.id === 3)).toBe(false);
    expect(resolved.some((entity) => entity.id === 4)).toBe(true);
  });

  it('routes terrain roles to the terrain pass and everything else to the other pass', () => {
    const scene = createTopologyRoomScene();
    const { terrain, other } = partitionTileRoomEntities(
      resolveTileRoomEntities(scene.level, new Map(), true),
    );
    for (const entity of terrain) {
      expect(['platform', 'passthrough', 'movingPlatform', 'hazard']).toContain(entity.kind);
    }
    for (const entity of other) {
      expect(['platform', 'passthrough', 'movingPlatform', 'hazard']).not.toContain(
        entity.kind,
      );
    }
  });

  it('changes rendered output when markers are toggled in both scenes', () => {
    for (const scene of [createGeneratedRoomScene(), createTopologyRoomScene()]) {
      const draw = (showMarkers: boolean): Uint8Array => {
        const canvas = createCanvas(TILE_ROOM_VIEW_W, TILE_ROOM_VIEW_H);
        const context = canvas.getContext('2d');
        drawTileRoomFrame(context as unknown as CanvasRenderingContext2D, scene, {
          camera: {
            x: Math.max(0, scene.level.spawn.x - 100),
            y: Math.max(0, scene.level.spawn.y - 100),
          },
          viewW: TILE_ROOM_VIEW_W,
          viewH: TILE_ROOM_VIEW_H,
          dpr: 1,
          player: null,
          movingRects: new Map(),
          treatment: 'cavern',
          showMarkers,
          worldSeed: TILE_ROOM_SEED,
        });
        return canvas.toBuffer('image/png') as Uint8Array;
      };
      expect(draw(false)).not.toEqual(draw(true));
    }
  });
});

describe('canvas discipline', () => {
  it('leaves the transform where it found it (§13.2)', () => {
    const scene = createTopologyRoomScene();
    const canvas = createCanvas(TILE_ROOM_VIEW_W, TILE_ROOM_VIEW_H);
    const context = canvas.getContext('2d');
    const before = context.getTransform();

    drawTileRoomFrame(context as unknown as CanvasRenderingContext2D, scene, {
      camera: { x: 180.37, y: 120.63 },
      viewW: TILE_ROOM_VIEW_W,
      viewH: TILE_ROOM_VIEW_H,
      dpr: 2,
      player: null,
      movingRects: new Map(),
      treatment: 'cavern',
      showMarkers: false,
      worldSeed: TILE_ROOM_SEED,
    });

    const after = context.getTransform();
    expect([after.a, after.b, after.c, after.d, after.e, after.f]).toEqual([
      before.a,
      before.b,
      before.c,
      before.d,
      before.e,
      before.f,
    ]);
  });
});

describe('culling invariance against the tile room (§11.3)', () => {
  /**
   * Moving the camera must change only *which* terrain is drawn, never how any
   * of it looks. Two frames whose cameras differ by a whole number of world
   * pixels must agree exactly on the world region both of them show.
   *
   * Layers are off: parallax is transform-only presentation that is *supposed*
   * to move with the camera, so including it would test the opposite property.
   */
  function renderAt(cameraX: number) {
    const scene = createTopologyRoomScene();
    const canvas = createCanvas(TILE_ROOM_VIEW_W, TILE_ROOM_VIEW_H);
    const context = canvas.getContext('2d');
    drawTileRoomFrame(context as unknown as CanvasRenderingContext2D, scene, {
      camera: { x: cameraX, y: 120 },
      viewW: TILE_ROOM_VIEW_W,
      viewH: TILE_ROOM_VIEW_H,
      dpr: 1,
      player: null,
      movingRects: new Map(),
      treatment: 'cavern',
      showMarkers: false,
      worldSeed: TILE_ROOM_SEED,
      drawLayers: false,
    });
    return context.getImageData(0, 0, TILE_ROOM_VIEW_W, TILE_ROOM_VIEW_H);
  }

  it('renders the shared region identically after the camera pans', () => {
    const shift = 16;
    const a = renderAt(180);
    const b = renderAt(180 + shift);

    let compared = 0;
    let mismatch: string | null = null;
    compare:
    for (let y = 0; y < TILE_ROOM_VIEW_H; y++) {
      // Exclude the two device pixels adjacent to each canvas clip boundary:
      // Canvas anti-alias coverage there is implementation-dependent even when
      // the same world primitive is translated by an exact device-pixel span.
      for (let x = shift + 2; x < TILE_ROOM_VIEW_W - 2; x++) {
        const ai = (y * TILE_ROOM_VIEW_W + x) * 4;
        const bi = (y * TILE_ROOM_VIEW_W + (x - shift)) * 4;
        if (
          a.data[ai] !== b.data[bi] ||
          a.data[ai + 1] !== b.data[bi + 1] ||
          a.data[ai + 2] !== b.data[bi + 2]
        ) {
          mismatch = `world pixel ${x},${y} differed after a ${shift}px camera pan`;
          break compare;
        }
        compared++;
      }
    }
    expect(mismatch).toBeNull();
    expect(compared).toBeGreaterThan(0);
  });
});
