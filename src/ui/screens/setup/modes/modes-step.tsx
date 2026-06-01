/**
 * Flight modes setup step (T5.7; spec plan/04 §4.4). The step maps ArduPilot
 * `FLTMODE1`…`FLTMODE6` switch positions to vehicle-aware mode ids and edits
 * `FLTMODE_CH`, plus optional `SIMPLE` / `SUPER_SIMPLE` bitmask flags when those
 * parameters are present in the injected ParamClient cache.
 */
import { For, Show, createMemo, createSignal, onCleanup, type Accessor, type JSX } from 'solid-js';
import type { ParamClient, VehicleClass } from '../../../../contracts';
import { t } from '../../../../core/i18n';
import type { SetupStep, SetupStepApi, SettledStatus } from '../framework';
import {
  FLIGHT_MODE_CHANNEL_OPTIONS,
  SUPER_SIMPLE_MODE_PARAM,
  deriveFlightModeMapping,
  isModesParamName,
  setSimpleModeEnabled,
  simpleModeEnabled,
  type FlightModeMapping,
  type FlightModeParamName,
  type FlightModePositionSelection,
  type ModesParamName,
  type SimpleModeBitmaskSelection,
} from './options';
import './messages';

/** Dependencies injected into {@link createModesStep}. */
export interface ModesStepDeps {
  /** Parameter microservice used to read/write ArduPilot mode params. */
  readonly params: ParamClient;
  /** Current vehicle class used to choose the ArduPilot mode option table. */
  readonly getVehicleClass: () => VehicleClass;
}

interface ModesStepPanelProps {
  readonly api: SetupStepApi;
  readonly deps: ModesStepDeps;
  readonly mapping: Accessor<FlightModeMapping>;
  readonly refresh: () => void;
}

