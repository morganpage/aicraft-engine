#!/usr/bin/env bash
# celerock.md §12.9 — Required Wiring, and §12.10 — Gate Substance.
#
#   ./check.sh --stage N   the §14 Stage-N gate: only what Stage N must have wired
#   ./check.sh             every stage's wiring (equivalent to --stage 7)
#   ./check.sh --final     all wiring + §12.10 gate substance — the ship gate
#
# WHY THE STAGE TABLE EXISTS. §12.9 requires all twelve recipes imported, but
# Stage 1 legitimately needs three. A gate that demands all twelve from the
# first boundary is red from Stage 1 through Stage 6, and a check that is always
# red teaches the run to ignore it (§12.10.4). Staged, the gate is GREEN when
# the current stage's work is done and RED the moment the next stage opens —
# so red always means "there is work in front of you right now".
#
# Prints nothing and exits 0 when clean. Every failure line is a FAILED STAGE.
#
# §12.8 (forbidden patterns) is the other half and runs as a test:
#   scanForbiddenIdentifiers('src') === []   — recipes/game-test-harness.ts

set -uo pipefail

STAGE=7
FINAL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --final) FINAL=1; STAGE=7 ;;
    --stage) STAGE="${2:-7}"; shift ;;
    --stage=*) STAGE="${1#*=}" ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
case "$STAGE" in
  [1-7]) ;;
  *) echo "--stage must be 1-7 (got '$STAGE')" >&2; exit 2 ;;
esac

fail=0
say() { echo "  $*"; fail=$((fail + 1)); }

# ---------------------------------------------------------------------------
# The §14 stage tables. A stage requires everything from every earlier stage.
# particle-system is the pre-0.21.0 back-port and is never required.
# ldtk-entity-tile-art is capability-gated on the LEVEL: required from stage 4
# only when public/*.ldtk actually defines a FallingBlock entity (see below).
# ---------------------------------------------------------------------------

recipes_for_stage() {
  local s=$1
  [ "$s" -ge 1 ] && echo "fixed-tick-game ldtk-draw-pipeline ldtk-hot-reload-plugin"
  [ "$s" -ge 2 ] && echo "platformer-input sprite-sheet-boot image-decoder sheet-frame-index"
  [ "$s" -ge 3 ] && echo "room-slide-aperture"
  [ "$s" -ge 4 ] && echo "ldtk-entity-art"
  [ "$s" -ge 5 ] && echo "feel-effects"
  [ "$s" -ge 6 ] && echo "audio-unlock"
  [ "$s" -ge 7 ] && echo "game-test-harness"
  return 0
}

# advanceSpringRod is deliberately NOT in this table. §12.7 #13 reads "Hair uses
# advanceSpringRod, never raw advanceSpringChain" — a constraint on hair, not a
# requirement that hair exists. §4.4 puts the spring-rod hair on the PROCEDURAL
# FALLBACK body, so a build rendering the supplied Player.png sprite correctly
# may have none. Requiring it accused a build that had done nothing wrong; the
# real constraint is §12.8's forbidden `advanceSpringChain`, which already runs.
symbols_for_stage() {
  local s=$1
  [ "$s" -ge 1 ] && echo "createLdtkRoomPainter applyCameraLetterbox composeCameraTransform prefersReducedMotion"
  [ "$s" -ge 2 ] && echo "stepPlatformer drawSprite deriveSpriteAnimKind"
  [ "$s" -ge 3 ] && echo "beginSessionRoomSlide advanceSessionRoomSlide"
  [ "$s" -ge 4 ] && echo "ldtkEntityTileOverride drawLevelEntity createLocalStorageSaveStorage createMenuNav"
  [ "$s" -ge 5 ] && echo "triggerHitStop sineShake"
  [ "$s" -ge 6 ] && echo "createAudioAdapter"
  return 0
}

RECIPES=$(recipes_for_stage "$STAGE" | tr '\n' ' ')
SYMBOLS=$(symbols_for_stage "$STAGE" | tr '\n' ' ')

echo "§12.9.1 — recipes copied in and imported (stage $STAGE)"
for r in $RECIPES; do
  test -s "src/recipes/$r.ts" || say "MISSING OR EMPTY: src/recipes/$r.ts"
done
# One permissive pattern on purpose. Game code lives in src/ and src/game/,
# tests reach in as '../src/recipes/', vite.config.ts as './src/recipes/', and
# a build may quote its specifiers either way. Anchoring on incidental syntax
# has produced two false results already — see §12.9.1 in the brief.
for r in $RECIPES; do
  grep -rqE "from [\"'][^\"']*recipes/$r[\"']" src/ tests/ vite.config.ts 2>/dev/null \
    || say "CARRIED BUT NEVER IMPORTED: $r"
done

echo "§12.9.1 — structural"
js=$(find src -name '*.js' 2>/dev/null | head -1)
[ -n "$js" ] && say "JAVASCRIPT IN src/: $js — tsc --noEmit is not a gate for this build"
ts_count=$(find src -name '*.ts' 2>/dev/null | grep -vc '^src/recipes/' || true)
[ "${ts_count:-0}" -lt 2 ] && say "SINGLE-FILE src/: the recipes are not in it and neither is the engine"

