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

/**
 * Additively merge `messages` into the in-memory catalog for `locale`,
 * letting each UI module contribute its own (namespaced) keys at import time
 * without editing the central English catalog.
 *
 * Unlike {@link registerLocale} this never replaces the existing catalog — keys
 * are merged on top of what is already registered. Merging is last-write-wins:
 * a later registration overrides an earlier entry for the same key (a dev-mode
 * `console.warn` flags such overrides). Registered keys resolve through `t()`
 * with the usual precedence (active locale → English → key) and react to the
 * active-locale signal, so registering under a non-active locale takes effect
 * once {@link setLocale} switches to it.
 *
 * The shipped {@link EN_MESSAGES} object is never mutated: merges produce a new
 * catalog object stored in the registry.
 *
 * @param messages - Flat map of message key → template string to contribute.
 * @param locale - Target locale code; defaults to {@link DEFAULT_LOCALE} (`'en'`).
 * @throws if `locale` is empty.
 */
export function registerMessages(
  messages: Record<string, string>,
  locale: LocaleCode = DEFAULT_LOCALE,
): void {
  if (!locale) throw new Error('registerMessages: locale code must be a non-empty string');
  const existing = registry.get(locale);
  const merged: Record<string, string> = { ...existing, ...messages };
  if (import.meta.env.DEV && existing) {
    for (const key of Object.keys(messages)) {
      if (key in existing) {
        console.warn(
          `registerMessages: key "${key}" overrides an existing entry for locale "${locale}"`,
        );
      }
    }
  }
  registry.set(locale, merged);
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
 * Enumerate the message keys registered for `code` (the union of central
 * {@link EN_MESSAGES} keys and every key contributed via
 * {@link registerMessages}/{@link registerLocale} for that locale).
 *
 * Returns an empty array when no catalog is registered for `code`. Used by the
 * i18n-completeness audit (T8.11) and by {@link pseudoLocaleFromEnglish} to
 * derive a pseudo-locale from the live English catalog. Defaults to
 * {@link DEFAULT_LOCALE} (`'en'`), the source-of-truth catalog.
 */
export function messageKeys(code: LocaleCode = DEFAULT_LOCALE): LocaleCode[] {
  const catalog = registry.get(code);
  return catalog ? Object.keys(catalog) : [];
}

/**
 * Snapshot the registered catalog for `code` as a plain readonly map, or an
 * empty map when none is registered. Unlike {@link catalogFor} this always
 * returns a catalog object (never `undefined`), so audits/derivations can read
 * the full key→string surface without a presence check. Defaults to
 * {@link DEFAULT_LOCALE} (`'en'`).
 */
export function getMessages(code: LocaleCode = DEFAULT_LOCALE): MessageCatalog {
  return registry.get(code) ?? {};
}

/**
 * Resolve the registered catalog for `code`, or `undefined` when none exists.
 * Internal helper consumed by `t()`; not part of the call-site contract.
 */
export function catalogFor(code: LocaleCode): MessageCatalog | undefined {
  return registry.get(code);
}
