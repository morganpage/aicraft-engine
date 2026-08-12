/**
 * Prepared level-theme facade.
 *
 * Theme normalization is level-independent; connectivity and static rectangle
 * exposure are prepared once per level. Draw passes never classify geometry.
 *
 * @module
 */

import type { EntityKind, LevelData, LevelEntity, LevelRect } from '../level/types';
import { prefersReducedMotion } from '../primitives/motion';
import { safeHex } from '../primitives/color';
import {
  computeRectExposures,
  createTerrainConnectionTable,
  createTerrainMaterialTable,
  drawTerrainRect,
  drawTerrainTiles,
  normalizeTerrainMaterial,
  type NormalizedTerrainMaterial,
  type TerrainEdgeDetailRenderer,
  type TerrainDetailRenderer,
  type TerrainMaterialInput,
  type TerrainRectRole,
  type TerrainViewport,
} from '../terrain';
import {
  DEFAULT_ENTITY_PALETTE,
  drawLevelEntity,
  type DrawLevelEntityOverrideMap,
  type EntityPalette,
} from './renderer';
import { drawThemedLevelEntity } from './themed-entity-renderer';

export interface ResolvedLevelEntity {
  readonly entity: Readonly<LevelEntity>;
  readonly rect: Readonly<LevelRect>;
}

export interface LevelRenderFrame {
  readonly level: Readonly<LevelData>;
  readonly devicePixelRatio: number;
  readonly view: Readonly<TerrainViewport>;
  readonly entities: readonly Readonly<ResolvedLevelEntity>[];
  readonly tick: number;
  readonly interpolation?: number;
  readonly reducedMotion?: boolean;
  readonly mode?: 'play' | 'edit' | 'thumbnail';
}

export interface LevelTerrainTheme {
  readonly tiles: Readonly<Record<number, Readonly<TerrainMaterialInput>>>;
  readonly solid: Readonly<TerrainMaterialInput>;
  readonly passthrough: Readonly<TerrainMaterialInput>;
  readonly moving: Readonly<TerrainMaterialInput>;
  readonly hazard: Readonly<TerrainMaterialInput>;
  readonly connects?: (centerValue: number, neighborValue: number) => boolean;
  readonly rectFamilyFor?: (entity: Readonly<LevelEntity>) => number;
  readonly drawTileDetail?: TerrainDetailRenderer;
  readonly drawTileEdgeDetail?: TerrainEdgeDetailRenderer;
  readonly drawRectDetail?: TerrainDetailRenderer;
}

export type LevelLayerRenderer = (
  ctx: CanvasRenderingContext2D,
  frame: Readonly<LevelRenderFrame>,
) => void;

export interface LevelRenderTheme {
  readonly id: string;
  readonly visualSeed: number;
  readonly backgroundColor: string;
  readonly terrain: Readonly<LevelTerrainTheme>;
  readonly entityPalette?: Readonly<EntityPalette>;
  readonly entityOverrides?: Readonly<DrawLevelEntityOverrideMap>;
  readonly farBackground?: LevelLayerRenderer;
  readonly midBackground?: LevelLayerRenderer;
  readonly backDecorations?: LevelLayerRenderer;
  readonly frontDecorations?: LevelLayerRenderer;
  readonly foreground?: LevelLayerRenderer;
  readonly screenTint?: LevelLayerRenderer;
  /**
   * Optional terrain-art override. When present, the frame composer
   * (`drawPreparedLevelFrame`) calls this **instead of** the procedural
   * `drawTerrainTiles` + `drawTerrainRects` passes. This is the seam
   * used to render LDtk-authored levels through `drawLdtkLevel`.
   *
   * When omitted, the legacy procedural terrain renderer is used.
   */
  readonly terrainArt?: LevelLayerRenderer;
}

export interface TerrainDiagnostic {
  readonly code: 'connector-threw' | 'material-invalid' | 'detail-threw' | 'scene-mismatch';
  readonly detail: string;
  readonly error?: unknown;
}

export interface LevelThemeRendererOptions {
  readonly onDiagnostic?: (diagnostic: Readonly<TerrainDiagnostic>) => void;
}

export interface LevelThemeRenderer {
  readonly prepare: (level: Readonly<LevelData>) => PreparedLevelScene;
}

export interface PreparedLevelScene {
  readonly level: Readonly<LevelData>;
  readonly drawBackground: LevelLayerRenderer;
  readonly drawTerrainTiles: LevelLayerRenderer;
  readonly drawTerrainRects: LevelLayerRenderer;
  readonly drawEntities: LevelLayerRenderer;
  readonly drawEntity: (
    ctx: CanvasRenderingContext2D,
    resolved: Readonly<ResolvedLevelEntity>,
    frame: Readonly<LevelRenderFrame>,
  ) => void;
  readonly drawBackDecorations: LevelLayerRenderer;
  readonly drawFrontDecorations: LevelLayerRenderer;
  readonly drawForeground: LevelLayerRenderer;
  readonly drawScreenTint: LevelLayerRenderer;
}

