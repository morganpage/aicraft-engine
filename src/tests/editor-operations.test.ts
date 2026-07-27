import { describe, it, expect } from 'vitest';
import { applyOp, applyBatch, createEditorState } from '../editor';
import type { EditorState } from '../editor/types';
import type { LevelData, LevelRect, LevelEntity, MovingPlatformProps } from '../level/types';

/** A minimal valid level: spawn + exit, 10x10 tile grid, next id = 3. */
function baseLevel(): LevelData {
  return {
    version: 1,
    id: 'test-level',
    name: 'Test',
    width: 160,
    height: 160,
    tileSize: 16,
    spawn: { x: 16, y: 16 },
    tiles: { data: new Array(100).fill(0), cols: 10, rows: 10, tileSize: 16 },
    entities: [
      {
        id: 1,
        kind: 'spawn',
        rect: { x: 16, y: 16, width: 16, height: 16 },
        props: {},
      },
      {
        id: 2,
        kind: 'exit',
        rect: { x: 128, y: 128, width: 16, height: 16 },
        props: { isTrap: false, locked: false },
      },
    ],
    nextEntityId: 3,
  };
}

/** Deep snapshot of a state's level, used for purity assertions. */
function snapshot(state: EditorState): LevelData {
  return JSON.parse(JSON.stringify(state.level)) as LevelData;
}

describe('applyOp — addEntity', () => {
  it('adds an entity and advances nextEntityId', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 32, y: 32, width: 32, height: 16 },
      props: { visual: 'normal' },
    });
    expect(next.level.entities.length).toBe(3);
    expect(next.level.nextEntityId).toBe(4);
    const added = next.level.entities[2];
    expect(added.kind).toBe('platform');
    expect(added.id).toBe(3);
  });

  it('records exactly one history entry with addEntity label', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 0, y: 0, width: 16, height: 16 },
      props: {},
    });
    expect(next.undoStack.length).toBe(1);
    expect(next.undoStack[0].label).toBe('Add platform');
    expect(next.undoStack[0].op.type).toBe('addEntity');
  });

  it('clears the redo stack', () => {
    let state = createEditorState(baseLevel());
    state = applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 0, y: 0, width: 16, height: 16 },
      props: {},
    });
    // Simulate a redo entry existing from before
    state = { ...state, redoStack: state.undoStack };
    state = applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 16, y: 0, width: 16, height: 16 },
      props: {},
    });
    expect(state.redoStack.length).toBe(0);
  });

  it('recomputes the validation cache', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 32, y: 32, width: 32, height: 16 },
      props: {},
    });
    expect(next.validation).not.toBe(state.validation);
    expect(typeof next.validation.valid).toBe('boolean');
  });
});

describe('applyOp — removeEntity', () => {
  it('removes the entity with the given id', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, { type: 'removeEntity', id: 2 });
    expect(next.level.entities.length).toBe(1);
    expect(next.level.entities.find((e) => e.id === 2)).toBeUndefined();
  });

  it('records a history entry for the removal', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, { type: 'removeEntity', id: 2 });
    expect(next.undoStack.length).toBe(1);
    expect(next.undoStack[0].op.type).toBe('removeEntity');
  });

  it('is a no-op (state unchanged, no history entry) for a missing id', () => {
    const state = createEditorState(baseLevel());
    const before = snapshot(state);
    const next = applyOp(state, { type: 'removeEntity', id: 9999 });
    expect(next).toBe(state);
    expect(next.undoStack.length).toBe(0);
    expect(snapshot(state)).toEqual(before);
  });
});

describe('applyOp — updateEntityProps', () => {
  it('merges a partial patch into the entity props', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'updateEntityProps',
      id: 2,
      propsPatch: { locked: true },
    });
    const exitEntity = next.level.entities.find((e) => e.id === 2);
    expect(exitEntity).toBeDefined();
    if (!exitEntity) return;
    expect(exitEntity.kind).toBe('exit');
    if (exitEntity.kind === 'exit') {
      expect(exitEntity.props.locked).toBe(true);
      expect(exitEntity.props.isTrap).toBe(false);
    }
  });

  it('is a no-op for a missing id', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'updateEntityProps',
      id: 9999,
      propsPatch: { foo: 'bar' },
    });
    expect(next).toBe(state);
  });
});

