import { describe, expect, it } from 'vitest';
import { createGeneratedRoomScene } from '../sections/tile-room-fixtures';
import { hashTileRoomScene, parseTileRoomScene, serializeTileRoomScene } from '../sections/tile-room-level-io';

describe('tile-room level persistence', () => {
  it('round-trips a complete scene with collision semantics', () => {
    const scene = createGeneratedRoomScene();
    const parsed = parseTileRoomScene(serializeTileRoomScene(scene), scene);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(hashTileRoomScene(parsed.scene)).toBe(hashTileRoomScene(scene));
    expect(parsed.scene.id).toBe(scene.id);
  });

  it('accepts raw LevelData while retaining the active scene tab and semantics', () => {
    const scene = createGeneratedRoomScene();
    const parsed = parseTileRoomScene(JSON.stringify({ ...scene.level, name: 'Imported room' }), scene);
    expect(parsed).toMatchObject({ ok: true, scene: { id: scene.id, label: 'Imported room', tileSemantics: scene.tileSemantics } });
  });

  it('rejects malformed JSON and invalid levels with useful messages', () => {
    const scene = createGeneratedRoomScene();
    expect(parseTileRoomScene('{', scene)).toEqual({ ok: false, error: 'That file is not valid JSON.' });
    const invalid = parseTileRoomScene(JSON.stringify({ ...scene.level, entities: [] }), scene);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error).toContain('spawn');
  });
});
