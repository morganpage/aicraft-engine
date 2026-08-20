import { describe, expect, it } from 'vitest';
import { ldtkLevelToLevelData } from '../ldtk/translate';
import type { LdtkEntityInstance, LdtkLevel } from '../ldtk/types';
import type { Solid } from '../collision/types';
import {
  FALLING_BLOCK_TUNING,
  collectFallingBlocks,
  fallingBlockArmed,
  fallingBlockSolids,
  advanceFallingBlocks,
  scaleFallingBlockTuning,
  type FallingBlock,
  type FallingBlockPlayer,
} from '../platformer/falling-block';

/**
 * The FallingBlock recipe (0.20.0), ported from the reference Celerock build
 * where it lived game-side. Every constant is Celeste-derived: arm on X-only
 * overlap, shake 0.2 s, extending 0.4 s grace, accel 500 px/s² to a 160 px/s
 * cap, flush landing, block-on-block stacking, room escape.
 */

function makeLevel(entities: readonly LdtkEntityInstance[]): LdtkLevel {
  return {
    identifier: 'Level_0',
    iid: 'lvl-0',
    uid: 1,
    pxWid: 48,
    pxHei: 184,
    worldX: 0,
    worldY: 0,
    worldDepth: 0,
    fieldInstances: [],
    externalRelPath: null,
    __neighbours: [],
    layerInstances: [
      {
        __type: 'IntGrid',
        __identifier: 'Collisions',
        __cWid: 6,
        __cHei: 23,
        __gridSize: 8,
        __opacity: 1,
        __pxTotalOffsetX: 0,
        __pxTotalOffsetY: 0,
        visible: true,
        iid: 'l1',
        levelId: 'lvl-0',
        layerDefUid: 10,
        intGridCsv: [],
        __tilesetDefUid: null,
        __tilesetRelPath: null,
      },
      {
        __type: 'Entities',
        __identifier: 'Entities',
        __cWid: 6,
        __cHei: 23,
        __gridSize: 8,
        __opacity: 1,
        __pxTotalOffsetX: 0,
        __pxTotalOffsetY: 0,
        visible: true,
        iid: 'l2',
        levelId: 'lvl-0',
        layerDefUid: 11,
        entityInstances: entities,
        __tilesetDefUid: null,
        __tilesetRelPath: null,
      },
    ],
  };
}

const ENT = (
  over: Partial<LdtkEntityInstance> &
    Pick<LdtkEntityInstance, '__identifier' | 'px' | 'width' | 'height'>,
): LdtkEntityInstance => ({
  defUid: 1,
  iid: 'e',
  __tags: [],
  __grid: [0, 0],
  __pivot: [0, 0],
  __tile: null,
  fieldInstances: [],
  ...over,
});

const DT = 1 / 60;
const playerAt = (x: number, y: number): FallingBlockPlayer => ({ x, y, width: 4, height: 12 });
/** A solid floor rect. */
const FLOOR: Solid = { id: 'floor', x: 0, y: 160, width: 48, height: 8 };

describe('collectFallingBlocks — LDtk trigger consumption', () => {
  it('collects FallingBlock triggers with their authored tiletype via props.fields', () => {
    const { level } = ldtkLevelToLevelData(
      makeLevel([
        ENT({
          __identifier: 'FallingBlock',
          px: [16, 0],
          width: 16,
          height: 16,
          fieldInstances: [{ __identifier: 'tiletype', __type: 'Int', __value: 2 }],
        }),
        ENT({ __identifier: 'Spike', px: [0, 152], width: 8, height: 8 }),
      ]),
    );
    const blocks = collectFallingBlocks(level!);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      x: 16,
      y: 0,
      width: 16,
      height: 16,
      originY: 0,
      material: 2,
      phase: 'idle',
    });
  });

  it('tiletype absent or invalid defaults to material 1 (walls)', () => {
    const { level } = ldtkLevelToLevelData(
      makeLevel([
        ENT({ __identifier: 'FallingBlock', px: [0, 0], width: 16, height: 16 }),
        ENT({
          __identifier: 'FallingBlock',
          px: [16, 0],
          width: 16,
          height: 16,
          fieldInstances: [{ __identifier: 'tiletype', __type: 'Float', __value: 1.5 }],
        }),
      ]),
    );
    const blocks = collectFallingBlocks(level!);
    expect(blocks.map((b) => b.material)).toEqual([1, 1]);
  });

  it('a custom action override consumes a differently named entity', () => {
    const { level } = ldtkLevelToLevelData(
      makeLevel([ENT({ __identifier: 'CeilingBlock', px: [0, 0], width: 8, height: 8 })]),
    );
    expect(collectFallingBlocks(level!, { action: 'CeilingBlock' })).toHaveLength(1);
    expect(collectFallingBlocks(level!)).toHaveLength(0);
  });
});

