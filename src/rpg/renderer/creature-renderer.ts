/**
 * Procedural creature rendering.
 *
 * Dispatches on the serializable `bodyPlan` grammar and draws silhouettes
 * readable at both battle and portrait sizes from `generatePalette` colors
 * plus primitive shapes. All decorative animation derives from the visual
 * seed and presentation tick only — never from simulation state — and
 * freezes under reduced motion.
 */

import { prefersReducedMotion } from '../../primitives/motion';
import { generatePalette } from '../../palette/generate';
import type { Palette } from '../../palette/types';
import type { CreatureVisualManifest } from '../creatures';

export interface CreatureDrawOptions {
  readonly x: number;
  readonly y: number;
  /** Bounding size in pixels (creature fits within `size × size`). */
  readonly size: number;
  readonly tick: number;
  readonly reducedMotion?: boolean;
}

function paletteFor(manifest: CreatureVisualManifest): Palette {
  return generatePalette(manifest.paletteSeed);
}

function featurePresent(manifest: CreatureVisualManifest, feature: string): boolean {
  return manifest.features.includes(feature);
}

function drawEyes(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  const eye = Math.max(2, r * 0.2);
  ctx.fillRect(cx - r * 0.42 - eye / 2, cy - r * 0.2, eye, eye);
  ctx.fillRect(cx + r * 0.42 - eye / 2, cy - r * 0.2, eye, eye);
}

function bobOffset(options: CreatureDrawOptions, manifest: CreatureVisualManifest): number {
  const reduced = options.reducedMotion ?? prefersReducedMotion();
  if (reduced) return 0;
  const phase = Math.floor(options.tick / 10) + (manifest.paletteSeed % 7);
  return Math.floor(phase / 2) % 2 === 0 ? 0 : -Math.max(1, options.size * 0.03);
}

/**
 * Draw one creature from its visual manifest. Deterministic per
 * `(manifest, size, tick)`; the same manifest always renders identically.
 */
