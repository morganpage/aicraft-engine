import { describe, expect, it } from 'vitest';
import { ldtkLevelToLevelData } from '../ldtk/translate';
import type { LdtkEntityInstance, LdtkLevel } from '../ldtk/types';

/**
 * 0.20.0: trigger entities carry their authored LDtk field values as a
 * first-class `props.fields` record — the supported read surface for
 * custom-entity recipes (FallingBlock's `tiletype`, a hint trigger's `text`),
 * replacing the `props.params.fieldInstances` reach-through.
 */

function makeLevel(entities: readonly LdtkEntityInstance[]): LdtkLevel {
  return {
    identifier: 'Level_0',
    iid: 'lvl-0',
    uid: 1,
    pxWid: 48,
    pxHei: 32,
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
        __cWid: 3,
        __cHei: 2,
        __gridSize: 16,
        __opacity: 1,
        __pxTotalOffsetX: 0,
        __pxTotalOffsetY: 0,
        visible: true,
        iid: 'l1',
        levelId: 'lvl-0',
        layerDefUid: 10,
        intGridCsv: [1, 1, 1, 0, 0, 0],
        __tilesetDefUid: null,
        __tilesetRelPath: null,
      },
      {
        __type: 'Entities',
        __identifier: 'Entities',
        __cWid: 3,
        __cHei: 2,
        __gridSize: 16,
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

describe('trigger props.fields (0.20.0)', () => {
  it('exposes authored field values as a clean top-level record', () => {
    const { level } = ldtkLevelToLevelData(
      makeLevel([
        ENT({
          __identifier: 'FallingBlock',
          px: [16, 0],
          width: 16,
          height: 16,
          fieldInstances: [
            { __identifier: 'tiletype', __type: 'Int', __value: 2 },
            { __identifier: 'label', __type: 'String', __value: 'crumbly' },
          ],
        }),
      ]),
    );
    const trigger = level!.entities.find((e) => e.kind === 'trigger')!;
    expect(trigger.props).toMatchObject({ action: 'FallingBlock' });
    if (trigger.kind !== 'trigger') throw new Error('unreachable');
    expect(trigger.props.fields).toEqual({ tiletype: 2, label: 'crumbly' });
  });

  it('an entity with no authored fields translates with an empty record', () => {
    const { level } = ldtkLevelToLevelData(
      makeLevel([ENT({ __identifier: 'ShowHint', px: [0, 0], width: 16, height: 16 })]),
    );
    const trigger = level!.entities.find((e) => e.kind === 'trigger')!;
    if (trigger.kind !== 'trigger') throw new Error('unreachable');
    expect(trigger.props.fields).toEqual({});
  });

  it('the legacy params.fieldInstances shape is unchanged (back-compat)', () => {
    const { level } = ldtkLevelToLevelData(
      makeLevel([
        ENT({
          __identifier: 'FallingBlock',
          px: [16, 0],
          width: 16,
          height: 16,
          fieldInstances: [{ __identifier: 'tiletype', __type: 'Int', __value: 3 }],
        }),
      ]),
    );
    const trigger = level!.entities.find((e) => e.kind === 'trigger')!;
    if (trigger.kind !== 'trigger') throw new Error('unreachable');
    expect(trigger.props.params.fieldInstances).toEqual({ tiletype: 3 });
  });
});
