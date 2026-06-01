/**
 * Bundled extension-API type declaration accessor (task T7.3; spec plan/06
 * §6.4/§6.10).
 *
 * {@link EXT_API_DTS} is the checked-in, auto-generated bundle of the frozen
 * `ctx`/`mvp` type closure (regenerate with `node scripts/gen-ext-dts.mjs`); it
 * carries a `__EXT_API_VERSION__` placeholder. {@link buildExtApiDts} injects
 * the running API version so the scripting console (T7.4) / API reference (T7.5)
 * can hand a versioned declaration to the editor for autocomplete.
 */
import { EXT_API_VERSION } from '../../version';
import { EXT_API_DTS } from './generated-dts';

export { EXT_API_DTS };

/** Placeholder the generator embeds for the version banner. */
const VERSION_TOKEN = /__EXT_API_VERSION__/g;

/** The bundled `.d.ts`, with the version banner resolved to `version`. */
export function buildExtApiDts(version: string = EXT_API_VERSION): string {
  return EXT_API_DTS.replace(VERSION_TOKEN, version);
}