echo "§12.9.2 — engine reachable from GAME code"
grep -qE '"aicraft-engine": *"0\.22\.0"' package.json 2>/dev/null \
  || say "PIN NOT EXACT: $(grep -o '"aicraft-engine": *"[^\"]*"' package.json 2>/dev/null) — a caret resolved a real build to 0.17.2"
# --exclude-dir=recipes is the entire point: the copied recipes import the
# engine themselves, so a grep over all of src/ is green for a build that
# carries twelve recipes and wires none of them.
grep -rqE --exclude-dir=recipes "from [\"']aicraft-engine[\"']" src/ 2>/dev/null \
  || say "ENGINE INSTALLED BUT NEVER IMPORTED BY GAME CODE — this is the whole failure mode"

echo "§12.9.3 — one grep per silently-failing system (stage $STAGE)"
for s in $SYMBOLS; do
  grep -rq --exclude-dir=recipes "$s" src/ 2>/dev/null || say "NOT WIRED: $s"
done

# §6.1 falling blocks are CAPABILITY-GATED on the level, not on the stage. The
# reference build's .ldtk defines none, so a flat requirement would fail the
# build that passed; the shipped pack gained a FallingBlock entity later, and a
# build using that pack must wire the machine rather than hand-roll it.
# Ask the level, not the calendar.
if [ "$STAGE" -ge 4 ] && grep -lq FallingBlock public/*.ldtk 2>/dev/null; then
  grep -rqE "from [\"'][^\"']*recipes/ldtk-entity-tile-art[\"']" src/ tests/ 2>/dev/null \
    || say "LEVEL DEFINES FallingBlock BUT ldtk-entity-tile-art IS NOT IMPORTED (§6.1 art)"
  grep -rq --exclude-dir=recipes "advanceFallingBlocks" src/ 2>/dev/null \
    || say "LEVEL DEFINES FallingBlock BUT advanceFallingBlocks IS NOT WIRED (§6.1 — the engine owns the machine)"
fi

if [ "$FINAL" -eq 1 ]; then
  echo "§12.10 — gate substance (Stage 7 ship gate)"

  # Checks the ARTIFACT, not the call. A build once satisfied the §13 gate with
  # missingShotManifest(dir, []) — the exact function the brief names, called
  # correctly, with an empty required list against an empty directory. Grepping
  # the call site for "[]" cannot tell that apart from the assertion's own
  # .toEqual([]), so count the captures instead: an empty manifest cannot
  # produce fifteen PNGs.
  shots=$(find .qa -name '*.png' 2>/dev/null | wc -l | tr -d ' ')
  [ "${shots:-0}" -lt 15 ] \
    && say "ONLY $shots GATE CAPTURE(S) IN .qa/ — §13 has 15 gates; an empty manifest asserts nothing"

  # §12.7 has 25 acceptance criteria. A suite below one test per criterion has
  # not tested the game, whatever it is named.
  #
  # Count ANY test file and BOTH runner idioms. Globbing tests/*.test.ts and
  # counting only `it(` reported ONLY 0 TEST(S) against a build carrying 55
  # tests in tests/*.test.mjs under `node --test` — the fourth false result
  # this check has produced by anchoring on incidental syntax, and the fourth
  # caught only by running it against a build whose answer was known.
  tests=$(find tests -type f \( -name '*.test.*' -o -name '*.spec.*' \) 2>/dev/null \
    -exec grep -oh "\b\(it\|test\)(" {} + 2>/dev/null | wc -l | tr -d ' ')
  [ "${tests:-0}" -lt 25 ] \
    && say "ONLY $tests TEST(S) — §12.7 has 25 acceptance criteria"

  # Topic coverage, not filenames: the reference build proves §12.1b's
  # seam-respawn assertions may live inside gameplay-wiring.test.ts rather than
  # a file named for the section. Require the SUBJECT to be tested somewhere.
  for t in triggerHitStop:§12.2-dash-bonk \
           composeCameraTransform:§12.2b-world-composition \
           writeSave:§12.4/12.5-persistence \
           respawn:§12.1b-seam-respawn \
           fellIntoVoid:§6.2/§12.7-#25-void-death; do
    k="${t%%:*}"; label="${t#*:}"
    grep -rq "$k" tests/ 2>/dev/null || say "NOTHING TESTS $label (no '$k' anywhere in tests/)"
  done

  # Both halves or neither. A mounted plugin firing an event no client handles
  # is a hot reload that has never reloaded anything.
  if grep -q "createLdtkHotReloadPlugin" vite.config.ts 2>/dev/null \
     && ! grep -rq --exclude-dir=recipes "import.meta.hot" src/ 2>/dev/null; then
    say "HOT RELOAD HALF-WIRED: vite plugin mounted, no import.meta.hot listener in game code (§5.7, §12.7 #17)"
  fi
fi

scope="§12.9 (stage $STAGE)"
[ "$FINAL" -eq 1 ] && scope="§12.9 + §12.10"

echo
if [ "$fail" -eq 0 ]; then
  echo "$scope clean."
else
  echo "$scope FAILED — $fail check(s). This is a failed stage, not a TODO."
fi
exit $((fail > 0))
