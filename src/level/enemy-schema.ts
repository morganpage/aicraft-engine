/** Canonical fixed width of the built-in charger archetype. */
export const CHARGER_WIDTH = 16;
/** Canonical fixed height of the built-in charger archetype. */
export const CHARGER_HEIGHT = 16;

/** Numeric charger parameter names validated by the level schema. */
export type ChargerNumericParam =
  | 'speed'
  | 'dashSpeed'
  | 'windupDuration'
  | 'recoveryDuration'
  | 'dashMaxDistance'
  | 'detectionRadius'
  | 'verticalTolerance';

/** Shared numeric range/default contract for charger validation and behavior. */
export interface ChargerNumericRule {
  readonly min: number;
  readonly max: number;
  readonly defaultValue: number;
  readonly minExclusive?: boolean;
}

/** Canonical charger numeric rules. */
export const CHARGER_NUMERIC_RULES: Readonly<
  Record<ChargerNumericParam, ChargerNumericRule>
> = {
  speed: { min: 0, max: 1024, defaultValue: 40 },
  dashSpeed: { min: 0, max: 4096, defaultValue: 300, minExclusive: true },
  windupDuration: { min: 0, max: 60, defaultValue: 0.5 },
  recoveryDuration: { min: 0, max: 60, defaultValue: 0.8 },
  dashMaxDistance: { min: 0, max: 65_536, defaultValue: 128 },
  detectionRadius: { min: 0, max: 65_536, defaultValue: 160 },
  verticalTolerance: { min: 0, max: 4096, defaultValue: 12 },
};

/** Validate a numeric charger parameter against its canonical rule. */
export function isValidChargerNumber(
  key: ChargerNumericParam,
  value: unknown,
): value is number {
  const rule = CHARGER_NUMERIC_RULES[key];
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (rule.minExclusive ? value > rule.min : value >= rule.min) &&
    value <= rule.max
  );
}

/** Resolve invalid direct-call data to the named default, never by clamping. */
export function resolveChargerNumber(
  key: ChargerNumericParam,
  value: unknown,
): number {
  return isValidChargerNumber(key, value)
    ? value
    : CHARGER_NUMERIC_RULES[key].defaultValue;
}
