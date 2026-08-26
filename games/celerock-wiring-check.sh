#!/usr/bin/env bash
# celerock.md §12.9 — Required Wiring, and §12.10 — Gate Substance.
#
#   ./celerock-wiring-check.sh            §12.9 only — run at EVERY §14 stage boundary
#   ./celerock-wiring-check.sh --final    §12.9 + §12.10 — the Stage 7 ship gate
#
# §12.10 is separate because it cannot pass early: a Stage 1 build has no gate
# captures and no suite yet. Running it at every boundary would train the run to
# treat a red check as normal, which is how a gate stops meaning anything.
#
# Prints nothing and exits 0 when clean. Every failure line is a FAILED STAGE.
#
# Validated against both known runs of games/celerock-gauntlet-prompt.txt:
#   - the build that passed §12.7: silent on all 41 checks except the exact-pin
#     rule (it shipped "^0.22.0" and was correct only by luck).
#   - the build that shipped 420 lines of hand-rolled JS: fails all 41.
#
# §12.8 (forbidden patterns) is the other half and runs as a test:
#   scanForbiddenIdentifiers('src') === []   — recipes/game-test-harness.ts

set -uo pipefail
FINAL=0
[ "${1:-}" = "--final" ] && FINAL=1

fail=0
say() { echo "  $*"; fail=$((fail + 1)); }

RECIPES="fixed-tick-game platformer-input sprite-sheet-boot image-decoder
         sheet-frame-index ldtk-draw-pipeline room-slide-aperture ldtk-entity-art
         feel-effects audio-unlock game-test-harness ldtk-hot-reload-plugin"

# ldtk-entity-tile-art is capability-gated (§6.1 falling blocks) and
# particle-system is the pre-0.21.0 back-port — neither is required here.

SYMBOLS="createLdtkRoomPainter stepPlatformer drawSprite deriveSpriteAnimKind
         beginSessionRoomSlide advanceSessionRoomSlide applyCameraLetterbox
         composeCameraTransform ldtkEntityTileOverride drawLevelEntity
         createMenuNav triggerHitStop sineShake createAudioAdapter
         advanceSpringRod createLocalStorageSaveStorage prefersReducedMotion"

echo "§12.9.1 — recipes copied in and imported"
for r in $RECIPES; do
  test -s "src/recipes/$r.ts" || say "MISSING OR EMPTY: src/recipes/$r.ts"
done
# One permissive pattern on purpose: game code lives in src/ and src/game/,
# tests reach in as '../src/recipes/', vite.config.ts as './src/recipes/'.
# An anchored regex loses call sites silently.
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
grep -qE '"aicraft-engine": *"0\.22\.0"' package.json \
  || say "PIN NOT EXACT: $(grep -o '"aicraft-engine": *"[^\"]*"' package.json) — a caret resolved a real build to 0.17.2"
# --exclude-dir=recipes is the entire point: the copied recipes import the
# engine themselves, so a grep over all of src/ is green for a build that
# carries fourteen recipes and wires none of them.
grep -rqE --exclude-dir=recipes "from [\"']aicraft-engine[\"']" src/ 2>/dev/null \
  || say "ENGINE INSTALLED BUT NEVER IMPORTED BY GAME CODE — this is the whole failure mode"

echo "§12.9.3 — one grep per silently-failing system"
for s in $SYMBOLS; do
  grep -rq --exclude-dir=recipes "$s" src/ 2>/dev/null || say "NOT WIRED: $s"
done

if [ "$FINAL" -eq 1 ]; then
  echo "§12.10 — gate substance (Stage 7 ship gate)"

  # Checks the ARTIFACT, not the call. A build once satisfied the §13 gate with
  # missingShotManifest(dir, []) — the exact function the brief names, called
  # correctly, with an empty required list against an empty directory. Grepping
  # the call site for "[]" cannot tell that apart from the assertion's own
  # .toEqual([]), so count the captures instead: an empty manifest cannot
  # produce fourteen PNGs.
  shots=$(find .qa -name '*.png' 2>/dev/null | wc -l | tr -d ' ')
  [ "${shots:-0}" -lt 14 ] \
    && say "ONLY $shots GATE CAPTURE(S) IN .qa/ — §13 has 14 gates; an empty manifest asserts nothing"

  # §12.7 has 24 acceptance criteria. A suite below one test per criterion has
  # not tested the game, whatever it is named.
  tests=$(grep -rho "\bit(" tests/*.test.ts 2>/dev/null | wc -l | tr -d ' ')
  [ "${tests:-0}" -lt 24 ] \
    && say "ONLY $tests TEST(S) — §12.7 has 24 acceptance criteria"

  # Topic coverage, not filenames: the reference build proves §12.1b's
  # seam-respawn assertions may live inside gameplay-wiring.test.ts rather than
  # a file named for the section. Require the SUBJECT to be tested somewhere.
  for t in triggerHitStop:§12.2-dash-bonk \
           composeCameraTransform:§12.2b-world-composition \
           writeSave:§12.4/12.5-persistence \
           respawn:§12.1b-seam-respawn; do
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

scope="§12.9"
[ "$FINAL" -eq 1 ] && scope="§12.9 + §12.10"

echo
if [ "$fail" -eq 0 ]; then
  echo "$scope clean."
else
  echo "$scope FAILED — $fail check(s). This is a failed stage, not a TODO."
fi
exit $((fail > 0))
