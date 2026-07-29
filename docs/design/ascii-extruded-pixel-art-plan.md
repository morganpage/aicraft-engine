# ASCII-Authored Extruded Pixel Art Plan

## Status

- Status: Proposed
- Target module: `src/fake3d/`
- Target release: First partial delivery of Fake-3D
- Runtime dependencies: None
- Built-in renderer: None in v1
- Intended consumers: Three.js, Babylon.js, WebGL, WebGPU, or custom renderers

## Objective

Add a deterministic workflow that turns ASCII art defined in TypeScript into renderer-neutral, indexed 3D mesh data.

```text
ASCII definition
    |
    v
validated pixel asset
    |
    v
extruded mesh + material metadata
    |
    v
consumer-owned Three.js BufferGeometry
```

The same validated cells can produce deterministic debris descriptors when the object is destroyed.

## Locked Decisions

| Decision | Choice |
|---|---|
| Rendering target | Renderer-neutral mesh data |
| Three.js dependency | None; Three.js remains consumer-owned |
| Initial scope | Static extruded assets and debris descriptors |
| Asset metadata | Structured symbol legend |
| Animation | Deferred |
| 3D particle simulation | Deferred |
| Canvas2D fake-3D renderer | Deferred |
| Geometry model | Thin 2D pixel grid extruded along Z |
| Error policy | Never-throw result objects with diagnostics |
| Source format | TypeScript string rows, not external files |
| Mesh optimization | Internal-face culling and deterministic front/back run merging |

## Motivation

The current Fake-3D pillar is planned but unimplemented:

- `docs/architecture.md:90`
- `docs/api-surface.md:1855`
- `README.md:46`

The existing plan covers Canvas2D projection, cubes, billboards, and isometric tiles. This update expands the pillar to include deterministic renderer-neutral geometry.

The target workflow supports assets such as:

```ts
const bat = {
  rows: [
    '.....o.o.....',
    '....oWoWo....',
    'o...oWWWo...o',
    'oo.oWeEeWo.oo',
    'oWWooWWWooWWo',
    '.oWWoWWWoWWo.',
    '..oo.oWWWo.oo',
    '.....oWWo....',
    '......o......',
  ],
  empty: '.',
  symbols: {
    o: {
      materialId: 'outline',
      color: { type: 'hex', value: '#160f20' },
    },
    W: {
      materialId: 'body',
      color: { type: 'hex', value: '#6b4a8f' },
    },
    e: {
      materialId: 'eyes',
      color: { type: 'hex', value: '#ffd447' },
      emissive: true,
    },
    E: {
      materialId: 'feature',
      color: { type: 'palette', slot: 'feature' },
      emissive: true,
    },
  },
} satisfies AsciiArtDefinition;
```

## Non-Goals

- Do not add Three.js as a dependency or type dependency.
- Do not create `THREE.BufferGeometry`, materials, scenes, cameras, lights, or bloom passes.
- Do not implement a complete Minecraft-style voxel engine.
- Do not support multi-layer 3D voxel volumes in v1.
- Do not add skeletal or frame animation in v1.
- Do not simulate debris after its initial state is derived.
- Do not add collision geometry or destruction state management.
- Do not add transparent materials in v1.
- Do not add UVs or texture atlases in v1.
- Do not add a Canvas2D preview until the mesh compiler is stable.

## Architecture

### Layer Placement

ASCII validation, extrusion, mesh generation, and debris derivation belong to the deterministic core:

- No DOM access
- No renderer imports
- No `Math.random`
- No wall-clock reads
- No global mutable state
- No mutation of authoritative input

`docs/architecture.md` must identify renderer-neutral derived geometry as deterministic output intended only for renderers. It does not require a fourth runtime layer.

### Renderer Boundary

The engine returns plain data:

```text
aicraft-engine
  AsciiArtDefinition
  ParsedAsciiArt
  ExtrudedMeshData
  AsciiDebrisDescriptor[]

consumer
  THREE.BufferGeometry
  THREE.Material
  THREE.Mesh
  bloom
  lights
  shadows
  debris simulation
```

No public engine type may reference Three.js concepts beyond generic geometry vocabulary.

### README Scope Change

`README.md:4` currently describes the library as "Canvas2D-only." This must be revised to clarify:

> Built-in rendering helpers use Canvas2D. Deterministic geometry modules may also emit renderer-neutral data for consumer-owned 3D renderers.

This is an additive scope expansion, not permission to add a WebGL runtime dependency.

