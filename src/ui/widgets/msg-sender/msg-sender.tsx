/**
 * Metadata-driven MAVLink message / MAV_CMD sender widget.
 *
 * The component renders a searchable picker across dialect `MessageMeta` and
 * `MAV_CMD` enum entries, derives type-aware editors from that metadata, and
 * emits via an injected structural send seam. It owns no host singleton and is
 * therefore straightforward to mount with a mock sender in tests.
 */
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onMount,
  type Component,
  type JSX,
} from 'solid-js';
import { BUILTIN_DIALECTS } from '../../../mavlink/dialects';
import { StreamRateService } from '../../../mavlink/microservices/streams';
import {
  buildSenderChoices,
  commandFieldSpecs,
  defaultRawValues,
  enumOptionLabel,
  filterSenderChoices,
  messageFieldSpecs,
  parseMessageFields,
} from './derive';
import './messages';
import './msg-sender.css';
import type {
  CommandChoice,
  CommandWire,
  FieldEditorSpec,
  MessageSenderProps,
  MsgSenderFavorite,
  SenderChoice,
} from './types';

const DEFAULT_TARGET = 1;
const DEFAULT_FRAME = 0;
const FAVORITE_ID_RADIX = 36;

/** The MAVLink message / MAV_CMD sender widget. */
export const MessageSender: Component<MessageSenderProps> = (props) => {
  const t = props.t;
  const dialects = createMemo(() => props.dialects ?? BUILTIN_DIALECTS);
  const choices = createMemo(() => buildSenderChoices(dialects()));
  const [query, setQuery] = createSignal('');
  const [selectionId, setSelectionId] = createSignal('');
  const [fieldValues, setFieldValues] = createSignal<Record<string, string>>({});
  const [signed, setSigned] = createSignal(false);
  const [commandWire, setCommandWire] = createSignal<CommandWire>('long');
  const [targetSystem, setTargetSystem] = createSignal(props.targetSystem ?? DEFAULT_TARGET);
  const [targetComponent, setTargetComponent] = createSignal(
    props.targetComponent ?? DEFAULT_TARGET,
  );
  const [confirmation, setConfirmation] = createSignal(0);
  const [commandFrame, setCommandFrame] = createSignal(DEFAULT_FRAME);
  const [commandCurrent, setCommandCurrent] = createSignal(0);
  const [commandAutocontinue, setCommandAutocontinue] = createSignal(0);
  const [favoriteName, setFavoriteName] = createSignal('');
  const [favorites, setFavorites] = createSignal<readonly MsgSenderFavorite[]>([]);
  const [rateHz, setRateHz] = createSignal(1);
  const [status, setStatus] = createSignal('');

  const filteredChoices = createMemo(() => filterSenderChoices(choices(), query()));

  createEffect(() => {
    const all = choices();
    if (selectionId().length === 0) {
      const first = all[0];
      if (first !== undefined) setSelectionId(first.id);
    }
  });

  const active = createMemo<SenderChoice | undefined>(() =>
    choices().find((choice) => choice.id === selectionId()),
  );

  const specs = createMemo<readonly FieldEditorSpec[]>(() => {
    const choice = active();
    if (choice === undefined) return [];
    return choice.kind === 'message'
      ? messageFieldSpecs(choice.dialect, choice.meta)
      : commandFieldSpecs(choice.dialect, choice.entry);
  });

  createEffect(() => {
    const currentSpecs = specs();
    setFieldValues(defaultRawValues(currentSpecs));
  });

  onMount(() => {
    const store = props.favorites;
    if (store === undefined) return;
    void Promise.resolve(store.load())
      .then((loaded) => setFavorites([...loaded]))
      .catch(() => {
        /* favorites are optional; load failure must not break sending */
      });
  });

  const activeFavorites = createMemo(() =>
    favorites().filter((favorite) => favorite.selectionId === selectionId()),
  );

  const updateField = (name: string, value: string): void => {
    setFieldValues((prev) => ({ ...prev, [name]: value }));
  };

  const sendOptions = (): { signed: boolean } => ({ signed: signed() });

  const sendActive = async (): Promise<void> => {
    const choice = active();
    if (choice === undefined) return;
    try {
      if (choice.kind === 'message') {
        await Promise.resolve(
          props.send(choice.meta.name, parseMessageFields(specs(), fieldValues()), sendOptions()),
        );
        setStatus(t('msgsender.sent', { name: choice.meta.name }));
        return;
      }
      const name = commandWire() === 'long' ? 'COMMAND_LONG' : 'COMMAND_INT';
      await Promise.resolve(props.send(name, commandFields(choice), sendOptions()));
      setStatus(t('msgsender.sent', { name }));
    } catch (err) {
      setStatus(t('msgsender.failed', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const requestRate = async (): Promise<void> => {
    const choice = active();
    if (choice === undefined || choice.kind !== 'message') return;
    try {
      const service = new StreamRateService({
        send: (name, fields) => props.send(name, fields, sendOptions()),
        dialect: choice.dialect,
        targetSystem: targetSystem(),
        targetComponent: targetComponent(),
      });
      await service.setMessageRate(choice.meta.id, rateHz());
      setStatus(t('msgsender.rate.sent', { name: choice.meta.name, hz: rateHz() }));
    } catch (err) {
      setStatus(t('msgsender.failed', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const saveFavorite = (): void => {
    const name = favoriteName().trim();
    if (name.length === 0 || active() === undefined) return;
    const favorite: MsgSenderFavorite = {
      id: makeFavoriteId(),
      name,
      selectionId: selectionId(),
      values: { ...fieldValues() },
      signed: signed(),
      ...(active()?.kind === 'command' ? { commandWire: commandWire() } : {}),
    };
    const next = [...favorites(), favorite];
    setFavorites(next);
    setFavoriteName('');
    const store = props.favorites;
    if (store !== undefined) {
      void Promise.resolve(store.save(next)).catch(() => {
        /* favorites remain usable in memory even if persistence fails */
      });
    }
  };

  const applyFavorite = (favorite: MsgSenderFavorite): void => {
    setFieldValues({ ...favorite.values });
    setSigned(favorite.signed ?? false);
    if (favorite.commandWire !== undefined) setCommandWire(favorite.commandWire);
  };

  const renderEditor = (spec: FieldEditorSpec): JSX.Element => {
    const raw = (): string => fieldValues()[spec.name] ?? '';
    const aria = `${spec.label} ${spec.name}`;
    const commaArray = spec.arrayLen !== undefined && !spec.textArray;
    const textEditor = spec.type === 'char' || spec.textArray || commaArray;
    return (
      <label
        class="mvp-msgsender__field-label"
        classList={{ 'mvp-msgsender__field--unused': spec.unused === true }}
      >
        <span>
          {spec.label}
          <Show when={spec.name !== spec.label}>
            {' '}
            <small>({spec.name})</small>
          </Show>
        </span>
        <Show
          when={spec.enumOptions !== undefined}
          fallback={
            <input
              class="mvp-msgsender__field-input"
              aria-label={aria}
              type={textEditor ? 'text' : 'number'}
              inputmode={spec.type === 'char' || spec.textArray ? 'text' : 'decimal'}
              step={isIntegerType(spec.type) ? '1' : 'any'}
              value={raw()}
              onInput={(e) => updateField(spec.name, e.currentTarget.value)}
            />
          }
        >
          <select
            class="mvp-msgsender__field-select"
            aria-label={aria}
            value={raw()}
            onChange={(e) => updateField(spec.name, e.currentTarget.value)}
          >
            <For each={spec.enumOptions ?? []}>
              {(option) => <option value={String(option.value)}>{enumOptionLabel(option)}</option>}
            </For>
          </select>
        </Show>
        <span class="mvp-msgsender__field-meta">
          <Show when={spec.units}>{(units) => t('msgsender.units', { units: units() })}</Show>
          <Show when={spec.arrayLen !== undefined && !spec.textArray}>
            {t('msgsender.arrayHint', { count: spec.arrayLen ?? 0 })}
          </Show>
        </span>
      </label>
    );
  };

  return (
    <section class="mvp-msgsender" role="region" aria-label={t('msgsender.title')}>
      <div class="mvp-msgsender__picker">
        <label class="mvp-msgsender__label">
          <span>{t('msgsender.search')}</span>
          <input
            class="mvp-msgsender__search"
            type="search"
            aria-label={t('msgsender.search')}
            placeholder={t('msgsender.searchPlaceholder')}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </label>
        <label class="mvp-msgsender__label">
          <span>{t('msgsender.pick')}</span>
          <select
            class="mvp-msgsender__select mvp-msgsender__picker-select"
            aria-label={t('msgsender.pick')}
            value={selectionId()}
            onChange={(e) => setSelectionId(e.currentTarget.value)}
          >
            <For each={filteredChoices()}>
              {(choice) => <option value={choice.id}>{choice.label}</option>}
            </For>
          </select>
        </label>
        <Show when={filteredChoices().length === 0}>
          <p class="mvp-msgsender__empty" role="status">
            {t('msgsender.noChoices')}
          </p>
        </Show>
      </div>

      <fieldset class="mvp-msgsender__options">
        <legend>{t('msgsender.section.options')}</legend>
        <div class="mvp-msgsender__row">
          <label class="mvp-msgsender__label">
            <span>{signed() ? t('msgsender.signed') : t('msgsender.unsigned')}</span>
            <input
              class="mvp-msgsender__signed"
              type="checkbox"
              checked={signed()}
              onChange={(e) => setSigned(e.currentTarget.checked)}
            />
          </label>
          <Show when={active()?.kind === 'command'}>
            <label class="mvp-msgsender__label">
              <span>{t('msgsender.commandWire')}</span>
              <select
                class="mvp-msgsender__select mvp-msgsender__wire"
                aria-label={t('msgsender.commandWire')}
                value={commandWire()}
                onChange={(e) => setCommandWire(e.currentTarget.value as CommandWire)}
              >
                <option value="long">{t('msgsender.commandWire.long')}</option>
                <option value="int">{t('msgsender.commandWire.int')}</option>
              </select>
            </label>
          </Show>
          <label class="mvp-msgsender__label">
            <span>{t('msgsender.targetSystem')}</span>
            <input
              class="mvp-msgsender__input mvp-msgsender__target-system"
              type="number"
              step="1"
              value={String(targetSystem())}
              onInput={(e) => setTargetSystem(numberInput(e.currentTarget.value))}
            />
          </label>
          <label class="mvp-msgsender__label">
            <span>{t('msgsender.targetComponent')}</span>
            <input
              class="mvp-msgsender__input mvp-msgsender__target-component"
              type="number"
              step="1"
              value={String(targetComponent())}
              onInput={(e) => setTargetComponent(numberInput(e.currentTarget.value))}
            />
          </label>
          <Show when={active()?.kind === 'command'}>
            <label class="mvp-msgsender__label">
              <span>{t('msgsender.confirmation')}</span>
              <input
                class="mvp-msgsender__input mvp-msgsender__confirmation"
                type="number"
                step="1"
                value={String(confirmation())}
                onInput={(e) => setConfirmation(numberInput(e.currentTarget.value))}
              />
            </label>
            <Show when={commandWire() === 'int'}>
              <label class="mvp-msgsender__label">
                <span>{t('msgsender.frame')}</span>
                <input
                  class="mvp-msgsender__input mvp-msgsender__frame"
                  type="number"
                  step="1"
                  value={String(commandFrame())}
                  onInput={(e) => setCommandFrame(numberInput(e.currentTarget.value))}
                />
              </label>
              <label class="mvp-msgsender__label">
                <span>{t('msgsender.current')}</span>
                <input
                  class="mvp-msgsender__input mvp-msgsender__current"
                  type="number"
                  step="1"
                  value={String(commandCurrent())}
                  onInput={(e) => setCommandCurrent(numberInput(e.currentTarget.value))}
                />
              </label>
              <label class="mvp-msgsender__label">
                <span>{t('msgsender.autocontinue')}</span>
                <input
                  class="mvp-msgsender__input mvp-msgsender__autocontinue"
                  type="number"
                  step="1"
                  value={String(commandAutocontinue())}
                  onInput={(e) => setCommandAutocontinue(numberInput(e.currentTarget.value))}
                />
              </label>
            </Show>
          </Show>
        </div>
      </fieldset>

      <fieldset class="mvp-msgsender__fields">
        <legend>{t('msgsender.section.fields')}</legend>
        <div class="mvp-msgsender__field-grid">
          <For each={specs()}>{(spec) => renderEditor(spec)}</For>
        </div>
      </fieldset>

      <Show when={active()?.kind === 'message'}>
        <fieldset class="mvp-msgsender__rate">
          <legend>{t('msgsender.rate.title')}</legend>
          <div class="mvp-msgsender__rate-row">
            <label class="mvp-msgsender__label">
              <span>{t('msgsender.rate.hz')}</span>
              <input
                class="mvp-msgsender__input mvp-msgsender__rate-hz"
                type="number"
                min="0"
                step="0.1"
                value={String(rateHz())}
                onInput={(e) => setRateHz(numberInput(e.currentTarget.value))}
              />
            </label>
            <button
              class="mvp-msgsender__button mvp-msgsender__rate-button"
              type="button"
              onClick={() => void requestRate()}
            >
              {t('msgsender.rate.request')}
            </button>
          </div>
        </fieldset>
      </Show>

      <fieldset class="mvp-msgsender__favorites">
        <legend>{t('msgsender.section.favorites')}</legend>
        <div class="mvp-msgsender__favorite-row">
          <label class="mvp-msgsender__label">
            <span>{t('msgsender.favoriteName')}</span>
            <input
              class="mvp-msgsender__input mvp-msgsender__favorite-name"
              value={favoriteName()}
              onInput={(e) => setFavoriteName(e.currentTarget.value)}
            />
          </label>
          <button
            class="mvp-msgsender__button mvp-msgsender__favorite-save"
            type="button"
            onClick={saveFavorite}
          >
            {t('msgsender.saveFavorite')}
          </button>
        </div>
        <Show
          when={activeFavorites().length > 0}
          fallback={<p class="mvp-msgsender__nofav">{t('msgsender.noFavorites')}</p>}
        >
          <ul class="mvp-msgsender__favorite-list">
            <For each={activeFavorites()}>
              {(favorite) => (
                <li>
                  <button
                    class="mvp-msgsender__button mvp-msgsender__favorite-apply"
                    type="button"
                    aria-label={t('msgsender.applyFavorite')}
                    onClick={() => applyFavorite(favorite)}
                  >
                    {favorite.name}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </fieldset>

      <div class="mvp-msgsender__actions">
        <button
          class="mvp-msgsender__button mvp-msgsender__send"
          type="button"
          onClick={() => void sendActive()}
        >
          {t('msgsender.send')}
        </button>
        <output class="mvp-msgsender__status" role="status">
          {status()}
        </output>
      </div>
    </section>
  );

  function commandFields(choice: CommandChoice): Record<string, unknown> {
    const values = fieldValues();
    if (commandWire() === 'int') {
      return {
        param1: numberInput(values.param1 ?? '0'),
        param2: numberInput(values.param2 ?? '0'),
        param3: numberInput(values.param3 ?? '0'),
        param4: numberInput(values.param4 ?? '0'),
        x: numberInput(values.x ?? values.param5 ?? '0'),
        y: numberInput(values.y ?? values.param6 ?? '0'),
        z: numberInput(values.z ?? values.param7 ?? '0'),
        command: choice.entry.value,
        target_system: targetSystem(),
        target_component: targetComponent(),
        frame: commandFrame(),
        current: commandCurrent(),
        autocontinue: commandAutocontinue(),
      };
    }
    return {
      param1: numberInput(values.param1 ?? '0'),
      param2: numberInput(values.param2 ?? '0'),
      param3: numberInput(values.param3 ?? '0'),
      param4: numberInput(values.param4 ?? '0'),
      param5: numberInput(values.param5 ?? values.x ?? '0'),
      param6: numberInput(values.param6 ?? values.y ?? '0'),
      param7: numberInput(values.param7 ?? values.z ?? '0'),
      command: choice.entry.value,
      target_system: targetSystem(),
      target_component: targetComponent(),
      confirmation: confirmation(),
    };
  }
};

function numberInput(raw: string): number {
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : 0;
}

function isIntegerType(type: string): boolean {
  return type.startsWith('uint') || type.startsWith('int');
}

function makeFavoriteId(): string {
  return `fav-${Date.now().toString(FAVORITE_ID_RADIX)}-${Math.random()
    .toString(FAVORITE_ID_RADIX)
    .slice(2)}`;
}
