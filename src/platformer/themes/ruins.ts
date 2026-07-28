import type { LevelRenderTheme } from '../level-theme';
import { drawRuinsDust } from '../atmosphere-recipes';

/** Warm masonry example theme. */
export const RUINS_LEVEL_THEME: Readonly<LevelRenderTheme> = {
  id: 'ruins',
  visualSeed: 0x5255494e,
  backgroundColor: '#171116',
  terrain: {
    tiles: {
      1: { id: 'ruins-stone', palette: { fill: '#735846', top: '#b49872', side: '#594033', outline: '#241b1c', detail: '#49352c' }, surfaceDetail: 'mortar' },
      2: { id: 'ruins-ledge', palette: { fill: '#6d6045', top: '#c0a96f', side: '#50462f', outline: '#241b1c', detail: '#453c2a' }, surfaceDetail: 'mortar' },
    },
    solid: { id: 'ruins-solid', palette: { fill: '#735846', top: '#b49872', side: '#594033', outline: '#241b1c', detail: '#49352c' }, surfaceDetail: 'mortar' },
    passthrough: { id: 'ruins-ledge', palette: { fill: '#6d6045', top: '#c0a96f', side: '#50462f', outline: '#241b1c' } },
    moving: { id: 'ruins-moving', palette: { fill: '#6c6871', top: '#b4adb8', side: '#48444d', outline: '#201e24', accent: '#d5a84f' }, surfaceDetail: 'rivets' },
    hazard: { id: 'ruins-hazard', palette: { fill: '#a33e35', top: '#e37a57', side: '#6d2928', outline: '#281719' } },
  },
  farBackground(ctx, frame) {
    ctx.fillStyle = '#241a24';
    const horizon = frame.view.height * 0.72;
    for (let x = 20; x < frame.view.width; x += 92) ctx.fillRect(x, horizon - 35, 18, 35);
  },
  backDecorations: drawRuinsDust,
};
