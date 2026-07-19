import { describe, it, expect } from 'vitest';
import { migrateLevel } from '../level/migrate';
import type { LevelMigration } from '../level/types';

describe('migrateLevel — forward ladder', () => {
  it('runs a single v1 -> v2 migration', () => {
    const migrations: Record<number, LevelMigration> = {
      1: (raw) => ({ ...raw, version: 2, renamed: raw.oldField }),
    };
    const result = migrateLevel(
      { version: 1, oldField: 'hello' },
      migrations,
      2,
    );
    expect(result.level).not.toBeNull();
    expect(result.level?.version).toBe(2);
    expect(result.level?.renamed).toBe('hello');
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it('runs a multi-step v1 -> v3 ladder in order', () => {
    const migrations: Record<number, LevelMigration> = {
      1: (raw) => ({ ...raw, version: 2, step1: true }),
      2: (raw) => ({ ...raw, version: 3, step2: true }),
    };
    const result = migrateLevel({ version: 1 }, migrations, 3);
    expect(result.level).not.toBeNull();
    expect(result.level?.version).toBe(3);
    expect(result.level?.step1).toBe(true);
    expect(result.level?.step2).toBe(true);
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(3);
    expect(result.errors).toEqual([]);
  });

  it('threads each step output into the next step input', () => {
    const seen: number[] = [];
    const migrations: Record<number, LevelMigration> = {
      1: (raw) => {
        seen.push(1);
        return { ...raw, version: 2 };
      },
      2: (raw) => {
        seen.push(2);
        return { ...raw, version: 3 };
      },
    };
    migrateLevel({ version: 1 }, migrations, 3);
    expect(seen).toEqual([1, 2]);
  });

  it('returns raw unchanged when raw.version === targetVersion', () => {
    const migrations: Record<number, LevelMigration> = {};
    const raw = { version: 1, foo: 'bar' };
    const result = migrateLevel(raw, migrations, 1);
    expect(result.level).toBe(raw);
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(1);
    expect(result.errors).toEqual([]);
  });
});

describe('migrateLevel — defensive (never throws)', () => {
  it('returns null level + error when raw is not an object', () => {
    const result = migrateLevel('not an object', {}, 1);
    expect(result.level).toBeNull();
    expect(result.fromVersion).toBeNull();
    expect(result.toVersion).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns null level + error when version is missing', () => {
    const result = migrateLevel({ foo: 'bar' }, {}, 1);
    expect(result.level).toBeNull();
    expect(result.fromVersion).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns null level + error when version is 0', () => {
    const result = migrateLevel({ version: 0 }, {}, 1);
    expect(result.level).toBeNull();
    expect(result.fromVersion).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns null level + error when version is negative', () => {
    const result = migrateLevel({ version: -3 }, {}, 1);
    expect(result.level).toBeNull();
    expect(result.fromVersion).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns null level + error when version is non-integer', () => {
    const result = migrateLevel({ version: 1.5 }, {}, 2);
    expect(result.level).toBeNull();
    expect(result.fromVersion).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns null level + error when version is non-finite', () => {
    const result = migrateLevel({ version: Infinity }, {}, 2);
    expect(result.level).toBeNull();
    expect(result.fromVersion).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns null level + error when a migration step throws', () => {
    const migrations: Record<number, LevelMigration> = {
      1: () => {
        throw new Error('boom');
      },
    };
    const result = migrateLevel({ version: 1 }, migrations, 2);
    expect(result.level).toBeNull();
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(2);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('threw');
    expect(result.errors[0]).toContain('boom');
  });

  it('returns null level + error when a migration step throws a non-Error', () => {
    const migrations: Record<number, LevelMigration> = {
      1: () => {
        throw 'string error';
      },
    };
    const result = migrateLevel({ version: 1 }, migrations, 2);
    expect(result.level).toBeNull();
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('string error');
  });

  it('returns null level + error when a migration step returns a non-object', () => {
    const migrations: Record<number, LevelMigration> = {
      1: () => 'not an object' as unknown as Record<string, unknown>,
    };
    const result = migrateLevel({ version: 1 }, migrations, 2);
    expect(result.level).toBeNull();
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('non-object');
  });

  it('returns null level + error when an intermediate migration is missing', () => {
    const migrations: Record<number, LevelMigration> = {
      1: (raw) => ({ ...raw, version: 2 }),
    };
    const result = migrateLevel({ version: 1 }, migrations, 3);
    expect(result.level).toBeNull();
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(3);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('missing migration step');
    expect(result.errors[0]).toContain('2');
  });
});

describe('migrateLevel — no downgrade', () => {
  it('returns raw unchanged when targetVersion < raw.version', () => {
    const raw = { version: 3, data: 'future' };
    const result = migrateLevel(raw, {}, 1);
    expect(result.level).toBe(raw);
    expect(result.fromVersion).toBe(3);
    expect(result.toVersion).toBe(3);
    expect(result.errors).toEqual([]);
  });
});