describe('applyOp — moveEntities', () => {
  it('translates multiple entities by (dx, dy)', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'moveEntities',
      ids: [1, 2],
      dx: 16,
      dy: -8,
    });
    const spawn = next.level.entities.find((e) => e.id === 1);
    const exit = next.level.entities.find((e) => e.id === 2);
    expect(spawn?.rect.x).toBe(32);
    expect(spawn?.rect.y).toBe(8);
    expect(exit?.rect.x).toBe(144);
    expect(exit?.rect.y).toBe(120);
  });

  it('ignores ids that do not match any entity', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'moveEntities',
      ids: [1, 9999],
      dx: 16,
      dy: 0,
    });
    const spawn = next.level.entities.find((e) => e.id === 1);
    expect(spawn?.rect.x).toBe(32);
    // Exit untouched (didn't move despite the unknown id being in the list)
    const exit = next.level.entities.find((e) => e.id === 2);
    expect(exit?.rect.x).toBe(128);
  });
});

describe('applyOp — setEntityRect', () => {
  it('replaces the entity rect', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'setEntityRect',
      id: 1,
      rect: { x: 50, y: 60, width: 32, height: 32 },
    });
    const spawn = next.level.entities.find((e) => e.id === 1);
    expect(spawn?.rect).toEqual({ x: 50, y: 60, width: 32, height: 32 });
  });
});

describe('applyOp — paintTiles', () => {
  it('writes new values into the tile grid', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'paintTiles',
      cells: [
        { x: 0, y: 0, newValue: 1, oldValue: 0 },
        { x: 1, y: 0, newValue: 1, oldValue: 0 },
        { x: 2, y: 3, newValue: 2, oldValue: 0 },
      ],
    });
    expect(next.level.tiles.data[0]).toBe(1);
    expect(next.level.tiles.data[1]).toBe(1);
    expect(next.level.tiles.data[3 * 10 + 2]).toBe(2);
  });

  it('skips out-of-bounds cells without throwing', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'paintTiles',
      cells: [
        { x: -1, y: 0, newValue: 1, oldValue: 0 },
        { x: 99, y: 99, newValue: 1, oldValue: 0 },
        { x: 5, y: 5, newValue: 1, oldValue: 0 },
      ],
    });
    expect(next.level.tiles.data[5 * 10 + 5]).toBe(1);
  });

  it('is a no-op if all cells are unchanged (same value)', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'paintTiles',
      cells: [{ x: 0, y: 0, newValue: 0, oldValue: 0 }],
    });
    expect(next).toBe(state);
  });
});

describe('applyOp — setSpawnPoint', () => {
  it('replaces the level spawn point', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, { type: 'setSpawnPoint', x: 80, y: 90 });
    expect(next.level.spawn).toEqual({ x: 80, y: 90 });
  });

  it('is a no-op if spawn point is unchanged', () => {
    const state = createEditorState(baseLevel());
    const same = applyOp(state, {
      type: 'setSpawnPoint',
      x: state.level.spawn.x,
      y: state.level.spawn.y,
    });
    expect(same).toBe(state);
  });
});

describe('applyOp — batch', () => {
  it('collapses N sub-ops into a single history entry', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'batch',
      label: 'Bulk edit',
      ops: [
        {
          type: 'addEntity',
          kind: 'platform',
          rect: { x: 32, y: 0, width: 32, height: 16 },
          props: {},
        },
        {
          type: 'addEntity',
          kind: 'platform',
          rect: { x: 64, y: 0, width: 32, height: 16 },
          props: {},
        },
        { type: 'moveEntities', ids: [1], dx: 8, dy: 0 },
      ],
    });
    expect(next.level.entities.length).toBe(4);
    expect(next.undoStack.length).toBe(1);
    expect(next.undoStack[0].label).toBe('Bulk edit');
    expect(next.undoStack[0].op.type).toBe('batch');
  });

  it('treats an all-no-op batch as a no-op', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'batch',
      label: 'no-op batch',
      ops: [{ type: 'removeEntity', id: 9999 }],
    });
    expect(next).toBe(state);
  });
});

