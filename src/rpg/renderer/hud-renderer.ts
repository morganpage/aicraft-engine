/**
 * HUD rendering: party HP bars and inventory counts on the bitmap font.
 * Colors come from the theme; low HP turns the bar red below 25%.
 */

import {
  DEFAULT_FONT,
  drawText,
  type BitmapFont,
} from '../../primitives/bitmap-font';
import type { CreatureInstance, SpeciesDefinition } from '../creatures';
import { deriveMaxHp } from '../creatures';
import type { InventoryState } from '../inventory';
import type { RpgVisualTheme } from './theme';
import { DEFAULT_RPG_THEME } from './theme';

export interface RpgHudDrawOptions {
  readonly theme?: RpgVisualTheme;
  readonly font?: BitmapFont;
  readonly scale?: number;
}

export interface HpBarParams {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly label: string;
  readonly current: number;
  readonly max: number;
  readonly theme?: RpgVisualTheme;
  readonly font?: BitmapFont;
  readonly scale?: number;
}

/** Draw one labeled HP bar; proportional fill, red under 25%. */
export function drawHpBar(
  ctx: CanvasRenderingContext2D,
  params: HpBarParams,
): void {
  const theme = params.theme ?? DEFAULT_RPG_THEME;
  const font = params.font ?? DEFAULT_FONT;
  const scale = params.scale ?? 1;
  const safeMax = Math.max(1, params.max);
  const ratio = Math.min(1, Math.max(0, params.current / safeMax));
  const height = 8;

  drawText(ctx, params.label, params.x, params.y, { font, scale, color: theme.panels.text });
  const barY = params.y + font.cellHeight * scale + 2;
  ctx.fillStyle = theme.panels.hpBack;
  ctx.fillRect(params.x, barY, params.width, height);
  ctx.fillStyle = ratio <= 0.25 ? theme.panels.hpLow : theme.panels.hpFill;
  ctx.fillRect(params.x, barY, Math.round(params.width * ratio), height);
  ctx.strokeStyle = theme.panels.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(params.x + 0.5, barY + 0.5, params.width - 1, height - 1);
}

/** Draw the party HUD: one HP bar per member, in order. */
export function drawPartyHud(
  ctx: CanvasRenderingContext2D,
  party: readonly CreatureInstance[],
  species: Readonly<Record<string, SpeciesDefinition>>,
  options: RpgHudDrawOptions & { readonly x: number; readonly y: number; readonly width: number },
): void {
  const theme = options.theme ?? DEFAULT_RPG_THEME;
  party.forEach((member, index) => {
    const def = species[member.speciesId];
    const label = def ? `${def.name} L${member.level}` : member.speciesId;
    drawHpBar(ctx, {
      x: options.x,
      y: options.y + index * 26,
      width: options.width,
      label,
      current: member.currentHp,
      max: def ? deriveMaxHp(def.baseStats.hp, member.level) : member.currentHp,
      theme,
      font: options.font,
      scale: options.scale,
    });
  });
}

/** Draw the inventory line (item name × count) under the party HUD. */
export function drawInventoryHud(
  ctx: CanvasRenderingContext2D,
  inventory: InventoryState,
  items: Readonly<Record<string, { readonly name: string }>>,
  options: RpgHudDrawOptions & { readonly x: number; readonly y: number },
): void {
  const theme = options.theme ?? DEFAULT_RPG_THEME;
  const font = options.font ?? DEFAULT_FONT;
  const scale = options.scale ?? 1;
  inventory.forEach((entry, index) => {
    const name = items[entry.itemId]?.name ?? entry.itemId;
    drawText(ctx, `${name} x${entry.quantity}`, options.x, options.y + index * (font.cellHeight * scale + 4), {
      font,
      scale,
      color: theme.panels.textDim,
    });
  });
}

