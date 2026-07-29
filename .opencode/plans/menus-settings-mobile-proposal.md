# Standard Game UI, Settings, and Mobile Support — Proposal

## Goal

Games built with the engine should have a usable baseline game shell without
rebuilding routine UI for every project. A consumer that provides a container
around their canvas, settings storage, and game-state integration should receive:

1. A main menu, pause menu, settings screen, game-over screen, and
   level-complete screen.
2. Persistent SFX volume, music volume, and master mute.
3. Keyboard, pointer, touch, and gamepad-friendly menu interaction.
4. Responsive mobile gameplay controls.
5. A portrait-orientation prompt and a best-effort landscape-lock request.
6. Accessible DOM controls with useful defaults and a theme override seam.

The feature must provide both:

- **An opinionated standard setup** that works out of the box.
- **Composable lower-level primitives** for games that replace or extend the
  standard presentation.

The standard setup is a game UI shell, not a full game template. Consumers
continue to own game simulation, game state, rendering, level flow, and
game-specific actions.

## Design constraints

1. **Useful by default.** The quick-start path must create working menus,
   settings, and mobile controls without consumer-authored HTML or CSS.
2. **Composable underneath.** Settings, geometry, canvas drawing, orientation,
   and touch-control adapters remain independently usable.
3. **Zero runtime dependencies.**
4. **Layer discipline.** Pure reducers and normalization remain host-free;
   drawing takes `CanvasRenderingContext2D`; DOM and browser APIs are isolated
   in defensive adapters.
5. **Consumer-owned simulation.** UI input is latched and drained by the
   consumer. The standard UI does not mutate `GameState` directly.
6. **Defensive host access.** DOM, storage, media-query, fullscreen, and
   orientation failures never crash the game.
7. **Source compatibility.** Existing modules and public APIs remain compatible.

---

## Default user experience

`createStandardGameUI()` provides the following fixed baseline screens:

| Game mode / screen | Default controls |
|---|---|
| Main menu | Play, Settings |
| Paused | Resume, Settings, Quit |
| Game over | Retry, Settings, Quit |
| Level complete | Next, Settings, Quit |
| Settings | SFX volume, music volume, master mute, Back |
| Portrait prompt | “Rotate device” message; optional landscape-lock action |
| Playing on touch devices | Left, Right, Jump overlay controls |

The default screen-to-event mapping reuses `GameEvent`:

| Control | Event |
|---|---|
| Play | `{ type: 'start' }` |
| Pause | `{ type: 'pause' }` |
| Resume | `{ type: 'resume' }` |
| Retry | `{ type: 'retry' }` |
| Next | `{ type: 'next' }` |
| Quit | `{ type: 'quit' }` |

Settings and Back are internal UI navigation and do not emit `GameEvent`s.

### Default interaction

- Native DOM buttons and range inputs provide pointer, touch, focus, and
  keyboard behavior.
- Arrow keys move menu focus; Enter/Space activates the focused control.
- Escape pauses while playing, resumes from pause, or backs out of Settings.
- Standard-mapping gamepad D-pad/left stick moves focus, the primary face
  button confirms, the secondary face button backs out, and Start toggles
  pause/resume.
- Menu/game events are queued, and `poll()` returns at most one event per tick
  so consumers can call `reduceGameState()` exactly once on their fixed-step
  boundary.
- Touch controls are visible in `playing` mode only when mobile-control policy
  resolves to visible.

---

## Module 1: `src/settings/` — Validated persistent settings

**Layer:** Pure core (normalization and reducer) + host-adapter composition
(persistence).