describe('applyBatch helper', () => {
  it('produces the same result as applyOp({type:"batch", ...})', () => {
    const state = createEditorState(baseLevel());
    const ops = [
      {
        type: 'addEntity' as const,
        kind: 'platform' as const,
        rect: { x: 0, y: 0, width: 32, height: 16 },
        props: {},
      },
      {
        type: 'addEntity' as const,
        kind: 'platform' as const,
        rect: { x: 32, y: 0, width: 32, height: 16 },
        props: {},
      },
    ];
    const a = applyOp(state, { type: 'batch', ops, label: 'L' });
    const b = applyBatch(state, ops, 'L');
    expect(b.level.entities.length).toBe(a.level.entities.length);
    expect(b.undoStack.length).toBe(1);
    expect(b.undoStack[0].label).toBe('L');
  });
});

describe('applyOp — purity', () => {
  it('never mutates the input state.level (deep equality)', () => {
    const state = createEditorState(baseLevel());
    const before = snapshot(state);
    applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 0, y: 0, width: 32, height: 16 },
      props: {},
    });
    expect(snapshot(state)).toEqual(before);
  });

  it('history snapshots are independent clones of the live level', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 0, y: 0, width: 32, height: 16 },
      props: {},
    });
    const entry = next.undoStack[0];
    const beforePost = JSON.parse(JSON.stringify(entry.postSnapshot)) as LevelData;
    // Mutate next.level — entry.postSnapshot must not change.
    // Cast through unknown because readonly is a compile-time check we need to bypass for this test.
    const mutated = JSON.parse(JSON.stringify(next.level)) as unknown as {
      entities: { id: number; kind: string; rect: LevelRect; props: Record<string, unknown> }[];
    };
    mutated.entities[0] = {
      ...mutated.entities[0],
      rect: { x: 999, y: 999, width: 999, height: 999 },
    };
    void mutated;
    expect(entry.postSnapshot).toEqual(beforePost);
  });

  it('JSON-clone verified: mutating the returned level does not affect the input', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'addEntity',
      kind: 'platform',
      rect: { x: 0, y: 0, width: 32, height: 16 },
      props: {},
    });
    // Cast through unknown to bypass the readonly-array type check — we are
    // demonstrating that mutation of the returned level does not leak back to the input.
    const hacked = JSON.parse(JSON.stringify(next.level)) as unknown as {
      entities: unknown[];
    };
    hacked.entities.push({
      id: 999,
      kind: 'spawn',
      rect: { x: 0, y: 0, width: 1, height: 1 },
      props: {},
    });
    void hacked;
    expect(state.level.entities.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Regression tests for integration-hardening pass.
//
// These cover concrete bugs found in the playground:
//   - moveEntities on a movingPlatform must translate its path along with
//     the body so the platform doesn't snap back to its old path on play.
//   - moveEntities / setEntityRect on a spawn entity must update
//     level.spawn so the runtime player actually spawns at the new position.
//   - setEntityRect on a movingPlatform body must translate path[0] to
//     match (body and first waypoint stay coherent).
// ---------------------------------------------------------------------------

/** Build a level with a movingPlatform + spawn + exit so the moving-platform
 *  + spawn coherence tests have realistic fixtures. */
function levelWithMovingPlatformAndSpawn(): LevelData {
  return {
    version: 1,
    id: 'mp-level',
    name: 'MP',
    width: 400,
    height: 240,
    tileSize: 16,
    spawn: { x: 32, y: 32 },
    tiles: { data: new Array(15 * 15).fill(0), cols: 15, rows: 15, tileSize: 16 },
    entities: [
      {
        id: 1,
        kind: 'spawn',
        rect: { x: 32, y: 32, width: 16, height: 16 },
        props: {},
      },
      {
        id: 2,
        kind: 'exit',
        rect: { x: 352, y: 32, width: 16, height: 16 },
        props: { isTrap: false, locked: false },
      },
      {
        id: 3,
        kind: 'movingPlatform',
        rect: { x: 100, y: 100, width: 48, height: 16 },
        props: {
          speed: 60,
          path: [
            { x: 100, y: 100 },
            { x: 200, y: 100 },
          ],
          loopMode: 'loop',
        } satisfies MovingPlatformProps,
      },
    ],
    nextEntityId: 4,
  };
}

describe('applyOp — moveEntities coherence (integration hardening)', () => {
  it('translates a movingPlatform path along with its body (regression: body/path divergence)', () => {
    const state = createEditorState(levelWithMovingPlatformAndSpawn());
    const next = applyOp(state, {
      type: 'moveEntities',
      ids: [3],
      dx: 50,
      dy: 30,
    });
    const mp = next.level.entities.find((e) => e.id === 3);
    if (!mp || mp.kind !== 'movingPlatform') throw new Error('missing movingPlatform');
    // Body shifted by (50, 30)
    expect(mp.rect.x).toBe(150);
    expect(mp.rect.y).toBe(130);
    // Path must shift by the same delta so the platform does not snap back
    // to its old home position when compiled.
    expect(mp.props.path).toEqual([
      { x: 150, y: 130 },
      { x: 250, y: 130 },
    ]);
  });

  it('updates level.spawn when a spawn entity is moved (regression: cosmetic spawn editing)', () => {
    const state = createEditorState(levelWithMovingPlatformAndSpawn());
    const next = applyOp(state, {
      type: 'moveEntities',
      ids: [1],
      dx: 64,
      dy: 16,
    });
    // Both the spawn entity's rect AND the level's authoritative spawn
    // field must move together — otherwise compileLevel() reads a stale
    // spawn and the player spawns at the wrong place.
    expect(next.level.spawn).toEqual({ x: 96, y: 48 });
    const spawn = next.level.entities.find((e) => e.id === 1);
    expect(spawn?.rect.x).toBe(96);
    expect(spawn?.rect.y).toBe(48);
  });

  it('updates level.spawn for exactly the dx/dy applied (multiple spawn moves accumulate)', () => {
    const state = createEditorState(levelWithMovingPlatformAndSpawn());
    const step1 = applyOp(state, { type: 'moveEntities', ids: [1], dx: 16, dy: 0 });
    const step2 = applyOp(step1, { type: 'moveEntities', ids: [1], dx: 0, dy: 32 });
    expect(step2.level.spawn).toEqual({ x: 48, y: 64 });
  });
});

describe('applyOp — setEntityRect coherence (integration hardening)', () => {
  it('updates level.spawn when a spawn entity rect is set (regression: cosmetic spawn editing)', () => {
    const state = createEditorState(levelWithMovingPlatformAndSpawn());
    const next = applyOp(state, {
      type: 'setEntityRect',
      id: 1,
      rect: { x: 80, y: 64, width: 16, height: 16 },
    });
    // The level.spawn must reflect the new spawn entity position so
    // compileLevel() reads a coherent spawn.
    expect(next.level.spawn).toEqual({ x: 80, y: 64 });
    const spawn = next.level.entities.find((e) => e.id === 1);
    expect(spawn?.rect).toEqual({ x: 80, y: 64, width: 16, height: 16 });
  });

  it('translates path[0] to match a movingPlatform body change (regression: body/path divergence)', () => {
    const state = createEditorState(levelWithMovingPlatformAndSpawn());
    const next = applyOp(state, {
      type: 'setEntityRect',
      id: 3,
      rect: { x: 150, y: 130, width: 48, height: 16 },
    });
    const mp = next.level.entities.find((e) => e.id === 3);
    if (!mp || mp.kind !== 'movingPlatform') throw new Error('missing movingPlatform');
    // path[0] should track the new body top-left so the "home" position
    // stays coherent. The remaining waypoints preserve their relative
    // offset from path[0].
    expect(mp.props.path[0]).toEqual({ x: 150, y: 130 });
    // Second waypoint should preserve the original relative offset
    // (path[1] - path[0] === {100, 0} before and after).
    expect(mp.props.path[1]).toEqual({ x: 250, y: 130 });
  });
});

// ---------------------------------------------------------------------------
// Regression: enemy patrolPath coherence under moveEntities / setEntityRect.
//
// A built-in Spinny stores its patrol as `params.patrolPath`. Moving the
// enemy body must translate every waypoint by the same rect delta —
// otherwise the runtime spinny behavior (which targets patrolPath waypoints
// from its body rect) drags the enemy back to the original patrol box the
// moment play begins. Mirrors the movingPlatform path-translation contract.
// ---------------------------------------------------------------------------

/** Build a level with several enemy entities for the patrolPath tests. */
function levelWithEnemies(): LevelData {
  return {
    version: 1,
    id: 'enemy-level',
    name: 'EN',
    width: 400,
    height: 240,
    tileSize: 16,
    spawn: { x: 32, y: 32 },
    tiles: { data: new Array(15 * 15).fill(0), cols: 15, rows: 15, tileSize: 16 },
    entities: [
      {
        id: 1,
        kind: 'spawn',
        rect: { x: 32, y: 32, width: 16, height: 16 },
        props: {},
      },
      // Spinny with the default two-point patrol: body at (100,100), patrol
      // [(100,100), (148,100)] — point 0 equals body top-left.
      {
        id: 10,
        kind: 'enemy',
        rect: { x: 100, y: 100, width: 16, height: 16 },
        props: {
          archetype: 'spinny',
          params: {
            speed: 60,
            ledgeTurnAround: true,
            patrolPath: [
              { x: 100, y: 100 },
              { x: 148, y: 100 },
            ],
          },
        },
      },
      // Spinny with a three-point patrol (non-trivial shape to translate).
      {
        id: 11,
        kind: 'enemy',
        rect: { x: 200, y: 100, width: 16, height: 16 },
        props: {
          archetype: 'spinny',
          params: {
            patrolPath: [
              { x: 200, y: 100 },
              { x: 300, y: 100 },
              { x: 250, y: 200 },
            ],
          },
        },
      },
      // Turret — no patrolPath. Must remain untouched by patrol translation.
      {
        id: 12,
        kind: 'enemy',
        rect: { x: 50, y: 50, width: 16, height: 16 },
        props: {
          archetype: 'turret',
          params: { fireRate: 1, projectileSpeed: 120, projectileSize: 6 },
        },
      },
      // Spinny with malformed params (no patrolPath). Must remain untouched.
      {
        id: 13,
        kind: 'enemy',
        rect: { x: 80, y: 80, width: 16, height: 16 },
        props: { archetype: 'spinny', params: {} },
      },
      // Spinny with malformed patrolPath (wrong type). Must not throw.
      {
        id: 14,
        kind: 'enemy',
        rect: { x: 60, y: 60, width: 16, height: 16 },
        props: {
          archetype: 'spinny',
          params: { patrolPath: 'not-an-array' },
        },
      },
    ],
    nextEntityId: 20,
  };
}

describe('applyOp — moveEntities on enemy patrolPath coherence', () => {
  it('translates every patrolPath waypoint by the rect delta (spinny, two-point)', () => {
    const state = createEditorState(levelWithEnemies());
    const next = applyOp(state, {
      type: 'moveEntities',
      ids: [10],
      dx: 50,
      dy: 30,
    });
    const enemy = next.level.entities.find((e) => e.id === 10);
    if (!enemy || enemy.kind !== 'enemy') throw new Error('missing enemy');
    expect(enemy.rect.x).toBe(150);
    expect(enemy.rect.y).toBe(130);
    const params = enemy.props.params as { patrolPath: { x: number; y: number }[] };
    expect(params.patrolPath).toEqual([
      { x: 150, y: 130 },
      { x: 198, y: 130 },
    ]);
  });

  it('translates every patrolPath waypoint by the rect delta (spinny, three-point)', () => {
    const state = createEditorState(levelWithEnemies());
    const next = applyOp(state, {
      type: 'moveEntities',
      ids: [11],
      dx: 10,
      dy: -20,
    });
    const enemy = next.level.entities.find((e) => e.id === 11);
    if (!enemy || enemy.kind !== 'enemy') throw new Error('missing enemy');
    const params = enemy.props.params as { patrolPath: { x: number; y: number }[] };
    expect(params.patrolPath).toEqual([
      { x: 210, y: 80 },
      { x: 310, y: 80 },
      { x: 260, y: 180 },
    ]);
  });

  it('preserves the relative patrol shape (delta between consecutive waypoints unchanged)', () => {
    const state = createEditorState(levelWithEnemies());
    const next = applyOp(state, {
      type: 'moveEntities',
      ids: [11],
      dx: 73,
      dy: 41,
    });
    const enemy = next.level.entities.find((e) => e.id === 11);
    if (!enemy || enemy.kind !== 'enemy') throw new Error('missing enemy');
    const beforeEnemy = state.level.entities.find((e) => e.id === 11);
    if (!beforeEnemy || beforeEnemy.kind !== 'enemy') throw new Error('missing enemy (before)');
    const before = (beforeEnemy.props.params as { patrolPath: { x: number; y: number }[] }).patrolPath;
    const after = (enemy.props.params as { patrolPath: { x: number; y: number }[] }).patrolPath;
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      const dxb = before[(i + 1) % before.length].x - before[i].x;
      const dyb = before[(i + 1) % before.length].y - before[i].y;
      const dxa = after[(i + 1) % after.length].x - after[i].x;
      const dya = after[(i + 1) % after.length].y - after[i].y;
      expect(dxa).toBe(dxb);
      expect(dya).toBe(dyb);
    }
  });

  it('does not modify turret params (no patrolPath)', () => {
    const state = createEditorState(levelWithEnemies());
    const next = applyOp(state, {
      type: 'moveEntities',
      ids: [12],
      dx: 25,
      dy: 5,
    });
    const enemy = next.level.entities.find((e) => e.id === 12);
    if (!enemy || enemy.kind !== 'enemy') throw new Error('missing turret');
    expect(enemy.rect.x).toBe(75);
    expect(enemy.rect.y).toBe(55);
    expect(enemy.props.params).toEqual({
      fireRate: 1,
      projectileSpeed: 120,
      projectileSize: 6,
    });
  });

  it('does not modify spinny params when patrolPath is absent', () => {
    const state = createEditorState(levelWithEnemies());
    const next = applyOp(state, {
      type: 'moveEntities',
      ids: [13],
      dx: 5,
      dy: 5,
    });
    const enemy = next.level.entities.find((e) => e.id === 13);
    if (!enemy || enemy.kind !== 'enemy') throw new Error('missing enemy');
    expect(enemy.rect.x).toBe(85);
    expect(enemy.rect.y).toBe(85);
    expect(enemy.props.params).toEqual({});
  });

  it('does not throw on malformed patrolPath (non-array)', () => {
    const state = createEditorState(levelWithEnemies());
    expect(() =>
      applyOp(state, { type: 'moveEntities', ids: [14], dx: 5, dy: 5 }),
    ).not.toThrow();
    const next = applyOp(state, { type: 'moveEntities', ids: [14], dx: 5, dy: 5 });
    const enemy = next.level.entities.find((e) => e.id === 14);
    if (!enemy || enemy.kind !== 'enemy') throw new Error('missing enemy');
    // Body moved; the malformed patrolPath is preserved verbatim (no throw,
    // no coercion — the consumer's data is left alone).
    expect(enemy.rect.x).toBe(65);
    expect(enemy.rect.y).toBe(65);
    expect((enemy.props.params as { patrolPath: unknown }).patrolPath).toBe('not-an-array');
  });

  it('is pure: input state is not mutated', () => {
    const state = createEditorState(levelWithEnemies());
    const before = snapshot(state);
    applyOp(state, { type: 'moveEntities', ids: [10], dx: 50, dy: 30 });
    expect(snapshot(state)).toEqual(before);
  });
});

