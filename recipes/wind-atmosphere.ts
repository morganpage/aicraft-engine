/**
 * The wind — one voice.
 *
 * Radical simplification (post-listen #6) after the multi-voice recipe
 * glitched in play: three voices each taking peak AND frequency retargets
 * every tick is ~360 AudioParam events a second of cancel/re-anchor churn,
 * and a Q-10 whistle rings on the one-second looping noise buffer at the
 * loop seam. So this is ONE voice doing the one thing that reads as wind:
 *
 *   pink noise → bandpass whose center, gain, and Q ride the tuning.
 *
 * A bandpass, not a lowpass, on purpose: a lowpass passes ALL of pink's deep
 * energy untouched (30–100 Hz reads as rumble), while the bandpass's low
 * skirt is a built-in low-cut whose steepness is the Q knob.
 *
 *   gust  = one warped sine PER GUST CYCLE, with each cycle's period drawn
 *           from a seeded rng (GUST_JITTER) — gusts arrive at uneven,
 *           non-repeating intervals, because a metronomic gust reads as
 *           mechanical however pleasant its shape
 *   level = intensity × gust — the lab's level meter (presentation only)
 *   snow  = right-to-left push ∝ intensity × gust³,
 *           sway amplitude × (1 + gust · MAX_SWAY_GAIN)
 *   voice = peak ∝ intensity × gust^1.5, center lo → hi with the gust
 *
 * The SNOW keys on the normalized gust, not on `level` — the same lesson
 * the audio bed taught (§post-listen #1): keying movement to
 * intensity-squashed `level` crushes it to nothing at light weather
 * (0.35³ ≈ 0.04, cubed again ≈ imperceptible), and snow that never
 * visibly reacts to audible gusts reads as broken, not calm. Gusts move
 * the snow at EVERY intensity; intensity scales how far they move it.
 *
 * That fix repaired the RATIO (gusts swing the push ~6× lull→peak at any
 * tuning) but not the SCALE, and the eye needs absolute movement (§post-
 * listen #14): at MAX_DRIFT 0.25 the shipped weather's peak push — 0.25 ×
 * intensity 0.35 × blended-gust-peak³ 0.4³ — was ~0.006 vw/s ≈ 7 px/s,
 * lost under a ±50 px sway while the ear clearly heard the swell. The
 * coefficient is now calibrated against the SHIPPED weather, not the
 * storm: 1.8 × 0.35 × 0.4³ ≈ 0.04 vw/s, about the near flakes' fall
 * speed — a ~45° slant at gust peak against near-straight lull.
 *
 * Glitch hygiene, deliberately conservative:
 *   - param pushes are THROTTLED to every {@link AUDIO_UPDATE_TICKS} tick
 *     (~7.5 Hz). The gust is sub-hertz, so nothing is lost audibly, but the
 *     param churn — the prime glitch suspect — drops 24×.
 *   - no flutter (fast AM), no whistle (high Q), no second gust sine. Each
 *     was a moving part; none survived simplification.
 *
 * The tuning workflow survives from the multi-voice days because it was the
 * one thing that worked: DYNAMICS_AMOUNT 0 freezes the weather at
 * DYNAMICS_HOLD — tune the steady sound first, then raise the amount and
 * shape the movement around it. Every number lives in {@link WIND_TUNING},
 * mutable at runtime for the wind lab; the values here are the defaults.
 *
 * Determinism: the gust shape is a pure function of cycle phase, and the
 * period draws come from a SEEDED rng — no wall clock, no Math.random — so
 * the same run always has the same weather, and two winds stepped
 * identically blow identically.
 */
import { mulberry32, type AudioAdapter, type NoiseLoopHandle } from 'aicraft-engine';

/**
 * What the wind hands the sky — the entire interface between the weather
 * simulation and whatever renders it. Structurally identical to
 * `backdrop-sky.ts`'s `BackdropWind` ON PURPOSE, so the two recipes can be
 * copied independently and still fit together without either importing the
 * other. Two numbers cross; nothing else does.
 */
export interface SnowWind {
  /** Integrated wind offset in viewport widths; NEGATIVE = right-to-left. */
  readonly driftX: number;
  /** Sway amplitude multiplier, 1 = still air. Gusts deepen the wobble. */
  readonly swayGain: number;
}

/**
 * AudioParam pushes happen on every Nth tick, not every tick. 8 ≈ 7.5 Hz at
 * the fixed 60 Hz step — far above the gust's sub-hertz movement, far below
 * the per-tick churn that glitched.
 */
const AUDIO_UPDATE_TICKS = 8;

/**
 * The tunable weather. Mutable ON PURPOSE — the wind lab writes to it live;
 * the game only ever reads it. These values are the shipped defaults.
 */
