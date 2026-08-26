#!/usr/bin/env bash
# celerock.md §12.9 — Required Wiring.
#
# Run from a Celerock build root at EVERY §14 stage boundary, not once at the end.
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
  grep -rq "from '[^']*recipes/$r'" src/ tests/ vite.config.ts 2>/dev/null \
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
grep -rq --exclude-dir=recipes "from 'aicraft-engine'" src/ 2>/dev/null \
  || say "ENGINE INSTALLED BUT NEVER IMPORTED BY GAME CODE — this is the whole failure mode"

echo "§12.9.3 — one grep per silently-failing system"
for s in $SYMBOLS; do
  grep -rq --exclude-dir=recipes "$s" src/ 2>/dev/null || say "NOT WIRED: $s"
done

echo
if [ "$fail" -eq 0 ]; then
  echo "§12.9 clean."
else
  echo "§12.9 FAILED — $fail check(s). This is a failed stage, not a TODO."
fi
exit $((fail > 0))
