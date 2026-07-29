import { outlineRect } from '../../../src/primitives/outline-rect';
import type { EnemyState } from '../../../src/platformer/enemy/types';
import { CHARGER_HEIGHT, CHARGER_WIDTH } from './constants';
import type { ChargerPhase } from './charger-behavior';

export interface ChargerPalette {
  readonly body: string;
  readonly armor: string;
  readonly feature: string;
  readonly outline: string;
}

export const DEFAULT_CHARGER_PALETTE: Readonly<ChargerPalette> = {
  body: '#d45b3f',
  armor: '#7f3140',
  feature: '#ffe066',
  outline: '#1b1020',
};

export function drawCharger(
  ctx: CanvasRenderingContext2D,
  state: EnemyState,
  palette: ChargerPalette = DEFAULT_CHARGER_PALETTE,
): void {
  const phase: ChargerPhase =
    state.data.phase === 'windup' ||
    state.data.phase === 'dash' ||
    state.data.phase === 'recovery'
      ? state.data.phase
      : 'patrol';
  const dir =
    state.data.dashDir === 1 || state.data.dashDir === -1
      ? state.data.dashDir
      : state.facing;
  const windupTimer =
    typeof state.data.windupTimer === 'number' &&
    Number.isFinite(state.data.windupTimer)
      ? Math.max(0, Math.min(0.5, state.data.windupTimer))
      : 0.25;
  const compression =
    phase === 'windup'
      ? 0.66 + (windupTimer / 0.5) * 0.24
      : phase === 'recovery'
        ? 0.84
        : 1;
  const lean = phase === 'dash' ? 2.5 : phase === 'windup' ? -2 : 0;
  const slump = phase === 'recovery' ? 3 : 0;

  ctx.save();
  ctx.translate(
    state.x + CHARGER_WIDTH / 2 + lean * dir,
    state.y + CHARGER_HEIGHT,
  );
  ctx.scale(state.facing, 1);
  ctx.translate(0, slump);
  ctx.scale(1 / compression, compression);

  outlineRect(
    ctx,
    -6,
    -12,
    12,
    10,
    palette.body,
    palette.outline,
  );
  ctx.fillStyle = palette.armor;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-5, -12);
  ctx.lineTo(0, -16);
  ctx.lineTo(5, -12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = palette.feature;
  ctx.fillRect(2.5, -9.5, 2, 2);

  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-4, -2);
  ctx.lineTo(-5.5, 0);
  ctx.moveTo(4, -2);
  ctx.lineTo(5.5, 0);
  ctx.stroke();

  if (phase === 'recovery') {
    ctx.fillStyle = palette.feature;
    ctx.fillRect(-8, -16, 2, 2);
    ctx.fillRect(7, -18, 2, 2);
  }
  ctx.restore();
}
