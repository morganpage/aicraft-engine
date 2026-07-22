# Spider Prototype Samples

Procedural spider locomotion prototype — Approach B hybrid (gait coordinator + segmented body + IK legs + pedipalps).

## sample-sheet.png

4-panel sample sheet rendered by `benchmarks/_scripts/spider-render.ts`.

| Panel | What it shows |
|---|---|
| 1. Coordinated Gait Walk | Alternating tetrapod gait (Set A/B). Faded ghosts show step history, bold is current pose. |
| 2. Frantic Gait Scuttle | Free-stepping with neighbor-lock. Higher speed, chaotic scuttling pattern. |
| 3. Body Showcase (3 palettes) | Stationary spiders at idle breathing. L-R: Dark Purple, Sickly Green, Blood Red. |
| 4. Multi-Spider Scuttle | 3 spiders at different seeds/sizes walking simultaneously (swarm check). |

## Reproduce

```bash
npx tsx benchmarks/_scripts/spider-render.ts
```
