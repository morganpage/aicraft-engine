# Library/Product Showcase and Landing Pages

> Research note for library/product showcase and landing pages. Slug: `showcase-page`.
> Investigated: 2026-06-19.

## TL;DR

The showcase page for `aicraft-engine` must bridge the gap between technical correctness (our benchmark PNGs) and visual appeal/developer desire. The single most important finding of this research is that **the most successful rendering and generative-art showcases are live, interactive, and highly responsive playgrounds that embed the code directly alongside the output**. By making the code editable and linking visual parameter changes (like sliders, seed inputs, or IK targets) directly to real-time code mutation, we create an irresistible "developer sandbox" that proves our core value proposition: *zero runtime dependencies, seeded determinism, and high-performance procedural rendering*. To align with our Sokpop-inspired aesthetic, the showcase's UI chrome itself should be rendered using the library's primitives (the "eat your own dogfood" pattern), creating a cohesive, tactile, and playful experience that feels like a game rather than a dry documentation site.

## Why this matters for aicraft-engine

- **Pillars Touched**: Direct showcase of **Pillar 1 (Primitives & RNG)**, **Pillar 1b (Animation & IK)**, **Pillar 2 (Palette & Cosmetics)**, and **Pillar 4 (Fake-3D)**.
- **Consumer Games**: Consumer titles (such as card-based village builders or idle gardens) need to see the library "in action" to understand how it eliminates the asset pipeline.
- **Unlocks**:
  - **Developer Trust**: Proves that a zero-dependency, Canvas2D-only library can produce fluid, organic, and beautiful animations and graphics at 60 FPS in the browser.
  - **Tangible Determinism**: Makes our core differentiator ("same seed = same output") visually undeniable and interactive.
  - **Viral Sourcing**: Provides a shareable sandbox where developers can generate a cute character, copy a "seed link," and share it with others, driving adoption of the library and the Skool community.

---

## Prior Art Survey

### Category A: Rendering & Game Libraries

