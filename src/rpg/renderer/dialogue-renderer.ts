/**
 * Dialogue box rendering on the bitmap font: measured wrapping, typewriter
 * reveal, choice cursor. The reveal is presentation-only — the caller
 * advances it; under reduced motion the full line renders immediately.
 * Panel/text colors are verified WCAG-AA in tests.
 */

import {
  DEFAULT_FONT,
  measureText,
  drawText,
  type BitmapFont,
} from '../../primitives/bitmap-font';
import { prefersReducedMotion } from '../../primitives/motion';
import type { DialogueRequest } from '../dialogue';
import type { RpgVisualTheme } from './theme';
import { DEFAULT_RPG_THEME } from './theme';

export interface RpgDialogueDrawOptions {
  readonly width: number;
  /** Top edge of the panel. */
  readonly y: number;
  readonly theme?: RpgVisualTheme;
  readonly font?: BitmapFont;
  /** 0–1; fraction of the current line revealed. Forced to 1 under reduced motion. */
  readonly revealRatio?: number;
  readonly scale?: number;
}

/** Greedy word wrap against the bitmap font's metrics. */
export function wrapDialogueText(
  text: string,
  font: BitmapFont,
  maxWidth: number,
  scale: number = 1,
): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (measureText(candidate, font, scale).width <= maxWidth || current.length === 0) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/**
 * Draw the dialogue panel: speaker line, wrapped body text with typewriter
 * reveal, and the choice list with a cursor marker on the current index.
 */
export function drawRpgDialogue(
  ctx: CanvasRenderingContext2D,
  request: DialogueRequest,
  options: RpgDialogueDrawOptions,
): void {
  const theme = options.theme ?? DEFAULT_RPG_THEME;
  const font = options.font ?? DEFAULT_FONT;
  const scale = options.scale ?? 2;
  const reduced = prefersReducedMotion();
  const reveal = reduced ? 1 : Math.min(1, Math.max(0, options.revealRatio ?? 1));
  const lineHeight = font.cellHeight * scale + 4;

  const wrapped = wrapDialogueText(request.text, font, options.width - 24, scale);
  const choiceCount = request.choices.length;
  const panelHeight = 16 + lineHeight * (wrapped.length + 1 + choiceCount) + 10;

  ctx.fillStyle = theme.panels.background;
  ctx.fillRect(8, options.y, options.width - 16, panelHeight);
  ctx.strokeStyle = theme.panels.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(8, options.y, options.width - 16, panelHeight);

  let cursorY = options.y + 10;
  drawText(ctx, request.speakerId.toUpperCase(), 16, cursorY, {
    font, scale, color: theme.panels.accent,
  });
  cursorY += lineHeight + 2;

  const visibleChars = Math.floor(request.text.length * reveal);
  let used = 0;
  for (const line of wrapped) {
    const remaining = visibleChars - used;
    if (remaining <= 0) break;
    drawText(ctx, line.slice(0, remaining), 16, cursorY, {
      font, scale, color: theme.panels.text,
    });
    used += line.length + 1;
    cursorY += lineHeight;
  }

  cursorY += 4;
  request.choices.forEach((choice, index) => {
    const selected = index === request.cursor;
    if (selected) {
      drawText(ctx, '>', 16, cursorY, { font, scale, color: theme.panels.accent });
    }
    drawText(ctx, choice.text, 16 + font.cellWidth * scale * 2, cursorY, {
      font, scale,
      color: selected ? theme.panels.text : theme.panels.textDim,
    });
    cursorY += lineHeight;
  });
}