## Public API Draft

### Definitions

```ts
export type AsciiColorSource =
  | {
      readonly type: 'hex';
      readonly value: string;
    }
  | {
      readonly type: 'palette';
      readonly slot: keyof Palette;
    };

export interface AsciiArtSymbol {
  readonly materialId: string;
  readonly color: AsciiColorSource;
  readonly emissive?: boolean;
}

export interface AsciiArtDefinition {
  readonly rows: readonly string[];
  readonly empty: string;
  readonly symbols: Readonly<Record<string, AsciiArtSymbol>>;
}
```

### Parsed Asset

```ts
export interface AsciiArtCell {
  readonly index: number;
  readonly column: number;
  readonly row: number;
  readonly materialIndex: number;
}

export interface AsciiArtMaterial {
  readonly id: string;
  readonly color: string;
  readonly emissive: boolean;
}

export interface ParsedAsciiArt {
  readonly width: number;
  readonly height: number;
  readonly empty: string;
  readonly cells: readonly AsciiArtCell[];
  readonly materials: readonly AsciiArtMaterial[];
}

export interface AsciiArtIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

export interface ParseAsciiArtResult {
  readonly asset: ParsedAsciiArt | null;
  readonly issues: readonly AsciiArtIssue[];
}
```

### Parsing

```ts
export function parseAsciiArt(
  definition: AsciiArtDefinition,
  palette?: Palette,
): ParseAsciiArtResult;
```

`parseAsciiArt` validates and normalizes the source. It never throws and never mutates the definition or palette.

### Extrusion

```ts
export interface FaceShading {
  readonly front: number;
  readonly back: number;
  readonly side: number;
  readonly top: number;
  readonly bottom: number;
}

export interface ExtrudeAsciiArtOptions {
  readonly cellSize: number;
  readonly depth: number;
  readonly faceShading: FaceShading;
  readonly mergeFrontBackRuns: boolean;
}

export interface MeshGroup {
  readonly materialId: string;
  readonly emissive: boolean;
  readonly start: number;
  readonly count: number;
}

export interface MeshBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface ExtrudedCell {
  readonly sourceIndex: number;
  readonly position: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly materialId: string;
  readonly color: string;
  readonly emissive: boolean;
}

export interface ExtrudedMeshData {
  readonly positions: readonly number[];
  readonly normals: readonly number[];
  readonly colors: readonly number[];
  readonly indices: readonly number[];
  readonly groups: readonly MeshGroup[];
  readonly bounds: MeshBounds;
  readonly cells: readonly ExtrudedCell[];
}

export interface BuildExtrudedMeshResult {
  readonly mesh: ExtrudedMeshData | null;
  readonly issues: readonly AsciiArtIssue[];
}

export function buildExtrudedMesh(
  asset: ParsedAsciiArt,
  options?: Partial<ExtrudeAsciiArtOptions>,
): BuildExtrudedMeshResult;
```

### Debris

```ts
export interface AsciiDebrisOptions {
  readonly maxCount: number;
  readonly minSpeed: number;
  readonly maxSpeed: number;
  readonly verticalBias: number;
  readonly maxAngularSpeed: number;
  readonly minLifeTicks: number;
  readonly maxLifeTicks: number;
}

export interface AsciiDebrisDescriptor {
  readonly sourceIndex: number;
  readonly position: readonly [number, number, number];
  readonly velocity: readonly [number, number, number];
  readonly angularVelocity: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly materialId: string;
  readonly color: string;
  readonly emissive: boolean;
  readonly lifeTicks: number;
}

export function deriveAsciiDebris(
  cells: readonly ExtrudedCell[],
  seed: number,
  options?: Partial<AsciiDebrisOptions>,
): readonly AsciiDebrisDescriptor[];
```

Debris descriptors contain immutable initial conditions only. The consumer owns advancement, gravity, collisions, rendering, and cleanup.

## Default Configuration

Create exported defaults rather than embedding tunable values:

```ts
export const DEFAULT_FACE_SHADING: FaceShading = {
  front: 1,
  back: 0.62,
  side: 0.82,
  top: 1.06,
  bottom: 0.6,
};

export const DEFAULT_EXTRUDE_ASCII_ART_OPTIONS: ExtrudeAsciiArtOptions = {
  cellSize: 1,
  depth: 1,
  faceShading: DEFAULT_FACE_SHADING,
  mergeFrontBackRuns: true,
};
```

