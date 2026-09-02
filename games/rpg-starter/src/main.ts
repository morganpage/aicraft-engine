/**
 * Browser entry: canvas, fixed-step loop, keyboard events, and rendering —
 * all thin composition over `createStarterGame` (the same object tests
 * drive headlessly). No gameplay rules live here.
 */

import {
  advanceAccumulator,
  DEFAULT_MAX_FRAME_DELTA,
  createLocalStorageSaveStorage,
  getDevicePixelRatio,
  applyCanvasDprTransform,
  resizeCanvasToBackingStore,
  drawRpgMap,
  drawRpgActor,
  drawRpgNpc,
  drawRpgDialogue,
  drawRpgBattleScene,
  drawPartyHud,
  drawInventoryHud,
  getDialogueRequest,
  DEFAULT_RPG_CONFIG,
  DEFAULT_RPG_THEME,
  STARTER_FIELD_MAP_ID,
  type RpgEvent,
} from 'aicraft-engine';
import { createStarterGame } from './game';
import './style.css';

const game = createStarterGame({ storage: createLocalStorageSaveStorage() });
if (game.hasSave()) game.load();

const canvas = document.getElementById('game') as HTMLCanvasElement;
const maybeCtx = canvas.getContext('2d');
if (!maybeCtx) throw new Error('Canvas 2D context unavailable');
const ctx: CanvasRenderingContext2D = maybeCtx;

const VIEW_TILES_X = 15;
const VIEW_TILES_Y = 10;
const TILE = game.content.maps[STARTER_FIELD_MAP_ID].tileSize;

const DPR = { ratio: 1 };
function resize(): void {
  DPR.ratio = getDevicePixelRatio();
  resizeCanvasToBackingStore(canvas, canvas.clientWidth || 480, canvas.clientHeight || 320);
  applyCanvasDprTransform(ctx, DPR.ratio);
}
window.addEventListener('resize', resize);
resize();

window.addEventListener('keydown', (event) => {
  game.pressKey(event.key);
  if (event.key === 's' || event.key === 'S') game.save();
  if (event.key === 'l' || event.key === 'L') game.load();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) event.preventDefault();
});
window.addEventListener('keyup', (event) => game.releaseKey(event.key));
window.addEventListener('pointerdown', () => game.tick(game.sampleInput()) /* also arms audio via adapter */);

let accumulator = 0;
let lastTime = performance.now();
let presentationTick = 0;

function frame(now: number): void {
  const frameDelta = Math.min(0.25, (now - lastTime) / 1000);
  lastTime = now;
  const stepped = advanceAccumulator(accumulator, frameDelta, DEFAULT_RPG_CONFIG.tickDuration, DEFAULT_MAX_FRAME_DELTA, () => {
    const events: readonly RpgEvent[] = game.tick(game.sampleInput());
    for (const event of events) handleEventCue(event);
    presentationTick += 1;
  });
  accumulator = stepped.accumulator;
  render();
  requestAnimationFrame(frame);
}

function handleEventCue(event: RpgEvent): void {
  const hint = document.getElementById('hint');
  if (!hint) return;
  if (event.type === 'battleEnded') {
    hint.textContent = `Battle ended: ${event.outcome}. Press S to save.`;
  } else if (event.type === 'levelGained') {
    hint.textContent = `Level up! Now level ${event.level}.`;
  } else if (event.type === 'encounterTriggered') {
    hint.textContent = `A wild creature appears (Lv ${event.level})!`;
  } else if (event.type === 'healApplied') {
    hint.textContent = 'Your team is fully rested.';
  }
}

function render(): void {
  const state = game.getState();
  ctx.fillStyle = DEFAULT_RPG_THEME.terrain.groundAlt;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (state.activity.kind === 'battle') {
    drawRpgBattleScene(ctx, state.activity.battle, game.content, {
      width: canvas.width,
      height: canvas.height,
      tick: presentationTick,
    });
    const commands = game.battleCommands();
    ctx.fillStyle = DEFAULT_RPG_THEME.panels.background;
    ctx.fillRect(0, canvas.height - 26, canvas.width, 26);
    ctx.fillStyle = DEFAULT_RPG_THEME.panels.text;
    ctx.font = '10px monospace';
    const label = commands.length > 0
      ? commands.map((command, index) => {
          if (command.type === 'fight') return `${index + 1}:${command.moveId}`;
          if (command.type === 'catch') return `${index + 1}:Catch`;
          if (command.type === 'switch') return `${index + 1}:Switch`;
          return `${index + 1}:Flee`;
        }).join('  ')
      : '...';
    ctx.fillText(label, 8, canvas.height - 12);
    return;
  }

  const overworld = state.activity.kind === 'overworld'
    ? state.activity.overworld
    : state.activity.returnTo;
  const map = game.content.maps[overworld.location.mapId];
  if (!map) return;

  const cameraX = Math.max(0, Math.min(
    map.widthTiles * TILE - VIEW_TILES_X * TILE,
    overworld.location.tileX * TILE - Math.floor(VIEW_TILES_X / 2) * TILE,
  ));
  const cameraY = Math.max(0, Math.min(
    map.heightTiles * TILE - VIEW_TILES_Y * TILE,
    overworld.location.tileY * TILE - Math.floor(VIEW_TILES_Y / 2) * TILE,
  ));

  drawRpgMap(ctx, map, { cameraX, cameraY, tick: presentationTick });
  for (const npc of map.npcs) {
    drawRpgNpc(ctx, {
      x: npc.tile.tileX * TILE + TILE / 2 - cameraX,
      y: npc.tile.tileY * TILE + TILE / 2 + 4 - cameraY,
      size: 10,
      facing: npc.facing,
      tick: presentationTick,
    });
  }
  drawRpgActor(ctx, {
    x: overworld.location.tileX * TILE + TILE / 2 - cameraX,
    y: overworld.location.tileY * TILE + TILE / 2 + 4 - cameraY,
    size: 10,
    facing: overworld.location.facing,
    moving: overworld.step !== null,
    tick: presentationTick,
    body: DEFAULT_RPG_THEME.actors.playerBody,
    outline: DEFAULT_RPG_THEME.actors.playerOutline,
  });

  drawPartyHud(ctx, state.party, game.content.species, { x: canvas.width - 150, y: 8, width: 140 });
  drawInventoryHud(ctx, state.inventory, game.content.items, { x: canvas.width - 150, y: 8 + state.party.length * 26 + 6 });

  if (state.activity.kind === 'dialogue') {
    const dialogue = game.content.dialogues[state.activity.dialogue.dialogueId];
    if (dialogue) {
      const request = getDialogueRequest(dialogue, state.activity.dialogue.session, {
        flags: state.flags,
        inventory: state.inventory,
        partySize: state.party.length,
        maxPartySize: 6,
      });
      if (request) {
        drawRpgDialogue(ctx, request, { width: canvas.width, y: canvas.height - 110, revealRatio: 1 });
      }
    }
  }
}

requestAnimationFrame(frame);