function readMapping(deps: ModesStepDeps, revision: Accessor<number>): FlightModeMapping {
  revision();
  return deriveFlightModeMapping(deps.getVehicleClass(), (name) => deps.params.get(name)?.value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function modeSelectValue(position: FlightModePositionSelection): string {
  return position.value === undefined ? '' : String(position.value);
}

/** One `FLTMODEn` dropdown for a switch position. */
function FlightModeSelect(props: {
  readonly api: SetupStepApi;
  readonly mapping: FlightModeMapping;
  readonly position: FlightModePositionSelection;
  readonly disabled: boolean;
  readonly onWrite: (name: FlightModeParamName, value: number) => void;
}): JSX.Element {
  const labelId = `mvp-setup-modes-${props.position.name.toLowerCase()}-label`;
  const selectId = `mvp-setup-modes-${props.position.name.toLowerCase()}`;
  return (
    <label class="mvp-setup-modes__field" data-param={props.position.name}>
      <span id={labelId} class="mvp-setup-modes__label">
        {props.api.t('setup.modes.position.label', { position: props.position.position })}
      </span>
      <select
        id={selectId}
        class="mvp-setup-modes__select"
        data-testid={`modes-position-${props.position.position}`}
        aria-labelledby={labelId}
        aria-label={props.api.t('setup.modes.position.aria', {
          position: props.position.position,
        })}
        disabled={props.disabled || props.mapping.options.length === 0}
        value={modeSelectValue(props.position)}
        onChange={(event): void => {
          const value = Number(event.currentTarget.value);
          if (Number.isFinite(value)) props.onWrite(props.position.name, value);
        }}
      >
        <option value="" disabled>
          {props.api.t('setup.modes.select.placeholder')}
        </option>
        <Show when={props.position.value !== undefined && props.position.option === undefined}>
          <option value={modeSelectValue(props.position)} disabled>
            {props.api.t('setup.modes.mode.unknown', { value: props.position.value ?? '' })}
          </option>
        </Show>
        <For each={props.mapping.options}>
          {(option) => (
            <option value={String(option.value)}>
              {props.api.t('setup.modes.mode.option', {
                name: option.name,
                value: option.value,
              })}
            </option>
          )}
        </For>
      </select>
    </label>
  );
}

/** Optional simple/super-simple checkbox for one switch position. */
function SimpleModeCheckbox(props: {
  readonly api: SetupStepApi;
  readonly bitmask: SimpleModeBitmaskSelection;
  readonly position: number;
  readonly disabled: boolean;
  readonly onWrite: (name: ModesParamName, value: number) => void;
}): JSX.Element {
  const isSuperSimple = props.bitmask.name === SUPER_SIMPLE_MODE_PARAM;
  const labelKey = isSuperSimple ? 'setup.modes.superSimple.enable' : 'setup.modes.simple.enable';
  const ariaKey = isSuperSimple ? 'setup.modes.superSimple.aria' : 'setup.modes.simple.aria';
  return (
    <label class="mvp-setup-modes__simple-toggle">
      <input
        type="checkbox"
        aria-label={props.api.t(ariaKey, { position: props.position })}
        checked={simpleModeEnabled(props.bitmask.value, props.position)}
        disabled={props.disabled}
        onChange={(event): void => {
          const next = setSimpleModeEnabled(
            props.bitmask.value,
            props.position,
            event.currentTarget.checked,
          );
          props.onWrite(props.bitmask.name, next);
        }}
      />
      <span>{props.api.t(labelKey)}</span>
    </label>
  );
}

/** Guided pane rendered for the flight-modes setup step. */
function ModesStepPanel(props: ModesStepPanelProps): JSX.Element {
  const [saving, setSaving] = createSignal<ModesParamName | undefined>(undefined);
  const [error, setError] = createSignal<string | undefined>(undefined);
  const mapping = createMemo(() => props.mapping());

  const unsubscribe = props.deps.params.onChange((param) => {
    if (isModesParamName(param.name)) props.refresh();
  });
  onCleanup(unsubscribe);

  const writeParam = async (name: ModesParamName, value: number): Promise<void> => {
    setSaving(name);
    setError(undefined);
    try {
      await props.deps.params.set(name, value);
      props.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(undefined);
    }
  };

  const onChannelChange = (event: Event): void => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLSelectElement)) return;
    const value = Number(target.value);
    if (Number.isFinite(value)) {
      void writeParam(mapping().channel.name, value);
    }
  };

  return (
    <section class="mvp-setup-modes" data-vehicle-class={mapping().vehicleClass}>
      <p class="mvp-setup-modes__description">{props.api.t('setup.modes.description')}</p>
      <p class="mvp-setup-modes__vehicle">
        {props.api.t('setup.modes.vehicleClass', { vehicleClass: mapping().vehicleClass })}
      </p>

      <Show when={saving()}>
        {(name) => (
          <p class="mvp-setup-modes__saving" role="status">
            {props.api.t('setup.modes.saving', { name: name() })}
          </p>
        )}
      </Show>
      <Show when={error()}>
        {(message) => (
          <p class="mvp-setup-modes__error" role="alert">
            {props.api.t('setup.modes.error', { message: message() })}
          </p>
        )}
      </Show>

      <label class="mvp-setup-modes__field" data-param={mapping().channel.name}>
        <span class="mvp-setup-modes__label">{props.api.t('setup.modes.channel.label')}</span>
        <select
          class="mvp-setup-modes__select"
          data-testid="modes-channel"
          aria-label={props.api.t('setup.modes.channel.aria')}
          disabled={saving() !== undefined}
          value={String(mapping().channel.displayValue)}
          onChange={onChannelChange}
        >
          <For each={FLIGHT_MODE_CHANNEL_OPTIONS}>
            {(channel) => (
              <option value={String(channel)}>
                {channel === 0
                  ? props.api.t('setup.modes.channel.disabled')
                  : props.api.t('setup.modes.channel.option', { channel })}
              </option>
            )}
          </For>
        </select>
      </label>

      <Show
        when={mapping().options.length > 0}
        fallback={<p>{props.api.t('setup.modes.noModes')}</p>}
      >
        <div class="mvp-setup-modes__positions">
          <For each={mapping().positions}>
            {(position) => (
              <div class="mvp-setup-modes__position" data-position={position.position}>
                <FlightModeSelect
                  api={props.api}
                  mapping={mapping()}
                  position={position}
                  disabled={saving() !== undefined}
                  onWrite={(name, value): void => {
                    void writeParam(name, value);
                  }}
                />
                <Show when={mapping().simple ?? mapping().superSimple}>
                  <div
                    class="mvp-setup-modes__simple"
                    aria-label={props.api.t('setup.modes.simple.title')}
                  >
                    <Show when={mapping().simple}>
                      {(simple) => (
                        <SimpleModeCheckbox
                          api={props.api}
                          bitmask={simple()}
                          position={position.position}
                          disabled={saving() !== undefined}
                          onWrite={(name, value): void => {
                            void writeParam(name, value);
                          }}
                        />
                      )}
                    </Show>
                    <Show when={mapping().superSimple}>
                      {(superSimple) => (
                        <SimpleModeCheckbox
                          api={props.api}
                          bitmask={superSimple()}
                          position={position.position}
                          disabled={saving() !== undefined}
                          onWrite={(name, value): void => {
                            void writeParam(name, value);
                          }}
                        />
                      )}
                    </Show>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <p class="mvp-setup-modes__status" data-status={mapping().status} role="status">
        {props.api.t(
          mapping().status === 'done' ? 'setup.modes.status.done' : 'setup.modes.status.todo',
        )}
      </p>
    </section>
  );
}

/** Create the Setup wizard step for ArduPilot flight-mode mapping. */
export function createModesStep(deps: ModesStepDeps): SetupStep {
  const [revision, setRevision] = createSignal(0);
  const refresh = (): void => {
    setRevision((value) => value + 1);
  };

  deps.params.onChange((param) => {
    if (isModesParamName(param.name)) refresh();
  });

  const mapping = (): FlightModeMapping => readMapping(deps, revision);
  const status = (): SettledStatus => mapping().status;

  return {
    id: 'modes',
    title: t('setup.modes.title'),
    icon: '✈',
    safetyNote: t('setup.modes.safety'),
    status,
    allowManualComplete: false,
    render: (api): JSX.Element => (
      <ModesStepPanel api={api} deps={deps} mapping={mapping} refresh={refresh} />
    ),
  };
}