describe('fallingBlockSolids — the per-tick projection', () => {
  it('projects every phase except gone, at the CURRENT rect', () => {
    const blocks: FallingBlock[] = [
      { id: 'a', x: 0, y: 10, width: 8, height: 8, originY: 0, material: 1, phase: 'falling', timer: 0, speed: 40 },
      { id: 'b', x: 0, y: 20, width: 8, height: 8, originY: 0, material: 1, phase: 'landed', timer: 0, speed: 0 },
      { id: 'c', x: 0, y: 30, width: 8, height: 8, originY: 0, material: 1, phase: 'gone', timer: 0, speed: 0 },
    ];
    expect(fallingBlockSolids(blocks)).toEqual([
      { id: 'a', x: 0, y: 10, width: 8, height: 8 },
      { id: 'b', x: 0, y: 20, width: 8, height: 8 },
    ]);
  });
});

describe('advanceFallingBlocks — the Celeste sequence', () => {
  it('arms on X-only overlap: under the footprint, beside it, on its back', () => {
    const block = collectFallingBlocks(
      ldtkLevelToLevelData(makeLevel([ENT({ __identifier: 'FallingBlock', px: [16, 0], width: 16, height: 16 })])).level!,
    );
    expect(fallingBlockArmed(block[0], playerAt(20, 40))).toBe(true);   // under it
    expect(fallingBlockArmed(block[0], playerAt(4, 40))).toBe(false);   // left of it
    expect(fallingBlockArmed(block[0], playerAt(34, 40))).toBe(false);  // right of it (34..38 vs footprint 16..32)
    expect(fallingBlockArmed(block[0], playerAt(20, 4))).toBe(true);    // standing ON it
    expect(fallingBlockArmed(block[0], null)).toBe(false);
  });

  it('idle → shaking fires armed, stays shaking through 0.2 s + extending grace', () => {
    let blocks: readonly FallingBlock[] = collectFallingBlocks(
      ldtkLevelToLevelData(makeLevel([ENT({ __identifier: 'FallingBlock', px: [16, 0], width: 16, height: 16 })])).level!,
    );
    const player = playerAt(20, 40);

    const first = advanceFallingBlocks(blocks, player, [], 184, DT);
    blocks = first.blocks;
    expect(first.events.armed).toHaveLength(1);
    expect(blocks[0].phase).toBe('shaking');

    // 0.2 s of shake + the player STILL under: the grace window extends.
    for (let i = 0; i < 12; i++) {
      const step = advanceFallingBlocks(blocks, player, [], 184, DT);
      blocks = step.blocks;
    }
    expect(blocks[0].phase).toBe('shaking');
    expect(blocks[0].timer).toBeCloseTo(13 * DT, 10);

    // Player steps out at ~0.217 s: grace (the 0.4 s window) closes early…
    const away = playerAt(0, 40);
    const out = advanceFallingBlocks(blocks, away, [], 184, DT);
    blocks = out.blocks;
    expect(out.events.released).toHaveLength(1);
    expect(blocks[0].phase).toBe('falling');
  });

  it('falls at Celeste accel 500 to cap 160 and lands FLUSH on the floor', () => {
    let blocks: readonly FallingBlock[] = collectFallingBlocks(
      ldtkLevelToLevelData(makeLevel([ENT({ __identifier: 'FallingBlock', px: [16, 0], width: 16, height: 16 })])).level!,
    );
    // Force it into falling directly (the armed path is covered above).
    const arm = advanceFallingBlocks(blocks, playerAt(20, 40), [FLOOR], 184, DT);
    blocks = arm.blocks;
    let landed = false;
    let flushBottom = 0;
    for (let i = 0; i < 240 && !landed; i++) {
      const step = advanceFallingBlocks(blocks, null, [FLOOR], 184, DT);
      blocks = step.blocks;
      if (step.events.landed.length > 0) {
        landed = true;
        flushBottom = blocks[0].y + blocks[0].height;
      }
    }
    expect(landed).toBe(true);
    // FLUSH: bottom lands exactly on the floor's top (160), zero embed.
    expect(flushBottom).toBe(160);
    expect(blocks[0].phase).toBe('landed');
    // Terminal speed never exceeds the cap.
    expect(blocks[0].speed).toBeLessThanOrEqual(FALLING_BLOCK_TUNING.maxSpeed + 1e-9);
  });

  it('a landing block overlaps the player standing on the landing spot → crushed', () => {
    let blocks: readonly FallingBlock[] = collectFallingBlocks(
      ldtkLevelToLevelData(makeLevel([ENT({ __identifier: 'FallingBlock', px: [16, 0], width: 16, height: 16 })])).level!,
    );
    const under = playerAt(18, 148); // standing on the floor under the block
    const arm = advanceFallingBlocks(blocks, under, [FLOOR], 184, DT);
    blocks = arm.blocks;
    let crushed = false;
    for (let i = 0; i < 240 && !crushed; i++) {
      const step = advanceFallingBlocks(blocks, under, [FLOOR], 184, DT);
      blocks = step.blocks;
      if (step.events.crushed.length > 0) crushed = true;
    }
    expect(crushed).toBe(true);
  });

  it('a block that finds no support leaves the room and goes gone (no solid)', () => {
    let blocks: readonly FallingBlock[] = collectFallingBlocks(
      ldtkLevelToLevelData(makeLevel([ENT({ __identifier: 'FallingBlock', px: [16, 0], width: 16, height: 16 })])).level!,
    );
    const arm = advanceFallingBlocks(blocks, playerAt(20, 40), [], 184, DT);
    blocks = arm.blocks;
    let gone = false;
    for (let i = 0; i < 1200 && !gone; i++) {
      const step = advanceFallingBlocks(blocks, null, [], 184, DT);
      blocks = step.blocks;
      if (blocks[0].phase === 'gone') gone = true;
    }
    expect(gone).toBe(true);
    expect(fallingBlockSolids(blocks)).toHaveLength(0);
  });

  it('stacking: a falling block lands flush on a LANDED block below it', () => {
    const { level } = ldtkLevelToLevelData(
      makeLevel([
        ENT({ __identifier: 'FallingBlock', px: [16, 0], width: 16, height: 16 }),
        ENT({ __identifier: 'FallingBlock', px: [16, 32], width: 16, height: 16 }),
      ]),
    );
    let blocks: readonly FallingBlock[] = collectFallingBlocks(level!);
    const under = playerAt(20, 40);
    // Arm only the top block by standing under IT (both footprints overlap X
    // at x=20 — both arm; that is the authored Celeste behavior).
    const arm = advanceFallingBlocks(blocks, under, [FLOOR], 184, DT);
    blocks = arm.blocks;
    const landedIds: string[] = [];
    for (let i = 0; i < 300; i++) {
      const step = advanceFallingBlocks(blocks, null, [FLOOR], 184, DT);
      blocks = step.blocks;
      for (const b of step.events.landed) landedIds.push(b.id);
      if (blocks.every((b) => b.phase === 'landed' || b.phase === 'gone')) break;
    }
    // Both landed: the lower-authored block at the floor, the upper stacked
    // flush on top of it.
    const byLanding = [...blocks].sort((a, b) => b.y - a.y);
    expect(byLanding[0].y + byLanding[0].height).toBe(160);
    expect(byLanding[1].y).toBe(byLanding[0].y - 16);
    expect(landedIds).toHaveLength(2);
  });

  it('purity: inputs are never mutated and unchanged blocks keep their reference', () => {
    const { level } = ldtkLevelToLevelData(
      makeLevel([ENT({ __identifier: 'FallingBlock', px: [16, 0], width: 16, height: 16 })]),
    );
    const blocks = collectFallingBlocks(level!);
    const snapshot = JSON.stringify(blocks);
    const nobody = advanceFallingBlocks(blocks, null, [FLOOR], 184, DT);
    expect(JSON.stringify(blocks)).toBe(snapshot);
    // No player → idle block is returned as the SAME reference.
    expect(nobody.blocks[0]).toBe(blocks[0]);
  });

  it('non-finite and zero dt are no-ops', () => {
    const { level } = ldtkLevelToLevelData(
      makeLevel([ENT({ __identifier: 'FallingBlock', px: [16, 0], width: 16, height: 16 })]),
    );
    const blocks = collectFallingBlocks(level!);
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const step = advanceFallingBlocks(blocks, playerAt(20, 40), [], 184, dt);
      expect(step.blocks).toBe(blocks);
      expect(step.events.armed).toHaveLength(0);
    }
  });
});

describe('scaleFallingBlockTuning', () => {
  it('scales distances/velocities/accel with the tile, times verbatim', () => {
    const scaled = scaleFallingBlockTuning(FALLING_BLOCK_TUNING, 16, 8);
    expect(scaled.accel).toBe(1000);
    expect(scaled.maxSpeed).toBe(320);
    expect(scaled.roomEscapeMargin).toBe(64);
    expect(scaled.shakeTime).toBe(0.2);
    expect(scaled.graceTime).toBe(0.4);
  });

  it('the reference tile size is the identity', () => {
    expect(scaleFallingBlockTuning(FALLING_BLOCK_TUNING, 8, 8)).toEqual({ ...FALLING_BLOCK_TUNING });
  });
});
