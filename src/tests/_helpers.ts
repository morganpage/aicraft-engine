import { vi } from 'vitest';

/**
 * Minimal mock for `CanvasRenderingContext2D` for testing draw primitives.
 *
 * The surface used by `outlineRect` (fill/stroke), `drawRig`
 * (save/transform/restore), `drawGlow` (radial gradient + additive
 * blend), and `drawSpider` (path drawing + save/restore) is mocked.
 * Add fields as more primitives are added. The mock records calls via
 * `vi.fn()` so tests can assert on style properties and draw-call args.
 */
export interface MockCtx {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  globalCompositeOperation: string;
  globalAlpha: number;
  fillRect: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  transform: ReturnType<typeof vi.fn>;
  createRadialGradient: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  closePath: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
}

export function createMockCtx(): MockCtx {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    transform: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
  };
}
