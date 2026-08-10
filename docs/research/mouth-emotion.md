# Parametric Character Mouth and Emotion Interpolation

> Research note for rendering a parametric character mouth that interpolates between emotion states — specifically the range SMILING → NEUTRAL → NERVOUS — for a minimalist side-on blob character. Slug: `mouth-emotion`.
> Investigated: 2026-06-20.

## TL;DR

To render an expressive, deterministic mouth for a minimalist side-view blob character (like the Slime Knight) within a zero-dependency Canvas 2D framework, we must combine **parametric vector curves** with **time-driven wave displacements**. While a smiling-to-neutral transition is elegantly solved via a single cubic Bézier curve with interpolated control points, a "nervous" state requires a distinct visual convention: a high-frequency, low-amplitude trembling polyline (a chattering wavy line) mapped along that same base curve. By mapping a 2D emotion space (Valence and Arousal) to these geometric parameters, we can smoothly interpolate from a wide, smooth smile, through a flat neutral line, to a trembling, chattering nervous squiggle. Prototyping should focus on: (1) an Interpolated Cubic Bézier Mouth for smooth smiling/frowning, (2) a Wave-Displaced Polyline Generator driven by the render tick for a chattering nervous tremble, and (3) Composable Secondary Cues (such as angled eyebrows and sweat droplets) to multiply the emotional readability of the face.

## Why this matters for aicraft-engine

This research directly impacts **Pillar 1 (Primitives & secondary dynamics)** and **Pillar 2 (Cosmetics & skin variation)**.
- **Character Expression & Appeal:** Minimalist characters with only eyes can feel detached or static. Adding a highly expressive, fluidly animating mouth below the eye instantly gives the character a soul, selling gameplay states (e.g., idle calm, walking focus, combat panic, or low-health worry).
- **Aesthetic Consistency:** The mouth must match the established Sokpop-inspired aesthetic of `slime-knight.ts`: flat fills, chunky outlines (3px), integer-pixel snapping, and strict determinism.
- **Zero Runtime Dependencies:** The entire animation and rendering pipeline must be implemented using pure Canvas 2D path APIs and simple trigonometric math, requiring no external libraries.
- **Strict Determinism:** The mouth's animations (especially the nervous tremble) must be 100% deterministic, relying on the render `tick` and seeded parameters rather than `Math.random()` or `Date.now()`.

---

## Prior Art Survey

### Pattern 1: Interpolated Cubic Bézier Mouth (The Smile/Frown Arc)
- **Source**: Dave Kerr's "Procedural Smiles" (`dwmkerr.com/procedural-smiles-animating-svg-with-pure-javascript/`) and standard 2D vector character rigs.
- **What it does**: Represents the mouth as a single cubic Bézier curve. The start and end anchors represent the mouth corners, and the two control points are interpolated vertically relative to the anchors.
  - **Smile (Positive Curvature):** Control points are pulled downwards (positive Y in Canvas coordinates), curving the line into a happy arc.
  - **Neutral (Zero Curvature):** Control points align horizontally with the anchors, collapsing the curve into a flat, clean straight line.
  - **Frown (Negative Curvature):** Control points are pushed upwards (negative Y), curving the line into a sad or worried arc.
- **Algorithmic shape**:
  ```typescript
  interface BezierMouth {
    x1: number; y1: number; // Left corner
    x2: number; y2: number; // Right corner
    cp1x: number; cp1y: number; // Control point 1
    cp2x: number; cp2y: number; // Control point 2
  }

  function evaluateBezierMouth(
    cx: number,
    cy: number,
    width: number,
    curvature: number, // [-1, 1] where -1 = frown, 0 = neutral, 1 = smile
    openness: number   // [0, 1] for mouth opening vertical depth
  ): BezierMouth {
    const halfW = width / 2;
    const x1 = cx - halfW;
    const y1 = cy;
    const x2 = cx + halfW;
    const y2 = cy;

    // Control points vertical offsets
    // Curvature bends the corners up/down. Openness pulls the center down.
    const cpYOffset = curvature * (width * 0.25) + openness * (width * 0.15);
    
    return {
      x1, y1,
      x2, y2,
      cp1x: x1 + halfW * 0.5,
      cp1y: y1 + cpYOffset,
      cp2x: x2 - halfW * 0.5,
      cp2y: y2 + cpYOffset
    };
  }
  ```
