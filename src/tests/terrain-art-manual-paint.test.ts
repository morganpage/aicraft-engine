import { describe, expect, it } from 'vitest';
import {
  clearTerrainArtSourceTileEdits,
  createTerrainArtProject,
  editTerrainArtSourceTile,
  renderTerrainArtSourceTile,
  updateTerrainArtGenerator,
} from '../index';

describe('terrain art manual painting', () => {
  it('stores compact runs and updates the composed source tile', () => {
    const source = createTerrainArtProject({ authoringResolution: 16 });
    const edited = editTerrainArtSourceTile(source, 'solid', 'manual', 15, 'default', [
      { x: 3, y: 4, mode: 'paint', colorRef: 'accent' },
      { x: 4, y: 4, mode: 'paint', colorRef: 'accent' },
    ]);
    const manual = edited.materials[0]!.layers.find((layer) => layer.id === 'manual')!;
    expect(manual.patches?.[0]?.runs).toEqual([
      { x: 3, y: 4, length: 2, mode: 'paint', colorRef: 'accent' },
    ]);
    const tile = renderTerrainArtSourceTile(edited, 'solid', 15);
    expect([...tile.pixels.slice((4 * 16 + 3) * 4, (4 * 16 + 3) * 4 + 3)]).toEqual([244, 211, 94]);
  });

  it('supports inherit and complete tile revert without changing procedural settings', () => {
    const source = createTerrainArtProject({ authoringResolution: 16 });
    const painted = editTerrainArtSourceTile(source, 'solid', 'manual', 15, 'default', [
      { x: 3, y: 4, mode: 'paint', rgba: 0xff0000ff },
      { x: 4, y: 4, mode: 'paint', rgba: 0xff0000ff },
    ]);
    const inherited = editTerrainArtSourceTile(painted, 'solid', 'manual', 15, 'default', [
      { x: 3, y: 4, mode: 'inherit' },
    ]);
    expect(inherited.materials[0]!.layers.find((layer) => layer.id === 'manual')!.patches?.[0]?.runs[0]).toMatchObject({ x: 4, length: 1 });
    const cleared = clearTerrainArtSourceTileEdits(inherited, 'solid', 'manual', 15, 'default');
    expect(cleared.materials[0]!.layers.find((layer) => layer.id === 'manual')!.patches).toEqual([]);
    expect(cleared.materials[0]!.generator).toEqual(source.materials[0]!.generator);
  });

  it('regenerates beneath manual pixels without changing their sparse patch', () => {
    const source = createTerrainArtProject({ authoringResolution: 16 });
    const painted = editTerrainArtSourceTile(source, 'solid', 'manual', 15, 'default', [
      { x: 8, y: 8, mode: 'paint', colorRef: 'accent' },
    ]);
    const regenerated = updateTerrainArtGenerator(painted, 'solid', { roundness: 1, contourWidth: 2 });
    const before = painted.materials[0]!.layers.find((layer) => layer.id === 'manual')!.patches;
    const after = regenerated.materials[0]!.layers.find((layer) => layer.id === 'manual')!.patches;
    expect(after).toEqual(before);
    expect(regenerated.materials[0]!.generator).toMatchObject({ roundness: 1, contourWidth: 2 });
  });
});
