/**
 * Shared visual theme contracts for the RPG renderers.
 *
 * Every color lives here (no magic colors in draw code). The default theme
 * is verified WCAG-AA for text-on-panel pairs in tests. Games override any
 * slot by spreading their own theme object.
 */

export interface RpgTerrainColors {
  readonly ground: string;
  readonly groundAlt: string;
  readonly path: string;
  readonly grass: string;
  readonly grassAlt: string;
  readonly obstacle: string;
  readonly obstacleEdge: string;
}

export interface RpgMarkerColors {
  readonly door: string;
  readonly heal: string;
  readonly encounter: string;
}

export interface RpgActorColors {
  readonly playerBody: string;
  readonly playerOutline: string;
  readonly npcBody: string;
  readonly npcOutline: string;
}

export interface RpgPanelColors {
  readonly background: string;
  readonly border: string;
  readonly text: string;
  readonly textDim: string;
  readonly hpFill: string;
  readonly hpLow: string;
  readonly hpBack: string;
  readonly accent: string;
}

/** The complete visual theme consumed by every RPG renderer. */
export interface RpgVisualTheme {
  readonly terrain: RpgTerrainColors;
  readonly markers: RpgMarkerColors;
  readonly actors: RpgActorColors;
  readonly panels: RpgPanelColors;
}

export const DEFAULT_RPG_THEME: Readonly<RpgVisualTheme> = Object.freeze({
  terrain: Object.freeze({
    ground: '#7a9e5f',
    groundAlt: '#719257',
    path: '#c9b98a',
    grass: '#3f7a44',
    grassAlt: '#356b3a',
    obstacle: '#6b6b73',
    obstacleEdge: '#4a4a52',
  }),
  markers: Object.freeze({
    door: '#b8793f',
    heal: '#e35d6a',
    encounter: '#8fe08f',
  }),
  actors: Object.freeze({
    playerBody: '#4f86f7',
    playerOutline: '#1b3f8f',
    npcBody: '#d9a441',
    npcOutline: '#7a5a1a',
  }),
  panels: Object.freeze({
    background: '#14141c',
    border: '#e8e8f0',
    text: '#f4f4f8',
    textDim: '#b8b8c4',
    hpFill: '#4fd06a',
    hpLow: '#e04f5f',
    hpBack: '#34343e',
    accent: '#ffd75e',
  }),
});