```ts
// types.ts
export interface GameSettings {
  readonly version: 1;
  readonly sfxVolume: number;   // [0, 1]
  readonly musicVolume: number; // [0, 1]
  readonly muted: boolean;      // master mute
}

export type SettingsPatch = Partial<
  Pick<GameSettings, 'sfxVolume' | 'musicVolume' | 'muted'>
>;

// constants.ts
export const DEFAULT_SETTINGS: GameSettings = {
  version: 1,
  sfxVolume: 0.7,
  musicVolume: 0.5,
  muted: false,
};

export const SETTINGS_SAVE_KEY = 'aicraft-settings';

// normalize.ts — pure runtime boundary
function normalizeSettings(
  value: unknown,
  defaults?: GameSettings,
): GameSettings;

// reducer.ts — pure, fresh return, never mutates input
function reduceSettings(
  state: GameSettings,
  patch: SettingsPatch,
): GameSettings;

// persistence.ts — composes the existing SaveStorage abstraction
function loadSettings(storage: SaveStorage): GameSettings;
function saveSettings(storage: SaveStorage, settings: GameSettings): void;
```

### Normalization contract

`normalizeSettings()`:

- Always returns a fresh `GameSettings`.
- Merges absent fields with normalized defaults.
- Accepts only finite numeric volume values and clamps them to `[0, 1]`.
- Accepts only a boolean `muted` value.
- Ignores unknown properties.
- Treats an absent or unsupported version as legacy input and recovers all
  recognized fields.
- Never mutates input and never throws.

`reduceSettings()` applies the same value rules to patches. `undefined`,
non-finite, and wrong-type values leave the corresponding current value
unchanged rather than corrupting state.

`loadSettings()` normalizes the untrusted result returned by `loadSave()`.
`saveSettings()` normalizes before calling `writeSave()`, so even hostile
runtime callers cannot persist a malformed settings record.

### Storage ownership

`SaveStorage` is already scoped to one key at construction time. Settings
persistence therefore does not select or replace a key internally. Consumers
must pass a settings-specific storage instance:

```ts
const settingsStorage =
  createLocalStorageSaveStorage(SETTINGS_SAVE_KEY);

const settings = loadSettings(settingsStorage);
```

The settings storage must not be the same key-bound storage instance used for
the main game save.

### Audio application

The standard UI applies settings immediately on load and after every change:

```ts
audio?.setVolume(settings.sfxVolume);
audio?.setMuted(settings.muted);
music?.setVolume(settings.muted ? 0 : settings.musicVolume);
```

`muted` is explicitly an application-level master mute. Applying zero to the
music target guarantees mute even if a consumer supplies a music adapter backed
by a different audio host. Unmuting restores the independently stored music
volume.

### Files

| Path | Content |
|---|---|
| `src/settings/types.ts` | `GameSettings`, `SettingsPatch` |
| `src/settings/constants.ts` | defaults and save key |
| `src/settings/normalize.ts` | runtime normalization and legacy recovery |
| `src/settings/reducer.ts` | pure settings reducer |
| `src/settings/persistence.ts` | load/save composition over `SaveStorage` |
| `src/settings/index.ts` | Barrel |

---

## Module 2: `src/ui/` — Shared UI geometry and canvas primitives

**Layer:** Pure geometry + renderer-adjacent canvas drawing. No global DOM and
no simulation mutation.

These primitives support games that want in-canvas or heavily customized
menus. The standard out-of-box menus use accessible DOM controls instead.

```ts
export interface UIPoint {
  readonly x: number;
  readonly y: number;
}

export interface UIRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface UISize {
  readonly width: number;
  readonly height: number;
}

export interface UIButtonState {
  readonly hovered?: boolean;
  readonly pressed?: boolean;
  readonly focused?: boolean;
  readonly disabled?: boolean;
}

export interface UITheme {
  readonly bg: string;
  readonly fg: string;
  readonly accent: string;
  readonly border: string;
  readonly disabled: string;
  readonly focus: string;
  readonly fontScale: number;
  readonly padding: number;
  readonly minTouchTarget: number;
}
```

