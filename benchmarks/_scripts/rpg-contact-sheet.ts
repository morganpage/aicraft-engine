// Deterministic RPG contact sheets: all six starter species (battle +
// portrait sizes), a full world overview, a battle scene, and a dialogue
// panel. Output PNGs land in benchmarks/rpg/ for human visual review —
// the same seed always produces the same sheet.
//
// Run: npm run rpg:sheets

import { createCanvas } from 'canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileRpgContent } from '../../src/rpg/content';
import { createStarterContentBundle, STARTER_MOVES, STARTER_TYPE_IDS } from '../../src/rpg/starter';
import { generateSpeciesSet } from '../../src/rpg/creature-generator';
import { createCreatureInstance } from '../../src/rpg/creatures';
import { drawRpgMap } from '../../src/rpg/renderer/map-renderer';
import { drawRpgActor, drawRpgNpc } from '../../src/rpg/renderer/actor-renderer';
import { drawRpgCreature } from '../../src/rpg/renderer/creature-renderer';
import { drawRpgDialogue } from '../../src/rpg/renderer/dialogue-renderer';
import { drawRpgBattleScene } from '../../src/rpg/renderer/battle-renderer';
import { drawPartyHud } from '../../src/rpg/renderer/hud-renderer';
import { createRpgState } from '../../src/rpg/state';
import type { BattleState } from '../../src/rpg/battle-types';

const SEED = 2026;
const OUT_DIR = 'benchmarks/rpg';

function save(canvas: HTMLCanvasElement, name: string): void {
  const target = join(OUT_DIR, name);
  writeFileSync(target, canvas.toBuffer('image/png'));
  console.log(`[rpg-contact-sheet] wrote ${target}`);
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const compiled = compileRpgContent(createStarterContentBundle(SEED));
  if (!compiled.ok) throw new Error(`starter content failed to compile: ${JSON.stringify(compiled.diagnostics)}`);
  const content = compiled.content;

  // 1. Species contact sheet: six species at battle size and portrait size.
  const species = generateSpeciesSet(SEED, { typeIds: STARTER_TYPE_IDS, moves: STARTER_MOVES });
  const sheet = createCanvas(6 * 120 + 20, 320);
  const sctx = sheet.getContext('2d');
  sctx.fillStyle = '#20202a';
  sctx.fillRect(0, 0, sheet.width, sheet.height);
  species.forEach((def, index) => {
    drawRpgCreature(sctx, def.visual, { x: 60 + index * 120 + 40, y: 100, size: 84, tick: 0, reducedMotion: true });
    drawRpgCreature(sctx, def.visual, { x: 60 + index * 120 + 40, y: 220, size: 44, tick: 0, reducedMotion: true });
  });
  save(sheet, 'species-contact-sheet.png');

  // 2. World overview with actors.
  const field = content.maps[content.mapIds[0]];
  const world = createCanvas(field.widthTiles * field.tileSize, field.heightTiles * field.tileSize);
  const wctx = world.getContext('2d');
  drawRpgMap(wctx, field, { tick: 0 });
  for (const npc of field.npcs) {
    drawRpgNpc(wctx, {
      x: npc.tile.tileX * field.tileSize + field.tileSize / 2,
      y: npc.tile.tileY * field.tileSize + field.tileSize / 2 + 4,
      size: 10,
      facing: npc.facing,
      tick: 0,
    });
  }
  drawRpgActor(wctx, {
    x: field.spawns[0].tile.tileX * field.tileSize + field.tileSize / 2,
    y: field.spawns[0].tile.tileY * field.tileSize + field.tileSize / 2 + 4,
    size: 10,
    facing: 'right',
    moving: false,
    tick: 0,
    body: '#4f86f7',
    outline: '#1b3f8f',
  });
  save(world, 'world-overview.png');

  // 3. Battle scene + party HUD.
  const playerSpecies = content.species[content.speciesIds[0]];
  const wildSpecies = content.species[content.speciesIds[1]];
  const battle: BattleState = {
    schemaVersion: 1,
    rulesVersion: 1,
    turn: 2,
    phase: 'command',
    playerParty: [createCreatureInstance({ id: 'p', species: playerSpecies, level: 4, individualSeed: 1 })],
    battleInventory: [],
    activePlayerIndex: 0,
    wild: createCreatureInstance({ id: 'w', species: wildSpecies, level: 4, individualSeed: 2 }),
    battleRng: { value: 1 },
    failedFleeAttempts: 0,
    rewardsApplied: false,
  };
  const battleCanvas = createCanvas(320, 200);
  const bctx = battleCanvas.getContext('2d');
  drawRpgBattleScene(bctx, battle, content, { width: 320, height: 160, tick: 0 });
  const state = createRpgState(content, SEED);
  drawPartyHud(bctx, state.party, content.species, { x: 8, y: 164, width: 160 });
  save(battleCanvas, 'battle-scene.png');

  // 4. Dialogue panel mock.
  const dialogue = content.dialogues[content.dialogueIds[0]];
  const dialogueCanvas = createCanvas(320, 120);
  const dctx = dialogueCanvas.getContext('2d');
  dctx.fillStyle = '#7a9e5f';
  dctx.fillRect(0, 0, 320, 120);
  const request = {
    nodeId: 'greet',
    speakerId: 'field-guide',
    text: dialogue.nodes[0].text,
    choices: dialogue.nodes[0].choices?.map((choice) => ({ id: choice.id, text: choice.text })) ?? [],
    cursor: 0,
  };
  drawRpgDialogue(dctx, request, { width: 320, y: 20, revealRatio: 1 });
  save(dialogueCanvas, 'dialogue-panel.png');

  console.log('[rpg-contact-sheet] done');
}

main();
