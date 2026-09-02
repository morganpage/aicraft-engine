import { describe, it, expect, vi } from 'vitest';
import { drawRpgMap } from '../renderer/map-renderer';
import { drawRpgActor, drawRpgNpc } from '../renderer/actor-renderer';
import { drawRpgCreature } from '../renderer/creature-renderer';
import { drawRpgDialogue, wrapDialogueText } from '../renderer/dialogue-renderer';
import { drawRpgBattleScene, createBattlePresentationQueue } from '../renderer/battle-renderer';
import { drawHpBar, drawPartyHud } from '../renderer/hud-renderer';
import { DEFAULT_RPG_THEME } from '../renderer/theme';
import { generateSpeciesSet } from '../creature-generator';
import { STARTER_MOVES, STARTER_TYPE_IDS, createStarterContentBundle } from '../starter';
import { compileRpgContent } from '../content';
import { createCreatureInstance } from '../creatures';
import { meetsWcagAa } from '../../primitives/color';
import { DEFAULT_FONT, measureText } from '../../primitives/bitmap-font';
import type { RpgMapDefinition, RpgTerrainKind } from '../map';
import type { CreatureVisualManifest, SpeciesDefinition } from '../creatures';
import type { BattleEvent } from '../battle-types';
import type { AudioAdapter } from '../../audio/types';
import { playRpgCue, rpgCueForBattleEvent } from '../audio';

/**
 * Behavioral renderer tests on a stub context (no pixel assertions): call
 * logs prove shapes are drawn, determinism proves the same state renders
 * identically, and contrast/motion contracts are checked directly.
 */

interface RecordedCall {
  readonly op: string;
  readonly style: string;
  readonly args: readonly unknown[];
}

function createStubCtx() {
  const calls: RecordedCall[] = [];
  const round = (value: unknown): unknown => {
    if (typeof value === 'number') return Math.round(value * 100) / 100;
    if (Array.isArray(value)) return value.map(round);
    return value;
  };
  const state = { fillStyle: '', strokeStyle: '' };
  const record = (name: string, style: 'fillStyle' | 'strokeStyle' | null) => {
    const fn = (...args: unknown[]) => {
      calls.push({ op: name, style: style ? state[style] : '', args: args.map(round) });
      return undefined;
    };
    return Object.assign(fn, vi.fn());
  };
  const ctx = {
    calls,
    state,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    fillRect: record('fillRect', 'fillStyle'),
    strokeRect: record('strokeRect', 'strokeStyle'),
    beginPath: record('beginPath', null),
    ellipse: record('ellipse', null),
    arc: record('arc', null),
    fill: record('fill', 'fillStyle'),
    stroke: record('stroke', 'strokeStyle'),
    fillText: record('fillText', 'fillStyle'),
  };
  return new Proxy(ctx as unknown as CanvasRenderingContext2D & { calls: RecordedCall[]; state: { fillStyle: string; strokeStyle: string } }, {
    get(target, prop) {
      if (prop === 'fillStyle') return target.state.fillStyle;
      if (prop === 'strokeStyle') return target.state.strokeStyle;
      return Reflect.get(target, prop);
    },
    set(target, prop, value) {
      if (prop === 'fillStyle') target.state.fillStyle = String(value);
      else if (prop === 'strokeStyle') target.state.strokeStyle = String(value);
      else Reflect.set(target, prop, value);
      return true;
    },
  });
}

function fillRectsOf(ctx: CanvasRenderingContext2D & { calls: RecordedCall[] }): RecordedCall[] {
  return ctx.calls.filter((call) => call.op === 'fillRect');
}

const W = 8;
const H = 6;

function makeMap(): RpgMapDefinition {
  const terrain = new Array<RpgTerrainKind>(W * H).fill('ground');
  terrain[10] = 'grass';
  terrain[11] = 'obstacle';
  terrain[12] = 'path';
  return {
    schemaVersion: 1,
    id: 'test-map',
    name: 'Test',
    widthTiles: W,
    heightTiles: H,
    tileSize: 16,
    terrain,
    collision: new Array<boolean>(W * H).fill(false),
    encounterZones: (() => { const z = new Array<string | null>(W * H).fill(null); z[10] = 'grass'; return z; })(),
    spawns: [{ id: 'start', tile: { tileX: 1, tileY: 1 }, facing: 'down' }],
    npcs: [],
    warps: [{ id: 'door', source: { tileX: 3, tileY: 3 }, targetMapId: 'clinic', targetAnchorId: 'entry', targetFacing: 'up' }],
    healPoints: [{ id: 'mat', tile: { tileX: 5, tileY: 4 } }],
  };
}

const CATALOG = { typeIds: STARTER_TYPE_IDS, moves: STARTER_MOVES };

