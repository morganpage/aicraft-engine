# Character Body-Plan Validation

`humanoid-prototype.png` is the deterministic Phase 8 review sheet for the
visual-only humanoid candidate. It includes three seeds, idle and stride poses,
signed-gravity air poses, both facings, an arm target, grayscale and small-scale
rows, and the existing slime-knight as a scale/silhouette reference.

Regenerate with:

```bash
npm run benchmark:humanoid
```

`humanoid-production.png` is rendered from `src/character/`. It is
byte-identical to the approved prototype sheet.

`humanoid-reference-study.png` is an original analytical diagram derived from
the researched platformer strategies in
`docs/research/humanoid-platformer-visual-reference.md`. It contains no copied
game sprites. Regenerate it with:

```bash
npx tsx benchmarks/_scripts/humanoid-reference-study-render.ts
```
