/**
 * Dev-time plausibility guards for particle authoring — the units trap, made
 * loud.
 *
 * The particle pillar is tick-unit, and documentation has NOT saved two
 * shipped builds from the same defect: speeds authored in px/s against the
 * px/tick solver (60× too fast), or a seconds `dt` passed to the tick-unit
 * `advance` (60× too slow — see `src/particles/seconds.ts`). A authored
 * `speed: 14` looks perfectly reasonable to a seconds-thinking author and is
 * 840 px/s at 60 Hz. These guards cannot catch the mistake at the type level
 * (a number is a number), so they catch it at RUN TIME: a spawn speed or life
 * whose magnitude is implausible for a one-screen-room effect warns ONCE per
 * process, naming the likely unit error. Warn, not throw — a legitimate
 * large-scale scene (a showcase panning a whole level) may author faster
 * particles than a room-scale game; the guard starts the conversation, it does
 * not end it.
 */

/**
 * Speeds above this (px/tick) warn: at 60 Hz it is 720 px/s — a one-screen
 * room (320–640 px) crossed in under half a second, faster than any tuned
 * effect in the engine (the death shatter peaks near ~2.6). A px/s-authored
 * speed (`14`, `40`, `80`) trips it immediately. Exported so a game rendering
 * genuinely huge worlds can document its own ceiling next to the import.
 */
export const IMPLAUSIBLE_SPEED_PX_PER_TICK = 12;

/**
 * Lives above this (ticks) warn: 600 ticks is 10 s at 60 Hz — longer than any
 * room-scale effect survives culling in practice, and the classic signature of
 * a seconds-valued life (or a seconds dt fed to the tick-unit `advance`).
 */
export const IMPLAUSIBLE_LIFE_TICKS = 600;

let speedWarned = false;
let lifeWarned = false;

function warnOnce(flag: 'speed' | 'life', message: string): void {
  if (flag === 'speed' ? speedWarned : lifeWarned) return;
  if (flag === 'speed') speedWarned = true;
  else lifeWarned = true;
  // Defensive host access: no console (SSR/worker stripped) → silent no-op.
  (typeof console !== 'undefined' ? console : undefined)?.warn?.(message);
}

/** Warn once when a spawn speed is implausibly fast for a tick-unit effect. */
export function warnImplausibleSpeed(where: string, speed: number): void {
  if (!Number.isFinite(speed) || speed <= IMPLAUSIBLE_SPEED_PX_PER_TICK) return;
  warnOnce(
    'speed',
    `${where}: particle speed ${speed} px/tick is over ${IMPLAUSIBLE_SPEED_PX_PER_TICK} ` +
      `(≈ ${IMPLAUSIBLE_SPEED_PX_PER_TICK * 60} px/s at 60 Hz). The particle pillar is TICK-unit — ` +
      `speeds are px per tick, not px per second. If you authored this value in px/s, divide by 60 ` +
      `(or use the tuned effect presets: DASH_TRAIL_EFFECT, LANDING_DUST_EFFECT, …).`,
  );
}

/** Warn once when a spawn life is implausibly long for a tick-unit effect. */
export function warnImplausibleLife(where: string, life: number): void {
  if (!Number.isFinite(life) || life <= IMPLAUSIBLE_LIFE_TICKS) return;
  warnOnce(
    'life',
    `${where}: particle life ${life} ticks is over ${IMPLAUSIBLE_LIFE_TICKS} (10 s at 60 Hz). ` +
      `The particle pillar is TICK-unit — life is ticks, not seconds. If you authored this value in ` +
      `seconds, multiply by 60.`,
  );
}