| Function | Purpose |
|---|---|
| `drawButton(ctx, bounds, label, state, theme?)` | Draw a themed button |
| `drawSlider(ctx, bounds, value, state, theme?)` | Draw a horizontal slider |
| `drawPanel(ctx, bounds, theme?)` | Draw a panel |
| `drawLabel(ctx, bounds, text, theme?)` | Draw centered bitmap-font text |
| `hitTestRect(point, bounds, hitSlop?)` | Pure rectangle hit test |
| `sliderValueAtPoint(point, bounds)` | Pure clamped slider-value mapping |
| `clientPointToCanvas(point, canvasRect, logicalSize)` | Pure CSS-to-logical coordinate conversion |

### Drawing contract

- All bounds are in the caller's current logical canvas coordinate system.
- Drawing functions clamp or reject degenerate geometry consistently and never
  throw for ordinary malformed numeric inputs.
- Each drawing helper brackets its mutations with `ctx.save()` /
  `ctx.restore()` so fill, stroke, alpha, line width, and transforms do not
  leak into consumer rendering.
- Slider pointer ownership, capture, and drag lifecycle remain consumer-owned
  at this lower layer. `sliderValueAtPoint()` only maps geometry to a value.
- `DEFAULT_UI_THEME` is shared semantically with the standard DOM theme.

### Files

| Path | Content |
|---|---|
| `src/ui/types.ts` | Geometry, theme, and control-state types |
| `src/ui/button.ts` | `drawButton()` |
| `src/ui/slider.ts` | `drawSlider()` and value mapping |
| `src/ui/panel.ts` | `drawPanel()` |
| `src/ui/label.ts` | `drawLabel()` |
| `src/ui/geometry.ts` | Hit testing and coordinate conversion |
| `src/ui/theme.ts` | `DEFAULT_UI_THEME` |
| `src/ui/index.ts` | Barrel |

---

## Module 3: `src/mobile/` — Mobile capability and control adapters

**Layer:** Host-touching defensive adapters.

### Orientation manager

```ts
export interface OrientationState {
  readonly orientation: 'portrait' | 'landscape' | 'square' | 'unknown';
  readonly canObserve: boolean;
  readonly canLock: boolean;
  readonly lockSucceeded: boolean;
}

export interface OrientationManager {
  getState(): OrientationState;
  requestLandscapeLock(): Promise<boolean>;
  subscribe(
    listener: (state: OrientationState) => void,
  ): () => void;
  dispose(): void;
}
```

Contract:

- `requestLandscapeLock()` catches synchronous errors and promise rejection,
  resolving `false` rather than throwing.
- Lock is best effort. Browsers may require fullscreen, installation, or a
  user gesture.
- Observation and lock support are reported independently.
- Orientation is derived from the most reliable available source, with a
  viewport-aspect fallback.
- Subscribers receive changes from the Screen Orientation API, media queries,
  or resize fallback.
- `dispose()` removes every listener and is idempotent.
- Node/SSR returns an `unknown`, unsupported state and a resolved `false` lock
  result.

### Capability probes

Avoid a universal `isMobileDevice()` classification. Export narrowly scoped
capabilities instead:

```ts
function hasTouchInput(): boolean;    // navigator.maxTouchPoints fallback
function hasCoarsePointer(): boolean; // any-pointer: coarse
function hasHoverInput(): boolean;    // any-hover: hover
```

The standard UI decides whether to show mobile controls using these
capabilities plus an explicit consumer policy:

```ts
type MobileControlsPolicy = 'auto' | 'always' | 'never';
```

`auto` shows controls when touch input or a coarse pointer is present.

### Owned mobile controls

The high-level mobile adapter owns the DOM elements it creates:

```ts
export interface MobileButtonDef {
  readonly id: string;
  readonly action: string;
  readonly label: string;
  readonly placement: 'left' | 'right';
  readonly className?: string;
}

export interface MobileControlsConfig {
  readonly container: HTMLElement | null;
  readonly buttons?: readonly MobileButtonDef[];
  readonly policy?: MobileControlsPolicy;
  readonly minTouchTarget?: number;
}

export interface MobileControlsAdapter {
  poll(): Readonly<Record<string, PolledEdge>>;
  setVisible(visible: boolean): void;
  getElements(): ReadonlyMap<string, HTMLElement>;
  dispose(): void;
}

function createMobileControls(
  config: MobileControlsConfig,
): MobileControlsAdapter;

function standardPlatformerMobileLayout(): readonly MobileButtonDef[];
```

