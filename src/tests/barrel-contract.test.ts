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
    // Entity display tiles (0.16.0) — the blit + the parsed render mode.
    expect(typeof aicraft.drawLdtkEntityTile).toBe('function');
    // Compile-time type use: the mode union must be importable.
    const _mode: aicraft.LdtkTileRenderMode = 'FitInside';
    void _mode;
    // The entity-art side channel record must be importable (its map rides
    // CompiledLdtkRoom.entityArt and the translate result).
    const _art: aicraft.LdtkEntityArt = {
      tile: { tilesetUid: 1, x: 0, y: 0, w: 8, h: 8 },
      tileRenderMode: undefined,
      nineSliceBorders: null,
    };
    void _art;
  });

  it('primitives: outlineRect is a function, DEFAULT_OUTLINE_COLOR is a string', () => {
    expect(typeof aicraft.outlineRect).toBe('function');
    expect(typeof aicraft.DEFAULT_OUTLINE_COLOR).toBe('string');
    expect(typeof aicraft.applyCanvasDprTransform).toBe('function');
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

  it('rng: the serializable pure-state stream API is public', () => {
    // Save/restore and mid-battle replay depend on streams being plain JSON.
    expect(typeof aicraft.createRngState).toBe('function');
    expect(typeof aicraft.advanceRng).toBe('function');
    expect(typeof aicraft.nextRngInt).toBe('function');
    expect(typeof aicraft.deriveSeed).toBe('function');
    const _state: aicraft.SerializableRngState = aicraft.createRngState(1);
    void _state;
  });

  it('rpg: version constants and the contract surface are public', () => {
    // Determinism contract: saves/traces bind to these version numbers.
    expect(aicraft.RPG_RULES_VERSION).toBe(1);
    expect(aicraft.RPG_STATE_SCHEMA_VERSION).toBe(1);
    expect(aicraft.RPG_CONTENT_SCHEMA_VERSION).toBe(1);
    expect(aicraft.RPG_SAVE_SCHEMA_VERSION).toBe(1);
    // Fixed RNG draw budgets are part of the public rules contract.
    expect(aicraft.ENCOUNTER_ROLL_PACK_SIZE).toBe(3);
    expect(aicraft.BATTLE_FIGHT_DRAW_BUDGET).toBe(8);
    expect(aicraft.BATTLE_CATCH_DRAW_BUDGET).toBe(4);
    expect(aicraft.BATTLE_SWITCH_DRAW_BUDGET).toBe(3);
    expect(aicraft.BATTLE_FLEE_DRAW_BUDGET).toBe(4);
    expect(typeof aicraft.DEFAULT_RPG_CONFIG).toBe('object');
    // Compile-time type uses: the activity union and battle contracts must
    // be importable from the root barrel.
    const _activity: aicraft.RpgActivity = {
      kind: 'overworld',
      overworld: {
        location: { mapId: 'field', tileX: 0, tileY: 0, facing: 'down' },
        step: null,
      },
    };
    const _command: aicraft.BattleCommand = { type: 'flee' };
    void _activity;
    void _command;
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

  it('particles: seconds-facing entry points and the shared air medium ship', () => {
    expect(typeof aicraft.advanceSeconds).toBe('function');
    expect(typeof aicraft.stepSeconds).toBe('function');
    expect(typeof aicraft.secondsToTicks).toBe('function');
    expect(aicraft.DEFAULT_PARTICLE_AIR).toEqual({ gravity: 0.1, drag: 0.9 });
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

  it('camera brain: createCameraBrain, updateCameraBrain, snapCameraBrain, converge are functions; followPosition is NOT public', () => {
    expect(typeof aicraft.createCameraBrain).toBe('function');
    expect(typeof aicraft.updateCameraBrain).toBe('function');
    // The first-frame solver: without it a boot camera eases in from zoom 1.
    expect(typeof aicraft.snapCameraBrain).toBe('function');
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

  it('camera celeste: the preset constants + assemblies are public, window 320×184', () => {
    expect(typeof aicraft.celesteCameraZoom).toBe('function');
    expect(typeof aicraft.celesteFollowMotion).toBe('function');
    expect(typeof aicraft.celesteFollowVcam).toBe('function');
    expect(typeof aicraft.devicePixelSnapThreshold).toBe('function');
    expect(aicraft.CELESTE_CAMERA_WINDOW).toEqual({ width: 320, height: 184 });
    expect(aicraft.CELESTE_ROOM_SLIDE_DURATION).toBe(0.65);
  });

  it('camera transform: the pixel-snap policy is public', () => {
    expect(typeof aicraft.cameraTransform).toBe('function');
    expect(typeof aicraft.applyCameraTransform).toBe('function');
    // Device snapping is the default: the origin lands on a device pixel even
    // under a fractional zoom.
    const t = aicraft.cameraTransform({ x: 101.37, y: 0 }, { width: 960, height: 540 }, { zoom: 2.75 });
    expect(Number.isInteger(t.offsetX * 2.75)).toBe(true);
  });

  it('input: createEdgeAccumulator and orEdges are functions', () => {
    expect(typeof aicraft.createEdgeAccumulator).toBe('function');
    expect(typeof aicraft.orEdges).toBe('function');
  });

  it('input: the 0.20.0 multi-device merge + frozen-map extenders are public', () => {
    expect(typeof aicraft.mergeEdges).toBe('function');
    expect(typeof aicraft.mergePolledEdgeMaps).toBe('function');
    expect(typeof aicraft.extendKeyboardMap).toBe('function');
    expect(typeof aicraft.extendGamepadMap).toBe('function');
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

  it('game-state: the 0.20.0 menu navigation layer is public', () => {
    expect(typeof aicraft.createMenuNav).toBe('function');
    expect(typeof aicraft.advanceMenuNav).toBe('function');
    expect(typeof aicraft.openMenuNav).toBe('function');
    expect(typeof aicraft.clampMenuNavIndex).toBe('function');
    expect(typeof aicraft.IDLE_MENU_INPUT).toBe('object');
  });

  it('platformer: the 0.20.0 FallingBlock recipe is public', () => {
    expect(typeof aicraft.collectFallingBlocks).toBe('function');
    expect(typeof aicraft.advanceFallingBlocks).toBe('function');
    expect(typeof aicraft.fallingBlockSolids).toBe('function');
    expect(typeof aicraft.fallingBlockArmed).toBe('function');
    expect(typeof aicraft.scaleFallingBlockTuning).toBe('function');
    expect(aicraft.FALLING_BLOCK_TRIGGER_ACTION).toBe('FallingBlock');
    expect(typeof aicraft.FALLING_BLOCK_TUNING).toBe('object');
  });

  it('audio: createAudioAdapter is a function', () => {
    expect(typeof aicraft.createAudioAdapter).toBe('function');
    // Compile-time type use: the sustained-voice options record must be
    // importable (startNoiseLoop's 4th parameter).
    const _opts: aicraft.NoiseLoopOptions = { q: 10, noise: 'pink' };
    void _opts;
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
    // The kind → clip grouping and the clip-aware clock: five kinds, three
    // clips, so one held jump arc never restarts its animation.
    expect(typeof aicraft.spriteAnimClipFor).toBe('function');
    expect(aicraft.spriteAnimClipFor('apex')).toBe('jump');
    expect(typeof aicraft.createSpriteAnimPlayer).toBe('function');
    expect(typeof aicraft.advanceSpriteAnimPlayer).toBe('function');
  });

  it('room-transition hardening: re-arm detector, hard-cut seed, and safe slide constructor are public', () => {
    // Tick-tock prevention (re-arm hysteresis over findLdtkRoomExit).
    expect(typeof aicraft.createRoomExitDetectorState).toBe('function');
    expect(typeof aicraft.detectLdtkRoomExit).toBe('function');
    expect(typeof aicraft.DEFAULT_EXIT_DEADBAND).toBe('number');
    expect(aicraft.DEFAULT_EXIT_DEADBAND).toBe(1);
    // Dip-down prevention — hard room cut + safe slide constructor.
    expect(typeof aicraft.seedRoomCutCamera).toBe('function');
    expect(typeof aicraft.beginRoomSlideFromBrain).toBe('function');
    // Follow-compatible destination framing (0.11.0).
    expect(typeof aicraft.roomEntrySlideView).toBe('function');
    // The bare primitives remain public (back-compat).
    expect(typeof aicraft.findLdtkRoomExit).toBe('function');
    expect(typeof aicraft.beginRoomSlide).toBe('function');
    expect(typeof aicraft.stabilizePlatformerRoomEntry).toBe('function');
    // Seam apron (0.18.0) — the structural replacement for the removed
    // protectGroundedRoomSlide guard (no post-hoc clamps: the neighbour's
    // floor simply exists in the tick set).
    expect(typeof aicraft.compileRoomSeamApron).toBe('function');
    expect(typeof aicraft.createSeamApronCache).toBe('function');
    expect(typeof aicraft.seamApronSourceFromSolidId).toBe('function');
    expect(typeof aicraft.seamSpanFor).toBe('function');
    expect(aicraft.DEFAULT_SEAM_APRON_DEPTH).toBe(64);
    expect(typeof aicraft.cameraApertureLetterbox).toBe('function');
    expect(typeof aicraft.applyCameraApertureLetterbox).toBe('function');
    // Compile-time type uses: the new exported types must be importable.
    const _state: aicraft.RoomExitDetectorState = aicraft.createRoomExitDetectorState();
    const _detection: aicraft.RoomExitDetection = { state: _state };
    const _opts: aicraft.RoomExitDetectorOptions = {};
    const _entryOpts: aicraft.RoomEntrySupportOptions = {};
    const _entryResult: aicraft.PlatformerRoomEntryStabilization = {
      state: {} as aicraft.PlatformerState,
      entry: { x: 0, y: 0, dir: 'e', toLevelIid: 'room' },
      corrected: false,
    };
    const _apronOpts: aicraft.SeamApronOptions = {};
    const _apronSource = aicraft.seamApronSourceFromSolidId('apron:L1:tile-0-160-32-8');
    expect(_apronSource?.levelIid).toBe('L1');
    void _apronOpts;
  const _slideOpts: aicraft.RoomEntrySlideViewOptions = {};
  void _slideOpts;
    void _detection; void _opts; void _entryOpts; void _entryResult;
  });

  it('room-transition session (0.15.0): the five orchestrator functions and their types are public', () => {
    // The session owns { detector, slide } as ONE state machine — suppressed
    // polls and refused begins during a slide, the finish-rebase exactly once,
    // one cancel-with-rebase abnormal-exit path.
    expect(typeof aicraft.createRoomTransitionSession).toBe('function');
    expect(typeof aicraft.pollRoomTransition).toBe('function');
    expect(typeof aicraft.beginSessionRoomSlide).toBe('function');
    expect(typeof aicraft.advanceSessionRoomSlide).toBe('function');
    expect(typeof aicraft.endRoomTransitionSession).toBe('function');
    // Compile-time type uses: the new exported types must be importable.
    const _session: aicraft.RoomTransitionSessionState = aicraft.createRoomTransitionSession();
    const _poll: aicraft.RoomTransitionPollResult = { type: 'idle' };
    type _BeginInput = aicraft.SessionSlideBeginInput;
    void 0 as _BeginInput | undefined;
    void _session; void _poll;
  });
});
