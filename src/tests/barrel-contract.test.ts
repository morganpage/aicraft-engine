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
  it('terrain art: runtime/compiler APIs are public but optional DOM editor is not in root', () => {
    expect(typeof aicraft.compileTerrainArtRuntime).toBe('function');
    expect(typeof aicraft.drawCompiledTerrainArtDualGrid).toBe('function');
    expect('mountTerrainArtReferenceEditor' in aicraft).toBe(false);
  });
  it('ldtk: the parse → auto-tile → edit → write pipeline is public', () => {
    expect(typeof aicraft.parseLdtkProject).toBe('function');
    expect(typeof aicraft.drawLdtkLevel).toBe('function');
    expect(typeof aicraft.ldtkLevelToLevelData).toBe('function');
    // The auto-tiler and its grid adapter — what makes an LDtk project
    // editable rather than merely playable.
    expect(typeof aicraft.runLdtkAutoLayer).toBe('function');
    expect(typeof aicraft.ldtkRuleSourceFromCsv).toBe('function');
    expect(typeof aicraft.ldtkOpaqueTileLookup).toBe('function');
    // Editing and round-tripping.
    expect(typeof aicraft.paintLdtkIntGrid).toBe('function');
    expect(typeof aicraft.widenDirtyRect).toBe('function');
    expect(typeof aicraft.readLdtkDocument).toBe('function');
    expect(typeof aicraft.writeLdtkDocument).toBe('function');
    expect(typeof aicraft.formatLdtkJson).toBe('function');
    // Pattern sentinels are part of the contract: a consumer building rule
    // patterns cannot encode them without these.
    expect(aicraft.LDTK_RULE_ANY_VALUE).toBe(1000001);
    expect(aicraft.LDTK_RULE_GROUP_STRIDE).toBe(1000);
  });

  it('primitives: outlineRect is a function, DEFAULT_OUTLINE_COLOR is a string', () => {
    expect(typeof aicraft.outlineRect).toBe('function');
    expect(typeof aicraft.DEFAULT_OUTLINE_COLOR).toBe('string');
  });

  it('primitives: bitmap-font — measureText, drawText are functions, DEFAULT_FONT is an object', () => {
    expect(typeof aicraft.measureText).toBe('function');
    expect(typeof aicraft.drawText).toBe('function');
    expect(typeof aicraft.DEFAULT_FONT).toBe('object');
    expect(aicraft.DEFAULT_FONT).not.toBeNull();
  });

  it('rng: mulberry32 is a function', () => {
    expect(typeof aicraft.mulberry32).toBe('function');
    expect(typeof aicraft.deriveVisualSeed).toBe('function');
    expect(typeof aicraft.visualChannel).toBe('function');
  });

  it('terrain: connectivity, viewport, and exposure helpers are functions', () => {
    expect(typeof aicraft.sampleTerrainNeighborhood).toBe('function');
    expect(typeof aicraft.createTerrainConnectionTable).toBe('function');
    expect(typeof aicraft.visibleTileRange).toBe('function');
    expect(typeof aicraft.computeRectExposures).toBe('function');
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
    expect(typeof aicraft.checkLineOfSight).toBe('function');
  });

  it('camera: createCamera and updateCamera are functions', () => {
    expect(typeof aicraft.createCamera).toBe('function');
    expect(typeof aicraft.updateCamera).toBe('function');
  });

  it('camera brain: createCameraBrain, updateCameraBrain, converge are functions; followPosition is NOT public', () => {
    expect(typeof aicraft.createCameraBrain).toBe('function');
    expect(typeof aicraft.updateCameraBrain).toBe('function');
    expect(typeof aicraft.converge).toBe('function');
    expect(typeof aicraft.DEFAULT_CAMERA_MOTION).toBe('object');
    expect(aicraft.DEFAULT_BRAIN_BLEND_DURATION).toBe(0.3);
    expect('followPosition' in aicraft).toBe(false);
  });

  it('camera fit: fitCameraZoom is a function', () => {
    expect(typeof aicraft.fitCameraZoom).toBe('function');
    // cover is the default policy; a level equal to the viewport fits at zoom 1.
    expect(aicraft.fitCameraZoom({ width: 160, height: 120 }, { width: 160, height: 120 })).toBe(1);
  });

  it('input: createEdgeAccumulator and orEdges are functions', () => {
    expect(typeof aicraft.createEdgeAccumulator).toBe('function');
    expect(typeof aicraft.orEdges).toBe('function');
  });

  it('input: createGamepadAdapter is a function, DEFAULT_GAMEPAD_DEADZONE is a number', () => {
    expect(typeof aicraft.createGamepadAdapter).toBe('function');
    expect(typeof aicraft.DEFAULT_GAMEPAD_DEADZONE).toBe('number');
  });

  it('game-loop: createGameLoop is a function, DEFAULT_FIXED_DT is a number', () => {
    expect(typeof aicraft.createGameLoop).toBe('function');
    expect(typeof aicraft.DEFAULT_FIXED_DT).toBe('number');
  });

  it('game-state: createGameState, reduceGameState, isLegalTransition are functions, DEFAULT_GAME_STATE_ADJACENCY is an object', () => {
    expect(typeof aicraft.createGameState).toBe('function');
    expect(typeof aicraft.reduceGameState).toBe('function');
    expect(typeof aicraft.isLegalTransition).toBe('function');
    expect(typeof aicraft.DEFAULT_GAME_STATE_ADJACENCY).toBe('object');
    expect(aicraft.DEFAULT_GAME_STATE_ADJACENCY).not.toBeNull();
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

  it('easing: advanceTween and createTweenState are functions, easeOutCubic is a function, powOut is a function', () => {
    expect(typeof aicraft.advanceTween).toBe('function');
    expect(typeof aicraft.createTweenState).toBe('function');
    expect(typeof aicraft.easeOutCubic).toBe('function');
    expect(typeof aicraft.powOut).toBe('function');
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

  it('character and charger validation exports are available from the root', () => {
    expect(typeof aicraft.deriveHumanoidConfig).toBe('function');
    expect(typeof aicraft.createHumanoidVisualState).toBe('function');
    expect(typeof aicraft.advanceHumanoidVisual).toBe('function');
    expect(typeof aicraft.drawHumanoid).toBe('function');
    expect(typeof aicraft.createBodyPlanRegistry).toBe('function');
    expect(typeof aicraft.chargerBehavior).toBe('object');
    expect(aicraft.CHARGER_WIDTH).toBe(16);
    expect(aicraft.CHARGER_HEIGHT).toBe(16);
  });

  it('platformer glue: compileLevel is a function, drawLevelEntity is a function, PRECISION_PLATFORMER is an object', () => {
    expect(typeof aicraft.compileLevel).toBe('function');
    expect(typeof aicraft.drawLevelEntity).toBe('function');
    expect(typeof aicraft.PRECISION_PLATFORMER).toBe('object');
    expect(aicraft.PRECISION_PLATFORMER).not.toBeNull();
  });

  it('editor: applyOp and createEditorState are functions, DEFAULT_CATALOG is an object', () => {
    expect(typeof aicraft.applyOp).toBe('function');
    expect(typeof aicraft.createEditorState).toBe('function');
    expect(typeof aicraft.DEFAULT_CATALOG).toBe('object');
    expect(aicraft.DEFAULT_CATALOG).not.toBeNull();
  });

  it('collectibles: collect, hasCollected, derivePickups are functions; DEFAULT_COLLECTIBLE_VALUE is a number', () => {
    expect(typeof aicraft.collect).toBe('function');
    expect(typeof aicraft.hasCollected).toBe('function');
    expect(typeof aicraft.derivePickups).toBe('function');
    expect(typeof aicraft.DEFAULT_COLLECTIBLE_RECT).toBe('object');
    expect(aicraft.DEFAULT_COLLECTIBLE_RECT).not.toBeNull();
    expect(typeof aicraft.DEFAULT_COLLECTIBLE_VALUE).toBe('number');
  });

  it('enemy: createEnemyBehaviorRegistry, stepProjectile, compileEnemies, drawEnemies, drawProjectiles are functions, spinnyBehavior is an object', () => {
    expect(typeof aicraft.createEnemyBehaviorRegistry).toBe('function');
    expect(typeof aicraft.stepProjectile).toBe('function');
    expect(typeof aicraft.compileEnemies).toBe('function');
    expect(typeof aicraft.stepEnemies).toBe('function');
    expect(typeof aicraft.drawEnemies).toBe('function');
    expect(typeof aicraft.drawProjectiles).toBe('function');
    expect(typeof aicraft.spinnyBehavior).toBe('object');
    expect(aicraft.spinnyBehavior).not.toBeNull();
    expect(typeof aicraft.turretBehavior).toBe('object');
    expect(aicraft.turretBehavior).not.toBeNull();
  });

  it('music: pure advance and both host adapters are exported', () => {
    expect(typeof aicraft.noteToFrequency).toBe('function');
    expect(typeof aicraft.frequencyToNote).toBe('function');
    expect(typeof aicraft.buildScale).toBe('function');
    expect(typeof aicraft.scaleDegree).toBe('function');
    expect(typeof aicraft.secondsPerBeat).toBe('function');
    expect(typeof aicraft.secondsPerStep).toBe('function');
    expect(typeof aicraft.swingLongDuration).toBe('function');
    expect(typeof aicraft.generatePattern).toBe('function');
    expect(typeof aicraft.advanceSequencer).toBe('function');
    expect(typeof aicraft.createSequencer).toBe('function');
    expect(typeof aicraft.createNoteFirePlayer).toBe('function');
    expect(typeof aicraft.SCALES).toBe('object');
    expect(aicraft.SCALES).not.toBeNull();
    expect(typeof aicraft.A4_FREQ).toBe('number');
    expect(typeof aicraft.A4_MIDI).toBe('number');
    expect(typeof aicraft.LOOKAHEAD_MS).toBe('number');
    expect(typeof aicraft.SCHEDULE_AHEAD_S).toBe('number');
  });

  it('replay: createReplayRecorder and playReplay are functions, replayHash is a function', () => {
    expect(typeof aicraft.createReplayRecorder).toBe('function');
    expect(typeof aicraft.playReplay).toBe('function');
    expect(typeof aicraft.replayHash).toBe('function');
  });

  it('sprites: parse → compile → resolve → render pipeline is public', () => {
    expect(typeof aicraft.parseSpriteSheet).toBe('function');
    expect(typeof aicraft.compileSpriteSheet).toBe('function');
    expect(typeof aicraft.resolveAnim).toBe('function');
    expect(typeof aicraft.createSpriteAnimState).toBe('function');
    expect(typeof aicraft.advanceSpriteAnim).toBe('function');
    expect(typeof aicraft.currentFrameIndex).toBe('function');
    expect(typeof aicraft.drawSprite).toBe('function');
    expect(typeof aicraft.deriveSpriteAnimKind).toBe('function');
    expect(typeof aicraft.createSpriteTintCache).toBe('function');
    expect(aicraft.DEFAULT_FRAME_DURATION_MS).toBe(100);
  });
});