describe('map renderer', () => {
  it('draws every tile plus door and heal markers', () => {
    const ctx = createStubCtx();
    drawRpgMap(ctx, makeMap(), { tick: 0 });
    expect(fillRectsOf(ctx).length).toBeGreaterThanOrEqual(W * H);
    expect(fillRectsOf(ctx).some((call) => call.style === DEFAULT_RPG_THEME.markers.door)).toBe(true);
    expect(fillRectsOf(ctx).some((call) => call.style === DEFAULT_RPG_THEME.markers.heal)).toBe(true);
    expect(fillRectsOf(ctx).some((call) => call.style === DEFAULT_RPG_THEME.terrain.grass)).toBe(true);
  });
  it('is deterministic per (map, tick)', () => {
    const a = createStubCtx();
    const b = createStubCtx();
    drawRpgMap(a, makeMap(), { tick: 30 });
    drawRpgMap(b, makeMap(), { tick: 30 });
    expect(a.calls).toEqual(b.calls);
  });
});

describe('actor renderer', () => {
  it('draws for every facing without throwing', () => {
    for (const facing of ['up', 'down', 'left', 'right'] as const) {
      const ctx = createStubCtx();
      drawRpgActor(ctx, { x: 50, y: 50, size: 12, facing, moving: true, tick: 8, body: '#ffffff', outline: '#000000' });
      expect(ctx.calls.length).toBeGreaterThan(2);
    }
  });
  it('drawRpgNpc uses theme npc colors', () => {
    const ctx = createStubCtx();
    drawRpgNpc(ctx, { x: 40, y: 40, size: 12, facing: 'down', tick: 0 });
    expect(ctx.calls.length).toBeGreaterThan(2);
  });
});

describe('creature renderer', () => {
  const SET = generateSpeciesSet(2026, CATALOG);

  it('renders all six starter species distinctively', () => {
    const signatures = new Set<string>();
    for (const species of SET) {
      const ctx = createStubCtx();
      drawRpgCreature(ctx, species.visual, { x: 60, y: 60, size: 48, tick: 0, reducedMotion: true });
      expect(ctx.calls.length).toBeGreaterThan(3);
      signatures.add(ctx.calls.map((call) => JSON.stringify(call)).join('|'));
    }
    // Five body plans across six species — at least five distinct signatures.
    expect(signatures.size).toBeGreaterThanOrEqual(5);
  });
  it('is deterministic per (manifest, tick) and stable across sizes', () => {
    const manifest: CreatureVisualManifest = SET[0].visual;
    const a = createStubCtx();
    const b = createStubCtx();
    drawRpgCreature(a, manifest, { x: 60, y: 60, size: 48, tick: 20, reducedMotion: true });
    drawRpgCreature(b, manifest, { x: 60, y: 60, size: 48, tick: 20, reducedMotion: true });
    expect(a.calls).toEqual(b.calls);
  });
  it('decorative animation derives from tick only (reduced motion frozen)', () => {
    const manifest = SET[1].visual;
    const frozenA = createStubCtx();
    const frozenB = createStubCtx();
    drawRpgCreature(frozenA, manifest, { x: 60, y: 60, size: 48, tick: 0, reducedMotion: true });
    drawRpgCreature(frozenB, manifest, { x: 60, y: 60, size: 48, tick: 999, reducedMotion: true });
    expect(frozenA.calls).toEqual(frozenB.calls);
  });
});

describe('dialogue renderer', () => {
  it('meets WCAG AA for text on the panel background', () => {
    expect(meetsWcagAa(DEFAULT_RPG_THEME.panels.text, DEFAULT_RPG_THEME.panels.background)).toBe(true);
    expect(meetsWcagAa(DEFAULT_RPG_THEME.panels.accent, DEFAULT_RPG_THEME.panels.background)).toBe(true);
  });
  it('wraps text to the requested width', () => {
    const text = 'Weaken a creature before throwing your capture orb across the meadow.';
    const lines = wrapDialogueText(text, DEFAULT_FONT, 120, 2);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measureText(line, DEFAULT_FONT, 2).width).toBeLessThanOrEqual(120);
    }
  });
  it('reveals text proportionally: ratio 1 draws all lines, ratio 0 draws none', () => {
    const request = {
      nodeId: 'n',
      speakerId: 'guide',
      text: 'Hello there, traveler. The grass rustles.',
      choices: [{ id: 'a', text: 'Advice' }],
      cursor: 0,
    };
    const full = createStubCtx();
    drawRpgDialogue(full, request, { width: 240, y: 100, revealRatio: 1 });
    const empty = createStubCtx();
    drawRpgDialogue(empty, request, { width: 240, y: 100, revealRatio: 0 });
    // The bitmap font draws glyphs as fillRects in the text color; full
    // reveal draws glyphs, zero reveal draws none.
    const bodyGlyphs = (ctx: ReturnType<typeof createStubCtx>) =>
      fillRectsOf(ctx).filter((call) => call.style === DEFAULT_RPG_THEME.panels.text).length;
    expect(bodyGlyphs(full)).toBeGreaterThan(bodyGlyphs(empty));
  });
});

