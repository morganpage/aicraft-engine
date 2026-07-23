# Spider Prototype Samples

Procedural spider locomotion prototype — Approach B hybrid (gait coordinator + segmented body + IK legs + pedipalps).

## sample-sheet.png

4-panel sample sheet rendered by `benchmarks/_scripts/spider-render.ts`.

| Panel | What it shows |
|---|---|
| 1. Coordinated Gait Walk | Strict alternating-tetrapod gait. Purple/cyan foot histories distinguish independent near/far legs; faded bodies show history. |
| 2. Frantic Gait Scuttle | Independent free-stepping with neighbour, corresponding-pair, and total-support locks. |
| 3. Direction + Leg Isolation | Stationary 2-leg right/left poses followed by 4-, 6-, and 8-leg spiders verify trailing-foot symmetry and dynamic leg counts. |
| 4. Facing Reversal Stress | A 0.7× frantic spider turns left after tick 60; the bold frame captures four frames after the turn to expose crossed or trailing legs. |

## Reproduce

```bash
npx tsx benchmarks/_scripts/spider-render.ts
```
