/**
 * Solid setup step factory for vehicle frame/class selection (T5.3). The step
 * is vehicle-class-aware, reads current values through the injected ParamClient,
 * and writes only the known ArduPilot frame parameters exposed by options.ts.
 */
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type JSX,
} from 'solid-js';
import type { ParamClient, VehicleClass } from '../../../../contracts';
import { t } from '../../../../core/i18n';
import type { SetupStep, SetupStepApi, SettledStatus } from '../framework';
import {
  deriveFrameSelection,
  isFrameParamName,
  type FrameOption,
  type FrameParamName,
  type FrameParamSelection,
  type FrameSelection,
} from './options';
import './messages';

/** Dependencies injected into {@link createFrameStep} for testability. */
export interface FrameStepDeps {
  /** Parameter microservice used to read and write ArduPilot frame params. */
  readonly params: ParamClient;
  /** Current vehicle class from the vehicle model/session. */
  readonly getVehicleClass: () => VehicleClass;
}

interface FrameStepPanelProps {
  readonly api: SetupStepApi;
  readonly deps: FrameStepDeps;
  readonly selection: Accessor<FrameSelection>;
  readonly refresh: () => void;
}

function readSelection(deps: FrameStepDeps, revision: Accessor<number>): FrameSelection {
  revision();
  return deriveFrameSelection(deps.getVehicleClass(), (name) => deps.params.get(name)?.value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function valueText(api: SetupStepApi, param: FrameParamSelection): string {
  if (param.value === undefined) return api.t('setup.frame.paramUnavailable');
  if (param.option !== undefined) {
    return api.t('setup.frame.currentOption', {
      label: api.t(param.option.labelKey),
      value: param.value,
    });
  }
  return api.t('setup.frame.currentValue', { value: param.value });
}

function selectValue(param: FrameParamSelection | undefined): string {
  return param?.value === undefined ? '' : String(param.value);
}

/** Derive the settled status for a frame selection. */
function frameStatus(selection: FrameSelection): SettledStatus {
  return selection.validFrameClass ? 'done' : 'todo';
}

/** i18n key for the inline status line, keyed off the settled status. */
function frameStatusMessageKey(status: SettledStatus): string {
  return status === 'done' ? 'setup.frame.done' : 'setup.frame.todo';
}

function canRenderOptionValue(param: FrameParamSelection | undefined): boolean {
  if (param?.value === undefined) return false;
  return param.options.length === 0 || param.option !== undefined;
}

/** Select UI for one known frame parameter (copter `FRAME_*` or QuadPlane `Q_FRAME_*`). */
function FrameSelect(props: {
  readonly api: SetupStepApi;
  readonly param: FrameParamSelection;
  readonly saving: string | undefined;
  readonly onWrite: (name: FrameParamName, value: number) => void;
}): JSX.Element {
  const labelId = `mvp-setup-frame-${props.param.name.toLowerCase()}-label`;
  const selectId = `mvp-setup-frame-${props.param.name.toLowerCase()}`;
  return (
    <div class="mvp-setup-frame__field" data-param={props.param.name}>
      <label id={labelId} for={selectId} class="mvp-setup-frame__label">
        {props.api.t(props.param.labelKey)}
      </label>
      <select
        id={selectId}
        class="mvp-setup-frame__select"
        aria-labelledby={labelId}
        aria-label={props.api.t(
          props.param.role === 'class'
            ? 'setup.frame.class.selectLabel'
            : 'setup.frame.type.selectLabel',
        )}
        value={canRenderOptionValue(props.param) ? selectValue(props.param) : ''}
        disabled={props.saving !== undefined}
        onChange={(event): void => {
          const value = Number(event.currentTarget.value);
          if (Number.isFinite(value)) props.onWrite(props.param.name, value);
        }}
      >
        <option value="" disabled>
          {props.api.t('setup.frame.selectPlaceholder')}
        </option>
        <For each={props.param.options}>
          {(option: FrameOption) => (
            <option value={String(option.value)}>{props.api.t(option.labelKey)}</option>
          )}
        </For>
      </select>
      <p class="mvp-setup-frame__current">{valueText(props.api, props.param)}</p>
      <Show when={props.param.value !== undefined && props.param.option === undefined}>
        <p class="mvp-setup-frame__warning" role="status">
          {props.api.t('setup.frame.unknownOption', { value: props.param.value ?? '' })}
        </p>
      </Show>
    </div>
  );
}

/** Guided frame setup pane rendered by the wizard shell. */
function FrameStepPanel(props: FrameStepPanelProps): JSX.Element {
  const [loading, setLoading] = createSignal(false);
  const [saving, setSaving] = createSignal<string | undefined>(undefined);
  const [error, setError] = createSignal<string | undefined>(undefined);
  const selection = createMemo(() => props.selection());

  const unsubscribe = props.deps.params.onChange((param) => {
    if (isFrameParamName(param.name)) props.refresh();
  });
  onCleanup(unsubscribe);

  const fetchParams = async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      await props.deps.params.fetchAll();
      props.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const writeParam = async (name: FrameParamName, value: number): Promise<void> => {
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

  onMount(() => {
    void fetchParams();
  });

  return (
    <section class="mvp-setup-frame" data-vehicle-class={selection().vehicleClass}>
      <p class="mvp-setup-frame__description">{props.api.t('setup.frame.description')}</p>

      <Show when={loading()}>
        <p class="mvp-setup-frame__loading" role="status">
          {props.api.t('setup.frame.loading')}
        </p>
      </Show>
      <Show when={saving()}>
        {(name) => (
          <p class="mvp-setup-frame__saving" role="status">
            {props.api.t('setup.frame.savePending', { name: name() })}
          </p>
        )}
      </Show>
      <Show when={error()}>
        {(message) => (
          <p class="mvp-setup-frame__error" role="alert">
            {props.api.t('setup.frame.error', { message: message() })}
          </p>
        )}
      </Show>

      <Show
        when={selection().mode === 'selectable'}
        fallback={
          <div class="mvp-setup-frame__parameters-only" data-mode={selection().mode}>
            <h3>{props.api.t('setup.frame.parametersOnly.title')}</h3>
            <p>
              {selection().mode === 'unsupported'
                ? props.api.t('setup.frame.unsupported')
                : props.api.t('setup.frame.parametersOnly.body')}
            </p>
            <Show when={selection().params.length > 0}>
              <dl class="mvp-setup-frame__params">
                <For each={selection().params}>
                  {(param) => (
                    <>
                      <dt>{props.api.t(param.labelKey)}</dt>
                      <dd>{valueText(props.api, param)}</dd>
                    </>
                  )}
                </For>
              </dl>
            </Show>
          </div>
        }
      >
        <div class="mvp-setup-frame__selectors">
          <Show when={selection().frameEnable}>
            {(param) => (
              <FrameSelect
                api={props.api}
                param={param()}
                saving={saving()}
                onWrite={(name, value): void => {
                  void writeParam(name, value);
                }}
              />
            )}
          </Show>
          <Show when={selection().frameClass}>
            {(param) => (
              <FrameSelect
                api={props.api}
                param={param()}
                saving={saving()}
                onWrite={(name, value): void => {
                  void writeParam(name, value);
                }}
              />
            )}
          </Show>
          <Show when={selection().frameType}>
            {(param) => (
              <FrameSelect
                api={props.api}
                param={param()}
                saving={saving()}
                onWrite={(name, value): void => {
                  void writeParam(name, value);
                }}
              />
            )}
          </Show>
        </div>
      </Show>

      <p class="mvp-setup-frame__status" data-status={frameStatus(selection())} role="status">
        {props.api.t(frameStatusMessageKey(frameStatus(selection())))}
      </p>
    </section>
  );
}

/**
 * Build the frame/type setup step. The status accessor is derived from current
 * parameters and reports `done` only when a valid frame class parameter is set.
 */
export function createFrameStep(deps: FrameStepDeps): SetupStep {
  const [revision, setRevision] = createSignal(0);
  const refresh = (): void => {
    setRevision((value) => value + 1);
  };
  const selection = (): FrameSelection => readSelection(deps, revision);
  const status = (): SettledStatus => frameStatus(selection());

  return {
    id: 'frame',
    title: t('setup.frame.title'),
    icon: '🛠',
    safetyNote: t('setup.frame.safety'),
    status,
    allowManualComplete: false,
    render: (api): JSX.Element => (
      <FrameStepPanel api={api} deps={deps} selection={selection} refresh={refresh} />
    ),
  };
}
