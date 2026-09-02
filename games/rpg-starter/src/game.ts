/**
 * Shared game wiring for the RPG starter: compiled content, the fixed-tick
 * facade loop, keyboard → semantic input mapping, audio cues, and the
 * save/load flow. The browser entry (`main.ts`) attaches a canvas and DOM
 * events; tests drive the same object headlessly — identical gameplay
 * either way, because all rules live in the engine.
 */

import {
  compileRpgContent,
  createRpgController,
  createRpgState,
  createRpgSave,
  migrateRpgSave,
  restoreRpgState,
  validateRpgSave,
  getBattleRequest,
  createAudioAdapter,
  createMemorySaveStorage,
  loadSave,
  writeSave,
  playRpgCue,
  rpgCueForBattleEvent,
  DEFAULT_RPG_CONFIG,
  type AudioAdapter,
  type BattleCommand,
  type CompiledRpgContent,
  type RpgDirection,
  type RpgEvent,
  type RpgInput,
  type RpgState,
  type SaveStorage,
} from 'aicraft-engine';
import { buildGameContent, GAME_SEED, SPAWN, STARTING_INVENTORY, STARTING_PARTY } from './content';

export interface StarterGameOptions {
  readonly storage?: SaveStorage;
  readonly audio?: AudioAdapter | null;
}

export interface StarterGame {
  readonly content: CompiledRpgContent;
  getState(): RpgState;
  /** Advance exactly one fixed tick with a semantic input snapshot. */
  tick(input: RpgInput): readonly RpgEvent[];
  /** Map a key press/release to semantic input state (edge-qualified). */
  pressKey(key: string): void;
  releaseKey(key: string): void;
  /** Current semantic input snapshot from held keys (consumes edges). */
  sampleInput(): RpgInput;
  /** The legal battle commands right now (empty outside battle decisions). */
  battleCommands(): readonly BattleCommand[];
  save(): boolean;
  load(): boolean;
  hasSave(): boolean;
  reset(): void;
  readonly diagnostics: readonly string[];
}

const DIRECTION_KEYS: Readonly<Record<string, RpgDirection>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
};

/**
 * Build the starter game. Boot order: compile content (never throws —
 * diagnostics are surfaced), then try to continue from storage, else start
 * a new session at the spawn with the granted party and inventory.
 */
export function createStarterGame(options: StarterGameOptions = {}): StarterGame {
  const compiled = compileRpgContent(buildGameContent());
  const diagnostics: string[] = [];
  if (!compiled.ok) {
    for (const diagnostic of compiled.diagnostics) diagnostics.push(`${diagnostic.path}: ${diagnostic.message}`);
    throw new Error(`starter content failed to compile:\n${diagnostics.join('\n')}`);
  }
  const content = compiled.content;
  const storage = options.storage ?? createMemorySaveStorage();
  const audio = options.audio === undefined ? createAudioAdapter() : options.audio;
  const controller = createRpgController(content, DEFAULT_RPG_CONFIG);

  const newSession = (): RpgState => createRpgState(content, GAME_SEED, {
    spawnMapId: SPAWN.mapId,
    spawnAnchorId: SPAWN.anchorId,
    startingParty: STARTING_PARTY.length > 0 ? [...STARTING_PARTY] : [{ speciesId: content.speciesIds[0], level: 4 }],
    startingInventory: [...STARTING_INVENTORY],
  });

  let state = newSession();

  let heldDirection: RpgDirection | null = null;
  let confirmEdge = false;
  let pendingBattleCommand: BattleCommand | null = null;

  const eventsSinceLastTick: RpgEvent[] = [];

  function currentBattleCommands(): readonly BattleCommand[] {
    return state.activity.kind === 'battle'
      ? getBattleRequest(state.activity.battle, content).legalCommands
      : [];
  }

  function emit(events: readonly RpgEvent[]): void {
    for (const event of events) {
      eventsSinceLastTick.push(event);
      const cue = rpgCueForBattleEvent(event);
      if (cue) playRpgCue(audio ?? undefined, cue);
    }
  }

  return {
    content,
    getState: () => state,
    tick(input) {
      const result = controller.step(state, input, DEFAULT_RPG_CONFIG.tickDuration);
      state = result.state;
      for (const diagnostic of result.diagnostics) diagnostics.push(`${diagnostic.code}: ${diagnostic.message}`);
      emit(result.events);
      const drained = [...eventsSinceLastTick];
      eventsSinceLastTick.length = 0;
      return drained;
    },
    pressKey(key) {
      const direction = DIRECTION_KEYS[key];
      if (direction) {
        heldDirection = direction;
        return;
      }
      if (key === 'Enter' || key === ' ' || key === 'e' || key === 'z') {
        confirmEdge = true;
        return;
      }
      if (key >= '1' && key <= '9') {
        const index = Number(key) - 1;
        const commands = currentBattleCommands();
        if (index < commands.length) pendingBattleCommand = commands[index];
      }
    },
    releaseKey(key) {
      const direction = DIRECTION_KEYS[key];
      if (direction && heldDirection === direction) heldDirection = null;
    },
    sampleInput() {
      const input: RpgInput = {
        direction: heldDirection,
        confirm: confirmEdge,
        cancel: false,
        menu: false,
        battleCommand: pendingBattleCommand,
      };
      confirmEdge = false;
      pendingBattleCommand = null;
      return input;
    },
    battleCommands: currentBattleCommands,
    save() {
      const result = createRpgSave(state);
      if (!result.save) {
        diagnostics.push('save rejected: not in an idle overworld state');
        return false;
      }
      writeSave(storage, result.save);
      playRpgCue(audio ?? undefined, 'save');
      return true;
    },
    load() {
      const raw = loadSave<unknown>(storage, null);
      if (!raw) return false;
      const migrated = migrateRpgSave(raw);
      if (!migrated.save) {
        diagnostics.push('load failed: save migration rejected the data');
        return false;
      }
      const validation = validateRpgSave(migrated.save, content);
      if (!validation.ok) {
        diagnostics.push('load failed: save does not match this content');
        return false;
      }
      const restored = restoreRpgState(migrated.save, content);
      if (!restored.state) return false;
      state = restored.state;
      return true;
    },
    hasSave() {
      const raw = loadSave<unknown>(storage, null);
      return raw !== null && raw !== false;
    },
    reset() {
      state = newSession();
    },
    diagnostics,
  };
}