- **Determinism profile**: Pure mathematical operations. 100% deterministic.
- **Runtime cost**: Negligible. A few basic arithmetic operations per frame, drawn using native `ctx.bezierCurveTo()`.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is extremely lightweight, clean, and perfectly matches the vector-primitive drawing style of the Slime Knight.
- **What to steal**: Linear interpolation of the control points to morph smoothly between smile, neutral, and frown.
- **What to avoid**: Complex multi-segment paths when a single cubic Bézier is sufficient for a closed-lip line.

---

### Pattern 2: Wave-Displaced Polyline (The Nervous Tremble)
- **Source**: Generative art / p5.js wavy line patterns, and classic cartoon chattering teeth animation.
- **What it does**: A nervous mouth cannot be represented by a smooth Bézier curve; it requires a chattering, squiggly, or jittery line. To achieve this procedurally, the mouth line is divided into $N$ segments (a polyline). For each vertex along the line, we calculate its position along the base curve and then apply a perpendicular displacement driven by a sine wave. The wave is parameterized by spatial frequency (how many squiggles across the mouth) and temporal frequency (how fast it chatters, driven by the render `tick`).
- **Algorithmic shape**:
  ```typescript
  function drawWavyMouth(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    width: number,
    curvature: number, // base arc bend
    amplitude: number, // height of squiggles (0 = flat line, 4 = highly nervous)
    frequency: number, // number of wave peaks across the mouth (e.g., 3.5)
    tick: number,
    speed: number = 0.6 // temporal chatter speed
  ): void {
    const segments = 16;
    const halfW = width / 2;
    
    ctx.beginPath();
    for (let i = 0; i <= segments; i++) {
      const u = i / segments; // parameter in [0, 1]
      
      // Base linear interpolation from left to right
      const bx = -halfW + width * u;
      // Base quadratic bend for the mouth shape
      const by = 4 * curvature * halfW * 0.2 * u * (1 - u);
      
      // Spatial wave phase + temporal chatter phase
      const phase = u * frequency * Math.PI * 2 + tick * speed;
      const waveOffset = amplitude * Math.sin(phase);
      
      // Apply displacement vertically (or perpendicular to the curve tangent)
      const x = cx + bx;
      const y = cy + by + waveOffset;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
  ```
- **Determinism profile**: Purely deterministic. Uses `tick` as the temporal phase, ensuring the chatter is identical on every replay.
- **Runtime cost**: Low. $O(N)$ where $N$ is the segment count (typically 12-16). Negligible CPU overhead.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It creates an organic, fluidly chattering wave that perfectly conveys nervousness or anxiety while remaining extremely lightweight and deterministic.
- **What to steal**: Combining spatial sine waves with temporal `tick` phase to create a smooth, continuous chattering motion.
- **What to avoid**: Using unseeded `Math.random()` for jitter, which creates high-frequency white noise (looks like a rendering glitch or static) rather than a coherent physical tremble.

---

### Pattern 3: 2D Emotion Blend Spaces (The Valence-Arousal Mapping)
- **Source**: Game animation blend spaces (Unreal Engine, Unity) and the Russell Circumplex Model of Affect.
- **What it does**: Maps a 2D emotion coordinate `(valence, arousal)` in `[-1, 1]²` to the physical mouth parameters.
  - **Valence** (positive = happy, negative = sad/worried) maps to `curvature` (smile vs. frown).
  - **Arousal** (positive = excited/nervous, negative = calm/bored) maps to `openness` (mouth gap) and `tremble amplitude` (nervousness).
  By interpolating across this 2D space, the character can transition smoothly between states:
  - `(1, 0)`: Calm Smile (smooth happy curve, closed).
  - `(0, 0)`: Neutral Line (flat, straight).
  - `(-1, 0)`: Calm Frown (smooth sad curve).
  - `(-1, 1)`: Nervous Tremble (chattering, squiggly frown).
  - `(1, 1)`: Excited Gasp (wide open happy mouth).