Ownership and layout contract:

- The adapter creates one semantic `<button type="button">` per definition.
- Poll results are keyed by `action`, not array position.
- The default layout provides `left`, `right`, and `jump`.
- Buttons meet the theme's minimum touch target, use `touch-action: none`, and
  respect `env(safe-area-inset-*)`.
- Responsive positioning is CSS/container based rather than fixed viewport
  coordinates.
- The adapter tracks pointer IDs through the existing multi-touch-safe input
  machinery.
- `dispose()` removes listeners, created elements, owned styles, media-query
  listeners, and resize listeners.
- Multiple adapters can coexist without global selector or style collisions.

### Files

| Path | Content |
|---|---|
| `src/mobile/types.ts` | Orientation, capability, and mobile-control types |
| `src/mobile/orientation.ts` | `createOrientationManager()` |
| `src/mobile/probe.ts` | Capability probes |
| `src/mobile/controls.ts` | Owned mobile-control adapter |
| `src/mobile/layout.ts` | Standard platformer layout |
| `src/mobile/index.ts` | Barrel |

---

## Module 4: `src/game-ui/` — Out-of-box standard game UI

**Layer:** Host-touching façade that composes `settings`, `mobile`, `input`,
`game-state`, `audio`, and `music`. It owns presentation and UI event buffers,
but never owns or mutates simulation state.

### Public API

```ts
export type StandardGameplayAction = 'left' | 'right' | 'jump';

export interface StandardGameUIConfig {
  readonly container: HTMLElement | null;
  readonly settingsStorage: SaveStorage;
  readonly audio?: Pick<
    AudioAdapter,
    'unlock' | 'setVolume' | 'setMuted'
  >;
  readonly music?: Pick<
    Sequencer | NoteFirePlayer,
    'setVolume'
  >;
  readonly theme?: Partial<UITheme>;
  readonly mobileControls?: MobileControlsPolicy;
  readonly requestLandscapeLock?: boolean;
}

export interface StandardGameUIPoll {
  readonly gameEvent: GameEvent | null;
  readonly gameplayInput: Readonly<
    Record<StandardGameplayAction, PolledEdge>
  >;
}

export interface StandardGameUI {
  /** Synchronize presentation with consumer-owned game state. */
  setMode(mode: GameMode): void;

  /** Drain the next queued menu event and gameplay touch edges once per tick. */
  poll(): StandardGameUIPoll;

  getSettings(): GameSettings;
  updateSettings(patch: SettingsPatch): GameSettings;

  /** Remove every owned element, style, listener, adapter, and subscription. */
  dispose(): void;
}

export function createStandardGameUI(
  config: StandardGameUIConfig,
): StandardGameUI;
```

The internal event buffer is FIFO. `poll()` drains at most one `GameEvent` and
retains any later events for subsequent ticks, preventing multiple
`reduceGameState()` calls from advancing `timeInState` more than once in a
single fixed tick. Settings changes are applied and persisted immediately and
do not enter this game-event queue.

The standard UI owns a gamepad adapter used only for menu navigation and the
pause/Start action. Gameplay directions and actions from a consumer's gamepad
adapter are not drained or returned by the standard UI.

### Consumer integration