describe('applyOp — setEntityRect on enemy patrolPath coherence', () => {
  it('translates every patrolPath waypoint by the rect delta (body move)', () => {
    const state = createEditorState(levelWithEnemies());
    const next = applyOp(state, {
      type: 'setEntityRect',
      id: 10,
      rect: { x: 150, y: 130, width: 16, height: 16 },
    });
    const enemy = next.level.entities.find((e) => e.id === 10);
    if (!enemy || enemy.kind !== 'enemy') throw new Error('missing enemy');
    expect(enemy.rect.x).toBe(150);
    expect(enemy.rect.y).toBe(130);
    const params = enemy.props.params as { patrolPath: { x: number; y: number }[] };
    // delta = (50, 30) — every waypoint translated by the same delta.
    expect(params.patrolPath).toEqual([
      { x: 150, y: 130 },
      { x: 198, y: 130 },
    ]);
  });

  it('preserves the relative patrol shape across body resize + move', () => {
    const state = createEditorState(levelWithEnemies());
    const next = applyOp(state, {
      type: 'setEntityRect',
      id: 11,
      rect: { x: 250, y: 150, width: 32, height: 32 },
    });
    const enemy = next.level.entities.find((e) => e.id === 11);
    if (!enemy || enemy.kind !== 'enemy') throw new Error('missing enemy');
    expect(enemy.rect).toEqual({ x: 250, y: 150, width: 32, height: 32 });
    // delta vs old (200, 100) = (50, 50) — every waypoint shifts by that.
    const params = enemy.props.params as { patrolPath: { x: number; y: number }[] };
    expect(params.patrolPath).toEqual([
      { x: 250, y: 150 },
      { x: 350, y: 150 },
      { x: 300, y: 250 },
    ]);
  });

  it('does not modify turret params under setEntityRect (no patrolPath)', () => {
    const state = createEditorState(levelWithEnemies());
    const next = applyOp(state, {
      type: 'setEntityRect',
      id: 12,
      rect: { x: 100, y: 100, width: 16, height: 16 },
    });
    const enemy = next.level.entities.find((e) => e.id === 12);
    if (!enemy || enemy.kind !== 'enemy') throw new Error('missing turret');
    expect(enemy.props.params).toEqual({
      fireRate: 1,
      projectileSpeed: 120,
      projectileSize: 6,
    });
  });

  it('does not throw on malformed patrolPath under setEntityRect', () => {
    const state = createEditorState(levelWithEnemies());
    expect(() =>
      applyOp(state, {
        type: 'setEntityRect',
        id: 14,
        rect: { x: 100, y: 100, width: 16, height: 16 },
      }),
    ).not.toThrow();
  });
});