- **Algorithmic shape**:
  ```typescript
  interface MouthParameters {
    curvature: number;   // [-1, 1] (frown to smile)
    openness: number;    // [0, 1] (closed to open)
    trembleAmp: number;  // [0, max] (chatter amplitude)
    trembleFreq: number; // frequency of chatter
  }

  function mapEmotionToMouth(valence: number, arousal: number): MouthParameters {
    // Curvature is driven primarily by valence
    const curvature = valence;
    
    // Openness increases with high arousal (gasp or excited smile)
    // but we scale it down slightly for negative valence (worried gasp is smaller)
    const openness = Math.max(0, arousal) * (valence >= 0 ? 0.8 : 0.4);
    
    // Tremble is active when arousal is high AND valence is negative (nervousness/fear)
    const trembleAmp = Math.max(0, arousal) * Math.max(0, -valence) * 3.5;
    const trembleFreq = 3.0 + Math.max(0, arousal) * 1.5; // faster/denser waves when highly aroused
    
    return { curvature, openness, trembleAmp, trembleFreq };
  }
  ```
- **Determinism profile**: Purely deterministic.
- **Runtime cost**: Negligible ($O(1)$ parameter mapping).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It provides a clean, unified API that hides the complex geometric parameters behind a standard 2D emotion coordinate, allowing the consumer to easily drive expressions.
- **What to steal**: The 2D Valence-Arousal mapping to coordinate mouth shape, openness, and jitter.
- **What to avoid**: Hard-coded, discrete state switches (e.g., `if (state === 'nervous')`) which prevent smooth, fluid transitions and look cheap.

---

