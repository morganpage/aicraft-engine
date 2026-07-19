import { describe, it, expect } from 'vitest';
import * as aicraft from '../index';

/**
 * Contract: the root barrel (`src/index.ts`) must re-export at least one
 * canonical symbol from every shipped module. Per `docs/conventions.md:53-56`,
 * the public API IS the contract — tests should treat it as such.
 *
 * This test exists to catch future barrel drift: if someone removes an export
 * from a module barrel, or forgets to wire a new module into `src/index.ts`,
 * the per-module unit tests still pass but the public API is silently
 * broken. This test fails fast in that case.
 *
 * One assertion per module, on the most canonical export(s) of that module.
 * Kind checks (function / object / number / string) are intentional — a
 * shadowed name (e.g. `mulberry32` accidentally re-exported as a const)
 * would otherwise slip through an `isDefined` check.
 */
describe('root barrel re-exports every module', () => {
  it('primitives: outlineRect is a function, DEFAULT_OUTLINE_COLOR is a string', () => {
    expect(typeof aicraft.outlineRect).toBe('function');
    expect(typeof aicraft.DEFAULT_OUTLINE_COLOR).toBe('string');
  });

  it('rng: mulberry32 is a function', () => {
    expect(typeof aicraft.mulberry32).toBe('function');
  });

  it('particles: spawn and step are functions', () => {
    expect(typeof aicraft.spawn).toBe('function');
    expect(typeof aicraft.step).toBe('function');
  });

  it('animation: createSkeleton is a function, DEFAULT_GAIT is an object', () => {
    expect(typeof aicraft.createSkeleton).toBe('function');
    expect(typeof aicraft.DEFAULT_GAIT).toBe('object');
    expect(aicraft.DEFAULT_GAIT).not.toBeNull();
  });

  it('palette: resolvePalette and generatePalette are functions', () => {
    expect(typeof aicraft.resolvePalette).toBe('function');
    expect(typeof aicraft.generatePalette).toBe('function');
  });

  it('cosmetics: migrateManifest is a function', () => {
    expect(typeof aicraft.migrateManifest).toBe('function');
  });

  it('iap: grantEntitlement is a function', () => {
    expect(typeof aicraft.grantEntitlement).toBe('function');
  });

  it('collision: resolveAxisX, resolveAxisY, aabbOverlap are functions', () => {
    expect(typeof aicraft.resolveAxisX).toBe('function');
    expect(typeof aicraft.resolveAxisY).toBe('function');
    expect(typeof aicraft.aabbOverlap).toBe('function');
  });

  it('camera: createCamera and updateCamera are functions', () => {
    expect(typeof aicraft.createCamera).toBe('function');
    expect(typeof aicraft.updateCamera).toBe('function');
  });

  it('input: createEdgeAccumulator and orEdges are functions', () => {
    expect(typeof aicraft.createEdgeAccumulator).toBe('function');
    expect(typeof aicraft.orEdges).toBe('function');
  });

  it('game-loop: createGameLoop is a function, DEFAULT_FIXED_DT is a number', () => {
    expect(typeof aicraft.createGameLoop).toBe('function');
    expect(typeof aicraft.DEFAULT_FIXED_DT).toBe('number');
  });

  it('audio: createAudioAdapter is a function', () => {
    expect(typeof aicraft.createAudioAdapter).toBe('function');
  });

  it('save: createMemorySaveStorage is a function', () => {
    expect(typeof aicraft.createMemorySaveStorage).toBe('function');
  });

  it('blend: blendPose and blendPoses are functions', () => {
    expect(typeof aicraft.blendPose).toBe('function');
    expect(typeof aicraft.blendPoses).toBe('function');
  });

  it('level: validateLevel and createTileQuery are functions, LEVEL_VERSION is a number', () => {
    expect(typeof aicraft.validateLevel).toBe('function');
    expect(typeof aicraft.createTileQuery).toBe('function');
    expect(typeof aicraft.LEVEL_VERSION).toBe('number');
  });

  it('platformer: stepPlatformer is a function, DEFAULT_PLATFORMER_CONFIG is an object, createPlatformerController is a function', () => {
    expect(typeof aicraft.stepPlatformer).toBe('function');
    expect(typeof aicraft.DEFAULT_PLATFORMER_CONFIG).toBe('object');
    expect(aicraft.DEFAULT_PLATFORMER_CONFIG).not.toBeNull();
    expect(typeof aicraft.createPlatformerController).toBe('function');
  });

  it('editor: applyOp and createEditorState are functions, DEFAULT_CATALOG is an object', () => {
    expect(typeof aicraft.applyOp).toBe('function');
    expect(typeof aicraft.createEditorState).toBe('function');
    expect(typeof aicraft.DEFAULT_CATALOG).toBe('object');
    expect(aicraft.DEFAULT_CATALOG).not.toBeNull();
  });
});
