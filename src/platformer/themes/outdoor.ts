import type { LevelRenderTheme } from '../level-theme';

/** Grass-topped earth for open-air scenes. */
export const OUTDOOR_LEVEL_THEME: Readonly<LevelRenderTheme> = {
  id: 'outdoor',
  visualSeed: 0x4f555444,
  backgroundColor: '#1c3044',
  terrain: {
    tiles: {
      1: {
        id: 'outdoor-earth',
        palette: {
          fill: '#765035',
          top: '#6f9f46',
          side: '#422c20',
          outline: '#251c17',
          detail: '#345b2d',
          accent: '#9bc764',
        },
        topThickness: 4,
        sideDepth: 5,
        cornerSize: 3,
        edgeDetail: 'grass',
        edgeDensity: 0.88,
      },
      2: {
        id: 'outdoor-shelf',
        palette: {
          fill: '#765035',
          top: '#78a94c',
          side: '#422c20',
          outline: '#251c17',
          detail: '#345b2d',
          accent: '#a5cf6c',
        },
        topThickness: 4,
        sideDepth: 5,
        cornerSize: 3,
        edgeDetail: 'grass',
        edgeDensity: 0.84,
      },
    },
    solid: {
      id: 'outdoor-solid',
      palette: {
        fill: '#765035',
        top: '#6f9f46',
        side: '#422c20',
        outline: '#251c17',
        accent: '#9bc764',
      },
      topThickness: 4,
      sideDepth: 5,
    },
    passthrough: {
      id: 'outdoor-shelf',
      palette: {
        fill: '#765035',
        top: '#78a94c',
        side: '#422c20',
        outline: '#251c17',
      },
      topThickness: 4,
      sideDepth: 5,
    },
    moving: {
      id: 'outdoor-moving',
      palette: {
        fill: '#6f5138',
        top: '#9b7650',
        side: '#453122',
        outline: '#241b16',
        accent: '#c69a5b',
      },
    },
    hazard: {
      id: 'outdoor-hazard',
      palette: {
        fill: '#9f4937',
        top: '#db7651',
        side: '#633026',
        outline: '#2c1b18',
      },
    },
  },
  farBackground(ctx, frame) {
    const horizon = frame.view.height * 0.72;
    ctx.fillStyle = '#29494a';
    ctx.beginPath();
    ctx.moveTo(0, frame.view.height);
    ctx.lineTo(0, horizon);
    for (let x = 0; x <= frame.view.width + 80; x += 80) {
      ctx.lineTo(x + 40, horizon - (x % 160 === 0 ? 34 : 20));
      ctx.lineTo(x + 80, horizon);
    }
    ctx.lineTo(frame.view.width, frame.view.height);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#385846';
    ctx.fillRect(0, horizon + 18, frame.view.width, frame.view.height - horizon);
  },
};
