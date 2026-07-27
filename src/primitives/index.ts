export { outlineRect, DEFAULT_OUTLINE_COLOR, type OutlineCoverage } from './outline-rect';
export {
  parseHex,
  toHex,
  shade,
  mixHex,
  complement,
  relativeLuminance,
  contrastRatio,
  meetsWcagAa,
  type RGB,
} from './color';
export { clamp, floor, lerp, approach } from './pixel';
export { prefersReducedMotion, resetMotionCacheForTests } from './motion';
export {
  FALLBACK_DPR,
  getDevicePixelRatio,
  resetDprCacheForTests,
  resizeCanvasToBackingStore,
} from './dpr';
export {
  createHitStop,
  triggerHitStop,
  stepHitStop,
  isHitStopActive,
  DEFAULT_HIT_STOP_DURATION,
  type HitStopState,
} from './hit-stop';
export {
  waveDisplacement,
  gerstnerDisplacement,
  generateWaveLine,
  DEFAULT_WAVE_LINE,
  DEFAULT_GERSTNER,
  type WaveOctave,
  type GerstnerOctave,
  type WaveDisplacementConfig,
  type GerstnerDisplacementConfig,
  type WaveMode,
  type WaveLineConfig,
  type WavePoint,
} from './wave-line';
export {
  drawGlow,
  DEFAULT_GLOW_INTENSITY,
} from './glow';
export {
  parallaxOffset,
  PARALLAX_FAR,
  PARALLAX_MID,
  PARALLAX_NEAR,
  tiledParallaxRange,
  drawTiledParallax,
  type TiledParallaxRange,
} from './parallax';
export {
  createFont,
  addGlyph,
  measureText,
  drawText,
  drawTextOutlined,
  DEFAULT_FONT,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_SCALE,
  DEFAULT_LINE_GAP,
  DEFAULT_CHAR_GAP,
  type BitmapFont,
  type GlyphData,
  type TextMetrics,
  type TextAlign,
  type TextDrawOptions,
} from './bitmap-font';
export {
  FONT_5X7_DATA,
  FONT_5X7_GLYPHS,
  FONT_5X7_CELL_WIDTH,
  FONT_5X7_CELL_HEIGHT,
  FONT_5X7_FIRST_CHAR,
  FONT_5X7_LAST_CHAR,
} from './font5x7-data';