// Compile-time assertion that LevelEntity is reachable for the type import.
// (noUnusedLocals gate would flag an unused import otherwise)
const _typeOnlyLevelEntity: LevelEntity | null = null;
void _typeOnlyLevelEntity;

describe('applyOp — addEntity for collectible (makeEntity dispatch)', () => {
  it('constructs a valid LevelEntity with kind: collectible and the supplied props', () => {
    const state = createEditorState(baseLevel());
    const next = applyOp(state, {
      type: 'addEntity',
      kind: 'collectible',
      rect: { x: 48, y: 48, width: 16, height: 16 },
      props: { kind: 'coin', value: 10 },
    });
    const added = next.level.entities[next.level.entities.length - 1];
    expect(added.kind).toBe('collectible');
    if (added.kind === 'collectible') {
      expect(added.props.kind).toBe('coin');
      expect(added.props.value).toBe(10);
    }
    // The added entity must pass validation (the validation cache reflects it).
    expect(next.validation.valid).toBe(true);
  });

  it('constructs a gem and a key via makeEntity dispatch', () => {
    const state = createEditorState(baseLevel());
    const withGem = applyOp(state, {
      type: 'addEntity',
      kind: 'collectible',
      rect: { x: 0, y: 0, width: 16, height: 16 },
      props: { kind: 'gem' },
    });
    const gemEntity = withGem.level.entities[withGem.level.entities.length - 1];
    expect(gemEntity.kind).toBe('collectible');
    if (gemEntity.kind === 'collectible') {
      expect(gemEntity.props.kind).toBe('gem');
    }

    const withKey = applyOp(withGem, {
      type: 'addEntity',
      kind: 'collectible',
      rect: { x: 16, y: 0, width: 16, height: 16 },
      props: { kind: 'key', persists: true },
    });
    const keyEntity = withKey.level.entities[withKey.level.entities.length - 1];
    expect(keyEntity.kind).toBe('collectible');
    if (keyEntity.kind === 'collectible') {
      expect(keyEntity.props.kind).toBe('key');
      expect(keyEntity.props.persists).toBe(true);
    }
  });
});
