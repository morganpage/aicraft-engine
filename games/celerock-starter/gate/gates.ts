/**
 * The §13 visual gate manifest — pre-armed, on purpose.
 *
 * A real run satisfied every §13 gate with `missingShotManifest(dir, [])`: the
 * exact function the brief names, called correctly, requiring nothing. That is
 * why this list ships populated rather than as an empty array for the build to
 * fill in. Emptying it is now an edit to a committed file, not a decision about
 * what to type — and `git diff gate/` finds it.
 *
 * These are the eighteen captures the REFERENCE build actually produced, not a
 * synthesized one-per-gate list. §13 has fourteen gates but they do not map 1:1
 * to captures (gate 4 is a manual playthrough, gate 6 is a stopwatch check), so
 * an invented manifest would be one that has never passed — and a probe that
 * has never passed is worse than no probe (§12.9).
 *
 * Captures may GROW. Never shrink.
 */
export const GATE_SHOTS: readonly string[] = [
  '01-menu.png',
  '02-titlecard.png',
  '03-walk.png',
  '04-jump.png',
  '05-dash.png',
  '06-grab.png',
  '07-climb.png',
  '08-slide-mid.png',
  '09-next-room.png',
  '10-deathflash.png',
  '11-respawnflash.png',
  '12-summit.png',
  '13-summit-held.png',
  '14-back-to-menu.png',
  '15-berry.png',
  '16-pause.png',
  '16b-pause-quit-selected.png',
  '17-hotreload.png',
];

/** Where the QA harness writes captures. */
export const SHOTS_DIR = '.qa/shots';
