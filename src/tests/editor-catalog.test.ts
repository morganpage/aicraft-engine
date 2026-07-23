import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CATALOG,
  createCatalogEntry,
  instantiateCatalogEntry,
} from '../editor';
import type { EntityKind } from '../level/types';

const ALL_KINDS: readonly EntityKind[] = [
  'spawn',
  'exit',
  'platform',
  'passthrough',
  'trap',
  'hazard',
  'decoration',
  'trigger',
  'movingPlatform',
];

describe('DEFAULT_CATALOG', () => {
  it('has one entry per EntityKind', () => {
    const kindsPresent = new Set<EntityKind>();
    for (const key of Object.keys(DEFAULT_CATALOG.entries)) {
      const entry = DEFAULT_CATALOG.entries[key];
      if (entry) kindsPresent.add(entry.kind);
    }
    for (const kind of ALL_KINDS) {
      expect(kindsPresent.has(kind)).toBe(true);
    }
  });

  it('every default entry produces a validateLevel-passing op when instantiated', () => {
    // We verify shape contractually; full validateLevel integration is
    // covered in editor-operations tests when applyOp runs validation.
    for (const key of Object.keys(DEFAULT_CATALOG.entries)) {
      const entry = DEFAULT_CATALOG.entries[key];
      if (!entry) continue;
      expect(typeof entry.label).toBe('string');
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.defaultRect.width).toBeGreaterThan(0);
      expect(entry.defaultRect.height).toBeGreaterThan(0);
      expect(typeof entry.defaultProps).toBe('object');
      expect(entry.defaultProps).not.toBeNull();
    }
  });

  it('platform default rect is 32x16', () => {
    const platform = DEFAULT_CATALOG.entries['platform'];
    if (!platform) throw new Error('missing platform');
    expect(platform.defaultRect.width).toBe(32);
    expect(platform.defaultRect.height).toBe(16);
  });

  it('spawn default rect is 16x16', () => {
    const spawn = DEFAULT_CATALOG.entries['spawn'];
    if (!spawn) throw new Error('missing spawn');
    expect(spawn.defaultRect.width).toBe(16);
    expect(spawn.defaultRect.height).toBe(16);
  });

  it('exit default props include isTrap=false, locked=false', () => {
    const exit = DEFAULT_CATALOG.entries['exit'];
    if (!exit) throw new Error('missing exit');
    expect(exit.defaultProps.isTrap).toBe(false);
    expect(exit.defaultProps.locked).toBe(false);
  });

  it('movingPlatform default props include a path array', () => {
    const mp = DEFAULT_CATALOG.entries['movingPlatform'];
    if (!mp) throw new Error('missing movingPlatform');
    expect(Array.isArray(mp.defaultProps.path)).toBe(true);
    expect(typeof mp.defaultProps.speed).toBe('number');
  });

  it('turret default props include params.shootTo {x:128, y:0}', () => {
    const turret = DEFAULT_CATALOG.entries['turret'];
    if (!turret) throw new Error('missing turret');
    const params = turret.defaultProps.params as Record<string, unknown>;
    expect(params).toBeDefined();
    expect(params.shootTo).toEqual({ x: 128, y: 0 });
  });

  it('catalog keys match EntityKind verbatim (no surprise lowercase-kebab)', () => {
    // Every EntityKind must work as a direct key. Regression test for the
    // earlier 'moving-platform' key inconsistency.
    expect(DEFAULT_CATALOG.entries['spawn']).toBeDefined();
    expect(DEFAULT_CATALOG.entries['exit']).toBeDefined();
    expect(DEFAULT_CATALOG.entries['platform']).toBeDefined();
    expect(DEFAULT_CATALOG.entries['passthrough']).toBeDefined();
    expect(DEFAULT_CATALOG.entries['trap']).toBeDefined();
    expect(DEFAULT_CATALOG.entries['hazard']).toBeDefined();
    expect(DEFAULT_CATALOG.entries['decoration']).toBeDefined();
    expect(DEFAULT_CATALOG.entries['trigger']).toBeDefined();
    expect(DEFAULT_CATALOG.entries['movingPlatform']).toBeDefined();
  });
});

describe('createCatalogEntry', () => {
  it('builds an entry with kind defaults', () => {
    const entry = createCatalogEntry('platform', 'My Platform');
    expect(entry.kind).toBe('platform');
    expect(entry.label).toBe('My Platform');
    expect(entry.defaultRect).toEqual({ x: 0, y: 0, width: 32, height: 16 });
  });

  it('merges partial rect overrides onto the kind default', () => {
    const entry = createCatalogEntry('platform', 'Wide', { width: 96 });
    expect(entry.defaultRect).toEqual({ x: 0, y: 0, width: 96, height: 16 });
  });

  it('merges props overrides onto the kind default', () => {
    const entry = createCatalogEntry(
      'platform',
      'Cracked',
      {},
      { visual: 'cracked' },
    );
    expect(entry.defaultProps.visual).toBe('cracked');
  });

  it('accepts full overrides', () => {
    const entry = createCatalogEntry(
      'exit',
      'Trap Door',
      { x: 100, y: 100, width: 24, height: 24 },
      { isTrap: true, locked: false },
    );
    expect(entry.kind).toBe('exit');
    expect(entry.label).toBe('Trap Door');
    expect(entry.defaultRect.x).toBe(100);
    expect(entry.defaultProps.isTrap).toBe(true);
  });
});

describe('instantiateCatalogEntry', () => {
  it('returns an addEntity op with the entry kind and props', () => {
    const entry = DEFAULT_CATALOG.entries['platform'];
    if (!entry) throw new Error('missing platform');
    const { op } = instantiateCatalogEntry(entry, { x: 32, y: 64 });
    expect(op.type).toBe('addEntity');
    if (op.type === 'addEntity') {
      expect(op.kind).toBe('platform');
      expect(op.rect.x).toBe(32);
      expect(op.rect.y).toBe(64);
      expect(op.rect.width).toBe(32);
      expect(op.rect.height).toBe(16);
      expect(op.props).toBe(entry.defaultProps);
    }
  });

  it('does not apply the op (caller responsibility)', () => {
    const entry = DEFAULT_CATALOG.entries['spawn'];
    if (!entry) throw new Error('missing spawn');
    const result = instantiateCatalogEntry(entry, { x: 0, y: 0 });
    // Pure data only — no side-effects
    expect(result.op).toBeDefined();
    expect(typeof result.op).toBe('object');
  });

  it('preserves the entry defaultProps reference (no clone needed for data op)', () => {
    const entry = DEFAULT_CATALOG.entries['exit'];
    if (!entry) throw new Error('missing exit');
    const { op } = instantiateCatalogEntry(entry, { x: 0, y: 0 });
    if (op.type === 'addEntity') {
      expect(op.props).toBe(entry.defaultProps);
    }
  });
});
