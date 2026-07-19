import { describe, it, expect } from 'vitest';
import { allocateEntityId } from '../level/entity-id';
import { DEFAULT_ENTITY_ID_START } from '../level/constants';
import type { LevelData } from '../level/types';

function makeLevel(nextEntityId: number): LevelData {
  return {
    version: 1,
    id: 'test',
    name: 'Test',
    width: 100,
    height: 100,
    tileSize: 10,
    spawn: { x: 10, y: 10 },
    tiles: { data: [], cols: 0, rows: 0, tileSize: 10 },
    entities: [],
    nextEntityId,
  };
}

describe('allocateEntityId', () => {
  it('returns the current nextEntityId as the allocated id', () => {
    const level = makeLevel(7);
    const result = allocateEntityId(level);
    expect(result.id).toBe(7);
  });

  it('returns nextEntityId + 1 as the new counter', () => {
    const level = makeLevel(7);
    const result = allocateEntityId(level);
    expect(result.nextEntityId).toBe(8);
  });

  it('produces monotonically increasing IDs across allocations', () => {
    const level = makeLevel(3);
    const a = allocateEntityId(level);
    const next: LevelData = { ...level, nextEntityId: a.nextEntityId };
    const b = allocateEntityId(next);
    const nextNext: LevelData = { ...next, nextEntityId: b.nextEntityId };
    const c = allocateEntityId(nextNext);
    expect(a.id).toBe(3);
    expect(b.id).toBe(4);
    expect(c.id).toBe(5);
    expect(c.nextEntityId).toBe(6);
  });

  it('falls back to DEFAULT_ENTITY_ID_START when nextEntityId is non-numeric', () => {
    const level = makeLevel(7);
    (level as unknown as { nextEntityId: unknown }).nextEntityId = 'not a number';
    const result = allocateEntityId(level);
    expect(result.id).toBe(DEFAULT_ENTITY_ID_START);
    expect(result.nextEntityId).toBe(DEFAULT_ENTITY_ID_START + 1);
  });

  it('falls back to DEFAULT_ENTITY_ID_START when nextEntityId is NaN', () => {
    const level = makeLevel(NaN);
    const result = allocateEntityId(level);
    expect(result.id).toBe(DEFAULT_ENTITY_ID_START);
  });

  it('falls back to DEFAULT_ENTITY_ID_START when nextEntityId is Infinity', () => {
    const level = makeLevel(Infinity);
    const result = allocateEntityId(level);
    expect(result.id).toBe(DEFAULT_ENTITY_ID_START);
  });

  it('does not mutate the input level', () => {
    const level = makeLevel(5);
    allocateEntityId(level);
    expect(level.nextEntityId).toBe(5);
  });

  it('floors a non-integer nextEntityId', () => {
    const level = makeLevel(4.9);
    const result = allocateEntityId(level);
    expect(result.id).toBe(4);
    expect(result.nextEntityId).toBe(5);
  });
});