A separate `DEFAULT_ASCII_DEBRIS_OPTIONS` must hold all debris tuning.

## Coordinate Contract

The coordinate contract must be documented and golden-tested.

| Concept | Convention |
|---|---|
| Coordinate system | Right-handed |
| ASCII columns | Increase along +X |
| ASCII row 0 | Top of the asset |
| World vertical | +Y |
| Front direction | +Z |
| Extrusion | Centered between `-depth / 2` and `+depth / 2` |
| Asset origin | Center of the complete grid |
| Front face | +Z |
| Back face | -Z |
| Top face | +Y |
| Bottom face | -Y |
| Triangle winding | Counter-clockwise when viewed from outside |
| Normals | Flat, axis-aligned, outward-facing |

A cell center is calculated as:

```ts
x = (column - (width - 1) / 2) * cellSize;
y = ((height - 1) / 2 - row) * cellSize;
z = 0;
```

Consumers position, rotate, and scale the completed asset using their renderer.

## Validation Contract

`parseAsciiArt` must report errors for:

- Empty row arrays
- Zero-width assets
- Ragged rows
- Tabs or line breaks inside rows
- Non-printable or multi-character symbols
- Empty marker longer than one character
- Empty marker present in the symbol legend
- Grid characters missing from the legend
- Invalid hex colors
- Palette slots used without a supplied palette
- Duplicate or empty material IDs
- Conflicting descriptors sharing one material ID

`buildExtrudedMesh` must report errors for:

- Non-finite `cellSize`
- Non-positive `cellSize`
- Non-finite `depth`
- Non-positive `depth`
- Non-finite or negative shading multipliers
- Malformed parsed cells
- Invalid material indices

Unknown symbols must not silently become empty cells. Silent substitution can turn authoring mistakes into missing geometry.

## Mesh Format

Use flat numeric arrays compatible with graphics APIs without modeling the output after Three.js classes.

- `positions` contains XYZ triples.
- `normals` contains XYZ triples.
- `colors` contains RGB byte triples in the range `0..255`.
- `indices` contains triangle indices.
- `groups` refers to contiguous ranges in `indices`.
- `groups.start` and `groups.count` use index-array offsets.
- Color values are encoded as sRGB bytes.
- Integration documentation must explain renderer-specific color conversion.

Vertices should be shared only within a quad. Do not globally weld vertices because adjacent faces require different flat normals and shading colors.

## Mesh Generation Algorithm

### Occupancy

1. Build a row-major occupancy table from `ParsedAsciiArt.cells`.
2. Resolve each occupied cell to a material index.
3. Keep the logical table integer-based.
4. Apply floating-point scale only while emitting positions.

### Front And Back Faces

1. Scan each row from left to right.
2. Find contiguous runs using the same material.
3. Merge each run into one front quad and one back quad when `mergeFrontBackRuns` is enabled.
4. Emit individual cell quads when merging is disabled.
5. Split runs at empty cells, material changes, or emissive changes.

### Boundary Faces

1. Inspect the four grid neighbors of every occupied cell.
2. Emit left, right, top, or bottom faces only where the neighboring cell is empty or outside the grid.
3. Do not emit faces between adjacent occupied cells.
4. Generate both front and back surfaces because assets may rotate.

This is internal-face culling, not camera visibility or frustum culling.

### Triangulation

1. Emit four vertices per quad.
2. Emit two triangles using fixed winding.
3. Assign one flat normal to all four vertices.
4. Apply the configured face shading to the base material color.
5. Clamp resulting RGB channels to valid byte values.

### Grouping

1. Accumulate quads by material ID and emissive flag.
2. Sort groups by material ID, then emissive flag.
3. Flatten groups into arrays using stable face ordering.
4. Record contiguous index ranges in `MeshGroup`.
5. Do not include painter-order depth keys; a 3D renderer owns depth testing.

## Emissive Contract

Emissive is metadata only.

- The engine does not implement lighting.
- The engine does not choose a Three.js material.
- Emissive groups retain their normal color data.
- The consumer may assign unlit or emissive materials.
- The consumer controls brightness, bloom threshold, tone mapping, and post-processing.
- Emissive cells remain identifiable in debris descriptors.

An intensity field should be deferred until a second consumer demonstrates a shared need.

## Debris Determinism

`deriveAsciiDebris` operates from `ExtrudedCell[]`, not from merged mesh faces.

This preserves one debris item per authored pixel even when front and back geometry has been merged.

Required deterministic behavior:

