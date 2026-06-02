/**
 * App Settings → Units & Measurement section (spec docs/appsettings §3/§7).
 *
 * Edits the unit **preset** (`settings.units`) + coordinate format
 * (`settings.coordinateFormat`), plus a full **per-quantity** override group
 * (`settings.unitPreferences`) so the user can force a specific unit for
 * altitude/distance/speed/vertical-speed/temperature/heading independent of the
 * preset. A live {@link createUnitFormatter} preview renders sample SI values in
 * the resolved units so the effect of every choice is visible before it applies
 * app-wide. Writes go through the coalesced `store.patch`, exactly like the
 * other sections; it unit-tests with a fresh `createAppStore()`.
 */
import { For, createMemo, type Component } from 'solid-js';
import type { CoordinateFormat, UnitPreferences, UnitSystem } from '../../../../contracts';
import { createUnitFormatter, resolveUnits } from '../../../../core/units';
import type { AppSettingsSectionDeps } from '../context';
import '../messages';
import '../appsettings.css';

/** Selectable unit presets, in display order. */
const UNIT_OPTIONS: readonly UnitSystem[] = ['metric', 'imperial'];
/** Selectable coordinate formats, in display order. */
const COORD_OPTIONS: readonly CoordinateFormat[] = ['dd', 'dms', 'utm', 'mgrs'];

/** Per-quantity override keys this section exposes (coordinate has its own select). */
type QuantityKey = 'altitude' | 'distance' | 'speed' | 'verticalSpeed' | 'temperature' | 'heading';

/** A per-quantity override row: its key + the unit tokens it offers. */
interface QuantitySpec {
  /** {@link UnitPreferences} key written by this row. */
  readonly key: QuantityKey;
  /** Forced-unit tokens (the empty Auto option is prepended in the markup). */
  readonly options: readonly string[];
}

/** Per-quantity rows, in display order (tokens match {@link UnitPreferences}). */
const QUANTITIES: readonly QuantitySpec[] = [
  { key: 'altitude', options: ['m', 'ft'] },
  { key: 'distance', options: ['m', 'km', 'ft', 'mi', 'nm'] },
  { key: 'speed', options: ['m/s', 'km/h', 'kt', 'mph'] },
  { key: 'verticalSpeed', options: ['m/s', 'ft/min'] },
  { key: 'temperature', options: ['C', 'F'] },
  { key: 'heading', options: ['deg', 'mil'] },
];

/** Fixed sample SI values used by the live preview. */
const SAMPLE = {
  /** Sample latitude (San Francisco), WGS84 degrees. */
  lat: 37.7749,
  /** Sample longitude (San Francisco), WGS84 degrees. */
  lon: -122.4194,
  /** Sample altitude in metres. */
  altitudeM: 120,
  /** Sample distance in metres. */
  distanceM: 1500,
  /** Sample speed in metres-per-second. */
  speedMs: 12,
  /** Sample climb rate in metres-per-second. */
  climbMs: 2,
  /** Sample temperature in degrees Celsius. */
  temperatureC: 20,
  /** Sample heading in degrees. */
  headingDeg: 90,
} as const;

/**
 * Map a unit token to its `appsettings.units.unit.*` message-key suffix. Most
 * tokens map 1:1; the ones containing characters that can't appear in a key are
 * remapped (`m/s`→`mps`, `km/h`→`kmh`, `ft/min`→`ftmin`, `C`→`celsius`,
 * `F`→`fahrenheit`).
 */
function unitLabelKey(token: string): string {
  switch (token) {
    case 'm/s':
      return 'mps';
    case 'km/h':
      return 'kmh';
    case 'ft/min':
      return 'ftmin';
    case 'C':
      return 'celsius';
    case 'F':
      return 'fahrenheit';
    default:
      return token;
  }
}