export function drawRpgCreature(
  ctx: CanvasRenderingContext2D,
  manifest: CreatureVisualManifest,
  options: CreatureDrawOptions,
): void {
  const palette = paletteFor(manifest);
  const scale = Number.isFinite(manifest.proportions.bodyScale) ? manifest.proportions.bodyScale : 1;
  const r = (options.size / 2) * 0.8 * Math.min(1.25, Math.max(0.75, scale));
  const cx = options.x;
  const cy = options.y + bobOffset(options, manifest);

  // Ground shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(options.x, options.y + options.size * 0.36, r * 0.8, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  const outline = palette.outline;
  const base = palette.base;
  const accent = palette.accent;
  const feature = palette.feature;

  switch (manifest.bodyPlan) {
    case 'quadruped': {
      ctx.fillStyle = outline;
      ctx.fillRect(cx - r, cy - r * 0.45, r * 2, r * 0.9);
      ctx.fillStyle = base;
      ctx.fillRect(cx - r + 1, cy - r * 0.45 + 1, r * 2 - 2, r * 0.9 - 2);
      ctx.fillStyle = outline;
      for (const lx of [-r * 0.6, -r * 0.2, r * 0.25, r * 0.6]) {
        ctx.fillRect(cx + lx, cy + r * 0.35, r * 0.16, r * 0.5);
      }
      ctx.fillStyle = base;
      ctx.fillRect(cx + r * 0.55, cy - r * 0.95, r * 0.55, r * 0.55);
      drawEyes(ctx, cx + r * 0.8, cy - r * 0.75, r * 0.5, outline);
      if (featurePresent(manifest, 'horn')) {
        ctx.fillStyle = feature;
        ctx.fillRect(cx + r * 0.7, cy - r * 1.2, r * 0.12, r * 0.3);
      }
      if (featurePresent(manifest, 'tailFan')) {
        ctx.fillStyle = accent;
        ctx.fillRect(cx - r - r * 0.25, cy - r * 0.2, r * 0.25, r * 0.5);
      }
      if (featurePresent(manifest, 'mane')) {
        ctx.fillStyle = accent;
        ctx.fillRect(cx + r * 0.45, cy - r * 0.9, r * 0.15, r * 0.5);
      }
      break;
    }
    case 'avian': {
      ctx.fillStyle = outline;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.85, r * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.78, r * 0.66, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.fillRect(cx - r * 1.05, cy - r * 0.3, r * 0.4, r * 0.75);
      ctx.fillRect(cx + r * 0.65, cy - r * 0.3, r * 0.4, r * 0.75);
      ctx.fillStyle = feature;
      ctx.fillRect(cx - r * 0.08, cy - r * 0.15, r * 0.2, r * 0.35);
      drawEyes(ctx, cx, cy - r * 0.25, r * 0.8, outline);
      if (featurePresent(manifest, 'crest')) {
        ctx.fillStyle = feature;
        ctx.fillRect(cx - r * 0.1, cy - r * 0.95, r * 0.25, r * 0.3);
      }
      if (featurePresent(manifest, 'wingTips')) {
        ctx.fillStyle = outline;
        ctx.fillRect(cx - r * 1.05, cy + r * 0.4, r * 0.4, 2);
        ctx.fillRect(cx + r * 0.65, cy + r * 0.4, r * 0.4, 2);
      }
      break;
    }
    case 'sprout': {
      const stemW = Math.max(4, r * 0.55);
      ctx.fillStyle = outline;
      ctx.fillRect(cx - stemW / 2 - 1, cy - r * 0.1, stemW + 2, r * 1.0);
      ctx.fillStyle = base;
      ctx.fillRect(cx - stemW / 2, cy - r * 0.05, stemW, r * 0.9);
      ctx.fillStyle = feature;
      for (let leaf = 0; leaf < 3; leaf++) {
        const lx = cx - r * 0.5 + leaf * r * 0.5;
        ctx.beginPath();
        ctx.ellipse(lx, cy - r * 0.55, Math.max(3, r * 0.3), Math.max(2, r * 0.18), leaf % 2 === 0 ? -0.5 : 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      drawEyes(ctx, cx, cy + r * 0.25, r * 0.5, outline);
      if (featurePresent(manifest, 'bloom')) {
        ctx.fillStyle = accent;
        ctx.fillRect(cx - r * 0.12, cy - r * 1.05, r * 0.24, r * 0.24);
      }
      if (featurePresent(manifest, 'vineWraps')) {
        ctx.fillStyle = accent;
        ctx.fillRect(cx - r * 0.24, cy + r * 0.3, r * 0.48, 2);
      }
      break;
    }
    case 'shell': {
      ctx.fillStyle = outline;
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.1, r * 0.9, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.1, r * 0.82, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(1.5, r * 0.12);
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.1, r * 0.5, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.1, r * 0.22, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = feature;
      ctx.fillRect(cx - r * 0.4, cy + r * 0.25, r * 0.8, Math.max(3, r * 0.32));
      drawEyes(ctx, cx, cy + r * 0.32, r * 0.6, outline);
      if (featurePresent(manifest, 'spikes')) {
        ctx.fillStyle = outline;
        for (const sx of [-0.6, -0.2, 0.2, 0.6]) {
          ctx.fillRect(cx + sx * r - 1, cy - r * 0.95, Math.max(2, r * 0.1), Math.max(3, r * 0.2));
        }
      }
      break;
    }
    case 'blob':
    default: {
      ctx.fillStyle = outline;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.9, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.82, r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      drawEyes(ctx, cx, cy - r * 0.1, r * 0.9, outline);
      ctx.fillStyle = feature;
      ctx.fillRect(cx - r * 0.2, cy + r * 0.3, r * 0.4, Math.max(2, r * 0.14));
      if (featurePresent(manifest, 'antenna')) {
        ctx.fillStyle = outline;
        ctx.fillRect(cx - 1, cy - r * 0.95, 2, r * 0.3);
        ctx.fillStyle = accent;
        ctx.fillRect(cx - 2, cy - r * 1.05, 4, 4);
      }
      if (featurePresent(manifest, 'spots')) {
        ctx.fillStyle = accent;
        ctx.fillRect(cx - r * 0.55, cy + r * 0.1, r * 0.16, r * 0.16);
        ctx.fillRect(cx + r * 0.4, cy + r * 0.15, r * 0.14, r * 0.14);
      }
      if (featurePresent(manifest, 'cheekPuffs')) {
        ctx.fillStyle = feature;
        ctx.fillRect(cx - r * 0.75, cy - r * 0.05, r * 0.16, r * 0.16);
        ctx.fillRect(cx + r * 0.6, cy - r * 0.05, r * 0.16, r * 0.16);
      }
      break;
    }
  }
}