```ts
const settingsStorage =
  createLocalStorageSaveStorage(SETTINGS_SAVE_KEY);

const gameUI = createStandardGameUI({
  container: document.querySelector('.game-shell'),
  settingsStorage,
  audio,
  music: sequencer,
  mobileControls: 'auto',
  requestLandscapeLock: true,
});

// Once after creation and whenever the mode changes:
gameUI.setMode(gameState.current);

// Once per fixed tick:
const uiFrame = gameUI.poll();

gameState = reduceGameState(
  gameState,
  uiFrame.gameEvent,
  fixedDt,
);

gameUI.setMode(gameState.current);

const input = {
  moveX:
    uiFrame.gameplayInput.left.held ===
    uiFrame.gameplayInput.right.held
      ? 0
      : uiFrame.gameplayInput.left.held
        ? -1
        : 1,
  jump: uiFrame.gameplayInput.jump,
  dash: null,
};
```

Consumers can OR-merge `gameplayInput` with their existing keyboard or gamepad
input. The standard UI never polls or drains consumer-owned adapters.

### DOM ownership

The standard UI creates:

- A scoped root overlay inside `container`.
- Native menu buttons, labeled range inputs, and a mute checkbox.
- A focus-visible menu panel with appropriate dialog/navigation semantics.
- The portrait prompt.
- Mobile gameplay controls.
- Scoped theme styles using a unique per-instance root attribute and CSS custom
  properties.

It records and restores any container inline styles it must change. `dispose()`
removes all created nodes, style elements, media-query subscriptions, window
listeners, orientation subscriptions, and owned input adapters. It must be
safe to create multiple UI instances on one page.

The first trusted keyboard or pointer activation calls `audio.unlock()`. When
`requestLandscapeLock` is enabled, that same user-gesture path makes one
best-effort landscape-lock request; the factory never attempts a restricted
orientation lock eagerly at module load or construction time.

### Accessibility

- Every interactive control is a native form control or button.
- Settings inputs have visible labels and accessible names.
- Menu screens use an appropriate labeled navigation/dialog container.
- Hidden screens are removed from focus order.
- Focus is moved predictably when screens open or close.
- Focus indicators meet contrast requirements.
- Touch targets default to at least `44` CSS pixels.
- Reduced-motion preference is respected; the baseline ships without required
  animation.

### Failure behavior

If `container` is `null`, DOM construction fails, or a host API is unavailable,
the factory returns a safe no-op adapter:

- `poll()` returns no game events and idle gameplay input.
- Settings still use the supplied defensive storage and remain available
  through `getSettings()` / `updateSettings()`.
- Every public method remains callable and never throws.

### Files

| Path | Content |
|---|---|
| `src/game-ui/types.ts` | Standard UI config, adapter, and poll contracts |
| `src/game-ui/menu-model.ts` | Pure screen/control definitions and event mapping |
| `src/game-ui/event-buffer.ts` | Pure/host-fed queued UI events |
| `src/game-ui/dom.ts` | Scoped DOM creation and accessibility wiring |
| `src/game-ui/navigation.ts` | Keyboard and standard-gamepad menu navigation |
| `src/game-ui/styles.ts` | Scoped default styles and theme variables |
| `src/game-ui/factory.ts` | `createStandardGameUI()` composition |
| `src/game-ui/index.ts` | Barrel |

---

## Existing module integration

Existing APIs remain source-compatible:

| Module | Integration |
|---|---|
| `src/audio/` | Standard UI calls `setVolume`, `setMuted`, and `unlock`; no API change required. |
| `src/music/` | Standard UI calls the existing structural `setVolume`; no API change required. |
| `src/game-state/` | Standard menu controls emit existing `GameEvent`s; consumer still reduces state. |
| `src/save/` | Caller creates a settings-keyed `SaveStorage`; settings compose `loadSave`/`writeSave`. |
| `src/input/` | Mobile controls reuse multi-touch edge semantics; consumer adapters remain independently owned. |
| `src/primitives/` | Canvas UI reuses bitmap text and outline/color helpers. |

Documentation updates are required in `docs/architecture.md`,
`docs/api-surface.md`, `docs/integration.md`, and the main `README.md`.

## Testing