- Use `mulberry32`; never use `Math.random`.
- Derive each cell's RNG seed from the user seed and `sourceIndex`.
- Keep one cell's velocity stable if unrelated cells are added elsewhere.
- Apply a fixed RNG draw order per descriptor.
- Use row-major source ordering for uncapped output.
- Use deterministic seeded selection when `maxCount` is lower than the cell count.
- Return fresh arrays and fresh descriptors.
- Never mutate cells or options.

No debris progression API is included in v1.

## File Plan

| File | Change |
|---|---|
| `docs/research/ascii-extruded-pixel-art.md` | Record prior art, terminology, and research sources |
| `docs/design/ascii-extruded-pixel-art-plan.md` | Add this implementation plan |
| `docs/architecture.md` | Classify renderer-neutral derived geometry and update Fake-3D status |
| `docs/api-surface.md` | Replace the planned Fake-3D stub with the agreed exports |
| `docs/integration.md` | Add a renderer-neutral and Three.js conversion example |
| `README.md` | Revise Canvas2D-only wording and Fake-3D scope/status |
| `src/fake3d/types.ts` | Public data contracts |
| `src/fake3d/constants.ts` | Default extrusion, shading, and debris options |
| `src/fake3d/ascii-art.ts` | Validation, palette resolution, and parsing |
| `src/fake3d/extrude.ts` | Internal-face culling, merging, and mesh emission |
| `src/fake3d/debris.ts` | Deterministic cell-to-debris derivation |
| `src/fake3d/index.ts` | Module barrel |
| `src/index.ts` | Root barrel export |
| `src/tests/fake3d-ascii-art.test.ts` | Parsing and validation tests |
| `src/tests/fake3d-extrude.test.ts` | Geometry and grouping tests |
| `src/tests/fake3d-debris.test.ts` | Determinism and descriptor tests |
| `src/tests/barrel-contract.test.ts` | Fake-3D public export assertion |

No `package.json` dependency or export-map change is required. npm consumers will import through the existing root package export.

## Implementation Phases

### Phase 1: Documentation And Contract

1. Add the research record.
2. Add this plan.
3. Update the architecture classification.
4. Resolve Fake-3D pillar numbering drift between README and API documentation.
5. Update `docs/api-surface.md` with the locked public API.
6. Mark Fake-3D as partially implemented only after source ships.

### Phase 2: Parser And Validation

1. Write failing tests for valid and malformed definitions.
2. Implement color-source resolution.
3. Implement palette-slot resolution.
4. Implement row and symbol validation.
5. Produce immutable row-major cells and stable material ordering.
6. Verify input objects are not mutated.

### Phase 3: Basic Extrusion

1. Write failing single-cell geometry tests.
2. Implement coordinate conversion and centered origin.
3. Emit all six outward faces for one cell.
4. Verify normals, winding, bounds, and colors.
5. Add adjacent-cell internal-face tests.
6. Implement internal-face removal.

### Phase 4: Run Merging And Grouping

1. Add same-material front/back run fixtures.
2. Add material-boundary and empty-cell fixtures.
3. Implement deterministic horizontal run merging.
4. Implement stable material and emissive grouping.
5. Verify merged and unmerged meshes cover equivalent surfaces.

### Phase 5: Debris Descriptors

1. Write seed golden tests before implementation.
2. Derive world-space debris from `ExtrudedCell`.
3. Implement per-cell independent seeded RNG.
4. Add deterministic cap selection.
5. Verify exact color, emissive, size, position, and material preservation.
6. Verify different seeds change motion while source geometry remains unchanged.

### Phase 6: Integration Documentation

1. Document conversion to `THREE.BufferGeometry`.
2. Document construction of one material per mesh group.
3. Document emissive material assignment.
4. Document sRGB-to-renderer color handling.
5. Document consumer-owned resource disposal.
6. Document that collision and debris advancement remain consumer responsibilities.

### Phase 7: Final Verification

1. Run focused Fake-3D tests.
2. Run the barrel contract.
3. Run the complete unit suite.
4. Run strict TypeScript checks.
5. Build distributable output.
6. Verify npm package contents.
7. Review public JSDoc and API documentation for drift.

## Test Matrix

### Parsing

- Valid rectangular asset
- Empty asset
- Empty rows
- Ragged rows
- Unknown symbol
- Duplicate material ID
- Invalid empty marker
- Tab characters
- Non-ASCII symbols
- Invalid hex color
- Valid palette reference
- Missing palette
- Input immutability
- Stable material ordering
- Never-throw malformed input

