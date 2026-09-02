# Meadow Tamers — the aicraft-engine RPG starter

A zero-asset, top-down monster-tamer built entirely from `aicraft-engine`
public APIs. Explore, talk to the field guide, rustle the tall grass, battle,
weaken, capture, level up, heal at the rest house, save, and reload.

```bash
npm install
npm run dev        # play in the browser
npm test           # headless full-loop determinism tests (same game object)
npm run build      # production bundle
```

## Controls

- **Arrows / WASD** — move (tile-snapped, one direction at a time)
- **Enter / Space / E / Z** — talk, advance dialogue, confirm
- **1–9** — issue the numbered battle command shown at the bottom of the screen
- **S** — save (only works standing still on the overworld — that's the point)
- **L** — load the save

## Editing the game

[`src/content.ts`](src/content.ts) is the creative surface: change `GAME_SEED`
to reroll species, names, and the world layout; swap the starting party and
inventory; the rest is engine composition. [`src/game.ts`](src/game.ts) holds
the shared wiring (fixed-tick loop, key → semantic input mapping, audio cues,
save/load) and is the same object the tests drive headlessly — the browser
entry in [`src/main.ts`](src/main.ts) only adds canvas and DOM.

## What is deliberately absent

No image, font, or audio files — creatures, tiles, dialogue, and sounds are
generated procedurally at runtime. No gameplay rules live in this package:
legality, RNG, damage, capture math, and progression all come from the
engine, which is why the headless tests and the browser behave identically.

## Browser tests

The engine-level loop (encounter → battle → heal → save → reload, twice,
hash-identical) is proven headlessly in `tests/starter-loop.test.ts`.
Recorded-browser (Playwright) coverage is the remaining consumer-side step,
per the repository convention that visual/browser verification lives with
the consumer rather than the library.
