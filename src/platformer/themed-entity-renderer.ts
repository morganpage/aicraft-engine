/**
 * Semantic platformer-entity silhouettes for themed level rendering.
 *
 * These are shared fallbacks, not game-art mandates. Runtime enemies remain
 * consumer-owned and return `false` so the regular renderer can handle them.
 *
 * @module
 */

import { safeHex } from '../primitives/color';
import type { EntityPalette } from './renderer';
import type { LevelRenderFrame, ResolvedLevelEntity } from './level-theme';

export interface DrawThemedLevelEntityOptions {
  readonly themeId: string;
  readonly palette?: Readonly<EntityPalette>;
}

interface SemanticColors {
  readonly bright: string;
  readonly body: string;
  readonly dark: string;
  readonly danger: string;
}

function colorsFor(themeId: string, palette?: Readonly<EntityPalette>): SemanticColors {
  const body = themeId === 'mechanical'
    ? '#9dabb0'
    : themeId === 'cavern'
      ? '#aa91b0'
      : themeId === 'outdoor' ? '#7fa354' : '#b49872';
  const dark = themeId === 'mechanical'
    ? '#172027'
    : themeId === 'cavern'
      ? '#1c1724'
      : themeId === 'outdoor' ? '#26321f' : '#241b1c';
  return {
    bright: safeHex(palette?.exit, '#ffe066'),
    body,
    dark,
    danger: safeHex(palette?.hazard, '#ff4d45'),
  };
}

function drawEditMarker(
  ctx: CanvasRenderingContext2D,
  resolved: Readonly<ResolvedLevelEntity>,
  color: string,
): void {
  const r = resolved.rect;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(Math.floor(r.x) + 0.5, Math.floor(r.y) + 0.5, Math.max(0, Math.floor(r.width) - 1), Math.max(0, Math.floor(r.height) - 1));
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Draw a semantic entity. Returns `true` when the entity was handled, including
 * intentionally hidden play-mode markers.
 */
export function drawThemedLevelEntity(
  ctx: CanvasRenderingContext2D,
  resolved: Readonly<ResolvedLevelEntity>,
  frame: Readonly<LevelRenderFrame>,
  options: Readonly<DrawThemedLevelEntityOptions>,
): boolean {
  const { entity, rect: r } = resolved;
  const colors = colorsFor(options.themeId, options.palette);
  const edit = frame.mode === 'edit';

  if (entity.kind === 'spawn' || entity.kind === 'trigger') {
    if (edit) {
      drawEditMarker(
        ctx,
        resolved,
        entity.kind === 'spawn'
          ? safeHex(options.palette?.spawn, '#7aff7a')
          : safeHex(options.palette?.trigger, '#3a9a9a'),
      );
    }
    return true;
  }

  if (entity.kind === 'exit') {
    const inset = Math.max(1, Math.min(r.width, r.height) * 0.12);
    ctx.fillStyle = colors.dark;
    ctx.fillRect(r.x, r.y + r.height * 0.22, r.width, r.height * 0.78);
    ctx.fillStyle = colors.body;
    ctx.beginPath();
    ctx.arc(r.x + r.width / 2, r.y + r.height * 0.32, Math.max(1, r.width / 2), Math.PI, 0);
    ctx.lineTo(r.x + r.width, r.y + r.height);
    ctx.lineTo(r.x, r.y + r.height);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = colors.dark;
    ctx.fillRect(r.x + inset, r.y + r.height * 0.38, Math.max(0, r.width - inset * 2), r.height * 0.62);
    ctx.fillStyle = entity.props.locked ? colors.danger : colors.bright;
    ctx.fillRect(r.x + r.width * 0.68, r.y + r.height * 0.6, Math.max(1, inset), Math.max(1, inset));
    if (entity.props.isTrap) {
      ctx.strokeStyle = colors.danger;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + r.width, r.y + r.height); ctx.stroke();
    }
    return true;
  }

  if (entity.kind === 'collectible') {
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const radius = Math.max(1, Math.min(r.width, r.height) / 2);
    const color = entity.props.kind === 'coin'
      ? safeHex(options.palette?.collectibleCoin, '#ffd700')
      : entity.props.kind === 'gem'
        ? safeHex(options.palette?.collectibleGem, '#4a9eff')
        : safeHex(options.palette?.collectibleKey, '#c0c0c0');
    ctx.fillStyle = color;
    ctx.strokeStyle = colors.dark;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (entity.props.kind === 'gem') {
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx + radius, cy);
      ctx.lineTo(cx, cy + radius);
      ctx.lineTo(cx - radius, cy);
      ctx.closePath();
    } else if (entity.props.kind === 'key') {
      ctx.arc(cx - radius * 0.35, cy - radius * 0.15, radius * 0.4, 0, Math.PI * 2);
      ctx.moveTo(cx, cy); ctx.lineTo(cx + radius, cy + radius * 0.55);
      ctx.lineTo(cx + radius * 0.72, cy + radius * 0.55);
    } else {
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
    return true;
  }

  if (entity.kind === 'trap') {
    ctx.fillStyle = colors.danger;
    ctx.strokeStyle = colors.dark;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r.x + r.width / 2, r.y);
    ctx.lineTo(r.x + r.width, r.y + r.height);
    ctx.lineTo(r.x, r.y + r.height);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = colors.dark;
    ctx.fillRect(r.x + r.width * 0.46, r.y + r.height * 0.35, Math.max(1, r.width * 0.08), Math.max(1, r.height * 0.32));
    return true;
  }

  return false;
}