export interface WindTuning {
  /**
   * Gust period (seconds): the CENTER of each cycle's draw — see
   * GUST_JITTER for the spread around it.
   */
  GUST_PERIOD_S: number;
  /**
   * Gust jitter: 0 is a metronome (every gust exactly GUST_PERIOD_S), 1
   * draws each cycle uniformly in [0.5×, 1.5×] the period, so the spacing
   * between gusts never settles into a rhythm.
   */
  GUST_JITTER: number;
  /** Gust floor: the swell never falls below this fraction of its peak. */
  GUST_FLOOR: number;
  /** Gust warp: >1 narrows peaks and deepens valleys — gusts as events. */
  GUST_WARP: number;
  /**
   * How much the weather moves: 0 freezes it at DYNAMICS_HOLD — a perfectly
   * steady wind for tuning by ear — and 1 is full gusting. Tune the static
   * sound first, then raise the amount and shape the gusts around it.
   */
  DYNAMICS_AMOUNT: number;
  /**
   * The gust level the weather holds while frozen (and the point dynamics
   * moves around at partial amounts). The lab's "steady wind" strength.
   */
  DYNAMICS_HOLD: number;
  /** The voice's peak at intensity 1, gust 1. */
  WIND_PEAK: number;
  /** The bandpass center at lull → at gust peak. */
  WIND_FILTER_HZ: readonly [number, number];
  /**
   * The bandpass Q: higher narrows the band — steepening the low skirt
   * (pink's deep rumble) and tightening the top at once. ~1 is broad and
   * warm; the resonant, hollow character arrives past ~3.
   */
  WIND_Q: number;
  /**
   * Snow push at gust 1, intensity 1, in viewport-widths per second, LEFTWARD.
   * Calibrated against the SHIPPED weather (§post-listen #14), whose gust
   * tops out at 0.4 under intensity 0.35: there 1.8 × 0.35 × 0.4³ ≈ 0.04
   * vw/s — the near flakes' fall speed, i.e. a clearly readable slant. At
   * the old 0.25 the same weather pushed ~0.006 vw/s ≈ 7 px/s: gusts the
   * ear heard and the eye never saw. A full storm (intensity 1, gust 1)
   * scuds snow at the full 1.8 vw/s — sideways weather.
   */
  MAX_DRIFT: number;
  /**
   * Sway amplitude multiplier at gust 1 — gusts deepen the flakes' wobble.
   * Keyed on the normalized gust, so the agitation is visible at every
   * intensity, like the rest of the snow coupling.
   */
  MAX_SWAY_GAIN: number;
}

/** The shipped weather — tuned by ear in the wind lab (§post-listen #12). */
export const WIND_TUNING: WindTuning = {
  GUST_PERIOD_S: 9,
  GUST_JITTER: 1,
  GUST_FLOOR: 0.11,
  GUST_WARP: 3,
  DYNAMICS_AMOUNT: 0.2,
  DYNAMICS_HOLD: 0.25,
  WIND_PEAK: 0.3,
  WIND_FILTER_HZ: [190, 1760],
  WIND_Q: 2.15,
  MAX_DRIFT: 1.8,
  MAX_SWAY_GAIN: 4,
};

/** Phase offset (radians) so a fresh boot starts mid-swell, not at zero. */
const GUST_PHASE = 1.7;

/** The wind. Step it every fixed tick; read `level`/`driftX` for presentation. */
export interface Wind {
  /**
   * The tuning this instance reads. Defaults to {@link WIND_TUNING}; pass your
   * own to `createWind` to run two winds at different weather, or to let a
   * tuning lab mutate one live while the game reads another.
   */
  readonly tuning: WindTuning;
  /** 0 still air .. 1 storm. The one knob — loudness of the audio, strength of the snow. */
  intensity: number;
  /** Instantaneous gust level in [0, 1]: `intensity` shaped by the swell. Drives the SNOW. */
  level: number;
  /** The normalized swell in [GUST_FLOOR, 1] — drives the VOICE at full depth at any intensity. */
  gust: number;
  /**
   * Integrated wind push in viewport widths; NEGATIVE = right-to-left. Fed
   * straight to the backdrop, which wraps positions anyway — the value is
   * deliberately not wrapped here so it stays monotone and inspectable.
   */
  driftX: number;
  /** Seconds of weather so far — the gust envelope's only input. */
  gustClock: number;
  /** Seconds into the current gust cycle. */
  gustPhase: number;
  /** The current cycle's drawn period — GUST_PERIOD_S × a jitter factor. */
  gustPeriod: number;
  /**
   * Seeded period draws — the same weather every run, and identical across
   * wind instances stepped alike.
   */
  readonly gustRng: () => number;
  /** Tick counter for the audio-param throttle. */
  audioTick: number;
  /** The adapter the voice runs through. */
  readonly audio: AudioAdapter;
  bed: NoiseLoopHandle | null;
}

/** What the audio graph should be doing right now, as pure data. */
export interface WindVoiceTargets {
  readonly peak: number;
  readonly hz: number;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** Interpolate a `[at gust 0, at gust 1]` pair. */
function band(range: readonly [number, number], gust: number): number {
  return range[0] + (range[1] - range[0]) * gust;
}

/**
 * The shape of ONE gust cycle in [GUST_FLOOR, 1]: a slow sine into 0..1,
 * warped toward distinct events (§GUST_WARP), then biased off the floor.
 * `phase` is the fraction through the cycle, 0..1 — the CYCLE LENGTH is a
 * separate, jittered draw (§GUST_JITTER), so the weather never repeats.
 */
export function gustEnvelope(phase: number, tuning: WindTuning = WIND_TUNING): number {
  const swell = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2 + GUST_PHASE);
  return tuning.GUST_FLOOR + (1 - tuning.GUST_FLOOR) * swell ** tuning.GUST_WARP;
}

