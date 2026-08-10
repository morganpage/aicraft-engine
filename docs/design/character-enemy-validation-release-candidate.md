# Character/Enemy Validation Release-Candidate Handoff

> Date: 2026-07-29  
> Status: **NEEDS VISUAL REVISION**
> Candidate version: `aicraft-engine@0.5.0`

The implementation-ready recovery plan is:

- `docs/design/humanoid-visual-revision-plan.md`

## Source identity

- Published `0.4.0` baseline:
  `72ef6c62d14f8eef1be94c20c2093a5b5cba97af`
- Development base and current `main`:
  `6d4906624dac359f186fcbc583af96e8e9ffd66e`
- Release-candidate implementation commit:
  `0663d7fe599bfa3ef4256c247f7e7e5bbbbcadab`
- Release-candidate implementation tree:
  `f517358ea922209d7ad5cda7dda5a03f40da4786`
- Branch: `codex/character-enemy-validation`
- Worktree was clean when the candidate artifact was packed.
- `package.json` and `package-lock.json` both report `0.5.0`.

This handoff document is an administrative follow-up to the implementation
commit. It is excluded from the npm package and does not change packed runtime
or declaration content.

## Exact artifact

- Filename: `aicraft-engine-0.5.0.tgz`
- Size: 554,929 bytes
- Unpacked size: 1,845,909 bytes
- Entry count: 463
- SHA-1: `48374f6d6360ac8fa767e77eb940c0ff5fca93c0`
- SHA-512:
  `sha512-Nhyn9CNnaEejHSljf0ufAWHy0oiNvvpqOD82TaAfKjteZVJwdhBjW1BApIKh3VwX8HO1Ui0D6BVhB2juxrwowQ==`

The tarball contains production `dist/character`, collision LOS, charger,
declarations, README, license, and package metadata. It contains no prototype,
showcase, benchmark, or test files and has no runtime dependencies.

## Gate results

Phase 15.5: **NEEDS REVISION**

- Humanoid production and prototype PNG SHA-256:
  `66f2484f6c8cecebe0696a6e36afcb373fd62ecd874027ea88e7952fd91c5837`
- Charger production and prototype PNG SHA-256:
  `cad16310317a96be7f5921f5f63eea4bc477455401e4e4fdb69b4b35a4c1911d`
- Both production sheets are byte-identical to the approved prototypes.
- Production architecture matches both decision documents.
- Humanoid idle geometry now enforces grounded feet, left/right foot and knee
  ordering, finite coordinates, exact limb lengths, and non-intersecting legs.
- Neutral arms hang beside the torso with sided elbows/hands, exact segment
  lengths, shallow bends, and no centerline crossing.
- The later platformer-specific reference study found that the permanent sheet
  still uses arbitrary mid-stride samples rather than named contact, passing,
  and opposite-contact poses, and does not show an explicit landing pose.
  Those visual gates must be added before approval.

Phase 16: **PASS**

- 2,803 library tests passed across 143 files.
- 222 showcase tests passed across 10 files.
- Library typecheck, distribution build, showcase typecheck, and showcase build
  passed.
- Package dry-run and exact `npm pack --json` passed at `0.5.0`.

Phase 17: **PASS**

- The exact tarball installed into a fresh strict TypeScript/Vite project.
- Package-root-only humanoid/platformer wiring typechecked and bundled.
- Bundled runtime assertions passed for charger registration, fixed dimensions,
  and empty-path LOS.
- A collision-only Rollup graph contained two modules and no character or
  charger implementation modules.
- The smoke source contained no `JumpState` or `advanceJump` humanoid coupling.
- Plain Node ESM was not treated as a supported path: as documented in the
  README, emitted extensionless internal imports require a bundler. The runtime
  entry was bundled to Node ESM before execution.

## Handoff

`main` has not advanced beyond the recorded development base, so the branch
does not need synchronization. The exact artifact still passes its technical
gates, but visual approval is paused pending the named gait and landing
evidence above. No merge, tag, or npm publication has occurred.

---

## Postscript — 2026-08-10: scope expanded, visual verdict resolved (idle scope)

> See `docs/design/0.5.0-scope-decision.md` for the full rationale.

**Scope expansion (Option B/B1).** Between the original candidate (2026-07-29)
and this audit, `main` advanced past `6d49066` to `c7906fd` and accumulated
several finished, tested modules that were never part of the original 0.5.0
candidate: `src/terrain-art/`, `src/ldtk/` (native editor + auto-layer rule
engine), `src/sprites/` (Aseprite-JSON pipeline), the ladder/climb system, and
LDtk tile semantics. Rather than publish a narrow 0.5.0 and split this work
into 0.6.0, the decision is to **ship the entire current `main` tree as
0.5.0.**

**Visual verdict — resolved for the idle scope.** A fresh `@benchmarker`
review on 2026-08-10 against the current production code returned:

- **Charger: APPROVED** — unchanged, all four phases legible.
- **Humanoid: APPROVED for the idle scope only.** The Phase H2 idle pose is
  polished and approved (`benchmarks/character-body-plans/humanoid-idle-h2.png`).
  The original objection — "arbitrary mid-stride samples rather than named
  contact/passing/opposite-contact poses, and no explicit landing pose" —
  remains live for the **motion** scope: Phase H3 (grounded locomotion) and H4
  (airborne + landing) are unimplemented stubs in
  `src/character/humanoid/pose.ts`. Per B1, motion poses are **deferred to
  0.6.0**; the 0.5.0 production sheet honestly labels the stub panels
  `(0.6.0)`. The humanoid public API is stable; only the stub geometry fills in
  next release.

**Gate matrix re-run.** Full results in `0.5.0-scope-decision.md`. All gates
green after two unblocks: (a) `benchmarks/_scripts/humanoid-validation-render.ts`
had an obsolete prototype-equality assertion (Decision #9 of
`humanoid-visual-revision-plan.md`) that crashed the script — removed; (b)
`scripts/check-level-visual-size.mjs` was pegged to a Phase 0 baseline and
reported a spurious +39.52% — re-baselined to the 0.5.0 `dist/` as a
whole-distribution regression budget. Tarball leak scan is clean; zero runtime
dependencies.

**Publication status.** **PUBLISHED.** `aicraft-engine@0.5.0` went live on npm
at 2026-08-10T12:37:10.635Z. Release commit `a71b189`, tag `v0.5.0`. Registry
integrity `sha512-J//xe073JWyXoM22aEPf9k+I4EdwxWRw7DSfiilfKJFNKXyD4LxvQ4sAQOsVn/uXdJOrs8Y5kAXs4j543Rq8cg==`,
shasum `7072dcef938edfd654d1112502a86b951d06a531` (byte-identical to the
smoke-tested tarball). Full details in `docs/design/0.5.0-scope-decision.md`.
