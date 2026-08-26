/** Shared runtime shape (§11). Later stages add fields; nothing here is final. */
import type {
  CameraBrain,
  CompiledLdtkRoom,
  LdtkTilesetBundle,
  PlatformerConfig,
  PlatformerState,
} from 'aicraft-engine';
import type { LdtkRoomPainter } from './recipes/ldtk-draw-pipeline';

export interface Game {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly painter: LdtkRoomPainter;
  readonly tilesets: LdtkTilesetBundle;
  active: CompiledLdtkRoom;
  brain: CameraBrain;
  player: PlatformerState;
  config: Readonly<PlatformerConfig>;
  viewport: { width: number; height: number };
  dpr: number;
}