/** Draw the next cycle's period: the center ± jitter-scaled spread. */
function nextGustPeriod(rng: () => number, tuning: WindTuning): number {
  const spread = tuning.GUST_JITTER * 0.5;
  return Math.max(1, tuning.GUST_PERIOD_S * (1 + (rng() * 2 - 1) * spread));
}

/**
 * The audio targets for a wind's current state — the recipe as a pure
 * function, testable without a browser. Peak rises as gust^1.5 so the bed
 * swells clearly without pumping; the cutoff opens with the gust so it
 * brightens as it loudens.
 */
export function windVoices(wind: Readonly<Wind>): WindVoiceTargets {
  const gust = wind.gust;
  return {
    peak: wind.tuning.WIND_PEAK * wind.intensity * gust ** 1.5,
    hz: band(wind.tuning.WIND_FILTER_HZ, gust),
  };
}

/**
 * Build the wind. The voice does NOT start here — pre-gesture the adapter is
 * locked and {@link stepWind} starts it on the first tick after unlock.
 */
export function createWind(audio: AudioAdapter, intensity: number, tuning: WindTuning = WIND_TUNING): Wind {
  return {
    tuning,
    intensity: clamp01(intensity),
    level: 0,
    gust: 0,
    driftX: 0,
    gustClock: 0,
    gustPhase: 0,
    gustPeriod: tuning.GUST_PERIOD_S,
    gustRng: mulberry32(0x9e57),
    audioTick: 0,
    audio,
    bed: null,
  };
}

/**
 * Advance one fixed step: swell the level, push the snow, track the audio.
 * Runs in every game state (menu, hit-stop, summit) — the wind is the
 * mountain's ambience, not a gameplay system, and it must not stutter.
 */
export function stepWind(wind: Wind, dt: number): void {
  wind.gustClock += dt;
  wind.audioTick += 1;
  // Advance the cycle; on wrap, draw the NEXT cycle's period from the seeded
  // rng — the jitter that keeps gust spacing from settling into a rhythm.
  wind.gustPhase += dt;
  if (wind.gustPhase >= wind.gustPeriod) {
    wind.gustPhase -= wind.gustPeriod;
    wind.gustPeriod = nextGustPeriod(wind.gustRng, wind.tuning);
  }
  // The whole dynamics system in one line: the live envelope blended toward
  // the held point by DYNAMICS_AMOUNT. 0 → a constant steady wind (tune the
  // bed by ear with everything else out of the way); 1 → the untouched
  // envelope. Everything downstream reads the blended value.
  wind.gust = clamp01(
    wind.tuning.DYNAMICS_HOLD
    + (gustEnvelope(wind.gustPhase / wind.gustPeriod, wind.tuning) - wind.tuning.DYNAMICS_HOLD) * wind.tuning.DYNAMICS_AMOUNT,
  );
  wind.level = clamp01(wind.intensity * wind.gust);
  // The snow keys on the GUST (full-range at any intensity); intensity only
  // scales how far a gust moves it — see the header's snow note.
  wind.driftX -= wind.tuning.MAX_DRIFT * wind.intensity * wind.gust ** 3 * dt;
  startVoice(wind);
  // Throttled: setPeak/setFrequency ramp internally, and a sub-hertz gust
  // needs no 60 Hz retargets — this is the glitch hygiene (§header).
  if (wind.audioTick % AUDIO_UPDATE_TICKS !== 0) return;
  const voices = windVoices(wind);
  wind.bed?.setPeak(voices.peak);
  wind.bed?.setFrequency(voices.hz);
  wind.bed?.setQ(wind.tuning.WIND_Q);
}

/**
 * Start the voice once, on the first tick the adapter is unlocked. An inert
 * (pre-unlock) handle reports `isPlaying() === false` forever, so the guard
 * also reads as "not started yet" — and would restart the voice if it were
 * ever stopped, which nothing currently does.
 */
function startVoice(wind: Wind): void {
  if (!wind.audio.isUnlocked()) return;
  if (wind.bed?.isPlaying()) return;
  const voices = windVoices(wind);
  wind.bed = wind.audio.startNoiseLoop('bandpass', voices.hz, voices.peak, { noise: 'pink', q: wind.tuning.WIND_Q });
}

/**
 * The wind as the backdrop's snowfall sees it — the single handoff point
 * between the weather simulation and the sky that renders it.
 */
export function snowWind(wind: Readonly<Wind>): SnowWind {
  return {
    driftX: wind.driftX,
    swayGain: 1 + wind.gust * wind.tuning.MAX_SWAY_GAIN,
  };
}
