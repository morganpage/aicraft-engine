/** Theme selection and deterministic thumbnail helpers for editor consumers. @module */

import type { LevelData } from '../level/types';
import type { LevelRenderTheme, PreparedLevelScene } from './level-theme';
import { drawPreparedLevelFrame } from './level-layers';
import { resolveLevelEntities } from './level-theme';

export interface LevelThemeOption {
  readonly id: string;
  readonly label: string;
  readonly theme: Readonly<LevelRenderTheme>;
}

export interface ResolvedLevelThemeOption {
  readonly option: Readonly<LevelThemeOption>;
  readonly requestedId: string | undefined;
  readonly usedFallback: boolean;
}

/**
 * Resolve a consumer-supplied theme list without a global registry.
 *
 * Unknown/missing ids use `fallbackId` when present, otherwise the first
 * option. An empty list returns `null`.
 */
export function resolveLevelThemeOption(
  options: readonly Readonly<LevelThemeOption>[],
  requestedId?: string,
  fallbackId?: string,
): ResolvedLevelThemeOption | null {
  if (!Array.isArray(options) || options.length === 0) return null;
  const exact = requestedId === undefined
    ? undefined
    : options.find((entry) => entry.id === requestedId);
  const fallback = fallbackId === undefined
    ? undefined
    : options.find((entry) => entry.id === fallbackId);
  const option = exact ?? fallback ?? options[0];
  return { option, requestedId, usedFallback: exact === undefined };
}

export interface DrawLevelThumbnailOptions {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio?: number;
  readonly padding?: number;
}

/**
 * Draw a deterministic, reduced-motion thumbnail fitted inside a target box.
 *
 * The prepared scene must own `level`; mismatch behavior remains fail-closed.
 */
export function drawLevelThumbnail(
  ctx: CanvasRenderingContext2D,
  scene: Readonly<PreparedLevelScene>,
  level: Readonly<LevelData>,
  options: Readonly<DrawLevelThumbnailOptions>,
): void {
  const width = Number.isFinite(options.width) && options.width > 0 ? options.width : 1;
  const height = Number.isFinite(options.height) && options.height > 0 ? options.height : 1;
  const padding = Number.isFinite(options.padding)
    ? Math.max(0, options.padding ?? 0)
    : 0;
  const levelWidth = Number.isFinite(level.width) && level.width > 0 ? level.width : 1;
  const levelHeight = Number.isFinite(level.height) && level.height > 0 ? level.height : 1;
  const scale = Math.max(0.0001, Math.min(
    Math.max(1, width - padding * 2) / levelWidth,
    Math.max(1, height - padding * 2) / levelHeight,
  ));
  const offsetX = (width - levelWidth * scale) / 2;
  const offsetY = (height - levelHeight * scale) / 2;
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    drawPreparedLevelFrame(ctx, scene, {
      level,
      devicePixelRatio: options.devicePixelRatio ?? 1,
      view: { x: 0, y: 0, width: levelWidth, height: levelHeight },
      entities: resolveLevelEntities(level.entities),
      tick: 0,
      reducedMotion: true,
      mode: 'thumbnail',
    });
  } finally {
    ctx.restore();
  }
}
