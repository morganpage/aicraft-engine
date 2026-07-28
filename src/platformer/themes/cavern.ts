import type { LevelRenderTheme } from '../level-theme';
import { drawCavernDrips } from '../atmosphere-recipes';

/** Cool rock-and-vein example theme. */
export const CAVERN_LEVEL_THEME: Readonly<LevelRenderTheme> = {
  id: 'cavern',
  visualSeed: 0x43415645,
  backgroundColor: '#12101a',
  terrain: {
    tiles: {
      1: { id: 'cavern-rock', palette: { fill: '#51445d', top: '#8a7891', side: '#3b3047', outline: '#1c1724', detail: '#32283d', accent: '#bca8cb' }, edgeDetail: 'rocky', edgeDensity: 0.76 },
      2: { id: 'cavern-shelf', palette: { fill: '#60506b', top: '#aa91b0', side: '#45374f', outline: '#1c1724', detail: '#392d43' }, edgeDetail: 'rocky', edgeDensity: 0.66 },
    },
    solid: { id: 'cavern-solid', palette: { fill: '#51445d', top: '#8a7891', side: '#3b3047', outline: '#1c1724', detail: '#32283d' } },
    passthrough: { id: 'cavern-shelf', palette: { fill: '#60506b', top: '#aa91b0', side: '#45374f', outline: '#1c1724' } },
    moving: { id: 'cavern-moving', palette: { fill: '#52616b', top: '#9dabb0', side: '#36434d', outline: '#172027', accent: '#d7a84b' } },
    hazard: { id: 'cavern-hazard', palette: { fill: '#963c50', top: '#e06b79', side: '#632638', outline: '#21131b' } },
  },
  farBackground(ctx, frame) {
    ctx.fillStyle = '#201b2b';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let x = 0; x <= frame.view.width; x += 48) ctx.lineTo(x, 12 + (x % 96 === 0 ? 28 : 8));
    ctx.lineTo(frame.view.width, 0);
    ctx.fill();
  },
  backDecorations: drawCavernDrips,
};