function defineEntityKindPartition<
  const Terrain extends readonly EntityKind[],
  const NonTerrain extends readonly EntityKind[],
>(
  terrain: Terrain,
  nonTerrain: NonTerrain,
  _allKindsCovered: Exclude<EntityKind, Terrain[number] | NonTerrain[number]> extends never ? true : never,
  _noKindOverlaps: Extract<Terrain[number], NonTerrain[number]> extends never ? true : never,
): readonly [Terrain, NonTerrain] {
  return [terrain, nonTerrain] as const;
}

export const [TERRAIN_ROLE_KINDS, NON_TERRAIN_KINDS] = defineEntityKindPartition(
  ['platform', 'passthrough', 'movingPlatform', 'hazard'] as const,
  // Phase 8 — springs + dash crystals are non-terrain interactive objects
  // (trigger volumes), not collision geometry for theme rendering.
  ['spawn', 'exit', 'trap', 'decoration', 'trigger', 'enemy', 'collectible', 'spring', 'dashRefill'] as const,
  true,
  true,
);

const TERRAIN_SET: ReadonlySet<EntityKind> = new Set(TERRAIN_ROLE_KINDS);
const NON_TERRAIN_SET: ReadonlySet<EntityKind> = new Set(NON_TERRAIN_KINDS);

function roleFor(kind: EntityKind): TerrainRectRole {
  if (kind === 'passthrough') return 'passthrough';
  if (kind === 'movingPlatform') return 'moving';
  if (kind === 'hazard') return 'hazard';
  return 'solid';
}

function normalizePalette(input?: Readonly<EntityPalette>): EntityPalette {
  const result: Record<string, string | undefined> = {};
  const base = DEFAULT_ENTITY_PALETTE as Readonly<Record<string, string | undefined>>;
  const authored = input as Readonly<Record<string, string | undefined>> | undefined;
  for (const key of Object.keys(base)) {
    const fallback = base[key];
    if (fallback !== undefined) result[key] = safeHex(authored?.[key], fallback);
  }
  return result;
}

function safeLayer(layer: LevelLayerRenderer | undefined): LevelLayerRenderer {
  return layer ?? (() => undefined);
}