| File | What it covers |
|---|---|
| `src/tests/settings-reducer.test.ts` | Patch subsets, clamping, invalid values, fresh return, no mutation |
| `src/tests/settings-persistence.test.ts` | Round-trip, malformed JSON shapes, legacy/missing versions, separate storage key |
| `src/tests/ui.test.ts` | Geometry, degenerate bounds, CSS-to-logical coordinates, slider mapping |
| `src/tests/ui-drawing.test.ts` | Canvas commands, visual bounds, disabled/focus states, context save/restore |
| `src/tests/mobile-orientation.test.ts` | Unsupported hosts, lock resolve/reject, changes, unsubscribe, disposal |
| `src/tests/mobile-probe.test.ts` | Touch, coarse pointer, hover, hybrid devices, Node fallback |
| `src/tests/mobile-controls.test.ts` | DOM ownership, ID/action mapping, multi-touch, visibility, safe cleanup |
| `src/tests/game-ui.test.ts` | Screen mapping, queued events, settings application, pause/back behavior |
| `src/tests/game-ui-accessibility.test.ts` | Labels, focus order, hidden screens, keyboard activation |
| `src/tests/game-ui-disposal.test.ts` | Listener/style/node cleanup, idempotence, multiple instances |

DOM integration tests use a DOM test environment as a development-only
dependency or equivalent Vitest environment. This does not change the
zero-runtime-dependency guarantee.

Drawing helpers receive both command-level tests and at least one rendered
visual fixture through the existing `canvas` development dependency.

## Barrel update

Add to `src/index.ts`:

```ts
export * from './settings';
export * from './ui';
export * from './mobile';
export * from './game-ui';
```

## Showcase integration

Update the playground to demonstrate the complete quick-start path:

1. Start in the standard main menu.
2. Use `GameState.current` to select the standard screen.
3. Pause and resume through keyboard, pointer, touch, and gamepad input.
4. Change SFX/music volume and master mute, reload, and verify persistence.
5. Show mobile left/right/jump controls under automatic capability detection.
6. Show the portrait prompt and attempt landscape lock after a user gesture.
7. Respect safe-area insets and remain usable at narrow viewport widths.
8. Dispose and remount the playground without duplicated DOM or listeners.

The showcase must use the public `createStandardGameUI()` API rather than
private setup code so it serves as the integration example.

## Documentation and quick start

The integration guide must include:

- The minimal setup example.
- A complete fixed-tick event/input merge example.
- Storage-key separation.
- Mobile viewport-meta recommendation.
- Orientation-lock limitations and fullscreen/user-gesture requirements.
- The difference between the standard DOM UI and canvas UI primitives.
- Theme override and mobile-control policy examples.
- Disposal requirements for single-page applications.

## Acceptance criteria

1. A consumer can obtain the default menus, settings, portrait prompt, and
   mobile controls by providing only a container, settings storage, and
   optional audio/music adapters.
2. No consumer-authored menu HTML or CSS is required for the default path.
3. Main-menu, pause, retry, next, and quit controls produce canonical
   `GameEvent`s without directly mutating `GameState`.
4. Settings survive reload, malformed stored values recover safely, and the
   game save is never overwritten.
5. Touch controls support simultaneous movement and jump and never remain
   stuck after pointer cancellation.
6. All default controls are keyboard and touch operable, labeled, focusable,
   and visibly focused.
7. Unsupported orientation, storage, media-query, audio, and DOM capabilities
   degrade without throwing.
8. Multiple instances can coexist and full disposal leaves no owned DOM,
   styles, listeners, or subscriptions.
9. A new example game can integrate the full feature with a short quick-start
   and no copied showcase implementation.

## Out of scope

- A full game/project template.
- Game-specific menu items, save-slot selection, inventory, or account UI.
- A declarative arbitrary-screen DSL.
- Animated screen transitions.
- Cloud settings synchronization.
- Guaranteed orientation locking; browser policy makes it best effort.
- Automatically changing the document's viewport meta tag.
- Replacing consumer-owned simulation, `GameState`, keyboard mappings, or
  gamepad mappings used during gameplay.