### Geometry

- Single pixel produces six quads and twelve triangles
- Adjacent horizontal pixels remove two internal faces
- Adjacent vertical pixels remove two internal faces
- Disconnected pixels retain separate boundaries
- Holes remain empty
- Front normal is `+Z`
- Back normal is `-Z`
- Top normal is `+Y`
- Bottom normal is `-Y`
- Left normal is `-X`
- Right normal is `+X`
- All triangle windings face outward
- Asset is centered around the origin
- Bounds match exact cell dimensions
- Face shading matches golden RGB values
- No `NaN`, infinity, or negative zero
- Repeated builds are deeply identical

### Merging

- Same-material horizontal cells merge
- Different materials do not merge
- Emissive and non-emissive cells do not merge
- Empty cells split runs
- Merging can be disabled
- Merged output covers the same exterior surface
- Stable group and triangle ordering

### Debris

- One descriptor per occupied cell by default
- Position matches the corresponding cell center
- Size matches `cellSize` and depth
- Material and color are preserved
- Emissive metadata is preserved
- Same seed produces exact golden output
- Different seeds produce different motion
- Unrelated cell changes do not perturb existing cell motion
- `maxCount` is respected deterministically
- Empty cells never produce debris
- Input cells and options remain unchanged

### Public Surface

- `parseAsciiArt` exported from `src/fake3d`
- `buildExtrudedMesh` exported from `src/fake3d`
- `deriveAsciiDebris` exported from `src/fake3d`
- Fake-3D exports available from `src/index.ts`
- Type-only exports compile through the public barrel
- Distribution declarations expose all public contracts

## Three.js Integration Example

Documentation should show consumer code similar to:

```ts
const geometry = new THREE.BufferGeometry();

geometry.setAttribute(
  'position',
  new THREE.Float32BufferAttribute(mesh.positions, 3),
);

geometry.setAttribute(
  'normal',
  new THREE.Float32BufferAttribute(mesh.normals, 3),
);

const colors = convertSrgbBytesToThreeColors(mesh.colors);

geometry.setAttribute(
  'color',
  new THREE.Float32BufferAttribute(colors, 3),
);

geometry.setIndex(mesh.indices);

for (const group of mesh.groups) {
  geometry.addGroup(group.start, group.count, materialIndexById[group.materialId]);
}
```

This example belongs in integration documentation, not in library source or tests.

## Risks And Mitigations

| Risk | Mitigation |
|---|---|
| Canvas2D-only scope conflict | Update README and architecture before declaring the feature shipped |
| Three.js coupling | Expose only plain arrays and neutral group metadata |
| Geometry orientation bugs | Lock coordinates, normals, and winding with golden tests |
| Hidden malformed ASCII | Return positional diagnostics instead of silently treating symbols as empty |
| Vertex-normal conflicts | Share vertices only within individual flat-shaded quads |
| Excessive geometry | Cull internal side faces and merge front/back runs |
| Material-group instability | Sort groups and document stable emission order |
| Debris changes after asset edits | Seed each descriptor independently from source index |
| Palette too restrictive | Support both direct configured hex colors and semantic palette slots |
| Transparent sorting complexity | Keep v1 materials opaque |
| Scope expansion into physics | Return initial descriptors only; consumer owns simulation |
| Premature voxel-engine complexity | Keep v1 to a single 2D grid extruded along Z |

## Acceptance Criteria

The update is complete when:

- A TypeScript ASCII definition compiles into deterministic mesh arrays.
- No Three.js or other runtime dependency is introduced.
- Internal faces between neighboring pixels are absent.
- Front and back runs merge without crossing material boundaries.
- All six exterior face directions render correctly when the object rotates.
- Colors and emissive flags survive parsing, extrusion, and debris derivation.
- Debris descriptors reproduce exactly for the same seed.
- Public functions never throw on malformed input.
- Existing inputs are never mutated.
- Fake-3D exports are available from module and root barrels.
- API documentation matches the shipped source.
- The complete test suite and strict typecheck pass.

## Verification Commands

```bash
npm test -- src/tests/fake3d-ascii-art.test.ts
npm test -- src/tests/fake3d-extrude.test.ts
npm test -- src/tests/fake3d-debris.test.ts
npm test -- src/tests/barrel-contract.test.ts
npm test
npm run build
npm run build:dist
npm run showcase:typecheck
npm run showcase:test
npm run showcase:build
npm pack --dry-run
```
