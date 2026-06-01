/**
 * Failsafe setup step (T5.8).
 *
 * Exposes {@link createFailsafeStep}, a Setup wizard step that edits the
 * Copter-centric ArduPilot failsafe parameters through {@link ParamClient.get}
 * and {@link ParamClient.set}. Parameters absent from the current cache are not
 * rendered, allowing Plane/Rover/older-firmware variants to degrade gracefully.
 */
import { For, Show, createMemo, createSignal, type Accessor, type Component } from 'solid-js';
import { createParamMetaStore } from '../../../../mavlink/param-meta';
import { t } from '../../../../core/i18n';
import type { ParamClient, VehicleClass } from '../../../../contracts';
import type { SetupStep, TFn } from '../framework';
import {
  deriveFailsafeSections,
  deriveFailsafeStatus,
  isFailsafeParamName,
  type FailsafeField,
  type FailsafeParamName,
} from './metadata';
import './messages';

const PARAM_META = createParamMetaStore();

/** Dependencies required by {@link createFailsafeStep}. */
export interface FailsafeStepDeps {
  /** Parameter client backed by the active vehicle. */
  readonly params: ParamClient;
  /** Current vehicle class accessor used for contextual copy. */
  readonly getVehicleClass: () => VehicleClass;
}

/** Props for the rendered failsafe setup component. */
export interface FailsafeSetupProps extends FailsafeStepDeps {
  /** i18n translate function from the setup framework. */
  readonly t: TFn;
  /** Reactive revision bumped when parameter cache values change. */
  readonly revision: Accessor<number>;
  /** Notify the owning step after a local write completes. */
  readonly onChanged: () => void;
}

type PendingSet = ReadonlySet<FailsafeParamName>;
type ErrorMap = ReadonlyMap<FailsafeParamName, string>;

function pendingWith(prev: PendingSet, name: FailsafeParamName, pending: boolean): PendingSet {
  const next = new Set(prev);
  if (pending) next.add(name);
  else next.delete(name);
  return next;
}

