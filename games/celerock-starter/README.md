# Celerock — starter scaffold

A Celeste-class precision platformer on `aicraft-engine@0.22.0`, scaffolded so
the parts that four previous runs got silently wrong are already correct, and
the gates that catch the rest are already wired.

**Read the brief first:** [celerock.md](https://github.com/morganpage/aicraft-engine/blob/v0.22.7/games/celerock.md).
It is the specification. This README is only how to move through it.

## What is already done

**§14 Stage 1 is complete and working.** Boot, the G3 preflight, the per-room
cache, the **painter over the surface cache** (not a per-frame `drawLdtkLevel`),
the Celeste camera preset at the campaign-constant window zoom, the letterbox
mask, the DPR boundary, and the single `composeCameraTransform` render skeleton
every later stage inherits. `npm run dev` shows a graybox walking a real room.

Also done: the twelve §1.1 recipes copied into `src/recipes/`, the four assets in
`public/`, the exact engine pin, the hot-reload plugin mounted **and** its
`import.meta.hot` listener wired, and the gates below.

## What you do

Work §14 Stages 2–7 in order. Each stage has its own gate in the brief.

```bash
npm run dev            # play it
npm test               # gate + suite
npm run build          # gate + typecheck + bundle
```

As each stage lands, bump `config.stage` in `package.json`. The gate then checks
that stage's requirements and the next stage goes red until you build it.

```bash
bash gate/check.sh --stage 3     # what Stage 3 must have wired
bash gate/check.sh --final       # the ship gate: all wiring + §12.10 substance
```

## The gates, and why they start where they do

- **`gate/check.sh`** is §12.9 (required wiring) and §12.10 (gate substance). It
  runs on `pretest` and `prebuild`, so you cannot get a green build past it.
- **`gate/gates.ts`** is the §13 visual manifest, **pre-filled with the eighteen
  captures the reference build actually produced.** `tests/gates.test.ts` ships
  RED against it. Turn it green by producing the captures — never by shortening
  the list. A previous run passed every §13 gate with
  `missingShotManifest(dir, [])`: the right function, correct arguments, an
  empty requirement, an empty directory, and nothing asserted.

Deleting a gate is a legitimate edit for a fork and is not legitimate mid-build.
`tests/contracts.test.ts` asserts the `pretest`/`prebuild` hooks still exist, and
`git diff gate/` shows the rest.

## The one thing not to do

Do not re-sketch a recipe inline. Every one of them is already in
`src/recipes/`, already typechecking. Importing costs one line; re-writing costs
forty and is a failed stage (§12.9.1) however good the code looks.
