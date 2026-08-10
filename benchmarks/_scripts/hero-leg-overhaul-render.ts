import { createCanvas } from 'canvas';
import { writeFileSync } from 'node:fs';
import {
  deriveHeroConfig,
  createHeroFrameState,
  stepHero,
  drawSlimeKnight,
  HERO_CANVAS_SIZE,
  HERO_GROUND_Y,
} from '../../showcase/helpers/slime-knight';

function renderLegOverhaul() {
  const seed = 98724;
  const config = deriveHeroConfig(seed);
  const DT = 1 / 60;

  console.log('Simulating frames for the 9 panels...');

  // 1. Idle (breath mid-stretch) — tick 40
  let state1 = createHeroFrameState(config);
  for (let i = 0; i < 40; i++) {
    state1 = stepHero(state1, DT, { walkDx: 0, facing: 1 });
  }

  // 2. Idle (breath mid-squash) — tick 56
  let state2 = createHeroFrameState(config);
  for (let i = 0; i < 56; i++) {
    state2 = stepHero(state2, DT, { walkDx: 0, facing: 1 });
  }

  // 3. Walk right, midstride (legs crossed) — tick 44
  let state3 = createHeroFrameState(config);
  for (let i = 0; i < 44; i++) {
    state3 = stepHero(state3, DT, { walkDx: 1.5, facing: 1 });
  }

  // 4. Walk right, contact (feet together) — tick 22
  let state4 = createHeroFrameState(config);
  for (let i = 0; i < 22; i++) {
    state4 = stepHero(state4, DT, { walkDx: 1.5, facing: 1 });
  }

  // 5. Walk left, midstride — tick 44
  let state5 = createHeroFrameState(config);
  for (let i = 0; i < 44; i++) {
    state5 = stepHero(state5, DT, { walkDx: -1.5, facing: -1 });
  }

  // 6. Forward foot close-up — same as Panel 3 (tick 44) but zoomed 3x on feet
  const state6 = state3;

  // 7. Jump apex — frame 20 of jump simulation
  let state7 = createHeroFrameState(config);
  state7 = stepHero(state7, DT, { jumpPressed: true, jumpHeld: true });
  for (let i = 1; i <= 20; i++) {
    state7 = stepHero(state7, DT, { jumpHeld: true });
  }

  // 8. Jump landing squash — frame 38 of jump simulation
  let state8 = createHeroFrameState(config);
  state8 = stepHero(state8, DT, { jumpPressed: true, jumpHeld: true });
  for (let i = 1; i <= 38; i++) {
    state8 = stepHero(state8, DT, { jumpHeld: true });
  }

  // 9. Jump recovery — frame 45 of jump simulation
  let state9 = createHeroFrameState(config);
  state9 = stepHero(state9, DT, { jumpPressed: true, jumpHeld: true });
  for (let i = 1; i <= 45; i++) {
    state9 = stepHero(state9, DT, { jumpHeld: true });
  }

  // Setup 3x3 composite canvas
  const headerHeight = 80;
  const panelSize = HERO_CANVAS_SIZE;
  const compositeWidth = panelSize * 3;
  const compositeHeight = panelSize * 3 + headerHeight;

  const canvas = createCanvas(compositeWidth, compositeHeight);
  const ctx = canvas.getContext('2d');

  // 1. Draw Header
  ctx.fillStyle = '#0f172a'; // Slate-900
  ctx.fillRect(0, 0, compositeWidth, headerHeight);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('Hero Leg Overhaul Validation (Seed: 98724)', 24, 38);

  ctx.fillStyle = '#94a3b8'; // Slate-400
  ctx.font = '13px sans-serif';
  ctx.fillText('Verifying hip attachment, co-located hips, crossing walk cycle, forward foot offset, and landing squash.', 24, 60);

  // Define the 9 panels
  const panels = [
    {
      state: state1,
      tick: 40,
      label: '1. Idle (Breath Stretch)',
      subLabel: 'tick: 40 | scaleY: 1.036 | knees bent',
      zoom: 1,
    },
    {
      state: state2,
      tick: 56,
      label: '2. Idle (Breath Squash)',
      subLabel: 'tick: 56 | scaleY: 0.964 | knees extended',
      zoom: 1,
    },
    {
      state: state3,
      tick: 44,
      label: '3. Walk Right (Midstride)',
      subLabel: 'tick: 44 | legs crossed | forward shin on top',
      zoom: 1,
    },
    {
      state: state4,
      tick: 22,
      label: '4. Walk Right (Contact)',
      subLabel: 'tick: 22 | feet together | passing-through',
      zoom: 1,
    },
    {
      state: state5,
      tick: 44,
      label: '5. Walk Left (Midstride)',
      subLabel: 'tick: 44 | mirrored crossing | forward shin on top',
      zoom: 1,
    },
    {
      state: state6,
      tick: 44,
      label: '6. Forward Foot Close-up',
      subLabel: '3x zoom | shoe forward of ankle | toe points right',
      zoom: 3,
    },
    {
      state: state7,
      tick: 20,
      label: '7. Jump Apex',
      subLabel: 'frame: 20 | airborne | legs tucked',
      zoom: 1,
    },
    {
      state: state8,
      tick: 38,
      label: '8. Jump Landing Squash',
      subLabel: 'frame: 38 | scaleY: 0.71 | landing impact',
      zoom: 1,
    },
    {
      state: state9,
      tick: 45,
      label: '9. Jump Recovery',
      subLabel: 'frame: 45 | scaleY: 0.96 | recovering to rest',
      zoom: 1,
    },
  ];

  panels.forEach((panel, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const xOffset = col * panelSize;
    const yOffset = row * panelSize + headerHeight;

    ctx.save();
    ctx.translate(xOffset, yOffset);

    // Clip to panel bounds to prevent zoom spillover
    ctx.beginPath();
    ctx.rect(0, 0, panelSize, panelSize);
    ctx.clip();

    // 1. Background
    ctx.fillStyle = '#1e293b'; // Slate-800 dark background
    ctx.fillRect(0, 0, panelSize, panelSize);

    // 2. Ground line
    const groundY = HERO_GROUND_Y;
    ctx.strokeStyle = '#475569'; // Slate-600
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(panelSize, groundY);
    ctx.stroke();

    // 3. Shadow (tracks frame.x)
    // We only draw shadow if the character is not zoomed in, or we can scale it with zoom
    if (panel.zoom === 1) {
      const shadowCx = panelSize / 2 + panel.state.x;
      const shadowCy = groundY + 2;
      ctx.save();
      ctx.fillStyle = '#010000'; // Outline color
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.ellipse(shadowCx, shadowCy, 56, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 4. Character (with optional zoom)
    ctx.save();
    if (panel.zoom > 1) {
      // Zoom centered on the feet, taking character's X offset into account
      const charCx = panelSize / 2 + panel.state.x;
      ctx.translate(panelSize / 2, panelSize / 2);
      ctx.scale(panel.zoom, panel.zoom);
      ctx.translate(-charCx, -groundY + 20); // offset slightly to center the feet nicely
    }
    drawSlimeKnight(ctx as any, panel.state, panel.tick);
    ctx.restore();

    // 5. Label
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(panel.label, 16, 30);

    // 6. Sub-label
    ctx.fillStyle = '#94a3b8'; // Slate-400
    ctx.font = '11px sans-serif';
    ctx.fillText(panel.subLabel, 16, 48);

    ctx.restore();

    // Draw grid lines
    ctx.strokeStyle = '#334155'; // Slate-700
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(xOffset, yOffset, panelSize, panelSize);
    ctx.stroke();
  });

  // Save composite image
  const destPath = 'benchmarks/hero-leg-overhaul.png';
  writeFileSync(destPath, canvas.toBuffer('image/png'));
  console.log(`Saved composite leg overhaul validation PNG to ${destPath}`);
}

renderLegOverhaul();
