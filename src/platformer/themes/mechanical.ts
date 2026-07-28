import type { LevelRenderTheme } from '../level-theme';
import { drawMechanicalSparks } from '../atmosphere-recipes';

/** Steel plate example theme. */
export const MECHANICAL_LEVEL_THEME: Readonly<LevelRenderTheme> = {
  id: 'mechanical',
  visualSeed: 0x4d454348,
  backgroundColor: '#10171b',
  terrain: {
    tiles: {
      1: { id: 'mechanical-plate', palette: { fill: '#52616b', top: '#9dabb0', side: '#36434d', outline: '#172027', detail: '#26333b', accent: '#d7a84b' }, edgeDetail: 'beveled', edgeDensity: 0.3 },
      2: { id: 'mechanical-rail', palette: { fill: '#625d54', top: '#c4b276', side: '#413d38', outline: '#172027', detail: '#302d29', accent: '#e1b94f' }, edgeDetail: 'beveled', edgeDensity: 0.25 },
    },
    solid: { id: 'mechanical-solid', palette: { fill: '#52616b', top: '#9dabb0', side: '#36434d', outline: '#172027', detail: '#26333b', accent: '#d7a84b' } },
    passthrough: { id: 'mechanical-rail', palette: { fill: '#625d54', top: '#c4b276', side: '#413d38', outline: '#172027', accent: '#e1b94f' } },
    moving: { id: 'mechanical-moving', palette: { fill: '#657985', top: '#b6c4c8', side: '#40515b', outline: '#10181d', detail: '#26333b', accent: '#f0b83f' } },
    hazard: { id: 'mechanical-hazard', palette: { fill: '#bb4d38', top: '#f48a53', side: '#743026', outline: '#241716', accent: '#f2c84b' } },
  },
  farBackground(ctx, frame) {
    ctx.strokeStyle = '#26343a';
    ctx.lineWidth = 6;
    for (let y = 48; y < frame.view.height; y += 96) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(frame.view.width, y); ctx.stroke();
    }
  },
  backDecorations: drawMechanicalSparks,
};
