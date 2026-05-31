/**
 * Locale registry + active-locale signal (T0.8).
 *
 * The active locale is backed by a Solid signal so UI consumers re-render on a
 * runtime language switch (spec plan/05 §5.9). Additional locales (community /
 * extension-provided) register at runtime; partial catalogs are fine because
 * `t()` falls back per-key to English.
 */
import { createSignal, type Accessor } from 'solid-js';
import { EN_MESSAGES, type MessageCatalog } from './catalog';

/** A BCP-47-style locale code, e.g. `'en'`, `'en-US'`, `'fr'`. */
export type LocaleCode = string;

/** The always-present default locale shipped with the app. */
export const DEFAULT_LOCALE: LocaleCode = 'en';

const registry = new Map<LocaleCode, MessageCatalog>([[DEFAULT_LOCALE, EN_MESSAGES]]);

const [activeLocale, setActiveLocale] = createSignal<LocaleCode>(DEFAULT_LOCALE);

/**
 * Reactive accessor for the active locale. Reading it inside a Solid reactive
 * context (component/memo/effect) subscribes that consumer to language changes.
 */
export const locale: Accessor<LocaleCode> = activeLocale;

/** Get the active locale code. Reads the signal, so it is reactive in Solid. */
export function getLocale(): LocaleCode {
  return activeLocale();
}

/**
 * Set the active locale. Unknown/unregistered codes are still applied; `t()`
 * then falls back to English (and ultimately the key) for missing strings.
 */
export function setLocale(code: LocaleCode): void {
  setActiveLocale(code);
}

/**
 * Register (or replace) a runtime locale catalog. Catalogs may be partial:
 * missing keys fall back to English via `t()`.
 *
 * @throws if `code` is empty.
 */
export function registerLocale(code: LocaleCode, messages: MessageCatalog): void {
  if (!code) throw new Error('registerLocale: locale code must be a non-empty string');
  registry.set(code, messages);
}

/** True when a catalog is registered for `code`. */
export function hasLocale(code: LocaleCode): boolean {
  return registry.has(code);
}

/** List all registered locale codes (always includes {@link DEFAULT_LOCALE}). */
export function listLocales(): LocaleCode[] {
  return [...registry.keys()];
}

/**
 * Resolve the registered catalog for `code`, or `undefined` when none exists.
 * Internal helper consumed by `t()`; not part of the call-site contract.
 */
export function catalogFor(code: LocaleCode): MessageCatalog | undefined {
  return registry.get(code);
}
