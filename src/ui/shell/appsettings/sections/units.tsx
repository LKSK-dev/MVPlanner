/**
 * App Settings → Units & Measurement section (spec docs/appsettings §3/§7).
 *
 * Edits the unit system + coordinate format on `settings`, and shows a live
 * {@link buildPreview} block so the user sees exactly how the chosen
 * unit/coordinate selection renders (coordinate/altitude/distance/speed) before
 * it applies app-wide. Writes go through the coalesced `store.patch` exactly
 * like the legacy Settings screen; the shell's settings effects react to the
 * same fields. Store-/deps-injected, so it unit-tests with a fresh
 * `createAppStore()`.
 */
import { For, createMemo, type Component } from 'solid-js';
import type { CoordinateFormat, UnitSystem } from '../../../../contracts';
import { buildPreview } from '../../../screens/config/settings/preview';
import type { AppSettingsSectionDeps } from '../context';
import '../messages';
import '../appsettings.css';

/** Selectable unit systems, in display order. */
const UNIT_OPTIONS: readonly UnitSystem[] = ['metric', 'imperial'];
/** Selectable coordinate formats, in display order. */
const COORD_OPTIONS: readonly CoordinateFormat[] = ['dd', 'dms', 'utm', 'mgrs'];

/** The Units & Measurement section body. */
export const UnitsSection: Component<{ deps: AppSettingsSectionDeps }> = (props) => {
  const t = props.deps.t;
  const settings = props.deps.store.select((s) => s.settings);

  /** The live unit/coordinate preview (recomputes on unit/coord change). */
  const preview = createMemo(() =>
    buildPreview({ units: settings().units, coordinateFormat: settings().coordinateFormat }),
  );

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
        <h3>{t('appsettings.units.preview')}</h3>
        <dl class="mvp-appsettings__preview">
          <dt class="mvp-appsettings__label">{t('appsettings.units.preview.coord')}</dt>
          <dd data-testid="appsettings-units-preview-coord">{preview().coordinate}</dd>
          <dt class="mvp-appsettings__label">{t('appsettings.units.preview.altitude')}</dt>
          <dd data-testid="appsettings-units-preview-altitude">{preview().altitude}</dd>
          <dt class="mvp-appsettings__label">{t('appsettings.units.preview.distance')}</dt>
          <dd data-testid="appsettings-units-preview-distance">{preview().distance}</dd>
          <dt class="mvp-appsettings__label">{t('appsettings.units.preview.speed')}</dt>
          <dd data-testid="appsettings-units-preview-speed">{preview().speed}</dd>
        </dl>
      </div>
    </div>
  );
};