### Pattern 4: Composable Secondary Cues (Eyebrows & Sweat Particles)
- **Source**: Classic cartoon animation, anime visual shorthand, and Sokpop particle systems.
- **What it does**: A mouth alone cannot fully convey complex emotions like "nervous." To sell the emotion, the mouth must be paired with secondary cues:
  - **Diagonal Eyebrows**: Two simple line segments drawn above the eye. Angling them up-inward (`/ \`) immediately conveys worry/nervousness.
  - **Sweat Drop Particle**: A single tear-shaped particle that spawns at the temple and slides down the body.
  By coordinating these cues with the mouth's emotional state, the character's expression becomes instantly recognizable.
- **Algorithmic shape**:
  ```typescript
  function drawEyebrows(
    ctx: CanvasRenderingContext2D,
    eyeCx: number,
    eyeCy: number,
    eyeRadius: number,
    worry: number, // [0, 1]
    palette: Palette
  ): void {
    if (worry <= 0.1) return;
    
    ctx.strokeStyle = palette.outline;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    
    const browW = eyeRadius * 0.8;
    const browY = eyeCy - eyeRadius * 1.3;
    
    // Left eyebrow (angled up-inward for worry: / )
    const leftAngle = worry * 0.4; // radians
    ctx.save();
    ctx.translate(eyeCx - eyeRadius * 0.8, browY);
    ctx.rotate(leftAngle);
    ctx.beginPath();
    ctx.moveTo(-browW / 2, 0);
    ctx.lineTo(browW / 2, 0);
    ctx.stroke();
    ctx.restore();
    
    // Right eyebrow (angled up-inward: \ )
    const rightAngle = -worry * 0.4;
    ctx.save();
    ctx.translate(eyeCx + eyeRadius * 0.8, browY);
    ctx.rotate(rightAngle);
    ctx.beginPath();
    ctx.moveTo(-browW / 2, 0);
    ctx.lineTo(browW / 2, 0);
    ctx.stroke();
    ctx.restore();
  }
  ```
- **Determinism profile**: Purely deterministic.
- **Runtime cost**: Extremely low (drawing 2 lines).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It leverages the existing eye coordinate system and palette, adding massive emotional ROI for almost zero code size or performance cost.
- **What to steal**: Up-inward angled eyebrows to multiply the readability of a nervous mouth.
- **What to avoid**: Complex eyebrow meshes; two simple lines are more readable and fit the Sokpop aesthetic perfectly.

---

## Reference Implementations

- **Dave Kerr's SVG Smile** (`github.com/dwmkerr/svg-smile`): Demonstrates cubic Bézier interpolation for a smile-to-frown transition.
- **Sokpop Collective Catalog** (`sokpop.itch.io`): Illustrates the use of minimalist, chunky-outline facial features (often just a simple curved line or dot) that squash and stretch with the character's body.
- **Processing/p5.js Face Generator Examples**: Shows how to draw procedural facial features using simple trigonometric functions and polylines.

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Dave Kerr's Smile Geometry | Cubic Bézier control points pulling down for a smile and up for a frown. | `dwmkerr.com/procedural-smiles-animating-svg-with-pure-javascript/` |
| Slime Knight Eye | Sclera squashing vertically during blinks, pupil tracking gaze. | `showcase/helpers/slime-knight.ts:1520` |
| Cartoon Expression Guides | Eyebrows angled up-inward (`/ \`) combined with a wavy mouth to sell "nervous/worried". | Standard animation reference sheets |

---

## Open Questions

1. **Should the mouth support flat fills when open?**
   - *Line-only mouth:* A single stroked line is extremely clean and matches the simplest Sokpop style.
   - *Filled open mouth:* An open mouth (e.g., during a gasp or a wide smile) could be filled with the outline color (`palette.outline`) or a dark feature color, with a tongue drawn inside. This adds visual richness but increases geometric complexity (requires drawing a closed loop with two Bézier curves).
   - *Recommendation:* Start with a line-only mouth for simplicity and performance. If an open mouth is needed, draw it as a closed path filled with `palette.outline` (flat dark fill), which perfectly matches the chunky, high-contrast Sokpop aesthetic.
2. **Where should the mouth state live?**
   - Should `emotion` (or `valence` and `arousal`) be part of the static `HeroConfig` (derived from the seed), or should it be a dynamic input passed in `HeroInputs` (like `facing` or `look`)?
   - *Recommendation:* It must be a dynamic input in `HeroInputs`. This allows the game loop to dynamically change the character's expression based on gameplay events (e.g., getting hit, idle breathing, or spotting an enemy) rather than locking the character into a single emotion forever.

---

## Top 3 Patterns Worth Prototyping

1. **Interpolated Cubic Bézier Mouth (Pattern 1)**
   - *Why:* It provides a smooth, mathematically elegant transition between smiling, neutral, and frowning using a single Canvas 2D path call.
   - *Key Parameters:* `width: number`, `curvature: number` (frown to smile), `openness: number`.
2. **Wave-Displaced Polyline Tremble (Pattern 2)**
   - *Why:* It is the definitive visual convention for a chattering, nervous mouth. It creates a highly expressive, organic tremble driven purely by the render `tick`.
   - *Key Parameters:* `amplitude: number` (tremble height), `frequency: number` (wave density), `tick: number`, `speed: number`.
3. **Valence-Arousal 2D Blend Space (Pattern 3)**
   - *Why:* It simplifies the API for game developers, mapping a simple 2D emotion coordinate `(valence, arousal)` to the complex underlying geometric parameters of the mouth.
   - *Key Parameters:* `valence: number` (sad to happy), `arousal: number` (calm to excited/nervous).

---

## Cross-References

- `docs/research/elastic-rod-antenna.md` — Secondary dynamics using Verlet chains and Bézier smoothing.
- `docs/research/walk-cycle-direction-conventions.md` — Locomotion phase and facing-direction conventions.
- The canonical Sokpop reference (sokpop.itch.io) — Strategic context on Sokpop's minimalist rendering.
- `showcase/helpers/slime-knight.ts` — The canonical showcase character that this mouth will be integrated into.