/** The Units & Measurement section body. */
export const UnitsSection: Component<{ deps: AppSettingsSectionDeps }> = (props) => {
  const t = props.deps.t;
  const settings = props.deps.store.select((s) => s.settings);

  /** Live formatter bound to the resolved (preset + overrides) units. */
  const formatter = createMemo(() => createUnitFormatter(resolveUnits(settings())));

  /** Current override token for a quantity, or `''` when it follows the preset. */
  const overrideOf = (key: QuantityKey): string => settings().unitPreferences?.[key] ?? '';

  /**
   * Write a per-quantity override. An empty `raw` deletes the override (revert
   * to the preset default); otherwise it stores the selected token. `raw` is
   * sourced from the row's own `<option>` list, so it is a valid token for the
   * target key (the localized `Record` cast keeps that assignment type-safe
   * without `any`).
   */
  const setOverride = (key: QuantityKey, raw: string): void => {
    props.deps.store.patch((d) => {
      const up: UnitPreferences = { ...d.settings.unitPreferences };
      if (raw === '') {
        delete up[key];
      } else {
        (up as Record<QuantityKey, string>)[key] = raw;
      }
      d.settings.unitPreferences = up;
    });
  };

  return (
    <div class="mvp-appsettings__group">
      <label class="mvp-appsettings__field">
        <span class="mvp-appsettings__label">{t('appsettings.units.system')}</span>
        <select
          class="mvp-appsettings__select"
          data-testid="appsettings-units-system"
          value={settings().units}
          onChange={(e): void => {
            const value = e.currentTarget.value as UnitSystem;
            props.deps.store.patch((d) => {
              d.settings.units = value;
            });
          }}
        >
          <For each={UNIT_OPTIONS}>
            {(u) => <option value={u}>{t(`appsettings.units.${u}`)}</option>}
          </For>
        </select>
      </label>

      <label class="mvp-appsettings__field">
        <span class="mvp-appsettings__label">{t('appsettings.units.coord')}</span>
        <select
          class="mvp-appsettings__select"
          data-testid="appsettings-units-coord"
          value={settings().coordinateFormat}
          onChange={(e): void => {
            const value = e.currentTarget.value as CoordinateFormat;
            props.deps.store.patch((d) => {
              d.settings.coordinateFormat = value;
            });
          }}
        >
          <For each={COORD_OPTIONS}>
            {(c) => <option value={c}>{t(`appsettings.units.coord.${c}`)}</option>}
          </For>
        </select>
      </label>

      <div class="mvp-appsettings__group">
        <h3>{t('appsettings.units.advanced')}</h3>
        <For each={QUANTITIES}>
          {(spec) => (
            <label class="mvp-appsettings__field">
              <span class="mvp-appsettings__label">{t(`appsettings.units.q.${spec.key}`)}</span>
              <select
                class="mvp-appsettings__select"
                data-testid={`appsettings-units-q-${spec.key}`}
                value={overrideOf(spec.key)}
                onChange={(e): void => setOverride(spec.key, e.currentTarget.value)}
              >
                <option value="">{t('appsettings.units.auto')}</option>
                <For each={spec.options}>
                  {(token) => (
                    <option value={token}>
                      {t(`appsettings.units.unit.${unitLabelKey(token)}`)}
                    </option>
                  )}
                </For>
              </select>
            </label>
          )}
        </For>
      </div>

      <div class="mvp-appsettings__group">
        <h3>{t('appsettings.units.preview')}</h3>
        <dl class="mvp-appsettings__preview">
          <dt class="mvp-appsettings__label">{t('appsettings.units.preview.coord')}</dt>
          <dd data-testid="appsettings-units-preview-coord">
            {formatter().coordinate(SAMPLE.lat, SAMPLE.lon)}
          </dd>
          <dt class="mvp-appsettings__label">{t('appsettings.units.preview.altitude')}</dt>
          <dd data-testid="appsettings-units-preview-altitude">
            {formatter().altitude(SAMPLE.altitudeM)}
          </dd>
          <dt class="mvp-appsettings__label">{t('appsettings.units.preview.distance')}</dt>
          <dd data-testid="appsettings-units-preview-distance">
            {formatter().distance(SAMPLE.distanceM)}
          </dd>
          <dt class="mvp-appsettings__label">{t('appsettings.units.preview.speed')}</dt>
          <dd data-testid="appsettings-units-preview-speed">{formatter().speed(SAMPLE.speedMs)}</dd>
          <dt class="mvp-appsettings__label">{t('appsettings.units.q.verticalSpeed')}</dt>
          <dd data-testid="appsettings-units-preview-vspeed">
            {formatter().climb(SAMPLE.climbMs)}
          </dd>
          <dt class="mvp-appsettings__label">{t('appsettings.units.q.temperature')}</dt>
          <dd data-testid="appsettings-units-preview-temperature">
            {formatter().temperature(SAMPLE.temperatureC)}
          </dd>
          <dt class="mvp-appsettings__label">{t('appsettings.units.q.heading')}</dt>
          <dd data-testid="appsettings-units-preview-heading">
            {formatter().heading(SAMPLE.headingDeg)}
          </dd>
        </dl>
      </div>
    </div>
  );
};