export function createLevelThemeRenderer(
  theme: Readonly<LevelRenderTheme>,
  options: Readonly<LevelThemeRendererOptions> = {},
): LevelThemeRenderer {
  const onDiagnostic = options.onDiagnostic;
  const materials = createTerrainMaterialTable(theme.terrain.tiles);
  const roles = {
    solid: normalizeTerrainMaterial(theme.terrain.solid),
    passthrough: normalizeTerrainMaterial(theme.terrain.passthrough),
    moving: normalizeTerrainMaterial(theme.terrain.moving),
    hazard: normalizeTerrainMaterial(theme.terrain.hazard),
  } as const;
  const backgroundColor = safeHex(theme.backgroundColor, '#000000');
  const palette = normalizePalette(theme.entityPalette);
  const connects = typeof theme.terrain.connects === 'function'
    ? theme.terrain.connects
    : (a: number, b: number) => materials.get(a) !== undefined && materials.get(b) !== undefined;
  const rectFamilyFor = typeof theme.terrain.rectFamilyFor === 'function'
    ? theme.terrain.rectFamilyFor
    : undefined;

  const guardedDetail = (
    callback: TerrainDetailRenderer | undefined,
    label: string,
  ): TerrainDetailRenderer | undefined => callback === undefined ? undefined : (ctx, detail) => {
    try {
      callback(ctx, detail);
    } catch (error) {
      onDiagnostic?.({ code: 'detail-threw', detail: label, error });
      throw error;
    }
  };
  const tileDetail = guardedDetail(theme.terrain.drawTileDetail, 'tile detail renderer threw');
  const rectDetail = guardedDetail(theme.terrain.drawRectDetail, 'rectangle detail renderer threw');
  const guardedEdgeDetail = theme.terrain.drawTileEdgeDetail === undefined
    ? undefined
    : ((ctx, detail) => {
      try {
        theme.terrain.drawTileEdgeDetail?.(ctx, detail);
      } catch (error) {
        onDiagnostic?.({ code: 'detail-threw', detail: 'tile edge detail renderer threw', error });
        throw error;
      }
    }) satisfies TerrainEdgeDetailRenderer;

  return {
    prepare(level) {
      const connections = createTerrainConnectionTable(level.tiles, connects, {
        onError(centerValue, neighborValue, error) {
          onDiagnostic?.({
            code: 'connector-threw',
            detail: `connector threw for ${centerValue} -> ${neighborValue}`,
            error,
          });
        },
      });
      const staticRects = level.entities
        .filter((entity) => TERRAIN_SET.has(entity.kind) && entity.kind !== 'movingPlatform')
        .map((entity) => {
          const material = roles[roleFor(entity.kind)];
          let familyId = material.channelId;
          if (rectFamilyFor !== undefined) {
            try {
              const candidate = rectFamilyFor(entity);
              if (Number.isFinite(candidate)) familyId = candidate | 0;
            } catch (error) {
              onDiagnostic?.({ code: 'material-invalid', detail: `rect family failed for entity ${entity.id}`, error });
            }
          }
          return { key: entity.id, rect: entity.rect, familyId, minimumSpan: material.cornerSize };
        });
      const exposure = computeRectExposures(staticRects);
      const mismatches = new WeakSet<object>();

      const accept = (frame: Readonly<LevelRenderFrame>): LevelRenderFrame | null => {
        if (frame.level !== level) {
          const reference = frame.level as object;
          if (!mismatches.has(reference)) {
            mismatches.add(reference);
            onDiagnostic?.({ code: 'scene-mismatch', detail: 'frame.level was not prepared by this scene' });
          }
          return null;
        }
        return frame.reducedMotion === undefined
          ? { ...frame, reducedMotion: prefersReducedMotion() }
          : frame;
      };
      const materialFor = (kind: EntityKind): NormalizedTerrainMaterial => roles[roleFor(kind)];

      const drawOne = (
        ctx: CanvasRenderingContext2D,
        resolved: Readonly<ResolvedLevelEntity>,
        frame: Readonly<LevelRenderFrame>,
      ): void => {
        const accepted = accept(frame);
        if (accepted === null) return;
        if (TERRAIN_SET.has(resolved.entity.kind)) {
          drawTerrainRect(ctx, resolved.rect, {
            visualSeed: theme.visualSeed,
            devicePixelRatio: accepted.devicePixelRatio,
            entityKey: resolved.entity.id,
            role: roleFor(resolved.entity.kind),
            material: materialFor(resolved.entity.kind),
            drawDetail: rectDetail,
            exposure: resolved.entity.kind === 'movingPlatform'
              ? undefined
              : exposure.get(resolved.entity.id),
          });
        } else if (NON_TERRAIN_SET.has(resolved.entity.kind)) {
          const override = theme.entityOverrides?.[resolved.entity.kind];
          if (
            override === undefined &&
            drawThemedLevelEntity(ctx, resolved, accepted, { themeId: theme.id, palette })
          ) return;
          drawLevelEntity(ctx, { ...resolved.entity, rect: resolved.rect } as LevelEntity, {
            palette,
            drawOverride: theme.entityOverrides,
          });
        }
      };

      return {
        level,
        drawBackground(ctx, frame) {
          const accepted = accept(frame);
          if (accepted === null) return;
          ctx.fillStyle = backgroundColor;
          ctx.fillRect(0, 0, accepted.view.width, accepted.view.height);
          safeLayer(theme.farBackground)(ctx, accepted);
          safeLayer(theme.midBackground)(ctx, accepted);
        },
        drawTerrainTiles(ctx, frame) {
          const accepted = accept(frame);
          if (accepted === null) return;
          if (theme.terrainArt !== undefined) {
            theme.terrainArt(ctx, accepted);
            return;
          }
          drawTerrainTiles(ctx, level.tiles, {
            visualSeed: theme.visualSeed,
            view: accepted.view,
            devicePixelRatio: accepted.devicePixelRatio,
            materials,
            connections,
            drawDetail: tileDetail,
            drawEdgeDetail: guardedEdgeDetail,
            overscanTiles: 1,
          });
        },
        drawTerrainRects(ctx, frame) {
          const accepted = accept(frame);
          if (accepted === null) return;
          // When a terrain-art override is active, the procedural rect pass
          // is skipped — the override owns all terrain rendering (e.g. an
          // LDtk level whose tiles + entity rects are both in the tileset).
          if (theme.terrainArt !== undefined) return;
          for (const resolved of accepted.entities) {
            if (TERRAIN_SET.has(resolved.entity.kind)) drawOne(ctx, resolved, accepted);
          }
        },
        drawEntities(ctx, frame) {
          const accepted = accept(frame);
          if (accepted === null) return;
          for (const resolved of accepted.entities) {
            if (NON_TERRAIN_SET.has(resolved.entity.kind)) drawOne(ctx, resolved, accepted);
          }
        },
        drawEntity: drawOne,
        drawBackDecorations(ctx, frame) {
          const accepted = accept(frame); if (accepted !== null) safeLayer(theme.backDecorations)(ctx, accepted);
        },
        drawFrontDecorations(ctx, frame) {
          const accepted = accept(frame); if (accepted !== null) safeLayer(theme.frontDecorations)(ctx, accepted);
        },
        drawForeground(ctx, frame) {
          const accepted = accept(frame); if (accepted !== null) safeLayer(theme.foreground)(ctx, accepted);
        },
        drawScreenTint(ctx, frame) {
          const accepted = accept(frame); if (accepted !== null) safeLayer(theme.screenTint)(ctx, accepted);
        },
      };
    },
  };
}

/** Convert authored entities to resolved entries, substituting runtime rectangles. */
export function resolveLevelEntities(
  entities: readonly Readonly<LevelEntity>[],
  runtimeRects: ReadonlyMap<number, Readonly<LevelRect>> = new Map(),
): readonly ResolvedLevelEntity[] {
  return entities.map((entity) => ({ entity, rect: runtimeRects.get(entity.id) ?? entity.rect }));
}