#### 1. p5.js (Editor & Examples)
- **Source**: [p5js.org](https://p5js.org/)
- **What it looks like**: Bright, high-contrast pink-and-white aesthetic. Friendly and educational. Examples are structured as a sidebar gallery with a central code editor and live preview canvas.
- **Live vs Static**: Fully live.
- **Single-page vs Gallery**: Multi-page gallery with a dedicated full-screen editor.
- **Framework used**: React/Next.js for the main site, custom web editor.
- **Where it lives**: Separate repositories (`p5.js-website` and `p5.js-web-editor`).
- **Best**: Extremely low barrier to entry; code is immediately editable with instant feedback.
- **Worst**: The editor is a heavy, separate application that can feel disconnected from the main documentation.
- **Fit for our constraints**: Medium. While we want live code editing, we want it embedded inline in the landing page, not as a heavy separate editor.

#### 2. three.js (Examples Gallery)
- **Source**: [threejs.org](https://threejs.org/)
- **What it looks like**: Minimalist black homepage with a massive grid of user-submitted project thumbnails. The `/examples/` page is a sidebar list of hundreds of test cases with a full-screen WebGL canvas.
- **Live vs Static**: Homepage is static thumbnails; examples page is fully live.
- **Single-page vs Gallery**: Multi-page gallery.
- **Framework used**: Vanilla JS/HTML.
- **Where it lives**: In-repo (`/examples` and `/editor` are part of the main three.js repository).
- **Best**: The sheer volume of examples is unmatched; clicking "View Source" opens a floating window with unminified, copy-pasteable code.
- **Worst**: The homepage is extremely sparse and intimidating for beginners; no search bar on the main page.
- **Fit for our constraints**: Strong in-repo structure. We should keep our showcase in-repo and deploy it directly from our codebase.

#### 3. Babylon.js
- **Source**: [babylonjs.com](https://www.babylonjs.com/)
- **What it looks like**: Modern, dark-themed developer landing page. Features a massive, impressive live WebGL hero canvas.
- **Live vs Static**: Fully live.
- **Single-page vs Gallery**: Multi-page with a dedicated "Playground" and "Snippets" gallery.
- **Framework used**: React.
- **Where it lives**: Separate repository for the website, but playground integrates with the main monorepo.
- **Best**: The "Playground" is a full-featured IDE with TypeScript support, auto-complete, and a collaborative "save/share" system.
- **Worst**: The main landing page is extremely heavy and can lag on lower-end devices due to the high-fidelity 3D hero scene.
- **Fit for our constraints**: Weak. Our library is ultra-minimalist; our showcase must load instantly and run flawlessly on mobile.

#### 4. Pixi.js
- **Source**: [pixijs.com](https://pixijs.com/)
- **What it looks like**: Highly polished, dark-themed landing page with high-performance 2D animations running live.
- **Live vs Static**: Fully live.
- **Single-page vs Gallery**: Multi-page with an interactive examples gallery.
- **Framework used**: React/Docusaurus.
- **Where it lives**: Separate repo for the documentation site.
- **Best**: Outstanding visual presentation; showcases high-performance 2D rendering (60 FPS) directly on the landing page.
- **Worst**: The playground code editor is basic and lacks advanced IDE features.
- **Fit for our constraints**: Strong visual inspiration. Proves that high-performance 2D rendering is a massive selling point.

#### 5. Phaser (Examples/Lab)
- **Source**: [labs.phaser.io](https://labs.phaser.io/)
- **What it looks like**: A massive, retro-style "Phaser Lab" featuring nested folders of hundreds of individual examples running in iframes.
- **Live vs Static**: Fully live.
- **Single-page vs Gallery**: Multi-page hierarchical gallery.
- **Framework used**: Vanilla JS/HTML.
- **Where it lives**: Separate repo (`phaser3-examples`) but deployed alongside the main site.
- **Best**: Incredible depth; literally every single API method has a corresponding live example.
- **Worst**: The UI of the Phaser Lab looks like a Windows 95 file explorer; highly intimidating and visually unappealing.
- **Fit for our constraints**: Weak. We want a highly polished, curated experience rather than a dump of hundreds of test cases.

#### 6. Anime.js / GSAP / Framer Motion / React Spring (Animation Libraries)
- **Source**: [animejs.com](https://animejs.com/), [greensock.com](https://greensock.com/), [framer.com/motion/](https://www.framer.com/motion/), [react-spring.dev](https://react-spring.dev/)
- **What they look like**:
  - *Anime.js*: Single-page minimalist masterpiece. The page itself is a live demo; clicking or hovering triggers fluid, beautiful vector animations.
  - *GSAP*: Rich, scroll-driven interactive landing page demonstrating ScrollTrigger.
  - *Framer Motion / React Spring*: Clean, modern documentation pages with inline interactive cards (e.g., draggable cards, spring-loaded buttons) with code snippets alongside.
- **Live vs Static**: Fully live.
- **Single-page vs Gallery**: Single-page landing with multi-page docs.
- **Framework used**: React/Next.js (Framer/Spring), Vanilla/Vue (Anime.js).
- **Where they live**: Separate repos for marketing sites.
- **Best**: High emotional impact; they make you *want* to use the library because the landing page feels so satisfying to interact with.
- **Worst**: Can be highly CPU-intensive, occasionally stuttering on mobile.
- **Fit for our constraints**: Strong. The tactile, bouncy, and playful feel of Framer Motion and React Spring aligns perfectly with our Sokpop-inspired aesthetic.

#### 7. d3.js (Observable Plot/Gallery)
- **Source**: [d3js.org](https://d3js.org/)
- **What it looks like**: A dense grid of static SVG/Canvas thumbnails on the homepage, linking to live Observable Notebooks.
- **Live vs Static**: Homepage is static; notebooks are live.
- **Single-page vs Gallery**: Multi-page gallery.
- **Framework used**: React/Observable.
- **Where it lives**: Separate platform (Observable).
- **Best**: The notebooks are fully reactive; changing a line of code instantly re-renders the chart and updates downstream variables.
- **Worst**: Requires learning the custom Observable notebook syntax, which differs slightly from standard JavaScript.
- **Fit for our constraints**: Medium. We want the reactivity of Observable but in standard, copy-pasteable TypeScript.

#### 8. Konva & Fabric.js (Canvas Libraries)
- **Source**: [konvajs.org](https://konvajs.org/), [fabricjs.com](https://fabricjs.com/)
- **What they look like**: Documentation-first sites. Fabric.js has an interactive canvas where you can draw shapes, drag them, and see the object model JSON update live.
- **Live vs Static**: Fully live.
- **Single-page vs Gallery**: Multi-page documentation.
- **Framework used**: Vanilla JS/Jekyll.
- **Best**: Fabric's live JSON inspector is incredibly useful for understanding the underlying data structure.
- **Worst**: Visually dated (looks like 2012-era Bootstrap).
- **Fit for our constraints**: Strong data-visualization pattern. Showing the underlying parameters (like our `SkinPreset` JSON) mutate live alongside the character is a great pattern.

#### 9. Excalidraw & tldraw (Canvas Products)
- **Source**: [excalidraw.com](https://excalidraw.com/), [tldraw.dev](https://tldraw.dev/)
- **What they look like**: The landing page *is* the product. You land on a full-screen, fully interactive infinite canvas.
- **Live vs Static**: Fully live.
- **Single-page vs Gallery**: Single-page application.
- **Framework used**: React.
- **Where it lives**: In-repo (the main product codebase).
- **Best**: Zero friction. You are using the library's core capabilities within 1 second of loading the page.
- **Worst**: No traditional "marketing" content above the fold; users who want to read about features must find the separate `/docs` link.
- **Fit for our constraints**: Strong. Proves the power of "eating your own dogfood" by building the showcase UI using the library itself.

---

### Category B: Generative & Procedural Art Presentation

#### 1. OpenProcessing
- **Source**: [openprocessing.org](https://openprocessing.org/)
- **What it looks like**: A social network masonry grid of sketches. Clicking a sketch runs it full-screen with a "Show Code" split-screen drawer.
- **Best**: High community engagement; code is fully editable and forkable inline.
- **Worst**: Visual quality is highly variable since it's user-generated content.

#### 2. Generative Hut (by Tim Holman)
- **Source**: [generativehut.com](https://www.generativehut.com/)
- **What it looks like**: A highly curated, beautiful grid of generative art pieces, focusing on physical pen plotters and digital art.
- **Best**: Pristine, high-fidelity presentation; feels like an art gallery.
- **Worst**: Entirely static (images/videos); no code or live generation.

#### 3. itch.io Generative Tags
- **Source**: [itch.io/games/tag-generative](https://itch.io/games/tag-generative)
- **What it looks like**: Standard itch.io grid of game cards.
- **Best**: Shows real-world, playable applications of generative algorithms.
- **Worst**: No code access; highly fragmented.

#### 4. Sokpop Collective Catalog & Game Pages
- **Source**: [sokpop.itch.io](https://sokpop.itch.io/)
- **What it looks like**: A colorful, chaotic, highly stylized grid of ~100 games.
- **Best**: Masterclass in minimalist marketing. Each game page starts with a prominent, looping gameplay GIF that conveys the "vibe" instantly. Whimsical, short descriptions focus on the "toy-like" nature of the games.
- **Worst**: No live playable web builds for most games (they must be downloaded).
- **Fit for our constraints**: Canonical aesthetic reference. The showcase must feel like a Sokpop game page: warm, playful, and visual-first.

#### 5. JS13k Winners / Awwwards Generative Entries
- **Source**: [js13kgames.com](https://js13kgames.com/)
- **What they look like**: Simple lists or highly polished, award-winning sites.
- **Best**: JS13k proves that extreme constraints (under 13KB) lead to incredible procedural rendering that loads instantly.
- **Worst**: Awwwards entries are often over-engineered, heavy, and fail on mobile.

#### 6. Are.na Generative Channels
- **Source**: [are.na/block/243912](https://www.are.na/)
- **What it looks like**: Minimalist, text-and-image grid serving as a collaborative mood board.
- **Best**: Excellent for visual inspiration and mapping conceptual connections.
- **Worst**: No interactivity or code execution.

---

### Category C: Modern Dev-Tool Landing Pages

#### 1. Linear, Vercel, Resend, Clerk, Cal.com, Supabase, Railway
- **What they look like**: Ultra-polished, dark-themed, high-performance layouts. They embed live interactive widgets (e.g., Resend's email builder, Clerk's auth form, Cal.com's booking calendar, Supabase's SQL editor) directly inline in the scroll experience.
- **Best**: They make abstract developer tools *tangible*. Instead of reading about "fast scheduling," you click a date and experience it.
- **Worst**: Highly complex to build and maintain; often requires mock backends.
- **Fit for our constraints**: Strong. Embedding a live, interactive "slime-knight" character customizer or an IK leg-dragger inline in the scroll experience will make our library instantly tangible.

---

## Answers to the 10 Questions

### 1. Live vs static:
The best rendering-library showcases run code live in the browser (e.g., p5.js, Pixi.js, Framer Motion, tldraw).
- **Live running code**:
  - *Pros*: Proves performance, allows interactive scrubbing, lets developers copy-paste and tweak code instantly.
  - *Cons/Failure modes*: Heavy CPU/GPU load, browser crashes on mobile, loading spinners, compilation/rendering errors if the user edits code incorrectly.
- **Pre-rendered GIFs/screenshots** (e.g., Generative Hut, Sokpop Collective):
  - *Pros*: 100% reliable, loads instantly, looks exactly as intended, zero performance overhead.
  - *Cons/Failure modes*: Static, passive, doesn't prove the code actually runs, doesn't allow interaction or parameter tweaking.
- *Verdict*: A hybrid approach is best. Use lightweight, optimized live Canvas2D renders for interactive sections, and fallback to crisp, looping WebP/GIFs if rendering fails or on low-end mobile devices.

### 2. Single long-scroll vs multi-page gallery:
- **Single long-scroll**: Dominates modern landing pages (e.g., Resend, Linear, Anime.js). It wins when you need to tell a cohesive story, guide the user through features sequentially, and build excitement before showing the documentation.
- **Multi-page gallery**: Dominates mature libraries (e.g., three.js, Phaser, d3.js). It wins when the library has hundreds of distinct APIs and the user is looking for a specific recipe or test case.
- *Verdict*: For `aicraft-engine`, a **single-page interactive landing page** that tells the story of the library (Pillars 1 to 4) is the winning structure. It should have a prominent link to a separate, clean documentation/gallery page for deep dives.

### 3. Framework choice:
Peers overwhelmingly choose **React / Next.js** or **Svelte** for the showcase site itself (e.g., Framer Motion, React Spring, Pixi.js, Babylon.js), even when the library is framework-agnostic.
- *Why*: State management is highly complex when linking sliders, code editors, and canvas outputs. React/Svelte makes syncing these states (e.g., updating a slider updates the code snippet, which updates the canvas) trivial.
- *For aicraft-engine*: Since our library is framework-agnostic and zero-dependency, we should build the showcase using a lightweight, fast, vanilla-friendly framework or static site generator. **Vite + Vanilla TS** or **Astro + Svelte/React** is the ideal choice. It keeps the showcase incredibly fast, lightweight, and aligned with our "zero-bloat" philosophy.

### 4. In-repo vs separate:
- **In-repo**: Dominates open-source libraries (e.g., three.js, tldraw, Excalidraw). The showcase lives in a `/docs` or `/showcase` folder in the same repository.
- *Why*: It ensures the showcase is always in sync with the latest library code. When a developer submits a PR that changes an API, they can update the showcase in the same PR.
- *Deploy strategy*: Deployed automatically via **GitHub Actions** to **GitHub Pages** or **Vercel** on every push to `main`. This is the perfect fit for `aicraft-engine`.

### 5. Determinism communication:
Communicating "same seed = same output" is a green field — very few showcases do this well.
- *How Art Blocks does it*: Displays the transaction hash (seed) prominently. Clicking "Re-render" draws the exact same image pixel-by-pixel.
- *How we can make it tangible*:
  - Present a split-screen or dual-canvas view.
  - Canvas A and Canvas B both run the same procedural generation code.
  - Provide a "Seed" text input. If both canvases use the same seed, they render identical characters (e.g., identical slime-knights, identical walking animations).
  - Provide a "Desynchronize" button that lets Canvas B use a different seed. Watch them diverge.
  - Provide a "Seed History" list. Clicking a previous seed restores the exact same visual, proving byte-identical stability.

### 6. Seed-scrubbing UX:
In generative art, continuous sliders are terrible for seeds because seeds are discrete integers that produce discontinuous outputs.
- *Best Practice UX*:
  - A text input showing the current seed (e.g., `#98724`).
  - A prominent **Randomize** button (die icon 🎲) that rolls a new seed.
  - A **Copy Link** button that appends `?seed=98724` to the URL, allowing users to share their exact creation.
  - For *continuous parameters* (like IK target position, walk speed, gravity, color chroma), use smooth, tactile sliders.

### 7. Code-alongside-output:
Yes, the best showcases show the code inline (e.g., p5.js, Tailwind, Resend).
- *How it is framed*: A split-pane layout.
- *Left*: A syntax-highlighted, read-only (or editable) code block showing the exact library calls (e.g., `outlineRect(ctx, x, y, ...)`, `solveLimb(...)`).
- *Right*: The live canvas rendering the output.
- *Interactive Link*: When the user adjusts a slider (e.g., changing the `boneLength` from `40` to `60`), the code block's text mutates in real-time to show `boneLength: 60`. This creates an instant mental mapping between the code and the visual.

### 8. Failure modes:
- **High CPU/GPU usage**: Freezing the browser, especially on mobile.
- **Slow initial load**: Loading heavy JS bundles or assets, contradicting the "minimalist" pitch.
- **API mismatch**: The code shown alongside the demo doesn't match the current version of the library.
- **Lack of mobile touch support**: Sliders or canvas interactions that don't work on phones.
- **Obfuscated code**: Showing a demo but hiding the source code behind layers of build tools.

### 9. "Eat your own dogfood" pattern:
Yes, tldraw and Excalidraw are the ultimate examples.
- *For aicraft-engine*: We can draw the showcase's UI elements (like button borders, panel dividers, slider handles, and tooltips) using our own `outlineRect` and `shade` primitives on a Canvas2D overlay. This makes the entire page feel like a cohesive, tactile, Sokpop-style game.

### 10. The Sokpop aesthetic specifically:
- **Color Palettes**: Warm, earthy, low-fidelity, pastel yet vibrant. 4-5 colors per palette.
- **Outline Weight**: Thick, prominent, pixel-snapped outlines (1px or 2px dark-purple `#1d1128` outlines).
- **Character Proportions**: Cute, stubby, chibified. Big heads, tiny limbs, no necks, stubby bodies.
- **Typography**: Whimsical, hand-drawn, or chunky retro pixel fonts (e.g., "Silkscreen" or custom SVG paths).
- **Animation Style**: Bouncy, organic, highly physical. Heavy use of squash and stretch, Verlet spring secondary motion (tails, floppy hats, hair), procedural walking (feet lifting and bobbing), and horizontal "turning" squash (simulating 3D rotation by squashing 2D elements horizontally).
- **Flat Shading**: No gradients, no soft shadows. Shading is done using flat, darker shapes (parallelograms for cubes, crescent shapes for spheres) with sharp edges.

---

## Top 3 Patterns Worth Adopting

### 1. The Live-Mutating Code Sandbox (Split-Pane UX)
- **Rationale**: Developers want to see the code that produces the visual. By linking sliders directly to code text mutation, we create an immediate, satisfying mental model of how the library works.
- **Implementation**: A split-pane layout where adjusting a slider (e.g., `boneLength` or `chroma`) mutates the code snippet text in real-time while updating the Canvas2D render.

### 2. The Dual-Canvas Determinism Prover
- **Rationale**: Determinism is our killer feature. Showing two canvases side-by-side that render identical complex procedural characters/animations when sharing a seed—and instantly diverge when desynchronized—makes our core thesis tangible and undeniable.
- **Implementation**: Two side-by-side canvases running the same procedural generation code. A "Seed" input controls both. A "Desynchronize" button rolls a different seed for Canvas B, showing them diverge. A "Seed History" list lets users click previous seeds to see them snap back to identical states.

### 3. The "Dogfooded" Sokpop UI Chrome
- **Rationale**: It proves the library's utility for building complete, cohesive games. By drawing the showcase's buttons, sliders, and panels using `outlineRect` and `shade`, we demonstrate that our primitives are powerful enough to build a beautiful, tactile user interface.
- **Implementation**: Render the interactive UI elements (borders, sliders, panels) directly onto a Canvas2D overlay using `outlineRect` and `shade` with a 2px dark-purple outline, matching the Sokpop aesthetic.

---

## Anti-Patterns to Avoid

- **No Heavy 3D Engines**: Do not load Three.js or Babylon.js for the showcase. It contradicts our "zero-dependency, Canvas2D-only" philosophy.
- **No Continuous Seed Sliders**: Never use a continuous slider for seeds. It creates a jumpy, jarring visual experience. Use a die icon and a text input instead.
- **No Static-Only Presentation**: Do not rely solely on static screenshots or GIFs. It fails to prove that our library is highly performant and interactive.

---

## Sokpop Aesthetic Cheat-Sheet

- **Outlines**: Always 1px or 2px, solid dark-purple `#1d1128` or `#121214`. Never anti-aliased or soft.
- **Fills**: Flat, solid colors. No gradients.
- **Shading**: Hand-drawn, flat, darker shapes with sharp edges.
- **Proportions**: Head height $\approx$ torso height. Big eyes, stubby limbs.
- **Physics**: Secondary motion on everything. Tails, ears, and hair must sway using Verlet springs.

---

## Reference Implementations

- [p5.js Examples](https://p5js.org/examples/) — Teaches split-screen code-alongside-canvas layout.
- [tldraw.dev](https://tldraw.dev/) — Teaches full-screen "dogfooding" of canvas primitives.
- [Art Blocks](https://www.artblocks.io/) — Teaches seed-to-output determinism communication.

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| `benchmarks/palette/in-game-shapes.png` | Cute, retro slime-knight character showing outline visibility and feature pop | Local |
| `benchmarks/animation/gallery.png` | 3x2 composite of all six benchmark scenes, showing IK, springs, and locomotion | Local |

---

## Open Questions

- **Performance on Mobile**: Can we run multiple live Canvas2D instances (e.g., the dual-canvas prover + the interactive sandbox) at 60 FPS on lower-end mobile devices? We should profile this during prototyping.
- **Code Editing Scope**: Should the inline code blocks be fully editable (using a lightweight editor like CodeMirror) or read-only with slider-driven mutation? Read-only with slider-driven mutation is much lighter and less prone to user syntax errors.

---

## Cross-References

- `docs/research/algorithmic-palette-substitution.md` — Core color and contrast repair research.
- `docs/research/algorithmic-skin-variation.md` — Core cosmetics and skin manifest research.
