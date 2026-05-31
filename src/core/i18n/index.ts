/**
 * i18n public surface (T0.8).
 *
 * Evolved from the T0.1 shim into a runtime-switchable catalog while keeping the
 * exact call-site contract: `t(key, vars?)`. All user-facing strings route
 * through `t()` (conventions plan/implementation/00 §0.3); the active locale is
 * a Solid signal so the UI reacts to language changes (spec plan/05 §5.9).
 *
 * Resolution order for a key: active-locale catalog → English → the key itself.
 *
 * @see ./catalog — message/catalog types + the shipped English strings.
 * @see ./locale — locale registry + active-locale signal.
 * @see ./format — locale-aware Intl number/date helpers.
 */
import { EN_MESSAGES, interpolate, type MessageVars } from './catalog';
import { catalogFor, getLocale } from './locale';

export type { MessageCatalog, MessageVars } from './catalog';
export type { DateInput } from './format';
export type { LocaleCode } from './locale';

export {
  DEFAULT_LOCALE,
  getLocale,
  hasLocale,
  listLocales,
  locale,
  registerLocale,
  setLocale,
} from './locale';
export {
  formatDate,
  formatDateTime,
  formatDecimal,
  formatInteger,
  formatNumber,
  formatTime,
} from './format';

/**
 * Translate `key` in the active locale, substituting `{var}` placeholders.
 *
 * Falls back to the English string, then to `key` itself, so the UI never shows
 * a blank. Reads the active-locale signal, so Solid consumers re-render when the
 * language changes. Backward-compatible with the T0.1 shim signature.
 */
export function t(key: string, vars?: MessageVars): string {
  const active = catalogFor(getLocale());
  const template = active?.[key] ?? EN_MESSAGES[key] ?? key;
  return interpolate(template, vars);
}