function errorWith(prev: ErrorMap, name: FailsafeParamName, message: string | undefined): ErrorMap {
  const next = new Map(prev);
  if (message === undefined) next.delete(name);
  else next.set(name, message);
  return next;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function inputStep(field: FailsafeField): number | 'any' {
  return field.increment ?? 'any';
}

/** Render the failsafe parameter editor grouped by RC/Battery/GCS/EKF-GPS. */
export const FailsafeSetup: Component<FailsafeSetupProps> = (props) => {
  const [pending, setPending] = createSignal<PendingSet>(new Set<FailsafeParamName>());
  const [errors, setErrors] = createSignal<ErrorMap>(new Map<FailsafeParamName, string>());

  const sections = createMemo(() => {
    props.revision();
    return deriveFailsafeSections((name) => props.params.get(name), PARAM_META);
  });

  const writeField = async (field: FailsafeField, value: number): Promise<void> => {
    if (!Number.isFinite(value)) return;
    setPending((prev) => pendingWith(prev, field.name, true));
    setErrors((prev) => errorWith(prev, field.name, undefined));
    try {
      await props.params.set(field.name, value);
      props.onChanged();
    } catch (err) {
      setErrors((prev) => errorWith(prev, field.name, errorMessage(err)));
    } finally {
      setPending((prev) => pendingWith(prev, field.name, false));
    }
  };

  const onEnumChange = (field: FailsafeField, event: Event): void => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLSelectElement)) return;
    void writeField(field, Number(target.value));
  };

  const onNumberChange = (field: FailsafeField, event: Event): void => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;
    void writeField(field, Number(target.value));
  };

  return (
    <div class="mvp-failsafe" data-vehicle-class={props.getVehicleClass()}>
      <p class="mvp-failsafe__intro">{props.t('setup.failsafe.intro')}</p>
      <p class="mvp-failsafe__vehicle">
        {props.t('setup.failsafe.vehicleClass', { vehicleClass: props.getVehicleClass() })}
      </p>

      <Show
        when={sections().length > 0}
        fallback={
          <p class="mvp-failsafe__empty" role="status">
            {props.t('setup.failsafe.empty')}
          </p>
        }
      >
        <For each={sections()}>
          {(section) => (
            <section class="mvp-failsafe__section" data-section={section.id}>
              <h3 class="mvp-failsafe__section-title">{props.t(section.titleKey)}</h3>
              <div class="mvp-failsafe__fields">
                <For each={section.fields}>
                  {(field) => {
                    const controlId = `mvp-failsafe-${field.name}`;
                    const descriptionId = `${controlId}-description`;
                    const errorId = `${controlId}-error`;
                    const fieldError = (): string | undefined => errors().get(field.name);
                    const isPending = (): boolean => pending().has(field.name);
                    return (
                      <div class="mvp-failsafe__field" data-name={field.name}>
                        <label class="mvp-failsafe__label" for={controlId}>
                          <span class="mvp-failsafe__label-text">{props.t(field.labelKey)}</span>
                          <span class="mvp-failsafe__param-name">{field.name}</span>
                        </label>

                        {field.kind === 'enum' ? (
                          <select
                            id={controlId}
                            class="mvp-failsafe__control mvp-failsafe__select"
                            aria-label={props.t('setup.failsafe.valueFor', { name: field.name })}
                            aria-describedby={descriptionId}
                            disabled={isPending()}
                            value={String(field.value)}
                            onChange={(event): void => onEnumChange(field, event)}
                          >
                            <For each={field.options ?? []}>
                              {(option) => (
                                <option value={String(option.value)}>{option.label}</option>
                              )}
                            </For>
                          </select>
                        ) : (
                          <input
                            id={controlId}
                            class="mvp-failsafe__control mvp-failsafe__input"
                            aria-label={props.t('setup.failsafe.valueFor', { name: field.name })}
                            aria-describedby={descriptionId}
                            type="number"
                            disabled={isPending()}
                            value={String(field.value)}
                            min={field.min}
                            max={field.max}
                            step={inputStep(field)}
                            onChange={(event): void => onNumberChange(field, event)}
                          />
                        )}

                        <p id={descriptionId} class="mvp-failsafe__description">
                          {field.description}
                          <Show when={field.units}>
                            {(units) => (
                              <span class="mvp-failsafe__units">
                                {' '}
                                {props.t('setup.failsafe.units', { units: units() })}
                              </span>
                            )}
                          </Show>
                        </p>

                        <Show when={isPending()}>
                          <p class="mvp-failsafe__pending" role="status">
                            {props.t('setup.failsafe.pending')}
                          </p>
                        </Show>
                        <Show when={fieldError()}>
                          {(message) => (
                            <p id={errorId} class="mvp-failsafe__error" role="alert">
                              {message()}
                            </p>
                          )}
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
            </section>
          )}
        </For>
      </Show>
    </div>
  );
};

/** Create the Setup wizard step for ArduPilot failsafe configuration. */
export function createFailsafeStep(deps: FailsafeStepDeps): SetupStep {
  const [revision, setRevision] = createSignal(0);
  const bump = (): void => {
    setRevision((value) => value + 1);
  };

  deps.params.onChange((param) => {
    if (isFailsafeParamName(param.name)) bump();
  });

  const sections = (): ReturnType<typeof deriveFailsafeSections> => {
    revision();
    return deriveFailsafeSections((name) => deps.params.get(name), PARAM_META);
  };

  return {
    id: 'failsafe',
    title: t('setup.failsafe.title'),
    icon: 'FS',
    safetyNote: t('setup.failsafe.safety'),
    status: () => deriveFailsafeStatus(sections()),
    allowManualComplete: false,
    render: (api) => (
      <FailsafeSetup
        params={deps.params}
        getVehicleClass={deps.getVehicleClass}
        t={api.t}
        revision={revision}
        onChanged={bump}
      />
    ),
  };
}