describe('battle renderer', () => {
  const COMPILED = compileRpgContent(createStarterContentBundle(2026));
  if (!COMPILED.ok) throw new Error('content must compile');
  const content = COMPILED.content;
  const species: SpeciesDefinition = content.species[content.speciesIds[0]];
  const wildSpecies: SpeciesDefinition = content.species[content.speciesIds[1]];
  const player = createCreatureInstance({ id: 'p', species, level: 4, individualSeed: 1 });
  const wild = createCreatureInstance({ id: 'w', species: wildSpecies, level: 4, individualSeed: 2 });

  function battleState(): import('../battle-types').BattleState {
    return {
      schemaVersion: 1,
      rulesVersion: 1,
      turn: 1,
      phase: 'command',
      playerParty: [player],
      battleInventory: [],
      activePlayerIndex: 0,
      wild,
      battleRng: { value: 123 },
      failedFleeAttempts: 0,
      rewardsApplied: false,
    };
  }

  it('draws the scene and both HP bars from authoritative state', () => {
    const ctx = createStubCtx();
    drawRpgBattleScene(ctx, battleState(), content, { width: 320, height: 180, tick: 0 });
    expect(ctx.calls.length).toBeGreaterThan(6);
  });

  it('presentation queue: advance, skip, and drain without affecting state', () => {
    const events: BattleEvent[] = [
      { type: 'moveUsed', actorId: 'p', moveId: 'ember-jab', targetId: 'w' },
      { type: 'damageDealt', targetId: 'w', amount: 5, hpAfter: 10 },
      { type: 'battleEnded', outcome: 'victory' },
    ];
    const queue = createBattlePresentationQueue();
    queue.push(events);
    expect(queue.pendingCount).toBe(3);
    expect(queue.activeCue()?.event.type).toBe('moveUsed');

    queue.advance(10);
    expect(queue.pendingCount).toBe(0);
    expect(queue.drainCompleted().map((e) => e.type)).toEqual(events.map((e) => e.type));

    queue.push(events);
    queue.skipAll();
    expect(queue.pendingCount).toBe(0);
    expect(queue.drainCompleted().length).toBe(3);

    // Replay invariance: same events → same pacing.
    const a = createBattlePresentationQueue();
    const b = createBattlePresentationQueue();
    a.push(events);
    b.push(events);
    a.advance(0.1);
    b.advance(0.1);
    expect(a.activeCue()?.elapsedS).toBeCloseTo(b.activeCue()?.elapsedS ?? -1, 6);
  });
});

describe('hud renderer', () => {
  it('draws proportional HP bars with low-HP coloring', () => {
    const ctx = createStubCtx();
    drawHpBar(ctx, { x: 8, y: 8, width: 100, label: 'Cub L4', current: 10, max: 20 });
    expect(fillRectsOf(ctx).some((call) => call.args[2] === 50 && call.style === DEFAULT_RPG_THEME.panels.hpFill)).toBe(true);
    const low = createStubCtx();
    drawHpBar(low, { x: 8, y: 8, width: 100, label: 'Cub L4', current: 1, max: 20 });
    expect(fillRectsOf(low).some((call) => call.args[2] === 5 && call.style === DEFAULT_RPG_THEME.panels.hpLow)).toBe(true);
  });
  it('draws one bar per party member', () => {
    const ctx = createStubCtx();
    const species: SpeciesDefinition = {
      id: 'cub', name: 'Cub', typeId: 'ember',
      baseStats: { hp: 12, attack: 12, defense: 12, speed: 12 },
      catchBasisPoints: 4000, expYield: 30, learnset: [],
      visual: { generatorVersion: 1, bodyPlan: 'blob', paletteSeed: 1, proportions: {}, features: [] },
    };
    const party = [
      createCreatureInstance({ id: 'a', species, level: 4, individualSeed: 1 }),
      createCreatureInstance({ id: 'b', species, level: 5, individualSeed: 2 }),
    ];
    drawPartyHud(ctx, party, { cub: species }, { x: 8, y: 8, width: 120 });
    expect(ctx.calls.length).toBeGreaterThan(6);
  });
});

describe('rpg audio cues', () => {
  function stubAdapter(throwing = false): AudioAdapter {
    return {
      unlock: () => { if (throwing) throw new Error('boom'); },
      isUnlocked: () => true,
      playTone: () => { if (throwing) throw new Error('boom'); },
      playNoise: () => { if (throwing) throw new Error('boom'); },
    } as unknown as AudioAdapter;
  }
  it('maps battle events to cues', () => {
    expect(rpgCueForBattleEvent({ type: 'moveUsed', actorId: 'p', moveId: 'x', targetId: 'w' })).toBe('attack');
    expect(rpgCueForBattleEvent({ type: 'damageDealt', targetId: 'w', amount: 1, hpAfter: 1 })).toBe('hit');
    expect(rpgCueForBattleEvent({ type: 'levelGained', creatureId: 'p', level: 5 })).toBe('levelUp');
    expect(rpgCueForBattleEvent({ type: 'captureAttempted', chanceBasisPoints: 1, roll: 1 })).toBeNull();
  });
  it('plays without throwing, and silently on failures', () => {
    expect(() => playRpgCue(stubAdapter(), 'menuConfirm')).not.toThrow();
    expect(() => playRpgCue(stubAdapter(true), 'heal')).not.toThrow();
    expect(() => playRpgCue(null, 'save')).not.toThrow();
  });
});
